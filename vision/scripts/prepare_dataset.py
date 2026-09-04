"""Download and merge the two usable conveyor-belt defect datasets into one
YOLO detection dataset under a single 5-class taxonomy.

Why this script exists (see context.md S7):
  * `sample-wy2mp` (922 imgs) is INSTANCE SEGMENTATION and has no belt-joint class.
  * `test-yfiry`   (325 imgs) is BOUNDING BOX and is the only source anywhere
    with an explicit `Belt Joint` class -- the headline class for PS 26008.
  We therefore train DETECTION and convert the segmentation polygons down to
  boxes. Polygons convert down cleanly; boxes cannot convert up.

Classes are mapped BY NAME, never by index -- Roboflow does not guarantee index
order across projects, and a silent index mismatch would poison the labels in a
way that still trains happily and scores nonsense.

Run:  .venv/Scripts/python.exe vision/scripts/prepare_dataset.py
"""

from __future__ import annotations

import os
import shutil
import sys
from collections import Counter
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from vision.paths import RAW, DATASET as OUT  # noqa: E402  (needs ROOT on path)

# The unified taxonomy. Size ("Large"/"Small") is deliberately NOT a label --
# severity is derived from measured box area, not a labeller's subjective call.
CLASSES = ["belt_joint", "tear", "hole", "impact_damage", "patch_repair"]

# Source class name -> unified class. Anything absent here is dropped.
CLASS_MAP = {
    # test-yfiry (detection)
    "belt joint": "belt_joint",
    "large tear": "tear",
    "small tear": "tear",
    "large hole": "hole",
    "small hole": "hole",
    # sample-wy2mp (segmentation)
    "tear": "tear",
    "hole": "hole",
    "puncture": "hole",          # a puncture is a hole; same repair response
    "impact damage": "impact_damage",
    "patch work": "patch_repair",
    # explicitly dropped, listed so the intent is visible rather than implied:
    # "human", "roller", "conveyor", "other objects" -> not belt defects
}

SOURCES = [
    ("sample-wy2mp", "conveyor-belt-damage", 1),
    ("test-yfiry", "conveyor-belt-damage-ucjlj", 1),
]

# Cap on label-free images kept per split. A few negatives cut false positives
# on the live webcam demo (a desk should not read as "tear"); too many skew it.
BACKGROUND_CAP = 0.10


def download() -> list[Path]:
    from roboflow import Roboflow

    load_dotenv(ROOT / ".env")
    key = os.getenv("ROBOFLOW_API_KEY")
    if not key:
        sys.exit("ROBOFLOW_API_KEY missing from .env")

    RAW.mkdir(parents=True, exist_ok=True)
    rf = Roboflow(api_key=key)
    paths = []
    for ws, proj, ver in SOURCES:
        dest = RAW / proj
        if dest.exists():
            print(f"  [cached] {proj}")
        else:
            print(f"  [downloading] {ws}/{proj} v{ver}")
            rf.workspace(ws).project(proj).version(ver).download(
                "yolov8", location=str(dest)
            )
        paths.append(dest)
    return paths


def polygon_to_box(coords: list[float]) -> tuple[float, float, float, float]:
    """Normalised polygon points -> normalised YOLO cx,cy,w,h."""
    xs, ys = coords[0::2], coords[1::2]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0


def convert_label(line: str, names: list[str]) -> str | None:
    """One source label line -> one unified label line, or None if dropped."""
    parts = line.split()
    if len(parts) < 5:
        return None
    src_name = names[int(parts[0])].strip().lower()
    target = CLASS_MAP.get(src_name)
    if target is None:
        return None

    vals = [float(v) for v in parts[1:]]
    cx, cy, w, h = polygon_to_box(vals) if len(vals) > 4 else vals[:4]

    # Clamp to frame; Roboflow polygons occasionally sit a hair outside.
    cx, cy = min(max(cx, 0.0), 1.0), min(max(cy, 0.0), 1.0)
    w, h = min(w, 1.0), min(h, 1.0)
    if w <= 1e-4 or h <= 1e-4:
        return None
    return f"{CLASSES.index(target)} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def merge(src_dirs: list[Path]) -> Counter:
    if OUT.exists():
        shutil.rmtree(OUT)
    counts: Counter = Counter()

    for split in ("train", "valid", "test"):
        (OUT / split / "images").mkdir(parents=True, exist_ok=True)
        (OUT / split / "labels").mkdir(parents=True, exist_ok=True)

    for src in src_dirs:
        names = yaml.safe_load((src / "data.yaml").read_text())["names"]
        tag = src.name[:12]
        print(f"\n  {src.name}: source classes = {names}")

        for split in ("train", "valid", "test"):
            img_dir, lbl_dir = src / split / "images", src / split / "labels"
            if not img_dir.exists():
                continue
            kept_bg = 0
            imgs = sorted(img_dir.iterdir())
            bg_budget = int(len(imgs) * BACKGROUND_CAP)

            for img in imgs:
                lbl = lbl_dir / f"{img.stem}.txt"
                lines = []
                if lbl.exists():
                    for ln in lbl.read_text().splitlines():
                        out = convert_label(ln, names)
                        if out:
                            lines.append(out)
                            counts[CLASSES[int(out.split()[0])]] += 1

                if not lines:
                    if kept_bg >= bg_budget:
                        continue
                    kept_bg += 1
                    counts["_background"] += 1

                # Prefix guards against filename collisions between datasets.
                stem = f"{tag}_{img.stem}"
                shutil.copy2(img, OUT / split / "images" / f"{stem}{img.suffix}")
                (OUT / split / "labels" / f"{stem}.txt").write_text("\n".join(lines))

    (OUT / "data.yaml").write_text(
        yaml.safe_dump(
            {
                "path": str(OUT).replace("\\", "/"),
                "train": "train/images",
                "val": "valid/images",
                "test": "test/images",
                "names": {i: n for i, n in enumerate(CLASSES)},
            },
            sort_keys=False,
        )
    )
    return counts


if __name__ == "__main__":
    print("Downloading sources...")
    dirs = download()
    print("\nMerging into unified taxonomy...")
    counts = merge(dirs)

    print(f"\nWrote {OUT}")
    print("\n  instances per unified class:")
    for c in CLASSES:
        bar = "#" * min(50, counts[c] // 20)
        print(f"    {c:<15} {counts[c]:>5}  {bar}")
    print(f"    {'(background)':<15} {counts['_background']:>5}")

    n_train = len(list((OUT / "train" / "images").iterdir()))
    n_val = len(list((OUT / "valid" / "images").iterdir()))
    n_test = len(list((OUT / "test" / "images").iterdir()))
    print(f"\n  images: train {n_train} | val {n_val} | test {n_test}")

    if counts["belt_joint"] < 100:
        print(
            f"\n  WARNING: belt_joint has only {counts['belt_joint']} instances."
            "\n  This is the headline class for PS 26008 and it is the rarest."
            "\n  Judge overall mAP with suspicion; read per-class recall instead."
        )
