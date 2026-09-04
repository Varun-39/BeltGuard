# PROJECT CONTEXT — Conveyor Belt Joint Rupture Detection System (SIH 26008)

> This file is the single source of truth for project state. Claude must read this file fully before starting work each session, and must update it after every meaningful change (new module built, decision made, dataset chosen, blocker hit). Never let this file go stale — treat it as the project's memory across sessions.

---

## 1. Problem Statement Reference

- **PS ID:** 26008
- **Title:** Belt Joint Rupture and Conveyor Belt Damages in Iron Ore Mining Industry — Intelligent Monitoring and Prediction
- **Organization:** Ministry of Steel
- **Department:** NMDC
- **Category:** Hardware
- **Theme:** Smart Automation
- **Core ask:** Build an intelligent, real-time, AI/IoT-based system to detect early-stage degradation of conveyor belt joints and belt body (cracks, tears, splice failure, misalignment, overheating) before rupture occurs, shifting maintenance from reactive to predictive.

## 2. Current Build Constraint (IMPORTANT)

- **No physical hardware is currently available** — no Jetson Nano in hand yet, no sensors, no camera, no belt rig.
- The project is being built **software-first, hardware-deferred**: every component must work end-to-end on simulated/public data now, and be swappable to real hardware later with minimal code change.
- Target edge device (once sourced): **NVIDIA Jetson Nano (4GB, B01)**.
- Do not assume hardware is present anywhere in code — always build an abstraction layer (e.g., a `DataSource` interface) so a simulated sensor feed and a real sensor feed are interchangeable.

## 3. System Scope (full vision, for reference — not all built yet)

1. IoT sensor layer: vibration, temperature, load/tension, belt tracking/misalignment, speed, acoustic
2. Vision layer: RGB camera (crack/tear/splice detection) + thermal camera (overheating detection)
3. Edge AI inference on Jetson Nano (TensorRT-optimized model)
4. Sensor fusion + rule-based/ML-based health scoring
5. Predictive analytics / Remaining Useful Life (RUL) estimation
6. Real-time dashboard with alerts (Normal / Warning / Critical)
7. Digital twin visualization
8. SCADA/PLC integration (simulated via Modbus for now)
9. Notification system (email/SMS escalation)

**Drone-based inspection is explicitly OUT of scope for this build.**

## 4. What We're Building RIGHT NOW (no-hardware phase)

- [ ] Vision defect-detection model (trained on public/adapted datasets, exportable to ONNX)
- [ ] Simulated sensor data generator (vibration, temperature, load, speed, acoustic — with injected fault patterns)
- [ ] MQTT pipeline (simulated publishers → broker → subscriber)
- [ ] Backend API + time-series storage
- [ ] Sensor fusion / health-scoring logic
- [ ] Predictive/anomaly detection model (using public bearing/vibration datasets as stand-ins, e.g. NASA/CWRU bearing datasets)
- [ ] Real-time dashboard (live simulated data + live webcam-based vision demo)
- [ ] Digital twin (basic 2D/3D visualization bound to simulated data)
- [ ] SCADA/PLC integration simulated via a Modbus simulator
- [ ] Clear abstraction layer so every simulated component can be swapped for real hardware later without rearchitecting

## 5. Tech Stack Decisions Log

> Update this section every time a technology choice is finalized. Include the date and one-line reason.

| Layer | Choice | Reason | Status |
|---|---|---|---|
| Edge AI target | Jetson Nano 4GB | Chosen by team, hardware category PS | Confirmed, not yet in hand |
| Dev machine | Win 11, RTX 5060 Laptop 8GB, Py 3.13.9, Node 24, Docker 29 | Local GPU makes YOLO training feasible without cloud | Confirmed 2026-09-04 |
| Vision model | YOLOv8-nano (ultralytics) → ONNX export | ONNX is the exact handoff path to TensorRT on Nano; nano fits 4GB | Decided 2026-09-04 |
| Messaging | MQTT (Mosquitto in Docker) | Real protocol a Jetson would publish on; sim + real sensors share one bus | Decided 2026-09-04 |
| Time-series store | SQLite (WAL mode) | Demo-scale data; InfluxDB adds an ops surface for zero demo benefit. Swap path documented in docs/ | Decided 2026-09-04 |
| Backend | FastAPI + WebSocket push | Async, fast, WS gives the dashboard live streaming without polling | Decided 2026-09-04 |
| Dashboard | Next.js + Tailwind + shadcn/ui + Recharts + Motion | Custom UI needed to clear the "not another Grafana screenshot" bar | Decided 2026-09-04 |
| Digital twin | react-three-fiber (Three.js) inside the same Next app | One app, zero install for judges, shares the same live WS feed | Decided 2026-09-04 |
| SCADA/PLC sim | pymodbus TCP server | Standard industrial handoff; documents the real-SCADA mapping | Decided 2026-09-04 |

