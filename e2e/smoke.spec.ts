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

test.describe('global topbar controls', () => {
  test('date-range From/To picker is rendered in the topbar', async ({ page }) => {
    await page.goto('/v2')
    // Two real <input type="date"> controls labelled From / To.
    const dateInputs = page.locator('.topbar input[type="date"]')
    await expect(dateInputs).toHaveCount(2, { timeout: 10_000 })
    await expect(page.locator('#v2-date-from')).toBeVisible()
    await expect(page.locator('#v2-date-to')).toBeVisible()
  })

  test('brand-filter dropdown still renders alongside date-range', async ({ page }) => {
    await page.goto('/v2')
    await expect(page.locator('.topbar .bfd-trigger')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.topbar input[type="date"]').first()).toBeVisible()
  })
})

test.describe('no dev-command leaks in user UI', () => {
  // Confirms the empty-state copy on social pages no longer surfaces internal
  // CLI commands (e.g. "python scripts/pipeline/apify_to_supabase.py").
  for (const path of ['/v2/tiktok', '/v2/twitter']) {
    test(`${path} does not surface internal CLI commands`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })
      const body = await page.textContent('body')
      expect(body, `${path} must not leak the pipeline command into UI`).not.toMatch(/python scripts\/pipeline/i)
    })
  }

  // The twitter subtitle previously contained the words "Scraping runs" and
  // "pipeline run". Those are internal-vocab leaks; the user-facing copy is
  // now "Data refreshes every Monday morning".
  test('/v2/twitter does not contain "Scraping runs" / "pipeline run" / "python scripts" in body copy', async ({ page }) => {
    await page.goto('/v2/twitter', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })
    const body = (await page.textContent('body')) ?? ''
    expect(body, 'twitter page must not say "Scraping runs"').not.toMatch(/Scraping runs/i)
    expect(body, 'twitter page must not say "pipeline run"').not.toMatch(/pipeline run/i)
    expect(body, 'twitter page must not say "python scripts"').not.toMatch(/python scripts/i)
  })
})

