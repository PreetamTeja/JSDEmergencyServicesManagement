import React from 'react'

// The boot logo mark, built as a 3x3 grid of shard tiles instead of a flat
// square — each tile starts scattered outward, rotated, and transparent,
// then converges into place with a staggered delay (an "implosion" read
// as a reveal, rather than a real exploding photograph — see the CSS
// keyframe below for exactly how each shard moves). Pure CSS/SVG, no
// external image asset: the shards are just colored divs, and the "TS"
// wordmark fades in on top once they've mostly landed.
//
// Respects prefers-reduced-motion — see src/index.css's existing reduced-
// motion block, extended to include .explode-shard/.explode-mark below.
export default function ExplodeLogo({ size = 56 }) {
  const pieces = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3)
    const col = i % 3
    // Outward vector from center tile (1,1) toward this tile's grid position,
    // scaled up so the shard starts well outside the mark before converging.
    const dx = (col - 1) * (size * 1.9)
    const dy = (row - 1) * (size * 1.9)
    const rot = (col - 1) * 50 + (row - 1) * -30
    // Stagger from the outer ring inward-ish, with the center piece landing
    // last so the wordmark reveal reads as "assembled, then labeled."
    const delay = (Math.abs(col - 1) + Math.abs(row - 1)) * 60 + col * 20

    return (
      <div key={i} className="explode-shard"
        style={{
          position: 'absolute',
          width: `${size / 3}px`, height: `${size / 3}px`,
          top: `${row * (size / 3)}px`, left: `${col * (size / 3)}px`,
          background: (row + col) % 2 === 0 ? '#D6DF27' : '#C7CF20',
          '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': `${rot}deg`,
          animationDelay: `${delay}ms`,
        }} />
    )
  })

  return (
    <div className="relative" style={{ width: size, height: size, borderRadius: size * 0.28, overflow: 'hidden' }}>
      {pieces}
      <div className="explode-mark absolute inset-0 grid place-items-center font-bold"
        style={{ fontSize: size * 0.36, color: '#07514D' }}>TS</div>
    </div>
  )
}
