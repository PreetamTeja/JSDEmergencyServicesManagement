import React, { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, Polygon, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { useFleetStore } from '../../store/useFleetStore'
import { JAMSHEDPUR_CENTER, LOCATIONS, ZONES, zoneById, locById } from '../../data/locations'
import { hospitalById } from '../../data/hospitals'
import { zonePoolCounts } from '../../services/dispatchService'
import { makeVehicleIcon, makeHospitalIcon, makeFirestationIcon } from './vehicleIcon'
import { STATUS_COLORS, VehicleIcon } from '../../components/common/ui.jsx'
import VehiclePanel from './VehiclePanel'

const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const EMERGENCY_TYPES = ['ambulance', 'firetruck']
const TYPE_ORDER = ['ambulance', 'firetruck']
const TYPE_SHORT = { ambulance: 'amb', firetruck: 'fire' }

export default function LiveMapPage() {
  const allVehicles = useFleetStore((s) => s.vehicles)
  const drivers = useFleetStore((s) => s.drivers)
  const live = useFleetStore((s) => s.live)
  const emergencies = useFleetStore((s) => s.emergencies)
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)
  const vehicles = useMemo(() => allVehicles.filter((v) => EMERGENCY_TYPES.includes(v.type)), [allVehicles])
  const [params] = useSearchParams()
  const [selectedId, setSelectedId] = useState(() => params.get('focus'))
  // Re-focus if navigated here again with a different ?focus= id.
  useEffect(() => { const f = params.get('focus'); if (f) setSelectedId(f) }, [params])
  const [showZones, setShowZones] = useState(true)
  const [showLegend, setShowLegend] = useState(false)
  const [showFleet, setShowFleet] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [hoveredZone, setHoveredZone] = useState(null)
  const toggleZone = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // emergency ambulance ids (priority styling)
  const emAmbIds = useMemo(
    () => new Set(emergencies.filter((e) => e.state === 'EN_ROUTE').map((e) => e.ambulanceId)),
    [emergencies])

  // idle vehicles cluster at their home-zone reference point (jittered).
  const positioned = useMemo(() => vehicles.map((v, i) => {
    const l = live[v.id]
    if (l?.pos) return { ...v, pos: l.pos, isLive: true }
    const z = zoneById(v.homeZoneId) || ZONES[0]
    const a = (i % 6) - 2.5
    const b = ((i * 7) % 6) - 2.5
    return { ...v, pos: [z.ref.lat + a * 0.0012, z.ref.lng + b * 0.0012], isLive: false }
  }), [vehicles, live])

  const counts = zonePoolCounts(vehicles)
  const vehiclesByZone = useMemo(() => {
    const m = {}; vehicles.forEach((v) => { (m[v.homeZoneId] = m[v.homeZoneId] || []).push(v) }); return m
  }, [vehicles])

  // current active job + destination for a vehicle (for the hover dialog)
  const jobFor = (vid) => {
    const e = emergencies.find((x) => x.ambulanceId === vid && x.state === 'EN_ROUTE')
    if (e) {
      if (e.kind === 'fire') return { label: `Fire ${e.id}`, dest: locById(e.pickup)?.name }
      return { label: `Emergency ${e.id} · ${e.caseType}`, dest: hospitalById(e.hospitalId)?.name }
    }
    return null
  }
  const activeEm = emergencies.filter((e) => e.state === 'EN_ROUTE')
  const selected = positioned.find((v) => v.id === selectedId)
  const totals = {
    enroute: vehicles.filter((v) => v.status === 'enroute').length,
    idle: vehicles.filter((v) => v.status === 'idle').length,
    maintenance: vehicles.filter((v) => v.status === 'maintenance').length,
  }

  return (
    <div className="relative h-full">
      <MapContainer center={[JAMSHEDPUR_CENTER.lat, JAMSHEDPUR_CENTER.lng]} zoom={JAMSHEDPUR_CENTER.zoom}
        zoomControl={false} className="h-full w-full">
        <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
        <FlyTo pos={selected?.pos} />

        {showZones && ZONES.map((z) => {
          const hot = hoveredZone === z.id
          return (
            <Polygon key={z.id} positions={z.polygon}
              pathOptions={{ color: z.color, weight: hot ? 3 : 1.5, fillOpacity: hot ? 0.28 : 0.08 }}>
              <Tooltip sticky>{z.name} zone</Tooltip>
            </Polygon>
          )
        })}

        {LOCATIONS.map((l) => (
          <CircleMarker key={l.id} center={[l.lat, l.lng]} radius={4}
            pathOptions={{ color: '#07514D', fillColor: '#ffffff', fillOpacity: 1, weight: 1.5 }} />
        ))}

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

        {/* emergency routes: leg1 (to scene) dashed, leg2 (ambulance → hospital) red */}
        {activeEm.map((e) => {
          const legColor = e.kind === 'fire' ? '#ea580c' : '#2563eb'
          return (
            <React.Fragment key={e.id}>
              {e.leg1?.length > 0 && <Polyline positions={e.leg1} pathOptions={{ color: e.traffic?.color || legColor, weight: 4, opacity: 0.8 }} />}
              {e.leg2?.length > 0 && <Polyline positions={e.leg2} pathOptions={{ color: '#dc2626', weight: 4, opacity: 0.85 }} />}
            </React.Fragment>
          )
        })}

        {positioned.map((v) => {
          const job = jobFor(v.id)
          const driver = drivers.find((d) => d.id === v.driverId)
          const color = emAmbIds.has(v.id) ? '#dc2626' : STATUS_COLORS[v.status]
          return (
            <Marker key={v.id} position={v.pos} icon={makeVehicleIcon(v, v.id === selectedId, emAmbIds.has(v.id))}
              eventHandlers={{ click: () => setSelectedId(v.id) }}>
              <Tooltip direction="top" offset={[0, -16]} className="veh-tip" opacity={1}>
                <div className="min-w-[180px]">
                  <div className="flex items-center justify-between gap-3 pb-1.5 mb-1.5 border-b border-cmd-border">
                    <span className="flex items-center gap-1.5 font-semibold text-[13px]">
                      <span style={{ color }}><VehicleIcon type={v.type} size={15} /></span>{v.reg}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] capitalize" style={{ color }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                      {v.status === 'enroute' ? 'en route' : v.status}
                    </span>
                  </div>
                  <Info k="Type" v={v.type} cap />
                  <Info k="Driver" v={driver?.name || 'Unassigned'} />
                  <Info k="Job" v={job ? job.label : 'None'} />
                  {job?.dest && <Info k="Destination" v={job.dest} />}
                  <Info k="Fuel" v={`${v.fuel}%`} />
                </div>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>

      {/* bottom-right toggles: Fleet panel + Legend (panels expand above the buttons) */}
      <div className="absolute bottom-4 right-4 z-[500] flex flex-col items-end gap-2">
        {showFleet && (
          <div className="panel bg-white/95 text-black w-80 max-h-[70vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-cmd-border">
              <div className="label mb-2">Live Fleet · Jamshedpur</div>
              <div className="flex gap-4 text-sm">
                <Legend color={STATUS_COLORS.enroute} label="En route" n={totals.enroute} />
                <Legend color={STATUS_COLORS.idle} label="Idle" n={totals.idle} />
                <Legend color={STATUS_COLORS.maintenance} label="Maint." n={totals.maintenance} />
              </div>
              <label className="mt-2.5 flex items-center gap-1.5 text-xs text-cmd-muted cursor-pointer">
                <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Show zones
              </label>
            </div>
            <div className="px-4 pt-2.5 pb-1 label">Zone Fleet Pools</div>
            <div className="flex-1 overflow-auto px-2 pb-2">
              {counts.map(({ zone, byType, idleCount }) => {
                const open = expanded.has(zone.id)
                const pool = (vehiclesByZone[zone.id] || []).slice().sort((a, b) => a.type.localeCompare(b.type))
                return (
                  <div key={zone.id} onMouseEnter={() => setHoveredZone(zone.id)} onMouseLeave={() => setHoveredZone(null)}>
                    <button onClick={() => toggleZone(zone.id)}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-cmd-panel2 transition-colors text-left">
                      <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: zone.color }} />
                      <span className="font-medium text-[13px] flex-1">{zone.name}</span>
                      <span className="flex items-center gap-1.5 text-cmd-muted">
                        {TYPE_ORDER.filter((t) => byType[t]).map((t) => (
                          <span key={t} className="inline-flex items-center gap-0.5" title={TYPE_SHORT[t]}>
                            <VehicleIcon type={t} size={13} /><span className="text-[11px]">{byType[t]}</span>
                          </span>
                        ))}
                        {idleCount === 0 && <span className="text-[11px]">none free</span>}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`text-cmd-muted transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                    {open && (
                      <div className="ml-3 pl-3 border-l border-cmd-border space-y-0.5 pb-1.5">
                        {pool.map((v) => (
                          <button key={v.id} onClick={() => setSelectedId(v.id)}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-[12px] hover:bg-cmd-panel2 text-left">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[v.status] }} />
                            <span className="text-accent"><VehicleIcon type={v.type} size={13} /></span>
                            <span className="font-mono flex-1 truncate">{v.reg}</span>
                            <span className="text-cmd-muted capitalize">{v.status === 'enroute' ? 'en route' : v.status}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {showLegend && (
          <div className="panel bg-white/95 text-black px-4 py-3 w-56">
            <div className="label mb-2">Legend</div>
            <div className="space-y-1.5 text-xs">
              <Key dot="#16a34a" label="Unit · responding" />
              <Key dot="#64748b" label="Unit · idle" />
              <Key dot="#d97706" label="Unit · maintenance" />
              <Key dot="#dc2626" label="Unit · on emergency" />
              <Key sq="#dc2626" label="Hospital" />
              <Key sq="#ea580c" label="Fire station" />
              <Key ring="#07514D" label="Location" />
              <div className="pt-1.5 mt-1.5 border-t border-cmd-border label">Zones</div>
              {ZONES.map((z) => <Key key={z.id} sq={z.color} label={z.name} />)}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFleet((v) => !v)}
            title={showFleet ? 'Hide Live Fleet' : 'Show Live Fleet'} aria-label="Toggle live fleet panel"
            className={`h-10 px-3 inline-flex items-center gap-1.5 rounded-full shadow-lg text-[13px] font-medium transition-colors ${
              showFleet ? 'bg-accent text-white hover:bg-accent-glow' : 'bg-white text-cmd-text border border-cmd-border hover:bg-cmd-panel2'}`}>
            <VehicleIcon type="ambulance" size={16} /> Live Fleet
          </button>
          <button onClick={() => setShowLegend((v) => !v)}
            title="Legend" aria-label="Toggle legend"
            className="h-10 w-10 grid place-items-center rounded-full bg-accent text-white shadow-lg hover:bg-accent-glow">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showLegend ? 'rotate-180' : ''}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {selected && (
        <div className="absolute top-4 right-4 bottom-4 z-[500] w-80">
          <VehiclePanel vehicle={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  )
}

// Pan/zoom the map to a focused vehicle (used by Fleet's "Locate on map").
function FlyTo({ pos }) {
  const map = useMap()
  useEffect(() => { if (pos) map.flyTo(pos, 15, { duration: 0.8 }) }, [pos && pos[0], pos && pos[1]])
  return null
}

function Info({ k, v, cap }) {
  return (
    <div className="flex justify-between gap-3 text-[12px] leading-5">
      <span className="text-cmd-muted">{k}</span>
      <span className={`text-cmd-text text-right ${cap ? 'capitalize' : ''}`}>{v}</span>
    </div>
  )
}

function Key({ dot, sq, ring, label }) {
  return (
    <div className="flex items-center gap-2">
      {dot && <span className="h-3 w-3 rounded-full shrink-0" style={{ background: dot }} />}
      {sq && <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: sq }} />}
      {ring && <span className="h-3 w-3 rounded-full bg-white shrink-0" style={{ border: `2px solid ${ring}` }} />}
      <span className="text-cmd-muted">{label}</span>
    </div>
  )
}

function Legend({ color, label, n }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-cmd-muted">{label}</span>
      <span className="font-semibold">{n}</span>
    </div>
  )
}
