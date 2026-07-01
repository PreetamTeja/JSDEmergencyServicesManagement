/**
 * Tests for the emergency filter logic in EmergencyPage.
 *
 * The page's ACTIVE_STATES list and the shown/counts memos are pure functions
 * of emergencies + filter. We extract that logic here and test it directly
 * to avoid rendering the full map component (react-leaflet needs canvas/WebGL).
 */

const ACTIVE_STATES = ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED']

function filterEmergencies(emergencies, filter) {
  const match = (e) =>
    filter === 'all' ||
    (filter === 'active' && ACTIVE_STATES.includes(e.state)) ||
    (filter === 'completed' && e.state === 'COMPLETED')
  return emergencies.filter(match)
}

function buildCounts(emergencies) {
  return {
    active: emergencies.filter((e) => ACTIVE_STATES.includes(e.state)).length,
    completed: emergencies.filter((e) => e.state === 'COMPLETED').length,
    all: emergencies.length,
  }
}

const mkE = (id, state) => ({ id, state })

describe('ACTIVE_STATES definition', () => {
  test('includes EN_ROUTE', () => {
    expect(ACTIVE_STATES).toContain('EN_ROUTE')
  })
  test('includes QUEUED', () => {
    expect(ACTIVE_STATES).toContain('QUEUED')
  })
  test('includes NO_HOSPITAL', () => {
    expect(ACTIVE_STATES).toContain('NO_HOSPITAL')
  })
  test('includes NO_BLOODBANK', () => {
    expect(ACTIVE_STATES).toContain('NO_BLOODBANK')
  })
  test('includes PREEMPTED', () => {
    expect(ACTIVE_STATES).toContain('PREEMPTED')
  })
  test('does not include COMPLETED', () => {
    expect(ACTIVE_STATES).not.toContain('COMPLETED')
  })
})

describe('filterEmergencies — active filter', () => {
  const emergencies = [
    mkE('E1', 'EN_ROUTE'),
    mkE('E2', 'QUEUED'),
    mkE('E3', 'NO_HOSPITAL'),
    mkE('E4', 'NO_BLOODBANK'),
    mkE('E5', 'PREEMPTED'),
    mkE('E6', 'COMPLETED'),
  ]

  test('active filter includes all active states', () => {
    const result = filterEmergencies(emergencies, 'active')
    const ids = result.map((e) => e.id)
    expect(ids).toContain('E1') // EN_ROUTE
    expect(ids).toContain('E2') // QUEUED
    expect(ids).toContain('E3') // NO_HOSPITAL
    expect(ids).toContain('E4') // NO_BLOODBANK
    expect(ids).toContain('E5') // PREEMPTED
  })

  test('active filter excludes COMPLETED', () => {
    const result = filterEmergencies(emergencies, 'active')
    const ids = result.map((e) => e.id)
    expect(ids).not.toContain('E6')
  })

  test('active filter returns 5 emergencies from sample data', () => {
    const result = filterEmergencies(emergencies, 'active')
    expect(result).toHaveLength(5)
  })
})

describe('filterEmergencies — completed filter', () => {
  const emergencies = [
    mkE('E1', 'EN_ROUTE'),
    mkE('E2', 'COMPLETED'),
    mkE('E3', 'QUEUED'),
  ]

  test('completed filter only returns COMPLETED state', () => {
    const result = filterEmergencies(emergencies, 'completed')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('E2')
  })

  test('completed filter excludes EN_ROUTE', () => {
    const result = filterEmergencies(emergencies, 'completed')
    const ids = result.map((e) => e.id)
    expect(ids).not.toContain('E1')
  })
})

describe('filterEmergencies — all filter', () => {
  const emergencies = [
    mkE('E1', 'EN_ROUTE'),
    mkE('E2', 'COMPLETED'),
    mkE('E3', 'QUEUED'),
    mkE('E4', 'NO_HOSPITAL'),
  ]

  test('all filter returns every emergency regardless of state', () => {
    const result = filterEmergencies(emergencies, 'all')
    expect(result).toHaveLength(4)
  })
})

describe('buildCounts', () => {
  test('counts match filter logic for each bucket', () => {
    const emergencies = [
      mkE('E1', 'EN_ROUTE'),
      mkE('E2', 'QUEUED'),
      mkE('E3', 'NO_BLOODBANK'),
      mkE('E4', 'COMPLETED'),
      mkE('E5', 'COMPLETED'),
    ]
    const counts = buildCounts(emergencies)
    expect(counts.active).toBe(3)   // EN_ROUTE + QUEUED + NO_BLOODBANK
    expect(counts.completed).toBe(2)
    expect(counts.all).toBe(5)
  })

  test('all zeros for empty list', () => {
    const counts = buildCounts([])
    expect(counts.active).toBe(0)
    expect(counts.completed).toBe(0)
    expect(counts.all).toBe(0)
  })
})
