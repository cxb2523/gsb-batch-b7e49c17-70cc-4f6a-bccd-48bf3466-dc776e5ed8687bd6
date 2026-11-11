import asyncio
import sys
import httpx
import pytest

def test_camera_endpoints(configured, monkeypatch):
    from app.bootstrap import create_app
    app = create_app(mode="mock", transport="rtsp")

    async def idle_reader(session):
        await asyncio.Event().wait()

    monkeypatch.setattr(app.state.video_receiver, "_read_loop", idle_reader)

    async def exercise():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-API-Key": "test-control-key"}) as client:
                health = await client.get("/health")
                assert health.status_code == 200
                assert health.json()["video_transport"] == "rtsp"
                assert "livekit" not in health.json()
                schema = (await client.get("/openapi.json")).json()
                for path in ("/sources/start", "/sources/{source_id}/status", "/sources/{source_id}", "/detections", "/alerts", "/inference-logs"):
                    assert path in schema["paths"]
                assert not any("livekit" in path for path in schema["paths"])
                stopped = await client.get("/sources/camara1/status")
                assert stopped.status_code == 200 and stopped.json()["status"] == "stopped"
                registration = await client.post("/cameras", json={"source_id": "test_camera", "stream_path": "camera01"})
                assert registration.status_code == 201
                assert registration.json()["host"] == "184.194.94.182"
                assert registration.json()["has_password"] is False
                assert "password" not in registration.json()
                started = await client.post("/sources/start", json={"source_id": "camara1", "stream_path": "camera01"})
                assert started.status_code == 200 and started.json()["source_id"] == "camara1"
                state = (await client.get("/sources/camara1/status")).json()
                assert state["active"] is True and state["frames_received"] == 0
                assert (await client.delete("/sources/camara1")).status_code == 200
                # La baja de la ultima camara ya estaba habilitada en la copia local.
                assert (await client.delete("/cameras/camara1")).status_code == 200
                assert (await client.get("/cameras/camara1")).status_code == 404
                assert isinstance((await client.get("/detections?camera=camara1&limit=10")).json(), list)
                assert "items" in (await client.get("/alerts?camera=camara1&limit=30")).json()
                assert "items" in (await client.get("/inference-logs?limit=10")).json()
                assert (await client.get("/sources/camara1/status", headers={"X-API-Key": "incorrecta"})).status_code == 401

    asyncio.run(exercise())
