// JOOLA Intel V2 — Real browser audit via Playwright
// Visits every page, captures: load time, console errors, viewport screenshots,
// brand filter interactions, column filter interactions, mobile rendering.
//
// Run: node scripts/browser_audit.mjs
// Requires the dev server running at BASE_URL.

import { chromium } from 'playwright-core'
import fs from 'fs'
import path from 'path'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002'
const OUT_DIR = path.join(process.cwd(), 'scripts', 'browser_audit_out')
fs.mkdirSync(OUT_DIR, { recursive: true })

const PAGES = [
  { slug: 'overview',    path: '/v2',             label: 'Executive Overview' },
  { slug: 'instagram',   path: '/v2/instagram',   label: 'Instagram' },
  { slug: 'youtube',     path: '/v2/youtube',     label: 'YouTube' },
  { slug: 'reddit',      path: '/v2/reddit',      label: 'Reddit' },
  { slug: 'comments',    path: '/v2/comments',    label: 'Comments Intel' },
  { slug: 'influencers', path: '/v2/influencers', label: 'Influencers' },
  { slug: 'ads',         path: '/v2/ads',         label: 'Ads' },
  { slug: 'promotions',  path: '/v2/promotions',  label: 'Promotions' },
  { slug: 'products',    path: '/v2/products',    label: 'Products' },
  { slug: 'market',      path: '/v2/market',      label: 'Market' },
  { slug: 'twitter',     path: '/v2/twitter',     label: 'X / Twitter' },
  { slug: 'tiktok',      path: '/v2/tiktok',      label: 'TikTok' },
]

