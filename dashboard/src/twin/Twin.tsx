import { Canvas, useFrame, useThree, type ThreeElements } from '@react-three/fiber'
import { CameraControls, Environment, Html, Lightformer, Outlines } from '@react-three/drei'
import type CameraControlsImpl from 'camera-controls'
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Frame } from '../useLive'
import { BELT_LENGTH_M, LEVEL_LABEL, PARTS, type Level, type PartId } from '../model'
import {
  BELT_W, BEND_A, BEND_B, CAMERA_X, CARRY_IDLERS, CARRY_Y, CENTER_ROLL, HEAD, IDLER_04_X, LEGS_X,
  RETURN_IDLERS, ROLL_R, STRINGER_Z, T, TAIL, TAKEUP, TROUGH, buildLoop, carryS, fillSurface, pointAt,
  type Pulley,
} from './geometry'

/* ── Selection model ────────────────────────────────────────────────────────
   One selected part at a time. Everything else ghosts so the part can be
   seen in place -- the belt has to go translucent for an idler underneath it
   to be visible at all. Parts that give the selection physical context
   (the belt around a splice, the frame a pulley sits in) ghost less.      */

type Owner = PartId | 'structure'

type TwinState = {
  mode: 'hero' | 'work'
  selected: PartId | null
  hovered: PartId | null
  select: (id: PartId | null) => void
  hover: (id: PartId | null) => void
  register: (id: PartId, o: THREE.Object3D | null) => void
  accent: string
  hoverLine: string
}
const TwinCtx = createContext<TwinState>(null!)
const OwnerCtx = createContext<Owner>('structure')

const CONTEXT: Partial<Record<PartId, Owner[]>> = {
  splice: ['belt'], belt: ['splice'], camera: ['belt', 'structure'],
  head: ['structure'], tail: ['structure'], takeup: ['structure'],
}
function targetOpacity(owner: Owner, selected: PartId | null) {
  if (!selected || owner === selected) return 1
  return CONTEXT[selected]?.includes(owner) ? 0.32 : 0.06
}

function makeMaterials() {
  const std = (color: string, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent: true })
  // The structure wears the same machine green as the interface accent:
  // hammertone enamel, the finish of lathes, mills and gearboxes.
  return {
    paint: std('#56715f', 0.55, 0.28),       // structural steel, machine-green enamel
    steel: std('#a7abad', 0.36, 0.85),       // roll shells, shafts
    lagging: std('#2a2c2b', 0.82, 0),        // rubber pulley lagging
    dark: std('#3b413e', 0.45, 0.45),        // gearbox, motor, bearing housings
    concrete: std('#6e6f6a', 0.92, 0),       // take-up counterweight
    housing: std('#dcdfda', 0.4, 0.1),       // camera enclosure
  }
}
type Mats = ReturnType<typeof makeMaterials>

/** Materials owned by the enclosing part, fading toward their ghost opacity
 *  with exponential damping -- continuous, interruptible, never a snap. */
function useMaterials(extra: THREE.Material[] = []): Mats {
  const owner = useContext(OwnerCtx)
  const { selected } = useContext(TwinCtx)
  const mats = useMemo(() => makeMaterials(), [])
  useFrame((_, dt) => {
    const target = targetOpacity(owner, selected)
    for (const m of [...Object.values(mats), ...extra]) {
      m.opacity = THREE.MathUtils.damp(m.opacity, target, 9, dt)
      m.depthWrite = m.opacity > 0.97
    }
  })
  return mats
}

/** Selection outline: a thin accent edge, the same device CAD viewers use.
 *  Thickness is in pixels. Do NOT pass `screenspace`: drei 10.7's shader has
 *  that flag's branches swapped, and `true` extrudes in metres -- a 2 m halo. */
function Edge() {
  const owner = useContext(OwnerCtx)
  const { selected, hovered, accent, hoverLine } = useContext(TwinCtx)
  if (owner === 'structure') return null
  if (selected === owner) return <Outlines thickness={2} angle={0} color={accent} />
  if (hovered === owner) return <Outlines thickness={1.25} angle={0} color={hoverLine} />
  return null
}

function M({ children, ...props }: ThreeElements['mesh']) {
  return <mesh castShadow receiveShadow {...props}>{children}<Edge /></mesh>
}

function Part({ id, children }: { id: PartId; children: ReactNode }) {
  const t = useContext(TwinCtx)
  return (
    <OwnerCtx.Provider value={id}>
      <group ref={(o) => t.register(id, o)}
             onClick={(e) => { if (e.delta > 4 || t.mode === 'hero') return; e.stopPropagation(); t.select(id) }}
             onPointerOver={(e) => { if (t.mode === 'hero') return; e.stopPropagation(); t.hover(id) }}
             onPointerOut={() => t.hover(null)}>
        {children}
      </group>
    </OwnerCtx.Provider>
  )
}

/* ── Geometry helpers ───────────────────────────────────────────────────── */

const Z_AXIS: [number, number, number] = [Math.PI / 2, 0, 0]   // cylinder Y -> Z

function Box({ at, size, mat }: { at: [number, number, number]; size: [number, number, number]; mat: THREE.Material }) {
  return <M position={at} material={mat}><boxGeometry args={size} /></M>
}

