"""API SentriX: VideoMAE CUDA por defecto y simulador explícito para pruebas."""
import logging
import asyncio
import os
import socket
from pathlib import Path
import time
from uuid import uuid4
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from app.infrastructure.streaming.webrtc import WebRTCReceiver
from fastapi import FastAPI
from app.infrastructure.persistence.detections import DetectionStore
from app.infrastructure.persistence.inference_logs import InferenceLogStore
from app.presentation.http.logs import logs_router
from app.infrastructure.persistence.alerts import AlertStore
from app.domain.alerts import EventPolicy
from app.presentation.http.alerts import alerts_router
from app.presentation.http.security import ApiKeyGuard, ClerkGuard, document_api_key, error_status

from app.domain.inference import Window, Prediction
from app.application.ports import Predictor
from app.application.inference import InferenceService
from app.application.queries import RecordQueries
from app.application.cameras import CameraService
from app.application.retention import Retention
from app.application.clips import ClipQueries
from app.infrastructure.persistence.clips import ClipStore
from app.infrastructure.clips.storage import ObjectStorage
from app.application.errors import ApplicationError
from app.infrastructure.inference.mock import MockPredictor
from app.infrastructure.persistence.cameras import CameraStore
from app.infrastructure.settings import event_policy as configured_event_policy
from app.presentation.http.inference import inference_router
from app.presentation.http.body_limit import BodyLimit
from app.presentation.http.streaming import rtsp_routers, webrtc_router
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

ROLES = ("all", "api", "worker", "inference")
AUTH_MODES = ("api_key", "both", "clerk")


def selected_provider():
    provider = os.getenv("SENTRIX_PROVIDER", "cuda")
    if provider not in ("cuda", "cpu"):
        raise ValueError("SENTRIX_PROVIDER debe ser cuda o cpu; no hay fallback automático")
    return provider


