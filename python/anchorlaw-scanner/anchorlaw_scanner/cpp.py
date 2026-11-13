# -*- coding: utf-8 -*-
"""注释式标注提取器（C++ / Go / Java）：scanner 识别 @anchor 注释式标注（语言无关的标注抽象）。

设计原则（通用协议性）：
- Anchor 是语言无关的概念：声明位置 + 验证载体。
- Python: 装饰器 @test(...)（运行时注册）
- TypeScript: JSDoc 注释（现有实现）
- C++ / Go / Java: 行注释 // @anchor.test(...) / // @anchor.idk(...)（§2.4/§13 v0.16 登记）
- 验证载体独立：通常是 probe/test binary（如 block_probe.cpp 对比参考实现输出）

本模块实现注释式语言文件的标注提取与格式验证（不做完整 AST 分析，
避免把协议 scanner 变成语言编译器）。
"""
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Union

# 注释式标注语言源文件扩展名（C++ / Go / Java）
CPP_EXTENSIONS = {".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hh", ".hxx", ".go", ".java"}

# // @anchor.test("描述", source="trace:...") 或 // @anchor.idk("描述")
# DOTALL 使标注可以跨行书写：在整份源码上匹配（连续行已按原顺序天然拼接），
# 非贪婪的 .*? 保证每条标注在遇到的第一个右括号处闭合，两段完整的单行标注
# 不会被误拼成一条。
_ANCHOR_RE = re.compile(
    r"@anchor\.(?P<kind>test|idk)\s*\(\s*"
    r"(?P<desc>[\"'])(?P<description>.*?)(?P=desc)"
    r"(?P<rest>.*?)\)",
    re.DOTALL,
)

# source 字段：source="..." （test 必填）
_SOURCE_RE = re.compile(r'source\s*=\s*["\']([^"\']*)["\']')


@dataclass
class CppAnchor:
    """C++ 文件中提取出的一个 anchor 标注。"""
    kind: str            # "test" | "idk"
    description: str
    source: str          # 验证载体引用（probe/trace/文件）；test 必须提供
    file_path: str
    line_number: int
    valid: bool          # 格式是否合规（test 必须有 source）
    issues: List[str] = field(default_factory=list)


@dataclass
class CppParseError:
    """文件无法按 UTF-8 解码时的解析失败项（工具级标记，不是 anchor 结果）。

    出现解析失败的文件不再产出任何 @anchor 结果，避免坏编码被静默吞成
    “标注缺失”或描述残缺。
    """
    category: str         # 固定为 "parse-error"
    severity: str         # 固定为 "info"
    file_path: str
    line_number: int      # 首个解码失败所在行（1 起）
    message: str          # 含 "decode error" 与原始异常信息


def is_cpp_file(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in CPP_EXTENSIONS


def _decode_utf8(raw: bytes) -> Union[str, CppParseError]:
    """严格按 UTF-8 解码；失败时返回带首个失败行号的 CppParseError，
    绝不使用替换字符继续。"""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as e:
        # 首个解码失败位置之前的换行符数 +1 即失败所在行（1 起）
        line_number = raw.count(b"\n", 0, e.start) + 1
        return CppParseError(
            category="parse-error",
            severity="info",
            file_path="",
            line_number=line_number,
            message=f"decode error: {type(e).__name__}: {e}",
        )


def _line_number_at(source: str, position: int) -> int:
    """字符偏移量 → 1 起行号（LF / CRLF 均适用）。"""
    return source.count("\n", 0, position) + 1


def scan_cpp_file(
    file_path: str, source: Optional[str] = None
) -> List[Union[CppAnchor, CppParseError]]:
    """扫描一个 C++/Go/Java 文件，提取并校验 @anchor 标注。

    source 参数（可选）提供文件内容，避免重复读取。
    返回 CppAnchor 列表（含格式校验结果）；若文件无法按 UTF-8 解码，
    则返回仅含一个 CppParseError 的列表，且不产出任何 anchor。
    """
    if source is None:
        with open(file_path, "rb") as f:
            raw = f.read()
        decoded = _decode_utf8(raw)
        if isinstance(decoded, CppParseError):
            decoded.file_path = file_path
            return [decoded]
        source = decoded

    anchors: List[CppAnchor] = []
    # 在整份源码上匹配：连续行按原顺序拼接，跨行标注（如
    # `// @anchor.test("描述",` 换行接 `source="probe:x")`）可被完整识别；
    # 行号取标注起始行（@anchor 出现的位置）。
    for m in _ANCHOR_RE.finditer(source):
        kind = m.group("kind")
        description = m.group("description").strip()
        rest = m.group("rest")
        sm = _SOURCE_RE.search(rest)
        src = sm.group(1) if sm else ""

        issues: List[str] = []
        if not description:
            issues.append("description 为空")
        if kind == "test" and not src:
            issues.append("test 标注必须提供 source 字段（验证载体引用）")

        anchors.append(CppAnchor(
            kind=kind,
            description=description,
            source=src,
            file_path=file_path,
            line_number=_line_number_at(source, m.start()),
            valid=not issues,
            issues=issues,
        ))
    return anchors


def summarize_cpp(anchors: List[CppAnchor]) -> Dict:
    """C++ 标注汇总。"""
    summary = {
        "total": len(anchors),
        "test": sum(1 for a in anchors if a.kind == "test"),
        "idk": sum(1 for a in anchors if a.kind == "idk"),
        "invalid": [a for a in anchors if not a.valid],
    }
    return summary
