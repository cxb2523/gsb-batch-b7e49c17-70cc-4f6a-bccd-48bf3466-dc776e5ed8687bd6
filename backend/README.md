# SentriX — backend de inferencia

Servicio FastAPI que recibe video RTSP/RTSPS desde MediaMTX, detecta anomalías con VadCLIP y
las clasifica con VideoMAE en GPU, y guarda detecciones, alertas y logs en PostgreSQL (Neon). El panel
SvelteKit lo consulta por HTTP con `X-API-Key`.

## Requisitos

- **Python 3.11 o superior.** El servicio se detiene al arrancar con una versión anterior.
- GPU NVIDIA con controlador compatible con `onnxruntime-gpu` (modo predeterminado).
- Pesos `modelo/videomae_crime5_continuous.onnx` y `.onnx.data`, juntos (ver [modelo/README.md](../modelo/README.md)).
- Una base PostgreSQL accesible (`SENTRIX_DATABASE_URL`).

## Instalar y arrancar

Desde la raíz del repositorio, en PowerShell:

```powershell
python -m venv .venv
Copy-Item backend/.env.example backend/.env
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-gpu.txt
.\backend\start_gpu.ps1
```

Completar `backend/.env` antes de arrancar (al menos `SENTRIX_DATABASE_URL` y
`SENTRIX_CONTROL_API_KEY`). No instalar `onnxruntime` y `onnxruntime-gpu` en el mismo
entorno. `start_gpu.ps1` fuerza CUDA y transporte RTSP (el modelo lo decide `SENTRIX_PREDICTOR`,
por defecto el híbrido) y no inicia una segunda instancia si ya hay una sana en el puerto 8000.
El híbrido necesita además `modelo/vadclip/clip_visual.onnx` y `vadclip_head.onnx` (fuera de git;
están en el paquete de Piero `sentrix_vadclip_videomae_onnx_v1/models`). Equivalente manual:

```powershell
$env:SENTRIX_PROVIDER = 'cuda'
$env:SENTRIX_VIDEO_TRANSPORT = 'rtsp'
.\.venv\Scripts\python.exe backend/run_server.py --host 127.0.0.1 --port 8000
```

Esperar `Application startup complete` y revisar http://localhost:8000/health:
`model_loaded: true`, `gpu_active: true` y `CUDAExecutionProvider` en `providers`.
Swagger: http://localhost:8000/docs (botón Authorize para la API key).

Ejecutar un único proceso: sesiones, colas y política de alertas viven en memoria.
Si el modelo no carga, el servicio no arranca; no cambia en silencio a CPU ni al simulador.
Para usar CPU de forma deliberada, `SENTRIX_PROVIDER=cpu`. Para pruebas sin modelo,
`SENTRIX_PREDICTOR=mock` (`/health` informa `model_loaded: false` y cada predicción lleva
`simulated: true`).

## Escalamiento horizontal (roles)

`SENTRIX_ROLE` separa el servicio en procesos que comparten la base PostgreSQL:

| Rol | Qué hace |
|---|---|
| `all` (predeterminado) | Un solo proceso hace todo, como antes. |
| `api` | Atiende al panel. No carga el modelo: `POST /sources/start` registra que la cámara debe correr y `GET /sources/{id}/status` muestra lo que publica el worker dueño. |
| `worker` | Procesa cámaras y carga el modelo, salvo que use un servidor de inferencia. Cada cámara la procesa un solo worker (lease en la base). |
| `inference` | Solo los modelos (CLIP, cabezal VadCLIP y VideoMAE) en la GPU. Sin base de datos ni cámaras. |

Cada worker renueva sus cámaras cada `SENTRIX_COORDINATION_INTERVAL` s (2) y toma como máximo una
cámara libre por ciclo, solo si es de los menos cargados, hasta `SENTRIX_WORKER_CAPACITY` (2). Si un
worker se apaga de golpe, sus cámaras pasan a otro cuando vence el lease (`SENTRIX_LEASE_TTL`, 15 s) y
se interrumpen sus alertas abiertas (`worker_lost`). Con un apagado ordenado (Ctrl+C) las libera al
instante. Las cámaras ya asignadas no se redistribuyen al sumar workers.

