import React, { useState, useMemo, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip } from 'react-leaflet'
import { useFleetStore } from '../store/useFleetStore'
import { JAMSHEDPUR_CENTER, LOCATIONS, locById } from '../data/locations'
import { hospitalById, CASE_TYPES, SEVERITIES } from '../data/hospitals'
import { makeVehicleIcon, makeHospitalIcon, makeFirestationIcon } from '../features/map/vehicleIcon'
import LiveEta from '../components/common/LiveEta'
import VoiceAgent from './VoiceAgent'

const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

const SEV_META = {
  Critical: { color: '#dc2626', bg: '#fef2f2', hint: 'Life-threatening' },
  Urgent:   { color: '#d97706', bg: '#fffbeb', hint: 'Needs help soon' },
  Normal:   { color: '#2563eb', bg: '#eff6ff', hint: 'Stable' },
}
const CASE_ICON = { Cardiac: '❤️', Trauma: '🩹', General: '🚑', Maternity: '🤰', Pediatric: '🧒' }

export default function UserPortal({ session, onSignOut }) {
  const ready = useFleetStore((s) => s.ready)
  const error = useFleetStore((s) => s.error)
  const emergencies = useFleetStore((s) => s.emergencies)
  const createEmergency = useFleetStore((s) => s.createEmergency)
  const cancelRequest = useFleetStore((s) => s.cancelRequest)
  const live = useFleetStore((s) => s.live)
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)
  const policy = useFleetStore((s) => s.policyConfig)

  const [kind, setKind] = useState('medical')
  const [pickup, setPickup] = useState('loc-sakchi')
  const [caseType, setCaseType] = useState('Cardiac')
  const [severity, setSeverity] = useState('Urgent')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [callOpen, setCallOpen] = useState(false)
  const [reqTab, setReqTab] = useState('live')
  const [mass, setMass] = useState(false)
  const [patients, setPatients] = useState(5)
  const isFire = kind === 'fire'

  const per = Number(policy?.patients_per_ambulance) || 4
  const cap = Number(policy?.max_units) || 10
  const useUnits = (!isFire && mass) ? Math.min(cap, Math.max(2, Math.ceil((Number(patients) || 2) / per))) : 1

  const myId = session?.sub || session?.name
  const mine = useMemo(
    () => [...emergencies].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [emergencies])
  const LIVE_STATES = ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL']
  const activeMine = mine.filter((e) => LIVE_STATES.includes(e.state))
  const completedMine = mine.filter((e) => !LIVE_STATES.includes(e.state))
  const shownReqs = reqTab === 'live' ? activeMine : completedMine

  async function submit() {
    setBusy(true)
    const r = await createEmergency({ kind, pickup, caseType, severity, requestedBy: myId,
      units: 1, patients: (!isFire && mass) ? (Number(patients) || 2) : 1 })
    setBusy(false); setResult(r)
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col" style={{ background: '#F3F4F6', fontFamily: "'Poppins', sans-serif" }}>
      {/* ── Header ── */}
      <header className="h-[60px] shrink-0 flex items-center justify-between px-6 z-40"
        style={{ background: '#fff', boxShadow: '0 1px 0 rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl flex items-center justify-center text-white text-[13px] font-bold"
            style={{ background: '#07514D' }}>J</div>
          <span className="text-[15px] font-bold text-[#111827]">JSD Emergency Services</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[#6B7280] hidden sm:inline">{session?.sub || session?.name}</span>
          <button onClick={onSignOut}
            className="h-8 px-4 rounded-lg text-[12px] font-semibold text-[#6B7280] transition-all"
            style={{ background: '#F3F4F6' }}>
            Sign out
          </button>
        </div>
      </header>

      {callOpen && <VoiceAgent session={session} onClose={() => setCallOpen(false)} />}

      {error ? (
        <div className="flex-1 grid place-items-center p-6">
          <div className="bg-white rounded-3xl p-8 max-w-md text-center shadow-sm">
            <div className="text-[18px] font-bold text-[#111827] mb-2">Service unavailable</div>
            <p className="text-[14px] text-[#6B7280]">{error}</p>
          </div>
        </div>
      ) : !ready ? (
        <LoadingState />
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden gap-0">
          {/* ── LEFT: Booking form ── */}
          <aside className="w-full lg:w-[380px] shrink-0 overflow-y-auto py-5 px-4 space-y-4">
            {/* Voice CTA banner */}
            <button onClick={() => setCallOpen(true)}
              className="w-full rounded-2xl p-4 flex items-center gap-4 text-left transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #07514D 0%, #0B6A64 100%)', boxShadow: '0 4px 20px rgba(7,81,77,0.3)' }}>
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: '#D6DF27' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#07514D" strokeWidth="2.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </div>
              <div>
                <div className="text-[14px] font-bold text-white">Call for immediate help</div>
                <div className="text-[12px] text-white/70 mt-0.5">Speak with our AI assistant 24/7</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" className="ml-auto shrink-0">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            {/* Booking card */}
            <div className="rounded-2xl p-5 space-y-4" style={{ background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div className="text-[14px] font-bold text-[#111827]">Book a unit</div>

              {/* Type toggle */}
              <div className="grid grid-cols-2 gap-2">
                <TypeTile active={!isFire} onClick={() => setKind('medical')}
                  label="🚑 Ambulance" desc="Medical emergency" color="#07514D" />
                <TypeTile active={isFire} onClick={() => setKind('fire')}
                  label="🚒 Fire truck" desc="Fire / rescue" color="#ea580c" />
              </div>

              {/* Location */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] block mb-1.5">
                  {isFire ? 'Incident location' : 'Pickup location'}
                </label>
                <LocationPicker value={pickup} onChange={setPickup} />
              </div>

              {/* Case type */}
              {!isFire && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] block mb-1.5">Type of emergency</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {CASE_TYPES.map((c) => (
                      <button key={c} onClick={() => setCaseType(c)}
                        className="py-2 rounded-xl text-[12px] font-semibold transition-all"
                        style={caseType === c
                          ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 8px rgba(7,81,77,0.25)' }
                          : { background: '#F3F4F6', color: '#6B7280' }}>
                        {CASE_ICON[c] || '🚨'} {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Severity */}
              {!isFire && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] block mb-1.5">Severity</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {SEVERITIES.map((s) => {
                      const m = SEV_META[s] || { color: '#2563eb', bg: '#eff6ff', hint: '' }
                      const on = severity === s
                      return (
                        <button key={s} onClick={() => setSeverity(s)}
                          className="flex flex-col items-center py-2.5 rounded-xl text-[12px] font-bold transition-all"
                          style={on
                            ? { background: m.color, color: '#fff', boxShadow: `0 2px 10px ${m.color}44` }
                            : { background: m.bg, color: m.color }}>
                          {s}
                          <span className="text-[10px] font-normal mt-0.5 opacity-70">{m.hint}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Mass casualty */}
              {!isFire && (
                <div className="rounded-xl p-3" style={{ background: '#F9FAFB' }}>
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="text-[13px] font-semibold text-[#374151]">Multiple casualties</span>
                    <div onClick={() => setMass((m) => !m)}
                      className="h-5 w-9 rounded-full relative cursor-pointer transition-all"
                      style={{ background: mass ? '#07514D' : '#D1D5DB' }}>
                      <div className="h-4 w-4 rounded-full bg-white absolute top-0.5 transition-all"
                        style={{ left: mass ? '20px' : '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                    </div>
                  </label>
                  {mass && (
                    <div className="mt-3 flex items-center gap-3">
                      <input type="number" min={2} max={200} value={patients} onChange={(e) => setPatients(e.target.value)}
                        className="w-20 rounded-lg px-3 py-1.5 text-[14px] font-bold text-center"
                        style={{ background: '#fff', border: '1.5px solid #E5E7EB', color: '#111827' }} />
                      <span className="text-[12px] text-[#6B7280]">
                        patients · <strong className="text-[#07514D]">~{useUnits} ambulance{useUnits > 1 ? 's' : ''}</strong> dispatched
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Result banner */}
              {result && (
                <div className="rounded-xl px-4 py-3 text-[13px] flex items-start gap-2.5"
                  style={result.ok
                    ? { background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#16a34a' }
                    : { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626' }}>
                  <span className="text-base leading-none mt-0.5">{result.ok ? '✓' : '⚠'}</span>
                  <span className="font-medium">
                    {result.ok
                      ? (result.mass
                        ? `Mass casualty ${result.id} — ${result.dispatched}/${result.units} ambulances dispatched`
                        : `Help is on the way · ${result.id}${result.vehicle ? ' · ' + result.vehicle : ''}`)
                      : result.reason}
                  </span>
                </div>
              )}

              {/* Submit */}
              <button onClick={submit} disabled={busy}
                className="w-full h-14 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-60 transition-all active:scale-[0.98]"
                style={{
                  background: isFire ? '#ea580c' : '#07514D',
                  color: '#fff',
                  boxShadow: `0 4px 20px ${isFire ? 'rgba(234,88,12,0.35)' : 'rgba(7,81,77,0.35)'}`,
                }}>
                {busy ? (
                  <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg> Sending…</>
                ) : isFire ? '🚒 Book fire truck' : (!isFire && mass) ? `🚑 Dispatch ${useUnits} ambulances` : '🚑 Book ambulance'}
              </button>
            </div>
          </aside>

          {/* ── CENTER: Live map ── */}
          <main className="relative flex-1 order-first lg:order-none min-h-[280px]">
            <TrackMap active={activeMine.filter((e) => e.state === 'EN_ROUTE')} live={live} vehicles={vehicles} hospitals={hospitals} firestations={firestations} />
          </main>

          {/* ── RIGHT: Your requests ── */}
          <aside className="w-full lg:w-[340px] shrink-0 overflow-y-auto py-5 px-4 space-y-3">
            {/* Requests header */}
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-bold text-[#111827]">Your requests</div>
              {activeMine.length > 0 && (
                <span className="h-5 px-2 rounded-full text-[10px] font-bold flex items-center"
                  style={{ background: '#07514D', color: '#D6DF27' }}>{activeMine.length} live</span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.8)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              {[{ id: 'live', label: 'Live', count: activeMine.length }, { id: 'completed', label: 'Completed', count: completedMine.length }].map(({ id, label, count }) => (
                <button key={id} onClick={() => setReqTab(id)}
                  className="flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all"
                  style={reqTab === id
                    ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 6px rgba(7,81,77,0.25)' }
                    : { color: '#9CA3AF' }}>
                  {label}{count > 0 && <span className="ml-1 opacity-70">({count})</span>}
                </button>
              ))}
            </div>

            {/* Cards */}
            <div className="space-y-3">
              {shownReqs.length === 0 ? (
                <div className="rounded-2xl p-6 text-center" style={{ background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <div className="text-3xl mb-2">{reqTab === 'live' ? '🚑' : '✅'}</div>
                  <div className="text-[13px] font-semibold text-[#374151]">
                    {reqTab === 'completed' ? 'Nothing completed yet' : 'No active requests'}
                  </div>
                  <div className="text-[12px] text-[#9CA3AF] mt-1">
                    {reqTab === 'completed' ? 'Finished trips will appear here.' : 'Use the form to dispatch a unit.'}
                  </div>
                </div>
              ) : shownReqs.map((e) => (
                <RequestCard key={e.id} e={e} vehicles={vehicles} onCancel={cancelRequest} />
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

/* ── Request card ── */
const STEPS = ['Requested', 'Assigned', 'En route', 'Arrived']
function stepIndex(state) {
  if (state === 'COMPLETED') return 3
  if (state === 'EN_ROUTE') return 2
  if (state === 'QUEUED' || state === 'NO_HOSPITAL') return 0
  return 0
}

function RequestCard({ e, vehicles, onCancel }) {
  const isF = e.kind === 'fire'
  const hosp = hospitalById(e.hospitalId)
  const accent = isF ? '#ea580c' : '#07514D'
  const veh = vehicles.find((v) => v.id === e.ambulanceId)
  const cancelled = e.state === 'CANCELLED'
  const canCancel = ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL'].includes(e.state)
  const [cancelling, setCancelling] = useState(false)
  async function doCancel() {
    if (!window.confirm(`Cancel ${isF ? 'fire truck' : 'ambulance'} for ${e.id}?`)) return
    setCancelling(true)
    try { await onCancel?.(e.id) } finally { setCancelling(false) }
  }
  const si = stepIndex(e.state)
  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: accent }} />
          <span className="text-[13px] font-bold text-[#111827]">{e.id}</span>
        </div>
        <StatusChip state={e.state} isFire={isF} />
      </div>

      {/* Info row */}
      <div className="text-[12px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-0.5">
        <span className="font-semibold text-[#374151]">{isF ? '🔥 Fire' : `${CASE_ICON[e.caseType] || '🚨'} ${e.caseType}`}</span>
        <span>📍 {locById(e.pickup)?.name}</span>
        {veh && <span>🚑 {veh.reg}</span>}
      </div>

      {/* Progress stepper */}
      {!cancelled && (
        <div className="flex items-center">
          {STEPS.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex flex-col items-center gap-1">
                <div className="h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold transition-all"
                  style={{ background: i <= si ? accent : '#F3F4F6', color: i <= si ? '#fff' : '#D1D5DB' }}>
                  {i < si || e.state === 'COMPLETED' ? '✓' : i === si ? '●' : i + 1}
                </div>
                <span className="text-[9px] font-medium text-center leading-tight" style={{ color: i <= si ? accent : '#D1D5DB', width: 50 }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mb-4 transition-all" style={{ background: i < si ? accent : '#F3F4F6' }} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ETA banner */}
      {e.state === 'EN_ROUTE' && (
        <div className="rounded-xl px-4 py-2.5 flex items-center justify-between"
          style={{ background: `${accent}0D` }}>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: `${accent}99` }}>Arriving in</div>
            <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin}
              className="text-[20px] font-bold" style={{ color: accent }} />
          </div>
          {!isF && hosp && (
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Hospital</div>
              <div className="text-[12px] font-semibold text-[#374151]">{hosp.name}</div>
            </div>
          )}
        </div>
      )}
      {(e.state === 'QUEUED' || e.state === 'NO_HOSPITAL') && (
        <div className="rounded-xl px-4 py-2.5 text-[12px] font-medium" style={{ background: 'rgba(217,119,6,0.08)', color: '#d97706' }}>
          {e.state === 'NO_HOSPITAL' ? '🔍 Finding nearest available hospital…' : '⏳ Finding nearest available unit…'}
        </div>
      )}

      {/* Traffic */}
      {e.state === 'EN_ROUTE' && e.traffic && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="h-2 w-2 rounded-full" style={{ background: e.traffic.color }} />
          <span style={{ color: e.traffic.color }} className="font-semibold">{e.traffic.label} traffic</span>
          {e.trafficFactor > 1.05 && <span className="text-[#9CA3AF]">+{Math.round((e.trafficFactor - 1) * 100)}% delay</span>}
        </div>
      )}

      {/* Cancel */}
      {canCancel && (
        <button onClick={doCancel} disabled={cancelling}
          className="w-full h-9 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-50"
          style={{ background: 'rgba(220,38,38,0.06)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.15)' }}>
          {cancelling ? 'Cancelling…' : `Cancel ${isF ? 'fire truck' : 'ambulance'}`}
        </button>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-6 space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#E5E7EB' }} />
      ))}
    </div>
  )
}

function LocationPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)
  const selected = LOCATIONS.find((l) => l.id === value)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? LOCATIONS.filter((l) => l.name.toLowerCase().includes(t)) : LOCATIONS
  }, [q])
  useEffect(() => {
    const h = (ev) => { if (boxRef.current && !boxRef.current.contains(ev.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => { setOpen((o) => !o); setQ('') }}
        className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-left text-[14px] font-medium transition-all"
        style={{ background: '#F9FAFB', border: '1.5px solid #E5E7EB', color: '#111827' }}>
        <span>{selected?.name || 'Select a location'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-2xl overflow-hidden"
          style={{ background: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: '1px solid #F3F4F6' }}>
          <div className="px-3 py-2 border-b border-[#F3F4F6]">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search location…"
              className="w-full text-[14px] bg-transparent outline-none text-[#111827] placeholder:text-[#9CA3AF]" />
          </div>
          <div className="max-h-52 overflow-auto">
            {list.length === 0 && <div className="px-4 py-3 text-[13px] text-[#9CA3AF]">No match</div>}
            {list.map((l) => (
              <button key={l.id} type="button" onClick={() => { onChange(l.id); setOpen(false) }}
                className="w-full text-left px-4 py-2.5 text-[13px] font-medium transition-all"
                style={l.id === value ? { background: 'rgba(7,81,77,0.06)', color: '#07514D' } : { color: '#374151' }}
                onMouseEnter={(ev) => { if (l.id !== value) ev.currentTarget.style.background = '#F9FAFB' }}
                onMouseLeave={(ev) => { if (l.id !== value) ev.currentTarget.style.background = 'transparent' }}>
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TrackMap({ active, live, vehicles, hospitals, firestations }) {
  const first = active.find((e) => locById(e.pickup)) || active[0]
  const center = (first && locById(first.pickup)) || JAMSHEDPUR_CENTER
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={14} zoomControl={false} className="h-full w-full">
      <TileLayer url={LIGHT_TILES} attribution="&copy; OpenStreetMap" />
      {hospitals.map((h) => (
        <Marker key={h.id} position={[h.lat, h.lng]} icon={makeHospitalIcon(h.status === 'full')}>
          <Tooltip><b>{h.name}</b></Tooltip>
        </Marker>
      ))}
      {firestations.map((f) => (
        <Marker key={f.id} position={[f.lat, f.lng]} icon={makeFirestationIcon()}>
          <Tooltip><b>{f.name}</b></Tooltip>
        </Marker>
      ))}
      {active.map((e) => {
        const isF = e.kind === 'fire'
        const veh = vehicles.find((v) => v.id === e.ambulanceId)
        const pos = live[e.ambulanceId]?.pos
        const pick = locById(e.pickup)
        if (!pick) return null
        const legColor = isF ? '#ea580c' : '#2563eb'
        return (
          <React.Fragment key={e.id}>
            {e.leg1?.length > 0 && <Polyline positions={e.leg1} pathOptions={{ color: e.traffic?.color || legColor, weight: 4, opacity: 0.8 }} />}
            {e.leg2?.length > 0 && <Polyline positions={e.leg2} pathOptions={{ color: '#dc2626', weight: 4, opacity: 0.85 }} />}
            <CircleMarker center={[pick.lat, pick.lng]} radius={6} pathOptions={{ color: legColor, fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
              <Tooltip>{isF ? 'Incident' : 'Pickup'} · {pick.name}</Tooltip>
            </CircleMarker>
            {pos && veh && (
              <Marker position={pos} icon={makeVehicleIcon(veh, false, true)}>
                <Tooltip direction="top" offset={[0, -16]}>{veh.reg} · ETA <LiveEtaInline e={e} /></Tooltip>
              </Marker>
            )}
          </React.Fragment>
        )
      })}
    </MapContainer>
  )
}
const LiveEtaInline = ({ e }) => <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} />

const TypeTile = ({ active, onClick, label, desc, color }) => (
  <button onClick={onClick}
    className="rounded-xl p-3 text-left transition-all active:scale-[0.97]"
    style={active
      ? { background: color, boxShadow: `0 4px 12px ${color}33`, color: '#fff' }
      : { background: '#F3F4F6', color: '#6B7280' }}>
    <div className="text-[13px] font-bold">{label}</div>
    <div className="text-[11px] mt-0.5 opacity-70">{desc}</div>
  </button>
)

function StatusChip({ state, isFire }) {
  const map = {
    EN_ROUTE:    ['#16a34a', 'On the way'],
    COMPLETED:   ['#64748b', isFire ? 'Cleared' : 'Arrived'],
    QUEUED:      ['#d97706', 'Finding unit'],
    NO_HOSPITAL: ['#dc2626', 'Finding hospital'],
    CANCELLED:   ['#94a3b8', 'Cancelled'],
  }
  const [c, t] = map[state] || ['#64748b', state]
  return (
    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: `${c}18`, color: c }}>{t}</span>
  )
}
