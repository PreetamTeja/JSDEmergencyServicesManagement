#!/usr/bin/env node
/* =====================================================================
   JSD TATA Emergency Services — CloudWatch MCP Server
   Proxies through the backend /infra/metrics endpoint using a Cognito
   bearer token. No AWS credentials required on the developer machine.

   Register in .mcp.json with:
     "env": {
       "API_BASE_URL": "https://<your-api-gateway>.execute-api.eu-west-1.amazonaws.com",
       "API_TOKEN": "<your-cognito-sso-access-token>"
     }
   ===================================================================== */

const API_BASE = (process.env.API_BASE_URL || '').replace(/\/$/, '')
const API_KEY = process.env.MCP_API_KEY || ''

if (!API_BASE) process.stderr.write('[jsd-mcp] WARNING: API_BASE_URL not set — all tool calls will fail\n')
if (!API_KEY) process.stderr.write('[jsd-mcp] WARNING: MCP_API_KEY not set — all tool calls will return 403\n')

/* ---------- fetch helper ---------- */
async function apiFetch(path) {
  if (!API_BASE) throw new Error('API_BASE_URL is not configured in .mcp.json env')
  if (!API_KEY) throw new Error('MCP_API_KEY is not set — add it to .mcp.json env')

  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
  })
  if (res.status === 401) throw new Error('401 Unauthorised — MCP_API_KEY is invalid')
  if (res.status === 403) throw new Error('403 Forbidden — MCP_API_KEY does not have MCP scope')
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const b = await res.json(); msg = b.message || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

/* ---------- tool implementations ---------- */
async function getInfraMetrics(rangeMin = 1440, periodMin = 60) {
  return apiFetch(`/infra/metrics?range_min=${rangeMin}&period_min=${periodMin}`)
}

async function getRecentErrors(limitMin = 60) {
  const data = await apiFetch(`/infra/metrics?range_min=${limitMin}&period_min=${limitMin}`)
  return {
    window_min: limitMin,
    errors: data.recent_errors || [],
    error_count: (data.recent_errors || []).length,
  }
}

async function getLambdaMetrics(rangeMin = 1440, periodMin = 60) {
  const data = await apiFetch(`/infra/metrics?range_min=${rangeMin}&period_min=${periodMin}`)
  return {
    function_name: data.function_name,
    range_min: data.range_min,
    period_min: data.period_min,
    invocations: data.invocations,
    errors: data.errors,
    error_rate_pct: data.error_rate_pct,
    throttles: data.throttles,
    duration_avg_ms: data.duration_avg_ms,
    duration_p99_ms: data.duration_p99_ms,
    cold_starts: data.cold_starts,
    series: data.series,
  }
}

async function getInfraSummary() {
  const data = await apiFetch('/infra/metrics?range_min=60&period_min=60')
  const issues = []
  if (data.error_rate_pct >= 5) issues.push(`High error rate: ${data.error_rate_pct}%`)
  if (data.throttles > 0) issues.push(`${data.throttles} throttle(s)`)
  if (data.duration_p99_ms > 8000) issues.push(`p99 latency ${data.duration_p99_ms}ms`)
  if (data.cold_starts > 20) issues.push(`${data.cold_starts} cold starts`)
  return {
    status: issues.length === 0 ? 'healthy' : 'degraded',
    issues,
    invocations_1h: data.invocations,
    error_rate_pct: data.error_rate_pct,
    duration_avg_ms: data.duration_avg_ms,
    duration_p99_ms: data.duration_p99_ms,
    cold_starts: data.cold_starts,
    recent_error_count: (data.recent_errors || []).length,
    generated_at: new Date().toISOString(),
  }
}

async function queryLogs(pattern, limitMin = 60) {
  const data = await apiFetch(`/infra/metrics?range_min=${limitMin}&period_min=${limitMin}`)
  const all = data.recent_errors || []
  const lower = pattern.toLowerCase()
  const matched = all.filter((e) => (e.message || '').toLowerCase().includes(lower))
  return {
    pattern,
    window_min: limitMin,
    matched: matched.length,
    results: matched,
  }
}

/* ---------- MCP tool definitions ---------- */
const TOOLS = [
  {
    name: 'get_lambda_metrics',
    description: 'Get invocation count, error rate, duration (avg + p99), throttles, and cold starts for the JSD transport API Lambda. Proxies through the backend — no AWS credentials needed.',
    inputSchema: {
      type: 'object',
      properties: {
        range_min: { type: 'number', description: 'How far back in minutes. Default 1440 (24h).' },
        period_min: { type: 'number', description: 'Aggregation bucket in minutes. Default 60.' },
      },
    },
  },
  {
    name: 'get_recent_errors',
    description: 'Fetch recent ERROR/WARN log lines from the Lambda CloudWatch log group.',
    inputSchema: {
      type: 'object',
      properties: {
        limit_min: { type: 'number', description: 'How far back to look in minutes. Default 60.' },
      },
    },
  },
  {
    name: 'query_logs',
    description: 'Filter recent log events by a keyword or substring pattern.',
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Keyword to search for in log messages (case-insensitive).' },
        range_min: { type: 'number', description: 'How far back in minutes. Default 60.' },
      },
    },
  },
  {
    name: 'get_infra_summary',
    description: 'Quick health check: returns status (healthy/degraded), active issues, and key metrics for the last hour.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_infra_metrics',
    description: 'Full raw metrics payload from /infra/metrics — same data as the Infra Health dashboard.',
    inputSchema: {
      type: 'object',
      properties: {
        range_min: { type: 'number', description: 'How far back in minutes. Default 1440 (24h).' },
        period_min: { type: 'number', description: 'Aggregation bucket in minutes. Default 60.' },
      },
    },
  },
]

/* ---------- MCP JSON-RPC 2.0 ---------- */
function ok(id, result) {
  return { jsonrpc: '2.0', id, result }
}
function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'get_lambda_metrics':
      return getLambdaMetrics(args.range_min || 1440, args.period_min || 60)
    case 'get_recent_errors':
      return getRecentErrors(args.limit_min || 60)
    case 'query_logs':
      return queryLogs(args.pattern, args.range_min || 60)
    case 'get_infra_summary':
      return getInfraSummary()
    case 'get_infra_metrics':
      return getInfraMetrics(args.range_min || 1440, args.period_min || 60)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

async function handleRpc(rpc) {
  const { method, id, params } = rpc
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'jsd-cloudwatch-mcp', version: '2.0.0' },
    })
  }
  if (method === 'notifications/initialized') return null
  if (method === 'tools/list') {
    return ok(id, { tools: TOOLS })
  }
  if (method === 'tools/call') {
    try {
      const result = await callTool(params?.name, params?.arguments || {})
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
    } catch (e) {
      return err(id, -32000, e.message)
    }
  }
  return err(id, -32601, `Method not found: ${method}`)
}

/* ---------- stdio transport (Claude Code) ---------- */
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buf += chunk
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rpc = JSON.parse(trimmed)
      const res = await handleRpc(rpc)
      if (res !== null) process.stdout.write(JSON.stringify(res) + '\n')
    } catch {}
  }
})
process.stderr.write(`[jsd-mcp] ready  api=${API_BASE || '(not set)'}\n`)
