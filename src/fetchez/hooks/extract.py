#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
fetchez.hooks.builtins.file_ops.extract
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Extract and decompress archive files safely.

:copyright: (c) 2010-2026 Regents of the University of Colorado
:license: MIT, see LICENSE for more details.
"""

import logging
from pathlib import Path

from fetchez.hooks import FetchHook
from fetchez.utils import UnsafeArchiveError, int_or, p_f_extract, str2bool

logger = logging.getLogger(__name__)


def _hook_logger(hook):
    """Return the logger for the running hook's own module.

    ``unzip`` shares this implementation with ``extract`` but logs under
    ``fetchez.hooks.unzip``, so a caller can filter messages by hook.
    """
    return logging.getLogger(type(hook).__module__)


def _normalize_bool(value):
    """Coerce a bool-like value.

    Recipes, presets and the CLI may pass ``"true"``/``"false"`` as strings;
    a plain truth test would read ``"false"`` as true.
    """
    parsed = str2bool(value)
    return bool(value) if parsed is None else parsed


def _normalize_members(members):
    """Return members as a list of patterns, or None for "all members".

    The CLI passes ``members=.tif`` as a bare string; iterating that string
    pattern by pattern would match single characters. A single string is
    therefore treated as one pattern.
    """
    if members is None:
        return None

    if isinstance(members, str):
        members = [members]

    patterns = [str(member) for member in members if str(member).strip()]
    return patterns or None


def _normalize_limit(value):
    """Coerce an optional integer limit, treating an invalid value as unset."""
    return int_or(value)


class Extract(FetchHook):
    """Extract or decompress archive files."""

    name = "extract"
    meta_desc = "Extract .zip, .tar, .tar.gz, .tgz, and .gz files."
    meta_stage = "file"
    meta_category = "file-op"
    # meta_aliases = ["unzip"]
    meta_effects = [
        "creates-entries",
        "modifies-entries",
        "consumes-artifact",
        "creates-artifact",
    ]

    def __init__(
        self,
        remove: bool = False,
        overwrite: bool = False,
        members: list[str] | None = None,
        max_members: int | None = None,
        max_total_size: int | None = None,
        **kwargs,
    ):
        """Extract and/or decompress files.

        Extraction delegates to ``fetchez.utils.p_f_extract``, which rejects
        an unsafe archive (path traversal, colliding member paths, or an
        exceeded limit) before publishing anything.

        Args:
            remove: Delete the original archive after successful extraction.
            overwrite: Replace existing extracted files.
            members: Optional archive member/name patterns to extract.
            max_members: Optional maximum number of selected archive members.
            max_total_size: Optional maximum total uncompressed size, in bytes,
                of the selected outputs.
        """
        super().__init__(**kwargs)
        self.remove = _normalize_bool(remove)
        self.overwrite = _normalize_bool(overwrite)
        self.members = _normalize_members(members)
        self.max_members = _normalize_limit(max_members)
        self.max_total_size = _normalize_limit(max_total_size)

    def run(self, entries):
        out_entries = []
        logger = _hook_logger(self)

        for mod, entry in entries:
            dst_fn = entry.get("dst_fn")
            status = entry.get("status")

            # Entries that failed acquisition or carry no artifact pass
            # through untouched. The raw value is checked: Path("") is ".".
            if (status is not None and status != 0) or not dst_fn:
                out_entries.append((mod, entry))
                continue

            file_path = Path(dst_fn)

            try:
                extracted = p_f_extract(
                    file_path,
                    outdir=file_path.parent,
                    members=self.members,
                    overwrite=self.overwrite,
                    max_members=self.max_members,
                    max_total_size=self.max_total_size,
                )

            except UnsafeArchiveError as exc:
                # Must come before ValueError, which it subclasses, so an
                # unsafe archive is reported instead of passed through quietly.
                logger.error("Refusing to extract %s: %s", file_path, exc)
                out_entries.append((mod, entry))
                continue

            except ValueError:
                # Not an archive format handled by this hook.
                out_entries.append((mod, entry))
                continue

            except Exception as exc:
                logger.error(
                    "Extraction failed for %s: %s",
                    file_path,
                    exc,
                )
                out_entries.append((mod, entry))
                continue

            for extracted_path in extracted:
                child_entry = {
                    **entry,
                    "dst_fn": str(extracted_path),
                    "src_fn": str(file_path),
                    "status": 0,
                }

                child_entry.pop("data_type", None)
                child_entry.pop("profile", None)

                out_entries.append((mod, child_entry))

            if self.remove:
                try:
                    file_path.unlink()
                except OSError:
                    pass

        return out_entries
