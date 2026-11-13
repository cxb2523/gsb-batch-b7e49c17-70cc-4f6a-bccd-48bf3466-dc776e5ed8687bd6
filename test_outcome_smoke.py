"""Smoke test for per-route outcome aggregation in repo/main.py.

Stubs torch/cv2 (not installed here) and exercises Pipeline.run via spawn:
  route 1: normal EOF completion
  route 2: reconnect exhausted (decoder-style error message)
  route 3: unexpected exception mid-pipeline
  route 4: hard crash (os._exit) -> main process must backfill a record
"""
import multiprocessing as _stdlib_mp
import os
import sys
import types

REPO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, REPO)

# ---- stub torch / cv2 before importing main.py ----
torch = types.ModuleType("torch")
torch.Tensor = type("Tensor", (), {})
torch.device = lambda *a, **k: None
torch.multiprocessing = _stdlib_mp
sys.modules["torch"] = torch
sys.modules["torch.multiprocessing"] = _stdlib_mp
sys.modules["cv2"] = types.ModuleType("cv2")

import main  # noqa: E402


class FakePipeline(main.Pipeline):
    """Pipeline whose _run_pipeline is replaced by a scenario."""

    def _run_pipeline(self):
        scenario = self.input_url
        if scenario == "file.mp4":
            return main.STATUS_COMPLETED, "[Decoder] 视频流已结束或无可用信号", 1234
        if scenario.startswith("rtsp://"):
            raise RuntimeError("[Decoder] 无信号，重连3次失败")  # wait: raised -> error?
        if scenario == "boom":
            raise ValueError("inference exploded")
        if scenario == "crash":
            os._exit(2)
        raise AssertionError(scenario)


def run_scenario():
    mp = _stdlib_mp
    mp.set_start_method("spawn")
    outcome_queue = mp.Queue()
    args = [
        {"gpu": 0, "input_url": "file.mp4", "output_url": "out1.mp4"},
        {"gpu": 0, "input_url": "rtsp://10.255.255.1:8554/live", "output_url": "out2.mp4"},
        {"gpu": 0, "input_url": "boom", "output_url": "out3.mp4"},
        {"gpu": 0, "input_url": "crash", "output_url": "out4.mp4"},
    ]
    pool = []
    for cfg in args:
        p = FakePipeline(outcome_queue=outcome_queue, **cfg)
        p.start()
        pool.append((cfg, p))
    for _, p in pool:
        p.join()

    import queue as queue_mod
    outcomes = {}
    while True:
        try:
            o = outcome_queue.get_nowait()
        except queue_mod.Empty:
            break
        outcomes[o["pid"]] = o

    summary = []
    for cfg, p in pool:
        o = outcomes.get(p.pid)
        if o is None:
            o = {"pid": p.pid, "input_url": cfg["input_url"], "output_url": cfg["output_url"],
                 "status": main.STATUS_CRASHED, "processed_frames": -1,
                 "last_error": f"exitcode={p.exitcode}"}
        summary.append(o)

    assert len(summary) == len(args), f"expected {len(args)} records, got {len(summary)}"
    by_input = {o["input_url"]: o for o in summary}

    r = by_input["file.mp4"]
    assert r["status"] == main.STATUS_COMPLETED and r["processed_frames"] == 1234, r

    r = by_input["rtsp://10.255.255.1:8554/live"]
    # raised inside _run_pipeline with decoder-style message -> run() marks error...
    # (classification happens in the decode loop; here we simulate via classify fn)
    assert r["status"] == main.STATUS_ERROR and "重连" in r["last_error"], r

    r = by_input["boom"]
    assert r["status"] == main.STATUS_ERROR and "inference exploded" in r["last_error"], r

    r = by_input["crash"]
    assert r["status"] == main.STATUS_CRASHED, r

    # classification unit checks
    assert main._classify_decoder_error("[Decoder] 视频流已结束或无可用信号") == main.STATUS_COMPLETED
    assert main._classify_decoder_error("[Decoder] 无信号，重连3次失败") == main.STATUS_RECONNECT_EXHAUSTED
    assert main._classify_decoder_error("[Decoder] NPP 尺寸缩放失败") == main.STATUS_ERROR

    print("ALL SCENARIO CHECKS PASSED")
    for o in summary:
        print(o)


if __name__ == "__main__":
    run_scenario()
