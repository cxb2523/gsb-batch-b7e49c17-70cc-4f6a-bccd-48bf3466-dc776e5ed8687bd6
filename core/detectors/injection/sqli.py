"""
SQL 注入检测器

检测 SQL 注入漏洞，支持错误型、时间盲注、UNION 注入等多种技术
"""

import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

# 导入项目统一异常类型
from core.exceptions import ConnectionError as DetectorConnectionError
from core.exceptions import HTTPError
from core.exceptions import TimeoutError as DetectorTimeoutError

from ..base import BaseDetector
from ..factory import register_detector
from ..payloads import PayloadCategory, get_payloads
from ..result import DetectionResult, DetectorType, Severity

logger = logging.getLogger(__name__)


@register_detector("sqli")
class SQLiDetector(BaseDetector):
    """SQL 注入检测器

    支持的检测技术:
    - 错误型注入 (Error-based)
    - 时间盲注 (Time-based Blind)
    - 布尔盲注 (Boolean-based Blind)
    - UNION 注入
    - 堆叠查询 (Stacked Queries)

    使用示例:
        detector = SQLiDetector()
        results = detector.detect("https://example.com/search", params={"q": "test"})
    """

    name = "sqli"
    description = "SQL 注入漏洞检测器"
    vuln_type = "sqli"
    severity = Severity.CRITICAL
    detector_type = DetectorType.INJECTION
    version = "2.0.0"

    # 数据库错误特征模式
    ERROR_PATTERNS = {
        "mysql": [
            r"SQL syntax.*MySQL",
            r"Warning.*mysql_",
            r"Warning.*mysqli_",
            r"valid MySQL result",
            r"MySqlClient\.",
            r"com\.mysql\.jdbc",
            r"Syntax error or access violation",
            r"You have an error in your SQL syntax",
            r"MySQL server version for the right syntax",
            r"mysqli_fetch",
            r"mysql_fetch",
            r"Unknown column '.*' in",
        ],
        "postgresql": [
            r"PostgreSQL.*ERROR",
            r"Warning.*pg_",
            r"valid PostgreSQL result",
            r"Npgsql\.",
            r"PG::SyntaxError",
            r"org\.postgresql\.util\.PSQLException",
            r"ERROR:\s+syntax error at or near",
            r"unterminated quoted string at or near",
        ],
        "mssql": [
            r"Driver.* SQL[-_ ]*Server",
            r"OLE DB.* SQL Server",
            r"Microsoft SQL Native Client",
            r"ODBC SQL Server Driver",
            r"SQLServer JDBC Driver",
            r"com\.microsoft\.sqlserver\.jdbc",
            r"Unclosed quotation mark after the character string",
            r"Incorrect syntax near",
            r"SQL Server.*Driver",
            r"mssql_query\(\)",
        ],
        "oracle": [
            r"Oracle error",
            r"ORA-\d{4,5}",
            r"Oracle.*Driver",
            r"Warning.*oci_",
            r"Warning.*ora_",
            r"quoted string not properly terminated",
            r"oracle\.jdbc\.driver",
        ],
        "sqlite": [
            r"SQLite.*error",
            r"sqlite3\.OperationalError",
            r"SQLite3::SQLException",
            r"SQLITE_ERROR",
            r"near \".*\": syntax error",
            r"unrecognized token:",
        ],
        "generic": [
            r"SQLSTATE\[[0-9A-Z]+\]",
            r"SQL command not properly ended",
            r"syntax error at end of input",
            r"Unexpected end of command in statement",
            r"Invalid query",
            r"Database error",
            r"SQL Error",
        ],
    }

    # 时间盲注检测的延迟时间（秒）
    TIME_DELAY = 5
    TIME_THRESHOLD = 4  # 判定阈值（默认值，可被配置覆盖）

    # 时间盲注对照请求判定默认值
    # 延迟请求相对对照请求至少需要多出的绝对耗时（秒）
    TIME_CONTROL_MARGIN = 2.0
    # 延迟请求相对对照请求至少需要达到的耗时倍数
    TIME_CONTROL_RATIO = 1.5

    # 布尔盲注判定默认值
    # 同一组真假 payload 的重复轮数（至少两轮）
    BOOLEAN_ROUNDS = 2
    # 真假条件响应长度差占基线长度的比例阈值
    BOOLEAN_DIFF_RATIO = 0.1
    # 真条件响应相对基线的漂移比例阈值，超过则该轮作废
    BOOLEAN_BASELINE_DRIFT = 0.15

    # 判定依据原因标签（写入 DetectionResult.extra["reason_label"]）
    REASON_TIME_CONFIRMED = "time_delay_vs_control_confirmed"
    REASON_TIME_TIMEOUT_CONFIRMED = "time_timeout_vs_control_confirmed"
    REASON_TIME_CONTROL_SLOW = "time_control_also_slow_link_issue"
    REASON_TIME_NO_SIGNIFICANT_DELTA = "time_delay_not_significant_vs_control"
    REASON_TIME_CONTROL_UNAVAILABLE = "time_control_request_failed"
    REASON_BOOL_CONSISTENT = "boolean_two_rounds_consistent_diff"
    REASON_BOOL_DIRECTION_MISMATCH = "boolean_round_directions_inconsistent"
    REASON_BOOL_UNSTABLE_PAGE = "boolean_round_voided_baseline_drift"
    REASON_BOOL_INSUFFICIENT_ROUNDS = "boolean_insufficient_valid_rounds"

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化检测器

        Args:
            config: 配置选项
                - max_payloads: 最大 payload 数量
                - time_delay: 时间盲注延迟时间
                - time_threshold: 时间盲注耗时判定阈值（秒）
                - time_control_margin: 延迟请求相对对照请求的最小显著耗时差（秒）
                - time_control_ratio: 延迟请求相对对照请求的最小显著耗时倍数
                - boolean_rounds: 布尔盲注每组真假 payload 的重复轮数（>=2）
                - boolean_diff_ratio: 布尔盲注真假长度差比例阈值
                - boolean_baseline_drift: 布尔盲注真条件相对基线的漂移阈值
                - check_time_based: 是否检测时间盲注
                - check_error_based: 是否检测错误型注入
                - check_boolean_based: 是否检测布尔盲注
        """
        super().__init__(config)

        # 加载 payload
        max_payloads = self.config.get("max_payloads", 30)
        self.payloads = self._enhance_payloads(
            get_payloads(PayloadCategory.SQLI, limit=max_payloads)
        )

        # 编译错误模式正则
        self._compiled_patterns: Dict[str, List[re.Pattern]] = {}
        for db_type, patterns in self.ERROR_PATTERNS.items():
            self._compiled_patterns[db_type] = [re.compile(p, re.IGNORECASE) for p in patterns]

        # 检测选项
        self.check_error_based = self.config.get("check_error_based", True)
        self.check_time_based = self.config.get("check_time_based", True)
        self.check_boolean_based = self.config.get("check_boolean_based", True)

        # 时间盲注阈值：未配置时沿用类属性默认值
        self.TIME_DELAY = self.config.get("time_delay", self.TIME_DELAY)
        self.TIME_THRESHOLD = self.config.get("time_threshold", self.TIME_THRESHOLD)
        self.time_control_margin = self.config.get(
            "time_control_margin", self.TIME_CONTROL_MARGIN
        )
        self.time_control_ratio = self.config.get(
            "time_control_ratio", self.TIME_CONTROL_RATIO
        )

        # 布尔盲注阈值：未配置时沿用类属性默认值
        try:
            configured_rounds = int(self.config.get("boolean_rounds", self.BOOLEAN_ROUNDS))
            self.boolean_rounds = max(2, configured_rounds)
        except (TypeError, ValueError):
            self.boolean_rounds = self.BOOLEAN_ROUNDS
        self.boolean_diff_ratio = self.config.get(
            "boolean_diff_ratio", self.BOOLEAN_DIFF_RATIO
        )
        self.boolean_baseline_drift = self.config.get(
            "boolean_baseline_drift", self.BOOLEAN_BASELINE_DRIFT
        )

    def detect(self, url: str, **kwargs) -> List[DetectionResult]:
        """检测 SQL 注入漏洞

        Args:
            url: 目标 URL
            **kwargs:
                params: GET 参数字典
                data: POST 数据字典
                method: HTTP 方法
                headers: 请求头

        Returns:
            检测结果列表
        """
        self._log_detection_start(url)
        results: List[DetectionResult] = []

        # 获取参数
        params = kwargs.get("params", {})
        data = kwargs.get("data", {})
        method = kwargs.get("method", "GET").upper()
        headers = kwargs.get("headers", {})

        # 如果没有提供参数，尝试从 URL 解析
        if not params:
            parsed = urlparse(url)
            params = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        # 测试 GET 参数
        if params:
            param_results = self._test_parameters(url, params, "GET", headers)
            results.extend(param_results)

        # 测试 POST 数据
        if data and method == "POST":
            data_results = self._test_parameters(url, data, "POST", headers)
            results.extend(data_results)

        self._log_detection_end(url, results)
        return results

    def _test_parameters(
        self, url: str, params: Dict[str, str], method: str, headers: Dict[str, str]
    ) -> List[DetectionResult]:
        """测试参数中的 SQL 注入

        Args:
            url: 目标 URL
            params: 参数字典
            method: HTTP 方法
            headers: 请求头

        Returns:
            检测结果列表
        """
        results = []

        for param_name, original_value in params.items():
            # 跳过某些参数
            if self._should_skip_param(param_name):
                continue

            # 获取基线响应
            baseline = self._get_baseline_response(url, params, method, headers)
            if baseline is None:
                continue

            # 测试每个 payload
            for payload in self.payloads:
                # 构造测试值
                test_value = str(original_value) + payload

                # 错误型注入检测
                if self.check_error_based:
                    error_result = self._check_error_based(
                        url, params, param_name, test_value, method, headers
                    )
                    if error_result:
                        results.append(error_result)
                        break  # 发现漏洞后跳过该参数

                # 时间盲注检测
                if self.check_time_based and "SLEEP" in payload.upper():
                    time_result = self._check_time_based(
                        url, params, param_name, payload, original_value, method, headers
                    )
                    if time_result:
                        results.append(time_result)
                        break

            # 布尔盲注检测（需要更复杂的逻辑）
            if self.check_boolean_based and not any(r.param == param_name for r in results):
                boolean_result = self._check_boolean_based(
                    url, params, param_name, baseline, method, headers
                )
                if boolean_result:
                    results.append(boolean_result)

        return results

    def _check_error_based(
        self,
        url: str,
        params: Dict[str, str],
        param_name: str,
        test_value: str,
        method: str,
        headers: Dict[str, str],
    ) -> Optional[DetectionResult]:
        """检测错误型 SQL 注入

        Args:
            url: 目标 URL
            params: 参数字典
            param_name: 测试参数名
            test_value: 测试值
            method: HTTP 方法
            headers: 请求头

        Returns:
            检测结果或 None
        """
        test_params = params.copy()
        test_params[param_name] = test_value

        try:
            if method == "GET":
                response = self.http_client.get(url, params=test_params, headers=headers)
            else:
                response = self.http_client.post(url, data=test_params, headers=headers)

            # 检查响应中的数据库错误
            db_type, match_text = self._find_db_error(response.text)
            if db_type:
                request_info = self._build_request_info(
                    method=method,
                    url=url,
                    headers=headers,
                    params=test_params if method == "GET" else None,
                    data=test_params if method != "GET" else None,
                )
                response_info = self._build_response_info(response)
                return self._create_result(
                    url=url,
                    vulnerable=True,
                    param=param_name,
                    payload=test_value,
                    evidence=match_text,
                    confidence=0.95,
                    verified=True,
                    request=request_info,
                    response=response_info,
                    remediation="使用参数化查询（Prepared Statements）或 ORM 框架",
                    references=[
                        "https://owasp.org/www-community/attacks/SQL_Injection",
                        "https://cheatsheetseries.owasp.org/cheatsheets"
                        "/SQL_Injection_Prevention_Cheat_Sheet.html",
                    ],
                    extra={"db_type": db_type, "injection_type": "error-based"},
                )
        except DetectorTimeoutError as e:
            # 请求超时 - 可能是服务器处理慢或网络问题
            logger.debug("错误型注入检测超时 %s: %s", url, e)
        except DetectorConnectionError as e:
            # 连接失败 - 目标可能不可达
            logger.debug("错误型注入检测连接失败 %s: %s", url, e)
        except HTTPError as e:
            # 其他 HTTP 错误
            logger.debug("错误型注入检测 HTTP 错误 %s: %s", url, e)
        except (AttributeError, TypeError) as e:
            # 响应对象属性访问错误（如 response.text 不存在）
            logger.debug("错误型注入检测响应解析失败: %s", e)
        except Exception as e:
            # 捕获其他未预期异常，保证检测流程继续
            # 注意：这里使用宽泛捕获是为了单个 payload 测试失败不影响整体检测
            logger.warning("错误型注入检测未预期错误: %s: %s", type(e).__name__, e)

        return None

    @staticmethod
    def _build_control_payload(payload: str, original_value: str) -> str:
        """构造无延迟对照 payload

        与时间盲注 payload 保持相同的注入结构，仅移除/替换数据库侧的延迟原语
        （SLEEP / pg_sleep / BENCHMARK / WAITFOR DELAY），使对照请求在语义上
        等价但不会触发服务端等待。无法识别延迟原语时回退到参数原始值。

        Args:
            payload: 含延迟原语的时间盲注 payload
            original_value: 被注入参数的原始取值

        Returns:
            不含延迟原语的对照值
        """
        control = payload
        # BENCHMARK(N, expr) -> 0（N 支持嵌套括号）
        control = re.sub(
            r"BENCHMARK\s*\(\s*\d+\s*,[^()]*\([^()]*\)[^()]*\)",
            "0",
            control,
            flags=re.IGNORECASE,
        )
        # WAITFOR DELAY '0:0:5' -> 整句移除（MSSQL 堆叠语句，保留其余部分）
        control = re.sub(
            r";?\s*WAITFOR\s+DELAY\s+'[^']*'", "", control, flags=re.IGNORECASE
        )
        # SLEEP(N) / pg_sleep(N) -> 0
        control = re.sub(
            r"(?:pg_)?sleep\s*\(\s*\d+(?:\.\d+)?\s*\)",
            "0",
            control,
            flags=re.IGNORECASE,
        )

        # 仍残留其他延迟原语（如未覆盖的方言）时，回退到原始参数值
        if re.search(r"(?:pg_)?sleep|waitfor\s+delay|benchmark", control, re.IGNORECASE):
            return str(original_value)
        return control

    def _send_timed_request(
        self,
        url: str,
        request_params: Dict[str, str],
        method: str,
        headers: Dict[str, str],
    ) -> Tuple[Optional[Any], float, bool]:
        """发送请求并计时

        Args:
            url: 目标 URL
            request_params: 完整请求参数
            method: HTTP 方法
            headers: 请求头

        Returns:
            (响应对象或 None, 耗时秒, 是否抛出超时异常)
        """
        start = time.time()
        try:
            if method == "GET":
                response = self.http_client.get(url, params=request_params, headers=headers)
            else:
                response = self.http_client.post(url, data=request_params, headers=headers)
            return response, time.time() - start, False
        except DetectorTimeoutError:
            # 超时同样需要进入对照流程，不能仅凭异常判定漏洞
            return None, time.time() - start, True

    def _delay_significantly_slower(self, delay_elapsed: float, control_elapsed: float) -> bool:
        """判断延迟请求是否显著慢于无延迟对照请求

        需同时满足绝对耗时差与相对倍数两个阈值，避免对照请求本身有几十毫秒
        抖动时仅凭倍数造成误判。阈值均来自配置。
        """
        delta = delay_elapsed - control_elapsed
        ratio = delay_elapsed / max(control_elapsed, 1e-6)
        return delta >= self.time_control_margin and ratio >= self.time_control_ratio

    def _check_time_based(
        self,
        url: str,
        params: Dict[str, str],
        param_name: str,
        payload: str,
        original_value: str,
        method: str,
        headers: Dict[str, str],
    ) -> Optional[DetectionResult]:
        """检测时间盲注（带无延迟对照请求）

        判定流程:
            1. 发送含延迟原语的请求；耗时未超阈值则该 payload 无信号。
            2. 首次超阈值（含直接抛超时异常）时，发送一次同参数、不含 SLEEP
               的等价对照请求。
            3. 对照请求同样慢 -> 判定为链路问题，放弃该 payload，不产出漏洞结论。
            4. 仅当延迟请求显著慢于对照请求时才报告漏洞。

        Args:
            url: 目标 URL
            params: 参数字典
            param_name: 测试参数名
            payload: 时间盲注 payload
            original_value: 被注入参数的原始取值，用于构造对照值
            method: HTTP 方法
            headers: 请求头

        Returns:
            检测结果或 None
        """
        test_params = params.copy()
        test_params[param_name] = payload

        try:
            response, delay_elapsed, delay_timed_out = self._send_timed_request(
                url, test_params, method, headers
            )

            # 首次请求未超阈值且未超时：无时间盲注信号
            if not delay_timed_out and delay_elapsed < self.TIME_THRESHOLD:
                return None

            # 首次超阈值（或直接超时）：插入无延迟对照请求
            control_value = self._build_control_payload(payload, original_value)
            control_params = params.copy()
            control_params[param_name] = control_value

            try:
                (
                    control_response,
                    control_elapsed,
                    control_timed_out,
                ) = self._send_timed_request(url, control_params, method, headers)
            except DetectorConnectionError as e:
                logger.debug(
                    "时间盲注对照请求连接失败（%s）%s: %s",
                    self.REASON_TIME_CONTROL_UNAVAILABLE,
                    url,
                    e,
                )
                return None
            except HTTPError as e:
                logger.debug(
                    "时间盲注对照请求 HTTP 错误（%s）%s: %s",
                    self.REASON_TIME_CONTROL_UNAVAILABLE,
                    url,
                    e,
                )
                return None
            except Exception as e:
                logger.warning(
                    "时间盲注对照请求未预期错误（%s）: %s: %s",
                    self.REASON_TIME_CONTROL_UNAVAILABLE,
                    type(e).__name__,
                    e,
                )
                return None

            evidence_base = {
                "injection_type": "time-based",
                "payload": payload,
                "control_payload": control_value,
                "delay_elapsed": round(delay_elapsed, 4),
                "control_elapsed": round(control_elapsed, 4),
                "delay_timed_out": delay_timed_out,
                "control_timed_out": control_timed_out,
                "time_threshold": self.TIME_THRESHOLD,
                "control_margin": self.time_control_margin,
                "control_ratio": self.time_control_ratio,
            }

            def _request_info() -> Any:
                return self._build_request_info(
                    method=method,
                    url=url,
                    headers=headers,
                    params=test_params if method == "GET" else None,
                    data=test_params if method != "GET" else None,
                )

            # 对照请求同样慢（超阈值或同样超时）：链路问题，放弃该 payload
            if control_timed_out or control_elapsed >= self.TIME_THRESHOLD:
                logger.info(
                    "时间盲注: 对照请求同样耗时 %.2fs（延迟请求 %.2fs），"
                    "判定为链路问题（%s），放弃 payload %s",
                    control_elapsed,
                    delay_elapsed,
                    self.REASON_TIME_CONTROL_SLOW,
                    payload,
                )
                return None

            # 延迟请求未显著慢于对照请求：不满足时间盲注特征
            if not self._delay_significantly_slower(delay_elapsed, control_elapsed):
                logger.info(
                    "时间盲注: 延迟请求 %.2fs 未显著慢于对照请求 %.2fs（%s），"
                    "放弃 payload %s",
                    delay_elapsed,
                    control_elapsed,
                    self.REASON_TIME_NO_SIGNIFICANT_DELTA,
                    payload,
                )
                return None

            # 延迟请求显著慢于对照请求：判定存在时间盲注
            if delay_timed_out:
                reason_label = self.REASON_TIME_TIMEOUT_CONFIRMED
                confidence = 0.85
                verified = False
                evidence = (
                    f"延迟请求超时（耗时 {delay_elapsed:.2f}s），"
                    f"无延迟对照请求仅 {control_elapsed:.2f}s，"
                    f"显著慢于对照（阈值 {self.TIME_THRESHOLD}s）"
                )
            else:
                reason_label = self.REASON_TIME_CONFIRMED
                confidence = 0.90
                verified = True
                evidence = (
                    f"延迟请求 {delay_elapsed:.2f}s 显著慢于无延迟对照请求 "
                    f"{control_elapsed:.2f}s（阈值 {self.TIME_THRESHOLD}s，"
                    f"最小耗时差 {self.time_control_margin}s，"
                    f"最小倍数 {self.time_control_ratio}）"
                )

            response_info = self._build_response_info(response)
            return self._create_result(
                url=url,
                vulnerable=True,
                param=param_name,
                payload=payload,
                evidence=evidence,
                confidence=confidence,
                verified=verified,
                request=_request_info(),
                response=response_info,
                remediation="使用参数化查询（Prepared Statements）或 ORM 框架",
                references=["https://owasp.org/www-community/attacks/Blind_SQL_Injection"],
                extra={**evidence_base, "reason_label": reason_label},
            )
        except DetectorConnectionError as e:
            # 连接失败 - 目标可能不可达
            logger.debug("时间盲注检测连接失败 %s: %s", url, e)
        except HTTPError as e:
            # 其他 HTTP 错误
            logger.debug("时间盲注检测 HTTP 错误 %s: %s", url, e)
        except Exception as e:
            # 捕获其他未预期异常
            # 注意：这里使用宽泛捕获是为了单个 payload 测试失败不影响整体检测
            logger.warning("时间盲注检测未预期错误: %s: %s", type(e).__name__, e)

        return None

    def _run_boolean_round(
        self,
        url: str,
        params: Dict[str, str],
        param_name: str,
        true_payload: str,
        false_payload: str,
        baseline_length: int,
        method: str,
        headers: Dict[str, str],
    ) -> Dict[str, Any]:
        """执行一轮布尔盲注真假条件对比

        Args:
            url: 目标 URL
            params: 参数字典
            param_name: 测试参数名
            true_payload: 真条件 payload
            false_payload: 假条件 payload
            baseline_length: 基线响应长度
            method: HTTP 方法
            headers: 请求头

        Returns:
            本轮观测数据，包含:
                - status: ok / void_baseline_drift / void_no_signal / error
                - true_len / false_len: 真假条件响应长度
                - diff: true_len - false_len
                - diff_ratio: 长度差占基线比例
                - baseline_drift: 真条件相对基线的漂移比例
                - error: 请求异常信息（status 为 error 时）
        """
        true_params = params.copy()
        true_params[param_name] = str(params.get(param_name, "")) + true_payload
        false_params = params.copy()
        false_params[param_name] = str(params.get(param_name, "")) + false_payload

        try:
            if method == "GET":
                true_response = self.http_client.get(url, params=true_params, headers=headers)
                false_response = self.http_client.get(url, params=false_params, headers=headers)
            else:
                true_response = self.http_client.post(url, data=true_params, headers=headers)
                false_response = self.http_client.post(url, data=false_params, headers=headers)

            true_len = len(true_response.text)
            false_len = len(false_response.text)
        except (DetectorTimeoutError, DetectorConnectionError, HTTPError) as e:
            return {"status": "error", "error": f"{type(e).__name__}: {e}"}
        except (AttributeError, TypeError) as e:
            # 响应对象属性访问错误（如 response.text 不存在）
            return {"status": "error", "error": f"{type(e).__name__}: {e}"}

        diff = true_len - false_len
        diff_ratio = abs(diff) / max(1, baseline_length)
        baseline_drift = abs(true_len - baseline_length) / max(1, baseline_length)

        round_info: Dict[str, Any] = {
            "true_len": true_len,
            "false_len": false_len,
            "diff": diff,
            "diff_ratio": round(diff_ratio, 4),
            "baseline_drift": round(baseline_drift, 4),
            "true_params": true_params,
            "true_response": true_response,
        }

        # 真条件与基线漂移过大：页面本身不稳定，本轮作废
        if baseline_drift > self.boolean_baseline_drift:
            round_info["status"] = "void_baseline_drift"
            round_info["reason"] = self.REASON_BOOL_UNSTABLE_PAGE
            return round_info

        # 真假长度差不显著：该组 payload 在本轮没有可区分信号，本轮作废
        if diff_ratio <= self.boolean_diff_ratio:
            round_info["status"] = "void_no_signal"
            return round_info

        round_info["status"] = "ok"
        return round_info

    def _check_boolean_based(
        self,
        url: str,
        params: Dict[str, str],
        param_name: str,
        baseline: Any,
        method: str,
        headers: Dict[str, str],
    ) -> Optional[DetectionResult]:
        """检测布尔盲注（多轮一致性验证）

        判定流程:
            1. 对同一组真假 payload 重复 boolean_rounds 轮（至少两轮）。
            2. 某轮真条件与基线漂移超过阈值（页面本身不稳定）-> 该轮作废。
            3. 某轮真假长度差不超过阈值（无可区分信号）-> 该轮作废。
            4. 至少两轮有效且真假长度差方向一致 -> 判为可疑。
            5. 有效轮方向不一致 -> 放弃该组 payload，不产出漏洞结论。

        Args:
            url: 目标 URL
            params: 参数字典
            param_name: 测试参数名
            baseline: 基线响应
            method: HTTP 方法
            headers: 请求头

        Returns:
            检测结果或 None
        """
        # 真条件 payload
        true_payloads = [
            "' AND '1'='1",
            "' AND 1=1--",
            '" AND "1"="1',
            "' OR '1'='1",
        ]

        # 假条件 payload
        false_payloads = [
            "' AND '1'='2",
            "' AND 1=2--",
            '" AND "1"="2',
            "' AND 1=0--",
        ]

        baseline_length = len(baseline.text) if baseline else 0

        for true_payload, false_payload in zip(true_payloads, false_payloads):
            rounds: List[Dict[str, Any]] = []
            try:
                for round_index in range(self.boolean_rounds):
                    round_info = self._run_boolean_round(
                        url,
                        params,
                        param_name,
                        true_payload,
                        false_payload,
                        baseline_length,
                        method,
                        headers,
                    )
                    round_info["round"] = round_index + 1
                    rounds.append(round_info)

                valid_rounds = [r for r in rounds if r.get("status") == "ok"]
                voided_rounds = [r for r in rounds if r.get("status") != "ok"]

                # 至少两轮有效
                if len(valid_rounds) < 2:
                    logger.info(
                        "布尔盲注: 有效轮数 %d 不足两轮（%s），放弃 payload 组 %s",
                        len(valid_rounds),
                        self.REASON_BOOL_INSUFFICIENT_ROUNDS,
                        true_payload,
                    )
                    continue

                # 两轮的真假长度差方向必须一致
                directions = {1 if r["diff"] > 0 else -1 for r in valid_rounds}
                if len(directions) != 1:
                    logger.info(
                        "布尔盲注: 各轮真假长度差方向不一致（%s），放弃 payload 组 %s",
                        self.REASON_BOOL_DIRECTION_MISMATCH,
                        true_payload,
                    )
                    continue

                # 两轮方向一致：判为可疑
                direction_label = "true_longer" if directions.pop() > 0 else "true_shorter"
                round_diffs = [r["diff"] for r in valid_rounds]
                last_valid = valid_rounds[-1]
                true_params = last_valid.get("true_params", params)
                request_info = self._build_request_info(
                    method=method,
                    url=url,
                    headers=headers,
                    params=true_params if method == "GET" else None,
                    data=true_params if method != "GET" else None,
                )
                response_info = self._build_response_info(last_valid.get("true_response"))
                # extra 中的轮次数据只保留可序列化的标量字段
                rounds_evidence = [
                    {k: v for k, v in r.items() if k not in ("true_params", "true_response")}
                    for r in rounds
                ]
                return self._create_result(
                    url=url,
                    vulnerable=True,
                    param=param_name,
                    payload=f"TRUE: {true_payload}, FALSE: {false_payload}",
                    evidence=(
                        f"{len(valid_rounds)} 轮真假长度差方向一致（{direction_label}）: "
                        f"各轮差值 {round_diffs}"
                    ),
                    confidence=0.75,
                    verified=False,
                    request=request_info,
                    response=response_info,
                    remediation="使用参数化查询（Prepared Statements）或 ORM 框架",
                    extra={
                        "injection_type": "boolean-based",
                        "reason_label": self.REASON_BOOL_CONSISTENT,
                        "rounds": rounds_evidence,
                        "valid_rounds": len(valid_rounds),
                        "voided_rounds": len(voided_rounds),
                        "direction": direction_label,
                        "round_diffs": round_diffs,
                        "baseline_length": baseline_length,
                        "diff_ratio_threshold": self.boolean_diff_ratio,
                        "baseline_drift_threshold": self.boolean_baseline_drift,
                    },
                )

            except Exception as e:
                # 捕获其他未预期异常
                # 注意：这里使用宽泛捕获是为了单个 payload 测试失败不影响整体检测
                logger.warning("布尔盲注检测未预期错误: %s: %s", type(e).__name__, e)

        return None

    def _find_db_error(self, response_text: str) -> Tuple[Optional[str], Optional[str]]:
        """在响应中查找数据库错误

        Args:
            response_text: 响应文本

        Returns:
            (数据库类型, 匹配文本) 或 (None, None)
        """
        for db_type, patterns in self._compiled_patterns.items():
            for pattern in patterns:
                match = pattern.search(response_text)
                if match:
                    # 提取上下文
                    start = max(0, match.start() - 50)
                    end = min(len(response_text), match.end() + 50)
                    context = response_text[start:end]
                    return db_type, context.strip()
        return None, None

    def _get_baseline_response(
        self, url: str, params: Dict[str, str], method: str, headers: Dict[str, str]
    ) -> Optional[Any]:
        """获取基线响应

        Args:
            url: 目标 URL
            params: 参数字典
            method: HTTP 方法
            headers: 请求头

        Returns:
            响应对象或 None
        """
        try:
            if method == "GET":
                return self.http_client.get(url, params=params, headers=headers)
            else:
                return self.http_client.post(url, data=params, headers=headers)
        except DetectorTimeoutError as e:
            logger.debug("获取基线响应超时 %s: %s", url, e)
            return None
        except DetectorConnectionError as e:
            logger.debug("获取基线响应连接失败 %s: %s", url, e)
            return None
        except HTTPError as e:
            logger.debug("获取基线响应 HTTP 错误 %s: %s", url, e)
            return None
        except (OSError, IOError) as e:
            # 网络层错误
            logger.debug("获取基线响应网络错误 %s: %s", url, e)
            return None
        except Exception as e:
            # 捕获其他未预期异常
            # 注意：基线响应获取失败不应中断整个检测流程
            logger.warning("获取基线响应未预期错误 %s: %s: %s", url, type(e).__name__, e)
            return None

    def _should_skip_param(self, param_name: str) -> bool:
        """判断是否应跳过某个参数

        Args:
            param_name: 参数名

        Returns:
            是否跳过
        """
        skip_patterns = [
            "token",
            "csrf",
            "nonce",
            "hash",
            "sig",
            "signature",
            "timestamp",
            "time",
            "_t",
            "callback",
            "jsonp",
        ]
        param_lower = param_name.lower()
        return any(p in param_lower for p in skip_patterns)

    def get_payloads(self) -> List[str]:
        """获取检测器使用的 payload 列表"""
        return self.payloads

    def verify(self, result: DetectionResult) -> bool:
        """验证 SQL 注入漏洞

        Args:
            result: 检测结果

        Returns:
            是否确认存在漏洞
        """
        if not result.vulnerable or not result.payload:
            return False

        # 已验证的结果直接返回
        if result.verified:
            return True

        request = result.request
        method = request.method.upper() if request and request.method else "GET"
        headers = request.headers if request else {}

        params: Dict[str, str] = {}
        if request and request.params:
            params = request.params.copy()
        else:
            parsed = urlparse(result.url)
            params = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        if result.param:
            params.setdefault(result.param, "")
            original = params.get(result.param, "")
        else:
            return False

        def _build_payload(base: str, clause: str) -> str:
            if base.isdigit():
                return f"{base} OR {clause}"
            return f"{base}' OR {clause}--"

        try:
            # 时间盲注验证
            verify_clause = f"SLEEP({self.TIME_DELAY})"
            verify_value = _build_payload(str(original), verify_clause)
            verify_params = params.copy()
            verify_params[result.param] = verify_value

            start_time = time.time()
            if method == "GET":
                self.http_client.get(result.url, params=verify_params, headers=headers)
            else:
                self.http_client.post(result.url, data=verify_params, headers=headers)
            elapsed = time.time() - start_time

            if elapsed >= self.TIME_THRESHOLD:
                result.verified = True
                result.confidence = max(result.confidence, 0.9)
                return True

            # 布尔盲注验证（基于响应长度差异）
            baseline = self._get_baseline_response(result.url, params, method, headers)
            if baseline is None:
                return False

            true_params = params.copy()
            false_params = params.copy()
            true_params[result.param] = _build_payload(str(original), "1=1")
            false_params[result.param] = _build_payload(str(original), "1=2")

            if method == "GET":
                resp_true = self.http_client.get(result.url, params=true_params, headers=headers)
                resp_false = self.http_client.get(result.url, params=false_params, headers=headers)
            else:
                resp_true = self.http_client.post(result.url, data=true_params, headers=headers)
                resp_false = self.http_client.post(result.url, data=false_params, headers=headers)

            baseline_len = len(getattr(baseline, "text", "") or "")
            true_len = len(getattr(resp_true, "text", "") or "")
            false_len = len(getattr(resp_false, "text", "") or "")

            def _ratio(a: int, b: int) -> float:
                return abs(a - b) / max(1, b)

            if _ratio(true_len, baseline_len) < 0.1 and _ratio(false_len, baseline_len) > 0.2:
                result.verified = True
                result.confidence = max(result.confidence, 0.8)
                return True

            return False

        except DetectorTimeoutError:
            logger.debug("SQL注入验证: 请求超时，可能存在漏洞")
            return False
        except (DetectorConnectionError, HTTPError) as e:
            logger.debug("SQL注入验证失败: %s", e)
            return False
        except Exception as e:
            logger.debug("SQL注入验证未预期错误: %s: %s", type(e).__name__, e)
            return False