En local, cada proceso en su propia terminal (los workers comparten la GPU):

```powershell
$env:SENTRIX_ROLE = 'api';    .\.venv\Scripts\python.exe backend/run_server.py --port 8000
$env:SENTRIX_ROLE = 'worker'; .\.venv\Scripts\python.exe backend/run_server.py --port 8001
$env:SENTRIX_ROLE = 'worker'; .\.venv\Scripts\python.exe backend/run_server.py --port 8002
```

El panel apunta solo a la API (puerto 8000). `GET /health` de la API lista los workers vivos y sus cámaras.

### Servidor de inferencia compartido

Con varios workers en una sola GPU, cada uno cargaría su copia de los modelos y llenaría la VRAM. Para
compartirlos, arrancar el servidor con `.\backend\start_inference.ps1` (puerto 8099; `-BindHost` con la IP
de Tailscale para workers en otras máquinas) y poner en cada worker
`SENTRIX_INFERENCE_URL=http://<host>:8099`. Solo funciona con `SENTRIX_PREDICTOR=hybrid` y el worker no
necesita los pesos ni GPU, pero sí `modelo/vadclip/metadata.json`.

El worker guarda el estado de cada cámara y recorta en CPU; el servidor no guarda nada por cámara y atiende
`POST /infer/detect` y `POST /infer/classify` con `X-API-Key`. Si se cae, cada bloque fallido interrumpe la
alerta (`processing_error`), el worker sigue vivo y retoma solo cuando el servidor vuelve.

### Workers en Azure

`deploy/azure` crea hasta 3 VMs con Terraform y despliega en ellas el último commit, con el servidor de
inferencia en un equipo con GPU conectado por Tailscale. Requiere Terraform, Azure CLI con sesión iniciada,
Tailscale, la llave `~/.ssh/sentrix_azure`, `deploy/azure/terraform/terraform.tfvars` y el puerto 8099 abierto
solo para Tailscale. La clave de Tailscale debe ser reutilizable y no efímera.

```powershell
.\backend\start_inference.ps1 -BindHost <IP de Tailscale del equipo>
$s = Read-Host "Clave de Tailscale" -AsSecureString; $env:TAILSCALE_AUTHKEY = [System.Net.NetworkCredential]::new("", $s).Password
.\.venv\Scripts\python.exe deploy/azure/workers_azure.py subir --capacidad 6
.\.venv\Scripts\python.exe deploy/azure/workers_azure.py autoescalar --capacidad 4
.\.venv\Scripts\python.exe deploy/azure/workers_azure.py bajar
```

`subir` deja cada worker con un tope de 6 cámaras y `autoescalar` calcula con 4 por VM: si cae una VM, las demás
absorben sus cámaras. `bajar` detiene los workers, comprueba que no queden clips sin subir y destruye todo. Las VMs
cobran mientras existan.

## Configuración (`backend/.env`)

