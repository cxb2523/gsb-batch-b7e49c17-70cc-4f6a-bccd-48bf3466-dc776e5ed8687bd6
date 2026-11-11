"""Health, inference and detection HTTP endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from app.domain.inference import Window, Prediction
from app.presentation.http.security import require_admin

def inference_router(app, queries, receiver, inference_service, *, real_mode, selected_transport, mock_type):
    router = APIRouter()
    @router.get("/health")
    def health():
        video_status = {"video_transport": selected_transport, "role": getattr(app.state, "role", "all")}
        if getattr(app.state, "worker_id", None):
            video_status["worker_id"] = app.state.worker_id
        if selected_transport == "rtsp":
            video_status["rtsp"] = receiver.connection_status()
        if real_mode:
            if app.state.predictor is None:
                raise HTTPException(503, "Modelo no disponible")
            return {"status": "ok", "predictor": type(app.state.predictor).__name__,
                    **app.state.predictor.health(), **video_status}
        return {"status": "ok", "predictor": type(app.state.predictor).__name__,
                "model_loaded": False if isinstance(app.state.predictor, mock_type) else None,
                **video_status}

    @router.post("/predict", response_model=Prediction, response_model_exclude_none=True,
                 dependencies=[Depends(require_admin)])
    def predict(window: Window, response: Response):
        prediction, detection_id = inference_service.predict(window)
        response.headers["X-Detection-ID"] = detection_id
        return prediction

    @router.get("/detections")
    def list_detections(camera: str | None = None, limit: int = Query(100, ge=1, le=500),
                        offset: int = Query(0, ge=0)):
        return queries.list(camera, limit, offset)

    @router.get('/detections/{detection_id}')
    def get_detection(detection_id: str):
        return queries.get(detection_id)
    return router
