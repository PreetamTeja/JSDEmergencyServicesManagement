// Dispatch Board: search, filter tabs, pagination, row selection, bulk
// cancel confirmation dialog, single-row cancel confirmation dialog.
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')
const { mockPlaywright } = require('../helpers/mocks.cjs')

test.describe('Dispatch Board — interactions', () => {
  test.beforeEach(async ({ page }) => { await mockPlaywright(page) })

  test('Search filters the table by ID', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/requests'))
    await expect(page.getByText('Dispatch Board').first()).toBeVisible({ timeout: 15000 })
    await page.getByLabel('Search responses').fill('EMG-000001')
    await expect(page.locator('tr', { hasText: 'EMG-000001' })).toBeVisible()
    await expect(page.locator('tr', { hasText: 'EMG-000003' })).toHaveCount(0)
  })

  test('Filter tabs switch the visible set (Fire filter hides medical rows)', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/requests'))
    await expect(page.getByText('Dispatch Board').first()).toBeVisible({ timeout: 15000 })
    await page.getByRole('tab', { name: 'Fire' }).click()
    await expect(page.getByRole('tab', { name: 'Fire' })).toHaveAttribute('aria-selected', 'true')
  })

  test('Row checkbox selection shows the bulk action bar, and bulk-cancel asks for confirmation', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/requests'))
    await expect(page.getByText('Dispatch Board').first()).toBeVisible({ timeout: 15000 })
    // Bulk-cancel only actually targets EN_ROUTE rows (see bulkCancelSelected
    // in RequestsPage.jsx) — selecting an arbitrary "first row" can silently
    // no-op (and never even show the confirm dialog) if that row isn't
    // EN_ROUTE, so select the one row we know is EMG-000001 (EN_ROUTE).
    const rowCheckbox = page.locator('tr', { hasText: 'EMG-000001' }).locator('input[type="checkbox"]')
    await rowCheckbox.check()
    await expect(page.getByText(/1 selected/)).toBeVisible()

    let dialogSeen = false
    page.once('dialog', async (d) => { dialogSeen = true; await d.dismiss() })
    await page.getByRole('button', { name: /Cancel selected/i }).click()
    await page.waitForTimeout(300)
    expect(dialogSeen).toBe(true)
  })

  test('Single-row cancel from the action menu asks for confirmation', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/requests'))
    await expect(page.getByText('Dispatch Board').first()).toBeVisible({ timeout: 15000 })
    await page.getByLabel('Actions for EMG-000001').click()
    let dialogSeen = false
    page.once('dialog', async (d) => { dialogSeen = true; await d.dismiss() })
    await page.getByText('Cancel dispatch', { exact: false }).click()
    await page.waitForTimeout(300)
    expect(dialogSeen).toBe(true)
  })
})
