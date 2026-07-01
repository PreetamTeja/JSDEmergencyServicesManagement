import { describe, it, expect, beforeEach } from 'vitest'
import {
  setGeoReference,
  locById,
  zoneById,
  bloodBanks,
  bloodBankById,
  fmtPt,
  pickupLabel,
  zonesByProximity,
  JAMSHEDPUR_CENTER,
} from '../data/locations.js'

const SAMPLE_LOCATIONS = [
  { id: 'loc-1', name: 'City Hospital', type: 'hospital', lat: 22.76, lng: 86.20 },
  { id: 'loc-2', name: 'North Blood Bank', type: 'bloodbank', lat: 22.80, lng: 86.22 },
  { id: 'loc-3', name: 'Telco Colony', type: 'colony', lat: 22.75, lng: 86.19 },
]

const SAMPLE_ZONES = [
  { id: 'zone-1', name: 'South', ref: { lat: 22.74, lng: 86.18 } },
  { id: 'zone-2', name: 'North', ref: { lat: 22.83, lng: 86.24 } },
]

beforeEach(() => {
  setGeoReference(SAMPLE_LOCATIONS, SAMPLE_ZONES)
})

describe('JAMSHEDPUR_CENTER', () => {
  it('has lat, lng and zoom', () => {
    expect(JAMSHEDPUR_CENTER.lat).toBe(22.7596)
    expect(JAMSHEDPUR_CENTER.lng).toBe(86.2029)
    expect(JAMSHEDPUR_CENTER.zoom).toBe(13)
  })
})

describe('locById', () => {
  it('finds an existing location', () => {
    const l = locById('loc-1')
    expect(l).toBeDefined()
    expect(l.name).toBe('City Hospital')
  })

  it('returns undefined for unknown id', () => {
    expect(locById('nonexistent')).toBeUndefined()
  })

  it('returns undefined for undefined id', () => {
    expect(locById(undefined)).toBeUndefined()
  })
})

describe('zoneById', () => {
  it('finds an existing zone', () => {
    expect(zoneById('zone-1')?.name).toBe('South')
  })

  it('returns undefined for unknown zone', () => {
    expect(zoneById('zone-99')).toBeUndefined()
  })
})

describe('bloodBanks', () => {
  it('returns only bloodbank type locations', () => {
    const banks = bloodBanks()
    expect(banks.length).toBe(1)
    expect(banks[0].id).toBe('loc-2')
  })
})

describe('bloodBankById', () => {
  it('finds a blood bank by id', () => {
    const bank = bloodBankById('loc-2')
    expect(bank).toBeDefined()
    expect(bank.name).toBe('North Blood Bank')
  })

  it('returns undefined for a non-bloodbank location', () => {
    expect(bloodBankById('loc-1')).toBeUndefined()
  })
})

describe('fmtPt', () => {
  it('formats a valid point to 4 decimal places', () => {
    expect(fmtPt({ lat: 22.7596, lng: 86.2029 })).toBe('22.7596, 86.2029')
  })

  it('returns null for null', () => {
    expect(fmtPt(null)).toBeNull()
  })

  it('returns null when lat/lng are not numbers', () => {
    expect(fmtPt({ lat: 'abc', lng: 86 })).toBeNull()
  })

  it('rounds to 4 decimal places', () => {
    const r = fmtPt({ lat: 22.123456789, lng: 86.987654321 })
    expect(r).toBe('22.1235, 86.9877')
  })
})

describe('pickupLabel', () => {
  it('uses location name when pickup is a known id', () => {
    // locById('loc-1') = 'City Hospital'
    const label = pickupLabel({ pickup: 'loc-1' })
    expect(label).toBe('City Hospital')
  })

  it('falls back to pickupName when pickup id is unknown', () => {
    const label = pickupLabel({ pickup: 'unknown-id', pickupName: 'Custom Name' })
    expect(label).toBe('Custom Name')
  })

  it('falls back to formatted pickupPt when no name or pickupName', () => {
    const label = pickupLabel({ pickup: 'unknown-id', pickupPt: { lat: 22.75, lng: 86.19 } })
    expect(label).toBe('22.7500, 86.1900')
  })

  it('falls back to raw pickup string', () => {
    const label = pickupLabel({ pickup: 'raw-string-ref' })
    expect(label).toBe('raw-string-ref')
  })

  it('returns em dash for null/empty emergency', () => {
    expect(pickupLabel({})).toBe('—')
    expect(pickupLabel(null)).toBe('—')
  })
})

describe('zonesByProximity', () => {
  it('returns zones sorted nearest first', () => {
    // Point near South zone
    const point = { lat: 22.74, lng: 86.18 }
    const sorted = zonesByProximity(point)
    expect(sorted[0].zone.id).toBe('zone-1')
    expect(sorted[0].km).toBeLessThan(sorted[1].km)
  })

  it('returns zones sorted nearest first (near north)', () => {
    const point = { lat: 22.83, lng: 86.24 }
    const sorted = zonesByProximity(point)
    expect(sorted[0].zone.id).toBe('zone-2')
  })

  it('includes km property for each entry', () => {
    const sorted = zonesByProximity({ lat: 22.76, lng: 86.20 })
    for (const entry of sorted) {
      expect(typeof entry.km).toBe('number')
      expect(entry.km).toBeGreaterThanOrEqual(0)
    }
  })
})
