"""Where the heavy vision artifacts live.

They deliberately do NOT live in the repo folder. This project sits under
OneDrive, and OneDrive syncs by folder tree -- it does not read .gitignore. A
141 MB dataset and per-epoch training checkpoints would be re-uploaded
continuously, burning quota and bandwidth, and the sync layer measurably slows
training (ultralytics logged ~3 MB/s image reads, ~80 s epochs instead of ~25 s).

%LOCALAPPDATA% is never synced by OneDrive and is the conventional Windows home
for regenerable data -- and this data IS regenerable: `prepare_dataset.py`
re-downloads it from Roboflow.

Resolved from the environment rather than hardcoded so a teammate's machine
picks its own path. Override with SIH_DATA_DIR in .env to use another disk.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _default_root() -> Path:
    # LOCALAPPDATA on Windows; ~/.local/share elsewhere so this still runs on
    # the Jetson (Linux) without a special case at the call sites.
    base = os.getenv("LOCALAPPDATA") or (Path.home() / ".local" / "share")
    return Path(base) / "sih26"


DATA_ROOT = Path(os.getenv("SIH_DATA_DIR") or _default_root())

RAW = DATA_ROOT / "raw"                  # Roboflow downloads, as-fetched
DATASET = DATA_ROOT / "belt_defects"     # merged, unified taxonomy
RUNS = DATA_ROOT / "runs"                # training checkpoints (churny)
MODELS = ROOT / "vision" / "models"      # final .pt/.onnx -- small, kept in repo


if __name__ == "__main__":
    print(f"DATA_ROOT  {DATA_ROOT}")
    for name in ("RAW", "DATASET", "RUNS", "MODELS"):
        p = globals()[name]
        print(f"  {name:<8} {p}  {'[exists]' if p.exists() else '[missing]'}")
