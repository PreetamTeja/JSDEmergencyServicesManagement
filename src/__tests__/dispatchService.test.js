import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vehicleHomePos, findNearestZonePool, zonePoolCounts } from '../services/dispatchService.js'

// Mock the OSRM module — tests must not hit the network
vi.mock('../services/osrm', () => ({
  haversine: (a, b) => {
    const R = 6371
    const dLat = (b[0] - a[0]) * Math.PI / 180
    const dLng = (b[1] - a[1]) * Math.PI / 180
    const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
  },
  getRoute: vi.fn(),
}))

// Mock locations module — zoneById and ZONES are used internally
vi.mock('../data/locations', () => {
  const ZONES = [
    { id: 'z1', name: 'South', ref: { lat: 22.74, lng: 86.18 } },
    { id: 'z2', name: 'North', ref: { lat: 22.83, lng: 86.24 } },
  ]
  return {
    ZONES,
    zoneById: (id) => ZONES.find((z) => z.id === id),
    zonesByProximity: (point) => {
      const haversine = (a, b) => {
        const R = 6371
        const dLat = (b[0] - a[0]) * Math.PI / 180
        const dLng = (b[1] - a[1]) * Math.PI / 180
        const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180
        const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
        return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
      }
      return [...ZONES]
        .map((z) => ({ zone: z, km: haversine([point.lat, point.lng], [z.ref.lat, z.ref.lng]) }))
        .sort((a, b) => a.km - b.km)
    },
  }
})

const ZONES = [
  { id: 'z1', name: 'South', ref: { lat: 22.74, lng: 86.18 } },
  { id: 'z2', name: 'North', ref: { lat: 22.83, lng: 86.24 } },
]

const VEHICLES = [
  { id: 'v1', homeZoneId: 'z1', type: 'ambulance', status: 'idle', driverId: 'd1' },
  { id: 'v2', homeZoneId: 'z2', type: 'ambulance', status: 'idle', driverId: 'd2' },
  { id: 'v3', homeZoneId: 'z1', type: 'firetruck', status: 'idle', driverId: 'd3' },
  { id: 'v4', homeZoneId: 'z1', type: 'ambulance', status: 'enroute', driverId: 'd4' },
]

const DRIVERS = [
  { id: 'd1', homeZoneId: 'z1', status: 'available' },
  { id: 'd2', homeZoneId: 'z2', status: 'available' },
  { id: 'd3', homeZoneId: 'z1', status: 'available' },
  { id: 'd4', homeZoneId: 'z1', status: 'on-trip' },
]

describe('vehicleHomePos', () => {
  it('returns lat/lng from the vehicle home zone ref', () => {
    const veh = { homeZoneId: 'z1' }
    const pos = vehicleHomePos(veh)
    expect(pos.lat).toBe(22.74)
    expect(pos.lng).toBe(86.18)
  })

  it('falls back to ZONES[0] for unknown zone id', () => {
    // Source: `zoneById(vehicle?.homeZoneId) || ZONES[0]`
    // If zoneById returns undefined, ZONES[0] (z1) is used as fallback
    const veh = { homeZoneId: 'unknown' }
    const pos = vehicleHomePos(veh)
    // Falls back to ZONES[0] = z1 { lat: 22.74, lng: 86.18 }
    expect(pos).not.toBeNull()
    expect(pos.lat).toBe(22.74)
  })

  it('falls back to ZONES[0] for null vehicle', () => {
    // null vehicle → vehicle?.homeZoneId = undefined → zoneById(undefined) = undefined → ZONES[0]
    const pos = vehicleHomePos(null)
    expect(pos).not.toBeNull()
    expect(typeof pos.lat).toBe('number')
  })

  it('falls back to ZONES[0] for vehicle with no homeZoneId', () => {
    const veh = {}
    const pos = vehicleHomePos(veh)
    // ZONES[0] = z1 in our mock
    expect(pos).not.toBeNull()
    expect(typeof pos.lat).toBe('number')
  })
})

describe('findNearestZonePool', () => {
  it('finds the nearest zone with an idle ambulance + free driver', () => {
    // South zone (z1) is very close to this pickup point
    const pickup = { lat: 22.74, lng: 86.18 }
    const result = findNearestZonePool(pickup, 'ambulance', VEHICLES, DRIVERS)
    expect(result).not.toBeNull()
    expect(result.vehicle.homeZoneId).toBe('z1')
    expect(result.driver.id).toBe('d1')
  })

  it('returns null when no idle vehicle of the right type exists', () => {
    const pickup = { lat: 22.74, lng: 86.18 }
    const busless = VEHICLES.filter((v) => v.type !== 'bus') // no buses anyway
    const result = findNearestZonePool(pickup, 'bus', busless, DRIVERS)
    expect(result).toBeNull()
  })

  it('skips vehicles without a free driver', () => {
    // Make all south zone ambulance drivers busy
    const busyDrivers = DRIVERS.map((d) => d.homeZoneId === 'z1' ? { ...d, status: 'on-trip' } : d)
    const pickup = { lat: 22.74, lng: 86.18 }
    const result = findNearestZonePool(pickup, 'ambulance', VEHICLES, busyDrivers)
    // Should fall through to north zone (z2)
    expect(result?.vehicle.homeZoneId).toBe('z2')
  })

  it('skips non-idle vehicles', () => {
    const pickup = { lat: 22.74, lng: 86.18 }
    // Mark z1 ambulance as enroute so only z2 is available
    const busy = VEHICLES.map((v) => v.id === 'v1' ? { ...v, status: 'enroute' } : v)
    const result = findNearestZonePool(pickup, 'ambulance', busy, DRIVERS)
    expect(result?.zone.id).toBe('z2')
  })

  it('returns the matching firetruck from zone z1', () => {
    const pickup = { lat: 22.74, lng: 86.18 }
    const result = findNearestZonePool(pickup, 'firetruck', VEHICLES, DRIVERS)
    expect(result).not.toBeNull()
    expect(result.vehicle.id).toBe('v3')
  })
})

describe('zonePoolCounts', () => {
  it('returns one entry per zone', () => {
    const counts = zonePoolCounts(VEHICLES)
    expect(counts.length).toBe(2) // mocked ZONES has 2 zones
  })

  it('counts idle vehicles correctly', () => {
    const counts = zonePoolCounts(VEHICLES)
    const south = counts.find((c) => c.zone.id === 'z1')
    // v1 (ambulance idle) + v3 (firetruck idle) = 2 idle, v4 (enroute) not counted
    expect(south.idleCount).toBe(2)
    // total in zone = v1 + v3 + v4 = 3
    expect(south.total).toBe(3)
  })

  it('reports byType breakdown', () => {
    const counts = zonePoolCounts(VEHICLES)
    const south = counts.find((c) => c.zone.id === 'z1')
    expect(south.byType.ambulance).toBe(1)
    expect(south.byType.firetruck).toBe(1)
  })

  it('handles empty vehicle list', () => {
    const counts = zonePoolCounts([])
    for (const c of counts) {
      expect(c.idleCount).toBe(0)
      expect(c.total).toBe(0)
    }
  })
})
