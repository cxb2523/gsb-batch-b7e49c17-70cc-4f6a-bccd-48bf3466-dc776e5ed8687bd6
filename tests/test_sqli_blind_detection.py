"""
SQL 注入检测器盲注判定逻辑单元测试

覆盖:
- 时间盲注: 无延迟对照请求机制（对照同样慢 -> 不报漏洞；显著慢于对照 -> 报漏洞；
  超时异常同样需要对照）
- 布尔盲注: 多轮一致性（两轮方向一致 -> 可疑；方向不一致 -> 不报；
  基线漂移轮作废）
- 错误型注入行为与置信度不受改动影响
- 判定阈值均可从配置读取，未配置时沿用默认值
"""

import pytest

from core.detectors.injection import sqli as sqli_module
from core.detectors.injection.sqli import SQLiDetector
from core.exceptions import TimeoutError as DetectorTimeoutError

# 模块级别标记 - 标识为单元测试和安全测试
pytestmark = [pytest.mark.unit, pytest.mark.security]

URL = "http://example.com/item"
BASELINE_TEXT = "A" * 1000


class _FakeClock:
    """可控时钟，避免测试中真实等待"""

    def __init__(self):
        self.now = 0.0

    def time(self):
        return self.now

    def advance(self, delta):
        self.now += delta


class _FakeTimeModule:
    """替换 sqli 模块中的 time 模块，仅提供 time()"""

    def __init__(self, clock):
        self._clock = clock

    def time(self):
        return self._clock.time()


class _Resp:
    """最小化的 HTTP 响应对象"""

    def __init__(self, text, status_code=200):
        self.status_code = status_code
        self.text = text
        self.headers = {}
        self.elapsed = 0.0


class _ScriptedClient:
    """按 router 脚本响应的伪 HTTP 客户端

    router(method, url, params, data) 返回:
        (delay_seconds, response_text)  —— 正常响应
        ("timeout", delay_seconds)      —— 抛出超时异常
    """

    def __init__(self, router, clock):
        self._router = router
        self._clock = clock
        self.calls = []

    def _handle(self, method, url, params, data):
        self.calls.append(
            {"method": method, "url": url, "params": params, "data": data}
        )
        outcome = self._router(method, url, params, data)
        if outcome[0] == "timeout":
            self._clock.advance(outcome[1])
            raise DetectorTimeoutError("request timed out", timeout=outcome[1])
        delay, text = outcome
        self._clock.advance(delay)
        return _Resp(text)

    def get(self, url, params=None, headers=None):
        return self._handle("GET", url, params or {}, None)

    def post(self, url, data=None, headers=None):
        return self._handle("POST", url, None, data or {})


def _make_detector(monkeypatch, router, config=None):
    """构造使用脚本化客户端与可控时钟的检测器"""
    clock = _FakeClock()
    client = _ScriptedClient(router, clock)
    detector = SQLiDetector(config=config or {})
    detector._http_client = client
    monkeypatch.setattr(sqli_module, "time", _FakeTimeModule(clock))
    return detector, client


def _value_of(call, param="id"):
    params = call["params"] if call["params"] is not None else call["data"]
    return params.get(param, "")


def _time_router(delay_elapsed, control_outcome, default_delay=0.1):
    """构造时间盲注场景 router

    含 SLEEP 的请求 -> (delay_elapsed, 页面)
    对照请求（不含 SLEEP 的注入变体）-> control_outcome
    基线请求（原始参数值）-> 快速响应
    """

    def router(method, url, params, data):
        value = (params or data or {}).get("id", "")
        if "SLEEP" in value.upper():
            if isinstance(delay_elapsed, tuple) and delay_elapsed[0] == "timeout":
                return delay_elapsed
            return (delay_elapsed, BASELINE_TEXT)
        if value and value != "1":
            # 无延迟对照请求（SLEEP 已被替换/移除）；其他注入探测请求也走此分支，
            # 其响应不含错误特征且长度一致，不会干扰错误型/布尔型判定
            return control_outcome
        return (default_delay, BASELINE_TEXT)

    return router


