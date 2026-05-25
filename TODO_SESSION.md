# JOOLA Intel — Pending Work

Pending action items only. Historical completed work has been removed (see
`git log` for past changes). Update this file by **removing** items as they
complete and **adding** new pending items as they're discovered.

---

## USER ACTIONS (blocking — Claude cannot run these)

### 1. Apply migration 016: `product_reviews` table

The scraper + AI enricher + facts wiring is ready in code, but the table doesn't exist yet.

- File: `migrations/016_product_reviews.sql`
- Apply via [Supabase SQL editor](https://supabase.com/dashboard/project/loecyghnkkxyymelgexz/sql) — paste, click Run.
- Failure mode if skipped: `python -m backend.scraping.run --module reviews` will 404 on every insert.

### 2. Extract per-brand widget credentials for product_reviews scraper

The scraper at `backend/scraping/sources/products/scrape_reviews.py` has a `WIDGET_CONFIG` dict with `needs_inspector: True` entries. Each brand needs its credentials filled in:

| Brand | Need to extract | From URL like |
|---|---|---|
| selkirk | `bv_passkey` | `https://api.bazaarvoice.com/data/reviews.json?passkey=XXX...` |
| onix | `bv_passkey` | same |
| wilson | `bv_passkey` | same |
| franklin | `bv_passkey` | same |
| joola | `jm_shop_domain` | `https://judge.me/api/v1/reviews?shop_domain=joolausa.myshopify.com&...` |
| paddletek | `jm_shop_domain` | same |
| crbn | `jm_shop_domain` | same |
| gamma | `jm_shop_domain` | same |

How: open brand product detail page (e.g. selkirk.com/products/project-boomstik) in Chrome → DevTools → Network tab → filter "reviews" or "bazaarvoice" or "judge.me" → copy query parameters into the `WIDGET_CONFIG` dict.

Start with **selkirk** to validate end-to-end against Project Boomstik (2,383 reviews — should be the canary).

### 3. Run end-to-end review pipeline after credentials set

```powershell
rm -f C:\Workspace\pipeline_v2_state.prev C:\Workspace\pipeline_v2_state.json
python -m backend.scraping.run --module reviews --restart       # scrape (default: 20 products × 50 reviews)
python -m backend.scraping.run --module enrichment --restart    # AI sentiment/NER
python -m backend.scraping.run --module facts --restart         # surface as channel='product_review'

# Verify
curl.exe -s -I -H "apikey: $env:SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $env:SUPABASE_SERVICE_ROLE_KEY" -H 'Prefer: count=exact' "$env:SUPABASE_URL/rest/v1/mention_facts?select=id&channel=eq.product_review" 2>&1 | Select-String 'Content-Range'
```

### 4. Validate Track B (rating backport for 6 brands)

The local Playwright scraper now has rating selectors for joola/six-zero/onix/franklin/head/wilson (was engage only). Validate by running the next product scrape and checking fill rates:

```powershell
python -m backend.scraping.run --module products --restart
```

Then per-brand fill check:
```sql
select b.slug,
       count(*)                                       as total,
       count(p.avg_rating)                            as has_rating,
       round(100.0 * count(p.avg_rating) / count(*))  as pct_rating,
       count(p.review_count)                          as has_reviews
from products p join brands b on b.id = p.brand_id
where p.category = 'paddle' and p.last_scraped_at >= now() - interval '24 hours'
group by b.slug order by b.slug;
```

Expected fill rates (per Track B docs):
- joola 60-100%, six-zero 50-90%, onix 30-80% (BV lazy-render risk), franklin 40-80%, wilson 30-80%, head 0% (no widget — intentional), engage ~100%.

If **onix** stays at 0%, raise `extra_wait` in `scrape_catalog_local.py` BRAND_SCRAPERS from 8000 → 12000ms and add a scroll-to-bottom step inside `_scrape_brand`.

### 5. Fix `topic_lifecycle` schema cache error

Every `python -m backend.scraping.run --module facts` logs:
```
PGRST204: Could not find the 'brand_id' column of 'topic_lifecycle' in the schema cache
```

Diagnose via SQL editor:
```sql
select column_name from information_schema.columns where table_name='topic_lifecycle';
```

If `brand_id` is **missing**: write a migration that adds it + backfills from joined channel tables.
If `brand_id` **exists**: run `notify pgrst, 'reload schema';` in SQL editor to refresh PostgREST cache.

Currently every facts run says "✓ 0 topic_lifecycle rows upserted (1826 unique topics across 5 channels)" — full pipeline silently loses topic data.

### 6. Fix `product_aliases` schema mismatch

Live schema: `id, canonical_name, alias, platform, confidence, created_at`.
Matcher expects: `product_id, brand_id, alias, alias_norm, confidence, is_ambiguous`.

This breaks `analyze_videos.py` (video-level paddle NER) and `populate_product_mentions.py`. mention_facts is unaffected (uses `products_catalog.aliases` JSON directly).

Fix path: write a migration that adds the missing columns + backfills `product_id` by joining `canonical_name` → `products_catalog.display_name`.

---

## ENGINEERING PUNCH LIST (Claude can do; queue for next session)

### Frontend

- **YouTube comments scraper returns 0 rows** even on full scrape. Apify actor `streamers/youtube-comments-scraper` may need individual video URLs rather than channel URL input. Investigate `backend/scraping/sources/youtube/scrape_comments.py`. Low priority — `yt_comments` already-stored rows enrich correctly.
- **"Best-rated paddle per brand" KPI strip** at top of /v2/product-intel — deferred. The Section 7 table columns are sufficient for now.
- **Product-level discount filter** on `/v2/campaign-offer-intel` — currently only filters by sitewide banner discounts. Could add a "products on sale" toggle that filters `products.discount_pct > 0`.
- **Strike-through rendering of `price → sale_price`** on product table — currently shown as separate columns.
- **Visual sparkline of rating trend over time per product** — needs a `product_rating_history` table (separate migration).
- **Per-paddle review-text rendering** on `/v2/product-intel` — when migration 016 lands, surface top 3 reviews per product (expandable row, sort by helpful_count).
- **Section 2 — Community trend date desync**: when user sets a custom date filter window, `filteredTrend` may still be keyed on un-filtered fetch range. Trace `frontend/app/v2/community-intel/page.tsx` `filteredTrend` computation; rebuild via useMemo from `filteredSignals` instead of using `data.trend` directly.
- **Section 7 — Internal "Review required" tables** still visible on `/v2/instagram` and `/v2/twitter`. Wrap in `process.env.NODE_ENV !== 'production'` or move to `/v2/_dev`.
- **Section 11 — Sales Intel actionability**: add executive-summary card above the 4 sub-tables aggregating "where are sales going?" (top 3 trending up/down, biggest gainers, biggest price drops).
- **Section 13 — Platform takeaway sections** at bottom of each of 5 platform pages (instagram/youtube/reddit/twitter/tiktok): add small `Platform takeaway` card with JOOLA position vs top competitor + WoW indicator + one-line "what to do".
- **Section 14 — JOOLA visibility consistency**: spot-check every chart highlights JOOLA the same way (green ring + label-always-on). Grep for `=== 'joola'` and confirm the styling branch always renders JOOLA's row/dot/bar even when value is 0.
- **Section 15 — Number / date / unit formatting** audit. `app/v2/sales-intel/page.tsx` revenue, `app/v2/changepoints/page.tsx` dates, `app/v2/product-intel/page.tsx` price formatting all need a once-over.
- **Section 16 — Empty state coverage**: pages like sales-intel + product-intel matrix may still render blank cards on zero-filter-rows. Use the standard `<div className="card" style={{ textAlign: 'center', padding: 48 }}>` pattern.

### Backend / scrapers

- **Pagination for product_reviews** (v2 enhancement). v1 fetches page 1 only — Boomstik's 2,383 reviews cap at ~50. Walk `Offset` (BV) / `page` (Judge.me) until empty in `scrape_reviews.py`.
- **Selkirk YT subscriber inflation** — yt_channel_weekly may still show 142K vs live ~17K. Inspect yt_channels for the brand_id, confirm channel_id is the `@SelkirkSport` canonical handle, fix or DELETE stale rows.
- **Franklin + Wilson YouTube cleanup** — these brands have no pickleball-specific YT channel. The `brands.yaml` mapping points at parent corporate channels. Either remove the youtube: line or purge stale rows via REST DELETE (commands in git history pre-2026-05-25).
- **AI enrichment doesn't cover `product_reviews` yet at runtime** — code is wired in `ai_enricher.py TABLES` but migration 016 must apply first or the enricher fails fast on the table-missing error.

### Data quality

- **45 → 42 player roster discrepancy** in `frontend/lib/v2/playerRoster.ts`. Set dedupes 3 multi-brand players (Parris Todd, Riley Newman, Steve Deakin). If business expected 43rd, identify and add.
- **Six-zero AUD pricing** — rows have `price_usd=NULL`, `currency='AUD'`. Add FX conversion or a `price_aud` column so six-zero shows in price-tier analysis.

---

## KNOWN SOFT SPOTS (watch list — not necessarily actionable yet)

- **Apify `streamers/youtube-comments-scraper`** sometimes returns FAILED runs — handled with retry, but if 2+ runs fail in a row, the actor may be down. Check Apify console.
- **Bazaarvoice widgets lazy-render** for ~5-10s. Scraper now waits 8000ms for onix/wilson; if a future page change extends this, raise the wait.
- **OpenAI `gpt-4o-mini` rate limits** — current pipeline uses 8 concurrent workers (`ENRICH_WORKERS=8`). Tier 1 OpenAI account caps at 500 RPM, which is comfortable for current volume but would throttle a 10x scale-up.
- **PostgREST schema cache** — after any migration that adds columns referenced by existing code, run `notify pgrst, 'reload schema';` in SQL editor to avoid PGRST204 errors. (See `topic_lifecycle.brand_id` failure above.)
- **mention_facts._clear_channel_facts(channel)** deletes the whole channel before re-insert. Re-runs are safe but transient gaps will be visible to the frontend during the few-second DELETE → INSERT window.
- **Checkpoint files at `C:\Workspace\pipeline_v2_state*`** sometimes hit `FileExistsError` on `--restart`. Delete manually before retrying if that error appears.

---

## ONE-LINER REFERENCE

```powershell
# Full weekly pipeline
rm -f C:\Workspace\pipeline_v2_state.prev C:\Workspace\pipeline_v2_state.json
python -m backend.scraping.run --module all --restart

# Just enrichment + facts (idempotent re-run after manual fix)
python -m backend.scraping.run --module enrichment
python -m backend.scraping.run --module facts

# Analytics rollup (marts + statistics)
python -m analytics_backend.run --module all

# Brand-scoped tests
python -m backend.scraping.run --module youtube --brands joola --restart
python -m backend.scraping.run --module tiktok --brands selkirk --restart

# Frontend
cd frontend; npx tsc --noEmit; npm run dev
```

Env load helper (one-time per PowerShell session):
```powershell
Get-Content c:\Workspace\joola-intel-nextjs\.env | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim() }
}
```

## Ask Intel — net-new build (2026-05-25)

### Files
- Schema: frontend/lib/v2/askIntel/schema.ts (40K — tables/columns/metrics)
- Safety: frontend/lib/v2/askIntel/sqlSafety.ts
- Types:  frontend/lib/v2/askIntel/types.ts
- API:    frontend/app/api/v2/ask-intel/route.ts (POST + GET /schema + GET /suggestions)
- Page:   frontend/app/v2/ask-intel/page.tsx
- Components: frontend/components/v2/askIntel/*.tsx
- Sidebar: added "Ask Intel" entry

### Architecture
Two-step OpenAI flow (planner → executor → answerer).
Structured plan (not raw SQL) — translates to typed supabase-js calls; no need for exec_safe_sql RPC.
JOOLA green #22c55e throughout. Reuses existing charts.tsx primitives.

### USER ACTIONS
- Add OPENAI_API_KEY (server-only, no NEXT_PUBLIC_) to frontend/.env.local AND Vercel env vars.
- Optionally create read-only DB role + RLS policies for defense in depth.

### Cost
~$0.003 per question (gpt-4o-mini planner + answerer ≈ 2k input + 1k output each).

### Known limitations
- v1 supports table/select/filter/groupBy/orderBy only — no arbitrary joins beyond schema.ts join hints.
- Complex CTEs not supported in v1.
- Future v2: exec_safe_sql stored proc with explicit read-only role.
