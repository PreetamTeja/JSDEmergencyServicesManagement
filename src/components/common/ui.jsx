import React from 'react'

export const STATUS_COLORS = {
  idle: '#64748b',
  enroute: '#22c55e',
  maintenance: '#f59e0b',
  available: '#22c55e',
  'on-trip': '#38bdf8',
  off: '#64748b',
}

export const PRIORITY_COLORS = {
  critical: '#ef4444',
  high: '#f59e0b',
  normal: '#38bdf8',
  low: '#64748b',
}

export { default as VehicleIcon } from './VehicleIcon.jsx'

export function StatusDot({ color, pulse }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: color }} />}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
    </span>
  )
}

export function Badge({ children, color = '#38bdf8' }) {
  return (
    <span className="chip" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
      {children}
    </span>
  )
}

export function Progress({ value, max, color = '#38bdf8', danger }) {
  const pct = Math.min(100, (value / max) * 100)
  const c = danger && value > max ? '#ef4444' : color
  return (
    <div className="h-2 w-full rounded-full bg-cmd-panel2 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: c }} />
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`panel !rounded-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[88vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-cmd-border px-5 py-3.5">
          <h3 className="font-semibold text-[20px] text-cmd-text">{title}</h3>
          <button className="text-cmd-muted hover:text-cmd-text text-xl leading-none" onClick={onClose}>×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// Right-side slide-in drawer (Fleetbase "New Order" style).
export function Drawer({ open, onClose, title, subtitle, actions, children, footer, width = 460 }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="drawer-panel h-full bg-cmd-panel border-l border-cmd-border shadow-2xl flex flex-col"
        style={{ width }} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-cmd-border px-5 py-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-cmd-text truncate">{title}</h3>
            {subtitle && <p className="text-xs text-cmd-muted truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button className="text-cmd-muted hover:text-cmd-text text-xl leading-none" onClick={onClose}>×</button>
          </div>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
        {footer && <div className="border-t border-cmd-border px-5 py-3 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

// Collapsible drawer section with a header bar.
export function DrawerSection({ title, children }) {
  return (
    <section className="border-b border-cmd-border">
      <div className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-cmd-muted bg-cmd-panel2">{title}</div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000
  if (Math.abs(diff) < 1) return 'just now'
  const m = Math.round(Math.abs(diff))
  if (diff > 0) return `${m}m ago`
  return `in ${m}m`
}
