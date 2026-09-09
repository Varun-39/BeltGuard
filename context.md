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

- [x] **Vision defect-detection model** — YOLOv8n trained 120 epochs (57 min, RTX 5060). Test mAP50 **0.976** overall. `belt_defect.pt` (6.3 MB) + `belt_defect.onnx` (12.3 MB) in `vision/models/`. **Caveat: belt_joint validated on only 7 test instances — see blockers.**
- [x] **Simulated sensor data generator** — 5 sensors on one shared `BeltModel`; 7 physics self-checks passing
- [x] **MQTT pipeline** — amqtt broker + scenario publisher + subscriber round-trip verified end-to-end (`infra/test_mqtt_roundtrip.py`)
- [x] **Backend API + SQLite time-series store** — MQTT ingest, 2 Hz fusion/broadcast, REST + WebSocket; full-stack test passing
- [x] **Vision service** — ONNX inference, MJPEG stream, publishes detections to the same MQTT bus
- [x] **Sensor fusion / health scoring** — explainable rule engine, 7 end-to-end checks passing incl. correct causal attribution
- [x] **Predictive layer** — CWRU real-data validation of our vibration indicators (held-out-load split) + healthy-only anomaly detector + degradation-trend RUL with confidence bands
- [x] **Real-time dashboard** — Vite+React+Tailwind, live WebSocket, health gauge, streaming charts, MJPEG camera, evidence panel, RUL
- [x] **Digital twin** — react-three-fiber, troughed belt geometry driven by live telemetry (belt scrolls at measured speed, splice tracks real belt phase, idler colour = bearing health)
- [x] **SCADA/PLC integration** — hand-written Modbus/TCP server (12-register map), polls the backend at 1 Hz; 8 checks incl. a real pymodbus client reading it over TCP
- [x] **Notification / escalation** — `backend/notify.py`, stdlib SMTP, deadbanded state transitions carrying the fusion evidence; 8 checks. Unconfigured SMTP is a supported, clearly-declared mode
- [x] **Abstraction layer** — `DataSource` ABC + required `Reading.simulated` flag

## 5. Tech Stack Decisions Log

> Update this section every time a technology choice is finalized. Include the date and one-line reason.

| Layer | Choice | Reason | Status |
|---|---|---|---|
| Edge AI target | Jetson Nano 4GB | Chosen by team, hardware category PS | Confirmed, not yet in hand |
| Dev machine | Win 11, RTX 5060 Laptop 8GB, Py 3.13.9, Node 24 (no Docker/WSL) | Local GPU makes YOLO training feasible without cloud | Confirmed 2026-09-04 |
| Vision model | YOLOv8-nano (ultralytics) → ONNX export | ONNX is the exact handoff path to TensorRT on Nano; nano fits 4GB | Decided 2026-09-04 |
| Messaging | MQTT via **amqtt** (pure Python) | ~~Mosquitto in Docker~~ — Docker Desktop needs WSL2, not installed, costs admin + reboot. amqtt keeps `pip install -r requirements.txt` as the entire setup. Same protocol/topics/payloads. | **Verified working 2026-09-04** |
| Time-series store | SQLite (WAL mode) | Demo-scale data; InfluxDB adds an ops surface for zero demo benefit. Swap path documented in docs/ | Decided 2026-09-04 |
| Backend | FastAPI + WebSocket push | Async, fast, WS gives the dashboard live streaming without polling | Decided 2026-09-04 |
| Dashboard | **Vite** + React + Tailwind v4 + Recharts | ~~Next.js + shadcn~~ — this is one client-side live page; SSR/routing/RSC contribute nothing and shadcn would supply ~2 components we'd hand-roll anyway. Vite is lighter with faster HMR. | Built 2026-09-04 |
| Digital twin | react-three-fiber inside the dashboard app | One app, zero install for judges, shares the same live WS feed | Built 2026-09-04 |
| SCADA/PLC sim | pymodbus TCP server | Standard industrial handoff; documents the real-SCADA mapping | Decided 2026-09-04 |

