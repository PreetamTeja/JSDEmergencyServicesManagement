import React from 'react'

// Flat-vector ambulance and fire truck, each built from several independent
// SVG shapes ("segments") rather than one flattened silhouette. Every
// segment gets a staggered reveal — starts scaled down, offset, and
// transparent, then settles into place with a slight overshoot — so the
// vehicle visibly assembles piece by piece rather than fading in as a
// single image. Same technique as ExplodeLogo's shard grid, applied to
// vehicle line art instead of a tile grid. Pure SVG, no external image.
function Seg({ children, i, ...props }) {
  return <g className="reveal-seg" style={{ '--i': i }} {...props}>{children}</g>
}

export function AmbulanceIcon({ className = '', width = 150 }) {
  return (
    <svg viewBox="0 0 150 90" width={width} className={className} aria-hidden="true">
      <Seg i={0}><rect x="8" y="30" width="90" height="34" rx="6" fill="#fff" stroke="#0C1322" strokeWidth="2" /></Seg>
      <Seg i={1}><path d="M98 34h26l14 18v12h-40Z" fill="#E6F0EE" stroke="#0C1322" strokeWidth="2" strokeLinejoin="round" /></Seg>
      <Seg i={2}><path d="M108 38h12l9 12h-21Z" fill="#9FD8E8" /></Seg>
      <Seg i={3}><rect x="20" y="14" width="46" height="16" rx="3" fill="#dc2626" /></Seg>
      <Seg i={4}><rect x="36" y="17" width="14" height="4" rx="1" fill="#fff" /><rect x="41" y="12" width="4" height="14" rx="1" fill="#fff" /></Seg>
      <Seg i={5}><circle cx="34" cy="66" r="11" fill="#1f2937" stroke="#0C1322" strokeWidth="1.5" /><circle cx="34" cy="66" r="4.5" fill="#9CA3AF" /></Seg>
      <Seg i={6}><circle cx="112" cy="66" r="11" fill="#1f2937" stroke="#0C1322" strokeWidth="1.5" /><circle cx="112" cy="66" r="4.5" fill="#9CA3AF" /></Seg>
      <Seg i={7}><rect x="8" y="42" width="90" height="6" fill="#07514D" opacity="0.15" /></Seg>
      <Seg i={8}><rect x="112" y="40" width="10" height="4" rx="1" fill="#D6DF27" /></Seg>
    </svg>
  )
}

export function FireTruckIcon({ className = '', width = 170 }) {
  return (
    <svg viewBox="0 0 170 90" width={width} className={className} aria-hidden="true">
      <Seg i={0}><rect x="6" y="28" width="118" height="36" rx="5" fill="#dc2626" stroke="#0C1322" strokeWidth="2" /></Seg>
      <Seg i={1}><path d="M124 32h24l14 16v14h-38Z" fill="#dc2626" stroke="#0C1322" strokeWidth="2" strokeLinejoin="round" /></Seg>
      <Seg i={2}><path d="M132 36h10l9 10h-19Z" fill="#9FD8E8" /></Seg>
      <Seg i={3}><rect x="14" y="34" width="96" height="10" rx="2" fill="#fbbf24" opacity="0.9" /></Seg>
      <Seg i={4}>
        <line x1="18" y1="26" x2="100" y2="10" stroke="#374151" strokeWidth="4" strokeLinecap="round" />
        <line x1="18" y1="20" x2="96" y2="6" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" />
      </Seg>
      <Seg i={5}><rect x="30" y="12" width="20" height="10" rx="2" fill="#dc2626" /></Seg>
      <Seg i={6}><circle cx="34" cy="66" r="12" fill="#1f2937" stroke="#0C1322" strokeWidth="1.5" /><circle cx="34" cy="66" r="5" fill="#9CA3AF" /></Seg>
      <Seg i={7}><circle cx="80" cy="66" r="12" fill="#1f2937" stroke="#0C1322" strokeWidth="1.5" /><circle cx="80" cy="66" r="5" fill="#9CA3AF" /></Seg>
      <Seg i={8}><circle cx="136" cy="66" r="12" fill="#1f2937" stroke="#0C1322" strokeWidth="1.5" /><circle cx="136" cy="66" r="5" fill="#9CA3AF" /></Seg>
      <Seg i={9}><rect x="138" y="38" width="10" height="4" rx="1" fill="#fbbf24" /></Seg>
    </svg>
  )
}

// A hose-reel "closing" motif for the loading indicator: the outer ring
// starts fully open (dash gap all the way around, like unspooled hose)
// and winds closed into a solid circle as it spins — read as the hose
// reeling back in while the app connects.
export function HoseReel({ size = 72 }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} className="hose-reel-spin" aria-hidden="true">
      <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
      <circle cx="36" cy="36" r={r} fill="none" stroke="#D6DF27" strokeWidth="4" strokeLinecap="round"
        style={{ '--circ': c }} className="hose-reel-arc" transform="rotate(-90 36 36)" />
      <circle cx="36" cy="36" r="6" fill="#D6DF27" />
      <circle cx="36" cy="36" r="2.4" fill="#07514D" />
    </svg>
  )
}
