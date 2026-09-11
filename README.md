# BeltGuard

**Intelligent monitoring and prediction of conveyor belt joint rupture and belt-body damage in iron ore mining.**

| | |
|---|---|
| **Problem Statement** | SIH **26008** |
| **Organisation** | Ministry of Steel |
| **Department** | NMDC (National Mineral Development Corporation) |
| **Category / Theme** | Hardware · Smart Automation |
| **Status** | Software-complete; hardware deployment deferred |

---

## 1. Overview

Belt conveyors are the primary bulk-material transport in iron ore mining, and
their most common catastrophic failure is at the **vulcanised splice** — the
joint where the belt is bonded into a loop. A splice degrades gradually and
then fails suddenly. Because the failure is unannounced, the response is
reactive: the line stops, the belt is re-spliced in place, and production is
lost for hours to days.

BeltGuard shifts that response from reactive to **predictive**. It observes the
belt through a machine-vision channel and five sensor channels, fuses them into
a single explainable health index, and produces a maintenance decision: **what
to repair, where it is, and how long remains before intervention is mandatory.**

### 1.1 Scope declaration

The AI models in this system are real and trained on real data. **The sensor
readings are simulated**, as no instrumented conveyor is available to the team.
This is stated deliberately and enforced structurally — the `simulated` flag is
a required field that propagates from the data source through the message bus,
fusion layer, dashboard, Modbus registers, and alert subject lines. No
configuration causes simulated data to present as real.

A complete component-by-component breakdown is maintained in
**[docs/real-vs-simulated.md](docs/real-vs-simulated.md)**.

---

## 2. Capabilities

| # | Capability | Implementation |
|---|---|---|
| 1 | Visual defect detection | YOLOv8-nano detecting belt joints, tears, holes, impact damage and prior repairs |
| 2 | Multi-channel condition monitoring | Vibration, temperature, load/tension, speed, acoustic |
| 3 | Sensor fusion and health scoring | Explainable rule engine producing a 0–100 index across four subsystems |
| 4 | Anomaly detection | Trained on healthy data only; requires no labelled faults |
| 5 | Remaining useful life | Degradation-trend extrapolation with 95% confidence bounds |
| 6 | Operator interface | Real-time dashboard with alert states, live inspection feed, and 3D digital twin |
| 7 | Maintenance decision support | Recommended action with location and planned-versus-unplanned downtime |
| 8 | Industrial integration | Modbus/TCP server exposing health to plant SCADA or a PLC |
| 9 | Escalation | SMTP alerting on confirmed state transitions, carrying diagnostic evidence |

---

## 3. System architecture

```
┌─ EDGE / ACQUISITION ────────────┐   ┌─ TRANSPORT ─┐   ┌─ PROCESSING ────────────┐
│                                 │   │             │   │                         │
│  Vibration ─┐                   │   │             │   │  Fusion & health score  │
│  Temperature│                   │   │             │   │  Anomaly detection      │
│  Load       ├─► DataSource ─────┼──►│  MQTT       ├──►│  RUL estimation         │
│  Speed      │   abstraction     │   │  :1883      │   │  Alert state machine    │
│  Acoustic  ─┘                   │   │             │   │  SQLite time-series     │
│                                 │   │             │   │  FastAPI :8010          │
│  Camera ──► YOLOv8n (ONNX) ─────┼──►│             │   │                         │
└─────────────────────────────────┘   └─────────────┘   └────────────┬────────────┘
                                                                     │
                        ┌────────────────────────┬───────────────────┴──────────┐
                        ▼                        ▼                              ▼
              ┌──────────────────┐   ┌──────────────────────┐   ┌───────────────────┐
              │ Operator console │   │ Plant SCADA / PLC    │   │ Escalation        │
              │ React :3000      │   │ Modbus/TCP :5020     │   │ SMTP              │
              │ WebSocket, 2 Hz  │   │ 12 holding registers │   │ Evidence-bearing  │
              └──────────────────┘   └──────────────────────┘   └───────────────────┘
```

### 3.1 Architectural principles

**Hardware abstraction at a single boundary.** Every channel is a `DataSource`
returning `Reading` objects. Migration to physical instrumentation requires one
new class per sensor; no downstream component — bus, fusion, dashboard, SCADA
bridge — is modified. See [docs/hardware-swap.md](docs/hardware-swap.md).

