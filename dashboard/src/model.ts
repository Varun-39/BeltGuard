/** The asset, as the codebase actually knows it.
 *
 *  Every component, sensor, position and threshold here traces to a file:
 *    positions        sensors_sim/belt.py  default_array() / BeltModel
 *    indicators       backend/fusion.py    evaluate()
 *    reference lines  backend/fusion.py    the `basis` each rule cites
 *    actions          industry-typical estimates, labelled as such in the UI
 *  Nothing is added for visual completeness. A component with no sensor says
 *  so rather than borrowing numbers from a neighbour.
 */
import type { Evt, Frame } from './useLive'

export type Level = 'normal' | 'warning' | 'critical' | 'none'

export function levelFor(score: number | null | undefined): Level {
  if (score == null) return 'none'
  return score >= 80 ? 'normal' : score >= 50 ? 'warning' : 'critical'
}
export const LEVEL_LABEL: Record<Level, string> = {
  normal: 'Normal', warning: 'Warning', critical: 'Critical', none: 'No data',
}

export type Subsystem = 'joint' | 'bearing' | 'alignment' | 'belt_body'
export const SUBSYSTEM_LABEL: Record<Subsystem, string> = {
  joint: 'Splice condition',
  bearing: 'Bearing condition',
  alignment: 'Belt tracking',
  belt_body: 'Belt surface',
}

export type Metric = {
  kind: string
  field: string
  label: string
  unit: string
  digits: number
  /** Reference line, only where fusion.py cites one. */
  ref?: { value: number; label: string }
}

export const METRICS = {
  rms: { kind: 'vibration', field: 'rms_mm_s', label: 'Vibration RMS', unit: 'mm/s', digits: 2,
         ref: { value: 2.8, label: 'ISO 10816-3 acceptable' } },
  kurtosis: { kind: 'vibration', field: 'kurtosis', label: 'Kurtosis', unit: '', digits: 1,
              ref: { value: 6, label: 'incipient damage' } },
  crest: { kind: 'vibration', field: 'crest_factor', label: 'Crest factor', unit: '', digits: 1,
           ref: { value: 4.5, label: 'impact onset' } },
  temp: { kind: 'temperature', field: 'temp_c', label: 'Housing temperature', unit: '°C', digits: 1,
          ref: { value: 70, label: 'alarm' } },
  spl: { kind: 'acoustic', field: 'spl_db', label: 'Sound pressure', unit: 'dBA', digits: 1,
         ref: { value: 82, label: 'onset' } },
  tonal: { kind: 'acoustic', field: 'tonal_db', label: 'Tonal squeal', unit: 'dB', digits: 1,
           ref: { value: 1.5, label: 'onset' } },
  tension: { kind: 'load', field: 'tension_kn', label: 'Belt tension', unit: 'kN', digits: 1 },
  load: { kind: 'load', field: 'load_tph', label: 'Ore load', unit: 't/h', digits: 0 },
  speed: { kind: 'speed', field: 'speed_mps', label: 'Belt speed', unit: 'm/s', digits: 2 },
  slip: { kind: 'speed', field: 'slip_pct', label: 'Drive slip', unit: '%', digits: 2,
          ref: { value: 2, label: 'onset' } },
} satisfies Record<string, Metric>

export type MetricId = keyof typeof METRICS

export function read(frame: Frame | null | undefined, m: Metric): number | undefined {
  const v = frame?.readings?.[m.kind]?.[m.field]
  return typeof v === 'number' ? v : undefined
}

/** The instrument, named by what it is rather than its wire tag -- a reading
 *  is traced to `sensor-id` for provenance, but a person reads "Thermal
 *  sensor", not "temp-idler-04". Keyed by the sensor `kind` sensors_sim/belt.py
 *  publishes and backend/app.py echoes back in `health.sources`. */
export const SENSOR_TYPE: Record<string, string> = {
  vibration: 'Vibration sensor',       // VibrationSensor: tri-axial accelerometer
  temperature: 'Thermal sensor',       // TemperatureSensor: IR / contact probe
  load: 'Load cell',                   // LoadSensor: belt weigher + tension load cell
  speed: 'Tachometer',                 // SpeedSensor: tacho on the tail pulley
  acoustic: 'Acoustic sensor',         // AcousticSensor: microphone
}

export type PartId = 'tail' | 'takeup' | 'idler04' | 'splice' | 'belt' | 'camera' | 'head'

export type Part = {
  name: string
  kind: string
  /** One plain sentence: what this actually is/does, no conveyor jargon.
   *  `kind` stays technical (that's what an operator wants); this is for
   *  the reader who has never seen the inside of a conveyor and just asked
   *  "what even is an idler?" -- a fair question this UI wasn't answering. */
  about: string
  location: string
  subsystems: Subsystem[]
  metrics: MetricId[]
  inspection?: 'joint' | 'defects'
  note?: string
}

export const BELT_LENGTH_M = 250        // BeltModel.belt_length_m, centre to centre

