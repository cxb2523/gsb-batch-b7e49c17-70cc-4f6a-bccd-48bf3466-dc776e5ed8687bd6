"""Use cases run with in-memory ports, without FastAPI, SQL or GPU."""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.application.cameras import CameraService
from app.application.errors import Conflict, InvalidInput, NotFound, Unavailable
from app.application.inference import InferenceService
from app.application.queries import RecordQueries
from app.domain.camera import CameraRegistration
from app.domain.inference import Prediction, Window


def test_queries_distinguish_missing_storage_failure_and_invalid_dates():
    class Repository:
        def get(self, identifier):
            return None

        def list(self, **filters):
            raise RuntimeError("private SQL diagnostic")

    queries = RecordQueries(Repository(), unavailable="Unavailable", missing="Missing")
    with pytest.raises(NotFound, match="Missing"):
        queries.get("absent")
    with pytest.raises(Unavailable, match="Unavailable"):
        queries.list()
    with pytest.raises(InvalidInput):
        queries.list(date_from=datetime(2026, 2, 1, tzinfo=timezone.utc),
                     date_to=datetime(2026, 1, 1, tzinfo=timezone.utc))
