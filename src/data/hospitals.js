// Hospital facilities are loaded at runtime from the API (DynamoDB ReferenceData).
// Only the controlled vocabularies below are static config.

export let HOSPITALS = []
export function setHospitals(list = []) { HOSPITALS = list }
export const hospitalById = (id) => HOSPITALS.find((h) => h.id === id)

export const CASE_TYPES = ['Cardiac', 'Trauma', 'General', 'Maternity', 'Pediatric']
export const SEVERITIES = ['Critical', 'Urgent', 'Normal']
export const SEVERITY_META = {
  Critical: { rank: 0, color: '#dc2626' },
  Urgent:   { rank: 1, color: '#d97706' },
  Normal:   { rank: 2, color: '#2563eb' },
}
