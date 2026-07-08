import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, pickupLabel, mapCenter } from '../../data/locations'
import { hospitalById, shortHospitalName, SEVERITY_META } from '../../data/hospitals'
import { makeVehicleIcon, makeHospitalIcon } from '../map/vehicleIcon'
import LiveEta from '../../components/common/LiveEta'
import { useNow } from '../../hooks/useNow'
import Icon from '../../components/common/Icon'
import { usePagination, PaginationBar } from '../../components/common/Pagination'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'queued', label: 'Queued' },
  { key: 'completed', label: 'Completed' },
  { key: 'fire', label: 'Fire' },
  { key: 'medical', label: 'Medical' },
  { key: 'cleared', label: 'Cleared' },
]
const ATTENTION = ['QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED']
const NO_FACILITY = ['NO_HOSPITAL', 'NO_BLOODBANK']
const FINISHED = ['COMPLETED', 'CANCELLED']

// Total wall-clock time a completed/cancelled job actually took, from
// creation to its last status update — falls back to the originally
// computed total-trip ETA if updatedAt isn't available (e.g. older records).
function completedDurationLabel(e) {
  const start = new Date(e.createdAt)
  const end = e.updatedAt ? new Date(e.updatedAt) : null
  if (end && !isNaN(start) && !isNaN(end) && end > start) {
    const min = (end - start) / 60000
    return min < 1 ? '<1 min' : `${Math.round(min)} min`
  }
  return e.totalEtaMin > 0 ? `${Math.round(e.totalEtaMin)} min` : null
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
  const drivers = useFleetStore((s) => s.drivers)
  const cancelRequest = useFleetStore((s) => s.cancelRequest)
  const now = useNow(3000)
  const [filter, setFilter] = useState('all')
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(() => params.get('q') || '')
  // Command palette / other pages can deep-link a search term via ?q=
  useEffect(() => {
    const urlQ = params.get('q')
    if (urlQ) { setQ(urlQ); setParams({}, { replace: true }) }
  }, [params, setParams])
  const [busy, setBusy] = useState(null)
  const [override, setOverride] = useState(null)
  const [timelineEm, setTimelineEm] = useState(null)
  const [menuId, setMenuId] = useState(null)
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

  // Row multi-select for bulk clear/cancel — cleared whenever the visible
  // set changes underneath it (filter/search/page) so a stale selection
  // can't silently act on rows the user isn't looking at anymore.
  const [selected, setSelected] = useState(() => new Set())
  const toggleSelected = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const clearSelection = () => setSelected(new Set())
  async function bulkCancelSelected() {
    const targets = [...selected].filter((id) => emergencies.find((e) => e.id === id)?.state === 'EN_ROUTE')
    if (!targets.length) return
    if (!window.confirm(`Cancel ${targets.length} active dispatch${targets.length > 1 ? 'es' : ''}?\n\n${targets.join(', ')}\n\nThis recalls the assigned unit(s) — this cannot be undone.`)) return
    setBulkBusy(true)
    for (const id of targets) { try { await cancelRequest(id) } catch {} }
    setBulkBusy(false)
    clearSelection()
  }
  function bulkClearSelected() {
    const n = new Set(cleared)
    selected.forEach((id) => n.add(id))
    persistCleared(n)
    clearSelection()
  }

  // KPI counts always reflect the live (non-cleared) board, regardless of
  // which filter tab — including "Cleared" — is currently selected, so
  // clearing items never makes the at-a-glance numbers look wrong.
  const visible = useMemo(
    () => emergencies.filter((e) => !cleared.has(e.id)),
    [emergencies, cleared])

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
    // "Cleared" is its own pool (only cleared items); every other tab draws
    // from the live board and never shows cleared items.
    const base = filter === 'cleared' ? emergencies.filter((e) => cleared.has(e.id)) : visible
    const match = (e) => (filter === 'all' || filter === 'cleared'
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
    return [...base].filter((e) => match(e) && search(e))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [visible, emergencies, cleared, vehicles, filter, q])

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

  // Pagination — user-selectable rows-per-page (5/10/50), same control
  // everywhere in the app (see components/common/Pagination.jsx).
  const { page, setPage, pageSize, setPageSize, pageCount, paged: pagedRows } = usePagination(rows, 10)
  useEffect(() => { setPage(0); setSelected(new Set()) }, [q, filter])

  async function onCancel(id) {
    setMenuId(null)
    if (!window.confirm(`Cancel dispatch ${id}? This recalls the assigned unit — this cannot be undone.`)) return
    setBusy(id)
    try { await cancelRequest(id) } finally { setBusy(null) }
  }

  return (
    <div className="flex flex-col h-full page-enter" style={{ background: '#F7F4EF' }}>

      {/* ── Page header ── */}
      <div className="px-6 pt-6 pb-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-[#0C1322]">Emergency Dispatch</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]"><Icon name="search" size={14} strokeWidth={2} /></span>
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() } }}
              placeholder="" aria-label="Search responses"
              className="pl-9 pr-9 py-2 rounded-xl text-[13px] text-[#0C1322] w-72 xl:w-96"
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

      {/* ── KPI strip — each tile applies the matching filter ── */}
      <div className="px-6 pb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { value: kpis.active, label: 'Active', color: '#16a34a', icon: 'activity', filterKey: 'active' },
          { value: kpis.queued, label: 'Queued', color: '#d97706', icon: 'clock', filterKey: 'queued' },
          { value: kpis.completedToday, label: 'Completed today', color: '#4f46e5', icon: 'check', filterKey: 'completed' },
          { value: kpis.fire, label: 'Fire incidents', color: '#dc2626', icon: 'flame', filterKey: 'fire' },
          { value: kpis.medical, label: 'Medical', color: '#2563eb', icon: 'medical', filterKey: 'medical' },
        ].map((k) => (
          <button key={k.label} onClick={() => setFilter(k.filterKey)}
            className="px-4 py-3.5 flex items-center gap-3 card-lift text-left transition-all"
            style={{ background: '#fff', borderRadius: '16px', outline: filter === k.filterKey ? `2px solid ${k.color}` : 'none', outlineOffset: '-2px' }}>
            <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${k.color}15`, color: k.color }}>
              <Icon name={k.icon} size={17} />
            </div>
            <div>
              <div className="text-[24px] font-bold leading-none" style={{ color: k.color }}>{k.value}</div>
              <div className="text-[11px] text-[#6B7280] mt-0.5 leading-tight">{k.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* ── Bulk action bar — appears once rows are selected ── */}
      {selected.size > 0 && (
        <div className="mx-6 mb-3 px-4 py-2.5 rounded-xl flex items-center gap-3"
          style={{ background: 'rgba(7,81,77,0.08)', border: '1px solid rgba(7,81,77,0.15)' }}>
          <span className="text-[12.5px] font-semibold" style={{ color: '#07514D' }}>{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={bulkCancelSelected} disabled={bulkBusy}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
            {bulkBusy ? 'Cancelling…' : 'Cancel selected'}
          </button>
          <button onClick={bulkClearSelected} disabled={bulkBusy}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(0,0,0,0.06)', color: '#374151' }}>
            Clear selected
          </button>
          <button onClick={clearSelection}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all"
            style={{ background: 'transparent', color: '#6B7280' }}>
            Deselect
          </button>
        </div>
      )}

      {/* ── Filters + board controls ── */}
      <div className="px-6 pb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Filter responses">
          {FILTERS.map((f) => {
            const isActive = filter === f.key
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} role="tab" aria-selected={isActive}
                className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all flex items-center gap-1.5"
                style={isActive
                  ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 8px rgba(7,81,77,0.25)' }
                  : { background: 'rgba(255,255,255,0.85)', color: '#6B7280' }}>
                {f.key === 'fire' && <Icon name="flame" size={12} />}
                {f.key === 'medical' && <Icon name="medical" size={12} />}
                {f.label}{f.key === 'cleared' && cleared.size > 0 ? ` (${cleared.size})` : ''}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {noFacility.length > 0 && (
            <button onClick={clearNoFacility} disabled={bulkBusy}
              className="px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
              style={{ background: 'rgba(217,119,6,0.1)', color: '#d97706' }}>
              <Icon name="alert" size={12} />{bulkBusy ? 'Clearing…' : `No-facility (${noFacility.length})`}
            </button>
          )}
          <button onClick={restoreCleared} disabled={cleared.size === 0}
            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.85)', color: '#6B7280' }}>
            Restore all
          </button>
          <button onClick={clearCompleted} disabled={clearableNow.length === 0}
            className="px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
            style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
            <Icon name="trash" size={12} />Clear{clearableNow.length ? ` (${clearableNow.length})` : ''}
          </button>
        </div>
      </div>

      {/* ── Dense table ── */}
      <div className="flex-1 overflow-auto px-6 pb-6 flex flex-col">
        <div className="card-static" style={{ background: 'rgba(255,255,255,0.92)', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)' }}>
          {/* Fixed proportional column widths (colgroup + table-fixed) instead
              of letting content dictate width — this is what guarantees
              everything fits in one page with no horizontal scroll,
              regardless of how long a pickup/destination name is (they just
              truncate, with the full value still on hover via title=). Type
              is folded into the Severity cell and Crew into the Unit cell to
              cut two columns entirely. */}
          <table className="w-full text-[13px]" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '4%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} />
              <col style={{ width: '8%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} />
              <col style={{ width: '11%' }} /><col style={{ width: '13%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '4%' }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <th className="px-4 py-3">
                  <input type="checkbox" aria-label="Select all on this page"
                    checked={pagedRows.length > 0 && pagedRows.every((e) => selected.has(e.id))}
                    onChange={(ev) => {
                      setSelected((s) => {
                        const n = new Set(s)
                        pagedRows.forEach((e) => ev.target.checked ? n.add(e.id) : n.delete(e.id))
                        return n
                      })
                    }} className="rounded" />
                </th>
                {['ID / Time', 'Severity', 'ETA', 'Pickup', 'Unit', 'Destination', 'Progress', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-3 truncate"
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
                      style={{ background: 'rgba(7,81,77,0.08)', color: '#07514D' }}>
                      Show all responses
                    </button>
                  )}
                </td></tr>
              )}
              {pagedRows.map((e) => {
                const isFire = e.kind === 'fire'
                const isBlood = e.kind === 'blood'
                const veh = vehicles.find((v) => v.id === e.ambulanceId)
                const hosp = hospitalById(e.hospitalId)
                const sev = SEVERITY_META[e.severity]
                const t = new Date(e.createdAt)
                const time = isNaN(t) ? '' : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                const typeColor = isFire ? '#ea580c' : isBlood ? '#b91c1c' : '#2563eb'
                const isNew = !seenRef.current.has(e.id)
                const driverName = drivers.find((d) => d.id === veh?.driverId)?.name
                return (
                  <tr key={e.id} className={`align-middle group transition-colors hover:bg-[rgba(7,81,77,0.03)] ${isNew ? 'row-flash' : ''}`}
                    style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td className="px-4 py-3.5">
                      <input type="checkbox" aria-label={`Select ${e.id}`} checked={selected.has(e.id)}
                        onChange={() => toggleSelected(e.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-[#0C1322] flex items-center gap-1.5 truncate">
                        {e.id}
                        {e.incidentId && <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0" style={{ background: '#fee2e2', color: '#dc2626' }}>MCI</span>}
                        {e.patientsCount > 1 && !isBlood && <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold shrink-0" style={{ background: '#eef2ff', color: '#4338ca' }}>{e.patientsCount}p</span>}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: '#6B7280' }}>{time}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="h-6 w-6 rounded-lg grid place-items-center shrink-0"
                          style={{ background: `${typeColor}12`, color: typeColor }}>
                          <Icon name={isFire ? 'flame' : isBlood ? 'droplet' : 'medical'} size={12} />
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium truncate" style={{ color: sev?.color || '#6B7280' }}>
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: sev?.color }} />
                          <span className="truncate">{(!isFire && !isBlood && e.caseType) ? e.caseType : e.severity}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-[13px] whitespace-nowrap" style={{ color: '#07514D' }}>
                      {e.state === 'EN_ROUTE' ? <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} />
                        : e.state === 'COMPLETED' ? (
                          <span title="Total time from request to arrival">{completedDurationLabel(e) || '—'}</span>
                        ) : <span className="text-[#6B7280] font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="truncate text-[#374151]" title={pickupLabel(e)}>{pickupLabel(e) || '—'}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      {veh ? (
                        <>
                          <div className="font-mono text-[12px] font-semibold text-[#0C1322] truncate">{veh.reg}</div>
                          {driverName && <div className="text-[11px] truncate" style={{ color: '#6B7280' }}>{driverName}</div>}
                        </>
                      ) : <span className="text-[#6B7280]">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="truncate text-[#374151]" title={shortHospitalName(hosp?.name) || ''}>{isFire ? '—' : (shortHospitalName(hosp?.name) || '—')}</div>
                    </td>
                    <td className="px-4 py-3.5"><ProgressBar e={e} now={now} /></td>
                    <td className="px-4 py-3.5"><StatusChip state={e.state} /></td>
                    <td className="px-4 py-3.5 relative">
                      <button onClick={() => setMenuId(menuId === e.id ? null : e.id)}
                        aria-label={`Actions for ${e.id}`} aria-expanded={menuId === e.id}
                        className="h-7 w-7 rounded-lg grid place-items-center text-[#6B7280] transition-colors hover:bg-[#E8E8EE]">⋮</button>
                      {menuId === e.id && (
                        <RowMenu e={e} busy={busy === e.id}
                          onOverride={() => { setMenuId(null); setOverride(e) }}
                          onCancel={() => onCancel(e.id)}
                          onViewTimeline={() => { setMenuId(null); setTimelineEm(e) }}
                          onClose={() => setMenuId(null)} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <PaginationBar page={page} setPage={setPage} pageCount={pageCount} pageSize={pageSize} setPageSize={setPageSize}
          total={rows.length} itemLabel="responses" suffix={` ${filter !== 'all' ? filter + ' ' : ''}responses`} />
      </div>

      {override && <OverrideModal em={override} onClose={() => setOverride(null)} />}
      {timelineEm && <TimelineModal em={timelineEm} onClose={() => setTimelineEm(null)} />}
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
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between mb-1.5 gap-1">
        <span className="text-[11px] font-semibold truncate" style={{ color }}>{stageLabel(e)}</span>
        {!cancelled && <span className="text-[11px] shrink-0" style={{ color: '#6B7280' }}>{pct}%</span>}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${queued ? 'animate-pulse' : ''}`}
          style={{ width: `${cancelled ? 0 : pct}%`, background: color }} />
      </div>
    </div>
  )
}

