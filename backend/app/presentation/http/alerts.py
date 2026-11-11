"""Alert HTTP adapter."""
from fastapi import APIRouter, Query
from typing import Literal


def alerts_router(service, clips=None):
    router = APIRouter(prefix='/alerts', tags=['Alertas EN-4'])

    @router.get('')
    def list_alerts(camera: str | None = None, status: Literal['active', 'closed', 'interrupted'] | None = None,
                    limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
        return service.list(camera, status, limit, offset)

    @router.get('/{alert_id}')
    def get_alert(alert_id: str):
        return service.get(alert_id)

    if clips is not None:
        @router.get('/{alert_id}/clip', summary='Clip del evento',
                    description='Estado del clip (recording, ready, partial o missing) y, si está en el bucket, '
                                'una URL temporal firmada para reproducirlo.')
        def get_clip(alert_id: str):
            return clips.get(alert_id)

    return router