## 6. Datasets Found / In Use

> Log every dataset considered, whether it was used, and why.

| Dataset | Purpose | Source | Used? | Notes |
|---|---|---|---|---|
| Conveyor-belt-damage (sample-wy2mp) | Vision — belt body defects | Roboflow Universe `sample-wy2mp/conveyor-belt-damage` | **YES — primary** | Verified via API 2026-09-04: **922 images, CC BY 4.0, 1 version, instance-segmentation.** Useful classes: Tear 689, patch work 405, impact damage 283, Puncture 120, Hole 42. Largest genuinely-useful belt defect set found. |
| Conveyor Belt Damage (test-yfiry) | Vision — **belt joint** | Roboflow Universe `test-yfiry/conveyor-belt-damage-ucjlj` | **YES — merged in** | Verified via API: **325 images, CC BY 4.0, 1 version.** Classes: Small Hole 232, Small Tear 212, Large Hole 205, Large Tear 188, **Belt Joint 41**. Only dataset found anywhere with an explicit *Belt Joint* class — indispensable given PS 26008 is about joints. 41 instances is thin; augmentation + a possible hand-labelled top-up is an open item. |
| Conveyor Belt Damage Detection (cctv-tarjun) | Vision | Roboflow Universe `cctv-tarjun/conveyor-belt-damage-detection-bvgsj-dk03r` | **NO — rejected** | Looked like the biggest win at 2,353 images, but API check showed it has **one class, `conveyor-belt`** (it localises the belt, it does not detect damage) and **`versions: 0`**, so nothing is downloadable. Image count alone would have been a misleading metric. |
| conveyor belt tear (samruddhi-uxs8x) | Vision — tear only | Roboflow Universe `samruddhi-uxs8x/conveyor-belt-tear` | Not yet | ~700 imgs, single-concept. Held in reserve as a top-up for the `tear` class if recall is weak after first training run. |
| NASA IMS Bearing (Univ. of Cincinnati) | Run-to-failure / RUL | data.gov `ims-bearings` | **NO — deliberately not used** | ~6 GB, and it is bearing run-to-failure. A conveyor splice fails by a different mechanism, on a different timescale, under different loading — an IMS-trained RUL model would be transferring across a gap wide enough to make its numbers dishonest. We use degradation-trend extrapolation instead and say so. Revisit if we ever get real belt run-to-failure history. |
| CWRU Bearing Fault | Vibration — **validates our indicators on real data** | `engineering.case.edu/sites/default/files/<n>.mat` (direct download, no auth) | **YES — in use** | 16 recordings: normal + inner_race + ball + outer_race, each at 0/1/2/3 hp, 12 kHz DE, 0.007in seeded defects. 1,537 windows. Used to prove RMS/kurtosis/crest-factor separate REAL faults, not just our simulator's. |
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

- **2026-09-04 — Fusion is a rule engine, not a model.** Nobody stops a 2,000 t/h ore line on an unexplained 0.87. Every alarm emits the indicator, its measured value, and the standard behind the threshold (ISO 10816-3, bearing kurtosis rules, idler temperature practice). The planned ML anomaly/RUL layer sits *alongside* this as a catcher of unanticipated patterns, never replacing the explainable backbone.
- **2026-09-04 — Evidence combines by noisy-OR, `1 - prod(1-s)`.** Chosen over `max()` because corroboration should count (three indicators at 0.5 is worse than one at 0.5) and over `mean()` because averaging lets healthy channels dilute one genuinely alarming one.
- **2026-09-04 — CALIBRATION FIX: severity ramps top out at the physical worst case, not the alarm level.** First version anchored each ramp's upper bound near its alarm threshold, which pinned severity to 1.0 the instant a channel alarmed — the health score saturated at ~10/100 by the midpoint and the entire back half of the degradation timeline looked identical. Alarm placement is the job of the NORMAL/WARNING/CRITICAL bands. These bounds are the per-site tuning knob a real installation would adjust.

