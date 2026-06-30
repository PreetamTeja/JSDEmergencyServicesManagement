/* =====================================================================
   Voice emergency agent — AWS Lambda (nodejs20), Amazon Bedrock.
   Conversational slot-filling: each turn we extract {kind, location, case_type,
   severity} from the whole transcript. If something required is missing, we ask
   for it; once everything is present we dispatch automatically (no end button).
   Reliable on any Converse model (no tool-calling dependency).
   Env: API_BASE, API_KEY, BEDROCK_MODEL_ID
   ===================================================================== */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import crypto from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
// OKF knowledge bundle — loaded once at cold start
const OKF_DIR = join(__dir, '..', 'knowledge')
function loadOKF() {
  try {
    const sections = ['emergency-types/index.md', 'vehicles/index.md']
    const locFiles = readdirSync(join(OKF_DIR, 'locations'))
      .filter((f) => f !== 'index.md' && f.endsWith('.md'))
      .map((f) => `locations/${f}`)
    return [...sections, ...locFiles]
      .map((p) => { try { return readFileSync(join(OKF_DIR, p), 'utf8') } catch { return '' } })
      .join('\n\n---\n\n')
  } catch { return '' }
}
const OKF_KNOWLEDGE = loadOKF()

const bedrock = new BedrockRuntimeClient({})
const MODEL = process.env.BEDROCK_MODEL_ID || 'eu.amazon.nova-lite-v1:0'
const API_BASE = process.env.API_BASE
const API_KEY = process.env.API_KEY

/* ---- locked-down CORS ---- */
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean)
const corsFor = (event) => {
  const o = event.headers?.origin || event.headers?.Origin
  const allow = ALLOWED.includes('*') ? '*' : (o && ALLOWED.includes(o) ? o : (ALLOWED[0] || 'null'))
  return { 'access-control-allow-origin': allow, 'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'POST,OPTIONS', 'vary': 'Origin', 'content-type': 'application/json' }
}
let CORS = corsFor({})
const reply = (obj, code = 200) => ({ statusCode: code, headers: CORS, body: JSON.stringify(obj) })

/* ---- Cognito JWT verification (RS256, built-in crypto) ---- */
const C_REGION = process.env.COGNITO_REGION || ''
const C_POOL = process.env.COGNITO_USER_POOL_ID || ''
const C_CLIENT = process.env.COGNITO_CLIENT_ID || ''
const C_ISS = C_REGION && C_POOL ? `https://cognito-idp.${C_REGION}.amazonaws.com/${C_POOL}` : null
const JWT_ENABLED = !!C_ISS
const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
let _keys = null, _at = 0
async function jwks() {
  if (_keys && Date.now() - _at < 3600_000) return _keys
  const r = await fetch(`${C_ISS}/.well-known/jwks.json`); _keys = (await r.json()).keys || []; _at = Date.now(); return _keys
}
async function verifyJwt(token) {
  if (!C_ISS || !token) return null
  const [h, p, sig] = token.split('.'); if (!sig) return null
  let header, payload
  try { header = JSON.parse(b64url(h)); payload = JSON.parse(b64url(p)) } catch { return null }
  if (header.alg !== 'RS256' || !header.kid) return null
  try {
    const jwk = (await jwks()).find((k) => k.kid === header.kid); if (!jwk) return null
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' })
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, b64url(sig))) return null
  } catch { return null }
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) return null
  if (payload.iss !== C_ISS) return null
  if (C_CLIENT) { const aud = payload.aud || payload.client_id; if (aud && aud !== C_CLIENT) return null }
  return payload
}
const identityOf = (c) => c?.sub || c?.username || c?.email || c?.name || null

const SEV = ['Critical', 'Urgent', 'Normal']
const CASES = ['Cardiac', 'Trauma', 'General', 'Maternity', 'Pediatric']

/* ---------- locations (cached) ---------- */
let _locs = null
async function locations() {
  if (_locs) return _locs
  try { _locs = ((await (await fetch(`${API_BASE}/reference/locations`)).json()) || []).map((l) => ({ id: l.id, name: l.name })) }
  catch { _locs = [] }
  return _locs
}
const knownId = (id) => (_locs || []).some((l) => l.id === id)

/* ---------- fuzzy location resolver ---------- */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const STOP = new Set(['quarters', 'quarter', 'hostel', 'hostels', 'block', 'near', 'the', 'area', 'road',
  'gate', 'colony', 'campus', 'to', 'at', 'in', 'a', 'an', 'please', 'send', 'need', 'there', 'is', 'fire',
  'accident', 'ambulance', 'truck', 'building', 'house', 'flat', 'number', 'no', 'and', 'me', 'we', 'my'])
