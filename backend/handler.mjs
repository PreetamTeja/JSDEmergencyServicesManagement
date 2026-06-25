/* =====================================================================
   PSIOG Transport API - single Lambda (HTTP API v2, payload format 2.0).
   AWS SDK v3 is preinstalled in the nodejs20.x runtime.
   Tables (env overridable): TransportRequests, Fleet, ShuttleCards, ReferenceData
   ===================================================================== */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand,
  PutCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { verifyJwt, isAdminClaims, identityOf, JWT_ENABLED } from './auth.mjs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { randomUUID } from 'crypto'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const TBL = {
  ops: process.env.TBL_REQUESTS || 'TransportRequests',
  fleet: process.env.TBL_FLEET || 'Fleet',
  cards: process.env.TBL_CARDS || 'ShuttleCards',
  ref: process.env.TBL_REF || 'ReferenceData',
  // Dedicated locations table: PK = location_id (unique per place).
  locations: process.env.TBL_LOCATIONS || 'Locations',
  // Shared org-wide employee directory, owned by HR/IAM. Transport only reads it.
  employees: process.env.EMP_TABLE || 'Employees',
}

// Locked-down CORS: only configured origins are reflected. Set ALLOWED_ORIGINS to a
// comma-separated list of your CloudFront URLs (default '*' for local/dev only).
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean)
const baseCors = (origin) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-headers': 'content-type,authorization,x-api-key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'vary': 'Origin',
  'content-type': 'application/json',
})
let RESP_CORS = baseCors('*')
function setCors(event) {
  const origin = event.headers?.origin || event.headers?.Origin
  if (ALLOWED.includes('*')) RESP_CORS = baseCors('*')
  else if (origin && ALLOWED.includes(origin)) RESP_CORS = baseCors(origin)
  else RESP_CORS = baseCors(ALLOWED[0] || 'null')
}
const ok = (body, code = 200) => ({ statusCode: code, headers: RESP_CORS, body: JSON.stringify(body) })
const err = (code, codeStr, message, extra = {}) => ok({ code: codeStr, message, ...extra }, code)

// API keys: { "<key>": "<source>" }. If empty, auth is disabled (open).
const API_KEYS = (() => { try { return JSON.parse(process.env.API_KEYS || '{}') } catch { return {} } })()
const KEYS_ON = Object.keys(API_KEYS).length > 0
const callerSource = (event) => {
  const k = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key']
  return API_KEYS[k] || null
}
// Which POST resources each source may call. CONSOLE (dispatcher app) = all.
const SCOPES = {
  CONSOLE: '*',
  HOSPITAL: ['emergencies'],
  EDUCATION: ['requests'],
  DELIVERY: ['requests'],
  ADMIN: ['requests'],
  HR: ['bookings'],
}
const canPost = (source, resource) => {
  const allow = SCOPES[source]
  return allow === '*' || (Array.isArray(allow) && allow.includes(resource))
}

/* ---------- input validation (reject malformed/oversized writes) ---------- */
const KINDS = ['medical', 'fire', 'blood']
const SEVS = ['Critical', 'Urgent', 'Normal']
const str = (v, max = 120) => typeof v === 'string' && v.length <= max
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
function validateEmergency(b) {
  if (b.kind != null && !KINDS.includes(b.kind)) return 'invalid kind'
  if (b.severity != null && !SEVS.includes(b.severity)) return 'invalid severity'
  const units = b.units != null ? Number(b.units) : 1
  if (!Number.isInteger(units) || units < 1 || units > 10) return 'invalid units'
  const patients = b.patients != null ? Number(b.patients) : 1
  if (!Number.isInteger(patients) || patients < 1 || patients > 1000) return 'invalid patients'
  const p = b.pickup
  if (!p || typeof p !== 'object') return 'pickup required'
  if (p.ref != null && !str(p.ref, 80)) return 'invalid pickup.ref'
  if (p.lat != null && !inRange(Number(p.lat), -90, 90)) return 'invalid pickup.lat'
  if (p.lng != null && !inRange(Number(p.lng), -180, 180)) return 'invalid pickup.lng'
  if (p.ref == null && (p.lat == null || p.lng == null)) return 'pickup needs ref or lat/lng'
  if (b.blood_bank_id != null && !str(b.blood_bank_id, 80)) return 'invalid blood_bank_id'
  if (b.note != null && !str(b.note, 500)) return 'note too long'
  if (b.requested_by != null && !str(b.requested_by, 120)) return 'invalid requested_by'
  if (b.contact != null) {
    if (typeof b.contact !== 'object') return 'invalid contact'
    if (b.contact.phone != null && !/^\+[1-9]\d{6,14}$/.test(String(b.contact.phone))) return 'phone must be E.164 (e.g. +9198…)'
    if (b.contact.email != null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.contact.email))) return 'invalid email'
  }
  return null
}

/* ---------- reference cache (warm-invocation reuse) ---------- */
let _ref = null
async function loadRef() {
  if (_ref) return _ref
  const [loc, zone, hosp, fire] = await Promise.all([
    // Locations live in ReferenceData under PK="LOC" (no separate Locations table).
    ddb.send(new QueryCommand({ TableName: TBL.ref, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'LOC' } })),
    ddb.send(new QueryCommand({ TableName: TBL.ref, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'ZONE' } })),
    ddb.send(new QueryCommand({ TableName: TBL.ref, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'HOSP' } })),
    ddb.send(new QueryCommand({ TableName: TBL.ref, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'FIRE' } })),
  ])
  // Expose a stable `id` (SK is the location id) for the rest of the app.
  const locations = (loc.Items || []).map((l) => ({ ...l, id: l.id || l.SK || l.location_id }))
  _ref = { locations, zones: zone.Items || [], hospitals: hosp.Items || [], firestations: fire.Items || [] }
  return _ref
}
const locById = (ref, id) => ref.locations.find((l) => l.id === id)

/* ---------- geo ---------- */
const R = 6371
function havKm(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
const zonesByProximity = (ref, p) => [...ref.zones].map((z) => ({ z, d: havKm(p, z.ref) })).sort((a, b) => a.d - b.d)
function resolvePickup(ref, pickup) {
  if (pickup?.ref) { const l = locById(ref, pickup.ref); return l ? { lat: l.lat, lng: l.lng } : null }
  if (typeof pickup?.lat === 'number') return { lat: pickup.lat, lng: pickup.lng }
  return null
}

/* ---------- shared Employees table mapping ----------
   FP-EMPLOYEE-TABLE-M schema (PK = employee_id, e.g. "EMP-OPS-00001"):
     first_name, last_name, employee_job_level ("L1".."L12"), employee_band (0-4),
     department_id, department_name, employee_title, status,
     housing_type, residence_name, unit_number, floor_number, block_name, gate_number, zone, ...
   The app needs: { id, name, job_level, band, grade, dept, status, housing }. */

// "L7" -> 7 ; tolerant of plain numbers too.
const jobLevelNum = (v) => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0 }

