// Selenium WebDriver suite — drives the real installed Edge (msedgedriver,
// auto-resolved by Selenium Manager) via W3C WebDriver, not Playwright's own
// protocol. Uses the Chrome DevTools Protocol (a genuine Selenium 4 feature,
// distinct from classic Selenium 3) to intercept and mock the two
// authenticated endpoints (/fleet, /ops) the same way the Playwright suite
// does with page.route — a forged/unsigned JWT (routing-only, see
// tests/helpers/auth.cjs) cannot pass real backend signature verification,
// so these must be mocked for the app to render past its boot screen.
//
// This is a small hand-rolled runner (no test framework) so its JSON result
// shape is simple and self-contained for the PDF report generator.
const { Builder, By, until } = require('selenium-webdriver')
const edge = require('selenium-webdriver/edge')
const fs = require('fs')
const path = require('path')
const { adminUrl } = require('../helpers/auth.cjs')

const BASE = 'http://localhost:5173'
const results = []

// selenium-webdriver's CdpConnection has no `.on()` of its own — events
// arrive on the underlying raw websocket (`_wsConnection`), so we parse
// frames ourselves and reply via `.send()` (promise-based, unlike the
// legacy callback-style `.execute()`).
async function withCdpMock(driver, fixtures, fn) {
  const connection = await driver.createCDPConnection('page')
  await connection.send('Network.enable', {})
  // Only pause the two endpoints that actually need mocking — pausing every
  // request (patterns: '*') risks stalling unrelated JS/CSS/image loads if
  // any continueRequest call is slow or drops, hanging the whole page.
  // IMPORTANT: anchor to the end of the path (no trailing wildcard) — a
  // trailing '*' on e.g. '*/fleet*' also matches Vite's own dev asset path
  // /src/features/fleet/FleetPage.jsx and corrupts that module's response.
  await connection.send('Fetch.enable', {
    patterns: fixtures.map((f) => ({ urlPattern: `*${f.match}` })),
  })

  const onMessage = async (data) => {
    let payload
    try { payload = JSON.parse(data.toString()) } catch { return }
    if (payload.method !== 'Fetch.requestPaused') return
    const { requestId, request } = payload.params
    const match = fixtures.find((f) => request.url.endsWith(f.match))
    // CDP-fulfilled responses bypass the real server entirely, so the
    // browser's own CORS check still applies to them — both the actual GET
    // and its preflight OPTIONS need explicit CORS headers, or the fetch()
    // in the app is rejected client-side before our JSON body is ever read.
    const corsHeaders = [
      { name: 'access-control-allow-origin', value: 'http://localhost:5173' },
      { name: 'access-control-allow-methods', value: 'GET,POST,OPTIONS' },
      { name: 'access-control-allow-headers', value: 'authorization,content-type' },
    ]
    if (match) {
      const isPreflight = request.method === 'OPTIONS'
      const body = isPreflight ? '' : Buffer.from(JSON.stringify(match.json)).toString('base64')
      connection.execute('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }, ...corsHeaders],
        body,
      }, () => {})
    } else {
      connection.execute('Fetch.continueRequest', { requestId }, () => {})
    }
  }
  connection._wsConnection.on('message', onMessage)

  try {
    return await fn()
  } finally {
    connection._wsConnection.off('message', onMessage)
    await connection.send('Fetch.disable', {})
  }
}

async function run(name, testFn) {
  const t0 = Date.now()
  try {
    await testFn()
    results.push({ name, status: 'passed', duration_ms: Date.now() - t0 })
    console.log(`ok   ${name} (${Date.now() - t0}ms)`)
  } catch (e) {
    results.push({ name, status: 'failed', duration_ms: Date.now() - t0, error: e.message })
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

async function main() {
  const options = new edge.Options()
  options.addArguments('--headless=new', '--window-size=1440,900')
  const driver = await new Builder().forBrowser('MicrosoftEdge').setEdgeOptions(options).build()

  const fleetOpsFixtures = [
    { match: '/fleet', json: { vehicles: [], drivers: [] } },
    { match: '/ops', json: { emergencies: [] } },
  ]

  try {
    await withCdpMock(driver, fleetOpsFixtures, async () => {
      await run('Dashboard loads with KPI cards', async () => {
        await driver.get(adminUrl(BASE, '/dashboard'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Operations Overview')]")), 15000)
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Total responses')]")), 5000)
      })

      await run('Dispatch Board loads', async () => {
        await driver.get(adminUrl(BASE, '/requests'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Dispatch Board')]")), 15000)
      })

      await run('Fleet & Crews page loads with tabs', async () => {
        await driver.get(adminUrl(BASE, '/fleet'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Vehicles')]")), 15000)
      })

      await run('Live Map page loads (Leaflet container present)', async () => {
        await driver.get(adminUrl(BASE, '/map'))
        await driver.wait(until.elementLocated(By.className('leaflet-container')), 15000)
      })

      await run('Emergencies page loads with New Emergency action', async () => {
        await driver.get(adminUrl(BASE, '/emergency'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'New Emergency')]")), 15000)
      })

      await run('Command palette opens with Ctrl+K', async () => {
        await driver.get(adminUrl(BASE, '/dashboard'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Operations Overview')]")), 15000)
        const { Key, Actions } = require('selenium-webdriver')
        await driver.actions().keyDown(Key.CONTROL).sendKeys('k').keyUp(Key.CONTROL).perform()
        await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 5000)
      })
    })

    await run('Landing page renders for an unauthenticated visit', async () => {
      await driver.get(BASE + '/')
      await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Emergency Services')]")), 15000)
    })
  } finally {
    await driver.quit()
  }

  const outDir = path.join(__dirname, '..', 'reports')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'selenium-results.json'), JSON.stringify({ results, generated_at: new Date().toISOString() }, null, 2))

  const failed = results.filter((r) => r.status === 'failed').length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error('SELENIUM RUNNER FAILED:', e); process.exit(1) })
