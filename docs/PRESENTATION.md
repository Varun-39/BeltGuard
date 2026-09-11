# BeltGuard — Complete Project Reference

*Smart India Hackathon — Problem Statement 26008 · Ministry of Steel / NMDC*
*Everything worth knowing before presenting, defending, or extending this project.*

---

## 1. The problem, in plain terms

Iron ore mines move ore on **belt conveyors** — kilometres of continuous rubber
belt running 24/7. The single most common catastrophic failure is at the
**vulcanised splice**, the joint where the belt is bonded into a closed loop.
A splice doesn't fail instantly — it degrades gradually (fatigue, delamination,
impact damage) — but the *failure itself* is sudden and unannounced.

Today, that failure is handled reactively: the belt snaps or the splice tears,
the line stops **immediately and unplanned**, a crew re-splices the belt in
place, and the mine loses production for **hours to days**. On a 2,000 t/h ore
line, that's not a maintenance inconvenience — it's a direct, large revenue
hit, plus safety risk to whoever has to do an emergency in-place repair.

**BeltGuard's job is to move that response from reactive to predictive**: see
the degradation coming, tell someone exactly what's wrong and where, and let
them schedule a 45-minute planned repair instead of an 8–14 hour unplanned one.

---

## 2. What we actually built — capability by capability

| # | Capability | How |
|---|---|---|
| 1 | **Visual defect detection** | A YOLOv8-nano model we trained ourselves, detecting belt joints, tears, holes, impact damage, and prior patch repairs, from a live camera feed |
| 2 | **Multi-channel condition monitoring** | Five sensor channels: vibration, temperature, load/tension, belt speed, acoustic |
| 3 | **Sensor fusion & health scoring** | An explainable rule engine that turns raw signals into a single 0–100 health index across four subsystems |
| 4 | **Anomaly detection** | Trained on *healthy data only* — doesn't need a single labelled fault to work |
| 5 | **Remaining Useful Life (RUL)** | Degradation-trend extrapolation with 95% confidence bounds — tells you *when* to act, not just *that* something is wrong |
| 6 | **Operator dashboard** | Real-time web console: live 3D digital twin of the conveyor, per-part inspection, live camera feed, health trend, event log |
| 7 | **Maintenance decision support** | Not just "critical" — a named repair, its location on the belt, and a planned-vs-unplanned downtime comparison |
| 8 | **Industrial integration** | A Modbus/TCP server so a plant SCADA system or PLC can read the health index directly, no dashboard required |
| 9 | **Escalation** | Email alerts on confirmed state changes, carrying the actual evidence (not just "critical") |

Every one of these is **built, running, and self-tested** right now — nothing
above is a mockup or a slide-only claim. See §13 for exactly which parts run
on real data versus simulated data, stated with zero spin.

---

## 3. How it works — the architecture

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

### Data flow, in words

1. Five sensors (real or simulated — identical code path either way) each
   produce a `Reading` and publish it to an MQTT topic.
2. A camera feed runs a YOLOv8n model at the edge, publishing detections to
   the same bus.
3. The backend ingests everything, fuses it into one explainable health score
   twice a second, persists it, and pushes it to every connected client over
   WebSocket.
4. The operator dashboard renders that as a live 3D twin plus an inspector
   panel; a Modbus/TCP bridge exposes the same numbers to plant SCADA; an
   alerting module escalates by email on confirmed state changes.

### The five engineering principles this was built on

**1. Hardware abstraction at a single boundary.**
Every sensor — real or simulated — is a `DataSource` returning `Reading`
objects. Going from simulation to a physical sensor means writing **one new
class**; nothing downstream (bus, fusion, dashboard, SCADA bridge) is touched.
This is the single decision that makes "software-first, hardware-deferred"
actually credible rather than a slide-only claim — see §12 for the concrete
swap procedure and bill of materials.

**2. Physically-coupled simulation, not five independent noise generators.**
All five simulated channels are driven by **one shared belt physics model**.
A degrading splice simultaneously raises impulsive vibration, raises local
temperature through friction, raises acoustic emission, and reduces belt
tension — phase-locked to the actual belt revolution — because that's what
happens physically when one fault occurs. Independent per-channel random
noise would make sensor fusion meaningless to demonstrate, because there'd be
nothing coherent for the fusion logic to actually fuse.

