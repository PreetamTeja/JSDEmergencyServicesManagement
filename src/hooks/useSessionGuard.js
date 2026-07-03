import { useEffect, useRef } from 'react'
import { isTokenExpired } from '../auth'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
const IDLE_TIMEOUT_MS = 25 * 60 * 1000  // auto sign-out after 25 min of no activity
const CHECK_INTERVAL_MS = 30 * 1000
// If the token dies while the user is still actively clicking around, give a
// short grace window rather than yanking them out mid-interaction — there's
// no silent-refresh path in this app's SSO model, so this is the best we can
// offer without a jarring cross-app redirect.
const EXPIRED_GRACE_MS = 60 * 1000

// Auto-clears the session (locally, no redirect) after idle timeout, or
// shortly after the SSO token expires if the user has stopped interacting.
// An active user is left alone even past token expiry until either the idle
// grace window elapses or a real API call surfaces the 401 itself.
export function useSessionGuard(onExpire) {
  const lastActiveRef = useRef(Date.now())

  useEffect(() => {
    const markActive = () => { lastActiveRef.current = Date.now() }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }))
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive))
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActiveRef.current
      const idleTimedOut = idleMs >= IDLE_TIMEOUT_MS
      const expiredWithGraceElapsed = isTokenExpired() && idleMs >= EXPIRED_GRACE_MS
      if (idleTimedOut || expiredWithGraceElapsed) onExpire()
    }, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [onExpire])
}
