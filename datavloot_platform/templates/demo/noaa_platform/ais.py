"""
The Guam 2025 AIS file the demo is built on, fetched on the first run.

NOAA publishes it as a zip of 41 MB holding one CSV of 366 MB. The download
is checked against the SHA-256 the demo was built with before anything is
unpacked, and the CSV is written under a temporary name and renamed when it
is complete, so a failed or partial download never leaves a guam_2025.csv
behind; the next run simply tries again.
"""

import hashlib
import os
import zipfile
from pathlib import Path

URL = "https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/data/ais/guam/guam-2025.zip"
SHA256 = "20295d4dbe3c386617b7e774ea4becc66f4d54b8cab8c13dcdc2a2afeb439ea0"
MEMBER = "guam_2025.csv"

MANUAL = (
    f"Download {URL} by hand, unzip it, and save {MEMBER} as {{csv_path}}. "
    "The index of all years is at "
    "https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/data/ais/guam/index-guam.html"
)


def ensure_csv(csv_path: Path, log, get) -> None:
    """
    Make sure `csv_path` exists, downloading and unpacking it if it does not.

    `get` is an HTTP GET with requests' signature; the asset passes dlt's
    requests helper, which retries and uses certifi.
    """
    if csv_path.exists():
        return

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    zip_path = csv_path.with_name(csv_path.name + ".zip.part")
    csv_part = csv_path.with_name(csv_path.name + ".part")
    try:
        log.info(f"{csv_path.name} not found; downloading {URL} (41 MB, 366 MB unpacked)…")
        try:
            digest = _download(get, zip_path)
        except Exception as e:
            raise RuntimeError(
                f"Could not download the AIS data: {e}\n" + MANUAL.format(csv_path=csv_path)
            ) from e
        if digest != SHA256:
            raise RuntimeError(
                "The AIS download does not match the file the demo was built on "
                f"(SHA-256 {digest}, expected {SHA256}): it is incomplete, or NOAA "
                "replaced the file. " + MANUAL.format(csv_path=csv_path)
            )
        with zipfile.ZipFile(zip_path) as z, z.open(MEMBER) as src, open(csv_part, "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
        os.replace(csv_part, csv_path)
        log.info(f"Saved {csv_path}.")
    finally:
        zip_path.unlink(missing_ok=True)
        csv_part.unlink(missing_ok=True)


def _download(get, zip_path: Path) -> str:
    """Stream URL to zip_path; return the SHA-256 of what arrived."""
    sha = hashlib.sha256()
    with get(URL, stream=True, timeout=60) as response:
        response.raise_for_status()
        with open(zip_path, "wb") as f:
            for chunk in response.iter_content(1 << 20):
                f.write(chunk)
                sha.update(chunk)
    return sha.hexdigest()