**Physically coupled simulation.** All five simulated channels are driven by a
single shared belt model. A degrading splice simultaneously raises impulsive
vibration, raises local temperature through friction, raises acoustic emission
and reduces belt tension, phase-locked to the belt revolution, because these are
four measurements of one physical event. Independent per-channel noise would
render sensor fusion meaningless.

**Explainable fusion.** Health scoring is a rule engine, not a neural network.
Every alarm reports the indicator, its measured value, and the standard from
which its threshold derives (ISO 10816-3 vibration severity; rolling-element
bearing kurtosis practice; grease-lubricated idler temperature limits). An
unexplained scalar is not actionable in a maintenance workflow.

**Rate decoupling.** The MQTT ingest thread updates an in-memory snapshot; a
separate 2 Hz task performs fusion, persistence and broadcast. Acquisition rate
and interface rate are independent.

---

## 4. Technology stack

### 4.1 Runtime

| Component | Version | Notes |
|---|---|---|
| Python | 3.13.9 | Backend, simulation, ML, SCADA bridge |
| Node.js | 24.x | Dashboard build tooling |
| Target edge device | NVIDIA Jetson Nano 4 GB (B01) | Deployment target; not yet procured |
| Development GPU | NVIDIA RTX 5060 Laptop (8 GB, sm_120) | Model training |

### 4.2 Machine learning and computer vision

| Package | Version | Purpose |
|---|---|---|
| `torch` / `torchvision` | 2.11.0+cu128 / 0.26.0+cu128 | Model training. CUDA 12.8 build required for Blackwell (sm_120) |
| `ultralytics` | 8.4.138 | YOLOv8 training pipeline and ONNX export |
| `onnx` | 1.22.0 | Model interchange format |
| `onnxruntime-gpu` | 1.29.0 | Production inference runtime |
| `opencv-python` | 5.0.0.93 | Frame capture, annotation, MJPEG encoding |
| `scikit-learn` | 1.9.0 | Isolation Forest anomaly detection, Random Forest classification |
| `scipy` | 1.18.1 | MATLAB `.mat` ingestion for the CWRU bearing dataset |
| `numpy` | 2.3.5 | Signal synthesis and feature extraction. Version pinned deliberately |
| `roboflow` | 1.4.2 | Dataset acquisition |

### 4.3 Backend and messaging

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.141.1 | REST API and WebSocket server |
| `uvicorn` | 0.52.4 | ASGI server |
| `amqtt` | 0.12.0 | MQTT 3.1.1 broker, pure Python |
| `paho-mqtt` | 2.1.0 | MQTT client (publishers and subscriber) |
| `pymodbus` | 3.15.0 | Modbus **client**, used for integration verification only |
| `websockets` | 15.0.1 | WebSocket test client |
| `python-dotenv` | 1.2.3 | Configuration |
| SQLite | stdlib | Time-series persistence, WAL mode |
| `smtplib` | stdlib | Alert delivery |

### 4.4 Frontend

| Package | Version | Purpose |
|---|---|---|
| `react` / `react-dom` | 19.2 | Interface |
| `typescript` | 6.0 | Type safety; build gated on `tsc -b` |
| `vite` | 8.2 | Build tooling and development proxy |
| `tailwindcss` | 4.3 | Styling, CSS-first theme tokens |
| `recharts` | 3.10 | Streaming time-series and RUL projection |
| `three` | 0.185 | 3D rendering |
| `@react-three/fiber` | 9.7 | React renderer for Three.js |
| `@react-three/drei` | 10.7 | Three.js helpers |
| `oxlint` | 1.79 | Linting |

### 4.5 Notable engineering decisions

Each decision below is recorded with full rationale in
[context.md](context.md) §7.

| Decision | Rationale |
|---|---|
| **amqtt instead of Mosquitto-in-Docker** | Docker Desktop requires WSL2, absent on the development host and costing an administrative install plus reboot. A pure-Python broker reduces setup to `pip install`. Protocol, topics and payloads are unchanged; a site deployment substitutes Mosquitto by changing one hostname. |
| **SQLite instead of a dedicated TSDB** | A demonstration produces 10⁵–10⁶ rows. SQLite handles this with an index and no operational surface. The substitution is confined to `backend/store.py`. |
| **Vite instead of Next.js** | The interface is a single client-side page. Server-side rendering, routing and React Server Components contribute nothing. |
| **Hand-written Modbus server** | `pymodbus` 3.15 is mid-migration: its datastore is deprecated and rejects writes, and the replacement `SimData` cannot be mutated while the server runs — which is the entire function of a live bridge. `pymodbus` is retained as the **test client**, verifying interoperability against an independent implementation. |
| **ONNX Runtime instead of CUDA PyTorch for inference** | Measured 61.8 img/s versus 30.4 img/s. At 640 px, YOLOv8n is small enough that CUDA per-call transfer overhead dominates. This also means the demonstration exercises the exact artifact deployed to the Jetson. |
| **Rule-based fusion instead of a learned model** | A maintenance decision requires justification. Every alarm cites its indicator, value and governing standard. |

