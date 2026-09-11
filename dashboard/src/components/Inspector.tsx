import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { API_BASE } from '../config'
import type { Evt, Frame, Rul } from '../useLive'
import {
  ACTIONS, DEFECT_LABEL, LEVEL_LABEL, METRICS, PARTS, PART_ORDER, SENSOR_PART, SENSOR_TYPE, SUBSYSTEM_LABEL,
  eventsFor, levelFor, read, type Level, type MetricId, type PartId, type Subsystem,
} from '../model'
import { MetricChart, Spark, metricSeries } from './Charts'
import { FADE, SPRING, motion } from './motion'
import { LevelText, Section, clock } from './ui'

type Props = {
  frame: Frame
  series: Frame[]
  rul: Rul | null
  events: Evt[]
  smtp: boolean
  baseline: { value: number; label: string } | null
  selected: PartId | null
  hovered: PartId | null
  onSelect: (id: PartId | null) => void
  onHover: (id: PartId | null) => void
}

/** The right-hand column. With nothing selected it answers "how is the asset
 *  and where should I look"; with a part selected it answers "what is wrong
 *  here, what is the evidence, what do I do". Panels slide in the direction
 *  of travel -- deeper to the left, back to the right. */
export function Inspector(p: Props) {
  const key = p.selected ?? 'overview'
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={p.selected ? 1 : -1}>
      <motion.div key={key} custom={p.selected ? 1 : -1}
                  variants={{
                    enter: (d: number) => ({ opacity: 0, x: 16 * d }),
                    center: { opacity: 1, x: 0 },
                    exit: (d: number) => ({ opacity: 0, x: -16 * d, transition: FADE }),
                  }}
                  initial="enter" animate="center" exit="exit" transition={SPRING}
                  className="divide-y divide-[var(--line)]">
        {p.selected ? <PartView {...p} id={p.selected} /> : <Overview {...p} />}
      </motion.div>
    </AnimatePresence>
  )
}

/* ── Overview ───────────────────────────────────────────────────────────── */

