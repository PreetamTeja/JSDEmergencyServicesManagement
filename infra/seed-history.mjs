#!/usr/bin/env node
/* =====================================================================
   PSIOG Transport - seed synthetic historical dispatch rows into
   TransportRequestsHistorySynthetic, the isolated table the AI Insights /
   coverage-gaps analytics read from. NEVER touches the live
   TransportRequests table.

   Run in AWS CloudShell (Node + AWS CLI present):
     AWS_REGION=eu-west-1 START_ID=5501 COUNT=5500 node seed-history.mjs

   Follows the shared platform-wide historical timeline (2010-2026,
   Jamshedpur Welfare Portal) so this service's synthetic data lines up
   with every other service's on the same real-world event windows. This
   service maps to the timeline's "Healthcare" segment behavior (it's
   emergency medical/fire dispatch, not commuter transport) - notably:
   volume EXPLODES during COVID rather than following the prosperity
   index, since "illness doesn't follow markets."

   Design (see comments at each section for the "why"):
     - Full 2010-01-01 .. 2026-07-08 range, year-weighted so quiet years
       (2012/2014/2025) stay quiet and shock years get real density.
     - Response quality (congestion, cancellation rate) follows the
       Tata Steel prosperity index - bad years = slower, stricter.
     - Response *volume* mostly does NOT follow prosperity for this
       service (healthcare != discretionary welfare spend), except the
       explicit COVID explosion and 2022 revenge-demand/supercycle bump.
     - Real calendar events: COVID cliff+two humps, steel crisis
       tightening, flood years (exact months), monsoon trauma bump,
       Durga Puja/Chhath lull (2022 inverted to a spike per the
       cross-platform "revenge demand" story), 2018 Bhushan Steel
       new-catchment bump, 2024 election dip, 2010 go-live migration tag.
     - One deliberate, commented outlier batch (golden rule: outliers
       need a one-line story, not silent noise).
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

/* =====================================================================
   THE SHARED TIMELINE (platform-wide, see Historical_Timeline_Trends.md)
   ===================================================================== */

// Tata Steel prosperity index, 0-100, per the shared backdrop table.
const PROSPERITY = { 2010: 72, 2011: 75, 2012: 68, 2013: 58, 2014: 65, 2015: 42, 2016: 38, 2017: 55, 2018: 66, 2019: 52, 2020: 30, 2021: 70, 2022: 88, 2023: 72, 2024: 68, 2025: 70, 2026: 70 }

// Response *volume* weight per year. Healthcare/emergency demand doesn't
// track prosperity the way discretionary welfare spend does - kept close
// to 1.0 except the two real shocks that DO move medical/fire call volume:
// the COVID public-health emergency, and 2022's "revenge demand" bump
// (postponed elective/non-critical care catching up) layered on top of
// the supercycle's operational generosity.
const YEAR_VOLUME_WEIGHT = {
  2010: 1.00, 2011: 1.00, 2012: 0.95, 2013: 1.00, 2014: 0.97, 2015: 1.00, 2016: 1.00,
  2017: 1.00, 2018: 1.05, 2019: 0.95, 2020: 1.55, 2021: 1.45, 2022: 1.22,
  2023: 1.05, 2024: 1.00, 2025: 0.97, 2026: 1.00,
}
// 2026 only runs through July - half the weight so it doesn't get seeded
// as if it were a full year.
const YEAR_LENGTH_FRAC = { 2026: 0.52 }

// Response *quality* follows prosperity directly: bad years = slower
// dispatch (budget-constrained fleet/staffing) and more cancellations
// (units unavailable). 2022 (prosperity 88) is the best-ever operational
// year; 2020/2016 are the worst.
function congestionFactor(year) {
  const p = PROSPERITY[year] ?? 65
  return Math.max(0.85, Math.min(1.4, 1 + (68 - p) / 90))
}
function cancellationRate(year) {
  const p = PROSPERITY[year] ?? 65
  return Math.max(0.03, Math.min(0.11, 0.055 + (68 - p) / 100 * 0.06))
}

const FROM = new Date('2010-01-01T00:00:00Z').getTime()
const TO = new Date('2026-07-08T23:59:59Z').getTime()

