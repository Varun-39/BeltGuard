"""Sensor fusion and health scoring.

WHY RULE-BASED AND NOT A NEURAL NET:

A judge (or a plant maintenance engineer) will ask "why did it say critical?".
A model that answers "0.87" is worthless in a maintenance workflow -- nobody
stops a 2000 t/h ore line on an unexplained number. Every rule here therefore
emits an `Evidence` object naming the indicator, its measured value, the
threshold it crossed, and the standard the threshold comes from. The dashboard
renders those reasons directly.

The ML layer (anomaly detection / RUL on the CWRU + NASA IMS bearing data) sits
ALONGSIDE this, not instead of it -- it catches degradation patterns no
threshold anticipates, while this stays the explainable backbone.

Thresholds are sourced, not invented:
  * Vibration RMS bands -- ISO 10816-3, Class II medium machines.
  * Kurtosis -- gaussian baseline 3.0; >6 incipient, >10 advanced bearing
    damage is the standard rolling-element rule of thumb.
  * Bearing housing temperature -- grease-lubricated limits; 70 C alarm,
    85 C trip is typical conveyor idler practice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict, field

# Subsystems we score independently, so a healthy belt body cannot mask a
# failing joint by averaging it away.
SUBSYSTEMS = ("joint", "bearing", "alignment", "belt_body")


@dataclass(frozen=True)
class Evidence:
    subsystem: str
    indicator: str
    value: float
    severity: float          # 0.0 fine .. 1.0 as bad as this rule can say
    message: str
    basis: str               # the standard or rule the threshold comes from

    def to_dict(self) -> dict:
        return asdict(self)


def _ramp(x: float, lo: float, hi: float) -> float:
    """0 below `lo`, 1 above `hi`, linear between. Keeps severity continuous.

    CALIBRATION NOTE -- `hi` is the PHYSICAL WORST CASE for the indicator, not
    the alarm level. Setting `hi` at the alarm level (the first version of this
    file did) pins severity to 1.0 the instant a channel alarms, so the score
    saturates and every later stage of a failure looks identical. Where the
    alarm sits is the job of the NORMAL/WARNING/CRITICAL bands in `score()`.
    These bounds are the ones a real installation would re-tune per site.

    Continuity matters: a step function makes the health score jump, which
    looks broken on a live dashboard and destroys any trend-based prediction.
    """
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def evaluate(latest: dict[str, dict], vision: dict | None = None) -> list[Evidence]:
    """Turn the newest reading of each sensor kind into a list of Evidence.

    `latest` maps sensor kind -> that sensor's `values` dict.
    `vision` is the optional newest detection summary from the camera.
    """
    ev: list[Evidence] = []
    vib = latest.get("vibration", {})
    tmp = latest.get("temperature", {})
    load = latest.get("load", {})
    spd = latest.get("speed", {})
    acu = latest.get("acoustic", {})

    # -- bearing ----------------------------------------------------------
    if "kurtosis" in vib:
        k = vib["kurtosis"]
        ev.append(Evidence(
            "bearing", "vibration_kurtosis", k, _ramp(k, 5.0, 22.0),
            f"Impulsiveness {k:.1f} (gaussian baseline 3.0)",
            "rolling-element bearing rule: >6 incipient, >10 advanced spalling"))
    if "rms_mm_s" in vib:
        r = vib["rms_mm_s"]
        ev.append(Evidence(
            "bearing", "vibration_rms", r, _ramp(r, 2.8, 18.0),
            f"Overall vibration {r:.2f} mm/s RMS",
            "ISO 10816-3 Class II: 2.8 good/acceptable, 7.1 unsatisfactory"))
    if "temp_c" in tmp:
        t = tmp["temp_c"]
        ev.append(Evidence(
            "bearing", "housing_temp", t, _ramp(t, 55.0, 100.0),
            f"Bearing housing {t:.1f} C",
            "grease-lubricated idler: 70 C alarm, 85 C trip"))

    # -- joint / splice ---------------------------------------------------
    # Falling tension under normal load is the specific splice indicator: the
    # joint is elongating. Rising vibration peak alone could be many things.
    if "tension_kn" in load and "load_tph" in load:
        expected = 48.0 + 22.0 * (load["load_tph"] / 2000.0)
        drop = max(0.0, (expected - load["tension_kn"]) / expected)
        ev.append(Evidence(
            "joint", "tension_deficit", drop * 100, _ramp(drop, 0.04, 0.35),
            f"Belt tension {drop*100:.1f}% below expected for current load",
            "splice elongation shows as tension loss at constant load"))
    if "crest_factor" in vib:
        cf = vib["crest_factor"]
        ev.append(Evidence(
            "joint", "impact_crest_factor", cf, _ramp(cf, 4.5, 14.0),
            f"Crest factor {cf:.1f} - impact loading at the joint",
            "a loose splice slaps the idlers once per belt revolution"))
    if "slip_pct" in spd:
        s = spd["slip_pct"]
        ev.append(Evidence(
            "joint", "drive_slip", s, _ramp(s, 2.0, 8.0),
            f"Drive slip {s:.2f}%",
            "slack from a stretched splice shows as pulley slip"))

    # -- alignment --------------------------------------------------------
    if "tonal_db" in acu:
        tn = acu["tonal_db"]
        ev.append(Evidence(
            "alignment", "tonal_squeal", tn, _ramp(tn, 1.5, 8.0),
            f"Tonal (squeal) component {tn:.1f} dB above broadband",
            "belt edge riding a misaligned idler squeals narrowband"))
    if "spl_db" in acu:
        sp = acu["spl_db"]
        ev.append(Evidence(
            "alignment", "sound_level", sp, _ramp(sp, 82.0, 105.0),
            f"Sound pressure {sp:.1f} dBA",
            "site baseline ~75 dBA at rated load"))

    # -- belt body (vision) -----------------------------------------------
    if vision:
        for cls, sev, note, basis in _vision_evidence(vision):
            ev.append(Evidence("belt_body", cls, sev * 100, sev, note, basis))

    return ev


def _vision_evidence(vision: dict):
    """Convert camera detections into evidence.

    `vision` = {"detections": [{"cls": str, "conf": float, "area_frac": float}]}

    Area fraction carries the severity a size label would have: this is why the
    taxonomy dropped "Large Tear"/"Small Tear" and measures the box instead.
    """
    by_cls: dict[str, float] = {}
    for d in vision.get("detections", []):
        if d.get("conf", 0) < 0.35:
            continue
        by_cls[d["cls"]] = max(by_cls.get(d["cls"], 0.0), d.get("area_frac", 0.0))

    out = []
    if (a := by_cls.get("tear")) is not None:
        out.append(("visual_tear", _ramp(a, 0.005, 0.06),
                    f"Tear visible, {a*100:.2f}% of frame",
                    "camera detection; area used as severity proxy"))
    if (a := by_cls.get("hole")) is not None:
        out.append(("visual_hole", _ramp(a, 0.003, 0.04),
                    f"Hole/puncture visible, {a*100:.2f}% of frame",
                    "camera detection; area used as severity proxy"))
    if (a := by_cls.get("impact_damage")) is not None:
        out.append(("visual_impact", _ramp(a, 0.01, 0.10),
                    f"Impact damage visible, {a*100:.2f}% of frame",
                    "camera detection; area used as severity proxy"))
    # A detected joint is NOT a fault -- every belt has joints. It is a
    # location cue telling the system where to look hardest.
    return out


def _noisy_or(severities: list[float]) -> float:
    """Combine independent evidence: 1 - prod(1 - s).

    Chosen over max() because corroboration should matter -- three indicators
    at 0.5 is a worse situation than one at 0.5 -- and over mean() because
    averaging lets healthy channels dilute one genuinely alarming one.
    """
    p = 1.0
    for s in severities:
        p *= (1.0 - max(0.0, min(1.0, s)))
    return 1.0 - p


@dataclass
class Health:
    overall: int
    state: str                              # NORMAL | WARNING | CRITICAL
    subsystems: dict[str, int]
    reasons: list[dict] = field(default_factory=list)
    simulated: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


def score(evidence: list[Evidence], simulated: bool = True) -> Health:
    """Fuse evidence into per-subsystem and overall health (100 = perfect)."""
    subs: dict[str, int] = {}
    for name in SUBSYSTEMS:
        sev = [e.severity for e in evidence if e.subsystem == name]
        subs[name] = int(round(100 * (1 - _noisy_or(sev)))) if sev else 100

    # The belt is as healthy as its worst subsystem, softened slightly so a
    # single marginal channel does not slam the headline number to zero.
    worst = min(subs.values())
    mean = sum(subs.values()) / len(subs)
    overall = int(round(0.75 * worst + 0.25 * mean))

    state = "NORMAL" if overall >= 80 else "WARNING" if overall >= 50 else "CRITICAL"

    # Only surface evidence that is actually contributing, worst first --
    # a wall of green rows is noise during an alarm.
    reasons = sorted(
        (e.to_dict() for e in evidence if e.severity > 0.05),
        key=lambda d: -d["severity"],
    )
    return Health(overall, state, subs, reasons, simulated)
