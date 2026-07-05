// Renders one of the three normalized test-result JSON files into a
// standalone PDF report, using the same headless-print approach as the
// project's other generated reports (playwright-core + Edge, no extra
// PDF library dependency).
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const CONFIGS = {
  playwright: {
    resultsFile: 'playwright-results-normalized.json',
    title: 'Playwright E2E Test Report',
    subtitle: 'Golden-path browser automation — @playwright/test driving Microsoft Edge',
    tool: '@playwright/test v1.61.1 · channel: msedge · mocked /fleet + /ops via page.route',
    outFile: 'JSD-Playwright-Test-Report.pdf',
    favicon: '🎭',
  },
  selenium: {
    resultsFile: 'selenium-results.json',
    title: 'Selenium WebDriver Test Report',
    subtitle: 'Golden-path browser automation — selenium-webdriver driving Microsoft Edge via W3C WebDriver',
    tool: 'selenium-webdriver v4.45.0 · msedgedriver (Selenium Manager) · mocked /fleet + /ops via Chrome DevTools Protocol (Fetch domain)',
    outFile: 'JSD-Selenium-Test-Report.pdf',
    favicon: '🧪',
  },
  smoke: {
    resultsFile: 'smoke-results.json',
    title: 'Smoke Test Report',
    subtitle: 'Fast critical-path health checks — real backend liveness + frontend render checks',
    tool: 'playwright-core (frontend checks) + native fetch (real, unmocked backend calls)',
    outFile: 'JSD-Smoke-Test-Report.pdf',
    favicon: '🔥',
  },
  mcp: {
    resultsFile: 'mcp-results.json',
    title: 'MCP Protocol Test Report',
    subtitle: 'Direct JSON-RPC protocol testing of the jsd-cloudwatch MCP server — not browser automation',
    tool: 'Node child_process + line-delimited JSON-RPC over stdio (the same transport Claude Code itself uses)',
    outFile: 'JSD-MCP-Test-Report.pdf',
    favicon: '🔌',
  },
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function buildHtml(cfg, data) {
  const { results, generated_at } = data
  const passed = results.filter((r) => r.status === 'passed').length
  const failed = results.length - passed
  const totalMs = results.reduce((s, r) => s + (r.duration_ms || 0), 0)
  const passRate = results.length ? Math.round((passed / results.length) * 100) : 0
  const statusColor = failed === 0 ? '#16a34a' : '#dc2626'
  const statusLabel = failed === 0 ? 'ALL PASSED' : `${failed} FAILED`

  const rows = results.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td style="text-align:center;">
        <span class="badge ${r.status === 'passed' ? 'badge-pass' : 'badge-fail'}">${r.status.toUpperCase()}</span>
      </td>
      <td style="text-align:right;">${(r.duration_ms / 1000).toFixed(2)}s</td>
      <td style="color:#dc2626; font-size:8.5pt;">${r.error ? escapeHtml(r.error) : ''}</td>
    </tr>`).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(cfg.title)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; color: #1a1f1e; font-size: 10.5pt; line-height: 1.5; }
  h1 { font-size: 22pt; color: #07514D; margin: 0 0 4px; }
  .subtitle { color: #6B7280; font-size: 11.5pt; margin-bottom: 4px; }
  .tool { color: #9CA3AF; font-size: 9pt; font-family: Consolas, monospace; margin-bottom: 22px; }
  .summary { display: flex; gap: 14px; margin-bottom: 24px; }
  .stat { flex: 1; background: #F7F4EF; border-radius: 10px; padding: 14px 16px; text-align: center; }
  .stat .n { font-size: 22pt; font-weight: 700; color: #0C1322; }
  .stat .l { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6B7280; margin-top: 2px; }
  .status-banner { background: ${statusColor}18; color: ${statusColor}; border: 1px solid ${statusColor}40; border-radius: 8px; padding: 10px 16px; font-weight: 700; font-size: 12pt; text-align: center; margin-bottom: 22px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.3pt; }
  th { background: #07514D; color: #fff; text-align: left; padding: 7px 9px; font-weight: 600; }
  td { padding: 6px 9px; border-bottom: 1px solid #E5E9E8; vertical-align: top; }
  tr:nth-child(even) td { background: #FAFBFB; }
  .badge { display: inline-block; font-size: 7.6pt; font-weight: 700; padding: 2px 8px; border-radius: 10px; letter-spacing: 0.03em; }
  .badge-pass { background: #DCFCE7; color: #16a34a; }
  .badge-fail { background: #FEE2E2; color: #dc2626; }
  footer { margin-top: 24px; font-size: 8pt; color: #9CA3AF; text-align: center; }
</style></head>
<body>
  <h1>${escapeHtml(cfg.title)}</h1>
  <div class="subtitle">${escapeHtml(cfg.subtitle)}</div>
  <div class="tool">${escapeHtml(cfg.tool)}</div>

  <div class="status-banner">${statusLabel}</div>

  <div class="summary">
    <div class="stat"><div class="n">${results.length}</div><div class="l">Total tests</div></div>
    <div class="stat"><div class="n" style="color:#16a34a;">${passed}</div><div class="l">Passed</div></div>
    <div class="stat"><div class="n" style="color:${failed ? '#dc2626' : '#0C1322'};">${failed}</div><div class="l">Failed</div></div>
    <div class="stat"><div class="n">${passRate}%</div><div class="l">Pass rate</div></div>
    <div class="stat"><div class="n">${(totalMs / 1000).toFixed(1)}s</div><div class="l">Total duration</div></div>
  </div>

  <table>
    <thead><tr><th>Test</th><th style="text-align:center;">Result</th><th style="text-align:right;">Duration</th><th>Error</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <footer>JSD Emergency Services · ${escapeHtml(cfg.title)} · Generated ${new Date(generated_at).toISOString()}</footer>
</body></html>`
}

async function main() {
  const kind = process.argv[2]
  const cfg = CONFIGS[kind]
  if (!cfg) { console.error('usage: node make-report.cjs <playwright|selenium|smoke>'); process.exit(1) }

  const data = JSON.parse(fs.readFileSync(path.join(__dirname, cfg.resultsFile), 'utf8'))
  const html = buildHtml(cfg, data)
  const htmlPath = path.join(__dirname, `${kind}-report.html`)
  fs.writeFileSync(htmlPath, html)

  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'))
  await page.pdf({
    path: path.join(__dirname, cfg.outFile),
    format: 'A4',
    printBackground: true,
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
  })
  await browser.close()
  console.log(`Wrote ${cfg.outFile}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
