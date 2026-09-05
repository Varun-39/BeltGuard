import type { ReactNode } from 'react'

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
      className={`panel-tex flex min-h-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] ${className}`}
    >
      {title && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
          <h2 className="text-[11px] font-600 tracking-[0.14em] text-[var(--color-fg-muted)] uppercase">
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
    ok: 'text-[var(--color-ok)] border-[color-mix(in_srgb,var(--color-ok)_45%,transparent)]',
    warn: 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)]',
    crit: 'text-[var(--color-crit)] border-[color-mix(in_srgb,var(--color-crit)_45%,transparent)]',
    info: 'text-[var(--color-info)] border-[color-mix(in_srgb,var(--color-info)_45%,transparent)]',
  }
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-500 tracking-wider whitespace-nowrap uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** Semicircular health gauge.

    Drawn as inline SVG rather than pulled from a chart library: it is two arcs
    and a needle, and a dependency for that would be more code than the shape. */
export function HealthGauge({ score, state }: { score: number; state: StateKey }) {
  const s = STATE[state]
  const R = 88
  const CX = 110
  const CY = 108
  // Semicircle from 180deg (left) to 0deg (right).
  const angle = Math.PI * (1 - Math.max(0, Math.min(100, score)) / 100)
  const arc = (from: number, to: number) => {
    const p = (a: number) => [CX + R * Math.cos(a), CY - R * Math.sin(a)]
    const [x1, y1] = p(from)
    const [x2, y2] = p(to)
    return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`
  }
  const zone = (lo: number, hi: number) => arc(Math.PI * (1 - lo / 100), Math.PI * (1 - hi / 100))

  return (
    <div className="flex flex-col items-center px-3 pt-1 pb-3">
      <svg viewBox="0 0 220 132" className="w-full max-w-[240px]" role="img"
           aria-label={`Belt health ${score} of 100, status ${s.label}`}>
        {/* Threshold zones, labelled below -- the bands mean something and the
            operator should be able to see where the needle sits within them. */}
        <path d={zone(0, 50)} fill="none" strokeWidth={9} strokeLinecap="butt"
              stroke="color-mix(in srgb, var(--color-crit) 26%, transparent)" />
        <path d={zone(50, 80)} fill="none" strokeWidth={9} strokeLinecap="butt"
              stroke="color-mix(in srgb, var(--color-warn) 26%, transparent)" />
        <path d={zone(80, 100)} fill="none" strokeWidth={9} strokeLinecap="butt"
              stroke="color-mix(in srgb, var(--color-ok) 26%, transparent)" />
        <path d={zone(0, score)} fill="none" strokeWidth={9} strokeLinecap="round"
              stroke={s.color} style={{ transition: 'stroke 400ms ease' }} />
        <line
          x1={CX} y1={CY}
          x2={CX + (R - 16) * Math.cos(angle)} y2={CY - (R - 16) * Math.sin(angle)}
          stroke={s.color} strokeWidth={2.5} strokeLinecap="round"
          style={{ transition: 'all 500ms cubic-bezier(0.4,0,0.2,1)' }}
        />
        <circle cx={CX} cy={CY} r={4.5} fill={s.color} />
        <text x={22} y={128} fill="var(--color-fg-dim)" fontSize={9} fontFamily="Fira Code">0</text>
        <text x={CX - 6} y={14} fill="var(--color-fg-dim)" fontSize={9} fontFamily="Fira Code">50</text>
        <text x={196} y={128} fill="var(--color-fg-dim)" fontSize={9} fontFamily="Fira Code">100</text>
      </svg>

      <div className="-mt-7 flex flex-col items-center">
        <div className="tnum text-5xl leading-none font-600" style={{ color: s.color }}>
          {score}
        </div>
        <div className="mt-1 text-[10px] tracking-[0.18em] text-[var(--color-fg-dim)]">
          BELT HEALTH INDEX
        </div>
      </div>
    </div>
  )
}

/** Horizontal bar per subsystem. Bars, not a radar chart: an operator needs to
 *  read "which one is worst" in under a second, and radar makes that harder. */
export function SubsystemBars({ subsystems }: { subsystems: Record<string, number> }) {
  const LABELS: Record<string, string> = {
    joint: 'Splice / Joint',
    bearing: 'Idler Bearing',
    alignment: 'Belt Tracking',
    belt_body: 'Belt Body',
  }
  const order = ['joint', 'bearing', 'alignment', 'belt_body']
  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      {order.map((k) => {
        const v = subsystems[k] ?? 100
        const st = STATE[stateFor(v)]
        return (
          <div key={k}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] text-[var(--color-fg-muted)]">{LABELS[k] ?? k}</span>
              <span className="tnum text-[12px] font-500" style={{ color: st.color }}>
                <span aria-hidden className="mr-1 text-[9px]">{st.glyph}</span>
                {v}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-muted)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, v)}%`,
                  background: st.color,
                  transition: 'width 500ms cubic-bezier(0.4,0,0.2,1), background 400ms ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
