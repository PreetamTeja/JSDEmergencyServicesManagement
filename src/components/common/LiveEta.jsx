import React, { useEffect, useState } from 'react'

// Live countdown to arrival. Prefers the server's `eta_complete` (unix seconds);
// falls back to a static minutes value. Updates every second.
export default function LiveEta({ etaComplete, fallbackMin = 0, className = '' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!etaComplete) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [etaComplete])

  if (!etaComplete) {
    return <span className={className}>{Math.max(0, Math.round(fallbackMin))} min</span>
  }
  const secs = Math.max(0, etaComplete - Math.floor(Date.now() / 1000))
  if (secs <= 0) return <span className={className}>arriving</span>
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return <span className={className}>{m > 0 ? `${m}m ${s}s` : `${s}s`}</span>
}