// Policy is re-keyed by job level: policy.levels is a list of bands, each with a
// min_level. The band for an employee = highest band whose min_level <= job level.
async function policyLevels() {
  const r = await ddb.send(new QueryCommand({ TableName: TBL.ref, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'POLICY' }, ScanIndexForward: false, Limit: 1 }))
  return (r.Items?.[0]?.levels) || []
}
function bandForLevel(levels, level) {
  const lv = jobLevelNum(level)
  return [...(levels || [])].sort((a, b) => b.min_level - a.min_level)
    .find((b) => lv >= b.min_level) || (levels || [])[levels.length - 1] || null
}
const mapEmployee = (i, bands) => {
  const level = jobLevelNum(i.employee_job_level)
  const band = bandForLevel(bands, level)
  return {
    id: i.employee_id,
    name: `${i.first_name || ''} ${i.last_name || ''}`.trim(),
    job_level: level, employee_band: i.employee_band, grade: band?.id || null, bandLabel: band?.label || '',
    dept: i.department_name || i.department_id || '', title: i.employee_title, status: i.status,
    housing: {
      type: i.housing_type, residence: i.residence_name, unit: i.unit_number,
      floor: i.floor_number, block: i.block_name, gate: i.gate_number, zone: i.zone,
    },
  }
}
// employee_id is the partition key (string) -> direct GetItem.
async function employeeRaw(id) {
  const r = await ddb.send(new GetCommand({ TableName: TBL.employees, Key: { employee_id: String(id) } }))
  return r.Item || null
}

/* ---------- ids ---------- */
const rid = (p, n) => `${p}-${Math.floor(n + Math.random() * 9 * n)}`
const now = () => new Date().toISOString()

/* ---------- fleet helpers ---------- */
async function listFleet() {
  const r = await ddb.send(new ScanCommand({ TableName: TBL.fleet, FilterExpression: 'SK = :m', ExpressionAttributeValues: { ':m': 'META' } }))
  const items = r.Items || []
  return {
    vehicles: items.filter((i) => i.PK.startsWith('VEH#')),
    drivers: items.filter((i) => i.PK.startsWith('DRV#')),
  }
}
async function setVehicleStatus(vehicle, status) {
  await ddb.send(new UpdateCommand({
    TableName: TBL.fleet, Key: { PK: `VEH#${vehicle.id}`, SK: 'META' },
    UpdateExpression: 'SET #s = :s, GSI1SK = :g1, GSI3PK = :g3',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status, ':g1': `${status}#${vehicle.type}#${vehicle.id}`, ':g3': `VEHSTATUS#${status}` },
  }))
}
async function setDriverStatus(driverId, status, assignment = null) {
  await ddb.send(new UpdateCommand({
    TableName: TBL.fleet, Key: { PK: `DRV#${driverId}`, SK: 'META' },
    UpdateExpression: 'SET #s = :s, GSI2SK = :g2, assignment = :a',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status, ':g2': `${status}#${driverId}`, ':a': assignment },
  }))
}
// nearest zone with a free vehicle of `type`
async function findNearestVehicle(ref, pickupPt, type) {
  for (const { z } of zonesByProximity(ref, pickupPt)) {
    const r = await ddb.send(new QueryCommand({
      TableName: TBL.fleet, IndexName: 'GSI1-zoneveh',
      KeyConditionExpression: 'GSI1PK = :p AND begins_with(GSI1SK, :s)',
      ExpressionAttributeValues: { ':p': `ZONE#${z.id}#VEH`, ':s': `idle#${type}#` },
      Limit: 1,
    }))
    const v = (r.Items || [])[0]
    if (v) return { vehicle: v, zone: z, km: havKm(pickupPt, z.ref) }
  }
  return null
}

/* ---------- ops helpers ---------- */
async function getOps() {
  const r = await ddb.send(new ScanCommand({ TableName: TBL.ops, FilterExpression: 'SK = :m', ExpressionAttributeValues: { ':m': 'META' } }))
  const items = r.Items || []
  return {
    requests: items.filter((i) => i.entity === 'REQ'),
    emergencies: items.filter((i) => i.entity === 'EMG'),
    bookings: items.filter((i) => i.entity === 'BK'),
  }
}
function indexAttrs(entity, status, zoneId, source, createdAt, sevRank, vehicleId) {
  const a = {
    GSI2PK: `${entity}#STATUS#${status}`, GSI2SK: sevRank != null ? `${sevRank}#${createdAt}` : createdAt,
    GSI3PK: `ZONE#${zoneId}`, GSI3SK: createdAt,
    GSI4PK: `SRC#${source}`, GSI4SK: createdAt,
  }
  if (vehicleId) { a.GSI5PK = `VEH#${vehicleId}`; a.GSI5SK = createdAt }
  return a
}
async function putOps(rec) { await ddb.send(new PutCommand({ TableName: TBL.ops, Item: rec })) }
async function getOpsItem(id) {
  const ent = id.startsWith('EMG') ? 'EMG#' : id.startsWith('BK') ? 'BK#' : 'REQ#'
  const r = await ddb.send(new GetCommand({ TableName: TBL.ops, Key: { PK: `${ent}${id}`, SK: 'META' } }))
  return r.Item
}
async function patchOpsStatus(item, status, extra = {}) {
  const sevRank = item.entity === 'EMG' ? ({ Critical: 0, Urgent: 1, Normal: 2 }[item.severity] ?? 1) : null
  await ddb.send(new UpdateCommand({
    TableName: TBL.ops, Key: { PK: item.PK, SK: 'META' },
    UpdateExpression: 'SET #s = :s, GSI2PK = :g2p, GSI2SK = :g2s, updated_at = :u',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':s': status, ':g2p': `${item.entity}#STATUS#${status}`,
      ':g2s': sevRank != null ? `${sevRank}#${item.created_at}` : item.created_at, ':u': now(),
    },
  }))
  // audit row
  await ddb.send(new PutCommand({ TableName: TBL.ops, Item: { PK: item.PK, SK: `EVT#${now()}`, type: status, ...extra } }))
}

// Complete a trip and free its vehicle/driver.
async function completeOp(item) {
  if (item.assigned_vehicle_id) {
    const v = (await ddb.send(new GetCommand({ TableName: TBL.fleet, Key: { PK: `VEH#${item.assigned_vehicle_id}`, SK: 'META' } }))).Item
    if (v) await setVehicleStatus(v, 'idle')
  }
  if (item.assigned_driver_id) await setDriverStatus(item.assigned_driver_id, 'available', null)
  await patchOpsStatus(item, 'COMPLETED')
  if (item.entity === 'EMG' && item.contact) {
    const what = item.kind === 'fire' ? 'Fire response' : item.kind === 'blood' ? 'Blood delivery' : 'Ambulance response'
    await notify(item.contact, `${item.id} completed`, `${what} ${item.id} is complete. Thank you.`)
  }
}
// Server-side auto-complete: free trips whose ETA passed (and heal legacy stuck rows).
async function sweepDue() {
  const r = await ddb.send(new ScanCommand({
    TableName: TBL.ops, FilterExpression: 'SK = :m AND #s = :en',
    ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':m': 'META', ':en': 'EN_ROUTE' },
  }))
  const nowSec = Math.floor(Date.now() / 1000)
  for (const it of r.Items || []) {
    const due = (it.eta_complete && it.eta_complete <= nowSec) ||
      (!it.eta_complete && Date.parse(it.created_at || 0) < Date.now() - 10 * 60000)
    if (due) { try { await completeOp(it) } catch {} }
  }
  // After freeing units, pull any queued emergencies forward.
  try { await tryDispatchQueued() } catch {}
}
// Operational policy parameters — written by the policy-sync agent from the policy
// document (env POLICY_CONFIG). Falls back to defaults when unset.
const POLICY = (() => { try { return JSON.parse(process.env.POLICY_CONFIG || '{}') } catch { return {} } })()
// Policy upload (admin uploads the PDF from the UI -> S3 -> policy-sync agent).
const s3 = new S3Client({})
const lambdaClient = new LambdaClient({})
const POLICY_BUCKET = process.env.POLICY_BUCKET
const POLICY_SYNC_FUNCTION = process.env.POLICY_SYNC_FUNCTION || 'psiog-policy-sync'
const POLICY_KEY = process.env.POLICY_KEY || 'policy.pdf'
const etaComplete = (mins) => Math.floor(Date.now() / 1000) + Math.max(120, Math.round(mins * 60))
const SPEED_KMH = Number(POLICY.speed_kmh) || 28

