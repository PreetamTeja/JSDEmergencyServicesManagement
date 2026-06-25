/* =====================================================================
   Auth helpers for the Transport API.
   Two principal types are supported:
     1. Browser users  -> Cognito JWT (Authorization: Bearer <token>),
        verified here against the pool JWKS (RS256, built-in crypto only).
     2. Server callers  -> x-api-key (hospital app, etc.), mapped to a source.
   No external dependencies (nodejs20 runtime).
   Env: COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID (optional aud check)
   ===================================================================== */
import crypto from 'crypto'

const REGION = process.env.COGNITO_REGION || ''
const POOL = process.env.COGNITO_USER_POOL_ID || ''
const CLIENT = process.env.COGNITO_CLIENT_ID || ''
const ISS = REGION && POOL ? `https://cognito-idp.${REGION}.amazonaws.com/${POOL}` : null
export const JWT_ENABLED = !!ISS

const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/* ---- JWKS cache (1h) ---- */
let _keys = null, _at = 0
async function jwks() {
  if (_keys && Date.now() - _at < 3600_000) return _keys
  const r = await fetch(`${ISS}/.well-known/jwks.json`)
  if (!r.ok) throw new Error('JWKS fetch failed')
  _keys = (await r.json()).keys || []
  _at = Date.now()
  return _keys
}

/* Verify a Cognito access/id token. Returns claims or null. */
export async function verifyJwt(token) {
  if (!ISS || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  let header, payload
  try { header = JSON.parse(b64url(h)); payload = JSON.parse(b64url(p)) } catch { return null }
  if (header.alg !== 'RS256' || !header.kid) return null
  let key
  try {
    const jwk = (await jwks()).find((k) => k.kid === header.kid)
    if (!jwk) return null
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  } catch { return null }
  const okSig = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, b64url(sig))
  if (!okSig) return null
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) return null
  if (payload.nbf && payload.nbf > now + 5) return null
  if (payload.iss !== ISS) return null
  if (payload.token_use && !['access', 'id'].includes(payload.token_use)) return null
  if (CLIENT) {
    const aud = payload.aud || payload.client_id
    if (aud && aud !== CLIENT) return null
  }
  return payload
}

export function groupsOf(claims) {
  const g = claims?.['cognito:groups'] || []
  return Array.isArray(g) ? g : [g].filter(Boolean)
}

// Admin if any group is allow-listed (ADMIN_GROUPS) or ends with "-admin".
const ADMIN_GROUPS = (process.env.ADMIN_GROUPS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
export function isAdminClaims(claims) {
  const g = groupsOf(claims)
  return ADMIN_GROUPS.length
    ? g.some((x) => ADMIN_GROUPS.includes(x))
    : g.some((x) => /-admin$/i.test(String(x)))
}

// A stable identity for ownership checks. `sub` is present in BOTH the access and id
// tokens (name/email are not in the access token), so clients must tag requests with it.
export function identityOf(claims) {
  return claims?.sub || claims?.username || claims?.email || claims?.name || null
}
