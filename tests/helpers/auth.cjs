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

function adminUrl(baseUrl, path = '/dashboard') {
  const access = forgedJwt({ sub: 'smoke-admin', username: 'smoke-admin', 'cognito:groups': ['transport-admin'] })
  const id = forgedJwt({ name: 'Smoke Admin', email: 'smoke-admin@test', 'cognito:groups': ['transport-admin'] })
  return `${baseUrl}${path}?sso_token=${access}&sso_id_token=${id}`
}

module.exports = { forgedJwt, adminUrl }
