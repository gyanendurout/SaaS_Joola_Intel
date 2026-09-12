"""Guards the reviews-crawl4ai write path.

On 2026-09-12 this module crawled 200 product pages for 100 minutes, extracted
89 ratings, and wrote zero rows. It built a 4-key payload
`{id, avg_rating, review_count, last_scraped_at}` and sent it to
`sb.upsert("products", ..., "id")`. `products` requires `name` (NOT NULL, no
default), and Postgres validates the proposed insert tuple *before* ON CONFLICT
arbitration can turn it into an UPDATE — so every batch died with

    23502 null value in column "name" violates not-null constraint

A partial-column "update" expressed as an upsert can never work against a table
with a NOT NULL column absent from the payload. The module now PATCHes each row,
which is what it actually meant: update these two fields on this existing row.

These tests pin the write verb, not just the outcome — an upsert that happens to
include `name` today would silently resurrect products deleted by the dedup job
(see migrations/008 + products_dupe_archive) as name-only zombie rows.
"""
import pytest

from backend.scraping.core.errors import SupabaseError
from backend.scraping.sources.products import scrape_reviews_crawl4ai as mod


PRODUCTS = [
    {"id": "p1", "brand_id": "b1", "name": "Hyperion CAS 16mm",
     "url": "https://joola.com/p1", "avg_rating": 4.1, "review_count": 10},
    {"id": "p2", "brand_id": "b1", "name": "Perseus Pro IV",
     "url": "https://joola.com/p2", "avg_rating": None, "review_count": None},
]


class FakeSb:
    """Records every write so tests can assert on verb *and* payload."""

    def __init__(self, patch_ok=True):
        self.patches: list[tuple[str, str, dict]] = []
        self.upserts: list[tuple[str, list, str]] = []
        self._patch_ok = patch_ok

    def get(self, table, select="*", params=None):
        if table == "brands":
            return [{"id": "b1", "slug": "joola"}]
        return [dict(p) for p in PRODUCTS]

    def patch(self, table, row_id, data):
        self.patches.append((table, row_id, data))
        return self._patch_ok

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows, on_conflict))
        return len(rows)


@pytest.fixture
def scraped(monkeypatch):
    """Both products come back with fresh review data."""
    def fake_batch(products):
        return [
            {**PRODUCTS[0], "avg_rating": 4.7, "review_count": 625,
             "last_scraped_at": "2026-09-12T00:00:00+00:00"},
            {**PRODUCTS[1], "avg_rating": 4.2, "review_count": 88,
             "last_scraped_at": "2026-09-12T00:00:00+00:00"},
        ]
    monkeypatch.setattr(mod, "run_sync", lambda coro: fake_batch(PRODUCTS))
    monkeypatch.setattr(mod, "_scrape_batch", lambda p: None)


def test_writes_via_patch_not_upsert(monkeypatch, scraped):
    """The regression: a partial update must not go out as an upsert."""
    fake = FakeSb()
    monkeypatch.setattr(mod, "sb", fake)

    n = mod.run({"dry_run": False})

    assert n == 2
    assert fake.upserts == [], "products must never be upserted from this module"
    assert [p[1] for p in fake.patches] == ["p1", "p2"]
    assert all(t == "products" for t, _, _ in fake.patches)


def test_patch_payload_carries_only_review_fields(monkeypatch, scraped):
    """A PATCH body is the update. It must not echo name/url/brand_id back."""
    fake = FakeSb()
    monkeypatch.setattr(mod, "sb", fake)

    mod.run({"dry_run": False})

    _, _, body = fake.patches[0]
    assert body == {
        "avg_rating": 4.7,
        "review_count": 625,
        "last_scraped_at": "2026-09-12T00:00:00+00:00",
    }
    for forbidden in ("name", "url", "brand_id", "id"):
        assert forbidden not in body


def test_zero_writes_raises_rather_than_reporting_success(monkeypatch, scraped):
    """89 rows attempted / 0 written must fail, not return 0.

    upsert() got this guard via _assert_wrote_something; the PATCH path needs
    its own or we reintroduce the exact silent failure being fixed.
    """
    fake = FakeSb(patch_ok=False)
    monkeypatch.setattr(mod, "sb", fake)

    with pytest.raises(SupabaseError) as exc:
        mod.run({"dry_run": False})

    assert "0 written" in str(exc.value)
    assert "2 rows attempted" in str(exc.value)


def test_partial_failure_returns_count_and_does_not_raise(monkeypatch, scraped):
    """One bad row must not discard the other 88."""
    fake = FakeSb()
    calls = {"n": 0}

    def flaky_patch(table, row_id, data):
        calls["n"] += 1
        fake.patches.append((table, row_id, data))
        return row_id != "p1"

    monkeypatch.setattr(mod, "sb", fake)
    monkeypatch.setattr(fake, "patch", flaky_patch)

    n = mod.run({"dry_run": False})

    assert n == 1
    assert calls["n"] == 2


