import React from 'react'
import ExplodeLogo from './ExplodeLogo'
import { AmbulanceIcon, FireTruckIcon, HoseReel } from './VehicleReveal'

// Shared branded loading screen — used both by the admin Console (App.jsx,
// while the fleet/ops data loads) and the requester Portal (in place of its
// old skeleton-pulse placeholder), so both sides of the app get the same
// arrival experience through SSO. Extracted to its own file rather than
// living in App.jsx so UserPortal.jsx can import it without a circular
// App.jsx <-> UserPortal.jsx dependency.
export default function BootScreen({ message = 'Connecting to live operations…' }) {
  const bg = 'linear-gradient(160deg,#05201E 0%,#083F3B 55%,#0B5A55 100%)'
  return (
    <div className="h-full w-full grid place-items-center text-white on-dark" style={{ background: bg }}>
      <div className="boot-in flex flex-col items-center text-center px-6">
        <div className="mb-2"><ExplodeLogo size={48} /></div>
        <div className="text-[22px] font-bold tracking-tight">JSD Emergency Services</div>
        <div className="text-[13px] mb-6" style={{ color: 'rgba(214,223,39,0.8)' }}>Tata Steel · Jamshedpur</div>

        {/* Ambulance + fire truck assemble segment-by-segment, either side of
            the hose-reel loading indicator — the fleet this app dispatches,
            arriving before the console/portal itself does. */}
        <div className="flex items-end justify-center gap-5">
          <AmbulanceIcon width={118} className="shrink-0" />
          <HoseReel size={64} />
          <FireTruckIcon width={130} className="shrink-0" />
        </div>

        <div className="mt-7 text-[13px] boot-pulse" style={{ color: 'rgba(255,255,255,0.78)' }}>{message}</div>
        <div className="mt-3 h-1 w-44 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.14)' }}>
          <div className="boot-bar h-full w-2/5 rounded-full" style={{ background: '#D6DF27' }} />
        </div>
      </div>
    </div>
  )
}
