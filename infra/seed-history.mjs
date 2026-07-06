#!/usr/bin/env node
/* =====================================================================
   PSIOG Transport - seed additional synthetic historical dispatch rows
   into TransportRequestsHistorySynthetic, the isolated table the AI
   Insights / coverage-gaps analytics read from. NEVER touches the live
   TransportRequests table.

   Run in AWS CloudShell (Node + AWS CLI present):
     AWS_REGION=eu-west-1 START_ID=5501 COUNT=5500 node seed-history.mjs

   Every number the AI Insights page shows is computed server-side from
   whatever's in this table (peak hours, drift, seasonal multipliers,
   trend deltas) - nothing in Function.cs is hardcoded. This script's only
   job is to make the underlying timeline richer and more realistic so
   those computations have more genuine signal to work with:
     - per-zone peak-hour bias (so staffing recs differ meaningfully by zone)
     - a gentle multi-year call-volume trend (so incidents_trend_pct moves)
     - a monsoon (Jun-Sep) trauma-share bump (so the monsoon alert fires)
     - calendar-window event tags dated in their real real-world windows
   ===================================================================== */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REGION = process.env.AWS_REGION || 'eu-west-1'
const TABLE = process.env.TABLE || 'TransportRequestsHistorySynthetic'
const START_ID = parseInt(process.env.START_ID || '5501', 10)
const COUNT = parseInt(process.env.COUNT || '5500', 10)
const TMP = path.join(os.tmpdir(), 'psiog-seed-history-batch.json')

/* ---------- reference geometry (mirrors data/locations.js + seed-data.mjs) ---------- */
const ZONES = [
  { id: 'zone-bistupur', ref: { lat: 22.8012, lng: 86.1856 }, peakHour: 9 },
  { id: 'zone-sakchi', ref: { lat: 22.8045, lng: 86.2057 }, peakHour: 18 },
  { id: 'zone-kadma', ref: { lat: 22.7942, lng: 86.1719 }, peakHour: 13 },
  { id: 'zone-sonari', ref: { lat: 22.7860, lng: 86.1640 }, peakHour: 22 },
  { id: 'zone-factory', ref: { lat: 22.7710, lng: 86.2080 }, peakHour: 8 },
]
const HOSPITALS = [
  { id: 'hosp-tata-steel-advanced-multi-spec', lat: 22.8012, lng: 86.1856, specialties: ['Cardiac', 'Trauma', 'General', 'Maternity', 'Pediatric'] },
  { id: 'hosp-subarnarekha-super-speciality-', lat: 22.7942, lng: 86.1719, specialties: ['Cardiac', 'Trauma', 'General', 'Maternity', 'Pediatric'] },
  { id: 'hosp-sakchi-community-hospital', lat: 22.8045, lng: 86.2057, specialties: ['General', 'Trauma', 'Pediatric'] },
  { id: 'hosp-steel-city-general-hospital', lat: 22.7710, lng: 86.2080, specialties: ['General', 'Trauma'] },
  { id: 'hosp-foundry-area-medical-centre', lat: 22.7710, lng: 86.2080, specialties: ['General', 'Trauma'] },
  { id: 'hosp-jubilee-care-hospital', lat: 22.8012, lng: 86.1856, specialties: ['General', 'Maternity', 'Pediatric'] },
  { id: 'hosp-jrd-family-health-clinic', lat: 22.7860, lng: 86.1640, specialties: ['General'] },
  { id: "hosp-iron-valley-children-s-clinic", lat: 22.7942, lng: 86.1719, specialties: ['Pediatric', 'General'] },
  { id: "hosp-millennium-women-s-care-clinic", lat: 22.8045, lng: 86.2057, specialties: ['Maternity', 'General'] },
  { id: 'hosp-township-maternity-clinic', lat: 22.8012, lng: 86.1856, specialties: ['Maternity', 'General'] },
]
// [name, ref, zoneId] - a representative sample of named pickup locations per zone.
const LOCATIONS = [
  ['Bistupur Quarters', 'loc-bistupur', 'zone-bistupur'], ['Jubilee Park Hub', 'loc-jubilee', 'zone-bistupur'],
  ['Tata Steel Gymkhana', 'loc-gymkhana', 'zone-bistupur'], ['Keenan Stadium', 'loc-keenan', 'zone-bistupur'],
  ['JRD Tata Memorial Hostel', 'loc-jrd-tata-memorial-hostel', 'zone-bistupur'],
  ['Sakchi Quarters', 'loc-sakchi', 'zone-sakchi'], ['Sakchi Market', 'loc-sakchimkt', 'zone-sakchi'],
  ['DBMS College', 'loc-dbms', 'zone-sakchi'], ['Hotel Sonnet', 'loc-sonnet', 'zone-sakchi'],
  ['Sakchi Heritage Quarters', 'loc-sakchi-heritage-quarters', 'zone-sakchi'],
  ['Kadma Quarters', 'loc-kadma', 'zone-kadma'], ['Kadma Market', 'loc-kadmamkt', 'zone-kadma'],
  ['Annapurna Community Mess', 'loc-annapurna-community-mess', 'zone-kadma'],
  ['Mill Workers Welfare Colony', 'loc-mill-workers-welfare-colony', 'zone-kadma'],
  ['Sonari Quarters', 'loc-sonari', 'zone-sonari'], ['Sonari Aerodrome', 'loc-aerodrome', 'zone-sonari'],
  ['Subarnarekha Riverside Quarters', 'loc-subarnarekha-riverside-quarters', 'zone-sonari'],
  ['Factory Main Gate', 'loc-gate', 'zone-factory'], ['Central Workshop', 'loc-workshop', 'zone-factory'],
  ['Fuel Station Depot', 'loc-fuel', 'zone-factory'], ['Blue Furnace Township Residency', 'loc-blue-furnace-township-residency', 'zone-factory'],
  ['Burma Mines', 'loc-burma', 'zone-factory'],
]

