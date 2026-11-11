from app.domain.pipeline import PipelineConfig, WindowBuffer, VideoMAEConfig, VideoMAEBuffer


def test_full_queue_discards_the_oldest_window():
    buffer = WindowBuffer(PipelineConfig(window_size=1, queue_size=1))
    buffer.push("first", 0)
    buffer.push("second", .25)
    assert buffer.dropped == 1
    assert buffer.queue.get_nowait() == (2, [("second", .25)])
    buffer.queue.task_done()


def test_timestamp_reset_discards_partial_window():
    buffer = WindowBuffer(PipelineConfig(window_size=2))
    buffer.push("old", 1)
    buffer.push("new", 0)
    buffer.push("next", .25)
    assert buffer.resets == 1
    assert buffer.queue.get_nowait()[1] == [("new", 0), ("next", .25)]
    buffer.queue.task_done()


def test_videomae_samples_sixteen_frames_at_stride_four():
    buffer = VideoMAEBuffer(VideoMAEConfig())
    for index in range(64):
        buffer.push(index, index / 30)
    number, samples = buffer.queue.get_nowait()
    assert number == 1
    assert [sample[0] for sample in samples] == list(range(0, 61, 4))
    buffer.queue.task_done()
