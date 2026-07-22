import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import { api } from '../../services/api'
import { zoneById, mapCenter } from '../../data/locations'
import Icon from '../../components/common/Icon'
import { useCachedApi } from '../../hooks/useCachedApi'

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
// Request-density color ramp, low -> high (matches the legend swatches and
// the HeatLayer gradient stops below).
const HEAT = ['#38bdf8', '#22c55e', '#eab308', '#f97316', '#dc2626']

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

            <KpiRow kpis={data.kpis} staffing={data.staffing_recommendations} />
            <HeatmapCard points={data.heatmap_points} hotspot={data.top_hotspot} />
            <StagingCards placements={data.placement_recommendations} />

            <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
              <PeakHourTable staffing={data.staffing_recommendations} />
              <ShiftScalingCard windows={data.peak_windows} />
            </div>

            <SeasonalAlerts alerts={data.seasonal_alerts} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OutcomeMixCard mix={data.outcome_mix} falseAlarmPct={data.false_alarm_pct} />
              <ChannelMixCard mix={data.channel_mix} />
            </div>

            <CostEfficiencyCard cost={data.cost_efficiency} />
            <WeatherImpactCard weather={data.weather_impact} />
            <ChannelQualityCard quality={data.channel_quality} />

            <div className="pt-2">
              <h2 className="text-[15px] font-bold tracking-tight" style={{ color: '#0C1322' }}>Deep business intelligence</h2>
              <p className="text-[12px] mt-0.5" style={{ color: '#6B7280' }}>Every card below answers a named executive question, not just a metric.</p>
            </div>

            <DemandHeatmapCard cells={data.demand_heatmap} />

            <ResponseBottleneckCard rows={data.response_bottleneck} />
            <FleetRightsizingCard fleet={data.fleet_rightsizing} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CaseTypeGrowthCard rows={data.case_type_growth} />
              <SteelCycleCard rows={data.steel_cycle_impact} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <VoiceAdoptionTrendCard trend={data.voice_adoption_trend} />
              <DemographicResponseGapCard gap={data.demographic_response_gap} />
            </div>

            <ShockEventCapacityCard events={data.shock_event_capacity} margin={data.readiness_margin} />

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
function KpiRow({ kpis, staffing }) {
  const [showBreakdown, setShowBreakdown] = useState(false)
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

  // "Recommended units" is time-sensitive: only zones currently at their
  // peak hour actually need the extra units right now, so the headline
  // number reflects that instead of the flat all-day total.
  const currentHour = new Date().getHours()
  const atPeakNow = (staffing || []).filter((s) => s.peak_hour === currentHour)
  const liveRecommended = atPeakNow.length
    ? atPeakNow.reduce((sum, s) => sum + s.recommended_units, 0)
    : kpis.recommended_units_total

  const cards = [
    { icon: 'activity', label: 'Total incidents', value: kpis.total_incidents.toLocaleString(), sub: trendTag(kpis.incidents_trend_pct, 'up'), color: '#07514D' },
    { icon: 'clock', label: 'Avg response time', value: `${kpis.avg_response_min} min`, sub: trendTag(kpis.response_trend_pct, 'down'), color: '#2563eb' },
    { icon: 'route', label: 'Peak hour', value: `${String(kpis.peak_hour).padStart(2, '0')}:00`, sub: <span className="text-[11px] font-medium" style={{ color: '#d97706' }}>{kpis.peak_hour_multiplier}x more calls</span>, color: '#d97706' },
    {
      icon: 'truck', label: 'Recommended units', value: liveRecommended,
      sub: (
        <span className="text-[11px] font-semibold" style={{ color: atPeakNow.length ? '#16a34a' : '#6B7280' }}>
          {atPeakNow.length ? `${atPeakNow.length} zone${atPeakNow.length > 1 ? 's' : ''} at peak now · tap to view` : 'For current demand · tap to view'}
        </span>
      ),
      color: '#0B6A64', clickable: true,
    },
    { icon: 'infra', label: 'AI confidence', value: `${kpis.ai_confidence_pct}%`, sub: <span className="text-[11px] font-semibold" style={{ color: kpis.ai_confidence_label === 'High' ? '#16a34a' : kpis.ai_confidence_label === 'Medium' ? '#d97706' : '#dc2626' }}>{kpis.ai_confidence_label}</span>, color: '#7c3aed' },
  ]
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="p-4 card-lift"
            style={{ background: '#fff', borderRadius: '16px', cursor: c.clickable ? 'pointer' : 'default' }}
            onClick={c.clickable ? () => setShowBreakdown(true) : undefined}
            role={c.clickable ? 'button' : undefined}
            tabIndex={c.clickable ? 0 : undefined}
          >
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

      {showBreakdown && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: 'rgba(12,19,34,0.45)', zIndex: 5000 }}
          onClick={() => setShowBreakdown(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5"
            style={{ background: '#fff' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[15px] font-bold" style={{ color: '#0C1322' }}>Recommended units by zone</h3>
              <button onClick={() => setShowBreakdown(false)} className="text-[13px]" style={{ color: '#9CA3AF' }}>✕</button>
            </div>
            <p className="text-[12px] mb-3" style={{ color: '#6B7280' }}>
              Current time {String(currentHour).padStart(2, '0')}:00 — zones at their peak hour right now are highlighted.
            </p>
            <div className="space-y-2 max-h-80 overflow-auto">
              {(staffing || []).map((s) => {
                const isPeakNow = s.peak_hour === currentHour
                return (
                  <div
                    key={s.zone_id}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5"
                    style={{ background: isPeakNow ? 'rgba(22,163,74,0.08)' : '#FAFBFB', border: isPeakNow ? '1px solid rgba(22,163,74,0.3)' : '1px solid #EEF1F0' }}
                  >
                    <div>
                      <div className="text-[13px] font-semibold" style={{ color: '#0C1322' }}>{zoneById(s.zone_id)?.name || s.zone_id}</div>
                      <div className="text-[11px]" style={{ color: '#6B7280' }}>
                        Peak hour {String(s.peak_hour).padStart(2, '0')}:00{isPeakNow ? ' · peak now' : ''}
                      </div>
                    </div>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[12px] font-bold"
                      style={{ background: isPeakNow ? 'rgba(22,163,74,0.15)' : 'rgba(7,81,77,0.1)', color: isPeakNow ? '#16a34a' : '#07514D' }}
                    >
                      {s.recommended_units}
                    </span>
                  </div>
                )
              })}
              {!staffing?.length && <Empty />}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- request heatmap ---------- */
function HeatmapCard({ points, hotspot }) {
  const center = mapCenter()
  return (
    <NeoCard title="Request heatmap" subtitle="Intensity of historical calls across Jamshedpur, by pickup location">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
        <div className="rounded-xl overflow-hidden relative" style={{ height: 340 }}>
          <MapContainer center={[center.lat, center.lng]} zoom={12} zoomControl={false} className="h-full w-full">
            <TileLayer url={LIGHT_TILES} attribution='&copy; OpenStreetMap &copy; CARTO' />
            <HeatLayer points={points} />
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

// Real kernel-density gradient (leaflet.heat) instead of discrete circles —
// each zone contributes one weighted point (weight = intensity), with a
// wide radius/blur so five real zone-level points blend into soft gradient
// blobs rather than reading as five hard pins. Still genuine data (real
// call-volume weighting per zone), just rendered as a continuous surface.
function HeatLayer({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points?.length) return
    const layer = L.heatLayer(
      points.map((p) => [p.lat, p.lng, 0.3 + p.intensity * 0.7]),
      { radius: 55, blur: 45, maxZoom: 14, max: 1, gradient: { 0.2: '#38bdf8', 0.4: '#22c55e', 0.6: '#eab308', 0.8: '#f97316', 1.0: '#dc2626' } },
    ).addTo(map)
    return () => { map.removeLayer(layer) }
  }, [map, points])
  return null
}

/* ---------- staging point analysis ---------- */
function stagingTier(driftKm) {
  if (driftKm >= 0.6) return { badge: 'Move unit', color: '#dc2626', bg: 'rgba(220,38,38,0.1)', demand: 'High demand' }
  if (driftKm >= 0.3) return { badge: 'Watch', color: '#d97706', bg: 'rgba(217,119,6,0.1)', demand: 'Medium demand' }
  return { badge: 'Optimal', color: '#16a34a', bg: 'rgba(22,163,74,0.1)', demand: 'Well covered' }
}
const WATCHLIST_KEY = 'psiog_insights_watchlist'
function readWatchlist() { try { return new Set(JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]')) } catch { return new Set() } }
function writeWatchlist(set) { try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...set])) } catch {} }

// Real month-by-month call counts per zone (server-computed, up to the last
// 12 months of data) rendered as a bar-per-month sparkline — not a single
// flat progress bar standing in for "demand."
function MonthlyBars({ counts, color }) {
  if (!counts?.length) return <div className="h-9 mb-2.5" />
  const max = Math.max(...counts, 1)
  return (
    <div className="flex items-end gap-[3px] h-9 mb-2.5">
      {counts.map((n, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(8, Math.round((n / max) * 100))}%`, background: color, opacity: 0.35 + 0.65 * (n / max) }} />
      ))}
    </div>
  )
}

function StagingCards({ placements }) {
  const navigate = useNavigate()
  const [watchlist, setWatchlist] = useState(readWatchlist)
  if (!placements?.length) return null

  function toggleWatch(zoneId) {
    setWatchlist((prev) => {
      const next = new Set(prev)
      next.has(zoneId) ? next.delete(zoneId) : next.add(zoneId)
      writeWatchlist(next)
      return next
    })
  }

  return (
    <NeoCard title="Staging point analysis">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {placements.map((p) => {
          const tier = stagingTier(p.drift_km)
          const watching = watchlist.has(p.zone_id)
          return (
            <div key={p.zone_id} className="rounded-xl p-3.5" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
              <div className="flex items-center justify-between gap-1.5 mb-2">
                <span className="text-[13px] font-bold truncate" style={{ color: '#0C1322' }}>{zoneById(p.zone_id)?.name || p.zone_id}</span>
                <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold shrink-0" style={{ background: tier.bg, color: tier.color }}>{tier.badge}</span>
              </div>
              <div className="text-[11px] mb-2" style={{ color: tier.color }}>{tier.demand}</div>
              <MonthlyBars counts={p.monthly_calls} color={tier.color} />
              <div className="flex items-center justify-between text-[11px] mb-2.5">
                <span style={{ color: '#6B7280' }}>{p.drift_km} km drift</span>
                <span style={{ color: '#6B7280' }}>{p.calls.toLocaleString()} incidents</span>
              </div>
              {tier.badge === 'Optimal' ? (
                <button disabled className="w-full py-1.5 rounded-lg text-[11.5px] font-semibold cursor-default"
                  style={{ background: 'rgba(0,0,0,0.04)', color: '#6B7280' }} title={p.recommendation}>
                  No action
                </button>
              ) : tier.badge === 'Watch' ? (
                <button onClick={() => toggleWatch(p.zone_id)}
                  className="w-full py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors"
                  style={{ background: watching ? 'rgba(22,163,74,0.12)' : tier.bg, color: watching ? '#16a34a' : tier.color }}
                  title={watching ? 'Remove from your watchlist' : p.recommendation}>
                  {watching ? 'Watching ✓' : 'Monitor'}
                </button>
              ) : (
                <button onClick={() => navigate(`/map?zone=${encodeURIComponent(p.zone_id)}`)}
                  className="w-full py-1.5 rounded-lg text-[11.5px] font-semibold transition-colors hover:brightness-95"
                  style={{ background: tier.bg, color: tier.color }} title={p.recommendation}>
                  Reposition →
                </button>
              )}
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
        <table className="w-full text-[13px]" style={{ tableLayout: 'fixed' }}>
          <colgroup><col style={{ width: '46%' }} /><col style={{ width: '28%' }} /><col style={{ width: '26%' }} /></colgroup>
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

/* ---------- outcome mix (what dispatches actually resolve to) ---------- */
const OUTCOME_COLOR = {
  'Treated & Transported': '#16a34a', 'Fire Extinguished': '#16a34a',
  'Treated on Scene': '#2563eb', 'Assisted / No Fire Found': '#2563eb',
  'False Alarm': '#d97706', 'Refused Transport': '#9CA3AF', 'Cancelled': '#dc2626',
}
function OutcomeMixCard({ mix, falseAlarmPct }) {
  const flagged = falseAlarmPct >= 15
  return (
    <NeoCard title="Outcome mix" subtitle="What historical dispatches actually resolved to">
      {mix?.length ? (
        <div className="space-y-2.5">
          {mix.map((m) => (
            <div key={m.resolution}>
              <div className="flex items-center justify-between text-[12.5px] mb-1">
                <span className="font-medium" style={{ color: '#374151' }}>{m.resolution}</span>
                <span className="font-bold" style={{ color: OUTCOME_COLOR[m.resolution] || '#6B7280' }}>{m.pct}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#F0F1F0' }}>
                <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: OUTCOME_COLOR[m.resolution] || '#9CA3AF' }} />
              </div>
            </div>
          ))}
          {flagged && (
            <div className="mt-1 rounded-xl px-3.5 py-2.5 flex items-start gap-2" style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)' }}>
              <Icon name="alert" size={14} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: '#d97706' }} />
              <span className="text-[11.5px]" style={{ color: '#92400e' }}>
                False-alarm rate is {falseAlarmPct}% — worth reviewing intake triage/screening for over-dispatch.
              </span>
            </div>
          )}
        </div>
      ) : <Empty />}
    </NeoCard>
  )
}

/* ---------- request channel mix ---------- */
const CHANNEL_META = {
  HOSPITAL: { label: 'Hospital-initiated', icon: 'medical', color: '#07514D' },
  PORTAL: { label: 'Requester portal', icon: 'dashboard', color: '#2563eb' },
  CONSOLE: { label: 'Control room console', icon: 'infra', color: '#7c3aed' },
  VOICE: { label: 'Voice emergency line', icon: 'activity', color: '#dc2626' },
  FIRE: { label: 'Fire report', icon: 'flame', color: '#ea580c' },
}
function ChannelMixCard({ mix }) {
  const voice = mix?.find((m) => m.source === 'VOICE')
  return (
    <NeoCard title="Request channels" subtitle="Where dispatches actually originate">
      {mix?.length ? (
        <div className="space-y-2.5">
          {mix.map((m) => {
            const meta = CHANNEL_META[m.source] || { label: m.source, icon: 'alert', color: '#6B7280' }
            return (
              <div key={m.source} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${meta.color}18`, color: meta.color }}>
                  <Icon name={meta.icon} size={14} strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-[12.5px] mb-1">
                    <span className="font-medium truncate" style={{ color: '#374151' }}>{meta.label}</span>
                    <span className="font-bold shrink-0 ml-2" style={{ color: meta.color }}>{m.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F0F1F0' }}>
                    <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: meta.color }} />
                  </div>
                </div>
              </div>
            )
          })}
          {voice && (
            <div className="text-[11px] pt-1" style={{ color: '#9CA3AF' }}>
              Voice line accounts for {voice.pct}% of dispatches ({voice.count.toLocaleString()} calls) — the automated emergency-line agent.
            </div>
          )}
        </div>
      ) : <Empty />}
    </NeoCard>
  )
}