/** Drum pulley across the belt: rubber-lagged or painted shell, steel end discs, through shaft. */
function Drum({ p, length, shaft, m, lagged = true }: { p: Pulley; length: number; shaft: number; m: Mats; lagged?: boolean }) {
  return (
    <group position={[p.x, p.y, 0]}>
      <M rotation={Z_AXIS} material={lagged ? m.lagging : m.dark}>
        <cylinderGeometry args={[p.r, p.r, length, 48]} />
      </M>
      {[-1, 1].map((s) => (
        <M key={s} rotation={Z_AXIS} position={[0, 0, (s * length) / 2]} material={m.steel}>
          <cylinderGeometry args={[p.r * 0.98, p.r * 0.98, 0.025, 48]} />
        </M>
      ))}
      <M rotation={Z_AXIS} material={m.steel}>
        <cylinderGeometry args={[Math.max(0.035, p.r * 0.14), Math.max(0.035, p.r * 0.14), shaft, 20]} />
      </M>
    </group>
  )
}

/** Plummer-block bearing housing on a pulley shaft. */
function BearingBlock({ x, y, z, m }: { x: number; y: number; z: number; m: Mats }) {
  return (
    <group position={[x, y, z]}>
      <Box at={[0, -0.02, 0]} size={[0.3, 0.2, 0.16]} mat={m.dark} />
      <Box at={[0, -0.13, 0]} size={[0.42, 0.04, 0.2]} mat={m.dark} />
    </group>
  )
}

/* ── Carry idler set: centre roll plus two wing rolls at the trough angle ─ */

const WING = (BELT_W - CENTER_ROLL) / 2
const ROLL_Y = CARRY_Y - ROLL_R
const BASE_Y = ROLL_Y - ROLL_R - 0.06
const STRINGER_TOP = BASE_Y - 0.03
const STRINGER_Y = STRINGER_TOP - 0.11
const STRINGER_BOTTOM = STRINGER_TOP - 0.22

function wingRoll(s: number, d: number) {
  // Point on the wing at distance d from the fold, pushed down the wing normal.
  const zc = s * (CENTER_ROLL / 2 + d * Math.cos(TROUGH))
  const yc = CARRY_Y + d * Math.sin(TROUGH)
  return { z: zc + s * Math.sin(TROUGH) * ROLL_R, y: yc - Math.cos(TROUGH) * ROLL_R }
}

function IdlerSet({ x, m, instrumented = false }: { x: number; m: Mats; instrumented?: boolean }) {
  const mid = wingRoll(1, WING / 2 + 0.01)
  const outer = wingRoll(1, WING - 0.02)
  const outerZ = outer.z + 0.03
  return (
    <group position={[x, 0, 0]}>
      <M position={[0, ROLL_Y, 0]} rotation={Z_AXIS} material={m.steel}>
        <cylinderGeometry args={[ROLL_R, ROLL_R, CENTER_ROLL - 0.03, 32]} />
      </M>
      {[-1, 1].map((s) => (
        <M key={s} position={[0, mid.y, s * mid.z]} rotation={[s * (Math.PI / 2 - TROUGH), 0, 0]} material={m.steel}>
          <cylinderGeometry args={[ROLL_R, ROLL_R, WING - 0.05, 32]} />
        </M>
      ))}
      {/* Frame: base angle across the stringers, brackets at every roll end. */}
      <Box at={[0, BASE_Y, 0]} size={[0.07, 0.06, STRINGER_Z * 2 + 0.1]} mat={m.paint} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box at={[0, (BASE_Y + ROLL_Y) / 2, s * (CENTER_ROLL / 2)]} size={[0.06, ROLL_Y - BASE_Y, 0.012]} mat={m.paint} />
          <Box at={[0, (BASE_Y + outer.y) / 2, s * outerZ]} size={[0.06, outer.y - BASE_Y + 0.02, 0.012]} mat={m.paint} />
        </group>
      ))}
      {instrumented && (
        // The three sensors actually fitted here (sensors_sim default_array):
        // accelerometer and temperature probe on the bracket, microphone beside it.
        <group position={[0, 0, outerZ + 0.03]}>
          <M position={[0, outer.y - 0.02, 0]} rotation={Z_AXIS} material={m.dark}>
            <cylinderGeometry args={[0.028, 0.028, 0.04, 20]} />
          </M>
          <Box at={[0, outer.y - 0.12, 0.005]} size={[0.05, 0.07, 0.05]} mat={m.dark} />
          <M position={[0, BASE_Y + 0.08, 0.02]} rotation={Z_AXIS} material={m.dark}>
            <cylinderGeometry args={[0.018, 0.018, 0.08, 16]} />
          </M>
        </group>
      )}
    </group>
  )
}

function ReturnIdler({ x, y, m }: { x: number; y: number; m: Mats }) {
  const cy = y - T - ROLL_R
  const z = BELT_W / 2 + 0.1
  return (
    <group position={[x, 0, 0]}>
      <M position={[0, cy, 0]} rotation={Z_AXIS} material={m.steel}>
        <cylinderGeometry args={[ROLL_R, ROLL_R, BELT_W + 0.1, 32]} />
      </M>
      {[-1, 1].map((s) => (
        <Box key={s} at={[0, (cy + STRINGER_BOTTOM) / 2, s * z]} size={[0.06, STRINGER_BOTTOM - cy + 0.04, 0.012]} mat={m.paint} />
      ))}
    </group>
  )
}

