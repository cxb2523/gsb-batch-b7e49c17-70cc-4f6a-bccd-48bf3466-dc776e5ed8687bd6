"""Coordinación entre procesos API y workers en PostgreSQL.

- source_control: estado deseado de cada cámara (running/stopped), lo escribe la API.
- camera_leases: qué worker procesa cada cámara; vence si el worker deja de renovarlo.
- worker_heartbeats: workers vivos y su capacidad.
- source_status: último estado publicado por el worker dueño de la cámara.
Los tiempos usan el reloj de la base (now()) para no depender del reloj de cada equipo.
"""
import json
from threading import Lock

from app.infrastructure.persistence.database import connect

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS source_control (
        source_id TEXT PRIMARY KEY,
        desired TEXT NOT NULL CHECK (desired IN ('running', 'stopped')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_id TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS camera_leases (
        source_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS camera_leases_worker ON camera_leases(worker_id)",
    """CREATE TABLE IF NOT EXISTS source_status (
        source_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        status_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
)


class CoordinationStore:
    def __init__(self, url):
        url = str(url)
        if not url.startswith(("postgresql://", "postgres://")):
            raise ValueError("Los roles api y worker requieren SENTRIX_DATABASE_URL (PostgreSQL)")
        self.url = url
        self._schema_lock = Lock()
        self._schema_ready = False

    def connect(self):
        connection = connect(self.url)
        try:
            with self._schema_lock:
                if not self._schema_ready:
                    with connection:
                        connection.execute("SELECT pg_advisory_xact_lock(734821906)")
                        for statement in SCHEMA:
                            connection.execute(statement)
                    self._schema_ready = True
            return connection
        except BaseException:
            connection.close()
            raise

    def _run(self, operation):
        connection = self.connect()
        try:
            with connection:
                return operation(connection)
        finally:
            connection.close()

    # --- API -------------------------------------------------------------
    def set_desired(self, source_id, desired):
        self._run(lambda c: c.execute(
            "INSERT INTO source_control (source_id, desired) VALUES (?, ?) "
            "ON CONFLICT (source_id) DO UPDATE SET desired = EXCLUDED.desired, updated_at = now()",
            (source_id, desired)))

    def overview(self):
        """Estado deseado, lease vigente y último estado publicado de cada cámara."""
        def query(c):
            return [dict(row) for row in c.execute(
                """SELECT c.source_id, c.desired, l.worker_id, (l.expires_at > now()) AS lease_alive,
                          s.worker_id AS status_worker, s.status_json,
                          EXTRACT(EPOCH FROM (now() - s.updated_at)) AS status_age
                   FROM source_control c
                   LEFT JOIN camera_leases l ON l.source_id = c.source_id
                   LEFT JOIN source_status s ON s.source_id = c.source_id""").fetchall()]
        return self._run(query)

    def workers(self, ttl):
        def query(c):
            return {row["worker_id"]: dict(row) for row in c.execute(
                """SELECT w.worker_id, w.capacity,
                          (SELECT COUNT(*) FROM camera_leases l
                           WHERE l.worker_id = w.worker_id AND l.expires_at > now()) AS cameras
                   FROM worker_heartbeats w
                   WHERE w.last_seen > now() - make_interval(secs => ?)""", (ttl,)).fetchall()}
        return self._run(query)

    # --- Worker ----------------------------------------------------------
    def heartbeat(self, worker_id, capacity):
        self._run(lambda c: c.execute(
            "INSERT INTO worker_heartbeats (worker_id, capacity) VALUES (?, ?) "
            "ON CONFLICT (worker_id) DO UPDATE SET capacity = EXCLUDED.capacity, last_seen = now()",
            (worker_id, capacity)))

    def desired_running(self):
        return self._run(lambda c: {row["source_id"] for row in c.execute(
            "SELECT source_id FROM source_control WHERE desired = 'running'").fetchall()})

    def renew(self, worker_id, source_ids, ttl):
        if not source_ids:
            return set()
        return self._run(lambda c: {row["source_id"] for row in c.execute(
            "UPDATE camera_leases SET expires_at = now() + make_interval(secs => ?) "
            "WHERE worker_id = ? AND source_id = ANY(?) AND expires_at > now() RETURNING source_id",
            (ttl, worker_id, list(source_ids))).fetchall()})

    def claim(self, worker_id, source_id, ttl):
        """Toma la cámara si no tiene dueño vigente. Devuelve None o {'previous': worker anterior}."""
        def operation(c):
            row = c.execute("SELECT worker_id, (expires_at > now()) AS alive FROM camera_leases "
                            "WHERE source_id = ? FOR UPDATE", (source_id,)).fetchone()
            if row is None:
                inserted = c.execute(
                    "INSERT INTO camera_leases (source_id, worker_id, expires_at) "
                    "VALUES (?, ?, now() + make_interval(secs => ?)) ON CONFLICT (source_id) DO NOTHING",
                    (source_id, worker_id, ttl))
                return {"previous": None} if inserted.rowcount == 1 else None
            if row["alive"] and row["worker_id"] != worker_id:
                return None
            c.execute("UPDATE camera_leases SET worker_id = ?, acquired_at = now(), "
                      "expires_at = now() + make_interval(secs => ?) WHERE source_id = ?",
                      (worker_id, ttl, source_id))
            return {"previous": row["worker_id"] if row["worker_id"] != worker_id else None}
        return self._run(operation)

    def publish(self, worker_id, snapshots):
        if not snapshots:
            return
        def operation(c):
            for snapshot in snapshots:
                c.execute(
                    "INSERT INTO source_status (source_id, worker_id, status_json) VALUES (?, ?, ?) "
                    "ON CONFLICT (source_id) DO UPDATE SET worker_id = EXCLUDED.worker_id, "
                    "status_json = EXCLUDED.status_json, updated_at = now()",
                    (snapshot["source_id"], worker_id, json.dumps(snapshot, default=str)))
        self._run(operation)

    def release(self, worker_id, source_ids):
        if not source_ids:
            return
        def operation(c):
            c.execute("DELETE FROM camera_leases WHERE worker_id = ? AND source_id = ANY(?)",
                      (worker_id, list(source_ids)))
            c.execute("DELETE FROM source_status WHERE worker_id = ? AND source_id = ANY(?)",
                      (worker_id, list(source_ids)))
        self._run(operation)

    def retire(self, worker_id):
        def operation(c):
            c.execute("DELETE FROM camera_leases WHERE worker_id = ?", (worker_id,))
            c.execute("DELETE FROM source_status WHERE worker_id = ?", (worker_id,))
            c.execute("DELETE FROM worker_heartbeats WHERE worker_id = ?", (worker_id,))
        self._run(operation)
