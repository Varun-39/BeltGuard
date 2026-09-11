import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from './config.ts'

/** Google sign-in, via Google Identity Services -- no auth backend of our
 *  own to run. Client-side only: the ID token's payload is decoded for a
 *  name/photo to personalise the console, but its SIGNATURE IS NOT VERIFIED
 *  here. That is fine for gating who bothers opening the workstation; it is
 *  not access control. A deployment that must actually protect the telemetry
 *  needs the backend to verify the token against Google's public keys
 *  (google-auth's `verify_oauth2_token`) and issue its own session -- nothing
 *  in this file substitutes for that.
 *
 *  Needs VITE_GOOGLE_CLIENT_ID in dashboard/.env (see .env.example for how
 *  to get one). Unset, `configured` is false and callers should skip the
 *  gate entirely -- this project runs without it, it just doesn't ask. */

export type GoogleUser = { name: string; email: string; picture: string; sub: string }

// Optional-chained on `.env` itself, not just the property: this file's pure
// half (decodeJwt) is imported by auth.check.ts under plain Node, where
// import.meta has no `env` at all -- only Vite's dev/build pipeline injects it.
const CLIENT_ID: string | undefined = import.meta.env?.VITE_GOOGLE_CLIENT_ID
export const configured = Boolean(CLIENT_ID)
const STORAGE_KEY = 'beltguard.user'

type GoogleId = {
  initialize(config: {
    client_id: string
    callback: (r: { credential: string }) => void
    auto_select?: boolean
  }): void
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void
  disableAutoSelect(): void
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

export function decodeJwt(token: string): GoogleUser | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(payload))
    return { name: json.name, email: json.email, picture: json.picture, sub: json.sub }
  } catch {
    return null           // a malformed token is not a crash, just no user
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  return scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google sign-in script failed to load'))
    document.head.appendChild(s)
  })
}

function loadUser(): GoogleUser | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') } catch { return null }
}
function saveUser(u: GoogleUser | null) {
  try {
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode */ }
}

/** "Open on phone" hand-off (backend/app.py `/api/pair`), so scanning the QR
 *  doesn't ask a signed-in operator to sign in a second time on their phone.
 *  Google itself has no cross-device part in this -- it's our own backend,
 *  holding the already-decoded profile in memory for two minutes, one read.
 *  PhoneSheet calls `createPair` before drawing the code; the redeem side
 *  below runs unconditionally on load, since a `?pair=` link is only ever
 *  reached by following the QR in the first place. */
export async function createPair(user: GoogleUser): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/api/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user),
    })
    return r.ok ? (await r.json()).token : null
  } catch { return null }
}
async function redeemPair(token: string): Promise<GoogleUser | null> {
  try {
    const r = await fetch(`${API_BASE}/api/pair/${token}`)
    return r.ok ? await r.json() : null
  } catch { return null }
}

export function useGoogleAuth() {
  const [user, setUser] = useState<GoogleUser | null>(loadUser)
  const [ready, setReady] = useState(false)

  // A pairing link redeems once, on the tab that opened it, before anything
  // else -- there is no other reason a `?pair=` param would be in the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const token = params.get('pair')
    if (!token) return
    params.delete('pair')
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`)
    redeemPair(token).then((u) => { if (u) { setUser(u); saveUser(u) } })
  }, [])

  useEffect(() => {
    if (!configured) return
    let live = true
    loadScript().then(() => {
      if (!live) return
      window.google!.accounts.id.initialize({
        client_id: CLIENT_ID!,
        auto_select: false,
        callback: (r) => {
          const u = decodeJwt(r.credential)
          if (!u) return
          setUser(u)
          saveUser(u)
        },
      })
      setReady(true)
    }).catch(() => {})
    return () => { live = false }
  }, [])

  // A ref callback, not an effect: Google's button must be rendered into the
  // exact DOM node once it exists, and this re-fires on its own the moment
  // `ready` flips true, whichever mounts first.
  const renderButton = useCallback((el: HTMLDivElement | null) => {
    if (el && window.google) window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'medium', shape: 'pill' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const signOut = useCallback(() => {
    setUser(null)
    saveUser(null)
    window.google?.accounts.id.disableAutoSelect()
  }, [])

  return { user, ready, renderButton, signOut }
}

export type Auth = ReturnType<typeof useGoogleAuth>
