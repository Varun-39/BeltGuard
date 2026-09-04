"""Simulated conveyor belt physics and the five sensor implementations.

DESIGN NOTE -- why one shared model instead of five independent generators:

A degrading splice does not politely raise only the vibration channel. It
raises impulsive vibration as the joint slaps the idlers, raises local
temperature through friction, raises acoustic level, and drops belt tension as
the splice elongates. All four move together, phase-locked to the belt
revolution, because they are four measurements of ONE physical event.

Every sensor below therefore reads from a single `BeltModel`. That is what makes
the downstream sensor-fusion layer meaningful -- it correlates real co-occurring
evidence, not five unrelated random walks dressed up as fusion.

Fault signatures are grounded in rotating-machinery condition monitoring:
bearing defect frequencies (BPFO/BPFI) derived from bearing geometry, first-order
thermal lag for heating, 1x/2x running-speed harmonics for misalignment.
See docs/real-vs-simulated.md for the honest scope statement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .datasource import DataSource, Reading

# Failure modes this simulator can inject, named for PS 26008's fault list.
FAULT_MODES = (
    "splice_degradation",   # the headline failure: belt joint working loose
    "idler_bearing_fault",  # spalled idler race -> impulsive vibration + heat
    "belt_misalignment",    # belt tracking off-centre -> edge wear, 1x/2x
    "belt_tear",            # longitudinal rip / puncture in the belt body
)


@dataclass
class BeltModel:
    """Shared physical state of one conveyor run. All sensors read from this."""

    belt_length_m: float = 250.0      # centre-to-centre; the loop is 2x this
    belt_speed_mps: float = 3.5
    ambient_c: float = 32.0           # open-cast iron ore site, day shift
    rated_load_tph: float = 2000.0
    idler_diameter_m: float = 0.152

    # Bearing geometry for a typical idler roller (9 balls, d/D = 0.32).
    # Defect frequencies come out as fixed multiples of shaft rotation frequency.
    n_balls: int = 9
    ball_pitch_ratio: float = 0.32

    # severity 0.0 (healthy) .. 1.0 (imminent rupture), per fault mode
    faults: dict[str, float] = field(default_factory=dict)
    seed: int = 26008

    def __post_init__(self) -> None:
        self.rng = np.random.default_rng(self.seed)
        self._load_walk = 0.0

    # -- geometry / characteristic frequencies ----------------------------

    @property
    def belt_period_s(self) -> float:
        """One full belt loop -- how often the splice passes a fixed sensor."""
        return 2.0 * self.belt_length_m / self.belt_speed_mps

    @property
    def idler_rot_hz(self) -> float:
        return self.belt_speed_mps / (math.pi * self.idler_diameter_m)

    @property
    def bpfo_hz(self) -> float:
        """Ball Pass Frequency, Outer race -- the classic spalled-race tone."""
        return (self.n_balls / 2.0) * (1 - self.ball_pitch_ratio) * self.idler_rot_hz

    @property
    def bpfi_hz(self) -> float:
        """Ball Pass Frequency, Inner race."""
        return (self.n_balls / 2.0) * (1 + self.ball_pitch_ratio) * self.idler_rot_hz

    def severity(self, mode: str) -> float:
        return float(self.faults.get(mode, 0.0))

    def set_fault(self, mode: str, severity: float) -> None:
        if mode not in FAULT_MODES:
            raise ValueError(f"unknown fault mode {mode!r}; expected one of {FAULT_MODES}")
        self.faults[mode] = float(np.clip(severity, 0.0, 1.0))

    # -- shared time-varying quantities ------------------------------------

    def splice_phase(self, t: float) -> float:
        """0..1 position of the splice in its revolution. 0 == passing sensor."""
        return (t % self.belt_period_s) / self.belt_period_s

    def splice_proximity(self, t: float, width: float = 0.04) -> float:
        """1.0 while the splice is under the sensor, decaying either side.

        This is what phase-locks vibration, heat and sound to the same event.
        """
        ph = self.splice_phase(t)
        d = min(ph, 1.0 - ph)          # circular distance to phase 0
        return math.exp(-((d / width) ** 2))

    def load_tph(self, t: float) -> float:
        """Ore feed rate: slow random walk plus surges, as a real feeder gives."""
        self._load_walk = 0.97 * self._load_walk + self.rng.normal(0, 0.02)
        surge = 0.15 * math.sin(2 * math.pi * t / 47.0)
        return self.rated_load_tph * (0.78 + surge + self._load_walk)


# ---------------------------------------------------------------------------
# Sensors
# ---------------------------------------------------------------------------


class _SimSensor(DataSource):
    """Base for every simulated sensor: binds one to the shared BeltModel."""

    def __init__(self, sensor_id: str, position_m: float, sample_hz: float, belt: BeltModel):
        super().__init__(sensor_id, position_m, sample_hz)
        self.belt = belt

    @property
    def simulated(self) -> bool:
        return True


class VibrationSensor(_SimSensor):
    """Tri-axial accelerometer on an idler bracket.

    Synthesises a real waveform window each call and derives the three features
    condition-monitoring engineers actually use:
      RMS      -- overall energy (ISO 10816 severity bands)
      peak     -- worst excursion
      kurtosis -- impulsiveness; the canonical early bearing-fault indicator.
                  Gaussian noise sits at 3.0; spalling drives it well above.
    """

    kind = "vibration"

    def __init__(self, sensor_id, position_m, belt, waveform_fs=2000.0, window=1024):
        super().__init__(sensor_id, position_m, sample_hz=5.0, belt=belt)
        self.waveform_fs = waveform_fs
        self.window = window

    def _waveform(self, t: float) -> np.ndarray:
        b = self.belt
        n = self.window
        ts = t + np.arange(n) / self.waveform_fs
        rng = b.rng

        # Healthy baseline: broadband floor + running-speed harmonic.
        x = rng.normal(0, 0.35, n)
        x += 0.45 * np.sin(2 * np.pi * b.idler_rot_hz * ts)

        # Misalignment: energy at 1x and a strong 2x component.
        mis = b.severity("belt_misalignment")
        if mis:
            x += mis * 1.6 * np.sin(2 * np.pi * b.idler_rot_hz * ts)
            x += mis * 2.4 * np.sin(2 * np.pi * 2 * b.idler_rot_hz * ts + 0.7)

        # Bearing spall: impulse train at BPFO, amplitude-modulated by 1x.
        # Impulsive, so it lifts kurtosis far more than it lifts RMS -- which
        # is exactly why kurtosis catches this fault earlier than RMS does.
        brg = b.severity("idler_bearing_fault")
        if brg:
            period = 1.0 / b.bpfo_hz
            phase = (ts % period) / period
            impulses = np.exp(-((phase / 0.02) ** 2)) + np.exp(-(((1 - phase) / 0.02) ** 2))
            envelope = 1 + 0.5 * np.sin(2 * np.pi * b.idler_rot_hz * ts)
            x += brg * 9.0 * impulses * envelope

        # Splice: a single hard slap as the joint crosses the idler. Grows
        # sharply as the joint loosens -- this is the rupture precursor.
        spl = b.severity("splice_degradation")
        if spl:
            x += (spl ** 1.5) * 14.0 * b.splice_proximity(t) * rng.normal(0, 1, n)

        # Tear: flapping edge, broadband, worse near the damaged section.
        tear = b.severity("belt_tear")
        if tear:
            x += tear * 2.2 * rng.normal(0, 1, n) * (0.6 + 0.4 * b.splice_proximity(t, 0.12))

        return x

    def read(self, t: float) -> Reading:
        x = self._waveform(t)
        rms = float(np.sqrt(np.mean(x**2)))
        peak = float(np.max(np.abs(x)))
        sd = float(np.std(x))
        kurt = float(np.mean((x - x.mean()) ** 4) / sd**4) if sd > 1e-9 else 3.0
        return Reading(
            sensor_id=self.sensor_id,
            kind=self.kind,
            t=t,
            values={"rms_mm_s": round(rms, 4), "peak_mm_s": round(peak, 4),
                    "kurtosis": round(kurt, 3), "crest_factor": round(peak / rms, 3)},
            unit={"rms_mm_s": "mm/s", "peak_mm_s": "mm/s",
                  "kurtosis": "-", "crest_factor": "-"},
            simulated=True,
            meta={"bpfo_hz": round(self.belt.bpfo_hz, 2), "position_m": self.position_m},
        )


class TemperatureSensor(_SimSensor):
    """IR / contact probe on an idler bearing housing.

    Stateful: heat does not jump, it follows a first-order lag toward the
    friction-driven target. tau ~ 90 s for a steel bearing housing.
    """

    kind = "temperature"

    def __init__(self, sensor_id, position_m, belt, tau_s: float = 90.0):
        super().__init__(sensor_id, position_m, sample_hz=1.0, belt=belt)
        self.tau_s = tau_s
        self._T = belt.ambient_c + 8.0
        self._last_t: float | None = None

    def read(self, t: float) -> Reading:
        b = self.belt
        dt = 0.0 if self._last_t is None else max(0.0, t - self._last_t)
        self._last_t = t

        load_frac = b.load_tph(t) / b.rated_load_tph
        target = b.ambient_c + 8.0 + 6.0 * load_frac
        target += 55.0 * b.severity("idler_bearing_fault")      # seizing bearing
        target += 22.0 * b.severity("splice_degradation") * b.splice_proximity(t, 0.10)
        target += 9.0 * b.severity("belt_misalignment")         # edge friction

        if dt:
            self._T += (target - self._T) * (1 - math.exp(-dt / self.tau_s))
        self._T += float(b.rng.normal(0, 0.12))

        return Reading(
            sensor_id=self.sensor_id, kind=self.kind, t=t,
            values={"temp_c": round(self._T, 2),
                    "rise_over_ambient_c": round(self._T - b.ambient_c, 2)},
            unit={"temp_c": "degC", "rise_over_ambient_c": "K"},
            simulated=True,
            meta={"ambient_c": b.ambient_c, "position_m": self.position_m},
        )


class LoadSensor(_SimSensor):
    """Belt weigher + tension load cell at the take-up.

    Tension DROPS as a splice elongates -- a falling tension trend under steady
    ore load is one of the more specific early splice-failure indicators.
    """

    kind = "load"

    def __init__(self, sensor_id, position_m, belt):
        super().__init__(sensor_id, position_m, sample_hz=2.0, belt=belt)

    def read(self, t: float) -> Reading:
        b = self.belt
        tph = b.load_tph(t)
        nominal_kn = 48.0 + 22.0 * (tph / b.rated_load_tph)
        tension = nominal_kn * (1.0 - 0.28 * b.severity("splice_degradation"))
        tension -= 4.0 * b.severity("belt_tear")
        tension += float(b.rng.normal(0, 0.35))
        return Reading(
            sensor_id=self.sensor_id, kind=self.kind, t=t,
            values={"load_tph": round(tph, 1), "tension_kn": round(tension, 2)},
            unit={"load_tph": "t/h", "tension_kn": "kN"},
            simulated=True, meta={"rated_tph": b.rated_load_tph},
        )


class SpeedSensor(_SimSensor):
    """Tacho on the tail pulley. Slip rises with load and with a slack splice."""

    kind = "speed"

    def __init__(self, sensor_id, position_m, belt):
        super().__init__(sensor_id, position_m, sample_hz=2.0, belt=belt)

    def read(self, t: float) -> Reading:
        b = self.belt
        load_frac = b.load_tph(t) / b.rated_load_tph
        slip = 0.004 + 0.010 * load_frac + 0.045 * b.severity("splice_degradation")
        v = b.belt_speed_mps * (1 - slip) + float(b.rng.normal(0, 0.008))
        return Reading(
            sensor_id=self.sensor_id, kind=self.kind, t=t,
            values={"speed_mps": round(v, 4), "slip_pct": round(slip * 100, 3)},
            unit={"speed_mps": "m/s", "slip_pct": "%"},
            simulated=True, meta={"nominal_mps": b.belt_speed_mps},
        )


class AcousticSensor(_SimSensor):
    """Microphone at the idler frame. Reports SPL plus a tonal-squeal component.

    A dry or misaligned idler squeals -- narrowband tonal energy, distinct from
    the broadband rumble of normal running. Reported separately so the fusion
    layer can treat "loud" and "squealing" as different pieces of evidence.
    """

    kind = "acoustic"

    def __init__(self, sensor_id, position_m, belt):
        super().__init__(sensor_id, position_m, sample_hz=4.0, belt=belt)

    def read(self, t: float) -> Reading:
        b = self.belt
        spl = 71.0 + 5.0 * (b.load_tph(t) / b.rated_load_tph)
        spl += 11.0 * b.severity("idler_bearing_fault")
        spl += 14.0 * b.severity("splice_degradation") * b.splice_proximity(t, 0.08)
        spl += 6.0 * b.severity("belt_tear")
        spl += float(b.rng.normal(0, 0.4))
        tonal = 4.0 * b.severity("belt_misalignment") + 3.0 * b.severity("idler_bearing_fault")
        return Reading(
            sensor_id=self.sensor_id, kind=self.kind, t=t,
            values={"spl_db": round(spl, 2),
                    "tonal_db": round(tonal + float(b.rng.normal(0, 0.2)), 2)},
            unit={"spl_db": "dBA", "tonal_db": "dB"},
            simulated=True, meta={"position_m": self.position_m},
        )


def default_array(belt: BeltModel) -> list[DataSource]:
    """The sensor array as it would be installed at one monitoring station."""
    return [
        VibrationSensor("vib-idler-04", 120.0, belt),
        TemperatureSensor("temp-idler-04", 120.0, belt),
        LoadSensor("load-takeup-01", 8.0, belt),
        SpeedSensor("speed-tail-01", 0.0, belt),
        AcousticSensor("acu-idler-04", 120.0, belt),
    ]
