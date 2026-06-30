import { create } from 'zustand'
import { setGeoReference, locById, bloodBankById } from '../data/locations'
import { setHospitals, hospitalById } from '../data/hospitals'
import { setPolicy } from '../services/policyService'
import { getRoute, getRouteAlternatives } from '../services/osrm'
import { factorForPath, trafficLevel, tickTraffic, setTrafficMode as applyTrafficMode } from '../services/traffic'
import { vehicleHomePos } from '../services/dispatchService'

// Pick the fastest *traffic-adjusted* route among OSRM alternatives (reroute around jams).
// Returns geometry + free-flow + traffic-adjusted minutes + the average congestion factor.
async function bestLeg(a, b) {
  const alts = await getRouteAlternatives([a, b])
  let best = null, bestAdj = Infinity, bestFactor = 1
  for (const r of alts) {
    const f = factorForPath(r.coordinates)
    const adj = r.durationMin * f
    if (adj < bestAdj) { bestAdj = adj; best = r; bestFactor = f }
  }
  best = best || alts[0]
  return { coordinates: best.coordinates, distanceKm: best.distanceKm, freeMin: best.durationMin, durationMin: bestAdj, factor: bestFactor }
}
import { api, API_ENABLED, normalizeVehicle, normalizeDriver } from '../services/api'

/* ---------- normalizers: DynamoDB items -> UI shapes ---------- */
const nEmg = (i) => ({ id: i.id, kind: i.kind || 'medical', pickup: i.pickup?.ref, caseType: i.case_type, severity: i.severity,
  state: i.status, createdAt: i.created_at, ambulanceId: i.assigned_vehicle_id || null,
  driverId: i.assigned_driver_id || null, hospitalId: i.hospital_id || null, requestedBy: i.requested_by || null,
  incidentId: i.incident_id || null, patientsCount: i.patients_count || 1, note: i.note || null,
  bloodBankId: i.blood_bank_id || null,
  fireStationId: i.fire_station_id || null,
  pickupName: i.pickup?.name || null,
  pickupPt: (typeof i.pickup?.lat === 'number') ? { lat: i.pickup.lat, lng: i.pickup.lng } : null,
  etaComplete: i.eta_complete || null,
  totalDistanceKm: i.distance_km || 0, totalEtaMin: i.eta_min || 0, etaToPickupMin: i.eta_to_pickup_min || 0 })
const nHosp = (h) => ({ ...h })

