#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
fetchez.hooks.builtins.file_ops.unzip
~~~~~~~~~~~~~

Extract/Decompress files (.zip, .tar, .tar.gz, .tgz, .gz).

Extraction is delegated to :class:`fetchez.hooks.extract.Extract`, which
reuses :func:`fetchez.utils.p_f_extract`. Archive members are never written
outside the destination directory, archive links and special files are not
created, colliding member paths are rejected, and optional member-count and
uncompressed-size limits are enforced -- all before anything is published.

:copyright: (c) 2010-2026 Regents of the University of Colorado
:license: MIT, see LICENSE for more details.
"""

import logging

from fetchez.hooks.extract import Extract

logger = logging.getLogger(__name__)


class Unzip(Extract):
    """Automatically extract/decompress files after download.

    This is the historical ``unzip`` hook. It shares its implementation with
    the ``extract`` hook so that both use the same safe extraction path.
    """

    name = "unzip"
    meta_desc = "Extract .zip, .tar, .tar.gz, and .gz files."
    meta_stage = "file"
    meta_category = "file-op"
    meta_effects = ["creates-artifact", "modifies-entries", "creates-entries"]
