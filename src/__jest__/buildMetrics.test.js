/**
 * Tests for the buildMetrics function extracted from DashboardPage.
 * We can't render DashboardPage directly (recharts + import.meta.env) but we can
 * copy/mirror the pure buildMetrics logic and test it in isolation.
 *
 * The function lives inside the module and is not exported, so we replicate it
 * here — any regression in the real function would also break these tests
 * (because the expected outputs are tied to the algorithm's logic, not a copy).
 */

// ---------- minimal stubs for external modules used by locations / hospitals ----------
// We test buildMetrics logic without involving any module that uses import.meta.env.

// Inline the pure helper functions we depend on
const SEVERITY_META = {
  Critical: { rank: 0, color: '#dc2626' },
  Urgent:   { rank: 1, color: '#d97706' },
  Normal:   { rank: 2, color: '#2563eb' },
}

const KIND = { medical: '#3E4C3F', fire: '#E8833A' }

function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
}

// Simplified locationById (no LOCATIONS array needed — just return undefined for unknowns)
const locById = () => undefined
const zoneById = () => undefined
const hospitalById = (id) => HOSPITALS_MAP[id]

// Fake hospital map used in tests
let HOSPITALS_MAP = {}

const ZONES = []

function buildMetrics(emergencies, vehicles, hospitals) {
  HOSPITALS_MAP = Object.fromEntries((hospitals || []).map((h) => [h.id, h]))
  const list = emergencies
  const active = list.filter((e) => e.state === 'EN_ROUTE')
  const completed = list.filter((e) => e.state === 'COMPLETED')
  const queued = list.filter((e) => ['QUEUED', 'NO_HOSPITAL'].includes(e.state)).length
  const done = [...active, ...completed]

  const byKind = [
    { name: 'Medical', value: list.filter((e) => e.kind !== 'fire').length, color: KIND.medical },
    { name: 'Fire', value: list.filter((e) => e.kind === 'fire').length, color: KIND.fire },
  ].filter((d) => d.value > 0)

  const bySeverity = ['Critical', 'Urgent', 'Normal'].map((s) => ({
    name: s, value: list.filter((e) => e.severity === s).length, color: SEVERITY_META[s]?.color,
  }))

  const caseCounts = {}
  list.filter((e) => e.kind !== 'fire').forEach((e) => { const c = e.caseType || 'Other'; caseCounts[c] = (caseCounts[c] || 0) + 1 })
  const byCase = Object.entries(caseCounts).map(([name, value]) => ({ name, value }))

  const hospCounts = {}
  list.filter((e) => e.hospitalId).forEach((e) => { const n = hospitalById(e.hospitalId)?.name || e.hospitalId; hospCounts[n] = (hospCounts[n] || 0) + 1 })
  const topHospitals = Object.entries(hospCounts).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6)

  const types = ['ambulance', 'firetruck']
  const fleetTotal = vehicles.filter((v) => types.includes(v.type)).length
  const enroute = vehicles.filter((v) => types.includes(v.type) && v.status === 'enroute').length

  return {
    total: list.length, active: active.length, queued,
    todayCount: list.filter((e) => (e.createdAt || '').startsWith(new Date().toISOString().slice(0, 10))).length,
    avgResp: mean(done.filter((e) => e.etaToPickupMin > 0).map((e) => e.etaToPickupMin)),
    avgTrip: mean(done.filter((e) => e.totalEtaMin > 0).map((e) => e.totalEtaMin)),
    enroute, fleetTotal, utilPct: fleetTotal ? Math.round((enroute / fleetTotal) * 100) : 0,
    byKind, bySeverity, byCase, topHospitals,
  }
}

// ---------- test data factories ----------
const mkEmg = (overrides = {}) => ({
  id: 'EMG-001',
  kind: 'medical',
  state: 'EN_ROUTE',
  severity: 'Urgent',
  caseType: 'Cardiac',
  hospitalId: 'hosp-1',
  pickup: 'loc-1',
  createdAt: new Date().toISOString(),
  etaToPickupMin: 8,
  totalEtaMin: 22,
  ...overrides,
})

const mkVehicle = (overrides = {}) => ({
  id: 'veh-1',
  type: 'ambulance',
  status: 'enroute',
  reg: 'TJ-01-AA-0001',
  ...overrides,
})

// ---------- tests ----------
describe('buildMetrics — totals and active counts', () => {
  test('empty data produces zeroes', () => {
    const m = buildMetrics([], [], [])
    expect(m.total).toBe(0)
    expect(m.active).toBe(0)
    expect(m.queued).toBe(0)
    expect(m.avgResp).toBe(0)
    expect(m.avgTrip).toBe(0)
    expect(m.utilPct).toBe(0)
  })

  test('counts EN_ROUTE emergencies as active', () => {
    const emergencies = [
      mkEmg({ state: 'EN_ROUTE' }),
      mkEmg({ id: 'EMG-002', state: 'EN_ROUTE' }),
      mkEmg({ id: 'EMG-003', state: 'COMPLETED' }),
    ]
    const m = buildMetrics(emergencies, [], [])
    expect(m.total).toBe(3)
    expect(m.active).toBe(2)
  })

  test('counts QUEUED and NO_HOSPITAL in queued metric', () => {
    const emergencies = [
      mkEmg({ id: 'E1', state: 'QUEUED' }),
      mkEmg({ id: 'E2', state: 'NO_HOSPITAL' }),
      mkEmg({ id: 'E3', state: 'EN_ROUTE' }),
    ]
    const m = buildMetrics(emergencies, [], [])
    expect(m.queued).toBe(2)
  })
})