/* ---------- fleet cost & efficiency ---------- */
function CostEfficiencyCard({ cost }) {
  if (!cost) return null
  const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`
  const maxKindCost = Math.max(...(cost.by_kind || []).map((k) => k.total_cost), 1)
  return (
    <NeoCard title="Fleet cost & efficiency" subtitle="Modeled operating cost from historical dispatch distance/duration">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total modeled cost', value: inr(cost.total_cost_estimate), color: '#07514D' },
          { label: 'Avg cost / dispatch', value: inr(cost.avg_cost_per_dispatch), color: '#2563eb' },
          { label: 'Total fuel burned', value: `${cost.total_fuel_l.toLocaleString()} L`, color: '#d97706' },
          {
            label: 'Reassignment rate', value: `${cost.reassignment_rate_pct}%`,
            color: cost.reassignment_rate_pct >= 8 ? '#dc2626' : '#16a34a',
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
            <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#9CA3AF' }}>{s.label}</div>
            <div className="text-[18px] font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
      {cost.by_kind?.length > 0 && (
        <div className="space-y-2">
          {cost.by_kind.map((k) => (
            <div key={k.kind} className="flex items-center gap-3">
              <span className="text-[12px] font-medium capitalize w-16 shrink-0" style={{ color: '#374151' }}>{k.kind}</span>
              <div className="flex-1 h-5 rounded-lg overflow-hidden" style={{ background: '#F0F1F0' }}>
                <div className="h-full rounded-lg flex items-center px-2" style={{ width: `${Math.max(6, (k.total_cost / maxKindCost) * 100)}%`, background: '#07514D' }}>
                  <span className="text-[10px] font-bold text-white whitespace-nowrap">{inr(k.total_cost)}</span>
                </div>
              </div>
              <span className="text-[11px] w-24 text-right shrink-0" style={{ color: '#9CA3AF' }}>{k.dispatches.toLocaleString()} calls</span>
            </div>
          ))}
        </div>
      )}
    </NeoCard>
  )
}

/* ---------- weather impact on response ---------- */
function WeatherImpactCard({ weather }) {
  if (!weather?.length) return null
  const best = weather[weather.length - 1]
  const worst = weather[0]
  const deltaPct = best.avg_eta_to_pickup_min > 0
    ? Math.round(((worst.avg_eta_to_pickup_min - best.avg_eta_to_pickup_min) / best.avg_eta_to_pickup_min) * 100)
    : 0
  return (
    <NeoCard title="Weather impact on response" subtitle="Avg time-to-pickup and SLA compliance by condition, worst first">
      {deltaPct > 15 && (
        <div className="mb-3 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.16)' }}>
          <span className="text-[11.5px]" style={{ color: '#1e3a8a' }}>
            Response runs {deltaPct}% slower in <b>{worst.weather}</b> vs <b>{best.weather}</b> conditions — worth pre-positioning extra units when severe weather is forecast.
          </span>
        </div>
      )}
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
            <th className="text-left font-semibold pb-2">Condition</th>
            <th className="text-right font-semibold pb-2">Calls</th>
            <th className="text-right font-semibold pb-2">Avg time to pickup</th>
            <th className="text-right font-semibold pb-2">SLA breach</th>
          </tr>
        </thead>
        <tbody>
          {weather.map((w) => (
            <tr key={w.weather} style={{ borderTop: '1px solid #F0F1F0' }}>
              <td className="py-2 font-medium" style={{ color: '#0C1322' }}>{w.weather}</td>
              <td className="py-2 text-right" style={{ color: '#6B7280' }}>{w.calls.toLocaleString()}</td>
              <td className="py-2 text-right" style={{ color: '#374151' }}>{w.avg_eta_to_pickup_min} min</td>
              <td className="py-2 text-right">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{
                  background: w.sla_breach_pct >= 25 ? 'rgba(220,38,38,0.1)' : w.sla_breach_pct >= 12 ? 'rgba(217,119,6,0.1)' : 'rgba(22,163,74,0.1)',
                  color: w.sla_breach_pct >= 25 ? '#dc2626' : w.sla_breach_pct >= 12 ? '#d97706' : '#16a34a',
                }}>{w.sla_breach_pct}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </NeoCard>
  )
}

/* ---------- channel intake quality (Q: which channel produces the most false alarms — is voice-agent screening worse than a human?) ---------- */
function ChannelQualityCard({ quality }) {
  if (!quality?.length) return null
  const worst = quality[0]
  const voice = quality.find((q) => q.source === 'VOICE')
  const console_ = quality.find((q) => q.source === 'CONSOLE')
  const maxPct = Math.max(...quality.map((q) => q.false_alarm_pct), 1)
  return (
    <NeoCard
      title="Is voice-agent intake worse than human screening?"
      subtitle="False-alarm rate and wasted cost, by request channel"
    >
      {voice && console_ && (
        <div className="mb-3 rounded-xl px-3.5 py-2.5" style={{
          background: voice.false_alarm_pct > console_.false_alarm_pct ? 'rgba(217,119,6,0.08)' : 'rgba(22,163,74,0.06)',
          border: `1px solid ${voice.false_alarm_pct > console_.false_alarm_pct ? 'rgba(217,119,6,0.2)' : 'rgba(22,163,74,0.18)'}`,
        }}>
          <span className="text-[11.5px]" style={{ color: voice.false_alarm_pct > console_.false_alarm_pct ? '#92400e' : '#14532d' }}>
            <b>Answer:</b> Voice line false-alarms at {voice.false_alarm_pct}% vs {console_.false_alarm_pct}% for the console —
            {' '}voice screening is {voice.false_alarm_pct > console_.false_alarm_pct ? 'currently worse' : 'holding up as well or better'} than human intake.
            {' '}Worst overall channel is <b>{worst.source}</b> at {worst.false_alarm_pct}%.
          </span>
        </div>
      )}
      <div className="space-y-2.5">
        {quality.map((q) => {
          const meta = CHANNEL_META[q.source] || { label: q.source, color: '#6B7280' }
          return (
            <div key={q.source}>
              <div className="flex items-center justify-between text-[12.5px] mb-1">
                <span className="font-medium" style={{ color: '#374151' }}>{meta.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-bold" style={{ color: q.false_alarm_pct >= 15 ? '#dc2626' : '#374151' }}>{q.false_alarm_pct}%</span>
                  <span className="text-[10.5px]" style={{ color: '#9CA3AF' }}>₹{Math.round(q.wasted_cost_estimate).toLocaleString('en-IN')} wasted</span>
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#F0F1F0' }}>
                <div className="h-full rounded-full" style={{ width: `${(q.false_alarm_pct / maxPct) * 100}%`, background: q.false_alarm_pct >= 15 ? '#dc2626' : meta.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </NeoCard>
  )
}

/* ---------- demand heatmap: day-of-week x hour-of-day grid ---------- */
const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function heatColor(intensity) {
  // 0 -> cool, 1 -> hot, matching the HEAT ramp used on the map card
  const stops = [[56, 189, 248], [34, 197, 94], [234, 179, 8], [249, 115, 22], [220, 38, 38]]
  const t = Math.min(1, Math.max(0, intensity)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  const f = t - i
  const [r1, g1, b1] = stops[i], [r2, g2, b2] = stops[i + 1]
  return `rgb(${Math.round(r1 + (r2 - r1) * f)},${Math.round(g1 + (g2 - g1) * f)},${Math.round(b1 + (b2 - b1) * f)})`
}
function DemandHeatmapCard({ cells }) {
  if (!cells?.length) return null
  const max = Math.max(...cells.map((c) => c.calls), 1)
  const grid = {}
  cells.forEach((c) => { grid[`${c.day_of_week}-${c.hour}`] = c.calls })
  return (
    <NeoCard title="Demand heatmap" subtitle="Call volume by day of week x hour of day — where staffing should flex, at a glance">
      <div className="overflow-x-auto">
        <div style={{ minWidth: 640 }}>
          <div className="flex mb-1 pl-9">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[9px]" style={{ color: '#9CA3AF' }}>{h % 3 === 0 ? h : ''}</div>
            ))}
          </div>
          {DOW_LABEL.map((label, dow) => (
            <div key={dow} className="flex items-center mb-[2px]">
              <div className="w-9 text-[10.5px] font-medium shrink-0" style={{ color: '#6B7280' }}>{label}</div>
              <div className="flex flex-1 gap-[2px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const calls = grid[`${dow}-${h}`] || 0
                  const intensity = calls / max
                  return (
                    <div
                      key={h}
                      title={`${label} ${h}:00 — ${calls} calls`}
                      className="flex-1 rounded-[2px]"
                      style={{ height: 16, background: calls > 0 ? heatColor(intensity) : '#F0F1F0', opacity: calls > 0 ? 0.55 + intensity * 0.45 : 1 }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-3">
        <span className="text-[10px]" style={{ color: '#9CA3AF' }}>Fewer calls</span>
        {HEAT_LEGEND.map((c) => <div key={c} className="h-2.5 w-4 rounded-sm" style={{ background: c }} />)}
        <span className="text-[10px]" style={{ color: '#9CA3AF' }}>More calls</span>
      </div>
    </NeoCard>
  )
}
const HEAT_LEGEND = ['#38bdf8', '#22c55e', '#eab308', '#f97316', '#dc2626']

function BarRow({ label, pct, max, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-32 truncate shrink-0" style={{ color: '#374151' }}>{label}</span>
      <div className="flex-1 h-3 rounded-md overflow-hidden" style={{ background: '#F0F1F0' }}>
        <div className="h-full rounded-md" style={{ width: `${(pct / max) * 100}%`, background: color }} />
      </div>
      <span className="text-[10.5px] w-10 text-right shrink-0 font-medium" style={{ color: '#6B7280' }}>{pct}%</span>
    </div>
  )
}

/* ---------- response-time bottleneck decomposition (Q: where does the time actually go?) ---------- */
function ResponseBottleneckCard({ rows }) {
  if (!rows?.length) return null
  const maxTotal = Math.max(...rows.map((r) => r.avg_total_min), 1)
  return (
    <NeoCard
      title="Where does response time actually go?"
      subtitle="Total trip time decomposed into travel-to-scene, scene/handover, and the traffic-congestion tax, by vehicle type"
    >
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.kind}>
            <div className="flex items-center justify-between text-[12px] mb-1">
              <span className="font-medium capitalize" style={{ color: '#374151' }}>{r.kind}</span>
              <span className="font-bold" style={{ color: '#0C1322' }}>{r.avg_total_min} min total</span>
            </div>
            <div className="h-5 rounded-lg overflow-hidden flex" style={{ background: '#F0F1F0', width: `${(r.avg_total_min / maxTotal) * 100}%`, minWidth: '40%' }}>
              <div className="h-full flex items-center justify-center" style={{ width: `${(r.avg_time_to_pickup_min / r.avg_total_min) * 100}%`, background: '#07514D' }} title={`Travel to scene: ${r.avg_time_to_pickup_min}m`} />
              <div className="h-full flex items-center justify-center" style={{ width: `${(r.avg_scene_handover_min / r.avg_total_min) * 100}%`, background: '#2563eb' }} title={`Scene/handover: ${r.avg_scene_handover_min}m`} />
              {r.avg_traffic_delay_min > 0 && (
                <div className="h-full flex items-center justify-center" style={{ width: `${Math.min(30, (r.avg_traffic_delay_min / r.avg_total_min) * 100)}%`, background: '#dc2626' }} title={`Traffic tax: ${r.avg_traffic_delay_min}m`} />
              )}
            </div>
            <div className="flex gap-3 mt-1 text-[10.5px]" style={{ color: '#9CA3AF' }}>
              <span><span className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: '#07514D' }} />Travel {r.avg_time_to_pickup_min}m</span>
              <span><span className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: '#2563eb' }} />Handover {r.avg_scene_handover_min}m</span>
              <span><span className="inline-block h-2 w-2 rounded-sm mr-1" style={{ background: '#dc2626' }} />Traffic tax {r.avg_traffic_delay_min}m</span>
            </div>
          </div>
        ))}
      </div>
    </NeoCard>
  )
}

/* ---------- fleet right-sizing (Q: is the fleet the right size for demand?) ---------- */
function FleetRightsizingCard({ fleet }) {
  if (!fleet) return null
  const overprovisioned = fleet.status === 'Overprovisioned'
  return (
    <NeoCard title="Is the fleet the right size for demand?" subtitle="Vehicles currently in rotation vs. Little's-Law-modeled requirement">
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
          <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#9CA3AF' }}>In rotation</div>
          <div className="text-[18px] font-bold" style={{ color: '#0C1322' }}>{fleet.current_vehicles_in_use}</div>
        </div>
        <div className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
          <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#9CA3AF' }}>Modeled requirement</div>
          <div className="text-[18px] font-bold" style={{ color: '#0C1322' }}>{fleet.recommended_units}</div>
        </div>
        <div className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
          <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#9CA3AF' }}>Status</div>
          <div className="text-[15px] font-bold" style={{ color: overprovisioned ? '#d97706' : fleet.status === 'Underprovisioned' ? '#dc2626' : '#16a34a' }}>{fleet.status}</div>
        </div>
      </div>
      <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.16)' }}>
        <span className="text-[11.5px]" style={{ color: '#1e3a8a' }}><b>Answer:</b> {fleet.recommendation}</span>
      </div>
    </NeoCard>
  )
}

/* ---------- case-type mix growth (Q: which case types are growing as a share of volume?) ---------- */
function CaseTypeGrowthCard({ rows }) {
  if (!rows?.length) return null
  const growing = rows[0]
  const shrinking = rows[rows.length - 1]
  return (
    <NeoCard title="Which case types are growing (or shrinking) as a share of demand?" subtitle="Share of medical dispatches, early vs. recent quartile of the historical window">
      {growing && shrinking && (
        <div className="mb-3 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.18)' }}>
          <span className="text-[11.5px]" style={{ color: '#14532d' }}>
            <b>Answer:</b> <b>{growing.case_type}</b> grew {growing.delta_pct_points > 0 ? '+' : ''}{growing.delta_pct_points}pt share; <b>{shrinking.case_type}</b> shrank {shrinking.delta_pct_points}pt.
          </span>
        </div>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.case_type} className="flex items-center justify-between text-[12px]">
            <span className="font-medium" style={{ color: '#374151' }}>{r.case_type}</span>
            <span className="flex items-center gap-2">
              <span style={{ color: '#9CA3AF' }}>{r.early_share_pct}% → {r.recent_share_pct}%</span>
              <span className="px-1.5 py-0.5 rounded-md text-[10.5px] font-bold" style={{
                background: r.delta_pct_points > 0 ? 'rgba(22,163,74,0.1)' : r.delta_pct_points < 0 ? 'rgba(220,38,38,0.1)' : 'rgba(107,114,128,0.1)',
                color: r.delta_pct_points > 0 ? '#16a34a' : r.delta_pct_points < 0 ? '#dc2626' : '#6B7280',
              }}>{r.delta_pct_points > 0 ? '+' : ''}{r.delta_pct_points}pt</span>
            </span>
          </div>
        ))}
      </div>
    </NeoCard>
  )
}

/* ---------- steel-cycle decoupling test (Q: does demand track Tata Steel's own cycle?) ---------- */
function SteelCycleCard({ rows }) {
  if (!rows?.length) return null
  return (
    <NeoCard title="Does dispatch demand track Tata Steel's industrial cycle, or is it decoupled?" subtitle="Call-volume multiplier during known steel-industry events vs. an average day">
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.event_name} className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12.5px] font-medium" style={{ color: '#374151' }}>{r.event_name}</span>
              <span className="text-[13px] font-bold" style={{ color: r.multiplier_vs_average_day >= 1.15 ? '#dc2626' : r.multiplier_vs_average_day <= 0.9 ? '#2563eb' : '#16a34a' }}>{r.multiplier_vs_average_day}x</span>
            </div>
            <div className="text-[11px]" style={{ color: '#9CA3AF' }}>{r.interpretation}</div>
          </div>
        ))}
      </div>
    </NeoCard>
  )
}

/* ---------- voice-agent adoption trend (Q: is voice adoption growing, and does quality hold up?) ---------- */
function VoiceAdoptionTrendCard({ trend }) {
  if (!trend) return null
  const growing = trend.share_delta_pct_points > 0
  const qualityHolding = trend.recent_false_alarm_pct <= trend.early_false_alarm_pct + 2
  return (
    <NeoCard title="Is voice-agent adoption growing, and does intake quality hold up as it scales?" subtitle="Voice line's share of dispatches and its false-alarm rate, early vs. recent quartile">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
          <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#9CA3AF' }}>Adoption share</div>
          <div className="text-[16px] font-bold" style={{ color: '#0C1322' }}>{trend.early_share_pct}% → {trend.recent_share_pct}%</div>
          <div className="text-[10.5px] mt-0.5" style={{ color: growing ? '#16a34a' : '#dc2626' }}>{growing ? '+' : ''}{trend.share_delta_pct_points}pt</div>
        </div>
        <div className="rounded-xl px-3.5 py-3" style={{ background: '#FAFBFB', border: '1px solid #EEF1F0' }}>
          <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#9CA3AF' }}>False-alarm rate</div>
          <div className="text-[16px] font-bold" style={{ color: '#0C1322' }}>{trend.early_false_alarm_pct}% → {trend.recent_false_alarm_pct}%</div>
        </div>
      </div>
      <div className="rounded-xl px-3.5 py-2.5" style={{ background: qualityHolding ? 'rgba(22,163,74,0.06)' : 'rgba(217,119,6,0.08)', border: `1px solid ${qualityHolding ? 'rgba(22,163,74,0.18)' : 'rgba(217,119,6,0.2)'}` }}>
        <span className="text-[11.5px]" style={{ color: qualityHolding ? '#14532d' : '#92400e' }}>
          <b>Answer:</b> Adoption has {growing ? 'grown' : 'shrunk'} {Math.abs(trend.share_delta_pct_points)}pt, and screening quality has {qualityHolding ? 'held steady' : 'degraded'} as it scaled.
        </span>
      </div>
    </NeoCard>
  )
}

/* ---------- demographic-controlled response gap (equity check) ---------- */
function DemographicResponseGapCard({ gap }) {
  if (!gap || (!gap.by_age_band?.length && !gap.by_gender?.length)) return null
  return (
    <NeoCard title="Does response time differ by patient demographic?" subtitle="Avg time-to-pickup by age band and gender, for medical dispatches — an equity check">
      {gap.by_age_band?.length >= 2 && (
        <div className="mb-3 rounded-xl px-3.5 py-2.5" style={{ background: gap.widest_age_gap_pct >= 10 ? 'rgba(217,119,6,0.08)' : 'rgba(22,163,74,0.06)', border: `1px solid ${gap.widest_age_gap_pct >= 10 ? 'rgba(217,119,6,0.2)' : 'rgba(22,163,74,0.18)'}` }}>
          <span className="text-[11.5px]" style={{ color: gap.widest_age_gap_pct >= 10 ? '#92400e' : '#14532d' }}>
            <b>Answer:</b> Widest age-band gap is {gap.widest_age_gap_pct}% — {gap.widest_age_gap_pct >= 10 ? 'a measurable disparity worth investigating' : 'no material disparity detected'}.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {gap.by_age_band?.length > 0 && (
          <div>
            <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-2" style={{ color: '#9CA3AF' }}>By age band</div>
            <div className="space-y-1.5">
              {gap.by_age_band.map((a) => (
                <BarRow key={a.age_band} label={a.age_band} pct={a.avg_eta_to_pickup_min} max={Math.max(...gap.by_age_band.map((x) => x.avg_eta_to_pickup_min), 1)} color="#2563eb" />
              ))}
            </div>
          </div>
        )}
        {gap.by_gender?.length > 0 && (
          <div>
            <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-2" style={{ color: '#9CA3AF' }}>By gender</div>
            <div className="space-y-1.5">
              {gap.by_gender.map((gnd) => (
                <BarRow key={gnd.gender} label={gnd.gender} pct={gnd.avg_eta_to_pickup_min} max={Math.max(...gap.by_gender.map((x) => x.avg_eta_to_pickup_min), 1)} color="#7c3aed" />
              ))}
            </div>
          </div>
        )}
      </div>
    </NeoCard>
  )
}

/* ---------- shock-event capacity & current readiness margin ---------- */
function ShockEventCapacityCard({ events, margin }) {
  if (!events?.length && !margin) return null
  return (
    <NeoCard title="How much did response degrade in past shock events, and is today's fleet ready for a repeat?" subtitle="Response-time and SLA-compliance degradation during historical demand spikes vs. baseline">
      {margin && (
        <div className="mb-3 rounded-xl px-3.5 py-2.5" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.16)' }}>
          <span className="text-[11.5px]" style={{ color: '#1e3a8a' }}><b>Answer:</b> {margin.margin_recommendation}</span>
        </div>
      )}
      {events?.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
              <th className="text-left font-semibold pb-2">Event</th>
              <th className="text-right font-semibold pb-2">Calls</th>
              <th className="text-right font-semibold pb-2">Response degradation</th>
              <th className="text-right font-semibold pb-2">SLA breach shift</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.event_tag} style={{ borderTop: '1px solid #F0F1F0' }}>
                <td className="py-2 font-medium" style={{ color: '#0C1322' }}>{e.event_tag.replaceAll('_', ' ')}</td>
                <td className="py-2 text-right" style={{ color: '#6B7280' }}>{e.calls.toLocaleString()}</td>
                <td className="py-2 text-right font-bold" style={{ color: e.response_degradation_pct > 15 ? '#dc2626' : e.response_degradation_pct > 0 ? '#d97706' : '#16a34a' }}>
                  {e.response_degradation_pct > 0 ? '+' : ''}{e.response_degradation_pct}%
                </td>
                <td className="py-2 text-right" style={{ color: '#6B7280' }}>{e.sla_breach_degradation_pct_points > 0 ? '+' : ''}{e.sla_breach_degradation_pct_points}pt</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