const CASE_TYPES = ['Cardiac', 'Trauma', 'General', 'Maternity', 'Pediatric', 'Respiratory']
const SEVERITIES = ['Critical', 'Urgent', 'Normal']

const R = 6371
const havKm = (a, b) => {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

/* ---------- deterministic PRNG so re-running with the same START_ID/COUNT is reproducible ---------- */
let seed = 42
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const weightedPick = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v }
  return pairs[pairs.length - 1][0]
}
// Gaussian-ish jitter around an hour, wrapped into 0-23.
function hourNear(center, spread) {
  const h = Math.round(center + (rand() + rand() + rand() - 1.5) * spread)
  return ((h % 24) + 24) % 24
}

const FROM = new Date('2022-08-01T00:00:00Z').getTime()
const TO = new Date('2026-06-30T23:59:59Z').getTime()
const SPAN = TO - FROM

const av = (v) => {
  if (v === null || v === undefined) return { NULL: true }
  if (typeof v === 'number') return { N: String(v) }
  if (typeof v === 'boolean') return { BOOL: v }
  if (Array.isArray(v)) return { L: v.map(av) }
  if (typeof v === 'object') return { M: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, av(val)])) }
  return { S: String(v) }
}

function makeRow(n) {
  const id = `SIM-${String(n).padStart(6, '0')}`
  const zone = pick(ZONES)

  // Mild multi-year growth trend: later rows are somewhat more likely to
  // land later in the range, so incidents_trend_pct has real signal instead
  // of being flat noise.
  const growthBias = rand() ** 1.4
  const dayFrac = 0.15 + growthBias * 0.85
  let dayMs = FROM + dayFrac * SPAN

  const dt = new Date(dayMs)
  const month = dt.getUTCMonth() + 1 // 1-12
  const isMonsoon = month >= 6 && month <= 9

  // Per-zone peak-hour bias: each zone clusters around its own busiest hour
  // (so Little's Law staffing recs genuinely differ zone to zone), with a
  // fatter tail so the rest of the day still has coverage.
  const hour = rand() < 0.55 ? hourNear(zone.peakHour, 2.2) : Math.floor(rand() * 24)
  dt.setUTCHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), Math.floor(rand() * 1000))

  const kind = weightedPick([['medical', 68], ['fire', 20], ['blood', 12]])
  // Monsoon months skew harder toward Trauma (wet-road accidents) -
  // computed here as real seeded signal, not asserted by the frontend/backend.
  const caseType = kind === 'medical'
    ? (isMonsoon && rand() < 0.4 ? 'Trauma' : weightedPick(CASE_TYPES.map((c) => [c, c === 'Trauma' ? 14 : 16])))
    : null
  const severity = caseType === 'Cardiac' || caseType === 'Trauma'
    ? weightedPick([['Critical', 45], ['Urgent', 40], ['Normal', 15]])
    : weightedPick([['Critical', 12], ['Urgent', 38], ['Normal', 50]])

  const zoneLocs = LOCATIONS.filter((l) => l[2] === zone.id)
  const [locName, locRef] = pick(zoneLocs.length ? zoneLocs : LOCATIONS)
  const jitterKm = (rand() - 0.5) * 0.018
  const pickup = {
    name: locName, ref: locRef,
    lat: +(zone.ref.lat + jitterKm).toFixed(4),
    lng: +(zone.ref.lng + jitterKm * 1.3).toFixed(4),
  }

  const eligibleHosp = kind === 'medical' && caseType
    ? HOSPITALS.filter((h) => h.specialties.includes(caseType))
    : HOSPITALS
  const hosp = kind === 'medical' ? pick(eligibleHosp.length ? eligibleHosp : HOSPITALS) : null
  const distanceKm = hosp
    ? +Math.max(0.4, havKm(pickup, hosp) + rand() * 1.5).toFixed(2)
    : +Math.max(0.4, rand() * 6).toFixed(2)

  // ETAs correlate with distance and get inflated for rows landing in the
  // zone's own peak hour, mirroring real congestion rather than flat timing.
  const isPeakNow = Math.abs(hour - zone.peakHour) <= 1
  const congestion = isPeakNow ? 1.35 : 1.0
  const etaToPickupMin = +Math.max(0.5, (distanceKm / 32) * 60 * congestion * (0.8 + rand() * 0.5)).toFixed(1)
  const etaMin = +Math.max(0.4, etaToPickupMin * (0.4 + rand() * 0.5)).toFixed(1)

  const status = rand() < 0.055 ? 'CANCELLED' : 'COMPLETED'
  const patientsCount = rand() < 0.05 ? 2 + Math.floor(rand() * 2) : 1

  const typeShort = kind === 'fire' ? 'fire' : 'amb'
  const short = zone.id.replace('zone-', '')
  const vehIdx = 1 + Math.floor(rand() * (kind === 'fire' ? 6 : 5))
  const assignedVehicleId = `sim-veh-${short}-${typeShort}-${vehIdx}`
  const assignedDriverId = `sim-drv-${short}-${vehIdx}`

  // Calendar-window event tags, dated in their real real-world windows so
  // the "seasonal alerts" the backend detects line up with an actual timeline.
  let eventTag = null
  const y = dt.getUTCFullYear()
  if (y === 2022 && month === 1 && rand() < 0.5) eventTag = 'COVID_OMICRON_WAVE_2022'
  else if (y === 2022 && month === 2 && rand() < 0.35) eventTag = 'COVID_OMICRON_WAVE_2022'
  else if ((month === 10 || month === 11) && rand() < 0.3) eventTag = 'DIWALI_FIRE_SEASON'
  else if ((month === 12 && dt.getUTCDate() >= 28) || (month === 1 && dt.getUTCDate() <= 2)) {
    if (rand() < 0.4) eventTag = 'NEW_YEAR_EVE'
  }

  return {
    id, kind, case_type: caseType, severity,
    pickup_zone_id: zone.id, pickup,
    hospital_id: hosp ? hosp.id : null,
    assigned_vehicle_id: assignedVehicleId, assigned_driver_id: assignedDriverId,
    status, distance_km: distanceKm, eta_to_pickup_min: etaToPickupMin, eta_min: etaMin,
    patients_count: patientsCount, event_tag: eventTag, source: 'SIM_SEED', synthetic: true,
    created_at: dt.toISOString(),
  }
}

/* ---------- write in batches of 25 (DynamoDB BatchWriteItem limit) ---------- */
function batchWrite(rows) {
  const reqs = rows.map((r) => ({ PutRequest: { Item: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, av(v)])) } }))
  const body = { [TABLE]: reqs }
  writeFileSync(TMP, JSON.stringify(body))
  execSync(`aws dynamodb batch-write-item --region ${REGION} --request-items file://${TMP}`, { stdio: 'ignore' })
}

console.log(`Seeding ${COUNT} rows into ${TABLE} (${REGION}), ids ${START_ID}..${START_ID + COUNT - 1}`)
let written = 0
for (let i = 0; i < COUNT; i += 25) {
  const batch = []
  for (let j = i; j < Math.min(i + 25, COUNT); j++) batch.push(makeRow(START_ID + j))
  batchWrite(batch)
  written += batch.length
  if (written % 500 === 0 || written === COUNT) console.log(`  ${written}/${COUNT} written`)
}
console.log(`Done. ${written} rows added to ${TABLE}.`)
