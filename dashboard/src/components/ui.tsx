import type { KeyboardEvent, ReactNode } from 'react'
import { LEVEL_LABEL, type Level } from '../model'

const LEVEL_COLOR: Record<Level, string> = {
  normal: 'var(--fg-2)', warning: 'var(--warn)', critical: 'var(--crit)', none: 'var(--fg-3)',
}

/** State as a word. Colour is added only when the state needs attention, and
 *  the word is always there, so nothing depends on hue alone. */
export function LevelText({ level, className = '' }: { level: Level; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} style={{ color: LEVEL_COLOR[level] }}>
      {(level === 'warning' || level === 'critical') && (
        <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden>
          {level === 'critical'
            ? <rect width="6" height="6" rx="1" fill="currentColor" />
            : <circle cx="3" cy="3" r="3" fill="currentColor" />}
        </svg>
      )}
      {LEVEL_LABEL[level]}
    </span>
  )
}

export function Section({ title, aside, children, className = '' }: {
  title: string; aside?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`px-5 py-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="heading">{title}</h3>
        {aside && <div className="text-[12px] text-[var(--fg-3)]">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

export const clock = (ts: number, sec = true) =>
  new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', ...(sec && { second: '2-digit' }), hour12: false,
  })

/** Segmented control as a radio group: one tab stop, arrow keys move the
 *  choice, screen readers announce "radio, 2 of 3". */
export function Segmented<T extends string | number | boolean>({ label, value, options, onChange, legend = true }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void; legend?: boolean
}) {
  const i = options.findIndex(([v]) => v === value)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + options.length) % options.length
    onChange(options[next][0])
    ;(e.currentTarget.children[next] as HTMLElement | undefined)?.focus()
  }
  const group = (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className="flex rounded-[7px] bg-[var(--hover)] p-0.5">
      {options.map(([v, text], k) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} tabIndex={k === i ? 0 : -1}
                onClick={() => onChange(v)}
                className={`cursor-pointer rounded-[5px] px-2.5 py-0.5 text-[12px] transition-colors ${
                  value === v ? 'bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                              : 'text-[var(--fg-2)] hover:text-[var(--fg)]'}`}>
          {text}
        </button>
      ))}
    </div>
  )
  if (!legend) return group
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px]" aria-hidden>{label}</span>
      {group}
    </div>
  )
}

/** The BeltGuard mark. Two flat PNGs (public/logo-mark-{light,dark}.png), not
 *  one asset filtered by CSS: the source art is a flat two-colour cutout, and
 *  a filter-based invert would also flip the green, which is a fixed brand
 *  hue in both themes. `dark` picks the pre-recoloured file instead. */
export function Mark({ size = 20, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <img src={dark ? '/logo-mark-dark.png' : '/logo-mark-light.png'} width={size} height={size}
         alt="" aria-hidden style={{ height: size, width: 'auto' }} />
  )
}
