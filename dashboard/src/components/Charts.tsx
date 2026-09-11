import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Frame, Rul } from '../useLive'
import { METRICS, read, type Metric, type MetricId, type Subsystem } from '../model'
import { clock } from './ui'

const TICK = { fill: 'var(--fg-3)', fontSize: 11, fontFamily: 'Geist Mono, ui-monospace, monospace' }
const TIP = {
  contentStyle: {
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
    fontSize: 12, fontFamily: 'Geist Mono, ui-monospace, monospace', padding: '6px 8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  },
  labelStyle: { color: 'var(--fg-3)' },
  itemStyle: { color: 'var(--fg)', padding: 0 },
  cursor: { stroke: 'var(--line-strong)', strokeWidth: 1 },
  isAnimationActive: false,
}

/** Tick labels at the precision the span needs: seconds for the live
 *  2.5-minute window, minutes once a projection stretches it into hours. */
function tickFormat(data: { t: number }[]) {
  const span = data.length > 1 ? data[data.length - 1].t - data[0].t : 0
  return (t: number) => clock(t, span < 900)
}

export function metricSeries(series: Frame[], m: Metric) {
  return series.flatMap((f) => {
    const v = read(f, m)
    return v === undefined ? [] : [{ t: f.ts, v }]
  })
}

/** Sparkline as plain SVG: 1px, no axes, no fill. Enough to show shape and
 *  direction next to a number; the expanded chart carries the scale. */
export function Spark({ values, limit }: { values: number[]; limit?: number }) {
  if (values.length < 2) return <div className="h-6" />
  let lo = Math.min(...values), hi = Math.max(...values)
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  const y = (v: number) => 22 - ((v - lo) / (hi - lo)) * 20
  const d = values.map((v, i) => `${(i / (values.length - 1)) * 100},${y(v).toFixed(2)}`).join(' ')
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      {limit !== undefined && limit > lo && limit < hi && (
        <line x1="0" x2="100" y1={y(limit)} y2={y(limit)} stroke="var(--line-strong)"
              strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      <polyline points={d} fill="none" stroke="var(--fg-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** A single metric with a real scale and its cited reference line. */
export function MetricChart({ series, id }: { series: Frame[]; id: MetricId }) {
  const m: Metric = METRICS[id]
  const data = metricSeries(series, m)
  return (
    <div className="h-[132px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={TICK}
                 tickLine={false} axisLine={false} minTickGap={56} tickFormatter={tickFormat(data)} />
          <YAxis width={44} tick={TICK} tickLine={false} axisLine={false} tickCount={4}
                 domain={['auto', 'auto']} tickFormatter={(v) => Number(v).toFixed(m.digits > 1 ? 1 : 0)} />
          {m.ref && (
            <ReferenceLine y={m.ref.value} ifOverflow="extendDomain" stroke="var(--fg-3)" strokeDasharray="3 3"
                           label={{ value: `${m.ref.value} ${m.ref.label}`, position: 'insideTopRight',
                                    fill: 'var(--fg-3)', fontSize: 11 }} />
          )}
          <Tooltip {...TIP} labelFormatter={(t) => clock(Number(t))}
                   formatter={(v) => [`${Number(v).toFixed(m.digits)} ${m.unit}`, m.label]} />
          <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={1.5} dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--accent)' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export type TimelineSubject =
  | { type: 'overall' }
  | { type: 'subsystem'; key: Subsystem }
  | { type: 'metric'; id: MetricId }

/** The history strip under the twin. Follows the selection: the asset's
 *  health index, a subsystem's score, or an uninstrumented part's primary
 *  reading. The RUL projection belongs to the overall index only. */
export function Timeline({ series, rul, subject }: {
  series: Frame[]; rul: Rul | null; subject: TimelineSubject
}) {
  const isScore = subject.type !== 'metric'
  const m: Metric | null = subject.type === 'metric' ? METRICS[subject.id] : null
  const hist = subject.type === 'metric'
    ? metricSeries(series, m!)
    : series.map((f) => ({
        t: f.ts,
        v: subject.type === 'overall' ? f.health.overall : (f.health.subsystems[subject.key] ?? 100),
      }))

  // RUL projection, overall only: measured trend carried forward to 50, with
  // the 95% interval from rul.py as dotted bounds rather than a filled cone.
  const data: Record<string, number>[] = hist.map((h) => ({ ...h }))
  const last = hist.at(-1)
  const rate = rul?.trend_per_hour
  let crossing: number | null = null
  if (subject.type === 'overall' && last && hist.length > 1 && rate && rate > 0 && rul?.hours_to_critical) {
    const histH = (last.t - hist[0].t) / 3600
    const span = Math.min(rul.hours_to_critical * 1.3, Math.max(histH * 1.2, 0.02))
    const fast = (last.v - 50) / Math.max(rul.ci_low_hours || span, 1e-6)
    const slow = (last.v - 50) / Math.max(rul.ci_high_hours || span, 1e-6)
    Object.assign(data[data.length - 1], { proj: last.v, lo: last.v, hi: last.v })
    for (let i = 1; i <= 20; i++) {
      const dh = (i / 20) * span
      data.push({ t: last.t + dh * 3600, proj: Math.max(0, last.v - rate * dh),
                  lo: Math.max(0, last.v - fast * dh), hi: Math.max(0, last.v - slow * dh) })
    }
    if (rul.hours_to_critical <= span) crossing = last.t + rul.hours_to_critical * 3600
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={TICK}
               tickLine={false} axisLine={false} minTickGap={72} tickFormatter={tickFormat(data as { t: number }[])} />
        <YAxis width={40} tick={TICK} tickLine={false} axisLine={false}
               {...(isScore ? { domain: [0, 100], ticks: [0, 50, 80, 100] } : { domain: ['auto', 'auto'], tickCount: 4 })} />
        {/* Band boundaries fusion.score() uses, labelled rather than coloured. */}
        {isScore && <ReferenceLine y={80} stroke="var(--line-strong)" strokeDasharray="3 3"
                                   label={{ value: 'warning', position: 'insideTopLeft', fill: 'var(--fg-3)', fontSize: 11 }} />}
        {isScore && <ReferenceLine y={50} stroke="var(--line-strong)" strokeDasharray="3 3"
                                   label={{ value: 'critical', position: 'insideTopLeft', fill: 'var(--fg-3)', fontSize: 11 }} />}
        {m?.ref && <ReferenceLine y={m.ref.value} ifOverflow="extendDomain" stroke="var(--line-strong)" strokeDasharray="3 3"
                                  label={{ value: m.ref.label, position: 'insideTopLeft', fill: 'var(--fg-3)', fontSize: 11 }} />}
        {crossing && <ReferenceLine x={crossing} stroke="var(--fg-3)"
                                    label={{ value: 'reaches 50', position: 'insideTopRight', fill: 'var(--fg-2)', fontSize: 11 }} />}
        <Tooltip {...TIP} labelFormatter={(t) => clock(Number(t))}
                 formatter={(v, n) => [
                   m ? `${Number(v).toFixed(m.digits)} ${m.unit}` : `${Math.round(Number(v))}`,
                   n === 'v' ? 'Measured' : n === 'proj' ? 'Projected' : n === 'lo' ? 'Earliest (95%)' : 'Latest (95%)',
                 ]} />
        <Line type="monotone" dataKey="v" stroke="var(--accent)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="proj" stroke="var(--fg-2)" strokeWidth={1.25} strokeDasharray="5 4"
              dot={false} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="lo" stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="1 3"
              dot={false} isAnimationActive={false} connectNulls={false} />
        <Line type="monotone" dataKey="hi" stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="1 3"
              dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
