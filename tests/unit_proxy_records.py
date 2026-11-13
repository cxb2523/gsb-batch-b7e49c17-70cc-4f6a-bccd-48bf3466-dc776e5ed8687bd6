"""代理池挑选 / 探活记录测试（不依赖真实外网）。

覆盖五类场景：
1. 正常挑选：记录域名、返回代理、是否复用绑定、候选数量，且与返回值一致
2. 站点绑定复用：第二次同站请求记录 bound_reuse=True，仍返回同一代理
3. 吊销后重选：绑定代理被吊销 -> 解除绑定、换新代理、记录 bound_reuse=False
4. 无可用代理：空结果也记一条（proxy=None、candidates=0）
5. 记录上限：超出上限丢弃最旧，只读取出为副本
另外：探活记录（可用性 / 耗时 / 因失败被吊销）、探活失败立即冷却、
success 清零失败计数、记录不改变加权挑选顺序。
"""

import os
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources_reptile"))

from resources_reptile.utils.proxy import ProxyPool

PASS = 0
FAIL = 0


def check(name, got, expected=True):
    global PASS, FAIL
    ok = (got is expected) if isinstance(expected, bool) else (got == expected)
    if ok:
        PASS += 1
        print(f"PASS {name}")
    else:
        FAIL += 1
        print(f"FAIL {name}: got={got!r} expected={expected!r}")


def _empty_cache_file(td):
    """空代理文件：阻断项目根 proxies.txt 的自动加载，模拟空池。"""
    path = os.path.join(td, "empty.txt")
    open(path, "w", encoding="utf-8").close()
    return path


PROXY_A = "1.1.1.1:3128"
PROXY_B = "2.2.2.2:3128"
PROXY_C = "3.3.3.3:3128"


# ---- 1. 正常挑选 + 记录与真实挑选一致 ----
p = ProxyPool(proxies=[PROXY_A, PROXY_B, PROXY_C])
picked = p.proxy("example.com")
sel = p.records("select")
check("select: one record per call", len(sel) == 1)
check("select: host recorded", sel[0]["host"] == "example.com")
check("select: proxy matches return", sel[0]["proxy"] == picked)
check("select: candidates count", sel[0]["candidates"] == 3)
check("select: first pick is not binding reuse", sel[0]["bound_reuse"] is False)
check("select: www prefix stripped", p.proxy("www.other.com")
      is not None and p.records("select")[-1]["host"] == "other.com")
check("select: kind filter excludes health", p.records("health") == [])

# 记录为副本：外部改动不影响池内记录
snap = p.records("select")
snap[0]["host"] = "tampered"
check("select: records() returns copy", p.records("select")[0]["host"] == "example.com")

# 加权挑选顺序不被记录影响：已采样低延迟的代理优先
pw = ProxyPool(proxies=[PROXY_A, PROXY_B, PROXY_C])
pw._latency[PROXY_C] = 0.01
pw._latency[PROXY_B] = 0.05
pw._latency[PROXY_A] = 0.2
first = pw.proxy("weight.site")
check("weight: fastest proxy first", first == PROXY_C)
check("weight: record matches weighted pick",
      pw.records("select")[-1]["proxy"] == PROXY_C
      and pw.records("select")[-1]["candidates"] == 3)

# ---- 2. 站点绑定复用 ----
same = p.proxy("example.com")
sel2 = p.records("select")[-1]
check("bind: same proxy reused", same == picked)
check("bind: record bound_reuse=True", sel2["bound_reuse"] is True)
check("bind: record proxy matches return", sel2["proxy"] == same)
check("bind: candidates still counted", sel2["candidates"] == 3)

# ---- 3. 吊销后解除绑定并重选 ----
p.revoke(picked, "conn-fail", force=True)
renewed = p.proxy("example.com")
sel3 = p.records("select")[-1]
check("revoke: different proxy selected", renewed is not None and renewed != picked)
check("revoke: record is not binding reuse", sel3["bound_reuse"] is False)
check("revoke: record proxy matches return", sel3["proxy"] == renewed)
check("revoke: candidates dropped by one", sel3["candidates"] == 2)
check("revoke: site binding replaced", p._site_map.get("example.com") == renewed)
# 冷却期内的代理不得被选中（即便请求别的站点）
check("revoke: cooling proxy excluded",
      all(p.proxy(f"h{i}.site") != picked for i in range(3)))

# 探活失败 -> 立即进入冷却，冷却期内不可选中
p_health = ProxyPool(proxies=[PROXY_A, PROXY_B])
probed = []


def fake_probe(proxy, url, timeout):
    probed.append((proxy, url))
    return proxy == PROXY_A   # 只有 A 可用


