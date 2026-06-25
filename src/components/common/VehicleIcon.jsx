import React from 'react'

// Simple, minimal glyphs — read well even at tiny sizes. 24x24 viewBox.
export const VEHICLE_PATHS = {
  car: '<rect x="3" y="10" width="14" height="5" rx="1.5"/><path d="M6 10l1.5-3h5L14 10"/><circle cx="7" cy="16" r="1"/><circle cx="13" cy="16" r="1"/>',
  bus: '<rect x="4" y="6" width="14" height="9" rx="1.5"/><path d="M4 11h14"/><circle cx="8" cy="16" r="1"/><circle cx="14" cy="16" r="1"/>',
  bike: '<circle cx="6" cy="15" r="2.4"/><circle cx="17" cy="15" r="2.4"/><path d="M6 15l3-5h4l2 5M9 10h3"/>',
  van: '<rect x="3" y="8" width="9" height="7" rx="1"/><path d="M12 10h4l3 3v2h-7z"/><circle cx="7" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
  ambulance: '<rect x="3" y="8" width="9" height="7" rx="1"/><path d="M12 10h4l3 3v2h-7z"/><circle cx="7" cy="16" r="1"/><circle cx="16" cy="16" r="1"/><path d="M6 11.5h3M7.5 10v3"/>',
  firetruck: '<rect x="2" y="9" width="11" height="6" rx="1"/><path d="M13 11h4l4 2v2h-8z"/><circle cx="6" cy="17" r="1.3"/><circle cx="17" cy="17" r="1.3"/><path d="M3 9l9-3M7 6v3"/>',
}

export default function VehicleIcon({ type, size = 16, className = '' }) {
  const paths = VEHICLE_PATHS[type] || VEHICLE_PATHS.car
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      className={className} dangerouslySetInnerHTML={{ __html: paths }} />
  )
}

// Raw SVG markup for Leaflet divIcon HTML.
export function vehicleSvgString(type, color) {
  const paths = VEHICLE_PATHS[type] || VEHICLE_PATHS.car
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}
