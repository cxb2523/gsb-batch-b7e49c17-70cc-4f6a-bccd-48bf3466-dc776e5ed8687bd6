"""Rutas del servidor de inferencia compartido. Sin estado: cada pedido trae todo lo que necesita."""
import asyncio
import base64

import numpy as np
from fastapi import APIRouter, HTTPException, Request

IMAGE_SHAPE = (224, 224, 3)
CLIP_SHAPE = (16, 224, 224, 3)
IMAGE_BYTES = int(np.prod(IMAGE_SHAPE))
CLIP_BYTES = int(np.prod(CLIP_SHAPE))
FEATURE_SIZE = 512
FEATURE_BYTES = FEATURE_SIZE * 4
MAX_PREVIOUS = 255  # El cabezal de VadCLIP admite 256 posiciones, incluida la del bloque actual.


def inference_server_router(app):
    router = APIRouter(tags=["Inferencia compartida"])

    def loaded():
        predictor = app.state.predictor
        if predictor is None:
            raise HTTPException(503, "Modelo no disponible")
        return predictor

    @router.get("/health")
    def health():
        return {"status": "ok", "role": "inference", **loaded().health()}

    @router.post("/infer/detect", summary="CLIP + cabezal VadCLIP: imagen uint8 224×224×3 + vectores anteriores")
    async def detect(request: Request):
        predictor = loaded()
        body = await request.body()
        extra = len(body) - IMAGE_BYTES
        if extra < 0 or extra % FEATURE_BYTES or extra // FEATURE_BYTES > MAX_PREVIOUS:
            raise HTTPException(422, "Se espera una imagen de 224×224×3 bytes y vectores float32 de 512")
        image = np.frombuffer(body, dtype=np.uint8, count=IMAGE_BYTES).reshape(IMAGE_SHAPE)
        previous = np.frombuffer(body, dtype=np.float32, offset=IMAGE_BYTES).reshape(-1, FEATURE_SIZE)
        if not np.isfinite(previous).all():
            raise HTTPException(422, "Los vectores anteriores no son válidos")
        # Los predictores serializan el acceso a la GPU con sus propios candados.
        feature, (score, hint, hint_probability) = await asyncio.to_thread(
            predictor.detect, image, list(previous), len(previous) + 1)
        return {"feature": base64.b64encode(np.asarray(feature, dtype=np.float32).tobytes()).decode("ascii"),
                "score": score, "hint": hint, "hint_probability": hint_probability}

    @router.post("/infer/classify", summary="VideoMAE: 16 frames uint8 RGB de 224×224×3, ya recortados")
    async def classify(request: Request):
        predictor = loaded()
        body = await request.body()
        if len(body) != CLIP_BYTES:
            raise HTTPException(422, "El clip debe tener 16×224×224×3 bytes")
        clip = np.frombuffer(body, dtype=np.uint8).reshape(CLIP_SHAPE)
        return {"logits": await asyncio.to_thread(predictor.classify, list(clip))}

    return router