def test_no_review_data_is_not_a_failure(monkeypatch):
    """Zero extractions with zero attempts is a legitimate 0, not an error."""
    fake = FakeSb()
    monkeypatch.setattr(mod, "sb", fake)
    monkeypatch.setattr(mod, "run_sync", lambda coro: [])
    monkeypatch.setattr(mod, "_scrape_batch", lambda p: None)

    assert mod.run({"dry_run": False}) == 0
    assert fake.patches == []


def test_dry_run_writes_nothing(monkeypatch):
    fake = FakeSb()
    monkeypatch.setattr(mod, "sb", fake)

    assert mod.run({"dry_run": True}) == 0
    assert fake.patches == [] and fake.upserts == []


# ── URL shadowing (found 2026-09-12) ────────────────────────────────────────
#
# 5 of the 200 scraped products share a URL with another product (variant query
# strings: `amped-pro-air-epic…?variant=…`, `dude-perfect-trickshot`, CRBN
# `counter-…`, `joola-perseus-iv-14mm`, CRBN `best-pickleball-eyewear`).
# `_scrape_batch` built `url_to_product` as {url: product}, so only ONE product
# survived per URL: the twin was never updated, and the survivor was PATCHed once
# per duplicate. That is why the module reported 103 writes while only 98 distinct
# rows changed — the count was PATCH calls, not rows.

SHARED_URL = "https://joola.com/collections/x/products/perseus-iv-14mm"

TWINS = [
    {"id": "t1", "brand_id": "b1", "name": "Perseus IV 14mm",
     "url": SHARED_URL, "avg_rating": None, "review_count": None},
    {"id": "t2", "brand_id": "b1", "name": "Perseus IV 14mm (dupe row)",
     "url": SHARED_URL, "avg_rating": None, "review_count": None},
    {"id": "t3", "brand_id": "b1", "name": "Solo product",
     "url": "https://joola.com/collections/x/products/solo", "avg_rating": None,
     "review_count": None},
]


def _fake_fetch(monkeypatch, html_by_url):
    """Stub fetch_pages_batch: one result per requested URL, in order."""
    async def fake_batch(urls, timeout=None, max_concurrent=None):
        return [{"url": u, "success": True, "html": html_by_url[u]} for u in urls]
    monkeypatch.setattr(mod, "fetch_pages_batch", fake_batch)


def test_every_product_sharing_a_url_gets_updated(monkeypatch):
    """Both twins must receive the rating, not just whichever won the dict."""
    # JSON-LD form on purpose: _parse_reviews_from_html is the REGEX fallback and
    # matches `"ratingValue": …`. The meta[itemprop] selectors live in _REVIEW_JS,
    # which only executes inside the browser.
    html = '{"ratingValue": "4.6", "reviewCount": "210"}'
    _fake_fetch(monkeypatch, {
        SHARED_URL: html,
        "https://joola.com/collections/x/products/solo": html,
    })

    updated = mod.run_sync(mod._scrape_batch(TWINS))
    ids = sorted(p["id"] for p in updated)

    assert ids == ["t1", "t2", "t3"], (
        "a product sharing its URL with another must still be updated; "
        f"got {ids}"
    )
    assert all(p["avg_rating"] == 4.6 for p in updated)
    assert all(p["review_count"] == 210 for p in updated)


def test_shared_url_is_fetched_once_not_once_per_product(monkeypatch):
    """Dedupe the crawl: 3 products over 2 URLs must cost 2 page fetches."""
    seen: list[list[str]] = []
    html = '{"ratingValue": "4.6", "reviewCount": "210"}'

    async def fake_batch(urls, timeout=None, max_concurrent=None):
        seen.append(list(urls))
        return [{"url": u, "success": True, "html": html} for u in urls]
    monkeypatch.setattr(mod, "fetch_pages_batch", fake_batch)

    mod.run_sync(mod._scrape_batch(TWINS))

    assert len(seen) == 1
    assert len(seen[0]) == 2, f"expected 2 distinct URLs fetched, got {seen[0]}"
    assert len(set(seen[0])) == 2


def test_no_product_is_emitted_twice_for_one_url(monkeypatch):
    """The survivor must not be PATCHed once per duplicate."""
    html = '{"ratingValue": "4.6", "reviewCount": "210"}'
    _fake_fetch(monkeypatch, {
        SHARED_URL: html,
        "https://joola.com/collections/x/products/solo": html,
    })

    updated = mod.run_sync(mod._scrape_batch(TWINS))
    ids = [p["id"] for p in updated]

    assert len(ids) == len(set(ids)), f"duplicate PATCH targets: {ids}"


def test_failed_page_skips_all_products_on_that_url(monkeypatch):
    """A blocked page must not fabricate updates for either twin."""
    async def fake_batch(urls, timeout=None, max_concurrent=None):
        return [{"url": u, "success": False, "html": ""} for u in urls]
    monkeypatch.setattr(mod, "fetch_pages_batch", fake_batch)

    assert mod.run_sync(mod._scrape_batch(TWINS)) == []
