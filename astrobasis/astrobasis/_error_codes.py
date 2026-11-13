"""ErrorEvent / ErrorMessage — logfmt event 名和错误消息模板的 SSOT 模式。

PostgreSQL errcodes.txt 风格的三层架构之定义层。每包各自定义自己的枚举成员；
此文件仅提供模式定义和 astrobasis 自身的 2 个本地事件。

用法:
    from astrobasis._error_codes import ErrorEvent
    log.warning(ErrorEvent.ATOMIC_WRITE_CHMOD_FAILED, path=path)
"""

from __future__ import annotations

from enum import Enum
from typing import Protocol


class HasCode(Protocol):
    """Protocol for typed logfmt event names — every ErrorEvent enum satisfies this.

    LogfmtLogger methods accept ``HasCode`` instead of raw ``str``.
    Pass ``ErrorEvent.MEMBER`` directly — the logger calls ``.code`` internally.
    """

    @property
    def code(self) -> str: ...


class ErrorEvent(Enum):
    """LogfmtLogger event 标识符的 SSOT。直接传递成员，.code 由 logger 内部调用。"""

    @property
    def code(self) -> str:
        return str(self.value)

    # ── I/O ──
    ATOMIC_WRITE_CHMOD_FAILED = "atomic_write_chmod_failed"
    ORJSON_UNAVAILABLE = "orjson_unavailable"


class ErrorMessage(Enum):
    """静态错误消息模板的 SSOT。使用 .message 获取字符串值。

    astrobasis 本身不抛自定义异常，此枚举为空占位——供上层包继承模式。
    """

    @property
    def message(self) -> str:
        return str(self.value)


class AnnotationKey(Enum):
    """管道注解键的 SSOT 基类。使用 .value 获取字符串值。

    对标 Heritrix CrawlURI annotations 的 key 侧。每包各自定义自己的注解键成员。
    astrobasis 本身不涉及 pipeline 概念，此枚举为空占位——供上层包继承模式。
    """
