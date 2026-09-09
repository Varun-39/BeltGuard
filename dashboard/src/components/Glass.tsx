/** The chromatic-refraction filter behind `.glass-refract`.
 *
 *  Real Liquid Glass is not blur. Blur alone is a frosted div. What makes a
 *  pane read as glass is that the content behind it BENDS, and bends slightly
 *  differently per colour channel — the same dispersion that puts a rainbow
 *  edge on a real lens.
 *
 *  So: one turbulence field, sampled three times by `feDisplacementMap` at
 *  staggered scales, each pass isolated to a single channel with
 *  `feColorMatrix`, then recombined with `feBlend mode="screen"`. Red bends
 *  most, blue least. `colorInterpolationFilters="sRGB"` is mandatory —
 *  without it the browser filters in linearRGB and the result goes milky.
 *
 *  Mounted once, hidden, and referenced by id from CSS.
 */
export function GlassFilters() {
  return (
    <svg aria-hidden width="0" height="0"
         style={{ position: 'absolute', pointerEvents: 'none' }}>
      <defs>
        <filter id="lg-refract" x="-12%" y="-12%" width="124%" height="124%"
                colorInterpolationFilters="sRGB">
          {/* Low-frequency, few octaves: broad lens-like swells, not noise. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0034"
                        numOctaves={2} seed={11} result="warp" />

          <feDisplacementMap in="SourceGraphic" in2="warp" scale={26}
                             xChannelSelector="R" yChannelSelector="G" result="dR" />
          <feColorMatrix in="dR" type="matrix" result="cR"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0" />

          <feDisplacementMap in="SourceGraphic" in2="warp" scale={17}
                             xChannelSelector="R" yChannelSelector="G" result="dG" />
          <feColorMatrix in="dG" type="matrix" result="cG"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0" />

          <feDisplacementMap in="SourceGraphic" in2="warp" scale={9}
                             xChannelSelector="R" yChannelSelector="G" result="dB" />
          <feColorMatrix in="dB" type="matrix" result="cB"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0" />

          <feBlend in="cR" in2="cG" mode="screen" result="rg" />
          <feBlend in="rg" in2="cB" mode="screen" />
        </filter>
      </defs>
    </svg>
  )
}

/** Four slowly drifting colour wells. Purely a backdrop for the glass to
 *  refract — without a coloured field beneath them, translucent panels have
 *  nothing to bend and collapse into grey rectangles. */
export function Aurora() {
  return (
    <div className="aurora" aria-hidden>
      <span /><span /><span /><span />
    </div>
  )
}
