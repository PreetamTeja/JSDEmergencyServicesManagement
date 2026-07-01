import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, pickupLabel } from '../../data/locations'
import { hospitalById, SEVERITY_META } from '../../data/hospitals'
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
  const cleared = useFleetStore((s) => s.clearedIds)
  const setClearedIds = useFleetStore((s) => s.setClearedIds)
  const persistCleared = (set) => setClearedIds(set)

  const [bulkBusy, setBulkBusy] = useState(false)
  const clearableNow = emergencies.filter((e) => FINISHED.includes(e.state) && !cleared.has(e.id))
  const noFacility = emergencies.filter((e) => NO_FACILITY.includes(e.state) && !cleared.has(e.id))
  function clearCompleted() { const n = new Set(cleared); clearableNow.forEach((e) => n.add(e.id)); persistCleared(n) }
  function restoreCleared() { persistCleared(new Set()) }
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

  return (
    <div className="flex flex-col h-full" style={{ background: '#E8E8EE' }}>

      {/* ── Page header ── */}
      <div className="px-6 pt-6 pb-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-[#0C1322]">Dispatch Board</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Every ambulance & fire dispatch · live, queued, historical</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, location, unit…"
              className="pl-9 pr-4 py-2 rounded-xl text-[13px] text-[#0C1322] w-64"
              style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)' }} />
          </div>
        </div>
      </div>

      {/* ── KPI strip (neomorphic) ── */}
      <div className="px-6 pb-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { value: kpis.active, label: 'Active', color: '#16a34a', icon: 'activity' },
          { value: kpis.queued, label: 'Queued', color: '#d97706', icon: 'clock' },
          { value: kpis.completedToday, label: 'Completed today', color: '#4f46e5', icon: 'check' },
          { value: kpis.fire, label: 'Fire incidents', color: '#dc2626', icon: 'flame' },
          { value: kpis.medical, label: 'Medical', color: '#2563eb', icon: 'medical' },
        ].map((k) => (
          <div key={k.label} className="px-4 py-3.5 flex items-center gap-3"
            style={{ background: '#fff', borderRadius: '16px' }}>
            <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${k.color}15`, color: k.color }}>
              <Icon name={k.icon} size={17} />
            </div>
            <div>
              <div className="text-[24px] font-bold leading-none" style={{ color: k.color }}>{k.value}</div>
              <div className="text-[11px] text-[#9CA3AF] mt-0.5 leading-tight">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters + board controls ── */}
      <div className="px-6 pb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => {
            const isActive = filter === f.key
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all flex items-center gap-1.5"
                style={isActive
                  ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 8px rgba(7,81,77,0.25)' }
                  : { background: 'rgba(255,255,255,0.85)', color: '#6B7280' }}>
                {f.key === 'fire' && <Icon name="flame" size={12} />}
                {f.key === 'medical' && <Icon name="medical" size={12} />}
                {f.label}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] cursor-pointer">
            <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} className="rounded" />
            Show cleared ({cleared.size})
          </label>
          {noFacility.length > 0 && (
            <button onClick={clearNoFacility} disabled={bulkBusy}
              className="px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
              style={{ background: 'rgba(217,119,6,0.1)', color: '#d97706' }}>
              <Icon name="alert" size={12} />{bulkBusy ? 'Clearing…' : `No-facility (${noFacility.length})`}
            </button>
          )}
          <button onClick={restoreCleared}
            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all"
            style={{ background: 'rgba(255,255,255,0.85)', color: '#6B7280' }}>
            Restore
          </button>
          <button onClick={clearCompleted} disabled={clearableNow.length === 0}
            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
            style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
            <Icon name="trash" size={12} />Clear{clearableNow.length ? ` (${clearableNow.length})` : ''}
          </button>
        </div>
      </div>

      {/* ── Dense table ── */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="overflow-hidden" style={{ background: 'rgba(255,255,255,0.92)', borderRadius: '20px', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                {['ID / Time', 'Type', 'Severity', 'Pickup', 'Unit', 'Destination', 'Progress', 'ETA', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-3"
                    style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: '#9CA3AF', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px]" style={{ color: '#9CA3AF' }}>No responses match this filter.</td></tr>
              )}
              {rows.map((e) => {
                const isFire = e.kind === 'fire'
                const isBlood = e.kind === 'blood'
                const veh = vehicles.find((v) => v.id === e.ambulanceId)
                const hosp = hospitalById(e.hospitalId)
                const sev = SEVERITY_META[e.severity]
                const t = new Date(e.createdAt)
                const time = isNaN(t) ? '' : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                const typeColor = isFire ? '#ea580c' : isBlood ? '#b91c1c' : '#2563eb'
                return (
                  <tr key={e.id} className="align-middle group" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
                    onMouseEnter={ev => ev.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
                    onMouseLeave={ev => ev.currentTarget.style.boxShadow = ''}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#0C1322] flex items-center gap-1.5">
                        {e.id}
                        {e.incidentId && <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold" style={{ background: '#fee2e2', color: '#dc2626' }}>MCI</span>}
                        {e.patientsCount > 1 && !isBlood && <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold" style={{ background: '#eef2ff', color: '#4338ca' }}>{e.patientsCount}p</span>}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: '#9CA3AF' }}>{time}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5"
                        style={{ background: `${typeColor}12`, color: typeColor }}>
                        <Icon name={isFire ? 'flame' : isBlood ? 'droplet' : 'medical'} size={12} />
                        {isFire ? 'Fire' : isBlood ? 'Blood' : 'Medical'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: sev?.color || '#6B7280' }}>
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: sev?.color }} />
                        {e.severity}
                        {e.caseType && !isFire && !isBlood && <span className="font-normal text-[#9CA3AF] text-[12px]">· {e.caseType}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#374151] max-w-[140px] truncate">{pickupLabel(e)}</td>
                    <td className="px-4 py-3">
                      {veh ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-6 w-6 rounded-lg grid place-items-center" style={{ background: `${typeColor}12` }}>
                            <Icon name={isFire ? 'flame' : isBlood ? 'droplet' : 'medical'} size={11} />
                          </span>
                          <span className="font-mono text-[12px] font-semibold text-[#0C1322]">{veh.reg}</span>
                        </span>
                      ) : <span className="text-[#9CA3AF]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#374151] max-w-[150px] truncate">{isFire ? '—' : (hosp?.name || '—')}</td>
                    <td className="px-4 py-3 w-44"><ProgressBar e={e} now={now} /></td>
                    <td className="px-4 py-3 font-semibold text-[13px]" style={{ color: '#07514D' }}>
                      {e.state === 'EN_ROUTE' ? <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} /> : <span className="text-[#9CA3AF] font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusChip state={e.state} /></td>
                    <td className="px-4 py-3 relative">
                      <button onClick={() => setMenuId(menuId === e.id ? null : e.id)}
                        className="h-7 w-7 rounded-lg grid place-items-center text-[#9CA3AF] transition-colors"
                        onMouseEnter={ev => ev.currentTarget.style.background = '#E8E8EE'}
                        onMouseLeave={ev => ev.currentTarget.style.background = ''}>⋮</button>
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
        <div className="text-[12px] mt-3 px-1" style={{ color: '#9CA3AF' }}>Showing {rows.length} {filter !== 'all' ? filter + ' ' : ''}responses</div>
      </div>

      {override && <OverrideModal em={override} onClose={() => setOverride(null)} />}
    </div>
  )
}

function ProgressBar({ e, now }) {
  const isFire = e.kind === 'fire'
  const pct = Math.round(progressOf(e, now) * 100)
  const done = e.state === 'COMPLETED'
  const cancelled = e.state === 'CANCELLED'
  const queued = ATTENTION.includes(e.state)
  const color = cancelled ? '#CBD5E1' : done ? '#16a34a' : queued ? '#d97706' : (isFire ? '#ea580c' : '#07514D')
  return (
    <div className="min-w-[130px]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold" style={{ color }}>{stageLabel(e)}</span>
        {!cancelled && <span className="text-[11px]" style={{ color: '#9CA3AF' }}>{pct}%</span>}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${queued ? 'animate-pulse' : ''}`}
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
    <div ref={ref} className="absolute right-4 top-10 z-20 w-44 text-[13px] overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.97)', borderRadius: '14px', boxShadow: '0 8px 32px rgba(0,0,0,0.14)', border: '1px solid rgba(0,0,0,0.06)' }}>
      {enroute ? (
        <>
          <button onClick={onOverride} className="w-full text-left px-4 py-2.5 font-medium transition-colors"
            style={{ color: '#07514D' }}
            onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.05)'}
            onMouseLeave={ev => ev.currentTarget.style.background = ''}>Override unit</button>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />
          <button onClick={onCancel} disabled={busy} className="w-full text-left px-4 py-2.5 font-medium transition-colors disabled:opacity-50"
            style={{ color: '#dc2626' }}
            onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(220,38,38,0.05)'}
            onMouseLeave={ev => ev.currentTarget.style.background = ''}>
            {busy ? 'Cancelling…' : 'Cancel dispatch'}
          </button>
        </>
      ) : (
        <div className="px-4 py-2.5 text-[#9CA3AF]">No actions available</div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-[380px] rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}
        onClick={ev => ev.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div>
            <div className="text-[15px] font-bold text-[#0C1322]">Override {em.id}</div>
            <div className="text-[11px] text-[#6B7280]">Manually reassign unit{!isFire && ' or hospital'}. Previous unit is freed.</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-xl grid place-items-center text-[#9CA3AF]"
            onMouseEnter={e => e.currentTarget.style.background = '#E8E8EE'}
            onMouseLeave={e => e.currentTarget.style.background = ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] mb-1.5">{isFire ? 'Fire truck' : 'Ambulance'}</div>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[13px] text-[#0C1322]"
              style={{ background: '#E8E8EE', border: '1px solid #E5E7EB' }}>
              {free.length === 0 && <option value="">No free units</option>}
              {free.map((v) => <option key={v.id} value={v.id}>{v.reg}{v.id === em.ambulanceId ? ' (current)' : ' · idle'}</option>)}
            </select>
          </div>
          {!isFire && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] mb-1.5">Hospital</div>
              <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-[13px] text-[#0C1322]"
                style={{ background: '#E8E8EE', border: '1px solid #E5E7EB' }}>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}{h.id === em.hospitalId ? ' (current)' : ''}</option>)}
              </select>
            </div>
          )}
          {result && (
            <div className="rounded-xl px-3 py-2.5 text-[12px] font-medium"
              style={{ background: result.ok ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', color: result.ok ? '#16a34a' : '#dc2626' }}>
              {result.ok ? 'Reassigned successfully.' : result.reason}
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl text-[13px] font-medium transition-colors"
            style={{ background: '#E8E8EE', color: '#6B7280' }}
            onMouseEnter={e => e.currentTarget.style.background = '#EAECEF'}
            onMouseLeave={e => e.currentTarget.style.background = '#E8E8EE'}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 h-10 rounded-xl text-[13px] font-semibold disabled:opacity-50 transition-all"
            style={{ background: '#07514D', color: '#fff', boxShadow: '0 2px 10px rgba(7,81,77,0.25)' }}>
            {busy ? 'Reassigning…' : 'Apply override'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusChip({ state }) {
  const map = {
    EN_ROUTE: ['#16a34a', 'En route'],
    COMPLETED: ['#64748b', 'Completed'],
    QUEUED: ['#d97706', 'Queued'],
    PREEMPTED: ['#dc2626', 'Preempted'],
    NO_HOSPITAL: ['#dc2626', 'No facility'],
    NO_BLOODBANK: ['#dc2626', 'No blood bank'],
    CANCELLED: ['#94a3b8', 'Cancelled'],
  }
  const [c, t] = map[state] || ['#64748b', state]
  return (
    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: `${c}14`, color: c }}>{t}</span>
  )
}
