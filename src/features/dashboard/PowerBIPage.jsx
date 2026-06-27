import React from 'react'

// Standalone Power BI view (public "Publish to web" embed) — kept separate from
// the native Dashboard so we can demo the BI report without touching the main UI.
// Set VITE_POWERBI_EMBED_URL to the iframe `src` from Power BI → File → Embed report
// → Publish to web (public).
export default function PowerBIPage() {
  const url = import.meta.env.VITE_POWERBI_EMBED_URL

  if (!url) {
    return (
      <div className="h-full grid place-items-center bg-cmd-bg p-6 text-center">
        <div className="panel p-6 max-w-md">
          <div className="text-[18px] font-semibold mb-1">Power BI not configured</div>
          <p className="text-[13px] text-cmd-muted">
            Set <code>VITE_POWERBI_EMBED_URL</code> to the report's public embed URL
            (Power BI → File → Embed report → Publish to web), then rebuild.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-cmd-bg">
      <div className="shrink-0 px-5 h-14 flex items-center border-b border-cmd-border">
        <div>
          <div className="text-[15px] font-semibold leading-tight">Power BI Analytics</div>
          <div className="text-[11px] text-cmd-muted">JSD TATA Emergency Services · embedded report</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-4">
        <iframe
          title="Power BI Report"
          src={url}
          className="w-full h-full border border-cmd-border bg-white"
          frameBorder="0"
          allowFullScreen
        />
      </div>
    </div>
  )
}
