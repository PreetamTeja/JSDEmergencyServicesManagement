// OSRM public demo server client. Returns route geometry, distance, duration.
// Falls back to a straight-line geometry if the network call fails so the demo
// keeps working offline.
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'

// coords: [{lat,lng}, ...] in order. Returns {coordinates:[[lat,lng]...], distanceKm, durationMin}
export async function getRoute(coords) {
  coords = (coords || []).filter((c) => c && typeof c.lng === 'number' && typeof c.lat === 'number')
  if (coords.length < 2) return { coordinates: [], distanceKm: 0, durationMin: 0, fallback: true }
  const path = coords.map((c) => `${c.lng},${c.lat}`).join(';')
  const url = `${OSRM_BASE}/${path}?overview=full&geometries=geojson&steps=false`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('OSRM ' + res.status)
    const data = await res.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('No route')
    return {
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      fallback: false,
    }
  } catch (e) {
    // straight-line fallback
    const line = coords.map((c) => [c.lat, c.lng])
    const distanceKm = haversineTotal(line)
    return { coordinates: densify(line), distanceKm, durationMin: (distanceKm / 28) * 60, fallback: true }
  }
}

// Like getRoute but returns up to N candidate routes (for traffic-aware selection).
// Falls back to a single straight-line route if the network call fails.
export async function getRouteAlternatives(coords) {
  coords = (coords || []).filter((c) => c && typeof c.lng === 'number' && typeof c.lat === 'number')
  if (coords.length < 2) return [{ coordinates: [], distanceKm: 0, durationMin: 0, fallback: true }]
  const path = coords.map((c) => `${c.lng},${c.lat}`).join(';')
  const url = `${OSRM_BASE}/${path}?overview=full&geometries=geojson&steps=false&alternatives=3`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('OSRM ' + res.status)
    const data = await res.json()
    const routes = data.routes || []
    if (!routes.length) throw new Error('No route')
    return routes.map((route) => ({
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      fallback: false,
    }))
  } catch {
    const line = coords.map((c) => [c.lat, c.lng])
    const distanceKm = haversineTotal(line)
    return [{ coordinates: densify(line), distanceKm, durationMin: (distanceKm / 28) * 60, fallback: true }]
  }
}

export function haversine(a, b) {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const lat1 = (a[0] * Math.PI) / 180
  const lat2 = (b[0] * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function haversineTotal(line) {
  let d = 0
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i])
  return d
}

// add intermediate points so straight-line fallback animates smoothly
function densify(line, perSeg = 30) {
  const out = []
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]]
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  out.push(line[line.length - 1])
  return out
}

// Nearest-neighbour ordering of drop stops starting from pickup.
export function orderStopsNearestNeighbour(pickup, drops) {
  const remaining = [...drops]
  const ordered = []
  let current = [pickup.lat, pickup.lng]
  while (remaining.length) {
    let best = 0
    let bestD = Infinity
    remaining.forEach((s, i) => {
      const d = haversine(current, [s.lat, s.lng])
      if (d < bestD) { bestD = d; best = i }
    })
    const next = remaining.splice(best, 1)[0]
    ordered.push(next)
    current = [next.lat, next.lng]
  }
  return ordered
}
