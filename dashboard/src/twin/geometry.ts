/** Conveyor geometry, in metres, side view in the XY plane with Z across the belt.
 *
 *  The belt is not drawn as a box. It is a closed loop wrapped around real
 *  pulleys: each straight run is the exact common tangent between two pulleys,
 *  and each wrap is an arc on the pulley. That is what makes the model read as
 *  a machine rather than a placeholder -- the return strand genuinely drops
 *  through the gravity take-up and comes back, because the path is solved, not
 *  sketched.
 *
 *  Only two dimensions come from the codebase: roll diameter
 *  (BeltModel.idler_diameter_m) and sensor positions. The length is shortened
 *  -- the real run is 250 m -- and the viewport says so.
 */

export type Pulley = { x: number; y: number; r: number; cw: boolean }

export const BELT_W = 1.4
export const ROLL_R = 0.152 / 2           // sensors_sim/belt.py idler_diameter_m
export const T = 0.012                    // belt thickness offset off every support
export const CARRY_Y = 2.4                // top of carry idler centre roll
export const TROUGH = (35 * Math.PI) / 180
export const CENTER_ROLL = 0.5
export const STRINGER_Z = 0.98

export const HEAD: Pulley = { x: 7, y: CARRY_Y - 0.4, r: 0.4, cw: true }
export const TAIL: Pulley = { x: -7, y: CARRY_Y - 0.315, r: 0.315, cw: true }
// Gravity take-up: the return strand passes over two bend pulleys and under a
// weighted pulley between them. Bend tops sit level with the adjacent strand.
export const BEND_A: Pulley = { x: -3.3, y: HEAD.y - HEAD.r - 0.15, r: 0.15, cw: false }
export const TAKEUP: Pulley = { x: -3.9, y: 0.95, r: 0.3, cw: true }
export const BEND_B: Pulley = { x: -4.5, y: TAIL.y - TAIL.r - 0.15, r: 0.15, cw: false }

/** Pulleys in the order the belt travels: carry strand runs tail -> head. */
export const LOOP = [TAIL, HEAD, BEND_A, TAKEUP, BEND_B]

export const CARRY_IDLERS = Array.from({ length: 10 }, (_, i) => -5.4 + i * 1.2)
export const IDLER_04_X = CARRY_IDLERS[3]
export const RETURN_IDLERS = [
  ...[5.5, 2.5, -0.5, -2.4].map((x) => ({ x, y: HEAD.y - HEAD.r })),
  { x: -5.8, y: TAIL.y - TAIL.r },
]
export const LEGS_X = [-6, -3, 0, 3, 6]
export const CAMERA_X = 5.4

type V = { x: number; y: number }

/** Directed common tangent from pulley A to pulley B.
 *
 *  With n the left normal of the travel direction, a pulley wrapped clockwise
 *  lies to the right of the belt, so its tangent point is c + r·n; a
 *  counter-clockwise one lies to the left, c - r·n. Requiring the segment to
 *  be perpendicular to n gives n·(cB - cA) = σA·rA - σB·rB, solved for n's
 *  angle. Of the two roots, the one travelling from A towards B is kept. */
export function tangent(a: Pulley, b: Pulley, pad = 0): { p0: V; p1: V } {
  const ra = a.r + pad, rb = b.r + pad
  const sa = a.cw ? 1 : -1, sb = b.cw ? 1 : -1
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const k = sa * ra - sb * rb
  const phi = Math.atan2(dy, dx), alpha = Math.acos(k / len)
  for (const ang of [phi + alpha, phi - alpha]) {
    const nx = Math.cos(ang), ny = Math.sin(ang)
    if (ny * dx - nx * dy > 0) {
      return {
        p0: { x: a.x + sa * ra * nx, y: a.y + sa * ra * ny },
        p1: { x: b.x + sb * rb * nx, y: b.y + sb * rb * ny },
      }
    }
  }
  throw new Error('no tangent: pulleys overlap')
}

export type Loop = {
  x: Float32Array; y: Float32Array; s: Float32Array; carry: Uint8Array
  length: number
  carryX: [number, number]
}

