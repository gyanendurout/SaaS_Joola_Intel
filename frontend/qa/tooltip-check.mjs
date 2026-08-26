/**
 * Tooltip smoke check.
 *
 * Guards the regression fixed on 2026-08-24: `.si-popup` carried `display: none`
 * with no rule to un-hide it, so every SectionInfo (?) tooltip on every v2 page
 * mounted but rendered invisible. A DOM-presence assertion would NOT have caught
 * that — the element was in the DOM the whole time. This asserts *computed
 * visibility* and non-zero box size instead.
 *
 *   node qa/tooltip-check.mjs [baseUrl]
 */

import { chromium } from 'playwright-core'

const BASE = process.argv[2] || 'http://localhost:3000'
const PAGES = [
  '/v2',
  '/v2/ads',
  // '/v2/ask-intel' — chat UI, no static sections to annotate
  '/v2/campaign-offer-intel',
  '/v2/changepoints',
  '/v2/comments',
  '/v2/community-intel',
  '/v2/correlations',
  '/v2/crisis',
  '/v2/data-health',
  '/v2/influencers',
  '/v2/instagram',
  '/v2/leaderboard',
  '/v2/market',
  '/v2/overview',
  '/v2/product-intel',
  '/v2/products',
  '/v2/products-intel',
  '/v2/promotions',
  '/v2/reddit',
  '/v2/sales-intel',
  '/v2/tiktok',
  '/v2/twitter',
  '/v2/youtube',
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

let failures = 0
let checked = 0

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120_000 })

  // These are client pages that fetch from Supabase before any section renders —
  // a fixed wait is what made an earlier version of this script report
  // "NO TOOLTIP ICONS FOUND" on a perfectly healthy page. Wait for the icons.
  try {
    await page.waitForSelector('.section-info', { timeout: 90_000, state: 'attached' })
  } catch { /* fall through to the count check below, which reports it */ }

  const icons = page.locator('.section-info')
  const n = await icons.count()
  if (n === 0) {
    // Distinguish a page that never rendered (slow/failed fetch) from one that
    // rendered fine but genuinely has no tooltips — very different bugs.
    const rendered = await page.evaluate(() => ({
      h2: document.querySelectorAll('h2').length,
      len: document.body.innerText.length,
    }))
    const why = rendered.h2 === 0
      ? `PAGE NEVER RENDERED (h2=0, text=${rendered.len})`
      : `RENDERED BUT NO TOOLTIPS (h2=${rendered.h2})`
    console.log(`  ${path.padEnd(28)} FAIL ${why}`)
    failures++
    continue
  }

  // Try the first few icons, not just the first. A single icon can be under a
  // sticky header or still settling, which produced false FAILs on pages whose
  // tooltips were provably fine. force:true also sidesteps Next's dev overlay,
  // which sits above the page and swallows pointer events.
  let result = { mounted: false }
  for (let i = 0; i < Math.min(n, 4); i++) {
    try {
      const ic = icons.nth(i)
      await ic.scrollIntoViewIfNeeded()
      await ic.hover({ force: true })
    } catch { continue }

    // The popup animates in (scaleIn 0.15s). Sampling mid-animation reads
    // opacity:0 and a partial box — indistinguishable from the display:none
    // bug this guards. Wait for it to settle before asserting.
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector('.si-popup')
        if (!el) return false
        const cs = getComputedStyle(el)
        return Number(cs.opacity) > 0.9 && el.getBoundingClientRect().width > 0
      }, { timeout: 4000 })
    } catch { /* fall through; the evaluate below records the real state */ }

    result = await page.evaluate(() => {
    const pop = document.querySelector('.si-popup')
    if (!pop) return { mounted: false }
    const cs = getComputedStyle(pop)
    const r = pop.getBoundingClientRect()
    return {
      mounted: true,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      w: Math.round(r.width),
      h: Math.round(r.height),
      title: pop.querySelector('.si-title')?.textContent || '',
      body: (pop.querySelector('.si-body')?.textContent || '').slice(0, 60),
    }
    })
    if (result.mounted && Number(result.opacity) > 0.9) break
  }

  checked++
  const visible =
    result.mounted &&
    result.display !== 'none' &&
    result.visibility !== 'hidden' &&
    Number(result.opacity) > 0 &&
    result.w > 0 && result.h > 0

  if (visible) {
    console.log(`  ${path.padEnd(28)} OK   ${n} icons | popup ${result.w}x${result.h} | "${result.title}"`)
  } else {
    failures++
    console.log(`  ${path.padEnd(28)} FAIL ${n} icons | ${JSON.stringify(result)}`)
  }
}

await browser.close()
console.log(`\n${checked} pages checked, ${failures} failing`)
process.exit(failures > 0 ? 1 : 0)