export const useFleetStore = create((set, get) => ({
  vehicles: [], drivers: [], emergencies: [], hospitals: [], firestations: [],
  live: {},
  ready: false, error: null, initialized: false,
  trafficMode: 'auto', // auto | clear | moderate | heavy | gridlock (demo control)
  policyConfig: {}, // operational policy params from the backend (set by the policy-sync agent)
  clearedIds: new Set(JSON.parse(sessionStorage.getItem('psiog_db_cleared') || '[]')),
  setClearedIds: (set_) => {
    sessionStorage.setItem('psiog_db_cleared', JSON.stringify([...set_]))
    set({ clearedIds: new Set(set_) })
  },

  // Load the active operational policy from the backend (/health echoes it).
  async loadPolicy() {
    try { const h = await api.getHealth(); set({ policyConfig: h?.policy || {} }) } catch {}
  },

  // Admin uploads a policy PDF (base64) -> backend stores it + runs the policy-sync
  // agent -> returns the applied params. Then refresh the displayed policy.
  async uploadPolicyDoc(content_base64, filename) {
    const r = await api.uploadPolicy(content_base64, filename)
    if (r?.applied) set({ policyConfig: r.applied })
    get().loadPolicy()
    return r
  },

  // Force a traffic level for demos; re-hydrates routes so ETAs/colors update now.
  setTrafficMode(mode) {
    applyTrafficMode(mode)
    set({ trafficMode: mode, live: {} }) // clear live geometry so it re-picks routes under the new traffic
    set((s) => ({ emergencies: s.emergencies.map((e) => ({ ...e, leg1: undefined, leg2: undefined, leg3: undefined })) }))
    get().hydrateLive().catch(() => {})
  },

  // ---------- init: load EVERYTHING from the API (DynamoDB). No mock. ----------
  async init() {
    if (get().initialized) return
    set({ initialized: true })
    if (!API_ENABLED) { set({ error: 'No backend configured. Set VITE_API_URL to the deployed API.' }); return }
    try {
      const [locations, zones, hospitals, firestations, policy] = await Promise.all([
        api.getLocations(), api.getZones(), api.getHospitals(), api.getFirestations(), api.getPolicy(),
      ])
      setGeoReference(locations, zones)
      setHospitals((hospitals || []).map(nHosp))
      setPolicy(policy)
      set({ hospitals: (hospitals || []).map(nHosp), firestations: firestations || [] })
      get().loadPolicy()
      await get().refreshFromApi()
      set({ ready: true })
      // Live geometry is best-effort; never let it block app load.
      get().hydrateLive().catch((e) => console.warn('live geometry skipped:', e?.message))
    } catch (e) {
      set({ error: `Failed to load from backend: ${e.message}` })
    }
  },

  async refreshFromApi() {
    const [fleet, ops] = await Promise.all([api.getFleet(), api.getOps()])
    // Preserve client-only route geometry (legs) across refreshes so the live map
    // doesn't flicker when polling.
    const prev = get().emergencies
    const legs = Object.fromEntries(prev.map((e) => [e.id, { leg1: e.leg1, leg2: e.leg2, leg3: e.leg3, traffic: e.traffic, trafficFactor: e.trafficFactor }]))
    const prevById = Object.fromEntries(prev.map((e) => [e.id, e]))
    set({
      vehicles: (fleet.vehicles || []).map(normalizeVehicle),
      drivers: (fleet.drivers || []).map(normalizeDriver),
      emergencies: (ops.emergencies || []).map((i) => {
        const m = nEmg(i); const p = prevById[m.id]
        // The client animation can finish a short trip (e.g. a fire run) before the
        // backend's eta_complete passes. Keep the locally-COMPLETED state instead of
        // letting the poll flip it back to EN_ROUTE — stops the status flicker.
        if (p && p.state === 'COMPLETED' && m.state === 'EN_ROUTE') m.state = 'COMPLETED'
        const L = legs[m.id]; return L ? { ...m, ...L } : m
      }),
    })
  },

  // Build live OSRM geometry (client-side) for any EN_ROUTE emergency missing it.
  // Medical = 2 legs (to scene, then to hospital); fire = 1 leg (to scene).
  async hydrateLive() {
    const s = get()
    const tasks = s.emergencies.filter((e) => e.state === 'EN_ROUTE' && e.ambulanceId && !s.live[e.ambulanceId])
    for (const job of tasks) {
      // One bad/stale record (missing location/hospital) must not break the rest.
      try {
        const veh = get().vehicles.find((v) => v.id === job.ambulanceId)
        const pickupLoc = job.kind === 'blood' ? job.pickupPt : locById(job.pickup)
        if (!pickupLoc) continue
        const start = veh ? vehicleHomePos(veh) : pickupLoc

        // Blood = round trip: start -> hospital(pickup) -> blood bank -> hospital. Three legs.
        if (job.kind === 'blood') {
          const bank = bloodBankById(job.bloodBankId)
          if (!bank) continue
          const leg1 = await bestLeg(start, pickupLoc)
          const leg2 = await bestLeg(pickupLoc, bank)
          const leg3 = await bestLeg(bank, pickupLoc)
          const coords = [...leg1.coordinates, ...leg2.coordinates, ...leg3.coordinates]
          if (!coords.length) continue
          const freeMin = leg1.freeMin + leg2.freeMin + leg3.freeMin
          const etaMin = +(leg1.durationMin + leg2.durationMin + leg3.durationMin).toFixed(1)
          const factor = freeMin > 0 ? etaMin / freeMin : 1
          const speed = factor > 0 ? 1 / factor : 1
          set((st) => ({ live: { ...st.live, [job.ambulanceId]: { coords, idx: 0, idxF: 0, speed, pos: coords[0], jobId: job.id } },
            emergencies: st.emergencies.map((e) => e.id === job.id ? { ...e, leg1: leg1.coordinates, leg2: leg2.coordinates, leg3: leg3.coordinates, traffic: trafficLevel(factor), trafficFactor: factor } : e) }))
          const distanceKm = +(leg1.distanceKm + leg2.distanceKm + leg3.distanceKm).toFixed(1)
          const etaToPickupMin = +leg1.durationMin.toFixed(1)
          api.writeRoute(job.id, { distance_km: distanceKm, eta_min: etaMin, eta_to_pickup_min: etaToPickupMin }).catch(() => {})
          set((st) => ({ emergencies: st.emergencies.map((e) => e.id === job.id ? { ...e, totalDistanceKm: distanceKm, totalEtaMin: etaMin, etaToPickupMin } : e) }))
          continue
        }

        const hosp = hospitalById(job.hospitalId)
        const leg1 = await bestLeg(start, pickupLoc)
        const leg2 = hosp ? await bestLeg(pickupLoc, hosp) : { coordinates: [], distanceKm: 0, durationMin: 0, freeMin: 0 }
        const coords = [...leg1.coordinates, ...leg2.coordinates]
        if (!coords.length) continue
        const freeMin = leg1.freeMin + leg2.freeMin
        const etaMin = +(leg1.durationMin + leg2.durationMin).toFixed(1)
        const factor = freeMin > 0 ? etaMin / freeMin : 1
        const speed = factor > 0 ? 1 / factor : 1
        set((st) => ({ live: { ...st.live, [job.ambulanceId]: { coords, idx: 0, idxF: 0, speed, pos: coords[0], jobId: job.id } },
          emergencies: st.emergencies.map((e) => e.id === job.id ? { ...e, leg1: leg1.coordinates, leg2: leg2.coordinates, traffic: trafficLevel(factor), trafficFactor: factor } : e) }))
        // Write the traffic-adjusted distance/duration back so the UI ETA matches the animation.
        const distanceKm = +(leg1.distanceKm + leg2.distanceKm).toFixed(1)
        const etaToPickupMin = +leg1.durationMin.toFixed(1)
        api.writeRoute(job.id, { distance_km: distanceKm, eta_min: etaMin, eta_to_pickup_min: etaToPickupMin }).catch(() => {})
        set((st) => ({ emergencies: st.emergencies.map((e) => e.id === job.id ? { ...e, totalDistanceKm: distanceKm, totalEtaMin: etaMin, etaToPickupMin } : e) }))
      } catch (e) { console.warn('skip live job', job.id, e?.message) }
    }
  },

  // ---------- live tick (client-side animation of the stored EN_ROUTE emergencies) ----------
  tick() {
    tickTraffic() // advance the simulated traffic (self-throttled)
    set((s) => {
      const live = { ...s.live }
      let { vehicles, emergencies } = s
      for (const id of Object.keys(live)) {
        const l = live[id]; if (!l.coords?.length) continue
        // advance by a congestion-scaled step (speed<1 = slower in heavy traffic)
        const idxF = (l.idxF ?? l.idx) + (l.speed || 1)
        const idx = Math.floor(idxF)
        if (idx >= l.coords.length) {
          vehicles = vehicles.map((v) => v.id === id ? { ...v, status: 'idle' } : v)
          emergencies = emergencies.map((e) => e.id === l.jobId ? { ...e, state: 'COMPLETED' } : e)
          delete live[id]; continue
        }
        live[id] = { ...l, idx, idxF, pos: l.coords[idx] }
      }
      return { live, vehicles, emergencies }
    })
  },

  // ---------- emergency ----------
  // units > 1 = mass-casualty (multiple ambulances to one incident); patients = multi-patient count.
  async createEmergency({ kind = 'medical', pickup, pickupPoint, bloodBank, caseType, severity = 'Urgent', note, requestedBy, units = 1, patients = 1 }) {
    try {
      // Blood requests carry the requesting hospital's coordinates as the pickup
      // plus a destination blood bank; medical/fire use a Location ref.
      const pickupPayload = kind === 'blood' ? pickupPoint : { ref: pickup }
      const r = await api.createEmergency({ external_ref: 'UI-' + Date.now(), kind, source: kind === 'fire' ? 'FIRE' : 'HOSPITAL',
        pickup: pickupPayload, case_type: kind === 'fire' ? 'Fire' : kind === 'blood' ? 'Blood' : caseType,
        blood_bank_id: bloodBank, severity, requested_by: requestedBy, note, units, patients })
      await get().refreshFromApi(); await get().hydrateLive()
      if (r.incident_id) {
        // mass-casualty summary
        return { ok: r.dispatched > 0, id: r.incident_id, mass: true, dispatched: r.dispatched, units: r.units,
          reason: r.dispatched === 0 ? 'No units available' : undefined }
      }
      if (r.status === 'EN_ROUTE') {
        const veh = get().vehicles.find((v) => v.id === r.assigned_vehicle_id)
        const hosp = r.hospital_id ? hospitalById(r.hospital_id) : null
        return { ok: true, id: r.id, vehicle: veh?.reg || r.assigned_vehicle_id, hospital: hosp?.name, bloodBank: r.blood_bank }
      }
      return { ok: false, id: r.id, reason: r.reason }
    } catch (e) { return { ok: false, reason: e.message } }
  },

  // Manual override: reassign vehicle and/or hospital on an active emergency.
  async reassignEmergency(id, { vehicleId, hospitalId } = {}) {
    try {
      await api.reassignEmergency(id, { vehicleId, hospitalId })
      // drop any stale live geometry so it re-hydrates from the new assignment
      set((s) => { const live = { ...s.live }; Object.keys(live).forEach((k) => { if (live[k].jobId === id) delete live[k] }); return { live } })
      await get().refreshFromApi(); await get().hydrateLive()
      return { ok: true }
    } catch (e) { return { ok: false, reason: e.message } }
  },

  // Cancel an active response (resolves EMG ids by prefix on the backend).
  async cancelRequest(id) { await api.cancelRequest(id); await get().refreshFromApi() },

  // ---------- fleet ----------
  async setVehicleStatus(vehicleId, status) { await api.setVehicleStatus(vehicleId, status); await get().refreshFromApi() },
}))