function RowMenu({ e, busy, onOverride, onCancel, onViewTimeline, onClose }) {
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
      {enroute && (
        <>
          <button onClick={onOverride} className="w-full text-left px-4 py-2.5 font-medium transition-colors hover:bg-[rgba(7,81,77,0.05)]"
            style={{ color: '#07514D' }}>Override unit</button>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />
        </>
      )}
      <button onClick={onViewTimeline} className="w-full text-left px-4 py-2.5 font-medium transition-colors hover:bg-[rgba(7,81,77,0.05)]"
        style={{ color: '#07514D' }}>View timeline</button>
      {enroute && (
        <>
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />
          <button onClick={onCancel} disabled={busy} className="w-full text-left px-4 py-2.5 font-medium transition-colors disabled:opacity-50 hover:bg-[rgba(220,38,38,0.05)]"
            style={{ color: '#dc2626' }}>
            {busy ? 'Cancelling…' : 'Cancel dispatch'}
          </button>
        </>
      )}
    </div>
  )
}

// Chronological milestones for a dispatch, derived from the fields the
// client actually has (createdAt, updatedAt, computed ETAs) rather than a
// dedicated event-history endpoint — the backend does write per-transition
// EVT# audit rows (see Function.cs), but nothing currently exposes them to
// the frontend, so intermediate steps without a real timestamp are labeled
// "(estimated)" rather than presented as if they were logged events.
function buildTimeline(em) {
  const created = new Date(em.createdAt)
  if (isNaN(created)) return []
  const updated = em.updatedAt ? new Date(em.updatedAt) : null
  const isFire = em.kind === 'fire'
  const steps = [{ label: 'Requested', time: created, done: true }]

  if (em.ambulanceId) {
    steps.push({ label: isFire ? 'Fire truck assigned' : 'Ambulance assigned', time: created, done: true })
  }

  if (['EN_ROUTE', 'COMPLETED'].includes(em.state) && em.etaToPickupMin > 0) {
    steps.push({
      label: isFire ? 'Arrived at incident' : 'Arrived at pickup',
      time: new Date(created.getTime() + em.etaToPickupMin * 60000),
      done: em.state === 'COMPLETED', estimated: true,
    })
  }

  if (em.state === 'COMPLETED') {
    const real = updated && updated > created ? updated : null
    steps.push({
      label: isFire ? 'Cleared scene' : 'Arrived / handover complete',
      time: real || new Date(created.getTime() + (em.totalEtaMin || 0) * 60000),
      done: true, estimated: !real,
    })
  } else if (em.state === 'CANCELLED') {
    steps.push({ label: 'Cancelled', time: updated || created, done: true })
  } else if (['QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK'].includes(em.state)) {
    steps.push({ label: em.state === 'QUEUED' ? 'Waiting for a unit' : 'Waiting for a facility', time: null, done: false, current: true })
  } else if (em.state === 'EN_ROUTE') {
    steps.push({ label: 'En route', time: null, done: false, current: true })
  }

  return steps
}