---

## 5. Machine learning models

### 5.1 Visual defect detection

| Property | Value |
|---|---|
| Architecture | YOLOv8-nano |
| Training data | 1,573 images, 3,249 annotated instances |
| Classes | `belt_joint`, `tear`, `hole`, `impact_damage`, `patch_repair` |
| Training | 120 epochs, 57 minutes, RTX 5060 |
| Artifacts | `belt_defect.pt` (6.3 MB), `belt_defect.onnx` (12.3 MB) |
| Inference | ~62 img/s (ONNX Runtime) |

**Held-out test results**

| Class | Precision | Recall | mAP50 | Test instances |
|---|---|---|---|---|
| `belt_joint` | 0.944 | 1.000 | 0.995 | **7** |
| `tear` | 0.964 | 0.948 | 0.971 | 142 |
| `hole` | 0.970 | 0.855 | 0.957 | 113 |
| `impact_damage` | 0.986 | 0.968 | 0.980 | 31 |
| `patch_repair` | 0.975 | 0.976 | 0.975 | 42 |
| **Overall** | | | **0.976** | 335 |

> **Material caveat.** The `belt_joint` figure is computed over **seven** test
> instances. It denotes seven detections from seven instances; a single miss
> would yield 0.857, and the Wilson 95% lower bound is approximately 0.65. This
> is the defining class for PS 26008 and the class about which the least can be
> claimed. **The figure must not be cited without its sample size.**
>
> Train/validation/test split leakage was tested and found absent: zero source
> images are shared between splits.

### 5.2 Bearing fault detection

Validated against the **Case Western Reserve University bearing dataset** —
1,537 windows drawn from 16 real accelerometer recordings across four motor
loads. The features evaluated are identical to those the fusion layer scores,
which establishes that the indicators separate genuine faults rather than only
artefacts of the simulator.

Evaluation uses a **held-out operating condition** (train 0/1/2 hp, test 3 hp)
rather than a random window split, the latter being the conventional source of
inflated CWRU results.

| Model | Result |
|---|---|
| Supervised 4-class classifier | 100% at held-out load (identical to the random split; no leakage effect) |
| **Anomaly detector, healthy data only** | **100% fault detection at an unseen load, 3.4% false-alarm rate** |

The anomaly detector is the deployable configuration: it requires only a
healthy baseline and no labelled faults, which is the condition of any
newly instrumented conveyor.

> **Caveat.** CWRU uses seeded 0.007″ defects — large, distinct, and separable
> on kurtosis alone. The result reflects a tractable benchmark, not a strong
> model. Progressive field wear will be less separable.

### 5.3 Remaining useful life

Degradation-trend extrapolation over a median-binned health history, reporting
a point estimate with 95% confidence bounds. **This is not a learned RUL
model**, and is labelled as such in the interface. A learned model requires
run-to-failure histories for this asset class, which do not exist publicly;
NASA's IMS bearing dataset was evaluated and rejected, as bearing run-to-failure
transfers poorly to splice failure across mechanism, timescale and loading.

The estimator declines to produce a figure when no degradation trend is present.

---

## 6. Data sources

| Dataset | Licence | Application |
|---|---|---|
| Roboflow `sample-wy2mp/conveyor-belt-damage` (922 images) | CC BY 4.0 | Belt-body defect classes |
| Roboflow `test-yfiry/conveyor-belt-damage-ucjlj` (325 images) | CC BY 4.0 | Sole source of an explicit `Belt Joint` class |
| CWRU Bearing Data Center (16 recordings) | Public | Validation of vibration indicators |

Class taxonomies are merged **by name**, never by index, as index ordering is
not guaranteed across Roboflow projects and a silent mismatch would train
successfully while scoring meaninglessly. Segmentation polygons are reduced to
bounding boxes so both datasets contribute to a single detection taxonomy;
severity is derived from measured box area rather than a subjective size label.