**3. Explainable fusion — a rule engine, not a black-box model.**
Nobody stops a 2,000 t/h ore line on an unexplained neural-network score of
0.87. Every alarm names the indicator, its measured value, and the standard
the threshold comes from (ISO 10816-3 vibration severity bands, rolling-
element bearing kurtosis practice, grease-lubricated idler temperature
limits). A maintenance decision needs a *reason*, not a probability.

**4. Rate decoupling.**
The MQTT ingest thread just updates an in-memory snapshot; a separate 2 Hz
task does fusion, persistence, and broadcast. Acquisition rate and dashboard
rate are independent — a real Jetson publishing at 100 Hz would not change
the frontend at all.

**5. Honesty is enforced structurally, not by discipline.**
`Reading.simulated` is a *required* field on the data type, not a default you
could forget to set. It's threaded through the entire pipeline — generator →
MQTT payload → fusion → WebSocket frame → dashboard badge → Modbus register 9
→ alert subject line — so there is no code path where simulated data can
silently present as real. See §13.

---

## 4. Technology stack

### Runtime

| Component | Version | Notes |
|---|---|---|
| Python | 3.13.9 | Backend, simulation, ML, SCADA bridge |
| Node.js | 24.x | Dashboard build tooling |
| Target edge device | NVIDIA Jetson Nano 4GB (B01) | Deployment target; not yet procured |
| Development GPU | NVIDIA RTX 5060 Laptop (8 GB) | Model training |

### Machine learning & computer vision

| Package | Purpose |
|---|---|
| PyTorch / torchvision | Model training |
| Ultralytics (YOLOv8) | Training pipeline and ONNX export |
| ONNX / ONNX Runtime | Model interchange format and production inference |
| OpenCV | Frame capture, annotation, MJPEG streaming |
| scikit-learn | Isolation Forest anomaly detection, Random Forest classification |
| SciPy | Reading the CWRU bearing dataset's `.mat` files |
| NumPy | Signal synthesis and feature extraction |
| Roboflow | Dataset acquisition |

### Backend & messaging

| Package | Purpose |
|---|---|
| FastAPI | REST API and WebSocket server |
| Uvicorn | ASGI server |
| amqtt | Pure-Python MQTT 3.1.1 broker |
| paho-mqtt | MQTT client (publishers and subscriber) |
| pymodbus | Modbus client — used to *verify* our own hand-written server, not to run it |
| SQLite (WAL mode) | Time-series persistence |
| smtplib (stdlib) | Alert delivery |

### Frontend

| Package | Purpose |
|---|---|
| React 19 + TypeScript | Interface, type-checked build |
| Vite | Build tooling and dev proxy |
| Tailwind CSS v4 | Styling |
| Recharts | Streaming time-series and RUL projection charts |
| three.js + @react-three/fiber + drei | The live 3D digital twin |
| Framer Motion | Purposeful, information-carrying animation only |

### Why these specific choices (not the obvious defaults)

| Decision | Why |
|---|---|
| **amqtt instead of Mosquitto/Docker** | Docker Desktop needs WSL2, which wasn't available and would've cost an admin install + reboot for one broker. amqtt keeps the entire setup to `pip install`. Protocol, topics, and payloads are identical — a real deployment swaps in Mosquitto by changing one hostname. |
| **SQLite instead of a dedicated time-series DB** | A demo produces 10⁵–10⁶ rows; SQLite with an index handles that with zero operational overhead. The swap point is one file (`backend/store.py`). |
| **Vite instead of Next.js** | This is a single client-side live page. Server-side rendering, routing, and React Server Components would add complexity and buy nothing. |
| **Hand-written Modbus server, pymodbus kept only as test client** | The pymodbus 3.15 server API is mid-migration and rejects writes — which is the entire job of a live bridge. Testing our server against pymodbus's independent *client* is a stronger interoperability proof than testing it against our own code. |
| **ONNX Runtime instead of CUDA PyTorch for inference** | Measured **61.8 img/s vs 30.4 img/s** — at 640px, YOLOv8n is small enough that CUDA's per-call transfer overhead outweighs its compute advantage. This also means the demo runs the *exact* artifact that would ship to the Jetson. |
| **Rule-based fusion instead of a learned scoring model** | A maintenance decision needs a citable reason. See principle 3 above. |

