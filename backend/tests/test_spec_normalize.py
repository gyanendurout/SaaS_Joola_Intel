"""Unit-normalisation tests for paddle spec parsing.

Every string asserted here is VERBATIM from the 2026-08-26 site recon of the
7 in-scope brands. Nothing is invented — if a format appears in this file it is
because a brand actually publishes it that way. Fixtures for the full pages live
in backend/tests/fixtures/paddle_specs/.

Run:  python -m pytest backend/tests/test_spec_normalize.py -q
"""
from __future__ import annotations

import pytest

from backend.scraping.sources.products.spec_normalize import (
    family_key,
    normalize_label,
    parse_grip_in,
    parse_length_in,
    parse_numeric,
    parse_shape,
    parse_thickness_mm,
    parse_weight_oz_range,
    variant_key,
)


# ── thickness ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("16mm",                       16.0),   # JOOLA variant option
    ("14mm",                       14.0),
    ("12.7 mm",                    12.7),   # Paddletek — space before unit
    ("Core Thickness: 16mm",       16.0),   # Selkirk labelled
    ("19mm",                       19.0),   # Selkirk LUXX
    ('0.55" // 14mm',              14.0),   # Six Zero — DUAL UNIT, mm must win
    ("13mm Polypropylene",         13.0),   # Franklin — value glued to material
    ("15.2mm for power and refined control", 15.2),  # Engage — trailing prose
    ("16mm thick core",            16.0),   # Franklin C45 prose
    ("",                           None),
    ("Thickness",                  None),   # a label with no value
    (None,                         None),
])
def test_parse_thickness_mm(raw, expected):
    assert parse_thickness_mm(raw) == expected


def test_thickness_prefers_mm_over_inches_in_dual_unit():
    """Six Zero writes both. Taking the inch number would yield 0.55mm."""
    assert parse_thickness_mm('0.55" // 14mm') == 14.0


def test_thickness_rejects_implausible_values():
    """A stray year or price must not become a thickness."""
    assert parse_thickness_mm("2026mm") is None
    assert parse_thickness_mm("0.2mm") is None


# ── weight (always a range) ─────────────────────────────────────────────────
@pytest.mark.parametrize("raw,lo,hi", [
    ("7.9-8.1oz",                        7.9, 8.1),   # JOOLA
    ("Average Weight: 7.9-8.1oz",        7.9, 8.1),
    ("7.9-8.2 oz",                       7.9, 8.2),   # Selkirk
    ("Weight Range: 7.9 - 8.3 oz",       7.9, 8.3),   # Selkirk LUXX
    ("7.7–8.1 oz",                  7.7, 8.1),   # Paddletek EN DASH U+2013
    ("7.5- 8 OZ.",                       7.5, 8.0),   # Franklin — ragged spacing, caps
    ("7.6 - 8.0oz weight",               7.6, 8.0),   # Franklin C45
    ("8.0 - 8.3 oz // 230gm +/- 5gm",    8.0, 8.3),   # Six Zero — oz must win over gm
    ("8.0 oz.",                          8.0, 8.0),   # Engage — single value
    ("Avg. Wt.: 8.0 oz. ± 0.2",     7.8, 8.2),   # CRBN — plus/minus form
    ("",                                 None, None),
    (None,                               None, None),
])
def test_parse_weight_oz_range(raw, lo, hi):
    assert parse_weight_oz_range(raw) == (lo, hi)


def test_weight_single_value_sets_both_bounds():
    """A point value is a degenerate range, not a half-open one."""
    assert parse_weight_oz_range("8.0 oz.") == (8.0, 8.0)


def test_weight_prefers_oz_over_grams():
    assert parse_weight_oz_range("8.0 - 8.3 oz // 230gm +/- 5gm") == (8.0, 8.3)


# ── length / width (inches, many quote styles) ──────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("16.5in",                  16.5),   # JOOLA
    ("Paddle Length: 16.5in",   16.5),
    ("15.95”",             15.95),  # Selkirk CURLY right-quote
    ('16.5"',                   16.5),   # CRBN straight
    ("16.3” // 413mm",     16.3),   # Six Zero dual — inches must win
    ('16.4" inches (L)',        16.4),   # Franklin — redundant unit word
    ('7.5" x 16.5"',            7.5),    # CRBN composite — first value
    ("",                        None),
    (None,                      None),
])
def test_parse_length_in(raw, expected):
    assert parse_length_in(raw) == expected


def test_length_dual_unit_prefers_inches():
    """413mm is the same length; storing 413 in an inches column is a bug."""
    assert parse_length_in("16.3” // 413mm") == 16.3


# ── grip circumference (fractions appear) ───────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("4.250in",                 4.250),  # JOOLA
    ("4.25”",              4.25),   # Selkirk curly
    ('4.125"',                  4.125),  # CRBN / Six Zero
    ("4 1/4”",             4.25),   # Engage — VULGAR FRACTION
    ("4 1/4 inch",              4.25),   # Engage X2
    ("4.250in/4.125in",         4.250),  # JOOLA — two options, take first
    ("",                        None),
    (None,                      None),
])
def test_parse_grip_in(raw, expected):
    assert parse_grip_in(raw) == expected