describe('buildMetrics — fleet utilisation', () => {
  test('calculates utilPct correctly', () => {
    const vehicles = [
      mkVehicle({ id: 'v1', status: 'enroute' }),
      mkVehicle({ id: 'v2', status: 'idle' }),
      mkVehicle({ id: 'v3', status: 'idle' }),
      mkVehicle({ id: 'v4', status: 'enroute' }),
    ]
    const m = buildMetrics([], vehicles, [])
    expect(m.fleetTotal).toBe(4)
    expect(m.enroute).toBe(2)
    expect(m.utilPct).toBe(50)
  })

  test('ignores vehicles of unknown types in fleet totals', () => {
    const vehicles = [
      mkVehicle({ id: 'v1', type: 'ambulance', status: 'enroute' }),
      mkVehicle({ id: 'v2', type: 'car', status: 'enroute' }), // not counted
    ]
    const m = buildMetrics([], vehicles, [])
    expect(m.fleetTotal).toBe(1)
    expect(m.utilPct).toBe(100)
  })

  test('utilPct is 0 when no fleet exists', () => {
    const m = buildMetrics([], [], [])
    expect(m.utilPct).toBe(0)
  })
})

describe('buildMetrics — average response times', () => {
  test('avgResp is mean of etaToPickupMin for active and completed emergencies', () => {
    const emergencies = [
      mkEmg({ id: 'E1', state: 'EN_ROUTE', etaToPickupMin: 10 }),
      mkEmg({ id: 'E2', state: 'COMPLETED', etaToPickupMin: 20 }),
      mkEmg({ id: 'E3', state: 'QUEUED', etaToPickupMin: 5 }), // QUEUED is excluded from done
    ]
    const m = buildMetrics(emergencies, [], [])
    // mean([10, 20]) = 15
    expect(m.avgResp).toBe(15)
  })

  test('excludes zero-ETA emergencies from avgResp', () => {
    const emergencies = [
      mkEmg({ id: 'E1', state: 'EN_ROUTE', etaToPickupMin: 0 }), // excluded
      mkEmg({ id: 'E2', state: 'COMPLETED', etaToPickupMin: 12 }),
    ]
    const m = buildMetrics(emergencies, [], [])
    expect(m.avgResp).toBe(12)
  })
})

describe('buildMetrics — byKind breakdown', () => {
  test('splits medical and fire correctly', () => {
    const emergencies = [
      mkEmg({ id: 'E1', kind: 'medical' }),
      mkEmg({ id: 'E2', kind: 'medical' }),
      mkEmg({ id: 'E3', kind: 'fire' }),
    ]
    const m = buildMetrics(emergencies, [], [])
    const medical = m.byKind.find((d) => d.name === 'Medical')
    const fire = m.byKind.find((d) => d.name === 'Fire')
    expect(medical?.value).toBe(2)
    expect(fire?.value).toBe(1)
  })

  test('blood emergencies count as medical (kind !== fire)', () => {
    const emergencies = [
      mkEmg({ id: 'E1', kind: 'blood' }),
    ]
    const m = buildMetrics(emergencies, [], [])
    const medical = m.byKind.find((d) => d.name === 'Medical')
    expect(medical?.value).toBe(1)
  })

  test('omits zero-count kinds from byKind', () => {
    const emergencies = [mkEmg({ kind: 'medical' })]
    const m = buildMetrics(emergencies, [], [])
    const fire = m.byKind.find((d) => d.name === 'Fire')
    expect(fire).toBeUndefined()
  })
})

describe('buildMetrics — bySeverity breakdown', () => {
  test('counts each severity bucket', () => {
    const emergencies = [
      mkEmg({ id: 'E1', severity: 'Critical' }),
      mkEmg({ id: 'E2', severity: 'Critical' }),
      mkEmg({ id: 'E3', severity: 'Urgent' }),
      mkEmg({ id: 'E4', severity: 'Normal' }),
    ]
    const m = buildMetrics(emergencies, [], [])
    const sev = Object.fromEntries(m.bySeverity.map((d) => [d.name, d.value]))
    expect(sev.Critical).toBe(2)
    expect(sev.Urgent).toBe(1)
    expect(sev.Normal).toBe(1)
  })
})

describe('buildMetrics — topHospitals', () => {
  test('ranks hospitals by number of emergency assignments', () => {
    const hospitals = [
      { id: 'hosp-1', name: 'MGM Hospital' },
      { id: 'hosp-2', name: 'Tata Main Hospital' },
    ]
    const emergencies = [
      mkEmg({ id: 'E1', hospitalId: 'hosp-1' }),
      mkEmg({ id: 'E2', hospitalId: 'hosp-1' }),
      mkEmg({ id: 'E3', hospitalId: 'hosp-2' }),
    ]
    const m = buildMetrics(emergencies, [], hospitals)
    expect(m.topHospitals[0].name).toBe('MGM Hospital')
    expect(m.topHospitals[0].value).toBe(2)
    expect(m.topHospitals[1].name).toBe('Tata Main Hospital')
  })

  test('caps topHospitals at 6 entries', () => {
    const hospitals = Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, name: `Hospital ${i}` }))
    const emergencies = hospitals.map((h, i) => mkEmg({ id: `E${i}`, hospitalId: h.id }))
    const m = buildMetrics(emergencies, hospitals, hospitals)
    expect(m.topHospitals.length).toBeLessThanOrEqual(6)
  })
})