---

## 7. Installation

**Prerequisites:** Python 3.13, Node.js 20+. Docker and WSL are **not** required.

```bash
python -m venv .venv
```
```bash
pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
```
```bash
pip install -r requirements.txt
```
```bash
npm install --prefix dashboard
```

Copy `.env.example` to `.env` and populate as required. All values are optional.

> The CUDA 12.8 PyTorch build is not published on PyPI and must be installed
> from the index above. Blackwell GPUs (RTX 50-series, sm_120) require cu128 or
> later. CPU-only hosts may omit the `+cu128` suffix; training is materially
> slower, inference is unaffected as it runs on ONNX Runtime.

---

## 8. Operation

Each service runs in its own terminal.

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

The operator console is served at **http://localhost:3000**.

Optionally, expose health to a PLC or SCADA client:

```bash
python -m scada_sim.modbus_server
```

<details>
<summary><b>Operational notes</b></summary>

- The backend listens on **8010**, not 8000.
- Python HTTP clients must address `127.0.0.1`, not `localhost`. On Windows,
  `localhost` resolves to `::1` first while Uvicorn binds IPv4 only, incurring
  an IPv6 connection failure per request — measured at 2,040 ms versus 15 ms.
- `--source testset` replays photographs of severely damaged belts, in which a
  defect occupies a large fraction of the frame. Belt-body health therefore
  reads as failed continuously. This is correct for that field of view, not a
  defect; vision area thresholds are a commissioning parameter documented in
  `backend/fusion.py`.
- Datasets and training artifacts are stored outside the repository at
  `%LOCALAPPDATA%/sih26/` (see `vision/paths.py`), as the working directory is
  under OneDrive, which synchronises by folder tree and does not observe
  `.gitignore`.
- The demonstration scenario accelerates the fault ramp **672×**; a real splice
  degrades over two to four weeks. Belt revolutions, thermal lag and bearing
  defect frequencies run at true rates. RUL reports the field-timescale
  equivalent.

</details>

### 8.1 Deployment

The backend (FastAPI + broker + simulator) and the frontend (static Vite
build) deploy to different kinds of host and are configured independently.

