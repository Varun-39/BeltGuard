import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Frame } from '../useLive'
import { STATE, cssColor, stateFor } from './Panels'

/** Digital twin bound to the live feed.

    Deliberately NOT a photoreal conveyor. It is a schematic whose geometry is
    driven by the actual telemetry: the belt scrolls at the measured speed, the
    splice marker is positioned by real belt phase, and the monitored idler
    takes its colour from the bearing subsystem score. A prettier static model
    that ignored the data would be a screensaver, not a twin.
*/

const BELT_LEN = 6.6
const BELT_W = 1.5
const TROUGH = 0.62      // side-wing angle (rad); real idler sets run ~35deg

function Idler({ x, health, monitored }: { x: number; health: number; monitored: boolean }) {
  const col = cssColor(monitored ? STATE[stateFor(health)].color : '#64748b')
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.x += dt * 3
  })
  return (
    <group position={[x, -0.34, 0]}>
      <mesh ref={ref} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.17, 0.17, BELT_W + 0.25, 20]} />
        <meshStandardMaterial
          color={col} metalness={0.45} roughness={0.3}
          emissive={monitored ? col : '#000'} emissiveIntensity={monitored ? 0.65 : 0}
        />
      </mesh>
      {monitored && (
        <Html center distanceFactor={5} position={[0, -0.5, 0]}>
          <div className="tnum rounded border px-1 py-px text-[8px] whitespace-nowrap"
               style={{ borderColor: col, color: col, background: 'rgba(15,23,42,0.92)' }}>
            idler-04
          </div>
        </Html>
      )}
    </group>
  )
}

function Belt({ frame }: { frame: Frame | null }) {
  const spliceRef = useRef<THREE.Mesh>(null)
  const phase = useRef(0)

  const speed = frame?.readings?.speed?.speed_mps ?? 0
  const jointHealth = frame?.health?.subsystems?.joint ?? 100
  const spliceCol = cssColor(STATE[stateFor(jointHealth)].color)

  // Scrolling texture at the measured belt speed. The stripes are a visual
  // proxy for motion; the SPEED is the real measurement driving it.
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 32
    const g = c.getContext('2d')!
    g.fillStyle = '#1a2033'; g.fillRect(0, 0, 128, 32)
    g.fillStyle = '#232c44'
    for (let i = 0; i < 128; i += 16) g.fillRect(i, 0, 8, 32)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(7, 1)
    return t
  }, [])

  useFrame((_, dt) => {
    tex.offset.x -= (speed / 12) * dt
    // Belt loop period = 2 * length / speed; the splice crosses the frame once
    // per revolution, exactly as sensors_sim/belt.py models it.
    const period = speed > 0.05 ? (2 * 250) / speed : Infinity   // matches BeltModel.belt_period_s
    phase.current = (phase.current + dt / period) % 1
    if (spliceRef.current) {
      spliceRef.current.position.x = -BELT_LEN / 2 + phase.current * BELT_LEN
    }
  })

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[BELT_LEN, BELT_W]} />
        <meshStandardMaterial map={tex} roughness={0.9} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>

      {/* Troughing wings -- a carrying idler set folds the belt into a V so ore
          does not spill. Without these it reads as a flat plane, not a conveyor. */}
      {[-1, 1].map((s2) => (
        <mesh key={s2}
              position={[0, Math.sin(TROUGH) * 0.34, s2 * (BELT_W / 2 + Math.cos(TROUGH) * 0.34)]}
              rotation={[-Math.PI / 2 + s2 * TROUGH, 0, 0]}>
          <planeGeometry args={[BELT_LEN, 0.7]} />
          <meshStandardMaterial map={tex} roughness={0.9} metalness={0.05}
                                side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* The splice: the thing this whole project exists to watch, so it is
          the one object made of real glass. MeshTransmissionMaterial actually
          refracts the scene behind it, which ties the twin to the same visual
          language as the panels rather than being a coloured quad. */}
      <mesh ref={spliceRef} position={[0, 0.05, 0]}>
        <boxGeometry args={[0.26, 0.1, BELT_W + 0.05]} />
        <meshPhysicalMaterial
          color={spliceCol}
          transmission={0.82} thickness={0.45} ior={1.45} roughness={0.12}
          metalness={0} clearcoat={1} clearcoatRoughness={0.06}
          attenuationColor={spliceCol} attenuationDistance={0.7}
          emissive={spliceCol}
          emissiveIntensity={jointHealth < 50 ? 1.9 : 0.75}
          transparent toneMapped={false}
        />
      </mesh>

      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, -0.06, (s * (BELT_W + 0.14)) / 2]}>
          <boxGeometry args={[BELT_LEN, 0.1, 0.09]} />
          <meshStandardMaterial color="#3a4568" metalness={0.4} roughness={0.35} />
        </mesh>
      ))}

      {[-2.6, -1.3, 0, 1.3, 2.6].map((x) => (
        <Idler key={x} x={x} monitored={x === 0}
               health={frame?.health?.subsystems?.bearing ?? 100} />
      ))}

      {[-BELT_LEN / 2, BELT_LEN / 2].map((x) => (
        <mesh key={x} position={[x, -0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.34, 0.34, BELT_W + 0.3, 26]} />
          <meshStandardMaterial color="#4d5a7d" metalness={0.5} roughness={0.25} />
        </mesh>
      ))}
    </group>
  )
}

