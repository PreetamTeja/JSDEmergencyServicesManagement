// Selenium WebDriver suite — drives the real installed Edge (msedgedriver,
// auto-resolved by Selenium Manager) via W3C WebDriver, not Playwright's own
// protocol. Uses the Chrome DevTools Protocol (a genuine Selenium 4 feature,
// distinct from classic Selenium 3) to intercept and mock authenticated
// endpoints the same way the Playwright suite does with page.route — a
// forged/unsigned JWT (routing-only, see tests/helpers/auth.cjs) cannot pass
// real backend signature verification, so these must be mocked for the app
// to render past its boot screen.
//
// This is a small hand-rolled runner (no test framework) so its JSON result
// shape is simple and self-contained for the PDF report generator. Coverage
// mirrors the Playwright suite's interaction tests (not just page loads):
// search/filter, pagination, confirm dialogs on destructive actions, the
// booking flow, map controls, and the command palette.
const { Builder, By, until, Key } = require('selenium-webdriver')
const edge = require('selenium-webdriver/edge')
const fs = require('fs')
const path = require('path')
const { adminUrl, userUrl } = require('../helpers/auth.cjs')
const { SAMPLE_VEHICLES, SAMPLE_INSIGHTS, SAMPLE_COVERAGE_GAPS, SAMPLE_INFRA_METRICS } = require('../helpers/mocks.cjs')

const BASE = 'http://localhost:5173'
const results = []

const MINE_EMERGENCIES = {
  emergencies: [
    { id: 'EMG-000001', kind: 'medical', case_type: 'Cardiac', severity: 'Critical', status: 'EN_ROUTE', pickup: { ref: 'loc-1' }, assigned_vehicle_id: 'AMB-3', created_at: new Date().toISOString(), patients_count: 1 },
    { id: 'EMG-000002', kind: 'medical', case_type: 'Trauma', severity: 'Urgent', status: 'QUEUED', pickup: { ref: 'loc-2' }, created_at: new Date().toISOString(), patients_count: 1 },
    { id: 'EMG-000003', kind: 'fire', severity: 'Critical', status: 'COMPLETED', pickup: { ref: 'loc-3' }, created_at: new Date(Date.now() - 3600_000).toISOString(), patients_count: 1 },
  ],
}
const PORTAL_MINE = {
  emergencies: [
    { id: 'EMG-MINE01', kind: 'medical', case_type: 'Cardiac', severity: 'Urgent', status: 'EN_ROUTE', pickup: { ref: 'loc-1' }, assigned_vehicle_id: 'AMB-1', requested_by: 'smoke-user', created_at: new Date().toISOString(), patients_count: 1 },
    { id: 'EMG-MINE02', kind: 'blood', severity: 'Critical', status: 'NO_BLOODBANK', pickup: { ref: 'loc-2' }, requested_by: 'smoke-user', created_at: new Date().toISOString(), patients_count: 1 },
  ],
}
const CREATE_EMERGENCY_RESPONSE = { id: 'EMG-TEST01', status: 'EN_ROUTE', assigned_vehicle_id: 'AMB-1' }