/* ── Structure: stringers, legs, end frames, drive platform ─────────────── */

function Structure() {
  const m = useMaterials()
  const postZ = 1.12
  return (
    <group>
      {[-1, 1].map((s) => (
        <Box key={s} at={[0, STRINGER_Y, s * STRINGER_Z]} size={[13.1, 0.22, 0.09]} mat={m.paint} />
      ))}
      {LEGS_X.map((x) => (
        <group key={x}>
          {[-1, 1].map((s) => (
            <group key={s}>
              <Box at={[x, STRINGER_BOTTOM / 2, s * STRINGER_Z]} size={[0.1, STRINGER_BOTTOM, 0.1]} mat={m.paint} />
              <Box at={[x, 0.01, s * STRINGER_Z]} size={[0.24, 0.02, 0.24]} mat={m.paint} />
            </group>
          ))}
          <Box at={[x, 0.32, 0]} size={[0.07, 0.07, STRINGER_Z * 2]} mat={m.paint} />
        </group>
      ))}
      {/* End frames carrying the pulley bearings. */}
      {[{ p: HEAD, x0: 6.55 }, { p: TAIL, x0: -6.55 }].map(({ p, x0 }) => (
        <group key={p.x}>
          {[-1, 1].map((s) => (
            <group key={s}>
              <Box at={[p.x, (p.y - 0.15) / 2, s * postZ]} size={[0.14, p.y - 0.15, 0.14]} mat={m.paint} />
              <Box at={[p.x, 0.01, s * postZ]} size={[0.3, 0.02, 0.3]} mat={m.paint} />
              <Box at={[(p.x + x0) / 2, STRINGER_Y, s * (STRINGER_Z + 0.07)]} size={[Math.abs(p.x - x0) + 0.1, 0.16, 0.06]} mat={m.paint} />
            </group>
          ))}
          <Box at={[p.x, 0.45, 0]} size={[0.1, 0.08, postZ * 2]} mat={m.paint} />
        </group>
      ))}
      {/* Drive platform beside the head pulley. */}
      <Box at={[HEAD.x + 0.55, HEAD.y - 0.34, 1.62]} size={[1.5, 0.06, 0.72]} mat={m.paint} />
      {[[HEAD.x - 0.1, 1.35], [HEAD.x + 1.2, 1.35], [HEAD.x + 1.2, 1.9]].map(([x, z]) => (
        <Box key={`${x}${z}`} at={[x, (HEAD.y - 0.37) / 2, z]} size={[0.08, HEAD.y - 0.37, 0.08]} mat={m.paint} />
      ))}
      {CARRY_IDLERS.filter((x) => x !== IDLER_04_X).map((x) => <IdlerSet key={x} x={x} m={m} />)}
      {RETURN_IDLERS.map((r) => <ReturnIdler key={r.x} x={r.x} y={r.y} m={m} />)}
    </group>
  )
}

/* ── Selectable parts ───────────────────────────────────────────────────── */

function HeadPulley() {
  const m = useMaterials()
  const shaftZ = 1.45
  return (
    <group>
      <Drum p={HEAD} length={BELT_W + 0.2} shaft={shaftZ * 2} m={m} />
      <BearingBlock x={HEAD.x} y={HEAD.y} z={-1.12} m={m} />
      <BearingBlock x={HEAD.x} y={HEAD.y} z={1.12} m={m} />
      {/* Right-angle drive: gearbox on the shaft end, motor along the belt. */}
      <Box at={[HEAD.x + 0.05, HEAD.y - 0.05, 1.62]} size={[0.5, 0.52, 0.42]} mat={m.dark} />
      <M position={[HEAD.x + 0.42, HEAD.y - 0.1, 1.62]} rotation={[0, 0, Math.PI / 2]} material={m.steel}>
        <cylinderGeometry args={[0.07, 0.07, 0.24, 20]} />
      </M>
      <M position={[HEAD.x + 0.9, HEAD.y - 0.1, 1.62]} rotation={[0, 0, Math.PI / 2]} material={m.dark}>
        <cylinderGeometry args={[0.2, 0.2, 0.72, 36]} />
      </M>
      <M position={[HEAD.x + 1.29, HEAD.y - 0.1, 1.62]} rotation={[0, 0, Math.PI / 2]} material={m.paint}>
        <cylinderGeometry args={[0.18, 0.2, 0.08, 36]} />
      </M>
    </group>
  )
}

function TailPulley() {
  const m = useMaterials()
  return (
    <group>
      <Drum p={TAIL} length={BELT_W + 0.2} shaft={2.5} m={m} lagged={false} />
      <BearingBlock x={TAIL.x} y={TAIL.y} z={-1.12} m={m} />
      <BearingBlock x={TAIL.x} y={TAIL.y} z={1.12} m={m} />
      {/* speed-tail-01: tachometer on the shaft end. */}
      <M position={[TAIL.x, TAIL.y, 1.3]} rotation={Z_AXIS} material={m.dark}>
        <cylinderGeometry args={[0.07, 0.07, 0.1, 24]} />
      </M>
    </group>
  )
}

