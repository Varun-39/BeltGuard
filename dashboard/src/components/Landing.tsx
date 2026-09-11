import { useEffect } from 'react'
import type { Frame } from '../useLive'
import { PARTS, PART_ORDER, SUBSYSTEM_LABEL, levelFor, partScore } from '../model'
import { configured as googleConfigured, type Auth } from '../auth'
import { motion } from './motion'
import { LevelText, Mark } from './ui'

/** The first screen is the machine itself. The 3D conveyor behind this text
 *  is the same live scene the workstation uses; "Open workstation" moves the
 *  camera into it rather than cutting to another page.
 *
 *  Gated by Google sign-in only when VITE_GOOGLE_CLIENT_ID is set (auth.ts) --
 *  unconfigured, entry needs nothing, same as before this existed. */
export function Landing({ frame, connected, reduced, dark, auth, onEnter }: {
  frame: Frame | null; connected: boolean; reduced: boolean; dark: boolean; auth: Auth; onEnter: () => void
}) {
  const canEnter = !googleConfigured || !!auth.user

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (canEnter && e.key === 'Enter' && !(e.target as HTMLElement).closest('button, a, input, [popover]')) onEnter()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onEnter, canEnter])

  const h = frame?.health
  const worst = frame
    ? PART_ORDER.filter((id) => (partScore(frame, id) ?? 100) < 80)
        .sort((a, b) => partScore(frame, a)! - partScore(frame, b)!)[0]
    : undefined
  const worstSub = worst && frame
    ? PARTS[worst].subsystems.reduce((a, b) => ((frame.health.subsystems[b] ?? 100) < (frame.health.subsystems[a] ?? 100) ? b : a))
    : undefined
  const sensors = Object.keys(h?.sources ?? {}).length
  const simulated = Object.values(h?.sources ?? {}).some((s) => s.simulated)

  // One orchestrated entrance, first paint only: nameplate, then the line,
  // then the action. Nothing moves after that.
  const rise = (i: number) => reduced ? {} : {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] as const, delay: 0.15 + i * 0.09 },
  }

  return (
    // Three rows: a header, a content block, and a footer. On desktop the
    // content block is flex-1 and centers within whatever's left between
    // them -- there the leftover space is modest, so splitting it above and
    // below the text looks intentional. On a phone that same leftover space
    // is large (a tall screen, a short amount to say), and centering just
    // relocates the emptiness rather than removing it -- the hero image
    // above is what's supposed to be doing the work of filling the screen.
    // So on phone the content sits in normal flow at its own height and the
    // footer follows directly after it; any true leftover ends up as
    // trailing space below the footer, at the actual end of the page,
    // which reads as "the page is short" rather than "something's missing".
    <div className="scaled pointer-events-none absolute inset-0 flex flex-col">
      <div className="pointer-events-auto flex shrink-0 items-center gap-2.5 px-6 py-5 text-[14px] sm:px-10 lg:px-14">
        <Mark dark={dark} />
        <span className="display">BeltGuard</span>
      </div>

      {/* Phone only: a plain spacer, no border. A hairline box drawn around
          mostly-empty space read worse than the empty space did -- it made
          the emptiness look like a broken placeholder instead of an accident.
          Its only job is keeping the wordmark clear of the machine, which
          the portrait camera parks in roughly this band. Taller than the
          machine strictly needs so the hero reads as a real photo of the
          conveyor, not a thumbnail floating in a lot of grid -- sized
          together with the camera's portrait zoom in Twin.tsx, not
          independently. */}
      <div className="h-[32vh] max-h-[270px] min-h-[190px] shrink-0 lg:hidden" />

      <div className="pointer-events-auto flex min-h-0 flex-col overflow-y-auto px-6 pb-4 sm:px-10 lg:flex-1 lg:justify-center lg:px-14">
        <div className="max-w-[34rem] lg:py-6">
          <motion.p {...rise(0)} className="eyebrow">Belt conveyor · condition monitoring</motion.p>
          {/* Stacked, not squeezed onto one line: at this weight and size
              "BeltGuard" run together reads as one long word competing with
              itself for space. Two lines read as a lockup, deliberately.
              Bold sans "Belt" against an italic serif "Guard" -- the actual
              technique behind the reference the user pointed at, not a full
              script face standing in for it. */}
          <motion.h1 {...rise(1)} className="wordmark mt-2 flex flex-col text-[clamp(56px,10.5vw,148px)]">
            <span className="wordmark-bold text-[var(--fg)]">Belt</span>
            <span className="wordmark-accent text-[1.08em] text-[var(--accent)]">Guard</span>
          </motion.h1>
          <motion.p {...rise(2)} className="mt-4 max-w-[26ch] text-[17px] leading-snug tracking-[-0.012em] text-[var(--fg-2)] sm:mt-5 sm:text-[20px]">
            Live condition monitoring for the belt, its splice and its idlers.
          </motion.p>

          <motion.div {...rise(3)} className="mt-5 border-t border-[var(--line-strong)] pt-3.5 text-[13px] sm:mt-7 sm:pt-4" aria-live="polite">
            {h ? (
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <LevelText level={levelFor(h.overall)} className="font-500" />
                <span className="text-[var(--fg-2)]">health <span className="num font-500 text-[var(--fg)]">{h.overall}</span> of 100</span>
                {worst && worstSub && (
                  <span className="text-[var(--fg-2)]">
                    · worst: {PARTS[worst].name}, {SUBSYSTEM_LABEL[worstSub].toLowerCase()}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-[var(--fg-2)]">{connected ? 'Connected. Waiting for the first reading…' : 'Backend not reachable.'}</p>
            )}
          </motion.div>

          <motion.div {...rise(4)} className="mt-5 sm:mt-6">
            {canEnter ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                {googleConfigured && auth.user && (
                  <img src={auth.user.picture} alt="" referrerPolicy="no-referrer"
                       className="size-7 rounded-full" />
                )}
                <button type="button" onClick={onEnter} autoFocus
                        className="w-full cursor-pointer rounded-[8px] bg-[var(--accent)] px-5 py-3 text-[14px] font-500 text-[var(--on-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-strong)] active:scale-[0.98] sm:w-auto sm:py-2.5">
                  Open workstation
                </button>
                <span className="hidden text-[12px] text-[var(--fg-3)] sm:inline">
                  or press <kbd className="num rounded-[4px] border border-[var(--line-strong)] px-1.5 py-px text-[11px]">Enter</kbd>
                </span>
                {googleConfigured && auth.user && (
                  <button type="button" onClick={auth.signOut}
                          className="cursor-pointer text-[12px] text-[var(--fg-3)] hover:text-[var(--fg-2)] hover:underline">
                    Not {auth.user.name.split(' ')[0]}?
                  </button>
                )}
              </div>
            ) : (
              <div>
                <div ref={auth.renderButton} />
                <p className="mt-2 text-[12px] text-[var(--fg-3)]">Sign in to open the workstation.</p>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      <motion.div {...rise(5)}
                  className="pointer-events-auto flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--line)] px-6 py-3 text-[11px] text-[var(--fg-3)] sm:px-10 lg:px-14">
        <span>{sensors ? `${sensors} sensors` : 'Sensors'} and an inspection camera, fused twice a second</span>
        {simulated && <span>· sensor streams are simulated</span>}
      </motion.div>
    </div>
  )
}
