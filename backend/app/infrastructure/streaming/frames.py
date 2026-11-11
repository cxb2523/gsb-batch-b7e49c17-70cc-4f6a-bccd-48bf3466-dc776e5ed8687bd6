"""Convert PyAV frames to normalized RGB windows."""
def prepare_frames(frames, config):
    """RGB normalizado THWC. Respeta padding de filas de PyAV; no necesita NumPy."""
    output = []
    for frame in frames:
        rgb = frame.reformat(width=config.width, height=config.height, format="rgb24")
        plane = rgb.planes[0]
        raw = bytes(plane)
        output.append([
            [[raw[y * plane.line_size + x * 3 + c] / 255.0 for c in range(3)]
             for x in range(config.width)] for y in range(config.height)
        ])
    return output
