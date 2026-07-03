import React from 'react'

// Single shared line-icon set (24x24 viewBox, stroke = currentColor).
// Rendered as real JSX — no dangerouslySetInnerHTML.
const PATHS = {
  // Navigation
  dashboard: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  map: <><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>,
  fleet: <><path d="M3 7h11v8H3z" /><path d="M14 9h3.5l3.5 3.5V15h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></>,
  emergency: <><path d="M3 8h10v7H3z" /><path d="M13 10h4l3 3v2h-7z" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="17" cy="17.5" r="1.6" /><path d="M6 11h3M7.5 9.5v3" /></>,
  requests: <><path d="M9 5h10M9 12h10M9 19h10" /><path d="M4.5 5h.01M4.5 12h.01M4.5 19h.01" /></>,
  powerbi: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  infra: <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
  insights: <><path d="M4 20V10M10 20V13M16 20V7M22 20V4" /><path d="M2 20h20" /></>,
  // KPIs / metrics
  activity: <path d="M3 12h4l2 6 4-14 2 8h6" />,
  pulse: <path d="M3 12h4l2-5 3 10 2-7h7" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" /></>,
  truck: <><path d="M3 7h11v8H3z" /><path d="M14 9h3.5l3.5 3.5V15h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  // Emergency kinds
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />,
  medical: <path d="M12 5v14M5 12h14" />,
  droplet: <path d="M12 3c3 4 6 7 6 10a6 6 0 1 1-12 0c0-3 3-6 6-10Z" />,
  // Actions / misc
  trash: <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />,
  alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17v.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />,
  traffic: <><rect x="8" y="2" width="8" height="20" rx="3" /><circle cx="12" cy="7" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="17" r="1.4" /></>,
  signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
}

export default function Icon({ name, size = 16, strokeWidth = 1.7, className = '', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true">
      {PATHS[name] || null}
    </svg>
  )
}