/* ---------- requester notifications (SMS via SNS, email via SES) ----------
   Best-effort and non-blocking: a notification failure never fails a dispatch.
   Configure SES_FROM (a verified SES sender) to enable email; SMS needs only a
   valid E.164 phone on the request. */
const sns = new SNSClient({})
const ses = new SESClient({})
const SES_FROM = process.env.SES_FROM
// Public base URL of the SPA, used to build shareable tracking links.
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '')
const trackUrl = (rec) => (APP_BASE_URL && rec.track_token) ? `${APP_BASE_URL}/track/${rec.id}?t=${rec.track_token}` : null
async function notify(contact, subject, message) {
  if (!contact || (!contact.phone && !contact.email)) return
  if (contact.phone) {
    try { await sns.send(new PublishCommand({ PhoneNumber: contact.phone, Message: message })) }
    catch (e) { console.error('NOTIFY_SMS', e?.name) }
  }
  if (contact.email && SES_FROM) {
    try {
      await ses.send(new SendEmailCommand({
        Source: SES_FROM, Destination: { ToAddresses: [contact.email] },
        Message: { Subject: { Data: subject }, Body: { Text: { Data: message } } },
      }))
    } catch (e) { console.error('NOTIFY_EMAIL', e?.name) }
  }
}

/* ---------- road routing + simulated traffic (server-side ETA) ----------
   So the API response carries a realistic, traffic-aware ETA even when no dispatcher
   console is open. Uses OSRM for real road distance/time, scaled by a time-of-day
   congestion factor; falls back to straight-line ÷ policy speed if OSRM is unreachable. */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'
const _osrmCache = new Map() // reuse identical routes within an invocation (mass casualty)
async function osrmRoute(points) {
  const valid = (points || []).filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number')
  if (valid.length < 2) return null
  const key = valid.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  if (_osrmCache.has(key)) return _osrmCache.get(key)
  const path = valid.map((p) => `${p.lng},${p.lat}`).join(';')
  let out = null
  try {
    const res = await fetch(`${OSRM_BASE}/${path}?overview=false`, { signal: AbortSignal.timeout(3500) })
    const d = await res.json()
    const route = d.routes?.[0]
    if (route) out = { km: route.distance / 1000, freeMin: route.duration / 60, legs: (route.legs || []).map((l) => ({ km: l.distance / 1000, min: l.duration / 60 })) }
  } catch { out = null }
  _osrmCache.set(key, out)
  return out
}
// Simulated congestion multiplier (1.0 = free flow). POLICY.traffic_factor overrides;
// otherwise a time-of-day rush-hour curve (IST), up to +60% at peak.
function trafficMultiplier() {
  if (POLICY.traffic_factor) return Number(POLICY.traffic_factor) || 1
  const d = new Date()
  const istH = (((d.getUTCHours() * 60 + d.getUTCMinutes()) + 330) % 1440) / 60
  const peak = Math.max(Math.max(0, 1 - Math.abs(istH - 9.5) / 2.5), Math.max(0, 1 - Math.abs(istH - 18.5) / 3))
  return +(1 + 0.6 * peak).toFixed(2)
}
// Build {distance_km, eta_to_pickup_min, eta_min, traffic_factor} for a route's points.
async function routeEta(points, fallbackPickupKm, fallbackTotalKm) {
  const f = trafficMultiplier()
  const r = await osrmRoute(points)
  if (r) {
    const pickupMin = (r.legs[0]?.min ?? r.freeMin) * f
    return { distance_km: +r.km.toFixed(1), eta_to_pickup_min: +pickupMin.toFixed(1), eta_min: +(r.freeMin * f).toFixed(1), traffic_factor: f }
  }
  return {
    distance_km: +fallbackTotalKm.toFixed(1),
    eta_to_pickup_min: +((fallbackPickupKm / SPEED_KMH * 60) * f).toFixed(1),
    eta_min: +((fallbackTotalKm / SPEED_KMH * 60) * f).toFixed(1),
    traffic_factor: f,
  }
}

/* ---------- emergency dispatch core (shared by create / mass-casualty / queue) ----------
   Given a partial/whole EMG record, compute assignment and side effects, and RETURN the
   full record to persist. Preserves id/created_at so it can promote a QUEUED row in place. */
