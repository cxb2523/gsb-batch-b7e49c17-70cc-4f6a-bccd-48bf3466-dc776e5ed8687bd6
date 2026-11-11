"""Dobles en memoria para probar la coordinación de workers sin base de datos."""
import json
from types import SimpleNamespace
from uuid import uuid4


class FakeCoordinationStore:
    """Misma semántica que CoordinationStore, con un reloj controlado por la prueba."""
    def __init__(self):
        self.now = 0.0
        self.control, self.leases, self.heartbeats, self.status = {}, {}, {}, {}

    def set_desired(self, source_id, desired):
        self.control[source_id] = desired

    def overview(self):
        rows = []
        for source_id, desired in self.control.items():
            lease = self.leases.get(source_id)
            status = self.status.get(source_id)
            rows.append({"source_id": source_id, "desired": desired,
                         "worker_id": lease[0] if lease else None,
                         "lease_alive": bool(lease and lease[1] > self.now),
                         "status_worker": status[0] if status else None,
                         "status_json": status[1] if status else None,
                         "status_age": 0.0 if status else None})
        return rows

    def workers(self, ttl):
        return {worker_id: {"worker_id": worker_id, "capacity": capacity,
                            "cameras": sum(1 for owner, expires in self.leases.values()
                                           if owner == worker_id and expires > self.now)}
                for worker_id, (capacity, seen) in self.heartbeats.items() if seen > self.now - ttl}

    def heartbeat(self, worker_id, capacity):
        self.heartbeats[worker_id] = (capacity, self.now)

    def desired_running(self):
        return {source_id for source_id, desired in self.control.items() if desired == "running"}

    def renew(self, worker_id, source_ids, ttl):
        renewed = set()
        for source_id in source_ids:
            lease = self.leases.get(source_id)
            if lease and lease[0] == worker_id and lease[1] > self.now:
                self.leases[source_id] = (worker_id, self.now + ttl)
                renewed.add(source_id)
        return renewed

    def claim(self, worker_id, source_id, ttl):
        lease = self.leases.get(source_id)
        if lease and lease[1] > self.now and lease[0] != worker_id:
            return None
        previous = lease[0] if lease and lease[0] != worker_id else None
        self.leases[source_id] = (worker_id, self.now + ttl)
        return {"previous": previous}

    def publish(self, worker_id, snapshots):
        for snapshot in snapshots:
            self.status[snapshot["source_id"]] = (worker_id, json.dumps(snapshot))

    def release(self, worker_id, source_ids):
        for source_id in source_ids:
            if self.leases.get(source_id, (None,))[0] == worker_id:
                del self.leases[source_id]
            if self.status.get(source_id, (None,))[0] == worker_id:
                del self.status[source_id]

    def retire(self, worker_id):
        self.release(worker_id, [s for s, (owner, _) in list(self.leases.items()) if owner == worker_id])
        self.heartbeats.pop(worker_id, None)

    def owner(self, source_id):
        lease = self.leases.get(source_id)
        return lease[0] if lease and lease[1] > self.now else None


class FakeReceiver:
    def __init__(self):
        self.sessions, self.events = {}, []

    def open(self, camera):
        session = SimpleNamespace(id=f"{camera.source_id}-{uuid4().hex[:6]}", source_id=camera.source_id)
        self.sessions[session.id] = session
        return {"source_id": camera.source_id}

    async def close(self, session_id):
        self.sessions.pop(session_id, None)

    def snapshot(self, session):
        return {"source_id": session.source_id, "session_id": session.id, "status": "receiving"}

    async def log_event(self, event_type, message, **kwargs):
        self.events.append((event_type, kwargs.get("camera")))

    def cameras(self):
        return sorted(session.source_id for session in self.sessions.values())


class FakeCameras:
    def __init__(self, disabled=()):
        self.disabled = set(disabled)

    def get(self, source_id):
        return SimpleNamespace(source_id=source_id, enabled=source_id not in self.disabled)


class FakeAlerts:
    def __init__(self):
        self.interrupted = []

    def interrupt_camera(self, camera, reason):
        self.interrupted.append((camera, reason))
        return 1
