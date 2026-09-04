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
| Vision model | TBD (likely YOLOv8-nano or lightweight custom CNN) | Needs to run real-time on Nano via TensorRT | Pending |
| Messaging | MQTT (Mosquitto) | Lightweight, standard for IoT sensor pipelines | Pending |
| Time-series DB | TBD (InfluxDB likely) | Best fit for sensor time-series | Pending |
| Backend | TBD (FastAPI likely) | Async, fast to build | Pending |
| Dashboard | TBD (Grafana for speed, or custom React for demo polish) | Depends on time budget | Pending |
| Digital twin | TBD (Three.js likely, browser-based, no engine install needed) | Judges view via browser, zero install friction | Pending |

## 6. Datasets Found / In Use

> Log every dataset considered, whether it was used, and why.

| Dataset | Purpose | Source | Used? | Notes |
|---|---|---|---|---|
| _(fill in as found)_ | | | | |

## 7. Decisions & Rationale Log

> Append-only log. Never delete old entries — strike through if superseded, but keep history visible.

- _(fill in as decisions are made)_

## 8. Known Blockers / Open Questions

> Things Claude or the team is stuck on, waiting for input on, or unsure about.

- _(fill in as they arise)_

## 9. File/Folder Structure

> Keep this updated as the actual repo structure evolves, so future sessions don't have to re-discover it.

```
(to be filled in as project scaffolding is created)
```

## 10. Demo Narrative (for SIH presentation)

- What is genuinely working live vs. simulated must always be stated honestly here, so the pitch never overclaims.
- Current honest status: _(update continuously)_

---

**Reminder to Claude:** Before ending any working session, update sections 4, 5, 6, 7, 8, and 9 with whatever changed. This file should always let a fresh session pick up exactly where the last one left off with zero re-explaining needed from the user.
