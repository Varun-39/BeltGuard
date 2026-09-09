import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Evt, Frame, Health, Reasons, Rul } from '../useLive'
import { Badge, Panel, STATE, stateFor } from './Panels'
import { AnimatedNumber, EASE_EXIT, EASE_OUT, SPRING, motion } from './motion'
import { AnimatePresence } from 'motion/react'

const AXIS = { stroke: 'var(--color-fg-dim)', fontSize: 10, fontFamily: 'JetBrains Mono' }

/** One streaming channel. `warn` draws a threshold line so the number has a
 *  reference -- a trace with no limit on it tells an operator nothing. */
export function Channel({
  series, label, unit, pick, color, warn, digits = 2,
}: {
  series: Frame[]
  label: string
  unit: string
  pick: (f: Frame) => number | undefined
  color: string
  warn?: number
  digits?: number
}) {
  const data = series
    .map((f) => ({ t: f.ts, v: pick(f) }))
    .filter((d): d is { t: number; v: number } => typeof d.v === 'number')
  const latest = data.at(-1)?.v
  const id = `g-${label.replace(/\W/g, '')}`
  const breached = warn !== undefined && latest !== undefined && latest >= warn

  return (
    <motion.div
      className="flex min-w-0 flex-col plate p-2.5"
      animate={{
        boxShadow: breached
          ? 'inset 0 0 0 1px rgba(255,159,10,0.55), 0 0 22px -8px rgba(255,159,10,0.6)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.055)',
      }}
      transition={EASE_OUT}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] tracking-wider text-[var(--color-fg-muted)] uppercase">
          {label}
        </span>
        <span className="tnum shrink-0 text-[13.5px] font-500"
              style={{ color: breached ? 'var(--color-warn)' : 'var(--color-fg)' }}>
          {latest !== undefined
            ? <AnimatedNumber value={latest} decimals={digits} />
            : '--'}
          <span className="ml-1 text-[9px] text-[var(--color-fg-dim)]">{unit}</span>
        </span>
      </div>
      <div className="h-[68px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.42} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis width={30} {...AXIS} tickLine={false} axisLine={false}
                   domain={['auto', 'auto']} tickFormatter={(v) => Number(v).toFixed(0)} />
            {warn !== undefined && (
              <ReferenceLine y={warn} stroke="var(--color-warn)" strokeDasharray="3 3"
                             strokeOpacity={0.75} />
            )}
            <Tooltip
              contentStyle={{
                background: 'rgba(12,15,26,0.92)', border: '1px solid rgba(255,255,255,0.14)',
                backdropFilter: 'blur(14px)',
                borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono',
              }}
              labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString()}
              formatter={(v: number) => [`${v.toFixed(digits)} ${unit}`, label]}
            />
            {/* isAnimationActive off: re-animating the whole path twice a second
                makes a streaming chart shimmer and burns frame budget. */}
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.6}
                  fill={`url(#${id})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}

/** History plus the RUL trend projected forward to the CRITICAL threshold.
 *
 *  This is the panel that makes "predictive" legible: the belt has not failed,
 *  and here is when it will. `lo`/`hi` are the 95% bounds already computed in
 *  rul.py -- drawn as dashed edges rather than a filled cone, which needs a
 *  ranged-area hack for no extra meaning. */
export function HealthTrend({ series, rul }: { series: Frame[]; rul?: Rul | null }) {
  const hist = series.map((f) => ({ t: f.ts, v: f.health.overall }))

  const proj: { t: number; proj: number; lo: number; hi: number }[] = []
  const last = hist.at(-1)
  const rate = rul?.trend_per_hour
  if (last && rate && rate > 0 && rul?.hours_to_critical) {
    // Project just past the crossing so the intersection is visible, and derive
    // the optimistic/pessimistic slopes from the CI on time-to-critical.
    // Cap the horizon to ~1.2x the visible history. Projecting far past the
    // window squeezes the measured trend into a sliver, and the trend is the
    // evidence for the projection -- hiding it defeats the panel.
    const histHours = (hist.at(-1)!.t - hist[0].t) / 3600
    const span = Math.min(rul.hours_to_critical * 1.35, Math.max(histHours * 1.2, 0.02))
    const rHi = (last.v - 50) / Math.max(rul.ci_low_hours || span, 1e-6)   // fastest
    const rLo = (last.v - 50) / Math.max(rul.ci_high_hours || span, 1e-6)  // slowest
    // Start at i=1: i=0 would repeat last.t, and a duplicate x value makes
    // Recharts generate duplicate React keys and omit ticks.
    for (let i = 1; i <= 20; i++) {
      const dh = (i / 20) * span
      proj.push({
        t: last.t + dh * 3600,
        proj: Math.max(0, last.v - rate * dh),
        lo: Math.max(0, last.v - rHi * dh),
        hi: Math.max(0, last.v - rLo * dh),
      })
    }
  }

  // One array, two disjoint key sets: history rows carry `v`, projection rows
  // carry proj/lo/hi. Recharts skips undefined, so the traces do not bleed.
  // The seam row carries both so the dashed line starts on the measured value
  // rather than floating away from it.
  const data: Record<string, number>[] = hist.map((h, i) =>
    i === hist.length - 1 && proj.length
      ? { ...h, proj: h.v, lo: h.v, hi: h.v }
      : h,
  )
  data.push(...proj)
  const crossing = last && rate ? last.t + (rul!.hours_to_critical || 0) * 3600 : null

  return (
    <div className="h-[132px] px-2 pt-2 pb-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          {/* Numeric time axis: projection points sit in the future, so a
              category axis would bunch them at the end. */}
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                 {...AXIS} tickLine={false} axisLine={false} minTickGap={60}
                 tickFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString([], {
                   hour: '2-digit', minute: '2-digit' })} />
          <YAxis domain={[0, 100]} width={28} {...AXIS} tickLine={false} axisLine={false} />
          {/* The same thresholds fusion.score() uses, drawn where they apply. */}
          <ReferenceLine y={80} stroke="var(--color-ok)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <ReferenceLine y={50} stroke="var(--color-crit)" strokeDasharray="4 4" strokeOpacity={0.5} />
          {crossing && (
            <ReferenceLine x={crossing} stroke="var(--color-crit)" strokeWidth={1.2}
                           label={{ value: 'CRITICAL', position: 'insideTopRight',
                                    fill: 'var(--color-crit)', fontSize: 9,
                                    fontFamily: 'JetBrains Mono' }} />
          )}
          <Tooltip
            contentStyle={{
              background: 'rgba(12,15,26,0.92)', border: '1px solid rgba(255,255,255,0.14)',
                backdropFilter: 'blur(14px)',
              borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono',
            }}
            labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString()}
            formatter={(v: number, n: string) => [
              `${Math.round(v)} / 100`,
              n === 'v' ? 'Health' : n === 'proj' ? 'Projected' : n === 'lo' ? 'Best case' : 'Worst case',
            ]}
          />
          <Area type="monotone" dataKey="v" stroke="var(--color-info)" strokeWidth={1.8}
                fill="url(#gh)" isAnimationActive={false} dot={false} />
          {/* Projection: dashed and unfilled so it never reads as measured. */}
          <Area type="monotone" dataKey="lo" stroke="var(--color-warn)" strokeWidth={1}
                strokeDasharray="2 3" strokeOpacity={0.55} fill="none"
                isAnimationActive={false} dot={false} connectNulls={false} />
          <Area type="monotone" dataKey="hi" stroke="var(--color-warn)" strokeWidth={1}
                strokeDasharray="2 3" strokeOpacity={0.55} fill="none"
                isAnimationActive={false} dot={false} connectNulls={false} />
          <Area type="monotone" dataKey="proj" stroke="var(--color-warn)" strokeWidth={1.8}
                strokeDasharray="5 4" fill="none" isAnimationActive={false}
                dot={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Why the score is what it is. This panel is the reason fusion is a rule
 *  engine and not a neural net -- every alarm can state its own justification. */
export function Evidence({ reasons }: { reasons: Reasons[] }) {
  if (!reasons?.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-8 text-center">
        <p className="text-[12px] text-[var(--color-fg-dim)]">
          No active indicators.<br />All channels within limits.
        </p>
      </div>
    )
  }
  const SUB: Record<string, string> = {
    joint: 'SPLICE', bearing: 'BEARING', alignment: 'TRACKING', belt_body: 'BELT',
  }
  return (
    <ul className="flex flex-col divide-y divide-[rgba(255,255,255,0.07)] overflow-y-auto">
      <AnimatePresence initial={false}>
      {reasons.map((r) => {
        const tone = r.severity > 0.66 ? 'crit' : r.severity > 0.33 ? 'warn' : 'neutral'
        const col = tone === 'crit' ? 'var(--color-crit)'
          : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-fg-dim)'
        return (
          // layout + presence: a newly contributing indicator slides in, and one
          // that drops below threshold slides out, so the operator can see WHAT
          // changed rather than only that the list is different.
          <motion.li key={r.indicator} layout
                     initial={{ opacity: 0, x: -10 }}
                     animate={{ opacity: 1, x: 0 }}
                     exit={{ opacity: 0, x: 10, transition: EASE_EXIT }}
                     transition={EASE_OUT}
                     className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] leading-snug text-[var(--color-fg)]">{r.message}</span>
              <Badge tone={tone as 'crit' | 'warn' | 'neutral'}>{SUB[r.subsystem] ?? r.subsystem}</Badge>
            </div>
            {/* The standard behind the threshold, so the number is auditable. */}
            <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-fg-dim)]">{r.basis}</p>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.09)]">
              <motion.div className="h-full w-full origin-left rounded-full"
                          style={{ background: col }}
                          initial={false}
                          animate={{ scaleX: Math.max(0.02, r.severity) }}
                          transition={SPRING} />
            </div>
          </motion.li>
        )
      })}
      </AnimatePresence>
    </ul>
  )
}

export function RulPanel({ rul }: { rul: Rul | null }) {
  if (!rul || rul.confidence === 'none') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center">
        <span className="tnum text-2xl text-[var(--color-fg-dim)]">—</span>
        <p className="text-[11px] text-[var(--color-fg-muted)]">No degradation trend</p>
        <p className="text-[10px] text-[var(--color-fg-dim)]">
          {rul?.basis ?? 'waiting for health history'}
        </p>
      </div>
    )
  }
  const days = rul.real_world_days
  const tone = days === null ? 'crit' : days < 2 ? 'crit' : days < 7 ? 'warn' : 'ok'
  const col = tone === 'crit' ? 'var(--color-crit)'
    : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-ok)'

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-baseline gap-2">
        <span className="tnum text-[30px] leading-none font-600" style={{ color: col }}>
          {days === null ? 'PAST' : <AnimatedNumber value={days} decimals={1} />}
        </span>
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          {days === null ? 'already critical' : 'days to critical'}
        </span>
      </div>

      {/* The interval, not just the point estimate -- rul.py promises this. */}
      {rul.ci_low_hours != null && rul.ci_high_hours != null && rul.demo_acceleration && (
        <p className="tnum text-[11px] text-[var(--color-fg-muted)]">
          95% CI {(rul.ci_low_hours * rul.demo_acceleration / 24).toFixed(1)}–
          {(rul.ci_high_hours * rul.demo_acceleration / 24).toFixed(1)} days
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={rul.confidence === 'high' ? 'ok' : rul.confidence === 'medium' ? 'info' : 'warn'}>
          {rul.confidence} confidence
        </Badge>
        {rul.r_squared !== undefined && <Badge>R² {rul.r_squared.toFixed(2)}</Badge>}
      </div>

      {/* Method and acceleration stated inline. A bare "3.6 days" would imply
          both more precision and a real-time scale than this method has. */}
      <p className="text-[10px] leading-relaxed text-[var(--color-fg-dim)]">
        Degradation-trend extrapolation, not a learned RUL model.
        {rul.demo_acceleration
          ? ` Scenario fault ramp is accelerated ${rul.demo_acceleration}× for the demo;
              the figure above is the field-timescale equivalent.`
          : ''}
      </p>
    </div>
  )
}

/** What to DO about it.
 *
 *  Detection without a recommended action is a dashboard, not a maintenance
 *  system. The planned-vs-unplanned downtime contrast is the entire business
 *  case for the project and nothing else on screen states it.
 *
 *  Downtime figures are industry-typical for a trough conveyor, not measured
 *  on an NMDC line -- labelled as estimates in the UI for that reason. */
const ACTIONS: Record<string, { do_: string; where: string; planned: string; unplanned: string }> = {
  bearing: {
    do_: 'Replace idler bearing',
    where: 'idler-04, 120 m from tail pulley',
    planned: '45 min', unplanned: '8-14 h',
  },
  joint: {
    do_: 'Inspect and re-vulcanise splice',
    where: 'belt joint, one pass per 143 s revolution',
    planned: '6 h', unplanned: '24-72 h',
  },
  alignment: {
    do_: 'Adjust belt tracking',
    where: 'training idlers, carry side',
    planned: '30 min', unplanned: '4-10 h',
  },
  belt_body: {
    do_: 'Patch belt surface damage',
    where: 'section under cam-head-01',
    planned: '2 h', unplanned: '12-36 h',
  },
}

export function ActionPanel({ health, rul }: { health: Health; rul: Rul | null }) {
  const worst = Object.entries(health.subsystems).sort((a, b) => a[1] - b[1])[0]
  if (!worst || worst[1] >= 80) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-5 text-center">
        <p className="text-[11px] text-[var(--color-fg-dim)]">
          No action required.<br />All subsystems above 80.
        </p>
      </div>
    )
  }
  const [sub, score] = worst
  const a = ACTIONS[sub]
  const days = rul?.real_world_days
  const urgent = score < 50
  const col = urgent ? 'var(--color-crit)' : 'var(--color-warn)'

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div>
        <p className="text-[13px] leading-snug font-500" style={{ color: col }}>{a.do_}</p>
        <p className="mt-0.5 text-[10.5px] text-[var(--color-fg-muted)]">{a.where}</p>
      </div>

      <p className="text-[11px] text-[var(--color-fg)]">
        Schedule within{' '}
        <span className="tnum font-600" style={{ color: col }}>
          {days == null ? 'next shift' : days < 1 ? '24 hours'
            : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`}
        </span>
      </p>

      {/* The argument for acting: planned repair is an order of magnitude
          cheaper in downtime than the rupture it prevents. */}
      <div className="plate grid grid-cols-2 gap-2 p-3">
        <div>
          <p className="text-[9px] tracking-wider text-[var(--color-fg-dim)] uppercase">Planned</p>
          <p className="tnum text-[13px] font-600 text-[var(--color-ok)]">{a.planned}</p>
        </div>
        <div>
          <p className="text-[9px] tracking-wider text-[var(--color-fg-dim)] uppercase">If it ruptures</p>
          <p className="tnum text-[13px] font-600 text-[var(--color-crit)]">{a.unplanned}</p>
        </div>
      </div>
      <p className="text-[9px] text-[var(--color-fg-dim)]">
        Downtime figures are industry-typical estimates, not NMDC-measured.
      </p>
    </div>
  )
}

