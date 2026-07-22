import React from 'react'
import { AmbulanceBlueprint, FireTruckBlueprint } from './VehicleBlueprint'

// Shared branded loading screen — used both by the admin Console (App.jsx,
// while the fleet/ops data loads) and the requester Portal (in place of its
// old skeleton-pulse placeholder), so both sides of the app get the same
// arrival experience through SSO. Extracted to its own file rather than
// living in App.jsx so UserPortal.jsx can import it without a circular
// App.jsx <-> UserPortal.jsx dependency.
//
// Full-page CAD/blueprint-style technical line art of the fleet (ambulance
// top+side, fire truck side+front) on a paper-white ground, with a single
// spinner in the bottom-right corner — intentionally minimal rather than
// the previous dark branded panel, so the drawing itself is the screen.
export default function BootScreen({ message = 'Connecting to live operations…' }) {
  return (
    <div className="h-full w-full relative overflow-hidden" style={{ background: '#FBFBF9' }}>
      {/* Faint graph-paper grid, the one nod to "blueprint" beyond the linework itself. */}
      <div className="pointer-events-none absolute inset-0" style={{
        backgroundImage: 'linear-gradient(rgba(31,41,55,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(31,41,55,0.05) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }} />

      <div className="h-full w-full flex flex-col px-8 py-6 gap-3">
        <div className="boot-in flex-1 min-h-0 flex items-center justify-center">
          <AmbulanceBlueprint className="h-full w-auto max-w-full" />
        </div>
        <div className="boot-in flex-1 min-h-0 flex items-center justify-center">
          <FireTruckBlueprint className="h-full w-auto max-w-full" />
        </div>
      </div>

      <div className="absolute right-6 bottom-6 flex items-center gap-3">
        <span className="text-[12px] boot-pulse" style={{ color: '#1f2937', opacity: 0.65 }}>{message}</span>
        <svg width="30" height="30" viewBox="0 0 30 30" className="blueprint-spin" aria-hidden="true">
          <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(31,41,55,0.15)" strokeWidth="2.4" />
          <circle cx="15" cy="15" r="12" fill="none" stroke="#0B6A64" strokeWidth="2.4" strokeLinecap="round"
            strokeDasharray="18 75.4" transform="rotate(-90 15 15)" />
        </svg>
      </div>
    </div>
  )
}
