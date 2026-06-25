// Frontend data layer. When VITE_API_URL is set, the app talks to the AWS
// backend (API Gateway -> Lambda -> DynamoDB). When unset, the app stays in
// mock mode (the in-memory store). This is the single swap point.
import { getToken } from '../auth'

const BASE = import.meta.env.VITE_API_URL || ''
export const API_ENABLED = !!BASE

// SECURITY: the browser authenticates with the user's Cognito JWT only.
// API keys are for server-to-server callers (e.g. the hospital app) and must
// never be shipped in the frontend bundle.
async function req(path, opts = {}) {
  const bearer = getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let detail = {}
    try { detail = await res.json() } catch {}
    throw new Error(detail.message || `API ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  // reference
  getLocations: () => req('/reference/locations'),
  getZones: () => req('/reference/zones'),
  getHospitals: () => req('/reference/hospitals'),
  getFirestations: () => req('/reference/firestations').catch(() => []),
  getPolicy: () => req('/reference/policy'),
  getHealth: () => req('/health').catch(() => ({})),
  getPowerbiToken: () => req('/powerbi/embed-token'),
  // Public tokenized live tracking (no auth) — for shareable links.
  getTrack: (id, token) => req(`/track/${id}?t=${encodeURIComponent(token || '')}`),
  // operational reads
  getFleet: () => req('/fleet'),
  getOps: () => req('/ops'),
  // mutations
  setVehicleStatus: (id, status) => req(`/fleet/${id}/status`, { method: 'POST', body: { status } }),
  cancelRequest: (id) => req(`/requests/${id}/cancel`, { method: 'POST' }),
  createEmergency: (payload) => req('/emergencies', { method: 'POST', body: payload }),
  uploadPolicy: (content_base64, filename) => req('/policy', { method: 'POST', body: { content_base64, filename } }),
  reassignEmergency: (id, payload) => req(`/emergencies/${id}/reassign`, { method: 'POST', body: payload }),
  writeRoute: (id, payload) => req(`/emergencies/${id}/route`, { method: 'POST', body: payload }),
}

// Normalize DynamoDB fleet items (snake_case keys) to the shape the UI uses.
export function normalizeVehicle(v) {
  return {
    id: v.id, reg: v.reg, type: v.type, status: v.status,
    driverId: v.driver_id, homeZoneId: v.home_zone_id,
    odometer: v.odometer, fuel: v.fuel, nextService: v.next_service, routeId: v.route_id,
  }
}
export function normalizeDriver(d) {
  return { id: d.id, name: d.name, license: d.license, status: d.status, homeZoneId: d.home_zone_id, assignment: d.assignment }
}
