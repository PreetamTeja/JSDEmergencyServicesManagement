import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SLA,
  QUEUE_SLA,
  SLA_COLOR,
  SLA_LABEL,
  slaTargets,
  slaStatus,
  slaText,
} from '../services/sla.js'

// ---- slaTargets ----
describe('slaTargets', () => {
  it('returns defaults when no policy provided', () => {
    expect(slaTargets()).toEqual({ Critical: 8, Urgent: 15, Normal: 30 })
  })

  it('returns defaults when policy has no sla_minutes', () => {
    expect(slaTargets({ someOtherKey: true })).toEqual(DEFAULT_SLA)
  })

  it('overrides individual fields from policy', () => {
    const result = slaTargets({ sla_minutes: { Critical: 5 } })
    expect(result.Critical).toBe(5)
    expect(result.Urgent).toBe(DEFAULT_SLA.Urgent)
    expect(result.Normal).toBe(DEFAULT_SLA.Normal)
  })

  it('handles full policy override', () => {
    const result = slaTargets({ sla_minutes: { Critical: 6, Urgent: 12, Normal: 25 } })
    expect(result).toEqual({ Critical: 6, Urgent: 12, Normal: 25 })
  })

  it('ignores non-object sla_minutes', () => {
    expect(slaTargets({ sla_minutes: 'string' })).toEqual(DEFAULT_SLA)
    expect(slaTargets({ sla_minutes: 42 })).toEqual(DEFAULT_SLA)
    expect(slaTargets({ sla_minutes: null })).toEqual(DEFAULT_SLA)
  })
})

