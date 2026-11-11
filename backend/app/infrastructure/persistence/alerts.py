"""Transactional alert persistence and recovery."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import time
from functools import wraps
from app.domain.alerts import DEFAULT_THRESHOLDS
from app.infrastructure.persistence.detections import DetectionStore

def _retry_transaction(operation):
    @wraps(operation)
    def run(*args, **kwargs):
        for attempt in range(3):
            try:
                return operation(*args, **kwargs)
            except Exception as exc:
                if getattr(exc, "sqlstate", None) not in ("40P01", "40001") or attempt == 2:
                    raise
                # The operation has rolled back and closed its connection.
                time.sleep(.05 * (attempt + 1))
    return run

def _interrupt_sql(bounded):
    # Una alerta interrumpida termina en la última ventana guardada de su sesión, para que el evento
    # (y su clip) tenga fin y duración sin la ventana Normal de cierre. Con `bounded` se excluyen las
    # ventanas posteriores al corte (p. ej. la que llegó después de un window_gap).
    end = ("(SELECT MAX(d.timestamp) FROM detections d WHERE d.session_id = alerts.session_id"
           + (" AND d.timestamp <= ?" if bounded else "") + ")")
    return ("UPDATE alerts SET status='interrupted', interruption_reason=?, fecha_hora_fin=?, "
            f"timestamp_fin={end}, duracion_segundos={end} - timestamp_inicio WHERE status='active'")

class AlertStore(DetectionStore):
    def _create_schema(self, connection):
        super()._create_schema(connection)
        connection.execute("""CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY, detection_id TEXT NOT NULL REFERENCES detections(id),
            end_detection_id TEXT REFERENCES detections(id), camera TEXT NOT NULL,
            session_id TEXT NOT NULL, clase TEXT NOT NULL, confianza REAL NOT NULL,
            threshold REAL NOT NULL, timestamp REAL NOT NULL, fecha_hora TEXT NOT NULL,
            timestamp_inicio REAL NOT NULL, timestamp_fin REAL, fecha_hora_fin TEXT,
            duracion_segundos REAL, status TEXT NOT NULL, interruption_reason TEXT,
            UNIQUE(detection_id)
        )""")
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS active_session ON alerts(session_id) WHERE status = 'active'")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_alerts_camera_fecha ON alerts(camera, fecha_hora)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_alerts_fecha_hora ON alerts(fecha_hora)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)")
        connection.execute("CREATE TABLE IF NOT EXISTS closed_alert_sessions (session_id TEXT PRIMARY KEY)")

    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()

    @_retry_transaction
    def apply(self, result, detection):
        state = result["alert"]
        connection = self.connect()
        try:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                if connection.execute("SELECT 1 FROM closed_alert_sessions WHERE session_id=?",
                                      (detection["session_id"],)).fetchone():
                    return None
                active = connection.execute("SELECT * FROM alerts WHERE session_id = ? AND status = 'active'",
                                            (detection["session_id"],)).fetchone()
                if state["started"] and active is None:
                    if detection["clase"] not in DEFAULT_THRESHOLDS or detection["confianza"] < state["threshold"]:
                        raise ValueError("La detección no cumple el threshold")
                    identifier = str(uuid4())
                    connection.execute("""INSERT OR IGNORE INTO alerts
                        (id, detection_id, camera, session_id, clase, confianza, threshold, timestamp,
                         fecha_hora, timestamp_inicio, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')""",
                        (identifier, detection["id"], detection["camera"], detection["session_id"],
                         detection["clase"], detection["confianza"], state["threshold"], detection["timestamp"],
                         detection["fecha_hora"], detection["timestamp"]))
                    active = connection.execute("SELECT * FROM alerts WHERE detection_id = ?", (detection["id"],)).fetchone()
                if state["ended"] and active is not None:
                    if detection["clase"] != "Normal" or detection["timestamp"] < active["timestamp_inicio"]:
                        raise ValueError("Cierre de evento inválido")
                    connection.execute("""UPDATE alerts SET status='closed', end_detection_id=?, timestamp_fin=?,
                        fecha_hora_fin=?, duracion_segundos=? WHERE id=?""",
                        (detection["id"], detection["timestamp"], detection["fecha_hora"],
                         detection["timestamp"]-active["timestamp_inicio"], active["id"]))
                    active = connection.execute("SELECT * FROM alerts WHERE id=?", (active["id"],)).fetchone()
                return dict(active) if active is not None else None
        finally:
            connection.close()

    @_retry_transaction
    def open_event(self, detection, clase, confianza, threshold, start_timestamp=None):
        """Híbrido: VadCLIP abrió el evento en `start_timestamp` (por defecto, el de la detección).

        `confianza` es el puntaje de anomalía que lo abrió; la clase la da VideoMAE en `detection`.
        """
        start = detection["timestamp"] if start_timestamp is None else start_timestamp
        if (clase not in DEFAULT_THRESHOLDS or not 0 <= confianza <= 1 or confianza < threshold
                or start > detection["timestamp"]):
            raise ValueError("Apertura de evento inválida")
        opened_at = (datetime.fromisoformat(detection["fecha_hora"])
                     - timedelta(seconds=detection["timestamp"] - start)).isoformat()
        connection = self.connect()
        try:
            with connection:
                if connection.execute("SELECT 1 FROM closed_alert_sessions WHERE session_id=?",
                                      (detection["session_id"],)).fetchone():
                    return None
                connection.execute("""INSERT OR IGNORE INTO alerts
                    (id, detection_id, camera, session_id, clase, confianza, threshold, timestamp,
                     fecha_hora, timestamp_inicio, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')""",
                    (str(uuid4()), detection["id"], detection["camera"], detection["session_id"], clase,
                     confianza, threshold, start, opened_at, start))
                row = connection.execute("SELECT * FROM alerts WHERE session_id=? AND status='active'",
                                         (detection["session_id"],)).fetchone()
                return dict(row) if row is not None else None
        finally:
            connection.close()

    @_retry_transaction
    def close_event(self, alert_id, end_timestamp, clase, fecha_hora_fin, end_detection_id=None):
        """Híbrido: VadCLIP cerró el evento; fija la clase final (promedio de VideoMAE dentro del evento)."""
        if clase not in DEFAULT_THRESHOLDS:
            raise ValueError("Clase final inválida")
        connection = self.connect()
        try:
            with connection:
                cursor = connection.execute("""UPDATE alerts SET status='closed', clase=?, end_detection_id=?,
                    timestamp_fin=?, fecha_hora_fin=?, duracion_segundos=? - timestamp_inicio
                    WHERE id=? AND status='active' AND timestamp_inicio <= ?""",
                    (clase, end_detection_id, end_timestamp, fecha_hora_fin, end_timestamp, alert_id, end_timestamp))
                return cursor.rowcount
        finally:
            connection.close()

    @_retry_transaction
    def interrupt(self, session_id=None, reason="service_restarted", end_timestamp=None):
        connection = self.connect()
        try:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                if session_id is not None and reason == "source_disconnected":
                    connection.execute("INSERT OR IGNORE INTO closed_alert_sessions VALUES (?)", (session_id,))
                bounded = end_timestamp is not None
                cursor = connection.execute(_interrupt_sql(bounded) + (" AND session_id=?" if session_id is not None else ""),
                    (reason, self.now(), *((end_timestamp,) * 2 if bounded else ()),
                     *((session_id,) if session_id is not None else ())))
                return cursor.rowcount
        finally:
            connection.close()

    @_retry_transaction
    def interrupt_camera(self, camera, reason):
        """Interrumpe las alertas activas de una cámara (p. ej. al cambiar de worker)."""
        connection = self.connect()
        try:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                cursor = connection.execute(_interrupt_sql(False) + " AND camera=?", (reason, self.now(), camera))
                return cursor.rowcount
        finally:
            connection.close()

    def purge_detections(self, before, batch=5000):
        """Borra detecciones Normal anteriores a `before` que no abren ni cierran ninguna alerta."""
        cutoff = before.astimezone(timezone.utc).isoformat()
        removed = 0
        while True:
            connection = self.connect()
            try:
                # Lotes cortos: cada uno es una transacción breve y no frena las escrituras en vivo.
                with connection:
                    count = connection.execute("""DELETE FROM detections WHERE id IN (
                        SELECT d.id FROM detections d WHERE d.clase = 'Normal' AND d.fecha_hora < ?
                        AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.detection_id = d.id)
                        AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.end_detection_id = d.id)
                        LIMIT ?)""", (cutoff, batch)).rowcount
            finally:
                connection.close()
            removed += count
            if count < batch:
                return removed

    def get(self, identifier):
        connection = self.connect()
        try:
            row = connection.execute("SELECT * FROM alerts WHERE id=?", (identifier,)).fetchone()
            return dict(row) if row else None
        finally:
            connection.close()

    def list(self, camera=None, status=None, limit=100, offset=0):
        connection = self.connect()
        clauses, params = [], []
        for column, value in (("camera", camera), ("status", status)):
            if value is not None:
                clauses.append(f"{column}=?")
                params.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        try:
            with connection:
                connection.execute("BEGIN")
                total = connection.execute("SELECT COUNT(*) FROM alerts" + where, params).fetchone()[0]
                rows = connection.execute("SELECT * FROM alerts" + where + " ORDER BY fecha_hora DESC, id DESC LIMIT ? OFFSET ?",
                                          (*params, limit, offset)).fetchall()
            return dict(items=[dict(row) for row in rows], total=total, limit=limit, offset=offset)
        finally:
            connection.close()
