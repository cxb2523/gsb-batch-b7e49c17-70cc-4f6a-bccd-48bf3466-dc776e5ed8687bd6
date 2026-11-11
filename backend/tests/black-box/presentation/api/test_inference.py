"""HTTP contracts across the newly separated layers."""
import asyncio

import httpx


def test_prediction_headers_history_and_error_mapping(configured, monkeypatch):
    from app.bootstrap import create_app
    app = create_app(mode="mock", transport="rtsp")

    async def exercise():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                         headers={"X-API-Key": "test-control-key"}) as client:
                response = await client.post("/predict", json={"timestamp": 1, "frames": [[[[0., 0., 0.]]]]})
                assert response.status_code == 200
                assert response.json()["simulated"] is True
                identifier = response.headers["X-Detection-ID"]
                saved = await client.get(f"/detections/{identifier}")
                assert saved.status_code == 200 and saved.json()["id"] == identifier
                assert (await client.get("/detections/missing")).status_code == 404
                assert (await client.get("/alerts/missing")).status_code == 404
                assert (await client.get("/inference-logs/missing")).status_code == 404
                invalid = await client.get("/inference-logs", params={
                    "date_from": "2026-02-01T00:00:00Z", "date_to": "2026-01-01T00:00:00Z"})
                assert invalid.status_code == 422
                assert (await client.post("/sources/start", json={"source_id": "missing"})).status_code == 404

                def fail(*args):
                    raise RuntimeError("private SQL diagnostic")

                monkeypatch.setattr(app.state.detection_store, "list", fail)
                response = await client.get("/detections")
                assert response.status_code == 503
                assert "private" not in response.text

    asyncio.run(exercise())


def test_webrtc_routes_and_bad_offer_still_return_original_status_codes(configured):
    from app.bootstrap import create_app
    app = create_app(mode="mock", transport="webrtc")

    async def exercise():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                         headers={"X-API-Key": "test-control-key"}) as client:
                assert (await client.get("/webrtc/sessions/missing")).status_code == 404
                assert (await client.get("/webrtc/viewers/missing")).status_code == 404
                offer = await client.post("/webrtc/offer", json={"type": "offer", "sdp": "invalid"})
                assert offer.status_code == 400
                assert (await client.get("/webrtc/sessions")).json() == []

    asyncio.run(exercise())
