import React, { useEffect, useState, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { useFleetStore } from './store/useFleetStore'
import { getSession, devLogin, login, logout, captureTokenFromUrl } from './auth'
import LiveMapPage from './features/map/LiveMapPage'
import FleetPage from './features/fleet/FleetPage'
import DashboardPage from './features/dashboard/DashboardPage'
import PowerBIPage from './features/dashboard/PowerBIPage'
import EmergencyPage from './features/emergency/EmergencyPage'
import DispatchBoard from './features/requests/RequestsPage'
import UserPortal from './portal/UserPortal'
import PolicyControls from './components/common/PolicyControls'
import TrackPage from './features/track/TrackPage'
import InfraHealthPage from './features/admin/InfraHealthPage'
import Icon from './components/common/Icon'

// Public shareable tracking links bypass auth + the authed data load entirely.
const IS_TRACK = typeof window !== 'undefined' && window.location.pathname.startsWith('/track/')

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
  { title: 'Analytics', items: [
    { to: '/powerbi', label: 'Power BI', icon: 'powerbi' },
  ] },
  { title: 'Admin', items: [
    { to: '/admin/infra', label: 'Infra Health', icon: 'infra' },
  ] },
]

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
  const retry = () => {
    useFleetStore.setState({ initialized: false, error: null })
    useFleetStore.getState().init()
  }
  if (error) return (
    <div className="h-screen grid place-items-center p-6 text-center"
      style={{ background: 'linear-gradient(160deg,#04332F 0%,#07514D 60%,#0B6A64 100%)' }}>
      <div className="bg-white rounded-2xl p-7 max-w-md w-full boot-in" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        <div className="h-11 w-11 rounded-xl grid place-items-center mx-auto mb-3"
          style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
          <Icon name="alert" size={22} strokeWidth={1.9} />
        </div>
        <div className="text-[19px] font-semibold mb-1">Can't reach the service</div>
        <p className="text-[13px] text-cmd-muted mb-5">{error}</p>
        <button className="btn-primary w-full h-10" onClick={retry}>Retry connection</button>
      </div>
    </div>
  )
  if (!ready) return <BootScreen />

  const signOut = () => { logout(); setSession(getSession()) }
  if (session.role === 'user') return <UserPortal session={session} onSignOut={signOut} />
  return <Console session={session} onSignOut={signOut} />
}

// Branded boot screen shown while live data loads — dispatch radar sweep.
export function BootScreen({ message = 'Connecting to live operations…' }) {
  const bg = 'linear-gradient(160deg,#05201E 0%,#083F3B 55%,#0B5A55 100%)'
  return (
    <div className="h-screen w-full grid place-items-center text-white on-dark" style={{ background: bg }}>
      <div className="boot-in flex flex-col items-center text-center px-6">
        <div className="h-14 w-14 rounded-2xl grid place-items-center font-bold text-[20px] boot-beacon mb-4"
          style={{ background: '#D6DF27', color: '#07514D' }}>TS</div>
        <div className="text-[22px] font-bold tracking-tight">JSD Emergency Services</div>
        <div className="text-[13px] mb-8" style={{ color: 'rgba(214,223,39,0.8)' }}>Tata Steel · Jamshedpur</div>

        <BootRadar />

        <div className="mt-8 text-[13px] boot-pulse" style={{ color: 'rgba(255,255,255,0.78)' }}>{message}</div>
        <div className="mt-3 h-1 w-44 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.14)' }}>
          <div className="boot-bar h-full w-2/5 rounded-full" style={{ background: '#D6DF27' }} />
        </div>
      </div>
    </div>
  )
}

