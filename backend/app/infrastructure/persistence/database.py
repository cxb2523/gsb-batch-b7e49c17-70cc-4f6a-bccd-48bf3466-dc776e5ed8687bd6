"""Conexión PostgreSQL; SQLite queda disponible únicamente para pruebas explícitas."""
from pathlib import Path
import sqlite3
import threading
import time


class Record(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in (cursor.description or ())]
    return lambda values: Record(zip(names, values))


# Las conexiones inactivas se descartan antes de que Neon o su pooler las corten.
IDLE_SECONDS = 60
MAX_IDLE = 8


class ConnectionPool:
    """Reutiliza conexiones entre operaciones; cada conexión la usa un solo hilo a la vez."""
    def __init__(self, url):
        self.url = url
        self.idle = []
        self.lock = threading.Lock()

    def new(self):
        import psycopg
        # Sin prepared statements de servidor: el pooler de Neon no los comparte entre conexiones.
        return psycopg.connect(self.url, row_factory=row_factory, connect_timeout=5,
                               prepare_threshold=None)

    def acquire(self):
        while True:
            with self.lock:
                connection, since = self.idle.pop() if self.idle else (None, 0)
            if connection is None:
                return self.new(), False
            if connection.closed or time.monotonic() - since > IDLE_SECONDS:
                connection.close()
                continue
            return connection, True

    def release(self, connection):
        from psycopg.pq import TransactionStatus
        if connection.closed or connection.broken:
            return
        if connection.info.transaction_status != TransactionStatus.IDLE:
            try:
                # Las lecturas sin bloque `with` dejan la transacción abierta.
                connection.rollback()
            except Exception:
                connection.close()
                return
        with self.lock:
            if len(self.idle) < MAX_IDLE:
                self.idle.append((connection, time.monotonic()))
                return
        connection.close()


_pools = {}
_pools_lock = threading.Lock()


def pool_for(url):
    with _pools_lock:
        if url not in _pools:
            _pools[url] = ConnectionPool(url)
        return _pools[url]


class PostgresConnection:
    def __init__(self, url):
        self.pool = pool_for(url)
        self.connection, self.reused = self.pool.acquire()
        self.started = False

    def _run(self, statement, parameters=None):
        import psycopg
        try:
            return self.connection.execute(statement, parameters)
        except psycopg.OperationalError:
            # Una conexión reutilizada pudo cerrarse en el servidor mientras estaba inactiva.
            # Solo se reintenta si aún no se ejecutó nada en esta operación.
            if self.started or not self.reused or not self.connection.broken:
                raise
            self.connection.close()
            self.connection, self.reused = self.pool.new(), False
            return self.connection.execute(statement, parameters)
        finally:
            self.started = True

    def execute(self, statement, parameters=None):
        if statement == "PRAGMA foreign_keys = ON":
            return None
        if statement in ("BEGIN", "BEGIN IMMEDIATE"):
            if statement == "BEGIN IMMEDIATE":
                # Serializa apertura/cierre de sesiones entre procesos.
                return self._run("LOCK TABLE alerts, closed_alert_sessions IN EXCLUSIVE MODE")
            return None  # psycopg inicia la transacción al ejecutar la primera consulta.
        ignore = "INSERT OR IGNORE" in statement
        statement = statement.replace("INSERT OR IGNORE", "INSERT").replace("?", "%s")
        if statement.lstrip().startswith("CREATE TABLE"):
            statement = statement.replace(" REAL", " DOUBLE PRECISION")
        if ignore:
            statement += " ON CONFLICT DO NOTHING"
        if parameters is not None:
            parameters = tuple(int(value) if isinstance(value, bool) else value for value in parameters)
        return self._run(statement, parameters)

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        self.connection.rollback() if kind else self.connection.commit()

    def close(self):
        self.pool.release(self.connection)


def connect(target):
    if str(target).startswith(("postgresql://", "postgres://")):
        return PostgresConnection(str(target))
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection
