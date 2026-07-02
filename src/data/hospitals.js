// Hospital facilities are loaded at runtime from the API (DynamoDB ReferenceData).
// Only the controlled vocabularies below are static config.

export let HOSPITALS = []
export function setHospitals(list = []) { HOSPITALS = list }
export const hospitalById = (id) => HOSPITALS.find((h) => h.id === id)

const STOP = new Set([
  'hospital','medical','centre','center','clinic','general','community',
  'care','speciality','specialty','advanced','multi','super','multi-speciality',
  'multi-specialty','area','services',
])
export function shortHospitalName(name = '') {
  if (!name || name.length <= 22) return name
  const words = name.split(/\s+/)
  const meaningful = words.filter(w => !STOP.has(w.toLowerCase()))
  if (meaningful.length >= 2) return meaningful.slice(0, 2).join(' ')
  if (meaningful.length === 1) return meaningful[0]
  return words.map(w => w[0]).join('').toUpperCase()
}

export const CASE_TYPES = ['Cardiac', 'Trauma', 'General', 'Maternity', 'Pediatric']
export const SEVERITIES = ['Critical', 'Urgent', 'Normal']
export const SEVERITY_META = {
  Critical: { rank: 0, color: '#dc2626' },
  Urgent:   { rank: 1, color: '#d97706' },
  Normal:   { rank: 2, color: '#2563eb' },
}
