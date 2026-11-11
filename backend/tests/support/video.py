"""Video H.264 sintético para probar clips sin cámara ni MediaMTX."""
from fractions import Fraction

import av
import numpy as np


def make_h264(path, seconds=10, fps=30, gop=30, size=(160, 120)):
    width, height = size
    with av.open(str(path), "w") as output:
        stream = output.add_stream("libx264", rate=fps, options={"g": str(gop), "preset": "ultrafast",
                                                                 "bf": "0"})
        stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
        for index in range(seconds * fps):
            frame = av.VideoFrame.from_ndarray(np.full((height, width, 3), index % 255, np.uint8), format="rgb24")
            frame.pts, frame.time_base = index, Fraction(1, fps)
            for packet in stream.encode(frame):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)
    return path


def packets(path):
    """Abre el video y entrega (stream, iterador de paquetes), como el lector RTSP."""
    container = av.open(str(path))
    video = container.streams.video[0]
    return container, video, (packet for packet in container.demux(video) if packet.size)


def duration(path):
    with av.open(str(path)) as container:
        frames = sum(1 for _ in container.decode(video=0))
        return frames, (container.duration / av.time_base if container.duration else None)
