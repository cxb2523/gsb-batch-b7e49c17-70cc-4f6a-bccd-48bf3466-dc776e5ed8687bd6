# Gonzo Pi Web Viewfinder — observable degradation states

The web viewfinder shows the live camera feed in a browser and makes every
link failure **visible and recoverable** instead of leaving a frozen or
blank image.

## What the operator sees

| Situation | Behavior |
|-----------|----------|
| Camera healthy | MJPEG live image, side panel shows **Live** with frame count and last-frame time. |
| Camera open fails (busy / init error) | A compact **Camera unavailable** strip over the top of the image area, the reason in the side panel, and an enabled **Retry connection** button. No placeholder picture is shown. |
| No new frame within the stall timeout | **Picture paused, waiting for camera frames…** strip and a **Paused** state. The last real frame stays on screen but is never re-timestamped; the notice clears automatically the moment a new frame arrives. |
| Camera dies mid-stream | Recorded as a runtime failure; the feed drops and the failure banner appears. Retry reopens the camera and restores the picture. |

The status panel and the picture are rendered **side by side** (stacked on
narrow screens). Notices are a slim strip pinned inside the top of the image
area — never a full-screen overlay — so the controls and the picture remain
visible at the same time.

## HTTP surface

| Method & path | Purpose |
|---------------|---------|
| `GET  /viewfinder` | Viewfinder page (image + status panel). Auto-starts the camera on first visit. |
| `GET  /viewfinder/feed` | `multipart/x-mixed-replace` MJPEG stream of real frames. Returns **503 JSON** (never a fake image) when the camera has failed. |
| `GET  /viewfinder/status` | JSON snapshot: `state`, `stalled`, `frame_seq`, `last_frame_at`, `last_error {code,message,at}`, resolution/fps/stall timeout. |
| `POST /viewfinder/retry` | Explicitly reopens the camera and returns the fresh status snapshot. |

Only genuine backend frames advance `frame_seq` / `last_frame_at`. The feed
generator waits on a condition variable and never re-emits an old frame, so
a stalled camera cannot masquerade as a live one.

## Configuration (environment variables)

| Variable | Default | Meaning |
|----------|---------|---------|
| `GONZO_VF_BACKEND` | `fake` | `fake` (software camera, no hardware) or `picamera` (real Raspberry Pi camera via picamerax). |
| `GONZO_VF_RESOLUTION` | `640x480` | Viewfinder capture resolution. The existing filming resolution/framerate in `gonzopi.py` is untouched; these settings only configure this preview stream. |
| `GONZO_VF_FPS` | `24` | Target viewfinder frame rate. |
| `GONZO_VF_STALL_TIMEOUT` | `3` | Seconds without a new frame before the page shows the paused/waiting state. |
| `GONZO_VF_FAIL_MODE` | `none` | Fake-backend failure injection: `none`, `busy`, `init`, `stall`, or `runtime:<n>`. |
| `GONZO_VF_FAIL_AFTER` | `5` | Frame count for `runtime:<n>` when `n` is omitted. |
| `GONZO_VF_PORT` | `8080` | Port for the standalone runner. |

## Running locally (no hardware needed)

From the `srv/` directory:

```bash
# Healthy software camera
GONZO_VF_BACKEND=fake python -m viewfinder.webapp
# then open http://localhost:8080/viewfinder

# Camera already in use -> failure banner + Retry
GONZO_VF_BACKEND=fake GONZO_VF_FAIL_MODE=busy python -m viewfinder.webapp

# Camera opens but never delivers frames -> paused/waiting state
GONZO_VF_BACKEND=fake GONZO_VF_FAIL_MODE=stall python -m viewfinder.webapp

# Camera dies after a few frames -> runtime failure
GONZO_VF_BACKEND=fake GONZO_VF_FAIL_MODE=runtime:5 python -m viewfinder.webapp
```

On a real device set `GONZO_VF_BACKEND=picamera`; the same state machine,
endpoints and page apply unchanged.

## Acceptance tests

The suite is fully offline and drives the real web.py WSGI stack over HTTP
with the fake backend (busy/init/stall/runtime injection):

```bash
cd srv
python -I -m unittest discover -s . -p "test_*.py" -v
```

It covers, among other things:

* device-busy and init failures record a structured reason and never emit a frame;
* a failed feed answers 503 with JSON rather than an invented image;
* `POST /viewfinder/retry` recovers the stream and serves real JPEG parts again;
* a stall freezes `frame_seq`/`last_frame_at`, reports `stalled: true`, and
  clears automatically on the next new frame;
* the feed's multipart parts contain real JPEG SOI markers and correct boundaries;
* the page renders the image and status panel together with no full-screen mask.

## Integration with the main control server

`gonzopiserver.py` imports the four handlers and registers the
`/viewfinder...` routes alongside the existing control/film routes, so the
feature is served through the same Apache/mod_wsgi virtual host. The
intro page links to `/viewfinder`.
