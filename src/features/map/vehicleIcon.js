import L from 'leaflet'
import { STATUS_COLORS } from '../../components/common/ui.jsx'
import { vehicleSvgString } from '../../components/common/VehicleIcon.jsx'

export function makeVehicleIcon(vehicle, selected, priority) {
  const color = priority ? '#dc2626' : (STATUS_COLORS[vehicle.status] || '#64748b')
  const ring = selected
    ? `box-shadow:0 0 0 2px #fff, 0 0 0 4px ${color}, 0 2px 8px rgba(16,24,40,0.25);`
    : `box-shadow:0 0 0 2px #fff, 0 1px 4px rgba(16,24,40,0.25);`
  const cls = priority ? 'vehicle-marker amb-pulse' : 'vehicle-marker'
  const d = priority ? 26 : 22
  return L.divIcon({
    className: cls,
    html: `<div style="display:grid;place-items:center;width:${d}px;height:${d}px;border-radius:50%;
      background:${color};${ring}">${vehicleSvgString(vehicle.type, '#ffffff')}</div>`,
    iconSize: [d, d],
    iconAnchor: [d / 2, d / 2],
  })
}

export function makeFirestationIcon() {
  const color = '#ea580c'
  return L.divIcon({
    className: '',
    html: `<div style="display:grid;place-items:center;width:22px;height:22px;border-radius:5px;
      background:#fff;border:1.5px solid ${color};box-shadow:0 1px 3px rgba(16,24,40,0.2)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3c2 3 4 4.5 4 8a4 4 0 0 1-8 0c0-2 1-3 1.5-4C10.5 8 12 6 12 3Z"/></svg></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  })
}

export function makeHospitalIcon(full) {
  const color = full ? '#94a3b8' : '#dc2626'
  return L.divIcon({
    className: '',
    html: `<div style="display:grid;place-items:center;width:22px;height:22px;border-radius:5px;
      background:#fff;border:1.5px solid ${color};box-shadow:0 1px 3px rgba(16,24,40,0.2)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round">
      <path d="M12 6v12M6 12h12"/></svg></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  })
}