function TakeUp() {
  const m = useMaterials()
  const rails = BELT_W / 2 + 0.3
  const cw = { y: 0.3, h: 0.42 }
  return (
    <group>
      {[BEND_A, BEND_B].map((p) => (
        <group key={p.x}>
          <Drum p={p} length={BELT_W + 0.1} shaft={STRINGER_Z * 2 + 0.1} m={m} lagged={false} />
          {[-1, 1].map((s) => (
            <Box key={s} at={[p.x, (p.y + STRINGER_BOTTOM) / 2, s * (STRINGER_Z + 0.02)]}
                 size={[0.1, STRINGER_BOTTOM - p.y + 0.05, 0.02]} mat={m.paint} />
          ))}
        </group>
      ))}
      {/* Vertical guides the weighted pulley rides in. */}
      {[-1, 1].map((s) => (
        <Box key={s} at={[TAKEUP.x, STRINGER_BOTTOM / 2, s * rails]} size={[0.12, STRINGER_BOTTOM, 0.08]} mat={m.paint} />
      ))}
      <Drum p={TAKEUP} length={BELT_W + 0.15} shaft={rails * 2 - 0.08} m={m} />
      {[-1, 1].map((s) => (
        <Box key={s} at={[TAKEUP.x, TAKEUP.y, s * (rails - 0.08)]} size={[0.24, 0.24, 0.1]} mat={m.dark} />
      ))}
      {/* Counterweight hung from the carriage; load-takeup-01 is the cell in the +z hanger. */}
      {[-1, 1].map((s) => (
        <M key={s} position={[TAKEUP.x, (cw.y + cw.h / 2 + TAKEUP.y) / 2, s * (rails - 0.08)]} material={m.steel}>
          <cylinderGeometry args={[0.02, 0.02, TAKEUP.y - cw.y - cw.h / 2, 12]} />
        </M>
      ))}
      <M position={[TAKEUP.x, (cw.y + cw.h / 2 + TAKEUP.y) / 2, rails - 0.08]} material={m.dark}>
        <cylinderGeometry args={[0.05, 0.05, 0.1, 24]} />
      </M>
      <Box at={[TAKEUP.x, cw.y, 0]} size={[0.8, cw.h, rails * 2 - 0.1]} mat={m.concrete} />
    </group>
  )
}

function Idler04() {
  const m = useMaterials()
  return <IdlerSet x={IDLER_04_X} m={m} instrumented />
}

function InspectionCamera() {
  const m = useMaterials()
  const top = 3.35
  return (
    <group position={[CAMERA_X, 0, 0]}>
      <Box at={[0, (STRINGER_TOP + top) / 2, STRINGER_Z + 0.08]} size={[0.07, top - STRINGER_TOP, 0.07]} mat={m.paint} />
      <Box at={[0, top, (STRINGER_Z + 0.08) / 2]} size={[0.07, 0.07, STRINGER_Z + 0.15]} mat={m.paint} />
      <Box at={[0, top - 0.1, 0]} size={[0.16, 0.12, 0.24]} mat={m.housing} />
      <M position={[0, top - 0.19, 0]} material={m.steel}>
        <cylinderGeometry args={[0.04, 0.045, 0.06, 24]} />
      </M>
    </group>
  )
}

/* ── Belt and splice: both drawn from the solved loop ───────────────────── */

const COLS = 17

function beltTexture() {
  // Low-contrast rubber grain. Its only job is to let belt travel be seen.
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const g = c.getContext('2d')!
  const img = g.createImageData(256, 64)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 215 + Math.random() * 40
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function surface(rows: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rows * COLS * 3), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rows * COLS * 2), 2))
  const idx: number[] = []
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < COLS - 1; j++) {
      const a = i * COLS + j, b = a + COLS
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  g.setIndex(idx)
  return g
}

type Motion = { phase: number; spliceAt: THREE.Vector3 }

function Belt({ loop, motion }: { loop: ReturnType<typeof buildLoop>; motion: React.RefObject<Motion> }) {
  const tex = useMemo(() => beltTexture(), [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#303134', map: tex, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, transparent: true,
  }), [tex])
  useMaterials([mat])
  const geo = useMemo(() => {
    const rows = loop.s.length
    const g = surface(rows)
    fillSurface(loop, 0, loop.length, rows, COLS,
      g.attributes.position.array as Float32Array, g.attributes.uv.array as Float32Array)
    g.computeVertexNormals()
    return g
  }, [loop])
  useFrame(() => { tex.offset.x = -(motion.current.phase * loop.length) / 2 })
  return <mesh geometry={geo} material={mat} castShadow receiveShadow />
}

const SPLICE_LEN = 0.4

