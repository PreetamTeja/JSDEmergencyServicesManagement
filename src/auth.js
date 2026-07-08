// Auth + role layer for the Emergency app.
//
// SSO model (matches the Jamshedpur platform repo):
//   - One shared Cognito user pool. The MAIN app signs the user in
//     (amazon-cognito-identity-js, tokens in its own localStorage).
//   - Clicking a service tile opens THIS app with the Cognito tokens on the URL:
//        https://<our-app>/?sso_token=<access_token>&sso_id_token=<id_token>
//   - We capture them, verify expiry, read `cognito:groups` for the role, and
//     route admins to the Console and everyone else to the self-service Portal.
//   - No token (or expired) -> bounce to the main app to (re)authenticate.
//
// Note: client-side decode is for ROUTING only. The backend must verify the JWT
// signature against the pool JWKS before trusting it for authorization.

const MAIN_APP_URL = import.meta.env.VITE_MAIN_APP_URL || ''
// Optional allow-list of admin groups. If empty, any group ending in "-admin" is admin.
const ADMIN_GROUPS = (import.meta.env.VITE_ADMIN_GROUPS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

const DEV_KEY = 'psiog_dev_session'
const SESSION_START_KEY = 'psiog_session_started_at'

// The real Cognito access/id tokens live in memory ONLY — never in
// localStorage/sessionStorage. The SSO portal team flagged (2026-07) that the
// previous sessionStorage.setItem(sso_token, ...) put the raw token somewhere
// any injected/XSS script, or any browser extension with storage access,
// could read straight off disk for the life of the tab. A module-scope
// variable has no such API surface — it disappears on reload/tab close, and
// there's nothing to `sessionStorage.getItem()` for.
// Trade-off: a hard page refresh loses it, but the portal keeps its own
// session (its own tokens, its own origin), so refreshing here just bounces
// through the portal and straight back with a fresh token — no login form,
// same "already signed in" experience as before, just nothing at rest.
let inMemoryAccessToken = null
let inMemoryIdToken = null

// Absolute session duration is measured from when the session was first
// established, independent of activity — record it once and never touch it
// again until the session is cleared, so idle-resets (mouse moves, etc.)
// can't be used to extend it indefinitely.
function markSessionStart() {
  if (!sessionStorage.getItem(SESSION_START_KEY)) sessionStorage.setItem(SESSION_START_KEY, String(Date.now()))
}
export function sessionAgeMs() {
  const t = sessionStorage.getItem(SESSION_START_KEY)
  return t ? Date.now() - Number(t) : 0
}

function decode(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch { return null }
}
const valid = (claims) => !!claims && (!claims.exp || claims.exp * 1000 > Date.now())

// Map Cognito groups -> app role. Admin if the group is allow-listed, or (when no
// allow-list is configured) if any group ends with "-admin".
function roleFromGroups(groups = []) {
  const list = Array.isArray(groups) ? groups : [groups]
  const isAdmin = ADMIN_GROUPS.length
    ? list.some((g) => ADMIN_GROUPS.includes(g))
    : list.some((g) => /-admin$/i.test(String(g)))
  return isAdmin ? 'admin' : 'user'
}

// Capture tokens arriving on the URL (?sso_token=&sso_id_token=). Call once at startup.
// Strips them from the URL immediately either way — a token must not linger
// in the address bar (browser history, referrer headers, screen-share) even
// for the one render before this runs.
export function captureTokenFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const at = params.get('sso_token')
  const it = params.get('sso_id_token')
  if (at) inMemoryAccessToken = at
  if (it) inMemoryIdToken = it
  if (at || it) {
    markSessionStart()
    params.delete('sso_token'); params.delete('sso_id_token')
    const qs = params.toString()
    history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }
}

export function getToken() {
  return inMemoryAccessToken && valid(decode(inMemoryAccessToken)) ? inMemoryAccessToken : null
}

export function getSession() {
  // 1) real SSO tokens from the platform
  const access = inMemoryAccessToken && decode(inMemoryAccessToken)
  if (valid(access)) {
    const idc = decode(inMemoryIdToken || '') || {}
    const groups = access['cognito:groups'] || idc['cognito:groups'] || []
    // Broad, ordered fallback across every claim Cognito might actually carry
    // for this app client — a pool without the profile/email scopes granted
    // can leave name/email empty, which previously fell straight through to
    // the literal placeholder string "User" instead of any real identifier.
    const givenFamily = [idc.given_name, idc.family_name].filter(Boolean).join(' ')
    const displayName = idc.name || givenFamily || idc.email || idc.preferred_username
      || access.username || access['cognito:username'] || idc['cognito:username'] || 'User'
    return {
      sub: access.sub,
      name: displayName,
      email: idc.email || null,
      role: roleFromGroups(groups),
      groups: Array.isArray(groups) ? groups : [groups].filter(Boolean),
      via: 'sso',
    }
  }
  // 2) local dev login (only used when there's no SSO token, e.g. running standalone)
  try {
    const d = JSON.parse(sessionStorage.getItem(DEV_KEY) || 'null')
    if (d) return { ...d, groups: d.groups || [], via: 'dev' }
  } catch {}
  return null
}

// Dev login stand-in for running this app outside the platform.
export function devLogin(role, name) {
  const s = { sub: `dev-${role}`, name: name || (role === 'admin' ? 'Control Room' : 'Requester'),
    email: `${role}@demo`, role, groups: [role === 'admin' ? 'emergency-admin' : 'emergency-user'] }
  sessionStorage.setItem(DEV_KEY, JSON.stringify(s))
  markSessionStart()
  return s
}

// Send the user to the platform to authenticate (the main app owns the login).
// Returns whether a real redirect was actually triggered — callers that need
// to show a "redirecting…" transition only while a real navigation is
// pending (not in local dev, where MAIN_APP_URL is typically unset) check this.
export function login() {
  if (MAIN_APP_URL) { window.location.href = MAIN_APP_URL; return true }
  return false
}

export function logout() {
  clearLocalSession()
  if (MAIN_APP_URL) window.location.href = MAIN_APP_URL
}

// Clears the session without leaving the app — used for idle timeout, where
// bouncing an unattended screen to another site would be more surprising
// than just landing back on this app's own sign-in screen.
export function clearLocalSession() {
  inMemoryAccessToken = null
  inMemoryIdToken = null
  sessionStorage.removeItem(DEV_KEY)
  sessionStorage.removeItem(SESSION_START_KEY)
}

export function isAuthed() { return !!getSession() }

// True once the SSO access token's own `exp` has passed. Dev sessions have
// no expiry claim and always return false — idle timeout still applies to
// them, just not token-expiry.
export function isTokenExpired() {
  const at = inMemoryAccessToken
  if (!at) return false
  const claims = decode(at)
  return !!claims?.exp && claims.exp * 1000 <= Date.now()
}
