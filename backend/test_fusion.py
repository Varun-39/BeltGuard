"""End-to-end check: simulated belt -> fusion -> health state.

This is the one test that proves the system does its job. It runs the full
degradation scenario and asserts the pipeline (a) starts healthy, (b) ends
critical, and (c) blames the RIGHT subsystem at each stage -- a scorer that
goes critical for the wrong reason is not a monitoring system.

Run:  .venv/Scripts/python.exe -m backend.test_fusion
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.fusion import evaluate, score, _noisy_or, _ramp
from sensors_sim.belt import BeltModel, default_array
from sensors_sim.run import severities_at, SCENARIO


def health_at(t: float, belt: BeltModel, sensors) -> "tuple":
    for mode, sev in severities_at(t).items():
        belt.set_fault(mode, sev)
    # Settle the thermal lag so temperature reflects this point in the story.
    for s in sensors:
        if s.kind == "temperature":
            s.read(max(0.0, t - 120))
    latest = {s.kind: s.read(t).values for s in sensors}
    return score(evaluate(latest))


def test_ramp_and_noisy_or_are_sane():
    assert _ramp(0, 5, 10) == 0.0 and _ramp(99, 5, 10) == 1.0
    assert abs(_ramp(7.5, 5, 10) - 0.5) < 1e-9
    # corroboration must beat any single piece of evidence
    assert _noisy_or([0.5, 0.5, 0.5]) > 0.5
    assert _noisy_or([]) == 0.0


def test_healthy_belt_scores_normal():
    belt = BeltModel()
    h = health_at(0.0, belt, default_array(belt))
    assert h.state == "NORMAL", (h.overall, h.reasons[:2])
    assert h.overall >= 80


def test_degradation_ends_critical():
    belt = BeltModel()
    h = health_at(SCENARIO[-1][0], belt, default_array(belt))
    assert h.state == "CRITICAL", (h.overall, h.state)


def test_health_declines_over_the_scenario():
    """Not strictly monotonic -- real signals wobble -- but the trend must fall."""
    belt = BeltModel()
    sensors = default_array(belt)
    series = [health_at(t, belt, sensors).overall
              for t in range(0, int(SCENARIO[-1][0]) + 1, 150)]
    first, last = sum(series[:3]) / 3, sum(series[-3:]) / 3
    assert last < first - 30, series


def test_bearing_is_blamed_before_the_joint():
    """The scenario spalls a bearing first, then works the splice loose.

    If the scorer flags the joint before the bearing it is reading correlation,
    not cause, and would send a crew to the wrong place.
    """
    belt = BeltModel()
    sensors = default_array(belt)
    early = health_at(400.0, belt, sensors).subsystems
    assert early["bearing"] < early["joint"], early


def test_reasons_are_present_and_explainable():
    """Every alarm must carry its own justification."""
    belt = BeltModel()
    h = health_at(SCENARIO[-1][0], belt, default_array(belt))
    assert h.reasons, "critical state with no stated reason"
    for r in h.reasons:
        assert r["message"] and r["basis"], r
    assert h.reasons[0]["severity"] >= h.reasons[-1]["severity"]


def test_vision_evidence_feeds_belt_body():
    belt = BeltModel()
    sensors = default_array(belt)
    latest = {s.kind: s.read(0.0).values for s in sensors}
    clean = score(evaluate(latest, vision={"detections": []}))
    torn = score(evaluate(latest, vision={"detections": [
        {"cls": "tear", "conf": 0.9, "area_frac": 0.05}]}))
    assert torn.subsystems["belt_body"] < clean.subsystems["belt_body"]
    # a detected joint is not damage -- every belt has joints
    jointed = score(evaluate(latest, vision={"detections": [
        {"cls": "belt_joint", "conf": 0.9, "area_frac": 0.05}]}))
    assert jointed.subsystems["belt_body"] == clean.subsystems["belt_body"]


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print(f"  PASS  {fn.__name__}")
    print(f"\n{len(tests)} checks passed.\n")

    belt = BeltModel()
    sensors = default_array(belt)
    print("  degradation timeline as the system sees it:")
    print(f"    {'t':>6}  {'health':>6} {'state':<9} {'joint':>6}{'brg':>5}{'align':>6}{'body':>5}  top reason")
    for t in range(0, int(SCENARIO[-1][0]) + 1, 300):
        h = health_at(float(t), belt, sensors)
        s = h.subsystems
        top = h.reasons[0]["message"] if h.reasons else "-"
        print(f"    {t:>6}  {h.overall:>6} {h.state:<9} {s['joint']:>6}{s['bearing']:>5}"
              f"{s['alignment']:>6}{s['belt_body']:>5}  {top[:44]}")
