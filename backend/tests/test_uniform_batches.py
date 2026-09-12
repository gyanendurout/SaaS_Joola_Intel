"""PGRST102 regression guard for the shared supabase write helper.

PostgREST answers a bulk POST whose objects do not all carry an identical key
set with 400 PGRST102 "All object keys must match", and it discards the ENTIRE
array -- not the offending row. On 2026-09-12 that lost 822 freshly scraped ad
creatives (168 Meta + 654 Google, 0 written) after the Apify credits had been
spent.

_uniform_batches() is the net. These tests are pure-offline: the function is
module-level and touches no network, no credentials and no database.
"""
import importlib

sb = importlib.import_module("backend.scraping.core.supabase_client")
_uniform_batches = sb._uniform_batches


def _all_key_uniform(batches):
    return all(len({frozenset(r) for r in b}) == 1 for b in batches if b)


# ── The bug, reproduced as data ───────────────────────────────────────────────

RAGGED = [
    # A full Meta ad: every creative field present.
    {"ad_id": "1", "body": "Real copy", "cta": "Shop now", "ad_title": "JOOLA"},
    # Same ad library, no CTA -> the old builder dropped the key entirely.
    {"ad_id": "2", "body": "Other copy", "ad_title": "Selkirk"},
    # Dynamic catalogue ad: body was a {{token}}, so body went too.
    {"ad_id": "3", "ad_title": "Paddletek"},
    # Another full one, to prove grouping is not just "first shape wins".
    {"ad_id": "4", "body": "More copy", "cta": "Learn more", "ad_title": "CRBN"},
]


def test_ragged_batch_is_split_so_every_batch_is_postable():
    batches = _uniform_batches("marketing_ads", RAGGED)
    assert _all_key_uniform(batches), [sorted(r) for b in batches for r in b]
    assert len(batches) == 3                      # three distinct key sets


def test_no_row_is_lost_or_duplicated():
    batches = _uniform_batches("marketing_ads", RAGGED)
    flat = [r for b in batches for r in b]
    assert len(flat) == len(RAGGED)
    assert {r["ad_id"] for r in flat} == {"1", "2", "3", "4"}


def test_keys_are_never_invented_or_padded():
    """Grouping must not add keys -- an explicit NULL overrides a column DEFAULT
    on INSERT and blanks a good value under merge-duplicates."""
    batches = _uniform_batches("marketing_ads", RAGGED)
    by_id = {r["ad_id"]: r for b in batches for r in b}
    assert "cta" not in by_id["2"]
    assert "body" not in by_id["3"] and "cta" not in by_id["3"]
    assert set(by_id["1"]) == {"ad_id", "body", "cta", "ad_title"}


def test_rows_are_not_copied(  ):
    """Callers and the PGRST204 column-stripper both mutate rows in place, so
    the batches must hold the original dict objects, not copies."""
    batches = _uniform_batches("t", RAGGED)
    assert any(r is RAGGED[0] for b in batches for r in b)


# ── Backward compatibility: the path every other module takes ────────────────

def test_already_uniform_rows_are_unchanged():
    rows = [{"a": 1, "b": None}, {"a": 2, "b": 3}, {"a": 4, "b": ""}]
    assert _uniform_batches("t", rows) == [rows]


def test_empty_input():
    assert _uniform_batches("t", []) == []


def test_key_order_within_a_row_does_not_split_the_batch():
    # Key ORDER is irrelevant to PostgREST; only the set matters.
    rows = [{"a": 1, "b": 2}, {"b": 3, "a": 4}]
    assert _uniform_batches("t", rows) == [rows]


def test_500_row_batching_still_applies_within_a_shape():
    rows = [{"a": i} for i in range(1100)]
    batches = _uniform_batches("t", rows)
    assert [len(b) for b in batches] == [500, 500, 100]


def test_batching_applies_per_shape_not_across_shapes():
    rows = [{"a": i} for i in range(600)] + [{"a": i, "b": i} for i in range(600)]
    batches = _uniform_batches("t", rows)
    assert [len(b) for b in batches] == [500, 100, 500, 100]
    assert _all_key_uniform(batches)
    assert sum(len(b) for b in batches) == 1200


def test_group_order_is_deterministic():
    rows = [{"a": 1}, {"a": 2, "b": 2}, {"a": 3}, {"a": 4, "b": 4, "c": 4}]
    first = [[sorted(r) for r in b] for b in _uniform_batches("t", rows)]
    for _ in range(20):
        assert [[sorted(r) for r in b] for b in _uniform_batches("t", rows)] == first


def test_the_real_ads_payload_shape_is_now_uniform():
    """End-to-end: the fixed builders feeding the fixed helper produce ONE batch.

    This is the assertion that says the 2026-09-12 run would have landed.
    """
    from backend.scraping.sources.ads.ad_payload import google_fields, meta_fields

    meta_items = [
        {"adArchiveID": "1", "isActive": True, "publisherPlatform": ["FACEBOOK"],
         "snapshot": {"body": {"text": "Real copy"}, "ctaText": "Shop now",
                      "title": "JOOLA", "linkUrl": "https://joola.com"}},
        {"adArchiveID": "2", "snapshot": {"body": {"text": "No cta here"}}},
        {"adArchiveID": "3", "snapshot": {"body": {"text": "{{product.brand}}"}}},
        {"adArchiveID": "4"},
    ]
    meta_rows = [{"brand_id": "b", "platform": "meta", "ad_id": str(i),
                  "page_name": "p", "raw": it, **meta_fields(it)}
                 for i, it in enumerate(meta_items)]
    assert len(_uniform_batches("marketing_ads", meta_rows)) == 1

    google_items = [
        {"creativeId": "1", "advertiserName": "Gamma", "imageUrl": "https://i",
         "firstShown": "2025-04-30", "lastShown": "2025-09-10",
         "approxDaysShown": 131, "adFormat": "text", "adUrl": "https://a"},
        {"creativeId": "2"},
        {"creativeId": "3", "adFormat": "video"},
    ]
    google_rows = []
    for i, it in enumerate(google_items):
        f = google_fields(it)
        google_rows.append({"brand_id": "b", "platform": "google", "ad_id": str(i),
                            "page_name": f.pop("page_name", None) or "dom",
                            "raw": it, **f})
    assert len(_uniform_batches("marketing_ads", google_rows)) == 1
