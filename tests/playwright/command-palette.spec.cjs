// Command palette: search over live emergencies and navigation commands.
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')
const { mockPlaywright } = require('../helpers/mocks.cjs')

test.describe('Command palette — interactions', () => {
  test.beforeEach(async ({ page }) => { await mockPlaywright(page) })

  test('Typing an emergency ID filters results and Enter navigates to it', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/dashboard'))
    await expect(page.getByText('Operations Overview')).toBeVisible({ timeout: 15000 })
    await page.keyboard.press('Control+k')
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 })
    await page.getByLabel('Command palette search').fill('EMG-000001')
    // Scope to the dialog — the underlying Dashboard table (with the same
    // ID) stays mounted behind the palette overlay, so an unscoped
    // getByText matches both and trips Playwright's strict-mode check.
    await expect(page.locator('[role="dialog"]').getByText('EMG-000001')).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/requests/)
  })

  test('Typing a nav command like "Fleet" finds the Fleet page link', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/dashboard'))
    await expect(page.getByText('Operations Overview')).toBeVisible({ timeout: 15000 })
    await page.keyboard.press('Control+k')
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 })
    await page.getByLabel('Command palette search').fill('Fleet')
    await expect(page.getByText('Fleet & Crews', { exact: false }).first()).toBeVisible({ timeout: 5000 })
  })
})