// ---- SLA_COLOR and SLA_LABEL constants ----
describe('SLA_COLOR', () => {
  it('has ok, warn, breach keys', () => {
    expect(SLA_COLOR).toHaveProperty('ok')
    expect(SLA_COLOR).toHaveProperty('warn')
    expect(SLA_COLOR).toHaveProperty('breach')
  })
  it('ok is green', () => {
    expect(SLA_COLOR.ok).toMatch(/^#/)
  })
})

describe('SLA_LABEL', () => {
  it('has expected labels', () => {
    expect(SLA_LABEL.ok).toBe('On track')
    expect(SLA_LABEL.warn).toBe('At risk')
    expect(SLA_LABEL.breach).toBe('Breached')
  })
})

// ---- slaStatus: queue states ----
describe('slaStatus — queue states', () => {
  const targets = DEFAULT_SLA

  it('fresh QUEUED emergency is ok', () => {
    const em = { state: 'QUEUED', createdAt: new Date().toISOString() }
    const r = slaStatus(em, targets, Date.now())
    expect(r.kind).toBe('queue')
    expect(r.state).toBe('ok')
    expect(r.target).toBe(QUEUE_SLA)
    expect(r.elapsedMin).toBeCloseTo(0, 1)
  })

  it('QUEUED at 60% of target is warn', () => {
    const ago = Date.now() - QUEUE_SLA * 0.61 * 60000
    const em = { state: 'QUEUED', createdAt: new Date(ago).toISOString() }
    const r = slaStatus(em, targets, Date.now())
    expect(r.state).toBe('warn')
  })

  it('QUEUED past target is breach', () => {
    const ago = Date.now() - (QUEUE_SLA + 1) * 60000
    const em = { state: 'QUEUED', createdAt: new Date(ago).toISOString() }
    const r = slaStatus(em, targets, Date.now())
    expect(r.state).toBe('breach')
    expect(r.remainingMin).toBeLessThan(0)
  })

  it('NO_HOSPITAL is treated as queue', () => {
    const em = { state: 'NO_HOSPITAL', createdAt: new Date().toISOString() }
    const r = slaStatus(em, targets, Date.now())
    expect(r.kind).toBe('queue')
  })

  it('NO_BLOODBANK is treated as queue', () => {
    const em = { state: 'NO_BLOODBANK', createdAt: new Date().toISOString() }
    const r = slaStatus(em, targets, Date.now())
    expect(r.kind).toBe('queue')
  })

  it('PREEMPTED is treated as queue', () => {
    const em = { state: 'PREEMPTED', createdAt: new Date().toISOString() }
    const r = slaStatus(em, targets, Date.now())
    expect(r.kind).toBe('queue')
  })
})

// ---- slaStatus: EN_ROUTE states ----
describe('slaStatus — EN_ROUTE states', () => {
  const targets = DEFAULT_SLA

  it('Critical EN_ROUTE within time is ok', () => {
    const em = { state: 'EN_ROUTE', severity: 'Critical', createdAt: new Date().toISOString(), etaToPickupMin: 2 }
    const r = slaStatus(em, targets, Date.now())
    expect(r.kind).toBe('scene')
    expect(r.state).toBe('ok')
    expect(r.target).toBe(DEFAULT_SLA.Critical)
  })

  it('Critical EN_ROUTE with etaToPickupMin > target is warn', () => {
    const em = { state: 'EN_ROUTE', severity: 'Critical', createdAt: new Date().toISOString(), etaToPickupMin: 20 }
    const r = slaStatus(em, targets, Date.now())
    expect(r.state).toBe('warn')
  })

  it('EN_ROUTE past target time is breach', () => {
    const ago = Date.now() - (DEFAULT_SLA.Urgent + 1) * 60000
    const em = { state: 'EN_ROUTE', severity: 'Urgent', createdAt: new Date(ago).toISOString(), etaToPickupMin: 0 }
    const r = slaStatus(em, targets, Date.now())
    expect(r.state).toBe('breach')
  })

  it('EN_ROUTE within last 25% of target is warn even if eta ok', () => {
    const target = DEFAULT_SLA.Normal // 30 min
    // Place 8 minutes in, meaning only 22 left — but within 25% threshold that is 7.5 min remaining
    const ago = Date.now() - (target * 0.76) * 60000 // 22.8 min elapsed, 7.2 remaining, < 25% of 30 = 7.5
    const em = { state: 'EN_ROUTE', severity: 'Normal', createdAt: new Date(ago).toISOString(), etaToPickupMin: 1 }
    const r = slaStatus(em, targets, Date.now())
    expect(r.state).toBe('warn')
  })

  it('unknown severity falls back to Urgent default', () => {
    const em = { state: 'EN_ROUTE', severity: 'Unknown', createdAt: new Date().toISOString(), etaToPickupMin: 0 }
    const r = slaStatus(em, targets, Date.now())
    expect(r.target).toBe(DEFAULT_SLA.Urgent)
  })

  it('missing createdAt uses nowMs as baseline', () => {
    const em = { state: 'EN_ROUTE', severity: 'Normal' }
    const r = slaStatus(em, targets, Date.now())
    expect(r.elapsedMin).toBeCloseTo(0, 1)
    expect(r.state).toBe('ok')
  })
})

// ---- slaStatus: completed / other states ----
describe('slaStatus — completed/other', () => {
  it('returns kind=none and state=ok for non-emergency states', () => {
    const em = { state: 'COMPLETED', severity: 'Critical', createdAt: new Date().toISOString() }
    const r = slaStatus(em, DEFAULT_SLA, Date.now())
    expect(r.kind).toBe('none')
    expect(r.state).toBe('ok')
  })
})

// ---- slaText ----
describe('slaText', () => {
  it('returns empty string for kind=none', () => {
    expect(slaText({ kind: 'none', state: 'ok', remainingMin: 5 })).toBe('')
  })

  it('returns OVERDUE for breach', () => {
    const text = slaText({ kind: 'queue', state: 'breach', remainingMin: -3.2 })
    expect(text).toBe('OVERDUE +4m')
  })

  it('returns Xm left for ok', () => {
    const text = slaText({ kind: 'scene', state: 'ok', remainingMin: 7.8 })
    expect(text).toBe('7m left')
  })

  it('returns 0m left when remainingMin is between 0 and 1', () => {
    const text = slaText({ kind: 'queue', state: 'warn', remainingMin: 0.3 })
    expect(text).toBe('0m left')
  })

  it('breach: rounds overdue minutes up with Math.ceil', () => {
    expect(slaText({ kind: 'scene', state: 'breach', remainingMin: -1.1 })).toBe('OVERDUE +2m')
    expect(slaText({ kind: 'scene', state: 'breach', remainingMin: -1.0 })).toBe('OVERDUE +1m')
  })
})
