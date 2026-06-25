import React, { useState } from 'react'
import { useFleetStore } from '../../store/useFleetStore'

// Compact "Active policy" + upload control, designed to live inside the sidebar
// profile popover. Uploading a PDF runs the policy-sync agent and refreshes the values.
export default function PolicyControls() {
  const policy = useFleetStore((s) => s.policyConfig)
  const upload = useFleetStore((s) => s.uploadPolicyDoc)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const has = policy && Object.keys(policy).length > 0

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true); setMsg(null)
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f)
      })
      const r = await upload(b64, f.name)
      if (r?.applied) setMsg({ ok: true, text: `Applied: ${r.applied.speed_kmh} km/h · 1 per ${r.applied.patients_per_ambulance} · max ${r.applied.max_units}` })
      else setMsg({ ok: false, text: r?.error || 'Could not read that policy document.' })
    } catch (err) { setMsg({ ok: false, text: err.message || 'Upload failed' }) }
    finally { setBusy(false); e.target.value = '' }
  }

  const rows = [
    ['Travel speed', policy.speed_kmh != null ? `${policy.speed_kmh} km/h` : '—'],
    ['Mass threshold', policy.mass_patient_threshold != null ? `${policy.mass_patient_threshold} pax` : '—'],
    ['Per ambulance', policy.patients_per_ambulance != null ? `${policy.patients_per_ambulance} pax` : '—'],
    ['Max units', policy.max_units ?? '—'],
    ['Auto-close', policy.autocomplete_minutes != null ? `${policy.autocomplete_minutes} min` : '—'],
    ['Severity', Array.isArray(policy.severity_order) ? policy.severity_order.map((s) => s[0]).join(' › ') : '—'],
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-cmd-text">Active policy</span>
        <label className={`text-[11px] px-2.5 h-7 rounded-md bg-accent text-white inline-flex items-center gap-1 cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          {busy ? 'Applying…' : '⬆ Upload PDF'}
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onFile} disabled={busy} />
        </label>
      </div>
      {has ? (
        <div className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between text-[12px]">
              <span className="text-cmd-muted">{k}</span><span className="font-medium text-cmd-text">{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-cmd-muted">No policy yet — upload a PDF to configure dispatch.</div>
      )}
      {msg && <div className={`mt-2 text-[11px] ${msg.ok ? 'text-status-enroute' : 'text-status-danger'}`}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</div>}
    </div>
  )
}
