/* Generate two demo policy PDFs (no dependencies) for the policy-sync agent:
   policy-initial.pdf  -> baseline values
   policy-updated.pdf  -> every number halved (easy to verify the change)
   Run:  node make-policy-pdfs.mjs   */
import { writeFileSync } from 'fs'

// Minimal valid single-page PDF with Helvetica text lines.
function buildPdf(lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  let text = 'BT /F1 13 Tf 50 760 Td 18 TL\n'
  lines.forEach((l) => { text += `(${esc(l)}) Tj T*\n` })
  text += 'ET'

  const objs = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>',
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
    `<</Length ${Buffer.byteLength(text)}>>\nstream\n${text}\nendstream`,
  ]

  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f\r\n`
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n\r\n` })
  out += `trailer\n<</Size ${objs.length + 1} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'binary')
}

// Natural-language (prose) policy — the agent must understand meaning, not key:value.
const policy = (v) => [
  'Tata Steel Jamshedpur - Emergency Services Operational Policy',
  '',
  `For estimating arrival times, control room should assume that ambulances and`,
  `fire trucks travel at about ${v.speed} kilometres per hour across the township`,
  `under normal conditions.`,
  '',
  `Any incident involving more than ${v.massMinus} injured people is to be treated`,
  `as a mass-casualty event. In such cases dispatch roughly one ambulance for`,
  `every ${v.per} casualties, and in no situation send more than ${v.max} ambulances`,
  `to a single incident.`,
  '',
  `If a response has not been completed, the system should automatically close the`,
  `trip after ${v.close} minutes so the vehicle is freed for the next call.`,
  '',
  `When triaging, always prioritise critical cases first, then urgent, then normal.`,
]

// massMinus = threshold-1 so "more than N" reads naturally for the stated threshold.
writeFileSync('policy-initial.pdf', buildPdf(policy({ speed: 40, massMinus: 3, per: 4, max: 10, close: 12 })))
writeFileSync('policy-updated.pdf', buildPdf(policy({ speed: 20, massMinus: 1, per: 2, max: 5, close: 6 })))
console.log('Wrote policy-initial.pdf and policy-updated.pdf')
