import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, pickupLabel } from '../../data/locations'
import { hospitalById, shortHospitalName, SEVERITY_META } from '../../data/hospitals'
import LiveEta from '../../components/common/LiveEta'
import { useNow } from '../../hooks/useNow'
import Icon from '../../components/common/Icon'

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
  const searchRef = useRef(null)

  // "/" focuses search from anywhere on the board (dispatchers live on the keyboard).
  useEffect(() => {
    const h = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault(); searchRef.current?.focus()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  // Rows present on first render are not "new"; anything arriving later flashes once.
  const seenRef = useRef(null)
  if (seenRef.current === null) seenRef.current = new Set(emergencies.map((e) => e.id))
  useEffect(() => { emergencies.forEach((e) => seenRef.current.add(e.id)) }, [emergencies])

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
    // Recomputed with `now` so "today" rolls over correctly past midnight.
    const today = new Date(now).toISOString().slice(0, 10)
    const live = visible.filter((e) => e.state === 'EN_ROUTE' || ATTENTION.includes(e.state))
    return {
      active: visible.filter((e) => e.state === 'EN_ROUTE').length,
      queued: visible.filter((e) => ATTENTION.includes(e.state)).length,
      completedToday: visible.filter((e) => e.state === 'COMPLETED' && (e.createdAt || '').startsWith(today)).length,
      fire: live.filter((e) => e.kind === 'fire').length,
      medical: live.filter((e) => e.kind !== 'fire' && e.kind !== 'blood').length,
    }
  }, [visible, now])

  const liveRows = useMemo(() => {
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

  // While a row menu is open, freeze the row ORDER (data stays live) so the
  // 5s refresh can't shuffle the row out from under the pointer.
  const frozenOrderRef = useRef(null)
  if (menuId) {
    if (!frozenOrderRef.current) frozenOrderRef.current = liveRows.map((e) => e.id)
  } else {
    frozenOrderRef.current = null
  }
  const rows = useMemo(() => {
    if (!frozenOrderRef.current) return liveRows
    const byId = new Map(liveRows.map((e) => [e.id, e]))
    return frozenOrderRef.current.map((id) => byId.get(id)).filter(Boolean)
  }, [liveRows, menuId])

  async function onCancel(id) { setMenuId(null); setBusy(id); try { await cancelRequest(id) } finally { setBusy(null) } }

  return (
    <div className="flex flex-col h-full page-enter" style={{ background: '#F7F4EF' }}>

      {/* ── Page header ── */}
      <div className="px-6 pt-6 pb-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-[#2E3A2F]">Emergency Dispatch</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]"><Icon name="search" size={14} strokeWidth={2} /></span>
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() } }}
              placeholder="Search ID, location, unit…  ( / )" aria-label="Search responses"
              className="pl-9 pr-9 py-2 rounded-xl text-[13px] text-[#2E3A2F] w-72 xl:w-96"
              style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)' }} />
            {q && (
              <button onClick={() => { setQ(''); searchRef.current?.focus() }} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-lg text-[#6B7280] hover:bg-[#EEEFF3] transition-colors">
                <Icon name="x" size={13} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="px-6 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { value: kpis.active, label: 'Active', color: '#16a34a', icon: 'activity' },
          { value: kpis.queued, label: 'Queued', color: '#d97706', icon: 'clock' },
          { value: kpis.completedToday, label: 'Completed today', color: '#4f46e5', icon: 'check' },
          { value: kpis.fire, label: 'Fire incidents', color: '#dc2626', icon: 'flame' },
          { value: kpis.medical, label: 'Medical', color: '#2563eb', icon: 'medical' },
        ].map((k) => (
          <div key={k.label} className="px-4 py-3.5 flex items-center gap-3 card-lift"
            style={{ background: '#fff', borderRadius: '16px' }}>
            <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${k.color}15`, color: k.color }}>
              <Icon name={k.icon} size={17} />
            </div>
            <div>
              <div className="text-[24px] font-bold leading-none" style={{ color: k.color }}>{k.value}</div>
              <div className="text-[11px] text-[#6B7280] mt-0.5 leading-tight">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters + board controls ── */}
      <div className="px-6 pb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Filter responses">
          {FILTERS.map((f) => {
            const isActive = filter === f.key
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} role="tab" aria-selected={isActive}
                className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all flex items-center gap-1.5"
                style={isActive
                  ? { background: '#2E3A2F', color: '#fff', boxShadow: '0 2px 8px rgba(46,58,47,0.25)' }
                  : { background: 'rgba(255,255,255,0.85)', color: '#6B7280' }}>
                {f.key === 'fire' && <Icon name="flame" size={12} />}
                {f.key === 'medical' && <Icon name="medical" size={12} />}
                {f.label}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-[#6B7280] cursor-pointer">
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
        <div className="overflow-hidden card-static" style={{ background: 'rgba(255,255,255,0.92)', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                {['ID / Time', 'Type', 'Severity', 'Pickup', 'Unit', 'Destination', 'Progress', 'ETA', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-3"
                    style={{ fontSize: '10.5px', letterSpacing: '0.06em', color: '#6B7280', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[13px]" style={{ color: '#6B7280' }}>
                  <div>No responses match {q ? 'this search' : 'this filter'}.</div>
                  {(q || filter !== 'all') && (
                    <button onClick={() => { setQ(''); setFilter('all') }}
                      className="mt-3 px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-colors hover:brightness-95"
                      style={{ background: 'rgba(46,58,47,0.08)', color: '#2E3A2F' }}>
                      Show all responses
                    </button>
                  )}
                </td></tr>
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
                const isNew = !seenRef.current.has(e.id)
                return (
                  <tr key={e.id} className={`align-middle group transition-colors hover:bg-[rgba(46,58,47,0.03)] ${isNew ? 'row-flash' : ''}`}
                    style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-[#2E3A2F] flex items-center gap-1.5">
                        {e.id}
                        {e.incidentId && <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold" style={{ background: '#fee2e2', color: '#dc2626' }}>MCI</span>}
                        {e.patientsCount > 1 && !isBlood && <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold" style={{ background: '#eef2ff', color: '#4338ca' }}>{e.patientsCount}p</span>}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: '#6B7280' }}>{time}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="h-8 w-8 rounded-xl grid place-items-center"
                        style={{ background: `${typeColor}12`, color: typeColor }}>
                        <Icon name={isFire ? 'flame' : isBlood ? 'droplet' : 'medical'} size={16} />
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: sev?.color || '#6B7280' }}>
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: sev?.color }} />
                        {(!isFire && !isBlood && e.caseType) ? e.caseType : e.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 max-w-[160px]">
                      <div className="truncate text-[#374151]" title={pickupLabel(e)}>{pickupLabel(e) || '—'}</div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {veh ? (
                        <span className="font-mono text-[12px] font-semibold text-[#2E3A2F]">{veh.reg}</span>
                      ) : <span className="text-[#6B7280]">—</span>}
                    </td>
                    <td className="px-4 py-3.5 max-w-[160px]">
                      <div className="truncate text-[#374151]" title={shortHospitalName(hosp?.name) || ''}>{isFire ? '—' : (shortHospitalName(hosp?.name) || '—')}</div>
                    </td>
                    <td className="px-4 py-3.5 w-44"><ProgressBar e={e} now={now} /></td>
                    <td className="px-4 py-3.5 font-semibold text-[13px]" style={{ color: '#2E3A2F' }}>
                      {e.state === 'EN_ROUTE' ? <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} /> : <span className="text-[#6B7280] font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3.5"><StatusChip state={e.state} /></td>
                    <td className="px-4 py-3.5 relative">
                      <button onClick={() => setMenuId(menuId === e.id ? null : e.id)}
                        aria-label={`Actions for ${e.id}`} aria-expanded={menuId === e.id}
                        className="h-7 w-7 rounded-lg grid place-items-center text-[#6B7280] transition-colors hover:bg-[#F7F4EF]">⋮</button>
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
        <div className="text-[12px] mt-3 px-1" style={{ color: '#6B7280' }}>Showing {rows.length} {filter !== 'all' ? filter + ' ' : ''}responses</div>
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
  const color = cancelled ? '#CBD5E1' : done ? '#16a34a' : queued ? '#d97706' : (isFire ? '#ea580c' : '#2E3A2F')
  return (
    <div className="min-w-[130px]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold" style={{ color }}>{stageLabel(e)}</span>
        {!cancelled && <span className="text-[11px]" style={{ color: '#6B7280' }}>{pct}%</span>}
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
          <button onClick={onOverride} className="w-full text-left px-4 py-2.5 font-medium transition-colors hover:bg-[rgba(46,58,47,0.05)]"
            style={{ color: '#2E3A2F' }}>Override unit</button>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />
          <button onClick={onCancel} disabled={busy} className="w-full text-left px-4 py-2.5 font-medium transition-colors disabled:opacity-50 hover:bg-[rgba(220,38,38,0.05)]"
            style={{ color: '#dc2626' }}>
            {busy ? 'Cancelling…' : 'Cancel dispatch'}
          </button>
        </>
      ) : (
        <div className="px-4 py-2.5 text-[#6B7280]">No actions available</div>
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
            <div className="text-[15px] font-bold text-[#2E3A2F]">Override {em.id}</div>
            <div className="text-[11px] text-[#6B7280]">Manually reassign unit{!isFire && ' or hospital'}. Previous unit is freed.</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="h-8 w-8 rounded-xl grid place-items-center text-[#6B7280] hover:bg-[#F7F4EF] transition-colors">
            <Icon name="x" size={15} strokeWidth={2.2} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7280] mb-1.5">{isFire ? 'Fire truck' : 'Ambulance'}</div>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[13px] text-[#2E3A2F]"
              style={{ background: '#F7F4EF', border: '1px solid #E5E7EB' }}>
              {free.length === 0 && <option value="">No free units</option>}
              {free.map((v) => <option key={v.id} value={v.id}>{v.reg}{v.id === em.ambulanceId ? ' (current)' : ' · idle'}</option>)}
            </select>
          </div>
          {!isFire && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7280] mb-1.5">Hospital</div>
              <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-[13px] text-[#2E3A2F]"
                style={{ background: '#F7F4EF', border: '1px solid #E5E7EB' }}>
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
          <button onClick={onClose} className="flex-1 h-10 rounded-xl text-[13px] font-medium transition-colors hover:brightness-95"
            style={{ background: '#F7F4EF', color: '#6B7280' }}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 h-10 rounded-xl text-[13px] font-semibold disabled:opacity-50 transition-all"
            style={{ background: '#2E3A2F', color: '#fff', boxShadow: '0 2px 10px rgba(46,58,47,0.25)' }}>
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
