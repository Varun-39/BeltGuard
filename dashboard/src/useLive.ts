import { useEffect, useRef, useState } from 'react'
import { API_BASE, WS_URL } from './config'

export type Reasons = {
  subsystem: string
  indicator: string
  value: number
  severity: number
  message: string
  basis: string
}

export type Health = {
  overall: number
  state: 'NORMAL' | 'WARNING' | 'CRITICAL'
  subsystems: Record<string, number>
  reasons: Reasons[]
  simulated: boolean
  vision_active: boolean
  sources: Record<string, { sensor_id: string; simulated: boolean }>
}

export type Detection = { cls: string; conf: number; area_frac: number }

export type Frame = {
  type: 'tick'
  ts: number
  health: Health
  readings: Record<string, Record<string, number>>
  vision: { detections: Detection[] } | null
}

export type Rul = {
  confidence: string
  basis: string
  trend_per_hour?: number
  hours_to_critical: number | null
  ci_low_hours?: number | null
  ci_high_hours?: number | null
  r_squared?: number
  real_world_days: number | null
  demo_acceleration?: number
}

/** Rolling buffer of recent frames for the charts. 300 @ 2 Hz = 150 s, which
 *  matches the ~143 s belt revolution so a full splice pass is always visible. */
const BUFFER = 300

export function useLive(paused: boolean) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const [series, setSeries] = useState<Frame[]>([])
  const [connected, setConnected] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout>
    let keepalive: ReturnType<typeof setInterval>
    let closed = false

    const connect = () => {
      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        setConnected(true)
        // The server reads to detect disconnects; without traffic some proxies
        // drop an idle socket that is only ever written to.
        keepalive = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 15000)
      }
      ws.onmessage = (e) => {
        // Pausing freezes the view but keeps the socket open, so resuming is
        // instant and the backend never sees a reconnect storm.
        if (pausedRef.current) return
        const f: Frame = JSON.parse(e.data)
        setFrame(f)
        setSeries((prev) => [...prev, f].slice(-BUFFER))
      }
      ws.onclose = () => {
        setConnected(false)
        clearInterval(keepalive)
        if (!closed) retry = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(keepalive)
      ws?.close()
    }
  }, [])

  return { frame, series, connected }
}

export type Evt = {
  ts: number
  from: string
  to: string
  health: number
  reasons: string[]
  notified: boolean      // did this transition warrant an alert
  delivered: boolean     // was that alert actually sent (false if no SMTP)
}

/** Alarm log, read from the backend.
 *
 *  This used to re-derive state transitions from health history client-side,
 *  with its own copy of the deadband rule. The backend's notifier already
 *  computes confirmed transitions to decide what to escalate, so this now reads
 *  that list instead -- one implementation of the rule, and the log gains
 *  whether each transition actually reached a human. */
export function useEvents(enabled: boolean) {
  const [events, setEvents] = useState<Evt[]>([])
  const [smtp, setSmtp] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      fetch(`${API_BASE}/api/alerts`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          setEvents(d.alerts ?? [])
          setSmtp(Boolean(d.smtp_configured))
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [enabled])
  return { events, smtp }
}

/** Health at the start of the stored window, for the KPI delta.
 *
 *  Asks for one shift (8 h). The store may hold less than that -- a demo run
 *  is minutes old -- so the label states the span it actually covers rather
 *  than claiming "last shift" for a two-minute-old baseline. */
const SHIFT_MIN = 480
export function useBaseline(enabled: boolean) {
  const [base, setBase] = useState<{ value: number; label: string } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      fetch(`${API_BASE}/api/health/history?minutes=${SHIFT_MIN}`)
        .then((r) => r.json())
        .then((rows: { ts: number; overall: number }[]) => {
          if (!alive || !rows.length) return
          const mins = (Date.now() / 1000 - rows[0].ts) / 60
          const label = mins >= SHIFT_MIN * 0.95 ? 'last shift'
            : mins >= 90 ? `${(mins / 60).toFixed(1)} h ago` : `${Math.max(1, Math.round(mins))} min ago`
          setBase({ value: rows[0].overall, label })
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 60000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [enabled])
  return base
}

/** RUL refits a trend over stored history, so it is polled slowly rather than
 *  pushed: the answer moves on a scale of hours, not half-seconds. */
export function useRul(enabled: boolean) {
  const [rul, setRul] = useState<Rul | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      fetch(`${API_BASE}/api/rul?minutes=30`)
        .then((r) => r.json())
        .then((d) => alive && setRul(d))
        .catch(() => {})
    load()
    const id = setInterval(load, 10000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [enabled])
  return rul
}
