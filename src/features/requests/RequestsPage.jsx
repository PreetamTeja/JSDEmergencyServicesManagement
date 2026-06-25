import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, pickupLabel } from '../../data/locations'
import { hospitalById, SEVERITY_META } from '../../data/hospitals'
import PageHeader from '../../components/common/PageHeader'
import { Modal } from '../../components/common/ui.jsx'
import LiveEta from '../../components/common/LiveEta'
import { useNow } from '../../hooks/useNow'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'queued', label: 'Queued' },
  { key: 'completed', label: 'Completed' },
  { key: 'fire', label: 'Fire' },
  { key: 'medical', label: 'Medical' },
]
const ATTENTION = ['QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED']
const NO_FACILITY = ['NO_HOSPITAL', 'NO_BLOODBANK']
const FINISHED = ['COMPLETED', 'CANCELLED']
const TODAY = new Date().toISOString().slice(0, 10)

// Clean line-icon set (no emojis).
const ICONS = {
  activity: '<path d="M3 12h4l2 6 4-12 2 6h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
  medical: '<path d="M12 5v14M5 12h14"/>',
  droplet: '<path d="M12 3c3 4 6 7 6 10a6 6 0 1 1-12 0c0-3 3-6 6-10Z"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.5"/>',
}
function Icon({ name, size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />
}

// Trip progress 0..1 — fills dispatch -> en route -> arrived, live by the ETA clock.
function progressOf(e, now) {
  if (e.state === 'COMPLETED') return 1
  if (ATTENTION.includes(e.state)) return 0.06
  if (e.state === 'CANCELLED') return 0
  if (e.state === 'EN_ROUTE') {
    const totalMin = e.totalEtaMin || e.etaToPickupMin || 0
    if (e.etaComplete && totalMin > 0) {
      const end = e.etaComplete * 1000
      const start = end - totalMin * 60000
      return Math.min(0.98, Math.max(0.06, (now - start) / (end - start)))
    }
    return 0.5
  }
  return 0
}
function stageLabel(e) {
  if (e.state === 'COMPLETED') return 'Arrived'
  if (e.state === 'EN_ROUTE') return 'En route'
  if (e.state === 'CANCELLED') return 'Cancelled'
  if (ATTENTION.includes(e.state)) return 'Finding unit'
  return 'Requested'
}

export default function DispatchBoard() {
  const emergencies = useFleetStore((s) => s.emergencies)
  const vehicles = useFleetStore((s) => s.vehicles)
  const cancelRequest = useFleetStore((s) => s.cancelRequest)
  const now = useNow(3000)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [override, setOverride] = useState(null)
  const [menuId, setMenuId] = useState(null)
  const [showCleared, setShowCleared] = useState(false)
  const [cleared, setCleared] = useState(() => new Set(JSON.parse(localStorage.getItem('psiog_db_cleared') || '[]')))
  const persistCleared = (set) => { localStorage.setItem('psiog_db_cleared', JSON.stringify([...set])); setCleared(new Set(set)) }

  const [bulkBusy, setBulkBusy] = useState(false)
  const clearableNow = emergencies.filter((e) => FINISHED.includes(e.state) && !cleared.has(e.id))
  const noFacility = emergencies.filter((e) => NO_FACILITY.includes(e.state) && !cleared.has(e.id))
  function clearCompleted() { const n = new Set(cleared); clearableNow.forEach((e) => n.add(e.id)); persistCleared(n) }
  function restoreCleared() { persistCleared(new Set()) }
  // Cancel every "no facility" incident (frees their unit) and hide them in one click.
  async function clearNoFacility() {
    if (!noFacility.length) return
    setBulkBusy(true)
    for (const e of noFacility) { try { await cancelRequest(e.id) } catch {} }
    const n = new Set(cleared); noFacility.forEach((e) => n.add(e.id)); persistCleared(n)
    setBulkBusy(false)
  }

  const visible = useMemo(
    () => emergencies.filter((e) => showCleared || !cleared.has(e.id)),
    [emergencies, cleared, showCleared])

  const kpis = useMemo(() => {
    const live = visible.filter((e) => e.state === 'EN_ROUTE' || ATTENTION.includes(e.state))
    return {
      active: visible.filter((e) => e.state === 'EN_ROUTE').length,
      queued: visible.filter((e) => ATTENTION.includes(e.state)).length,
      completedToday: visible.filter((e) => e.state === 'COMPLETED' && (e.createdAt || '').startsWith(TODAY)).length,
      fire: live.filter((e) => e.kind === 'fire').length,
      medical: live.filter((e) => e.kind !== 'fire' && e.kind !== 'blood').length,
    }
  }, [visible])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const match = (e) => (filter === 'all'
      || (filter === 'active' && e.state === 'EN_ROUTE')
      || (filter === 'queued' && ATTENTION.includes(e.state))
      || (filter === 'completed' && e.state === 'COMPLETED')
      || (filter === 'fire' && e.kind === 'fire')
      || (filter === 'medical' && e.kind !== 'fire' && e.kind !== 'blood'))
    const search = (e) => {
      if (!term) return true
      const veh = vehicles.find((v) => v.id === e.ambulanceId)
      const hay = [e.id, e.incidentId, e.caseType, e.severity, e.state, pickupLabel(e), veh?.reg, hospitalById(e.hospitalId)?.name]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(term)
    }
    return [...visible].filter((e) => match(e) && search(e))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [visible, vehicles, filter, q])

  async function onCancel(id) { setMenuId(null); setBusy(id); try { await cancelRequest(id) } finally { setBusy(null) } }

  const chip = (active) => `px-3 py-1 text-[12px] border transition-colors ${
    active ? 'bg-accent text-white border-accent' : 'bg-white border-slate-200 text-cmd-text hover:bg-slate-50'}`

  return (
    <div className="flex flex-col h-full bg-cmd-bg">
      <PageHeader title="Dispatch Board" subtitle="Every ambulance & fire dispatch · live, queued and historical">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, location, unit, hospital…"
          className="bg-white border border-slate-200 px-3 py-1.5 text-[13px] w-72" />
      </PageHeader>

      {/* Filters + clear controls */}
      <div className="px-6 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={chip(filter === f.key)}>
              <span className="inline-flex items-center gap-1">
                {f.key === 'fire' && <Icon name="flame" size={13} />}
                {f.key === 'medical' && <Icon name="medical" size={13} />}
                {f.label}
              </span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-cmd-muted cursor-pointer">
              <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} /> Show cleared ({cleared.size})
            </label>
            {noFacility.length > 0 && (
              <button onClick={clearNoFacility} disabled={bulkBusy}
                className="px-3 py-1 text-[12px] border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-40 inline-flex items-center gap-1">
                <Icon name="alert" size={13} />{bulkBusy ? 'Clearing…' : `Clear no-facility (${noFacility.length})`}
              </button>
            )}
            <button onClick={restoreCleared} className="px-3 py-1 text-[12px] border border-slate-200 bg-white hover:bg-slate-50">Restore</button>
            <button onClick={clearCompleted} disabled={clearableNow.length === 0}
              className="px-3 py-1 text-[12px] border border-slate-200 bg-white text-status-danger hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1">
              <Icon name="trash" size={13} />Clear completed{clearableNow.length ? ` (${clearableNow.length})` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="px-6 pt-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi value={kpis.active} label="Active" color="#16a34a" icon="activity" />
          <Kpi value={kpis.queued} label="Queued" color="#d97706" icon="clock" />
          <Kpi value={kpis.completedToday} label="Completed today" color="#4f46e5" icon="check" />
          <Kpi value={kpis.fire} label="Fire incidents" color="#dc2626" icon="flame" />
          <Kpi value={kpis.medical} label="Medical incidents" color="#2563eb" icon="medical" />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-cmd-muted text-[11px] uppercase tracking-wide border-b border-slate-200">
                {['ID', 'Type', 'Severity', 'Pickup', 'Unit', 'Destination', 'Progress', 'ETA', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-cmd-muted">No responses match.</td></tr>
              )}
              {rows.map((e) => {
                const isFire = e.kind === 'fire'
                const isBlood = e.kind === 'blood'
                const veh = vehicles.find((v) => v.id === e.ambulanceId)
                const hosp = hospitalById(e.hospitalId)
                const sev = SEVERITY_META[e.severity]
                const t = new Date(e.createdAt)
                const time = isNaN(t) ? '' : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                return (
                  <tr key={e.id} className="hover:bg-slate-50 align-middle">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-cmd-text flex items-center gap-1.5">
                        {e.id}
                        {e.incidentId && <span className="text-[10px] px-1 py-0.5 bg-red-50 text-red-600">MCI</span>}
                        {e.patientsCount > 1 && <span className="text-[10px] px-1 py-0.5 bg-indigo-50 text-indigo-600">{e.patientsCount}p</span>}
                      </div>
                      <div className="text-[11px] text-cmd-muted mt-0.5">Today, {time}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 text-[12px] font-medium inline-flex items-center gap-1"
                        style={{ background: isFire ? '#fff1e8' : isBlood ? '#fee2e2' : '#e8eefb', color: isFire ? '#ea580c' : isBlood ? '#b91c1c' : '#2563eb' }}>
                        <Icon name={isFire ? 'flame' : isBlood ? 'droplet' : 'medical'} size={13} />
                        {isFire ? 'Fire' : isBlood ? 'Blood' : 'Medical'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 text-cmd-text"><span className="h-2 w-2" style={{ background: sev?.color }} />{e.severity}</span></td>
                    <td className="px-4 py-3 text-cmd-text">{pickupLabel(e)}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-cmd-text">{veh?.reg || '—'}</td>
                    <td className="px-4 py-3 text-cmd-text">{isFire ? '—' : (hosp?.name || '—')}</td>
                    <td className="px-4 py-3 w-44"><ProgressBar e={e} now={now} /></td>
                    <td className="px-4 py-3 text-cmd-text">{e.state === 'EN_ROUTE' ? <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} /> : '—'}</td>
                    <td className="px-4 py-3"><StatusChip state={e.state} /></td>
                    <td className="px-4 py-3 relative">
                      <button onClick={() => setMenuId(menuId === e.id ? null : e.id)}
                        className="h-7 w-7 grid place-items-center text-cmd-muted hover:bg-slate-100">⋮</button>
                      {menuId === e.id && (
                        <RowMenu e={e} busy={busy === e.id}
                          onOverride={() => { setMenuId(null); setOverride(e) }}
                          onCancel={() => onCancel(e.id)} onClose={() => setMenuId(null)} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[12px] text-cmd-muted mt-3">Showing {rows.length} {filter === 'all' ? '' : filter + ' '}responses</div>
      </div>

      {override && <OverrideModal em={override} onClose={() => setOverride(null)} />}
    </div>
  )
}

function Kpi({ value, label, color, icon }) {
  return (
    <div className="bg-white border border-slate-200 px-4 py-3 flex items-center gap-3">
      <div className="h-9 w-9 grid place-items-center" style={{ background: `${color}1a`, color }}><Icon name={icon} size={18} /></div>
      <div>
        <div className="text-2xl font-bold leading-none" style={{ color }}>{value}</div>
        <div className="text-[11px] text-cmd-muted mt-1 flex items-center gap-1"><span className="h-1.5 w-1.5" style={{ background: color }} />{label}</div>
      </div>
    </div>
  )
}

function ProgressBar({ e, now }) {
  const isFire = e.kind === 'fire'
  const pct = Math.round(progressOf(e, now) * 100)
  const done = e.state === 'COMPLETED'
  const cancelled = e.state === 'CANCELLED'
  const queued = ATTENTION.includes(e.state)
  const color = cancelled ? '#94a3b8' : done ? '#16a34a' : queued ? '#d97706' : (isFire ? '#ea580c' : '#07514D')
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium" style={{ color }}>{stageLabel(e)}</span>
        {!cancelled && <span className="text-[11px] text-cmd-muted">{pct}%</span>}
      </div>
      <div className="h-1.5 bg-slate-200 overflow-hidden">
        <div className={`h-full transition-all duration-700 ease-out ${queued ? 'animate-pulse' : ''}`}
          style={{ width: `${cancelled ? 0 : pct}%`, background: color }} />
      </div>
    </div>
  )
}

function RowMenu({ e, busy, onOverride, onCancel, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (ev) => { if (ref.current && !ref.current.contains(ev.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  const enroute = e.state === 'EN_ROUTE'
  return (
    <div ref={ref} className="absolute right-4 top-10 z-20 w-40 bg-white border border-slate-200 shadow-card text-[13px]">
      {enroute ? (
        <>
          <button onClick={onOverride} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-accent">Override unit</button>
          <button onClick={onCancel} disabled={busy} className="w-full text-left px-3 py-2 hover:bg-red-50 text-status-danger disabled:opacity-50">{busy ? 'Cancelling…' : 'Cancel'}</button>
        </>
      ) : (
        <div className="px-3 py-2 text-cmd-muted">No actions</div>
      )}
    </div>
  )
}

function OverrideModal({ em, onClose }) {
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const reassignEmergency = useFleetStore((s) => s.reassignEmergency)
  const isFire = em.kind === 'fire'
  const type = isFire ? 'firetruck' : 'ambulance'
  const free = vehicles.filter((v) => v.type === type && (v.status === 'idle' || v.id === em.ambulanceId))
  const [vehicleId, setVehicleId] = useState(em.ambulanceId || '')
  const [hospitalId, setHospitalId] = useState(em.hospitalId || '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function submit() {
    setBusy(true)
    const payload = {}
    if (vehicleId && vehicleId !== em.ambulanceId) payload.vehicleId = vehicleId
    if (!isFire && hospitalId && hospitalId !== em.hospitalId) payload.hospitalId = hospitalId
    if (!payload.vehicleId && !payload.hospitalId) { setBusy(false); setResult({ ok: false, reason: 'Nothing changed' }); return }
    const r = await reassignEmergency(em.id, payload)
    setBusy(false); setResult(r)
    if (r.ok) setTimeout(onClose, 1000)
  }

  return (
    <Modal open title={`Override ${em.id}`} onClose={onClose}>
      <p className="text-xs text-cmd-muted mb-3">Manually reassign the {isFire ? 'fire truck' : 'ambulance'}{!isFire && ' or destination hospital'}. The previous unit is freed.</p>
      <div className="space-y-3 text-sm">
        <Field label={isFire ? 'Fire truck' : 'Ambulance'}>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="bg-white border border-slate-200 px-3 py-1.5 w-full">
            {free.length === 0 && <option value="">No free units</option>}
            {free.map((v) => <option key={v.id} value={v.id}>{v.reg}{v.id === em.ambulanceId ? ' (current)' : ' · idle'}</option>)}
          </select>
        </Field>
        {!isFire && (
          <Field label="Hospital">
            <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)} className="bg-white border border-slate-200 px-3 py-1.5 w-full">
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}{h.id === em.hospitalId ? ' (current)' : ''}</option>)}
            </select>
          </Field>
        )}
        {result && <div className={`p-2.5 text-xs ${result.ok ? 'text-status-enroute' : 'text-status-danger'}`}>{result.ok ? 'Reassigned.' : result.reason}</div>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-primary disabled:opacity-50" disabled={busy} onClick={submit}>{busy ? 'Reassigning…' : 'Apply override'}</button>
      </div>
    </Modal>
  )
}

const Field = ({ label, children }) => <div><div className="label mb-1">{label}</div>{children}</div>

function StatusChip({ state }) {
  const map = {
    EN_ROUTE: ['#16a34a', 'En route'], COMPLETED: ['#64748b', 'Completed'],
    QUEUED: ['#d97706', 'Queued'], PREEMPTED: ['#dc2626', 'Preempted'],
    NO_HOSPITAL: ['#dc2626', 'No facility'], NO_BLOODBANK: ['#dc2626', 'No blood bank'],
    CANCELLED: ['#94a3b8', 'Cancelled'],
  }
  const [c, t] = map[state] || ['#64748b', state]
  return <span className="px-2 py-0.5 text-[12px] font-medium" style={{ background: `${c}1a`, color: c }}>{t}</span>
}
