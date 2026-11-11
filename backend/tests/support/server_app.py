"""Uvicorn factory for E2E: real API/SQL/pipeline with controlled video and model.

No remote camera is contacted and no ONNX/GPU runtime is loaded.
"""
import asyncio
import os
from fractions import Fraction

import av

from app.bootstrap import create_app
from app.domain.inference import Prediction


class ScenarioPredictor:
    def predict(self, window):
        crime = window.timestamp <= .5
        return Prediction(clase="Hurto" if crime else "Normal", confianza=.95,
                          timestamp=window.timestamp, simulated=True)


def create_test_app():
    app = create_app(predictor=ScenarioPredictor(), transport="rtsp")
    receiver = app.state.video_receiver

    async def controlled_video(session):
        count = 2 if os.environ.get("SENTRIX_TEST_SCENARIO") == "open" else 5
        session.rtsp_status = "receiving"
        await receiver.log_event("source_connected", "Video de pruebas conectado", session=session)
        for number in range(1, count + 1):
            frame = av.VideoFrame(width=2, height=2, format="rgb24")
            for plane in frame.planes:
                plane.update(bytes(plane.buffer_size))
            frame.pts, frame.time_base = number, Fraction(1, 4)
            receiver._accept_rtsp_frame(session, frame, 0)
            await asyncio.wait_for(session.buffer.queue.join(), timeout=5)
        await asyncio.Event().wait()

    receiver._read_loop = controlled_video
    return app