## 6. Datasets Found / In Use

> Log every dataset considered, whether it was used, and why.

| Dataset | Purpose | Source | Used? | Notes |
|---|---|---|---|---|
| Conveyor-belt-damage (sample-wy2mp) | Vision — belt body defects | Roboflow Universe `sample-wy2mp/conveyor-belt-damage` | **YES — primary** | Verified via API 2026-09-04: **922 images, CC BY 4.0, 1 version, instance-segmentation.** Useful classes: Tear 689, patch work 405, impact damage 283, Puncture 120, Hole 42. Largest genuinely-useful belt defect set found. |
| Conveyor Belt Damage (test-yfiry) | Vision — **belt joint** | Roboflow Universe `test-yfiry/conveyor-belt-damage-ucjlj` | **YES — merged in** | Verified via API: **325 images, CC BY 4.0, 1 version.** Classes: Small Hole 232, Small Tear 212, Large Hole 205, Large Tear 188, **Belt Joint 41**. Only dataset found anywhere with an explicit *Belt Joint* class — indispensable given PS 26008 is about joints. 41 instances is thin; augmentation + a possible hand-labelled top-up is an open item. |
| Conveyor Belt Damage Detection (cctv-tarjun) | Vision | Roboflow Universe `cctv-tarjun/conveyor-belt-damage-detection-bvgsj-dk03r` | **NO — rejected** | Looked like the biggest win at 2,353 images, but API check showed it has **one class, `conveyor-belt`** (it localises the belt, it does not detect damage) and **`versions: 0`**, so nothing is downloadable. Image count alone would have been a misleading metric. |
| conveyor belt tear (samruddhi-uxs8x) | Vision — tear only | Roboflow Universe `samruddhi-uxs8x/conveyor-belt-tear` | Not yet | ~700 imgs, single-concept. Held in reserve as a top-up for the `tear` class if recall is weak after first training run. |
| NASA IMS Bearing (Univ. of Cincinnati) | Vibration — run-to-failure / RUL | data.gov `ims-bearings` | **Primary for RUL** | Run-to-failure at 20kHz, 2000 RPM. The only found dataset with true degradation-over-time, which is what RUL needs. |
| CWRU Bearing Fault | Vibration — fault classification | Case Western Reserve Univ. | **Primary for classification** | 12/48kHz DE/FE accelerometer, labelled fault types. Benchmark standard; gives us real fault *signatures* to shape the simulator with. |
| _Thermal / acoustic belt data_ | Overheating, acoustic | — | **None found** | No open dataset for conveyor-specific thermal or acoustic faults located. These will be **synthetic**, with fault signatures derived from documented failure physics, and labelled SIMULATED in the UI. |

## 7. Decisions & Rationale Log

> Append-only log. Never delete old entries — strike through if superseded, but keep history visible.

