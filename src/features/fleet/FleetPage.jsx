import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Polygon, CircleMarker, Marker, Tooltip } from 'react-leaflet'
import { makeHospitalIcon, makeFirestationIcon } from '../map/vehicleIcon'
import { useFleetStore } from '../../store/useFleetStore'
import { JAMSHEDPUR_CENTER, ZONES, LOCATIONS, zoneById } from '../../data/locations'
import { hospitalById } from '../../data/hospitals'
import PageHeader from '../../components/common/PageHeader'
import { StatusDot, STATUS_COLORS, VehicleIcon, Progress } from '../../components/common/ui.jsx'
import LiveEta from '../../components/common/LiveEta'

const TABS = ['Vehicles', 'Crews', 'Service Zones']
const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const EMERGENCY_TYPES = ['ambulance', 'firetruck']
const SERVICE_INTERVAL_KM = 10000   // service every 10,000 km
const DUE_SOON_KM = 500             // warn within the last 500 km of the cycle

// Odometer-based service schedule: next service at the next 10k boundary.
const serviceInfo = (odometer = 0) => {
  const nextKm = Math.ceil((odometer + 1) / SERVICE_INTERVAL_KM) * SERVICE_INTERVAL_KM
  const remaining = nextKm - odometer
  return { nextKm, remaining, due: remaining <= DUE_SOON_KM }
}

export default function FleetPage() {
  const [tab, setTab] = useState('Vehicles')
  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Fleet & Crews" subtitle="Ambulances · fire trucks · crews · service zones">
        <div className="flex gap-1 panel p-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`btn ${tab === t ? 'bg-accent text-white' : 'text-cmd-muted hover:text-cmd-text'}`}>{t}</button>
          ))}
        </div>
      </PageHeader>
      <div className="flex-1 overflow-auto p-6">
        {tab === 'Vehicles' && <Vehicles />}
        {tab === 'Crews' && <Drivers />}
        {tab === 'Service Zones' && <Zones />}
      </div>
    </div>
  )
}

