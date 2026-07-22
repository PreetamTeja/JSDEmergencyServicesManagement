import { useSsoSession } from '../hooks/useSsoSession'

const SSO_PORTAL_URL = import.meta.env.VITE_MAIN_APP_URL || ''

// Wraps the app; redirects to the SSO portal if the Worker session cookie
// is missing or invalid. Replaces the old query-param token capture in
// src/auth.js for routes served behind the Worker.
export function SsoGuard({ children }) {
  const { session, loading } = useSsoSession()

  if (loading) return null

  if (!session) {
    if (SSO_PORTAL_URL) window.location.href = SSO_PORTAL_URL
    return null
  }

  return children
}
