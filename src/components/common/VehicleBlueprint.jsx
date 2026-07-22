import React from 'react'

// Dense, multi-view CAD/spec-sheet style line art — original linework, not
// traced from any third-party drawing, but deliberately dense (front, rear,
// side and top views per vehicle, panel seams, dimension strings, wheel hub
// detail) to read as a real fabrication sheet rather than a simple icon.
const STROKE = '#1f2937'
const SW = 1

function Dim({ x1, y1, x2, y2, vertical }) {
  return (
    <g stroke={STROKE} strokeWidth={0.6} opacity="0.55">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical ? (
        <>
          <line x1={x1 - 3} y1={y1} x2={x1 + 3} y2={y1} />
          <line x1={x2 - 3} y1={y2} x2={x2 + 3} y2={y2} />
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - 3} x2={x1} y2={y1 + 3} />
          <line x1={x2} y1={y2 - 3} x2={x2} y2={y2 + 3} />
        </>
      )}
    </g>
  )
}
function Label({ x, y, children, anchor = 'middle' }) {
  return <text x={x} y={y} fontSize="6.5" fill={STROKE} textAnchor={anchor} opacity="0.75" letterSpacing="0.5">{children}</text>
}
function HatchDoor({ x, y, h }) {
  return <line x1={x} y1={y} x2={x} y2={y + h} strokeWidth={0.7} opacity="0.5" />
}
function WheelHub({ cx, cy, r }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} />
      <circle cx={cx} cy={cy} r={r * 0.42} />
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (a * Math.PI) / 180
        return <line key={a} x1={cx} y1={cy} x2={cx + Math.cos(rad) * r * 0.4} y2={cy + Math.sin(rad) * r * 0.4} strokeWidth={0.5} opacity="0.6" />
      })}
    </g>
  )
}

