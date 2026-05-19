import { test, expect } from '@playwright/test'

// All routes that must respond 200 and render the v2 shell.
// Keep this list in sync with qa/regression.ps1 ROUTES and the live nav.
const PAGES = [
  { path: '/v2',             label: 'Executive Overview' },
  { path: '/v2/instagram',   label: 'Instagram' },
  { path: '/v2/youtube',     label: 'YouTube' },
  { path: '/v2/reddit',      label: 'Reddit & Community' },
  { path: '/v2/comments',    label: 'Comments Intel' },
  { path: '/v2/influencers', label: 'Influencer Network' },
  { path: '/v2/ads',         label: 'Ads Library' },
  { path: '/v2/promotions',  label: 'Promotions' },
  { path: '/v2/products',    label: 'Product Catalog' },
  { path: '/v2/market',      label: 'Market Intel' },
  { path: '/v2/twitter',     label: 'X / Twitter' },
  { path: '/v2/tiktok',      label: 'TikTok' },
] as const

// Next.js API routes that should exist (POST endpoints — GET returns 405).
const API_ROUTES = [
  '/api/generate-content',
  '/api/keyword-research',
  '/api/content-brief',
  '/api/seo-analyzer',
] as const

test.describe('v2 dashboard routes', () => {
  for (const page of PAGES) {
    test(`${page.path} loads, renders shell, no error overlay`, async ({ page: p }) => {
      const response = await p.goto(page.path, { waitUntil: 'domcontentloaded' })
      expect(response, `no response for ${page.path}`).not.toBeNull()
      expect(response!.status(), `${page.path} non-200`).toBe(200)

      // Sidebar must be present (server-rendered in layout).
      await expect(p.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

      // No Next.js dev error overlay.
      const overlay = p.locator('nextjs-portal, [data-nextjs-dialog]')
      await expect(overlay).toHaveCount(0)

      // Main content region exists.
      await expect(p.locator('main.main, .v2-root .main, main')).toBeVisible()
    })
  }
})

test.describe('navigation', () => {
  test('clicking a sidebar link navigates to that route', async ({ page }) => {
    await page.goto('/v2')
    await page.locator('aside.sidebar a[href="/v2/instagram"]').first().click()
    await expect(page).toHaveURL(/\/v2\/instagram$/, { timeout: 10_000 })
    await expect(page.locator('aside.sidebar')).toBeVisible()
  })
})

test.describe('404 + edge cases', () => {
  test('unknown route returns 404', async ({ request }) => {
    const r = await request.get('/v2/this-page-does-not-exist-xyz')
    expect(r.status()).toBe(404)
  })

  test('root path responds (200 or redirect)', async ({ request }) => {
    const r = await request.get('/', { maxRedirects: 0 })
    expect([200, 301, 302, 307, 308]).toContain(r.status())
  })
})

test.describe('API routes registered', () => {
  for (const route of API_ROUTES) {
    test(`${route} exists (GET returns 405 or 200, not 404)`, async ({ request }) => {
      const r = await request.get(route)
      // POST-only routes return 405 Method Not Allowed for GET; some return 400.
      // What we care about is: NOT 404. A 404 means the route is missing.
      expect(r.status(), `${route} returned 404 — route is missing`).not.toBe(404)
    })
  }
})