class TestTimeBasedControlRequest:
    """时间盲注无延迟对照请求机制"""

    def test_reports_when_delay_significantly_slower_than_control(self, monkeypatch):
        """延迟请求显著慢于对照请求 -> 报漏洞，extra 带判定依据"""
        detector, client = _make_detector(
            monkeypatch, _time_router(5.0, (0.2, BASELINE_TEXT))
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is not None
        assert result.vulnerable is True
        assert result.confidence == pytest.approx(0.90)
        assert result.verified is True
        extra = result.extra
        assert extra["injection_type"] == "time-based"
        assert extra["reason_label"] == SQLiDetector.REASON_TIME_CONFIRMED
        assert extra["delay_elapsed"] == pytest.approx(5.0)
        assert extra["control_elapsed"] == pytest.approx(0.2)
        assert extra["control_payload"] == "1' AND 0--"
        assert extra["delay_timed_out"] is False
        # 延迟请求 + 对照请求各一次
        assert len(client.calls) == 2

    def test_no_vuln_when_control_also_slow(self, monkeypatch):
        """对照请求同样慢 -> 链路问题，不报漏洞"""
        detector, client = _make_detector(
            monkeypatch, _time_router(5.0, (5.5, BASELINE_TEXT))
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is None
        # 仍然发送了对照请求用于判定
        assert len(client.calls) == 2

    def test_no_vuln_when_control_also_times_out(self, monkeypatch):
        """延迟请求与对照请求都超时 -> 链路问题，不报漏洞"""
        detector, client = _make_detector(
            monkeypatch, _time_router(("timeout", 5.0), ("timeout", 5.0))
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is None
        assert len(client.calls) == 2

    def test_timeout_exception_still_requires_control(self, monkeypatch):
        """延迟请求直接抛超时异常：对照请求快 -> 才报漏洞（置信度低于正常路径）"""
        detector, client = _make_detector(
            monkeypatch, _time_router(("timeout", 5.0), (0.2, BASELINE_TEXT))
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is not None
        assert result.vulnerable is True
        assert result.confidence == pytest.approx(0.85)
        assert result.verified is False
        extra = result.extra
        assert extra["reason_label"] == SQLiDetector.REASON_TIME_TIMEOUT_CONFIRMED
        assert extra["delay_timed_out"] is True
        assert extra["control_timed_out"] is False
        assert extra["control_elapsed"] == pytest.approx(0.2)

    def test_no_vuln_when_delta_not_significant(self, monkeypatch):
        """延迟请求超阈值但未显著慢于对照 -> 不报漏洞"""
        # 延迟 4.5s 超阈值，对照 3.0s 未超阈值，但耗时差 1.5s < 默认 margin 2.0s
        detector, _ = _make_detector(monkeypatch, _time_router(4.5, (3.0, BASELINE_TEXT)))

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is None

    def test_below_threshold_skips_control_request(self, monkeypatch):
        """首次请求未超阈值 -> 不发送对照请求"""
        detector, client = _make_detector(
            monkeypatch, _time_router(1.0, (0.2, BASELINE_TEXT))
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is None
        assert len(client.calls) == 1

    def test_end_to_end_detect_no_vuln_when_control_also_slow(self, monkeypatch):
        """端到端: 网络抖动（对照同样慢）时 detect() 不产出任何漏洞结论"""
        detector, _ = _make_detector(
            monkeypatch, _time_router(5.0, (5.2, BASELINE_TEXT))
        )

        results = detector.detect(URL, params={"id": "1"})

        assert results == []

    def test_end_to_end_detect_reports_with_explainable_extra(self, monkeypatch):
        """端到端: 显著慢于对照时 detect() 产出带判定依据的结果"""
        detector, _ = _make_detector(
            monkeypatch, _time_router(5.0, (0.2, BASELINE_TEXT))
        )

        results = detector.detect(URL, params={"id": "1"})

        assert len(results) == 1
        result = results[0]
        assert result.extra["injection_type"] == "time-based"
        assert result.extra["reason_label"] == SQLiDetector.REASON_TIME_CONFIRMED
        assert "delay_elapsed" in result.extra
        assert "control_elapsed" in result.extra

    def test_time_threshold_from_config(self, monkeypatch):
        """time_threshold 从配置读取：阈值调高后同样的耗时不触发对照"""
        detector, client = _make_detector(
            monkeypatch,
            _time_router(5.0, (0.2, BASELINE_TEXT)),
            config={"time_threshold": 10},
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is None
        assert len(client.calls) == 1  # 未超阈值，未发送对照请求

    def test_control_margin_from_config(self, monkeypatch):
        """time_control_margin 从配置读取：显著性差不足配置值时不报"""
        detector, _ = _make_detector(
            monkeypatch,
            _time_router(5.0, (0.2, BASELINE_TEXT)),
            config={"time_control_margin": 10.0},
        )

        result = detector._check_time_based(
            URL, {"id": "1"}, "id", "1' AND SLEEP(5)--", "1", "GET", {}
        )

        assert result is None


class TestControlPayloadBuilder:
    """无延迟对照 payload 构造"""

    @pytest.mark.parametrize(
        "payload,expected",
        [
            ("1' AND SLEEP(5)--", "1' AND 0--"),
            ("' AND SLEEP(5)--", "' AND 0--"),
            ('" AND SLEEP(5)--', '" AND 0--'),
            ("1' AND pg_sleep(5)--", "1' AND 0--"),
            ("1' AND BENCHMARK(5000000,SHA1('test'))--", "1' AND 0--"),
            ("'; WAITFOR DELAY '0:0:5'--", "'--"),
            ("'; SELECT SLEEP(5);--", "'; SELECT 0;--"),
        ],
    )
    def test_delay_primitives_removed(self, payload, expected):
        assert SQLiDetector._build_control_payload(payload, "1") == expected

    def test_unknown_delay_primitive_falls_back_to_original_value(self):
        # 无法识别/清理的延迟原语 -> 回退到参数原始值
        control = SQLiDetector._build_control_payload("1' OR SLEEP(5)--", "7")
        assert "SLEEP" not in control.upper()
        assert control in ("1' OR 0--", "7")


def _boolean_router(plan, baseline_text=BASELINE_TEXT):
    """构造布尔盲注场景 router

    plan: 真假条件请求（按发起顺序）的响应长度队列；队列耗尽后返回基线长度。
    """
    remaining = list(plan)

    def router(method, url, params, data):
        value = (params or data or {}).get("id", "")
        if "'1'='1" in value or "'1'='2" in value:
            length = remaining.pop(0) if remaining else len(baseline_text)
            return (0.05, "A" * length)
        return (0.05, baseline_text)

    return router


class TestBooleanBasedRounds:
    """布尔盲注多轮一致性判定"""

    def test_two_consistent_rounds_report_suspicious(self, monkeypatch):
        """两轮真假长度差方向一致 -> 判为可疑，extra 带各轮长度差"""
        detector, _ = _make_detector(monkeypatch, _boolean_router([1000, 800, 1000, 800]))

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is not None
        assert result.vulnerable is True
        assert result.confidence == pytest.approx(0.75)
        assert result.verified is False
        extra = result.extra
        assert extra["injection_type"] == "boolean-based"
        assert extra["reason_label"] == SQLiDetector.REASON_BOOL_CONSISTENT
        assert extra["direction"] == "true_longer"
        assert extra["round_diffs"] == [200, 200]
        assert extra["valid_rounds"] == 2
        assert len(extra["rounds"]) == 2
        assert all(r["status"] == "ok" for r in extra["rounds"])

    def test_inconsistent_directions_no_vuln(self, monkeypatch):
        """两轮真假长度差方向不一致 -> 不报漏洞"""
        # 第 1 轮 true 更长（+200），第 2 轮 false 更长（-200），两轮均有效
        detector, _ = _make_detector(monkeypatch, _boolean_router([1000, 800, 1000, 1200]))

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is None

    def test_unstable_round_voided_no_vuln(self, monkeypatch):
        """某轮真条件与基线漂移过大 -> 该轮作废，有效轮不足两轮 -> 不报漏洞"""
        # 第 1 轮正常（true=1000, false=800）；第 2 轮 true=1300 漂移 30% > 15% 阈值
        detector, _ = _make_detector(monkeypatch, _boolean_router([1000, 800, 1300, 800]))

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is None

    def test_no_signal_when_lengths_match(self, monkeypatch):
        """真假长度差不超过阈值 -> 轮次作废，不报漏洞"""
        detector, _ = _make_detector(monkeypatch, _boolean_router([1000, 980, 1000, 980]))

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is None

    def test_boolean_rounds_from_config(self, monkeypatch):
        """boolean_rounds 从配置读取：配置 3 轮时需 3 轮一致才报"""
        detector, client = _make_detector(
            monkeypatch,
            _boolean_router([1000, 800] * 3),
            config={"boolean_rounds": 3},
        )

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is not None
        assert result.extra["valid_rounds"] == 3
        assert len(result.extra["rounds"]) == 3
        # 3 轮 x (真 + 假) 共 6 次布尔请求
        bool_calls = [c for c in client.calls if "'1'='" in _value_of(c)]
        assert len(bool_calls) == 6

    def test_diff_ratio_threshold_from_config(self, monkeypatch):
        """boolean_diff_ratio 从配置读取：阈值调高后同样的长度差不报"""
        detector, _ = _make_detector(
            monkeypatch,
            _boolean_router([1000, 800, 1000, 800]),
            config={"boolean_diff_ratio": 0.5},
        )

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is None

    def test_baseline_drift_threshold_from_config(self, monkeypatch):
        """boolean_baseline_drift 从配置读取：阈值放宽后漂移轮不再作废"""
        # true=1200 漂移 20%：默认 15% 阈值下作废，放宽到 0.25 后有效
        detector, _ = _make_detector(
            monkeypatch,
            _boolean_router([1200, 800, 1200, 800]),
            config={"boolean_baseline_drift": 0.25},
        )

        result = detector._check_boolean_based(
            URL, {"id": "1"}, "id", _Resp(BASELINE_TEXT), "GET", {}
        )

        assert result is not None
        assert result.extra["valid_rounds"] == 2

    def test_default_thresholds_unchanged(self):
        """未配置时沿用现有默认阈值"""
        detector = SQLiDetector()

        assert detector.TIME_THRESHOLD == 4
        assert detector.TIME_DELAY == 5
        assert detector.boolean_rounds == 2
        assert detector.boolean_diff_ratio == pytest.approx(0.1)
        assert detector.boolean_baseline_drift == pytest.approx(0.15)


class TestErrorBasedUnaffected:
    """错误型注入行为与置信度不受盲注改动影响"""

    def test_error_based_result_unchanged(self, monkeypatch):
        error_text = (
            "You have an error in your SQL syntax; check the manual that "
            "corresponds to your MySQL server version for the right syntax"
        )

        def router(method, url, params, data):
            value = (params or data or {}).get("id", "")
            if value != "1":
                return (0.05, error_text)
            return (0.05, BASELINE_TEXT)

        detector, _ = _make_detector(
            monkeypatch,
            router,
            config={"check_time_based": False, "check_boolean_based": False},
        )

        results = detector.detect(URL, params={"id": "1"})

        assert len(results) == 1
        result = results[0]
        assert result.vulnerable is True
        assert result.confidence == pytest.approx(0.95)
        assert result.verified is True
        assert result.extra["injection_type"] == "error-based"
        assert result.extra["db_type"] == "mysql"
        assert "reason_label" not in result.extra
        assert "SQL syntax" in result.evidence


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