function Splice({ loop, s04, motion }: {
  loop: ReturnType<typeof buildLoop>; s04: number; motion: React.RefObject<Motion>
}) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#6b6d72', roughness: 0.7, side: THREE.DoubleSide, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), [])
  useMaterials([mat])
  const geo = useMemo(() => surface(6), [])
  const anchor = useRef<THREE.Group>(null)
  const t = useContext(TwinCtx)

  useFrame(() => {
    // Phase 0 = splice passing the idler-04 sensors, as BeltModel defines it.
    const s = s04 + motion.current.phase * loop.length
    fillSurface(loop, s - SPLICE_LEN / 2, s + SPLICE_LEN / 2, 6, COLS, geo.attributes.position.array as Float32Array)
    geo.attributes.position.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    const p = pointAt(loop, s)
    motion.current.spliceAt.set(p.x, p.y, 0)
    anchor.current?.position.set(p.x, p.y, 0)
  })

  return (
    <>
      <mesh geometry={geo} material={mat} castShadow><Edge /></mesh>
      <group ref={(o) => { anchor.current = o; t.register('splice', o) }} />
    </>
  )
}

/* ── Callouts: only for parts that need attention, or the one under the cursor ─ */

const ANCHOR: Record<Exclude<PartId, 'splice'>, [number, number, number]> = {
  idler04: [IDLER_04_X, CARRY_Y + 0.25, STRINGER_Z + 0.1],
  belt: [3.6, CARRY_Y + 0.28, -0.3],
  head: [HEAD.x, HEAD.y + HEAD.r + 0.15, 0],
  tail: [TAIL.x, TAIL.y + TAIL.r + 0.15, 0],
  takeup: [TAKEUP.x, TAKEUP.y + 0.35, BELT_W / 2 + 0.3],
  camera: [CAMERA_X, 3.45, 0],
}

/** Leader lengths differ per part so labels on neighbouring parts stack
 *  rather than collide at the overview angle. */
const LEADER: Record<PartId, number> = {
  idler04: 18, splice: 52, belt: 34, head: 18, tail: 18, takeup: 18, camera: 18,
}

function Callout({ id, level, at, leader }: {
  id: PartId; level: Level; at: [number, number, number]
  leader?: React.RefObject<HTMLSpanElement | null>
}) {
  const t = useContext(TwinCtx)
  const alert = level === 'warning' || level === 'critical'
  if (t.mode === 'hero' || t.selected || !(alert || t.hovered === id)) return null
  const color = level === 'critical' ? 'var(--crit)' : 'var(--warn)'
  return (
    // Fixed labels stack above the travelling splice label, so its leader
    // passes behind them rather than through their text.
    <Html position={at} center zIndexRange={id === 'splice' ? [4, 0] : [9, 5]}
          style={{ pointerEvents: alert ? 'auto' : 'none' }}>
      <div className="flex -translate-y-1/2 flex-col items-center">
        {/* tabIndex -1: the component list is the keyboard path to every part. */}
        <button type="button" tabIndex={-1} onClick={() => t.select(id)}
                className="scaled glass flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-[12px] text-[var(--fg)] shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors hover:border-[var(--line-strong)]">
          {PARTS[id].name}
          {alert && <span style={{ color }}>{LEVEL_LABEL[level]}</span>}
        </button>
        <span ref={leader} className="w-px bg-[var(--fg-3)]" style={{ height: LEADER[id] }} />
      </div>
    </Html>
  )
}

/** The splice label travels, so it can pass right over a fixed label. Near
 *  one, its leader lengthens and the label rises above the other -- eased per
 *  frame on the DOM node, never through React state. */
const FIXED_LABEL_X = [ANCHOR.idler04[0], ANCHOR.belt[0]]

function SpliceCallout({ level, motion }: { level: Level; motion: React.RefObject<Motion> }) {
  const g = useRef<THREE.Group>(null)
  const leader = useRef<HTMLSpanElement>(null)
  const h = useRef(LEADER.splice)
  useFrame((_, dt) => {
    const p = motion.current.spliceAt
    g.current?.position.copy(p).setY(p.y + 0.2)
    const onCarry = p.y > CARRY_Y - 0.1
    const near = onCarry && FIXED_LABEL_X.some((x) => Math.abs(x - p.x) < 1.6)
    h.current = THREE.MathUtils.damp(h.current, near ? 96 : LEADER.splice, 6, dt)
    if (leader.current) leader.current.style.height = `${h.current.toFixed(1)}px`
  })
  return <group ref={g}><Callout id="splice" level={level} at={[0, 0, 0]} leader={leader} /></group>
}

/* ── Camera rig ─────────────────────────────────────────────────────────── */

type View = { az: number; polar: number; pad: number }
const VIEWS: Record<PartId | 'overview' | 'hero', View> = {
  overview: { az: -0.62, polar: 1.13, pad: 1.02 },
  hero: { az: 0.95, polar: 1.34, pad: 1.25 },   // drive end in the foreground, belt receding behind the nameplate; extra pad is margin for the rightward offset below, not part of the "shot"
  idler04: { az: -0.95, polar: 1.18, pad: 2.1 },
  splice: { az: -0.5, polar: 0.98, pad: 2.6 },
  belt: { az: -0.38, polar: 0.9, pad: 1.0 },
  takeup: { az: -0.3, polar: 1.33, pad: 1.3 },
  tail: { az: -1.2, polar: 1.12, pad: 1.55 },
  head: { az: 0.8, polar: 1.12, pad: 1.3 },
  camera: { az: 0.4, polar: 1.05, pad: 2.4 },
}
const UP = new THREE.Vector3(0, 1, 0)

