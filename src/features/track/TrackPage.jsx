import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker } from 'react-leaflet'
import L from 'leaflet'
import { api } from '../../services/api'
import { getRoute } from '../../services/osrm'
import { useNow } from '../../hooks/useNow'
import MapControls from '../../components/common/MapControls'

const TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

// Combines the vehicle dot and its label into a single divIcon (one DOM
// node Leaflet repositions as a unit) instead of a CircleMarker + a
// separate `permanent` Tooltip pane — the two-pane version visibly
// flickers/detaches from the marker mid zoom-animation since Leaflet
// repositions the marker and tooltip panes independently.
function vehicleLabelIcon(color, emoji, label) {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:140px;height:46px;">
      <div style="position:absolute;left:70px;top:30px;width:18px;height:18px;transform:translate(-50%,-50%);
        border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(16,24,40,0.35);"></div>
      <div style="position:absolute;left:70px;top:22px;transform:translate(-50%,-100%);white-space:nowrap;
        background:#fff;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:600;color:#1f2937;
        box-shadow:0 1px 4px rgba(16,24,40,0.25);">${emoji} ${label}</div>
    </div>`,
    iconSize: [140, 46],
    iconAnchor: [70, 30],
  })
}

const STATUS = {
  EN_ROUTE: ['#16a34a', 'On the way'],
  COMPLETED: ['#64748b', 'Arrived'],
  QUEUED: ['#d97706', 'Finding a unit'],
  NO_HOSPITAL: ['#d97706', 'Finding a facility'],
  NO_BLOODBANK: ['#d97706', 'Finding a blood bank'],
  PREEMPTED: ['#dc2626', 'Reassigned'],
  CANCELLED: ['#94a3b8', 'Cancelled'],
}

// 0..1 trip progress from the ETA clock.
// Anchored on created_at + eta_complete, both stable once dispatched — NOT
// eta_min/eta_to_pickup_min, which legitimately keep refreshing (traffic-
// adjusted recompute on every poll). This mirrors the same fix applied to
// the console's Dispatch Board (RequestsPage.jsx's progressOf): deriving
// "start" from a fluctuating total against a fixed eta_complete produced
// non-monotonic jumps. This page has its own separate fraction() (a public,
// unauthenticated tracking link, not sharing the console's store), so it
// needed the same fix applied independently.
function fraction(d, now) {
  if (!d) return 0
  if (d.status === 'COMPLETED') return 1
  if (['QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK', 'PREEMPTED', 'CANCELLED'].includes(d.status)) return 0
  const start = d.created_at ? new Date(d.created_at).getTime() : null
  const end = d.eta_complete ? d.eta_complete * 1000 : null
  if (start && end && end > start && !isNaN(start)) {
    return Math.min(1, Math.max(0, (now - start) / (end - start)))
  }
  return 0.5
}

export default function TrackPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') || params.get('token')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [route, setRoute] = useState([]) // [[lat,lng]...]
  const now = useNow(1000)
  const routeKey = useRef('')

  // Poll status every 5s.
  useEffect(() => {
    let alive = true
    async function load() {
      try { const d = await api.getTrack(id, token); if (alive) { setData(d); setError(null) } }
      catch (e) { if (alive) setError(e.message || 'Tracking link invalid') }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [id, token])

  // (Re)compute the road route whenever the points change.
  useEffect(() => {
    if (!data) return
    const pts = [data.origin, data.pickup, data.destination].filter(Boolean)
    const key = pts.map((p) => `${p.lat},${p.lng}`).join('|')
    if (!pts.length || key === routeKey.current) return
    routeKey.current = key
    getRoute(pts.map((p) => ({ lat: p.lat, lng: p.lng }))).then((r) => setRoute(r.coordinates || []))
  }, [data])

  const frac = fraction(data, now)
  const pos = useMemo(() => {
    if (!route.length) return data?.origin ? [data.origin.lat, data.origin.lng] : null
    const i = Math.min(route.length - 1, Math.max(0, Math.round(frac * (route.length - 1))))
    return route[i]
  }, [route, frac, data])

  if (error) return (
    <div className="h-screen grid place-items-center bg-cmd-bg p-6 text-center">
      <div className="panel p-6 max-w-sm">
        <div className="text-3xl mb-2">🔗</div>
        <div className="text-lg font-semibold mb-1">Tracking unavailable</div>
        <div className="text-sm text-cmd-muted">{error}</div>
      </div>
    </div>
  )
  if (!data) return (
    <div className="h-screen grid place-items-center bg-cmd-bg">
      <div className="flex items-center gap-3 text-cmd-muted">
        <span className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" /> Loading live tracking…
      </div>
    </div>
  )

  const isFire = data.kind === 'fire'
  const accent = isFire ? '#ea580c' : data.kind === 'blood' ? '#b91c1c' : '#07514D'
  const [sc, sl] = STATUS[data.status] || ['#64748b', data.status]
  const etaMin = Math.max(0, Math.ceil((data.eta_complete ? (data.eta_complete * 1000 - now) / 60000 : data.eta_to_pickup_min) || 0))
  const center = pos || (data.pickup ? [data.pickup.lat, data.pickup.lng] : (data.destination ? [data.destination.lat, data.destination.lng] : [22.80, 86.20]))
  const legColor = isFire ? '#ea580c' : '#2563eb'

  return (
    <div className="h-screen flex flex-col bg-cmd-bg">
      <header className="h-14 bg-accent text-white flex items-center justify-between px-4 shrink-0">
        <div className="font-semibold text-[15px]">JSD TATA Emergency · Live tracking</div>
        <span className="text-[12px] text-white/80">{data.id}</span>
      </header>

      <div className="relative flex-1">
        <MapContainer center={center} zoom={13} zoomControl={false} className="h-full w-full">
          <TileLayer url={TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
          <MapControls className="top-3 right-3" />
          {route.length > 0 && <Polyline positions={route} pathOptions={{ color: legColor, weight: 5, opacity: 0.8 }} />}
          {data.origin && (
            <CircleMarker center={[data.origin.lat, data.origin.lng]} radius={6}
              pathOptions={{ color: '#64748b', fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
              <Tooltip>{data.origin.label || 'Origin'}</Tooltip>
            </CircleMarker>
          )}
          {data.pickup && (
            <CircleMarker center={[data.pickup.lat, data.pickup.lng]} radius={6}
              pathOptions={{ color: legColor, fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
              <Tooltip>{data.pickup.label || 'Pickup'}</Tooltip>
            </CircleMarker>
          )}
          {data.destination && (
            <CircleMarker center={[data.destination.lat, data.destination.lng]} radius={7}
              pathOptions={{ color: '#16a34a', fillColor: '#dcfce7', fillOpacity: 1, weight: 2 }}>
              <Tooltip>{data.destination.label || 'Destination'}</Tooltip>
            </CircleMarker>
          )}
          {pos && <Marker position={pos} icon={vehicleLabelIcon(accent, isFire ? '🚒' : '🚑', data.vehicle?.reg || 'Unit')} />}
        </MapContainer>

        {/* Status card. z-[1000]: same fix as MapControls.jsx — Leaflet's
            zoom-animation transform on its own panes visually promotes them
            above normal-flow siblings, hiding this card behind the map
            except for a one-frame flash mid-zoom, without an explicit
            z-index higher than Leaflet's internal panes (max 700). */}
        <div className="absolute left-3 right-3 bottom-3 sm:left-4 sm:bottom-4 sm:right-auto sm:w-80 z-[1000] bg-white rounded-xl shadow-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-[15px]">{isFire ? '🚒 Fire response' : data.kind === 'blood' ? '🩸 Blood delivery' : '🚑 Ambulance'}</span>
            <span className="px-2 py-0.5 rounded-full text-[12px] font-medium" style={{ background: `${sc}22`, color: sc }}>{sl}</span>
          </div>
          <div className="text-[13px] text-cmd-muted mb-3">
            {data.severity ? `${data.severity} · ` : ''}{data.vehicle?.reg ? `Unit ${data.vehicle.reg}` : 'Assigning unit'}
          </div>

          {data.status === 'EN_ROUTE' && (
            <div className="rounded-lg bg-accent/5 px-3 py-2 mb-3 flex items-baseline justify-between">
              <span className="text-[13px] text-cmd-text">Arriving in</span>
              <span className="font-bold text-accent text-[18px]">{etaMin} min</span>
            </div>
          )}

          {/* progress bar */}
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${Math.round(frac * 100)}%`, background: accent }} />
          </div>
          {data.destination && <div className="mt-2 text-[12px] text-cmd-muted truncate">→ {data.destination.label}</div>}
        </div>
      </div>
    </div>
  )
}
