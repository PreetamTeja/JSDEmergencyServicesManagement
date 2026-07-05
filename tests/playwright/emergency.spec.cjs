// Emergencies page: New Emergency drawer open/close, filter tabs.
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')
const { mockPlaywright } = require('../helpers/mocks.cjs')

test.describe('Emergencies — interactions', () => {
  test.beforeEach(async ({ page }) => { await mockPlaywright(page) })

  test('New Emergency drawer opens as a modal dialog and closes', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/emergency'))
    await expect(page.getByText('New Emergency').first()).toBeVisible({ timeout: 15000 })
    await page.getByText('New Emergency').first().click()
    const dialog = page.locator('[role="dialog"][aria-label="New emergency"]')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('Filter tabs are real tabs with aria-selected state', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/emergency'))
    await expect(page.getByText('New Emergency').first()).toBeVisible({ timeout: 15000 })
    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    expect(count).toBeGreaterThan(0)
    await tabs.first().click()
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  })

  test('deep-linking to /emergency?new=1 opens the drawer automatically', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/emergency?new=1'))
    await expect(page.locator('[role="dialog"][aria-label="New emergency"]')).toBeVisible({ timeout: 15000 })
  })
})
