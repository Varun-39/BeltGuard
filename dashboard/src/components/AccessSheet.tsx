import type { Prefs } from '../prefs'
import { canSpeak } from '../voice'
import { PARTS, PART_ORDER } from '../model'
import { Segmented } from './ui'

const KEYS: [string, string][] = [
  [`1–${PART_ORDER.length}`, PART_ORDER.map((id) => PARTS[id].name).join(', ')],
  ['Esc', 'Back to overview'],
  ['P', 'Pause or resume the live view'],
  ['R', 'Read status aloud'],
  ['V', 'Speak a command'],
]

export function AccessSheet({ prefs, update, onReadStatus, voice }: {
  prefs: Prefs
  update: (p: Partial<Prefs>) => void
  onReadStatus: () => void
  voice: { supported: boolean; listening: boolean; heard: string | null; listen: () => void }
}) {
  return (
    <div id="access" popover="auto" className="sheet glass" aria-label="Display and accessibility">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-[13px] font-600">Display and accessibility</h2>
        <p className="text-[12px] text-[var(--fg-2)]">Saved in this browser.</p>
      </div>

      <div className="space-y-3 px-4 py-4">
        <Segmented label="Appearance" value={prefs.theme} onChange={(theme) => update({ theme })}
                   options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} />
        <Segmented label="Text size" value={prefs.scale} onChange={(scale) => update({ scale })}
                   options={[[1, '100%'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']]} />
        <Segmented label="Contrast" value={prefs.contrast} onChange={(contrast) => update({ contrast })}
                   options={[['standard', 'Standard'], ['more', 'High']]} />
        <Segmented label="Motion" value={prefs.motion} onChange={(motion) => update({ motion })}
                   options={[['system', 'Auto'], ['reduced', 'Reduced']]} />
      </div>

      <div className="space-y-3 border-t border-[var(--line)] px-4 py-4">
        <h3 className="heading">Voice</h3>
        {canSpeak ? (
          <>
            <button type="button" onClick={onReadStatus}
                    className="row w-full cursor-pointer border border-[var(--line)] px-3 py-2 text-left text-[13px]">
              Read status aloud <span className="float-right text-[12px] text-[var(--fg-3)]">R</span>
            </button>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input type="checkbox" checked={prefs.announce} onChange={(e) => update({ announce: e.target.checked })}
                     className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>
                Announce state changes
                <span className="block text-[12px] text-[var(--fg-2)]">Speaks each confirmed escalation or recovery.</span>
              </span>
            </label>
          </>
        ) : (
          <p className="text-[12px] text-[var(--fg-2)]">Speech output is not available in this browser.</p>
        )}

        {voice.supported ? (
          <div>
            <button type="button" onClick={voice.listen} disabled={voice.listening}
                    className="w-full cursor-pointer rounded-[6px] bg-[var(--accent)] px-3 py-2 text-left text-[13px] font-500 text-[var(--on-accent)] transition-opacity disabled:opacity-70">
              {voice.listening ? 'Listening…' : 'Speak a command'}
              <span className="float-right text-[12px] opacity-80">V</span>
            </button>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--fg-2)]" aria-live="polite">
              {voice.heard ?? 'Try “idler”, “splice”, “overview”, “pause” or “status”.'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-3)]">
              Uses your browser’s speech recognition; some browsers send the audio to their vendor to transcribe.
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--fg-2)]">Voice commands need Chrome, Edge or Safari.</p>
        )}
      </div>

      <div className="border-t border-[var(--line)] px-4 py-4">
        <h3 className="heading mb-2">Keyboard</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {KEYS.map(([k, what]) => (
            <div key={k} className="contents">
              <dt><kbd className="num rounded-[4px] border border-[var(--line-strong)] px-1.5 py-px text-[11px]">{k}</kbd></dt>
              <dd className="text-[var(--fg-2)]">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
