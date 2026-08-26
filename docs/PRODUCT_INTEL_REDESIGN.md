# Product Intel redesign — design document

> Status: **design, awaiting approval to implement**. Author: session 2026-08-26.
> Requirement owner: Gyanendu Rout. Supersedes nothing yet — the current page
> stays live until Phase 3 lands.

---

## 1. Understanding summary

Rebuild `/v2/product-intel` around seven requirements:

1. Paddles only — no bags, hats, apparel, accessories
2. Top 10 products per brand
3. Ranked by real-world fame, derived from customer reviews and social signal
4. Price comparison
5. Technology comparison
6. Mention count per product, per competitor
7. Keep the Tier concept as it exists today

**Brands in scope (7):** JOOLA, Selkirk, CRBN, Paddletek, Engage, Six Zero, Franklin.
Gamma, Onix, Wilson and Head are excluded from this page for now — they have no
review signal from any source. They remain tracked everywhere else in the app.

**Non-goals for this phase:** product comments (explicitly deferred by the
requirement owner), Amazon integration (Phase 4), and the four excluded brands.

---

## 2. Data reality — what the audit found

Three product tables exist with **no join keys between them**:

| Table | Rows | Space | Holds |
|---|---|---|---|
| `products_catalog` | 86 | mention side | what `mention_facts` / `product_attention_*` key to |
| `products` | 474 | storefront scrape | price, some review counts |
| `paddle_products` | 702 | review side | what `paddle_reviews` keys to |

`paddle_reviews.product_id` resolves **only** to `paddle_products`. Mention data
resolves **only** to `products_catalog`. Zero overlap. Any blend needs a bridge
that does not exist in the DB today.

### Blockers confirmed against the live DB

- **Every spec column in the schema is 100% NULL.** `product_variants.thickness`,
  `.weight`, `.color`, `.size` are empty across all 9,317 rows.
  `products.ai_category` is empty across all 474. The schema was designed for
  specs and never populated. **Technology comparison has no source data today.**
- **`products.category` is corrupted.** It mixes a skill-tier vocabulary
  (`Entry` 51, `Mid` 51, `Advanced` 21, `Pro` 17) into the same column as
  `paddle` (331). Rows tagged `paddle` include a hat, a tour bag, arm sleeves,
  and scraper junk (`SHOP`, `ABOUT`, `14MM`, `Thickness`).
  `products_catalog.category` is clean — 86/86 `paddle`.
- **`paddle_products.family_id` is 0/702 filled**, so variants do not collapse.
  Selkirk's Project Boomstik occupies 4 separate top-10 slots as distinct SKUs.
- **`mention_facts` brand attribution is unreliable** — 28 of 49 product_ids
  appear under more than one `brand_id`; 547 rows contradict the catalog. Always
  attribute via `products_catalog.brand_id`.
- **Amazon data does not exist.** One stray ASIN (`B0CP8L7XZ1`, Selkirk SLK ×
  Dude Perfect) in `products.url` and 6 `product_snapshots` rows, with no price,
  rating or reviews captured.
- **`joola_timeseries_daily` stopped at 2026-05-24.** The current page's
  "Product attention leaderboard" queries it with a 28-day window, which now
  matches zero rows. That section has been rendering empty since ~late June.

### What works

- `product_attention_summary` (191 rows, newest 2026-08-24) and
  `product_attention_daily` (514 rows, newest 2026-08-23) are **fresh** and
  carry a per-channel mention split.
- `paddle_reviews` = 26,798 rows, `brand_id` on 100%.
- All 7 in-scope brands clear 10 paddles with review signal.

---

## 3. Site recon — what is actually scrapable

**Six of seven brands are Shopify with an open `/products.json`. All spec data is
server-rendered.** No JS rendering, no Playwright, no Apify credits required.

