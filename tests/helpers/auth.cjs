// Shared helper for test suites: builds an unsigned "routing-only" JWT the
// same way the app's own dev-verification recipe does. This is valid ONLY
// for client-side route/role decisions (src/auth.js decodes but never
// trusts it for authorization) — never for calling the real authenticated
// backend. See src/auth.js:12-13 for the app's own documentation of this
// boundary.
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function forgedJwt(payload) {
  const header = b64url({ alg: 'none', typ: 'JWT' })
  const body = b64url({ ...payload, exp: 4102444800 }) // year 2100
  return `${header}.${body}.x`
}

// path may already carry its own query string (e.g. "/emergency?new=1") —
// join with '&' in that case instead of clobbering it with a second '?'.
function withTokens(baseUrl, path, access, id) {
  const sep = path.includes('?') ? '&' : '?'
  return `${baseUrl}${path}${sep}sso_token=${access}&sso_id_token=${id}`
}

function adminUrl(baseUrl, path = '/dashboard') {
  const access = forgedJwt({ sub: 'smoke-admin', username: 'smoke-admin', 'cognito:groups': ['transport-admin'] })
  const id = forgedJwt({ name: 'Smoke Admin', email: 'smoke-admin@test', 'cognito:groups': ['transport-admin'] })
  return withTokens(baseUrl, path, access, id)
}

// Non-admin role — routes to the requester Portal instead of the Console.
function userUrl(baseUrl, path = '/') {
  const access = forgedJwt({ sub: 'smoke-user', username: 'smoke-user', 'cognito:groups': ['emergency-user'] })
  const id = forgedJwt({ name: 'Smoke Requester', email: 'smoke-user@test', 'cognito:groups': ['emergency-user'] })
  return withTokens(baseUrl, path, access, id)
}

module.exports = { forgedJwt, adminUrl, userUrl }