/** Sample the whole belt loop: straights every `step` m, arcs every 6 degrees. */
export function buildLoop(step = 0.1): Loop {
  const n = LOOP.length
  const tans = LOOP.map((p, i) => tangent(p, LOOP[(i + 1) % n], T))
  const pts: { x: number; y: number; carry: boolean }[] = []

  for (let i = 0; i < n; i++) {
    const { p0, p1 } = tans[i]
    const m = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / step))
    for (let k = 0; k < m; k++) {
      const f = k / m
      pts.push({ x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f, carry: i === 0 })
    }
    const c = LOOP[(i + 1) % n]
    const next = tans[(i + 1) % n].p0
    const a0 = Math.atan2(p1.y - c.y, p1.x - c.x)
    const a1 = Math.atan2(next.y - c.y, next.x - c.x)
    const tau = Math.PI * 2
    const sweep = (((c.cw ? a0 - a1 : a1 - a0) % tau) + tau) % tau
    const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 30)))
    for (let k = 0; k < steps; k++) {
      const a = a0 + (c.cw ? -1 : 1) * (sweep * k) / steps
      pts.push({ x: c.x + (c.r + T) * Math.cos(a), y: c.y + (c.r + T) * Math.sin(a), carry: false })
    }
  }

  const N = pts.length
  const out: Loop = {
    x: new Float32Array(N + 1), y: new Float32Array(N + 1), s: new Float32Array(N + 1),
    carry: new Uint8Array(N + 1), length: 0,
    carryX: [tans[0].p0.x, tans[0].p1.x],
  }
  let s = 0
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N]                   // repeat the first point to close the loop
    if (i > 0) s += Math.hypot(p.x - out.x[i - 1], p.y - out.y[i - 1])
    out.x[i] = p.x; out.y[i] = p.y; out.s[i] = s; out.carry[i] = p.carry ? 1 : 0
  }
  out.length = s
  return out
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** How far the carry strand is troughed at `x`: flat on the pulleys, full
 *  trough once past the transition zone. */
export function troughAt(loop: Loop, x: number): number {
  const [x0, x1] = loop.carryX
  return smooth(x0 + 0.2, x0 + 1.4, x) * smooth(x1 - 0.2, x1 - 1.4, x)
}

/** Belt cross-section offset for lateral position `u` at trough factor `k`:
 *  flat over the centre roll, wings folded up at 35 degrees. Returns [dz, dy]. */
export function section(u: number, k: number): [number, number] {
  const c = CENTER_ROLL / 2, a = Math.abs(u)
  if (a <= c || k === 0) return [u, 0]
  const d = a - c, th = TROUGH * k
  return [Math.sign(u) * (c + d * Math.cos(th)), d * Math.sin(th)]
}

/** Point on the loop centreline at arc length `s` (wraps). */
export function pointAt(loop: Loop, s: number): { x: number; y: number; carry: boolean } {
  const L = loop.length
  const v = ((s % L) + L) % L
  let lo = 0, hi = loop.s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (loop.s[mid] <= v) lo = mid
    else hi = mid
  }
  const f = (v - loop.s[lo]) / Math.max(1e-9, loop.s[hi] - loop.s[lo])
  return {
    x: loop.x[lo] + (loop.x[hi] - loop.x[lo]) * f,
    y: loop.y[lo] + (loop.y[hi] - loop.y[lo]) * f,
    carry: loop.carry[lo] === 1 && loop.carry[hi] === 1,
  }
}

/** Arc length at which the carry strand crosses `x`. */
export function carryS(loop: Loop, x: number): number {
  for (let i = 1; i < loop.s.length; i++) {
    if (loop.carry[i] && loop.x[i] >= x) return loop.s[i]
  }
  return 0
}

/** Write the belt surface for arc-length range [s0, s1] into `pos`/`uv`
 *  (rows along s, `cols` vertices across). Shared by the belt and the splice
 *  so the splice lies exactly on the belt wherever it travels. */
export function fillSurface(
  loop: Loop, s0: number, s1: number, rows: number, cols: number,
  pos: Float32Array, uv?: Float32Array,
) {
  let o = 0, t = 0
  for (let i = 0; i < rows; i++) {
    const s = s0 + ((s1 - s0) * i) / (rows - 1)
    const p = pointAt(loop, s)
    const k = p.carry ? troughAt(loop, p.x) : 0
    for (let j = 0; j < cols; j++) {
      const u = -BELT_W / 2 + (BELT_W * j) / (cols - 1)
      const [dz, dy] = section(u, k)
      pos[o++] = p.x; pos[o++] = p.y + dy; pos[o++] = dz
      if (uv) { uv[t++] = s / 2; uv[t++] = j / (cols - 1) }
    }
  }
}
