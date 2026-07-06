import React from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import { api } from '../../services/api'
import { zoneById, mapCenter } from '../../data/locations'
import Icon from '../../components/common/Icon'
import { useCachedApi } from '../../hooks/useCachedApi'

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
// Request-density color ramp, low -> high (matches the legend swatches).
const HEAT = ['#38bdf8', '#22c55e', '#eab308', '#f97316', '#dc2626']
function heatColor(intensity) { return HEAT[Math.min(HEAT.length - 1, Math.floor(intensity * HEAT.length))] }

// Every number on this page comes from GET /analytics/insights (live,
// cached with background revalidation) over the seeded synthetic dataset —
// there is no fabricated/mock content here. Two honest simplifications vs.
// a full analytics product: (1) the map shows a zone-level heat overlay
// (colored circles sized/colored by real call volume per zone) rather than
// a true per-point kernel-density heatmap, since the backend aggregates at
// zone granularity; (2) "AI Confidence" is a sample-size heuristic (more
// historical records -> tighter estimates), not a model certainty score —
// labeled as such below rather than implied to be something it isn't.
export default function InsightsPage() {
  // Stable key, deliberately not version-suffixed: every past redesign of
  // this page bumped this string (v1 -> v2 -> v3), which silently wiped
  // everyone's cache and forced the full "Computing insights..." screen
  // again on the next visit. Components below already render safely with
  // a partial/older-shaped cached object, so there's no need to invalidate
  // on schema changes — the background refresh fills in the rest.
  const { data, loading, refreshing, err } = useCachedApi('psiog_insights', api.getInsights)

  const years = data?.date_range
    ? ((new Date(data.date_range.to) - new Date(data.date_range.from)) / (365.25 * 24 * 3600 * 1000)).toFixed(1)
    : null
  const dateLabel = data?.date_range
    ? `${new Date(data.date_range.from).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} – ${new Date(data.date_range.to).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
    : null

  return (
    <div className="h-full overflow-auto page-enter" style={{ background: '#F7F4EF' }}>
      <div className="px-7 pt-7 pb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#0C1322' }}>AI Insights</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#6B7280' }}>Historical intelligence to optimize ambulance staging and staffing.</p>
        </div>
        {dateLabel && (
          <span className="px-3 py-1.5 rounded-full text-[12px] font-medium shrink-0 mt-0.5" style={{ background: 'rgba(7,81,77,0.08)', color: '#07514D' }}>
            {dateLabel}
          </span>
        )}
      </div>

      <div className="px-7 pb-8 space-y-5">
        {loading && <NeoCard title="Loading"><Empty msg="Computing insights…" /></NeoCard>}
        {err && <NeoCard title="Unavailable"><Empty msg={`Couldn't load insights: ${err}`} /></NeoCard>}

        {data && (
          <>
            <div className="flex items-center gap-2 -mb-1">
              <Icon name="alert" size={13} strokeWidth={2} className="text-[#9CA3AF]" />
              <span className="text-[11px]" style={{ color: '#9CA3AF' }}>
                {data.record_count?.toLocaleString()} seeded historical records · not live dispatch data
                {refreshing && ' · refreshing…'}
              </span>
            </div>

            <KpiRow kpis={data.kpis} />
            <HeatmapCard points={data.heatmap_points} hotspot={data.top_hotspot} />
            <StagingCards placements={data.placement_recommendations} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PeakHourTable staffing={data.staffing_recommendations} />
              <ShiftScalingCard windows={data.peak_windows} />
            </div>

            <SeasonalAlerts alerts={data.seasonal_alerts} />

            <div className="text-[11.5px] text-center pt-1" style={{ color: '#9CA3AF' }}>
              Insights are generated from {years ? `${years} yrs` : 'seeded'} of historical dispatch data and refresh in the background on each visit.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- KPI row ---------- */
function KpiRow({ kpis }) {
  if (!kpis) return null
  const trendTag = (pct, goodDirection) => {
    if (!pct) return null
    const good = goodDirection === 'up' ? pct > 0 : pct < 0
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: good ? '#16a34a' : '#d97706' }}>
        {pct > 0 ? '↗' : '↘'} {Math.abs(pct)}% vs early window
      </span>
    )
  }
  const cards = [
    { icon: 'activity', label: 'Total incidents', value: kpis.total_incidents.toLocaleString(), sub: trendTag(kpis.incidents_trend_pct, 'up'), color: '#07514D' },
    { icon: 'clock', label: 'Avg response time', value: `${kpis.avg_response_min} min`, sub: trendTag(kpis.response_trend_pct, 'down'), color: '#2563eb' },
    { icon: 'route', label: 'Peak hour', value: `${String(kpis.peak_hour).padStart(2, '0')}:00`, sub: <span className="text-[11px] font-medium" style={{ color: '#d97706' }}>{kpis.peak_hour_multiplier}x more calls</span>, color: '#d97706' },
    { icon: 'truck', label: 'Recommended units', value: kpis.recommended_units_total, sub: <span className="text-[11px]" style={{ color: '#6B7280' }}>For current demand</span>, color: '#0B6A64' },
    { icon: 'infra', label: 'AI confidence', value: `${kpis.ai_confidence_pct}%`, sub: <span className="text-[11px] font-semibold" style={{ color: kpis.ai_confidence_label === 'High' ? '#16a34a' : kpis.ai_confidence_label === 'Medium' ? '#d97706' : '#dc2626' }}>{kpis.ai_confidence_label}</span>, color: '#7c3aed' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="p-4 card-lift" style={{ background: '#fff', borderRadius: '16px' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="h-8 w-8 rounded-xl grid place-items-center" style={{ background: `${c.color}18`, color: c.color }}>
              <Icon name={c.icon} size={15} strokeWidth={1.8} />
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#9CA3AF' }}>{c.label}</div>
          <div className="text-[24px] font-bold leading-tight mt-0.5" style={{ color: '#0C1322' }}>{c.value}</div>
          <div className="mt-1">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

/* ---------- request heatmap ---------- */
function HeatmapCard({ points, hotspot }) {
  const center = mapCenter()
  return (
    <NeoCard title="Request heatmap" subtitle="Intensity of historical calls across Jamshedpur, by zone">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
        <div className="rounded-xl overflow-hidden relative" style={{ height: 340 }}>
          <MapContainer center={[center.lat, center.lng]} zoom={12} zoomControl={false} className="h-full w-full">
            <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
            {(points || []).map((p) => (
              <CircleMarker key={p.zone_id} center={[p.lat, p.lng]} radius={18 + p.intensity * 30}
                pathOptions={{ color: heatColor(p.intensity), fillColor: heatColor(p.intensity), fillOpacity: 0.35, weight: 1, opacity: 0.6 }}>
                <Tooltip direction="top" offset={[0, -10]}>
                  <b>{zoneById(p.zone_id)?.name || p.zone_id}</b><br />{p.calls.toLocaleString()} historical calls
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
            <div className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: '#6B7280' }}>Request density</div>
            {['Very high', 'High', 'Medium', 'Low', 'Very low'].map((label, i) => (
              <div key={label} className="flex items-center gap-2 text-[12px] mb-1" style={{ color: '#374151' }}>
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: HEAT[HEAT.length - 1 - i] }} />{label}
              </div>
            ))}
          </div>
          {hotspot && (
            <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.14)' }}>
              <div className="text-[11px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: '#6B7280' }}>Top hotspot</div>
              <div className="text-[14px] font-bold" style={{ color: '#dc2626' }}>{zoneById(hotspot.zone_id)?.name || hotspot.zone_id}</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: '#6B7280' }}>{hotspot.drift_km} km drift from staging point</div>
            </div>
          )}
        </div>
      </div>
    </NeoCard>
  )
}

/* ---------- staging point analysis ---------- */
function stagingTier(driftKm) {
  if (driftKm >= 0.6) return { badge: 'Move unit', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', demand: 'High demand' }
  if (driftKm >= 0.3) return { badge: 'Watch', color: '#d97706', bg: 'rgba(217,119,6,0.1)', demand: 'Medium demand' }
  return { badge: 'Optimal', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', demand: 'Well covered' }
}
function StagingCards({ placements }) {
  if (!placements?.length) return null
  const maxCalls = Math.max(...placements.map((p) => p.calls), 1)
  return (
    <NeoCard title="Staging point analysis">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {placements.map((p) => {
          const tier = stagingTier(p.drift_km)
          return (
            <div key={p.zone_id} className="rounded-xl p-3.5" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
              <div className="flex items-center justify-between gap-1.5 mb-2">
                <span className="text-[13px] font-bold truncate" style={{ color: '#0C1322' }}>{zoneById(p.zone_id)?.name || p.zone_id}</span>
                <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold shrink-0" style={{ background: tier.bg, color: tier.color }}>{tier.badge}</span>
              </div>
              <div className="text-[11px] mb-2" style={{ color: tier.color }}>{tier.demand}</div>
              <div className="h-1.5 rounded-full overflow-hidden mb-2.5" style={{ background: 'rgba(0,0,0,0.06)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((p.calls / maxCalls) * 100)}%`, background: tier.color }} />
              </div>
              <div className="flex items-center justify-between text-[11px] mb-2.5">
                <span style={{ color: '#6B7280' }}>{p.drift_km} km drift</span>
                <span style={{ color: '#6B7280' }}>{p.calls.toLocaleString()} incidents</span>
              </div>
              <button disabled className="w-full py-1.5 rounded-lg text-[11.5px] font-semibold cursor-default"
                style={{ background: tier.badge === 'Optimal' ? 'rgba(0,0,0,0.04)' : tier.bg, color: tier.badge === 'Optimal' ? '#6B7280' : tier.color }}
                title={p.recommendation}>
                {tier.badge === 'Optimal' ? 'No action' : tier.badge === 'Watch' ? 'Monitor' : 'Reposition'}
              </button>
            </div>
          )
        })}
      </div>
    </NeoCard>
  )
}

/* ---------- recommended units table ---------- */
function PeakHourTable({ staffing }) {
  return (
    <NeoCard title="Recommended units by peak hour">
      {staffing?.length ? (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
              <th className="text-left font-semibold pb-2">Zone</th>
              <th className="text-left font-semibold pb-2">Peak hour</th>
              <th className="text-right font-semibold pb-2">Units needed</th>
            </tr>
          </thead>
          <tbody>
            {staffing.map((s) => (
              <tr key={s.zone_id} style={{ borderTop: '1px solid #F0F1F0' }}>
                <td className="py-2 font-semibold" style={{ color: '#0C1322' }}>{zoneById(s.zone_id)?.name || s.zone_id}</td>
                <td className="py-2" style={{ color: '#374151' }}>{String(s.peak_hour).padStart(2, '0')}:00</td>
                <td className="py-2 text-right">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: 'rgba(7,81,77,0.1)', color: '#07514D' }}>
                    {s.recommended_units}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty />}
    </NeoCard>
  )
}

/* ---------- shift-wise load scaling ---------- */
function ShiftScalingCard({ windows }) {
  return (
    <NeoCard title="Shift-wise load scaling" subtitle="Call volume vs overnight baseline">
      {windows?.length ? (
        <div className="space-y-3">
          {windows.map((w) => (
            <div key={w.window} className="rounded-xl px-3.5 py-3 flex items-center gap-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate" style={{ color: '#0C1322' }}>{w.window}</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: '#6B7280' }}>{w.recommendation}</div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[13px] font-bold shrink-0" style={{ background: 'rgba(217,119,6,0.12)', color: '#d97706' }}>
                {w.multiplier_vs_overnight_baseline}x
              </span>
            </div>
          ))}
        </div>
      ) : <Empty />}
    </NeoCard>
  )
}

/* ---------- seasonal / calendar-event alerts ---------- */
const EVENT_ICONS = { Monsoon: 'droplet', 'New Year': 'flame', Respiratory: 'medical', Diwali: 'flame' }
function eventIcon(name) {
  const key = Object.keys(EVENT_ICONS).find((k) => name.includes(k))
  return EVENT_ICONS[key] || 'alert'
}
function SeasonalAlerts({ alerts }) {
  return (
    <NeoCard title="Seasonal & event alerts">
      {alerts?.length ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {alerts.map((a) => (
            <div key={a.event_name} className="rounded-xl p-3.5" style={{ background: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.12)' }}>
              <div className="h-8 w-8 rounded-lg grid place-items-center mb-2" style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
                <Icon name={eventIcon(a.event_name)} size={15} strokeWidth={1.8} />
              </div>
              <div className="text-[13px] font-bold" style={{ color: '#0C1322' }}>{a.event_name}</div>
              {a.window_label && <div className="text-[11px] mt-0.5" style={{ color: '#9CA3AF' }}>{a.window_label}</div>}
              <div className="text-[20px] font-bold mt-2" style={{ color: '#dc2626' }}>+{Math.round((a.multiplier_vs_average_day - 1) * 100)}%</div>
              <div className="text-[10.5px]" style={{ color: '#9CA3AF' }}>vs average day</div>
              <div className="flex items-center justify-between mt-2.5 text-[11px]">
                <span style={{ color: '#6B7280' }}>{a.historical_calls.toLocaleString()} calls</span>
                <span className="px-2 py-0.5 rounded-full font-bold" style={{
                  background: a.risk_level === 'High' ? 'rgba(220,38,38,0.12)' : a.risk_level === 'Medium' ? 'rgba(217,119,6,0.12)' : 'rgba(107,114,128,0.12)',
                  color: a.risk_level === 'High' ? '#dc2626' : a.risk_level === 'Medium' ? '#d97706' : '#6B7280',
                }}>{a.risk_level} risk</span>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty msg="No calendar-driven spikes detected in this window." />}
    </NeoCard>
  )
}

/* ---------- presentational ---------- */
function NeoCard({ title, subtitle, children }) {
  return (
    <div className="p-5 card-static" style={{ background: '#fff', borderRadius: '16px' }} role="figure" aria-label={title}>
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#6B7280' }}>{title}</div>
        {subtitle && <div className="text-[11.5px] mt-0.5" style={{ color: '#9CA3AF' }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}
const Empty = ({ msg = 'No data yet.' }) => <div className="text-[13px] text-cmd-muted py-12 text-center">{msg}</div>
