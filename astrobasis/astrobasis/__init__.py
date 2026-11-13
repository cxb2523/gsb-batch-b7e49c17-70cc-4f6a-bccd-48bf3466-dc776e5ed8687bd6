"""AstroBasis 天枢 — monorepo 纯机制层，零第三方依赖。"""

from __future__ import annotations

from astrobasis._atomic import atomic_write_json
from astrobasis._error_codes import AnnotationKey, ErrorEvent, ErrorMessage, HasCode
from astrobasis._json_compat import json_dumps
from astrobasis._logfmt_checker import check_annotation_arg, check_raise_arg
from astrobasis._logging import JsonLogFormatter, LogfmtFormatter, LogfmtLogger, setup_root_logger
from astrobasis._types import AsyncCloseable
from astrobasis._version import __version__

__all__ = [
    "AnnotationKey",
    "AsyncCloseable",
    "ErrorEvent",
    "ErrorMessage",
    "HasCode",
    "JsonLogFormatter",
    "LogfmtFormatter",
    "LogfmtLogger",
    "__version__",
    "atomic_write_json",
    "check_annotation_arg",
    "check_raise_arg",
    "json_dumps",
    "setup_root_logger",
]
