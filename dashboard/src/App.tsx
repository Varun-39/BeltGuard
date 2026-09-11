import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { useBaseline, useEvents, useLive, useRul, type Frame, type Rul } from './useLive'
import {
  METRICS, PARTS, PART_ORDER, SUBSYSTEM_LABEL, levelFor, partScore, type Level, type PartId,
} from './model'
import { usePrefs } from './prefs'
import { speak, statusSentence, useAlarmAnnouncer, useVoiceCommands } from './voice'
import { configured as googleConfigured, useGoogleAuth, type Auth } from './auth'
import type { Command } from './commands'
// Lazy: three.js + @react-three/fiber + drei + camera-controls are most of
// the app's JS weight, and nothing above the fold needs them synchronously
// -- the header, wordmark and CTA can paint and be interactive first. Also
// the one thing keeping "open on phone" light over a real Wi-Fi link, not a
// dev-machine loopback.
const Twin = lazy(() => import('./twin/Twin').then((m) => ({ default: m.Twin })))
import { Inspector } from './components/Inspector'
import { Timeline, type TimelineSubject } from './components/Charts'
import { Landing } from './components/Landing'
import { AccessSheet } from './components/AccessSheet'
import { PhoneSheet } from './components/PhoneSheet'
import { FADE, motion } from './components/motion'
import { LevelText, Mark, Segmented } from './components/ui'

const partFromHash = () => {
  const id = location.hash.slice(1)
  return Object.hasOwn(PARTS, id) ? (id as PartId) : null
}

/** Two states of one screen. Landing: the machine, full-bleed, with its
 *  nameplate. Workstation: identity bar → twin → inspector → evidence →
 *  action. The 3D scene is shared, so entering is a camera move and the
 *  chrome growing in around it -- not a page change. */