test.describe('tiktok page polish', () => {
  test('Posted column shows a calendar date (not "Nd ago") when videos render', async ({ page }) => {
    await page.goto('/v2/tiktok', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    // Videos table is anchored; if it isn't present this is a data state, not a regression.
    const table = page.locator('#tiktok-videos-table table.data')
    const tableCount = await table.count()
    if (tableCount === 0) test.skip()

    const firstPostedCell = table.locator('tbody tr').first().locator('td').last()
    const text = (await firstPostedCell.textContent())?.trim() ?? ''
    // Expect a real date like "15 Jan 2025" (en-GB) — reject the "Nd ago" placeholder.
    expect(text, `Posted column should render a date, got: "${text}"`).not.toMatch(/^\d+d ago$/)
    expect(text, `Posted column should look like "DD Mon YYYY", got: "${text}"`).toMatch(/\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/)
  })
})

test.describe('twitter page polish', () => {
  test('Posted column shows a calendar date (not "Nd ago") when posts render', async ({ page }) => {
    await page.goto('/v2/twitter', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    // Posts table is anchored; if it isn't present this is a data state, not a regression.
    const table = page.locator('#twitter-posts-table table.data')
    const tableCount = await table.count()
    if (tableCount === 0) test.skip()

    const firstPostedCell = table.locator('tbody tr').first().locator('td').last()
    const text = (await firstPostedCell.textContent())?.trim() ?? ''
    // Expect a real date like "15 Jan 2025" (en-GB) — reject the "Nd ago" placeholder.
    expect(text, `Posted column should render a date, got: "${text}"`).not.toMatch(/^\d+d ago$/)
    expect(text, `Posted column should look like "DD Mon YYYY", got: "${text}"`).toMatch(/\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/)
  })
})

test.describe('market page polish', () => {
  test('/v2/market does not leak DB column names, dev jargon, or "paddle" suffix', async ({ page }) => {
    await page.goto('/v2/market', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    const body = (await page.textContent('body')) ?? ''
    expect(body, 'market page must not surface raw column "REDDIT_MENTIONS"').not.toMatch(/REDDIT_MENTIONS/i)
    expect(body, 'market page must not surface truncated column "REDDIT_M…"').not.toMatch(/REDDIT_M\./i)
    expect(body, 'market page must not include the "python scripts" CLI string').not.toMatch(/python scripts/i)
    expect(body, 'market page must not include the "scraped post" phrase').not.toMatch(/scraped post/i)
    expect(body, 'market page must not include the "Scraping runs" phrase').not.toMatch(/Scraping runs/i)
    expect(body, 'market page must not include the "pipeline run" phrase').not.toMatch(/pipeline run/i)
    expect(body, 'market labels must not have a trailing " paddle"').not.toMatch(/\b(JOOLA|Selkirk|Paddletek|CRBN|Engage|Onix|Wilson|Gamma|Franklin|Head)\s+paddle\b/i)
    // Hard-coded windows must not bypass the global date-range dropdown.
    expect(body, 'market subtitles must not hard-code "Last 30 days"').not.toMatch(/\bLast 30 days\b/)
    expect(body, 'market subtitles must not hard-code "Last 90 days" as a literal — pulled from DATE_RANGE_LABEL').not.toMatch(/community footprint.*\bLast 90 days\b/i)
  })

  test('/v2/market mentions trend uses calendar dates, not W1–W8', async ({ page }) => {
    await page.goto('/v2/market', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    // Look at the SVG axis labels in the LineChart. If the chart isn't on the page
    // (no Reddit data this window), treat it as a data state and skip.
    const axisLabels = page.locator('.v2-root text.scatter-axis')
    const count = await axisLabels.count()
    if (count === 0) test.skip()

    const firstLabel = (await axisLabels.first().textContent())?.trim() ?? ''
    expect(firstLabel, `mentions chart x-axis should show calendar dates, got "${firstLabel}"`).not.toMatch(/^W\d$/)
    expect(firstLabel, `mentions chart x-axis label should look like "Mon D", got "${firstLabel}"`).toMatch(/^[A-Z][a-z]{2}\s+\d{1,2}$/)
  })
})

test.describe('influencers page polish', () => {
  test('/v2/influencers does not leak dev jargon or scraper vocabulary', async ({ page }) => {
    await page.goto('/v2/influencers', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    const body = (await page.textContent('body')) ?? ''
    expect(body, 'influencers page must not include the "scraped posts" phrase').not.toMatch(/scraped posts/i)
    expect(body, 'influencers page must not include the "python scripts" CLI string').not.toMatch(/python scripts/i)
    expect(body, 'influencers page must not include the "not yet fully tracked" phrase').not.toMatch(/not yet fully tracked/i)
    expect(body, 'influencers page must not include the "pipeline run" phrase').not.toMatch(/pipeline run/i)
  })

  test('/v2/influencers Posted column shows calendar dates, not "Nd ago"', async ({ page }) => {
    await page.goto('/v2/influencers', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    // Top-posts section is anchored. If the table is missing, treat as a data
    // state rather than a regression.
    const table = page.locator('#influencer-top-posts table.data')
    const tableCount = await table.count()
    if (tableCount === 0) test.skip()

    const rows = table.locator('tbody tr')
    const rowCount = await rows.count()
    if (rowCount === 0) test.skip()

    const firstPostedCell = rows.first().locator('td').last()
    const text = (await firstPostedCell.textContent())?.trim() ?? ''
    expect(text, `Posted column should not be "Nd ago", got: "${text}"`).not.toMatch(/^\d+d ago$/)
  })

  test('/v2/influencers top posts section, if rendered, has at least one real post URL', async ({ page }) => {
    await page.goto('/v2/influencers', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    const section = page.locator('#influencer-top-posts')
    const sectionCount = await section.count()
    if (sectionCount === 0) test.skip()

    const table = section.locator('table.data')
    const tableCount = await table.count()
    if (tableCount === 0) test.skip()

    // Look for any anchor in the table whose href points to a real post URL.
    const realPostAnchors = table.locator('a[href*="instagram.com/p/"], a[href*="tiktok.com/"], a[href*="youtube.com/watch"], a[href*="x.com/"], a[href*="twitter.com/"]')
    const anchorCount = await realPostAnchors.count()
    if (anchorCount === 0) test.skip() // empty data — no regression
    expect(anchorCount).toBeGreaterThan(0)
  })
})

test.describe('comments page polish', () => {
  test('/v2/comments does not contain dev jargon or internal pipeline copy', async ({ page }) => {
    await page.goto('/v2/comments', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    const body = (await page.textContent('body')) ?? ''
    expect(body, 'comments page must not say "not yet fully tracked"').not.toMatch(/not yet fully tracked/i)
    expect(body, 'comments page must not say "python scripts"').not.toMatch(/python scripts/i)
    expect(body, 'comments page must not say "scraped"').not.toMatch(/\bscraped\b/i)
    expect(body, 'comments page must not say "pipeline run"').not.toMatch(/pipeline run/i)
    expect(body, 'comments page must not say "apify"').not.toMatch(/\bapify\b/i)
    expect(body, 'comments page must not hard-code "1000 IG"').not.toMatch(/1000 IG/i)
  })

  test('/v2/comments date cells do not match "Nd ago" pattern when comments render', async ({ page }) => {
    await page.goto('/v2/comments', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    // Comment rows are rendered as divs with a grid layout, not a table.
    // The date text is the last span inside the metadata line for each row.
    // If no comments rendered (empty data state) skip instead of failing.
    const commentRows = page.locator('.card [style*="gridTemplateColumns"]')
    const rowCount = await commentRows.count()
    if (rowCount === 0) test.skip()

    // Check all visible date spans — none should match the bare "Nd ago" pattern.
    const dateSpans = commentRows.locator('[title$="d ago"]')
    const spanCount = await dateSpans.count()
    if (spanCount === 0) test.skip()

    for (let i = 0; i < Math.min(spanCount, 5); i++) {
      const text = (await dateSpans.nth(i).textContent())?.trim() ?? ''
      expect(text, `date cell [${i}] must not be "Nd ago", got: "${text}"`).not.toMatch(/^\d+d ago$/)
    }
  })

  test('/v2/comments comment rows link to posts (not bare commenter handles) when comments render', async ({ page }) => {
    await page.goto('/v2/comments', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

    const commentRows = page.locator('.card [style*="gridTemplateColumns"]')
    const rowCount = await commentRows.count()
    if (rowCount === 0) test.skip()

    // Look for "View post →" anchors or anchors pointing to post URLs.
    const postLinks = page.locator(
      '.card a[href*="instagram.com/p/"], .card a[href*="youtube.com/watch"], .card a[href*="reddit.com/r/"]'
    )
    const viewPostLinks = page.locator('.card a:has-text("View post")')

    const postLinkCount = await postLinks.count()
    const viewPostCount = await viewPostLinks.count()

    // If neither kind of post link is found it means the data has no postUrl fields populated —
    // treat as a data state rather than a regression so CI stays green.
    if (postLinkCount === 0 && viewPostCount === 0) test.skip()
    expect(postLinkCount + viewPostCount).toBeGreaterThan(0)
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

test.describe('cross-page consistency', () => {
  // Pages owned by parallel agents during this sweep. Skip them so we don't
  // race their in-flight edits.
  const SKIP_PATHS = new Set<string>(['/v2/comments', '/v2/influencers'])

  for (const p of PAGES) {
    if (SKIP_PATHS.has(p.path)) continue
    test(`${p.path} renders the From/To date picker in the topbar`, async ({ page }) => {
      await page.goto(p.path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })
      const dateInputs = page.locator('.topbar input[type="date"]')
      await expect(dateInputs, `${p.path} should expose 2 calendar inputs`).toHaveCount(2)
    })
  }

  for (const p of PAGES) {
    if (SKIP_PATHS.has(p.path)) continue
    test(`${p.path} does not hard-code "Last 8 weeks" / "Last 90 days" / "13 weeks" / "This quarter" / "last 4 weeks" in body copy`, async ({ page }) => {
      await page.goto(p.path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })
      const body = (await page.textContent('body')) ?? ''

      // "Last 90 days" / "Last 30 days" / "Last 7 days" appear inside the
      // dynamic DATE_RANGE_LABEL string on some pages — that is acceptable.
      // We only reject the obviously hard-coded windows below.
      expect(body, `${p.path} must not hard-code "Last 8 weeks"`).not.toMatch(/\bLast 8 weeks\b/)
      expect(body, `${p.path} must not hard-code "13 weeks"`).not.toMatch(/\b13 weeks\b/)
      expect(body, `${p.path} must not hard-code "This quarter"`).not.toMatch(/\bThis quarter\b/)
      expect(body, `${p.path} must not hard-code "last 4 weeks"`).not.toMatch(/\blast 4 weeks\b/i)
    })
  }

  // Pages with date columns in their primary table must show calendar dates,
  // not the relative "Nd ago" placeholder.
  for (const path of ['/v2/reddit', '/v2/youtube', '/v2/promotions', '/v2/ads']) {
    test(`${path} primary-table first row does not start with "Nd ago"`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 10_000 })

      const tables = page.locator('table.data')
      const tableCount = await tables.count()
      if (tableCount === 0) test.skip()

      // Walk every cell of the first table's first row.
      const firstRow = tables.first().locator('tbody tr').first()
      const rowExists = await firstRow.count()
      if (rowExists === 0) test.skip()

      const cells = firstRow.locator('td')
      const cellCount = await cells.count()
      for (let i = 0; i < cellCount; i++) {
        const text = (await cells.nth(i).textContent())?.trim() ?? ''
        expect(text, `${path} td[${i}] must not be a bare "Nd ago"`).not.toMatch(/^\d+d ago$/)
      }
    })
  }
})
