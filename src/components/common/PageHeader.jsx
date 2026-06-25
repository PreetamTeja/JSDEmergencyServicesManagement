import React from 'react'

export default function PageHeader({ title, subtitle, children, light }) {
  return (
    <div className={`flex items-center justify-between px-6 py-4 border-b ${light ? 'border-slate-200' : 'border-cmd-border'}`}>
      <div>
        <h1 className="text-[20px] font-semibold text-cmd-text">{title}</h1>
        {subtitle && <p className="text-[14px] text-cmd-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
