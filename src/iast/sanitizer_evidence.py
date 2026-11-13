"""请求级消毒器证据归集（A4 链路层）：把探针快照、请求归集与 sink 族判定串成可核对链路。

设计定位：``sanitizer_trace.py`` 只有解析与判族两个纯函数，本模块补上中间的**状态层**——
按 requestId 归集 sink 实参上的消毒器快照（``sanitizerId|family1,family2``），
支持同一请求内控制器线程写入、sink 线程读取的跨线程场景，并在读取时给出三态判定：

- ``NO_RECORD``  无任何消毒记录 → 证据缺失（铁律：证据缺失 ≠ 阴性，绝不能当阴性）。
- ``ORTHOGONAL`` 有记录但针对族不含当前 sink 族（且非通配）→ 消毒器与本族注入正交，
  不构成阴性（只中和 HTML 的转义器对 SQL 不安全）。
- ``SANITIZED``  有记录且针对当前族或通配（空族列表 / ``*`` / ``all``）→ 合法阴性。

族判定**完全复用** ``sanitizer_trace.is_sanitized_for_family`` 的既有口径，本模块不另立规则。

上限与清理（防池化线程串证据）：
- 共享归集表有 ``max_active_requests`` 上限；超限后新请求只写入**线程本地单槽**
  （每线程只保留最近一个退化请求的记录），不无限增长，也不挤占在表请求。
- ``clear_request`` 把该请求的共享记录**整条一次性移除**；线程本地槽按 requestId 匹配，
  请求结束即失效，池化线程不会把上一个请求的消毒证据带给下一个请求。
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from src.iast.sanitizer_trace import is_sanitized_for_family, parse_sanitizer_record

# 三态判定结果（字符串常量，便于落库 / 日志直接序列化）。
NO_RECORD = "no-record"
ORTHOGONAL = "orthogonal"
SANITIZED = "sanitized"

# 默认活跃请求上限：超出后新请求退化为线程本地，保护共享表不无限增长。
DEFAULT_MAX_ACTIVE_REQUESTS = 1024


@dataclass(frozen=True)
class SanitizerVerdict:
    """一次 sink 时刻的消毒器证据判定结果（可核对：携带所见记录与命中记录）。"""

    status: str                      # NO_RECORD / ORTHOGONAL / SANITIZED
    request_id: str
    family: str
    records: Tuple[Dict[str, Any], ...] = field(default_factory=tuple)   # 本请求所见全部解析记录
    matched: Tuple[Dict[str, Any], ...] = field(default_factory=tuple)   # 其中对当前族生效的记录
    degraded: bool = False           # True 表示证据来自线程本地退化槽（共享表超限）

    @property
    def is_legitimate_negative(self) -> bool:
        """仅 SANITIZED 构成合法阴性；NO_RECORD / ORTHOGONAL 一律不得当阴性。"""
        return self.status == SANITIZED


class SanitizerEvidenceRegistry:
    """按 requestId 归集消毒器快照的线程安全注册表。

    写入路径（probe 事件入库 / 控制器线程）调用 :meth:`record_snapshot`；
    sink 时刻（可能在另一线程）调用 :meth:`evaluate`；请求结束调用 :meth:`clear_request`。
    """

    def __init__(self, max_active_requests: int = DEFAULT_MAX_ACTIVE_REQUESTS):
        self._max_active = max(1, int(max_active_requests))
        self._lock = threading.Lock()
        # 共享表：requestId -> [raw snapshot, ...]，跨线程可见。
        self._shared: Dict[str, List[str]] = {}
        # 退化槽：每线程单槽 {"request_id": rid, "raws": [...]}，仅共享表超限时启用。
        # 单槽替换语义保证：a) 内存有界（每线程至多一个请求）；b) 新请求覆盖旧请求，
        # 池化线程不会把上一请求的残留证据带给下一请求。
        self._local = threading.local()

    # ------------------------------------------------------------------ 写入 #
    def record_snapshot(self, request_id: str, raw: Any) -> bool:
        """在 sink 实参上记录一条消毒器快照（任意线程可写）。

        返回 True 表示写入共享表（跨线程可见）；False 表示共享表超限、
        已退化为线程本地（仅本线程后续可读）。
        空 request_id 无法归集，直接丢弃并返回 False。
        """
        rid = (request_id or "").strip()
        if not rid:
            return False
        raw_s = (raw or "").strip()
        if not raw_s:
            # 空快照等价于探针未记录，不占归集表（与 parse_sanitizer_record 的 present=False 对齐）。
            return self._has_request(rid)
        with self._lock:
            raws = self._shared.get(rid)
            if raws is None:
                if len(self._shared) >= self._max_active:
                    return self._record_local(rid, raw_s)
                raws = self._shared[rid] = []
            raws.append(raw_s)
            return True

    def _record_local(self, rid: str, raw_s: str) -> bool:
        """超限退化：写入本线程单槽（覆盖该线程上一个退化请求）。"""
        slot = getattr(self._local, "slot", None)
        if slot is None or slot["request_id"] != rid:
            slot = {"request_id": rid, "raws": []}
            self._local.slot = slot
        slot["raws"].append(raw_s)
        return False

    def _has_request(self, rid: str) -> bool:
        with self._lock:
            if rid in self._shared:
                return True
        slot = getattr(self._local, "slot", None)
        return bool(slot and slot["request_id"] == rid and slot["raws"])

    # ------------------------------------------------------------------ 读取 #
    def evaluate(self, request_id: str, family: str = "") -> SanitizerVerdict:
        """sink 时刻判定：归集本请求全部快照，按 sanitizer_trace 既有口径给三态。

        证据来源 = 共享表记录 ∪ 本线程退化槽记录（requestId 匹配时）。
        """
        rid = (request_id or "").strip()
        fam = (family or "").strip()
        raws, degraded = self._collect(rid)
        records = tuple(parse_sanitizer_record(r) for r in raws)
        present = tuple(rec for rec in records if rec["present"])
        if not present:
            return SanitizerVerdict(NO_RECORD, rid, fam, records, (), degraded)
        matched = tuple(rec for rec in present
                        if is_sanitized_for_family(rec["raw"], fam))
        if matched:
            return SanitizerVerdict(SANITIZED, rid, fam, records, matched, degraded)
        return SanitizerVerdict(ORTHOGONAL, rid, fam, records, (), degraded)

    def _collect(self, rid: str) -> Tuple[List[str], bool]:
        if not rid:
            return [], False
        with self._lock:
            raws = list(self._shared.get(rid, ()))
        slot = getattr(self._local, "slot", None)
        if slot and slot["request_id"] == rid:
            raws.extend(slot["raws"])
            return raws, True
        return raws, False

    # ------------------------------------------------------------------ 清理 #
    def clear_request(self, request_id: str) -> bool:
        """请求结束：整条记录一次性移除（共享表 + 本线程退化槽）。

        池化线程复用时不存在「上一个请求的消毒证据」：共享表条目整体删除，
        线程本地槽按 requestId 精确匹配、命中即清。
        返回是否有记录被移除。
        """
        rid = (request_id or "").strip()
        removed = False
        if rid:
            with self._lock:
                removed = self._shared.pop(rid, None) is not None
        slot = getattr(self._local, "slot", None)
        if slot and slot["request_id"] == rid:
            self._local.slot = None
            removed = True
        return removed

    # ------------------------------------------------------------------ 观测 #
    @property
    def active_requests(self) -> int:
        """共享表中的活跃请求数（不含线程本地退化槽）。"""
        with self._lock:
            return len(self._shared)

    def is_degraded(self, request_id: str) -> bool:
        """该请求的证据是否只落在线程本地退化槽（共享表超限所致）。"""
        rid = (request_id or "").strip()
        if not rid:
            return False
        with self._lock:
            if rid in self._shared:
                return False
        slot = getattr(self._local, "slot", None)
        return bool(slot and slot["request_id"] == rid and slot["raws"])


# 进程级默认注册表：probe 事件入库与 sink 判定共用同一实例，保证跨线程可见。
DEFAULT_REGISTRY = SanitizerEvidenceRegistry()


def record_snapshot(request_id: str, raw: Any) -> bool:
    """写入默认注册表，见 :meth:`SanitizerEvidenceRegistry.record_snapshot`。"""
    return DEFAULT_REGISTRY.record_snapshot(request_id, raw)


def evaluate(request_id: str, family: str = "") -> SanitizerVerdict:
    """读取默认注册表，见 :meth:`SanitizerEvidenceRegistry.evaluate`。"""
    return DEFAULT_REGISTRY.evaluate(request_id, family)


def clear_request(request_id: str) -> bool:
    """清理默认注册表，见 :meth:`SanitizerEvidenceRegistry.clear_request`。"""
    return DEFAULT_REGISTRY.clear_request(request_id)
