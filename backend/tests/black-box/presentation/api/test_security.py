"""Acceso HTTPS: datos protegidos, health publico y preflight para Vercel."""
import asyncio
import os

import httpx



def test_public_routes_and_cors(configured):
    from app.bootstrap import create_app
    app = create_app(mode="mock", transport="rtsp")

    async def exercise():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                assert (await client.get("/health")).status_code == 200
                schema = (await client.get("/openapi.json")).json()
                assert schema["paths"]["/cameras"]["get"]["security"] == [{"ControlApiKey": []}]
                assert "security" not in schema["paths"]["/health"]["get"]
                for path in ("/cameras", "/detections", "/alerts", "/inference-logs"):
                    assert (await client.get(path)).status_code == 401
                    assert (await client.get(path, headers={"X-API-Key": "incorrecta"})).status_code == 401
                    assert (await client.get(path, headers={"X-API-Key": os.environ["SENTRIX_CONTROL_API_KEY"]})).status_code == 200
                preflight = await client.options("/cameras/camara1", headers={"Origin": "https://sentrix-vercel-upload.vercel.app", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "X-API-Key,Authorization,Content-Type"})
                assert preflight.status_code == 200
                assert preflight.headers["Access-Control-Allow-Origin"] == "https://sentrix-vercel-upload.vercel.app"
                assert preflight.headers["Access-Control-Allow-Credentials"] == "true"
                rejected = await client.options("/cameras", headers={"Origin": "https://example.invalid", "Access-Control-Request-Method": "GET"})
                assert "Access-Control-Allow-Origin" not in rejected.headers

    asyncio.run(exercise())