function BootRadar() {
  return (
    <div className="relative h-24 w-24 rounded-full shrink-0" style={{ border: '1px solid rgba(255,255,255,0.3)' }}>
      <div className="absolute inset-3 rounded-full" style={{ border: '1px solid rgba(255,255,255,0.18)' }} />
      <div className="absolute inset-6 rounded-full" style={{ border: '1px solid rgba(255,255,255,0.12)' }} />
      <div className="absolute inset-0 rounded-full radar-sweep"
        style={{ background: 'conic-gradient(from 0deg, rgba(214,223,39,0.55), transparent 75deg)' }} />
      <span className="absolute h-1.5 w-1.5 rounded-full" style={{ top: '30%', left: '62%', background: '#D6DF27' }} />
      <span className="absolute h-1.5 w-1.5 rounded-full" style={{ top: '64%', left: '34%', background: '#D6DF27', opacity: 0.7 }} />
      <span className="absolute h-1 w-1 rounded-full" style={{ top: '48%', left: '48%', background: '#fff', opacity: 0.8 }} />
    </div>
  )
}

// Reached only when there's no SSO token. Normally users arrive from the
// Jamshedpur platform (Transport → Ambulance) carrying a token. The SSO button
// bounces to the platform to authenticate; dev buttons are for local standalone runs.
function Landing({ onPick }) {
  // Production: this app has NO login of its own. Authentication is owned entirely
  // by the Jamshedpur SSO portal (Cognito). Arriving without a valid sso_token means
  // the user didn't come through the portal -> send them there. The dev role buttons
  // are compiled in ONLY for local `vite dev` runs, never in a production build.
  const isDev = import.meta.env.DEV
  return (
    <div className="h-screen grid place-items-center bg-cmd-bg p-6">
      <div className="panel p-8 max-w-sm w-full text-center">
        <div className="h-12 w-12 rounded-xl bg-cta grid place-items-center text-accent font-bold text-[18px] mx-auto mb-3">TS</div>
        <div className="text-[20px] font-semibold">Emergency Services</div>
        <div className="text-[13px] text-cmd-muted mb-1">Tata Steel · Jamshedpur</div>
        <div className="text-[12px] text-cmd-muted mb-5">Access this service from the Jamshedpur SSO portal (Transport → Ambulance).</div>
        <button className="btn-primary w-full" onClick={login}>Go to SSO Portal</button>
        {isDev && (
          <div className="space-y-2 mt-5 pt-4 border-t border-cmd-border">
            <div className="text-[11px] uppercase tracking-wide text-cmd-muted">Local dev preview</div>
            <button className="btn-secondary w-full" onClick={() => onPick('admin')}>Continue as Control Room (admin)</button>
            <button className="btn-secondary w-full" onClick={() => onPick('user')}>Continue as Requester (user)</button>
          </div>
        )}
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
    `flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-3'} h-10 rounded-xl transition-all duration-150 relative select-none ${
      isActive
        ? 'font-semibold text-[#E9F06B]'
        : 'text-white/65 hover:text-white hover:bg-white/10 font-medium'
    }`

  const initials = (session?.name || 'EC').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F4EF] text-cmd-text">
      {/* ── Glassmorphism Sidebar ─────────────────────────────────── */}
      <aside
        className={`relative z-[1000] shrink-0 flex flex-col text-white transition-all duration-200 ${collapsed ? 'w-[68px]' : 'w-[240px]'}`}
        style={{
          background: 'rgba(7,81,77,0.93)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.22), inset -1px 0 0 rgba(255,255,255,0.07)',
        }}
      >
        {/* ── Logo / header ── */}
        <div className={`h-16 flex items-center shrink-0 ${collapsed ? 'justify-center' : 'justify-between px-4'}`}
          style={{ borderBottom: '1px solid rgba(255,255,255,0.09)' }}>
          {!collapsed && (
            <div className="leading-tight min-w-0">
              <div className="font-bold text-[15px] text-white tracking-tight truncate">JSD Emergency</div>
              <div className="text-[11px] truncate" style={{ color: 'rgba(214,223,39,0.75)' }}>Tata Steel · Jamshedpur</div>
            </div>
          )}
          <button onClick={toggle} title={collapsed ? 'Expand' : 'Collapse'} aria-label="Toggle navigation"
            className="h-8 w-8 grid place-items-center rounded-lg transition-colors shrink-0 text-white/55 hover:text-white hover:bg-white/10">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* ── CTA button ── */}
        <div className={`px-3 pt-3 pb-2`}>
          <button
            onClick={() => navigate('/emergency?new=1')}
            title="New Emergency" aria-label="New Emergency"
            className={`w-full flex items-center justify-center gap-1.5 h-9 rounded-xl font-semibold text-[13px] transition-all duration-150 hover:brightness-105 ${collapsed ? 'px-0' : 'px-3'}`}
            style={{
              background: '#D6DF27',
              color: '#07514D',
              boxShadow: '0 2px 10px rgba(214,223,39,0.3)',
            }}
          >
            <Icon name="plus" size={14} strokeWidth={2.5} />
            {!collapsed && 'New Emergency'}
          </button>
        </div>

        {/* ── Nav links ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 space-y-4 no-scrollbar mt-1">
          {SECTIONS.map((sec) => (
            <div key={sec.title}>
              {!collapsed && (
                <div className="px-2 mb-1.5 text-[10px] uppercase tracking-widest font-semibold"
                  style={{ color: 'rgba(255,255,255,0.55)' }}>{sec.title}</div>
              )}
              {collapsed && <div className="mx-3 my-2" style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }} />}
              <div className="space-y-0.5">
                {sec.items.map((n) => (
                  <NavLink key={n.to} to={n.to} className={linkClass} title={n.label}>
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <>
                            <span
                              className="absolute inset-0 rounded-xl -z-10"
                              style={{ background: 'rgba(214,223,39,0.16)' }}
                            />
                            <span
                              className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                              style={{ background: '#D6DF27' }}
                            />
                          </>
                        )}
                        <Icon name={n.icon} size={17} strokeWidth={1.6} />
                        {!collapsed && <span className="text-[13.5px]">{n.label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* ── User / profile footer ── */}
        <div ref={menuRef} className="mt-auto p-3 relative" style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }}>
          {menuOpen && (
            <div className="absolute bottom-full mb-2 left-2 w-72 bg-white text-cmd-text rounded-2xl p-3 z-[1100]"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.1)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div className="pb-2 mb-2" style={{ borderBottom: '1px solid #E5E7EB' }}>
                <div className="text-[13px] font-semibold truncate">{session?.name || 'Dispatcher'}</div>
                <div className="text-[11px] text-cmd-muted">Control Room · admin</div>
              </div>
              <PolicyControls />
              <button onClick={onSignOut}
                className="mt-3 w-full h-9 rounded-xl text-[13px] font-medium flex items-center justify-center gap-2 transition-colors hover:bg-[#EEEFF3]"
                style={{ border: '1px solid #E5E7EB', color: '#475467' }}>
                <Icon name="signout" size={15} strokeWidth={1.8} />
                Sign out
              </button>
            </div>
          )}
          <button onClick={() => setMenuOpen((o) => !o)} title="Profile" aria-label="Profile menu"
            aria-expanded={menuOpen}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} rounded-xl p-1.5 transition-colors hover:bg-white/10`}>
            <div className="h-8 w-8 rounded-full grid place-items-center text-[12px] font-bold shrink-0"
              style={{ background: '#D6DF27', color: '#07514D' }}>{initials}</div>
            {!collapsed && (
              <>
                <div className="text-[12.5px] leading-tight flex-1 truncate text-left">
                  <div className="font-medium text-white truncate">{session?.name || 'Dispatcher'}</div>
                  <div className="text-[10.5px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Control Room · admin</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  className={`transition-transform shrink-0`} style={{ color: 'rgba(255,255,255,0.45)' }}>
                  <path d={menuOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
                </svg>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/emergency" element={<EmergencyPage />} />
          <Route path="/requests" element={<DispatchBoard />} />
          <Route path="/map" element={<LiveMapPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/powerbi" element={<PowerBIPage />} />
          <Route path="/admin/infra" element={<InfraHealthPage />} />
        </Routes>
      </main>
    </div>
  )
}
