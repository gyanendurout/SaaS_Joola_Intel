"""Guards the Apify -> marketing_ads mapping.

The mapping drifted silently once (snapshot camelCase vs top-level snake_case)
and cost three months of blank ad copy without a single error. These tests use
real payload shapes so a future schema change fails here instead of quietly
writing empty columns.
"""
from backend.scraping.sources.ads.ad_payload import (
    GOOGLE_COLUMNS, META_COLUMNS, ad_id_of, google_fields, is_template_body,
    meta_fields,
)

META_ITEM = {
    "adArchiveID": "945687884878300",
    "pageName": "Onix Pickleball",
    "isActive": True,
    "startDateFormatted": "2026-04-13T07:00:00.000Z",
    "endDateFormatted": "2026-05-13T07:00:00.000Z",
    "publisherPlatform": ["FACEBOOK", "INSTAGRAM"],
    "snapshot": {
        "body": {"text": "Paddles you can count on, every match."},
        "title": "Onix Pickleball",
        "ctaText": "Shop now",
        "linkUrl": "https://onixpickleball.com/paddles",
        "cards": [],
    },
}

GOOGLE_ITEM = {
    "creativeId": "CR02156660292304502785",
    "advertiserName": "Gamma Sports",
    "imageUrl": "https://tpc.googlesyndication.com/archive/simgad/1693733",
    "firstShown": "2025-04-30",
    "lastShown": "2025-09-10",
    "approxDaysShown": 131,
    "adFormat": "text",
    "adUrl": "https://adstransparency.google.com/advertiser/AR025/creative/CR021",
}


def test_meta_reads_the_nested_camelcase_snapshot():
    f = meta_fields(META_ITEM)
    assert f["body"] == "Paddles you can count on, every match."
    assert f["cta"] == "Shop now"
    assert f["landing_url"] == "https://onixpickleball.com/paddles"
    assert f["started_at"] == "2026-04-13T07:00:00.000Z"
    assert f["publisher_platforms"] == ["FACEBOOK", "INSTAGRAM"]


def test_meta_falls_back_to_the_first_card_when_body_is_empty():
    item = {"snapshot": {"body": {}, "cards": [
        {"body": "Card copy", "ctaText": "Learn more", "linkUrl": "https://e.com"}]}}
    f = meta_fields(item)
    assert f["body"] == "Card copy"
    assert f["cta"] == "Learn more"
    assert f["landing_url"] == "https://e.com"


def test_dynamic_catalogue_copy_is_not_recorded_as_a_message():
    # 420 of 698 live Meta ads carry only "{{product.brand}}". Counting those as
    # ad copy would invent 420 messages nobody wrote.
    f = meta_fields({"snapshot": {"body": {"text": "{{product.brand}}"}}})
    assert f["body"] is None          # present as NULL, not absent -- PGRST102
    assert f["is_template_ad"] is True
    assert is_template_body("{{product.brand}}")
    assert not is_template_body("Real copy about {{product.brand}} paddles")


def test_meta_inactive_flag_survives():
    # is_active defaulting to True is what made every ad look permanently live.
    assert meta_fields({**META_ITEM, "isActive": False})["is_active"] is False


def test_google_exposes_recency_fields():
    f = google_fields(GOOGLE_ITEM)
    assert f["started_at"] == "2025-04-30"
    assert f["last_shown"] == "2025-09-10"
    assert f["approx_days_shown"] == 131


def test_google_archive_permalink_never_becomes_a_landing_url():
    f = google_fields(GOOGLE_ITEM)
    assert "landing_url" not in GOOGLE_COLUMNS and "landing_url" not in f
    assert f["archive_url"].startswith("https://adstransparency.google.com/")


def test_google_has_no_copy_and_does_not_pretend_to():
    # Absent from EVERY Google row, which is uniform and therefore postable --
    # unlike a key that is present on some rows and missing on others.
    f = google_fields(GOOGLE_ITEM)
    assert "body" not in f and "cta" not in f


def test_every_item_yields_the_same_key_set():
    """PGRST102 regression guard.

    PostgREST rejects a bulk POST whose objects differ in key set with
    400 "All object keys must match" and discards the ENTIRE array. On
    2026-09-12 the builders returned only the keys that carried a value, so one
    ad with no CTA lost all 168 Meta / 654 Google rows in its batch. Both
    builders must now return an identical key set for a full item, an empty
    item, and everything in between.
    """
    meta_shapes = {
        frozenset(meta_fields(i))
        for i in (META_ITEM, {}, {"snapshot": {}}, {"isActive": False},
                  {"snapshot": {"body": {"text": "{{product.brand}}"}}},
                  {"snapshot": {"cards": [{"body": "c", "ctaText": "Buy"}]}})
    }
    assert meta_shapes == {frozenset(META_COLUMNS)}, meta_shapes

    google_shapes = {
        frozenset(google_fields(i))
        for i in (GOOGLE_ITEM, {}, {"advertiserName": "X"}, {"adFormat": "video"})
    }
    assert google_shapes == {frozenset(GOOGLE_COLUMNS)}, google_shapes


def test_absent_values_are_null_not_empty_strings():
    f = meta_fields({})
    assert f["body"] is None and f["cta"] is None
    assert f["publisher_platforms"] is None          # never []
    assert google_fields({})["archive_url"] is None


def test_booleans_carry_their_column_default_never_none():
    # is_template_ad is `DEFAULT false` and is_active is `DEFAULT true`. A NULL
    # in either makes "is this ad running / is this real copy" unanswerable, so
    # the builder emits the real boolean rather than padding with None.
    f = meta_fields({})
    assert f["is_template_ad"] is False
    assert f["is_active"] is True


def test_ad_id_extraction_per_platform():
    assert ad_id_of(META_ITEM, "meta") == "945687884878300"
    assert ad_id_of(GOOGLE_ITEM, "google") == "CR02156660292304502785"
    assert ad_id_of({}, "meta") is None
