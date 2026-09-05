import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Frame, Reasons, Rul } from '../useLive'
import { Badge, Panel, STATE, stateFor } from './Panels'

const AXIS = { stroke: 'var(--color-fg-dim)', fontSize: 10, fontFamily: 'Fira Code' }

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
    <div className="flex min-w-0 flex-col rounded border border-[var(--color-border)] bg-[var(--color-panel-2)] p-2">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] tracking-wider text-[var(--color-fg-muted)] uppercase">
          {label}
        </span>
        <span className="tnum shrink-0 text-[13px] font-500"
              style={{ color: breached ? 'var(--color-warn)' : 'var(--color-fg)' }}>
          {latest !== undefined ? latest.toFixed(digits) : '--'}
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
            <CartesianGrid stroke="var(--color-muted)" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis width={30} {...AXIS} tickLine={false} axisLine={false}
                   domain={['auto', 'auto']} tickFormatter={(v) => Number(v).toFixed(0)} />
            {warn !== undefined && (
              <ReferenceLine y={warn} stroke="var(--color-warn)" strokeDasharray="3 3"
                             strokeOpacity={0.75} />
            )}
            <Tooltip
              contentStyle={{
                background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
                borderRadius: 6, fontSize: 11, fontFamily: 'Fira Code',
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
    </div>
  )
}

export function HealthTrend({ series }: { series: Frame[] }) {
  const data = series.map((f) => ({ t: f.ts, v: f.health.overall }))
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
          <CartesianGrid stroke="var(--color-muted)" vertical={false} />
          <XAxis dataKey="t" {...AXIS} tickLine={false} axisLine={false} minTickGap={60}
                 tickFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString([], {
                   hour: '2-digit', minute: '2-digit', second: '2-digit' })} />
          <YAxis domain={[0, 100]} width={28} {...AXIS} tickLine={false} axisLine={false} />
          {/* The same thresholds fusion.score() uses, drawn where they apply. */}
          <ReferenceLine y={80} stroke="var(--color-ok)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <ReferenceLine y={50} stroke="var(--color-crit)" strokeDasharray="4 4" strokeOpacity={0.5} />
          <Tooltip
            contentStyle={{
              background: 'var(--color-bg)', border: '1px solid var(--color-border-strong)',
              borderRadius: 6, fontSize: 11, fontFamily: 'Fira Code',
            }}
            labelFormatter={(t) => new Date(Number(t) * 1000).toLocaleTimeString()}
            formatter={(v: number) => [`${v} / 100`, 'Health']}
          />
          <Area type="monotone" dataKey="v" stroke="var(--color-info)" strokeWidth={1.8}
                fill="url(#gh)" isAnimationActive={false} dot={false} />
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
    <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-y-auto">
      {reasons.map((r, i) => {
        const tone = r.severity > 0.66 ? 'crit' : r.severity > 0.33 ? 'warn' : 'neutral'
        const col = tone === 'crit' ? 'var(--color-crit)'
          : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-fg-dim)'
        return (
          <li key={`${r.indicator}-${i}`} className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] leading-snug text-[var(--color-fg)]">{r.message}</span>
              <Badge tone={tone as 'crit' | 'warn' | 'neutral'}>{SUB[r.subsystem] ?? r.subsystem}</Badge>
            </div>
            {/* The standard behind the threshold, so the number is auditable. */}
            <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-fg-dim)]">{r.basis}</p>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--color-muted)]">
              <div className="h-full rounded-full"
                   style={{ width: `${Math.round(r.severity * 100)}%`, background: col,
                            transition: 'width 400ms ease' }} />
            </div>
          </li>
        )
      })}
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
        <span className="tnum text-3xl leading-none font-600" style={{ color: col }}>
          {days === null ? 'PAST' : days.toFixed(1)}
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