// Fits the map view to whatever route/marker geometry is available for this
// dispatch, once, on mount — the timeline map is a fixed snapshot, not a
// live-following view, so this only needs to run once per opened modal.
function FitToRoute({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points?.length > 1) map.fitBounds(points, { padding: [28, 28], maxZoom: 15 })
    else if (points?.length === 1) map.setView(points[0], 14)
  }, [map, points])
  return null
}

// Real route geometry (leg1: dispatch -> pickup/incident, leg2: pickup ->
// hospital/facility) comes from the OSRM-backed legs the fleet store already
// computes for live tracking (see useFleetStore.js) — nothing here is
// fabricated. Legs are undefined once the emergency ages out of the map's
// live-geometry cache, in which case the map falls back to straight
// origin/pickup/destination markers with no drawn path.
function TimelineMap({ em }) {
  const vehicles = useFleetStore((s) => s.vehicles)
  const veh = vehicles.find((v) => v.id === em.ambulanceId)
  const hosp = em.hospitalId ? hospitalById(em.hospitalId) : null
  const pickupLoc = locById(em.pickup) || em.pickupPt
  const pickupPos = pickupLoc && typeof pickupLoc.lat === 'number' ? [pickupLoc.lat, pickupLoc.lng] : null
  const hospPos = hosp ? [hosp.lat, hosp.lng] : null
  const startPos = veh?.pos && em.leg1?.length ? em.leg1[0] : null

  const routePoints = [...(em.leg1 || []), ...(em.leg2 || [])]
  const fitPoints = routePoints.length ? routePoints : [startPos, pickupPos, hospPos].filter(Boolean)
  const center = fitPoints[0] || [mapCenter().lat, mapCenter().lng]

  return (
    <div className="h-48 rounded-xl overflow-hidden mb-4" style={{ border: '1px solid #EEF1F0' }}>
      <MapContainer center={center} zoom={13} zoomControl={false} attributionControl={false} className="h-full w-full" dragging={false} scrollWheelZoom={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        <FitToRoute points={fitPoints.length ? fitPoints : null} />
        {em.leg1?.length > 0 && <Polyline positions={em.leg1} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.85 }} />}
        {em.leg2?.length > 0 && <Polyline positions={em.leg2} pathOptions={{ color: '#dc2626', weight: 4, opacity: 0.85 }} />}
        {startPos && veh && <Marker position={startPos} icon={makeVehicleIcon(veh, false, false)} />}
        {pickupPos && <Marker position={pickupPos} icon={makeHospitalIcon(false)} />}
        {hospPos && <Marker position={hospPos} icon={makeHospitalIcon(false)} />}
      </MapContainer>
      {!routePoints.length && (
        <div className="text-[10.5px] text-center py-1" style={{ color: '#9CA3AF', background: '#FAFBFB' }}>
          Live route geometry not available for this request — showing known stop locations only.
        </div>
      )}
    </div>
  )
}