def create_app(predictor: Predictor | None = None, *, mode: str | None = None,
               transport: str | None = None, detection_db=None, log_db=None,
               role: str | None = None, coordination_store=None, user_service=None):
    # all: un proceso hace todo (comportamiento original). api: sin modelo; atiende al panel y
    # registra qué cámaras deben correr. worker: procesa las cámaras que le asigna la coordinación.
    # inference: solo los modelos; los procesos con SENTRIX_INFERENCE_URL le envían sus bloques.
    role = role or os.getenv("SENTRIX_ROLE", "all").strip().lower()
    if role not in ROLES:
        raise ValueError("SENTRIX_ROLE debe ser all, api, worker o inference")
    if role == "inference":
        return create_inference_app(predictor)
    # api_key: como siempre. both: transición, acepta sesión o clave. clerk: solo sesión de usuario.
    auth_mode = os.getenv("SENTRIX_AUTH_MODE", "api_key").strip().lower()
    if auth_mode not in AUTH_MODES:
        raise ValueError("SENTRIX_AUTH_MODE debe ser api_key, both o clerk")
    if role == "worker":
        auth_mode = "api_key"  # El worker no atiende personas: habla con Neon y R2.
    database_url = os.getenv("SENTRIX_DATABASE_URL")
    if not database_url and not (detection_db or os.getenv("SENTRIX_DETECTION_DB")):
        raise ValueError("Configurar SENTRIX_DATABASE_URL con una conexión PostgreSQL")
    store = DetectionStore(detection_db or database_url or os.getenv("SENTRIX_DETECTION_DB"))
    log_store = InferenceLogStore(log_db or database_url or os.getenv("SENTRIX_LOG_DB") or store.path)
    alert_store = AlertStore(store.path)
    event_policy = configured_event_policy()
    # hybrid (predeterminado): VadCLIP abre y cierra la alerta y VideoMAE pone la clase.
    # videomae: solo VideoMAE con la política EN-4 anterior. mock: simulador para pruebas.
    selected_mode = (mode or os.getenv("SENTRIX_PREDICTOR", "hybrid")).strip().lower()
    uses_model = predictor is None and selected_mode in ("videomae", "hybrid") and role != "api"
    inference_url = os.getenv("SENTRIX_INFERENCE_URL", "").strip()
    # remote_mode: los modelos están en el servidor de inferencia; este proceso no los carga.
    remote_mode = uses_model and bool(inference_url)
    real_mode = uses_model and not remote_mode
    hybrid = uses_model and selected_mode == "hybrid"
    if remote_mode and not hybrid:
        raise ValueError("SENTRIX_INFERENCE_URL solo funciona con SENTRIX_PREDICTOR=hybrid")
    if predictor is None and selected_mode not in ("hybrid", "videomae", "mock"):
        raise ValueError("SENTRIX_PREDICTOR debe ser hybrid, videomae o mock")
    selected_transport = transport or os.getenv("SENTRIX_VIDEO_TRANSPORT", "rtsp")
    if selected_transport not in ("webrtc", "rtsp"):
        raise ValueError("SENTRIX_VIDEO_TRANSPORT debe ser webrtc o rtsp")
    if role != "all" and selected_transport != "rtsp":
        raise ValueError("Los roles api y worker solo admiten transporte RTSP")
    receiver_type = WebRTCReceiver
    receiver_options = {"detection_store": store, "log_store": log_store, "alert_store": alert_store}
    policy_factory = lambda: EventPolicy(event_policy.thresholds)
    clip_store = ClipStore(store.path)
    clip_storage = ObjectStorage.from_env()
    clips = None
    if selected_transport == "rtsp":
        from app.infrastructure.streaming.rtsp import RTSPReceiver
        receiver_type = RTSPReceiver
        # Quien procesa video graba los clips; la API solo los consulta.
        if role != "api" and os.getenv("SENTRIX_CLIPS", "1").strip() != "0":
            from app.infrastructure.clips.service import ClipService
            clips = ClipService(
                clip_store, clip_storage,
                os.getenv("SENTRIX_CLIPS_DIR") or str(Path(__file__).resolve().parents[1] / "data" / "clips"),
                pre_roll=float(os.getenv("SENTRIX_CLIP_PRE_ROLL", "5")),
                post_roll=float(os.getenv("SENTRIX_CLIP_POST_ROLL", "2")),
                max_seconds=float(os.getenv("SENTRIX_CLIP_MAX_SECONDS", "300")),
                keep_local=os.getenv("SENTRIX_CLIPS_KEEP_LOCAL", "0").strip() == "1",
                worker_id=os.getenv("SENTRIX_WORKER_ID") or socket.gethostname())
            receiver_options["clips"] = clips
    def predict_window(frames, timestamp):
        window = Window(frames=frames, timestamp=timestamp)
        return Prediction.model_validate(app.state.predictor.predict(window)).model_dump(exclude_none=True)
    if hybrid:
        from app.application.hybrid_processing import HybridContext, HybridProcessor
        from app.domain.pipeline import HybridBuffer
        from app.infrastructure.inference.hybrid import config_from_env, load_vadclip_metadata
        hybrid_config = config_from_env(load_vadclip_metadata(require_files=not remote_mode))
        receiver = receiver_type(predict_window, hybrid_config, buffer_factory=HybridBuffer,
                                 policy_factory=lambda: HybridContext(hybrid_config), **receiver_options)
        receiver.processor = HybridProcessor(lambda: app.state.predictor)
    elif real_mode:
        from app.infrastructure.inference.videomae import VideoMAEPredictor, load_metadata, config_from_metadata
        from app.domain.pipeline import VideoMAEBuffer
        receiver = receiver_type(
            predict_window, config_from_metadata(load_metadata()), buffer_factory=VideoMAEBuffer,
            predict_frames=lambda frames, timestamp: Prediction.model_validate(
                app.state.predictor.predict_frames(frames, timestamp)).model_dump(exclude_none=True),
            policy_factory=policy_factory, **receiver_options)
    else:
        receiver = receiver_type(predict_window, policy_factory=policy_factory, **receiver_options)
    sources = coordinator = None
    worker_id = None
    if role != "all":
        from app.infrastructure.persistence.coordination import CoordinationStore
        from app.infrastructure.streaming.distributed import DistributedSources
        coordination = coordination_store or CoordinationStore(database_url or "")
        ttl = float(os.getenv("SENTRIX_LEASE_TTL", "15"))
        sources = DistributedSources(coordination, worker_ttl=ttl)
        if role == "worker":
            from app.application.coordination import Coordinator
            worker_id = os.getenv("SENTRIX_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:6]}"
            coordinator = Coordinator(coordination, CameraStore(store.path), receiver, alert_store, worker_id,
                                      capacity=int(os.getenv("SENTRIX_WORKER_CAPACITY", "2")), ttl=ttl,
                                      interval=float(os.getenv("SENTRIX_COORDINATION_INTERVAL", "2")))
    camera_service = (CameraService(CameraStore(store.path), sources or receiver, receiver.default_camera,
                                    receiver.lock)
                      if selected_transport == "rtsp" else None)
    # La API (o el proceso all) limpia los datos viejos; los workers no, para no repetir el trabajo.
    retention_days = float(os.getenv("SENTRIX_RETENTION_DAYS", "7") or 0)
    retention = (Retention(alert_store, log_store, days=retention_days,
                           interval=float(os.getenv("SENTRIX_RETENTION_INTERVAL", "3600")))
                 if retention_days > 0 and role != "worker" else None)
    # Clips en el bucket: al pasar el tope de espacio se borran los más antiguos (0 lo desactiva).
    clips_max_gb = float(os.getenv("SENTRIX_CLIPS_MAX_GB", "8") or 0)
    clip_retention = None
    if clips_max_gb > 0 and clip_storage is not None and role != "worker":
        from app.application.clip_retention import ClipRetention

        def report_clip_purge(deleted, freed, total):
            log_store.emit("clips_purged", f"Espacio de clips: {deleted} borrados ({freed / 1e6:.0f} MB), "
                                          f"quedan {total / 1e6:.0f} MB de {clips_max_gb:g} GB")

        clip_retention = ClipRetention(
            clip_store, clip_storage, max_bytes=int(clips_max_gb * 1e9),
            target=float(os.getenv("SENTRIX_CLIPS_PURGE_TARGET", "0.8")),
            interval=float(os.getenv("SENTRIX_CLIPS_PURGE_INTERVAL", "300")), on_purge=report_clip_purge)
    webhook_verifier = None
    if auth_mode != "api_key":
        from app.infrastructure.auth.webhooks import WebhookVerifier
        webhook_verifier = WebhookVerifier(os.getenv("CLERK_WEBHOOK_SECRET", ""))
        if user_service is None:
            from app.infrastructure.auth.factory import user_service_from_env
            user_service = user_service_from_env(database_url)
        user_service.log = log_store
    else:
        user_service = None
    @asynccontextmanager
    async def lifespan(app):
        if database_url:
            # Fallar al iniciar si la conexión principal no está disponible.
            def initialize_storage():
                for persistent_store in (store, alert_store, log_store):
                    connection = persistent_store.connect()
                    try:
                        with connection:
                            connection.execute("SELECT 1")
                    finally:
                        connection.close()
            await asyncio.to_thread(initialize_storage)
        if user_service is not None:
            await asyncio.to_thread(user_service.check_storage)
        if clips is not None:
            try:
                recovered = await asyncio.to_thread(clips.recover)
                if recovered:
                    logger.info("Clips pendientes de un corte anterior: %s", recovered)
            except Exception:
                logger.exception("No se pudieron recuperar los clips pendientes")
        if selected_transport == "rtsp":
            await camera_service.initialize_cameras()
        background = []
        try:
            if role == "all":
                # Con varios workers, cada uno interrumpe solo las alertas de las cámaras que hereda.
                try:
                    await asyncio.to_thread(alert_store.interrupt, reason="service_restarted")
                except Exception:
                    logger.exception("No se pudieron recuperar las alertas pendientes")
            if remote_mode:
                from app.infrastructure.inference.remote import RemoteHybridPredictor
                key = os.getenv("SENTRIX_INFERENCE_API_KEY") or os.getenv("SENTRIX_CONTROL_API_KEY", "")
                app.state.predictor = RemoteHybridPredictor(inference_url, key)
                # Sin servidor el worker arranca igual; cada bloque fallido interrumpe la alerta y reintenta.
                if not (await asyncio.to_thread(app.state.predictor.health))["inference_reachable"]:
                    logger.warning("Servidor de inferencia no disponible todavía")
            if real_mode:
                started = time.perf_counter()
                await asyncio.to_thread(log_store.emit, "model_loading",
                                    "Iniciando carga de VadCLIP + VideoMAE" if hybrid else "Iniciando carga de VideoMAE")
                try:
                    provider = selected_provider()
                    if hybrid:
                        from app.infrastructure.inference.hybrid import HybridPredictor
                        logger.info("Cargando VadCLIP + VideoMAE (%s); esperar antes de conectar la fuente", provider)
                        app.state.predictor = await asyncio.to_thread(HybridPredictor, provider=provider)
                    else:
                        from app.infrastructure.inference.videomae import VideoMAEPredictor
                        logger.info("Cargando VideoMAE (%s); esperar antes de conectar la fuente", provider)
                        app.state.predictor = await asyncio.to_thread(VideoMAEPredictor, provider=provider)
                except Exception:
                    await asyncio.to_thread(log_store.emit, "model_error", "No se pudo cargar el modelo",
                                            level="ERROR", processing_ms=round((time.perf_counter()-started)*1000, 3))
                    raise
                logger.info("Modelo listo: %s", app.state.predictor.health())
                await asyncio.to_thread(log_store.emit, "model_ready", "Modelo cargado y calentamiento completado",
                                        processing_ms=round((time.perf_counter()-started)*1000, 3))
            if sources is not None:
                await sources.refresh()
                background.append(asyncio.create_task(sources.run()))
            if coordinator is not None:
                background.append(asyncio.create_task(coordinator.run()))
            if retention is not None:
                background.append(asyncio.create_task(retention.run()))
            if clip_retention is not None:
                background.append(asyncio.create_task(clip_retention.run()))
            await asyncio.to_thread(log_store.emit, "service_started", "Servicio de inferencia iniciado" +
                                    ("" if role == "all" else f" (rol {role}" +
                                     (f", worker {worker_id})" if worker_id else ")")))
            yield
        finally:
            for task in background:
                task.cancel()
            await asyncio.gather(*background, return_exceptions=True)
            if coordinator is not None:
                try:
                    await coordinator.stop()
                except Exception:
                    logger.exception("No se pudieron liberar las cámaras del worker")
            await receiver.shutdown()
            if clips is not None:
                # Espera a que terminen las subidas en curso; lo que falte se retoma al reiniciar.
                await asyncio.to_thread(clips.shutdown)
            await asyncio.to_thread(log_store.emit, "service_stopped", "Servicio de inferencia detenido")
            if remote_mode and app.state.predictor is not None:
                app.state.predictor.close()
            if uses_model:
                app.state.predictor = None
    app = FastAPI(title="SentriX · Servicio de inferencia", version="0.6.0", lifespan=lifespan,
                  description="VideoMAE CUDA; recepción RTSP/RTSPS o WebRTC y consulta de resultados HTTP.")
    app.add_middleware(BodyLimit)
    if user_service is None:
        app.add_middleware(ApiKeyGuard)
    else:
        app.add_middleware(ClerkGuard, authenticate=user_service.authenticate, allow_api_key=auth_mode == "both")
    origins = [value.strip() for value in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,https://sentrix-vercel-upload.vercel.app").split(",") if value.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins,
                       allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                       allow_headers=["Content-Type", "Authorization", "X-API-Key"],
                       expose_headers=["X-Detection-ID"])
    @app.exception_handler(ApplicationError)
    async def application_error(request, error):
        return JSONResponse(status_code=error_status(error), content={"detail": str(error)})

    if selected_transport == "rtsp":
        for router in rtsp_routers(camera_service):
            app.include_router(router)
    else:
        app.include_router(webrtc_router(receiver))
    app.include_router(logs_router(RecordQueries(log_store,
        unavailable="Almacenamiento de logs no disponible", missing="Log no encontrado")))
    app.include_router(alerts_router(RecordQueries(alert_store,
        unavailable="Almacenamiento de alertas no disponible", missing="Alerta no encontrada"),
        ClipQueries(alert_store, clip_store, clip_storage,
                    url_seconds=int(os.getenv("SENTRIX_CLIP_URL_SECONDS", "600")))))
    if user_service is not None:
        from app.presentation.http.users import auth_router, users_router, webhooks_router
        app.include_router(auth_router(user_service))
        app.include_router(users_router(user_service))
        app.include_router(webhooks_router(user_service, webhook_verifier))
    app.state.auth_mode = auth_mode
    app.state.video_receiver = receiver
    app.state.role = role
    app.state.worker_id = worker_id
    app.state.sources = sources
    app.state.detection_store = store
    app.state.log_store = log_store
    app.state.alert_store = alert_store
    # La API no infiere: /predict responde 503 en lugar de usar el simulador.
    app.state.predictor = predictor if predictor is not None else (
        None if uses_model or role == "api" else MockPredictor())

    inference_service = InferenceService(lambda: app.state.predictor, store, log_store, real_mode=uses_model)
    detection_queries = RecordQueries(store, unavailable="Almacenamiento de detecciones no disponible",
                                      missing="Detección no encontrada")
    app.include_router(inference_router(app, detection_queries, sources or receiver, inference_service,
                       real_mode=uses_model, selected_transport=selected_transport, mock_type=MockPredictor))
    document_api_key(app, auth_mode)
    return app


def create_inference_app(predictor: Predictor | None = None):
    """Servidor de inferencia compartido: CLIP, VadCLIP y VideoMAE una sola vez, sin base de datos ni cámaras."""
    from app.presentation.http.inference_server import inference_server_router

    @asynccontextmanager
    async def lifespan(app):
        if predictor is None:
            from app.infrastructure.inference.hybrid import HybridPredictor
            provider = selected_provider()
            logger.info("Cargando VadCLIP + VideoMAE (%s) para el servidor de inferencia", provider)
            app.state.predictor = await asyncio.to_thread(HybridPredictor, provider=provider)
            logger.info("Modelo listo: %s", app.state.predictor.health())
        try:
            yield
        finally:
            app.state.predictor = None

    app = FastAPI(title="SentriX · Servidor de inferencia compartido", version="0.7.0", lifespan=lifespan,
                  description="Recibe bloques recortados por los workers y ejecuta los modelos en la GPU.")
    # Un clip uint8 de 16×224×224×3 ocupa 2,4 MB: más que el límite de la API pública.
    app.add_middleware(BodyLimit, limit=8 * 1024 * 1024)
    app.add_middleware(ApiKeyGuard)  # Lo llaman los workers, nunca una persona: siempre con clave.
    app.state.predictor = predictor
    app.state.role = "inference"
    app.include_router(inference_server_router(app))
    document_api_key(app)
    return app
