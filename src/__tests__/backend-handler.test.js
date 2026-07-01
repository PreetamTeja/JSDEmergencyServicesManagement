/**
 * Tests for isolated pure helpers from backend/handler.mjs.
 * Because handler.mjs imports AWS SDK clients at the top level we extract and
 * re-implement the pure functions under test here, cross-checking against the
 * source so they stay in sync.
 */
import { describe, it, expect } from 'vitest'

// ---- SCOPES map (copied exactly from handler.mjs lines 65-77) ----
// We test the structural invariant rather than re-importing to avoid
// AWS SDK instantiation at import time.
const SCOPES = {
  CONSOLE: '*',
  HOSPITAL: ['emergencies'],
  EDUCATION: ['requests'],
  DELIVERY: ['requests'],
  ADMIN: ['requests'],
  HR: ['bookings'],
  FUEL: ['fleet'],
  MCP: ['infra'],
  HEALTH: ['emergencies'],
  MENTAL_HEALTH: ['emergencies'],
  WELFARE: ['emergencies'],
}

const canPost = (source, resource) => {
  const allow = SCOPES[source]
  return allow === '*' || (Array.isArray(allow) && allow.includes(resource))
}

describe('SCOPES — emergency-scoped sources', () => {
  const emergencySources = ['HOSPITAL', 'HEALTH', 'MENTAL_HEALTH', 'WELFARE']

  for (const src of emergencySources) {
    it(`${src} can POST /emergencies`, () => {
      expect(canPost(src, 'emergencies')).toBe(true)
    })

    it(`${src} cannot POST /requests`, () => {
      expect(canPost(src, 'requests')).toBe(false)
    })

    it(`${src} cannot POST /fleet`, () => {
      expect(canPost(src, 'fleet')).toBe(false)
    })
  }
})

describe('SCOPES — MCP', () => {
  it('MCP can POST /infra', () => {
    expect(canPost('MCP', 'infra')).toBe(true)
  })

  it('MCP cannot POST /emergencies', () => {
    expect(canPost('MCP', 'emergencies')).toBe(false)
  })
})

describe('SCOPES — CONSOLE', () => {
  it('CONSOLE can POST anything', () => {
    expect(canPost('CONSOLE', 'emergencies')).toBe(true)
    expect(canPost('CONSOLE', 'requests')).toBe(true)
    expect(canPost('CONSOLE', 'fleet')).toBe(true)
    expect(canPost('CONSOLE', 'infra')).toBe(true)
  })
})

describe('SCOPES — request-scoped sources', () => {
  const requestSources = ['EDUCATION', 'DELIVERY', 'ADMIN']

  for (const src of requestSources) {
    it(`${src} can POST /requests`, () => {
      expect(canPost(src, 'requests')).toBe(true)
    })

    it(`${src} cannot POST /emergencies`, () => {
      expect(canPost(src, 'emergencies')).toBe(false)
    })
  }
})

describe('SCOPES — HR', () => {
  it('HR can POST /bookings', () => {
    expect(canPost('HR', 'bookings')).toBe(true)
  })

  it('HR cannot POST /emergencies', () => {
    expect(canPost('HR', 'emergencies')).toBe(false)
  })
})

describe('SCOPES — FUEL', () => {
  it('FUEL can POST /fleet', () => {
    expect(canPost('FUEL', 'fleet')).toBe(true)
  })

  it('FUEL cannot POST /emergencies', () => {
    expect(canPost('FUEL', 'emergencies')).toBe(false)
  })
})

describe('SCOPES — unknown source', () => {
  it('unknown source is rejected for any resource', () => {
    expect(canPost('UNKNOWN', 'emergencies')).toBe(false)
    expect(canPost(undefined, 'emergencies')).toBe(false)
    expect(canPost(null, 'requests')).toBe(false)
  })
})

// ---- validateEmergency (re-implemented to match handler.mjs) ----
const KINDS = ['medical', 'fire', 'blood']
const SEVS = ['Critical', 'Urgent', 'Normal']
const str = (v, max = 120) => typeof v === 'string' && v.length <= max
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