export function AmbulanceBlueprint({ className = '', width = 620 }) {
  return (
    <svg viewBox="0 0 620 460" width={width} className={className} aria-hidden="true">
      <g fill="none" stroke={STROKE} strokeWidth={SW} strokeLinejoin="round">

        {/* ================= REAR VIEW (top-left) ================= */}
        <g transform="translate(20,14)">
          <rect x="0" y="0" width="130" height="112" rx="6" />
          <rect x="8" y="8" width="55" height="70" rx="2" opacity="0.6" />
          <rect x="67" y="8" width="55" height="70" rx="2" opacity="0.6" />
          <line x1="65" y1="8" x2="65" y2="112" opacity="0.4" />
          <rect x="16" y="16" width="20" height="18" rx="1.5" opacity="0.45" />
          <rect x="70" y="16" width="20" height="18" rx="1.5" opacity="0.45" />
          <circle cx="30" cy="60" r="3" opacity="0.6" />
          <circle cx="100" cy="60" r="3" opacity="0.6" />
          <rect x="4" y="86" width="122" height="6" opacity="0.4" />
          <circle cx="20" cy="118" r="2" fill={STROKE} />
          <circle cx="110" cy="118" r="2" fill={STROKE} />
          <Dim x1="0" y1="130" x2="130" y2="130" />
          <Label x={65} y={142}>REAR VIEW</Label>
        </g>

        {/* ================= FRONT VIEW ================= */}
        <g transform="translate(180,14)">
          <path d="M6 40 Q6 0 46 0h58q40 0 40 40v72H6Z" />
          <rect x="18" y="14" width="94" height="24" rx="3" opacity="0.6" />
          <line x1="65" y1="14" x2="65" y2="38" opacity="0.4" />
          <rect x="24" y="46" width="30" height="20" rx="2" opacity="0.4" />
          <rect x="76" y="46" width="30" height="20" rx="2" opacity="0.4" />
          <rect x="52" y="70" width="26" height="10" rx="1.5" opacity="0.45" />
          <circle cx="26" cy="98" r="4" opacity="0.5" />
          <circle cx="104" cy="98" r="4" opacity="0.5" />
          <circle cx="16" cy="122" r="2" fill={STROKE} />
          <circle cx="114" cy="122" r="2" fill={STROKE} />
          <Dim x1="6" y1="130" x2="120" y2="130" />
          <Label x={63} y={142}>FRONT VIEW</Label>
        </g>

        {/* ================= TOP VIEW ================= */}
        <g transform="translate(340,14)">
          <rect x="0" y="14" width="230" height="80" rx="12" />
          <line x1="150" y1="14" x2="150" y2="94" opacity="0.45" />
          <rect x="8" y="22" width="132" height="64" rx="5" opacity="0.55" />
          <line x1="52" y1="22" x2="52" y2="86" opacity="0.35" />
          <line x1="96" y1="22" x2="96" y2="86" opacity="0.35" />
          <path d="M150 20h58l16 20v50l-16 4h-58Z" opacity="0.6" />
          <circle cx="18" cy="14" r="2.5" fill={STROKE} />
          <circle cx="18" cy="94" r="2.5" fill={STROKE} />
          <circle cx="212" cy="14" r="2.5" fill={STROKE} />
          <circle cx="212" cy="94" r="2.5" fill={STROKE} />
          <Dim x1="0" y1="104" x2="230" y2="104" />
          <Label x={115} y={116}>TOP VIEW</Label>
        </g>

        {/* ================= LEFT SIDE VIEW (large, spans width) ================= */}
        <g transform="translate(20,190)">
          <rect x="10" y="26" width="440" height="118" rx="14" />
          <path d="M450 30h64l30 40v50l-30 14h-64Z" />
          <path d="M460 38h30l24 28h-54Z" opacity="0.55" />
          <path d="M462 40h14l12 18h-18Z" fill="#fff" opacity="0.35" />
          {/* window strip along box */}
          <rect x="24" y="42" width="410" height="30" rx="3" opacity="0.55" />
          {[70, 130, 190, 250, 310, 370].map((x) => <line key={x} x1={x} y1={42} x2={x} y2={72} opacity="0.3" strokeWidth={0.6} />)}
          {/* red accent + star of life */}
          <rect x="10" y="86" width="440" height="8" opacity="0.5" />
          <circle cx="240" cy="60" r="16" opacity="0.7" />
          <line x1="240" y1="48" x2="240" y2="72" strokeWidth={0.8} />
          <line x1="230" y1="53" x2="250" y2="67" strokeWidth={0.8} />
          <line x1="230" y1="67" x2="250" y2="53" strokeWidth={0.8} />
          {/* lower compartment doors + seams */}
          {[60, 120, 180, 300, 360, 400].map((x) => <HatchDoor key={x} x={x} y={98} h={44} />)}
          <rect x="30" y="102" width="70" height="34" rx="2" opacity="0.4" />
          <rect x="130" y="102" width="60" height="34" rx="2" opacity="0.4" />
          <rect x="310" y="102" width="45" height="34" rx="2" opacity="0.4" />
          {/* wheels */}
          <WheelHub cx={100} cy={158} r={26} />
          <WheelHub cx={380} cy={158} r={26} />
          <line x1="10" y1="146" x2="450" y2="146" opacity="0.3" strokeWidth={0.6} />
          <Dim x1="10" y1="196" x2="544" y2="196" />
          <Dim x1="560" y1="26" x2="560" y2="184" vertical />
          <Label x={277} y={210}>SIDE VIEW</Label>
        </g>
      </g>
    </svg>
  )
}