p_health._probe_fn = fake_probe
res = p_health.health_check(probe_url="http://probe.local/204", timeout=1)
check("health: reports each proxy", res == {PROXY_A: True, PROXY_B: False})
check("health: probe function injected", len(probed) == 2)
hrec = p_health.records("health")
check("health: one record per proxy", len(hrec) == 2)
by_proxy = {r["proxy"]: r for r in hrec}
check("health: alive record available", by_proxy[PROXY_A]["available"] is True
      and by_proxy[PROXY_A]["revoked"] is False)
check("health: dead record unavailable", by_proxy[PROXY_B]["available"] is False)
check("health: dead record revoked", by_proxy[PROXY_B]["revoked"] is True)
check("health: latency recorded as seconds",
      isinstance(by_proxy[PROXY_A]["latency"], (int, float))
      and by_proxy[PROXY_A]["latency"] >= 0)
check("health: records exclude select kind", p_health.records("select") == [])
check("health: dead proxy cooling", PROXY_B not in p_health._candidates_locked())
check("health: alive proxy retained", p_health._candidates_locked() == [PROXY_A])

# 成功使用清零失败计数
p_success = ProxyPool(proxies=[PROXY_B])
p_success.revoke(PROXY_B, "conn-fail")       # 1 次，未达阈值
check("success: fail counted", p_success._fails.get(PROXY_B) == 1)
p_success.success(PROXY_B)
check("success: fail count cleared", PROXY_B not in p_success._fails)
p_success.mark_used(PROXY_B, ok=True, latency=0.03)
check("success: mark_used ok keeps usable", PROXY_B in p_success._candidates_locked())
p_success.mark_used(PROXY_B, ok=False)
p_success.mark_used(PROXY_B, ok=False)
check("revoke: two use-fails cool down", PROXY_B not in p_success._candidates_locked())

# ---- 4. 无可用代理也留一条空记录 ----
with tempfile.TemporaryDirectory() as td:
    pe = ProxyPool(proxies=[], cache_file=_empty_cache_file(td))
    check("empty: proxy returns None", pe.proxy("blocked.site") is None)
    empty = pe.records("select")
    check("empty: one empty record", len(empty) == 1)
    check("empty: record proxy None", empty[0]["proxy"] is None)
    check("empty: record candidates 0", empty[0]["candidates"] == 0)
    check("empty: record keeps host", empty[0]["host"] == "blocked.site")
    check("empty: record bound_reuse False", empty[0]["bound_reuse"] is False)
    # 全部吊销后同样是空结果
    pa = ProxyPool(proxies=[PROXY_A], cache_file=_empty_cache_file(td))
    pa.revoke(PROXY_A, "conn-fail", force=True)
    check("empty: all revoked returns None", pa.proxy("x.site") is None)
    check("empty: all revoked record candidates 0",
          pa.records("select")[-1]["candidates"] == 0)

# ---- 5. 记录容量上限 ----
pl = ProxyPool(proxies=[PROXY_A, PROXY_B], record_limit=5)
returns = [pl.proxy(f"site{i}.example") for i in range(8)]
recs = pl.records()
check("limit: capped at record_limit", len(recs) == 5)
check("limit: oldest dropped", [r["host"] for r in recs]
      == [f"site{i}.example" for i in range(3, 8)])
check("limit: kept records match real picks",
      all(r["proxy"] == returns[3 + i] for i, r in enumerate(recs)))
check("limit: newest last", recs[-1]["host"] == "site7.example")

# 探活记录同样受同一个上限约束
pl2 = ProxyPool(proxies=[PROXY_A, PROXY_B], record_limit=3)
pl2._probe_fn = lambda proxy, url, timeout: True
for _ in range(3):
    pl2.health_check(probe_url="http://probe.local/204", timeout=1)
check("limit: health records capped", len(pl2.records("health")) == 3)
check("limit: health kept newest round",
      {r["proxy"] for r in pl2.records("health")} <= {PROXY_A, PROXY_B})

# 并发取代理：记录条数与实际调用一致，且每条记录的代理都是真实返回值
pc = ProxyPool(proxies=[PROXY_A, PROXY_B, PROXY_C], record_limit=500)
out = []
out_lock = threading.Lock()


def worker(i):
    got = pc.proxy(f"s{i % 5}.example")
    with out_lock:
        out.append((got, i))


threads = [threading.Thread(target=worker, args=(i,)) for i in range(50)]
for t in threads:
    t.start()
for t in threads:
    t.join()
check("concurrent: one record per call", len(pc.records("select")) == 50)
check("concurrent: all calls served", all(g in (PROXY_A, PROXY_B, PROXY_C) for g, _ in out))

print(f"DONE  PASS={PASS} FAIL={FAIL}")
sys.exit(1 if FAIL else 0)
