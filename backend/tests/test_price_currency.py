"""Regression tests for currency detection and price plausibility.

WHY THIS FILE EXISTS
Shopify geo-prices by visitor IP. `scrape_catalog_local` hardcodes a currency
per brand and trusts it, so when the crawl runs from outside the US the
storefront quietly serves a different currency and the scraper mislabels it.

Observed on the 2026-08-26 crawl from an India-based host:

    Six Zero "Black Opal 14mm"
      rendered:  Rs. 21,400.00          <- INR
      config:    currency = "AUD"
      stored:    price_local 21400 AUD, price_usd $14,124

A $300 paddle was recorded at fourteen thousand dollars, with no error raised.
Nothing in the pipeline objected, because 21400 is a perfectly well-formed
number and AUD is a perfectly well-formed currency.

Two independent defences are tested here:
  1. read the currency off the price string instead of trusting config, and
  2. refuse to store a price that cannot be a pickleball product.

Either one alone would have caught this. Both are cheap.
"""
from __future__ import annotations

import pytest

from backend.scraping.sources.products.scrape_catalog_local import (
    MAX_PLAUSIBLE_USD,
    _parse_price,
    detect_currency,
    plausible_usd,
)


# ── currency detection ──────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,configured,expected", [
    # The exact strings that caused the incident.
    ("Rs. 21,400.00",      "AUD", "INR"),
    ("Rs. 19,500.00",      "AUD", "INR"),
    ("from Rs. 17,600.00", "AUD", "INR"),
    ("₹21,400.00",         "AUD", "INR"),
    # Explicit codes always win over the configured value.
    ("$300.00 AUD",        "USD", "AUD"),
    ("$149.99 USD",        "AUD", "USD"),
    ("A$300.00",           "USD", "AUD"),
    ("CA$220.00",          "USD", "CAD"),
    ("£129.00",            "USD", "GBP"),
    ("€149,00",            "USD", "EUR"),
    # A BARE `$` is genuinely ambiguous — fall back to what the brand config
    # says, because that is the only information available.
    ("$159.95",            "USD", "USD"),
    ("$300.00",            "AUD", "AUD"),
    # No price, no opinion.
    ("",                   "USD", "USD"),
    (None,                 "USD", "USD"),
])
def test_detect_currency(raw, configured, expected):
    assert detect_currency(raw, configured) == expected


def test_detect_currency_does_not_trust_config_over_evidence():
    """The whole point. Config said AUD; the page said rupees. Page wins."""
    assert detect_currency("Rs. 21,400.00", "AUD") == "INR"


def test_rupee_is_not_read_as_a_dollar():
    assert detect_currency("Rs. 21,400.00", "USD") != "USD"


# ── plausibility guard ──────────────────────────────────────────────────────
@pytest.mark.parametrize("usd,ok", [
    (159.95, True),
    (299.95, True),
    (11.99,  True),
    (6.00,   True),     # Six Zero sells a key chain
    (MAX_PLAUSIBLE_USD, True),
    (MAX_PLAUSIBLE_USD + 0.01, False),
    (14124.0, False),   # the value actually stored
    (16104.0, False),
    (0.0,    False),    # a free paddle is a parse failure, not a price
    (-5.0,   False),
    (None,   False),
])
def test_plausible_usd(usd, ok):
    assert plausible_usd(usd) is ok


def test_the_stored_wrong_price_would_now_be_rejected():
    """Black Opal 14mm was written to the database at $14,124."""
    assert plausible_usd(14124.0) is False


def test_a_real_premium_paddle_is_still_accepted():
    """The guard must not clip the top of the genuine range. The most expensive
    paddle in the catalog is JOOLA's at $299.95, and Six Zero's limited edition
    lists at AUD 350 (~USD 230)."""
    for price in (299.95, 350.00, 449.99):
        assert plausible_usd(price) is True


# ── the parser itself was never wrong ───────────────────────────────────────
def test_parse_price_reads_the_number_correctly():
    """_parse_price did its job — 21400 really is the number on the page. The
    defect was never arithmetic, it was the unit. Pinned so nobody 'fixes' the
    parser looking for a bug that is not there."""
    assert _parse_price("Rs. 21,400.00") == 21400.0
    assert _parse_price("$300.00 AUD") == 300.0
    assert _parse_price("from Rs. 17,600.00") == 17600.0


# ── products.json: the IP-independent price source ──────────────────────────
def test_shopify_handle_extracts_from_product_links():
    from backend.scraping.sources.products.scrape_catalog_local import shopify_handle
    cases = [
        ("https://www.sixzeropickleball.com/products/black-opal-14mm", "black-opal-14mm"),
        ("https://www.sixzeropickleball.com/products/black-opal-14mm?variant=42", "black-opal-14mm"),
        ("https://joola.com/collections/paddles/products/astro-pickleball-paddle", "astro-pickleball-paddle"),
        ("https://joola.com/products/astro#reviews", "astro"),
        ("https://joola.com/pages/about", ""),
        ("", ""),
        (None, ""),
    ]
    for link, expected in cases:
        assert shopify_handle(link) == expected, link


# ── facet labels are not products ───────────────────────────────────────────
def test_facet_labels_are_rejected_as_product_names():
    """Six Zero's `.grid__item` selector also matches its filter sidebar, so
    the catalog acquired priced "products" named Thickness, HYBRID and 14MM."""
    from backend.scraping.sources.products.scrape_catalog_local import _FACET_LABEL
    for junk in ["Thickness", "Shape", "HYBRID", "WIDEBODY",
                 "14MM", "16MM", "13 mm", "Colour", "Price", "All"]:
        assert _FACET_LABEL.match(junk), junk


def test_real_paddle_names_containing_facet_words_survive():
    """Anchored whole-string matching. A paddle really can be called
    "Black Opal 14mm Elongated" and must not be filtered out."""
    from backend.scraping.sources.products.scrape_catalog_local import _FACET_LABEL
    for real in ["Black Opal 14mm Elongated", "Coral 16mm", "Hybrid Pro 16mm",
                 "Six Zero Standard Shape Paddle", "Quartz"]:
        assert not _FACET_LABEL.match(real), real
