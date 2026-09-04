"""Sensor abstraction layer.

THE HARDWARE SWAP POINT. Everything downstream of this module (MQTT publisher,
backend, fusion, dashboard) consumes `Reading` objects and never knows or cares
whether they came from a simulator or a real ADC.

To go live on a Jetson Nano, you write one new class implementing `DataSource`
that reads a real bus (I2C/SPI/serial) and returns `Reading(simulated=False)`.
No other file changes.

`Reading.simulated` is deliberately a required field, not a default. It rides
the payload all the way to the dashboard badge, so simulated data cannot
silently render as real -- the honesty guarantee is structural, not a UI note
somebody forgets to add.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass(frozen=True)
class Reading:
    sensor_id: str          # e.g. "vib-idler-04"
    kind: str               # vibration | temperature | load | speed | acoustic
    t: float                # seconds since sim/session start
    values: dict[str, float]
    unit: dict[str, str]
    simulated: bool
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class DataSource(ABC):
    """One physical (or simulated) sensor at one point on the belt."""

    kind: str

    def __init__(self, sensor_id: str, position_m: float, sample_hz: float):
        self.sensor_id = sensor_id
        self.position_m = position_m      # distance along belt run
        self.sample_hz = sample_hz

    @property
    @abstractmethod
    def simulated(self) -> bool:
        ...

    @abstractmethod
    def read(self, t: float) -> Reading:
        """Return the reading for simulation/wall-clock time `t` (seconds)."""