// selenium-webdriver's CdpConnection has no `.on()` of its own — events
// arrive on the underlying raw websocket (`_wsConnection`), so we parse
// frames ourselves and reply via `.send()` (promise-based, unlike the
// legacy callback-style `.execute()`).
async function withCdpMock(driver, fixtures, fn) {
  const connection = await driver.createCDPConnection('page')
  await connection.send('Network.enable', {})
  // Anchor to the end of the path by default (no trailing wildcard) — a
  // trailing '*' on e.g. '*/fleet*' also matches Vite's own dev asset path
  // /src/features/fleet/FleetPage.jsx and corrupts that module's response.
  // Endpoints called with query params (e.g. /infra/metrics?range_min=...)
  // need `hasQuery: true` so both the interception pattern and the match
  // check account for what follows the path.
  await connection.send('Fetch.enable', {
    patterns: fixtures.map((f) => ({ urlPattern: f.hasQuery ? `*${f.match}*` : `*${f.match}` })),
  })

  const onMessage = async (data) => {
    let payload
    try { payload = JSON.parse(data.toString()) } catch { return }
    if (payload.method !== 'Fetch.requestPaused') return
    const { requestId, request } = payload.params
    const path = request.url.split('?')[0]
    const match = fixtures.find((f) => (f.method ? request.method === f.method : true) && path.endsWith(f.match))
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

// Confirm dialogs (window.confirm) are native browser alerts under
// WebDriver — accept() clicks "OK", dismiss() clicks "Cancel". We always
// dismiss so the mocked destructive action never actually "completes";
// the assertion is just that a dialog appeared at all.
async function expectConfirmDialog(driver, triggerFn) {
  await triggerFn()
  const alert = await driver.wait(until.alertIsPresent(), 3000)
  const text = await alert.getText()
  await alert.dismiss()
  return text
}

async function main() {
  const options = new edge.Options()
  options.addArguments('--headless=new', '--window-size=1440,900')
  const driver = await new Builder().forBrowser('MicrosoftEdge').setEdgeOptions(options).build()

  const consoleFixtures = [
    { match: '/fleet', json: SAMPLE_VEHICLES },
    { match: '/ops', json: MINE_EMERGENCIES },
    { match: '/analytics/insights', json: SAMPLE_INSIGHTS },
    { match: '/analytics/coverage-gaps', json: SAMPLE_COVERAGE_GAPS },
    { match: '/infra/metrics', json: SAMPLE_INFRA_METRICS, hasQuery: true },
  ]
  const portalFixtures = [
    { match: '/fleet', json: SAMPLE_VEHICLES },
    { match: '/ops', json: PORTAL_MINE },
    { match: '/emergencies', json: CREATE_EMERGENCY_RESPONSE, method: 'POST' },
  ]

  try {
    await withCdpMock(driver, consoleFixtures, async () => {
      await run('Dashboard loads with KPI cards', async () => {
        await driver.get(adminUrl(BASE, '/dashboard'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Operations Overview')]")), 15000)
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Total responses')]")), 5000)
      })

      await run('Dashboard: Fleet-in-use KPI card navigates to /fleet', async () => {
        await driver.get(adminUrl(BASE, '/dashboard'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Operations Overview')]")), 15000)
        const card = await driver.findElement(By.xpath("//*[contains(text(),'Fleet in use')]/ancestor::div[@role='button'][1]"))
        await card.click()
        await driver.wait(until.urlContains('/fleet'), 5000)
      })

      await run('Dispatch Board loads', async () => {
        await driver.get(adminUrl(BASE, '/requests'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Dispatch Board')]")), 15000)
      })

      await run('Dispatch Board: search filters rows by ID', async () => {
        await driver.get(adminUrl(BASE, '/requests'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Dispatch Board')]")), 15000)
        const search = await driver.findElement(By.css('[aria-label="Search responses"]'))
        await search.sendKeys('EMG-000001')
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'EMG-000001')]")), 5000)
        const gone = await driver.findElements(By.xpath("//*[contains(text(),'EMG-000003')]"))
        if (gone.length > 0) throw new Error('EMG-000003 still visible after filtering to EMG-000001')
      })

      await run('Dispatch Board: bulk-cancel shows a confirm dialog', async () => {
        await driver.get(adminUrl(BASE, '/requests'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Dispatch Board')]")), 15000)
        const checkbox = await driver.findElement(By.css('tbody tr input[type="checkbox"]'))
        await checkbox.click()
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'selected')]")), 5000)
        const text = await expectConfirmDialog(driver, async () => {
          const btn = await driver.findElement(By.xpath("//button[contains(text(),'Cancel selected')]"))
          await btn.click()
        })
        if (!text) throw new Error('confirm dialog had no text')
      })

      await run('Fleet & Crews page loads with tabs', async () => {
        await driver.get(adminUrl(BASE, '/fleet'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Vehicles')]")), 15000)
      })

      await run('Fleet: pagination shows the current-page range (not the full count)', async () => {
        await driver.get(adminUrl(BASE, '/fleet'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Fleet Status')]")), 15000)
        // 5 sample vehicles, PAGE_SIZE=4 -> "1-4 of 5", not "5 of 5". The
        // footer text is built from several JSX-interpolated segments, which
        // render as separate sibling text nodes — contains(text(),...) only
        // checks the first text node, so this needs contains(., ...) to look
        // at the element's full concatenated string value instead.
        await driver.wait(until.elementLocated(By.xpath("//*[contains(., 'of 5 units')]")), 5000)
        const full = await driver.findElements(By.xpath("//*[contains(., '5 of 5 units')]"))
        if (full.length > 0) throw new Error('pagination footer still shows the full filtered count instead of the page range')
      })

      await run('Fleet: maintenance toggle shows a confirm dialog', async () => {
        await driver.get(adminUrl(BASE, '/fleet'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Fleet Status')]")), 15000)
        await expectConfirmDialog(driver, async () => {
          const btn = await driver.findElement(By.xpath("//button[contains(text(),'Maint.')]"))
          await btn.click()
        })
      })

      await run('Live Map page loads (Leaflet container present)', async () => {
        await driver.get(adminUrl(BASE, '/map'))
        await driver.wait(until.elementLocated(By.className('leaflet-container')), 15000)
      })

      await run('Live Map: zoom controls are present and clickable', async () => {
        await driver.get(adminUrl(BASE, '/map'))
        await driver.wait(until.elementLocated(By.className('leaflet-container')), 15000)
        const zoomIn = await driver.findElement(By.css('[aria-label="Zoom in"]'))
        await zoomIn.click()
      })

      await run('Emergencies page loads with New Emergency action', async () => {
        await driver.get(adminUrl(BASE, '/emergency'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'New Emergency')]")), 15000)
      })

      await run('Emergencies: New Emergency drawer opens as a dialog', async () => {
        await driver.get(adminUrl(BASE, '/emergency'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'New Emergency')]")), 15000)
        const trigger = await driver.findElement(By.xpath("(//*[contains(text(),'New Emergency')])[1]"))
        await trigger.click()
        await driver.wait(until.elementLocated(By.css('[role="dialog"][aria-label="New emergency"]')), 5000)
      })

      await run('Infra Health: time-range buttons switch', async () => {
        await driver.get(adminUrl(BASE, '/admin/infra'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Infrastructure Health')]")), 15000)
        const btn = await driver.findElement(By.xpath("//button[contains(text(),'7 d')]"))
        await btn.click()
      })

      await run('Infra Health: recent-errors panel shows the mocked ERROR-token log line', async () => {
        await driver.get(adminUrl(BASE, '/admin/infra'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Infrastructure Health')]")), 15000)
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'ANALYTICS_ERROR sample error')]")), 10000)
      })

      await run('Infra Health: CloudWatch subheading was removed', async () => {
        await driver.get(adminUrl(BASE, '/admin/infra'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Infrastructure Health')]")), 15000)
        const stray = await driver.findElements(By.xpath("//*[contains(text(),'CloudWatch metrics · Lambda + API Gateway')]"))
        if (stray.length > 0) throw new Error('stale CloudWatch subheading still present')
      })

      await run('Command palette opens with Ctrl+K', async () => {
        await driver.get(adminUrl(BASE, '/dashboard'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Operations Overview')]")), 15000)
        await driver.actions().keyDown(Key.CONTROL).sendKeys('k').keyUp(Key.CONTROL).perform()
        await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 5000)
      })

      await run('Command palette: typing an ID filters and Enter navigates to it', async () => {
        await driver.get(adminUrl(BASE, '/dashboard'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Operations Overview')]")), 15000)
        await driver.actions().keyDown(Key.CONTROL).sendKeys('k').keyUp(Key.CONTROL).perform()
        const input = await driver.wait(until.elementLocated(By.css('[aria-label="Command palette search"]')), 5000)
        await input.sendKeys('EMG-000001')
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'EMG-000001')]")), 5000)
        await input.sendKeys(Key.ENTER)
        await driver.wait(until.urlContains('/requests'), 5000)
      })
    })

    await withCdpMock(driver, portalFixtures, async () => {
      await run('User Portal: booking form loads for a non-admin session', async () => {
        await driver.get(userUrl(BASE, '/'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Book ambulance')]")), 15000)
      })

      await run('User Portal: "Multiple casualties" label has no "(mass)" suffix', async () => {
        await driver.get(userUrl(BASE, '/'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Book ambulance')]")), 15000)
        await driver.wait(until.elementLocated(By.xpath("//*[text()='Multiple casualties']")), 5000)
        const stray = await driver.findElements(By.xpath("//*[contains(text(),'Multiple casualties (mass)')]"))
        if (stray.length > 0) throw new Error('"(mass)" suffix still present')
      })

      await run('User Portal: NO_BLOODBANK request shows its own status + message', async () => {
        await driver.get(userUrl(BASE, '/'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Book ambulance')]")), 15000)
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Finding blood bank')]")), 10000)
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'No blood bank is available right now')]")), 5000)
      })

      await run('User Portal: cancelling a request shows a confirm dialog', async () => {
        await driver.get(userUrl(BASE, '/'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Book ambulance')]")), 15000)
        await driver.wait(until.elementLocated(By.xpath("//button[contains(text(),'Cancel ambulance') or contains(text(),'Cancel fire truck')]")), 10000)
        await expectConfirmDialog(driver, async () => {
          const btn = await driver.findElement(By.xpath("//button[contains(text(),'Cancel ambulance') or contains(text(),'Cancel fire truck')]"))
          await btn.click()
        })
      })

      await run('User Portal: full booking flow submits and shows a dispatch result', async () => {
        await driver.get(userUrl(BASE, '/'))
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Book ambulance')]")), 15000)
        // pickup defaults to a real location (loc-sakchi), not an empty
        // placeholder — open the picker by its dropdown-arrow glyph instead.
        const locBtn = await driver.findElement(By.xpath("//aside//button[contains(.,'▾')]"))
        await locBtn.click()
        const firstResult = await driver.wait(until.elementLocated(By.css('.max-h-56 button')), 5000)
        await firstResult.click()
        const severityBtn = await driver.findElement(By.xpath("//button[contains(.,'Critical')]"))
        await severityBtn.click()
        const submitBtn = await driver.findElement(By.xpath("//button[contains(text(),'Book ambulance')]"))
        await submitBtn.click()
        await driver.wait(until.elementLocated(By.xpath("//*[contains(text(),'Help is on the way')]")), 10000)
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