export function FireTruckBlueprint({ className = '', width = 680 }) {
  return (
    <svg viewBox="0 0 680 480" width={width} className={className} aria-hidden="true">
      <g fill="none" stroke={STROKE} strokeWidth={SW} strokeLinejoin="round">

        {/* ================= REAR VIEW ================= */}
        <g transform="translate(16,10)">
          <rect x="0" y="0" width="120" height="118" rx="6" />
          <rect x="10" y="10" width="100" height="70" rx="3" opacity="0.5" />
          {[30, 55, 80].map((x) => <line key={x} x1={x} y1={10} x2={x} y2={80} opacity="0.35" strokeWidth={0.6} />)}
          <rect x="16" y="88" width="88" height="20" opacity="0.4" />
          <circle cx="18" cy="122" r="2" fill={STROKE} />
          <circle cx="102" cy="122" r="2" fill={STROKE} />
          <Dim x1="0" y1="132" x2="120" y2="132" />
          <Label x={60} y={144}>REAR VIEW</Label>
        </g>

        {/* ================= FRONT / CAB VIEW ================= */}
        <g transform="translate(160,10)">
          <path d="M4 34 Q4 0 40 0h44q36 0 36 34v76H4Z" />
          <rect x="14" y="12" width="80" height="22" rx="3" opacity="0.6" />
          <line x1="54" y1="12" x2="54" y2="34" opacity="0.4" />
          <rect x="18" y="42" width="28" height="18" rx="2" opacity="0.4" />
          <rect x="66" y="42" width="28" height="18" rx="2" opacity="0.4" />
          <rect x="42" y="64" width="30" height="10" rx="1.5" opacity="0.45" />
          <circle cx="20" cy="92" r="4" opacity="0.5" />
          <circle cx="94" cy="92" r="4" opacity="0.5" />
          <circle cx="12" cy="112" r="2" fill={STROKE} />
          <circle cx="100" cy="112" r="2" fill={STROKE} />
          <Dim x1="4" y1="120" x2="104" y2="120" />
          <Label x={54} y={132}>FRONT VIEW</Label>
        </g>

        {/* ================= TOP VIEW ================= */}
        <g transform="translate(300,10)">
          <rect x="0" y="10" width="360" height="60" rx="10" />
          <line x1="230" y1="10" x2="230" y2="70" opacity="0.4" />
          {[40, 80, 120, 160, 200].map((x) => <line key={x} x1={x} y1={10} x2={x} y2={70} opacity="0.3" strokeWidth={0.6} />)}
          <path d="M230 14h90l24 18v22l-24 6h-90Z" opacity="0.55" />
          <circle cx="14" cy="10" r="2.2" fill={STROKE} />
          <circle cx="14" cy="70" r="2.2" fill={STROKE} />
          <circle cx="346" cy="10" r="2.2" fill={STROKE} />
          <circle cx="346" cy="70" r="2.2" fill={STROKE} />
          <Dim x1="0" y1="78" x2="360" y2="78" />
          <Label x={180} y={90}>TOP VIEW</Label>
        </g>

        {/* ================= SIDE VIEW A — equipment bay detail (large) ================= */}
        <g transform="translate(16,160)">
          <rect x="8" y="24" width="560" height="110" rx="12" />
          <path d="M568 28h60l30 34v42l-30 12h-60Z" />
          <path d="M578 34h26l20 22h-46Z" opacity="0.55" />
          {/* ladder on roof */}
          <line x1="30" y1="20" x2="470" y2="2" strokeWidth={1.6} />
          <line x1="30" y1="14" x2="466" y2="-4" strokeWidth={0.8} opacity="0.6" />
          {Array.from({ length: 11 }, (_, n) => (
            <line key={n} x1={40 + n * 40} y1={19 - n * 1.5} x2={40 + n * 40} y2={11 - n * 1.5} strokeWidth={0.6} opacity="0.7" />
          ))}
          {/* equipment compartment grid */}
          <line x1="8" y1="58" x2="568" y2="58" opacity="0.5" strokeWidth={0.7} />
          {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540].map((x) => (
            <line key={x} x1={x} y1={58} x2={x} y2={100} opacity="0.35" strokeWidth={0.6} />
          ))}
          {[65, 115, 165, 215, 265, 315, 365, 415, 465, 515].map((x) => (
            <circle key={x} cx={x} cy={80} r={7} opacity="0.7" strokeWidth={0.7} />
          ))}
          <rect x="20" y="32" width="330" height="20" rx="2" opacity="0.5" />
          {/* dimension ticks along compartments */}
          <Dim x1="8" y1="106" x2="568" y2="106" />
          <WheelHub cx={80} cy={148} r={28} />
          <WheelHub cx={290} cy={148} r={28} />
          <WheelHub cx={500} cy={148} r={28} />
          <Dim x1="8" y1="186" x2="658" y2="186" />
          <Label x={288} y={200}>SIDE VIEW &mdash; EQUIPMENT BAY</Label>
        </g>

        {/* ================= SIDE VIEW B — hose/tank detail (large, lower) ================= */}
        <g transform="translate(16,320)">
          <rect x="8" y="10" width="560" height="96" rx="12" />
          <path d="M568 14h60l30 30v36l-30 10h-60Z" />
          <path d="M578 20h26l20 18h-46Z" opacity="0.55" />
          {/* vertical louvre / hose panel */}
          {Array.from({ length: 14 }, (_, n) => (
            <line key={n} x1={30 + n * 22} y1={20} x2={30 + n * 22} y2={80} opacity="0.4" strokeWidth={0.7} />
          ))}
          <line x1="8" y1="46" x2="330" y2="46" opacity="0.4" strokeWidth={0.6} />
          <rect x="360" y="20" width="180" height="60" rx="3" opacity="0.45" />
          <line x1="450" y1="20" x2="450" y2="80" opacity="0.3" strokeWidth={0.6} />
          <WheelHub cx={80} cy={122} r={24} />
          <WheelHub cx={280} cy={122} r={24} />
          <WheelHub cx={480} cy={122} r={24} />
          <Dim x1="8" y1="160" x2="658" y2="160" />
          <Label x={288} y={174}>SIDE VIEW &mdash; TANK / HOSE PANEL</Label>
        </g>
      </g>
    </svg>
  )
}
