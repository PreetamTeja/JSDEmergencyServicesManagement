import React, { useEffect, useRef, useState } from 'react'
import { models, service, factories } from 'powerbi-client'
import { api } from '../../services/api'

// Secure Power BI embed (App-owns-data). The backend mints a short-lived embed
// token using a service principal — the user is authorized purely by their Cognito
// SSO session (the admin JWT on the API call), never by a Power BI login.
const powerbi = new service.Service(factories.hpmFactory, factories.wpmpFactory, factories.routerFactory)

export default function PowerBIReport() {
  const ref = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    let refreshTimer = null

    async function embed() {
      try {
        const { embedUrl, reportId, token, expiry } = await api.getPowerbiToken()
        if (cancelled || !ref.current) return
        powerbi.reset(ref.current)
        powerbi.embed(ref.current, {
          type: 'report',
          tokenType: models.TokenType.Embed,
          accessToken: token,
          embedUrl,
          id: reportId,
          settings: {
            panes: { filters: { visible: false } },
            background: models.BackgroundType.Transparent,
            // Without this, the embed SDK renders the report at its
            // authored 16:9 design size and letterboxes/crops inside
            // this fluid w-full/h-full container instead of actually
            // filling it — FitToPage scales the whole canvas (all
            // visuals together, proportions preserved) to the
            // container's real dimensions at render time, whatever
            // those turn out to be (admin console today, a different
            // website's iframe later).
            layoutType: models.LayoutType.Custom,
            customLayout: { displayOption: models.DisplayOption.FitToPage },
          },
        })
        // Refresh the token ~2 min before it expires so the report never drops out.
        if (expiry) {
          const ms = new Date(expiry).getTime() - Date.now() - 120000
          if (ms > 0) refreshTimer = setTimeout(embed, ms)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load the Power BI report')
      }
    }
    embed()
    return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); if (ref.current) powerbi.reset(ref.current) }
  }, [])

  if (error) return (
    <div className="h-full grid place-items-center bg-cmd-bg p-6 text-center">
      <div>
        <div className="text-status-danger font-semibold mb-1">Power BI report unavailable</div>
        <div className="text-sm text-cmd-muted max-w-md">{error}</div>
      </div>
    </div>
  )
  return <div ref={ref} className="h-full w-full bg-cmd-bg [&_iframe]:border-0" />
}
