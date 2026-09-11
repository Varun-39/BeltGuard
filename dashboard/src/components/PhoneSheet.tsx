import { useEffect, useRef, useState } from 'react'
import { toCanvas } from 'qrcode'
import { createPair, type GoogleUser } from '../auth'

type Status = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'unavailable' }

/** Scan to open this exact view on a phone on the same Wi-Fi. The dev server
 *  hands out its own LAN address (vite.config.ts, `/__lan-ip`) because the
 *  browser has no API to ask the OS for it. That endpoint exists only in
 *  `vite dev`, so a production build falls back to plain instructions rather
 *  than a broken QR code.
 *
 *  Signed in, the link also carries a one-time pairing token (auth.ts,
 *  backend `/api/pair`) so the phone opens already signed in -- scanning is
 *  the same "yes, this is me" gesture as typing a password would have been. */
export function PhoneSheet({ user }: { user: GoogleUser | null }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    setStatus({ kind: 'loading' })
    Promise.all([
      fetch('/__lan-ip').then((r) => r.json()) as Promise<{ ip: string | null }>,
      user ? createPair(user) : Promise.resolve(null),
    ]).then(([{ ip }, token]) => {
      if (!live) return
      if (!ip) { setStatus({ kind: 'unavailable' }); return }
      const port = location.port || '3000'
      // The query string comes before the hash fragment either way.
      const query = token ? `?pair=${token}` : ''
      setStatus({ kind: 'ready', url: `http://${ip}:${port}${location.pathname}${query}${location.hash}` })
    }).catch(() => live && setStatus({ kind: 'unavailable' }))
    return () => { live = false }
  }, [user])

  useEffect(() => {
    if (status.kind !== 'ready' || !canvas.current) return
    toCanvas(canvas.current, status.url, { margin: 1, width: 176 }).catch(() => {})
  }, [status])

  return (
    <div id="phone" popover="auto" className="sheet glass" aria-label="Open on phone">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-[13px] font-600">Open on phone</h2>
        <p className="text-[12px] text-[var(--fg-2)]">
          Scan with a phone on the same Wi-Fi. It opens this same view, live{user ? ', already signed in' : ''}.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 px-4 py-5">
        {status.kind === 'ready' && (
          <>
            <canvas ref={canvas} width={176} height={176} className="rounded-[6px] border border-[var(--line)]" />
            <p className="num text-center text-[11px] break-all text-[var(--fg-3)]">{status.url}</p>
          </>
        )}
        {status.kind === 'loading' && <p className="text-[12px] text-[var(--fg-3)]">Finding this machine's address…</p>}
        {status.kind === 'unavailable' && (
          <p className="text-[12px] leading-relaxed text-[var(--fg-2)]">
            Not available from this build. On the same Wi-Fi, open this machine's
            local address on port {location.port || '3000'} from your phone's browser instead.
          </p>
        )}
      </div>
    </div>
  )
}