function resolveLocation(text) {
  if (!text || !_locs?.length) return null
  const full = norm(text)
  const q = full.split(' ').filter((w) => w && !STOP.has(w))
  let best = null, bs = 0
  for (const l of _locs) {
    const name = norm(l.name); const nameTok = name.split(' ').filter(Boolean)
    let s = 0
    for (const w of q) {
      if (nameTok.includes(w)) s += 2
      else if (nameTok.some((n) => n.length > 2 && (n.includes(w) || w.includes(n)))) s += 1
    }
    if (name && (full.includes(name) || name.includes(full))) s += 3
    if (s > bs) { bs = s; best = l.id }
  }
  return bs >= 2 ? best : null
}

/* ---------- dispatch via the existing /emergencies API ---------- */
async function dispatch(input, requestedBy) {
  const body = {
    external_ref: 'VOICE-' + Date.now(),
    kind: input.kind,
    source: input.kind === 'fire' ? 'FIRE' : 'HOSPITAL',
    pickup: { ref: input.pickup_id },
    case_type: input.kind === 'fire' ? 'Fire' : input.case_type,
    severity: input.severity || 'Urgent',
    units: input.units || 1,
    patients: input.patients || 1,
    requested_by: requestedBy || 'Voice agent',
  }
  const r = await fetch(`${API_BASE}/emergencies`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify(body),
  })
  return r.json()
}

// Dispatch from already-collected slots (used on confirm — no re-extraction, no loop).
async function doDispatch(s, requestedBy, locs) {
  const kind = (s.kind === 'fire' || s.kind === 'medical') ? s.kind : 'medical'
  const pid = knownId(s.pickup_id) ? s.pickup_id : resolveLocation(s.pickup_id)
  if (!pid) return reply({ reply: 'What is the location of the emergency?', booked: null })
  const severity = SEV.includes(s.severity) ? s.severity : 'Urgent'
  const caseType = CASES.includes(s.case_type) ? s.case_type : 'General'
  const patients = Math.max(1, Math.round(Number(s.patients) || 1))
  const units = Math.min(10, Math.max(1, Math.round(Number(s.units) || 1)))
  const place = (locs.find((l) => l.id === pid)?.name) || 'the location'
  const result = await dispatch({ kind, pickup_id: pid, case_type: kind === 'fire' ? undefined : caseType, severity, units, patients }, requestedBy)
  console.log('dispatch result', JSON.stringify(result))
  if (result.incident_id) {
    const replyText = result.dispatched > 0
      ? `Mass casualty — ${result.dispatched} ambulance${result.dispatched > 1 ? 's' : ''} dispatched to ${place} for ${patients} people.`
      : 'No ambulances are available right now.'
    return reply({ reply: replyText, booked: { ...result, mass: true, kind, pickup_id: pid, severity, case_type: caseType, patients } })
  }
  const ok = result.status === 'EN_ROUTE'
  const replyText = ok
    ? `${kind === 'fire' ? 'Fire truck' : 'Ambulance'} dispatched${result.hospital ? ' to ' + result.hospital : ''}.`
    : (result.reason || 'No unit is available right now.')
  return reply({ reply: replyText, booked: { ...result, kind, pickup_id: pid, severity, case_type: caseType } })
}

/* ---------- slot extraction from the transcript ---------- */
async function extractSlots(transcript, locs) {
  // OKF knowledge bundle gives the model rich aliases, zone context, and
  // emergency-type guidance — far more than a flat id=name list.
  // Fallback to flat list if bundle failed to load (e.g. local dev without files).
  const locationContext = OKF_KNOWLEDGE
    ? `Use the Open Knowledge Format bundle below to resolve locations and emergency types.\n\n${OKF_KNOWLEDGE}`
    : `Locations (id=name): ` + locs.map((l) => `${l.id}=${l.name}`).join('; ')

  const sys = [{ text:
    `You read an emergency phone call transcript and extract structured fields. Output ONLY minified JSON, nothing else:\n` +
    `{"kind":"medical|fire|","pickup_id":"a location id from the list or empty","pickup_text":"the place the caller said or empty","case_type":"Cardiac|Trauma|General|Maternity|Pediatric|","severity":"Critical|Urgent|Normal|","patients":0}\n` +
    `Rules: kind=fire for any fire/smoke/blaze, otherwise medical if it's a medical/health emergency, else empty. ` +
    `Map the spoken place to the closest location id using the aliases and context in the knowledge bundle; also copy the spoken place into pickup_text. ` +
    `"patients" = number of people affected/injured (integer); use 0 if unknown. ` +
    `A bomb blast, explosion, building collapse, stampede, gas leak, or "many/multiple people injured" is a MASS CASUALTY — set case_type to Trauma, severity to Critical, and patients to the stated count (estimate generously if they say "many"). ` +
    `Leave a field "" or 0 ONLY if the caller truly has not indicated it. Do not invent values that weren't implied.\n\n` +
    locationContext }]
  const out = await bedrock.send(new ConverseCommand({ modelId: MODEL, system: sys, messages: [{ role: 'user', content: [{ text: transcript || '(no input yet)' }] }] }))
  const raw = out.output.message.content.find((c) => c.text)?.text || ''
  const m = raw.match(/\{[\s\S]*\}/)
  return m ? JSON.parse(m[0]) : {}
}

