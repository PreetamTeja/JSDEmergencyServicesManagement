import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Polygon, CircleMarker, Marker, Tooltip } from 'react-leaflet'
import { makeHospitalIcon, makeFirestationIcon } from '../map/vehicleIcon'
import { useFleetStore } from '../../store/useFleetStore'
import { JAMSHEDPUR_CENTER, ZONES, LOCATIONS, zoneById } from '../../data/locations'
import { hospitalById } from '../../data/hospitals'
import { StatusDot, STATUS_COLORS, VehicleIcon, Progress } from '../../components/common/ui.jsx'
import { makeVehicleIcon } from '../map/vehicleIcon'
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
    <div className="flex flex-col h-full" style={{ background: '#E8E8EE' }}>
      {/* Floating tab header */}
      <div className="px-6 pt-5 pb-4 flex items-center gap-4 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-[#0C1322]">Fleet & Crews</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Ambulances · fire trucks · crews · service zones</p>
        </div>
        <div className="flex gap-1.5 p-1 rounded-2xl shrink-0"
          style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-xl text-[13px] font-semibold transition-all"
              style={tab === t
                ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 8px rgba(7,81,77,0.25)' }
                : { color: '#6B7280' }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
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
  const live = useFleetStore((s) => s.live)
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)
  const setVehicleStatus = useFleetStore((s) => s.setVehicleStatus)

  const fleet = useMemo(() => allVehicles.filter((v) => EMERGENCY_TYPES.includes(v.type)), [allVehicles])
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')
  const [zone, setZone] = useState('all')
  const [q, setQ] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)

  const jobFor = (vid) => emergencies.find((e) => e.ambulanceId === vid && e.state === 'EN_ROUTE')

  const amb = fleet.filter((v) => v.type === 'ambulance')
  const fire = fleet.filter((v) => v.type === 'firetruck')
  const idleCount = (l) => l.filter((v) => v.status === 'idle').length
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

  const positioned = useMemo(() => fleet.map((v, i) => {
    const l = live[v.id]
    if (l?.pos) return { ...v, pos: l.pos }
    const z = zoneById(v.homeZoneId) || ZONES[0]
    const a = (i % 6) - 2.5; const b = ((i * 7) % 6) - 2.5
    return { ...v, pos: [z.ref.lat + a * 0.0012, z.ref.lng + b * 0.0012] }
  }), [fleet, live])

  return (
    <div className="relative h-full overflow-hidden">
      {/* ── Full-screen fleet map ── */}
      <MapContainer center={[JAMSHEDPUR_CENTER.lat, JAMSHEDPUR_CENTER.lng]} zoom={14}
        zoomControl={false} className="absolute inset-0 z-0 h-full w-full">
        <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
        {ZONES.map((z) => (
          <Polygon key={z.id} positions={z.polygon} pathOptions={{ color: z.color, weight: 1.5, fillOpacity: 0.08 }} />
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
        {positioned.map((v) => {
          const job = jobFor(v.id)
          const driver = drivers.find((d) => d.id === v.driverId)
          return (
            <Marker key={v.id} position={v.pos}
              icon={makeVehicleIcon ? makeVehicleIcon(v, false, respondingIds.has(v.id)) : undefined}
              eventHandlers={{ click: () => navigate(`/map?focus=${v.id}`) }}>
              <Tooltip direction="top" offset={[0, -16]} className="veh-tip" opacity={1}>
                <div className="text-[12px]">
                  <div className="font-bold">{v.reg}</div>
                  <div className="text-[#6B7280] capitalize">{v.status}{driver ? ` · ${driver.name}` : ''}</div>
                  {job && <div className="text-[#07514D] font-medium mt-0.5">{job.id}</div>}
                </div>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Gradient fade when panel is open */}
      {panelOpen && (
        <div className="absolute left-[420px] top-0 bottom-0 w-32 z-[5] pointer-events-none"
          style={{ background: 'linear-gradient(to right, rgba(245,246,248,0.4) 0%, transparent 100%)' }} />
      )}

      {/* ── Floating vehicle list panel ── */}
      <div className={`absolute left-4 top-4 bottom-4 z-[400] transition-all duration-300 overflow-hidden flex flex-col ${panelOpen ? 'w-[400px]' : 'w-0 opacity-0'}`}
        style={{ borderRadius: '20px', background: panelOpen ? 'rgba(255,255,255,0.93)' : 'transparent', backdropFilter: panelOpen ? 'blur(20px)' : 'none', WebkitBackdropFilter: panelOpen ? 'blur(20px)' : 'none', boxShadow: panelOpen ? '0 4px 32px rgba(0,0,0,0.13)' : 'none' }}>

        {panelOpen && (<>
          {/* KPIs */}
          <div className="px-4 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div className="text-[15px] font-bold text-[#0C1322] mb-3">Fleet Status</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Ambulances', val: `${idleCount(amb)}/${amb.length}`, sub: 'idle', color: '#07514D' },
                { label: 'Fire trucks', val: `${idleCount(fire)}/${fire.length}`, sub: 'idle', color: '#ea580c' },
                { label: 'Responding', val: responding, sub: 'en route', color: '#16a34a' },
                { label: 'Crews free', val: crewAvail, sub: 'available', color: '#0B6A64' },
                { label: 'Low fuel', val: lowFuel, sub: '< 25%', color: lowFuel ? '#dc2626' : '#9CA3AF' },
                { label: 'Svc due', val: svcDue, sub: `≤${DUE_SOON_KM}km`, color: svcDue ? '#d97706' : '#9CA3AF' },
              ].map((k) => (
                <div key={k.label} className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(0,0,0,0.03)' }}>
                  <div className="text-[20px] font-bold leading-none" style={{ color: k.color }}>{k.val}</div>
                  <div className="text-[10px] text-[#9CA3AF] mt-0.5 leading-tight">{k.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="px-4 py-2.5 shrink-0 flex gap-2 flex-wrap" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div className="relative flex-1">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg or crew…"
                className="w-full pl-7 pr-3 py-1.5 rounded-xl text-[12px] text-[#0C1322]"
                style={{ background: 'rgba(0,0,0,0.04)' }} />
            </div>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="rounded-xl px-2.5 py-1.5 text-[12px] text-[#374151]"
              style={{ background: 'rgba(0,0,0,0.04)' }}>
              <option value="all">All types</option>
              <option value="ambulance">Ambulance</option>
              <option value="firetruck">Fire</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl px-2.5 py-1.5 text-[12px] text-[#374151]"
              style={{ background: 'rgba(0,0,0,0.04)' }}>
              <option value="all">Any status</option>
              <option value="idle">Idle</option>
              <option value="enroute">En route</option>
              <option value="maintenance">Maint.</option>
            </select>
          </div>

          {/* Vehicle table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0" style={{ background: 'rgba(255,255,255,0.95)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <tr>
                  {['Unit', 'Status', 'Driver', 'Fuel', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => {
                  const drv = drivers.find((d) => d.id === v.driverId)
                  const job = jobFor(v.id)
                  const svc = serviceInfo(v.odometer)
                  const isFire = v.type === 'firetruck'
                  const statColor = v.status === 'enroute' ? '#16a34a' : v.status === 'maintenance' ? '#d97706' : '#07514D'
                  const typeColor = isFire ? '#ea580c' : '#2563eb'
                  return (
                    <tr key={v.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
                      onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.03)'}
                      onMouseLeave={ev => ev.currentTarget.style.background = ''}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ background: `${typeColor}12`, color: typeColor }}>
                            <VehicleIcon type={v.type} size={14} />
                          </span>
                          <div>
                            <div className="font-bold text-[#0C1322]">{v.reg}</div>
                            <div className="text-[10.5px] text-[#9CA3AF] capitalize">{zoneById(v.homeZoneId)?.name || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize"
                          style={{ background: `${statColor}14`, color: statColor }}>
                          {v.status === 'enroute' ? 'En route' : v.status}
                        </span>
                        {job && <div className="text-[10px] text-[#9CA3AF] mt-0.5">{job.id}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-[#374151]">{drv?.name || <span className="text-[#9CA3AF]">—</span>}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)', minWidth: '40px' }}>
                            <div className="h-full rounded-full" style={{ width: `${v.fuel}%`, background: v.fuel < 25 ? '#ef4444' : '#07514D' }} />
                          </div>
                          <span className="text-[10.5px] font-medium shrink-0" style={{ color: v.fuel < 25 ? '#dc2626' : '#6B7280' }}>{v.fuel}%</span>
                        </div>
                        {svc.due && <div className="text-[9.5px] text-[#d97706] mt-0.5">Svc due</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={() => navigate(`/map?focus=${v.id}`)}
                            className="h-6 px-2 rounded-lg text-[10.5px] font-medium transition-colors"
                            style={{ background: 'rgba(7,81,77,0.08)', color: '#07514D' }}
                            onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.15)'}
                            onMouseLeave={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.08)'}>Locate</button>
                          {v.status !== 'maintenance'
                            ? <button onClick={() => setVehicleStatus(v.id, 'maintenance')} disabled={v.status === 'enroute'}
                                className="h-6 px-2 rounded-lg text-[10.5px] font-medium disabled:opacity-40 transition-colors"
                                style={{ background: 'rgba(217,119,6,0.08)', color: '#d97706' }}
                                onMouseEnter={ev => !ev.currentTarget.disabled && (ev.currentTarget.style.background = 'rgba(217,119,6,0.15)')}
                                onMouseLeave={ev => ev.currentTarget.style.background = 'rgba(217,119,6,0.08)'}>Maint.</button>
                            : <button onClick={() => setVehicleStatus(v.id, 'idle')}
                                className="h-6 px-2 rounded-lg text-[10.5px] font-medium transition-colors"
                                style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>Return</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px]" style={{ color: '#9CA3AF' }}>No units match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] shrink-0" style={{ color: '#9CA3AF', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            {shown.length} of {fleet.length} units
          </div>
        </>)}
      </div>

      {/* Toggle button */}
      <button onClick={() => setPanelOpen((o) => !o)}
        className="absolute z-[400] flex items-center gap-2 transition-all"
        style={{
          top: '16px',
          left: panelOpen ? '432px' : '16px',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          borderRadius: '12px',
          padding: '8px 14px',
          fontSize: '12.5px',
          fontWeight: 600,
          color: '#07514D',
        }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
          style={{ transform: panelOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}>
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        {panelOpen ? 'Hide list' : 'Show fleet list'}
      </button>
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
    <div className="px-6 pb-6 space-y-4 overflow-auto h-full">
      <div className="relative w-60">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search crew…"
          className="pl-9 pr-4 py-2 rounded-xl text-[13px] text-[#0C1322] w-full"
          style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.07)' }} />
      </div>
      <div className="overflow-hidden" style={{ background: 'rgba(255,255,255,0.92)', borderRadius: '20px', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <table className="w-full text-[13px]">
          <thead style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <tr><Th>Crew</Th><Th>Licence</Th><Th>Status</Th><Th>Vehicle</Th><Th>Current job</Th><Th></Th></tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const veh = vehByDriver.get(d.id)
              const job = emergencies.find((e) => e.ambulanceId === veh?.id && e.state === 'EN_ROUTE')
              const statColor = STATUS_COLORS[d.status]
              return (
                <tr key={d.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.03)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = ''}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full grid place-items-center text-[12px] font-bold shrink-0"
                        style={{ background: 'rgba(7,81,77,0.1)', color: '#07514D' }}>
                        {d.name.split(' ').map((p) => p[0]).join('')}
                      </div>
                      <span className="font-medium text-[#0C1322]">{d.name}</span>
                    </div>
                  </Td>
                  <Td>{d.license}</Td>
                  <Td>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold capitalize"
                      style={{ background: `${statColor}14`, color: statColor }}>
                      {d.status}
                    </span>
                  </Td>
                  <Td className="font-mono text-[12px] font-semibold text-[#0C1322]">{veh?.reg || '—'}</Td>
                  <Td style={{ color: '#6B7280' }}>{job ? `${job.id} · ${job.kind === 'fire' ? 'Fire' : job.caseType}` : '—'}</Td>
                  <Td>
                    {veh && (
                      <button onClick={() => navigate(`/map?focus=${veh.id}`)}
                        className="px-3 py-1 rounded-xl text-[11px] font-semibold transition-colors"
                        style={{ background: 'rgba(7,81,77,0.08)', color: '#07514D' }}
                        onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.15)'}
                        onMouseLeave={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.08)'}>Locate</button>
                    )}
                  </Td>
                </tr>
              )
            })}
            {drivers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: '#9CA3AF' }}>No crew match.</td></tr>
            )}
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

const Row = ({ label, value }) => (
  <div className="flex justify-between text-[13px]">
    <span className="text-[#9CA3AF]">{label}</span>
    <span className="text-[#374151] text-right">{value}</span>
  </div>
)
const Th = ({ children }) => (
  <th className="text-left px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>{children}</th>
)
const Td = ({ children, className = '' }) => (
  <td className={`px-4 py-2.5 text-[13px] text-[#374151] ${className}`}>{children}</td>
)
