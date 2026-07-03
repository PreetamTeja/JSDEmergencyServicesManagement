// Geo reference (locations + zones) is loaded at runtime from the API
// (DynamoDB ReferenceData). Nothing is hardcoded here except the map view config.
import { haversine } from '../services/osrm'

// Map view configuration (not domain data) - where the Leaflet map opens.
export const JAMSHEDPUR_CENTER = { lat: 22.7596, lng: 86.2029, zoom: 13 }

// Live bindings - populated by setGeoReference() during app init.
export let LOCATIONS = []
export let ZONES = []

export function setGeoReference(locations = [], zones = []) {
  LOCATIONS = locations
  ZONES = zones
}

export const locById = (id) => LOCATIONS.find((l) => l.id === id)
export const zoneById = (id) => ZONES.find((z) => z.id === id)

// Exact center between the loaded zones' reference points — a function
// (not a cached constant) because ZONES loads asynchronously after this
// module first evaluates; falls back to JAMSHEDPUR_CENTER until it does.
export function mapCenter() {
  if (!ZONES.length) return JAMSHEDPUR_CENTER
  const lat = ZONES.reduce((s, z) => s + z.ref.lat, 0) / ZONES.length
  const lng = ZONES.reduce((s, z) => s + z.ref.lng, 0) / ZONES.length
  return { lat, lng, zoom: JAMSHEDPUR_CENTER.zoom }
}

// Blood banks are Locations tagged type="bloodbank" (one per zone).
export const bloodBanks = () => LOCATIONS.filter((l) => l.type === 'bloodbank')
export const bloodBankById = (id) => LOCATIONS.find((l) => l.id === id && l.type === 'bloodbank')

// Format a {lat,lng} point for display.
export const fmtPt = (p) => (p && typeof p.lat === 'number' && typeof p.lng === 'number')
  ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : null
// Human label for an emergency's pickup: saved-location name, else a given name,
// else raw lat/lng (unnamed location), else the ref/dash.
export const pickupLabel = (e) =>
  locById(e?.pickup)?.name || e?.pickupName || fmtPt(e?.pickupPt) || e?.pickup || '—'

// Zones ranked by straight-line distance from a {lat,lng} point (nearest first).
export function zonesByProximity(point) {
  return [...ZONES]
    .map((z) => ({ zone: z, km: haversine([point.lat, point.lng], [z.ref.lat, z.ref.lng]) }))
    .sort((a, b) => a.km - b.km)
}