export default function App() {
  const { prefs, update, dark, reduced } = usePrefs()
  const auth = useGoogleAuth()
  const [selected, setSelected] = useState<PartId | null>(partFromHash)
  const [entered, setEntered] = useState(() => partFromHash() !== null)   // a deep link skips the landing
  const [hovered, setHovered] = useState<PartId | null>(null)
  const [paused, setPaused] = useState(false)
  const { frame, series, connected } = useLive(paused)
  const rul = useRul(connected)
  const baseline = useBaseline(connected)
  const { events, smtp } = useEvents(connected)

  useAlarmAnnouncer(events, prefs.announce)

  const run = useCallback((c: Command) => {
    if (c.type === 'select') { setEntered(true); setSelected(c.id) }
    else if (c.type === 'overview') setSelected(null)
    else if (c.type === 'pause') setPaused(true)
    else if (c.type === 'resume') setPaused(false)
    else speak(statusSentence(frame, rul))
  }, [frame, rul])
  const voice = useVoiceCommands(run)

  useEffect(() => {
    history.replaceState(null, '', selected ? `#${selected}` : location.pathname)
  }, [selected])

  // Keyboard: every action a pointer can take has a key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') { setSelected(null); return }
      if (!entered) return
      const n = Number(e.key)
      if (n >= 1 && n <= PART_ORDER.length) setSelected(PART_ORDER[n - 1])
      else if (e.key === 'p' || e.key === 'P') setPaused((p) => !p)
      else if (e.key === 'r' || e.key === 'R') speak(statusSentence(frame, rul))
      else if (e.key === 'v' || e.key === 'V') voice.listen()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [entered, frame, rul, voice])

  const levels = useMemo(
    () => Object.fromEntries(PART_ORDER.map((id) => [id, levelFor(partScore(frame, id))])) as Record<PartId, Level>,
    [frame],
  )
  const enter = useCallback(() => setEntered(true), [])

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <div className="flex h-full flex-col">
        <a href="#diagnostics"
           className="sr-only z-50 rounded-[6px] bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--on-accent)] focus:not-sr-only focus:absolute focus:top-2 focus:left-2">
          Skip to diagnostics
        </a>

        <div className="chrome shrink-0 overflow-hidden" inert={!entered}
             style={{ height: entered ? 'calc(44px * var(--ui-scale))' : 0 }}>
          <TopBar frame={frame} connected={connected} paused={paused} setPaused={setPaused} dark={dark} auth={auth}
                  onHome={() => { setSelected(null); setEntered(false) }} />
        </div>

        <div className={`chrome relative flex min-h-0 flex-1 flex-col lg:grid ${entered ? 'overflow-y-auto lg:overflow-hidden' : 'overflow-hidden'}`}
             style={{ gridTemplateColumns: entered ? 'minmax(0,1fr) calc(384px * var(--ui-scale))' : 'minmax(0,1fr) 0px' }}>
          <main className={`flex shrink-0 flex-col lg:h-auto lg:min-h-0 ${entered ? 'h-[72vh]' : 'h-full'}`}>
            <div className="relative min-h-0 flex-1">
              {/* Fallback matches Twin's own outer wrapper (grid-bg on the
                  viewport surface) so the 3D chunk loading in behind it is
                  invisible -- same backdrop before and after, no flash. */}
              <Suspense fallback={<div className="grid-bg absolute inset-0 bg-[var(--viewport)]" />}>
                <Twin frame={frame} paused={paused} levels={levels} mode={entered ? 'work' : 'hero'}
                      reduced={reduced} themeKey={`${dark}-${prefs.contrast}`}
                      selected={selected} hovered={hovered} onSelect={setSelected} onHover={setHovered} />
              </Suspense>
              <AnimatePresence>
                {!entered && (
                  <motion.div key="landing" className="absolute inset-0"
                              exit={{ opacity: 0, y: -12, transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}>
                    <Landing frame={frame} connected={connected} reduced={reduced} dark={dark} auth={auth} onEnter={enter} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="chrome shrink-0 overflow-hidden border-t border-[var(--line)] bg-[var(--surface)]"
                 inert={!entered} style={{ height: entered ? 'calc(184px * var(--ui-scale))' : 0 }}>
              {frame && <History series={series} rul={rul} selected={selected} frame={frame} />}
            </div>
          </main>

          {/* The one panel that genuinely floats beside a live 3D view --
              the "hero card" surface, per the controlled-glass call: glass
              supplies its own border on every edge, so no Tailwind border
              utility here would survive the cascade anyway. */}
          <aside id="diagnostics" tabIndex={-1} inert={!entered} aria-label="Diagnostics"
                 className={`glass focus:outline-none lg:min-h-0 lg:overflow-y-auto ${entered ? '' : 'hidden lg:block'}`}>
            <motion.div className="scaled" initial={false}
                        animate={entered ? { opacity: 1, x: 0 } : { opacity: 0, x: 24 }}
                        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1], delay: entered ? 0.18 : 0 }}>
              {frame ? (
                <Inspector frame={frame} series={series} rul={rul} events={events} smtp={smtp} baseline={baseline}
                           selected={selected} hovered={hovered} onSelect={setSelected} onHover={setHovered} />
              ) : <Waiting connected={connected} />}
            </motion.div>
          </aside>
        </div>

        <AccessSheet prefs={prefs} update={update} voice={voice} onReadStatus={() => speak(statusSentence(frame, rul))} />
        <PhoneSheet user={auth.user} />
        {!entered && (
          <div className="scaled fixed top-3 right-3 z-10 flex items-center gap-1 sm:top-4 sm:right-5">
            <button type="button" popoverTarget="phone" aria-label="Open on phone"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] sm:px-2.5">
              <PhoneIcon /><span className="hidden sm:inline">Open on phone</span>
            </button>
            <button type="button" popoverTarget="access" aria-label="Display and accessibility"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] sm:px-2.5">
              <AccessIcon /><span className="hidden sm:inline">Accessibility</span>
            </button>
          </div>
        )}
      </div>
    </MotionConfig>
  )
}

function AccessIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
         strokeLinecap="round" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="7" />
      <circle cx="8" cy="4.6" r="0.9" fill="currentColor" stroke="none" />
      <path d="M4.5 6.6 8 7.4l3.5-.8M8 7.4v2.4l-1.6 3M8 9.8l1.6 3" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden className="shrink-0">
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.4" />
      <path d="M7 12h2" strokeLinecap="round" />
    </svg>
  )
}

/** Who is at the console. A picture avoids depending on Google's photo CDN
 *  staying reachable -- falls back to an initial on a flat tile. A real
 *  toggle button rather than a hover card: hover-only menus are unreachable
 *  by keyboard and unusable on a touch phone, and this whole feature exists
 *  to be opened on a phone. */
function UserChip({ user, onSignOut }: { user: NonNullable<Auth['user']>; onSignOut: () => void }) {
  const [broken, setBroken] = useState(false)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0"
         onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}
         onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
              aria-label={`Signed in as ${user.name}`} className="block cursor-pointer rounded-full">
        {!broken ? (
          <img src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
               className="size-6 rounded-full" />
        ) : (
          <span className="grid size-6 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-600 text-[var(--accent)]">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-20 mt-1.5 w-44 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <p className="truncate px-3 py-1.5 text-[12px] text-[var(--fg-2)]">{user.name}</p>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut() }}
                  className="w-full cursor-pointer px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--hover)]">
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** Identity reads like a machine plate: the asset number in nameplate
 *  lettering, where it is, and one labelled readout of its condition. */
