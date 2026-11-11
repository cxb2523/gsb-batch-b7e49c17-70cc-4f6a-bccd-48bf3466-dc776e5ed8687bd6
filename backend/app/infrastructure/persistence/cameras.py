"""SQL camera repository."""
import json
from threading import Lock
from app.domain.camera import CameraRegistration
from app.infrastructure.persistence.database import connect

class CameraStore:
    def __init__(self, target):
        self.target = target
        self._schema_lock = Lock()
        self._schema_ready = False

    def connect(self):
        connection = connect(self.target)
        try:
            with self._schema_lock:
                if not self._schema_ready:
                    # Varios procesos pueden arrancar a la vez contra un esquema vacío.
                    with connection:
                        if str(self.target).startswith(("postgresql://", "postgres://")):
                            connection.execute("SELECT pg_advisory_xact_lock(734821906)")
                        connection.execute("""CREATE TABLE IF NOT EXISTS cameras (
                            source_id TEXT PRIMARY KEY, config_json TEXT NOT NULL
                        )""")
                    self._schema_ready = True
            return connection
        except BaseException:
            connection.close()
            raise

    def get(self, source_id):
        connection = self.connect()
        try:
            with connection:
                row = connection.execute("SELECT config_json FROM cameras WHERE source_id=?",
                                         (source_id,)).fetchone()
                return CameraRegistration.model_validate(json.loads(row[0])) if row else None
        finally:
            connection.close()

    def list(self):
        connection = self.connect()
        try:
            with connection:
                rows = connection.execute("SELECT config_json FROM cameras ORDER BY source_id").fetchall()
                return [CameraRegistration.model_validate(json.loads(row[0])) for row in rows]
        finally:
            connection.close()

    def save(self, camera, *, update=False):
        connection = self.connect()
        config = json.dumps(camera.private_config(), ensure_ascii=False)
        try:
            with connection:
                if update:
                    cursor = connection.execute("UPDATE cameras SET config_json=? WHERE source_id=?",
                                                (config, camera.source_id))
                else:
                    cursor = connection.execute(
                        "INSERT INTO cameras VALUES (?, ?) ON CONFLICT DO NOTHING",
                        (camera.source_id, config))
                return cursor.rowcount == 1
        finally:
            connection.close()

    def delete(self, source_id):
        connection = self.connect()
        try:
            with connection:
                return connection.execute("DELETE FROM cameras WHERE source_id=?",
                                          (source_id,)).rowcount == 1
        finally:
            connection.close()
