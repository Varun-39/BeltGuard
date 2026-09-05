import { useEffect, useRef, useState } from 'react'

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
  method?: string
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
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)

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

export type Evt = { ts: number; kind: 'state'; from: string; to: string }

/** Alarm log, derived client-side from health history the backend already
 *  stores. No new table and no new endpoint -- a state transition is just a
 *  change between consecutive rows of /api/health/history. */
export function useEvents(enabled: boolean) {
  const [events, setEvents] = useState<Evt[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      fetch('/api/health/history?minutes=60')
        .then((r) => r.json())
        .then((rows: { ts: number; state: string }[]) => {
          if (!alive) return
          // Deadband: a new state must hold for HOLD consecutive samples before
          // it counts as a transition. Health hovering on a threshold otherwise
          // fills the log with WARNING->NORMAL->WARNING noise, which is the
          // classic way an alarm list becomes something operators ignore.
          const HOLD = 4
          const out: Evt[] = []
          let confirmed = rows[0]?.state
          for (let i = 1; i < rows.length; i++) {
            const s2 = rows[i].state
            if (s2 === confirmed) continue
            const holds = rows.slice(i, i + HOLD)
            if (holds.length === HOLD && holds.every((r) => r.state === s2)) {
              out.push({ ts: rows[i].ts, kind: 'state', from: confirmed, to: s2 })
              confirmed = s2
            }
          }
          setEvents(out.reverse().slice(0, 40))   // newest first
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [enabled])
  return events
}

/** RUL refits a trend over stored history, so it is polled slowly rather than
 *  pushed: the answer moves on a scale of hours, not half-seconds. */
export function useRul(enabled: boolean) {
  const [rul, setRul] = useState<Rul | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      fetch('/api/rul?minutes=30')
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
