"""El búfer del híbrido arma bloques de 16 frames como el runner de Piero."""
from app.domain.hybrid import HybridConfig
from app.domain.pipeline import HybridBuffer


def push(buffer, count, start=0, fps=30.0):
    for index in range(start, start + count):
        buffer.push(index, index / fps)


def drain(buffer):
    blocks = []
    while not buffer.queue.empty():
        blocks.append(buffer.queue.get_nowait())
        buffer.queue.task_done()
    return blocks


def test_one_block_every_16_frames_with_clip_and_videomae_frames():
    buffer = HybridBuffer(HybridConfig())
    push(buffer, 40)
    blocks = drain(buffer)
    assert [number for number, _ in blocks] == [1, 2]
    first = blocks[0][1]
    assert first["clip"] == 0                    # CLIP: primer frame del bloque
    assert first["videomae"] == [3, 7, 11, 15]   # VideoMAE: uno de cada 4, terminando en el 15
    assert first["timestamp"] == 15 / 30 and first["epoch"] == 0
    assert blocks[1][1]["clip"] == 16 and blocks[1][1]["videomae"] == [19, 23, 27, 31]
    assert len(buffer.partial) == 2              # frames 35 y 39 del bloque incompleto


def test_four_blocks_give_the_runner_span_of_61_frames():
    buffer = HybridBuffer(HybridConfig())
    push(buffer, 64)
    frames = [f for _, block in drain(buffer) for f in block["videomae"]]
    # Últimos 61 frames (3..63) tomando uno de cada 4: lo mismo que frames[i * 4] del runner.
    assert frames == list(range(3, 64, 4))


def test_time_jump_restarts_the_block_and_changes_epoch():
    buffer = HybridBuffer(HybridConfig())
    push(buffer, 10)
    push(buffer, 16, start=200)   # salto de ~6 s
    blocks = drain(buffer)
    assert len(blocks) == 1
    assert blocks[0][1]["clip"] == 200 and blocks[0][1]["epoch"] == 1


def test_full_queue_drops_the_oldest_block():
    buffer = HybridBuffer(HybridConfig(queue_size=2))
    push(buffer, 16 * 3)
    assert buffer.dropped == 1
    assert [number for number, _ in drain(buffer)] == [2, 3]


def test_invalid_timestamp_restarts():
    buffer = HybridBuffer(HybridConfig())
    push(buffer, 8)
    buffer.push(99, float("nan"))
    assert buffer.invalid_timestamps == 1 and buffer.resets == 1 and buffer.partial == []
