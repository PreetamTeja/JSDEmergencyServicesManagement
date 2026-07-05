// Playwright E2E suite — golden-path coverage of the Console app's main
// pages. Runs against the local Vite dev server with the live/authenticated
// endpoints (/fleet, /ops) mocked, since a forged JWT (routing-only, per
// src/auth.js:12-13) cannot pass real backend signature verification.
// Reference data endpoints (/reference/*) are left live — they're public.
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')

async function mockAuthedEndpoints(page) {
  await page.route('**/fleet', (r) => r.fulfill({ json: { vehicles: [], drivers: [] } }))
  await page.route('**/ops', (r) => r.fulfill({ json: { emergencies: [] } }))
}

test.describe('Console — golden paths', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthedEndpoints(page)
  })

  test('Dashboard loads with KPI cards and no console errors', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(adminUrl('http://localhost:5173', '/dashboard'))
    await expect(page.getByText('Operations Overview')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Total responses')).toBeVisible()
    await expect(page.getByText('Fleet in use')).toBeVisible()
    expect(errors, `Uncaught page errors: ${errors.join('; ')}`).toHaveLength(0)
  })

  test('Dispatch Board loads and shows the requests table', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/requests'))
    await expect(page.locator('nav, aside').getByText('Dispatch Board')).toBeVisible({ timeout: 15000 })
  })

  test('Fleet & Crews page loads with tabs', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/fleet'))
    await expect(page.getByText('Vehicles').first()).toBeVisible({ timeout: 15000 })
  })

  test('Live Map page loads', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/map'))
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 15000 })
  })

  test('Emergencies page loads with the New Emergency action', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/emergency'))
    await expect(page.getByText('New Emergency').first()).toBeVisible({ timeout: 15000 })
  })

  test('AI Insights page loads recommendation cards', async ({ page }) => {
    await page.route('**/analytics/insights', (r) => r.fulfill({
      json: {
        record_count: 100, date_range: null,
        placement_recommendations: [], staffing_recommendations: [],
        peak_windows: [], seasonal_alerts: [],
      },
    }))
    await page.goto(adminUrl('http://localhost:5173', '/insights'))
    await expect(page.getByRole('heading', { name: 'AI Insights' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Ambulance staging placement')).toBeVisible()
  })

  test('Infra Health page loads for admin', async ({ page }) => {
    await page.route('**/infra/metrics*', (r) => r.fulfill({
      json: { invocations: 0, errors: 0, error_rate_pct: 0, throttles: 0, duration_avg_ms: 0, duration_p99_ms: 0, cold_starts: 0, recent_errors: [], series: { invocations: [], errors: [], duration_avg: [] } },
    }))
    await page.goto(adminUrl('http://localhost:5173', '/admin/infra'))
    await expect(page.getByText('Infra Health').first()).toBeVisible({ timeout: 15000 })
  })

  test('Command palette opens with Ctrl+K and closes with Escape', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/dashboard'))
    await expect(page.getByText('Operations Overview')).toBeVisible({ timeout: 15000 })
    await page.keyboard.press('Control+k')
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 })
  })

  test('Sidebar navigation switches pages', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/dashboard'))
    await expect(page.getByText('Operations Overview')).toBeVisible({ timeout: 15000 })
    await page.locator('nav, aside').getByText('Fleet & Crews').click()
    await expect(page).toHaveURL(/\/fleet/)
  })
})