// The landing hero's idle sway: a bounded arc around VIEWS.hero.az, not a
// continuous spin. A full 360 orbit inevitably swings the machine over the
// text and, on the far side, leaves it stranded with empty space between it
// and the nameplate -- both looked broken. Bounded to a fraction of that,
// keeping it inside the frame `az: 0.95` was composed for -- but 6 degrees
// over 17 seconds (the original figures) turned out too subtle to read as
// motion at all on a real laptop; it moves (confirmed live: azimuthAngle and
// camera position both changing frame to frame), it just doesn't LOOK like
// it's doing anything from a normal glance. Widened and sped up so the sway
// itself is legible, still well short of a distracting spin.
const SWIVEL_AMPLITUDE = THREE.MathUtils.degToRad(10)
const SWIVEL_PERIOD_S = 11

/** Distance that fits every corner of `box` in the frustum from this angle.
 *  Exact for elongated parts, where a bounding sphere leaves them tiny. */
function fit(box: THREE.Box3, v: View, fov: number, aspect: number) {
  const center = box.getCenter(new THREE.Vector3())
  const o = new THREE.Vector3().setFromSphericalCoords(1, v.polar, v.az)
  const right = new THREE.Vector3().crossVectors(o.clone().negate(), UP).normalize()
  const up = new THREE.Vector3().crossVectors(right, o.clone().negate())
  const tv = Math.tan(THREE.MathUtils.degToRad(fov / 2)), th = tv * aspect
  let d = 0
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center)
    const z = c.dot(o)
    d = Math.max(d, z + Math.abs(c.dot(right)) / th, z + Math.abs(c.dot(up)) / tv)
  }
  return { center, pos: o.multiplyScalar(d * v.pad).add(center) }
}

function Rig({ root, parts, motion, resetKey, onMoved, reduced }: {
  root: React.RefObject<THREE.Group | null>
  parts: React.RefObject<Partial<Record<PartId, THREE.Object3D>>>
  motion: React.RefObject<Motion>
  resetKey: number
  onMoved: (moved: boolean) => void
  reduced: boolean
}) {
  const { selected: picked, mode } = useContext(TwinCtx)
  const selected = mode === 'hero' ? null : picked
  const controls = useRef<CameraControlsImpl>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const first = useRef(true)
  const swivelBase = useRef<number | null>(null)
  const swivelT = useRef(0)

  useEffect(() => {
    const c = controls.current
    const obj = selected ? parts.current[selected] : root.current
    if (!c || !obj) return
    // Aspect from the canvas size itself: camera.aspect can lag a resize by a frame.
    const aspect = size.width / size.height
    // Portrait hero (a phone): the nameplate stacks above the machine rather
    // than beside it, and needs real headroom, not the 30% used landscape.
    // Zoom out a little so the whole conveyor reads, not one idler -- but
    // only a little: the previous *1.8 read as "too small to notice, too
    // much empty grid around it", which is a worse failure than a machine
    // that fills its band generously.
    const portrait = mode === 'hero' && aspect <= 1.2
    const view = mode === 'hero'
      ? (portrait ? { ...VIEWS.hero, pad: VIEWS.hero.pad * 1.3 } : VIEWS.hero)
      : VIEWS[selected ?? 'overview']
    const box = selected === 'splice'
      ? new THREE.Box3().setFromCenterAndSize(motion.current.spliceAt, new THREE.Vector3(SPLICE_LEN, 0.4, BELT_W))
      : new THREE.Box3().setFromObject(obj)
    const { center, pos } = fit(box, view, camera.fov, aspect)
    // Critically damped travel (camera-controls smoothTime) -- the camera
    // moves like something with mass, and a new selection mid-flight simply
    // retargets it. The first framing is instant: there is nothing to travel from.
    const animate = !first.current && !reduced
    c.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, animate)
    // On the landing the machine sits right of centre, leaving the left for
    // its nameplate; on narrow screens it drops below the text instead.
    // Capped, not just scaled down: at 0.3 the offset grows with aspect
    // ratio without limit, and on an ordinary 16:9 laptop that was already
    // enough to push the machine's near edge past the right side of the
    // frame -- clipped, with the text column using barely a third of the
    // left. 0.15 reads as "beside the text", not "beside the text and also
    // half off-screen"; the cap keeps a 21:9 monitor from reinventing the
    // same bug at a different width.
    const dist = pos.distanceTo(center)
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const [fx, fy] = mode !== 'hero' ? [0, 0]
      : aspect > 1.2 ? [-Math.min(halfH * aspect * 0.15, halfH * 0.45), 0]
      : [0, halfH * 0.5]
    c.setFocalOffset(fx, fy, 0, animate)
    // Landscape hero only: re-centre the sway on this framing's own azimuth,
    // not read back off the controls (which mid-transition would be wherever
    // the camera currently is, not where it's headed).
    swivelBase.current = mode === 'hero' && !portrait ? view.az : null
    swivelT.current = 0
    first.current = false
    onMoved(false)
  }, [selected, mode, resetKey, size.width, size.height, camera, parts, root, motion, onMoved, reduced])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const moved = () => onMoved(true)
    c.addEventListener('controlstart', moved)
    return () => c.removeEventListener('controlstart', moved)
  }, [onMoved])

  // The splice travels with the belt; keep it framed while it is selected.
  // On the landing only, the camera sways gently round its composed angle --
  // not in portrait: on a phone the twin is already small and the text sits
  // right below it, and a moving object in that little space reads as a
  // stray toy, not a hero shot. It holds still there; dragging still orbits.
  useFrame((_, dt) => {
    if (!reduced && swivelBase.current != null) {
      swivelT.current += dt
      controls.current?.rotateAzimuthTo(
        swivelBase.current + SWIVEL_AMPLITUDE * Math.sin((swivelT.current / SWIVEL_PERIOD_S) * Math.PI * 2), false)
    }
    if (selected === 'splice') {
      const p = motion.current.spliceAt
      controls.current?.moveTo(p.x, p.y, p.z, true)
    }
  })

  return (
    <CameraControls ref={controls} makeDefault smoothTime={mode === 'hero' ? 0.9 : 0.55} draggingSmoothTime={0.1}
                    minDistance={1.2} maxDistance={40} maxPolarAngle={Math.PI * 0.49} />
  )
}