- **2026-09-04 — Heavy vision artifacts live outside the repo, at `%LOCALAPPDATA%\sih26\`.** The project sits under OneDrive, and OneDrive syncs by folder tree — it does not read `.gitignore`. A 141 MB dataset plus per-epoch checkpoints were being re-uploaded continuously, burning quota and bandwidth *and* throttling training. `%LOCALAPPDATA%` is never synced and is the conventional Windows home for regenerable data — and this data is regenerable, `prepare_dataset.py` re-downloads it. Resolved from the environment (not hardcoded to this user) via `vision/paths.py`, overridable with `SIH_DATA_DIR`. Final `.pt`/`.onnx` stay in the repo: small, and worth having backed up. Measured effect: 3.4x faster training.

- **2026-09-04 — Vision service runs ONNX, not the CUDA `.pt`, and it is measurably faster.** Benchmarked on 40 pre-loaded test frames: **ONNX 61.8 img/s vs CUDA .pt 30.4 img/s**. YOLOv8n at 640px is small enough that CUDA's per-call transfer/sync overhead outweighs its compute advantage on single frames. This also means the demo exercises the exact artifact that ships to the Nano. An auto-selecting dual-backend was built and then deleted once measured — it solved a problem that did not exist.
- **2026-09-04 — MEASURE BEFORE OPTIMISING (recorded because it nearly cost us).** An early benchmark showed ONNX at ~7 img/s and triggered an onnxruntime-gpu install that corrupted numpy. That benchmark did a `cv2.imread` per image: it was measuring **disk, not inference**. Real figure is 61.8 img/s.
- ~~**2026-09-04 — `_yolo_path` exists because of the apostrophe in `SIH'26`.**~~ **SUPERSEDED 2026-09-04 by the folder rename to `beltguard`; workaround deleted.** Original entry: ultralytics strips apostrophes from absolute `.pt` paths and then fails with FileNotFoundError on `SIH26\...`; `torch.load` and `check_file` handle the same path fine, so the bug is inside ultralytics' `.pt` loader. A cwd-relative path avoids it. **Latent hazard: expect the apostrophe to bite again in npm/Next.js tooling at the dashboard stage.**

- **2026-09-04 — CWRU evaluated by held-out OPERATING CONDITION, not a random window split.** A random split over windows cut from one continuous recording puts near-duplicate slices in train and test, which is the standard way CWRU results get inflated. We train on 0/1/2 hp and test only on the unseen 3 hp. Both numbers are printed. **They came out identical (100% / 100%, gap 0.0)** — the leakage concern was real but did not materialise here. The honest caveat is different: CWRU's seeded 0.007in defects are large and distinct (separable on kurtosis alone, normal ~2.9 vs outer_race ~7.8), so 100% reflects an easy benchmark, not a strong model. Real idler wear is gradual and messier.
- **2026-09-04 — RUL is degradation-trend extrapolation, and is labelled as such everywhere.** Not a learned RUL model — that needs run-to-failure history for *this* asset class, which nobody has for a conveyor splice. Trend extrapolation is what condition-monitoring practice actually uses when you have a health indicator and no failure history. It refuses to answer on a flat trend, reports a confidence interval rather than a point estimate, and fits only a recent window because degradation accelerates.
- **2026-09-04 — `DEMO_ACCELERATION` makes the compressed timeline explicit.** The scenario ramps a full healthy->rupture failure in 45 simulated minutes so a demo is watchable; a real splice takes 2-4 weeks. The constant (672x) is applied to the *fault ramp only* — belt revolutions, thermal lag and bearing defect frequencies still run at real rates — and RUL reports the real-world equivalent alongside sim time so nobody infers that belts fail in an afternoon.

