"""Validated operational log records."""
from typing import Literal
from pydantic import AwareDatetime, BaseModel

EventType = Literal["service_started", "service_stopped", "model_loading", "model_ready",
                    "model_error", "source_connected", "source_disconnected", "source_timeout",
                    "source_error", "transport_connected", "transport_disconnected",
                    "transport_error", "configuration_missing", "inference_completed",
                    "inference_error", "detection_storage_error", "window_discarded",
                    "alert_opened", "alert_closed", "alert_interrupted", "alert_storage_error",
                    "source_assigned", "data_purged", "clips_purged", "user_provisioned",
                    "user_deleted", "user_invited", "user_role_changed", "user_status_changed",
                    "user_sync_conflict"]


class InferenceLog(BaseModel):
    id: str
    fecha_hora: AwareDatetime
    camera: str | None
    event_type: EventType
    level: Literal["INFO", "WARNING", "ERROR"]
    message: str
    processing_ms: float | None
    inference_ms: float | None
    session_id: str | None
    window_id: str | None
    detection_id: str | None


class LogPage(BaseModel):
    items: list[InferenceLog]
    total: int
    limit: int
    offset: int
