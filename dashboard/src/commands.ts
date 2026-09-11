/** Spoken and typed command grammar. Pure: no DOM, no React, so it can be
 *  checked in isolation (commands.check.ts). Deliberately small -- a handful
 *  of verbs an operator would actually say at a console. */
import type { PartId } from './model'

export type Command =
  | { type: 'select'; id: PartId }
  | { type: 'overview' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'status' }

// Order matters: "take up" must win over "tail", "head pulley" over "belt".
const PART_WORDS: [RegExp, PartId][] = [
  [/\bidler\b|\bbearing\b/, 'idler04'],
  [/\bsplice\b|\bjoint\b/, 'splice'],
  [/\btake[\s-]?up\b/, 'takeup'],
  [/\btail\b|\btacho/, 'tail'],
  [/\bhead\b|\bdrive\b|\bmotor\b|\bgearbox\b/, 'head'],
  [/\bcamera\b|\bvision\b/, 'camera'],
  [/\bbelt\b/, 'belt'],
]

export function parseCommand(heard: string): Command | null {
  const t = heard.toLowerCase().trim()
  if (!t) return null
  if (/\b(overview|back|home|all parts|whole)\b/.test(t)) return { type: 'overview' }
  if (/\b(pause|freeze|hold)\b/.test(t)) return { type: 'pause' }
  if (/\b(resume|live|unpause|continue)\b/.test(t)) return { type: 'resume' }
  if (/\b(status|report|read|how is|what's wrong|what is wrong)\b/.test(t)) return { type: 'status' }
  for (const [re, id] of PART_WORDS) if (re.test(t)) return { type: 'select', id }
  return null
}