| Brand | Platform | Spec carrier | Difficulty |
|---|---|---|---|
| JOOLA | Shopify | HTML spec table `#ProductTabsWrapper custom-tabs table tr` | easy |
| Selkirk | Shopify | metafield `div#tech-specs .metafield-rich_text_field` | easy |
| CRBN | Shopify | comparison grid `.comparison-grid-rows-*` | easy* |
| Paddletek | Shopify | `.ptk-specs__row` + Section Rendering API per variant | easy |
| Engage | Shopify | `Specifications:` block inside `body_html` — no HTML fetch needed | easiest |
| Six Zero | Shopify | real HTML table `table.dcf-table tbody tr` | easy |
| Franklin | Adobe Commerce | freeform prose in description | **moderate** |

\* CRBN's `active` CSS class is a decoy — it sits on the same column regardless
of which product is loaded. Match the column by shape/title, never by `.active`.

**Franklin specifics:** Cloudflare Managed Challenge, ~50% 403 on unthrottled
back-to-back requests. Use the apex domain (`franklinsports.com` — `www.` 301s),
browser UA, persistent cookies, throttling. No sitemap; enumerate from
`/sports/pickleball/paddles` (26 product URLs). `robots.txt` has `Disallow: /*?`
— stay on clean paths.

**JSON-LD is useless here.** All six Shopify brands emit `Product` schema with
`additionalProperty: null`.

### Field availability matrix

`P` = published as a labelled field · `PR` = prose only · `V` = variant option only

| Field | JOOLA | Selkirk | CRBN | Paddletek | Engage | Six Zero | Franklin |
|---|---|---|---|---|---|---|---|
| Core thickness | V+PR | P | PR | P+V | P | P | P |
| Total length | P | P | P | P | P | P | P |
| Width | P | P | P | P | P | P | P |
| Handle length | P | P | P | P | P | P | P |
| Static weight | P | P | P | P | P | P | P |
| Shape | P | P | P | P | P | V | P |
| Grip circumference | P | P | P | **—** | P | P | P |
| Core material | P | P | P | PR | P | P | P |
| Face material | P | P | PR | PR | P | P | PR |
| Swing weight | **—** | P | P | P | **—** | P | P |
| Twist weight | **—** | P | P | P | PR | P | P |
| Balance point | **—** | **—** | P | **—** | **—** | **—** | **—** |
| **Spin / RPM** | **—** | **—** | **—** | **—** | **—** | **—** | **—** |
| USAP approval | P | — | — | — | P | P | P |

**Only six fields are available for all seven brands** — core thickness, total
length, width, handle length, static weight, shape. These are the only honest
axes for a cross-brand comparison table. Everything else is a nullable detail
field, shown on a product but never used to rank or compare.

**Nobody publishes spin/RPM.** It is dropped from scope.

**USAP absence means "not stated", not "not certified"** — 4 of 7 publish it
despite all being certified. Never render absence as a negative.

---