// Approximate Vijayadashami/Dussehra date per year - the Durga Puja/Chhath
// window's real center per the shared timeline is lunar and shifts yearly;
// these are close approximations for a synthetic demo, not liturgically
// exact. The 10-14 day lull is centred ±7 days around this date.
const DUSSEHRA = { 2010: '10-17', 2011: '10-06', 2012: '10-24', 2013: '10-13', 2014: '10-03', 2015: '10-22', 2016: '10-11', 2017: '09-30', 2018: '10-19', 2019: '10-08', 2020: '10-25', 2021: '10-15', 2022: '10-05', 2023: '10-24', 2024: '10-12', 2025: '10-02', 2026: '10-20' }

function yearOf(ms) { return new Date(ms).getUTCFullYear() }

// Weighted year sampler: builds a cumulative table once, combining
// PROSPERITY-independent volume weight with the fraction of the calendar
// each year actually spans (so 2026 gets proportionally fewer rows).
const YEARS = Object.keys(YEAR_VOLUME_WEIGHT).map(Number)
const yearWeights = YEARS.map((y) => YEAR_VOLUME_WEIGHT[y] * (YEAR_LENGTH_FRAC[y] ?? 1))
function pickYear() { return weightedPick(YEARS.map((y, i) => [y, yearWeights[i]])) }

// Picks a random ms timestamp within the given year, then applies a
// day-level acceptance weight for festival lull / 2022 Puja spike /
// election dip - rejection-sampled (a few retries) rather than a hard
// filter, so the effect is a density shift, not a cliff.
function pickDayInYear(year, maxTries = 6) {
  const yStart = Math.max(FROM, new Date(Date.UTC(year, 0, 1)).getTime())
  const yEnd = Math.min(TO, new Date(Date.UTC(year, 11, 31, 23, 59, 59)).getTime())
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const ms = yStart + rand() * (yEnd - yStart)
    const w = dayAcceptWeight(ms, year)
    if (rand() < w) return ms
  }
  return yStart + rand() * (yEnd - yStart)
}

