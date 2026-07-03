import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFleetStore } from '../../store/useFleetStore'
import Icon from './Icon'

// Static, always-available actions. Built once per open rather than per
// keystroke — this list never changes while the palette is open.
function buildStaticCommands(navigate, isAdmin) {
  const nav = (to) => ({ action: () => navigate(to) })
  const cmds = [
    { id: 'new-emergency', label: 'New Emergency', hint: 'Report an emergency', icon: 'plus', action: () => navigate('/emergency?new=1') },
  ]
  if (isAdmin) {
    cmds.push(
      { id: 'go-dashboard', label: 'Go to Dashboard', icon: 'dashboard', ...nav('/dashboard') },
      { id: 'go-emergencies', label: 'Go to Emergencies', icon: 'emergency', ...nav('/emergency') },
      { id: 'go-dispatch', label: 'Go to Dispatch Board', icon: 'requests', ...nav('/requests') },
      { id: 'go-map', label: 'Go to Live Map', icon: 'map', ...nav('/map') },
      { id: 'go-fleet', label: 'Go to Fleet & Crews', icon: 'fleet', ...nav('/fleet') },
      { id: 'go-powerbi', label: 'Go to Power BI', icon: 'powerbi', ...nav('/powerbi') },
      { id: 'go-infra', label: 'Go to Infra Health', icon: 'infra', ...nav('/admin/infra') },
    )
  }
  return cmds
}

export default function CommandPalette({ open, onClose, isAdmin }) {
  const navigate = useNavigate()
  const emergencies = useFleetStore((s) => s.emergencies)
  const [q, setQ] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => { if (open) { setQ(''); setHighlight(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])

  const staticCommands = useMemo(() => buildStaticCommands(navigate, isAdmin), [navigate, isAdmin])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    const matches = (label) => !term || label.toLowerCase().includes(term)
    const cmdMatches = staticCommands.filter((c) => matches(c.label))

    let emgMatches = []
    if (term && isAdmin) {
      emgMatches = emergencies
        .filter((e) => [e.id, e.caseType, e.severity, e.state].filter(Boolean).some((f) => f.toLowerCase().includes(term)))
        .slice(0, 6)
        .map((e) => ({
          id: `emg-${e.id}`, label: e.id, hint: `${e.caseType || e.kind} · ${e.severity} · ${e.state}`,
          icon: e.kind === 'fire' ? 'flame' : 'medical',
          action: () => navigate(`/requests?q=${encodeURIComponent(e.id)}`),
        }))
    }
    return [...cmdMatches, ...emgMatches]
  }, [q, staticCommands, emergencies, isAdmin])

  useEffect(() => { setHighlight(0) }, [q])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(results.length - 1, h + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); return }
      if (e.key === 'Enter') { e.preventDefault(); const r = results[highlight]; if (r) { r.action(); onClose() } }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, results, highlight, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]" style={{ background: 'rgba(12,19,34,0.35)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette"
        className="w-[520px] max-w-[90vw] rounded-2xl overflow-hidden boot-in"
        style={{ background: '#fff', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <Icon name="search" size={15} strokeWidth={2} className="text-[#6B7280] shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions, pages, emergency ID…" aria-label="Command palette search"
            className="flex-1 h-full outline-none text-[14px] text-[#0C1322] bg-transparent" />
          <kbd className="text-[10.5px] px-1.5 py-0.5 rounded font-mono shrink-0" style={{ background: 'rgba(0,0,0,0.06)', color: '#6B7280' }}>Esc</kbd>
        </div>
        <div className="max-h-[340px] overflow-auto py-1.5">
          {results.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-[#6B7280]">No matches.</div>}
          {results.map((r, i) => (
            <button key={r.id} onClick={() => { r.action(); onClose() }} onMouseEnter={() => setHighlight(i)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
              style={i === highlight ? { background: 'rgba(7,81,77,0.07)' } : {}}>
              <span className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ background: 'rgba(7,81,77,0.08)', color: '#07514D' }}>
                <Icon name={r.icon || 'requests'} size={14} strokeWidth={1.8} />
              </span>
              <span className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium text-[#0C1322] truncate">{r.label}</div>
                {r.hint && <div className="text-[11px] text-[#6B7280] truncate">{r.hint}</div>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
