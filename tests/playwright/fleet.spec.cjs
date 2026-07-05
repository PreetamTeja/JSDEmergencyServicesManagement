// Fleet & Crews: search, type/status filters, pagination, maintenance
// confirmation dialog.
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')
const { mockPlaywright } = require('../helpers/mocks.cjs')

test.describe('Fleet & Crews — interactions', () => {
  test.beforeEach(async ({ page }) => { await mockPlaywright(page) })

  test('Search filters the vehicle list by registration', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/fleet'))
    await expect(page.getByText('Fleet Status')).toBeVisible({ timeout: 15000 })
    await page.getByLabel('Search reg or crew').fill('9999')
    await expect(page.getByText('JH01AB9999')).toBeVisible()
    await expect(page.getByText('JH01AB1234')).toHaveCount(0)
  })

  test('Type filter narrows to fire trucks only', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/fleet'))
    await expect(page.getByText('Fleet Status')).toBeVisible({ timeout: 15000 })
    await page.getByRole('combobox').first().selectOption('firetruck')
    await expect(page.getByText('JH01FT1035')).toBeVisible()
    await expect(page.getByText('JH01AB1234')).toHaveCount(0)
  })

  test('Pagination shows the correct current-page range, not the full count', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/fleet'))
    await expect(page.getByText('Fleet Status')).toBeVisible({ timeout: 15000 })
    // 5 sample vehicles, PAGE_SIZE=4 -> page 1 should read "1-4 of 5", not "5 of 5".
    await expect(page.getByText(/1.4 of 5 units/)).toBeVisible()
  })

  test('Maintenance toggle asks for confirmation before taking a unit out of service', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/fleet'))
    await expect(page.getByText('Fleet Status')).toBeVisible({ timeout: 15000 })
    let dialogSeen = false
    page.once('dialog', async (d) => { dialogSeen = true; await d.dismiss() })
    await page.getByRole('button', { name: 'Maint.' }).first().click()
    await page.waitForTimeout(300)
    expect(dialogSeen).toBe(true)
  })
})