| Variable | Uso |
|---|---|
| `SENTRIX_DATABASE_URL` | Conexión PostgreSQL para detecciones, alertas, logs y cámaras. Obligatoria en operación. |
| `SENTRIX_CONTROL_API_KEY` | Clave exigida en `X-API-Key`; debe coincidir con `INFERENCE_API_KEY` del frontend. |
| `SENTRIX_PREDICTOR` / `SENTRIX_PROVIDER` | `hybrid` (predeterminado: VadCLIP + VideoMAE), `videomae` (solo VideoMAE con EN-4) o `mock` / `cuda` o `cpu`. |
| `SENTRIX_VADCLIP_ROOT` | Carpeta de CLIP + cabezal VadCLIP (por defecto `modelo/vadclip`). |
| `SENTRIX_HYBRID_THRESHOLD`, `_RELEASE`, `_MERGE_GAP`, `_MAX_EVENT_SECONDS`, … | Ajustes de la política del híbrido; por defecto los de `modelo/vadclip/metadata.json` (los del runner). |
| `SENTRIX_VIDEO_TRANSPORT` | `rtsp` (predeterminado) o `webrtc` (modo alternativo de pruebas). |
| `SENTRIX_SOURCE_ID`, `SENTRIX_CAMERA_NAME`, `SENTRIX_STREAM_PATH`, `SENTRIX_RTSP_*` | Cámara predeterminada en MediaMTX. `SENTRIX_RTSP_SHA256` es obligatoria con RTSPS. |
| `SENTRIX_ALERT_THRESHOLDS` | JSON con los umbrales de las cuatro clases (ver EN-4). |
| `TA2_QUEUE_SIZE` | Ventanas en cola por sesión, de 1 a 4 (predeterminado 2). |
| `FRONTEND_ORIGINS` | Orígenes CORS permitidos, separados por comas. |
| `SENTRIX_ROLE` | `all`, `api`, `worker` o `inference` (ver Escalamiento horizontal). |
| `SENTRIX_INFERENCE_URL`, `SENTRIX_INFERENCE_API_KEY` | Servidor de inferencia compartido y su clave (por defecto `SENTRIX_CONTROL_API_KEY`). Vacío: cada worker carga los modelos. |
| `SENTRIX_MODEL_ROOT` | Carpeta del modelo VideoMAE (por defecto `modelo`). |
| `SENTRIX_WORKER_CAPACITY`, `SENTRIX_LEASE_TTL`, `SENTRIX_COORDINATION_INTERVAL`, `SENTRIX_WORKER_ID` | Ajustes de los workers (2 cámaras, 15 s, 2 s, id automático). |
| `SENTRIX_DETECTION_DB`, `SENTRIX_LOG_DB` | Solo sin `SENTRIX_DATABASE_URL`: archivos SQLite para pruebas locales. |

## API

Todas las rutas exigen `X-API-Key`, salvo `/health`, `/docs`, `/redoc` y `/openapi.json`.

| Ruta | Uso |
|---|---|
| `GET /health` | Estado del modelo, GPU y transporte. |
| `GET/POST /cameras`, `GET/PUT/DELETE /cameras/{source_id}` | Inventario de cámaras. |
| `POST /sources/start`, `GET /sources`, `GET /sources/{id}/status`, `DELETE /sources/{id}` | Iniciar, consultar y detener el análisis de una cámara. |
| `GET /detections`, `GET /detections/{id}` | Historial de inferencias (filtro `camera`, `limit` 1–500, `offset`). |
| `GET /alerts`, `GET /alerts/{id}` | Eventos confirmados (filtros `camera`, `status`; paginación). |
| `GET /alerts/{id}/clip` | Clip del evento: `status` (`recording`, `ready`, `partial`, `missing`), `duration_seconds` y, si está en el bucket, una `url` firmada temporal. |
| `GET /inference-logs`, `GET /inference-logs/{id}` | Logs operativos (filtros cámara, evento, nivel y fechas con zona horaria). |
| `POST /predict` | Clasificación de un clip JSON independiente, sin política temporal. |

Errores controlados: 401 (API key), 404, 409, 413 (cuerpo > 2 MiB), 422 (entrada inválida) y 503
(modelo o almacenamiento no disponible).

## Flujo de video e inferencia

### Híbrido (predeterminado): VadCLIP abre y cierra, VideoMAE clasifica

Igual que el runner de Piero (`run_realtime_hybrid_onnx.py`), comprobado video por video en GPU:
mismos puntajes (Δ < 1e-6), mismas aperturas y soltadas, mismas clases de VideoMAE.

- **Cada 16 frames** (~0,53 s a 30 fps): el primer frame del bloque pasa por CLIP (vector de 512) y
  el cabezal VadCLIP calcula el puntaje de anomalía con los últimos 8 vectores (~4,3 s).
- **Abre** la alerta cuando el puntaje suavizado (2 actualizaciones) llega a 0,85. `alerts.confianza`
  es ese puntaje y `threshold` 0,85; la clase inicial es la criminal más probable de VideoMAE.
- **VideoMAE** solo corre con el evento abierto (y durante la espera de unión): al abrir, cada 4
  bloques (64 frames, los mismos 16 frames de 61 que antes) y al soltar.
