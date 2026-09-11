// Run: node --experimental-strip-types src/twin/geometry.check.ts
import assert from 'node:assert/strict'
import { BEND_A, CARRY_Y, HEAD, LOOP, T, TAIL, buildLoop, carryS, pointAt, tangent } from './geometry.ts'

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

// Carry strand: level, resting on the pulley tops.
const carry = tangent(TAIL, HEAD, T)
near(carry.p0.y, CARRY_Y + T)
near(carry.p1.y, CARRY_Y + T)
assert.ok(carry.p1.x > carry.p0.x, 'carry runs tail -> head')

// Return strand leaves the head underneath and meets the bend pulley on top.
const ret = tangent(HEAD, BEND_A, T)
near(ret.p0.y, HEAD.y - HEAD.r - T, 1e-4)
near(ret.p1.y, BEND_A.y + BEND_A.r + T, 1e-4)

// Every tangent point sits exactly on its pulley (radius + thickness offset).
for (let i = 0; i < LOOP.length; i++) {
  const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length]
  const { p0, p1 } = tangent(a, b, T)
  near(Math.hypot(p0.x - a.x, p0.y - a.y), a.r + T)
  near(Math.hypot(p1.x - b.x, p1.y - b.y), b.r + T)
}

// The loop closes and arc-length lookup wraps.
const loop = buildLoop()
const start = pointAt(loop, 0), wrapped = pointAt(loop, loop.length)
near(start.x, wrapped.x, 1e-4)
near(start.y, wrapped.y, 1e-4)
assert.ok(loop.length > 30 && loop.length < 40, `loop length ${loop.length}`)
near(pointAt(loop, carryS(loop, 0)).y, CARRY_Y + T, 1e-3)

console.log('geometry ok, loop', loop.length.toFixed(2), 'm')
