"""Per-brand paddle spec parser tests, run entirely against offline fixtures.

Every expected value in this file was read out of
``backend/tests/fixtures/paddle_specs/`` — the 27 real captures taken during the
2026-08-26 site recon. Nothing is invented. Where a brand does not publish a
field, the assertion is ``is None``, which is the contract: a missing
measurement is NULL, never a guess and never ``False``.

No network. No Playwright. ``python -m pytest backend/tests/test_spec_parsers.py -q``

Fixture inventory actually present (this differs from the recon write-up, which
predates the capture — Selkirk and Six Zero DO have product JSON and rendered
pages; only Franklin has neither):

    joola      json x2 + html x2
    selkirk    json x2 + html x2
    crbn       json x2 + html x2
    paddletek  json x2 + html x2
    engage     json x2 (specs live in body_html) + html x2
    six-zero   json x2 + html x2
    franklin   NOTHING — parser is UNVERIFIED, only its no-raise contract is tested
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

from backend.scraping.sources.products.spec_parsers import (
    franklin_product_urls,
    parse_crbn,
    parse_engage,
    parse_franklin,
    parse_joola,
    parse_paddletek,
    parse_selkirk,
    parse_sixzero,
)

FIXTURES = Path(__file__).parent / "fixtures" / "paddle_specs"

ALL_PARSERS = (
    parse_joola,
    parse_selkirk,
    parse_crbn,
    parse_paddletek,
    parse_engage,
    parse_sixzero,
    parse_franklin,
)


def load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def load_html(name: str) -> str:
    with gzip.open(FIXTURES / name, "rt", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def by_variant(rows: list[dict]) -> dict[str, dict]:
    return {r["variant_key"]: r for r in rows}


# Columns of migration 024 that every returned dict must carry.
SPEC_COLUMNS = {
    "source_handle", "source_url", "product_name", "family_key", "variant_key",
    "shape", "thickness_mm", "length_in", "width_in", "handle_length_in",
    "weight_oz_min", "weight_oz_max", "grip_circum_in", "core_material",
    "face_material", "swing_weight", "twist_weight", "balance_point_mm",
    "usap_approved", "raw_specs", "source_confidence",
}


def assert_row_contract(row: dict) -> None:
    """Invariants migration 024 enforces at the DB level, checked before write."""
    assert set(row) == SPEC_COLUMNS, set(row).symmetric_difference(SPEC_COLUMNS)
    for column in ("source_handle", "source_url", "product_name", "family_key", "variant_key"):
        assert isinstance(row[column], str) and row[column].strip(), (column, row[column])
    assert row["source_confidence"] in ("labelled", "variant", "prose")
    assert isinstance(row["raw_specs"], dict)
    assert row["usap_approved"] in (True, None), "absence must be NULL, never False"
    assert row["shape"] in (None, "elongated", "hybrid", "widebody", "standard")


# ── JOOLA ───────────────────────────────────────────────────────────────────
# Spec table `#product-tab-2 .specifications-section`; thickness only exists as
# the Shopify `Size` option, hence one row per thickness.

def test_joola_perseus_yields_one_row_per_thickness():
    rows = parse_joola(
        load_json("joola__joola-perseus-pro-v-pickleball-paddle-1.json"),
        load_html("page_joola.html.gz"),
    )
    assert len(rows) == 2
    for row in rows:
        assert_row_contract(row)

    keyed = by_variant(rows)
    assert set(keyed) == {"elongated|16.0", "elongated|14.0"}

    thick = keyed["elongated|16.0"]
    assert thick["source_handle"] == "joola-perseus-pro-v-pickleball-paddle-1"
    assert thick["product_name"] == "JOOLA Perseus Pro V Pickleball Paddle"
    assert thick["family_key"] == "perseus pro v"
    assert thick["shape"] == "elongated"                     # "Class: Elongated"
    assert thick["thickness_mm"] == 16.0
    assert (thick["weight_oz_min"], thick["weight_oz_max"]) == (7.9, 8.1)
    assert thick["length_in"] == 16.5
    assert thick["width_in"] == 7.5
    assert thick["handle_length_in"] == 5.5                  # "Grip Length: 5.5in"
    assert thick["grip_circum_in"] == 4.25                   # "4.250in/4.125in"
    assert thick["core_material"] == "PP Core + CF + EVA Foam"
    assert thick["face_material"] == "Textured CF"
    assert thick["usap_approved"] is True                    # "USAP certified: Yes"
    # JOOLA publishes none of these three.
    assert thick["swing_weight"] is None
    assert thick["twist_weight"] is None
    assert thick["balance_point_mm"] is None
    # Thickness came from a variant option, so the row is not fully labelled.
    assert thick["source_confidence"] == "variant"
    assert thick["raw_specs"]["Average Weight"] == "7.9-8.1oz"

    assert keyed["elongated|14.0"]["thickness_mm"] == 14.0
    assert keyed["elongated|14.0"]["length_in"] == 16.5


def test_joola_hyperion_publishes_a_point_weight_not_a_range():
    rows = parse_joola(
        load_json("joola__joola-hyperion-pro-v-pickleball-paddle.json"),
        load_html("page_joola2.html.gz"),
    )
    assert len(rows) == 2
    keyed = by_variant(rows)
    assert set(keyed) == {"elongated|16.0", "elongated|14.0"}

    row = keyed["elongated|16.0"]
    assert row["family_key"] == "hyperion pro v"
    assert row["shape"] == "elongated"
    # The spec table says a flat "8.1oz" — a point value collapses to equal bounds.
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (8.1, 8.1)
    assert row["length_in"] == 16.5
    assert row["width_in"] == 7.5
    assert row["core_material"] == "PP core + CF + EVA foam"
    assert row["usap_approved"] is True


# ── Selkirk ─────────────────────────────────────────────────────────────────
# `div#tech-specs .metafield-rich_text_field`: a <p> shape heading followed by a
# <ul> of label: value pairs, repeated once per shape.

def test_selkirk_omni_splits_by_shape_heading():
    rows = parse_selkirk(
        load_json("selkirk__selkirk-omni-pickleball-paddle.json"),
        load_html("page_selkirk.html.gz"),
    )
    assert len(rows) == 2
    for row in rows:
        assert_row_contract(row)
        assert row["family_key"] == "omni"
        assert row["thickness_mm"] == 16.0
        assert (row["weight_oz_min"], row["weight_oz_max"]) == (7.9, 8.2)
        assert row["grip_circum_in"] == 4.25
        assert row["core_material"] == "PureFoam™"
        assert row["source_confidence"] == "labelled"
        assert row["usap_approved"] is None       # Selkirk never states it

    keyed = by_variant(rows)
    assert set(keyed) == {"widebody|16.0", "elongated|16.0"}

    wide = keyed["widebody|16.0"]
    assert wide["shape"] == "widebody"
    assert wide["length_in"] == 15.95           # curly quote in the source
    assert wide["width_in"] == 8.0
    assert wide["handle_length_in"] == 5.6
    assert wide["swing_weight"] == 112.0        # "112 +/- 2" -> the centre
    assert wide["twist_weight"] == 7.9          # "7.9 +/- 0.2"

    long = keyed["elongated|16.0"]
    assert long["shape"] == "elongated"
    assert long["length_in"] == 16.5
    assert long["width_in"] == 7.45
    assert long["handle_length_in"] == 5.8
    assert long["swing_weight"] == 118.0
    assert long["twist_weight"] == 6.9


def test_selkirk_luxx_proper_noun_shapes_stay_null_but_keys_stay_distinct():
    rows = parse_selkirk(
        load_json("selkirk__luxx-control-air-with-infinigrit.json"),
        load_html("page_selkirk2.html.gz"),
    )
    assert len(rows) == 2
    for row in rows:
        assert_row_contract(row)
        assert row["family_key"] == "luxx control air with infinigrit"
        assert row["thickness_mm"] == 19.0
        assert (row["weight_oz_min"], row["weight_oz_max"]) == (7.9, 8.3)
        assert row["core_material"] == "X7 Thickset Honeycomb Core"
        assert row["face_material"] == "Florek Carbon Fiber"
        # "Epic" / "Invikta" are Selkirk product-line names, not shape words, and
        # Selkirk's own nav lists Widebody / Epic / Invikta as SIBLINGS — so
        # mapping them onto a canonical shape would be an invention.
        assert row["shape"] is None

    keyed = by_variant(rows)
    # ...but the raw label still has to keep the two rows apart, or the unique
    # constraint on (brand, handle, variant_key) would collapse them into one.
    assert set(keyed) == {"epic|19.0", "invikta|19.0"}
    assert keyed["epic|19.0"]["raw_specs"]["Shape"] == "Epic"

    epic = keyed["epic|19.0"]
    assert epic["length_in"] == 15.85
    assert epic["width_in"] == 7.85
    assert epic["handle_length_in"] == 5.25
    assert epic["swing_weight"] == 109.0
    assert epic["twist_weight"] == 6.6

    invikta = keyed["invikta|19.0"]
    assert invikta["length_in"] == 16.4
    assert invikta["width_in"] == 7.5
    assert invikta["handle_length_in"] == 5.35
    assert invikta["swing_weight"] == 113.0
    assert invikta["twist_weight"] == 6.0


# ── CRBN ────────────────────────────────────────────────────────────────────
# A four-column comparison grid shared verbatim by every TruFoam Barrage page.
# The `active` class is a DECOY: both captures below carry it on column 1.

def test_crbn_ignores_the_active_class_decoy():
    elongated = parse_crbn(load_json("crbn__tfb3.json"), load_html("page_crbn.html.gz"))
    square = parse_crbn(load_json("crbn__tfb2.json"), load_html("page_crbn2.html.gz"))
    assert len(elongated) == 1 and len(square) == 1

    # Column 1 (the one wearing `active` on BOTH pages) is "Elongated w/ Long
    # Handle", 7.35" x 16.5", 5.75" handle, 239mm balance. If either row below
    # matches that, the parser followed the decoy.
    assert elongated[0]["width_in"] != 7.35
    assert square[0]["width_in"] != 7.35
    assert elongated[0]["balance_point_mm"] != 239.0
    assert square[0]["balance_point_mm"] != 239.0


def test_crbn_tfb3_elongated():
    rows = parse_crbn(load_json("crbn__tfb3.json"), load_html("page_crbn.html.gz"))
    assert len(rows) == 1
    row = rows[0]
    assert_row_contract(row)

    assert row["source_handle"] == "tfb3"
    assert row["shape"] == "elongated"
    assert row["thickness_mm"] == 14.0          # prose only: "engineered at 14mm"
    assert row["width_in"] == 7.5               # the grid row is "W x L"
    assert row["length_in"] == 16.5
    assert row["handle_length_in"] == 5.5
    assert row["grip_circum_in"] == 4.125
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (7.8, 8.2)  # "8.0 oz. +/- 0.2"
    assert row["balance_point_mm"] == 236.0
    assert row["twist_weight"] == 6.54
    assert row["swing_weight"] == 119.0         # "118-120" -> midpoint
    assert row["core_material"] == "100% TruFoam Floating Core"
    assert row["usap_approved"] is None
    # Thickness is regex-over-marketing-copy, so the whole row is downgraded.
    assert row["source_confidence"] == "prose"
    assert row["family_key"]
    assert row["variant_key"] == "elongated|14.0"


def test_crbn_tfb2_square_is_not_a_canonical_shape():
    rows = parse_crbn(load_json("crbn__tfb2.json"), load_html("page_crbn2.html.gz"))
    assert len(rows) == 1
    row = rows[0]
    assert_row_contract(row)

    assert row["source_handle"] == "tfb2"
    assert row["raw_specs"]["Shape"] == "Square"
    assert row["shape"] is None                 # "Square" is CRBN's own vocabulary
    assert row["variant_key"] == "square|14.0"  # ...but it still separates rows
    assert row["thickness_mm"] == 14.0
    assert row["width_in"] == 7.85
    assert row["length_in"] == 16.0
    assert row["handle_length_in"] == 5.5
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (7.8, 8.2)
    assert row["balance_point_mm"] == 236.0
    assert row["twist_weight"] == 6.9
    assert row["swing_weight"] == 111.0         # "110-112" -> midpoint


# ── Paddletek ───────────────────────────────────────────────────────────────
# `.ptk-specs__row` carries the CURRENTLY SELECTED variant only. One HTML capture
# therefore measures exactly one thickness; the others are still emitted so the
# grain survives, but with variant-only confidence.

def test_paddletek_tko_c_measures_the_rendered_thickness_only():
    rows = parse_paddletek(
        load_json("paddletek__bantam-tko-c.json"),
        load_html("page_paddletek.html.gz"),
    )
    assert len(rows) == 2
    for row in rows:
        assert_row_contract(row)
        assert row["family_key"] == "bantam tko c"
        assert row["shape"] == "elongated"
        assert row["grip_circum_in"] is None    # Paddletek does not publish grip
        assert row["usap_approved"] is None

    keyed = by_variant(rows)
    assert set(keyed) == {"elongated|12.7", "elongated|14.3"}

    rendered = keyed["elongated|12.7"]
    assert rendered["thickness_mm"] == 12.7
    assert rendered["length_in"] == 16.5        # 'Elongated - 16.5" x 7.5"'
    assert rendered["width_in"] == 7.5
    assert rendered["handle_length_in"] == 5.25
    assert (rendered["weight_oz_min"], rendered["weight_oz_max"]) == (7.7, 8.1)  # EN DASH
    assert rendered["swing_weight"] == 119.0    # "115-123" -> midpoint
    assert rendered["twist_weight"] == 7.1      # "6.7-7.5"  -> midpoint
    assert rendered["source_confidence"] == "labelled"

    unrendered = keyed["elongated|14.3"]
    assert unrendered["thickness_mm"] == 14.3
    assert unrendered["source_confidence"] == "variant"
    # Shape is a product-level fact and carries over; the measurements do not.
    assert unrendered["weight_oz_min"] is None
    assert unrendered["swing_weight"] is None


def test_paddletek_ex_l_pro_single_thickness_standard_shape():
    rows = parse_paddletek(
        load_json("paddletek__bantam-ex-l-pro.json"),
        load_html("page_paddletek2.html.gz"),
    )
    assert len(rows) == 1
    row = rows[0]
    assert_row_contract(row)

    assert row["family_key"] == "bantam ex l pro"
    assert row["variant_key"] == "standard|14.3"
    assert row["shape"] == "standard"           # 'Standard - 16" x 8"'
    assert row["thickness_mm"] == 14.3
    assert row["length_in"] == 16.0
    assert row["width_in"] == 8.0
    assert row["handle_length_in"] == 4.75
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (8.3, 8.7)
    # This page renders no swing/twist rows at all.
    assert row["swing_weight"] is None
    assert row["twist_weight"] is None
    assert row["source_confidence"] == "labelled"


# ── Engage ──────────────────────────────────────────────────────────────────
# The whole spec block lives in `body_html` — no HTML fetch needed.

def test_engage_x2_reads_specs_out_of_body_html_without_a_page():
    rows = parse_engage(load_json("engage__engage-x2-pickleball-paddle.json"), None)
    assert len(rows) == 1
    row = rows[0]
    assert_row_contract(row)

    assert row["source_handle"] == "engage-x2-pickleball-paddle"
    assert row["shape"] == "elongated"
    assert row["thickness_mm"] == 16.0
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (8.0, 8.0)
    assert row["length_in"] == 16.5             # "16.5 inch x 7.5 inch with a 5.5 inch handle"
    assert row["width_in"] == 7.5
    assert row["handle_length_in"] == 5.5
    assert row["grip_circum_in"] == 4.25        # "4 1/4 inch" — a MIXED FRACTION
    assert row["core_material"] == "Quad-Density Foam Core"
    assert row["face_material"] == "Micro-Weave Carbon Fiber Surface"
    assert row["usap_approved"] is True         # "USA Pickleball Certified"
    assert row["swing_weight"] is None          # Engage publishes neither
    assert row["twist_weight"] is None
    assert row["family_key"]
    assert row["variant_key"] == "elongated|16.0"
    assert row["source_confidence"] == "labelled"


def test_engage_pro1_states_no_shape_and_a_contradictory_usap_line():
    rows = parse_engage(load_json("engage__pro1-innovation-152.json"), None)
    assert len(rows) == 1
    row = rows[0]
    assert_row_contract(row)

    assert row["thickness_mm"] == 15.2          # "15.2mm for power and refined control"
    assert row["length_in"] == 16.6             # '16.6" x 7.4" with a 6.0" handle length'
    assert row["width_in"] == 7.4
    assert row["handle_length_in"] == 6.0
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (8.0, 8.0)
    assert row["grip_circum_in"] == 4.25        # "4 1/4" — colon sits OUTSIDE <strong>
    assert row["core_material"] == "New Power Flex Polymer"
    assert row["face_material"] == "Raw Carbon Fiber with Next-Gen Inner Layer"
    # The Shape line carries dimensions but no shape word.
    assert row["shape"] is None
    assert row["variant_key"] == "any|15.2"
    # "USAP-Approved for tournament play (in process of being approved & listed)"
    # contradicts itself; NULL is the only honest reading.
    assert row["usap_approved"] is None


# ── Six Zero ────────────────────────────────────────────────────────────────
# One `table.dcf-table` per shape, captioned with the shape in its header row.

def test_sixzero_coral_yields_one_row_per_shape_table():
    rows = parse_sixzero(load_json("sixzero__coral-16mm.json"), load_html("page_sixzero2.html.gz"))
    assert len(rows) == 3
    for row in rows:
        assert_row_contract(row)
        assert row["family_key"] == "coral"
        assert row["thickness_mm"] == 16.0
        # "8.0 - 8.3 oz // 230gm +/- 5gm" — the gram half must not win.
        assert (row["weight_oz_min"], row["weight_oz_max"]) == (8.0, 8.3)
        assert row["face_material"] == "Diamond Tough Raw Carbon Fiber"
        assert row["core_material"] == "Tectonic Core with ProPulsion Foam"
        assert row["grip_circum_in"] == 4.0     # '4.0" - 4.13"' -> lower bound
        assert row["usap_approved"] is True     # "Registered Approval Body"
        assert row["source_confidence"] == "labelled"

    keyed = by_variant(rows)
    assert set(keyed) == {"hybrid|16.0", "elongated|16.0", "widebody|16.0"}

    assert keyed["hybrid|16.0"]["shape"] == "hybrid"
    assert keyed["hybrid|16.0"]["length_in"] == 16.3
    assert keyed["hybrid|16.0"]["width_in"] == 7.5
    assert keyed["hybrid|16.0"]["handle_length_in"] == 5.5
    assert keyed["hybrid|16.0"]["swing_weight"] == 114.0
    assert keyed["hybrid|16.0"]["twist_weight"] == 6.7

    assert keyed["elongated|16.0"]["length_in"] == 16.5
    assert keyed["elongated|16.0"]["width_in"] == 7.3
    assert keyed["elongated|16.0"]["handle_length_in"] == 5.75
    assert keyed["elongated|16.0"]["swing_weight"] == 117.0
    assert keyed["elongated|16.0"]["twist_weight"] == 5.9

    assert keyed["widebody|16.0"]["length_in"] == 16.0
    assert keyed["widebody|16.0"]["width_in"] == 7.8
    assert keyed["widebody|16.0"]["swing_weight"] == 110.0
    assert keyed["widebody|16.0"]["twist_weight"] == 7.1


def test_sixzero_black_opal_dual_unit_strings():
    rows = parse_sixzero(
        load_json("sixzero__black-opal-14mm.json"),
        load_html("page_sixzero.html.gz"),
    )
    assert len(rows) == 1
    row = rows[0]
    assert_row_contract(row)

    assert row["family_key"] == "black opal"
    assert row["shape"] is None                 # single-shape paddle, none stated
    assert row["variant_key"] == "any|14.0"
    assert row["thickness_mm"] == 14.0          # '0.55" // 14mm' — mm must win
    assert row["length_in"] == 16.3             # '16.3" // 413mm' — inches must win
    assert row["width_in"] == 7.5               # '7.5" to 7.7" // 192mm to 196mm'
    assert row["handle_length_in"] == 5.5       # '5.5" // 140mm'
    assert row["grip_circum_in"] == 4.125
    assert (row["weight_oz_min"], row["weight_oz_max"]) == (8.0, 8.3)
    assert row["swing_weight"] == 113.0
    assert row["twist_weight"] == 6.6
    assert row["face_material"] == "Diamon Tough Raw Carbon Fiber"  # brand's typo
    assert row["usap_approved"] is True


# ── Franklin ────────────────────────────────────────────────────────────────
# UNVERIFIED: there is no Franklin fixture. The parser was written from the
# recon notes in docs/PRODUCT_INTEL_REDESIGN.md section 3 and has never seen a
# real Franklin page. Only the contract is asserted here — asserting invented
# measurements would make the suite lie about coverage.

def test_franklin_parser_is_unverified_and_only_its_contract_is_tested():
    assert parse_franklin(None, None) == []
    assert parse_franklin({}, "") == []
    assert parse_franklin({"product": {"handle": "x"}}, "<html></html>") == []


def test_franklin_product_urls_never_requests_a_query_string():
    """robots.txt carries `Disallow: /*?`, so a `?` must never survive here."""
    assert franklin_product_urls(None, "franklinsports.com") == []
    assert franklin_product_urls("<html></html>", "") == []

    listing = """
      <a href="/products/signature-paddle?color=red">filtered</a>
      <a href="/products/signature-paddle">clean</a>
      <a href="/products/signature-paddle">duplicate</a>
      <a href="https://franklinsports.com/max-grit-16mm.html">magento style</a>
      <a href="/sports/pickleball/paddles">the listing page itself</a>
      <a href="/customer/account/login">account</a>
      <a href="https://example.com/products/someone-else">off-domain</a>
    """
    urls = franklin_product_urls(listing, "franklinsports.com")
    assert urls == [
        "https://franklinsports.com/products/signature-paddle",
        "https://franklinsports.com/max-grit-16mm.html",
    ]
    assert all("?" not in url for url in urls)


# ── never-raise contract, for every brand ───────────────────────────────────

@pytest.mark.parametrize("parser", ALL_PARSERS, ids=lambda p: p.__name__)
@pytest.mark.parametrize("payload", [
    (None, None),
    ({}, ""),
    ({"product": {}}, "<html>"),
    ({"product": {"handle": "h", "title": "T"}}, "<div class='ptk-specs__row'>broken"),
    ({"not": "a product"}, "���"),
], ids=["nones", "empties", "empty-product", "truncated-html", "garbage"])
def test_parsers_never_raise_and_never_return_partial_garbage(parser, payload):
    rows = parser(*payload)
    assert isinstance(rows, list)
    for row in rows:
        assert_row_contract(row)


@pytest.mark.parametrize("parser", ALL_PARSERS, ids=lambda p: p.__name__)
def test_html_only_input_never_raises(parser):
    """A brand page fetched without its /products.json must degrade, not explode."""
    assert isinstance(parser(None, load_html("page_joola.html.gz")), list)