function dayAcceptWeight(ms, year) {
  const dt = new Date(ms)
  const month = dt.getUTCMonth() + 1
  const date = dt.getUTCDate()
  let w = 1.0

  // Durga Puja / Chhath window: general transactional lull everywhere on
  // the platform. For THIS service, emergencies don't pause for festivals,
  // so the dip is mild (0.75x) rather than the sharper admin-side lull
  // other segments see - except 2022, which the shared timeline calls out
  // explicitly as the platform's single biggest event-record spike
  // ("revenge demand"): inverted here to a 1.8x bump.
  const dh = DUSSEHRA[year]
  if (dh) {
    const [dm, dd] = dh.split('-').map(Number)
    const dCenter = Date.UTC(year, dm - 1, dd)
    const daysFrom = Math.abs(ms - dCenter) / 86400000
    if (daysFrom <= 7) w *= (year === 2022 ? 1.8 : 0.75)
  }

  // 2024 general elections (May-Jun): brief 2-3 week activity dip.
  if (year === 2024 && month >= 5 && month <= 6) w *= 0.85

  // Founder's Day (3 Mar +/-2 days): admin pause platform-wide; emergency
  // dispatch itself keeps running, so only a token dip.
  if (month === 3 && date >= 1 && date <= 5) w *= 0.92

  return w
}

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

  const year = pickYear()
  let dayMs = pickDayInYear(year)
  const dt = new Date(dayMs)
  let month = dt.getUTCMonth() + 1
  const isMonsoon = month >= 6 && month <= 9

  // ---- COVID-19: the structural break (Mar 2020 - Jun 2021) ----
  // Cliff on 25 Mar 2020 (lockdown), not a ramp. Two explosion humps
  // (first wave Apr-Jun 2020, Delta Apr-Jun 2021) per the shared timeline;
  // Healthcare is the one segment that EXPLODES rather than pausing.
  const lockdownStart = Date.UTC(2020, 2, 25)
  const covidEnd = Date.UTC(2021, 5, 30, 23, 59, 59)
  const inCovidWindow = dayMs >= lockdownStart && dayMs <= covidEnd
  const inFirstWaveHump = dayMs >= Date.UTC(2020, 3, 1) && dayMs <= Date.UTC(2020, 5, 30)
  const inDeltaHump = dayMs >= Date.UTC(2021, 3, 1) && dayMs <= Date.UTC(2021, 5, 30)

  // ---- Flood years: Aug 2017, Sep 2019, Aug 2023 (exact months, same
  // dates as every other service on the platform - the #1 cross-segment
  // consistency test). ----
  const inFloodWindow =
    (year === 2017 && month === 8) ||
    (year === 2019 && month === 9) ||
    (year === 2023 && month === 8)

  const kind = weightedPick([['medical', 68], ['fire', 20], ['blood', 12]])

  // Monsoon + flood months skew harder toward Trauma (wet-road accidents,
  // structural incidents); flood windows push this much further (x4-6 per
  // the shared timeline) than an ordinary monsoon month.
  const traumaBoost = inFloodWindow ? 0.85 : (isMonsoon ? 0.4 : 0)
  let caseType = kind === 'medical'
    ? (rand() < traumaBoost ? 'Trauma' : weightedPick(CASE_TYPES.map((c) => [c, c === 'Trauma' ? 14 : 16])))
    : null

  // During COVID, elective/non-critical medical care effectively pauses -
  // almost everything that DOES come through is acute (Respiratory/
  // Cardiac/Trauma), matching "everything else in this segment pauses."
  if (kind === 'medical' && inCovidWindow && rand() < 0.6) {
    caseType = weightedPick([['Respiratory', 45], ['Cardiac', 25], ['Trauma', 20], ['General', 10]])
  }

  const severity = inCovidWindow
    ? weightedPick([['Critical', 55], ['Urgent', 35], ['Normal', 10]]) // acute-only during COVID
    : caseType === 'Cardiac' || caseType === 'Trauma'
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

  // Per-zone peak-hour bias, congestion-scaled by year (steel-crisis /
  // COVID years run slower fleets/response), and further inflated if the
  // row lands in that zone's own peak hour.
  const hour = rand() < 0.55 ? hourNear(zone.peakHour, 2.2) : Math.floor(rand() * 24)
  dt.setUTCHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), Math.floor(rand() * 1000))
  const isPeakNow = Math.abs(hour - zone.peakHour) <= 1
  const congestion = (isPeakNow ? 1.35 : 1.0) * congestionFactor(year)
  const etaToPickupMin = +Math.max(0.5, (distanceKm / 32) * 60 * congestion * (0.8 + rand() * 0.5)).toFixed(1)
  const etaMin = +Math.max(0.4, etaToPickupMin * (0.4 + rand() * 0.5)).toFixed(1)

  const status = rand() < cancellationRate(year) ? 'CANCELLED' : 'COMPLETED'
  const patientsCount = rand() < 0.05 ? 2 + Math.floor(rand() * 2) : 1

  // ---- BI-model enrichment: everything below is additive (new columns
  // only) so it doesn't disturb the volume/timing logic above. Added to
  // give the star schema real measures/dimensions beyond the original flat
  // set: a real duration (completed_at), operational cost/fuel, SLA and
  // resolution outcome, a varied request-source dimension, weather, and a
  // non-clinical demographic split for medical cases. ----

  // completedAt: created_at + total ETA + a small on-scene/handover buffer.
  // Cancelled trips never "complete" a run, so no completion timestamp.
  const handoverMin = status === 'COMPLETED' ? 4 + rand() * 12 : 0
  const completedAt = status === 'COMPLETED'
    ? new Date(dt.getTime() + (etaMin + handoverMin) * 60000).toISOString()
    : null

  // traffic_factor: same congestion signal already driving ETA, exposed
  // directly as a measure so a dashboard can chart it without re-deriving.
  const trafficFactor = +congestion.toFixed(2)

  // resolution_type: outcome bucket, independent of CANCELLED/COMPLETED so
  // a dashboard can break down *why* a completed run looked the way it did.
  const resolutionType = status === 'CANCELLED'
    ? 'Cancelled'
    : kind === 'fire'
      ? weightedPick([['Fire Extinguished', 60], ['False Alarm', 15], ['Assisted / No Fire Found', 25]])
      : hosp
        ? weightedPick([['Treated & Transported', 78], ['Treated on Scene', 14], ['False Alarm', 8]])
        : weightedPick([['Treated on Scene', 55], ['False Alarm', 20], ['Refused Transport', 25]])

  // requester_source: who/what originated the dispatch. Previously a
  // hardcoded constant (SIM_SEED) with no analytical value; now a real,
  // kind-biased dimension mirroring the live app's actual source channels.
  const requesterSource = kind === 'fire'
    ? weightedPick([['FIRE', 70], ['CONSOLE', 20], ['PORTAL', 10]])
    : weightedPick([['HOSPITAL', 40], ['PORTAL', 30], ['CONSOLE', 20], ['VOICE', 10]])

  // sla_breach: policy-style threshold on time-to-pickup, tighter for
  // Critical severity - a straightforward compliance measure.
  const slaThresholdMin = severity === 'Critical' ? 10 : severity === 'Urgent' ? 15 : 20
  const slaBreach = etaToPickupMin > slaThresholdMin

  // cost_estimate / fuel_used_l: simple per-km operating-cost model,
  // fire trucks costed higher (larger vehicle, lower fuel economy).
  const costPerKm = kind === 'fire' ? 145 : 62
  const baseFee = kind === 'fire' ? 800 : 250
  const costEstimate = +(baseFee + distanceKm * costPerKm * (0.85 + rand() * 0.3)).toFixed(0)
  const kmpl = kind === 'fire' ? 2.6 : 7.5
  const fuelUsedL = +(distanceKm / kmpl).toFixed(2)

  // reassigned_count: mostly 0; occasional reassignment more likely in
  // low-congestion-quality years (steel-crisis/COVID strain on dispatch).
  const reassignChance = 0.04 * congestionFactor(year)
  const reassignedCount = rand() < reassignChance ? 1 + (rand() < 0.15 ? 1 : 0) : 0

  // weather_condition: ties into the same flood/monsoon windows already
  // driving trauma-mix above, plus a simple winter/summer split so it's not
  // just "Rain vs Clear" year-round.
  const weatherCondition = inFloodWindow
    ? 'Flood'
    : isMonsoon
      ? weightedPick([['Heavy Rain', 40], ['Light Rain', 35], ['Overcast', 25]])
      : (month === 12 || month === 1 || month === 2)
        ? weightedPick([['Foggy', 30], ['Cold & Clear', 50], ['Clear', 20]])
        : (month >= 3 && month <= 5)
          ? weightedPick([['Hot & Dry', 55], ['Clear', 35], ['Hazy', 10]])
          : weightedPick([['Clear', 60], ['Hazy', 25], ['Overcast', 15]])

  // age_band / gender: non-clinical demographic split, medical dispatches
  // only. Deliberately coarse (bands, not ages) and case-type-informed
  // (Pediatric skews young, Maternity is female by definition) rather than
  // uniform-random, so it reads as a plausible population, not noise.
  let ageBand = null, gender = null
  if (kind === 'medical') {
    if (caseType === 'Pediatric') ageBand = weightedPick([['0-5', 55], ['6-12', 45]])
    else if (caseType === 'Maternity') ageBand = weightedPick([['18-25', 35], ['26-35', 45], ['36-45', 20]])
    else if (caseType === 'Cardiac') ageBand = weightedPick([['41-60', 35], ['61-75', 40], ['76+', 25]])
    else ageBand = weightedPick([['13-25', 15], ['26-40', 25], ['41-60', 30], ['61-75', 20], ['76+', 10]])
    gender = caseType === 'Maternity' ? 'F' : weightedPick([['F', 48], ['M', 50], ['O', 2]])
  }

  const typeShort = kind === 'fire' ? 'fire' : 'amb'
  const short = zone.id.replace('zone-', '')
  const vehIdx = 1 + Math.floor(rand() * (kind === 'fire' ? 6 : 5))
  const assignedVehicleId = `sim-veh-${short}-${typeShort}-${vehIdx}`
  const assignedDriverId = `sim-drv-${short}-${vehIdx}`

  // Calendar-window event tags, dated to the shared platform timeline.
  let eventTag = null
  const date = dt.getUTCDate()
  if (year === 2010 && month <= 3) eventTag = rand() < 0.15 ? 'PORTAL_GOLIVE_MIGRATION_2010' : eventTag
  else if (inFirstWaveHump) eventTag = 'COVID_LOCKDOWN_WAVE1_2020'
  else if (inDeltaHump) eventTag = 'COVID_DELTA_WAVE_2021'
  else if (year === 2021 && month === 1 && rand() < 0.2) eventTag = 'COVID_VACCINATION_DRIVE_2021'
  else if (year === 2022 && (month === 1 || month === 2) && rand() < 0.4) eventTag = 'COVID_OMICRON_WAVE_2022'
  else if (inFloodWindow) eventTag = 'MONSOON_FLOOD_EVENT'
  else if (year === 2018 && month >= 5 && month <= 9 && rand() < 0.2) eventTag = 'BHUSHAN_STEEL_TRANSFER_COHORT_2018'
  else if ((month === 10 || month === 11) && rand() < 0.3) eventTag = 'DIWALI_FIRE_SEASON'
  else if ((month === 12 && date >= 28) || (month === 1 && date <= 2)) { if (rand() < 0.4) eventTag = 'NEW_YEAR_EVE' }
  else if (year === 2016 && rand() < 0.05) eventTag = 'STEEL_CRISIS_BUDGET_TIGHTENING_2016'

  return {
    id, kind, case_type: caseType, severity,
    pickup_zone_id: zone.id, pickup,
    hospital_id: hosp ? hosp.id : null,
    assigned_vehicle_id: assignedVehicleId, assigned_driver_id: assignedDriverId,
    status, distance_km: distanceKm, eta_to_pickup_min: etaToPickupMin, eta_min: etaMin,
    patients_count: patientsCount, event_tag: eventTag, source: 'SIM_SEED', synthetic: true,
    created_at: dt.toISOString(),
    completed_at: completedAt, traffic_factor: trafficFactor, resolution_type: resolutionType,
    requester_source: requesterSource, sla_breach: slaBreach, sla_threshold_min: slaThresholdMin,
    cost_estimate: costEstimate, fuel_used_l: fuelUsedL, reassigned_count: reassignedCount,
    weather_condition: weatherCondition, age_band: ageBand, gender,
  }
}

