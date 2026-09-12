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