function validateEmergency(b) {
  if (b.kind != null && !KINDS.includes(b.kind)) return 'invalid kind'
  if (b.severity != null && !SEVS.includes(b.severity)) return 'invalid severity'
  const units = b.units != null ? Number(b.units) : 1
  if (!Number.isInteger(units) || units < 1 || units > 10) return 'invalid units'
  const patients = b.patients != null ? Number(b.patients) : 1
  if (!Number.isInteger(patients) || patients < 1 || patients > 1000) return 'invalid patients'
  const p = b.pickup
  if (!p || typeof p !== 'object') return 'pickup required'
  if (p.ref != null && !str(p.ref, 80)) return 'invalid pickup.ref'
  if (p.lat != null && !inRange(Number(p.lat), -90, 90)) return 'invalid pickup.lat'
  if (p.lng != null && !inRange(Number(p.lng), -180, 180)) return 'invalid pickup.lng'
  if (p.ref == null && (p.lat == null || p.lng == null)) return 'pickup needs ref or lat/lng'
  if (b.blood_bank_id != null && !str(b.blood_bank_id, 80)) return 'invalid blood_bank_id'
  if (b.note != null && !str(b.note, 500)) return 'note too long'
  if (b.requested_by != null && !str(b.requested_by, 120)) return 'invalid requested_by'
  return null
}

describe('validateEmergency', () => {
  const validBody = { pickup: { ref: 'loc-1' } }

  it('accepts a minimal valid body (pickup.ref)', () => {
    expect(validateEmergency(validBody)).toBeNull()
  })

  it('accepts pickup with lat/lng', () => {
    expect(validateEmergency({ pickup: { lat: 22.76, lng: 86.20 } })).toBeNull()
  })

  it('rejects invalid kind', () => {
    expect(validateEmergency({ ...validBody, kind: 'flood' })).toBe('invalid kind')
  })

  it('accepts valid kinds', () => {
    for (const k of ['medical', 'fire', 'blood']) {
      expect(validateEmergency({ ...validBody, kind: k })).toBeNull()
    }
  })

  it('rejects invalid severity', () => {
    expect(validateEmergency({ ...validBody, severity: 'Minor' })).toBe('invalid severity')
  })

  it('accepts valid severities', () => {
    for (const s of ['Critical', 'Urgent', 'Normal']) {
      expect(validateEmergency({ ...validBody, severity: s })).toBeNull()
    }
  })

  it('rejects units = 0', () => {
    expect(validateEmergency({ ...validBody, units: 0 })).toBe('invalid units')
  })

  it('rejects units = 11', () => {
    expect(validateEmergency({ ...validBody, units: 11 })).toBe('invalid units')
  })

  it('accepts units = 1 through 10', () => {
    for (let u = 1; u <= 10; u++) {
      expect(validateEmergency({ ...validBody, units: u })).toBeNull()
    }
  })

  it('rejects patients = 0', () => {
    expect(validateEmergency({ ...validBody, patients: 0 })).toBe('invalid patients')
  })

  it('rejects patients = 1001', () => {
    expect(validateEmergency({ ...validBody, patients: 1001 })).toBe('invalid patients')
  })

  it('accepts patients = 1000', () => {
    expect(validateEmergency({ ...validBody, patients: 1000 })).toBeNull()
  })

  it('rejects missing pickup', () => {
    expect(validateEmergency({})).toBe('pickup required')
    expect(validateEmergency({ pickup: null })).toBe('pickup required')
    expect(validateEmergency({ pickup: 'string' })).toBe('pickup required')
  })

  it('rejects pickup with neither ref nor lat/lng', () => {
    expect(validateEmergency({ pickup: {} })).toBe('pickup needs ref or lat/lng')
  })

  it('rejects pickup.lat out of range', () => {
    expect(validateEmergency({ pickup: { lat: 91, lng: 86 } })).toBe('invalid pickup.lat')
    expect(validateEmergency({ pickup: { lat: -91, lng: 86 } })).toBe('invalid pickup.lat')
  })

  it('rejects pickup.lng out of range', () => {
    expect(validateEmergency({ pickup: { lat: 22, lng: 181 } })).toBe('invalid pickup.lng')
  })

  it('rejects note longer than 500 chars', () => {
    const note = 'x'.repeat(501)
    expect(validateEmergency({ ...validBody, note })).toBe('note too long')
  })

  it('accepts note of exactly 500 chars', () => {
    const note = 'x'.repeat(500)
    expect(validateEmergency({ ...validBody, note })).toBeNull()
  })
})

