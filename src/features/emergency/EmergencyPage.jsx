import React, { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip } from 'react-leaflet'
import { useFleetStore } from '../../store/useFleetStore'
import { mapCenter, LOCATIONS, locById, bloodBanks, bloodBankById, pickupLabel, fmtPt } from '../../data/locations'
import { hospitalById, CASE_TYPES, SEVERITIES, SEVERITY_META } from '../../data/hospitals'
import { makeVehicleIcon, makeHospitalIcon, makeFirestationIcon } from '../map/vehicleIcon'
import LiveEta from '../../components/common/LiveEta'
import Icon from '../../components/common/Icon'
import AlertsPanel from './AlertsPanel'
import MapControls from '../../components/common/MapControls'
import { useNow } from '../../hooks/useNow'
import { slaTargets, slaStatus, slaText, SLA_COLOR, SLA_LABEL } from '../../services/sla'

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
]

export default function EmergencyPage() {
  const emergencies = useFleetStore((s) => s.emergencies)
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('active')

  // Sidebar "New Emergency" CTA navigates with ?new=1
  useEffect(() => {
    if (params.get('new') === '1') { setOpen(true); setParams({}, { replace: true }) }
  }, [params, setParams])

  // Cards present on first render aren't "new"; later arrivals flash once.
  const seenRef = React.useRef(null)
  if (seenRef.current === null) seenRef.current = new Set(emergencies.map((e) => e.id))
  useEffect(() => { emergencies.forEach((e) => seenRef.current.add(e.id)) }, [emergencies])

  const ACTIVE_STATES = ['EN_ROUTE', 'QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED']

  const counts = useMemo(() => ({
    active: emergencies.filter((e) => ACTIVE_STATES.includes(e.state)).length,
    completed: emergencies.filter((e) => e.state === 'COMPLETED').length,
    all: emergencies.length,
  }), [emergencies])

  const shown = useMemo(() => {
    const match = (e) => filter === 'all'
      || (filter === 'active' && ACTIVE_STATES.includes(e.state))
      || (filter === 'completed' && e.state === 'COMPLETED')
    return [...emergencies].filter(match).sort((a, b) =>
      (SEVERITY_META[a.severity]?.rank - SEVERITY_META[b.severity]?.rank) ||
      (new Date(b.createdAt) - new Date(a.createdAt)))
  }, [emergencies, filter])

  return (
    <div className="relative h-full overflow-hidden page-enter">
      {/* ── Full-screen map ── */}
      <EmergencyMap emergencies={emergencies} />

      {/* ── Floating top header strip ── */}
      <div className="absolute top-4 left-4 right-4 z-[400] px-4 py-2.5 rounded-2xl flex items-center gap-3"
        style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid rgba(255,255,255,0.6)' }}>
        <div className="text-[15px] font-bold text-[#0C1322] leading-tight shrink-0">Emergency Dispatch</div>
        <div className="flex-1" />
        <TrafficControl />
        {counts.active > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0"
            style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
            <span className="h-1.5 w-1.5 rounded-full bg-[#dc2626] animate-pulse" />
            {counts.active} active
          </span>
        )}
        <button onClick={() => setOpen(true)}
          className="h-9 px-4 rounded-xl text-[13px] font-semibold flex items-center gap-2 shrink-0 transition-all hover:brightness-105"
          style={{ background: '#D6DF27', color: '#07514D' }}>
          <Icon name="plus" size={13} strokeWidth={2.5} />
          New Emergency
        </button>
      </div>

      {/* ── Floating emergency list panel (left) ── */}
      <div className="absolute left-4 top-[72px] bottom-4 z-[400] w-[340px] max-w-[calc(100vw-2rem)] flex flex-col gap-3 overflow-hidden"
        style={{ marginTop: '16px' }}>
        {/* Alerts */}
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid rgba(255,255,255,0.6)' }}>
          <AlertsPanel />
        </div>

        {/* Filter + list */}
        <div className="flex-1 rounded-2xl flex flex-col min-h-0"
          style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid rgba(255,255,255,0.6)' }}>
          {/* Filter tabs */}
          <div className="flex gap-1.5 p-3 shrink-0" role="tablist" aria-label="Filter emergencies" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            {FILTERS.map((f) => {
              const isActive = filter === f.key
              return (
                <button key={f.key} onClick={() => setFilter(f.key)} role="tab" aria-selected={isActive}
                  className="flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-all"
                  style={isActive
                    ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 8px rgba(7,81,77,0.25)' }
                    : { background: 'rgba(0,0,0,0.04)', color: '#6B7280' }}>
                  {f.label} <span style={{ opacity: 0.75 }}>{counts[f.key] || 0}</span>
                </button>
              )
            })}
          </div>
          {/* List */}
          <div className="flex-1 overflow-auto px-3 py-2 space-y-2 no-scrollbar">
            {shown.length === 0
              ? (
                <div className="text-center py-8">
                  <div className="text-[13px] text-[#6B7280]">No {filter === 'all' ? '' : filter + ' '}emergencies in this view.</div>
                  {filter !== 'completed' && (
                    <button onClick={() => setOpen(true)}
                      className="mt-3 px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-all hover:brightness-105"
                      style={{ background: '#D6DF27', color: '#07514D' }}>
                      Report new emergency
                    </button>
                  )}
                </div>
              )
              : shown.map((e) => <EmergencyCard key={e.id} em={e} isNew={!seenRef.current.has(e.id)} />)}
          </div>
        </div>
      </div>

      {/* ── Slide-in drawer for new emergency ── */}
      {open && <NewEmergencyDrawer onClose={() => setOpen(false)} />}
    </div>
  )
}

