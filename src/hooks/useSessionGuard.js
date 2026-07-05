import { useEffect, useRef } from 'react'
import { isTokenExpired, sessionAgeMs } from '../auth'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
// Standardized across all services: 5 min idle, 20 min absolute session cap.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const ABSOLUTE_SESSION_MS = 20 * 60 * 1000
// Warn shortly before whichever deadline (idle or absolute) is closer, so
// the tighter 5-minute idle window still gets a meaningful heads-up.
const WARN_BEFORE_MS = 30 * 1000
const CHECK_INTERVAL_MS = 5 * 1000
// If the token dies while the user is still actively clicking around, give a
// short grace window rather than yanking them out mid-interaction — there's
// no silent-refresh path in this app's SSO model, so this is the best we can
// offer without a jarring cross-app redirect.
const EXPIRED_GRACE_MS = 30 * 1000

// Expires the session after 5 min of no activity OR 20 min total (whichever
// comes first — the absolute cap can't be extended by activity, by design),
// or shortly after the SSO token expires if the user has stopped interacting.
export function useSessionGuard(onExpire, onIdleWarning) {
  const lastActiveRef = useRef(Date.now())
  const warnedRef = useRef(false)

  useEffect(() => {
    const markActive = () => { lastActiveRef.current = Date.now() }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }))
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive))
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActiveRef.current
      const idleRemaining = IDLE_TIMEOUT_MS - idleMs
      const absRemaining = ABSOLUTE_SESSION_MS - sessionAgeMs()
      const expiredWithGraceElapsed = isTokenExpired() && idleMs >= EXPIRED_GRACE_MS
      if (idleRemaining <= 0 || absRemaining <= 0 || expiredWithGraceElapsed) { onExpire(); return }
      const soonestRemaining = Math.min(idleRemaining, absRemaining)
      if (soonestRemaining <= WARN_BEFORE_MS && !warnedRef.current) {
        warnedRef.current = true
        onIdleWarning?.(Math.max(0, soonestRemaining))
      }
    }, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [onExpire, onIdleWarning])

  // Exposed so a "stay signed in" action in the UI counts as activity without
  // needing to synthesize a fake DOM event. Only resets the idle clock — the
  // absolute session cap is deliberately not extendable this way.
  return { extendSession: () => { lastActiveRef.current = Date.now(); warnedRef.current = false } }
}