- **Suelta** tras 3 actualizaciones bajo el umbral (~1,6 s). La alerta queda abierta 8 s
  (`merge_gap`): si VadCLIP se reactiva, es el mismo evento; si no, se cierra con **fin = el momento
  en que VadCLIP soltó** y la clase final = promedio de logits de VideoMAE dentro del evento. Si en
  ese promedio gana Normal, se usa la clase criminal más probable (VadCLIP manda).
- Eventos de más de 120 s se cortan en tramos (se cierra uno y se abre otro).
- Detecciones: cada clasificación de VideoMAE y, sin evento, una Normal cada 4 bloques
  (confianza = 1 − puntaje), el mismo ritmo de filas que con VideoMAE solo.
- `GET /sources/{id}/status` → `latest_result` muestra `anomaly_score`, `vadclip_hint` y en `alert`
  `incident` (VadCLIP sobre el umbral) y `closing` (esperando la unión).
- El clip incluye la espera de unión: termina ~8 s + `SENTRIX_CLIP_POST_ROLL` después del fin.

### VideoMAE solo (`SENTRIX_PREDICTOR=videomae`, política EN-4)

- El backend consume el stream RTSP de MediaMTX por TCP y reintenta cada 3 s si se corta. Cada
  corte se registra una vez como `transport_error`; la recuperación, como `source_connected`.
- Se toman los frames recibidos 0, 4, …, 60 de cada bloque de 64 (16 frames por ventana). Se
  preserva el aspecto, se recorta al centro a 224×224 y se normaliza como en el entrenamiento.
  Entrada float32 NCTHW `[1, 3, 16, 224, 224]`.
- La inferencia corre en un hilo aparte. La cola descarta la ventana más antigua si se llena.
- Saltos de más de 1 s, retrocesos o timestamps inválidos reinician la ventana parcial y la política.
- Cada sesión tiene su propia política, cola y resultados; reconectar limpia el estado.

A 30 fps llega una ventana cada 2,13 s; a 25 fps, cada 2,56 s. Procesar una ventana
(inferencia y guardado) debe tardar menos que eso para no descartar ventanas.

## Persistencia (PostgreSQL)

Todas las tablas viven en la base de `SENTRIX_DATABASE_URL` y se crean al arrancar si no
existen. Las conexiones se reutilizan entre operaciones; si la base corta una conexión
inactiva, se abre otra automáticamente. No se guardan frames, clips ni video.

- **EN-3, `detections`:** cada inferencia exitosa, incluida la clase Normal y las que no superan
  el umbral: `id`, `camera`, `fecha_hora` (UTC), `clase`, `confianza`, `timestamp` (segundos de la
  línea temporal del video, no fecha), `simulated`, `probabilities`, `session_id` y `window_id`
  (nulos en `POST /predict`, que devuelve el id en la cabecera `X-Detection-ID`).
- **EN-4, `alerts`** (con el híbrido, ver arriba: lo abre y cierra VadCLIP): se abre un evento tras dos ventanas consecutivas de la misma clase criminal
  con confianza ≥ su umbral, y se cierra tras tres ventanas Normal consecutivas. Umbrales
  provisionales: Hurto .50, Robo .60, Agresión física .60, Vandalismo .55. Guarda detección de
  apertura y cierre, timestamps, duración y estado `active`/`closed`/`interrupted`.
  Desconexiones, fallos, ventanas perdidas y reinicios interrumpen el evento sin inventar un regreso
  a Normal; una alerta interrumpida termina en la última ventana guardada antes del corte, así que
  también tiene fin y duración. La tabla solo se consulta al abrir o cerrar una alerta.
- **TA-4, `inference_logs`:** inicio y cierre del servicio, carga del modelo, conexiones de fuentes,
  errores e inferencias con `processing_ms` e `inference_ms`. Un fallo al guardar logs no detiene
  la inferencia.
- **Retención:** con `SENTRIX_RETENTION_DAYS=N` (rol `all` o `api`) se borran cada hora las detecciones
  Normal que no abren ni cierran una alerta y los logs `inference_completed` con más de N días. Las
  alertas, sus detecciones y los demás eventos se conservan. Por defecto 7 días; `0` la desactiva.

### Clips de eventos

