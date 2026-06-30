import React, { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip } from 'react-leaflet'
import { useFleetStore } from '../../store/useFleetStore'
import { JAMSHEDPUR_CENTER, LOCATIONS, locById, bloodBanks, bloodBankById, pickupLabel, fmtPt } from '../../data/locations'
import { hospitalById, CASE_TYPES, SEVERITIES, SEVERITY_META } from '../../data/hospitals'
import { makeVehicleIcon, makeHospitalIcon, makeFirestationIcon } from '../map/vehicleIcon'
import PageHeader from '../../components/common/PageHeader'
import { Modal } from '../../components/common/ui.jsx'
import LiveEta from '../../components/common/LiveEta'
import AlertsPanel from './AlertsPanel'
import { useNow } from '../../hooks/useNow'
import { slaTargets, slaStatus, slaText, SLA_COLOR, SLA_LABEL } from '../../services/sla'

const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

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
    <div className="flex flex-col h-full">
      <PageHeader title="Emergency Dispatch" subtitle="Ambulance + fire response · automatic nearest-unit dispatch">
        <TrafficControl />
        <button className="btn-primary" onClick={() => setOpen(true)}>+ New Emergency</button>
      </PageHeader>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px] overflow-hidden">
        <EmergencyMap emergencies={emergencies} />
        <div className="overflow-auto border-l border-cmd-border p-4 order-first lg:order-none">
          <AlertsPanel />
          <div className="flex flex-wrap gap-1.5 mb-2">
            {FILTERS.map((f) => {
              const active = filter === f.key
              return (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${
                    active ? 'bg-accent text-white border-accent' : 'bg-white border-cmd-border text-cmd-text hover:bg-cmd-panel2'}`}>
                  {f.label}<span className={`ml-1 ${active ? 'text-white/80' : 'text-cmd-muted'}`}>{counts[f.key] || 0}</span>
                </button>
              )
            })}
          </div>
          <div className="divide-y divide-cmd-border">
            {shown.map((e) => <EmergencyCard key={e.id} em={e} />)}
          </div>
        </div>
      </div>

      {open && <NewEmergencyModal onClose={() => setOpen(false)} />}
    </div>
  )
}

function TrafficControl() {
  const mode = useFleetStore((s) => s.trafficMode)
  const setMode = useFleetStore((s) => s.setTrafficMode)
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-cmd-muted">
      <span>🚦 Traffic</span>
      <select value={mode} onChange={(e) => setMode(e.target.value)}
        className="bg-white border border-cmd-border rounded-md px-2 py-1 text-[12px] text-cmd-text">
        <option value="auto">Auto (live)</option>
        <option value="clear">Clear</option>
        <option value="moderate">Moderate</option>
        <option value="heavy">Heavy</option>
        <option value="gridlock">Gridlock</option>
      </select>
    </label>
  )
}

function EmergencyCard({ em }) {
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
    <div className="py-3 first:pt-0">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: accent }} />{em.id}</span>
        <div className="flex items-center gap-1">
          {em.incidentId && <span className="chip" style={{ background: '#fde8e8', color: '#dc2626' }}>MCI</span>}
          {em.patientsCount > 1 && !isBlood && <span className="chip" style={{ background: '#eef2ff', color: '#4338ca' }}>{em.patientsCount} pax</span>}
          {sla.kind !== 'none' && (
            <span className="chip" title={`SLA ${sla.target}m · ${SLA_LABEL[sla.state]}`}
              style={{ background: `${SLA_COLOR[sla.state]}1a`, color: SLA_COLOR[sla.state] }}>{slaText(sla)}</span>
          )}
          <span className="chip" style={{ background: `${accent}1a`, color: accent }}>{isFire ? 'Fire' : isBlood ? 'Blood' : em.severity}</span>
        </div>
      </div>
      <div className="mt-1 text-xs text-cmd-muted">
        <span className="text-cmd-text font-medium">{isFire ? 'Fire incident' : isBlood ? 'Blood supply' : em.caseType}</span> · {isBlood ? 'from' : 'pickup'} {pickupName}
      </div>
      <StateLine em={em} isFire={isFire} isBlood={isBlood} />
      {em.state === 'EN_ROUTE' && (
        <div className="mt-2 panel-2 p-2 space-y-1 text-xs">
          <div className="flex justify-between gap-2"><span className="text-cmd-muted">{isFire ? 'Fire truck' : 'Ambulance'}</span>
            <span className="text-cmd-text text-right">{veh?.reg || '—'} · ETA <LiveEta etaComplete={em.etaComplete} fallbackMin={em.etaToPickupMin} className="font-medium" /></span></div>
          {isBlood ? <Line k="Blood bank" v={bank ? bank.name : '—'} /> : !isFire && <Line k="Hospital" v={hosp ? `${hosp.name}` : '—'} />}
          {em.traffic && (
            <div className="flex justify-between gap-2"><span className="text-cmd-muted">Traffic</span>
              <span className="text-right font-medium" style={{ color: em.traffic.color }}>
                {em.traffic.label}{em.trafficFactor > 1.05 ? ` · +${Math.round((em.trafficFactor - 1) * 100)}%` : ''}
              </span></div>
          )}
          <Line k="Total" v={`${em.totalDistanceKm.toFixed(1)} km · ${Math.round(em.totalEtaMin)} min`} accent />
        </div>
      )}
    </div>
  )
}

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

function EmergencyMap({ emergencies }) {
  const live = useFleetStore((s) => s.live)
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)
  const active = emergencies.filter((e) => e.state === 'EN_ROUTE')

  return (
    <MapContainer center={[JAMSHEDPUR_CENTER.lat, JAMSHEDPUR_CENTER.lng]} zoom={13} zoomControl={false} className="h-full w-full">
      <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />

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

      {active.map((e) => {
        const isFire = e.kind === 'fire'
        const isBlood = e.kind === 'blood'
        const veh = vehicles.find((v) => v.id === e.ambulanceId)
        const pos = live[e.ambulanceId]?.pos
        const pickup = locById(e.pickup) || e.pickupPt
        if (!pickup) return null
        const pickName = locById(e.pickup)?.name || e.pickupName || fmtPt(e.pickupPt) || 'Pickup'
        const bank = isBlood ? bloodBankById(e.bloodBankId) : null
        const pickColor = isFire ? '#ea580c' : isBlood ? '#b91c1c' : '#2563eb'
        return (
          <React.Fragment key={e.id}>
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
            {pos && veh && (
              <Marker position={pos} icon={makeVehicleIcon(veh, false, true)}>
                <Tooltip direction="top" offset={[0, -16]}>{veh.reg} · {isFire ? 'Fire' : isBlood ? 'Blood' : e.severity}</Tooltip>
              </Marker>
            )}
          </React.Fragment>
        )
      })}
    </MapContainer>
  )
}

function NewEmergencyModal({ onClose }) {
  const createEmergency = useFleetStore((s) => s.createEmergency)
  const hospitals = useFleetStore((s) => s.hospitals)
  const banks = bloodBanks()
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
    <Modal open title="New Emergency" onClose={onClose}>
      <p className="text-xs text-cmd-muted mb-3">
        No approval needed — the nearest available unit is dispatched automatically.
        {isFire ? ' Fire trucks respond from the closest fire station.'
          : isBlood ? ' An ambulance runs a round trip: hospital → blood bank → back to the hospital.'
          : ' Ambulances are routed to the nearest hospital with the right specialty and a free bed.'}
      </p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <TypeBtn active={!isFire && !isBlood} onClick={() => setKind('medical')} label="Ambulance" color="#07514D" />
        <TypeBtn active={isFire} onClick={() => setKind('fire')} label="Fire" color="#ea580c" />
        <TypeBtn active={isBlood} onClick={() => setKind('blood')} label="Blood" color="#b91c1c" />
      </div>

      <div className="space-y-3 text-sm">
        {isBlood ? (
          <>
            <Field label="Requesting hospital (pickup)">
              <Select value={pickupHosp} onChange={setPickupHosp} options={hospitals.map((h) => h.id)}
                labels={Object.fromEntries(hospitals.map((h) => [h.id, h.name]))} />
            </Field>
            <Field label="Destination blood bank">
              {banks.length === 0
                ? <div className="text-xs text-status-danger">No blood banks configured. Add Locations with type=bloodbank.</div>
                : <Select value={bloodBank} onChange={setBloodBank} options={banks.map((b) => b.id)}
                    labels={Object.fromEntries(banks.map((b) => [b.id, b.name]))} />}
            </Field>
          </>
        ) : (
          <Field label={isFire ? 'Incident location' : 'Pickup location (quarters / pinned)'}>
            <Select value={pickup} onChange={setPickup} options={LOCATIONS.map((l) => l.id)}
              labels={Object.fromEntries(LOCATIONS.map((l) => [l.id, l.name]))} />
          </Field>
        )}
        {!isFire && !isBlood && (
          <Field label="Medical emergency type">
            <Select value={caseType} onChange={setCaseType} options={CASE_TYPES} />
          </Field>
        )}
        {!isFire && !isBlood && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Patients on scene">
              <input type="number" min={1} max={200} value={patients} onChange={(e) => setPatients(e.target.value)}
                className="bg-white border border-cmd-border rounded-md px-3 py-1.5 w-full" />
            </Field>
            <Field label="Mass casualty">
              <label className="flex items-center gap-2 h-[34px] text-[13px] cursor-pointer">
                <input type="checkbox" checked={massCasualty} onChange={(e) => setMassCasualty(e.target.checked)} />
                Dispatch multiple ambulances
              </label>
            </Field>
          </div>
        )}
        {!isFire && !isBlood && massCasualty && (
          <Field label="Ambulances to dispatch">
            <input type="number" min={2} max={10} value={units} onChange={(e) => setUnits(e.target.value)}
              className="bg-white border border-cmd-border rounded-md px-3 py-1.5 w-full" />
          </Field>
        )}
        <Field label={isBlood ? 'Priority' : 'Severity'}>
          <div className="flex gap-2">
            {SEVERITIES.map((s) => (
              <button key={s} onClick={() => setSeverity(s)}
                className={`btn flex-1 border text-[13px] ${severity === s ? 'text-white' : 'text-cmd-text border-cmd-border bg-white'}`}
                style={severity === s ? { background: s === 'Critical' ? '#dc2626' : s === 'Urgent' ? '#d97706' : '#2563eb', borderColor: 'transparent' } : {}}>{s}</button>
            ))}
          </div>
        </Field>
        {result && (
          <div className={`panel-2 p-2.5 text-xs ${result.ok ? 'text-status-enroute' : 'text-status-danger'}`}>
            {result.ok
              ? (result.mass
                ? `Incident ${result.id} — ${result.dispatched}/${result.units} ambulances dispatched`
                : `Dispatched ${result.id} — ${result.vehicle}${result.hospital ? ' → ' + result.hospital : ''}${result.bloodBank ? ' → ' + result.bloodBank : ''}`)
              : result.reason}
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-primary disabled:opacity-50" disabled={busy || (isBlood && banks.length === 0)} onClick={submit}>
          {busy ? 'Routing…' : isFire ? 'Dispatch fire truck →' : isBlood ? 'Dispatch blood run →' : useUnits > 1 ? `Dispatch ${useUnits} ambulances →` : 'Dispatch ambulance →'}
        </button>
      </div>
    </Modal>
  )
}

const Field = ({ label, children }) => (
  <div><div className="label mb-1">{label}</div>{children}</div>
)
const Select = ({ value, onChange, options, labels }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className="bg-white border border-cmd-border rounded-md px-3 py-1.5 w-full">
    {options.map((o) => <option key={o} value={o}>{labels ? labels[o] : o}</option>)}
  </select>
)
const TypeBtn = ({ active, onClick, label, color }) => (
  <button onClick={onClick}
    className={`h-11 rounded-lg border-2 font-medium text-[14px] transition-colors ${active ? 'text-white' : 'bg-white text-cmd-text border-cmd-border'}`}
    style={active ? { background: color, borderColor: color } : {}}>
    {label}
  </button>
)
