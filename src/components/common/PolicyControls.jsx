import React, { useState } from 'react'
import { useFleetStore } from '../../store/useFleetStore'
import Icon from './Icon'

// Lives in the sidebar profile popover as a single compact "Active policy"
// open button — the full table + upload used to render inline there, which
// crowded a small dropdown. Everything now lives in its own modal instead.
export default function PolicyControls() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="w-full h-9 rounded-xl text-[13px] font-medium flex items-center justify-center gap-2 transition-colors hover:bg-[#EEEFF3]"
        style={{ border: '1px solid #E5E7EB', color: '#374151' }}>
        <Icon name="infra" size={15} strokeWidth={1.8} />
        Active policy
      </button>
      {open && <PolicyModal onClose={() => setOpen(false)} />}
    </>
  )
}

function PolicyModal({ onClose }) {
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
    <div className="fixed inset-0 z-[1200] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-[420px] rounded-2xl overflow-hidden" style={{ background: '#fff', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}
        onClick={(ev) => ev.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div>
            <div className="text-[15px] font-bold text-[#0C1322]">Active policy</div>
            <div className="text-[11px] text-[#6B7280]">Current dispatch parameters, extracted from the last uploaded policy document.</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="h-8 w-8 rounded-xl grid place-items-center text-[#6B7280] hover:bg-[#EEEFF3] transition-colors shrink-0">
            <Icon name="x" size={15} strokeWidth={2.2} />
          </button>
        </div>

        <div className="px-5 py-4">
          {has ? (
            <table className="w-full text-[13px]">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <td className="py-2 text-[#6B7280]">{k}</td>
                    <td className="py-2 text-right font-semibold text-[#0C1322]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[13px] text-[#6B7280] py-2">No policy yet — upload a PDF to configure dispatch.</div>
          )}
        </div>

        <div className="px-5 py-4 flex items-center justify-between" style={{ borderTop: '1px solid rgba(0,0,0,0.07)', background: '#FAFBFB' }}>
          <div className="text-[11px] text-[#6B7280] flex-1 min-w-0">
            {msg ? (
              <span className={msg.ok ? 'text-[#16a34a]' : 'text-[#dc2626]'}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</span>
            ) : 'Upload a new policy PDF to update these values.'}
          </div>
          <label className={`text-[12px] px-3 h-8 rounded-lg bg-accent text-white inline-flex items-center gap-1.5 cursor-pointer shrink-0 ml-3 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
            {busy ? 'Applying…' : 'Upload PDF'}
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        </div>
      </div>
    </div>
  )
}
