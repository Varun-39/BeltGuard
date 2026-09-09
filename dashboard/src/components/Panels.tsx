import type { ReactNode } from 'react'
import { AnimatedNumber, EASE_OUT, SPRING, motion, useReducedMotion } from './motion'

/** Status is NEVER conveyed by colour alone -- every state also carries a text
 *  label and a distinct glyph. Required by the chart-accessibility guidance and
 *  by common sense: a colour-blind operator must still read an alarm. */
export const STATE = {
  NORMAL: { color: 'var(--color-ok)', label: 'NORMAL', glyph: '●' },
  WARNING: { color: 'var(--color-warn)', label: 'WARNING', glyph: '▲' },
  CRITICAL: { color: 'var(--color-crit)', label: 'CRITICAL', glyph: '■' },
  NO_DATA: { color: 'var(--color-fg-dim)', label: 'NO DATA', glyph: '—' },
} as const

export type StateKey = keyof typeof STATE

/** Resolve a `var(--x)` token to a literal colour.
 *
 *  three.js cannot parse CSS custom properties -- passing one to a material
 *  logs "THREE.Color: Unknown color model" every frame and renders the mesh
 *  black, which on a dark scene looks like nothing drew at all. The DOM keeps
 *  using the tokens; only the WebGL side needs resolving, so index.css stays
 *  the single source of truth for the palette. */
const cache = new Map<string, string>()
export function cssColor(v: string): string {
  if (!v.startsWith('var(')) return v
  const hit = cache.get(v)
  if (hit) return hit
  const name = v.slice(4, -1).trim()
  const out =
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#94a3b8'
  cache.set(v, out)
  return out
}

export function stateFor(score: number | null | undefined): StateKey {
  if (score === null || score === undefined) return 'NO_DATA'
  return score >= 80 ? 'NORMAL' : score >= 50 ? 'WARNING' : 'CRITICAL'
}

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`panel group relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] ${className}`}
    >
      {title && (
        <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
          <h2 className="text-[10.5px] font-600 tracking-[0.16em] text-[var(--color-fg-muted)] uppercase">
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'crit' | 'info'
  children: ReactNode
  title?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'text-[var(--color-fg-muted)] border-[var(--color-border-strong)]',
    ok: 'text-[var(--color-ok)] border-[color-mix(in_srgb,var(--color-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_9%,transparent)]',
    warn: 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_9%,transparent)]',
    crit: 'text-[var(--color-crit)] border-[color-mix(in_srgb,var(--color-crit)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-crit)_9%,transparent)]',
    info: 'text-[var(--color-info)] border-[color-mix(in_srgb,var(--color-info)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_9%,transparent)]',
  }
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9.5px] font-500 tracking-[0.09em] whitespace-nowrap uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** Semicircular health gauge.
 *
 *  Inline SVG rather than a chart library: it is two arcs and a needle, and a
 *  dependency for that would be more code than the shape.
 *
 *  The needle uses a SPRING rather than a linear tween. A real analog gauge has
 *  mass -- it overshoots slightly and settles -- and borrowing that makes a
 *  falling value read as physical rather than as a redraw. */
