"""Remaining Useful Life: how long until this belt reaches a maintenance limit.

WHAT THIS IS, HONESTLY:

This is a DEGRADATION-TREND extrapolation, not a learned RUL model. It fits a
trend to the recent health-score history and projects forward to the threshold
crossing, with an uncertainty band from the fit residuals.

That distinction matters and we state it rather than bury it. A learned RUL
model (train on many run-to-failure histories, predict time-to-failure directly)
needs run-to-failure data from THIS asset class. NASA's IMS bearing set has
that for bearings, but a conveyor splice fails by a different mechanism, on a
different timescale, under different loading -- so an IMS-trained model would
be transferring across a gap wide enough to make its numbers dishonest.

Trend extrapolation is what condition-monitoring practice actually uses when
you have a health indicator but no failure history, which is exactly the
position a newly instrumented conveyor is in. It is defensible, and it improves
by itself as real history accumulates.

Design choices that keep it honest:
  * Fit on a RECENT window, not all history -- degradation accelerates, so an
    old-and-slow trend would flatter the estimate.
  * Refuse to answer when the trend is flat or improving. "No trend" is a real
    answer; inventing a number would be worse.
  * Report a confidence INTERVAL, never a bare number. A point estimate of
    "41.3 hours" implies precision this method does not have.

Run:  .venv/Scripts/python.exe -m predictive.rul
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np

# Health-score thresholds the projection aims at, matching fusion.score().
WARNING_LEVEL = 80
CRITICAL_LEVEL = 50

MIN_POINTS = 12          # below this a slope is noise
MIN_SLOPE = 0.02         # health points lost per hour worth extrapolating


@dataclass
class RulEstimate:
    trend_per_hour: float          # health points lost per hour (positive = degrading)
    hours_to_warning: float | None
    hours_to_critical: float | None
    ci_low_hours: float | None     # optimistic / pessimistic bounds on time-to-critical
    ci_high_hours: float | None
    r_squared: float
    confidence: str                # high | medium | low | none
    basis: str
    method: str = "degradation-trend extrapolation (not a learned RUL model)"

    def to_dict(self) -> dict:
        return asdict(self)


def estimate(ts_seconds: np.ndarray, health: np.ndarray,
             window_hours: float = 2.0) -> RulEstimate:
    """Project the recent health trend forward to the maintenance thresholds.

    `ts_seconds` is wall-clock; `health` is the 0-100 overall score.
    """
    ts = np.asarray(ts_seconds, dtype=float)
    hv = np.asarray(health, dtype=float)
    if len(ts) < MIN_POINTS:
        return RulEstimate(0.0, None, None, None, None, 0.0, "none",
                           f"only {len(ts)} samples; need {MIN_POINTS}")

    hours = (ts - ts[0]) / 3600.0
    # Recent window only: degradation accelerates, and an old flat trend would
    # make the estimate optimistic exactly when it matters most.
    recent = hours >= max(0.0, hours[-1] - window_hours)
    if recent.sum() < MIN_POINTS:
        recent = np.ones_like(hours, dtype=bool)
    t, h = hours[recent], hv[recent]

    slope, intercept = np.polyfit(t, h, 1)
    fit = slope * t + intercept
    ss_res = float(np.sum((h - fit) ** 2))
    ss_tot = float(np.sum((h - h.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-9 else 0.0

    decline = -slope                       # positive == getting worse
    current = float(fit[-1])

    if decline < MIN_SLOPE:
        return RulEstimate(
            round(decline, 4), None, None, None, None, round(r2, 3), "none",
            "health is stable or improving -- no meaningful degradation trend")

    def hours_to(level: float) -> float | None:
        if current <= level:
            return 0.0                     # already past it
        return (current - level) / decline

    # Uncertainty from fit scatter: how much slower/faster the decline could be.
    resid_sd = float(np.sqrt(ss_res / max(len(t) - 2, 1)))
    span = max(t[-1] - t[0], 1e-6)
    slope_se = resid_sd / (np.std(t) * np.sqrt(len(t))) if np.std(t) > 1e-9 else decline
    lo_rate, hi_rate = decline + 1.96 * slope_se, max(decline - 1.96 * slope_se, 1e-6)

    crit = hours_to(CRITICAL_LEVEL)
    ci_low = (current - CRITICAL_LEVEL) / lo_rate if crit else 0.0
    ci_high = (current - CRITICAL_LEVEL) / hi_rate if crit else 0.0

    confidence = ("high" if r2 > 0.85 and span > 0.5 else
                  "medium" if r2 > 0.6 else "low")

    return RulEstimate(
        trend_per_hour=round(decline, 3),
        hours_to_warning=None if (w := hours_to(WARNING_LEVEL)) is None else round(w, 2),
        hours_to_critical=None if crit is None else round(crit, 2),
        ci_low_hours=round(min(ci_low, ci_high), 2),
        ci_high_hours=round(max(ci_low, ci_high), 2),
        r_squared=round(r2, 3),
        confidence=confidence,
        basis=f"linear fit over last {span:.2f} h of health history ({len(t)} points)",
    )


def _demo() -> None:
    """Run the real degradation scenario through fusion, then estimate RUL."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.fusion import evaluate, score
    from sensors_sim.belt import BeltModel, default_array
    from sensors_sim.run import SCENARIO, severities_at

    belt = BeltModel()
    sensors = default_array(belt)
    ts, hs = [], []
    end = int(SCENARIO[-1][0])
    for t in range(0, end + 1, 30):
        for mode, sev in severities_at(float(t)).items():
            belt.set_fault(mode, sev)
        for s in sensors:
            if s.kind == "temperature":
                s.read(max(0.0, t - 120))
        h = score(evaluate({s.kind: s.read(float(t)).values for s in sensors}))
        ts.append(float(t))
        hs.append(h.overall)

    print(f"  simulated {end/3600:.2f} h of belt history, {len(ts)} health samples")
    print(f"  health went {hs[0]} -> {hs[-1]}\n")
    from sensors_sim.run import DEMO_ACCELERATION
    print(f"  fault ramp is accelerated {DEMO_ACCELERATION:.0f}x vs a real belt,")
    print("  so 'real equiv' converts sim-hours to the field timescale.\n")
    print(f"  {'at':>7}  {'health':>6}  {'trend/h':>9}  {'sim h->crit':>11}"
          f"  {'real equiv':>12}  conf")
    for cut in (len(ts) // 6, len(ts) // 4, len(ts) // 3, len(ts) // 2, len(ts)):
        e = estimate(np.array(ts[:cut]), np.array(hs[:cut]))
        h2c = e.hours_to_critical
        real = (f"{h2c*DEMO_ACCELERATION/24:.1f} days"
                if h2c else ("already past" if h2c == 0.0 else "-"))
        print(f"  {ts[cut-1]:>6.0f}s  {hs[cut-1]:>6}  {e.trend_per_hour:>9.2f}"
              f"  {(f'{h2c:.3f}' if h2c is not None else '-'):>11}"
              f"  {real:>12}  {e.confidence}")

    # A degrading belt must be caught, and the estimate must tighten as the
    # failure approaches -- a prediction that does not shrink is not predicting.
    early = estimate(np.array(ts[:len(ts) // 6]), np.array(hs[:len(ts) // 6]))
    mid = estimate(np.array(ts[:len(ts) // 4]), np.array(hs[:len(ts) // 4]))
    assert early.hours_to_critical is not None, "missed an obvious degradation"
    assert mid.hours_to_critical < early.hours_to_critical, (
        f"RUL did not shrink: {early.hours_to_critical} -> {mid.hours_to_critical}")
    assert early.confidence != "none"

    # A healthy belt must NOT produce a failure prediction.
    flat_ts = np.arange(0, 3600, 30, dtype=float)
    flat = estimate(flat_ts, np.full(len(flat_ts), 97.0) + np.random.default_rng(0)
                    .normal(0, 0.5, len(flat_ts)))
    print(f"\n  steady healthy belt -> confidence '{flat.confidence}',"
          f" hours_to_critical={flat.hours_to_critical}")
    assert flat.hours_to_critical is None, "predicted failure on a healthy belt"
    print("  (correctly refuses to predict a failure that is not happening)")


if __name__ == "__main__":
    _demo()