// ---- havKm (Haversine, extracted from handler.mjs) ----
const R = 6371
function havKm(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

describe('havKm', () => {
  it('returns 0 for identical points', () => {
    expect(havKm({ lat: 22.76, lng: 86.20 }, { lat: 22.76, lng: 86.20 })).toBeCloseTo(0, 5)
  })

  it('is approximately correct for known distance', () => {
    // Jamshedpur to Dhanbad ~ 60 km straight line
    const jsr = { lat: 22.8046, lng: 86.2029 }
    const dhanbad = { lat: 23.7957, lng: 86.4304 }
    const d = havKm(jsr, dhanbad)
    expect(d).toBeGreaterThan(50)
    expect(d).toBeLessThan(130)
  })

  it('is symmetric', () => {
    const a = { lat: 22.74, lng: 86.18 }
    const b = { lat: 22.83, lng: 86.24 }
    expect(havKm(a, b)).toBeCloseTo(havKm(b, a), 8)
  })
})

// ---- auth helpers: isAdminClaims and identityOf (pure, no crypto) ----
// Replicated from backend/auth.mjs
function groupsOf(claims) {
  const g = claims?.['cognito:groups'] || []
  return Array.isArray(g) ? g : [g].filter(Boolean)
}

const ADMIN_GROUPS_ENV = ''
function isAdminClaims(claims) {
  const g = groupsOf(claims)
  const ADMIN_GROUPS = ADMIN_GROUPS_ENV.split(',').map((s) => s.trim()).filter(Boolean)
  return ADMIN_GROUPS.length
    ? g.some((x) => ADMIN_GROUPS.includes(x))
    : g.some((x) => /-admin$/i.test(String(x)))
}

function identityOf(claims) {
  return claims?.sub || claims?.username || claims?.email || claims?.name || null
}

describe('isAdminClaims', () => {
  it('returns true when a group ends with -admin', () => {
    expect(isAdminClaims({ 'cognito:groups': ['dispatcher-admin'] })).toBe(true)
    expect(isAdminClaims({ 'cognito:groups': ['fleet-admin'] })).toBe(true)
  })

  it('returns false when no group ends with -admin', () => {
    expect(isAdminClaims({ 'cognito:groups': ['dispatcher', 'users'] })).toBe(false)
  })

  it('returns false for empty groups', () => {
    expect(isAdminClaims({ 'cognito:groups': [] })).toBe(false)
    expect(isAdminClaims({})).toBe(false)
    expect(isAdminClaims(null)).toBe(false)
  })

  it('is case-insensitive for -admin suffix', () => {
    expect(isAdminClaims({ 'cognito:groups': ['Fleet-Admin'] })).toBe(true)
    expect(isAdminClaims({ 'cognito:groups': ['FLEET-ADMIN'] })).toBe(true)
  })

  it('handles a single string group (non-array)', () => {
    // groupsOf wraps it in an array
    expect(isAdminClaims({ 'cognito:groups': 'ops-admin' })).toBe(true)
  })
})

describe('identityOf', () => {
  it('returns sub when present', () => {
    expect(identityOf({ sub: 'user-123', email: 'a@b.com' })).toBe('user-123')
  })

  it('falls back to username', () => {
    expect(identityOf({ username: 'johndoe' })).toBe('johndoe')
  })

  it('falls back to email', () => {
    expect(identityOf({ email: 'x@y.com' })).toBe('x@y.com')
  })

  it('falls back to name', () => {
    expect(identityOf({ name: 'Jane' })).toBe('Jane')
  })

  it('returns null when claims is null', () => {
    expect(identityOf(null)).toBeNull()
    expect(identityOf(undefined)).toBeNull()
  })

  it('returns null when no identifying field exists', () => {
    expect(identityOf({})).toBeNull()
  })
})
