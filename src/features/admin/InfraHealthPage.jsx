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

const NEO = {
  background: '#F7F4EF',
  boxShadow: '8px 8px 20px rgba(0,0,0,0.12), -8px -8px 20px rgba(255,255,255,0.85)',
  borderRadius: '16px',
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

  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="h-full overflow-auto" style={{ background: '#F7F4EF' }}>
      {/* ── Page header ── */}
      <div className="px-7 pt-7 pb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#0C1322]">Infrastructure Health</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">CloudWatch metrics · Lambda + API Gateway</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastRefresh && <span className="text-[11px] text-[#6B7280]">Refreshed {lastRefresh.toLocaleTimeString()}</span>}
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            {RANGES.map((r, i) => (
              <button key={r.label} onClick={() => setRangeIdx(i)}
                className="px-3 h-7 rounded-lg text-[12px] font-semibold transition-all"
                style={i === rangeIdx
                  ? { background: '#07514D', color: '#fff', boxShadow: '0 2px 6px rgba(7,81,77,0.25)' }
                  : { color: '#6B7280' }}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="h-9 px-4 rounded-xl text-[12px] font-semibold flex items-center gap-2 disabled:opacity-50 transition-all"
            style={{ background: 'rgba(255,255,255,0.9)', color: '#374151', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={loading ? 'animate-spin' : ''}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="px-7 pb-8 space-y-5">
        {err && (
          <div className="rounded-2xl px-5 py-4 text-[13px]"
            style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)', color: '#dc2626' }}>
            <strong>CloudWatch error:</strong> {err}
            {(err.includes('CloudWatch') || err.includes('not configured')) && (
              <p className="mt-1 text-[12px] opacity-80">Deploy the backend with the updated <code>deploy-backend.sh</code> to enable CloudWatch access.</p>
            )}
          </div>
        )}

        {!data && !loading && !err && (
          <div className="text-[13px] text-[#6B7280] py-20 text-center">No data — deploy the backend first.</div>
        )}

        {data && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <NeoKpi label="Invocations" value={fmt(data.invocations)} sub={`last ${range.label}`} />
              <NeoKpi label="Error rate" value={`${data.error_rate_pct}%`} sub={`${fmt(data.errors)} errors`} accent={statusColor(data.error_rate_pct)} />
              <NeoKpi label="Avg duration" value={`${data.duration_avg_ms.toFixed(0)} ms`} sub="mean response" />
              <NeoKpi label="p99 duration" value={`${data.duration_p99_ms.toFixed(0)} ms`} sub="tail latency" accent={data.duration_p99_ms > 5000 ? RAMP.warn : undefined} />
              <NeoKpi label="Cold starts" value={fmt(data.cold_starts)} sub={`throttles: ${fmt(data.throttles)}`} accent={data.cold_starts > 10 ? RAMP.warn : undefined} />
            </div>

            <StatusBanner data={data} />

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <NeoCard title="Invocations over time"><MiniLine data={data.series.invocations} color={RAMP.ok} label="calls" /></NeoCard>
              <NeoCard title="Errors over time"><MiniLine data={data.series.errors} color={RAMP.error} label="errors" /></NeoCard>
              <NeoCard title="Duration (avg ms)"><MiniLine data={data.series.duration_avg} color="#7FB0AB" label="ms" /></NeoCard>
            </div>

            {/* Functions comparison — TransportApi (primary) vs VoiceAgent */}
            {data.functions?.length > 0 && (
              <NeoCard title="Functions">
                <FunctionsTable primary={data} others={data.functions} />
              </NeoCard>
            )}

            {/* Cost estimate + DynamoDB + Bedrock */}
            {(data.cost_estimate || data.dynamodb?.length > 0 || data.bedrock) && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {data.cost_estimate && (
                  <NeoCard title="Estimated monthly cost">
                    <CostEstimateCard cost={data.cost_estimate} />
                  </NeoCard>
                )}
                {data.dynamodb?.length > 0 && (
                  <NeoCard title="DynamoDB">
                    <DynamoCard tables={data.dynamodb} />
                  </NeoCard>
                )}
                {data.bedrock && (
                  <NeoCard title="Bedrock (VoiceAgent)">
                    <BedrockCard bedrock={data.bedrock} />
                  </NeoCard>
                )}
              </div>
            )}

            {/* X-Ray trace breakdown */}
            {data.trace_breakdown?.length > 0 && (
              <NeoCard title="Request time breakdown · X-Ray (last hour)">
                <TraceBreakdownCard segments={data.trace_breakdown} />
              </NeoCard>
            )}
            {!data.trace_breakdown?.length && (
              <div className="rounded-2xl px-5 py-3 text-[12px]" style={{ background: 'rgba(0,0,0,0.03)', color: '#6B7280' }}>
                No X-Ray trace data yet — run <code className="bg-white px-1 rounded">infra/enable-observability.sh</code> once
                in CloudShell to turn on Active tracing and the extra DynamoDB/Bedrock/cost metrics above.
              </div>
            )}

            {/* Error log */}
            <NeoCard title={data.recent_errors?.length > 0 ? `Recent errors · last ${Math.min(range.value, 60)} min` : 'Recent errors / warnings'}>
              {data.recent_errors?.length > 0 ? (
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {data.recent_errors.map((e, i) => (
                    <div key={i} className="flex gap-3 text-[12px] py-1.5" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      <span className="shrink-0 font-mono text-[#6B7280]">{e.timestamp.slice(11, 19)}</span>
                      <span className={`flex-1 font-mono leading-relaxed ${e.message?.includes('ERROR') ? 'text-red-600' : 'text-[#6B7280]'}`}>{e.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-[#6B7280] py-8 text-center flex items-center justify-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  No errors in the selected window.
                </div>
              )}
            </NeoCard>
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
      <div className="rounded-2xl px-5 py-3 flex items-center gap-2.5 text-[13px]"
        style={{ background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.15)', color: '#16a34a' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span className="font-semibold">All systems healthy</span>
      </div>
    )
  }
  return (
    <div className="rounded-2xl px-5 py-3 flex items-start gap-2.5 text-[13px]"
      style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.15)', color: '#d97706' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
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
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 10, fill: AXIS }} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }} />
        <Tooltip {...TIP} formatter={(v) => [v, label]} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function NeoKpi({ label, value, sub, accent }) {
  return (
    <div className="p-5" style={NEO}>
      <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-3" style={{ color: '#6B7280' }}>{label}</div>
      <div className="text-[30px] font-bold leading-none" style={{ color: accent || '#0C1322' }}>{value}</div>
      <div className="text-[12px] mt-2 font-medium" style={{ color: accent ? `${accent}99` : '#6B7280' }}>{sub}</div>
    </div>
  )
}

function NeoCard({ title, children }) {
  return (
    <div className="p-5" style={NEO}>
      <div className="text-[10.5px] uppercase tracking-widest font-semibold mb-4" style={{ color: '#6B7280' }}>{title}</div>
      {children}
    </div>
  )
}

const Empty = () => <div className="text-[13px] text-[#6B7280] py-12 text-center">No data yet.</div>
const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0)

function FunctionsTable({ primary, others }) {
  const rows = [
    { function_name: primary.function_name, invocations: primary.invocations, error_rate_pct: primary.error_rate_pct,
      duration_avg_ms: primary.duration_avg_ms, duration_p99_ms: primary.duration_p99_ms, cold_starts: primary.cold_starts },
    ...others,
  ]
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide" style={{ color: '#6B7280', borderBottom: '1px solid #E9EAEC' }}>
          <Th>Function</Th><Th>Invocations</Th><Th>Error rate</Th><Th>Avg</Th><Th>p99</Th><Th>Cold starts</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.function_name} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <td className="py-2.5 font-mono text-[12px] font-semibold text-[#0C1322]">{r.function_name}</td>
            <td>{fmt(r.invocations)}</td>
            <td style={{ color: statusColor(r.error_rate_pct) }}>{r.error_rate_pct}%</td>
            <td>{r.duration_avg_ms?.toFixed?.(0) ?? r.duration_avg_ms} ms</td>
            <td>{r.duration_p99_ms?.toFixed?.(0) ?? r.duration_p99_ms} ms</td>
            <td>{fmt(r.cold_starts)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
const Th = ({ children }) => <th className="text-left font-medium py-2">{children}</th>

function CostEstimateCard({ cost }) {
  return (
    <div>
      <div className="text-[30px] font-bold leading-none" style={{ color: '#0C1322' }}>${cost.total_est_monthly_usd?.toFixed(2)}</div>
      <div className="text-[12px] mt-1.5 font-medium" style={{ color: '#6B7280' }}>/ month, extrapolated from this window</div>
      <div className="mt-3 space-y-1.5">
        {cost.lambdas?.map((l) => (
          <div key={l.function_name} className="flex justify-between text-[12px]">
            <span className="font-mono text-[#6B7280]">{l.function_name}</span>
            <span className="font-semibold text-[#374151]">${l.est_monthly_usd?.toFixed(2)}</span>
          </div>
        ))}
        {cost.bedrock_est_monthly_usd != null && (
          <div className="flex justify-between text-[12px]">
            <span className="text-[#6B7280]">Bedrock tokens</span>
            <span className="font-semibold text-[#374151]">${cost.bedrock_est_monthly_usd.toFixed(2)}</span>
          </div>
        )}
      </div>
      <div className="text-[10.5px] mt-3" style={{ color: '#9CA3AF' }}>{cost.note}</div>
    </div>
  )
}

function DynamoCard({ tables }) {
  return (
    <div className="space-y-3">
      {tables.map((t) => {
        const throttled = (t.read_throttles || 0) + (t.write_throttles || 0) > 0
        return (
          <div key={t.table} className="pb-2.5" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-semibold text-[#0C1322]">{t.table}</span>
              {throttled && (
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>throttled</span>
              )}
            </div>
            <div className="flex gap-4 mt-1 text-[11px]" style={{ color: '#6B7280' }}>
              <span>RCU: <b style={{ color: '#374151' }}>{fmt(t.consumed_rcu)}</b></span>
              <span>WCU: <b style={{ color: '#374151' }}>{fmt(t.consumed_wcu)}</b></span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BedrockCard({ bedrock }) {
  return (
    <div className="space-y-2 text-[12px]">
      <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Model</span><span className="font-mono text-[11px] text-[#374151]">{bedrock.model_id}</span></div>
      <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Invocations</span><span className="font-semibold text-[#374151]">{fmt(bedrock.invocations)}</span></div>
      <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Input tokens</span><span className="font-semibold text-[#374151]">{fmt(bedrock.input_tokens)}</span></div>
      <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Output tokens</span><span className="font-semibold text-[#374151]">{fmt(bedrock.output_tokens)}</span></div>
      <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Avg latency</span><span className="font-semibold text-[#374151]">{bedrock.avg_latency_ms?.toFixed(0)} ms</span></div>
      {bedrock.client_errors > 0 && (
        <div className="flex justify-between"><span style={{ color: '#dc2626' }}>Client errors</span><span className="font-semibold" style={{ color: '#dc2626' }}>{fmt(bedrock.client_errors)}</span></div>
      )}
    </div>
  )
}

function TraceBreakdownCard({ segments }) {
  const max = Math.max(...segments.map((s) => s.avg_ms), 1)
  return (
    <div className="space-y-2.5">
      {segments.map((s) => (
        <div key={s.service}>
          <div className="flex justify-between text-[12px] mb-1">
            <span className="font-medium text-[#374151]">{s.service}</span>
            <span style={{ color: '#6B7280' }}>{s.avg_ms.toFixed(0)} ms · {s.samples} samples</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${(s.avg_ms / max) * 100}%`, background: RAMP.ok }} />
          </div>
        </div>
      ))}
    </div>
  )
}
