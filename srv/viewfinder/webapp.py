"""web.py handlers for the Gonzo Pi web viewfinder.

Routes (registered both by the standalone runner below and by the main
``gonzopiserver`` application):

``GET  /viewfinder``          viewfinder page (status bar + live image)
``GET  /viewfinder/feed``     multipart/x-mixed-replace MJPEG stream
``GET  /viewfinder/status``   JSON snapshot of the service state
``POST /viewfinder/retry``    re-open the camera, returns the status snapshot

The feed only ever emits real camera JPEG frames.  When the camera has
failed it answers HTTP 503 with the recorded reason instead of inventing a
placeholder image, and a stalled camera simply stops delivering new parts
(the page notices via the status endpoint and shows "paused/waiting").
"""

import json
import os
import time

import web

from .service import (
    BOUNDARY,
    STATE_FAILED,
    STATE_STOPPED,
    get_service,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')

render = web.template.render(TEMPLATE_DIR)

urls = (
    '/viewfinder/retry/?', 'viewfinder_retry',
    '/viewfinder/status/?', 'viewfinder_status',
    '/viewfinder/feed/?', 'viewfinder_feed',
    '/viewfinder/?', 'viewfinder_page',
)


class viewfinder_page:
    def GET(self):
        service = get_service()
        service.ensure_running()
        status = service.snapshot()
        return render.viewfinder(status)


class viewfinder_status:
    def GET(self):
        service = get_service()
        # Status polling must not (re)start a failed camera by itself;
        # only the page's initial load / retry button do that.
        web.header('Content-Type', 'application/json')
        return json.dumps(service.snapshot())


class viewfinder_retry:
    def POST(self):
        service = get_service()
        service.start()
        web.header('Content-Type', 'application/json')
        return json.dumps(service.snapshot())


class viewfinder_feed:
    def GET(self):
        service = get_service()
        service.ensure_running()
        # Let the camera-open thread settle so a busy / init failure is
        # answered with a clean 503 rather than an empty multipart stream.
        state = service.wait_until_settled(timeout=3.0)
        if state in (STATE_FAILED, STATE_STOPPED):
            # No fake picture: tell the client the camera is unavailable.
            web.ctx.status = '503 Service Unavailable'
            web.header('Content-Type', 'application/json')
            return json.dumps(service.snapshot())

        web.header('Content-Type',
                   'multipart/x-mixed-replace; boundary=gonzovf')
        web.header('Cache-Control',
                   'no-store, no-cache, must-revalidate, max-age=0')
        web.header('Pragma', 'no-cache')
        return _feed_generator(service)


def _feed_generator(service):
    """Yield one multipart part per genuinely new frame.

    Old frames are never re-emitted: the generator waits on the service
    condition and advances only when the frame sequence changes.  If the
    camera fails mid-stream the generator ends the response so the browser
    drops the image and the page's status poll shows the failure banner.
    """
    last_seq = 0
    while True:
        frame, seq = service.wait_for_frame(last_seq, timeout=10.0)
        state = service.snapshot()['state']
        if state in (STATE_FAILED, STATE_STOPPED):
            return
        if frame is None:
            # Stall or slow startup: just keep the connection open. The
            # client detects the stall through /viewfinder/status.
            continue
        last_seq = seq
        part = (
            BOUNDARY + b'\r\n'
            b'Content-Type: image/jpeg\r\n'
            b'Content-Length: ' + str(len(frame)).encode('ascii')
            + b'\r\n\r\n'
        )
        yield part
        yield frame
        yield b'\r\n'


# --------------------------------------------------------------------------
# Standalone runner - useful for local development / acceptance tests
# without Apache:
#
#   python -m viewfinder.webapp
#
# Failure injection examples:
#   GONZO_VF_BACKEND=fake GONZO_VF_FAIL_MODE=busy python -m viewfinder.webapp
#   GONZO_VF_BACKEND=fake GONZO_VF_FAIL_MODE=stall python -m viewfinder.webapp
# --------------------------------------------------------------------------

def make_app():
    # The reloader tries to import handlers as top-level modules, which
    # fails when this code runs inside a package (or under mod_wsgi); the
    # main control server disables it for the same reason.
    web.config.debug = False
    app = web.application(urls, globals())
    return app


if __name__ == '__main__':
    port = int(os.environ.get('GONZO_VF_PORT', '8080'))
    app = make_app()
    # web.py's application.run() ignores a port argument; bind explicitly.
    func = app.wsgifunc()
    web.httpserver.runsimple(func, ('0.0.0.0', port))