## 4. Decision log

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| D1 | Rank **reviews-first, mentions as tiebreak** | mentions-only; blended score; expand catalog first | Reviews are the only signal with enough depth (26,798 rows). Mentions are capped by the 86-row catalog — only Selkirk clears 10 products. |
| D2 | Scope to **7 brands** | all 11; only the 5 with `paddle_reviews` | Requirement owner's call. Gamma/Onix/Wilson/Head have zero review signal, so a ranked top-10 would be fabricated. |
| D3 | **Crawl brand sites for specs** into a new table | parse from product names (39% coverage); review-perception sliders; drop the requirement | Requirement owner's call. Recon then showed it is cheap — 6 of 7 are plain HTTP. |
| D4 | Spec grain = **product × shape × thickness** | one row per product | Multi-shape paddles (Selkirk Epic/Invikta, Six Zero Hybrid/Elongated/Widebody, Engage Elongated/Widebody) publish a different spec set per shape. One row per product would silently drop variants. |
| D5 | Compare on the **6 universal fields only** | compare everything available | A comparison table with holes for 2 of 7 brands is misleading. Non-universal fields still render on the product row, just not in the comparison axis. |
| D6 | Bridge via **longest-alias containment match, brand-scoped** | exact normalized match; fuzzy/Levenshtein | Exact match scored 8%. Containment scores 50–86% of catalog. Fuzzy risks cross-product false positives, which are worse than misses (existing repo rule). |
| D7 | **Surface unmatched high-review paddles** as a catalog-gap panel | hide them | JOOLA Beacon has 316 reviews and is not in `products_catalog` at all. The gap is itself intelligence, and it is the work queue for fixing coverage. |
| D8 | Keep **Tier boundaries** (Value <$100 / Mid $100–199 / Premium $200+), unify the **colors** | keep three renderings; re-derive tiers | Requirement 7 says keep it. Boundaries are already consistent; only the colors disagree (6C uses red for Premium, everywhere else uses yellow). |
| D9 | New standalone pipeline module `product-specs` | fold into weekly `products` run | Specs change rarely; a weekly re-crawl is wasted requests. Mirrors the existing `reviews-crawl4ai` precedent. |
| D10 | **Amazon deferred to Phase 4** | build now alongside specs | Zero usable data today, and Amazon actively blocks scrapers. Two risky crawls should not block one deliverable. |
| D11 | **Retire all 8 legacy sections** | retire only the dead ones; keep everything and add | Nothing currently working is lost — the leaderboard's source mart died 2026-05-24 and 4 of the 8 are fetch functions rendered by nothing. Keeping them would leave two competing product tables on one page. |
| D12 | **Convert AUD→USD at write time**, storing rate + as-of date | show AUD with a marker; hardcode a constant | Six Zero otherwise has no Tier and sits out requirement 4. A stored rate keeps every converted price auditable; a constant rots silently. |
| D13 | **Capture `price_local` before converting** | convert in the scraper only | The AUD figure is currently discarded entirely — `price_usd` is NULL and no column holds the published price. There is nothing in the DB to convert, so capture must come first. |
| D14 | **Checkpoint after each phase** | build all three then review | Requirement owner's call. A wrong schema assumption surfaces before it propagates into the UI. |

---

## 5. Architecture

Three phases. Each ships independently and is separately verifiable.

```
Phase 1  migration 024_paddle_specs.sql        ── new table, real UNIQUE constraint
Phase 2  scrape_specs.py                       ── 7 brand parsers, TDD'd on fixtures
Phase 3  productIntel.ts + page.tsx rebuild    ── the 7 display requirements
Phase 4  (later) Amazon source
```

### 5.1 Schema — `paddle_specs`

Grain: one row per **(brand, source product handle, shape, thickness)**.

```
id                uuid pk
brand_id          uuid not null references brands(id)
source_handle     text not null      -- shopify handle / magento url key
source_url        text not null
product_name      text not null      -- as published by the brand
family_key        text not null      -- normalized, for bridging
shape             text               -- elongated | hybrid | widebody | standard
thickness_mm      numeric(5,2)
length_in         numeric(5,2)
width_in          numeric(5,2)
handle_length_in  numeric(5,2)
weight_oz_min     numeric(4,2)       -- ranges are the norm: "7.7-8.1 oz"
weight_oz_max     numeric(4,2)
grip_circum_in    numeric(4,3)       -- nullable: Paddletek omits
core_material     text
face_material     text
swing_weight      numeric(5,1)       -- nullable: JOOLA + Engage omit
twist_weight      numeric(4,2)       -- nullable
balance_point_mm  numeric(5,1)       -- nullable: CRBN only
usap_approved     boolean            -- null = not stated, NOT false
raw_specs         jsonb not null     -- every label/value pair as scraped
scraped_at        timestamptz not null default now()
source_confidence text not null      -- 'labelled' | 'variant' | 'prose'

unique (brand_id, source_handle, shape, thickness_mm)
```

Three deliberate choices:

- **`raw_specs jsonb` keeps everything.** Parsers will miss fields; the raw pairs
  let us backfill without re-crawling.
- **`source_confidence`** records whether a value came from a labelled field, a
  variant option, or a regex over prose. Franklin and CRBN are prose/grid-derived
  and deserve to be visibly less trustworthy than Selkirk's metafield.