- **2026-09-04 — Project renamed `SIH'26` -> `beltguard`; product name BeltGuard.** The apostrophe was not cosmetic: it broke ultralytics `.pt` loading outright, and npm/Next.js were the next likely victims. Renaming was the root-cause fix rather than accumulating per-tool workarounds. Backend also moved off port 8000 (owned by another local project) to **8010**.

- **2026-09-04 — Dashboard design taken from `ui-ux-pro-max`, with two deliberate departures.** Used its palette (#0F172A/#1B2336 dark tech + status green), Fira Sans/Fira Code pairing and dense-dashboard spacing. Departed on (a) **glassmorphism** — it was the recommended style, but frosted blur in a safety-critical control room trades legibility for decoration, so panels are solid with 1px borders; (b) **Next.js** — see stack table. Kept its accessibility requirement strictly: **status is never conveyed by colour alone** (every state carries a text label and a distinct glyph ● ▲ ■), and the streaming view has a Pause control.
- **2026-09-04 — VISION EVIDENCE NEEDS TEMPORAL PERSISTENCE (real bug found via the dashboard).** Scoring the instantaneous camera detection made the health index flap between 13 and 100 twice a second, because each frame's detection instantly drove `belt_body`. That is wrong for the real system too: a single frame from a camera on a vibrating conveyor must never drive a maintenance alarm. The backend now aggregates detections over a 6 s window, requires a class to appear in >=40% of recent frames before it counts, and uses the **median** area rather than the worst frame. Health swing over 20 samples dropped ~87 -> ~38, with the remainder being genuine degradation.
- **2026-09-04 — RUL must smooth before fitting.** Raw 2 Hz health carries real per-sample flicker; fitting a line straight through it produced r^2 0.04 and a nonsense 1874 points/hour trend. `_bin_median` bins to a median per time bucket first. Median not mean, so one frame catching a large tear cannot drag the whole trend.
- **2026-09-04 — Vision area thresholds are a COMMISSIONING PARAMETER, not a constant.** `_vision_evidence` bounds assume a wide-angle camera seeing full belt width, where a serious tear is a few percent of frame. The `--source testset` images are macro shots of damaged belts (area_frac up to 0.58), so they saturate every threshold and read belt_body as failed continuously — correctly for that framing. Mount height, lens and belt width all move these numbers.

- **2026-09-04 — Dashboard now answers "so what do I do?", not just "what is the state?".** Three additions: (a) the health trend projects the RUL trend forward as a dashed line with 95% bounds and a marked CRITICAL crossing, so "predictive" is a picture rather than a side-panel number; (b) a **Recommended Action** panel naming the repair, the location, the schedule window, and the planned-vs-unplanned downtime contrast — that contrast is the project's business case and nothing else on screen stated it; (c) an **Event Log** of confirmed state transitions. The event log is derived client-side from `/api/health/history`, which already existed — no new table, no new endpoint.
- **2026-09-04 — Alarm deadband on the event log.** Health hovering on the 80 threshold produced `NORMAL -> WARNING -> NORMAL` flapping. A new state must now hold for 4 consecutive samples before it is logged. An alarm list that flaps is the classic way operators learn to ignore one.
- **2026-09-04 — BUG: SQLite connection was shared across three threads with no lock.** `check_same_thread=False` permits cross-thread use but does NOT make a connection concurrency-safe; the MQTT callback thread, the asyncio broadcast task and FastAPI's handler threads interleaved statements and raised `sqlite3.InterfaceError: bad parameter or other API misuse` mid-query, surfacing as intermittent 500s on `/api/history`. The original comment claiming "writes are serialised by the connection's own lock" was simply wrong. Fixed with one `threading.Lock` around every statement; verified with 50 concurrent requests, all 200, zero errors.
- **2026-09-04 — BUG: three.js cannot parse CSS custom properties.** The digital twin passed `var(--color-ok)` tokens straight into materials, logging `THREE.Color: Unknown color model` every frame. `cssColor()` resolves tokens to literals for the WebGL side only, so `index.css` stays the single source of truth for the palette.
- **2026-09-04 — The embedded preview pane does not composite the WebGL canvas into screenshots.** The digital twin appears blank in captures while rendering correctly; `canvas.toDataURL()` (needs `preserveDrawingBuffer: true`) is the reliable way to verify it. Recorded because it cost real time chasing a rendering bug that did not exist — a blank twin in a screenshot is not evidence the twin is broken.

- **2026-09-09 — Modbus server is hand-written; pymodbus is kept only as the test client.** pymodbus 3.15 is mid-migration: `ModbusServerContext` is deprecated and rejected our writes (`ExcCode 6`), and the replacement `SimData` pre-builds its register block with no supported way to mutate values while the server runs — which is the entire job of a live bridge. FC3/FC4 over TCP is a 7-byte header plus a 5-byte request, so serving it directly was less code than working around that. Testing our server against pymodbus's *client* is a stronger interop claim than testing it against our own.
- **2026-09-09 — Register map design: HEARTBEAT and DATA_VALID are deliberately separate.** The heartbeat proves the bridge is alive; DATA_VALID proves the numbers are fresh. On losing the backend the bridge reports `ALARM_STATE=NO_DATA`, `DATA_VALID=0`, `RUL_DAYS=65535` and keeps the beat ticking, rather than leaving stale values a PLC would act on. `RUL_DAYS=65535` means unknown, kept distinct from `0` which would mean "failing now".
- **2026-09-09 — PERFORMANCE BUG: `localhost` costs ~2 s per request on this host.** Every backend endpoint measured a uniform ~2,050 ms, which saturated the SCADA bridge's 1 Hz poll loop. Cause: `localhost` resolves to `::1` first while uvicorn binds IPv4 only, so each request waits out an IPv6 connection failure before falling back. **`127.0.0.1` measures 15 ms — 136x faster.** All Python HTTP clients now use `127.0.0.1` explicitly. Worth knowing before blaming any future latency on the backend.
- **2026-09-09 — BUG: `asyncio.create_task()` without keeping a reference.** The SCADA poller was garbage-collected mid-run; the heartbeat froze while the server kept serving stale registers — the exact failure the heartbeat exists to expose. The task handle is now retained, and the poll loop catches all exceptions and degrades to NO_DATA rather than dying silently.

- **2026-09-09 — Alerts carry evidence, and have NO time-based rate limit.** The mail includes the top contributing indicators from the fusion layer, because "CRITICAL, health 32" is not actionable while "bearing housing 84 C" tells a fitter what to bring. The first version had a 5-minute rate limit on top of the deadband; it silently swallowed the "recovered" notice, leaving anyone who got the CRITICAL mail believing the belt was still down. The deadband plus "alert once per confirmed transition" already make spam impossible, so the timer was deleted rather than special-cased.
- **2026-09-09 — Unconfigured SMTP is a supported mode, not an error.** With no mail server the alert is logged and recorded with `delivered=False`, and `/api/alerts` reports `smtp_configured`. The escalation path is demonstrable in a demo without pretending mail was sent. Alerts generated from simulated sources say `[SIMULATED DATA]` in both subject and body, so an alert can never imply a real belt is failing.

- **2026-09-09 — Alarm deadband was implemented twice, in two languages.** The dashboard's event log re-derived state transitions from health history with its own `HOLD = 4`, while `notify.py` already computed confirmed transitions with `HOLD_SAMPLES = 4` to decide what to escalate. Two copies of one rule, guaranteed to drift. `notify.py` now logs *every* confirmed transition and flags which ones warrant a mail (`notified`); the dashboard reads `/api/alerts`. Net: less client code, one implementation, and the event log gained whether each transition actually reached a human.
- **2026-09-09 — Full dead-code review.** Removed: `seen_in` and `frames_considered` (computed into the vision payload, read by nobody), `hours_to_warning` and `WARNING_LEVEL` (computed and returned by RUL, consumed nowhere), and `Rul.method` in TypeScript (declared, rendered nowhere). Verified clean and kept: all FastAPI route handlers (referenced by decorator, not name), `.oxlintrc.json` (wired to `npm run lint`), `Detection` type, `/api/status` (ops endpoint, covered by `test_backend`).
- **2026-09-09 — `predictive/cwru.py` had no assertions.** It carried the project's strongest claim — that our indicators separate *real* faults — while being the only non-trivial module that could not fail. It now asserts kurtosis still separates outer-race faults, held-out-load accuracy stays above 0.90, false alarms stay under 15%, and the download produced enough windows.
- **2026-09-09 — Added `.env.example`.** `.env` is gitignored, so `ROBOFLOW_API_KEY`, `SIH_DATA_DIR` and the `SMTP_*`/`ALERT_*` variables were undiscoverable for anyone cloning the repo; they had been documented in three separate files and nowhere together.

- **2026-09-10 — Motion added, with a rule: animation must carry information.** Motion (motion.dev) for React, chosen over adding anime.js alongside it — two animation runtimes doing one job is bloat, not polish. All motion primitives live in `dashboard/src/components/motion.tsx` under one reduced-motion policy. What each animation *means*: animated numbers convey **direction and magnitude** of change (a health index snapping 76->61 reads as a glitch; one that visibly falls reads as deterioration); `AnimatePresence` on the evidence and event lists shows **what** changed, not just that the list differs; the gauge needle uses a spring because a real analog gauge has mass; the header status chip pulses on escalation so a state change registers even if the operator was looking elsewhere. Panel reveal is first-paint only — re-animating on every 2 Hz tick would make the dashboard twitch.
- **2026-09-10 — Three motion constraints enforced throughout.** (a) Exit is faster than entry (160 ms vs 340 ms) — arriving deserves a beat, leaving should get out of the way. (b) Transform and opacity only; subsystem bars and severity bars animate `scaleX`, never `width`, so nothing relayouts twice a second. (c) `prefers-reduced-motion` is a hard off, not a slowdown — and the CRITICAL alarm edge degrades to a *static* red border rather than vanishing, so the safety signal survives the setting.
- **2026-09-10 — CRITICAL alarm treatment sits on the viewport frame, not a panel.** A slow breathing red edge at `z-50`, readable from across a room at an angle by someone not looking directly at the screen — which is the actual condition of a control room.

- **2026-09-10 — Redesigned on Apple's Liquid Glass language.** Palette moved to Apple system colours (systemGreen/Orange/Red/Blue/Purple), type to Inter (closest free SF Pro analogue) + JetBrains Mono for telemetry, radii to 22/16/11 px. Glass is four stacked cues, not just blur: `saturate(180%) brightness(112%)` on the backdrop for vibrancy, a near-transparent vertical tint for body, `inset 0 1px rgba(255,255,255,0.55)` for the specular top edge, and an inset ring plus deep outer shadow for thickness. **The specular edge is what sells it** — blur alone reads as a frosted div.
- **2026-09-10 — The aurora field exists so the glass has something to refract.** Four slowly drifting colour wells behind everything. Over a flat dark fill `backdrop-filter` has nothing to bend and every glass panel collapses into a grey rectangle; this is the single most-missed prerequisite of glassmorphism.
- **2026-09-10 — Real chromatic refraction via SVG (`components/Glass.tsx`).** One `feTurbulence` field sampled by three `feDisplacementMap` passes at staggered scales (26/17/9), each isolated to one channel with `feColorMatrix`, recombined with `feBlend mode="screen"` — red bends most, blue least, as in a real lens. Fed to `backdrop-filter: url(#lg-refract)`. `colorInterpolationFilters="sRGB"` is mandatory and **must be camelCase in React**; the hyphenated SVG spelling is rejected as an invalid DOM prop and the filter silently runs in linearRGB.
- **2026-09-10 — BUG: a backdrop-filtered ANCESTOR breaks react-three-fiber's canvas sizing.** The digital twin went blank after the glass redesign: r3f measured its container as zero, left the canvas at its 300x150 default, and rendered nothing. Proven by toggling `backdrop-filter: none` at runtime, after which the canvas immediately sized to 809x474. Fix is a `.glass-solid` variant — identical radius, specular edge and shadow, no backdrop-filter — used via `<Panel solid>` for any panel hosting WebGL. This also matches the design rule already in force: **chrome is glass, content is opaque.**
- **2026-09-10 — BUG: `<Environment preset="city">` fetches an HDRI from a CDN.** The fetch failed and the exception took the whole Canvas down. Replaced with an explicit light rig (three keys plus two coloured rims) and native `meshPhysicalMaterial` transmission for the splice, so the twin has zero network dependencies. A demo must never require a round-trip to render.

## 8. Known Blockers / Open Questions

- **RESULT 2026-09-04 — trained model, and the honest reading of it.** 120 epochs, 57 min. Per-class on the held-out test split:

  | class | P | R | mAP50 | test instances |
  |---|---|---|---|---|
  | belt_joint | 0.944 | 1.000 | 0.995 | **7** |
  | tear | 0.964 | 0.948 | 0.971 | 142 |
  | hole | 0.970 | 0.855 | 0.957 | 113 |
  | impact_damage | 0.986 | 0.968 | 0.980 | 31 |
  | patch_repair | 0.975 | 0.976 | 0.975 | 42 |

  **`belt_joint` recall 1.000 must NOT be quoted as-is.** It means "found all 7 of 7". One miss would have read 0.857; the Wilson 95% CI lower bound on 7/7 is ~0.65, so true recall could plausibly be 65%. The headline class for this PS is the one we can say least about. Do not put 0.995 on a slide without the n=7 next to it.
  **Leakage was checked and is clean:** 0 shared source images between train/valid/test (Roboflow split before augmenting; all 489 augmented variants stay inside train). So the other classes' scores are trustworthy.
  Splits hold belt_joint 60/14/7 (train/valid/test) — the class is scarce everywhere, not just at test time.
- **`Belt Joint` has only 41 labelled instances** across all datasets found. This is the single most important class for PS 26008 and it is the rarest. Mitigation plan: heavy augmentation, class-weighted loss, and honest reporting of per-class recall rather than a flattering overall mAP. May need hand-labelling a top-up set.
- ~~`ui-ux-pro-max-skill` is NOT available.~~ **RESOLVED 2026-09-04** — user installed it from an interactive terminal. `ui-ux-pro-max:*` skills now in the roster (design, design-system, ui-styling, slides, banner-design). Use for the dashboard stage.
- **PyTorch installed is `2.11.0+cpu`** while the machine has an RTX 5060 (Blackwell, sm_120). GPU training needs a CUDA 12.8+ build (~2.5 GB download). Awaiting user go-ahead.
- **Roboflow dataset pages return HTTP 403 to automated fetch.** Exact image counts, class lists and licenses must be confirmed via the Roboflow API (needs a free API key) or a manual browser check before a dataset is committed to.
- ~~Docker Desktop is installed but was not running.~~ **RESOLVED 2026-09-04** — root cause was that **WSL2 is not installed**, which Docker Desktop's Linux engine requires; it launched and died silently. Rather than spend an admin install + reboot on one broker, switched to amqtt. Full round-trip now verified: 260 msgs across all 5 sensor kinds, `simulated` flag intact on the wire.
- ~~The project lives on OneDrive, which is measurably slowing training.~~ **RESOLVED 2026-09-04** — heavy artifacts relocated to `%LOCALAPPDATA%\sih26\` (see decision log). Image read 3.3 -> 38.9 MB/s, epoch time ~80 s -> 23.8 s, full run ~2.5 h -> ~60 min. Ultralytics still prints its slow-access warning (its threshold is aggressive) but the bottleneck is gone.
- ~~The apostrophe in the folder name is a live hazard.~~ **RESOLVED 2026-09-04** — user renamed `SIH'26` -> **`beltguard`**. Verified after the move: venv intact, CUDA still available, and absolute `.pt` paths load correctly, so the `_yolo_path` workaround was deleted as dead code. Full suite re-run green in the new location.
- **onnxruntime CUDA EP does not load** on this machine (ORT 1.29 moved it to a separate plugin package). Irrelevant in practice — ONNX on CPU is already faster than the CUDA `.pt` here, and the Nano will use TensorRT, not onnxruntime.
- **No physical hardware.** Standing constraint, not a blocker for this phase.

## 9. File/Folder Structure

```
beltguard/
├── context.md          # this file — project memory
├── vision/             # defect detection: dataset prep, training, ONNX export, webcam demo
│   ├── paths.py        # resolves heavy-artifact locations (see decision log)
│   ├── models/         # gitignored — final .pt / .onnx weights
│   └── scripts/        # prepare_dataset.py (download+merge) | train.py (train+ONNX export)
├── sensors_sim/        # datasource.py (ABC) | belt.py (physics + 5 sensors) | run.py (scenario->MQTT)
├── backend/            # fusion.py (health scoring) + tests; FastAPI/MQTT-subscriber/SQLite still TO BUILD
├── infra/              # broker.py (amqtt) + test_mqtt_roundtrip.py
├── requirements.txt    # pinned; note the cu128 index URL for torch
├── dashboard/          # Vite+React app — live view, alerts, trends, camera, RUL
│   └── src/components/ # Panels.tsx (gauge/bars) | Telemetry.tsx (charts/evidence/RUL) | Twin.tsx (3D + camera)
├── scada_sim/          # pymodbus TCP server exposing health state to a mock SCADA
├── predictive/         # cwru.py (real-data validation) | rul.py (trend RUL)
└── docs/               # architecture, hardware-swap guide, real-vs-simulated honesty doc

Outside the repo (NOT synced by OneDrive), created by vision/paths.py:
%LOCALAPPDATA%/sih26/
├── raw/                # Roboflow downloads as-fetched
├── belt_defects/       # merged dataset, unified 5-class taxonomy
├── runs/               # training checkpoints (per-epoch churn)
└── train.log
```

## 10. Demo Narrative (for SIH presentation)

- **Current honest status (2026-09-09): feature-complete for the no-hardware phase.** All 11 checklist items in Section 4 are done. The authoritative honesty statement now lives in **`docs/real-vs-simulated.md`** — that is the document to read before pitching, not this bullet.
- One-line version: *the AI models are real and trained on real data; the sensor readings are simulated, and the system says so on screen, on the wire, and in every alert.*
- The three caveats to say out loud before a judge finds them: **belt_joint mAP50 0.995 is n=7**; **CWRU 100% is an easy seeded-defect benchmark**; **the demo timeline is accelerated 672x**.

- What is genuinely working live vs. simulated must always be stated honestly here, so the pitch never overclaims.
- **Superseded status (2026-09-04):** Repo scaffolded on its own git repo. Sensor simulation layer **built and passing 7 physics self-checks** — vibration/temperature/load/speed/acoustic driven by one shared belt model, every reading structurally flagged `simulated=True`. Vision datasets verified via API and licensing confirmed (CC BY 4.0). **Not yet running:** no model trained, no MQTT bus, no backend, no dashboard. Nothing is being presented as real hardware data.

---

**Reminder to Claude:** Before ending any working session, update sections 4, 5, 6, 7, 8, and 9 with whatever changed. This file should always let a fresh session pick up exactly where the last one left off with zero re-explaining needed from the user.
