// Policy is re-keyed by job_level: loaded at runtime from the API.
// policy.levels = ordered bands; a band is identified by its id (e.g. "L9").
let _policy = { levels: [], vehicle_type_caps: {} }

export function setPolicy(p) { if (p) _policy = p }
export function getPolicy() { return _policy }

export function bandById(code) { return (_policy.levels || []).find((b) => b.id === code) }
export function bandForLevel(level) {
  return [...(_policy.levels || [])].sort((a, b) => b.min_level - a.min_level)
    .find((b) => Number(level) >= b.min_level) || null
}

// gradesList() kept for component compatibility: returns bands as {code,label,...}.
export function gradesList() {
  return (_policy.levels || []).map((b) => ({
    code: b.id, label: b.label, allowed_vehicle_types: b.allowed_vehicle_types,
    monthly_fuel_cap_litres: b.monthly_fuel_cap_litres, shuttle_rides: b.shuttle_rides,
  }))
}
export function isVehicleTypeAllowed(code, vehicleType) {
  return !!bandById(code)?.allowed_vehicle_types?.includes(vehicleType)
}
export function gradeFuelCap(code) { return bandById(code)?.monthly_fuel_cap_litres ?? 0 }
export function shuttleRidesFor(code) { return bandById(code)?.shuttle_rides ?? 0 }
export function vehicleFuelCap(vehicleType) { return _policy.vehicle_type_caps?.[vehicleType] ?? 100 }