/** Alarm log. Answers "when did this start", which the live view cannot, and
 *  "was anyone actually told", which matters more. */
export function EventLog({ events, smtp }: { events: Evt[]; smtp: boolean }) {
  if (!events.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center">
        <p className="text-[11px] text-[var(--color-fg-dim)]">No state changes recorded</p>
        {!smtp && (
          <p className="text-[9.5px] text-[var(--color-fg-dim)]">
            SMTP not configured — alerts will be logged, not emailed
          </p>
        )}
      </div>
    )
  }
  const RANK: Record<string, number> = { NORMAL: 0, WARNING: 1, CRITICAL: 2 }
  return (
    <ul className="flex flex-col divide-y divide-[rgba(255,255,255,0.07)] overflow-y-auto">
      <AnimatePresence initial={false}>
      {events.map((e, i) => {
        const st = STATE[e.to as keyof typeof STATE] ?? STATE.NO_DATA
        const worse = (RANK[e.to] ?? 0) > (RANK[e.from] ?? 0)
        return (
          // Newest first, so a new alarm pushes in from the top.
          <motion.li key={`${e.ts}-${i}`} layout
                     initial={{ opacity: 0, y: -8 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, transition: EASE_EXIT }}
                     transition={EASE_OUT}
                     className="px-3 py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="tnum shrink-0 text-[10px] text-[var(--color-fg-dim)]">
                {new Date(e.ts * 1000).toLocaleTimeString([], {
                  hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span aria-hidden className="shrink-0 text-[9px]" style={{ color: st.color }}>
                {worse ? '▲' : '▼'}
              </span>
              <span className="text-[11px] leading-snug text-[var(--color-fg-muted)]">
                {e.from} <span className="text-[var(--color-fg-dim)]">&rarr;</span>{' '}
                <span style={{ color: st.color }}>{e.to}</span>
              </span>
              {e.notified && (
                <span className="ml-auto shrink-0 text-[9px] tracking-wider uppercase"
                      style={{ color: e.delivered ? 'var(--color-ok)' : 'var(--color-fg-dim)' }}>
                  {e.delivered ? 'emailed' : 'logged'}
                </span>
              )}
            </div>
            {e.reasons?.[0] && (
              <p className="mt-0.5 pl-[62px] text-[10px] leading-snug text-[var(--color-fg-dim)]">
                {e.reasons[0]}
              </p>
            )}
          </motion.li>
        )
      })}
      </AnimatePresence>
    </ul>
  )
}


export function SourceBar({ frame }: { frame: Frame | null }) {
  if (!frame) return null
  const anySim = Object.values(frame.health.sources ?? {}).some((s) => s.simulated)
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
      {Object.entries(frame.health.sources ?? {}).map(([kind, s]) => (
        <Badge key={kind} tone={s.simulated ? 'warn' : 'ok'} title={s.sensor_id}>
          {kind} · {s.simulated ? 'sim' : 'real'}
        </Badge>
      ))}
      <Badge tone={frame.health.vision_active ? 'ok' : 'neutral'}>
        camera · {frame.health.vision_active ? 'real' : 'offline'}
      </Badge>
      {anySim && (
        <span className="ml-auto text-[10px] text-[var(--color-warn)]">
          contains simulated sources
        </span>
      )}
    </div>
  )
}
