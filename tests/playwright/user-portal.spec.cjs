// User Portal: the requester-side booking flow end-to-end — type tile,
// location picker, case type, severity, submit — plus the "your requests"
// tracker showing an item with a NO_BLOODBANK-style attention state, and the
// cancel-with-confirmation flow.
const { test, expect } = require('@playwright/test')
const { userUrl } = require('../helpers/auth.cjs')
const { mockPlaywright, SAMPLE_VEHICLES } = require('../helpers/mocks.cjs')

async function mockPortal(page) {
  await mockPlaywright(page)
  // Override /ops with items owned by the test user (requested_by must match
  // the forged JWT's `sub`, "smoke-user" — see src/portal/UserPortal.jsx's
  // `myId` filter) so the "Your requests" list actually shows something.
  await page.route('**/ops', (r) => r.fulfill({
    json: {
      emergencies: [
        { id: 'EMG-MINE01', kind: 'medical', case_type: 'Cardiac', severity: 'Urgent', status: 'EN_ROUTE', pickup: { ref: 'loc-1' }, assigned_vehicle_id: 'AMB-1', requested_by: 'smoke-user', created_at: new Date().toISOString(), patients_count: 1 },
        { id: 'EMG-MINE02', kind: 'blood', severity: 'Critical', status: 'NO_BLOODBANK', pickup: { ref: 'loc-2' }, requested_by: 'smoke-user', created_at: new Date().toISOString(), patients_count: 1 },
      ],
    },
  }))
}

test.describe('User Portal — booking flow', () => {
  test.beforeEach(async ({ page }) => { await mockPortal(page) })

  test('Full booking flow: pick location, case type, severity, submit', async ({ page }) => {
    await page.goto(userUrl('http://localhost:5173', '/'))
    await expect(page.getByText('Book ambulance', { exact: false }).first()).toBeVisible({ timeout: 15000 })

    // pickup defaults to a real location (UserPortal.jsx: useState('loc-sakchi'))
    // rather than an empty placeholder, so there's a real name on the button
    // already — exercise the picker anyway by opening it and re-selecting
    // the first option, to cover the dropdown open/select interaction.
    await page.locator('aside').getByRole('button').filter({ hasText: '▾' }).click()
    await page.locator('.max-h-56 button').first().click()

    const caseTypeBtn = page.getByRole('button', { name: 'Cardiac' })
    if (await caseTypeBtn.count()) await caseTypeBtn.click()

    await page.getByRole('button', { name: 'Critical' }).click()
    await page.getByRole('button', { name: /Book ambulance/i }).click()

    await expect(page.getByText('Help is on the way', { exact: false })).toBeVisible({ timeout: 10000 })
  })

  test('"Your requests" shows NO_BLOODBANK with its own status chip and message', async ({ page }) => {
    await page.goto(userUrl('http://localhost:5173', '/'))
    await expect(page.getByText('Book ambulance', { exact: false }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Finding blood bank', { exact: false })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('No blood bank is available right now', { exact: false })).toBeVisible()
  })

  test('Cancelling an active request asks for confirmation', async ({ page }) => {
    await page.goto(userUrl('http://localhost:5173', '/'))
    await expect(page.getByText('Book ambulance', { exact: false }).first()).toBeVisible({ timeout: 15000 })
    let dialogSeen = false
    page.once('dialog', async (d) => { dialogSeen = true; await d.dismiss() })
    const cancelBtn = page.getByRole('button', { name: /Cancel (ambulance|fire truck)/i }).first()
    await cancelBtn.click()
    await page.waitForTimeout(300)
    expect(dialogSeen).toBe(true)
  })

  test('Multiple casualties checkbox no longer shows the "(mass)" label', async ({ page }) => {
    await page.goto(userUrl('http://localhost:5173', '/'))
    await expect(page.getByText('Book ambulance', { exact: false }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Multiple casualties', { exact: true })).toBeVisible()
    await expect(page.getByText('Multiple casualties (mass)')).toHaveCount(0)
  })
})
