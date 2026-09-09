# Going from simulation to real hardware

*How BeltGuard moves onto a Jetson Nano and a physical conveyor.*

The whole system was built assuming this day would come, so this is a list of
substitutions rather than a rewrite. **No component downstream of the sensor
layer changes at all.**

---

## The one boundary that matters

Everything reads `Reading` objects produced by a `DataSource`:

```python
# sensors_sim/datasource.py
class DataSource(ABC):
    kind: str
    @property
    @abstractmethod
    def simulated(self) -> bool: ...
    @abstractmethod
    def read(self, t: float) -> Reading: ...
```

To go real you write **one new class per sensor** that reads a physical bus and
returns `Reading(..., simulated=False)`. Nothing else in the repo is touched:
the MQTT topics, payload shape, fusion rules, thresholds, dashboard, RUL and
Modbus register map all keep working, because none of them know or care where a
reading came from.

The `simulated` flag flipping to `False` is what makes the dashboard badge, the
alert subject line and Modbus register 9 stop saying "simulated" — automatically,
with no other edit.

---

## Bill of materials

| Need | Part | Approx cost (INR) | Notes |
|---|---|---|---|
| Edge compute | Jetson Nano 4GB (B01) | 12,000–18,000 | Already the chosen target |
| Vibration | ADXL335 / ADXL345, or IEPE + ADC for real ISO-grade | 300 / 6,000 | Sample ≥2 kHz to resolve BPFO ~22 Hz and its harmonics |
| Temperature | MLX90614 (IR, non-contact) | 900 | Non-contact matters: the idler is rotating |
| Belt speed | Inductive proximity sensor + pulley target | 700 | Pulse counting; no analogue path needed |
| Load / tension | HX711 + load cell on the take-up | 800 | |
| Acoustic | I2S MEMS mic (INMP441) | 400 | |
| Camera | Any CSI/USB camera, 1080p, global shutter preferred | 2,000–8,000 | Rolling shutter smears a belt at 3.5 m/s |
| Lighting | LED bar, diffuse | 1,500 | **Do not skip.** Underground belt lighting is the single biggest cause of vision failure |

Rough total: **₹20,000–35,000** per monitoring station.

---

## Steps

### 1. Model → TensorRT

The ONNX file is already the deployment artifact:

```bash
# on the Nano
trtexec --onnx=belt_defect.onnx --saveEngine=belt_defect.engine --fp16
```

FP16 roughly doubles throughput on the Nano with negligible accuracy loss for
detection. `vision/service.py` loads ONNX today; point it at the engine instead.

> Do **not** train on the Nano. Train on a workstation, ship the artifact.

### 2. Write the real DataSources

One file, e.g. `sensors_hw/real.py`:

```python
class RealVibrationSensor(DataSource):
    kind = "vibration"

    @property
    def simulated(self) -> bool:
        return False        # this is what flips every badge in the system

    def read(self, t: float) -> Reading:
        window = self.adc.read_block(self.window)          # real samples
        rms  = float(np.sqrt(np.mean(window**2)))
        peak = float(np.max(np.abs(window)))
        sd   = float(np.std(window))
        kurt = float(np.mean((window - window.mean())**4) / sd**4)
        return Reading(
            sensor_id="vib-idler-04", kind=self.kind, t=t,
            values={"rms_mm_s": rms, "peak_mm_s": peak, "kurtosis": kurt,
                    "crest_factor": peak / rms},
            unit={...}, simulated=False,
        )
```

**Keep the `values` keys identical.** The fusion layer looks up `rms_mm_s`,
`kurtosis`, `crest_factor` etc. by name; matching them is the entire contract.

### 3. Point the publisher at the real array

`sensors_sim/run.py` builds its array from `default_array(belt)`. Swap that one
call for the real sensor list. The publishing loop, topics and payloads are
unchanged.

### 4. Move the broker

`infra/broker.py` (amqtt) is fine for a laptop demo. A site deployment should
run **Mosquitto** with per-device credentials and TLS on 8883. Change the host
in the publisher and in `backend/app.py`; nothing else.

### 5. Calibrate — this is not optional

The physical world does not match the model, and these are the knobs:

| What | Where | Why it must be re-tuned |
|---|---|---|
| Vision area thresholds | `backend/fusion.py::_vision_evidence` | **Field-of-view dependent.** Bounds assume a wide-angle view of full belt width. Mount height, lens and belt width all move them. |
| Severity ramp bounds | `backend/fusion.py::evaluate` | `lo` is where an indicator starts mattering, `hi` is its physical worst case. Site-specific. |
| Belt geometry | `sensors_sim/belt.py::BeltModel` | Length, speed, idler diameter and bearing ball count set BPFO/BPFI. Wrong geometry = watching the wrong frequency. |
| Ambient baseline | `BeltModel.ambient_c` | An open-cast site in May is not one in January. |
| Alert recipients | `.env` | `SMTP_HOST`, `ALERT_TO` |

**Record a healthy baseline first.** Run the belt in known-good condition for a
week, then set thresholds relative to what you measured. The CWRU work shows
why: an anomaly detector fitted on healthy data alone caught every real fault
at an unseen load with a 3.4% false-alarm rate, and needed no fault labels —
which is exactly the position a newly instrumented conveyor is in.

### 6. Hand off to plant SCADA

`scada_sim/modbus_server.py` already speaks Modbus/TCP on port 5020 with a
documented register map. On site: point it at the real backend, move it to port
502 if the SCADA expects it, and give the integrator the register map (the
server prints it at startup; the authoritative source is `REGISTERS` in that
module).

Have the PLC watch **register 11 (`HEARTBEAT`)** and **register 10
(`DATA_VALID`)**. A frozen heartbeat means the bridge died; `DATA_VALID = 0`
means the bridge is alive but the numbers are stale. A PLC acting on a frozen
value is the failure mode worth engineering against.

---

## What we would *not* carry over unchanged

- **SQLite** is right for a demo. Years of history across dozens of conveyors
  wants a real time-series database; the swap is confined to `backend/store.py`.
- **The `testset` camera source** exists to demo the model. On site the source
  is the real camera (`--source 0`).
- **`DEMO_ACCELERATION`** (672×) must be set to 1. It only exists to make a
  three-week failure watchable in 45 minutes.
