import { describe, it, expect, beforeEach } from 'vitest'
import {
  setHospitals,
  hospitalById,
  HOSPITALS,
  CASE_TYPES,
  SEVERITIES,
  SEVERITY_META,
} from '../data/hospitals.js'

const SAMPLE_HOSPITALS = [
  { id: 'h-1', name: 'MGM Medical', specialties: ['Cardiac', 'Trauma'], capability: 5, lat: 22.76, lng: 86.20 },
  { id: 'h-2', name: 'District Hospital', specialties: ['General', 'Maternity'], capability: 3, lat: 22.78, lng: 86.22 },
  { id: 'h-3', name: "St. Mary's", specialties: ['Pediatric'], capability: 4, lat: 22.74, lng: 86.19 },
]

beforeEach(() => {
  setHospitals(SAMPLE_HOSPITALS)
})

describe('CASE_TYPES', () => {
  it('includes all expected case types', () => {
    expect(CASE_TYPES).toContain('Cardiac')
    expect(CASE_TYPES).toContain('Trauma')
    expect(CASE_TYPES).toContain('General')
    expect(CASE_TYPES).toContain('Maternity')
    expect(CASE_TYPES).toContain('Pediatric')
  })
})

describe('SEVERITIES', () => {
  it('has Critical, Urgent, Normal in order', () => {
    expect(SEVERITIES).toEqual(['Critical', 'Urgent', 'Normal'])
  })
})

describe('SEVERITY_META', () => {
  it('Critical has rank 0 and red color', () => {
    expect(SEVERITY_META.Critical.rank).toBe(0)
    expect(SEVERITY_META.Critical.color).toBe('#dc2626')
  })

  it('Urgent has rank 1', () => {
    expect(SEVERITY_META.Urgent.rank).toBe(1)
  })

  it('Normal has rank 2 and blue color', () => {
    expect(SEVERITY_META.Normal.rank).toBe(2)
    expect(SEVERITY_META.Normal.color).toBe('#2563eb')
  })

  it('ranks are strictly ordered Critical < Urgent < Normal', () => {
    const { Critical, Urgent, Normal } = SEVERITY_META
    expect(Critical.rank).toBeLessThan(Urgent.rank)
    expect(Urgent.rank).toBeLessThan(Normal.rank)
  })
})

describe('setHospitals / hospitalById', () => {
  it('finds an existing hospital by id', () => {
    const h = hospitalById('h-1')
    expect(h).toBeDefined()
    expect(h.name).toBe('MGM Medical')
  })

  it('returns undefined for unknown id', () => {
    expect(hospitalById('h-99')).toBeUndefined()
  })

  it('returns undefined for undefined id', () => {
    expect(hospitalById(undefined)).toBeUndefined()
  })

  it('resets hospital list on subsequent setHospitals calls', () => {
    setHospitals([{ id: 'h-new', name: 'New Hospital', specialties: [] }])
    expect(hospitalById('h-1')).toBeUndefined()
    expect(hospitalById('h-new')?.name).toBe('New Hospital')
  })

  it('setHospitals with no args defaults to empty', () => {
    setHospitals()
    expect(hospitalById('h-1')).toBeUndefined()
  })
})