/* ===================================================================== */
export const handler = async (event) => {
  CORS = corsFor(event)
  if (event.requestContext?.http?.method === 'OPTIONS') return reply({})

  // Require an authenticated user (Cognito JWT) when configured — the voice line
  // dispatches real units and calls a paid model, so it must not be open.
  const bearer = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
  const claims = bearer ? await verifyJwt(bearer) : null
  if (JWT_ENABLED && !claims) return reply({ reply: 'Please sign in to use the emergency voice line.', booked: null }, 401)

  let payload = {}
  try { payload = JSON.parse(event.body || '{}') } catch {}
  const turns = Array.isArray(payload.messages) ? payload.messages.slice(-20)
    .filter((t) => t && typeof t.text === 'string' && t.text.length <= 1000)
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', text: t.text })) : []
  // Trust the verified identity over the body for who the request is for.
  const requestedBy = identityOf(claims) || payload.requestedBy
  const finalize = !!payload.finalize
  const confirmed = !!payload.confirmed   // caller approved the dispatch in the dialog

  const locs = await locations()
  const transcript = turns.filter((t) => t.text).map((t) => `${t.role === 'assistant' ? 'Agent' : 'Caller'}: ${t.text}`).join('\n')
  const anyUser = turns.some((t) => t.role !== 'assistant' && t.text && t.text.trim())

  // greeting (call just opened)
  if (!anyUser && !finalize) return reply({ reply: 'Emergency line. Do you need an ambulance or a fire truck, and where is it?', booked: null })

  try {
    // Confirm path: dispatch the slots we already collected — do NOT re-extract
    // (re-extraction can drop a field and cause an endless "please confirm" loop).
    if (confirmed && payload.slots && payload.slots.pickup_id) {
      return await doDispatch(payload.slots, requestedBy, locs)
    }

    const slots = await extractSlots(transcript, locs)
    console.log('slots', JSON.stringify(slots))

    let kind = (slots.kind === 'fire' || slots.kind === 'medical') ? slots.kind : ''
    let pid = knownId(slots.pickup_id) ? slots.pickup_id : (resolveLocation(slots.pickup_id) || resolveLocation(slots.pickup_text) || resolveLocation(transcript))
    let caseType = CASES.includes(slots.case_type) ? slots.case_type : ''
    let severity = SEV.includes(slots.severity) ? slots.severity : ''
    // Mass casualty: send the patient count and let the BACKEND decide how many
    // ambulances to send (policy-driven). We only flag "mass" for the wording.
    const patients = Math.max(1, Math.round(Number(slots.patients) || 1))
    const mass = kind === 'medical' && patients > 3

    // On End-call, push it through with sensible defaults.
    if (finalize) { if (!severity) severity = 'Urgent'; if (kind === 'medical' && !caseType) caseType = 'General' }

    // Ask for the first missing required field.
    if (!kind) return reply({ reply: 'Do you need an ambulance or a fire truck?', booked: null })
    if (!pid) return reply({ reply: 'What is the location of the emergency?', booked: null })
    if (kind === 'medical' && !caseType) return reply({ reply: 'What is the medical emergency? For example cardiac, trauma, maternity, pediatric, or general.', booked: null })
    if (!severity) return reply({ reply: 'How severe is it — critical, urgent, or normal?', booked: null })

    // Everything present -> ask the caller to confirm before dispatching.
    const place = (locs.find((l) => l.id === pid)?.name) || 'the location'
    if (!confirmed) {
      const summary = kind === 'fire'
        ? `a fire truck to ${place}, severity ${severity}`
        : mass
          ? `a mass casualty response to ${place} for ${patients} people, severity ${severity}`
          : `an ambulance to ${place} for a ${caseType.toLowerCase()} case, severity ${severity}`
      return reply({
        reply: `I have ${summary}. Should I dispatch? Say yes to confirm or no to change something.`,
        booked: null,
        pending: { kind, pickup_id: pid, case_type: caseType, severity, units: 1, patients, mass, summary },
      })
    }

    // Confirmed (e.g. End-call finalize, no client slots) -> dispatch the computed slots.
    return await doDispatch({ kind, pickup_id: pid, case_type: caseType, severity, units: 1, patients }, requestedBy, locs)
  } catch (e) {
    console.error('voice-agent error', e?.name, e?.message)
    return reply({ reply: `Voice service error: ${e?.message || 'unknown'}`, booked: null })
  }
}