export const PARTS: Record<PartId, Part> = {
  idler04: {
    name: 'Idler 04', kind: 'Carry idler set, three-roll',
    about: 'A set of rollers that the belt rides on, holding its shape and keeping it running straight.',
    location: '120 m from tail pulley',
    subsystems: ['bearing'], metrics: ['rms', 'kurtosis', 'temp', 'spl', 'tonal'],
  },
  splice: {
    name: 'Splice', kind: 'Belt joint',
    about: "The seam where the belt's two ends are joined into one continuous loop -- its weakest point.",
    location: 'Travels with the belt',
    subsystems: ['joint'], metrics: ['tension', 'crest', 'slip'],
    inspection: 'joint',
    note: 'Measured indirectly: tension loss at the take-up, impact at idler 04, slip at the tail.',
  },
  belt: {
    name: 'Belt', kind: 'Troughed conveyor belt',
    about: 'The rubber loop itself, the thing actually carrying the material.',
    location: `${BELT_LENGTH_M} m centre to centre`,
    subsystems: ['belt_body', 'alignment'], metrics: ['speed', 'tonal', 'spl'],
    inspection: 'defects',
  },
  takeup: {
    name: 'Take-up', kind: 'Take-up with tension load cell',
    about: 'Keeps the belt pulled tight as it stretches over time, so it grips the pulleys instead of slipping.',
    location: '8 m from tail pulley',
    subsystems: [], metrics: ['tension', 'load'],
  },
  tail: {
    name: 'Tail pulley', kind: 'Non-drive pulley with tachometer',
    about: 'The roller at the far end that the belt loops around -- it turns freely, the motor is at the other end.',
    location: 'Tail end, 0 m',
    subsystems: [], metrics: ['speed', 'slip'],
  },
  head: {
    name: 'Head pulley', kind: 'Drive pulley',
    about: "The motor-driven roller that actually pulls the belt around the loop -- the conveyor's engine.",
    location: `Head end, ${BELT_LENGTH_M} m`,
    subsystems: [], metrics: [],
    note: 'Not instrumented. Belt speed and drive slip are measured at the tail pulley.',
  },
  camera: {
    name: 'Inspection camera', kind: 'Fixed-mount vision camera',
    about: 'Watches the belt surface as it passes, looking for visible tears, holes or wear.',
    location: 'Head end, over the carry strand',
    subsystems: [], metrics: [], inspection: 'defects',
  },
}

export const PART_ORDER: PartId[] = ['idler04', 'splice', 'belt', 'takeup', 'tail', 'head', 'camera']

/** Where each sensor is physically bolted on -- sensors_sim/belt.py
 *  default_array(), by position_m: vibration/temperature/acoustic at 120 m
 *  (idler 04), load at 8 m (take-up), speed at 0 m (tail pulley).
 *
 *  NOT derivable from PARTS[id].metrics: the splice borrows several of these
 *  same readings as fault EVIDENCE (tension loss, impact, slip) without
 *  hosting a sensor of its own -- that is a different fact from where the
 *  hardware physically sits, and conflating them once put "Load cell" and
 *  "Tachometer" in the data-sources table at "Splice". */
export const SENSOR_PART: Record<string, PartId> = {
  vibration: 'idler04', temperature: 'idler04', acoustic: 'idler04',
  load: 'takeup', speed: 'tail',
}

/** Worst subsystem score on a part, or null if it has none. */
export function partScore(frame: Frame | null, id: PartId): number | null {
  const subs = PARTS[id].subsystems
  if (!frame || !subs.length) return null
  return Math.min(...subs.map((s) => frame.health.subsystems[s] ?? 100))
}

/** Map an alert reason back to its subsystem.
 *
 *  Alerts carry reason MESSAGES, not indicator ids. Those messages come from
 *  fixed f-string templates in fusion.evaluate(), so their leading words are
 *  stable; this table mirrors them. If a template changes there, change it
 *  here -- an unmatched message simply stays unattributed. */
const MESSAGE_PREFIX: [string, Subsystem][] = [
  ['Impulsiveness', 'bearing'], ['Overall vibration', 'bearing'], ['Bearing housing', 'bearing'],
  ['Belt tension', 'joint'], ['Crest factor', 'joint'], ['Drive slip', 'joint'],
  ['Tonal (squeal)', 'alignment'], ['Sound pressure', 'alignment'],
  ['Tear visible', 'belt_body'], ['Hole/puncture', 'belt_body'], ['Impact damage', 'belt_body'],
]
function subsystemOf(message: string): Subsystem | undefined {
  return MESSAGE_PREFIX.find(([p]) => message.startsWith(p))?.[1]
}

export function eventsFor(events: Evt[], id: PartId): Evt[] {
  const subs = PARTS[id].subsystems
  return events.filter((e) => e.reasons?.some((r) => subs.includes(subsystemOf(r)!)))
}

/** Detection classes from vision/: belt_joint is a location cue, not a fault. */
export const DEFECT_LABEL: Record<string, string> = {
  tear: 'Tear', hole: 'Hole', impact_damage: 'Impact damage',
  patch_repair: 'Patch repair', belt_joint: 'Belt joint',
}

/** What to do about each subsystem. Downtime figures are industry-typical
 *  for a trough conveyor, NOT measured on this equipment; the UI says so. */
export const ACTIONS: Record<Subsystem, { do_: string; where: string; planned: string; unplanned: string }> = {
  bearing: { do_: 'Replace idler bearing', where: 'Idler 04, 120 m from tail pulley',
             planned: '45 min', unplanned: '8–14 h' },
  joint: { do_: 'Inspect and re-vulcanise splice', where: 'Belt joint, one pass per revolution',
           planned: '6 h', unplanned: '24–72 h' },
  alignment: { do_: 'Adjust belt tracking', where: 'Training idlers, carry side',
               planned: '30 min', unplanned: '4–10 h' },
  belt_body: { do_: 'Patch belt surface damage', where: 'Section under the inspection camera',
               planned: '2 h', unplanned: '12–36 h' },
}