---

## 5. The vision model — training, dataset, and honest accuracy

### Architecture & training

| Property | Value |
|---|---|
| Architecture | YOLOv8-nano (chosen to fit a 4GB Jetson Nano) |
| Training data | 1,573 images, 3,249 annotated instances |
| Classes | `belt_joint`, `tear`, `hole`, `impact_damage`, `patch_repair` |
| Training run | 120 epochs, 57 minutes, on an RTX 5060 |
| Exported artifacts | `belt_defect.pt` (6.3 MB), `belt_defect.onnx` (12.3 MB) |
| Inference speed | ~62 images/second (ONNX Runtime, CPU-comparable path) |

### Held-out test results

| Class | Precision | Recall | mAP50 | Test instances |
|---|---|---|---|---|
| `belt_joint` | 0.944 | 1.000 | 0.995 | **7** |
| `tear` | 0.964 | 0.948 | 0.971 | 142 |
| `hole` | 0.970 | 0.855 | 0.957 | 113 |
| `impact_damage` | 0.986 | 0.968 | 0.980 | 31 |
| `patch_repair` | 0.975 | 0.976 | 0.975 | 42 |
| **Overall** | | | **0.976** | 335 |

### The caveat we say out loud before anyone asks

`belt_joint`'s 1.000 recall means **"found all 7 of 7 test instances."** One
miss would have read 0.857, and the Wilson 95% confidence lower bound on 7/7
is roughly **0.65** — the true recall could plausibly be much lower than the
headline number suggests. This is the single most important class for a
problem statement about belt *joints*, and it's the class we can honestly say
the least about. **We never cite the 0.995 figure without the n=7 next to
it.** The class is scarce at every stage of the pipeline: 60 train / 14
validation / 7 test instances, out of only 41 labelled `Belt Joint` instances
found across every public dataset we could locate. The single highest-value
piece of remaining work is roughly 100 more hand-labelled joint instances,
which would convert this from a caveat into a supportable claim.

Leakage was explicitly checked and ruled out: **zero source images are shared
between the train/validation/test splits** (verified before augmentation, so
all 489 augmented variants of any image stay inside the same split).

### Datasets used

| Dataset | Images | License | Contribution |
|---|---|---|---|
| Roboflow `sample-wy2mp/conveyor-belt-damage` | 922 | CC BY 4.0 | Belt-body defect classes (tear, hole, impact, patch) |
| Roboflow `test-yfiry/conveyor-belt-damage-ucjlj` | 325 | CC BY 4.0 | The **only** dataset found anywhere with an explicit `Belt Joint` class |

One dataset is segmentation (pixel masks), the other is bounding boxes; both
were merged as bounding-box detection so the joint-bearing set's classes
weren't lost. Classes were merged **by name, not by index** — Roboflow class
indices aren't guaranteed to line up across projects, and a silent mismatch
would train "successfully" while scoring meaninglessly. Size labels
(`Large Tear` / `Small Tear`) were deliberately collapsed to one `tear` class,
because defect severity should come from *measured* bounding-box area, not a
labeller's subjective size call.

