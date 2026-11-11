"""Operational log HTTP adapter."""
from typing import Literal
from fastapi import APIRouter, Query
from pydantic import AwareDatetime
from app.domain.logs import EventType, InferenceLog, LogPage


def logs_router(service):
    router = APIRouter(prefix='/inference-logs', tags=['Logs de inferencia'])

    @router.get('', response_model=LogPage)
    def list_logs(camera: str | None = Query(None, min_length=1, max_length=64),
                  event_type: EventType | None = None,
                  level: Literal['INFO', 'WARNING', 'ERROR'] | None = None,
                  date_from: AwareDatetime | None = None, date_to: AwareDatetime | None = None,
                  limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
        return service.list(camera=camera, event_type=event_type, level=level, date_from=date_from,
                            date_to=date_to, limit=limit, offset=offset)

    @router.get('/{log_id}', response_model=InferenceLog)
    def get_log(log_id: str):
        return service.get(log_id)

    return router
