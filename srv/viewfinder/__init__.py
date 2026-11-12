"""Gonzo Pi web viewfinder with observable degradation states.

Public entry points:

* :class:`~viewfinder.service.ViewfinderService` - camera frame producer that
  keeps the latest JPEG frame plus an explicit state machine
  (``starting`` / ``running`` / ``failed`` / ``stopped``) and the latest
  failure reason.
* :mod:`viewfinder.webapp` - web.py handlers (MJPEG feed, status JSON,
  retry endpoint and the viewfinder page) that can run standalone or be
  imported by the main ``gonzopiserver`` application.
"""

from .service import (
    ViewfinderService,
    ViewfinderError,
    CameraBusyError,
    CameraInitError,
    CameraRuntimeError,
    FakeBackend,
    PicameraBackend,
    get_service,
    reset_service,
)

__all__ = [
    'ViewfinderService',
    'ViewfinderError',
    'CameraBusyError',
    'CameraInitError',
    'CameraRuntimeError',
    'FakeBackend',
    'PicameraBackend',
    'get_service',
    'reset_service',
]
