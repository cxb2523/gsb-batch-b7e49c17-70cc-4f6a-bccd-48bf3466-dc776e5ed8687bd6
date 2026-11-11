"""ASGI request body limit."""
class BodyLimit:
    """Limita el cuerpo antes de que FastAPI deserialice el JSON."""
    def __init__(self, app, limit=2 * 1024 * 1024):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        parts, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            size += len(body)
            if size > self.limit:
                from starlette.responses import JSONResponse
                return await JSONResponse(status_code=413,
                    content={"detail": "La solicitud supera 2 MiB"})(scope, receive, send)
            parts.append(body)
            if not message.get("more_body", False):
                break
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": b"".join(parts), "more_body": False}
        await self.app(scope, replay, send)
