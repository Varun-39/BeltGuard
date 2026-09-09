# BeltGuard

**Early detection of conveyor belt joint rupture and belt damage in iron ore mining.**

Smart India Hackathon — PS **26008**, Ministry of Steel / NMDC.

Conveyor belts in iron ore handling fail at the splice. When a joint ruptures
unannounced, the line stops for hours to days. BeltGuard watches the belt with
a camera and five sensor channels, fuses them into one explainable health
index, and says **what to fix, where, and how long you have.**

> **Honesty first:** the AI models are real and trained on real data; the
> sensor readings are **simulated**, because we have no hardware yet. The
> system declares this everywhere — on screen, on the wire, and in every alert.
> Full breakdown: **[docs/real-vs-simulated.md](docs/real-vs-simulated.md)**.

---

## Quickstart

Requires Python 3.13 and Node 20+. **No Docker, no WSL.**

```bash
python -m venv .venv
pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
npm install --prefix dashboard
```

Then run each of these in its own terminal:

```bash
python infra/broker.py
```
```bash
python -m uvicorn backend.app:app --port 8010
```
```bash
python -m sensors_sim.run --speed 5
```
```bash
python -m vision.service --source testset --loop
```
```bash
npm run dev --prefix dashboard
```

Open **http://localhost:3000**.

Optional — expose health to a PLC/SCADA over Modbus/TCP:

```bash
python -m scada_sim.modbus_server
```

<details>
<summary>Notes that will save you time</summary>

- The backend is on **8010**, not 8000.
- Use `127.0.0.1`, not `localhost`, in any Python HTTP client here — on Windows
  `localhost` resolves to `::1` first while uvicorn binds IPv4 only, costing
  **~2 s per request** (measured: 2040 ms vs 15 ms).
- `--source testset` plays real photos of *badly damaged* belts, so belt-body
  health reads as failed continuously. That is correct for that framing, not a
  bug — see the calibration note in `backend/fusion.py`.
- Datasets and training artifacts live outside the repo, in
  `%LOCALAPPDATA%/sih26/` (see `vision/paths.py`), because this project sits in
  a OneDrive folder and OneDrive does not read `.gitignore`.
</details>

---

## How it works

```
 5 simulated sensors ─┐
 (vibration, temp,    │
  load, speed,        ├─► MQTT ──► backend ──┬─► SQLite (history)
  acoustic)           │  :1883    :8010      │
                      │                      ├─► WebSocket ──► dashboard :3000
 camera ──► YOLOv8n ──┘                      │                 + digital twin
 (ONNX)     detections                       ├─► Modbus/TCP ──► plant SCADA
                                             │   :5020
                                             └─► SMTP alerts
```

**One shared belt model drives all five sensors.** A degrading splice raises
impulsive vibration, raises local temperature through friction, raises acoustic
level *and* drops belt tension — because they are four measurements of one
physical event, phase-locked to the belt revolution. Fusing five independent
random walks would be theatre; this makes fusion mean something.

**Fusion is a rule engine, not a neural net.** Nobody stops a 2,000 t/h ore line
on an unexplained `0.87`. Every alarm names its indicator, its measured value,
and the standard behind the threshold — ISO 10816-3 for vibration, rolling-element
kurtosis rules for bearings, grease-lubricated idler limits for temperature.

---

## Results

| | |
|---|---|
| **Defect detection** | YOLOv8n, 1,573 real belt images, 5 classes. Test **mAP50 0.976** |
| **Per-class** | tear 0.971 · hole 0.957 · impact 0.980 · patch 0.975 · **belt_joint 0.995 (n=7 — see caveat)** |
| **Bearing anomaly detection** | Trained on **healthy CWRU data only**; catches 100% of real faults at an unseen motor load, 3.4% false alarms |
| **Inference** | ~62 img/s via ONNX Runtime |

> ⚠️ **`belt_joint` mAP50 0.995 is measured on 7 test instances.** It means
> "found all 7 of 7". Never quote it without the sample size. This is the
> headline class for PS 26008 and the one we can say least about.

---

## Layout

```
sensors_sim/    DataSource abstraction + shared belt physics + 5 sensors
vision/         dataset prep, training, ONNX export, inference service
backend/        MQTT ingest, fusion/health scoring, SQLite, alerts, API
predictive/     CWRU real-data validation + degradation-trend RUL
dashboard/      Vite + React live dashboard and 3D digital twin
scada_sim/      Modbus/TCP bridge to plant SCADA
infra/          MQTT broker
docs/           hardware swap guide, real-vs-simulated statement
context.md      full decision log — every non-obvious choice and why
```

## Tests

Each module carries a runnable self-check that asserts its *claims*, not just
that the code runs:

```bash
python -m sensors_sim.test_belt        # fault signatures behave as documented
python -m backend.test_fusion          # degradation is blamed on the right subsystem
python -m backend.test_notify          # alerts escalate but never spam
python -m scada_sim.test_modbus        # a real pymodbus client can read the map
python -m vision.test_service          # the exported ONNX still detects
python infra/test_mqtt_roundtrip.py    # broker + publisher + subscriber
python -m backend.test_backend         # full stack over the network, nothing stubbed
```

## Further reading

- **[docs/real-vs-simulated.md](docs/real-vs-simulated.md)** — what we can honestly claim, and the caveats to say out loud
- **[docs/hardware-swap.md](docs/hardware-swap.md)** — BOM, TensorRT, calibration, SCADA handoff
- **[context.md](context.md)** — the full decision log, including the mistakes
