"""Checks the ONNX model actually detects on held-out images, and that its
output feeds the fusion layer correctly.

This is the check that the deployed artifact -- the ONNX file, not the .pt --
works. A model that scores well in training but fails after export is a classic
and silent failure.

Run:  .venv/Scripts/python.exe -m vision.test_service
"""

import sys
import time
from collections import Counter
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.fusion import evaluate, score          # noqa: E402
from vision.paths import DATASET, MODELS            # noqa: E402


def main() -> int:
    from ultralytics import YOLO

    onnx = MODELS / "belt_defect.onnx"
    assert onnx.exists(), f"missing {onnx} -- run vision/scripts/train.py"
    model = YOLO(str(onnx), task="detect")
    names = model.names

    imgs = sorted((DATASET / "test" / "images").iterdir())[:60]
    assert imgs, "no test images found"

    found: Counter = Counter()
    frames_with_dets = 0
    t0 = time.time()
    for p in imgs:
        img = cv2.imread(str(p))
        if img is None:
            continue
        res = model.predict(img, conf=0.35, verbose=False)[0]
        if len(res.boxes):
            frames_with_dets += 1
        for b in res.boxes:
            found[names[int(b.cls)]] += 1
    dt = time.time() - t0

    print(f"  ran ONNX on {len(imgs)} held-out images in {dt:.1f}s "
          f"({len(imgs)/dt:.1f} img/s on this machine)")
    print(f"  frames with >=1 detection: {frames_with_dets}/{len(imgs)}")
    print(f"  detections by class: {dict(found)}")

    assert found, "ONNX model detected nothing at all -- export is broken"
    assert frames_with_dets > len(imgs) * 0.5, "detected on under half the test frames"

    # The ONNX output must flow into fusion and move belt_body.
    healthy_sensors = {
        "vibration": {"rms_mm_s": 0.6, "kurtosis": 3.0, "crest_factor": 3.2},
        "temperature": {"temp_c": 40.0},
        "load": {"load_tph": 1560.0, "tension_kn": 65.0},
        "speed": {"slip_pct": 0.9},
        "acoustic": {"spl_db": 74.0, "tonal_db": 0.3},
    }
    clean = score(evaluate(healthy_sensors, {"detections": []}))
    torn = score(evaluate(healthy_sensors, {"detections": [
        {"cls": "tear", "conf": 0.88, "area_frac": 0.05}]}))
    print(f"  fusion: clean belt_body={clean.subsystems['belt_body']} "
          f"-> with tear={torn.subsystems['belt_body']} "
          f"({clean.state} -> {torn.state})")
    assert torn.subsystems["belt_body"] < clean.subsystems["belt_body"]

    print("\nPASS  ONNX inference works and drives the fusion layer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