async function buildEmergency(ref, item) {
  const createdAt = item.created_at || now()
  const sevAll = item.severity || 'Urgent'
  const sevR = { Critical: 0, Urgent: 1, Normal: 2 }[sevAll] ?? 1
  const pt = resolvePickup(ref, item.pickup)
  const zoneId = zonesByProximity(ref, pt)[0]?.z.id
  const base = {
    PK: `EMG#${item.id}`, SK: 'META', entity: 'EMG', id: item.id, kind: item.kind || 'medical',
    severity: sevAll, pickup: item.pickup, pickup_zone_id: zoneId,
    requested_by: item.requested_by || null, source: item.source || 'CONSOLE',
    incident_id: item.incident_id || null, patients_count: item.patients_count || 1, note: item.note || null,
    contact: item.contact || null,
    track_token: item.track_token || randomUUID().replace(/-/g, ''),
    created_at: createdAt, updated_at: now(),
  }

  if (item.kind === 'fire') {
    const truck = await findNearestVehicle(ref, pt, 'firetruck')
    if (!truck) return { ...base, case_type: 'Fire', status: 'QUEUED', ...indexAttrs('EMG', 'QUEUED', zoneId, base.source, createdAt, sevR) }
    // Origin = the fire station the truck responds from (its zone's station, else
    // the nearest station to the incident). The incident coords/location are the drop.
    const station = (ref.firestations || []).find((f) => f.zone_id === truck.zone.id)
      || (ref.firestations || []).map((f) => ({ f, d: havKm(pt, { lat: f.lat, lng: f.lng }) }))
        .sort((a, b) => a.d - b.d)[0]?.f
    const origin = station ? { lat: station.lat, lng: station.lng } : truck.zone.ref
    const eta = await routeEta([origin, pt], truck.km, truck.km)
    await setVehicleStatus(truck.vehicle, 'enroute')
    if (truck.vehicle.driver_id) await setDriverStatus(truck.vehicle.driver_id, 'on-trip', item.id)
    return {
      ...base, case_type: 'Fire', status: 'EN_ROUTE',
      assigned_vehicle_id: truck.vehicle.id, assigned_driver_id: truck.vehicle.driver_id,
      fire_station_id: station?.id || null,
      distance_km: eta.distance_km, eta_min: eta.eta_min, eta_to_pickup_min: eta.eta_to_pickup_min, traffic_factor: eta.traffic_factor,
      eta_complete: etaComplete(eta.eta_min), ...indexAttrs('EMG', 'EN_ROUTE', zoneId, base.source, createdAt, sevR, truck.vehicle.id),
    }
  }

  // Blood-bank logistics: an ambulance runs a round trip
  // base -> requesting hospital (pickup) -> blood bank -> back to hospital.
  if (item.kind === 'blood') {
    const found = await findNearestVehicle(ref, pt, 'ambulance')
    if (!found) return { ...base, case_type: 'Blood', status: 'QUEUED', ...indexAttrs('EMG', 'QUEUED', zoneId, base.source, createdAt, sevR) }
    // destination blood bank: explicit id, else nearest blood-bank location to the hospital
    let bank = item.blood_bank_id ? locById(ref, item.blood_bank_id) : null
    if (!bank) {
      bank = ref.locations.filter((l) => l.type === 'bloodbank')
        .map((l) => ({ l, d: havKm(pt, { lat: l.lat, lng: l.lng }) }))
        .sort((a, b) => a.d - b.d)[0]?.l
    }
    if (!bank) return { ...base, case_type: 'Blood', status: 'NO_BLOODBANK', assigned_vehicle_id: found.vehicle.id, ...indexAttrs('EMG', 'NO_BLOODBANK', zoneId, base.source, createdAt, sevR) }
    const pickToBank = havKm(pt, { lat: bank.lat, lng: bank.lng })
    const totalKm = found.km + 2 * pickToBank
    // Round trip: base -> hospital (pickup) -> blood bank -> back to hospital.
    const eta = await routeEta([found.zone.ref, pt, { lat: bank.lat, lng: bank.lng }, pt], found.km, totalKm)
    await setVehicleStatus(found.vehicle, 'enroute')
    if (found.vehicle.driver_id) await setDriverStatus(found.vehicle.driver_id, 'on-trip', item.id)
    return {
      ...base, case_type: 'Blood', status: 'EN_ROUTE',
      assigned_vehicle_id: found.vehicle.id, assigned_driver_id: found.vehicle.driver_id, blood_bank_id: bank.id,
      distance_km: eta.distance_km, eta_min: eta.eta_min, eta_to_pickup_min: eta.eta_to_pickup_min, traffic_factor: eta.traffic_factor,
      eta_complete: etaComplete(eta.eta_min), ...indexAttrs('EMG', 'EN_ROUTE', zoneId, base.source, createdAt, sevR, found.vehicle.id),
    }
  }

  const caseType = item.case_type
  const found = await findNearestVehicle(ref, pt, 'ambulance')
  if (!found) return { ...base, case_type: caseType, status: 'QUEUED', ...indexAttrs('EMG', 'QUEUED', zoneId, base.source, createdAt, sevR) }
  // Route to the nearest hospital that handles this case type. For Critical cases,
  // prefer the most capable facility, then distance. (Bed capacity is owned by the
  // hospital's own systems, not tracked here.)
  const hosp = ref.hospitals
    .filter((h) => (h.specialties || []).includes(caseType))
    .map((h) => ({ h, d: havKm(pt, { lat: h.lat, lng: h.lng }) }))
    .sort((a, b) => (sevAll === 'Critical' ? (b.h.capability - a.h.capability) || (a.d - b.d) : a.d - b.d))[0]
  if (!hosp) return { ...base, case_type: caseType, status: 'NO_HOSPITAL', assigned_vehicle_id: found.vehicle.id, ...indexAttrs('EMG', 'NO_HOSPITAL', zoneId, base.source, createdAt, sevR) }

  const totalKm = found.km + hosp.d
  // base -> scene (pickup) -> hospital, with traffic-aware road ETA.
  const eta = await routeEta([found.zone.ref, pt, { lat: hosp.h.lat, lng: hosp.h.lng }], found.km, totalKm)
  await setVehicleStatus(found.vehicle, 'enroute')
  if (found.vehicle.driver_id) await setDriverStatus(found.vehicle.driver_id, 'on-trip', item.id)
  return {
    ...base, case_type: caseType, status: 'EN_ROUTE',
    assigned_vehicle_id: found.vehicle.id, assigned_driver_id: found.vehicle.driver_id, hospital_id: hosp.h.id,
    distance_km: eta.distance_km, eta_min: eta.eta_min, eta_to_pickup_min: eta.eta_to_pickup_min, traffic_factor: eta.traffic_factor,
    eta_complete: etaComplete(eta.eta_min), ...indexAttrs('EMG', 'EN_ROUTE', zoneId, base.source, createdAt, sevR, found.vehicle.id),
  }
}

// Queue handling: try to dispatch any QUEUED / NO_HOSPITAL emergencies to freed units.
async function tryDispatchQueued() {
  const r = await ddb.send(new ScanCommand({
    TableName: TBL.ops, FilterExpression: 'SK = :m AND entity = :e AND (#s = :q OR #s = :n)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':m': 'META', ':e': 'EMG', ':q': 'QUEUED', ':n': 'NO_HOSPITAL' },
  }))
  const items = (r.Items || []).sort((a, b) => String(a.GSI2SK || '').localeCompare(String(b.GSI2SK || '')))
  for (const it of items.slice(0, 10)) {
    const ref = await loadRef()
    const rec = await buildEmergency(ref, it)
    if (rec.status === 'EN_ROUTE') await putOps(rec)
  }
}