- **Quién graba:** el proceso que recibe el video (`all` o `worker`). Guarda en memoria los últimos
  segundos de paquetes H.264 y, al abrirse una alerta, escribe un MP4 **sin recodificar** desde
  `SENTRIX_CLIP_PRE_ROLL` segundos antes (5 por defecto: la alerta se confirma ~2 ventanas después de
  que empieza la anomalía) hasta `SENTRIX_CLIP_POST_ROLL` segundos después del cierre (2 por defecto).
  Tope: `SENTRIX_CLIP_MAX_SECONDS` (300). Un evento interrumpido deja un clip `partial`.
- **Cortes abruptos:** el MP4 es fragmentado y se escribe al disco en cada paquete. Si el proceso muere,
  al arrancar repara los `.part` (conserva los fragmentos completos) y sube lo pendiente.
- **Dónde queda:** en `SENTRIX_CLIPS_DIR` (por defecto `backend/data/clips`) y, si están las variables
  `SENTRIX_CLIPS_*` de un bucket S3 compatible (Cloudflare R2), se sube como `<cámara>/<alerta>.mp4` y se
  borra del disco (`SENTRIX_CLIPS_KEEP_LOCAL=1` lo conserva). El estado vive en la tabla `alert_clips`.
- **Cómo se reproduce:** `GET /alerts/{id}/clip` firma una URL de `SENTRIX_CLIP_URL_SECONDS` (600) para
  el bucket privado; la API necesita las mismas variables `SENTRIX_CLIPS_*` para firmarla.
- `SENTRIX_CLIPS=0` desactiva la grabación.

### Migraciones

`backend/migrations/` contiene scripts SQL idempotentes para alinear una base existente con las
restricciones del código. Ejecutarlos una vez sobre la base de operación, por ejemplo:

```powershell
.\.venv\Scripts\python.exe -c "import psycopg,pathlib,dotenv; u=dotenv.dotenv_values('backend/.env')['SENTRIX_DATABASE_URL']; c=psycopg.connect(u, autocommit=True); c.execute(pathlib.Path('backend/migrations/2026-10-31_integridad_e_indices.sql').read_text(encoding='utf-8')); print('ok')"
```

## Pruebas

Desde `backend/`:

```powershell
.\test.ps1                 # toda la suite; también: unit, black-box, integration, e2e
..\.venv\Scripts\python.exe -m pytest tests -q
```

La suite usa SQLite temporal y un predictor simulado; no lee `backend/.env` ni escribe en la
base de operación. La prueba marcada `postgres` necesita `SENTRIX_TEST_DATABASE_URL` y trabaja
en un esquema temporal que borra al terminar.

## Autenticación de usuarios (Clerk)

Clerk guarda contraseñas y sesiones; Neon solo guarda perfil y rol en `users`. La autorización ocurre en FastAPI.
`SENTRIX_AUTH_MODE` decide cómo entra una solicitud (rol `all` o `api`; los workers siempre usan la clave):

| Modo | Acceso |
|---|---|
| `api_key` (por defecto) | Solo `X-API-Key`, sin cambios. |
| `both` | Transición: `Authorization: Bearer` o `X-API-Key`. La clave nunca entra a `/users` ni `/auth`. |
| `clerk` | Solo sesión de usuario. |

Permisos: `admin` y `operator` consultan, registran y editan cámaras e inician o detienen análisis. Solo `admin`
elimina o cambia `enabled` de una cámara, usa `POST /predict`, invita y administra usuarios. Una cuenta inactiva recibe 403 aunque su
token siga vigente; una cuenta creada sin invitación queda inactiva.

Puesta en marcha:

1. Aplicar `migrations/2026-11-08_usuarios.sql` en la base. El backend no crea esta tabla al arrancar.
2. En Clerk, usar acceso Invite-only y crear un webhook a `/webhooks/clerk` con `user.created`, `user.updated` y `user.deleted`.
3. Definir `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `CLERK_ISSUER`, `CLERK_AUTHORIZED_PARTIES` y `CLERK_INVITATION_REDIRECT_URL`.
4. Crear la primera cuenta en el Dashboard de Clerk y, desde `backend/`: `python -m app.tools.bootstrap_admin --email persona@dominio.com`.
5. Cambiar a `both`, publicar el panel que envía el token y luego cambiar a `clerk`.
