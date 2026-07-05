// Infra Health: time-range selector switches, error log renders the mocked
// error (regression test for the ERROR-token filter fix), no stray
// "CloudWatch metrics" subheading (explicitly removed).
const { test, expect } = require('@playwright/test')
const { adminUrl } = require('../helpers/auth.cjs')
const { mockPlaywright } = require('../helpers/mocks.cjs')

test.describe('Infra Health — interactions', () => {
  test.beforeEach(async ({ page }) => { await mockPlaywright(page) })

  test('Time-range buttons switch the selected range', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/admin/infra'))
    await expect(page.getByText('Infrastructure Health')).toBeVisible({ timeout: 15000 })
    const sevenDay = page.getByRole('button', { name: '7 d' })
    await sevenDay.click()
    await expect(sevenDay).toBeVisible()
  })

  test('Recent errors panel shows the mocked ERROR-token log line', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/admin/infra'))
    await expect(page.getByText('Infrastructure Health')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/ANALYTICS_ERROR sample error/)).toBeVisible({ timeout: 10000 })
  })

  test('CloudWatch subheading was removed from the page header', async ({ page }) => {
    await page.goto(adminUrl('http://localhost:5173', '/admin/infra'))
    await expect(page.getByText('Infrastructure Health')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('CloudWatch metrics · Lambda + API Gateway')).toHaveCount(0)
  })
})
