"""SQL operational log repository."""
import logging
import time
from threading import Lock
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from app.domain.logs import InferenceLog
from app.infrastructure.persistence.database import connect

logger = logging.getLogger(__name__)

class InferenceLogStore:
    def __init__(self, path):
        self.path = str(path) if str(path).startswith(("postgresql://", "postgres://")) else Path(path)
        self._schema_lock = Lock()
        self._schema_ready = False

    def connect(self):
        connection = connect(self.path)
        try:
            with self._schema_lock:
                if not self._schema_ready:
                    # Commit DDL before starting the log transaction.
                    with connection:
                        if isinstance(self.path, str):
                            # Same initialization lock used by detection/alert stores.
                            connection.execute("SELECT pg_advisory_xact_lock(734821906)")
                        self._create_schema(connection)
                    self._schema_ready = True
            return connection
        except BaseException:
            connection.close()
            raise

    def _create_schema(self, connection):
        connection.execute("""CREATE TABLE IF NOT EXISTS inference_logs (
            id TEXT PRIMARY KEY, fecha_hora TEXT NOT NULL, camera TEXT,
            event_type TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL,
            processing_ms REAL, inference_ms REAL, session_id TEXT, window_id TEXT,
            detection_id TEXT
        )""")
        connection.execute("CREATE INDEX IF NOT EXISTS logs_date ON inference_logs(fecha_hora)")
        connection.execute("CREATE INDEX IF NOT EXISTS logs_camera_event ON inference_logs(camera, event_type)")

    def write(self, event_type, message, *, camera=None, level="INFO", processing_ms=None,
              inference_ms=None, session_id=None, window_id=None, detection_id=None):
        record = InferenceLog(id=str(uuid4()), fecha_hora=datetime.now(timezone.utc), camera=camera,
            event_type=event_type, level=level, message=message, processing_ms=processing_ms,
            inference_ms=inference_ms, session_id=session_id, window_id=window_id,
            detection_id=detection_id).model_dump(mode="json")
        record["fecha_hora"] = datetime.fromisoformat(record["fecha_hora"]).isoformat(
            timespec="microseconds").replace("+00:00", "Z")
        for attempt in range(3):
            try:
                self._write_record(record)
                break
            except Exception as exc:
                if getattr(exc, "sqlstate", None) not in ("40P01", "40001") or attempt == 2:
                    raise
                # Retry the whole transaction after rollback, retaining the log identity.
                time.sleep(.05 * (attempt + 1))
        return record

    def _write_record(self, record):
        connection = self.connect()
        try:
            with connection:
                connection.execute("INSERT INTO inference_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                   tuple(record.values()))
        finally:
            connection.close()

    def emit(self, *args, **kwargs):
        # Un fallo de logs no debe interrumpir video ni sustituir el resultado del modelo.
        try:
            return self.write(*args, **kwargs)
        except Exception:
            logger.error("No se pudo persistir el log de inferencia", exc_info=True)
            return None

    def purge(self, before, batch=5000):
        """Borra los logs `inference_completed` anteriores a `before`; los demás eventos se conservan."""
        cutoff = before.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
        removed = 0
        while True:
            connection = self.connect()
            try:
                with connection:
                    count = connection.execute("""DELETE FROM inference_logs WHERE id IN (
                        SELECT id FROM inference_logs WHERE event_type = 'inference_completed'
                        AND fecha_hora < ? LIMIT ?)""", (cutoff, batch)).rowcount
            finally:
                connection.close()
            removed += count
            if count < batch:
                return removed

    def get(self, identifier):
        connection = self.connect()
        try:
            row = connection.execute("SELECT * FROM inference_logs WHERE id = ?", (identifier,)).fetchone()
            return dict(row) if row else None
        finally:
            connection.close()

    def list(self, *, camera=None, event_type=None, level=None, date_from=None, date_to=None,
             limit=100, offset=0):
        clauses, values = [], []
        for column, value in (("camera", camera), ("event_type", event_type), ("level", level)):
            if value is not None:
                clauses.append(f"{column} = ?")
                values.append(value)
        for operator, value in ((">=", date_from), ("<=", date_to)):
            if value is not None:
                clauses.append(f"fecha_hora {operator} ?")
                values.append(value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"))
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        connection = self.connect()
        try:
            with connection:
                connection.execute("BEGIN")
                total = connection.execute("SELECT COUNT(*) FROM inference_logs" + where, values).fetchone()[0]
                rows = connection.execute("SELECT * FROM inference_logs" + where +
                    " ORDER BY fecha_hora DESC, id DESC LIMIT ? OFFSET ?", (*values, limit, offset)).fetchall()
            return dict(items=[dict(row) for row in rows], total=total, limit=limit, offset=offset)
        finally:
            connection.close()
