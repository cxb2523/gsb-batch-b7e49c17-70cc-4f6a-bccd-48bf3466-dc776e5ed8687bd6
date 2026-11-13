"""POSIX atomic file replacement primitive — mkstemp → write → fsync → os.replace → chmod.

Equivalent to SQLite WAL / PostgreSQL WAL / systemd-journald / Git core.fsync.
All rules engine and preferences JSON write paths use this primitive.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from astrobasis._error_codes import ErrorEvent
from astrobasis._logging import LogfmtLogger

logger = LogfmtLogger("astrobasis.atomic")


def atomic_write_json(
    path: Path,
    data: Any,
    *,
    max_bytes: int | None = None,
    chmod_mask: int | None = 0o600,
) -> None:
    """POSIX atomic file replacement protocol: mkstemp → write → fsync → os.replace → chmod.

    Args:
        path: Target file path.
        data: json.dumps-compatible object.
        max_bytes: Size check before writing, raises ValueError if exceeded. None to skip.
        chmod_mask: File permission after write. None to skip chmod.
    """
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    content_bytes = content.encode("utf-8")

    if max_bytes is not None and len(content_bytes) > max_bytes:
        raise ValueError(f"Data size {len(content_bytes)} exceeds limit {max_bytes}")

    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(suffix=".tmp", prefix=path.name + ".", dir=parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content_bytes)
            f.flush()
            os.fsync(f.fileno())
        Path(tmp_path).replace(path)
    except Exception:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass
        raise

    if chmod_mask is not None:
        try:
            Path(path).chmod(chmod_mask)
        except OSError:
            logger.debug(ErrorEvent.ATOMIC_WRITE_CHMOD_FAILED, path=path)
