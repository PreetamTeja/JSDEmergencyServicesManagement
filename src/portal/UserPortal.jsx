import React, { useState, useMemo, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip } from 'react-leaflet'
import { useFleetStore } from '../store/useFleetStore'
import { mapCenter, LOCATIONS, locById } from '../data/locations'
import { hospitalById, CASE_TYPES, SEVERITIES } from '../data/hospitals'
import { makeVehicleIcon, makeHospitalIcon, makeFirestationIcon } from '../features/map/vehicleIcon'
import LiveEta from '../components/common/LiveEta'
import Icon from '../components/common/Icon'
import VoiceAgent from './VoiceAgent'
import MapControls from '../components/common/MapControls'
import BootScreen from '../components/common/BootScreen'

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

const SEV_META = {
  Critical: { color: '#dc2626', hint: 'Life-threatening' },
  Urgent: { color: '#d97706', hint: 'Needs help soon' },
  Normal: { color: '#2563eb', hint: 'Stable' },
}

// Self-service requester experience. When SSO lands, an authenticated "user"
// (not admin) is routed here: they raise an emergency and track their own.
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
  const [reqTab, setReqTab] = useState('live') // live | completed
  const [mass, setMass] = useState(false)
  const [patients, setPatients] = useState(5)
  const isFire = kind === 'fire'
  // Preview only — the backend decides the real count from the active policy.
  const per = Number(policy?.patients_per_ambulance) || 4
  const cap = Number(policy?.max_units) || 10
  const useUnits = (!isFire && mass) ? Math.min(cap, Math.max(2, Math.ceil((Number(patients) || 2) / per))) : 1

  // Tag requests by the stable Cognito `sub` (matches the backend filter).
  const myId = session?.sub || session?.name
  // The backend already scopes /ops to the signed-in user, so just sort what we get.
  // (Fall back to a client filter only if a requestedBy is present and differs.)
  const mine = useMemo(
    () => [...emergencies].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [emergencies])
  const LIVE_STATES = ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK']
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
    <div className="h-screen overflow-hidden bg-cmd-bg text-cmd-text flex flex-col">
      <header className="h-16 bg-accent text-white flex items-center justify-between px-5 shrink-0 sticky top-0 z-40">
        <div className="font-semibold text-[15px]">JSD TATA Emergency Services</div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-white/80 hidden sm:inline">{session?.name || session?.['cognito:username'] || session?.email || session?.sub}</span>
          <button onClick={onSignOut} className="text-[13px] px-3 h-9 rounded-lg bg-white/10 hover:bg-white/20">Sign out</button>
        </div>
      </header>

      {callOpen && <VoiceAgent session={session} onClose={() => setCallOpen(false)} />}

      {error ? (
        <div className="flex-1 grid place-items-center p-6 text-center">
          <div className="panel p-6 max-w-md">
            <div className="h-10 w-10 rounded-xl grid place-items-center mx-auto mb-3"
              style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
              <Icon name="alert" size={20} strokeWidth={1.9} />
            </div>
            <div className="text-[18px] font-semibold mb-1">Service unavailable</div>
            <p className="text-[14px] text-cmd-muted mb-4">{error}</p>
            <button className="btn-primary w-full"
              onClick={() => { useFleetStore.setState({ initialized: false, error: null }); useFleetStore.getState().init() }}>
              Retry connection
            </button>
          </div>
        </div>
      ) : !ready ? (
        <div className="flex-1 min-h-0"><BootScreen /></div>
      ) : (
        // overflow-y-auto below lg: on mobile this stacks map + both asides
        // vertically with no per-panel height constraint, so their combined
        // content height exceeds the viewport — without page-level scroll
        // here, the bottom of the booking form and the entire "Your
        // requests" panel are clipped and completely unreachable (confirmed
        // via a real mobile-width render, ~284px of content inaccessible).
        // Desktop keeps overflow-hidden + per-pane scroll (each aside's own
        // overflow-y-auto below), since the 3-pane layout there is already
        // fully visible without an outer scroll.
        <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
          {/* LEFT — booking + your requests (scrollable) */}
          <aside className="w-full lg:w-[400px] shrink-0 lg:border-r border-cmd-border lg:overflow-y-auto bg-cmd-bg">
            <div className="p-4 space-y-5">
              {/* Request form */}
              <div>
                {/* type tiles */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <TypeTile active={!isFire} onClick={() => setKind('medical')} label="Ambulance" color="#07514D" />
                  <TypeTile active={isFire} onClick={() => setKind('fire')} label="Fire truck" color="#ea580c" />
                </div>

                <Field label={isFire ? 'Incident location' : 'Pickup location'}>
                  <LocationPicker value={pickup} onChange={setPickup} />
                </Field>

                {!isFire && (
                  <Field label="What's the emergency?">
                    <div className="grid grid-cols-3 gap-2">
                      {CASE_TYPES.map((c) => (
                        <button key={c} onClick={() => setCaseType(c)}
                          className={`py-2 rounded-lg border text-[12px] font-medium transition-colors ${caseType === c ? 'border-accent bg-accent/5 text-accent' : 'border-cmd-border bg-white text-cmd-text hover:border-accent/40'}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}

                {!isFire && (
                  <div className="mb-3 rounded-lg border border-cmd-border p-3">
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-[13px] font-medium">Multiple casualties</span>
                      <input type="checkbox" checked={mass} onChange={(e) => setMass(e.target.checked)} className="h-4 w-4 accent-status-danger" />
                    </label>
                    {mass && (
                      <div className="mt-3">
                        <div className="label mb-1">People affected</div>
                        <input type="number" min={2} max={200} value={patients} onChange={(e) => setPatients(e.target.value)}
                          className="bg-white border border-cmd-border rounded-md px-3 py-1.5 w-full" />
                        <div className="mt-1 text-[11px] text-cmd-muted">~{useUnits} ambulance{useUnits > 1 ? 's' : ''} will be dispatched.</div>
                      </div>
                    )}
                  </div>
                )}

                <Field label="Severity">
                  <div className="grid grid-cols-3 gap-2">
                    {SEVERITIES.map((s) => {
                      const m = SEV_META[s] || { color: '#2563eb', hint: '' }
                      const on = severity === s
                      return (
                        <button key={s} onClick={() => setSeverity(s)}
                          className="flex flex-col items-center py-2 rounded-lg border text-[13px] font-semibold transition-colors"
                          style={on ? { background: m.color, borderColor: m.color, color: '#fff' } : { borderColor: '#e2e8f0', background: '#fff' }}>
                          {s}<span className="text-[10px] font-normal mt-0.5" style={{ color: on ? 'rgba(255,255,255,.8)' : '#94a3b8' }}>{m.hint}</span>
                        </button>
                      )
                    })}
                  </div>
                </Field>


                {result && (
                  <div className={`rounded-lg p-3 text-[13px] mt-1 flex items-start gap-2 ${result.ok ? 'bg-green-50 text-status-enroute' : 'bg-red-50 text-status-danger'}`}>
                    <span className="shrink-0 mt-0.5"><Icon name={result.ok ? 'check' : 'alert'} size={15} strokeWidth={2.2} /></span>
                    <span>{result.ok
                      ? (result.mass
                        ? `Mass casualty ${result.id} — ${result.dispatched}/${result.units} ambulances dispatched`
                        : `Help is on the way — ${result.id}${result.vehicle ? ' · ' + result.vehicle : ''}${result.hospital ? ' → ' + result.hospital : ''}`)
                      : result.reason}</span>
                  </div>
                )}
                <button className="btn-primary w-full mt-4 h-12 text-[15px] disabled:opacity-50" disabled={busy} onClick={submit}>
                  {busy ? 'Sending…' : isFire ? 'Book fire truck' : (!isFire && mass) ? `Dispatch ${useUnits} ambulances` : 'Book ambulance'}
                </button>
              </div>
            </div>
          </aside>

          {/* CENTER — large live map with floating Call button */}
          <main className="relative flex-1 order-first lg:order-none min-h-[300px]">
            <TrackMap active={activeMine.filter((e) => e.state === 'EN_ROUTE')} live={live} vehicles={vehicles} hospitals={hospitals} firestations={firestations} />

            {/* floating Call button — bottom right */}
            <button onClick={() => setCallOpen(true)} title="Call for help"
              className="absolute bottom-6 right-6 z-[500] flex items-center gap-3 bg-cta text-accent font-bold rounded-full pl-5 pr-6 h-16 shadow-xl active:scale-[0.97] transition-transform hover:brightness-105">
              <Icon name="phone" size={24} strokeWidth={1.9} />
              <span>Call for help</span>
            </button>
          </main>

          {/* RIGHT — your requests */}
          <aside className="w-full lg:w-[340px] shrink-0 lg:border-l border-cmd-border lg:overflow-y-auto bg-cmd-bg">
            <div className="p-4">
              <h2 className="text-[15px] font-semibold mb-3">Your requests</h2>
              <div className="flex gap-1 mb-3 p-1 bg-brand-light rounded-lg">
                <ReqTab active={reqTab === 'live'} onClick={() => setReqTab('live')} label="Live" count={activeMine.length} />
                <ReqTab active={reqTab === 'completed'} onClick={() => setReqTab('completed')} label="Completed" count={completedMine.length} />
              </div>
              <div className="divide-y divide-cmd-border">
                {shownReqs.length === 0 && <EmptyRequests tab={reqTab} />}
                {shownReqs.map((e) => <RequestCard key={e.id} e={e} vehicles={vehicles} onCancel={cancelRequest} />)}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

/* ---------------- request progress card ---------------- */
const STEPS = ['Requested', 'Unit assigned', 'En route', 'Arrived']
function stepIndex(state) {
  if (state === 'COMPLETED') return 3
  if (state === 'EN_ROUTE') return 2
  if (state === 'QUEUED' || state === 'NO_HOSPITAL' || state === 'NO_BLOODBANK') return 0
  return 0
}
function RequestCard({ e, vehicles, onCancel }) {
  const isF = e.kind === 'fire'
  const hosp = hospitalById(e.hospitalId)
  const accent = isF ? '#ea580c' : '#07514D'
  const veh = vehicles.find((v) => v.id === e.ambulanceId)
  const cancelled = e.state === 'CANCELLED'
  const canCancel = ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK'].includes(e.state)
  const [cancelling, setCancelling] = useState(false)
  async function doCancel() {
    if (!window.confirm(`Cancel ${isF ? 'fire truck' : 'ambulance'} for ${e.id}?`)) return
    setCancelling(true)
    try { await onCancel?.(e.id) } finally { setCancelling(false) }
  }
  const si = stepIndex(e.state)
  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: accent }} />{e.id}</span>
        <StatusChip state={e.state} isFire={isF} />
      </div>
      <div className="mt-1 text-xs text-cmd-muted">
        <span className="text-cmd-text font-medium">{isF ? 'Fire' : e.caseType}</span> · {locById(e.pickup)?.name}
        {veh && <> · <span className="text-cmd-text font-medium">{veh.reg}</span></>}
      </div>

      {!cancelled && (
        <div className="mt-3 flex items-center">
          {STEPS.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex flex-col items-center gap-1" style={{ flex: '0 0 auto' }}>
                <div className="h-5 w-5 rounded-full grid place-items-center text-[10px] font-bold"
                  style={{ background: i <= si ? accent : '#e2e8f0', color: i <= si ? '#fff' : '#94a3b8' }}>
                  {i < si || e.state === 'COMPLETED' ? '✓' : i === si ? '●' : i + 1}
                </div>
                <span className="text-[9px] text-center leading-tight" style={{ color: i <= si ? accent : '#94a3b8', width: 52 }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-0.5 mb-4" style={{ background: i < si ? accent : '#e2e8f0' }} />}
            </React.Fragment>
          ))}
        </div>
      )}

      {e.state === 'EN_ROUTE' && (
        <>
          <div className="mt-3 rounded-lg bg-accent/5 px-3 py-2 text-[13px] text-cmd-text flex items-center justify-between">
            <span>Arriving in <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} className="font-bold text-accent text-[15px]" /></span>
            {!isF && hosp && <span className="text-xs text-cmd-muted">→ {hosp.name}</span>}
          </div>
          {e.traffic && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: e.traffic.color }} />
              <span style={{ color: e.traffic.color }} className="font-medium">{e.traffic.label} traffic</span>
              {e.trafficFactor > 1.05 && <span className="text-cmd-muted">· +{Math.round((e.trafficFactor - 1) * 100)}% delay</span>}
            </div>
          )}
        </>
      )}
      {(e.state === 'QUEUED' || e.state === 'NO_HOSPITAL' || e.state === 'NO_BLOODBANK') && (
        <div className="mt-3 text-xs text-status-maint">
          {e.state === 'NO_HOSPITAL' ? 'No hospital with the right specialty is free right now — still searching, your request stays queued.'
            : e.state === 'NO_BLOODBANK' ? 'No blood bank is available right now — still searching, your request stays queued.'
            : 'Finding the nearest available unit…'}
        </div>
      )}

      {canCancel && (
        <button onClick={doCancel} disabled={cancelling}
          className="mt-3 w-full h-9 rounded-lg border border-red-300 text-status-danger text-[13px] font-medium hover:bg-red-50 disabled:opacity-50 transition-colors">
          {cancelling ? 'Cancelling…' : `Cancel ${isF ? 'fire truck' : 'ambulance'}`}
        </button>
      )}
    </div>
  )
}

const ReqTab = ({ active, onClick, label, count }) => (
  <button onClick={onClick}
    className={`flex-1 text-[13px] font-medium py-1.5 rounded-md transition-colors ${active ? 'bg-white text-accent shadow-sm' : 'text-cmd-muted hover:text-cmd-text'}`}>
    {label}{count > 0 && <span className="ml-1 opacity-70">({count})</span>}
  </button>
)

function EmptyRequests({ tab }) {
  return (
    <div className="py-10 text-center">
      <div className="text-sm font-medium text-cmd-text">{tab === 'completed' ? 'Nothing completed yet' : 'No active requests'}</div>
      <div className="text-xs text-cmd-muted mt-1">{tab === 'completed' ? 'Finished trips will show up here.' : 'Tap “Call for help” or use the form to dispatch a unit.'}</div>
    </div>
  )
}

/* ---------------- searchable location picker ---------------- */
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
        className="w-full flex items-center justify-between bg-white border border-cmd-border rounded-md px-3 py-2.5 text-left text-[14px]">
        <span>{selected?.name || 'Select a location'}</span>
        <span className="text-cmd-muted">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-cmd-border rounded-lg shadow-card overflow-hidden">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="" aria-label="Search location"
            className="w-full px-3 py-2 text-[14px] border-b border-cmd-border outline-none" />
          <div className="max-h-56 overflow-auto">
            {list.length === 0 && <div className="px-3 py-3 text-[13px] text-cmd-muted">No match</div>}
            {list.map((l) => (
              <button key={l.id} type="button" onClick={() => { onChange(l.id); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-[14px] hover:bg-brand-light ${l.id === value ? 'bg-accent/5 text-accent font-medium' : ''}`}>{l.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Live map for the requester: their dispatched ambulance(s)/fire truck(s) moving to
// the scene, with the route and destination. Vehicle position comes from the shared
// store's `live` geometry (animated by the app tick).
function TrackMap({ active, live, vehicles, hospitals, firestations }) {
  const first = active.find((e) => locById(e.pickup)) || active[0]
  const center = (first && locById(first.pickup)) || mapCenter()
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={14} zoomControl={false} className="h-full w-full">
      <TileLayer url={LIGHT_TILES} attribution="&copy; OpenStreetMap" />
      <MapControls className="top-3 right-3" />

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
        const isFire = e.kind === 'fire'
        const veh = vehicles.find((v) => v.id === e.ambulanceId)
        const pos = live[e.ambulanceId]?.pos
        const pickup = locById(e.pickup)
        if (!pickup) return null
        const legColor = isFire ? '#ea580c' : '#2563eb'
        return (
          <React.Fragment key={e.id}>
            {e.leg1?.length > 0 && <Polyline positions={e.leg1} pathOptions={{ color: e.traffic?.color || legColor, weight: 4, opacity: 0.8 }} />}
            {e.leg2?.length > 0 && <Polyline positions={e.leg2} pathOptions={{ color: '#dc2626', weight: 4, opacity: 0.85 }} />}
            <CircleMarker center={[pickup.lat, pickup.lng]} radius={6} pathOptions={{ color: legColor, fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
              <Tooltip>{isFire ? 'Incident' : 'Pickup'} · {pickup.name}</Tooltip>
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

const Field = ({ label, children }) => <div className="mb-3"><div className="label mb-1">{label}</div>{children}</div>
const TypeTile = ({ active, onClick, label, color }) => (
  <button onClick={onClick}
    className={`p-3 rounded-xl border-2 text-center font-semibold text-[14px] transition-colors ${active ? 'text-white' : 'bg-white text-cmd-text border-cmd-border hover:border-accent/40'}`}
    style={active ? { background: color, borderColor: color } : {}}>
    {label}
  </button>
)
function StatusChip({ state, isFire }) {
  const map = {
    EN_ROUTE: ['#16a34a', 'On the way'], COMPLETED: ['#64748b', isFire ? 'Cleared' : 'Arrived'],
    QUEUED: ['#d97706', 'Waiting for a unit'], NO_HOSPITAL: ['#dc2626', 'Finding hospital'], NO_BLOODBANK: ['#dc2626', 'Finding blood bank'], CANCELLED: ['#94a3b8', 'Cancelled'],
  }
  const [c, t] = map[state] || ['#64748b', state]
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${c}22`, color: c }}>{t}</span>
}