def test_grip_parses_mixed_fraction():
    """4 1/4 is 4.25, not 4.0 and not 1/4."""
    assert parse_grip_in("4 1/4”") == 4.25


# ── shape ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("Elongated",                       "elongated"),
    ("Class: Elongated",                "elongated"),
    ("Shape: Elongated - 16.5\" x 7.5\"", "elongated"),   # Paddletek composite
    ("Standard - 16\" x 8\"",           "standard"),
    ("Widebody",                        "widebody"),
    ("Wide Body",                       "widebody"),
    ("Hybrid",                          "hybrid"),
    ("Elongated Shape",                 "elongated"),     # Franklin C45
    ("",                                None),
    ("Carbon Fiber",                    None),            # not a shape
    (None,                              None),
])
def test_parse_shape(raw, expected):
    assert parse_shape(raw) == expected


# ── generic numeric (swing / twist / balance) ───────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("112 +/- 2",              112.0),   # Selkirk OMNI
    ("109",                    109.0),   # Selkirk LUXX
    ("7.9 +/- 0.2",            7.9),
    ("118-120",                119.0),   # CRBN range -> midpoint
    ("115–123",           119.0),   # Paddletek en dash range -> midpoint
    ("6.54",                   6.54),
    ("236mm",                  236.0),   # CRBN balance point
    ("",                       None),
    (None,                     None),
])
def test_parse_numeric(raw, expected):
    assert parse_numeric(raw) == expected


# ── label normalisation (brands drift within their own site) ────────────────
def test_normalize_label_is_case_and_whitespace_insensitive():
    """Selkirk writes these two on OMNI vs LUXX — note the DOUBLE space."""
    a = normalize_label("Average swing weight (as sold)")
    b = normalize_label("Average Swingweight  (may vary +/- .2 pts)")
    assert a.startswith("average swing")
    assert b.startswith("average swing")


@pytest.mark.parametrize("raw,expected", [
    ("Core Thickness:",     "core thickness"),
    ("  CORE  THICKNESS ",  "core thickness"),
    ("Handle Length*",      "handle length"),   # CRBN footnote marker
    ("Grip Circumference*", "grip circumference"),
    ("Avg. Wt.",            "avg wt"),
])
def test_normalize_label(raw, expected):
    assert normalize_label(raw) == expected


# ── family_key: the join currency between three ID spaces ───────────────────
def test_family_key_collapses_variants_to_one_family():
    """These are 5 SKUs of ONE paddle. If they don't collapse, Perseus Pro IV
    occupies 5 of JOOLA's 10 top-10 slots."""
    names = [
        "JOOLA Perseus Pro IV 16mm Pickleball Paddle",
        "JOOLA Perseus Pro IV 14mm Pickleball Paddle",
        "JOOLA Perseus Pro IV 16mm Pickleball Paddle - Tropical Red/Green",
        "Perseus Pro IV 16mm Pickleball Paddle - Tropical Red/Green",
        "JOOLA Perseus Pro IV 14mm Pickleball Paddle - Tropical Red/Green",
    ]
    keys = {family_key(n, "joola") for n in names}
    assert len(keys) == 1, f"expected 1 family, got {keys}"


def test_family_key_does_not_over_collapse_distinct_products():
    """Perseus and Perseus Pro are DIFFERENT paddles. Stripping model
    qualifiers would merge two real products into one row."""
    assert family_key("JOOLA Perseus IV 16mm", "joola") != \
           family_key("JOOLA Perseus Pro IV 16mm", "joola")


def test_family_key_separates_generations():
    assert family_key("JOOLA Perseus Pro IV", "joola") != \
           family_key("JOOLA Perseus Pro V", "joola")


def test_family_key_strips_brand_prefix():
    assert family_key("JOOLA Hyperion CFS", "joola") == family_key("Hyperion CFS", "joola")


def test_family_key_handles_selkirk_sport_prefix():
    assert family_key("Selkirk Sport Project Boomstik", "selkirk") == \
           family_key("Selkirk LABS Project Boomstik", "selkirk")


def test_family_key_survives_mojibake():
    """CRBN's registered mark is stored corrupted as U+FFFD. The key must not
    differ because of an encoding artefact."""
    assert family_key("CRBN� X Series", "crbn") == family_key("CRBN X Series", "crbn")


def test_family_key_unifies_superscript_and_hyphenated_model_numbers():
    """CRBN ships the same paddle as `CRBN-2 X-Series` and `CRBN² X Series`.

    NFKC folds the superscript to a plain digit, producing the token `crbn2`,
    which the brand strip then misses because there is no word boundary between
    `crbn` and `2`. The two spellings previously yielded '2 x series' and
    'crbn2 x series' — one paddle split across two families, and neither
    matching the catalog alias 'CRBN 2'.
    """
    assert family_key("CRBN² X Series", "crbn") == \
           family_key("CRBN-2 X-Series Carbon Fiber Paddle", "crbn")