// ---- One deliberate outlier batch (golden rule: outliers need a story).
// A handful of Jan 2010 go-live migration rows carry unrealistically high
// patient counts - a plausible artifact of bulk-entering old paper
// records where multi-casualty incidents got merged during transcription.
// Kept under 2% of total volume, tagged so it reads as a known anomaly-
// detection demo case rather than a silent data bug.
function applyMigrationOutliers(rows) {
  let tagged = 0
  const maxOutliers = Math.max(1, Math.round(rows.length * 0.015))
  for (const r of rows) {
    if (tagged >= maxOutliers) break
    if (r.event_tag === 'PORTAL_GOLIVE_MIGRATION_2010' && rand() < 0.3) {
      r.patients_count = 6 + Math.floor(rand() * 6)
      r.event_tag = 'PORTAL_GOLIVE_MIGRATION_2010_BULK_ENTRY_ARTIFACT'
      tagged++
    }
  }
}

/* ---------- write in batches of 25 (DynamoDB BatchWriteItem limit) ---------- */
function batchWrite(rows) {
  const reqs = rows.map((r) => ({ PutRequest: { Item: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, av(v)])) } }))
  const body = { [TABLE]: reqs }
  writeFileSync(TMP, JSON.stringify(body))
  execSync(`aws dynamodb batch-write-item --region ${REGION} --request-items file://${TMP}`, { stdio: 'ignore' })
}

console.log(`Seeding ${COUNT} rows into ${TABLE} (${REGION}), ids ${START_ID}..${START_ID + COUNT - 1}, span 2010-01-01..2026-07-08`)
let written = 0
for (let i = 0; i < COUNT; i += 25) {
  const batch = []
  for (let j = i; j < Math.min(i + 25, COUNT); j++) batch.push(makeRow(START_ID + j))
  applyMigrationOutliers(batch)
  batchWrite(batch)
  written += batch.length
  if (written % 500 === 0 || written === COUNT) console.log(`  ${written}/${COUNT} written`)
}
console.log(`Done. ${written} rows added to ${TABLE}.`)
