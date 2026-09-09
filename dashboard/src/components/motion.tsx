import { motion, useReducedMotion, useSpring, type Transition } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Shared motion vocabulary.
 *
 *  RULE FOR THIS FILE: in a control room, motion must carry information. It
 *  marks that a value changed, which direction it moved, or that something new
 *  arrived. Decorative movement competes with the data for attention and, on a
 *  screen someone watches for eight hours, becomes noise.
 *
 *  Three constraints follow from that:
 *    - EXIT IS FASTER THAN ENTRY. Something arriving deserves a beat; something
 *      leaving should get out of the way.
 *    - TRANSFORM AND OPACITY ONLY. Both stay on the compositor. Animating
 *      width/height/top would relayout the page 2x a second.
 *    - REDUCED MOTION IS A HARD OFF, not a slowdown. An operator who asked the
 *      OS for no motion gets final states immediately.
 */

export const EASE_OUT: Transition = { duration: 0.34, ease: [0.16, 1, 0.3, 1] }
export const EASE_EXIT: Transition = { duration: 0.16, ease: [0.4, 0, 1, 1] }
export const SPRING: Transition = { type: 'spring', stiffness: 210, damping: 26, mass: 0.7 }

/** Panels reveal in a wave on first paint only, never on data updates.
 *  Re-animating on every tick would make the dashboard twitch. */
export function Reveal({
  children, index = 0, className = '',
}: { children: ReactNode; index?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...EASE_OUT, delay: reduce ? 0 : Math.min(index * 0.045, 0.5) }}
    >
      {children}
    </motion.div>
  )
}

/** A number that travels to its new value instead of teleporting.
 *
 *  This is the highest-value animation in the app: at 2 Hz, a health index
 *  snapping 76 -> 61 reads as a glitch, while a number that visibly falls reads
 *  as deterioration. The motion IS the information.
 */
export function AnimatedNumber({
  value, decimals = 0, className = '', style,
}: { value: number; decimals?: number; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion()
  const spring = useSpring(value, { stiffness: 90, damping: 20, mass: 0.6 })
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (reduce) { setShown(value); return }
    spring.set(value)
  }, [value, reduce, spring])

  useEffect(() => {
    if (reduce) return
    return spring.on('change', (v) => setShown(v))
  }, [spring, reduce])

  return (
    <span className={className} style={style}>
      {shown.toFixed(decimals)}
    </span>
  )
}

/** Direction-of-travel indicator. Condition monitoring cares more about which
 *  way a value is heading than where it currently sits, and nothing on the
 *  dashboard conveyed that before. */
export function Trend({ value, window = 12 }: { value: number; window?: number }) {
  const hist = useRef<number[]>([])
  hist.current = [...hist.current, value].slice(-window)
  if (hist.current.length < window) return null

  const delta = hist.current.at(-1)! - hist.current[0]
  if (Math.abs(delta) < 2) return null
  const falling = delta < 0
  return (
    <motion.span
      initial={{ opacity: 0, y: falling ? -3 : 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={EASE_OUT}
      className="tnum text-[10px] font-500"
      style={{ color: falling ? 'var(--color-crit)' : 'var(--color-ok)' }}
      title={`${falling ? 'Falling' : 'Rising'} ${Math.abs(delta).toFixed(0)} points recently`}
    >
      {falling ? '▼' : '▲'} {Math.abs(delta).toFixed(0)}
    </motion.span>
  )
}

/** Fires a brief emphasis whenever `key` changes -- used on the header status
 *  chip so an escalation is impossible to miss even if you looked away. */
export function PulseOnChange({
  trigger, color, children,
}: { trigger: string; color: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  const first = useRef(true)
  useEffect(() => { first.current = false }, [trigger])

  return (
    <motion.div
      key={trigger}
      initial={reduce || first.current ? false : { scale: 0.94, opacity: 0.4 }}
      animate={{
        scale: 1,
        opacity: 1,
        boxShadow: reduce
          ? 'none'
          : [`0 0 0 0 ${color}`, `0 0 0 8px transparent`, `0 0 0 0 transparent`],
      }}
      transition={{ ...SPRING, boxShadow: { duration: 0.9, ease: 'easeOut' } }}
      style={{ borderRadius: 6 }}
    >
      {children}
    </motion.div>
  )
}

export { motion, useReducedMotion }
