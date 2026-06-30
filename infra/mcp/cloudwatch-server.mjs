#!/usr/bin/env node
/* =====================================================================
   JSD TATA Emergency Services — CloudWatch MCP Server
   Exposes AWS CloudWatch metrics + logs as MCP tools so any MCP client
   (Claude Desktop, Claude Code, etc.) can query infra health directly.

   Run locally (needs AWS creds):
     AWS_REGION=eu-west-1 node infra/mcp/cloudwatch-server.mjs

   Or mount in Claude Code .mcp.json (see infra/mcp/README.md).
   ===================================================================== */
import { createServer } from 'node:http'
import { CloudWatchClient, GetMetricDataCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import { CloudWatchLogsClient, FilterLogEventsCommand, StartQueryCommand, GetQueryResultsCommand } from '@aws-sdk/client-cloudwatch-logs'

const REGION = process.env.AWS_REGION || 'eu-west-1'
const FN_NAME = process.env.LAMBDA_FUNCTION_NAME || 'psiog-transport-api'
const VOICE_FN = process.env.VOICE_FUNCTION_NAME || 'psiog-voice-agent'
const API_ID = process.env.API_GATEWAY_ID || ''

const cw = new CloudWatchClient({ region: REGION })
const cwl = new CloudWatchLogsClient({ region: REGION })

/* ---------- helpers ---------- */
const minsAgo = (m) => new Date(Date.now() - m * 60_000)
const nowDate = () => new Date()

async function getLambdaMetrics(fnName, periodMin = 60, rangeMin = 1440) {
  const end = nowDate()
  const start = minsAgo(rangeMin)
  const period = periodMin * 60

  const queries = [
    { Id: 'invocations', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'Sum' } },
    { Id: 'errors', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'Sum' } },
    { Id: 'throttles', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Throttles', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'Sum' } },
    { Id: 'duration_avg', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'Average' } },
    { Id: 'duration_p99', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'p99' } },
    { Id: 'cold_starts', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'InitDuration', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'SampleCount' } },
    { Id: 'concurrent', MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: 'ConcurrentExecutions', Dimensions: [{ Name: 'FunctionName', Value: fnName }] }, Period: period, Stat: 'Maximum' } },
  ]

  const r = await cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: start, EndTime: end }))
  const byId = Object.fromEntries((r.MetricDataResults || []).map((m) => [m.Id, m]))

  const sum = (id) => (byId[id]?.Values || []).reduce((a, v) => a + v, 0)
  const avg = (id) => { const vs = byId[id]?.Values || []; return vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : 0 }
  const max = (id) => Math.max(0, ...(byId[id]?.Values || [0]))
  const series = (id) => (byId[id]?.Timestamps || []).map((t, i) => ({ t: new Date(t).toISOString(), v: +(byId[id].Values[i] || 0).toFixed(2) })).sort((a, b) => a.t.localeCompare(b.t))

  const invocations = sum('invocations')
  const errors = sum('errors')
  return {
    function_name: fnName,
    range_min: rangeMin,
    period_min: periodMin,
    invocations,
    errors,
    error_rate_pct: invocations > 0 ? +((errors / invocations) * 100).toFixed(2) : 0,
    throttles: sum('throttles'),
    duration_avg_ms: +avg('duration_avg').toFixed(1),
    duration_p99_ms: +avg('duration_p99').toFixed(1),
    cold_starts: sum('cold_starts'),
    max_concurrent: max('concurrent'),
    series: {
      invocations: series('invocations'),
      errors: series('errors'),
      duration_avg: series('duration_avg'),
    },
  }
}