function Overview({ frame, rul, events, smtp, baseline, hovered, onSelect, onHover }: Props) {
  const h = frame.health
  const level = levelFor(h.overall)
  const delta = baseline ? Math.round(h.overall - baseline.value) : null
  // Fixed order, never re-sorted live: rows must not move under the cursor
  // while scores change twice a second. Status words carry the ranking.
  const rows = PART_ORDER.map((id) => {
    const subs = PARTS[id].subsystems
    const worstSub = subs.length
      ? subs.reduce((a, b) => ((h.subsystems[b] ?? 100) < (h.subsystems[a] ?? 100) ? b : a)) : null
    return { id, sub: worstSub, v: worstSub ? (h.subsystems[worstSub] ?? 100) : null }
  })
  const worstSub = (Object.keys(SUBSYSTEM_LABEL) as Subsystem[])
    .reduce((a, b) => ((h.subsystems[b] ?? 100) < (h.subsystems[a] ?? 100) ? b : a))

  return (
    <>
      <div className="px-5 pt-5 pb-6">
        <h2 className="heading">Health index</h2>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="num text-[44px] leading-none font-600 tracking-[-0.025em]">{h.overall}</span>
          <span className="num text-[13px] text-[var(--fg-3)]">/ 100</span>
          <LevelText level={level} className="ml-auto text-[13px] font-500" />
        </div>
        <p className="mt-3 text-[12px] text-[var(--fg-2)]">
          {delta === null ? 'No baseline stored yet'
            : delta === 0 ? `Unchanged since ${baseline!.label}`
            : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} since ${baseline!.label}`}
        </p>
        <Since events={events} state={h.state} now={frame.ts} />
        <RulLine rul={rul} />
      </div>

      <Section title="Components">
        <ul className="-mx-2">
          {rows.map(({ id, sub, v }) => (
            <li key={id}>
              <button type="button" onClick={() => onSelect(id)}
                      onPointerEnter={() => onHover(id)} onPointerLeave={() => onHover(null)}
                      aria-current={hovered === id}
                      className="row flex w-full cursor-pointer items-baseline gap-3 px-2 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{PARTS[id].name}</span>
                  <span className="block truncate text-[12px] text-[var(--fg-3)]">
                    {sub ? SUBSYSTEM_LABEL[sub] : PARTS[id].kind}
                  </span>
                </span>
                {v !== null && (
                  <>
                    <span className="num text-[13px] font-500">{v}</span>
                    <LevelText level={levelFor(v)} className="w-[70px] justify-end text-[12px]" />
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {(h.subsystems[worstSub] ?? 100) < 80 && <Action subsystem={worstSub} rul={rul} />}

      <Section title="Recent events" aside={events.length ? `${events.length} recorded` : undefined}>
        <EventList events={events.slice(0, 5)} smtp={smtp} />
      </Section>

      <Sources frame={frame} />
    </>
  )
}

/** How long the asset has held its current state, from the notifier's
 *  confirmed transitions. Silent when the live state has not been confirmed. */
function Since({ events, state, now }: { events: Evt[]; state: string; now: number }) {
  const e = events[0]
  if (!e || e.to !== state) return null
  const mins = Math.max(0, (now - e.ts) / 60)
  const span = mins < 90 ? `${Math.round(mins)} min` : `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min`
  return (
    <p className="mt-1 text-[12px] text-[var(--fg-2)]">
      {LEVEL_LABEL[state.toLowerCase() as Level] ?? state} for {span}, since {clock(e.ts, false)}
    </p>
  )
}

function RulLine({ rul }: { rul: Rul | null }) {
  if (!rul || rul.confidence === 'none') {
    return <p className="mt-1 text-[12px] text-[var(--fg-3)]">No degradation trend to project.</p>
  }
  const days = rul.real_world_days
  const ci = rul.ci_low_hours != null && rul.ci_high_hours != null && rul.demo_acceleration
    ? ` (95% ${(rul.ci_low_hours * rul.demo_acceleration / 24).toFixed(1)}–${(rul.ci_high_hours * rul.demo_acceleration / 24).toFixed(1)})`
    : ''
  return (
    <p className="mt-1 text-[12px] text-[var(--fg-2)]"
       title={`Degradation-trend extrapolation, not a learned RUL model.${rul.demo_acceleration ? ` Demo fault ramp accelerated ${rul.demo_acceleration}×; figure is the field-timescale equivalent.` : ''}`}>
      {days === null
        ? 'Already below the critical threshold.'
        : <>Projected to reach critical in <span className="num text-[var(--fg)]">{days.toFixed(1)} days</span>{ci} · {rul.confidence} confidence</>}
    </p>
  )
}

/* ── Part view ──────────────────────────────────────────────────────────── */

function PartView({ id, frame, series, rul, events, smtp, onSelect }: Props & { id: PartId }) {
  const part = PARTS[id]
  const subs = part.subsystems
  const reasons = frame.health.reasons.filter((r) => subs.includes(r.subsystem as Subsystem))
  const related = eventsFor(events, id)
  const worst = subs.length
    ? subs.reduce((a, b) => ((frame.health.subsystems[b] ?? 100) < (frame.health.subsystems[a] ?? 100) ? b : a))
    : null

  return (
    <>
      <div className="px-5 pt-4 pb-5">
        <button type="button" onClick={() => onSelect(null)}
                className="-ml-1.5 cursor-pointer rounded-[6px] px-1.5 py-0.5 text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]">
          ‹ Overview
        </button>
        <h2 className="display mt-2 text-[28px]">{part.name}</h2>
        <p className="mt-1 text-[12px] text-[var(--fg-2)]">{part.kind} · {part.location}</p>

        {subs.length > 0 && (
          <dl className="mt-4 space-y-1.5">
            {subs.map((s) => {
              const v = frame.health.subsystems[s] ?? 100
              return (
                <div key={s} className="flex items-baseline gap-3">
                  <dt className="flex-1 text-[13px]">{SUBSYSTEM_LABEL[s]}</dt>
                  <dd className="num text-[13px] font-500">{v}<span className="font-normal text-[var(--fg-3)]"> / 100</span></dd>
                  <dd className="w-[70px] text-right text-[12px]"><LevelText level={levelFor(v)} /></dd>
                </div>
              )
            })}
          </dl>
        )}
        {part.note && <p className="mt-4 text-[12px] leading-relaxed text-[var(--fg-2)]">{part.note}</p>}
        {id === 'head' && (
          <button type="button" onClick={() => onSelect('tail')}
                  className="mt-2 cursor-pointer text-[12px] text-[var(--accent)] hover:underline">
            Show tail pulley
          </button>
        )}
      </div>

      {reasons.length > 0 && (
        <Section title="Why" aside={`${reasons.length} indicator${reasons.length === 1 ? '' : 's'}`}>
          <ul className="space-y-4">
            {reasons.map((r) => (
              <li key={r.indicator}>
                <div className="flex items-baseline gap-3">
                  <p className="flex-1 text-[13px] leading-snug font-500">{r.message}</p>
                  <span className="num text-[12px] text-[var(--fg-2)]">{Math.round(r.severity * 100)}%</span>
                </div>
                <p className="mt-0.5 text-[12px] leading-snug text-[var(--fg-3)]">{r.basis}</p>
                {/* Bar colour is the indicator's own band: red past 66%, amber past 33%. */}
                <div className="mt-2 h-[2px] rounded-full bg-[var(--line)]">
                  <motion.div className="h-[2px] origin-left rounded-full" initial={false}
                              style={{ background: r.severity > 0.66 ? 'var(--crit)' : r.severity > 0.33 ? 'var(--warn)' : 'var(--fg-3)' }}
                              animate={{ scaleX: r.severity }} transition={SPRING} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {part.metrics.length > 0 && <Telemetry frame={frame} series={series} ids={part.metrics} key={id} />}

      {part.inspection && <Inspection frame={frame} mode={part.inspection} />}

      {worst && (frame.health.subsystems[worst] ?? 100) < 80 && <Action subsystem={worst} rul={rul} />}

      {subs.length > 0 && (
        <Section title="Events" aside={related.length ? `${related.length} involving this part` : undefined}>
          <EventList events={related.slice(0, 6)} smtp={smtp} empty="No recorded transitions involve this part." />
        </Section>
      )}
    </>
  )
}

/** Readings as rows: name, shape, value. One row expands to a scaled chart
 *  with its cited reference -- detail on demand instead of six charts at once. */
function Telemetry({ frame, series, ids }: { frame: Frame; series: Frame[]; ids: MetricId[] }) {
  const [open, setOpen] = useState<MetricId | null>(ids[0])
  return (
    <Section title="Telemetry" aside="last 2.5 min">
      <ul className="-mx-2">
        {ids.map((id) => {
          const m = METRICS[id]
          const v = read(frame, m)
          const sensorId = frame.health.sources?.[m.kind]?.sensor_id
          const isOpen = open === id
          return (
            <li key={id}>
              <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}
                      title={sensorId} className="row grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_72px_auto] items-center gap-3 px-2 py-1.5 text-left">
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{m.label}</span>
                  <span className="block truncate text-[11px] text-[var(--fg-3)]">{SENSOR_TYPE[m.kind] ?? m.kind}</span>
                </span>
                <Spark values={metricSeries(series, m).slice(-120).map((d) => d.v)} limit={'ref' in m ? m.ref.value : undefined} />
                <span className="num min-w-[84px] text-right text-[13px] font-500">
                  {v === undefined ? '—' : v.toFixed(m.digits)}
                  <span className="font-normal text-[var(--fg-3)]">{m.unit ? ` ${m.unit}` : ''}</span>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }} transition={SPRING} className="overflow-hidden px-2">
                    <div className="pt-1 pb-3"><MetricChart series={series} id={id} /></div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** The camera is the only direct view of the belt surface. For the splice,
 *  a detected joint is a location cue; for the belt, defects are the finding.
 *  Area is shown, not confidence: the backend aggregates detections over a
 *  window and reports a fixed confidence, so a percentage there would mislead. */
function Inspection({ frame, mode }: { frame: Frame; mode: 'joint' | 'defects' }) {
  const [live, setLive] = useState(true)
  // A dropped MJPEG connection retries by itself; nobody should have to babysit a feed.
  useEffect(() => {
    if (live) return
    const t = setTimeout(() => setLive(true), 5000)
    return () => clearTimeout(t)
  }, [live])
  const dets = (frame.vision?.detections ?? [])
    .filter((d) => (mode === 'joint' ? d.cls === 'belt_joint' : d.cls !== 'belt_joint'))
  return (
    <Section title="Inspection camera" aside={frame.health.vision_active ? 'Receiving' : 'Offline'}>
      <div className="overflow-hidden rounded-[8px] border border-[var(--line)] bg-black">
        {live ? (
          <img src={`${API_BASE}/stream`} alt="Inspection camera over the carry strand, with detections"
               className="aspect-[4/3] w-full object-contain" onError={() => setLive(false)} />
        ) : (
          <div className="grid aspect-[4/3] place-items-center bg-[var(--viewport)] p-4 text-center text-[12px] text-[var(--fg-2)]">
            <div>
              Vision service not reachable. Retrying every 5 s.
              <button type="button" onClick={() => setLive(true)}
                      className="mt-2 block w-full cursor-pointer text-[var(--accent)] hover:underline">Retry now</button>
            </div>
          </div>
        )}
      </div>
      <ul className="mt-3 space-y-1">
        {dets.length === 0 ? (
          <li className="text-[12px] text-[var(--fg-3)]">
            {mode === 'joint' ? 'Joint not in view.' : 'No persistent defects in view.'}
          </li>
        ) : dets.map((d) => (
          <li key={d.cls} className="flex items-baseline gap-3 text-[13px]">
            <span className="flex-1">{DEFECT_LABEL[d.cls] ?? d.cls}</span>
            <span className="num text-[12px] text-[var(--fg-2)]">{(d.area_frac * 100).toFixed(2)}% of frame</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Action({ subsystem, rul }: { subsystem: Subsystem; rul: Rul | null }) {
  const a = ACTIONS[subsystem]
  const days = rul?.real_world_days
  const within = days == null ? 'the next shift' : days < 1 ? '24 hours'
    : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`
  return (
    <Section title="Recommended action">
      <p className="text-[16px] leading-snug font-600 tracking-[-0.01em]">{a.do_}</p>
      <p className="mt-0.5 text-[12px] text-[var(--fg-2)]">{a.where} · schedule within {within}</p>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <dt className="text-[var(--fg-3)]">Planned repair</dt>
          <dd className="num mt-0.5 text-[13px] font-500">{a.planned}</dd>
        </div>
        <div>
          <dt className="text-[var(--fg-3)]">If it fails in service</dt>
          <dd className="num mt-0.5 text-[13px] font-500">{a.unplanned}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-[var(--fg-3)]">Downtime figures are industry-typical estimates, not measured on this equipment.</p>
    </Section>
  )
}

const RANK: Record<string, number> = { NORMAL: 0, WARNING: 1, CRITICAL: 2 }

function EventList({ events, smtp, empty = 'No state changes recorded.' }: { events: Evt[]; smtp: boolean; empty?: string }) {
  if (!events.length) {
    return (
      <p className="text-[12px] text-[var(--fg-3)]">
        {empty}{!smtp && ' Email is not configured; alerts are logged only.'}
      </p>
    )
  }
  return (
    <ol className="space-y-3">
      {events.map((e, i) => {
        const worse = (RANK[e.to] ?? 0) > (RANK[e.from] ?? 0)
        const level = e.to.toLowerCase() as Level
        const cause = e.reasons?.[0]
        return (
          <li key={`${e.ts}-${i}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 text-[13px]">
            <time className="num pt-px text-[12px] text-[var(--fg-3)]">{clock(e.ts)}</time>
            <div className="min-w-0">
              <p>
                {worse ? 'Escalated to ' : 'Returned to '}<LevelText level={level} />
                <span className="text-[12px] text-[var(--fg-3)]">
                  {e.notified ? (e.delivered ? ' · emailed' : ' · logged') : ''}
                </span>
              </p>
              {cause && (
                <p className="truncate text-[12px] text-[var(--fg-2)]" title={e.reasons.join('\n')}>
                  {cause}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Provenance stays on screen: which streams are simulated is not a detail.
 *  Rows are named by instrument type and physical location, not by their
 *  wire tag -- the tag is still there, as a hover title, for anyone tracing
 *  a fault back to hardware. */
function Sources({ frame }: { frame: Frame }) {
  const src = Object.entries(frame.health.sources ?? {})
  const sim = src.filter(([, s]) => s.simulated).length
  return (
    <details className="group px-5 py-4">
      <summary className="flex cursor-pointer list-none items-baseline justify-between text-[12px] text-[var(--fg-2)] marker:hidden">
        <span className="heading">Data sources</span>
        <span>{sim ? `${sim} of ${src.length} sensors simulated` : 'All sensors live'} ›</span>
      </summary>
      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="heading [&>th]:pb-1.5 [&>th]:text-left">
            <th>Instrument</th><th>Location</th><th className="text-right">Mode</th>
          </tr>
        </thead>
        <tbody>
          {src.map(([kind, s]) => {
            const part = SENSOR_PART[kind]
            return (
              <tr key={kind} title={s.sensor_id}>
                <td className="py-1">{SENSOR_TYPE[kind] ?? kind}</td>
                <td className="py-1 text-[var(--fg-2)]">{part ? PARTS[part].name : '—'}</td>
                <td className="py-1 text-right text-[var(--fg-2)]">{s.simulated ? 'Simulated' : 'Live'}</td>
              </tr>
            )
          })}
          <tr title="cam-head-01">
            <td className="py-1">{PARTS.camera.name}</td>
            <td className="py-1 text-[var(--fg-2)]">{PARTS.camera.location}</td>
            <td className="py-1 text-right text-[var(--fg-2)]">{frame.health.vision_active ? 'Receiving' : 'Offline'}</td>
          </tr>
        </tbody>
      </table>
    </details>
  )
}