export function DigitalTwin({ frame }: { frame: Frame | null }) {
  const [err, setErr] = useState(false)
  if (err) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-[var(--color-fg-dim)]">
        3D view unavailable (WebGL not supported)
      </div>
    )
  }
  return (
    <div className="relative h-[280px] lg:h-full lg:min-h-[210px]">
      {/* preserveDrawingBuffer: the embedded preview pane does not composite the
          WebGL canvas into screenshots, so toDataURL() is the only reliable way
          to confirm the scene actually drew. */}
      {/* resize.debounce=0 + an explicit fill style.
          r3f measures its container with a debounced ResizeObserver. Inside a
          backdrop-filtered, flex-sized panel that first measurement can land
          while the box is still 0, and the debounce means the corrected size
          never arrives -- the canvas stays pinned at its 300x150 default and
          renders nothing visible. Measuring immediately fixes it. */}
      <Canvas
        camera={{ position: [3.4, 2.5, 5.4], fov: 40 }}
        dpr={[1, 1.75]}
        resize={{ debounce: 0, scroll: false }}
        style={{ width: '100%', height: '100%', display: 'block' }}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x0b0f1c, 1)}
        onError={() => setErr(true)}
      >
        {/* Lit entirely by explicit lights, no environment map.
            drei's <Environment preset> fetches an HDRI from a CDN; that fetch
            failed here and took the whole canvas down with it. A demo must not
            depend on a network round-trip, so the rig is three keys plus two
            coloured rims matching the dashboard palette. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[6, 9, 5]} intensity={2.4} color="#e6efff" />
        <directionalLight position={[-6, 3, -4]} intensity={1.1} color="#0a84ff" />
        <directionalLight position={[5, 2, -6]} intensity={0.9} color="#bf5af2" />
        <pointLight position={[0, 1.6, 1.5]} intensity={9} distance={9} color="#ffffff" />

        <Belt frame={frame} />

        {/* Contact shadow instead of a grid: it grounds the belt in the scene
            and reads as depth rather than as graph paper. */}
        <ContactShadows position={[0, -0.85, 0]} opacity={0.55} scale={16}
                        blur={2.4} far={3} resolution={512} color="#000814" />
        <OrbitControls enablePan={false} minDistance={4} maxDistance={11}
                       maxPolarAngle={Math.PI / 2.15}
                       autoRotate autoRotateSpeed={0.35} enableDamping
                       dampingFactor={0.06} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 text-[9px] text-[var(--color-fg-dim)]">
        drag to orbit · scroll to zoom
      </div>
    </div>
  )
}

export function CameraFeed({ frame }: { frame: Frame | null }) {
  const [live, setLive] = useState(true)
  const dets = frame?.vision?.detections ?? []
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex h-[190px] flex-1 items-center justify-center overflow-hidden bg-black lg:h-auto lg:min-h-[170px]">
        {live ? (
          <img src="/stream" alt="Live belt inspection camera with defect detections"
               className="h-full w-full object-contain" onError={() => setLive(false)} />
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] text-[var(--color-fg-muted)]">Vision service offline</p>
            <p className="mt-1 text-[10px] text-[var(--color-fg-dim)]">
              start it with:<br />
              <code className="text-[var(--color-info)]">python -m vision.service --source testset --loop</code>
            </p>
            <button onClick={() => setLive(true)}
                    className="mt-3 cursor-pointer rounded border border-[rgba(255,255,255,0.16)] px-2 py-1 text-[10px] text-[var(--color-fg-muted)] transition-colors duration-200 hover:border-[var(--color-info)] hover:text-[var(--color-info)]">
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[rgba(255,255,255,0.08)] px-2.5 py-1.5">
        {dets.length === 0 ? (
          <span className="text-[10px] text-[var(--color-fg-dim)]">no defects in frame</span>
        ) : (
          dets.slice(0, 5).map((d, i) => (
            <span key={i}
                  className="tnum rounded border border-[rgba(255,255,255,0.16)] px-1.5 py-0.5 text-[10px]"
                  style={{ color: d.cls === 'belt_joint' ? 'var(--color-info)' : 'var(--color-warn)' }}>
              {d.cls} {(d.conf * 100).toFixed(0)}%
            </span>
          ))
        )}
      </div>
    </div>
  )
}
