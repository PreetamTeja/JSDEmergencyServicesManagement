// Zone-based dispatch + severity/specialty ambulance routing.
// Pure logic — the store passes data in and persists results, so this can be
// swapped for real AWS endpoints later.
import { getRoute, haversine } from './osrm'
import { ZONES, zoneById, zonesByProximity } from '../data/locations'

// Position of a vehicle: live pos if moving, else its home-zone reference point.
export function vehicleHomePos(vehicle) {
  const z = zoneById(vehicle?.homeZoneId) || ZONES[0]
  if (!z?.ref) return null
  return { lat: z.ref.lat, lng: z.ref.lng }
}

// Pick an available driver for a vehicle: prefer its own home driver, else any
// available driver stationed in the same zone.
function pickDriver(vehicle, drivers) {
  const own = drivers.find((d) => d.id === vehicle.driverId)
  if (own && own.status === 'available') return own
  return drivers.find((d) => d.homeZoneId === vehicle.homeZoneId && d.status === 'available') || null
}

// Nearest zone to `pickup` that has an idle vehicle of `type` with a free driver.
// Falls back to the next-nearest zone automatically. Returns null if none.
export function findNearestZonePool(pickup, type, vehicles, drivers) {
  for (const { zone, km } of zonesByProximity(pickup)) {
    const vehicle = vehicles.find((v) => v.homeZoneId === zone.id && v.type === type && v.status === 'idle')
    if (!vehicle) continue
    const driver = pickDriver(vehicle, drivers)
    if (!driver) continue
    return { zone, vehicle, driver, zoneKm: km }
  }
  return null
}

// Live idle-fleet counts per zone, by type. Used for the map overlay.
export function zonePoolCounts(vehicles) {
  return ZONES.map((z) => {
    const pool = vehicles.filter((v) => v.homeZoneId === z.id)
    const idle = pool.filter((v) => v.status === 'idle')
    const byType = idle.reduce((a, v) => { a[v.type] = (a[v.type] || 0) + 1; return a }, {})
    return { zone: z, idleCount: idle.length, total: pool.length, byType }
  })
}

// Rank idle ambulances by OSRM travel time from their position to the pickup.
// Pre-ranks by straight-line, then refines the closest few with OSRM.
export async function rankNearestAmbulance(ambulances, pickup) {
  const prelim = ambulances
    .map((v) => ({ vehicle: v, pos: vehicleHomePos(v), km: haversine([pickup.lat, pickup.lng], [vehicleHomePos(v).lat, vehicleHomePos(v).lng]) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 3)
  let best = null
  for (const c of prelim) {
    const leg = await getRoute([c.pos, pickup])
    if (!best || leg.durationMin < best.leg.durationMin) best = { ...c, leg }
  }
  return best // { vehicle, pos, leg } or null
}

// Choose destination hospital by required specialty.
// Normal/Urgent → nearest by OSRM travel time. Critical → bias to the highest
// capability facility with the specialty, even if slightly farther.
export async function selectHospital(pickup, specialty, severity, hospitals) {
  const eligible = hospitals.filter((h) => h.specialties.includes(specialty))
  if (!eligible.length) return null

  const prelim = eligible
    .map((h) => ({ hospital: h, km: haversine([pickup.lat, pickup.lng], [h.lat, h.lng]) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 4)

  const scored = []
  for (const c of prelim) {
    const leg = await getRoute([pickup, { lat: c.hospital.lat, lng: c.hospital.lng }])
    scored.push({ hospital: c.hospital, leg })
  }

  if (severity === 'Critical') {
    // highest capability first, then fastest
    scored.sort((a, b) => (b.hospital.capability - a.hospital.capability) || (a.leg.durationMin - b.leg.durationMin))
  } else {
    scored.sort((a, b) => a.leg.durationMin - b.leg.durationMin)
  }
  return scored[0] // { hospital, leg }
}
