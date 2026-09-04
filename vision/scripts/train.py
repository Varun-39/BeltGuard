"""Train YOLOv8n on the merged belt-defect dataset and export ONNX.

ONNX is not decoration: it is the exact handoff path to the Jetson Nano.
On-device you run `trtexec --onnx=belt_defect.onnx` to build a TensorRT engine.
Nothing else in the pipeline changes -- the inference wrapper takes either.

Run:  .venv/Scripts/python.exe vision/scripts/train.py [--epochs N]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "vision" / "data" / "belt_defects" / "data.yaml"
MODELS = ROOT / "vision" / "models"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=120)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    args = ap.parse_args()

    if not torch.cuda.is_available():
        raise SystemExit("CUDA unavailable -- refusing to start a multi-hour CPU run")
    MODELS.mkdir(parents=True, exist_ok=True)

    model = YOLO("yolov8n.pt")
    model.train(
        data=str(DATA),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=0,
        project=str(ROOT / "vision" / "runs"),
        name="belt_defect",
        exist_ok=True,
        patience=30,
        seed=26008,
        # Belt defects are thin, low-contrast marks on dark rubber under mixed
        # site lighting. Push photometric aug hard; keep geometric aug modest
        # because a splice's horizontal-band shape is part of its identity.
        hsv_v=0.5,
        hsv_s=0.6,
        degrees=7.0,
        scale=0.45,
        fliplr=0.5,
        flipud=0.0,      # belts are not seen upside down
        mosaic=1.0,
        close_mosaic=15,
    )

    # Per-class metrics on the held-out TEST split -- overall mAP is misleading
    # here because `tear` outnumbers `belt_joint` roughly 18:1.
    m = model.val(data=str(DATA), split="test", device=0)
    names = m.names
    print("\n  per-class on test split:")
    print(f"    {'class':<15} {'P':>6} {'R':>6} {'mAP50':>7}")
    for i, c in enumerate(m.ap_class_index):
        p, r, ap50 = m.box.p[i], m.box.r[i], m.box.ap50[i]
        print(f"    {names[c]:<15} {p:>6.3f} {r:>6.3f} {ap50:>7.3f}")
    print(f"\n  overall mAP50 {m.box.map50:.3f} | mAP50-95 {m.box.map:.3f}")

    best = Path(model.trainer.best)
    onnx = YOLO(str(best)).export(format="onnx", imgsz=args.imgsz, opset=12, simplify=True)
    for src, dst in ((best, "belt_defect.pt"), (Path(onnx), "belt_defect.onnx")):
        (MODELS / dst).write_bytes(src.read_bytes())
    print(f"\n  exported -> {MODELS/'belt_defect.pt'}\n             {MODELS/'belt_defect.onnx'}")


if __name__ == "__main__":
    main()