function TopBar({ frame, connected, paused, setPaused, onHome, dark, auth }: {
  frame: Frame | null; connected: boolean; paused: boolean
  setPaused: (p: boolean) => void; onHome: () => void; dark: boolean; auth: Auth
}) {
  const health = frame?.health
  const simulated = Object.values(health?.sources ?? {}).some((s) => s.simulated)
  return (
    <header className="scaled flex h-11 items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-3 sm:gap-4 sm:px-4">
      <button type="button" onClick={onHome} aria-label="BeltGuard, back to the start screen"
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[6px] py-1 pr-1 text-[14px]">
        <Mark dark={dark} /> <span className="display hidden sm:inline">BeltGuard</span>
      </button>
      {health && (
        <>
          <span aria-hidden className="h-5 w-px shrink-0 bg-[var(--line-strong)]" />
          <div className="flex shrink-0 flex-col leading-tight" role="status" aria-live="polite">
            <span className="eyebrow">Condition</span>
            <LevelText level={levelFor(health.overall)} className="text-[13px] font-500" />
          </div>
        </>
      )}

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        {simulated && (
          <span className="hidden text-[12px] text-[var(--fg-2)] lg:inline"
                title="At least one sensor stream is generated by the simulator, not read from hardware.">
            Simulated data
          </span>
        )}
        {connected ? (
          <Segmented label="Data stream" legend={false} value={paused} onChange={setPaused}
                     options={[[false, 'Live'], [true, 'Paused']]} />
        ) : (
          <span className="hidden text-[12px] text-[var(--fg-2)] sm:inline">Reconnecting…</span>
        )}
        {googleConfigured && auth.user && <UserChip user={auth.user} onSignOut={auth.signOut} />}
        <button type="button" popoverTarget="phone" aria-label="Open on phone"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]">
          <PhoneIcon /><span className="hidden xl:inline">Open on phone</span>
        </button>
        <button type="button" popoverTarget="access" aria-label="Display and accessibility"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-[var(--fg-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)]">
          <AccessIcon /><span className="hidden xl:inline">Accessibility</span>
        </button>
      </div>
    </header>
  )
}

/** What the history strip shows for each selection: the part's own score,
 *  or its primary reading when it has no score. */
function subjectFor(id: PartId | null, frame: Frame): TimelineSubject {
  if (!id || id === 'head') return { type: 'overall' }
  if (id === 'takeup') return { type: 'metric', id: 'tension' }
  if (id === 'tail') return { type: 'metric', id: 'speed' }
  if (id === 'camera') return { type: 'subsystem', key: 'belt_body' }
  const key = PARTS[id].subsystems
    .reduce((a, b) => ((frame.health.subsystems[b] ?? 100) < (frame.health.subsystems[a] ?? 100) ? b : a))
  return { type: 'subsystem', key }
}

function History({ series, rul, selected, frame }: {
  series: Frame[]; rul: Rul | null; selected: PartId | null; frame: Frame
}) {
  const subject = subjectFor(selected, frame)
  const [title, key] = subject.type === 'overall' ? ['Health index', 'overall']
    : subject.type === 'subsystem' ? [SUBSYSTEM_LABEL[subject.key], subject.key]
    : [METRICS[subject.id].label, subject.id]
  const projecting = subject.type === 'overall' && !!rul?.hours_to_critical && (rul.trend_per_hour ?? 0) > 0

  return (
    <section className="scaled h-[184px] px-4 pt-3 pb-2" aria-label={`${title} history`}>
      <div className="flex items-baseline gap-3">
        <h2 className="heading">{title}</h2>
        {selected && subject.type !== 'overall' && <span className="text-[12px] text-[var(--fg-3)]">{PARTS[selected].name}</span>}
        <span className="ml-auto flex items-center gap-4 text-[12px] text-[var(--fg-3)]">
          {projecting && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="2" aria-hidden><line x1="0" x2="16" y1="1" y2="1" stroke="var(--fg-2)" strokeDasharray="4 3" /></svg>
              projection
            </span>
          )}
          last 2.5 min
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key} className="h-[140px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }} transition={FADE}>
          <Timeline series={series} rul={rul} subject={subject} />
        </motion.div>
      </AnimatePresence>
    </section>
  )
}

/** No telemetry yet: say exactly what to start. */
function Waiting({ connected }: { connected: boolean }) {
  return (
    <div className="px-5 py-6">
      <h2 className="text-[15px] font-600">Waiting for telemetry</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--fg-2)]">
        {connected ? 'Connected, but no sensor data on the bus yet.' : 'The backend is not reachable.'} Start the services:
      </p>
      <pre className="num mt-4 overflow-x-auto rounded-[8px] border border-[var(--line)] bg-[var(--bg)] p-4 text-[12px] leading-relaxed">
{`python infra/broker.py
python -m uvicorn backend.app:app --port 8010
python -m sensors_sim.run`}
      </pre>
    </div>
  )
}
