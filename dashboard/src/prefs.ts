import { useEffect, useState } from 'react'

/** Display and accessibility preferences. Per-viewer, so they live in
 *  localStorage; applied as attributes on <html> so plain CSS does the work. */
export type Prefs = {
  theme: 'system' | 'light' | 'dark'
  scale: number              // 1 = 100%; text and panels, not the 3D view
  contrast: 'standard' | 'more'
  motion: 'system' | 'reduced'
  announce: boolean          // speak confirmed state changes aloud
}

const DEFAULTS: Prefs = { theme: 'system', scale: 1, contrast: 'standard', motion: 'system', announce: false }
const KEY = 'beltguard.prefs'

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS            // storage blocked or corrupt: defaults, never a crash
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load)

  useEffect(() => {
    const el = document.documentElement
    if (prefs.theme === 'system') delete el.dataset.theme
    else el.dataset.theme = prefs.theme
    if (prefs.contrast === 'more') el.dataset.contrast = 'more'
    else delete el.dataset.contrast
    if (prefs.motion === 'reduced') el.dataset.motion = 'reduced'
    else delete el.dataset.motion
    el.style.setProperty('--ui-scale', String(prefs.scale))
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
  }, [prefs])

  // Resolved values the JS side needs: the 3D scene reads colours from CSS
  // tokens and must re-read them when the effective theme flips.
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [systemReduce, setSystemReduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const d = matchMedia('(prefers-color-scheme: dark)')
    const r = matchMedia('(prefers-reduced-motion: reduce)')
    const onD = () => setSystemDark(d.matches)
    const onR = () => setSystemReduce(r.matches)
    d.addEventListener('change', onD)
    r.addEventListener('change', onR)
    return () => { d.removeEventListener('change', onD); r.removeEventListener('change', onR) }
  }, [])

  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark)
  const reduced = prefs.motion === 'reduced' || systemReduce
  const update = (p: Partial<Prefs>) => setPrefs((cur) => ({ ...cur, ...p }))
  return { prefs, update, dark, reduced }
}