- **`weight_oz_min/max`** because every brand publishes a range, not a number.
  Collapsing to a midpoint loses real information.

`unique (brand_id, source_handle, shape, thickness_mm)` is a **real UNIQUE
CONSTRAINT**, not an expression index — PostgREST `on_conflict` requires that,
and getting it wrong has already broken two marts in this repo.

### 5.2 Scraper — `backend/scraping/sources/products/scrape_specs.py`

Standard contract: `def run(ctx: dict[str, Any]) -> int`, honours `ctx["dry_run"]`
and `ctx["brands"]`, returns rows written, per-brand failures logged not raised.

Structure mirrors `scrape_catalog_local.py`'s `BRAND_SCRAPERS` list, but with a
per-brand **parser function** instead of a JS string, since everything is
server-rendered:

```python
BRAND_SPEC_SOURCES = [
  {"slug": "joola",     "kind": "shopify", "parser": parse_joola,     "throttle": 1.0},
  {"slug": "selkirk",   "kind": "shopify", "parser": parse_selkirk,   "throttle": 1.0},
  {"slug": "crbn",      "kind": "shopify", "parser": parse_crbn,      "throttle": 1.0},
  {"slug": "paddletek", "kind": "shopify", "parser": parse_paddletek, "throttle": 1.0},
  {"slug": "engage",    "kind": "shopify", "parser": parse_engage,    "throttle": 1.0},
  {"slug": "six-zero",  "kind": "shopify", "parser": parse_sixzero,   "throttle": 1.0},
  {"slug": "franklin",  "kind": "magento", "parser": parse_franklin,  "throttle": 4.0},
]
```

**Politeness is explicit, not inherited.** `RateLimiter` exists in
`core/rate_limits.py` and is currently imported by nothing; this module wires it
up. Franklin gets a 4s throttle, persistent cookie jar, browser UA, apex domain,
and clean paths only (its `robots.txt` disallows `/*?`).

**Unit normalisation is the bulk of the work.** Real strings from recon:

```
thickness   16mm · 12.7 mm · 0.55" // 14mm · 13mm Polypropylene
weight      8.0 oz. · 7.7–8.1 oz (EN DASH) · 7.5- 8 OZ. · 8.0 - 8.3 oz // 230gm
length      16.5in · 15.95” (curly) · 16.5" · 16.3” // 413mm · 16.4" inches (L)
grip        4.250in · 4.25” · 4 1/4” (FRACTION) · 4.125"
```

These go through one shared normaliser module with unit tests per format.

### 5.3 Frontend — ranking pipeline

```
paddle_reviews ──group by family_key──> review families (141 across 5 brands)
products.review_count ────────────────> engage, franklin families
                          │
                          ├── rank desc by review count ──> top 10 per brand
                          │
products_catalog ──containment bridge──> attach mention counts (50–86% hit)
paddle_specs ──────family_key join─────> attach specs
products / paddle_products ────────────> attach price → Tier
```

`family_key` is the single join currency. It is computed the same way in Python
(scraper) and TypeScript (frontend), and that duplication is a known risk —
mitigated by a shared fixture set both sides test against.

**All reads stay under the 1,000-row PostgREST cap or page explicitly with
`.range()`.** `paddle_reviews` at 26,798 rows must page; this is the exact bug
class found on 2026-08-24 across 49 other call sites.

### 5.4 Page structure

Replaces the current 15-section sprawl with 7 sections mapping 1:1 to the
requirements:

| § | Section | Requirement |
|---|---|---|
| 1 | Coverage strip — brands, paddles ranked, review corpus, spec fill % | — |
| 2 | **Top 10 per brand** — rank, paddle, Tier, price, reviews, rating, mentions | 1, 2, 3, 7 |
| 3 | **Price comparison** — cross-brand distribution by Tier | 4 |
| 4 | **Technology comparison** — the 6 universal fields, cross-brand | 5 |
| 5 | **Mention count per product** — per-channel split, per competitor | 6 |
| 6 | Catalog gap — high-review paddles missing from tracking | D7 |
| 7 | Customer Voice — retained as-is | existing |