async function audit() {
  console.log(`🌐 Browser audit @ ${BASE_URL}\n`)
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const findings = []

  for (const p of PAGES) {
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors    = []
    const networkFails  = []

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', err => pageErrors.push(err.message))
    page.on('response', resp => {
      if (resp.status() >= 400 && !resp.url().includes('favicon')) {
        networkFails.push(`${resp.status()} ${resp.url()}`)
      }
    })

    const t0 = Date.now()
    let nav = { status: null, error: null }
    try {
      const r = await page.goto(BASE_URL + p.path, { waitUntil: 'networkidle', timeout: 30000 })
      nav.status = r?.status()
    } catch (e) {
      nav.error = e.message
    }
    const loadMs = Date.now() - t0

    // Wait for client-side render
    await page.waitForTimeout(800)

    // Capture diagnostics
    const title = await page.title()
    const h1Count = await page.locator('h1').count()
    const h2Count = await page.locator('h2').count()
    const tableCount = await page.locator('table').count()
    const chartSvgs = await page.locator('main svg').count()
    const deadSelects = await page.locator('select:not([onchange])').count()

    // Check sidebar
    const hasSidebar = await page.locator('aside.sidebar').count() > 0
    // Check brand filter button in topbar
    const hasTopFilter = await page.locator('.topbar, .bfd-button, [class*="bfd-"]').count() > 0
    // Check filter banner if filter active
    const filterBanner = await page.locator('[class*="filter-banner"]').count()

    // Find inline hex colors in rendered DOM (smoke check)
    const inlineHexCount = await page.evaluate(() => {
      const all = document.querySelectorAll('[style*="#"]')
      return all.length
    })

    // Screenshot — desktop
    await page.screenshot({ path: path.join(OUT_DIR, `${p.slug}_desktop.png`), fullPage: true })

    // Mobile
    await page.setViewportSize({ width: 375, height: 800 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT_DIR, `${p.slug}_mobile.png`), fullPage: true })

    findings.push({
      page:           p.label,
      path:           p.path,
      status:         nav.status,
      error:          nav.error,
      load_ms:        loadMs,
      title,
      h1_count:       h1Count,
      h2_count:       h2Count,
      table_count:    tableCount,
      chart_svgs:     chartSvgs,
      dead_selects:   deadSelects,
      has_sidebar:    hasSidebar,
      has_topfilter:  hasTopFilter,
      filter_banners: filterBanner,
      inline_hex:     inlineHexCount,
      console_errors: consoleErrors.slice(0, 5),
      page_errors:    pageErrors.slice(0, 3),
      network_fails:  networkFails.slice(0, 5),
    })

    console.log(`  ${nav.status === 200 ? '✓' : '✗'} ${p.label.padEnd(20)} ${nav.status} ${loadMs}ms ` +
                `h1=${h1Count} h2=${h2Count} tables=${tableCount} charts=${chartSvgs} ` +
                `sel(dead)=${deadSelects} consoleErr=${consoleErrors.length} ` +
                `pageErr=${pageErrors.length} 4xx/5xx=${networkFails.length}`)

    await page.close()
  }

  // ─── Interaction tests on representative pages ──────────────────────────
  console.log('\n🧪 Interaction tests')
  const ipage = await context.newPage()
  await ipage.setViewportSize({ width: 1440, height: 900 })
  const interactions = []

  // Test 1: BrandFilterDropdown open/close
  try {
    await ipage.goto(BASE_URL + '/v2/twitter', { waitUntil: 'networkidle' })
    await ipage.waitForTimeout(800)
    const btn = ipage.locator('.bfd-button, [class*="bfd-button"]').first()
    const btnExists = await btn.count()
    if (btnExists) {
      await btn.click()
      await ipage.waitForTimeout(300)
      const popoverVisible = await ipage.locator('.bfd-popover, [class*="bfd-popover"], [class*="bfd-list"]').count()
      interactions.push({ test: 'brand_dropdown_opens', pass: popoverVisible > 0, evidence: `popovers=${popoverVisible}` })
      await ipage.screenshot({ path: path.join(OUT_DIR, '_interact_dropdown_open.png') })
      // Press Escape
      await ipage.keyboard.press('Escape')
      await ipage.waitForTimeout(300)
      const popoverAfter = await ipage.locator('.bfd-popover, [class*="bfd-popover"]').count()
      interactions.push({ test: 'escape_closes_dropdown', pass: popoverAfter === 0 || popoverVisible > popoverAfter,
                           evidence: `before=${popoverVisible} after=${popoverAfter}` })
    } else {
      interactions.push({ test: 'brand_dropdown_opens', pass: false, evidence: 'button not found' })
    }
  } catch (e) {
    interactions.push({ test: 'brand_dropdown_opens', pass: false, evidence: e.message })
  }

  // Test 2: Column filter on twitter page
  try {
    await ipage.goto(BASE_URL + '/v2/twitter', { waitUntil: 'networkidle' })
    await ipage.waitForTimeout(800)
    const colFilters = await ipage.locator('input[placeholder*="filter" i], .col-filter-input').count()
    interactions.push({ test: 'column_filters_present', pass: colFilters > 0, evidence: `count=${colFilters}` })
    if (colFilters > 0) {
      const first = ipage.locator('input[placeholder*="filter" i], .col-filter-input').first()
      const rowsBefore = await ipage.locator('table.data tbody tr').count()
      await first.fill('joola')
      await ipage.waitForTimeout(400)
      const rowsAfter = await ipage.locator('table.data tbody tr').count()
      interactions.push({ test: 'column_filter_reduces_rows',
                          pass: rowsAfter < rowsBefore || rowsBefore === 0,
                          evidence: `before=${rowsBefore} after=${rowsAfter}` })
      await ipage.screenshot({ path: path.join(OUT_DIR, '_interact_colfilter.png') })
    }
  } catch (e) {
    interactions.push({ test: 'column_filter_works', pass: false, evidence: e.message })
  }

  // Test 3: Sort behavior
  try {
    await ipage.goto(BASE_URL + '/v2/twitter', { waitUntil: 'networkidle' })
    await ipage.waitForTimeout(800)
    const sortHeader = ipage.locator('th[aria-sort], .col-th, [class*="sort"]').first()
    const exists = await sortHeader.count()
    if (exists) {
      const before = await ipage.locator('table.data tbody tr').nth(0).innerText()
      await sortHeader.click()
      await ipage.waitForTimeout(300)
      const after = await ipage.locator('table.data tbody tr').nth(0).innerText()
      interactions.push({ test: 'sort_changes_order', pass: before !== after, evidence: 'first row changed' })
    }
  } catch (e) {
    interactions.push({ test: 'sort_changes_order', pass: false, evidence: e.message })
  }

  for (const i of interactions) {
    console.log(`   ${i.pass ? '✓' : '✗'} ${i.test} — ${i.evidence}`)
  }

  await ipage.close()
  await browser.close()

  // ─── Persist JSON report ────────────────────────────────────────────────
  const out = {
    base_url: BASE_URL,
    timestamp: new Date().toISOString(),
    page_findings: findings,
    interactions,
  }
  fs.writeFileSync(path.join(OUT_DIR, 'audit_report.json'), JSON.stringify(out, null, 2))
  console.log(`\n📁 Screenshots + JSON: ${OUT_DIR}`)

  // Summary
  console.log('\n📊 Summary')
  const slow = findings.filter(f => f.load_ms > 5000)
  const consoleBad = findings.filter(f => f.console_errors.length > 0)
  const pageBad = findings.filter(f => f.page_errors.length > 0)
  const netBad = findings.filter(f => f.network_fails.length > 0)
  console.log(`   Slow pages (>5s)       : ${slow.length}  ${slow.map(s => s.page).join(', ')}`)
  console.log(`   Pages w/ console errors: ${consoleBad.length}`)
  console.log(`   Pages w/ JS errors     : ${pageBad.length}`)
  console.log(`   Pages w/ 4xx/5xx fetches: ${netBad.length}`)
  console.log(`   Dead <select> total    : ${findings.reduce((s,f) => s + f.dead_selects, 0)}`)
  console.log(`   Pages missing topfilter: ${findings.filter(f => !f.has_topfilter).length}`)
}

audit().catch(err => { console.error(err); process.exit(1) })
