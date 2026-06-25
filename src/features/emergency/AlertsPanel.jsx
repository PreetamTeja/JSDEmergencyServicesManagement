import React, { useMemo, useState } from 'react'
import { useFleetStore } from '../../store/useFleetStore'
import { useNow } from '../../hooks/useNow'
import { slaTargets, slaStatus, slaText, SLA_COLOR } from '../../services/sla'
import { pickupLabel } from '../../data/locations'

// Severity rank so a dismissed alert re-surfaces only if it gets WORSE.
const RANK = { warn: 1, breach: 2 }
const STORE_KEY = 'psiog_sla_ack' // { [emergencyId]: rankAtDismiss }

function loadAck() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch { return {} }
}
function saveAck(ack) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(ack)) } catch {}
}

// Live alerts: emergencies breaching (or about to breach) their response SLA, or
// stuck unassigned. Sorted worst-first. Acknowledged alerts are hidden until they
// escalate. Hidden entirely when nothing needs attention.
export default function AlertsPanel() {
  const emergencies = useFleetStore((s) => s.emergencies)
  const policy = useFleetStore((s) => s.policyConfig)
  const now = useNow(10000)
  const [ack, setAck] = useState(loadAck)

  const all = useMemo(() => {
    const targets = slaTargets(policy)
    return emergencies
      .filter((e) => ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED'].includes(e.state))
      .map((e) => ({ e, s: slaStatus(e, targets, now) }))
      .filter(({ s }) => s.state !== 'ok')
      .sort((a, b) => (a.s.state === b.s.state ? a.s.remainingMin - b.s.remainingMin
        : a.s.state === 'breach' ? -1 : 1))
  }, [emergencies, policy, now])

  // Show unless acknowledged at an equal/worse rank than current.
  const visible = all.filter(({ e, s }) => !(ack[e.id] >= RANK[s.state]))

  function dismiss(id, state) {
    const next = { ...ack, [id]: RANK[state] }
    setAck(next); saveAck(next)
  }
  function clearAll() {
    const next = { ...ack }
    visible.forEach(({ e, s }) => { next[e.id] = RANK[s.state] })
    setAck(next); saveAck(next)
  }

  if (!visible.length) return null
  const breaches = visible.filter((a) => a.s.state === 'breach').length

  return (
    <div className="mb-3 rounded-lg border border-status-danger/40 bg-status-danger/5 overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between bg-status-danger/10">
        <span className="text-[12px] font-semibold text-status-danger">⚠ SLA alerts · {visible.length}</span>
        <div className="flex items-center gap-2">
          {breaches > 0 && <span className="text-[11px] font-semibold text-white bg-status-danger rounded-full px-2 py-0.5">{breaches} breached</span>}
          <button onClick={clearAll} className="text-[11px] font-medium text-status-danger/80 hover:text-status-danger underline underline-offset-2">Clear all</button>
        </div>
      </div>
      <div className="divide-y divide-status-danger/15 max-h-48 overflow-auto">
        {visible.map(({ e, s }) => (
          <div key={e.id} className="px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-cmd-text truncate">
                {e.id} · {e.kind === 'fire' ? 'Fire' : e.kind === 'blood' ? 'Blood' : e.severity}
              </div>
              <div className="text-[11px] text-cmd-muted truncate">
                {s.kind === 'queue' ? 'Waiting for a unit' : 'En route to scene'} · {pickupLabel(e)}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: SLA_COLOR[s.state] }}>
                {slaText(s)}
              </span>
              <button onClick={() => dismiss(e.id, s.state)} title="Dismiss"
                className="h-5 w-5 grid place-items-center rounded text-cmd-muted hover:bg-status-danger/15 hover:text-status-danger">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
