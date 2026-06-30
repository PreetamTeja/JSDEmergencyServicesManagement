import React, { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '../../services/api'

const RANGES = [
  { label: '1 h', value: 60, period: 5 },
  { label: '6 h', value: 360, period: 30 },
  { label: '24 h', value: 1440, period: 60 },
  { label: '7 d', value: 10080, period: 720 },
]

const RAMP = { ok: '#0B6A64', warn: '#d97706', error: '#dc2626', muted: '#CBD5D3' }
const AXIS = '#9AA3A1'
const GRID = '#EEF1F0'
const TIP = {
  contentStyle: { border: '1px solid #E5E9E8', borderRadius: 0, fontSize: 11, boxShadow: 'none', padding: '5px 9px' },
  labelStyle: { color: '#161616', fontWeight: 600 },
}

function statusColor(errorRatePct) {
  if (errorRatePct >= 5) return RAMP.error
  if (errorRatePct >= 1) return RAMP.warn
  return RAMP.ok
}

export default function InfraHealthPage() {
  const [rangeIdx, setRangeIdx] = useState(2) // default 24h
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const range = RANGES[rangeIdx]

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const d = await api.getInfraMetrics({ range_min: range.value, period_min: range.period })
      setData(d)
      setLastRefresh(new Date())
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [range.value, range.period])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="h-full overflow-auto bg-cmd-bg">
      <div className="px-6 pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-cmd-text">Infrastructure Health</h1>
          <p className="text-[13px] text-cmd-muted">CloudWatch metrics · Lambda + API Gateway</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-[11px] text-cmd-muted">Refreshed {lastRefresh.toLocaleTimeString()}</span>}
          <div className="flex border border-cmd-border bg-white">
            {RANGES.map((r, i) => (
              <button key={r.label} onClick={() => setRangeIdx(i)}
                className={`px-3 h-8 text-[12px] font-medium transition-colors ${i === rangeIdx ? 'bg-accent text-white' : 'text-cmd-muted hover:text-cmd-text'}`}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="h-8 px-3 border border-cmd-border bg-white text-[12px] text-cmd-muted hover:text-cmd-text flex items-center gap-1.5 disabled:opacity-50">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={loading ? 'animate-spin' : ''}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="px-6 pb-8 space-y-4">
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] p-4">
            <strong>CloudWatch error:</strong> {err}
            {err.includes('CloudWatch') || err.includes('not configured') ? (
              <p className="mt-1 text-[12px]">Deploy the backend with the updated <code>deploy-backend.sh</code> to enable CloudWatch access.</p>
            ) : null}
          </div>
        )}

        {!data && !loading && !err && (
          <div className="text-[13px] text-cmd-muted py-20 text-center">No data — deploy the backend first.</div>
        )}

        {data && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-5 border border-cmd-border bg-white divide-x divide-cmd-border">
              <Kpi label="Invocations" value={fmt(data.invocations)} sub={`last ${range.label}`} />
              <Kpi label="Error rate" value={`${data.error_rate_pct}%`} sub={`${fmt(data.errors)} errors`}
                accent={statusColor(data.error_rate_pct)} />
              <Kpi label="Avg duration" value={`${data.duration_avg_ms.toFixed(0)} ms`} sub="mean response" />
              <Kpi label="p99 duration" value={`${data.duration_p99_ms.toFixed(0)} ms`} sub="tail latency"
                accent={data.duration_p99_ms > 5000 ? RAMP.warn : undefined} />
              <Kpi label="Cold starts" value={fmt(data.cold_starts)} sub={`throttles: ${fmt(data.throttles)}`}
                accent={data.cold_starts > 10 ? RAMP.warn : undefined} />
            </div>

            {/* Status badge */}
            <StatusBanner data={data} />

            {/* Charts row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title="Invocations over time">
                <MiniLine data={data.series.invocations} color={RAMP.ok} label="calls" />
              </Card>
              <Card title="Errors over time">
                <MiniLine data={data.series.errors} color={RAMP.error} label="errors" />
              </Card>
              <Card title="Duration (avg ms) over time">
                <MiniLine data={data.series.duration_avg} color="#7FB0AB" label="ms" />
              </Card>
            </div>

            {/* Error log */}
            {data.recent_errors?.length > 0 && (
              <Card title={`Recent errors / warnings · last ${Math.min(range.value, 60)} min`}>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {data.recent_errors.map((e, i) => (
                    <div key={i} className="flex gap-3 text-[12px] border-b border-cmd-border/50 py-1.5">
                      <span className="text-cmd-muted shrink-0 font-mono">{e.timestamp.slice(11, 19)}</span>
                      <span className={`flex-1 font-mono leading-relaxed ${e.message?.includes('ERROR') ? 'text-red-600' : 'text-cmd-muted'}`}>
                        {e.message}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {data.recent_errors?.length === 0 && (
              <Card title="Recent errors / warnings">
                <div className="text-[13px] text-cmd-muted py-8 text-center flex items-center justify-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  No errors in the selected window.
                </div>
              </Card>
            )}

            {/* MCP hint */}
            <div className="border border-cmd-border bg-white p-4 flex gap-3 items-start">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={RAMP.ok} strokeWidth="2" className="mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
              </svg>
              <div>
                <div className="text-[13px] font-medium text-cmd-text">Query with Claude Code (MCP)</div>
                <p className="text-[12px] text-cmd-muted mt-0.5">
                  The CloudWatch MCP server at <code className="bg-cmd-panel2 px-1">infra/mcp/cloudwatch-server.mjs</code> is
                  registered in <code className="bg-cmd-panel2 px-1">.mcp.json</code>. Use tools like{' '}
                  <code className="bg-cmd-panel2 px-1">get_infra_summary</code>,{' '}
                  <code className="bg-cmd-panel2 px-1">get_recent_errors</code>, and{' '}
                  <code className="bg-cmd-panel2 px-1">query_logs</code> directly in Claude Code.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatusBanner({ data }) {
  const { error_rate_pct, throttles, duration_p99_ms, cold_starts } = data
  const issues = []
  if (error_rate_pct >= 5) issues.push(`High error rate: ${error_rate_pct}%`)
  if (throttles > 0) issues.push(`${throttles} throttle${throttles > 1 ? 's' : ''}`)
  if (duration_p99_ms > 8000) issues.push(`p99 latency ${duration_p99_ms.toFixed(0)} ms`)
  if (cold_starts > 20) issues.push(`${cold_starts} cold starts`)

  if (!issues.length) {
    return (
      <div className="border border-green-200 bg-green-50 px-4 py-2.5 flex items-center gap-2 text-[13px] text-green-700">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        All systems healthy
      </div>
    )
  }
  return (
    <div className="border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-start gap-2 text-[13px] text-amber-800">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span><strong>Attention:</strong> {issues.join(' · ')}</span>
    </div>
  )
}

function MiniLine({ data, color, label }) {
  if (!data?.length) return <Empty />
  const formatted = data.map((d) => ({ ...d, label: d.t.slice(11, 16) }))
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={formatted} margin={{ left: -20, top: 6, right: 6 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 10, fill: AXIS }}
          interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }} />
        <Tooltip {...TIP} formatter={(v) => [v, label]} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-cmd-muted">{label}</div>
      <div className="text-[28px] font-semibold mt-1 text-cmd-text leading-none" style={accent ? { color: accent } : {}}>{value}</div>
      <div className="text-[12px] mt-1.5 text-cmd-muted">{sub}</div>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="bg-white border border-cmd-border p-4">
      <div className="text-[12px] uppercase tracking-wide font-semibold text-cmd-muted mb-3">{title}</div>
      {children}
    </div>
  )
}

const Empty = () => <div className="text-[13px] text-cmd-muted py-12 text-center">No data yet.</div>
const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0)
