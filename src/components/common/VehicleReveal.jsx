import React from 'react'

// Detailed flat-vector ambulance and fire truck, each built from several
// independent SVG shapes ("segments") rather than one flattened silhouette.
// Every segment gets a staggered reveal — starts scaled down, offset, and
// transparent, then settles into place with a slight overshoot — so the
// vehicle visibly assembles piece by piece rather than fading in as a
// single image. Same technique as ExplodeLogo's shard grid, applied to
// vehicle line art instead of a tile grid. Pure SVG, no external image —
// scales crisply at any size and carries no licensing/hotlink risk.
function Seg({ children, i, ...props }) {
  return <g className="reveal-seg" style={{ '--i': i }} {...props}>{children}</g>
}

// Soft contact shadow so the vehicle reads as grounded rather than floating.
function GroundShadow({ cx, width }) {
  return (
    <ellipse cx={cx} cy="78" rx={width} ry="5" fill="#000" opacity="0.18" />
  )
}

export function AmbulanceIcon({ className = '', width = 150 }) {
  return (
    <svg viewBox="0 0 150 92" width={width} className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ambBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e7ecef" />
        </linearGradient>
        <linearGradient id="ambGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfeaf3" />
          <stop offset="100%" stopColor="#8fc7dc" />
        </linearGradient>
        <radialGradient id="ambTire" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#3a4353" />
          <stop offset="100%" stopColor="#161b24" />
        </radialGradient>
      </defs>

      <Seg i={0}><GroundShadow cx={73} width={62} /></Seg>

      {/* main box body */}
      <Seg i={1}><rect x="8" y="28" width="92" height="38" rx="7" fill="url(#ambBody)" stroke="#0C1322" strokeWidth="2" /></Seg>
      {/* lower skirt / bumper trim */}
      <Seg i={2}><rect x="8" y="56" width="92" height="10" rx="2" fill="#0C1322" opacity="0.08" /></Seg>

      {/* cab */}
      <Seg i={3}><path d="M100 32h27l15 19v13h-42Z" fill="url(#ambBody)" stroke="#0C1322" strokeWidth="2" strokeLinejoin="round" /></Seg>
      {/* windshield with reflection */}
      <Seg i={4}>
        <path d="M110 36h13l10 13h-23Z" fill="url(#ambGlass)" />
        <path d="M112 37h5l7 10h-8Z" fill="#fff" opacity="0.35" />
      </Seg>
      {/* side window strip on box */}
      <Seg i={5}><rect x="18" y="34" width="30" height="12" rx="2" fill="url(#ambGlass)" opacity="0.85" /></Seg>

      {/* red accent stripe + Star of Life */}
      <Seg i={6}><rect x="8" y="46" width="92" height="5" fill="#dc2626" /></Seg>
      <Seg i={7}>
        <circle cx="63" cy="40" r="8.5" fill="#0369a1" />
        <g stroke="#fff" strokeWidth="1.6">
          <line x1="63" y1="33.5" x2="63" y2="46.5" />
          <line x1="56.5" y1="37" x2="69.5" y2="43" />
          <line x1="56.5" y1="43" x2="69.5" y2="37" />
        </g>
      </Seg>

      {/* roof light bar */}
      <Seg i={8}>
        <rect x="20" y="14" width="48" height="15" rx="3" fill="#111827" />
        <rect x="22" y="16.5" width="21" height="10" rx="2" fill="#dc2626" />
        <rect x="45" y="16.5" width="21" height="10" rx="2" fill="#2563eb" />
      </Seg>

      {/* door seam + handle */}
      <Seg i={9}><line x1="72" y1="30" x2="72" y2="56" stroke="#0C1322" strokeOpacity="0.3" strokeWidth="1.4" /><rect x="80" y="42" width="6" height="2.4" rx="1" fill="#0C1322" opacity="0.5" /></Seg>

      {/* headlight */}
      <Seg i={10}><rect x="138" y="47" width="6" height="7" rx="1.5" fill="#fde68a" stroke="#0C1322" strokeWidth="1" /></Seg>

      {/* wheels */}
      <Seg i={11}><circle cx="34" cy="68" r="12" fill="url(#ambTire)" stroke="#0C1322" strokeWidth="1.5" /><circle cx="34" cy="68" r="5" fill="#cbd5e1" /></Seg>
      <Seg i={12}><circle cx="114" cy="68" r="12" fill="url(#ambTire)" stroke="#0C1322" strokeWidth="1.5" /><circle cx="114" cy="68" r="5" fill="#cbd5e1" /></Seg>
    </svg>
  )
}

