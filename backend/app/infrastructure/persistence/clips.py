"""Estado de los clips de alertas. El video vive en el bucket o en el disco del worker, nunca en la base."""
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from app.infrastructure.persistence.database import connect

# recording: grabando · uploading: cerrado, subiendo · ready/partial: disponible · missing: sin video
STATUSES = ("recording", "uploading", "ready", "partial", "missing")


def _now():
    return datetime.now(timezone.utc).isoformat()


class ClipStore:
    def __init__(self, target):
        self.target = str(target) if str(target).startswith(("postgresql://", "postgres://")) else Path(target)
        self._schema_lock = Lock()
        self._schema_ready = False

    def connect(self):
        connection = connect(self.target)
        try:
            with self._schema_lock:
                if not self._schema_ready:
                    with connection:
                        if isinstance(self.target, str):
                            connection.execute("SELECT pg_advisory_xact_lock(734821906)")
                        connection.execute("""CREATE TABLE IF NOT EXISTS alert_clips (
                            alert_id TEXT PRIMARY KEY, camera TEXT NOT NULL, status TEXT NOT NULL,
                            object_key TEXT, local_path TEXT, worker_id TEXT, duration_seconds REAL,
                            size_bytes INTEGER, reason TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                            CHECK (status IN ('recording', 'uploading', 'ready', 'partial', 'missing'))
                        )""")
                    self._schema_ready = True
            return connection
        except BaseException:
            connection.close()
            raise

    def begin(self, alert_id, camera, worker_id, local_path):
        now = _now()
        connection = self.connect()
        try:
            with connection:
                connection.execute("""INSERT INTO alert_clips (alert_id, camera, status, local_path, worker_id,
                    started_at, updated_at) VALUES (?, ?, 'recording', ?, ?, ?, ?)
                    ON CONFLICT(alert_id) DO UPDATE SET status='recording', local_path=excluded.local_path,
                    worker_id=excluded.worker_id, updated_at=excluded.updated_at""",
                    (alert_id, camera, local_path, worker_id, now, now))
        finally:
            connection.close()

    def update(self, alert_id, status, **fields):
        if status not in STATUSES:
            raise ValueError("Estado de clip inválido")
        allowed = ("object_key", "local_path", "duration_seconds", "size_bytes", "reason")
        columns = [name for name in allowed if name in fields]
        assignments = ", ".join(["status=?", "updated_at=?"] + [f"{name}=?" for name in columns])
        connection = self.connect()
        try:
            with connection:
                return connection.execute(f"UPDATE alert_clips SET {assignments} WHERE alert_id=?",
                    (status, _now(), *[fields[name] for name in columns], alert_id)).rowcount
        finally:
            connection.close()

    def stored(self):
        """Clips que ocupan espacio en el bucket, del más antiguo al más nuevo: (alert_id, object_key, size)."""
        connection = self.connect()
        try:
            rows = connection.execute("""SELECT alert_id, object_key, COALESCE(size_bytes, 0) AS size_bytes
                FROM alert_clips WHERE object_key IS NOT NULL AND status IN ('ready', 'partial')
                ORDER BY started_at, alert_id""").fetchall()
            return [(row["alert_id"], row["object_key"], row["size_bytes"]) for row in rows]
        finally:
            connection.close()

    def mark_purged(self, alert_id):
        """El video ya no está en el bucket: el panel lo verá como `missing` con motivo `purged_for_space`."""
        connection = self.connect()
        try:
            with connection:
                return connection.execute("""UPDATE alert_clips SET status='missing', object_key=NULL,
                    reason='purged_for_space', updated_at=? WHERE alert_id=?""", (_now(), alert_id)).rowcount
        finally:
            connection.close()

    def get(self, alert_id):
        connection = self.connect()
        try:
            row = connection.execute("SELECT * FROM alert_clips WHERE alert_id=?", (alert_id,)).fetchone()
            return dict(row) if row else None
        finally:
            connection.close()
