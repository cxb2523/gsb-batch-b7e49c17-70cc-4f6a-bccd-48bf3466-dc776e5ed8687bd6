"""Stable ASGI entry point used by run_server.py and existing deployments."""
import sys

if sys.version_info < (3, 11):
    # Las fechas ISO con "Z" y otras dependencias del backend requieren 3.11+.
    raise SystemExit("SentriX requiere Python 3.11 o superior; se detectó Python %d.%d." % sys.version_info[:2])

from pathlib import Path
from dotenv import load_dotenv
from app.bootstrap import create_app

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
app = create_app()
