// Live Map: zone toggle, and the shared MapControls (zoom + place search)
// component — mocking Nominatim so the search path is exercised without
// hitting the real public geocoder.
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')
const { mockPlaywright } = require('../helpers/mocks.cjs')

test.describe('Live Map — interactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockPlaywright(page)
    await page.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({
      json: [{ place_id: 1, display_name: 'Bistupur, Jamshedpur, Jharkhand, India', lat: '22.8012', lon: '86.1856' }],
    }))
  })

  test('Zones checkbox toggles zone polygons', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/map'))
    await expect(page.getByText('Live Map').first()).toBeVisible({ timeout: 15000 })
    const zonesToggle = page.getByLabel('Zones')
    if (await zonesToggle.count()) {
      await zonesToggle.uncheck()
      await expect(zonesToggle).not.toBeChecked()
    }
  })

  test('Map zoom controls are present and clickable', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/map'))
    await expect(page.getByText('Live Map').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByLabel('Zoom in')).toBeVisible()
    await expect(page.getByLabel('Zoom out')).toBeVisible()
    await page.getByLabel('Zoom in').click()
  })

  test('Place search returns and selects a result', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/map'))
    await expect(page.getByText('Live Map').first()).toBeVisible({ timeout: 15000 })
    await page.getByLabel('Search places on map').fill('Bistupur')
    await expect(page.getByText('Bistupur, Jamshedpur', { exact: false })).toBeVisible({ timeout: 5000 })
    await page.getByText('Bistupur, Jamshedpur', { exact: false }).click()
  })
})
