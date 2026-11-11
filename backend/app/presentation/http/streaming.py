
"""HTTP routes over camera use cases and media adapters."""
from fastapi import APIRouter, Depends, Request
from app.domain.camera import CameraRegistration
from app.presentation.http.schemas import StartSource, Offer, ViewerOffer
from app.presentation.http.security import is_admin, require_admin

def rtsp_routers(service):
    sources = APIRouter(prefix='/sources', tags=['Fuentes RTSP/RTSPS'])

    @sources.post('/start', summary='Iniciar analisis de una camara de MediaMTX',
                  description=('El panel envia source_id y stream_path; no envia video ni credenciales. '
                               'FastAPI consume directamente el stream RTSP/RTSPS. Para cambiar una ruta '
                               'activa, detener primero la fuente con DELETE /sources/{source_id}.'))
    async def start(body: StartSource):
        return await service.start_source(body)

    sources.add_api_route('', service.list_sources, methods=['GET'])
    sources.add_api_route('/{source_id}/status', service.source_status, methods=['GET'])
    sources.add_api_route('/{source_id}', service.stop_source, methods=['DELETE'])
    cameras = APIRouter(prefix='/cameras', tags=['Camaras'])

    @cameras.post('', status_code=201)
    async def register(body: CameraRegistration):
        return await service.register_camera(body)

    @cameras.put('/{source_id}')
    async def update(source_id: str, body: CameraRegistration, request: Request):
        return await service.update_camera(source_id, body, may_change_enabled=is_admin(request))

    cameras.add_api_route('', service.list_cameras, methods=['GET'])
    cameras.add_api_route('/{source_id}', service.get_camera, methods=['GET'])
    cameras.add_api_route('/{source_id}', service.delete_camera, methods=['DELETE'],
                          dependencies=[Depends(require_admin)])
    return sources, cameras

def webrtc_router(receiver):
    router = APIRouter(prefix='/webrtc', tags=['WebRTC'])

    @router.post('/offer')
    async def offer(body: Offer):
        return await receiver.offer(body)

    @router.post('/viewers/offer')
    async def viewer_offer(body: ViewerOffer):
        return await receiver.viewer_offer(body)

    router.add_api_route('/sessions', receiver.list_sessions, methods=['GET'])
    router.add_api_route('/sessions/{session_id}', receiver.status, methods=['GET'])
    router.add_api_route('/sessions/{session_id}', receiver.delete, methods=['DELETE'])
    router.add_api_route('/viewers/{viewer_id}', receiver.viewer_status, methods=['GET'])
    router.add_api_route('/viewers/{viewer_id}', receiver.delete_viewer, methods=['DELETE'])
    return router