async function getApiMetrics(apiId, periodMin = 60, rangeMin = 1440) {
  if (!apiId) return { error: 'API_GATEWAY_ID not configured' }
  const end = nowDate()
  const start = minsAgo(rangeMin)
  const period = periodMin * 60

  const queries = [
    { Id: 'count', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: [{ Name: 'ApiId', Value: apiId }] }, Period: period, Stat: 'Sum' } },
    { Id: 'err4xx', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: '4XXError', Dimensions: [{ Name: 'ApiId', Value: apiId }] }, Period: period, Stat: 'Sum' } },
    { Id: 'err5xx', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: '5XXError', Dimensions: [{ Name: 'ApiId', Value: apiId }] }, Period: period, Stat: 'Sum' } },
    { Id: 'latency', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Latency', Dimensions: [{ Name: 'ApiId', Value: apiId }] }, Period: period, Stat: 'Average' } },
    { Id: 'latency_p99', MetricStat: { Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Latency', Dimensions: [{ Name: 'ApiId', Value: apiId }] }, Period: period, Stat: 'p99' } },
  ]

  const r = await cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: start, EndTime: end }))
  const byId = Object.fromEntries((r.MetricDataResults || []).map((m) => [m.Id, m]))
  const sum = (id) => (byId[id]?.Values || []).reduce((a, v) => a + v, 0)
  const avg = (id) => { const vs = byId[id]?.Values || []; return vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : 0 }

  const count = sum('count')
  const err4 = sum('err4xx')
  const err5 = sum('err5xx')
  return {
    api_id: apiId,
    range_min: rangeMin,
    requests: count,
    errors_4xx: err4,
    errors_5xx: err5,
    error_rate_pct: count > 0 ? +(((err4 + err5) / count) * 100).toFixed(2) : 0,
    latency_avg_ms: +avg('latency').toFixed(1),
    latency_p99_ms: +avg('latency_p99').toFixed(1),
  }
}

async function getRecentErrors(fnName, limitMin = 60, maxEvents = 20) {
  const logGroup = `/aws/lambda/${fnName}`
  try {
    const r = await cwl.send(new FilterLogEventsCommand({
      logGroupName: logGroup,
      startTime: Date.now() - limitMin * 60_000,
      filterPattern: '?ERROR ?Error ?error ?WARN',
      limit: maxEvents,
    }))
    return (r.events || []).map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      message: (e.message || '').trim().slice(0, 500),
    }))
  } catch (e) {
    return [{ error: e.message }]
  }
}

async function runLogsInsight(fnName, query, rangeMin = 60) {
  const logGroup = `/aws/lambda/${fnName}`
  try {
    const start = await cwl.send(new StartQueryCommand({
      logGroupName: logGroup,
      startTime: Math.floor((Date.now() - rangeMin * 60_000) / 1000),
      endTime: Math.floor(Date.now() / 1000),
      queryString: query,
      limit: 50,
    }))
    // Poll until complete (max 15s)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const res = await cwl.send(new GetQueryResultsCommand({ queryId: start.queryId }))
      if (res.status === 'Complete') {
        return (res.results || []).map((row) => Object.fromEntries(row.map((f) => [f.field, f.value])))
      }
    }
    return [{ error: 'query timed out' }]
  } catch (e) {
    return [{ error: e.message }]
  }
}

/* ---------- MCP protocol (JSON-RPC 2.0 over HTTP, stdio, or SSE) ----------
   This implements the subset needed for Claude Code / Claude Desktop:
   - initialize
   - tools/list
   - tools/call
   Uses HTTP transport (single endpoint POST /) so it can be run standalone or
   mounted as a sidecar. Claude Code uses stdio; for stdio support use the
   --stdio flag (reads from stdin, writes to stdout). */

