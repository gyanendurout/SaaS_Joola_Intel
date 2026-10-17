import { test, expect } from '@playwright/test'

// These run signed OUT: they check the gate itself, not the pages behind it.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('login gate', () => {
  test('a dashboard page redirects to /login with next=', async ({ page }) => {
    await page.goto('/v2/overview')
    await expect(page).toHaveURL(/\/login\?next=%2Fv2%2Foverview/)
    await expect(page.getByLabel('Work email')).toBeVisible()
  })

  test('a non-JOOLA email is refused without sending anything', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Work email').fill('x@gmail.com')
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(page.locator('#login-email-error')).toContainText('Use your @joola.com or @joola.in email.')
    await expect(page.getByLabel('6-digit code')).toHaveCount(0)
  })

  test('API routes return 401 when signed out', async ({ request }) => {
    const res = await request.post('/api/seo-analyzer', { data: {}, maxRedirects: 0 })
    expect(res.status()).toBe(401)
  })

  // CVE-2025-29927: this header used to let requests skip middleware entirely.
  test('the middleware-bypass header does not skip the gate', async ({ request }) => {
    const res = await request.get('/v2/overview', {
      maxRedirects: 0,
      headers: { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' },
    })
    expect(res.status()).toBe(307)
    expect(res.headers()['location']).toContain('/login')
  })
})
