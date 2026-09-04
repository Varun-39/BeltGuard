"""Self-check for the belt simulator.

These assert the PHYSICS CLAIMS, not just that the code runs. If a fault
signature stops behaving the way the docstrings say it does, this fails.

Run:  .venv/Scripts/python.exe -m sensors_sim.test_belt
"""

from .belt import BeltModel, default_array, VibrationSensor, TemperatureSensor, LoadSensor


def _vib(belt, t=0.0):
    return VibrationSensor("v", 120.0, belt).read(t).values


def test_healthy_baseline_is_gaussian_ish():
    """Healthy vibration should sit near kurtosis 3.0 -- i.e. plain noise."""
    v = _vib(BeltModel())
    assert 2.3 < v["kurtosis"] < 4.0, v
    assert v["rms_mm_s"] < 1.5, v


def test_bearing_fault_lifts_kurtosis_faster_than_rms():
    """The core early-detection claim: impulsive faults show in kurtosis first.

    At low severity, kurtosis must move proportionally more than RMS -- that is
    the whole reason condition monitoring watches kurtosis.
    """
    healthy = _vib(BeltModel())
    faulty = _vib(BeltModel(faults={"idler_bearing_fault": 0.25}))
    kurt_ratio = faulty["kurtosis"] / healthy["kurtosis"]
    rms_ratio = faulty["rms_mm_s"] / healthy["rms_mm_s"]
    assert kurt_ratio > rms_ratio, f"kurt x{kurt_ratio:.2f} vs rms x{rms_ratio:.2f}"


def test_bearing_defect_frequency_matches_geometry():
    """BPFO must follow the standard bearing formula, not a made-up constant."""
    b = BeltModel()
    expected = (b.n_balls / 2) * (1 - b.ball_pitch_ratio) * b.idler_rot_hz
    assert abs(b.bpfo_hz - expected) < 1e-9
    assert b.bpfi_hz > b.bpfo_hz          # inner race always passes faster


def test_splice_slap_is_phase_locked_to_belt_revolution():
    """Splice damage must spike only while the joint is under the sensor."""
    b = BeltModel(faults={"splice_degradation": 0.8})
    at_splice = _vib(b, t=0.0)["peak_mm_s"]
    away = _vib(b, t=b.belt_period_s * 0.5)["peak_mm_s"]
    assert at_splice > 3 * away, (at_splice, away)


def test_splice_degradation_drops_belt_tension():
    """Elongating splice -> falling tension. The specific early indicator."""
    healthy = LoadSensor("l", 8.0, BeltModel()).read(10.0).values["tension_kn"]
    faulty = LoadSensor("l", 8.0, BeltModel(faults={"splice_degradation": 0.9})).read(10.0)
    assert faulty.values["tension_kn"] < healthy - 5.0, (healthy, faulty.values)


def test_temperature_lags_rather_than_jumping():
    """First-order thermal response: a seizing bearing heats over minutes."""
    b = BeltModel(faults={"idler_bearing_fault": 1.0})
    s = TemperatureSensor("t", 120.0, b)
    s.read(0.0)
    after_10s = s.read(10.0).values["temp_c"]
    after_600s = s.read(600.0).values["temp_c"]
    assert after_10s < b.ambient_c + 25, "heated implausibly fast"
    assert after_600s > after_10s + 15, "never reached steady state"


def test_every_reading_is_flagged_simulated():
    """The honesty guarantee: no reading can leave here unlabelled."""
    belt = BeltModel()
    for s in default_array(belt):
        r = s.read(5.0)
        assert r.simulated is True, s.sensor_id
        assert r.values and r.unit.keys() == r.values.keys(), s.sensor_id


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print(f"  PASS  {fn.__name__}")
    print(f"\n{len(tests)} checks passed.")

    b = BeltModel()
    print(f"\nBelt: {b.belt_length_m} m @ {b.belt_speed_mps} m/s")
    print(f"  splice passes a sensor every {b.belt_period_s:.1f} s")
    print(f"  idler rotation {b.idler_rot_hz:.2f} Hz | BPFO {b.bpfo_hz:.2f} Hz | BPFI {b.bpfi_hz:.2f} Hz")