/* ===================================================================== */
export const handler = async (event) => {
  setCors(event)
  const method = event.requestContext?.http?.method
  const path = event.rawPath || '/'
  if (method === 'OPTIONS') return ok({})
  let body = {}
  try { body = event.body ? JSON.parse(event.body) : {} } catch { return err(400, 'BAD_JSON', 'Invalid JSON body') }
  const seg = path.replace(/^\/+|\/+$/g, '').split('/') // e.g. ["requests","REQ-1","dispatch"]

  // ---- principal resolution: API key (server callers) OR Cognito JWT (browser users) ----
  const apiKeySource = callerSource(event)
  const bearer = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
  const claims = bearer ? await verifyJwt(bearer) : null
  const admin = apiKeySource === 'CONSOLE' || (!!claims && isAdminClaims(claims))
  const identity = claims ? identityOf(claims) : null
  const authed = !!apiKeySource || !!claims
  const AUTH_ON = KEYS_ON || JWT_ENABLED

  // ---- write authorization ----
  if (method === 'POST') {
    if (AUTH_ON && !authed) return err(401, 'UNAUTHORIZED', 'Authentication required')
    // server keys are restricted to their scope
    if (apiKeySource && apiKeySource !== 'CONSOLE' && !canPost(apiKeySource, seg[0]))
      return err(403, 'FORBIDDEN', `${apiKeySource} key is not permitted to POST /${seg[0]}`)
    // non-admin browser users may only create/route emergencies and cancel their own
    if (!apiKeySource && claims && !admin) {
      const allowed = seg[0] === 'emergencies' || (seg[0] === 'requests' && seg[2] === 'cancel')
      if (!allowed) return err(403, 'FORBIDDEN', 'Not permitted for this user')
    }
  }
  // source is server-controlled, never trust the body for it
  if (apiKeySource && apiKeySource !== 'CONSOLE') body.source = apiKeySource
  else if (!apiKeySource && claims && !admin) body.source = 'PORTAL'

  // ---- read authorization (operational data is not public) ----
  if (method === 'GET' && AUTH_ON) {
    const adminGet = ['employees', 'allotments', 'fuel', 'cards', 'powerbi']
    const authedGet = ['fleet', 'ops', ...adminGet]
    if (authedGet.includes(seg[0]) && !authed) return err(401, 'UNAUTHORIZED', 'Authentication required')
    if (adminGet.includes(seg[0]) && !admin) return err(403, 'FORBIDDEN', 'Admin only')
  }

  try {
    // ---- health ----
    if (path === '/health') return ok({ ok: true, time: now(), auth: KEYS_ON || JWT_ENABLED, jwt: JWT_ENABLED, policy: POLICY })

    // ---- public live tracking (tokenized, no auth). Returns only non-sensitive
    //      incident geometry + ETA so a shareable link can render a live map. ----
    if (method === 'GET' && seg[0] === 'track' && seg[1]) {
      const it = await getOpsItem(seg[1])
      const token = event.queryStringParameters?.t || event.queryStringParameters?.token
      if (!it || it.entity !== 'EMG' || !it.track_token || token !== it.track_token)
        return err(404, 'NOT_FOUND', 'tracking link invalid or expired')
      const ref = await loadRef()
      const pt = resolvePickup(ref, it.pickup)
      const veh = it.assigned_vehicle_id
        ? (await ddb.send(new GetCommand({ TableName: TBL.fleet, Key: { PK: `VEH#${it.assigned_vehicle_id}`, SK: 'META' } }))).Item
        : null
      const zoneRef = (id) => ref.zones.find((z) => z.id === id)?.ref
      const named = (lat, lng, label) => (typeof lat === 'number' ? { lat, lng, label } : null)
      let origin = null, pickup = null, destination = null
      const incidentLabel = it.pickup?.name || (pt ? `${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}` : 'Scene')
      if (it.kind === 'fire') {
        const st = (ref.firestations || []).find((f) => f.id === it.fire_station_id)
        origin = st ? named(st.lat, st.lng, st.name) : (veh && zoneRef(veh.home_zone_id) ? named(zoneRef(veh.home_zone_id).lat, zoneRef(veh.home_zone_id).lng, 'Fire station') : null)
        destination = pt ? named(pt.lat, pt.lng, incidentLabel) : null
      } else {
        const zr = veh && zoneRef(veh.home_zone_id)
        origin = zr ? named(zr.lat, zr.lng, 'Unit base') : null
        pickup = pt ? named(pt.lat, pt.lng, incidentLabel) : null
        if (it.kind === 'blood') {
          const bank = ref.locations.find((l) => l.id === it.blood_bank_id)
          destination = bank ? named(bank.lat, bank.lng, bank.name) : null
        } else {
          const hosp = ref.hospitals.find((h) => h.id === it.hospital_id)
          destination = hosp ? named(hosp.lat, hosp.lng, hosp.name) : null
        }
      }
      return ok({
        id: it.id, kind: it.kind, status: it.status, severity: it.severity, case_type: it.case_type,
        eta_min: it.eta_min || 0, eta_to_pickup_min: it.eta_to_pickup_min || 0,
        eta_complete: it.eta_complete || null, distance_km: it.distance_km || 0,
        vehicle: veh ? { reg: veh.reg, type: veh.type } : null,
        origin, pickup, destination, created_at: it.created_at, updated_at: it.updated_at,
      })
    }

    // ---- Power BI embed token (App-owns-data). Admin-gated by the caller's Cognito
    //      JWT above; the user never logs into Power BI. The Lambda uses a service
    //      principal to mint a short-lived embed token for the configured report. ----
    if (method === 'GET' && seg[0] === 'powerbi' && seg[1] === 'embed-token') {
      const { PBI_TENANT_ID, PBI_CLIENT_ID, PBI_CLIENT_SECRET, PBI_WORKSPACE_ID, PBI_REPORT_ID } = process.env
      if (!PBI_TENANT_ID || !PBI_CLIENT_ID || !PBI_CLIENT_SECRET || !PBI_WORKSPACE_ID || !PBI_REPORT_ID)
        return err(500, 'PBI_NOT_CONFIGURED', 'Power BI service principal env vars are not set')
      // 1) AAD token via client credentials (service principal)
      const aadRes = await fetch(`https://login.microsoftonline.com/${PBI_TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: PBI_CLIENT_ID,
          client_secret: PBI_CLIENT_SECRET, scope: 'https://analysis.windows.net/powerbi/api/.default' }),
      })
      const aad = await aadRes.json()
      if (!aad.access_token) return err(502, 'PBI_AAD_FAILED', aad.error_description || 'AAD token request failed')
      const pbiHeaders = { authorization: `Bearer ${aad.access_token}`, 'content-type': 'application/json' }
      const base = `https://api.powerbi.com/v1.0/myorg/groups/${PBI_WORKSPACE_ID}/reports/${PBI_REPORT_ID}`
      // 2) report metadata (embedUrl + datasetId)
      const repRes = await fetch(base, { headers: pbiHeaders })
      const rep = await repRes.json()
      if (!rep.embedUrl) return err(502, 'PBI_REPORT_FAILED', rep.error?.message || 'report fetch failed')
      // 3) generate a view-only embed token for this report
      const gtRes = await fetch(`${base}/GenerateToken`, {
        method: 'POST', headers: pbiHeaders, body: JSON.stringify({ accessLevel: 'View' }),
      })
      const gt = await gtRes.json()
      if (!gt.token) return err(502, 'PBI_TOKEN_FAILED', gt.error?.message || 'GenerateToken failed')
      return ok({ embedUrl: rep.embedUrl, reportId: rep.id, token: gt.token, expiry: gt.expiration })
    }

    // ---- admin uploads the policy PDF -> store in S3 -> run policy-sync agent ----
    if (method === 'POST' && seg[0] === 'policy' && !seg[1]) {
      if (!admin) return err(403, 'FORBIDDEN', 'Admin only')
      if (!POLICY_BUCKET) return err(500, 'NO_BUCKET', 'POLICY_BUCKET not configured')
      const b64 = body.content_base64 || body.file
      if (!b64) return err(400, 'NO_FILE', 'content_base64 (PDF) required')
      const bytes = Buffer.from(String(b64).replace(/^data:[^;]*;base64,/, ''), 'base64')
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) return err(400, 'BAD_FILE', 'empty or too large (max 5MB)')
      await s3.send(new PutObjectCommand({ Bucket: POLICY_BUCKET, Key: POLICY_KEY, Body: bytes, ContentType: 'application/pdf' }))
      const inv = await lambdaClient.send(new InvokeCommand({
        FunctionName: POLICY_SYNC_FUNCTION,
        Payload: Buffer.from(JSON.stringify({ bucket: POLICY_BUCKET, key: POLICY_KEY })),
      }))
      let result = {}
      try { result = JSON.parse(Buffer.from(inv.Payload || []).toString() || '{}') } catch {}
      return ok({ ok: !!result.ok, applied: result.applied || null, error: result.error || null })
    }

    // ---- reference ----
    if (method === 'GET' && seg[0] === 'reference') {
      const ref = await loadRef()
      if (seg[1] === 'locations') return ok(ref.locations)
      if (seg[1] === 'zones') return ok(ref.zones)
      if (seg[1] === 'hospitals') return ok(ref.hospitals)
      if (seg[1] === 'firestations') return ok(ref.firestations)
      if (seg[1] === 'policy') {
        const r = await ddb.send(new QueryCommand({ TableName: TBL.ref, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': 'POLICY' }, ScanIndexForward: false, Limit: 1 }))
        return ok((r.Items || [])[0] || {})
      }
    }

    // ---- employees (read-only from the shared org table, mapped to app shape) ----
    if (method === 'GET' && seg[0] === 'employees') {
      const [r, bands] = await Promise.all([ddb.send(new ScanCommand({ TableName: TBL.employees })), policyLevels()])
      return ok((r.Items || []).filter((e) => !e.status || e.status === 'Active').map((e) => mapEmployee(e, bands)))
    }

    // ---- allotments (Fleet table, PK ALLOT#<empId>) ----
    if (method === 'GET' && seg[0] === 'allotments') {
      const r = await ddb.send(new ScanCommand({ TableName: TBL.fleet, FilterExpression: 'begins_with(PK, :a)', ExpressionAttributeValues: { ':a': 'ALLOT#' } }))
      return ok(r.Items || [])
    }
    if (method === 'POST' && seg[0] === 'allotments') {
      if (!admin) return err(403, 'FORBIDDEN', 'Admin only')
      // Grade-based eligibility: the employee's grade must permit the vehicle type.
      const raw = await employeeRaw(body.employeeId)
      if (!raw) return err(404, 'UNKNOWN_EMPLOYEE', `employee ${body.employeeId} not found`)
      const veh = (await ddb.send(new GetCommand({ TableName: TBL.fleet, Key: { PK: `VEH#${body.vehicleId}`, SK: 'META' } }))).Item
      if (!veh) return err(404, 'NOT_FOUND', 'vehicle not found')
      const level = jobLevelNum(raw.employee_job_level)
      const band = bandForLevel(await policyLevels(), level)
      const allowed = band?.allowed_vehicle_types || []
      if (!allowed.includes(veh.type)) return err(422, 'NOT_ELIGIBLE', `Job level ${level} (${band?.label || '-'}) is not eligible for a ${veh.type}`, { allowed })
      const id = `al-${Date.now()}`
      const it = { PK: `ALLOT#${body.employeeId}`, SK: 'META', id, employeeId: body.employeeId, vehicleId: body.vehicleId, job_level: raw.job_level, grade: band?.id, validTill: body.validTill || '2027-03-31' }
      await ddb.send(new PutCommand({ TableName: TBL.fleet, Item: it }))
      return ok(it, 201)
    }

    // ---- fuel logs (Fleet table, SK FUEL#) ----
    if (method === 'GET' && seg[0] === 'fuel') {
      const r = await ddb.send(new ScanCommand({ TableName: TBL.fleet, FilterExpression: 'begins_with(SK, :f)', ExpressionAttributeValues: { ':f': 'FUEL#' } }))
      return ok(r.Items || [])
    }
    if (method === 'POST' && seg[0] === 'fuel') {
      if (!admin) return err(403, 'FORBIDDEN', 'Admin only')
      const date = now().slice(0, 10)
      const id = `f-${Date.now()}`
      const it = { PK: `VEH#${body.vehicleId}`, SK: `FUEL#${date}#${id}`, id, vehicleId: body.vehicleId, litres: body.litres, cost: body.cost, date, station: body.station || 'Fuel Station Depot' }
      await ddb.send(new PutCommand({ TableName: TBL.fleet, Item: it }))
      return ok(it, 201)
    }

    // ---- fleet ----
    if (method === 'GET' && seg[0] === 'fleet') return ok(await listFleet())
    if (method === 'POST' && seg[0] === 'fleet' && seg[2] === 'status') {
      if (!admin) return err(403, 'FORBIDDEN', 'Admin only')
      const veh = (await ddb.send(new GetCommand({ TableName: TBL.fleet, Key: { PK: `VEH#${seg[1]}`, SK: 'META' } }))).Item
      if (!veh) return err(404, 'NOT_FOUND', 'vehicle not found')
      await setVehicleStatus(veh, body.status)
      return ok({ id: seg[1], status: body.status })
    }

    // ---- shuttle cards (with their ride rows) ----
    if (method === 'GET' && seg[0] === 'cards') {
      const r = await ddb.send(new ScanCommand({ TableName: TBL.cards }))
      const items = r.Items || []
      const cards = items.filter((i) => i.SK === 'META').map((c) => ({
        ...c, rides: items.filter((x) => x.PK === c.PK && x.SK.startsWith('RIDE#'))
          .sort((a, b) => b.SK.localeCompare(a.SK)),
      }))
      return ok(cards)
    }

    // ---- ops (all requests/emergencies/bookings) ----
    if (method === 'GET' && seg[0] === 'ops') {
      await sweepDue()
      const data = await getOps()
      if (admin) return ok(data)
      // non-admin: only their own emergencies; hide other entities entirely
      return ok({ requests: [], bookings: [],
        emergencies: data.emergencies.filter((e) => identity && e.requested_by === identity) })
    }

    // ---- status of a single request / emergency / booking by id ----
    if (method === 'GET' && ['requests', 'emergencies', 'bookings'].includes(seg[0]) && seg[1] && !seg[2]) {
      const it = await getOpsItem(seg[1])
      if (!it) return err(404, 'NOT_FOUND', `${seg[1]} not found`)
      return ok({
        id: it.id, type: it.entity, status: it.status, severity: it.severity, case_type: it.case_type,
        pickup: it.pickup, drop: it.drop, drops: it.drops, hospital_id: it.hospital_id,
        assigned_vehicle_id: it.assigned_vehicle_id, assigned_driver_id: it.assigned_driver_id,
        eta_min: it.eta_min, distance_km: it.distance_km, created_at: it.created_at, updated_at: it.updated_at,
      })
    }

    // ---- create transport/delivery/shuttle-bus request ----
    if (method === 'POST' && seg[0] === 'requests' && seg.length === 1) {
      const ref = await loadRef()
      const pt = resolvePickup(ref, body.pickup)
      if (!pt) return err(404, 'UNKNOWN_LOCATION', 'pickup not resolvable')
      const zoneId = zonesByProximity(ref, pt)[0]?.z.id
      const id = rid('REQ', 1000)
      const createdAt = now()
      const rec = {
        PK: `REQ#${id}`, SK: 'META', entity: 'REQ', id,
        external_ref: body.external_ref || null, source: body.source || 'PORTAL',
        request_type: body.request_type || 'TRANSPORT', vehicle_type: body.vehicle_type || 'car',
        status: 'NEW', priority: body.priority || 'normal',
        pickup: body.pickup, drops: body.drops || [], pickup_zone_id: zoneId,
        requested_by: body.requested_by || null, note: body.note || null,
        created_at: createdAt, updated_at: createdAt,
        ...indexAttrs('REQ', 'NEW', zoneId, body.source || 'PORTAL', createdAt),
      }
      await putOps(rec)
      return ok({ id, status: 'NEW' }, 201)
    }

    // ---- assign / dispatch / complete / cancel ----
    if (method === 'POST' && seg[0] === 'requests' && seg[2]) {
      const item = await getOpsItem(seg[1])
      if (!item) return err(404, 'NOT_FOUND', 'request not found')
      const action = seg[2]
      // dispatch-desk actions are admin-only; cancel/complete are admin OR the owner.
      const ownsItem = identity && item.requested_by === identity
      if (['review', 'assign', 'dispatch'].includes(action) && !admin) return err(403, 'FORBIDDEN', 'Admin only')
      if (['cancel', 'complete'].includes(action) && !admin && !ownsItem) return err(403, 'FORBIDDEN', 'Not your request')
      if (action === 'review') { await patchOpsStatus(item, 'REVIEWED'); return ok({ id: seg[1], status: 'REVIEWED' }) }
      if (action === 'assign') {
        await patchOpsStatus(item, 'ASSIGNED')
        await ddb.send(new UpdateCommand({
          TableName: TBL.ops, Key: { PK: item.PK, SK: 'META' },
          UpdateExpression: 'SET assigned_vehicle_id = :v, assigned_driver_id = :d, GSI5PK = :g5, GSI5SK = :g5s',
          ExpressionAttributeValues: { ':v': body.vehicleId, ':d': body.driverId, ':g5': `VEH#${body.vehicleId}`, ':g5s': item.created_at },
        }))
        if (body.driverId) await setDriverStatus(body.driverId, 'available', seg[1])
        return ok({ id: seg[1], status: 'ASSIGNED' })
      }
      if (action === 'dispatch') {
        const { vehicles } = await listFleet()
        const v = vehicles.find((x) => x.id === item.assigned_vehicle_id)
        if (v) await setVehicleStatus(v, 'enroute')
        if (item.assigned_driver_id) await setDriverStatus(item.assigned_driver_id, 'on-trip', seg[1])
        await patchOpsStatus(item, 'EN_ROUTE')
        // backstop auto-complete (frees vehicle even without a browser)
        await ddb.send(new UpdateCommand({ TableName: TBL.ops, Key: { PK: item.PK, SK: 'META' },
          UpdateExpression: 'SET eta_complete = :e', ExpressionAttributeValues: { ':e': etaComplete(6) } }))
        return ok({ id: seg[1], status: 'EN_ROUTE' })
      }
      if (action === 'complete' || action === 'cancel') {
        const status = action === 'complete' ? 'COMPLETED' : 'CANCELLED'
        const { vehicles } = await listFleet()
        const v = vehicles.find((x) => x.id === item.assigned_vehicle_id)
        if (v) await setVehicleStatus(v, 'idle')
        if (item.assigned_driver_id) await setDriverStatus(item.assigned_driver_id, 'available', null)
        await patchOpsStatus(item, status)
        return ok({ id: seg[1], status })
      }
    }

    // ---- emergency actions: manual override (reassign) + OSRM route write-back ----
    if (method === 'POST' && seg[0] === 'emergencies' && seg[1] && seg[2]) {
      const item = await getOpsItem(seg[1])
      if (!item) return err(404, 'NOT_FOUND', 'emergency not found')

      // client writes back the real OSRM distance/duration so UI matches the animation
      if (seg[2] === 'route') {
        const etaMin = Number(body.eta_min) || 0
        await ddb.send(new UpdateCommand({
          TableName: TBL.ops, Key: { PK: item.PK, SK: 'META' },
          UpdateExpression: 'SET distance_km = :d, eta_min = :e, eta_to_pickup_min = :p, eta_complete = :c, updated_at = :u',
          ExpressionAttributeValues: {
            ':d': Number(body.distance_km) || item.distance_km || 0, ':e': etaMin,
            ':p': Number(body.eta_to_pickup_min) || item.eta_to_pickup_min || 0,
            ':c': etaComplete(etaMin), ':u': now(),
          },
        }))
        return ok({ id: seg[1], updated: true })
      }

      // manual override: swap the assigned vehicle and/or hospital — admin only
      if (seg[2] === 'reassign') {
        if (!admin) return err(403, 'FORBIDDEN', 'Admin only')
        const { vehicles } = await listFleet()
        if (body.vehicleId && body.vehicleId !== item.assigned_vehicle_id) {
          const newV = vehicles.find((x) => x.id === body.vehicleId)
          if (!newV) return err(404, 'NOT_FOUND', 'replacement vehicle not found')
          const oldV = vehicles.find((x) => x.id === item.assigned_vehicle_id)
          if (oldV) await setVehicleStatus(oldV, 'idle')
          if (item.assigned_driver_id) await setDriverStatus(item.assigned_driver_id, 'available', null)
          await setVehicleStatus(newV, 'enroute')
          if (newV.driver_id) await setDriverStatus(newV.driver_id, 'on-trip', seg[1])
          await ddb.send(new UpdateCommand({
            TableName: TBL.ops, Key: { PK: item.PK, SK: 'META' },
            UpdateExpression: 'SET assigned_vehicle_id = :v, assigned_driver_id = :d, GSI5PK = :g5, GSI5SK = :g5s, updated_at = :u',
            ExpressionAttributeValues: { ':v': newV.id, ':d': newV.driver_id || null, ':g5': `VEH#${newV.id}`, ':g5s': item.created_at, ':u': now() },
          }))
        }
        if (body.hospitalId && body.hospitalId !== item.hospital_id) {
          await ddb.send(new UpdateCommand({ TableName: TBL.ops, Key: { PK: item.PK, SK: 'META' }, UpdateExpression: 'SET hospital_id = :h, updated_at = :u', ExpressionAttributeValues: { ':h': body.hospitalId, ':u': now() } }))
        }
        await ddb.send(new PutCommand({ TableName: TBL.ops, Item: { PK: item.PK, SK: `EVT#${now()}`, type: 'REASSIGNED', vehicleId: body.vehicleId, hospitalId: body.hospitalId } }))
        return ok({ id: seg[1], reassigned: true })
      }
      return err(404, 'NO_ROUTE', `No emergency action ${seg[2]}`)
    }

    // ---- emergency create (auto-dispatch). Supports kind=fire, multi-patient, mass-casualty ----
    if (method === 'POST' && seg[0] === 'emergencies' && !seg[1]) {
      const vErr = validateEmergency(body)
      if (vErr) return err(400, 'INVALID_INPUT', vErr)
      await sweepDue() // free finished units + drain the queue first
      let ref = await loadRef()
      if (!resolvePickup(ref, body.pickup)) return err(404, 'UNKNOWN_LOCATION', 'pickup not resolvable')
      const caseType = body.case_type || body.caseType
      // Tolerate callers that signal the type via case_type instead of kind
      // (e.g. an external service sending case_type:"Fire" with kind:"medical").
      let kind = body.kind
      const ctLower = String(caseType || '').toLowerCase()
      if (ctLower === 'fire') kind = 'fire'
      else if (ctLower === 'blood') kind = 'blood'
      else if (!KINDS.includes(kind)) kind = 'medical'
      const patients = Math.max(1, Number(body.patients) || 1)
      // Mass casualty: units are POLICY-driven (patients_per_ambulance, max_units,
      // mass_patient_threshold). An explicit units>1 (e.g. admin override) is honored
      // up to the policy cap. Fire stays single.
      const per = Number(POLICY.patients_per_ambulance) || 4
      const cap = Number(POLICY.max_units) || 10
      const massT = Number(POLICY.mass_patient_threshold) || 3
      const units = kind === 'fire' ? 1
        : Number(body.units) > 1 ? Math.min(cap, Math.round(Number(body.units)))
        : patients > massT ? Math.min(cap, Math.max(2, Math.ceil(patients / per))) : 1
      const incidentId = units > 1 ? rid('INC', 100) : null

      const records = []
      for (let i = 0; i < units; i++) {
        ref = await loadRef() // refresh beds between iterations
        const rec = await buildEmergency(ref, {
          id: rid('EMG', 100), kind, case_type: caseType, severity: body.severity,
          pickup: body.pickup, blood_bank_id: body.blood_bank_id, requested_by: body.requested_by, source: body.source,
          incident_id: incidentId, patients_count: patients, note: body.note, contact: body.contact, created_at: now(),
        })
        await putOps(rec)
        records.push(rec)
      }
      const hospName = (id) => ref.hospitals.find((h) => h.id === id)?.name
      const bankName = (id) => ref.locations.find((l) => l.id === id)?.name
      const resp = (r) => ({
        id: r.id, status: r.status, assigned_vehicle_id: r.assigned_vehicle_id || null,
        hospital_id: r.hospital_id || null, hospital: hospName(r.hospital_id),
        blood_bank_id: r.blood_bank_id || null, blood_bank: bankName(r.blood_bank_id),
        eta_to_pickup_min: r.eta_to_pickup_min || 0, eta_min: r.eta_min || 0, distance_km: r.distance_km || 0,
        traffic_factor: r.traffic_factor || 1, tracking_url: trackUrl(r),
        reason: r.status === 'QUEUED' ? (kind === 'fire' ? 'No fire truck available' : 'No ambulance available')
          : r.status === 'NO_HOSPITAL' ? `No facility with ${r.case_type} + capacity`
          : r.status === 'NO_BLOODBANK' ? 'No blood bank configured' : undefined,
      })
      // Notify the requester once (best-effort, after dispatch is decided).
      if (body.contact) {
        const what = kind === 'fire' ? 'Fire truck' : kind === 'blood' ? 'Blood delivery' : 'Ambulance'
        const dispatched = records.filter((r) => r.status === 'EN_ROUTE').length
        let msg
        if (units > 1) {
          msg = dispatched > 0 ? `${dispatched} of ${units} units dispatched for incident ${incidentId}. Help is on the way.`
            : `Your emergency ${incidentId} is received; all units are busy and you are in the queue.`
        } else {
          const r0 = records[0]
          const link = trackUrl(r0)
          msg = r0.status === 'EN_ROUTE'
            ? `Help is on the way. ${what} dispatched for ${r0.id}, ETA ~${Math.round(r0.eta_to_pickup_min || 0)} min.${link ? ` Track live: ${link}` : ''}`
            : `Your request ${r0.id} is received; all units are busy and you are in the queue.`
        }
        await notify(body.contact, 'JSD TATA Emergency Services', msg)
      }
      if (units === 1) return ok(resp(records[0]), 201)
      return ok({ incident_id: incidentId, units, dispatched: records.filter((r) => r.status === 'EN_ROUTE').length, results: records.map(resp) }, 201)
    }

    // ---- shuttle booking (shared card, cap enforced) ----
    if (method === 'POST' && seg[0] === 'bookings') {
      await sweepDue() // free any shuttles whose previous trip has finished
      const ref = await loadRef()
      const card = (await ddb.send(new GetCommand({ TableName: TBL.cards, Key: { PK: `CARD#${body.card_id}`, SK: 'META' } }))).Item
      if (!card) return err(404, 'NOT_FOUND', 'card not found')
      const levels = await policyLevels()
      const band = (levels || []).find((b) => b.id === card.grade) || bandForLevel(levels, card.job_level)
      const cap = band?.shuttle_rides ?? 0
      const month = now().slice(0, 7)
      const pt = resolvePickup(ref, body.pickup)
      const found = await findNearestVehicle(ref, pt, 'bus')
      if (!found) return err(422, 'NO_RESOURCE', 'No shuttle available in any zone')
      const dropL = locById(ref, body.drop?.ref) || (body.drop?.lat ? body.drop : null)
      const distKm = dropL ? havKm(pt, { lat: dropL.lat, lng: dropL.lng }) : 0
      const fare = Math.round(distKm * 12)
      const id = rid('BK', 1000)
      // atomic cap check + increment
      try {
        await ddb.send(new UpdateCommand({
          TableName: TBL.cards, Key: { PK: `CARD#${body.card_id}`, SK: 'META' },
          UpdateExpression: 'SET used_this_month = if_not_exists(used_this_month, :z) + :one, #m = :mo',
          ConditionExpression: '(attribute_not_exists(used_this_month) OR used_this_month < :cap)',
          ExpressionAttributeNames: { '#m': 'month' },
          ExpressionAttributeValues: { ':one': 1, ':z': 0, ':cap': cap, ':mo': month },
        }))
      } catch { return err(422, 'CAP_EXHAUSTED', `Monthly shuttle entitlement exhausted (cap ${cap})`) }
      const createdAt = now()
      await ddb.send(new PutCommand({ TableName: TBL.cards, Item: { PK: `CARD#${body.card_id}`, SK: `RIDE#${createdAt.slice(0,10)}#${id}`, id, memberId: body.member_id, from: body.pickup?.ref, to: body.drop?.ref, date: createdAt.slice(0,10), fare } }))
      const zoneId = found.zone.id
      const rec = { PK: `BK#${id}`, SK: 'META', entity: 'BK', id, status: 'EN_ROUTE', card_id: body.card_id, member_id: body.member_id, pickup: body.pickup, drop: body.drop, pickup_zone_id: zoneId, assigned_vehicle_id: found.vehicle.id, assigned_driver_id: found.vehicle.driver_id, fare, distance_km: +distKm.toFixed(1), eta_complete: etaComplete((distKm / 28) * 60), source: 'HR', created_at: createdAt, updated_at: createdAt, ...indexAttrs('BK', 'EN_ROUTE', zoneId, 'HR', createdAt, null, found.vehicle.id) }
      await putOps(rec)
      await setVehicleStatus(found.vehicle, 'enroute')
      if (found.vehicle.driver_id) await setDriverStatus(found.vehicle.driver_id, 'on-trip', id)
      return ok({ id, status: 'EN_ROUTE', zone: found.zone.name, fare, etaMin: Math.round((distKm / 28) * 60) }, 201)
    }

    return err(404, 'NO_ROUTE', `No handler for ${method} ${path}`)
  } catch (e) {
    // Log only the type/message (no full payloads/PII); return a generic error to the client.
    console.error('ERR', e?.name, e?.message)
    return err(500, 'INTERNAL', 'Internal error')
  }
}
