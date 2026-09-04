"""Vision inference service: camera/video -> defect detections -> MQTT + MJPEG.

Runs the ONNX model, which is both the artifact that ships to the Jetson Nano
(`trtexec --onnx=...` builds the TensorRT engine there) and -- measured, not
assumed -- the faster option here: 61.8 img/s vs 30.4 for the CUDA .pt on this
machine. YOLOv8n at 640px is small enough that CUDA's per-call transfer and
sync overhead outweighs its compute advantage for single-frame inference.

(An earlier benchmark suggested ONNX managed only ~7 img/s. That run did a
cv2.imread per image, so it was measuring disk, not inference. Worth
remembering before optimising the wrong layer.)

HONESTY: `simulated` here reports whether the IMAGE SOURCE is synthetic, and
`source` names what is actually in front of the lens. A webcam pointed at a
laptop screen is real camera data and real inference, but it is not a mine --
the dashboard shows the `source` string so nobody can infer otherwise.

Publishes to the same bus as the sensors:  belt/<line>/vision/<camera_id>
Serves an annotated MJPEG stream for the dashboard on :8001.

Run:  .venv/Scripts/python.exe -m vision.service --source 0
      .venv/Scripts/python.exe -m vision.service --source path/to/clip.mp4 --loop
      .venv/Scripts/python.exe -m vision.service --source testset
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from .paths import DATASET, MODELS

LINE = "nmdc-line-a"
CAMERA_ID = "cam-head-01"
CONF = 0.35

# Per-class colours (BGR). Belt joint is blue, not red: a joint is a landmark,
# not a defect -- every belt has them. Damage classes are warm.
COLOURS = {
    "belt_joint": (200, 130, 40),
    "tear": (40, 40, 220),
    "hole": (40, 120, 240),
    "impact_damage": (60, 180, 240),
    "patch_repair": (120, 190, 120),
}

_frame_lock = threading.Lock()
_latest_jpeg: bytes | None = None
_state = {"fps": 0.0, "detections": [], "source": "", "simulated": False,
          "backend": "loading"}


def _annotate(frame: np.ndarray, dets: list[dict], fps: float, source: str) -> np.ndarray:
    for d in dets:
        x1, y1, x2, y2 = d["xyxy"]
        c = COLOURS.get(d["cls"], (200, 200, 200))
        cv2.rectangle(frame, (x1, y1), (x2, y2), c, 2)
        label = f"{d['cls']} {d['conf']:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 6, y1), c, -1)
        cv2.putText(frame, label, (x1 + 3, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

    h = frame.shape[0]
    cv2.rectangle(frame, (0, h - 26), (frame.shape[1], h), (28, 28, 30), -1)
    cv2.putText(frame, f"YOLOv8n {_state['backend']}  {fps:4.1f} FPS   source: {source}",
                (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1, cv2.LINE_AA)
    return frame


def _frames(source: str, loop: bool):
    """Yield frames from a webcam index, a video file, or the test image split."""
    if source == "testset":
        imgs = sorted((DATASET / "test" / "images").iterdir())
        if not imgs:
            raise SystemExit(f"no test images at {DATASET/'test'/'images'}")
        while True:
            for p in imgs:
                img = cv2.imread(str(p))
                if img is not None:
                    yield img
                    time.sleep(0.4)      # readable pace; these are stills
            if not loop:
                return
        return

    cap = cv2.VideoCapture(int(source) if source.isdigit() else source)
    if not cap.isOpened():
        raise SystemExit(f"could not open source {source!r}")
    while True:
        ok, frame = cap.read()
        if not ok:
            if loop and not source.isdigit():
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            break
        yield frame
    cap.release()


def _load_model():
    from ultralytics import YOLO

    onnx = MODELS / "belt_defect.onnx"
    if not onnx.exists():
        raise SystemExit(f"missing {onnx} -- run vision/scripts/train.py first")
    return YOLO(str(onnx), task="detect"), "ONNX Runtime"


def run(source: str, loop: bool, publish: bool) -> None:
    model, backend = _load_model()
    names = model.names

    client = None
    if publish:
        import paho.mqtt.client as mqtt
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        try:
            client.connect("localhost", 1883, 60)
            client.loop_start()
        except OSError:
            print("  ! no broker on :1883 -- running without publishing")
            client = None

    # A webcam or a video of a real belt is genuine imagery; the bundled test
    # split is real photographs too. None of it is synthetic, so simulated=False
    # -- but `source` always travels with it so the dashboard can say what it is.
    label = {"testset": "held-out test images (real belt photos)"}.get(
        source, "live camera" if source.isdigit() else f"recorded video: {Path(source).name}")
    _state["source"], _state["simulated"] = label, False
    _state["backend"] = backend
    print(f"  backend: {backend}")
    print(f"  source:  {label}")

    global _latest_jpeg
    t_prev, fps = time.time(), 0.0

    for frame in _frames(source, loop):
        res = model.predict(frame, conf=CONF, verbose=False)[0]
        h, w = frame.shape[:2]
        dets = []
        for b in res.boxes:
            x1, y1, x2, y2 = (int(v) for v in b.xyxy[0])
            dets.append({
                "cls": names[int(b.cls)],
                "conf": round(float(b.conf), 3),
                "xyxy": [x1, y1, x2, y2],
                # Fraction of frame area -- this is the severity signal the
                # fusion layer consumes, and why the taxonomy dropped
                # "Large"/"Small" size labels in favour of measurement.
                "area_frac": round(abs((x2 - x1) * (y2 - y1)) / (w * h), 5),
            })

        now = time.time()
        fps = 0.9 * fps + 0.1 / max(now - t_prev, 1e-6)
        t_prev = now
        _state["detections"] = dets

        ok, buf = cv2.imencode(".jpg", _annotate(frame, dets, fps, label),
                               [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            with _frame_lock:
                _latest_jpeg = buf.tobytes()

        if client:
            client.publish(f"belt/{LINE}/vision/{CAMERA_ID}", json.dumps({
                "sensor_id": CAMERA_ID, "kind": "vision", "t": now,
                "values": {"detections": [
                    {k: d[k] for k in ("cls", "conf", "area_frac")} for d in dets]},
                "unit": {}, "simulated": False,
                "meta": {"source": label, "fps": round(fps, 1)},
                "line": LINE, "wall_ts": now,
            }), qos=0)

    if client:
        client.loop_stop()


api = FastAPI(title="Belt vision service")


@api.get("/stream")
def stream():
    def gen():
        while True:
            with _frame_lock:
                jpg = _latest_jpeg
            if jpg:
                yield b"--f\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            time.sleep(0.04)
    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=f")


@api.get("/state")
def state():
    return _state


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="testset",
                    help="webcam index (0), video path, or 'testset'")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--port", type=int, default=8001)
    ap.add_argument("--no-publish", action="store_true")
    args = ap.parse_args()

    threading.Thread(
        target=lambda: uvicorn.run(api, host="0.0.0.0", port=args.port, log_level="warning"),
        daemon=True).start()
    print(f"  MJPEG stream: http://localhost:{args.port}/stream")
    run(args.source, args.loop, not args.no_publish)


if __name__ == "__main__":
    main()