const TOOLS = [
  {
    name: 'get_lambda_metrics',
    description: 'Get invocation count, error rate, duration (avg + p99), throttles, cold starts, and concurrent executions for a Lambda function from CloudWatch. Defaults to the main API function.',
    inputSchema: {
      type: 'object',
      properties: {
        function_name: { type: 'string', description: 'Lambda function name. Defaults to psiog-transport-api.' },
        period_min: { type: 'number', description: 'Aggregation period in minutes. Default 60.' },
        range_min: { type: 'number', description: 'How far back to look in minutes. Default 1440 (24h).' },
      },
    },
  },
  {
    name: 'get_api_metrics',
    description: 'Get API Gateway request count, 4xx/5xx error rates, and latency (avg + p99) for the emergency services HTTP API.',
    inputSchema: {
      type: 'object',
      properties: {
        period_min: { type: 'number', description: 'Aggregation period in minutes. Default 60.' },
        range_min: { type: 'number', description: 'How far back to look in minutes. Default 1440 (24h).' },
      },
    },
  },
  {
    name: 'get_recent_errors',
    description: 'Fetch recent ERROR/WARN log events from a Lambda function\'s CloudWatch log group.',
    inputSchema: {
      type: 'object',
      properties: {
        function_name: { type: 'string', description: 'Lambda function name. Defaults to psiog-transport-api.' },
        limit_min: { type: 'number', description: 'How far back to look in minutes. Default 60.' },
        max_events: { type: 'number', description: 'Max log events to return. Default 20.' },
      },
    },
  },
  {
    name: 'query_logs',
    description: 'Run a CloudWatch Logs Insights query against a Lambda function\'s log group. Use standard Logs Insights syntax.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        function_name: { type: 'string', description: 'Lambda function name. Defaults to psiog-transport-api.' },
        query: { type: 'string', description: 'CloudWatch Logs Insights query string. E.g. "fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20"' },
        range_min: { type: 'number', description: 'How far back to query in minutes. Default 60.' },
      },
    },
  },
  {
    name: 'get_infra_summary',
    description: 'Get a combined health summary of all JSD Emergency Services Lambda functions and the API Gateway — useful for a quick status check.',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function callTool(name, args) {
  switch (name) {
    case 'get_lambda_metrics':
      return getLambdaMetrics(args.function_name || FN_NAME, args.period_min || 60, args.range_min || 1440)
    case 'get_api_metrics':
      return getApiMetrics(API_ID, args.period_min || 60, args.range_min || 1440)
    case 'get_recent_errors':
      return getRecentErrors(args.function_name || FN_NAME, args.limit_min || 60, args.max_events || 20)
    case 'query_logs':
      return runLogsInsight(args.function_name || FN_NAME, args.query, args.range_min || 60)
    case 'get_infra_summary': {
      const [main, voice, api] = await Promise.all([
        getLambdaMetrics(FN_NAME, 60, 60).catch((e) => ({ error: e.message })),
        getLambdaMetrics(VOICE_FN, 60, 60).catch((e) => ({ error: e.message })),
        getApiMetrics(API_ID, 60, 60).catch((e) => ({ error: e.message })),
      ])
      return { main_api: main, voice_agent: voice, api_gateway: api, generated_at: new Date().toISOString() }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function mcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result }
}
function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleRpc(req) {
  const { method, id, params } = req
  if (method === 'initialize') {
    return mcpResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'jsd-cloudwatch-mcp', version: '1.0.0' },
    })
  }
  if (method === 'tools/list') {
    return mcpResponse(id, { tools: TOOLS })
  }
  if (method === 'tools/call') {
    try {
      const result = await callTool(params?.name, params?.arguments || {})
      return mcpResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
    } catch (e) {
      return mcpError(id, -32000, e.message)
    }
  }
  return mcpError(id, -32601, `Method not found: ${method}`)
}

/* ---------- transport: stdio (for Claude Code) or HTTP ---------- */
const useStdio = process.argv.includes('--stdio')

if (useStdio) {
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
        const req = JSON.parse(trimmed)
        const res = await handleRpc(req)
        process.stdout.write(JSON.stringify(res) + '\n')
      } catch {}
    }
  })
  process.stderr.write(`[jsd-cloudwatch-mcp] stdio mode, region=${REGION}, fn=${FN_NAME}\n`)
} else {
  const PORT = Number(process.env.PORT || 3099)
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', async () => {
      try {
        const rpc = JSON.parse(body)
        const result = await handleRpc(rpc)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify(mcpError(null, -32700, 'Parse error')))
      }
    })
  })
  server.listen(PORT, () => {
    console.log(`[jsd-cloudwatch-mcp] HTTP on :${PORT}  region=${REGION}  fn=${FN_NAME}`)
    if (!API_ID) console.warn('[jsd-cloudwatch-mcp] API_GATEWAY_ID not set — API Gateway metrics will be skipped')
  })
}
