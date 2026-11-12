"""Pytest configuration: make the repository root importable.

The pipeline code lives in ``utils/`` (a package) and in top-level ``scripts/``
files that are not part of a package. Adding the repo root to ``sys.path``
lets tests import both ``utils.*`` and the scripts via ``importlib`` without
ever touching the real GitHub API.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
