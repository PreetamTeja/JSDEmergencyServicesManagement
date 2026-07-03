import React from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'
import { api } from '../../services/api'
import { zoneById } from '../../data/locations'
import Icon from '../../components/common/Icon'
import { useCachedApi } from '../../hooks/useCachedApi'

const RAMP = ['#07514D', '#0B6A64', '#2E8B84', '#4A9B96', '#7FB0AB', '#A9CCC8']
const AXIS = '#9AA3A1'
const GRID = '#EEF1F0'
const TIP = {
  contentStyle: { border: '1px solid #E5E9E8', borderRadius: 0, fontSize: 12, boxShadow: 'none', padding: '6px 10px' },
  labelStyle: { color: '#161616', fontWeight: 600 }, cursor: { fill: 'rgba(7,81,77,0.05)' },
}

export default function InsightsPage() {
  const { data, loading, refreshing, err } = useCachedApi('psiog_insights_v1', api.getInsights)

  const years = data?.date_range
    ? ((new Date(data.date_range.to) - new Date(data.date_range.from)) / (365.25 * 24 * 3600 * 1000)).toFixed(1)
    : null

  return (
    <div className="h-full overflow-auto page-enter" style={{ background: '#F7F4EF' }}>
      <div className="px-7 pt-7 pb-5">
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#0C1322' }}>AI Insights</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#6B7280' }}>
          Patterns mined from {years ? `${years}yr` : ''} seeded historical dispatch data — for planning, not live ops
        </p>
      </div>

      <div className="px-7 pb-8 space-y-5">
        {loading && <NeoCard title="Loading"><Empty msg="Crunching historical data…" /></NeoCard>}
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

            {/* ── Demand patterns ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NeoCard title="Call demand by hour of day">
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={data.demand.by_hour.map((h) => ({ name: h.hour, value: h.calls }))} margin={{ left: -20, top: 6 }} barCategoryGap="15%">
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 10, fill: AXIS }} interval={2} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} />
                    <Tooltip {...TIP} labelFormatter={(v) => `${v}:00`} />
                    <Bar dataKey="value" fill={RAMP[0]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </NeoCard>
              <NeoCard title="Call demand by day of week">
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={data.demand.by_weekday.map((w) => ({ name: w.weekday, value: w.calls }))} margin={{ left: -20, top: 6 }} barCategoryGap="35%">
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: AXIS }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} />
                    <Tooltip {...TIP} />
                    <Bar dataKey="value" fill={RAMP[1]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </NeoCard>
            </div>

            {/* ── Response trend ── */}
            <NeoCard title={`Avg response time trend · monthly ${data.response_trend.pct_change_first_to_last_quartile !== 0 ? `(${data.response_trend.pct_change_first_to_last_quartile > 0 ? '+' : ''}${data.response_trend.pct_change_first_to_last_quartile}% vs. early window)` : ''}`}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.response_trend.by_month} margin={{ left: -10, top: 6, right: 10 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 10, fill: AXIS }} interval={5} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} />
                  <Tooltip {...TIP} formatter={(v) => [`${v} min`, 'Avg ETA']} />
                  <Line type="monotone" dataKey="avg_eta_to_pickup_min" stroke={RAMP[0]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </NeoCard>

            {/* ── Case & severity mix ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NeoCard title="Medical case-type mix">
                <Donut data={data.case_mix.map((c, i) => ({ name: c.case_type, value: c.count, color: RAMP[i % RAMP.length] }))} />
              </NeoCard>
              <NeoCard title="Severity mix">
                <Donut data={data.severity_mix.map((s, i) => ({ name: s.severity, value: s.count, color: RAMP[i % RAMP.length] }))} />
              </NeoCard>
            </div>

            {/* ── Zone demand & utilization ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NeoCard title="Demand by zone">
                <Bars data={data.demand.by_zone.map((z) => ({ name: zoneById(z.zone_id)?.name || z.zone_id, value: z.calls }))} color={RAMP[2]} vertical />
              </NeoCard>
              <NeoCard title="Busiest simulated vehicle/zone pairs">
                <Bars data={data.utilization.map((u) => ({ name: `${u.vehicle_id} · ${zoneById(u.zone_id)?.name || u.zone_id}`, value: u.calls }))} color={RAMP[3]} vertical />
              </NeoCard>
            </div>
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
function Donut({ data }) {
  if (!data.length) return <Empty />
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <>
      <div className="relative">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip {...TIP} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-[26px] font-bold leading-none" style={{ color: '#0C1322' }}>{total}</div>
            <div className="text-[10px] uppercase tracking-widest font-semibold mt-1" style={{ color: '#6B7280' }}>total</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {data.map((d) => (
          <span key={d.name} className="flex items-center gap-1.5 text-[12px] text-cmd-text">
            <i className="h-2 w-2 rounded-full" style={{ background: d.color }} />
            {d.name} <span className="text-cmd-muted">({d.value})</span>
          </span>
        ))}
      </div>
    </>
  )
}
function Bars({ data, color, vertical }) {
  if (!data.length || data.every((d) => !d.value)) return <Empty />
  if (vertical) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 12 }} barCategoryGap="30%">
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis dataKey="name" type="category" width={140} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#4B5552' }} />
          <Tooltip {...TIP} />
          <Bar dataKey="value" fill={color || RAMP[0]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ left: -20, top: 6 }} barCategoryGap="35%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: AXIS }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} />
        <Tooltip {...TIP} />
        <Bar dataKey="value" fill={color || RAMP[0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
const Empty = ({ msg = 'No data yet.' }) => <div className="text-[13px] text-cmd-muted py-12 text-center">{msg}</div>
