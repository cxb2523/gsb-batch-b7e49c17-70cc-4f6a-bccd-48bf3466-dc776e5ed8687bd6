"""
暴露面检测器

检测高价值敏感资产暴露：Sliver/Metasploit 等 C2 遗物、.git/.env、
历史记录、私钥、凭证与配置泄露、目录列表等
"""

import logging
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from ..base import BaseDetector
from ..factory import register_detector
from ..result import DetectionResult, DetectorType, Severity

logger = logging.getLogger(__name__)


@register_detector("exposure")
class ExposureDetector(BaseDetector):
    """暴露面检测器

    探测目标站点上意外暴露的高价值文件与目录，例如:
    - C2 框架遗物 (Sliver 数据库、Metasploit 历史记录)
    - 版本控制元数据 (.git、.svn)
    - 环境变量与配置文件 (.env、config 文件)
    - 私钥与凭证文件
    - 备份与数据库导出

    使用示例:
        detector = ExposureDetector()
        results = detector.detect("https://example.com")
    """

    name = "exposure"
    description = "敏感资产暴露面检测器"
    vuln_type = "exposure"
    severity = Severity.HIGH
    detector_type = DetectorType.MISC
    version = "1.0.0"

    # 默认探测路径: 路径 -> (严重程度, 暴露类型)
    DEFAULT_PATHS: Dict[str, Tuple[Severity, str]] = {
        # C2 / 渗透框架遗物
        "/.sliver/sliver.db": (Severity.CRITICAL, "sliver_database"),
        "/.msf4/history": (Severity.HIGH, "metasploit_history"),
        "/.msf4/logs": (Severity.HIGH, "metasploit_logs"),
        # 版本控制元数据
        "/.git/HEAD": (Severity.HIGH, "git_metadata"),
        "/.git/config": (Severity.HIGH, "git_config"),
        "/.svn/entries": (Severity.HIGH, "svn_metadata"),
        # 环境变量与配置
        "/.env": (Severity.CRITICAL, "env_file"),
        "/.env.local": (Severity.CRITICAL, "env_file"),
        "/.env.production": (Severity.CRITICAL, "env_file"),
        "/config.php": (Severity.HIGH, "config_file"),
        "/web.config": (Severity.HIGH, "config_file"),
        # 私钥与凭证
        "/.ssh/id_rsa": (Severity.CRITICAL, "private_key"),
        "/.ssh/id_ed25519": (Severity.CRITICAL, "private_key"),
        "/id_rsa": (Severity.CRITICAL, "private_key"),
        "/.aws/credentials": (Severity.CRITICAL, "cloud_credentials"),
        "/.npmrc": (Severity.HIGH, "registry_credentials"),
        "/.netrc": (Severity.HIGH, "netrc_credentials"),
        # 备份与数据库导出
        "/backup.sql": (Severity.HIGH, "database_backup"),
        "/database.sql": (Severity.HIGH, "database_backup"),
        "/dump.sql": (Severity.HIGH, "database_backup"),
        "/backup.zip": (Severity.MEDIUM, "backup_archive"),
        "/backup.tar.gz": (Severity.MEDIUM, "backup_archive"),
        # shell 历史
        "/.bash_history": (Severity.HIGH, "shell_history"),
        "/.zsh_history": (Severity.HIGH, "shell_history"),
        "/.mysql_history": (Severity.HIGH, "mysql_history"),
    }

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化检测器

        Args:
            config: 配置选项
                - custom_paths: 自定义探测路径，格式为
                  {路径: (Severity, 暴露类型)}，优先于默认路径探测
                - max_paths: 最大探测路径数量
        """
        super().__init__(config)

        # 自定义路径优先（排在默认路径之前，且同键覆盖默认值）
        custom_paths = self.config.get("custom_paths", {}) or {}
        paths: Dict[str, Tuple[Severity, str]] = dict(custom_paths)
        for path, meta in self.DEFAULT_PATHS.items():
            paths.setdefault(path, meta)

        max_paths = self.config.get("max_paths")
        self.exposure_paths = paths
        if isinstance(max_paths, int) and max_paths > 0:
            self.exposure_paths = dict(list(paths.items())[:max_paths])

    def detect(self, url: str, **kwargs) -> List[DetectionResult]:
        """检测敏感资产暴露

        Args:
            url: 目标 URL
            **kwargs:
                headers: 请求头

        Returns:
            检测结果列表
        """
        self._log_detection_start(url)
        results: List[DetectionResult] = []

        headers = kwargs.get("headers", {})
        parsed = urlparse(url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

        for path, (severity, exposure_name) in self.exposure_paths.items():
            test_url = urljoin(base_url, path)
            response = self._safe_request("GET", test_url, headers=headers)
            if response is None:
                continue

            if getattr(response, "status_code", 0) != 200:
                continue

            body = getattr(response, "text", "") or ""
            if not body:
                continue

            result = self._create_result(
                url=test_url,
                vulnerable=True,
                payload=path,
                evidence=f"发现暴露资产: {path} ({exposure_name})",
                confidence=0.90,
                verified=True,
                request=self._build_request_info("GET", test_url, headers=headers),
                response=self._build_response_info(response),
                remediation=f"立即移除或限制对 {path} 的公开访问，并审计是否已被利用",
                extra={
                    "exposure_type": exposure_name,
                    "path": path,
                    "content_preview": body[:200],
                },
            )
            result.severity = severity
            results.append(result)

        self._log_detection_end(url, results)
        return results

    def get_payloads(self) -> List[str]:
        """获取检测器探测的路径列表"""
        return list(self.exposure_paths.keys())