function Vehicles() {
  const navigate = useNavigate()
  const allVehicles = useFleetStore((s) => s.vehicles)
  const drivers = useFleetStore((s) => s.drivers)
  const emergencies = useFleetStore((s) => s.emergencies)
  const setVehicleStatus = useFleetStore((s) => s.setVehicleStatus)

  const fleet = useMemo(() => allVehicles.filter((v) => EMERGENCY_TYPES.includes(v.type)), [allVehicles])
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [zone, setZone] = useState('all')
  const [q, setQ] = useState('')

  const jobFor = (vid) => emergencies.find((e) => e.ambulanceId === vid && e.state === 'EN_ROUTE')

  // KPIs
  const amb = fleet.filter((v) => v.type === 'ambulance')
  const fire = fleet.filter((v) => v.type === 'firetruck')
  const idle = (l) => l.filter((v) => v.status === 'idle').length
  const respondingIds = new Set(emergencies.filter((e) => e.state === 'EN_ROUTE' && e.ambulanceId).map((e) => e.ambulanceId))
  const responding = fleet.filter((v) => respondingIds.has(v.id)).length
  const crewAvail = drivers.filter((d) => new Set(fleet.map((v) => v.driverId)).has(d.id) && d.status === 'available').length
  const lowFuel = fleet.filter((v) => v.fuel < 25).length
  const svcDue = fleet.filter((v) => serviceInfo(v.odometer).due).length

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return fleet.filter((v) => {
      if (type !== 'all' && v.type !== type) return false
      if (status !== 'all' && v.status !== status) return false
      if (zone !== 'all' && v.homeZoneId !== zone) return false
      if (term) {
        const drv = drivers.find((d) => d.id === v.driverId)
        const hay = [v.reg, v.type, drv?.name].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [fleet, drivers, type, status, zone, q])

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Ambulances" value={`${idle(amb)}/${amb.length}`} sub="available" accent="#07514D" />
        <Kpi label="Fire trucks" value={`${idle(fire)}/${fire.length}`} sub="available" accent="#ea580c" />
        <Kpi label="Responding" value={responding} sub="en route" accent="#16a34a" />
        <Kpi label="Crews free" value={crewAvail} sub="available" accent="#0B6A64" />
        <Kpi label="Low fuel" value={lowFuel} sub="< 25%" accent={lowFuel ? '#dc2626' : '#64748b'} />
        <Kpi label="Service due" value={svcDue} sub={`≤ ${DUE_SOON_KM} km`} accent={svcDue ? '#d97706' : '#64748b'} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg or crew…"
          className="bg-white border border-cmd-border rounded-lg px-3 py-1.5 text-[13px] w-52" />
        <Seg value={type} onChange={setType} options={[['all', 'All types'], ['ambulance', 'Ambulance'], ['firetruck', 'Fire']]} />
        <Seg value={status} onChange={setStatus} options={[['all', 'Any status'], ['idle', 'Idle'], ['enroute', 'En route'], ['maintenance', 'Maint.']]} />
        <select value={zone} onChange={(e) => setZone(e.target.value)} className="bg-white border border-cmd-border rounded-lg px-2.5 py-1.5 text-[13px]">
          <option value="all">All zones</option>
          {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <span className="text-[12px] text-cmd-muted ml-auto">{shown.length} of {fleet.length}</span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map((v) => {
          const drv = drivers.find((d) => d.id === v.driverId)
          const color = STATUS_COLORS[v.status]
          const job = jobFor(v.id)
          const svc = serviceInfo(v.odometer)
          const isFire = v.type === 'firetruck'
          return (
            <div key={v.id} className="panel p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-9 w-9 rounded-md bg-accent/10 text-accent grid place-items-center"><VehicleIcon type={v.type} size={20} /></span>
                  <div>
                    <div className="font-semibold">{v.reg}</div>
                    <div className="text-xs text-cmd-muted capitalize">{v.type} · {zoneById(v.homeZoneId)?.name || '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs capitalize" style={{ color }}>
                  <StatusDot color={color} pulse={v.status === 'enroute'} />{v.status}
                </div>
              </div>

              {/* live assignment */}
              {job && (
                <div className="mt-3 panel-2 p-2 text-xs space-y-1" style={{ borderLeft: `3px solid ${isFire ? '#ea580c' : '#2563eb'}` }}>
                  <div className="flex justify-between"><span className="text-cmd-muted">On job</span><span className="font-medium">{job.id} · {isFire ? 'Fire' : job.caseType}</span></div>
                  <div className="flex justify-between"><span className="text-cmd-muted">{isFire ? 'Scene' : 'Hospital'}</span><span className="text-right">{isFire ? '—' : (hospitalById(job.hospitalId)?.name || '—')}</span></div>
                  <div className="flex justify-between"><span className="text-cmd-muted">ETA</span><span className="text-accent font-medium"><LiveEta etaComplete={job.etaComplete} fallbackMin={job.etaToPickupMin} /></span></div>
                </div>
              )}

              <div className="mt-3 space-y-2 text-sm">
                <Row label="Crew" value={drv ? `${drv.name}${drv.status ? ` · ${drv.status}` : ''}` : 'Unassigned'} />
                <Row label="Odometer" value={`${v.odometer.toLocaleString()} km`} />
                <Row label="Next service" value={<span style={{ color: svc.due ? '#d97706' : undefined }}>{svc.nextKm.toLocaleString()} km · in {svc.remaining.toLocaleString()} km{svc.due ? ' · due' : ''}</span>} />
                <div>
                  <div className="flex justify-between text-xs label"><span>Fuel</span><span className={v.fuel < 25 ? 'text-red-600' : 'text-cmd-text'}>{v.fuel}%</span></div>
                  <Progress value={v.fuel} max={100} color={v.fuel < 25 ? '#ef4444' : '#38bdf8'} />
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button className="btn-ghost text-xs flex-1" onClick={() => navigate(`/map?focus=${v.id}`)}>Locate on map</button>
                {v.status !== 'maintenance'
                  ? <button className="btn-ghost text-xs flex-1" disabled={v.status === 'enroute'} onClick={() => setVehicleStatus(v.id, 'maintenance')}>Maintenance</button>
                  : <button className="btn-primary text-xs flex-1" onClick={() => setVehicleStatus(v.id, 'idle')}>Return to service</button>}
              </div>
            </div>
          )
        })}
        {shown.length === 0 && <div className="panel p-4 text-sm text-cmd-muted">No units match these filters.</div>}
      </div>
    </div>
  )
}

function Drivers() {
  const navigate = useNavigate()
  const allDrivers = useFleetStore((s) => s.drivers)
  const vehicles = useFleetStore((s) => s.vehicles)
  const emergencies = useFleetStore((s) => s.emergencies)
  const [q, setQ] = useState('')

  const fleet = vehicles.filter((v) => EMERGENCY_TYPES.includes(v.type))
  const vehByDriver = new Map(fleet.map((v) => [v.driverId, v]))
  const term = q.trim().toLowerCase()
  const drivers = allDrivers
    .filter((d) => vehByDriver.has(d.id))
    .filter((d) => !term || `${d.name} ${d.license}`.toLowerCase().includes(term))

  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search crew…"
        className="bg-white border border-cmd-border rounded-lg px-3 py-1.5 text-[13px] w-60" />
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cmd-panel2 text-cmd-muted text-xs uppercase">
            <tr><Th>Crew</Th><Th>Licence</Th><Th>Status</Th><Th>Vehicle</Th><Th>Current job</Th><Th></Th></tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const veh = vehByDriver.get(d.id)
              const job = emergencies.find((e) => e.ambulanceId === veh?.id && e.state === 'EN_ROUTE')
              const color = STATUS_COLORS[d.status]
              return (
                <tr key={d.id} className="border-t border-cmd-border hover:bg-cmd-panel2/50">
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-accent/15 grid place-items-center text-accent text-xs font-semibold">
                        {d.name.split(' ').map((p) => p[0]).join('')}
                      </div>{d.name}
                    </div>
                  </Td>
                  <Td>{d.license}</Td>
                  <Td><span className="flex items-center gap-1.5 capitalize" style={{ color }}><StatusDot color={color} />{d.status}</span></Td>
                  <Td className="font-mono text-xs">{veh?.reg || '—'}</Td>
                  <Td className="text-cmd-muted">{job ? `${job.id} · ${job.kind === 'fire' ? 'Fire' : job.caseType}` : '—'}</Td>
                  <Td>{veh && <button className="text-[12px] text-accent hover:underline" onClick={() => navigate(`/map?focus=${veh.id}`)}>Locate</button>}</Td>
                </tr>
              )
            })}
            {drivers.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-cmd-muted">No crew match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Zones() {
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="panel overflow-hidden h-[70vh]">
        <MapContainer center={[JAMSHEDPUR_CENTER.lat, JAMSHEDPUR_CENTER.lng]} zoom={13} className="h-full w-full">
          <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
          {ZONES.map((z) => (
            <Polygon key={z.id} positions={z.polygon} pathOptions={{ color: z.color, weight: 2, fillOpacity: 0.12 }}>
              <Tooltip sticky>{z.name}</Tooltip>
            </Polygon>
          ))}
          {LOCATIONS.map((l) => (
            <CircleMarker key={l.id} center={[l.lat, l.lng]} radius={5}
              pathOptions={{ color: '#38bdf8', fillColor: '#0b0f17', fillOpacity: 1, weight: 2 }}>
              <Tooltip>{l.name}</Tooltip>
            </CircleMarker>
          ))}
          {hospitals.map((h) => (
            <Marker key={h.id} position={[h.lat, h.lng]} icon={makeHospitalIcon(false)}>
              <Tooltip><b>{h.name}</b></Tooltip>
            </Marker>
          ))}
          {firestations.map((f) => (
            <Marker key={f.id} position={[f.lat, f.lng]} icon={makeFirestationIcon()}>
              <Tooltip><b>{f.name}</b></Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">Campus Service Zones</h3>
        {ZONES.map((z) => (
          <div key={z.id} className="panel p-3 flex items-center gap-3">
            <span className="h-4 w-4 rounded" style={{ background: z.color }} />
            <div className="text-sm">{z.name}</div>
          </div>
        ))}
        <p className="text-xs text-cmd-muted">Zones define operational boundaries for dispatch and nearest-unit selection.</p>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wide text-cmd-muted">{label}</div>
      <div className="text-[22px] font-bold leading-tight">{value}</div>
      <div className="text-[11px]" style={{ color: accent }}>{sub}</div>
    </div>
  )
}
const Seg = ({ value, onChange, options }) => (
  <div className="flex gap-1 panel p-1">
    {options.map(([val, lbl]) => (
      <button key={val} onClick={() => onChange(val)}
        className={`px-2.5 py-1 rounded-md text-[12px] ${value === val ? 'bg-accent text-white' : 'text-cmd-muted hover:text-cmd-text'}`}>{lbl}</button>
    ))}
  </div>
)
const Row = ({ label, value }) => (
  <div className="flex justify-between"><span className="label">{label}</span><span>{value}</span></div>
)
const Th = ({ children }) => <th className="text-left font-medium px-4 py-2.5">{children}</th>
const Td = ({ children, className = '' }) => <td className={`px-4 py-2.5 ${className}`}>{children}</td>