/* ── Scene ──────────────────────────────────────────────────────────────── */

function Scene({ frame, paused, levels, parts, resetKey, onMoved, reduced }: {
  frame: Frame | null; paused: boolean; levels: Record<PartId, Level>; reduced: boolean
  parts: React.RefObject<Partial<Record<PartId, THREE.Object3D>>>
  resetKey: number; onMoved: (m: boolean) => void
}) {
  const loop = useMemo(() => buildLoop(), [])
  const s04 = useMemo(() => carryS(loop, IDLER_04_X), [loop])
  const motion = useRef<Motion>({ phase: 0, spliceAt: new THREE.Vector3() })
  const root = useRef<THREE.Group>(null)

  const speed = frame?.readings?.speed?.speed_mps ?? 0
  useFrame((_, dt) => {
    // One lap of the real 250 m loop per belt period at the measured speed,
    // mapped onto the shortened model loop.
    if (paused || speed < 0.05) return
    motion.current.phase = (motion.current.phase + (dt * speed) / (2 * BELT_LENGTH_M)) % 1
  })

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 12, 9]} intensity={2.1} castShadow
                        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02}
                        shadow-camera-left={-11} shadow-camera-right={11}
                        shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-far={40} />
      {/* Studio light built in-scene: reflections for the steel without
          fetching an HDRI, which once took the whole canvas down offline. */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#b9bbbe']} />
        <Lightformer form="rect" intensity={2.4} position={[0, 9, 2]} rotation-x={Math.PI / 2} scale={[24, 8, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-12, 4, 8]} rotation-y={Math.PI / 3} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[12, 3, -8]} rotation-y={(-2 * Math.PI) / 3} scale={[12, 4, 1]} />
      </Environment>

      <group ref={root}>
        <OwnerCtx.Provider value="structure"><Structure /></OwnerCtx.Provider>
        <Part id="belt"><Belt loop={loop} motion={motion} /></Part>
        <Part id="splice"><Splice loop={loop} s04={s04} motion={motion} /></Part>
        <Part id="idler04"><Idler04 /></Part>
        <Part id="head"><HeadPulley /></Part>
        <Part id="tail"><TailPulley /></Part>
        <Part id="takeup"><TakeUp /></Part>
        <Part id="camera"><InspectionCamera /></Part>
      </group>

      {(Object.keys(ANCHOR) as (keyof typeof ANCHOR)[]).map((id) => (
        <Callout key={id} id={id} level={levels[id]} at={ANCHOR[id]} />
      ))}
      <SpliceCallout level={levels.splice} motion={motion} />

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={0.14} />
      </mesh>

      <Rig root={root} parts={parts} motion={motion} resetKey={resetKey} onMoved={onMoved} reduced={reduced} />
    </>
  )
}

/** A failing 3D view must not take the diagnostics down with it: the
 *  inspector and history keep working and the viewport says what happened. */