- **2026-09-04 — Project gets its own git repo.** Found that `git rev-parse --show-toplevel` resolved to `C:/Users/Dell` — the entire home directory was an accidental uncommitted repo. Ran `git init` inside the project folder on branch `main` so project history is isolated. The stray home-dir repo was left untouched.
- **2026-09-04 — SQLite over InfluxDB for time-series.** A demo generates on the order of 10^5–10^6 rows; SQLite with a timestamp index handles that with zero ops overhead. InfluxDB would add a container, a query language, and a retention policy for no visible demo benefit. Swap path (same insert/query surface) documented rather than pre-built.
- **2026-09-04 — MQTT kept despite being "extra".** Unlike the DB choice, MQTT is not overhead: it is the actual boundary where a real Jetson replaces the simulator. Simulated publishers and real sensors publish to the same topics, so the hardware swap is a config change, which is the project's core non-negotiable.
- **2026-09-04 — Custom Next.js dashboard over Grafana.** Grafana is faster to build but is exactly what judges have already seen. Design quality is a scoring surface here, so the time cost is justified.
- **2026-09-04 — Always verify a dataset via the Roboflow API, never by its advertised image count.** The 2,353-image `cctv-tarjun` set looked like the best find by a wide margin; the API showed a single non-defect class and zero generated versions. Two of the four candidates were unusable for reasons invisible on the listing page.
- **2026-09-04 — Merge the two usable vision datasets as BOUNDING-BOX detection, not segmentation.** The larger set (922) is segmentation, the joint-bearing set (325) is boxes. Training seg alone would mean dropping the `Belt Joint` class, which is unacceptable for a problem statement about belt joints. Polygons convert down to boxes losslessly-enough for this purpose; boxes do not convert up. Cost accepted: we lose pixel-accurate damage area.
- **2026-09-04 — Unified 5-class taxonomy, with size dropped as a label.** `belt_joint`, `tear`, `hole`, `impact_damage`, `patch_repair`. The source sets' `Large Tear`/`Small Tear` distinction is collapsed because severity should be derived from measured box area, not from a labeller's subjective size call. `Human`, `Roller`, `Conveyor`, `Other Objects` are dropped as non-defects.
- **2026-09-04 — Synthetic sensor data is signature-driven, not noise-driven.** Where a real dataset exists (vibration), fault signatures are extracted from CWRU/IMS and used to shape the generator. Where none exists (thermal, acoustic), signatures come from documented failure physics. Random noise alone would not survive a judge's question.

## 8. Known Blockers / Open Questions

- **`Belt Joint` has only 41 labelled instances** across all datasets found. This is the single most important class for PS 26008 and it is the rarest. Mitigation plan: heavy augmentation, class-weighted loss, and honest reporting of per-class recall rather than a flattering overall mAP. May need hand-labelling a top-up set.
- **`ui-ux-pro-max-skill` is NOT available in this environment.** Confirmed: absent from the session skill roster, and a plugin-catalog search returned zero results. Installing it needs `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` from an **interactive `claude` terminal** — the desktop Code tab cannot run plugin dialogs. Until then the design-quality bar is enforced via the `frontend-design` and `design:*` skills instead. **Flagged to user, not silently skipped.**
- **PyTorch installed is `2.11.0+cpu`** while the machine has an RTX 5060 (Blackwell, sm_120). GPU training needs a CUDA 12.8+ build (~2.5 GB download). Awaiting user go-ahead.
- **Roboflow dataset pages return HTTP 403 to automated fetch.** Exact image counts, class lists and licenses must be confirmed via the Roboflow API (needs a free API key) or a manual browser check before a dataset is committed to.
- **No physical hardware.** Standing constraint, not a blocker for this phase.

## 9. File/Folder Structure

```
SIH'26/
├── context.md          # this file — project memory
├── vision/             # defect detection: dataset prep, training, ONNX export, webcam demo
│   ├── data/           # gitignored — downloaded datasets
│   ├── models/         # gitignored — .pt / .onnx weights
│   └── scripts/
├── sensors_sim/        # DataSource abstraction + simulated vibration/temp/load/speed/acoustic
├── backend/            # FastAPI: MQTT subscriber, SQLite store, fusion + health scoring, WS push
├── dashboard/          # Next.js app (live view, alerts, trends) — also hosts the digital twin
├── digital_twin/       # r3f scene assets/components (consumed by dashboard)
├── scada_sim/          # pymodbus TCP server exposing health state to a mock SCADA
└── docs/               # architecture, hardware-swap guide, real-vs-simulated honesty doc
```

## 10. Demo Narrative (for SIH presentation)

- What is genuinely working live vs. simulated must always be stated honestly here, so the pitch never overclaims.
- **Current honest status (2026-09-04):** Repo scaffolded on its own git repo. Sensor simulation layer **built and passing 7 physics self-checks** — vibration/temperature/load/speed/acoustic driven by one shared belt model, every reading structurally flagged `simulated=True`. Vision datasets verified via API and licensing confirmed (CC BY 4.0). **Not yet running:** no model trained, no MQTT bus, no backend, no dashboard. Nothing is being presented as real hardware data.

---

**Reminder to Claude:** Before ending any working session, update sections 4, 5, 6, 7, 8, and 9 with whatever changed. This file should always let a fresh session pick up exactly where the last one left off with zero re-explaining needed from the user.
