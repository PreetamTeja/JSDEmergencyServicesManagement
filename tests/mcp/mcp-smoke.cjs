// MCP protocol test — the jsd-cloudwatch server is a local stdio JSON-RPC
// tool, not a web UI, so browser automation (Selenium/Playwright) genuinely
// cannot exercise it. This speaks the real MCP wire protocol directly:
// spawn the server as a child process, send line-delimited JSON-RPC over
// its stdin, read responses from stdout — the same transport Claude Code
// itself uses per .mcp.json.
//
// Runs against a fake API_BASE_URL (no real AWS credentials needed) purely
// to verify the protocol handshake and tool-listing/dispatch machinery;
// tool calls are expected to fail with a network error against the fake
// host, which is itself a valid thing to assert (the server should report
// the failure as a JSON-RPC error, not crash or hang).
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const SERVER_PATH = path.join(__dirname, '..', '..', 'infra', 'mcp', 'cloudwatch-server.mjs')
const results = []

function check(name, ok, detail) {
  results.push({ name, status: ok ? 'passed' : 'failed', duration_ms: 0, error: ok ? undefined : detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
}

async function main() {
  if (!fs.existsSync(SERVER_PATH)) {
    check('MCP server file exists', false, `not found at ${SERVER_PATH}`)
    writeResults()
    process.exit(1)
  }

  const child = spawn('node', [SERVER_PATH], {
    env: { ...process.env, API_BASE_URL: 'https://fake-api.example.invalid', MCP_API_KEY: 'fake-test-key' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const pending = new Map()
  let buf = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        const resolver = pending.get(msg.id)
        if (resolver) { pending.delete(msg.id); resolver(msg) }
      } catch {}
    }
  })

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9)
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('timeout waiting for response')) }, 5000)
      pending.set(id, (msg) => { clearTimeout(timeout); resolve(msg) })
      child.stdin.write(rpc(id, method, params))
    })
  }

  try {
    // 1) initialize handshake
    const initRes = await send('initialize', { protocolVersion: '2024-11-05' })
    check('initialize handshake returns serverInfo', !!initRes.result?.serverInfo?.name, JSON.stringify(initRes))

    // 2) tools/list — all 5 documented tools present
    const listRes = await send('tools/list', {})
    const toolNames = (listRes.result?.tools || []).map((t) => t.name)
    const expected = ['get_lambda_metrics', 'get_recent_errors', 'query_logs', 'get_infra_summary', 'get_infra_metrics']
    const missing = expected.filter((t) => !toolNames.includes(t))
    check('tools/list exposes all 5 documented tools', missing.length === 0, `missing: ${missing.join(', ') || 'none'}`)

    // 3) tools/call for each tool — against a fake host these should fail
    // gracefully (network error surfaced as a JSON-RPC error), not hang or crash.
    for (const name of expected) {
      const args = name === 'query_logs' ? { pattern: 'ERROR' } : {}
      const callRes = await send('tools/call', { name, arguments: args })
      const handledGracefully = !!callRes.error || !!callRes.result
      check(`tools/call "${name}" responds (error or result, not a hang)`, handledGracefully,
        callRes.error ? `error: ${callRes.error.message}` : 'ok')
    }

    // 4) unknown method returns a proper JSON-RPC error, doesn't crash the process
    const unknownRes = await send('not/a/real/method', {})
    check('unknown method returns JSON-RPC error -32601', unknownRes.error?.code === -32601, JSON.stringify(unknownRes))

    // 5) server process is still alive after all of the above
    check('server process still running after all calls', child.exitCode === null && !child.killed)
  } catch (e) {
    check('MCP protocol exchange completed without throwing', false, e.message)
  } finally {
    child.kill()
  }

  writeResults()
  const failed = results.filter((r) => r.status === 'failed').length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed > 0 ? 1 : 0)
}

function writeResults() {
  const outDir = path.join(__dirname, '..', 'reports')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'mcp-results.json'), JSON.stringify({ results, generated_at: new Date().toISOString() }, null, 2))
}

main().catch((e) => { console.error('MCP TEST RUNNER FAILED:', e); process.exit(1) })