def test_family_key_keeps_distinct_crbn_generations_apart():
    """CRBN-2 and CRBN-3 are different paddles. Unifying notation must not
    merge two real products."""
    assert family_key("CRBN² TruFoam Barrage", "crbn") != \
           family_key("CRBN³ TruFoam Barrage", "crbn")


def test_family_key_always_strips_the_brand_token():
    for name in ["CRBN² X Series", "CRBN-2 X-Series", "CRBN 2 Pickleball Paddle"]:
        assert not family_key(name, "crbn").startswith("crbn"), name


def test_family_key_is_stable_and_lowercase():
    k = family_key("JOOLA Perseus Pro IV 16mm Pickleball Paddle", "joola")
    assert k == k.lower()
    assert k.strip() == k
    assert "  " not in k


# ── variant_key: NOT NULL upsert key (see migration 024 header) ─────────────
def test_variant_key_never_returns_none_or_empty():
    """The unique constraint depends on this. A NULL here silently duplicates
    every row on re-crawl, because Postgres treats NULLs as distinct."""
    for shape, thick in [(None, None), ("elongated", None), (None, 16.0)]:
        k = variant_key(shape, thick)
        assert isinstance(k, str) and k != ""


def test_variant_key_defaults_when_nothing_parsed():
    assert variant_key(None, None) == "default"


def test_variant_key_distinguishes_shapes_and_thicknesses():
    assert variant_key("elongated", 16.0) != variant_key("widebody", 16.0)
    assert variant_key("elongated", 16.0) != variant_key("elongated", 14.0)


def test_variant_key_is_deterministic():
    assert variant_key("elongated", 16.0) == variant_key("elongated", 16.0)


def test_variant_key_normalises_float_formatting():
    """16 and 16.0 must not produce two rows for the same paddle."""
    assert variant_key("elongated", 16) == variant_key("elongated", 16.0)


# ── endorser prefixes (signature editions) ──────────────────────────────────
# JOOLA lists the same paddle both with and without its athlete's name, and
# retailers copy whichever they were given. On the live review corpus that split
# JOOLA's best-selling paddle in two:
#     "JOOLA Ben Johns Perseus Pro IV 16mm"  -> 176 reviews
#     "JOOLA Perseus Pro IV 16mm"            -> 140 reviews
# Two entries for one paddle, neither ranking where it belongs, and two of
# JOOLA's ten top-10 slots spent on the same product.
#
# The roster is NOT hardcoded — it comes from `influencers.name`, which the repo
# already maintains per brand (CLAUDE.md invariant 5: scraper targets live in
# the database). Callers pass it in.
JOOLA_ATHLETES = ("Ben Johns", "Collin Johns", "Anna Bright", "Tyson McGuffin")


def test_endorser_prefix_does_not_split_a_family():
    assert family_key("JOOLA Ben Johns Perseus Pro IV 16mm Pickleball Paddle",
                      "joola", JOOLA_ATHLETES) == \
           family_key("JOOLA Perseus Pro IV 16mm Pickleball Paddle",
                      "joola", JOOLA_ATHLETES)


def test_endorser_stripped_for_every_athlete_on_the_roster():
    for athlete in JOOLA_ATHLETES:
        assert family_key(f"JOOLA {athlete} Scorpeus Pro IV 14mm", "joola",
                          JOOLA_ATHLETES) == \
               family_key("JOOLA Scorpeus Pro IV 14mm", "joola", JOOLA_ATHLETES)


def test_endorser_only_stripped_as_a_PREFIX():
    """A model genuinely named after someone keeps its name. Only the leading
    endorser badge is removed, never a match in the middle of a model name."""
    assert "johns" in family_key("JOOLA Tribute To Johns 16mm", "joola",
                                 JOOLA_ATHLETES)


def test_endorser_strip_does_not_empty_the_key():
    """A listing that is ONLY the athlete's name must not collapse to '', which
    would silently merge it into every other unkeyable row."""
    assert family_key("JOOLA Ben Johns Pickleball Paddle", "joola",
                      JOOLA_ATHLETES) != ""


def test_no_roster_means_no_stripping():
    """Backwards compatible: the argument is optional and defaults to off."""
    assert family_key("JOOLA Ben Johns Perseus Pro IV", "joola") == \
           "ben johns perseus pro iv"


def test_endorser_matching_is_case_and_punctuation_insensitive():
    assert family_key("JOOLA BEN JOHNS Perseus Pro IV", "joola", JOOLA_ATHLETES) == \
           family_key("JOOLA Perseus Pro IV", "joola", JOOLA_ATHLETES)


def test_endorser_does_not_merge_two_different_models():
    assert family_key("JOOLA Ben Johns Perseus Pro IV", "joola", JOOLA_ATHLETES) != \
           family_key("JOOLA Ben Johns Hyperion CFS 16", "joola", JOOLA_ATHLETES)
