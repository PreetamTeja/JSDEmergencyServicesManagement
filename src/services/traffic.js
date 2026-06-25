// Simulated real-time traffic layer.
// Keeps a per-zone congestion factor (1.0 = free flow .. ~3.0 = gridlock) that
// drifts over time (bounded random walk) and follows a rush-hour curve. Routing
// uses it to pick the fastest *traffic-adjusted* route and to inflate ETAs.
// No external dependency — swap factorForPath() for a provider call to go "real".
import { ZONES, zonesByProximity } from '../data/locations'

const MODE_VALUES = { clear: 1.0, moderate: 1.5, heavy: 2.1, gridlock: 2.8 }
let MODE = 'auto'                 // 'auto' | clear | moderate | heavy | gridlock
const factors = new Map()         // zoneId -> factor
let lastTick = 0

// Rush-hour curve: peaks ~08:00–10:00 and 17:00–19:00.
function rushTarget(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60
  const peak = (c, w, amp) => amp * Math.exp(-((h - c) ** 2) / (2 * w * w))
  return 1.15 + peak(9, 1.1, 0.9) + peak(18, 1.3, 1.1) // ~1.15 base, up to ~2.2 at peaks
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function ensureSeed() {
  if (!ZONES?.length) return
  for (const z of ZONES) if (!factors.has(z.id)) factors.set(z.id, rushTarget())
}

// Advance the simulation. Self-throttles, so it's safe to call every app tick (1s).
export function tickTraffic(now = Date.now()) {
  if (now - lastTick < 4000) return
  lastTick = now
  ensureSeed()
  if (MODE !== 'auto') { for (const z of ZONES || []) factors.set(z.id, MODE_VALUES[MODE]); return }
  const target = rushTarget()
  for (const z of ZONES || []) {
    const cur = factors.get(z.id) ?? target
    // pull toward the rush target + random noise
    const next = cur + (target - cur) * 0.15 + (Math.random() - 0.5) * 0.4
    factors.set(z.id, clamp(next, 1.0, 3.0))
  }
}

// Force a congestion mode for demos ('auto' resumes the simulation).
export function setTrafficMode(mode) {
  MODE = MODE_VALUES[mode] != null || mode === 'auto' ? mode : 'auto'
  lastTick = 0; tickTraffic() // apply immediately
}
export function getTrafficMode() { return MODE }

export function factorAt(lat, lng) {
  if (!ZONES?.length) return 1
  const z = zonesByProximity({ lat, lng })[0]?.zone
  return (z && factors.get(z.id)) || 1
}

// Average congestion along a route (coords: [[lat,lng], ...]).
export function factorForPath(coords) {
  if (!coords?.length) return 1
  const step = Math.max(1, Math.floor(coords.length / 8))
  let sum = 0, n = 0
  for (let i = 0; i < coords.length; i += step) { sum += factorAt(coords[i][0], coords[i][1]); n++ }
  return n ? sum / n : 1
}

export function trafficLevel(factor) {
  if (factor < 1.25) return { level: 'clear', color: '#16a34a', label: 'Clear' }
  if (factor < 1.7) return { level: 'moderate', color: '#d97706', label: 'Moderate' }
  if (factor < 2.3) return { level: 'heavy', color: '#ea580c', label: 'Heavy' }
  return { level: 'gridlock', color: '#dc2626', label: 'Gridlock' }
}
