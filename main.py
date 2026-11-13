import json
import os
import queue
import time
import traceback

import cv2
import torch
import torch.multiprocessing as mp

# 逐路运行结局状态
STATUS_COMPLETED = "completed"  # 正常读完（点播文件读到末尾）
STATUS_RECONNECT_EXHAUSTED = "reconnect_exhausted"  # 断流后重连次数耗尽
STATUS_ERROR = "error"  # 其他异常（解码/推理/编码等）
STATUS_CRASHED = "crashed"  # 子进程未上报结局即退出（由主进程补记）

_STATUS_LABELS = {
    STATUS_COMPLETED: "正常读完",
    STATUS_RECONNECT_EXHAUSTED: "重连耗尽",
    STATUS_ERROR: "异常",
    STATUS_CRASHED: "进程崩溃",
}


def _classify_decoder_error(msg):
    """根据 Decoder 抛出的错误信息归类结束原因。"""
    if "视频流已结束" in msg:
        return STATUS_COMPLETED
    if "重连" in msg or "无信号" in msg:
        return STATUS_RECONNECT_EXHAUSTED
    return STATUS_ERROR


class Pipeline(mp.Process):
    def __init__(self, gpu, input_url, output_url, outcome_queue=None):
        super().__init__()
        self.gpu = gpu
        self.input_url = input_url
        self.output_url = output_url
        # 主进程传入的队列，用于回传本路运行结局
        self._outcome_queue = outcome_queue

        os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu)

    def run(self):
        status = STATUS_ERROR
        last_error = ""
        processed_frames = 0
        started_at = time.time()
        try:
            status, last_error, processed_frames = self._run_pipeline()
        except Exception as e:
            # 解码循环之外（模型加载、推理、编码等）的异常也须落成结局记录
            status = STATUS_ERROR
            last_error = f"{type(e).__name__}: {e}"
            traceback.print_exc()
        finally:
            outcome = {
                "pid": os.getpid(),
                "gpu": self.gpu,
                "input_url": self.input_url,
                "output_url": self.output_url,
                "status": status,
                "processed_frames": processed_frames,
                "last_error": last_error,
                "duration_sec": round(time.time() - started_at, 3),
            }
            if self._outcome_queue is not None:
                try:
                    self._outcome_queue.put(outcome)
                except Exception:
                    pass
            print(f"[Pipeline] 结局: {json.dumps(outcome, ensure_ascii=False)}")

    def _run_pipeline(self):

        import osd
        from yolo26.det import YOLO26DetTRT
        from cpp import Decoder, Encoder
        from bytetrack.fast_byte_tracker import FastByteTracker

        model_det = YOLO26DetTRT(
            engine_path="./yolo26n.engine",
            conf_thres=0.25,
            device=torch.device("cuda:0"),
        )

        # 串联更多模型做进一步推理 cls / sem / pose
        # from yolo26 import YOLO26ClsTRT, YOLO26SemTRT, YOLO26PoseTRT
        # model_cls = YOLO26ClsTRT(engine_path="./yolo26n-cls.engine", device=torch.device("cuda:0"))
        # model_sem = YOLO26SemTRT(engine_path="./yolo26n-sem.engine", device=torch.device("cuda:0"))
        # model_pose = YOLO26PoseTRT(engine_path="./yolo26n-pose.engine", device=torch.device("cuda:0"))

        # 解码
        decoder_cfg = dict(
            enable_frame_skip=False,  # 是否跳帧
            output_width=model_det.w,  # 解码输出宽度（需与检测引擎输入一致）
            output_height=model_det.h,  # 解码输出高度（需与检测引擎输入一致）
            enable_auto_reconnect=True,  # 是否启用自动重连
            reconnect_delay_ms=2000,  # 重连间隔（毫秒）
            max_reconnects=5,  # 单次重连最大尝试次数，超过后抛出异常结束当前 Pipeline
            open_timeout_ms=5000,  # 打开流超时（毫秒）
            read_timeout_ms=5000,  # 读取数据包超时（毫秒）
            buffer_size=4 * 1024 * 1024,  # 4MB 缓冲区，用于抖动容忍
            max_delay_ms=200,  # 允许的最大解码延迟（毫秒）
            reorder_queue_size=4,  # B 帧重排队列长度
            decoder_threads=1,  # 解码线程数
            surfaces=3,  # 用于缓冲的 CUDA surface 数量
        )
        decoder = Decoder(self.input_url, **decoder_cfg)
        input_fps = decoder.get_fps()  # 输入资源（容器/流）原始帧率
        process_fps = input_fps / 2 if decoder_cfg["enable_frame_skip"] else input_fps

        # 编码
        encoder = Encoder(
            output_url=self.output_url,  # 输出 URL 或文件路径
            width=model_det.w,  # 编码输出宽度
            height=model_det.h,  # 编码输出高度
            codec="libx264",  # 编码使用的视频编码器
            bitrate=1000000,  # 编码目标码率（bps）
            fps=process_fps,  # 实际处理帧率，用于编码器码率控制
        )
        
        # ByteTrack 跟踪器（输入 Nx6: x1,y1,x2,y2,score,cls，输出 Nx7 末尾追加 track_id）
        tracker = FastByteTracker(
            frame_rate=process_fps,  # 跟踪器按实际处理帧率计算丢失容忍时长
            track_thresh=0.5,
            track_buffer=30,
            match_thresh=0.8,
        )

        frame_count = 0
        processed_frames = 0  # 本路累计已处理帧数（不随统计日志清零）
        status = STATUS_ERROR
        last_error = ""
        sum_wait = 0
        sum_det = 0
        sum_track = 0
        sum_encode = 0
        sum_event = 0

        while 1:
            t0 = time.time()

            # 读取下一帧解码结果；pts 为显示时间戳
            try:
                frame, pts = decoder.next_frame()
            except Exception as e:
                # Decoder 内部重连已耗尽（流断）或点播文件读完，直接收尾
                print(f"[Pipeline] {self.input_url} 读取结束: {e}")
                last_error = str(e)
                status = _classify_decoder_error(last_error)
                break

            if frame is None or (isinstance(frame, torch.Tensor) and frame.numel() == 0):
                # 解码器在连续坏帧且重连恢复失败后返回空帧
                last_error = "解码器返回空帧（连续坏帧且重连恢复失败）"
                status = STATUS_RECONNECT_EXHAUSTED
                print(f"[Pipeline] {self.input_url} 读取结束: {last_error}")
                break

            frame_count += 1
            processed_frames += 1

            t1 = time.time()

            # 推理检测框（返回 Nx6: x1,y1,x2,y2,score,cls）
            det_results = model_det(frame)

            t2 = time.time()

            det_results = det_results.cpu().numpy()  # (N, 6): x1,y1,x2,y2,score,cls
            tracker_results = tracker.update(det_results)  # (M, 7): 末尾追加 track_id

            t3 = time.time()

            annotated_frame = frame.cpu().numpy()

            for x1, y1, x2, y2, score, cls_id, track_id in tracker_results:
                osd.draw_bbox(
                    annotated_frame,
                    (int(x1), int(y1)),
                    (int(x2), int(y2)),
                    color=(64, 64, 255),
                    label=f"#{int(track_id)} {int(cls_id)}",
                )

            annotated_frame = torch.from_numpy(annotated_frame)
            encoder.encode(annotated_frame, pts)

            t4 = time.time()

            # 业务逻辑
            # Person(tracker_results)
            # Vehicle(tracker_results)

            t5 = time.time()

            sum_wait += t1 - t0
            sum_det += t2 - t1
            sum_track += t3 - t2
            sum_encode += t4 - t3
            sum_event += t5 - t4

            if frame_count == 1000:
                print(
                    f"[{time.strftime('%m/%d/%Y-%H:%M:%S', time.localtime())}] {self.input_url}, "
                    f"Det: {sum_det:.2f}ms, "
                    f"Track: {sum_track:.2f}ms, "
                    f"Encode: {sum_encode:.2f}ms, "
                    f"Event: {sum_event:.2f}ms, "
                    f"Wait: {sum_wait:.2f}ms "
                )
                frame_count = 0
                sum_det = 0
                sum_track = 0
                sum_encode = 0
                sum_event = 0
                sum_wait = 0

        # 收尾：冲刷编码器缓冲并写入文件尾，否则输出文件不完整
        encoder.finish()

        return status, last_error, processed_frames


