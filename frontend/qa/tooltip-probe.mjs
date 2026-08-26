import { chromium } from 'playwright-core'

const BASE = process.argv[2] || 'http://localhost:3100'
const PATH = process.argv[3] || '/v2/products'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto(BASE + PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
try {
  await page.waitForSelector('.section-info', { timeout: 90_000, state: 'attached' })
} catch {}

const n = await page.locator('.section-info').count()
console.log(`${PATH}: ${n} icons, h2=${await page.locator('h2').count()}`)

// try each of the first few icons until one produces a popup
for (let i = 0; i < Math.min(n, 5); i++) {
  const ic = page.locator('.section-info').nth(i)
  try {
    await ic.scrollIntoViewIfNeeded()
    await ic.hover({ force: true })
    await page.waitForTimeout(600)
  } catch (e) {
    console.log(`  icon ${i}: hover threw ${String(e).slice(0, 60)}`)
    continue
  }
  const r = await page.evaluate(() => {
    const p = document.querySelector('.si-popup')
    if (!p) return { mounted: false }
    const cs = getComputedStyle(p)
    const b = p.getBoundingClientRect()
    return { mounted: true, display: cs.display, opacity: cs.opacity,
             w: Math.round(b.width), h: Math.round(b.height),
             title: p.querySelector('.si-title')?.textContent }
  })
  console.log(`  icon ${i}:`, JSON.stringify(r))
  if (r.mounted && Number(r.opacity) > 0.9) {
    console.log('  -> VISIBLE, tooltips work on this page')
    break
  }
}
await browser.close()
