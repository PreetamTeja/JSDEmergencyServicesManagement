import React, { useEffect, useState, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { useFleetStore } from './store/useFleetStore'
import { getSession, devLogin, login, logout, captureTokenFromUrl } from './auth'
import LiveMapPage from './features/map/LiveMapPage'
import FleetPage from './features/fleet/FleetPage'
import DashboardPage from './features/dashboard/DashboardPage'
import EmergencyPage from './features/emergency/EmergencyPage'
import DispatchBoard from './features/requests/RequestsPage'
import UserPortal from './portal/UserPortal'
import PolicyControls from './components/common/PolicyControls'
import TrackPage from './features/track/TrackPage'

// Public shareable tracking links bypass auth + the authed data load entirely.
const IS_TRACK = typeof window !== 'undefined' && window.location.pathname.startsWith('/track/')

// Minimal line-icon paths (24x24, stroke=currentColor)
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  map: '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  fleet: '<path d="M3 7h11v8H3z"/><path d="M14 9h3.5l3.5 3.5V15h-7z"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
  emergency: '<path d="M3 8h10v7H3z"/><path d="M13 10h4l3 3v2h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/><path d="M6 11h3M7.5 9.5v3"/>',
  requests: '<path d="M9 5h10M9 12h10M9 19h10"/><path d="M4.5 5h.01M4.5 12h.01M4.5 19h.01"/>',
}

const SECTIONS = [
  { title: 'Operations', items: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/emergency', label: 'Emergencies', icon: 'emergency' },
    { to: '/requests', label: 'Dispatch Board', icon: 'requests' },
    { to: '/map', label: 'Live Map', icon: 'map' },
  ] },
  { title: 'Resources', items: [
    { to: '/fleet', label: 'Fleet & Crews', icon: 'fleet' },
  ] },
]

function Glyph({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  )
}

export default function App() {
  const init = useFleetStore((s) => s.init)
  const tick = useFleetStore((s) => s.tick)
  const ready = useFleetStore((s) => s.ready)
  const error = useFleetStore((s) => s.error)
  const [session, setSession] = useState(() => { captureTokenFromUrl(); return getSession() })

  useEffect(() => { if (!IS_TRACK) init() }, [init])
  useEffect(() => {
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])
  // Poll the backend so bookings + history reflect in near real-time (own dispatch board).
  useEffect(() => {
    if (!ready) return
    const id = setInterval(() => {
      const s = useFleetStore.getState()
      s.refreshFromApi().then(() => s.hydrateLive()).catch(() => {})
      s.loadPolicy()
    }, 5000)
    return () => clearInterval(id)
  }, [ready])

  // Public live-tracking link — no login, no backend bootstrap.
  if (IS_TRACK) return <Routes><Route path="/track/:id" element={<TrackPage />} /></Routes>

  // No session yet → SSO placeholder (replaced by the real redirect later).
  if (!session) return <Landing onPick={(role) => { devLogin(role); setSession(getSession()) }} />

  // Data is loaded exclusively from the backend (DynamoDB). No mock fallback.
  if (error) return (
    <div className="h-screen grid place-items-center bg-cmd-bg p-6 text-center">
      <div className="panel p-6 max-w-md">
        <div className="text-[20px] font-semibold mb-1">Cannot reach backend</div>
        <p className="text-[14px] text-cmd-muted">{error}</p>
      </div>
    </div>
  )
  if (!ready) return (
    <div className="h-screen grid place-items-center bg-cmd-bg">
      <div className="flex items-center gap-3 text-cmd-muted">
        <span className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading from DynamoDB...
      </div>
    </div>
  )

  const signOut = () => { logout(); setSession(getSession()) }
  if (session.role === 'user') return <UserPortal session={session} onSignOut={signOut} />
  return <Console session={session} onSignOut={signOut} />
}

// Reached only when there's no SSO token. Normally users arrive from the
// Jamshedpur platform (Transport → Ambulance) carrying a token. The SSO button
// bounces to the platform to authenticate; dev buttons are for local standalone runs.
function Landing({ onPick }) {
  const hasMainApp = !!import.meta.env.VITE_MAIN_APP_URL
  return (
    <div className="h-screen grid place-items-center bg-cmd-bg p-6">
      <div className="panel p-8 max-w-sm w-full text-center">
        <div className="h-12 w-12 rounded-xl bg-cta grid place-items-center text-accent font-bold text-[18px] mx-auto mb-3">TS</div>
        <div className="text-[20px] font-semibold">Emergency Services</div>
        <div className="text-[13px] text-cmd-muted mb-1">Tata Steel · Jamshedpur</div>
        <div className="text-[12px] text-cmd-muted mb-5">Access this service from the Jamshedpur platform (Transport → Ambulance).</div>
        <div className="space-y-2">
          {hasMainApp && <button className="btn-primary w-full" onClick={login}>Sign in via Jamshedpur SSO</button>}
          <div className="text-[11px] uppercase tracking-wide text-cmd-muted pt-2">Local dev preview</div>
          <button className="btn-secondary w-full" onClick={() => onPick('admin')}>Continue as Control Room (admin)</button>
          <button className="btn-secondary w-full" onClick={() => onPick('user')}>Continue as Requester (user)</button>
        </div>
      </div>
    </div>
  )
}

