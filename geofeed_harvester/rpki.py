from __future__ import annotations

import subprocess
from pathlib import Path


def verify_geofeed_signature(csv_path: Path, signature_path: Path, rpki_client: str = "rpki-client") -> bool:
    """Delegate CMS/RPKI geofeed signature verification to rpki-client."""
    result = subprocess.run(
        [rpki_client, "-f", str(csv_path), "-s", str(signature_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0
