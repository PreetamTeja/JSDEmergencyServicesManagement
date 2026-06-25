/* =====================================================================
   Policy-sync agent — ONE Lambda that proves the concept:
     policy PDF in S3  ->  Bedrock reads it  ->  backend Lambda updated.

   Flow:
     1. Read the policy PDF from S3 (event {bucket,key} or env defaults).
     2. Send the PDF straight to Amazon Bedrock (Converse "document" block)
        and ask it to extract the operational parameters as strict JSON.
     3. Validate, then push them onto the BACKEND Lambda as a POLICY_CONFIG
        env var via UpdateFunctionConfiguration — so the backend's behavior
        changes automatically, with no code rewrite and no redeploy.

   This is the safe pattern: the policy controls *parameters*, the agent writes
   them to the live function. (Generating/replacing code is intentionally NOT
   done here — that belongs behind a human-reviewed PR for a life-safety system.)

   Env: BEDROCK_MODEL_ID, TARGET_FUNCTION, POLICY_BUCKET, POLICY_KEY, AWS_REGION
   ===================================================================== */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { LambdaClient, GetFunctionConfigurationCommand, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda'

const bedrock = new BedrockRuntimeClient({})
const s3 = new S3Client({})
const lambda = new LambdaClient({})

const MODEL = process.env.BEDROCK_MODEL_ID || 'eu.amazon.nova-lite-v1:0'
const TARGET = process.env.TARGET_FUNCTION || 'psiog-transport-api'

// The schema we let the policy control. Defaults are the current code values.
const DEFAULTS = {
  speed_kmh: 28,
  mass_patient_threshold: 3,
  patients_per_ambulance: 4,
  max_units: 10,
  autocomplete_minutes: 10,
  severity_order: ['Critical', 'Urgent', 'Normal'],
}

const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

function sanitize(raw) {
  const o = raw || {}
  const sev = Array.isArray(o.severity_order) && o.severity_order.length === 3 ? o.severity_order : DEFAULTS.severity_order
  return {
    speed_kmh: clampNum(o.speed_kmh, 5, 120, DEFAULTS.speed_kmh),
    mass_patient_threshold: clampNum(o.mass_patient_threshold, 1, 50, DEFAULTS.mass_patient_threshold),
    patients_per_ambulance: clampNum(o.patients_per_ambulance, 1, 20, DEFAULTS.patients_per_ambulance),
    max_units: clampNum(o.max_units, 1, 50, DEFAULTS.max_units),
    autocomplete_minutes: clampNum(o.autocomplete_minutes, 1, 120, DEFAULTS.autocomplete_minutes),
    severity_order: sev,
  }
}

async function readPdf(bucket, key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return r.Body.transformToByteArray()
}

async function extractPolicy(pdfBytes) {
  const prompt =
    `You are reading an Emergency Services operational policy written in FREE-FORM NATURAL LANGUAGE ` +
    `(ordinary prose, sentences, possibly numbers spelled out as words). Understand the meaning and ` +
    `INFER each parameter even when it is phrased indirectly. Convert worded numbers to digits ` +
    `("forty" -> 40, "one ambulance for every four" -> patients_per_ambulance 4). ` +
    `Output ONLY minified JSON with EXACTLY these keys; if the document does not mention a value, ` +
    `keep the given default:\n` +
    `{"speed_kmh":number,"mass_patient_threshold":number,"patients_per_ambulance":number,` +
    `"max_units":number,"autocomplete_minutes":number,"severity_order":["Critical","Urgent","Normal"]}\n` +
    `Meanings (match these even if the document uses different words):\n` +
    `- speed_kmh: assumed ambulance/fire travel/response speed used for ETA (e.g. "travel at 40 km/h", "assume 30 kmph in traffic").\n` +
    `- mass_patient_threshold: number of casualties at/above which it counts as a mass-casualty incident (e.g. "more than 3 victims is a mass casualty").\n` +
    `- patients_per_ambulance: how many casualties one ambulance is expected to handle (e.g. "one ambulance per four patients").\n` +
    `- max_units: maximum ambulances dispatched to a single incident (e.g. "no more than 10 units per incident").\n` +
    `- autocomplete_minutes: minutes after which a trip is auto-closed (e.g. "close the trip after 12 minutes").\n` +
    `- severity_order: triage priority from highest to lowest (e.g. "prioritise critical, then urgent, then normal").\n` +
    `Current defaults (use ONLY for values the document does not specify): ` + JSON.stringify(DEFAULTS) + `\n` +
    `Output JSON only — no explanation, no markdown.`
  const out = await bedrock.send(new ConverseCommand({
    modelId: MODEL,
    messages: [{ role: 'user', content: [
      { text: prompt },
      { document: { format: 'pdf', name: 'EmergencyPolicy', source: { bytes: pdfBytes } } },
    ] }],
  }))
  const text = out.output.message.content.find((c) => c.text)?.text || ''
  const m = text.match(/\{[\s\S]*\}/)
  return sanitize(m ? JSON.parse(m[0]) : {})
}

async function applyToBackend(config) {
  const cur = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: TARGET }))
  const vars = { ...(cur.Environment?.Variables || {}), POLICY_CONFIG: JSON.stringify(config) }
  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: TARGET, Environment: { Variables: vars } }))
}

export const handler = async (event = {}) => {
  // Support S3 trigger records, direct invoke {bucket,key}, or env defaults.
  const rec = event.Records?.[0]?.s3
  const bucket = rec?.bucket?.name || event.bucket || process.env.POLICY_BUCKET
  const key = rec?.object?.key ? decodeURIComponent(rec.object.key.replace(/\+/g, ' ')) : (event.key || process.env.POLICY_KEY)
  if (!bucket || !key) return { ok: false, error: 'No policy document (set bucket/key or POLICY_BUCKET/POLICY_KEY)' }

  try {
    const pdf = await readPdf(bucket, key)
    const config = await extractPolicy(pdf)
    await applyToBackend(config)
    console.log('policy applied', JSON.stringify(config))
    return { ok: true, source: `s3://${bucket}/${key}`, target: TARGET, applied: config }
  } catch (e) {
    console.error('policy-sync error', e?.name, e?.message)
    return { ok: false, error: e?.message }
  }
}
