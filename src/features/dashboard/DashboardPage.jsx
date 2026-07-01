import React, { useMemo } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, zoneById, ZONES } from '../../data/locations'
import { hospitalById, SEVERITY_META } from '../../data/hospitals'
import PowerBIReport from './PowerBIReport'

const TODAY = new Date().toISOString().slice(0, 10)
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
  const emergencies = useFleetStore((s) => s.emergencies)
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const m = useMemo(() => buildMetrics(emergencies, vehicles, hospitals), [emergencies, vehicles, hospitals])

  // Secure Power BI embed (App-owns-data) — preferred for production.
  if (import.meta.env.VITE_POWERBI_SECURE === 'true') return <PowerBIReport />
  // Public "Publish to web" fallback (plain iframe).
  const pbiUrl = import.meta.env.VITE_POWERBI_EMBED_URL
  if (pbiUrl) {
    return (
      <div className="h-full bg-cmd-bg">
        <iframe title="Analytics (Power BI)" src={pbiUrl} className="w-full h-full border-0" allowFullScreen />
      </div>
    )
  }

  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="h-full overflow-auto" style={{ background: '#F9FAFB' }}>
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
          <NeoKpi icon="activity" label="Total responses" value={m.total} sub={`${m.todayCount} today`} />
          <NeoKpi icon="pulse" label="Active now" value={m.active} sub={`${m.queued} queued`} accentColor="#16a34a" />
          <NeoKpi icon="clock" label="Avg response" value={`${m.avgResp.toFixed(1)}m`} sub="to scene" />
          <NeoKpi icon="route" label="Avg trip" value={`${m.avgTrip.toFixed(1)}m`} sub="end to end" />
          <NeoKpi icon="truck" label="Fleet in use" value={`${m.utilPct}%`} sub={`${m.enroute}/${m.fleetTotal} units`} accentColor="#d97706" />
        </div>

        {/* ── Row 1 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <NeoCard title="Responses by type"><Donut data={m.byKind} /></NeoCard>
          <NeoCard title="Responses by severity"><Bars data={m.bySeverity} /></NeoCard>
          <NeoCard title="Medical cases by type"><Bars data={m.byCase} color={RAMP[0]} /></NeoCard>
        </div>

        {/* ── Row 2 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <NeoCard title="Responses by zone"><Bars data={m.byZone} color={RAMP[1]} /></NeoCard>
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
          {m.active === 0 ? <Empty msg="No active emergencies." /> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide" style={{ color: '#9CA3AF', borderBottom: '1px solid #E9EAEC' }}>
                  <Th>ID</Th><Th>Type</Th><Th>Severity</Th><Th>Zone</Th><Th>Vehicle</Th><Th>Destination</Th>
                </tr>
              </thead>
              <tbody>
                {emergencies.filter((e) => e.state === 'EN_ROUTE').map((e) => {
                  const isFire = e.kind === 'fire'
                  const veh = vehicles.find((v) => v.id === e.ambulanceId)
                  return (
                    <tr key={e.id} className="transition-colors" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
                      onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(7,81,77,0.03)'}
                      onMouseLeave={ev => ev.currentTarget.style.background = ''}>
                      <td className="py-2.5 font-semibold text-[#0C1322]">{e.id}</td>
                      <td><span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: isFire ? '#FEF0E6' : '#E6F0EE', color: isFire ? KIND.fire : KIND.medical }}>{isFire ? 'Fire' : e.caseType || 'Medical'}</span></td>
                      <td className="text-[#374151]">{e.severity}</td>
                      <td className="text-[#374151]">{zoneById(locById(e.pickup)?.zone_id)?.name || '—'}</td>
                      <td className="font-mono text-[12px] text-[#374151]">{veh?.reg || '—'}</td>
                      <td className="text-[#374151]">{isFire ? (locById(e.pickup)?.name || '—') : (hospitalById(e.hospitalId)?.name || '—')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </NeoCard>
      </div>
    </div>
  )
}

/* ---------- metrics (unchanged data model) ---------- */
function buildMetrics(emergencies, vehicles, hospitals) {
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

  const days = []
  for (let i = 13; i >= 0; i--) { const d = new Date(TODAY); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)) }
  const overTime = days.map((day) => ({
    day: day.slice(5),
    medical: list.filter((e) => (e.createdAt || '').startsWith(day) && e.kind !== 'fire').length,
    fire: list.filter((e) => (e.createdAt || '').startsWith(day) && e.kind === 'fire').length,
  }))

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
  list.filter((e) => e.hospitalId).forEach((e) => { const n = hospitalById(e.hospitalId)?.name || e.hospitalId; hospCounts[n] = (hospCounts[n] || 0) + 1 })
  const topHospitals = Object.entries(hospCounts).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6)

  const fleetTotal = vehicles.filter((v) => types.includes(v.type)).length
  const enroute = vehicles.filter((v) => types.includes(v.type) && v.status === 'enroute').length

  return {
    total: list.length, active: active.length, queued,
    todayCount: list.filter((e) => (e.createdAt || '').startsWith(TODAY)).length,
    avgResp: mean(done.filter((e) => e.etaToPickupMin > 0).map((e) => e.etaToPickupMin)),
    avgTrip: mean(done.filter((e) => e.totalEtaMin > 0).map((e) => e.totalEtaMin)),
    enroute, fleetTotal, utilPct: fleetTotal ? Math.round((enroute / fleetTotal) * 100) : 0,
    byKind, bySeverity, byCase, byZone, overTime, respBySeverity, fleetAvail, topHospitals,
  }
}

