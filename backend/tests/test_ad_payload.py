"""Guards the Apify -> marketing_ads mapping.

The mapping drifted silently once (snapshot camelCase vs top-level snake_case)
and cost three months of blank ad copy without a single error. These tests use
real payload shapes so a future schema change fails here instead of quietly
writing empty columns.
"""
from backend.scraping.sources.ads.ad_payload import (
    ad_id_of, google_fields, is_template_body, meta_fields,
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
    assert "body" not in f
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
    assert "landing_url" not in f
    assert f["archive_url"].startswith("https://adstransparency.google.com/")


def test_google_has_no_copy_and_does_not_pretend_to():
    f = google_fields(GOOGLE_ITEM)
    assert "body" not in f and "cta" not in f


def test_partial_payload_never_emits_empty_values():
    assert meta_fields({}) == {}
    assert google_fields({}) == {}
    assert all(v not in (None, "", []) for v in meta_fields(META_ITEM).values())


def test_ad_id_extraction_per_platform():
    assert ad_id_of(META_ITEM, "meta") == "945687884878300"
    assert ad_id_of(GOOGLE_ITEM, "google") == "CR02156660292304502785"
    assert ad_id_of({}, "meta") is None
