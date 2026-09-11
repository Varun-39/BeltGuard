import { useEffect, useRef, useState } from 'react'
import type { Evt, Frame, Rul } from './useLive'
import { ACTIONS, LEVEL_LABEL, PARTS, PART_ORDER, SUBSYSTEM_LABEL, levelFor, type Level, type Subsystem } from './model'
import { parseCommand, type Command } from './commands'

/** Speech output and input, both from the browser's own Web Speech API --
 *  no dependency, and nothing runs unless the operator turns it on. */

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

export function speak(text: string) {
  if (!canSpeak) return
  speechSynthesis.cancel()               // latest message wins; never queue stale alarms
  speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

/** One spoken sentence built only from live data: state, worst area, action. */
export function statusSentence(frame: Frame | null, rul: Rul | null): string {
  if (!frame) return 'No telemetry is arriving from the conveyor.'
  const h = frame.health
  const subs = Object.keys(SUBSYSTEM_LABEL) as Subsystem[]
  const worst = subs.reduce((a, b) => ((h.subsystems[b] ?? 100) < (h.subsystems[a] ?? 100) ? b : a))
  const worstScore = h.subsystems[worst] ?? 100
  const part = PART_ORDER.find((id) => PARTS[id].subsystems.includes(worst))!
  let s = `The conveyor is ${LEVEL_LABEL[levelFor(h.overall)]}, health ${h.overall} out of 100.`
  if (worstScore < 80) {
    s += ` Worst area: ${PARTS[part].name}, ${SUBSYSTEM_LABEL[worst].toLowerCase()} ${worstScore}.`
    s += ` Recommended: ${ACTIONS[worst].do_.toLowerCase()}.`
  }
  if (rul?.real_world_days != null) s += ` Projected to reach critical in ${rul.real_world_days.toFixed(1)} days.`
  return s
}

/** Speak each newly confirmed state change. Uses the notifier's deadbanded
 *  transitions, not the raw 2 Hz state, so a value hovering on a threshold
 *  cannot make the console chatter. History present at load is not re-read. */
export function useAlarmAnnouncer(events: Evt[], enabled: boolean) {
  const seen = useRef<number | null>(null)
  useEffect(() => {
    const latest = events[0]
    if (!latest) return
    if (seen.current === null) { seen.current = latest.ts; return }
    if (latest.ts <= seen.current) return
    seen.current = latest.ts
    if (!enabled) return
    const to = LEVEL_LABEL[latest.to.toLowerCase() as Level] ?? latest.to
    speak(`The conveyor ${latest.to === 'NORMAL' ? 'returned to' : 'is now'} ${to}. ${latest.reasons?.[0] ?? ''}`)
  }, [events, enabled])
}

// The Web Speech recognition API is not in TypeScript's DOM lib yet.
type Recognition = {
  lang: string; interimResults: boolean; maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; abort(): void
}
type RecognitionCtor = new () => Recognition
const Rec: RecognitionCtor | undefined = typeof window === 'undefined' ? undefined
  : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor })
      .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition)

/** Push-to-talk: one utterance per press. Opt-in only -- in Chrome the audio
 *  is transcribed by the browser vendor's speech service, and the panel says so. */
export function useVoiceCommands(run: (c: Command) => void) {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const active = useRef<Recognition | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  const listen = () => {
    if (!Rec || active.current) return
    const r = new Rec()
    r.lang = navigator.language || 'en-US'
    r.interimResults = false
    r.maxAlternatives = 3
    r.onresult = (e) => {
      const alts = Array.from(e.results[0] ?? []).map((a) => a.transcript)
      const cmd = alts.map(parseCommand).find(Boolean) ?? null
      setHeard(cmd ? `“${alts[0]}”` : `“${alts[0]}” — not a command`)
      if (cmd) run(cmd)
    }
    r.onerror = (e) => setHeard(e.error === 'not-allowed' ? 'Microphone access was blocked' : 'Didn’t catch that')
    r.onend = () => { active.current = null; setListening(false) }
    active.current = r
    setHeard(null)
    setListening(true)
    r.start()
  }
  return { supported: !!Rec, listening, heard, listen }
}