function TrafficControl() {
  const mode = useFleetStore((s) => s.trafficMode)
  const setMode = useFleetStore((s) => s.setTrafficMode)
  return (
    <div className="relative flex items-center gap-1.5 shrink-0 text-[12px] font-medium text-[#374151]">
      <Icon name="traffic" size={13} strokeWidth={1.8} className="text-[#6B7280]" />
      <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Traffic mode"
        className="appearance-none bg-transparent border-0 outline-none pr-5 py-1 text-[12px] font-medium text-[#374151] cursor-pointer min-w-[86px]">
        <option value="auto">Auto</option>
        <option value="clear">Clear</option>
        <option value="moderate">Moderate</option>
        <option value="heavy">Heavy</option>
        <option value="gridlock">Gridlock</option>
      </select>
      <svg className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[#9CA3AF]"
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  )
}

function EmergencyCard({ em, isNew = false }) {
  const vehicles = useFleetStore((s) => s.vehicles)
  const policy = useFleetStore((s) => s.policyConfig)
  const now = useNow(10000)
  const sla = slaStatus(em, slaTargets(policy), now)
  const sev = SEVERITY_META[em.severity]
  const isFire = em.kind === 'fire'
  const isBlood = em.kind === 'blood'
  const veh = vehicles.find((v) => v.id === em.ambulanceId)
  const hosp = hospitalById(em.hospitalId)
  const bank = bloodBankById(em.bloodBankId)
  const pickupName = pickupLabel(em)
  const accent = isFire ? '#ea580c' : isBlood ? '#b91c1c' : sev?.color

  return (
    <div className={`rounded-xl p-3 ${isNew ? 'row-flash' : ''}`}
      style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.06)', backdropFilter: 'blur(8px)' }}>
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-[13px] text-[#0C1322] flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: accent }} />
          {em.id}
        </span>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {em.incidentId && <Badge bg="#fde8e8" color="#dc2626">MCI</Badge>}
          {em.patientsCount > 1 && !isBlood && <Badge bg="#eef2ff" color="#4338ca">{em.patientsCount} pax</Badge>}
          {sla.kind !== 'none' && (
            <Badge bg={`${SLA_COLOR[sla.state]}18`} color={SLA_COLOR[sla.state]} title={`SLA ${sla.target}m`}>{slaText(sla)}</Badge>
          )}
          <Badge bg={`${accent}18`} color={accent}>{isFire ? 'Fire' : isBlood ? 'Blood' : em.severity}</Badge>
        </div>
      </div>

      {/* Details */}
      <div className="mt-1.5 text-[12px] text-[#6B7280]">
        <span className="text-[#374151] font-medium">{isFire ? 'Fire incident' : isBlood ? 'Blood supply' : em.caseType}</span>
        {' · '}{isBlood ? 'from' : 'pickup'} {pickupName}
      </div>

      <StateLine em={em} isFire={isFire} isBlood={isBlood} />

      {/* EN_ROUTE detail box */}
      {em.state === 'EN_ROUTE' && (
        <div className="mt-2 rounded-lg p-2.5 space-y-1.5 text-[12px]"
          style={{ background: 'rgba(7,81,77,0.05)', border: '1px solid rgba(7,81,77,0.08)' }}>
          <div className="flex justify-between gap-2">
            <span className="text-[#6B7280]">{isFire ? 'Fire truck' : 'Ambulance'}</span>
            <span className="text-[#0C1322] font-medium text-right">
              {veh?.reg || '—'} · ETA <LiveEta etaComplete={em.etaComplete} fallbackMin={em.etaToPickupMin} className="font-semibold" />
            </span>
          </div>
          {isBlood
            ? <Line k="Blood bank" v={bank?.name || '—'} />
            : !isFire && <Line k="Hospital" v={hosp?.name || '—'} />}
          {em.traffic && (
            <div className="flex justify-between gap-2">
              <span className="text-[#6B7280]">Traffic</span>
              <span className="font-medium text-right" style={{ color: em.traffic.color }}>
                {em.traffic.label}{em.trafficFactor > 1.05 ? ` ·+${Math.round((em.trafficFactor - 1) * 100)}%` : ''}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-[#6B7280]">Total</span>
            <span className="font-semibold text-[#07514D] text-right">{em.totalDistanceKm.toFixed(1)} km · {Math.round(em.totalEtaMin)} min</span>
          </div>
        </div>
      )}
    </div>
  )
}

const Badge = ({ bg, color, children, title }) => (
  <span title={title} className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
    style={{ background: bg, color }}>{children}</span>
)

function StateLine({ em, isFire, isBlood }) {
  const map = {
    EN_ROUTE: ['#16a34a', isFire ? 'Responding to scene' : isBlood ? 'Collecting & delivering blood' : 'En route'],
    COMPLETED: ['#64748b', isFire ? 'Incident cleared' : isBlood ? 'Blood delivered' : 'Completed at hospital'],
    QUEUED: ['#d97706', `Queued — no ${isFire ? 'fire truck' : 'ambulance'} free`],
    PREEMPTED: ['#dc2626', 'Preempted by Critical case'],
    NO_HOSPITAL: ['#dc2626', 'No facility with specialty + capacity'],
    NO_BLOODBANK: ['#dc2626', 'No blood bank configured'],
  }
  const [c, t] = map[em.state] || ['#64748b', em.state]
  return <div className="mt-1.5 text-xs font-medium" style={{ color: c }}>● {t}</div>
}

const Line = ({ k, v, accent }) => (
  <div className="flex justify-between gap-2"><span className="text-cmd-muted">{k}</span><span className={accent ? 'text-accent font-medium text-right' : 'text-cmd-text text-right'}>{v}</span></div>
)

// Memoized: without this, opening the drawer (a local `open` state toggle in
// the parent) re-renders this whole Leaflet tree — every marker/polyline gets
// re-diffed on the same frames as the slide-in animation, which is what
// caused the stutter. `emergencies` is the only prop and its reference is
// stable unless the store actually changes it.
const EmergencyMap = React.memo(function EmergencyMap({ emergencies }) {
  const live = useFleetStore((s) => s.live)
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)
  const active = emergencies.filter((e) => e.state === 'EN_ROUTE')

  return (
    <MapContainer center={[mapCenter().lat, mapCenter().lng]} zoom={14} zoomControl={false} className="h-full w-full absolute inset-0 z-0">
      <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
      <MapControls className="top-[80px] right-4" />

      {hospitals.map((h) => (
        <Marker key={h.id} position={[h.lat, h.lng]} icon={makeHospitalIcon(false)}>
          <Tooltip><b>{h.name}</b><br />{h.specialties.join(', ')}</Tooltip>
        </Marker>
      ))}

      {firestations.map((f) => (
        <Marker key={f.id} position={[f.lat, f.lng]} icon={makeFirestationIcon()}>
          <Tooltip><b>{f.name}</b><br />Fire station</Tooltip>
        </Marker>
      ))}

      {active.map((e) => <EmergencyRoute key={e.id} e={e} />)}
      {active.map((e) => {
        const veh = vehicles.find((v) => v.id === e.ambulanceId)
        const pos = live[e.ambulanceId]?.pos
        if (!pos || !veh) return null
        return <VehicleMarker key={e.id} e={e} veh={veh} pos={pos} />
      })}
    </MapContainer>
  )
})

// Split from EmergencyMap so the 1s live-position tick only re-renders the
// small moving marker below, not the route (route legs can be hundreds of
// OSRM points and previously got recreated every tick even though they
// don't change between hydrations — this was the real source of the
// drawer-opening stutter, since it competed with the slide animation for
// the same frames). Crucially this component never receives `pos`, so its
// props are stable across ticks and React can skip it entirely.
const EmergencyRoute = React.memo(function EmergencyRoute({ e }) {
  const isFire = e.kind === 'fire'
  const isBlood = e.kind === 'blood'
  const pickup = locById(e.pickup) || e.pickupPt
  if (!pickup) return null
  const pickName = locById(e.pickup)?.name || e.pickupName || fmtPt(e.pickupPt) || 'Pickup'
  const bank = isBlood ? bloodBankById(e.bloodBankId) : null
  const pickColor = isFire ? '#ea580c' : isBlood ? '#b91c1c' : '#2563eb'
  return (
    <>
      {e.leg1?.length > 0 && <Polyline positions={e.leg1} pathOptions={{ color: e.traffic?.color || pickColor, weight: 4, opacity: 0.8 }} />}
      {e.leg2?.length > 0 && <Polyline positions={e.leg2} pathOptions={{ color: isBlood ? '#b91c1c' : '#dc2626', weight: 4, opacity: 0.85 }} />}
      {e.leg3?.length > 0 && <Polyline positions={e.leg3} pathOptions={{ color: '#16a34a', weight: 4, opacity: 0.85, dashArray: '6 6' }} />}
      <CircleMarker center={[pickup.lat, pickup.lng]} radius={6}
        pathOptions={{ color: pickColor, fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
        <Tooltip>{isFire ? 'Fire incident' : isBlood ? 'Hospital' : 'Pickup'} · {pickName}</Tooltip>
      </CircleMarker>
      {bank && (
        <CircleMarker center={[bank.lat, bank.lng]} radius={7}
          pathOptions={{ color: '#b91c1c', fillColor: '#fee2e2', fillOpacity: 1, weight: 2 }}>
          <Tooltip><b>Blood bank</b> · {bank.name}</Tooltip>
        </CircleMarker>
      )}
    </>
  )
})

// The only piece that re-renders every 1s tick — cheap (one marker).
function VehicleMarker({ e, veh, pos }) {
  const isFire = e.kind === 'fire'
  const isBlood = e.kind === 'blood'
  return (
    <Marker position={pos} icon={makeVehicleIcon(veh, false, true)}>
      <Tooltip direction="top" offset={[0, -16]}>{veh.reg} · {isFire ? 'Fire' : isBlood ? 'Blood' : e.severity}</Tooltip>
    </Marker>
  )
}

function NewEmergencyDrawer({ onClose }) {
  const createEmergency = useFleetStore((s) => s.createEmergency)
  const hospitals = useFleetStore((s) => s.hospitals)
  // LOCATIONS/bloodBanks() are populated asynchronously from the backend
  // (a plain module-level `let`, not store state) — computing these at
  // module-import time would freeze them as empty forever. The drawer only
  // renders while open, so recomputing per render is cheap and correct;
  // `hospitals.length` is used purely as a reactive proxy signal that
  // fires once the initial data load has landed.
  const banks = useMemo(() => bloodBanks(), [hospitals.length])
  const bankLabels = useMemo(() => Object.fromEntries(banks.map((b) => [b.id, b.name])), [banks])
  const locationIds = useMemo(() => LOCATIONS.map((l) => l.id), [hospitals.length])
  const locationLabels = useMemo(() => Object.fromEntries(LOCATIONS.map((l) => [l.id, l.name])), [locationIds])
  const hospitalIds = useMemo(() => hospitals.map((h) => h.id), [hospitals])
  const hospitalLabels = useMemo(() => Object.fromEntries(hospitals.map((h) => [h.id, h.name])), [hospitals])
  const [kind, setKind] = useState('medical')
  const [pickup, setPickup] = useState('loc-sakchi')
  const [caseType, setCaseType] = useState('Cardiac')
  const [severity, setSeverity] = useState('Urgent')
  const [patients, setPatients] = useState(1)
  const [massCasualty, setMassCasualty] = useState(false)
  const [units, setUnits] = useState(2)
  const [pickupHosp, setPickupHosp] = useState(hospitals[0]?.id || '')
  const [bloodBank, setBloodBank] = useState(banks[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const isFire = kind === 'fire'
  const isBlood = kind === 'blood'
  const useUnits = !isFire && !isBlood && massCasualty ? Math.max(2, Number(units) || 2) : 1

  // Keyboard support: Escape closes, focus moves into the drawer on open.
  const panelRef = React.useRef(null)
  useEffect(() => {
    panelRef.current?.focus()
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function submit() {
    setBusy(true)
    let r
    if (isBlood) {
      const h = hospitals.find((x) => x.id === pickupHosp)
      r = await createEmergency({ kind: 'blood', severity,
        pickupPoint: { hospital_id: h?.id, name: h?.name, lat: h?.lat, lng: h?.lng }, bloodBank })
    } else {
      r = await createEmergency({ kind, pickup, caseType, severity, patients: Number(patients) || 1, units: useUnits })
    }
    setBusy(false)
    setResult(r)
    if (r.ok) setTimeout(onClose, 1600)
  }

  return (
    <div className="absolute inset-0 z-[500] flex justify-end" style={{ pointerEvents: 'none' }}>
      {/* Dim overlay */}
      <div className="absolute inset-0 drawer-overlay" style={{ background: 'rgba(0,0,0,0.25)', pointerEvents: 'auto' }} onClick={onClose} />

      {/* Drawer — solid (no backdrop-filter): blurring the live map on every
          frame of the slide is what caused the animation to stutter. */}
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="New emergency"
        className="relative flex flex-col w-[380px] max-w-full h-full overflow-auto drawer-panel outline-none"
        style={{ background: '#fff', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', pointerEvents: 'auto', willChange: 'transform' }}>

        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div>
            <div className="text-[16px] font-bold text-[#0C1322]">New Emergency</div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">Nearest unit dispatched automatically</div>
          </div>
          <button onClick={onClose} aria-label="Close drawer"
            className="h-8 w-8 rounded-xl grid place-items-center text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#374151]">
            <Icon name="x" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-4 overflow-auto">
          {/* Type selector */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7280] mb-2">Emergency type</div>
            <div className="grid grid-cols-3 gap-2">
              <TypeBtn active={!isFire && !isBlood} onClick={() => setKind('medical')} icon="medical" label="Ambulance" color="#07514D" />
              <TypeBtn active={isFire} onClick={() => setKind('fire')} icon="flame" label="Fire" color="#ea580c" />
              <TypeBtn active={isBlood} onClick={() => setKind('blood')} icon="droplet" label="Blood" color="#b91c1c" />
            </div>
          </div>

          {/* Context hint */}
          <div className="text-[12px] rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(7,81,77,0.05)', color: '#374151' }}>
            {isFire ? 'Fire trucks respond from the closest fire station.'
              : isBlood ? 'Ambulance runs: hospital → blood bank → hospital.'
              : 'Routed to nearest hospital with matching specialty and free bed.'}
          </div>

          {/* Location fields */}
          {isBlood ? (
            <>
              <DrawerField label="Requesting hospital">
                <DrawerSelect value={pickupHosp} onChange={setPickupHosp} options={hospitalIds} labels={hospitalLabels} />
              </DrawerField>
              <DrawerField label="Destination blood bank">
                {banks.length === 0
                  ? <div className="text-[12px] text-red-600">No blood banks configured.</div>
                  : <DrawerSelect value={bloodBank} onChange={setBloodBank} options={banks.map((b) => b.id)} labels={bankLabels} />}
              </DrawerField>
            </>
          ) : (
            <DrawerField label={isFire ? 'Incident location' : 'Pickup location'}>
              <DrawerSelect value={pickup} onChange={setPickup} options={locationIds} labels={locationLabels} />
            </DrawerField>
          )}

          {!isFire && !isBlood && (
            <DrawerField label="Medical type">
              <DrawerSelect value={caseType} onChange={setCaseType} options={CASE_TYPES} />
            </DrawerField>
          )}

          {!isFire && !isBlood && (
            <div className="grid grid-cols-2 gap-3">
              <DrawerField label="Patients on scene">
                <input type="number" min={1} max={200} value={patients} onChange={(e) => setPatients(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[13px] text-[#0C1322]"
                  style={{ background: '#E8E8EE', border: '1px solid #E5E7EB' }} />
              </DrawerField>
              <DrawerField label="Mass casualty">
                <label className="flex items-center gap-2 h-[38px] text-[13px] text-[#374151] cursor-pointer">
                  <input type="checkbox" checked={massCasualty} onChange={(e) => setMassCasualty(e.target.checked)} className="rounded" />
                  Multi-ambulance
                </label>
              </DrawerField>
            </div>
          )}

          {!isFire && !isBlood && massCasualty && (
            <DrawerField label="Ambulances to dispatch">
              <input type="number" min={2} max={10} value={units} onChange={(e) => setUnits(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-[13px] text-[#0C1322]"
                style={{ background: '#E8E8EE', border: '1px solid #E5E7EB' }} />
            </DrawerField>
          )}

          {/* Severity */}
          <DrawerField label={isBlood ? 'Priority' : 'Severity'}>
            <div className="flex gap-2">
              {SEVERITIES.map((s) => {
                const activeColor = s === 'Critical' ? '#dc2626' : s === 'Urgent' ? '#d97706' : '#2563eb'
                const isActive = severity === s
                return (
                  <button key={s} onClick={() => setSeverity(s)}
                    className="flex-1 h-9 rounded-xl text-[13px] font-semibold transition-all"
                    style={isActive
                      ? { background: activeColor, color: '#fff', boxShadow: `0 2px 10px ${activeColor}40` }
                      : { background: '#E8E8EE', color: '#6B7280' }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </DrawerField>

          {/* Result feedback */}
          {result && (
            <div className="rounded-xl p-3 text-[12px] font-medium"
              style={{ background: result.ok ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', color: result.ok ? '#16a34a' : '#dc2626' }}>
              {result.ok
                ? (result.mass
                  ? `Incident ${result.id} — ${result.dispatched}/${result.units} ambulances dispatched`
                  : `Dispatched ${result.id} — ${result.vehicle}${result.hospital ? ' → ' + result.hospital : ''}${result.bloodBank ? ' → ' + result.bloodBank : ''}`)
                : result.reason}
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div className="px-5 py-4 shrink-0 flex gap-2" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl text-[13px] font-medium text-[#6B7280] transition-colors hover:brightness-95"
            style={{ background: '#E8E8EE' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || (isBlood && banks.length === 0)}
            className="flex-1 h-10 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50"
            style={{ background: '#D6DF27', color: '#07514D' }}>
            {busy ? 'Routing…' : isFire ? 'Dispatch fire truck' : isBlood ? 'Dispatch blood run' : useUnits > 1 ? `Dispatch ${useUnits} ambulances` : 'Dispatch ambulance'}
          </button>
        </div>
      </div>
    </div>
  )
}

const DrawerField = ({ label, children }) => (
  <div>
    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#6B7280] mb-1.5">{label}</div>
    {children}
  </div>
)
const DrawerSelect = ({ value, onChange, options, labels }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-xl px-3 py-2 text-[13px] text-[#0C1322]"
    style={{ background: '#E8E8EE', border: '1px solid #E5E7EB' }}>
    {options.map((o) => <option key={o} value={o}>{labels ? labels[o] : o}</option>)}
  </select>
)
const TypeBtn = ({ active, onClick, icon, label, color }) => (
  <button onClick={onClick} aria-pressed={active}
    className="h-10 rounded-xl text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5"
    style={active
      ? { background: color, color: '#fff', boxShadow: `0 2px 10px ${color}40` }
      : { background: '#E8E8EE', color: '#6B7280' }}>
    {icon && <Icon name={icon} size={14} strokeWidth={2} />}
    {label}
  </button>
)
