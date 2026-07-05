// Smoke test suite — fast critical-path health checks, distinct from the
// fuller Playwright/Selenium page suites: a single shared browser context,
// no per-page assertion depth, plus real (unmocked) backend liveness checks
// against the actual deployed API. Meant to answer one question quickly:
// "is the system fundamentally up," not "does every feature work correctly."
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')
const { adminUrl } = require('../helpers/auth.cjs')

const BASE = 'http://localhost:5173'
const API_BASE = 'https://cfnjgxlvfl.execute-api.eu-west-1.amazonaws.com'
const results = []

async function check(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, status: 'passed', duration_ms: Date.now() - t0 })
    console.log(`ok   ${name} (${Date.now() - t0}ms)`)
  } catch (e) {
    results.push({ name, status: 'failed', duration_ms: Date.now() - t0, error: e.message })
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

async function main() {
  // ---- backend liveness (real, unmocked calls to the deployed API) ----
  await check('Backend /health responds', async () => {
    const res = await fetch(`${API_BASE}/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  })
  await check('Backend /reference/locations responds with data', async () => {
    const res = await fetch(`${API_BASE}/reference/locations`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) throw new Error('empty/invalid locations payload')
  })
  await check('Backend /reference/zones responds with data', async () => {
    const res = await fetch(`${API_BASE}/reference/zones`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) throw new Error('empty/invalid zones payload')
  })

  // ---- frontend liveness (dev server, one shared browser context) ----
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route('**/fleet', (r) => r.fulfill({ json: { vehicles: [], drivers: [] } }))
  await ctx.route('**/ops', (r) => r.fulfill({ json: { emergencies: [] } }))
  const page = await ctx.newPage()

  const pages = [
    { path: '/dashboard', text: 'Operations Overview' },
    { path: '/requests', text: 'Dispatch Board' },
    { path: '/fleet', text: 'Vehicles' },
    { path: '/map', text: null, selector: '.leaflet-container' },
    { path: '/emergency', text: 'New Emergency' },
  ]
  for (const p of pages) {
    await check(`Frontend ${p.path} responds and renders`, async () => {
      await page.goto(adminUrl(BASE, p.path))
      if (p.selector) await page.locator(p.selector).waitFor({ timeout: 10000 })
      else await page.getByText(p.text).first().waitFor({ timeout: 10000 })
    })
  }

  await check('Frontend root serves the app shell without a 5xx', async () => {
    const res = await page.goto(BASE + '/')
    if (res.status() >= 500) throw new Error(`HTTP ${res.status()}`)
  })

  await browser.close()

  const outDir = path.join(__dirname, '..', 'reports')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'smoke-results.json'), JSON.stringify({ results, generated_at: new Date().toISOString() }, null, 2))

  const failed = results.filter((r) => r.status === 'failed').length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error('SMOKE RUNNER FAILED:', e); process.exit(1) })