**Backend -> Railway** (or any host that runs a long-lived process; a plain
serverless function cannot hold the WebSocket or the broadcast loop open).
`railway.json` at the repo root points the build at `backend/requirements.txt`
-- the slim runtime set, not the root `requirements.txt`, which also pins the
vision *training* stack (torch, onnxruntime-gpu, ultralytics, ...) and would
fail to install on a plain host regardless (torch is pinned to a CUDA
`+cu128` build only available from PyTorch's own package index, not PyPI).
Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed frontend origins |
| `MQTT_HOST` / `MQTT_PORT` | `localhost` / `1883` | Where the broker lives |
| `SMTP_*`, `ALERT_TO`, `ALERT_FROM` | unset | Alert email, see `backend/notify.py` |

The broker and simulator are optional separate services on the same platform
(same `backend/requirements.txt`, start commands `python infra/broker.py` and
`python -m sensors_sim.run`) -- without them the deployed API still serves,
just with no live readings, the same honest "no data yet" state the console
already shows locally before `sensors_sim` is started.

**Frontend -> Vercel.** Set the project's Root Directory to `dashboard`
(framework preset "Vite" is auto-detected; no `vercel.json` needed -- this is
a single-page app with no client-side routing to redirect). Set
`VITE_API_BASE` to the deployed backend's URL (`dashboard/.env.example`) --
without it the built app requests `/api/...` on its own Vercel origin, where
nothing answers. `VITE_GOOGLE_CLIENT_ID`, if used, needs the Vercel domain
added to that OAuth client's authorized origins.

---

## 9. Interfaces

### 9.1 HTTP and WebSocket (`:8010`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | Broker connectivity, live channels, simulation status |
| `GET` | `/api/health/current` | Current fused health, subsystems and contributing evidence |
| `GET` | `/api/health/history` | Health history, server-side decimated |
| `GET` | `/api/history/{kind}` | Readings for one sensor kind |
| `GET` | `/api/rul` | RUL estimate with confidence bounds |
| `GET` | `/api/alerts` | Confirmed state transitions and delivery status |
| `WS` | `/ws` | Combined telemetry frame at 2 Hz |

### 9.2 Modbus/TCP (`:5020`, device id 1)

Holding registers, function codes 3 and 4. Registers are unsigned 16-bit;
physical quantities are scaled by a fixed factor forming part of the contract.

| Address | Name | Scale | Description |
|---|---|---|---|
| 0 | `HEALTH_OVERALL` | — | Fused health index, 0–100 |
| 1 | `ALARM_STATE` | — | 0 = NORMAL, 1 = WARNING, 2 = CRITICAL, 3 = NO_DATA |
| 2 | `HEALTH_JOINT` | — | Splice subsystem, 0–100 |
| 3 | `HEALTH_BEARING` | — | Idler bearing subsystem, 0–100 |
| 4 | `HEALTH_ALIGNMENT` | — | Belt tracking subsystem, 0–100 |
| 5 | `HEALTH_BELT_BODY` | — | Belt body subsystem, 0–100 |
| 6 | `BELT_SPEED` | ×100 | Belt speed, m/s |
| 7 | `BEARING_TEMP` | ×10 | Bearing housing temperature, °C |
| 8 | `RUL_DAYS` | ×10 | Days to CRITICAL; 65535 = unknown |
| 9 | `DATA_SIMULATED` | — | 1 = a contributing source is simulated |
| 10 | `DATA_VALID` | — | 1 = backend reachable and data fresh |
| 11 | `HEARTBEAT` | — | Increments each poll; wraps at 65535 |

`HEARTBEAT` and `DATA_VALID` are separate by design: the former establishes that
the bridge is running, the latter that its values are current. On loss of the
backend the bridge reports `NO_DATA` with `DATA_VALID = 0` while the heartbeat
continues, rather than presenting stale values as valid. Integrators should
monitor both.

---

## 10. Verification

Every module carries an executable self-check asserting its documented claims,
not merely that it executes.

```bash
python -m sensors_sim.test_belt        # fault signatures match documented physics
python -m backend.test_fusion          # degradation attributed to the correct subsystem
python -m backend.test_notify          # escalation without flap-induced spam
python -m scada_sim.test_modbus        # an independent Modbus client reads the map
python -m vision.test_service          # the exported ONNX artifact still detects
python -m predictive.cwru              # indicators still separate real faults
python infra/test_mqtt_roundtrip.py    # broker, publisher and subscriber
python -m backend.test_backend         # full stack over the network, nothing stubbed
```

Frontend type safety is enforced by `tsc -b`, which gates the production build.

---

## 11. Repository structure

```
beltguard/
├── sensors_sim/      DataSource abstraction, shared belt physics, five sensors
├── vision/           Dataset preparation, training, ONNX export, inference service
├── backend/          MQTT ingest, fusion, persistence, alerting, HTTP/WebSocket API
├── predictive/       CWRU validation, anomaly detection, RUL estimation
├── dashboard/        React operator console and 3D digital twin
├── scada_sim/        Modbus/TCP bridge
├── infra/            MQTT broker
├── docs/             Hardware migration guide, scope declaration
├── context.md        Engineering decision log
└── .env.example      Configuration reference
```

---

## 12. Implementation status

**Implemented and verified**

Vision model · sensor simulation · MQTT pipeline · backend API and persistence ·
sensor fusion and health scoring · anomaly detection · RUL estimation ·
operator dashboard · digital twin · Modbus/TCP integration · alert escalation ·
hardware abstraction layer.

**Deferred**

| Item | Reason |
|---|---|
| Jetson Nano deployment | Hardware not procured. ONNX artifact exported; migration path documented. |
| Physical instrumentation | Not procured. Bill of materials and integration procedure specified in [docs/hardware-swap.md](docs/hardware-swap.md). |
| Thermal imaging | Within PS scope. Overheating is presently detected via a temperature channel. |
| `belt_joint` dataset expansion | Highest-value remaining work; approximately 100 additional annotated instances would convert the principal caveat into a supportable claim. |

---

## 13. Documentation

| Document | Contents |
|---|---|
| [docs/real-vs-simulated.md](docs/real-vs-simulated.md) | Component-by-component scope declaration and the caveats governing every quoted figure |
| [docs/hardware-swap.md](docs/hardware-swap.md) | Bill of materials, TensorRT conversion, calibration procedure, SCADA handover |
| [context.md](context.md) | Complete engineering decision log, including superseded decisions and defects encountered |

---

*Developed for Smart India Hackathon, Problem Statement 26008 — Ministry of Steel / NMDC.*
