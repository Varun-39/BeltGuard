import { motion, type Transition } from 'motion/react'

/** Motion vocabulary. Motion here explains a change -- the camera travelling
 *  to a part, a panel replacing another, a disclosure opening -- and nothing
 *  loops or runs for its own sake.
 *
 *  Readings are deliberately NOT interpolated. A number sweeping from 83 to 11
 *  shows values that were never measured, and can briefly contradict the state
 *  label beside it. Instruments update in place; tabular figures keep them still. */

export const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 36, mass: 0.8 }
export const FADE: Transition = { duration: 0.16, ease: [0.2, 0, 0, 1] }

export { motion }