function TimelineModal({ em, onClose }) {
  const steps = buildTimeline(em)
  const fmt = (d) => d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)', zIndex: 5000 }} onClick={onClose}>
      <div className="w-[440px] rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}
        onClick={(ev) => ev.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div>
            <div className="text-[15px] font-bold text-[#0C1322]">Timeline · {em.id}</div>
            <div className="text-[11px] text-[#6B7280]">Steps without a logged timestamp are estimated from policy ETAs.</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="h-8 w-8 rounded-xl grid place-items-center text-[#6B7280] hover:bg-[#E8E8EE] transition-colors shrink-0">
            <Icon name="x" size={15} strokeWidth={2.2} />
          </button>
        </div>
        <div className="px-5 py-4">
          <TimelineMap em={em} />
          {steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0">
                <span className="h-3 w-3 rounded-full mt-0.5" style={{ background: s.done ? '#16a34a' : s.current ? '#d97706' : '#CBD5E1' }} />
                {i < steps.length - 1 && <span className="w-px flex-1 my-0.5" style={{ background: '#E5E7EB' }} />}
              </div>
              <div className="pb-4 min-w-0">
                <div className="text-[13px] font-semibold text-[#0C1322]">{s.label}</div>
                <div className="text-[11.5px]" style={{ color: '#6B7280' }}>
                  {s.time ? `${fmt(s.time)}${s.estimated ? ' (estimated)' : ''}` : 'Pending'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
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
          <button onClick={onClose} aria-label="Close"
            className="h-8 w-8 rounded-xl grid place-items-center text-[#6B7280] hover:bg-[#E8E8EE] transition-colors">
            <Icon name="x" size={15} strokeWidth={2.2} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7280] mb-1.5">{isFire ? 'Fire truck' : 'Ambulance'}</div>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[13px] text-[#0C1322]"
              style={{ background: '#E8E8EE', border: '1px solid #E5E7EB' }}>
              {free.length === 0 && <option value="">No free units</option>}
              {free.map((v) => <option key={v.id} value={v.id}>{v.reg}{v.id === em.ambulanceId ? ' (current)' : ' · idle'}</option>)}
            </select>
          </div>
          {!isFire && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7280] mb-1.5">Hospital</div>
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
          <button onClick={onClose} className="flex-1 h-10 rounded-xl text-[13px] font-medium transition-colors hover:brightness-95"
            style={{ background: '#E8E8EE', color: '#6B7280' }}>Cancel</button>
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