**Retired** (all currently dead or superseded): the attention leaderboard
(source mart is 3 months stale), `fetchStockoutOpportunities`,
`fetchRestockCadence`, `fetchPricePressure`, `fetchAttentionAvailability` — four
functions fully implemented but rendered by nothing today.

---

## 6. Testing strategy

| Layer | Approach |
|---|---|
| Spec parsers | **TDD against the 27 real captures** in `C:\tmp\paddlerecon\` — 12 product JSONs + 12 rendered HTML pages. Copied into `backend/tests/fixtures/paddle_specs/` so tests are hermetic and need no network. |
| Unit normalisers | Table-driven tests over every verbatim format string in §5.2 |
| `family_key` | Same fixture set asserted in **both** Python and TypeScript, guarding the duplicated implementation |
| Bridge | Assert the measured 50–86% catalog coverage as a regression floor — a drop means the matcher broke |
| Scraper run | `--dry-run` then `--brands joola` smoke, per `backend/README.md` recipe |
| DB | `_assert_wrote_something` gives a hard error on a zero-row write for free |
| Frontend | `npm run type-check`, `npm run qa` (incl. the tooltip-visibility gate), plus a paging assertion that no read silently truncates |
| Manual | Verify the 7 requirements against the rendered page |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Franklin Cloudflare blocks the crawl | Throttle + apex + cookies verified in recon; if it hardens, Franklin degrades to prose-parsed partial specs rather than failing the run |
| Brand site redesign silently blanks specs | `scraped_at` + `raw_specs` retained; `_assert_wrote_something` raises on a zero-row write; per-brand counts logged |
| `family_key` drift between Python and TS | Shared fixture set asserted on both sides |
| Bridge over-matches (wrong product) | Longest-alias-first, brand-scoped, containment only — no fuzzy. Repo rule: false positives are worse than misses |
| Six Zero AUD pricing | 11 of 35 rows priced; needs FX conversion or renders "price unavailable" — **open** |
| CRBN mojibake in `canonical_name` (`CRBN\ufffd`) | Depresses CRBN bridge to 50%; fix at source — **open** |

---

## 8. Open items

1. ~~Six Zero FX~~ — resolved (D12/D13): capture `price_local`, convert at write
   time against `fx_rates`. The seeded AUD→USD rate is **manual (0.66, as-of
   2026-08-26)** and should be replaced by a real feed before anyone quotes
   these numbers externally.
2. **CRBN encoding** — `canonical_name` holds a corrupted `®`
   (`CRBN�`), depressing CRBN's bridge hit rate to 50%. The writer lives
   **outside this repo**, so this needs fixing at that source or a cleanup pass
   on read.
3. **Excluded brands** — Gamma/Onix/Wilson/Head return once a review source
   covers them (likely Phase 4 Amazon).

---

## 9. Phase status

| Phase | State | Deliverables |
|---|---|---|
| 0 — truncation fix | **done, verified live** | `frontend/lib/v2/paged.ts` + 27 call sites converted |
| 1 — schema | **applied 2026-08-26** | `migrations/024_paddle_specs.sql`, `migrations/025_fx_rates.sql`, `scripts/db_verify.py` monitoring |
| 2 — scraper | **done, crawled live, 222 tests passing** | `scrape_specs.py`, `spec_parsers.py`, `spec_parse_utils.py`, `spec_normalize.py`, 5 test modules. 184 rows / 119 families / 6 of 7 brands |
| 3 — page | **done, verified against live data** | `frontend/lib/v2/paddleIntel.ts`, `frontend/lib/v2/paddleFamily.ts`, `frontend/app/v2/product-intel/page.tsx`, `backend/tests/test_family_parity.py` |
| 4 — Amazon | deferred | — |

### Phase 0 — silent truncation (found mid-project, fixed first)

PostgREST caps every response at 1,000 rows regardless of `.limit()`. 27 reads
were affected; unordered ones returned the OLDEST 1,000 rows, so pages showed
data frozen in the past and re-scraping never changed them. Verified against the
live DB after the fix:

| Page | Before | After |
|---|---|---|
| Market Intel `mention_facts` 30d | 1,000 rows, newest 2026-08-21 | 2,723 rows, newest 2026-08-24 |
| Community `reddit_comments` | 1,000 rows, newest 2026-08-15 | 2,695 rows, newest 2026-08-24 |
| Community `ig_comments` | 1,000 rows | 8,703 rows |
| Influencer `mention_facts` | 1,000 rows | 1,777 rows |

Every paged query now carries an explicit `ORDER BY` with an `id` tiebreak —
range-paging an unordered result set has no stable row order between requests
and would duplicate and skip rows, trading one silent corruption for another.

### Phase 2 notes — two bugs caught by testing against reality

**The paddle filter rejected every paddle.** `_NOT_PADDLE` matched substrings and
contained `"ball"`, which is inside `"pickleball"`. Live discovery returned 2
products for JOOLA — a luggage tag and a table-tennis set — out of 97 real
paddles, with no error. Now word-bounded, with `backend/tests/test_paddle_filter.py`
pinning it. Also relevant: `product_type` is unusable for filtering, as JOOLA
tags 377 of 391 products "Inventory Item".

**`family_key` split CRBN across notations.** NFKC folds the superscript in
`CRBN²` to a plain digit, giving the token `crbn2`, which the brand strip missed
for lack of a word boundary. `CRBN-2 X-Series` and `CRBN² X Series` — the same
paddle — produced different keys, and neither matched the catalog alias
`CRBN 2`. Fixed; distinct generations (CRBN-2 vs CRBN-3) still stay apart.

**Franklin's parser is UNVERIFIED.** It is the only brand with no fixture, so it
was written from recon notes plus standard Magento markup and has never run
against a real page. Flagged in the code and excluded from value assertions.

**Migrations could not be applied from this environment** — no `exec_sql` RPC
and no direct-connection credentials, only the service-role key, which reaches
PostgREST but cannot run DDL. Both were applied by hand via the Supabase SQL
editor on 2026-08-26 and verified with `scripts/db_verify.py`.

---

### Phase 2 results — the live crawl, 2026-08-26

184 rows, 119 product families, 6 of 7 brands. Core thickness — the field buyers
actually compare — is 87–100% populated everywhere.

| brand | rows | families | thickness | length | weight | shape |
|---|---|---|---|---|---|---|
| joola | 81 | 49 | 99% | 95% | 95% | 15% |
| paddletek | 32 | 24 | 100% | 66% | 66% | 94% |
| selkirk | 25 | 11 | 92% | 40% | 84% | 52% |
| engage | 23 | 18 | 87% | 65% | 87% | 35% |
| six-zero | 14 | 8 | 100% | 100% | 100% | 71% |
| crbn | 9 | 9 | 100% | 100% | 100% | 67% |
| **franklin** | **0** | — | — | — | — | — |

`shape` is low for JOOLA because JOOLA does not publish it as a labelled field
on most paddles — an honest NULL, not a parse failure. Deriving it from
length/width would be an editorial guess presented as scraped data.

**Franklin returned HTTP 403.** Cloudflare's Managed Challenge, exactly the risk
flagged against the one parser that had no fixture. Plain HTTP with throttling
does not defeat it. Options are crawl4ai/Playwright (the repo already runs both
for reviews) or dropping Franklin from the technology comparison. Until then the
page must render a brand with zero specs without breaking — Franklin still has
catalog, price and mention data.

### Phase 2 remediation — three defects found only by crawling for real

**1. Core thickness was lost on 66 of 81 JOOLA paddles.** All 12 fixtures are
flagship paddles, and flagships use an unambiguous `Core Thickness:` label. The
rest of the catalog writes `Core: 14mm` or `Core (mm): 14`. `normalize_label`
strips parentheticals — it must, because Selkirk's swing-weight labels depend on
that strip — so `Core (mm)` folded to `core` and the alias table sent it to
`core_material`, storing the string `"14"` as a material and leaving thickness
NULL. Resolution is now value-driven (`core_fields`), routed through a single
`assign_labelled` entry point so a parser reading a grid rather than a list
cannot bypass it. Thickness fill went **17.3% → 98.8%**; junk in `core_material`
went 66 → 0. `backend/tests/test_core_label.py`.

**2. Improving the parser orphaned every row it improved.** `variant_key` is
derived from shape and thickness and is part of the upsert conflict target, so
fixing thickness *changed the key* — 81 rows became 147, of which 67 were
superseded duplicates that would have been served as current. The crawler now
stamps `scraped_at` itself (a column default fires on INSERT only, so on an
upsert-update it would stay frozen at first-seen forever) and prunes rows it did
not re-confirm, for the brands it actually reached. A brand whose site is down
returns nothing and keeps its existing specs.

**3. Six Zero paddles were priced at $14,124.** Shopify geo-prices by visitor IP.
Crawling from this India-based host, the storefront rendered `Rs. 21,400.00`
while `BRAND_SCRAPERS` hardcodes `currency: "AUD"` — so INR was stored as AUD and
converted at the AUD→USD rate. Nothing objected: 21400 is a well-formed number
and AUD is a well-formed currency. This was never Six Zero-specific — **any**
Shopify brand's prices are wrong whenever the crawl runs from a non-US egress.

Three fixes, layered:
* prices now come from `/products.json`, which is served in the shop's own
  default currency and does not move with the crawler's IP (this also makes the
  `currency` config field true again);
* when falling back to the rendered price, the currency is read off the text
  rather than trusted from config, and a mismatch is reported;
* a price outside the plausible range for a pickleball product is stored as NULL
  rather than as a fact — a hard reject, not a rescaling guess, because dividing
  by 100 "because it looks like cents" would have produced a convincing $214 and
  buried the fault permanently.

Result: no product over $1,000 anywhere; Six Zero's flagship reads AUD 350 →
USD 231; Engage's priced rows went 5 → 17. `backend/tests/test_price_currency.py`.

**4. Filter facets were stored as priced products.** Six Zero's `.grid__item`
selector also matches its filter sidebar, so the catalog held rows named
`Thickness`, `HYBRID`, `14MM` and `Shape` carrying prices — indistinguishable
from products to everything downstream. Whole-string facet matching now rejects
them (a real paddle named "Black Opal 14mm Elongated" is untouched), and the 8
existing rows were deleted.

---

### Phase 3 results — the page, 2026-08-26

70 paddle families across all 7 brands, 18,499 reviews behind the ranking.
Seven sections, one per requirement. Built as two new modules rather than an
edit to `productIntel.ts`: `paddleFamily.ts` (join keys) and `paddleIntel.ts`
(the pipeline). `productIntel.ts` keeps `fetchCustomerVoice` and the drilldown
fetchers.

| brand | ranked | review corpus | priced | specs | tracked |
|---|---|---|---|---|---|
| JOOLA | 10 | 1,987 | 10/10 | 7/10 | 5/10 |
| CRBN | 10 | 10,286 | 8/10 | **1/10** | 2/10 |
| Selkirk | 10 | 6,966 | **2/10** | 4/10 | 6/10 |
| Paddletek | 10 | 1,572 | 8/10 | 8/10 | 6/10 |
| Six Zero | 10 | 1,265 | 7/10 | 4/10 | 7/10 |
| Engage | 10 | 622 | 6/10 | 6/10 | 2/10 |
| Franklin | 10 | 585 | 10/10 | **0/10** | 1/10 |

**The Python↔TypeScript parity risk is now tested, not assumed.**
`family_key` exists in both languages — Python writes `paddle_specs.family_key`
at crawl time, TypeScript computes keys for reviews, prices and mentions in the
browser. Drift would not break anything loudly; the join would simply match
fewer rows and the technology comparison would render blank cells that look
exactly like "the brand doesn't publish that spec".
`backend/tests/test_family_parity.py` compiles the TypeScript with the repo's
own `tsc`, runs both implementations over 633 real product names, and asserts
identical output. It was mutation-tested — removing one word from the
TypeScript `SUBBRAND` list fails it with 15 named mismatches.

### Phase 3 findings

**CRBN publishes no specifications for its best-selling line.** The X Series
accounts for CRBN's top four paddles by review volume (1,880 / 1,670 / 1,072 /
996 reviews) and carries no specs at all — not in the product page, not in the
description, not in `products.json`. Verified directly against the live site, so
this is a fact about CRBN's merchandising, not a parser gap. The page shows the
blanks and says why rather than borrowing a sibling model's numbers.

**Selkirk has prices for only 2 of its 10 ranked paddles.** Selkirk is served by
the Apify catalog scraper rather than the local one, and its price coverage is
24% overall. The price comparison reports `2 (+8 n/a)` instead of quietly
computing a median over the two it has.

**3,905 accessory reviews (14.6% of `paddle_reviews`) had to be excluded.** The
table holds reviews of cases, shoes, hats and bags. Selkirk's "Project Boomstik
Soft Case" alone has 651 — enough to rank second in that brand's top 10 as if it
were a paddle. Requirement 1 is paddles only, so `isNotPaddle()` filters them
and the coverage strip reports the count.

**Signature editions were splitting families.** JOOLA lists the same paddle with
and without the endorsing athlete: "Ben Johns Perseus Pro IV" (176 reviews) and
"Perseus Pro IV" (140). Unmerged, one paddle took two of JOOLA's ten slots and
neither showed its true 335. The roster comes from `influencers.name` rather
than a hardcoded athlete list, and the crawler reads the same table so both
sides of the join agree.

### Phase 3 corrections to this document

**The retirement list in §5.4 was wrong.** It claimed
`fetchStockoutOpportunities`, `fetchRestockCadence`, `fetchPricePressure` and
`fetchAttentionAvailability` were "fully implemented but rendered by nothing
today". All four are live in Sales Intel — `app/v2/sales-intel/page.tsx` and its
brand drilldown. Deleting them as approved would have broken that page. They
are kept.

The five that genuinely had no remaining consumer once the page was rebuilt were
removed (522 lines): `fetchCompetitorAttackMap`, `fetchAttentionFunnel`,
`fetchProductChannelSplit`, `fetchLaunchTracker`,
`fetchUnmatchedProductMentions`, with their interfaces.

### Phase 3 display decisions worth knowing

* **Core thickness shows every published value** — `14 / 16mm`, not one of them.
  A single number contradicts the paddle's own name whenever a family ships in
  two cores: "Hyperion Pro IV 14mm" reporting a 16mm core reads as a bug even
  though both values are correct.
* **A catalog product's mentions belong to exactly one row.** Containment
  matching is loose enough that several families can claim the same catalog
  entry — "Project Boomstik" and "Project Boomstik 2nd/Demos" each rendered the
  full 177 mentions, implying 354 for one paddle. The family with the most
  reviews keeps the claim.
* **JOOLA sorts first**, then everyone else by review corpus. The comparison
  reads as "us vs them", and alphabetical put JOOLA fourth.

### Still open after Phase 3

| Item | Status |
|---|---|
| Franklin specs | Blocked by Cloudflare (HTTP 403). Needs crawl4ai/Playwright or stays absent. Franklin's parser remains UNVERIFIED — no fixture. |
| Selkirk prices | 24% coverage, owned by the Apify catalog scraper. |
| CRBN X Series specs | Not published by CRBN. Nothing to collect. |
| FX rate | Still the manual AUD→USD 0.66 seeded by migration 025. Needs a real feed. |
| Phase 4 — Amazon | Deferred by the product owner. |
| Customer Voice sentiment | The retained §7 renders "POSITIVE 0% pos · 0 neg" for some rows. Pre-existing, in `fetchCustomerVoice`, untouched by this work. |
