import React from 'react'
import { api } from '../../services/api'
import { zoneById } from '../../data/locations'
import Icon from '../../components/common/Icon'
import { useCachedApi } from '../../hooks/useCachedApi'

const RAMP = ['#07514D', '#0B6A64', '#2E8B84', '#4A9B96', '#7FB0AB', '#A9CCC8']

// This page is deliberately NOT a dashboard of raw historical charts — every
// card here is a specific, actionable recommendation (where to stage a unit,
// how many units a zone's peak hour justifies, when to scale staffing up)
// computed with plain explainable techniques: demand-weighted centroid,
// Little's Law, and seasonal-multiplier detection over the seeded synthetic
// dataset. See lambda /analytics/insights for the math.
export default function InsightsPage() {
  const { data, loading, refreshing, err } = useCachedApi('psiog_insights_v2', api.getInsights)

  const years = data?.date_range
    ? ((new Date(data.date_range.to) - new Date(data.date_range.from)) / (365.25 * 24 * 3600 * 1000)).toFixed(1)
    : null

  return (
    <div className="h-full overflow-auto page-enter" style={{ background: '#F7F4EF' }}>
      <div className="px-7 pt-7 pb-5">
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#0C1322' }}>AI Insights</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#6B7280' }}>
          Where to stage units and how to scale staffing — derived from {years ? `${years}yr` : ''} of seeded historical dispatch data
        </p>
      </div>

      <div className="px-7 pb-8 space-y-5">
        {loading && <NeoCard title="Loading"><Empty msg="Computing recommendations…" /></NeoCard>}
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

            {/* ── Placement recommendations ── */}
            <NeoCard title="Ambulance staging placement">
              {data.placement_recommendations?.length ? (
                <div className="space-y-2.5">
                  {data.placement_recommendations.map((p) => (
                    <div key={p.zone_id} className="rounded-xl px-3.5 py-3 flex items-start gap-3"
                      style={{ background: p.drift_km >= 0.4 ? 'rgba(217,119,6,0.06)' : 'rgba(11,106,100,0.05)', border: `1px solid ${p.drift_km >= 0.4 ? 'rgba(217,119,6,0.18)' : 'rgba(11,106,100,0.12)'}` }}>
                      <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0 mt-0.5"
                        style={{ background: p.drift_km >= 0.4 ? 'rgba(217,119,6,0.12)' : 'rgba(11,106,100,0.1)', color: p.drift_km >= 0.4 ? '#d97706' : '#0B6A64' }}>
                        <Icon name="route" size={15} strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-bold" style={{ color: '#0C1322' }}>{zoneById(p.zone_id)?.name || p.zone_id}</span>
                          {p.drift_km >= 0.4 && (
                            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold shrink-0" style={{ background: 'rgba(217,119,6,0.14)', color: '#d97706' }}>
                              {p.drift_km} km drift
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] mt-1" style={{ color: '#6B7280' }}>{p.recommendation}</div>
                        <div className="text-[11px] mt-1.5" style={{ color: '#9CA3AF' }}>{p.calls.toLocaleString()} historical pickups analyzed</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty />}
            </NeoCard>

            {/* ── Staffing sizing + peak windows ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NeoCard title="Recommended units by zone · peak-hour sizing">
                {data.staffing_recommendations?.length ? (
                  <div className="space-y-2.5">
                    {data.staffing_recommendations.map((s) => (
                      <div key={s.zone_id} className="pb-2.5" style={{ borderBottom: '1px solid #F0F1F0' }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold" style={{ color: '#0C1322' }}>{zoneById(s.zone_id)?.name || s.zone_id}</span>
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: 'rgba(7,81,77,0.1)', color: '#07514D' }}>
                            {s.recommended_units} unit{s.recommended_units > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-[11.5px] mt-1" style={{ color: '#6B7280' }}>{s.rationale}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty />}
              </NeoCard>

              <NeoCard title="Shift-change load scaling">
                {data.peak_windows?.length ? (
                  <div className="space-y-3">
                    {data.peak_windows.map((w, i) => (
                      <div key={w.window} className="rounded-xl px-3.5 py-3" style={{ background: `${RAMP[i % RAMP.length]}0F`, border: `1px solid ${RAMP[i % RAMP.length]}26` }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-bold" style={{ color: '#0C1322' }}>{w.window}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold" style={{ background: `${RAMP[i % RAMP.length]}22`, color: RAMP[i % RAMP.length] }}>
                            {w.multiplier_vs_overnight_baseline}x baseline
                          </span>
                        </div>
                        <div className="text-[12px] mt-1" style={{ color: '#6B7280' }}>{w.recommendation}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty />}
              </NeoCard>
            </div>

            {/* ── Seasonal / calendar-event alerts ── */}
            <NeoCard title="Seasonal & calendar-event alerts">
              {data.seasonal_alerts?.length ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {data.seasonal_alerts.map((a) => (
                    <div key={a.event_name} className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.14)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-bold" style={{ color: '#0C1322' }}>{a.event_name}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold shrink-0" style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>
                          {a.multiplier_vs_average_day}x average day
                        </span>
                      </div>
                      <div className="text-[12px] mt-1" style={{ color: '#6B7280' }}>{a.recommendation}</div>
                      <div className="text-[11px] mt-1.5" style={{ color: '#9CA3AF' }}>{a.historical_calls.toLocaleString()} historical calls tagged</div>
                    </div>
                  ))}
                </div>
              ) : <Empty msg="No calendar-driven spikes detected in this window." />}
            </NeoCard>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- presentational (mirrors DashboardPage's NeoCard look) ---------- */
function NeoCard({ title, children, className = '' }) {
  return (
    <div className={`p-5 card-static ${className}`} style={{ background: '#fff', borderRadius: '16px' }} role="figure" aria-label={title}>
      <div className="text-[11px] uppercase tracking-widest font-semibold mb-4" style={{ color: '#6B7280' }}>{title}</div>
      {children}
    </div>
  )
}
const Empty = ({ msg = 'No data yet.' }) => <div className="text-[13px] text-cmd-muted py-12 text-center">{msg}</div>
