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

const ACCESS_KEY = 'sso_token'
const ID_KEY = 'sso_id_token'
const DEV_KEY = 'psiog_dev_session'

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
export function captureTokenFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const at = params.get(ACCESS_KEY)
  const it = params.get(ID_KEY)
  if (at) sessionStorage.setItem(ACCESS_KEY, at)
  if (it) sessionStorage.setItem(ID_KEY, it)
  if (at || it) {
    params.delete(ACCESS_KEY); params.delete(ID_KEY)
    const qs = params.toString()
    history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }
}

export function getToken() {
  const t = sessionStorage.getItem(ACCESS_KEY)
  return t && valid(decode(t)) ? t : null
}

export function getSession() {
  // 1) real SSO tokens from the platform
  const at = sessionStorage.getItem(ACCESS_KEY)
  const access = at && decode(at)
  if (valid(access)) {
    const idc = decode(sessionStorage.getItem(ID_KEY) || '') || {}
    const groups = access['cognito:groups'] || idc['cognito:groups'] || []
    return {
      sub: access.sub,
      name: idc.name || idc.email || access.username || 'User',
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
  return s
}

// Send the user to the platform to authenticate (the main app owns the login).
export function login() {
  if (MAIN_APP_URL) window.location.href = MAIN_APP_URL
}

export function logout() {
  clearLocalSession()
  if (MAIN_APP_URL) window.location.href = MAIN_APP_URL
}

// Clears the session without leaving the app — used for idle timeout, where
// bouncing an unattended screen to another site would be more surprising
// than just landing back on this app's own sign-in screen.
export function clearLocalSession() {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(ID_KEY)
  sessionStorage.removeItem(DEV_KEY)
}

export function isAuthed() { return !!getSession() }

// True once the SSO access token's own `exp` has passed. Dev sessions have
// no expiry claim and always return false — idle timeout still applies to
// them, just not token-expiry.
export function isTokenExpired() {
  const at = sessionStorage.getItem(ACCESS_KEY)
  if (!at) return false
  const claims = decode(at)
  return !!claims?.exp && claims.exp * 1000 <= Date.now()
}