class Contain extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid h-full place-items-center text-[13px] text-[var(--fg-2)]">
        <div className="text-center">
          The 3D view stopped.
          <button type="button" onClick={() => this.setState({ failed: false })}
                  className="mt-2 block w-full cursor-pointer text-[var(--accent)] hover:underline">Reload view</button>
        </div>
      </div>
    )
  }
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function Twin({ frame, paused, levels, mode, reduced, themeKey, selected, hovered, onSelect, onHover }: {
  frame: Frame | null
  paused: boolean
  mode: 'hero' | 'work'
  reduced: boolean
  /** Changes whenever the effective theme or contrast does, so the scene
   *  re-reads its colours from the CSS tokens. */
  themeKey: string
  levels: Record<PartId, Level>
  selected: PartId | null
  hovered: PartId | null
  onSelect: (id: PartId | null) => void
  onHover: (id: PartId | null) => void
}) {
  const [failed, setFailed] = useState(false)
  const [moved, setMoved] = useState(false)
  // "Drag to rotate" -- the hero's own manual orbit is otherwise invisible
  // until someone tries it, and now that dragging genuinely works (it
  // silently didn't, see the pointer-events-blocking bugs fixed alongside
  // this), it's worth telling people it's there. Shown once, ever: dismissed
  // by the first real drag (`moved` already tracks that) or a short timeout,
  // whichever comes first, and the "seen" flag persists across sessions.
  const [hintSeen, setHintSeen] = useState(() => {
    try { return localStorage.getItem('beltguard.rotateHintSeen') === '1' } catch { return false }
  })
  const [hintVisible, setHintVisible] = useState(false)
  const dismissHint = useCallback(() => {
    setHintSeen(true)
    try { localStorage.setItem('beltguard.rotateHintSeen', '1') } catch { /* private mode */ }
  }, [])
  useEffect(() => {
    if (mode !== 'hero' || hintSeen) return
    const show = setTimeout(() => setHintVisible(true), reduced ? 0 : 900)
    const hide = setTimeout(dismissHint, 8000)
    return () => { clearTimeout(show); clearTimeout(hide) }
  }, [mode, hintSeen, reduced, dismissHint])
  useEffect(() => { if (moved) dismissHint() }, [moved, dismissHint])
  const [resetKey, setResetKey] = useState(0)
  const down = useRef<[number, number]>([0, 0])
  const parts = useRef<Partial<Record<PartId, THREE.Object3D>>>({})
  const register = useCallback((id: PartId, o: THREE.Object3D | null) => { if (o) parts.current[id] = o }, [])
  const ctx = useMemo<TwinState>(() => ({
    mode, selected, hovered, select: onSelect, hover: onHover, register,
    accent: cssVar('--accent'), hoverLine: cssVar('--fg-3'),
  // themeKey is the trigger to re-read the tokens after a theme change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [mode, selected, hovered, onSelect, onHover, register, themeKey])

  if (failed) {
    return <div className="grid h-full place-items-center text-[13px] text-[var(--fg-2)]">3D view unavailable — WebGL is not supported here.</div>
  }

  return (
    <div className="grid-bg relative h-full w-full bg-[var(--viewport)]"
         style={{ cursor: hovered ? 'pointer' : 'default' }}
         onPointerDown={(e) => { down.current = [e.clientX, e.clientY] }}>
      <Contain>
      {/* shadows="basic" not the `shadows` boolean shorthand: that shorthand
          asks for PCFSoftShadowMap, which this three.js version warns is
          deprecated on every single frame -- ~2 log lines/sec of noise for a
          soft edge nobody sees on the 512px shadow this scene renders. */}
      {/* touchAction: camera-controls sets this to 'none' on the canvas itself
          once, on connect -- but R3F re-applies its OWN style object (size,
          display) on every resize, and that overwrites the whole inline
          style, wiping the one camera-controls set. Passing it here instead
          makes it part of what R3F itself reapplies each time, so it
          survives resizes. Without it, a touch drag is ambiguous between
          "orbit the camera" and "scroll the page", and the browser's own
          touch handling claims it for scrolling before any pointer/touch
          listener sees a meaningful drag -- mouse drag is unaffected
          (touch-action only governs touch gestures), which is exactly why
          this shipped invisibly: it worked in every test done with a mouse. */}
      <Canvas shadows="basic" dpr={[1, 2]} camera={{ fov: 30, near: 0.1, far: 200, position: [-8, 6, 14] }}
              style={{ touchAction: 'none' }}
              gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
              resize={{ debounce: 0, scroll: false }}
              onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
              onError={() => setFailed(true)}
              onPointerMissed={(e) => {
                // A drag that orbits the camera must not also clear the selection.
                if (Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) < 4) onSelect(null)
              }}>
        <TwinCtx.Provider value={ctx}>
          <Scene frame={frame} paused={paused} levels={levels} parts={parts} resetKey={resetKey} onMoved={setMoved} reduced={reduced} />
        </TwinCtx.Provider>
      </Canvas>
      </Contain>

      {/* pointer-events-none, deliberately -- this exact bug (an overlay
          silently eating the drag it's telling you about) is the one this
          whole feature exists downstream of. Anchored under the header
          rather than the footer: the machine sits in the upper band on
          both portrait (see Landing's spacer) and landscape, and the
          footer's own position varies enough between the two that a
          bottom-anchored hint risked landing on top of it. */}
      {mode === 'hero' && !hintSeen && (
        <div className={`pointer-events-none absolute inset-x-0 top-16 flex justify-center ${reduced ? '' : 'transition-opacity duration-500'}`}
             style={{ opacity: hintVisible ? 1 : 0 }}>
          <span className="glass rounded-full px-3 py-1.5 text-[12px] text-[var(--fg-2)]">Drag to rotate</span>
        </div>
      )}

      {moved && mode === 'work' && (
        <button type="button" onClick={() => setResetKey((k) => k + 1)}
                className="glass absolute top-3 right-3 cursor-pointer rounded-[6px] px-2.5 py-1 text-[12px] text-[var(--fg)] transition-colors hover:border-[var(--line-strong)]">
          Reset view
        </button>
      )}
      {mode === 'work' && (
        <p className="scaled pointer-events-none absolute bottom-3 left-4 text-[11px] text-[var(--fg-2)]">
          Length shortened for display · splice position estimated from belt speed
        </p>
      )}
    </div>
  )
}
