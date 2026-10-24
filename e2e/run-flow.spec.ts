import { expect, test } from '@playwright/test'

test.skip(!process.env.DATABASE_URL, 'DATABASE_URL is required for the persisted app flow.')

test('creates a run, processes fixture repo data, adjusts rubric, and exports CSV', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`

  await page.goto('/login')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Analysis Runs' })).toBeVisible()
  await page.getByRole('link', { name: 'New Run' }).click()
  await page.getByLabel('Run name').fill('E2E fixture run')
  await page.getByRole('button', { name: 'Create Run' }).click()

  await expect(page.getByRole('heading', { name: 'E2E fixture run' })).toBeVisible()
  await page.getByRole('button', { name: 'Process Queued' }).click()
  await expect(page.getByText('Alex Lee')).toBeVisible()
  await expect(page.getByText('Sam Cruz')).toBeVisible()

  const impact = page.locator('label').filter({ hasText: 'Impact' }).locator('input')
  await impact.evaluate((input) => {
    const range = input as HTMLInputElement
    range.value = '60'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    range.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'Apply Rubric' }).click()
  await expect(page.getByRole('button', { name: 'Apply Rubric' })).toBeEnabled()

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export' }).click()
  expect((await download).suggestedFilename()).toMatch(/repolight-.*\.csv/)
})