if __name__ == "__main__":
    # 你可以将该列表移到独立的 YAML 文件中，并通过 PyYAML 等方式加载。
    # 示例：
    #   import yaml
    #   with open("streams.yaml", "r", encoding="utf-8") as f:
    #       args = yaml.safe_load(f)
    # args = [
    #     {
    #         "gpu": 0,
    #         "input_url": "rtsp://127.0.0.1:8554/live/input",
    #         "output_url": "rtmp://127.0.0.1:1935/live/out",
    #     },
    #     {
    #         "gpu": 0,
    #         "input_url": "rtsp://127.0.0.1:8554/live/input",
    #         "output_url": "output_annotated.mp4",
    #     },
    #     {
    #         "gpu": 0,
    #         "input_url": "input.mp4",
    #         "output_url": "output_annotated.mp4",
    #     },
    #     {
    #         "gpu": 0,
    #         "input_url": "input.mp4",
    #         "output_url": "rtmp://127.0.0.1:1935/live/out",
    #     },
    # ]
    args = [
        {
            "gpu": 0,
            "input_url": "MOT17-08-SDP-raw.mp4",
            "output_url": "output_annotated.mp4",
        },
    ]

    # 使用 'spawn' 启动方式可避免 CUDA 上下文继承问题，
    # 确保每个子进程独立初始化 CUDA。
    # 配合 NVIDIA MPS（多进程服务）时，spawn 模式可让
    # 多个进程共享同一块 GPU 的计算资源，提升并发效率。
    mp.set_start_method("spawn")
    process_pool = []
    # 子进程通过该队列回传逐路结局，主进程在 join 后统一汇总
    outcome_queue = mp.Queue()

    for i in args:
        p = Pipeline(outcome_queue=outcome_queue, **i)
        p.start()
        process_pool.append((i, p))

        time.sleep(3)  # 避免同时建立大量 RTSP 连接冲垮网络

    for _, p in process_pool:
        p.join()

    # 汇总各路结局：以子进程 pid 关联，缺记录的（如崩溃）按 exitcode 补记
    outcomes = {}
    while True:
        try:
            o = outcome_queue.get_nowait()
        except queue.Empty:
            break
        outcomes[o["pid"]] = o

    summary = []
    for cfg, p in process_pool:
        o = outcomes.get(p.pid)
        if o is None:
            o = {
                "pid": p.pid,
                "gpu": cfg["gpu"],
                "input_url": cfg["input_url"],
                "output_url": cfg["output_url"],
                "status": STATUS_CRASHED,
                "processed_frames": -1,
                "last_error": f"子进程未上报结局即退出, exitcode={p.exitcode}",
                "duration_sec": None,
            }
        summary.append(o)

    print("\n========== Pipeline 运行结局汇总 ==========")
    for o in summary:
        frames = o["processed_frames"] if o["processed_frames"] >= 0 else "-"
        label = _STATUS_LABELS.get(o["status"], o["status"])
        print(
            f"  input={o['input_url']}  output={o['output_url']}  "
            f"状态={label}({o['status']})  已处理帧数={frames}  "
            f"最后错误={o['last_error'] or '无'}"
        )
    ok = sum(1 for o in summary if o["status"] == STATUS_COMPLETED)
    print(f"  合计: 启动 {len(process_pool)} 路, 汇总 {len(summary)} 条, 正常读完 {ok} 路, 异常 {len(summary) - ok} 路")
    print("  明细(JSON): " + json.dumps(summary, ensure_ascii=False))
