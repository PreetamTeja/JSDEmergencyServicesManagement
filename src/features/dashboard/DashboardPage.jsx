import React, { useMemo } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import { useFleetStore } from '../../store/useFleetStore'
import { locById, zoneById, ZONES } from '../../data/locations'
import { hospitalById, SEVERITY_META } from '../../data/hospitals'
import PowerBIReport from './PowerBIReport'

const TODAY = '2026-06-20'
const KIND = { medical: '#2563eb', fire: '#ea580c' }
const GREENS = ['#07514D', '#0B6A64', '#2E8B84', '#4A9B96', '#8FB920', '#D6DF27']
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

export default function DashboardPage() {
  const emergencies = useFleetStore((s) => s.emergencies)
  const vehicles = useFleetStore((s) => s.vehicles)
  const hospitals = useFleetStore((s) => s.hospitals)
  const firestations = useFleetStore((s) => s.firestations)

  const m = useMemo(() => buildMetrics(emergencies, vehicles, hospitals), [emergencies, vehicles, hospitals])

  // Secure Power BI embed (App-owns-data): authorized by the user's SSO session,
  // backend mints the embed token. No Power BI login. Preferred for production.
  if (import.meta.env.VITE_POWERBI_SECURE === 'true') return <PowerBIReport />

  // Public "Publish to web" fallback: a plain iframe (no auth, public link).
  const pbiUrl = import.meta.env.VITE_POWERBI_EMBED_URL
  if (pbiUrl) {
    return (
      <div className="h-full bg-cmd-bg">
        <iframe title="Analytics (Power BI)" src={pbiUrl}
          className="w-full h-full border-0" allowFullScreen />
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-cmd-bg">
      <div className="p-6 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <Kpi label="Total responses" value={m.total} sub={`${m.todayCount} today`} accent="#07514D" />
          <Kpi label="Active now" value={m.active} sub={`${m.queued} queued`} accent="#16a34a" />
          <Kpi label="Avg response" value={`${m.avgResp.toFixed(1)}m`} sub="to scene" accent="#0B6A64" />
          <Kpi label="Avg trip" value={`${m.avgTrip.toFixed(1)}m`} sub="end to end" accent="#4A9B96" />
          <Kpi label="Fleet in use" value={`${m.utilPct}%`} sub={`${m.enroute}/${m.fleetTotal} units`} accent="#d97706" />
        </div>

        {/* Row 1 — mix */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Responses by type">
            <Donut data={m.byKind} />
          </Card>
          <Card title="Responses by severity">
            <Bars data={m.bySeverity} />
          </Card>
          <Card title="Medical cases by type">
            <Bars data={m.byCase} color="#07514D" />
          </Card>
        </div>

        {/* Row 2 — geography + time */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Responses by zone">
            <Bars data={m.byZone} color="#0B6A64" />
          </Card>
          <Card title="Responses over time (14 days)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={m.overTime} margin={{ left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#000' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#000' }} />
                <Tooltip />
                <Line type="monotone" dataKey="medical" stroke={KIND.medical} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="fire" stroke={KIND.fire} strokeWidth={2} dot={false} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Avg response time by severity (min)">
            <Bars data={m.respBySeverity} />
          </Card>
        </div>

        {/* Row 3 — resources */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Fleet availability">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={m.fleetAvail}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#000' }} /><YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#000' }} />
                <Tooltip />
                <Bar dataKey="idle" stackId="a" fill="#64748b" />
                <Bar dataKey="enroute" stackId="a" fill="#16a34a" />
                <Bar dataKey="maintenance" stackId="a" fill="#d97706" radius={[6, 6, 0, 0]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Top receiving hospitals (dispatches)">
            <Bars data={m.topHospitals} color="#2E8B84" vertical />
          </Card>
        </div>

        {/* Active table */}
        <Card title={`Active responses (${m.active})`}>
          {m.active === 0 ? <Empty msg="No active emergencies." /> : (
            <table className="w-full text-sm">
              <thead className="text-black text-xs uppercase border-b border-slate-200">
                <tr><Th>ID</Th><Th>Type</Th><Th>Severity</Th><Th>Zone</Th><Th>Vehicle</Th><Th>Destination</Th></tr>
              </thead>
              <tbody>
                {emergencies.filter((e) => e.state === 'EN_ROUTE').map((e) => {
                  const isFire = e.kind === 'fire'
                  const veh = vehicles.find((v) => v.id === e.ambulanceId)
                  return (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="py-2 font-medium text-black">{e.id}</td>
                      <td><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: isFire ? '#fff1e8' : '#e8eefb', color: isFire ? KIND.fire : KIND.medical }}>{isFire ? 'Fire' : e.caseType || 'Medical'}</span></td>
                      <td className="text-black">{e.severity}</td>
                      <td className="text-black">{zoneById(locById(e.pickup)?.zone_id)?.name || '—'}</td>
                      <td className="font-mono text-[13px] text-black">{veh?.reg || '—'}</td>
                      <td className="text-black">{isFire ? (locById(e.pickup)?.name || '—') : (hospitalById(e.hospitalId)?.name || '—')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>

        <p className="text-[12px] text-cmd-muted">
          Measures (replicable in Power BI): <b>count</b> of emergencies by kind/severity/case/zone/date,
          <b> average</b> of response &amp; trip minutes by severity, fleet status counts, and hospital bed levels.
        </p>
      </div>
    </div>
  )
}

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

  // time series: last 14 days
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
function Kpi({ label, value, sub, accent }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-[12px] uppercase tracking-wide text-black">{label}</div>
      <div className="text-[26px] font-bold mt-1 text-black leading-tight">{value}</div>
      <div className="text-[12px]" style={{ color: accent }}>{sub}</div>
    </div>
  )
}
function Card({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-[16px] font-semibold text-black mb-2">{title}</div>
      {children}
    </div>
  )
}
function Donut({ data }) {
  if (!data.length) return <Empty />
  return (
    <>
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
            {data.map((d, i) => <Cell key={i} fill={d.color || GREENS[i % GREENS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-1">
        {data.map((d, i) => <span key={d.name} className="flex items-center gap-1 text-xs text-black"><i className="h-2.5 w-2.5 rounded-full" style={{ background: d.color || GREENS[i % GREENS.length] }} />{d.name} ({d.value})</span>)}
      </div>
    </>
  )
}
function Bars({ data, color, vertical }) {
  if (!data.length || data.every((d) => !d.value)) return <Empty />
  if (vertical) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 10, fill: '#000' }} />
          <Tooltip /><Bar dataKey="value" fill={color || '#07514D'} radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#000' }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#000' }} />
        <Tooltip />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color || color || '#07514D'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
const Empty = ({ msg = 'No data yet.' }) => <div className="text-[13px] text-black py-12 text-center">{msg}</div>
const Th = ({ children }) => <th className="text-left font-medium py-2">{children}</th>