A 2,353-image dataset that looked like the best find on paper was rejected
after verifying it via the Roboflow API rather than trusting its listing page
— it turned out to have a single non-defect class (it localises the belt, it
doesn't detect damage) and zero downloadable versions. **Lesson applied
throughout the project: verify a dataset via its API before committing to
it, never by its advertised image count.**

---

## 6. Bearing fault detection — validated on real data

The vibration indicators the system relies on (RMS, kurtosis, crest factor)
aren't just trusted on faith — they're validated against the **Case Western
Reserve University (CWRU) bearing dataset**: 1,537 windows drawn from 16 real
accelerometer recordings across four motor loads.

**Evaluation protocol matters here.** We deliberately used a **held-out
operating condition** split (train on 0/1/2 hp, test only on the unseen 3 hp)
rather than a random window split — a random split over windows cut from one
continuous recording is the standard, well-known way CWRU results get
inflated by near-duplicate slices leaking between train and test.

| Model | Result |
|---|---|
| Supervised 4-class classifier | 100% at the held-out load (identical to the random-split result — no leakage effect found) |
| **Anomaly detector, trained on healthy data only** | **100% fault detection at an unseen load, with a 3.4% false-alarm rate** |

The anomaly detector is the actually-deployable configuration: it needs only
a healthy baseline and **zero labelled faults**, which is exactly the
situation any newly-instrumented real conveyor would be in on day one.

**Honest caveat:** CWRU uses *seeded* 0.007″ defects — large, distinct, and
separable on kurtosis alone (healthy ≈2.9 vs outer-race fault ≈7.8). The
result reflects a genuinely tractable benchmark, evaluated rigorously — not
proof of a strong model against real-world progressive wear, which is
gradual and far messier. Expect materially worse numbers on a live site,
and say so before being asked.

---

## 7. Remaining Useful Life (RUL)

Reports a projected number of days until the health index crosses into
CRITICAL, with 95% confidence bounds, via **degradation-trend extrapolation**
over a median-binned health history.

**This is explicitly not a learned RUL model**, and the interface labels it
as such. A trained RUL model needs run-to-failure histories for *this exact
asset class* — a conveyor splice — and no such public dataset exists. NASA's
IMS bearing run-to-failure dataset was evaluated and deliberately rejected:
bearing run-to-failure doesn't transfer to splice failure across mechanism,
timescale, or loading, and using it anyway would produce a RUL number that
looks precise but means nothing. Trend extrapolation is what real condition-
monitoring practice actually uses when you have a health indicator but no
failure history — and the estimator **declines to produce a number at all**
when there's no discernible degradation trend, rather than guessing.

---

## 8. The sensor suite

| Channel | What it measures | Why it matters |
|---|---|---|
| **Vibration** | RMS velocity, kurtosis, crest factor | Bearing wear (BPFO/BPFI defect frequencies), impact events |
| **Temperature** | Idler bearing housing temperature | Friction heating from a failing bearing |
| **Load / tension** | Belt tension at the take-up | Splice slip, incorrect tensioning |
| **Speed** | Belt linear speed | Drive slip, tachometer cross-check |
| **Acoustic** | Sound pressure, tonal content | Squeal/tonal signatures of early bearing distress |

**Current status: all five channels are simulated** — see §13 for exactly
what that means and doesn't mean. The simulation isn't noise dressed up as
data: fault signatures are derived from **published failure physics** —
bearing defect frequencies computed from real bearing geometry (BPFO/BPFI),
first-order thermal lag modelling, 1×/2× misalignment harmonics — and all
five channels are driven by **one shared belt model**, so a degrading splice
raises vibration, temperature, and acoustic emission together, phase-locked
to the belt's actual rotation, exactly as it would physically. The proof that
this isn't just internally self-consistent fiction is §6: the same indicator
math (RMS, kurtosis, crest factor) that scores our simulated data also
correctly separates *real* bearing faults in the CWRU dataset.

---

## 9. The operator dashboard & digital twin

- **A live, solved-geometry 3D digital twin** of the conveyor (not a generic
  3D model) — the belt loop is built from exact tangent/arc geometry around
  the real pulley layout, the belt visibly scrolls at the *measured* speed,
  and the splice tracks its real position on the belt as it travels.
- **Click any component** (idler, splice, belt, take-up, tail/head pulley,
  inspection camera) to see its live evidence: which sensors feed it, why
  its score is what it is (citing the actual threshold/standard), and its
  telemetry history.
- **A live camera feed** with real-time YOLO detections overlaid, showing
  exactly what the vision model sees.
- **Health trend with a projected RUL overlay** — the prediction is a
  picture on the chart, not just a number in a side panel.
- **A Recommended Action panel**: names the repair, its location on the
  belt, and contrasts planned (~45 min) vs unplanned (8–14 h) downtime — this
  contrast *is* the project's business case, stated directly on screen.
- **An event log** of confirmed state transitions (not raw flapping data —
  a state must hold for several consecutive samples before it's logged, so
  an operator never learns to ignore the alarm list).
- Full accessibility: light/dark/high-contrast themes, adjustable text size,
  reduced-motion support (including honoring the OS-level setting), screen-
  reader-friendly state labelling (state is never colour-only), spoken status
  and alarm announcements, and opt-in voice commands.
- **"Open on phone"**: scan a QR code to open the exact same live view on a
  phone on the same network, already signed in — no second login.

---

## 10. Industrial integration

A hand-written **Modbus/TCP server** (port 5020) exposes 12 holding registers
— fused health, per-subsystem scores, belt speed, bearing temperature, a RUL
estimate, and a data-validity/heartbeat pair — so a plant's existing SCADA
system or a PLC can consume BeltGuard's output with **zero dashboard
dependency**. Verified against an independent `pymodbus` client reading it
live over TCP, not just against our own code.

The `HEARTBEAT` and `DATA_VALID` registers are deliberately separate: the
heartbeat proves the bridge process is alive, `DATA_VALID` proves the *numbers*
are current. If the backend goes down, the bridge reports `NO_DATA` with
`DATA_VALID = 0` while the heartbeat keeps ticking — a PLC acting on stale
values as if they were live is exactly the failure mode this is designed to
prevent.

---

## 11. Alerting & escalation

Real SMTP-based email escalation, triggered only on **confirmed** state
transitions (a state must hold for several consecutive samples — no flapping
spam). Every alert carries the actual fusion evidence ("bearing housing 84°C,
ISO 10816 unsatisfactory vibration"), because "CRITICAL, health 32" isn't
actionable but a named physical symptom is. With no mail server configured,
the alert is still logged with `delivered: false` rather than the system
silently pretending it sent something — an honestly-declared "off" mode, not
a hidden failure.

---

## 12. Feasibility — what it costs to go from simulation to real hardware

Because of the `DataSource` abstraction (§3, principle 1), going real is a
**substitution**, not a rewrite. Nothing downstream of the sensor layer needs
to change at all.

| Need | Part | Approx. cost (INR) |
|---|---|---|
| Edge compute | Jetson Nano 4GB (B01) | 12,000–18,000 |
| Vibration | ADXL345 (basic) or IEPE + ADC (ISO-grade) | 300 / 6,000 |
| Temperature | MLX90614 (non-contact IR — the idler is rotating) | 900 |
| Belt speed | Inductive proximity sensor + pulley target | 700 |
| Load / tension | HX711 + load cell on the take-up | 800 |
| Acoustic | I2S MEMS microphone (INMP441) | 400 |
| Camera | 1080p CSI/USB, global shutter preferred | 2,000–8,000 |
| Lighting | Diffuse LED bar | 1,500 |

**Rough total: ₹20,000–35,000 per monitoring station.**

The migration procedure itself: (1) export is already done — the ONNX model
converts to a TensorRT engine on-device with one `trtexec` command, roughly
doubling throughput at FP16 with negligible accuracy loss; (2) write one new
sensor class per physical channel, keeping the same output field names the
fusion layer already looks up by name; (3) point the publisher at the real
sensor array instead of the simulator; (4) move the broker to Mosquitto with
TLS for a real site; (5) **record a healthy baseline first** and re-tune the
site-specific calibration knobs (vision area thresholds, severity ramp
bounds, belt geometry, ambient baseline) — the CWRU result in §6 is exactly
why this works with no fault labels needed; (6) hand the existing Modbus
register map to the plant's SCADA integrator. Full procedure with code in
`docs/hardware-swap.md`.

---

## 13. What's real, what's simulated — stated with zero spin

> **The AI models are real and trained on real data. The sensor readings are
> simulated, because no physical conveyor is available to the team — and the
> system says so on screen, on the wire, and in every alert it sends.**

| Component | Status |
|---|---|
| Defect detection model | 🟢 **Real** — trained by us on 1,573 real photographs, 0.976 test mAP50 |
| Vision inference | 🟢 **Real** — real ONNX inference on real images, ~62 img/s |
| Vibration indicators | 🟢 **Validated on real data** — CWRU dataset, 100% detection / 3.4% false-alarm at an unseen load |
| Sensor readings (all 5 channels) | 🔴 **Simulated** — no physical sensors exist yet |
| Fusion & health scoring | 🟢 **Real logic, simulated inputs** — the exact rule engine that would run on a real belt |
| RUL | 🟡 **Real method, honestly limited** — real degradation-trend math, explicitly not a learned model |
| MQTT / backend / dashboard / SCADA bridge | 🟢 **Real** — production-shaped software, not mocked |
| Alerting | 🟡 **Real code, off by default** — real SMTP path, honestly reports when unconfigured |
| Jetson Nano deployment | 🔴 **Not done** — hardware not procured; artifact exported, swap path documented |
| Thermal camera | 🔴 **Not built** — overheating currently detected via the temperature sensor instead |

**This is enforced in code, not by discipline.** `Reading.simulated` is a
*required* field, not a default — a new sensor literally cannot be added
without declaring what it is. The flag propagates through every layer:
generator → MQTT payload → backend fusion → WebSocket frame → dashboard
per-source badge → Modbus register 9 → alert subject line. Alerts generated
from simulated sources say `[SIMULATED DATA]` in both the subject and the
body. **There is no configuration path that makes simulated data present as
real.**

### The demo timeline

The demonstration scenario compresses a full healthy-to-rupture failure into
**45 simulated minutes** (a real splice degrades over 2–4 weeks) — a **672×**
acceleration applied *only* to the fault ramp. Belt revolutions, thermal lag,
and bearing defect frequencies all still run at true physical rates. RUL
reports the real-world-equivalent number of days, not the compressed demo
time, so nothing implies a real belt fails in an afternoon.

---

## 14. Novelty & USP — what actually differentiates this

- **Explainable-by-construction, not explainable-after-the-fact.** The
  fusion layer is a rule engine that cites a real engineering standard for
  every alarm, rather than a black-box score with a bolted-on explanation
  layer. This is a *design* choice, not a limitation — a maintenance
  decision that can't be justified to a fitter isn't useful, however
  accurate the underlying model is.
- **A genuinely swappable hardware boundary**, proven by actually building
  the software against it rather than promising it exists. One abstract
  class, one new implementation per sensor, zero changes anywhere else in
  the stack — verified by architecture, not just claimed on a slide.
- **Physically-coupled multi-sensor simulation.** Most "simulated sensor"
  demos generate independent per-channel noise. This one drives all five
  channels off one shared physics model, so a single fault produces
  correlated symptoms across vibration, temperature, and acoustic — which is
  what makes demonstrating *sensor fusion* meaningful at all, instead of
  fusing five unrelated random numbers.
- **A structural (not promised) honesty framework.** The real-vs-simulated
  distinction is a required, type-checked field that travels through the
  entire pipeline into the UI, the wire protocol, and every alert — not a
  disclaimer on a slide that the software itself doesn't enforce.
- **Validated against real data even where the primary source is simulated.**
  The vibration indicators aren't just internally consistent with our own
  simulator — they're independently proven against a real, public bearing-
  fault dataset (CWRU), which is the actual check for whether the fusion
  logic works on real physics or only on our own synthetic assumptions.
- **A live-telemetry-driven 3D digital twin**, not a static diagram — the
  belt visibly runs at the measured speed and the splice tracks its real
  position, so the interface *is* the live system state, not a separate
  illustration of it.
- **Built for the plant it would actually go into**, not just for a judge's
  laptop: a real Modbus/TCP integration point for existing SCADA/PLC
  infrastructure, so adoption doesn't require replacing an operator's
  existing control-room tooling.

---

## 15. Impact — the actual business case

- **Downtime shape, not just downtime amount.** The core value proposition
  is converting an *unplanned* 8–14 hour stoppage into a *planned* ~45-minute
  repair scheduled within the next shift — the dashboard states this
  contrast directly, because it's the number that actually matters to a
  plant operator, not the health score itself.
- **Safety.** An in-place emergency splice repair on a live line is
  hazardous work done under time pressure after something has already gone
  wrong. Predictive maintenance turns that into a scheduled, planned job.
- **No fault labels required to deploy.** Because the anomaly-detection path
  works from a healthy baseline alone (§6), a newly instrumented conveyor
  doesn't need a historical archive of labelled failures to start producing
  useful alerts — a real, practical deployment blocker for most predictive-
  maintenance systems that this one is specifically designed around.
- **Low hardware cost relative to the failure it prevents.** ₹20,000–35,000
  per monitoring station (§12) against the cost of even a single unplanned
  multi-hour stoppage on a high-throughput ore line.
- **Fits into existing infrastructure**, not around it — the Modbus/SCADA
  bridge means a plant's control room doesn't need a new screen to watch;
  the data goes to the systems they already use.

---

## 16. Engineering rigor — how correctness is actually verified

Every module carries an **executable self-check that asserts its documented
claims**, not merely that it runs without crashing — a test suite that would
fail loudly if, say, a fault signature stopped matching its documented
physics, or a degradation got attributed to the wrong subsystem, or an
independent Modbus client couldn't read the register map. This runs across
the sensor physics, the fusion logic, the alerting deadband, the SCADA
bridge, the exported vision model, the CWRU validation, the MQTT round-trip,
and the full backend stack over the network with nothing stubbed out.
Frontend type safety is enforced by the TypeScript compiler and gates the
production build — a broken type is a broken build, not a runtime surprise.

Several real bugs were caught and fixed this way during development rather
than at demo time — among them: a shared SQLite connection with no lock
causing intermittent request failures under concurrent load; a vision
health score flapping between 13 and 100 twice a second because a single
camera frame was allowed to drive an alarm outright (fixed by requiring a
defect to persist across a window of frames); and an alert-escalation rate
limit that was silently swallowing "recovered" notices, leaving a false
impression that a fixed belt was still down.

---

## 17. Known limitations — said before anyone asks

1. **`belt_joint` detection is validated on only 7 test instances** (§5).
   The headline mAP50 of 0.995 should never be quoted without that sample
   size attached.
2. **CWRU's 100% bearing-fault result is an easy benchmark**, not proof of a
   strong model against real, gradual wear (§6).
3. **The demo timeline is artificially accelerated 672×** for the fault
   ramp specifically (§13) — clearly labelled, never implied as real-time.
4. **No physical hardware has been built or tested** — Jetson deployment,
   real sensors, and a real camera rig are all deferred; the abstraction and
   migration path are built and documented, but the actual swap hasn't
   happened (§12).
5. **Thermal imaging is in the problem statement's scope but not built** —
   overheating is currently inferred from the temperature sensor instead of
   a dedicated thermal camera.
6. **RUL is trend extrapolation, not a learned prediction model** (§7) — by
   deliberate choice, since no honest training data exists for this failure
   mode, not as an unstated shortcut.
7. **Downtime figures (45 min planned / 8–14 h unplanned) are
   industry-typical estimates**, not measurements taken on this specific
   equipment — labelled as such in the dashboard itself.

---

## 18. What's deferred, and why

| Item | Reason |
|---|---|
| Jetson Nano deployment | Hardware not yet procured. ONNX artifact is already exported; migration path is fully documented and requires no model retraining. |
| Physical sensor instrumentation | Not yet procured. Bill of materials and wiring specified in `docs/hardware-swap.md`. |
| Thermal imaging camera | Within the problem statement's scope; substituted with the temperature sensor channel for now. |
| `belt_joint` dataset expansion | Highest-value remaining work — roughly 100 additional hand-labelled instances would convert the project's main caveat into a fully supportable claim. |

---

## 19. One-paragraph summary (for an opening slide)

> Belt conveyors in iron ore mining fail catastrophically and without warning
> at the splice joint, turning a preventable problem into hours-to-days of
> unplanned downtime. BeltGuard fuses a real, self-trained computer-vision
> model (0.976 mAP50 across five defect classes) with five physically-coupled
> sensor channels into a single explainable health score, backed by an
> anomaly detector validated on a real public bearing-fault dataset (100%
> detection, 3.4% false alarms, on data it never trained on). It tells an
> operator exactly what's wrong, where, and how long they have — through a
> live 3D digital twin, a real SCADA/Modbus integration point, and
> evidence-carrying email alerts — all built software-first against a
> hardware abstraction proven by actually building against it, so the ~₹20–
> 35k per-station hardware swap to a real conveyor is a substitution, not a
> rewrite. Every claim above that rests on simulated rather than real sensor
> data is labelled that way in the software itself, not just in this
> document.

---

*For the complete, unabridged engineering history — every decision, every bug
found and fixed, every dataset considered and rejected, with full reasoning
— see [`context.md`](../context.md). For the component-by-component honesty
breakdown, see [`real-vs-simulated.md`](real-vs-simulated.md). For the exact
hardware migration procedure, see [`hardware-swap.md`](hardware-swap.md).*
