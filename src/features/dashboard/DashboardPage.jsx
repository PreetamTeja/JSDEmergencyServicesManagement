import React, { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, zoneById, ZONES } from '../../data/locations'
import { hospitalById, shortHospitalName, SEVERITY_META } from '../../data/hospitals'
import { slaTargets } from '../../services/sla'
import { istDateKey } from '../../services/time'
import Icon from '../../components/common/Icon'
import LiveEta from '../../components/common/LiveEta'
import { api } from '../../services/api'
import { useCachedApi } from '../../hooks/useCachedApi'

const KIND = { medical: '#0B6A64', fire: '#E8833A' }
// Cohesive teal ramp for categorical charts (brand-aligned, minimal).
const RAMP = ['#07514D', '#0B6A64', '#2E8B84', '#4A9B96', '#7FB0AB', '#A9CCC8']
const AXIS = '#9AA3A1'
const GRID = '#EEF1F0'
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

// Shared minimal tooltip look.
const TIP = {
  contentStyle: { border: '1px solid #E5E9E8', borderRadius: 0, fontSize: 12, boxShadow: 'none', padding: '6px 10px' },
  labelStyle: { color: '#161616', fontWeight: 600 }, cursor: { fill: 'rgba(7,81,77,0.05)' },
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const emergencies = useFleetStore((s) => s.emergencies)
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const policy = useFleetStore((s) => s.policyConfig)
  const m = useMemo(() => buildMetrics(emergencies, vehicles, hospitals), [emergencies, vehicles, hospitals])
  // Reference target for the response-time KPI (Urgent is the common case).
  const respTarget = slaTargets(policy).Urgent
  const respOk = m.avgResp <= respTarget

  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="h-full overflow-auto page-enter" style={{ background: '#F7F4EF' }}>
      {/* ── Page header ── */}
      <div className="px-7 pt-7 pb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#0C1322' }}>Operations Overview</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#6B7280' }}>Emergency response analytics · live from dispatch</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          {m.active > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold"
              style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] animate-pulse" />
              {m.active} active
            </span>
          )}
          <span className="px-3 py-1.5 rounded-full text-[12px] font-medium"
            style={{ background: 'rgba(7,81,77,0.08)', color: '#07514D' }}>
            {dateLabel}
          </span>
        </div>
      </div>

      <div className="px-7 pb-8 space-y-5">
        {/* ── KPI cards (neomorphic) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <NeoKpi icon="activity" label="Total responses" value={m.total}
            sub={`${m.todayCount} today · ${m.yesterdayCount} yesterday`} spark={m.totalSpark}
            onClick={() => navigate('/requests')} />
          <NeoKpi icon="pulse" label="Active now" value={m.active} sub={`${m.queued} queued`} accentColor="#16a34a"
            onClick={() => navigate('/requests')} />
          <NeoKpi icon="clock" label="Avg response" value={m.avgResp} format={(v) => `${v.toFixed(1)}m`}
            sub={`target ≤ ${respTarget}m ${respOk ? '✓ on track' : '· over'}`}
            accentColor={respOk ? '#16a34a' : '#d97706'} spark={m.respSpark}
            onClick={() => navigate('/requests')} />
          <NeoKpi icon="route" label="Avg trip" value={m.avgTrip} format={(v) => `${v.toFixed(1)}m`} sub="end to end" />
          <NeoKpi icon="truck" label="Fleet in use" value={m.utilPct} format={(v) => `${Math.round(v)}%`} sub={`${m.enroute}/${m.fleetTotal} units`} accentColor="#d97706"
            onClick={() => navigate('/fleet')} />
        </div>

        {/* ── Row 1 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <NeoCard title="Responses by type"><Donut data={m.byKind} /></NeoCard>
          <NeoCard title="Responses by severity"><Bars data={m.bySeverity} /></NeoCard>
          <NeoCard title="Medical cases by type"><Bars data={m.byCase} color={RAMP[0]} /></NeoCard>
        </div>

        {/* ── Row 2 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <NeoCard title="Responses by zone"><Bars data={m.byZone} color={RAMP[1]} onBarClick={(d) => navigate(`/requests?q=${encodeURIComponent(d.name)}`)} /></NeoCard>
          <NeoCard title="Responses over time · 14 days">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={m.overTime} margin={{ left: -20, top: 6, right: 6 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: AXIS }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: AXIS }} />
                <Tooltip {...TIP} />
                <Line type="monotone" dataKey="medical" stroke={KIND.medical} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="fire" stroke={KIND.fire} strokeWidth={2} dot={false} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
              </LineChart>
            </ResponsiveContainer>
          </NeoCard>
          <NeoCard title="Avg response time by severity · min"><Bars data={m.respBySeverity} /></NeoCard>
        </div>

        {/* ── Row 3 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <NeoCard title="Fleet availability">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={m.fleetAvail} margin={{ left: -20, top: 6 }} barCategoryGap="35%">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 12, fill: AXIS }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS }} />
                <Tooltip {...TIP} />
                <Bar dataKey="idle" stackId="a" fill="#CBD5D3" radius={[0,0,4,4]} />
                <Bar dataKey="enroute" stackId="a" fill="#16a34a" />
                <Bar dataKey="maintenance" stackId="a" fill="#d97706" radius={[4,4,0,0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" />
              </BarChart>
            </ResponsiveContainer>
          </NeoCard>
          <NeoCard title="Top receiving hospitals" className="lg:col-span-2">
            <Bars data={m.topHospitals} color={RAMP[2]} vertical />
          </NeoCard>
        </div>

        {/* ── Active table ── */}
        <NeoCard title={`Active responses · ${m.active}`}>
          {m.active === 0 ? <Empty msg="No active emergencies right now — new dispatches appear here live." /> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide" style={{ color: '#6B7280', borderBottom: '1px solid #E9EAEC' }}>
                  <Th>ID</Th><Th>Type</Th><Th>Severity</Th><Th>Zone</Th><Th>Vehicle</Th><Th>Destination</Th><Th>ETA</Th>
                </tr>
              </thead>
              <tbody>
                {emergencies.filter((e) => e.state === 'EN_ROUTE').map((e) => {
                  const isFire = e.kind === 'fire'
                  const veh = vehicles.find((v) => v.id === e.ambulanceId)
                  const sevColor = SEVERITY_META[e.severity]?.color || '#6B7280'
                  return (
                    <tr key={e.id} onClick={() => navigate(`/requests?q=${encodeURIComponent(e.id)}`)}
                      className="transition-colors cursor-pointer hover:bg-[rgba(7,81,77,0.03)]" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      <td className="py-2.5 font-semibold text-[#0C1322]">{e.id}</td>
                      <td><span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: isFire ? '#FEF0E6' : '#E6F0EE', color: isFire ? KIND.fire : KIND.medical }}>{isFire ? 'Fire' : e.caseType || 'Medical'}</span></td>
                      <td><span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: `${sevColor}14`, color: sevColor }}>{e.severity}</span></td>
                      <td className="text-[#374151]">{zoneById(locById(e.pickup)?.zone_id)?.name || '—'}</td>
                      <td className="font-mono text-[12px] text-[#374151]">{veh?.reg || '—'}</td>
                      <td className="text-[#374151]">{isFire ? (locById(e.pickup)?.name || '—') : (shortHospitalName(hospitalById(e.hospitalId)?.name) || '—')}</td>
                      <td className="font-semibold text-[13px]" style={{ color: '#07514D' }}>
                        <LiveEta etaComplete={e.etaComplete} fallbackMin={e.etaToPickupMin} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </NeoCard>

        {/* ── Coverage gap analysis (synthetic historical demo data) ── */}
        <CoverageGapsCard />
      </div>
    </div>
  )
}