/* ---------- presentational ---------- */
const ICONS = {
  activity: '<path d="M3 12h4l2 6 4-14 2 8h6"/>',
  pulse: '<path d="M3 12h4l2-5 3 10 2-7h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  truck: '<path d="M3 7h11v8H3z"/><path d="M14 9h3.5l3.5 3.5V15h-7z"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
}
function Glyph({ name, className = '' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  )
}
const CARD = {
  background: '#fff',
  borderRadius: '16px',
}

function NeoKpi({ icon, label, value, sub, accentColor }) {
  return (
    <div className="p-5 flex flex-col gap-3" style={CARD}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#9CA3AF' }}>{label}</span>
        <div className="h-8 w-8 rounded-xl grid place-items-center"
          style={{ background: accentColor ? `${accentColor}18` : 'rgba(7,81,77,0.08)' }}>
          <Glyph name={icon} className="" style={{ color: accentColor || '#07514D' }} />
        </div>
      </div>
      <div className="text-[32px] font-bold leading-none tracking-tight" style={{ color: '#0C1322' }}>{value}</div>
      <div className="text-[12px] font-medium" style={{ color: accentColor || '#6B7280' }}>{sub}</div>
    </div>
  )
}
function NeoCard({ title, children, className = '' }) {
  return (
    <div className={`p-5 ${className}`} style={CARD}>
      <div className="text-[11px] uppercase tracking-widest font-semibold mb-4" style={{ color: '#9CA3AF' }}>{title}</div>
      {children}
    </div>
  )
}
function Donut({ data }) {
  if (!data.length) return <Empty />
  return (
    <>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={d.color || RAMP[i % RAMP.length]} />)}
          </Pie>
          <Tooltip {...TIP} />
        </PieChart>
      </ResponsiveContainer>
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
function Bars({ data, color, vertical }) {
  if (!data.length || data.every((d) => !d.value)) return <Empty />
  if (vertical) {
    return (
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 12 }} barCategoryGap="30%">
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis dataKey="name" type="category" width={130} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#4B5552' }} />
          <Tooltip {...TIP} />
          <Bar dataKey="value" fill={color || RAMP[0]} />
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
        <Bar dataKey="value">
          {data.map((d, i) => <Cell key={i} fill={d.color || color || RAMP[0]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
const Empty = ({ msg = 'No data yet.' }) => <div className="text-[13px] text-cmd-muted py-12 text-center">{msg}</div>
const Th = ({ children }) => <th className="text-left font-medium py-2">{children}</th>