function Console({ session, onSignOut }) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('psiog_nav_collapsed') === '1')
  const toggle = () => setCollapsed((c) => { localStorage.setItem('psiog_nav_collapsed', c ? '0' : '1'); return !c })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-3'} h-10 rounded-lg transition-colors relative ${
      isActive ? 'bg-white/15 text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/10'}`

  const initials = (session?.name || 'EC').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden bg-cmd-bg text-cmd-text">
      <aside className={`shrink-0 flex flex-col bg-accent text-white transition-all duration-200 ${collapsed ? 'w-16' : 'w-60'}`}>
        <div className={`h-16 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-3'} shrink-0 border-b border-white/10`}>
          {!collapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-cta grid place-items-center text-accent font-bold text-[15px] shrink-0">TS</div>
              <div className="leading-tight truncate">
                <div className="font-semibold text-[15px] truncate">Emergency Ops</div>
                <div className="text-[11px] text-white/70 truncate">Tata Steel · Jamshedpur</div>
              </div>
            </div>
          )}
          <button onClick={toggle} title={collapsed ? 'Expand' : 'Collapse'} aria-label="Toggle navigation"
            className="h-9 w-9 grid place-items-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        <div className="p-3">
          <button onClick={() => navigate('/emergency?new=1')} title="New Emergency"
            className={`btn-cta w-full flex items-center justify-center gap-1.5 ${collapsed ? 'px-0' : ''}`}>
            <span className="text-[16px] leading-none">+</span>{!collapsed && 'New Emergency'}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 space-y-4 no-scrollbar">
          {SECTIONS.map((sec) => (
            <div key={sec.title}>
              {!collapsed && <div className="px-2 mb-1 text-[11px] uppercase tracking-wide text-white/45 font-semibold">{sec.title}</div>}
              {collapsed && <div className="mx-2 my-2 border-t border-white/10" />}
              <div className="space-y-0.5">
                {sec.items.map((n) => (
                  <NavLink key={n.to} to={n.to} className={linkClass} title={n.label}>
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-cta" />}
                        <Glyph name={n.icon} size={18} />
                        {!collapsed && <span className="text-[14px]">{n.label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div ref={menuRef} className="mt-auto border-t border-white/10 p-3 relative">
          {/* expandable profile menu: active policy + sign out */}
          {menuOpen && (
            <div className="absolute bottom-full mb-2 left-2 w-72 bg-white text-cmd-text rounded-xl shadow-card p-3 z-50">
              <div className="pb-2 mb-2 border-b border-cmd-border">
                <div className="text-[13px] font-semibold truncate">{session?.name || 'Dispatcher'}</div>
                <div className="text-[11px] text-cmd-muted">Control Room · admin</div>
              </div>
              <PolicyControls />
              <button onClick={onSignOut} className="mt-3 w-full h-9 rounded-lg border border-cmd-border text-[13px] font-medium hover:bg-cmd-panel2 flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Sign out
              </button>
            </div>
          )}
          <button onClick={() => setMenuOpen((o) => !o)} title="Profile"
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2'} rounded-lg p-1 hover:bg-white/10`}>
            <div className="h-9 w-9 rounded-full bg-white/15 grid place-items-center text-[12px] font-semibold shrink-0">{initials}</div>
            {!collapsed && (
              <>
                <div className="text-[13px] leading-tight flex-1 truncate text-left"><div className="font-medium truncate">{session?.name || 'Dispatcher'}</div><div className="text-[11px] text-white/60">Control Room · admin</div></div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-white/70 transition-transform ${menuOpen ? 'rotate-180' : ''}`}><path d="M6 15l6-6 6 6" /></svg>
              </>
            )}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/emergency" element={<EmergencyPage />} />
          <Route path="/requests" element={<DispatchBoard />} />
          <Route path="/map" element={<LiveMapPage />} />
          <Route path="/fleet" element={<FleetPage />} />
        </Routes>
      </main>
    </div>
  )
}