// Historical-pattern insight, deliberately separate from the live metrics
// above: fetched once from its own endpoint, backed by seeded synthetic
// data rather than the live dispatch feed. Clearly labeled as such so it's
// never mistaken for a real-time number.
function CoverageGapsCard() {
  const { data, loading, refreshing, err } = useCachedApi('psiog_coverage_gaps_v1', api.getCoverageGaps)

  if (loading) return null // avoid a flash of an empty card while the very first fetch resolves
  if (err) return null // non-critical insight — fail quietly rather than disrupt the live dashboard
  if (!data || !data.zones?.length) return null

  const years = data.date_range
    ? ((new Date(data.date_range.to) - new Date(data.date_range.from)) / (365.25 * 24 * 3600 * 1000)).toFixed(1)
    : null

  return (
    <NeoCard title={`Coverage gap analysis · ${years ? `${years}yr historical` : 'historical'} (demo data)`}>
      <div className="flex items-center gap-2 mb-4 -mt-1">
        <Icon name="alert" size={13} strokeWidth={2} className="text-[#9CA3AF]" />
        <span className="text-[11px]" style={{ color: '#9CA3AF' }}>
          {data.record_count?.toLocaleString()} seeded historical records · not live dispatch data
          {refreshing && ' · refreshing…'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-5">
        <div>
          <div className="text-[11px] uppercase tracking-widest font-semibold mb-3" style={{ color: '#6B7280' }}>
            Avg response by zone · min
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.zones.map((z) => ({ name: zoneById(z.zone_id)?.name || z.zone_id, value: z.avg_eta_to_pickup_min, flagged: z.gap_ratio >= 1.4 }))}
              layout="vertical" margin={{ left: 10, right: 20 }} barCategoryGap="30%">
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis dataKey="name" type="category" width={90} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#4B5552' }} />
              <Tooltip {...TIP} formatter={(v) => [`${v} min`, 'Avg response']} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.zones.map((z, i) => <Cell key={i} fill={z.gap_ratio >= 1.4 ? '#dc2626' : RAMP[0]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest font-semibold mb-3" style={{ color: '#6B7280' }}>
            {data.coverage_gaps?.length > 0 ? `${data.coverage_gaps.length} zone${data.coverage_gaps.length > 1 ? 's' : ''} flagged` : 'No zones flagged'}
          </div>
          {data.coverage_gaps?.length > 0 ? (
            <div className="space-y-2.5">
              {data.coverage_gaps.map((g) => (
                <div key={g.zone_id} className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold" style={{ color: '#0C1322' }}>{zoneById(g.zone_id)?.name || g.zone_id}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold" style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>
                      {g.gap_ratio}x avg
                    </span>
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: '#6B7280' }}>{g.recommendation}</div>
                  <div className="flex gap-4 mt-2 text-[11px]" style={{ color: '#9CA3AF' }}>
                    <span>{g.calls.toLocaleString()} calls</span>
                    <span>{g.avg_distance_km} km avg</span>
                    <span>{g.sla_breach_pct}% SLA breach</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] py-6 text-center" style={{ color: '#6B7280' }}>
              No zone is running meaningfully hotter than the network average.
            </div>
          )}
        </div>
      </div>
    </NeoCard>
  )
}

/* ---------- metrics (unchanged data model) ---------- */
function buildMetrics(emergencies, vehicles, hospitals) {
  // Computed per refresh (not at module load) so counts stay correct past
  // midnight — in IST (this is a Jamshedpur dispatch center), not UTC. Using
  // the UTC day here attributed any dispatch between 00:00-05:29 IST to
  // "yesterday" on the dashboard.
  const TODAY = istDateKey()
  const YESTERDAY = istDateKey(new Date(Date.now() - 86400000))
  const list = emergencies
  const active = list.filter((e) => e.state === 'EN_ROUTE')
  const completed = list.filter((e) => e.state === 'COMPLETED')
  const queued = list.filter((e) => ['QUEUED', 'NO_HOSPITAL'].includes(e.state)).length
  const done = [...active, ...completed]

  const byKind = [
    { name: 'Medical', value: list.filter((e) => e.kind !== 'fire').length, color: KIND.medical },
    { name: 'Fire', value: list.filter((e) => e.kind === 'fire').length, color: KIND.fire },
  ].filter((d) => d.value > 0)

  const bySeverity = ['Critical', 'Urgent', 'Normal'].map((s) => ({
    name: s, value: list.filter((e) => e.severity === s).length, color: SEVERITY_META[s]?.color,
  }))

  const caseCounts = {}
  list.filter((e) => e.kind !== 'fire').forEach((e) => { const c = e.caseType || 'Other'; caseCounts[c] = (caseCounts[c] || 0) + 1 })
  const byCase = Object.entries(caseCounts).map(([name, value]) => ({ name, value }))

  const zoneCounts = {}
  list.forEach((e) => { const z = zoneById(locById(e.pickup)?.zone_id)?.name || 'Unknown'; zoneCounts[z] = (zoneCounts[z] || 0) + 1 })
  const byZone = ZONES.map((z) => ({ name: z.name, value: zoneCounts[z.name] || 0, color: z.color })).filter((d) => d.value > 0)

  // Pure ms-arithmetic (not Date#setDate/#getDate, which read/write the
  // *browser's local* timezone — on a machine not set to IST, mutating a
  // UTC-midnight-parsed `TODAY` with local setDate could silently land on
  // the wrong calendar day). Subtracting whole days in ms and re-deriving
  // the IST key each time is timezone-independent.
  const days = []
  for (let i = 13; i >= 0; i--) days.push(istDateKey(new Date(Date.now() - i * 86400000)))
  const overTime = days.map((day) => ({
    day: day.slice(5),
    medical: list.filter((e) => (e.createdAt || '').startsWith(day) && e.kind !== 'fire').length,
    fire: list.filter((e) => (e.createdAt || '').startsWith(day) && e.kind === 'fire').length,
  }))
  // KPI sparklines: daily totals + daily avg response over the same 14 days.
  const totalSpark = overTime.map((d) => d.medical + d.fire)
  const respSpark = days.map((day) => {
    const vals = done.filter((e) => (e.createdAt || '').startsWith(day) && e.etaToPickupMin > 0).map((e) => e.etaToPickupMin)
    return vals.length ? mean(vals) : 0
  })

  const respBySeverity = ['Critical', 'Urgent', 'Normal'].map((s) => ({
    name: s, value: +mean(done.filter((e) => e.severity === s && e.etaToPickupMin > 0).map((e) => e.etaToPickupMin)).toFixed(1),
    color: SEVERITY_META[s]?.color,
  }))

  const types = ['ambulance', 'firetruck']
  const fleetAvail = types.map((t) => {
    const f = vehicles.filter((v) => v.type === t)
    return {
      name: t === 'firetruck' ? 'Fire truck' : 'Ambulance',
      idle: f.filter((v) => v.status === 'idle').length,
      enroute: f.filter((v) => v.status === 'enroute').length,
      maintenance: f.filter((v) => v.status === 'maintenance').length,
    }
  })

  const hospCounts = {}
  list.filter((e) => e.hospitalId).forEach((e) => { const n = shortHospitalName(hospitalById(e.hospitalId)?.name || e.hospitalId); hospCounts[n] = (hospCounts[n] || 0) + 1 })
  const topHospitals = Object.entries(hospCounts).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6)

  const fleetTotal = vehicles.filter((v) => types.includes(v.type)).length
  const enroute = vehicles.filter((v) => types.includes(v.type) && v.status === 'enroute').length

  return {
    total: list.length, active: active.length, queued,
    todayCount: list.filter((e) => (e.createdAt || '').startsWith(TODAY)).length,
    yesterdayCount: list.filter((e) => (e.createdAt || '').startsWith(YESTERDAY)).length,
    avgResp: mean(done.filter((e) => e.etaToPickupMin > 0).map((e) => e.etaToPickupMin)),
    avgTrip: mean(done.filter((e) => e.totalEtaMin > 0).map((e) => e.totalEtaMin)),
    enroute, fleetTotal, utilPct: fleetTotal ? Math.round((enroute / fleetTotal) * 100) : 0,
    byKind, bySeverity, byCase, byZone, overTime, respBySeverity, fleetAvail, topHospitals,
    totalSpark, respSpark,
  }
}

/* ---------- presentational ---------- */
const CARD = {
  background: '#fff',
  borderRadius: '16px',
}

// Count from 0 to `value` once on mount; later data refreshes jump directly
// (a dashboard that re-animates every poll would be noise, not delight).
function useCountUp(value, ms = 650) {
  const [display, setDisplay] = useState(0)
  const done = useRef(false)
  useEffect(() => {
    if (typeof value !== 'number' || !isFinite(value)) { setDisplay(value); return }
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (done.current || reduced) { done.current = true; setDisplay(value); return }
    done.current = true
    const t0 = performance.now()
    let raf
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms)
      setDisplay(value * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return display
}

// Tiny inline 14-day sparkline for KPI cards.
function Spark({ data, color = '#07514D' }) {
  if (!data || data.length < 2 || data.every((v) => !v)) return null
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${26 - (v / max) * 22}`).join(' ')
  return (
    <svg viewBox="0 0 100 28" className="w-full h-6 mt-1" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,28 ${pts} 100,28`} fill={`${color}12`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function NeoKpi({ icon, label, value, sub, accentColor, format, spark, sparkColor, onClick }) {
  const animated = useCountUp(typeof value === 'number' ? value : 0)
  const shown = typeof value === 'number' ? (format ? format(animated) : Math.round(animated)) : value
  return (
    <div className={`p-5 flex flex-col gap-3 card-lift ${onClick ? 'cursor-pointer' : ''}`} style={CARD}
      onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#6B7280' }}>{label}</span>
        <div className="h-8 w-8 rounded-xl grid place-items-center"
          style={{ background: accentColor ? `${accentColor}18` : 'rgba(7,81,77,0.08)', color: accentColor || '#07514D' }}>
          <Icon name={icon} size={16} strokeWidth={1.8} />
        </div>
      </div>
      <div className="text-[32px] font-bold leading-none tracking-tight" style={{ color: '#0C1322' }}>{shown}</div>
      <div className="text-[12px] font-medium" style={{ color: accentColor || '#6B7280' }}>{sub}</div>
      <Spark data={spark} color={sparkColor || accentColor || '#07514D'} />
    </div>
  )
}
function NeoCard({ title, children, className = '' }) {
  return (
    <div className={`p-5 card-static ${className}`} style={CARD} role="figure" aria-label={title}>
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
              {data.map((d, i) => <Cell key={i} fill={d.color || RAMP[i % RAMP.length]} />)}
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
        {data.map((d, i) => (
          <span key={d.name} className="flex items-center gap-1.5 text-[12px] text-cmd-text">
            <i className="h-2 w-2 rounded-full" style={{ background: d.color || RAMP[i % RAMP.length] }} />
            {d.name} <span className="text-cmd-muted">({d.value})</span>
          </span>
        ))}
      </div>
    </>
  )
}
function Bars({ data, color, vertical, onBarClick }) {
  if (!data.length || data.every((d) => !d.value)) return <Empty />
  const barProps = onBarClick ? { onClick: (entry) => onBarClick(entry), cursor: 'pointer' } : {}
  if (vertical) {
    return (
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 12 }} barCategoryGap="30%">
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis dataKey="name" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#4B5552' }} />
          <Tooltip {...TIP} />
          <Bar dataKey="value" fill={color || RAMP[0]} {...barProps} />
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
        <Bar dataKey="value" {...barProps}>
          {data.map((d, i) => <Cell key={i} fill={d.color || color || RAMP[0]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
const Empty = ({ msg = 'No data yet.' }) => <div className="text-[13px] text-cmd-muted py-12 text-center">{msg}</div>
const Th = ({ children }) => <th className="text-left font-medium py-2">{children}</th>
