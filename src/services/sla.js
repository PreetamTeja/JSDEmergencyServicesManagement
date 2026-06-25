// Response-time SLA evaluation for emergencies.
//
// Targets are minutes from when an emergency is CREATED to when a unit should be
// on scene, by severity. Defaults can be overridden by the active policy
// (policyConfig.sla_minutes), so the policy-sync agent can tune them later.

export const DEFAULT_SLA = { Critical: 8, Urgent: 15, Normal: 30 }
// Any unassigned emergency (no unit free) is a problem fast, regardless of severity.
export const QUEUE_SLA = 5

export function slaTargets(policy) {
  const p = policy?.sla_minutes
  return { ...DEFAULT_SLA, ...(p && typeof p === 'object' ? p : {}) }
}

export const SLA_COLOR = { ok: '#16a34a', warn: '#d97706', breach: '#dc2626' }
export const SLA_LABEL = { ok: 'On track', warn: 'At risk', breach: 'Breached' }

// Evaluate one emergency. Returns:
//   { state: 'ok'|'warn'|'breach', target, elapsedMin, remainingMin, kind }
//   kind: 'queue' (waiting for a unit) | 'scene' (en route to scene) | 'none'
export function slaStatus(em, targets, nowMs = Date.now()) {
  const created = em.createdAt ? new Date(em.createdAt).getTime() : nowMs
  const elapsedMin = Math.max(0, (nowMs - created) / 60000)

  // Unassigned states: under pressure against a short queue SLA.
  if (['QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED'].includes(em.state)) {
    const target = QUEUE_SLA
    const remainingMin = target - elapsedMin
    const state = remainingMin < 0 ? 'breach' : remainingMin <= target * 0.4 ? 'warn' : 'ok'
    return { state, target, elapsedMin, remainingMin, kind: 'queue' }
  }

  // En route: race the severity target. Overdue = breach; predicted-late or close = warn.
  if (em.state === 'EN_ROUTE') {
    const target = targets[em.severity] ?? DEFAULT_SLA.Urgent
    const remainingMin = target - elapsedMin
    const willBeLate = (em.etaToPickupMin || 0) > target
    const state = remainingMin < 0 ? 'breach'
      : (willBeLate || remainingMin <= target * 0.25) ? 'warn' : 'ok'
    return { state, target, elapsedMin, remainingMin, kind: 'scene' }
  }

  return { state: 'ok', target: 0, elapsedMin, remainingMin: 0, kind: 'none' }
}

// Short human label, e.g. "2m left", "OVERDUE +3m".
export function slaText(s) {
  if (s.kind === 'none') return ''
  if (s.state === 'breach') return `OVERDUE +${Math.ceil(-s.remainingMin)}m`
  return `${Math.max(0, Math.floor(s.remainingMin))}m left`
}