export function HealthGauge({ score, state }: { score: number; state: StateKey }) {
  const s = STATE[state]
  const reduce = useReducedMotion()
  const R = 88
  const CX = 110
  const CY = 108
  const clamped = Math.max(0, Math.min(100, score))
  const angle = Math.PI * (1 - clamped / 100)

  const arc = (from: number, to: number) => {
    const p = (a: number) => [CX + R * Math.cos(a), CY - R * Math.sin(a)]
    const [x1, y1] = p(from)
    const [x2, y2] = p(to)
    return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`
  }
  const zone = (lo: number, hi: number) => arc(Math.PI * (1 - lo / 100), Math.PI * (1 - hi / 100))
  const needleEnd = {
    x: CX + (R - 16) * Math.cos(angle),
    y: CY - (R - 16) * Math.sin(angle),
  }

  return (
    <div className="flex flex-col items-center px-3 pt-1 pb-3">
      <svg viewBox="0 0 220 132" className="w-full max-w-[248px]" role="img"
           aria-label={`Belt health ${score} of 100, status ${s.label}`}>
        <defs>
          <filter id="gauge-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Threshold zones. The bands mean something -- the operator should see
            where the needle sits within them, not just its number. */}
        <path d={zone(0, 50)} fill="none" strokeWidth={9} strokeLinecap="butt"
              stroke="color-mix(in srgb, var(--color-crit) 24%, transparent)" />
        <path d={zone(50, 80)} fill="none" strokeWidth={9} strokeLinecap="butt"
              stroke="color-mix(in srgb, var(--color-warn) 24%, transparent)" />
        <path d={zone(80, 100)} fill="none" strokeWidth={9} strokeLinecap="butt"
              stroke="color-mix(in srgb, var(--color-ok) 24%, transparent)" />

        <motion.path
          d={zone(0, clamped)} fill="none" strokeWidth={9} strokeLinecap="round"
          stroke={s.color} filter="url(#gauge-glow)"
          initial={false} animate={{ stroke: s.color }} transition={EASE_OUT}
        />

        <motion.line
          x1={CX} y1={CY}
          initial={false}
          animate={{ x2: needleEnd.x, y2: needleEnd.y, stroke: s.color }}
          transition={reduce ? { duration: 0 } : SPRING}
          strokeWidth={2.5} strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={5} fill="var(--color-panel)" stroke={s.color} strokeWidth={2} />

        <text x={20} y={128} fill="var(--color-fg-dim)" fontSize={9} fontFamily="Fira Code">0</text>
        <text x={CX - 6} y={12} fill="var(--color-fg-dim)" fontSize={9} fontFamily="Fira Code">50</text>
        <text x={196} y={128} fill="var(--color-fg-dim)" fontSize={9} fontFamily="Fira Code">100</text>
      </svg>

      <div className="-mt-8 flex flex-col items-center">
        <AnimatedNumber
          value={score}
          className="tnum text-[54px] leading-none font-600 tabular-nums"
          style={{ color: s.color, textShadow: `0 0 28px color-mix(in srgb, ${s.color} 35%, transparent)` }}
        />
        <div className="mt-1.5 text-[9px] tracking-[0.22em] text-[var(--color-fg-dim)]">
          BELT HEALTH INDEX
        </div>
      </div>
    </div>
  )
}

const LABELS: Record<string, string> = {
  joint: 'Splice / Joint',
  bearing: 'Idler Bearing',
  alignment: 'Belt Tracking',
  belt_body: 'Belt Body',
}
const ORDER = ['joint', 'bearing', 'alignment', 'belt_body']

/** Horizontal bars, not a radar chart: an operator must read "which one is
 *  worst" in under a second, and radar makes that harder.
 *
 *  The worst subsystem is marked, because that is the one the recommended
 *  action addresses and the eye should land on it first. */
export function SubsystemBars({ subsystems }: { subsystems: Record<string, number> }) {
  const worst = ORDER.reduce((a, b) => ((subsystems[b] ?? 100) < (subsystems[a] ?? 100) ? b : a))
  const anyDegraded = (subsystems[worst] ?? 100) < 80

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      {ORDER.map((k) => {
        const v = subsystems[k] ?? 100
        const st = STATE[stateFor(v)]
        const isWorst = k === worst && anyDegraded
        return (
          <div key={k}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]">
                {isWorst && (
                  <motion.span
                    layoutId="worst-marker"
                    className="inline-block h-1 w-1 rounded-full"
                    style={{ background: st.color }}
                    transition={SPRING}
                  />
                )}
                {LABELS[k] ?? k}
              </span>
              <span className="tnum flex items-baseline gap-1 text-[12px] font-500"
                    style={{ color: st.color }}>
                <span aria-hidden className="text-[8px]">{st.glyph}</span>
                <AnimatedNumber value={v} />
              </span>
            </div>
            <div className="h-[5px] overflow-hidden rounded-full bg-[var(--color-muted)]">
              {/* scaleX rather than width: transforms stay on the compositor,
                  width forces a layout pass twice a second. */}
              <motion.div
                className="h-full origin-left rounded-full"
                style={{ background: st.color, width: '100%' }}
                initial={false}
                animate={{ scaleX: Math.max(0.02, v / 100) }}
                transition={SPRING}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