export function FireTruckIcon({ className = '', width = 170 }) {
  return (
    <svg viewBox="0 0 176 92" width={width} className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ftBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id="ftGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfeaf3" />
          <stop offset="100%" stopColor="#8fc7dc" />
        </linearGradient>
        <radialGradient id="ftTire" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#3a4353" />
          <stop offset="100%" stopColor="#161b24" />
        </radialGradient>
      </defs>

      <Seg i={0}><GroundShadow cx={90} width={82} /></Seg>

      {/* main body */}
      <Seg i={1}><rect x="6" y="26" width="122" height="40" rx="6" fill="url(#ftBody)" stroke="#0C1322" strokeWidth="2" /></Seg>
      <Seg i={2}><rect x="6" y="56" width="122" height="10" rx="2" fill="#0C1322" opacity="0.12" /></Seg>

      {/* cab */}
      <Seg i={3}><path d="M128 30h25l15 17v15h-40Z" fill="url(#ftBody)" stroke="#0C1322" strokeWidth="2" strokeLinejoin="round" /></Seg>
      <Seg i={4}>
        <path d="M136 34h11l10 11h-21Z" fill="url(#ftGlass)" />
        <path d="M138 35h5l7 8h-8Z" fill="#fff" opacity="0.35" />
      </Seg>

      {/* equipment compartment panel with hose-reel motif */}
      <Seg i={5}><rect x="16" y="34" width="98" height="14" rx="2" fill="#fbbf24" /></Seg>
      <Seg i={6}>
        <circle cx="35" cy="41" r="6" fill="none" stroke="#7c2d12" strokeWidth="2.2" />
        <circle cx="35" cy="41" r="2" fill="#7c2d12" />
      </Seg>
      <Seg i={7}>
        <rect x="48" y="37" width="26" height="8" rx="1.5" fill="#7c2d12" opacity="0.18" />
        <rect x="80" y="37" width="26" height="8" rx="1.5" fill="#7c2d12" opacity="0.18" />
      </Seg>

      {/* ladder on top */}
      <Seg i={8}>
        <line x1="18" y1="24" x2="104" y2="8" stroke="#374151" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="18" y1="18" x2="100" y2="4" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" />
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <line key={n} x1={22 + n * 14} y1={23 - n * 2.8} x2={22 + n * 14} y2={17 - n * 2.8} stroke="#6b7280" strokeWidth="2" />
        ))}
      </Seg>

      {/* roof light bar */}
      <Seg i={9}>
        <rect x="30" y="10" width="24" height="10" rx="2" fill="#111827" />
        <rect x="32" y="12" width="9" height="6" rx="1.5" fill="#dc2626" />
        <rect x="43" y="12" width="9" height="6" rx="1.5" fill="#2563eb" />
      </Seg>

      {/* door seam */}
      <Seg i={10}><line x1="120" y1="28" x2="120" y2="56" stroke="#0C1322" strokeOpacity="0.35" strokeWidth="1.4" /></Seg>

      {/* headlight */}
      <Seg i={11}><rect x="142" y="46" width="6" height="7" rx="1.5" fill="#fde68a" stroke="#0C1322" strokeWidth="1" /></Seg>

      {/* wheels */}
      <Seg i={12}><circle cx="34" cy="68" r="13" fill="url(#ftTire)" stroke="#0C1322" strokeWidth="1.5" /><circle cx="34" cy="68" r="5.4" fill="#cbd5e1" /></Seg>
      <Seg i={13}><circle cx="83" cy="68" r="13" fill="url(#ftTire)" stroke="#0C1322" strokeWidth="1.5" /><circle cx="83" cy="68" r="5.4" fill="#cbd5e1" /></Seg>
      <Seg i={14}><circle cx="140" cy="68" r="13" fill="url(#ftTire)" stroke="#0C1322" strokeWidth="1.5" /><circle cx="140" cy="68" r="5.4" fill="#cbd5e1" /></Seg>
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
