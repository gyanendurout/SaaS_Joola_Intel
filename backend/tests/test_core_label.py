"""Regression tests for the ambiguous `Core` spec label.

WHY THIS FILE EXISTS
The word "Core" names two completely different measurements depending on the
brand and the paddle's vintage:

    Core: PP core + EVA foam wall     <- a MATERIAL
    Core: 14mm                        <- a THICKNESS
    Core (mm): 14                     <- a THICKNESS, unit in the LABEL

`normalize_label` deliberately strips parentheticals so that Selkirk's
`Average swing weight (as sold)` and `Average Swingweight (may vary...)` fold
together. That same strip turns `Core (mm)` into `core`, which the alias table
mapped unconditionally to `core_material`. A bare `14` then carries no unit, so
nothing downstream could rescue it either.

Result on the live 2026-08-26 JOOLA crawl: 66 of 81 paddles stored thickness as
NULL and core_material as the string "14", while the correct value sat in
raw_specs the whole time. Core thickness is the primary spec buyers compare
(14mm vs 16mm is THE decision), so this silently gutted the comparison.

The fixture set never caught it because all 12 fixtures are flagship paddles,
and flagships use the unambiguous `Core Thickness:` label.
"""
from __future__ import annotations

import pytest

from backend.scraping.sources.products.spec_parse_utils import (
    apply_pairs,
    core_fields,
    new_row,
)


def _row(pairs):
    row = new_row("h", "https://example.com/h", "Test Paddle")
    apply_pairs(row, pairs)
    return row


# ── routing decision ────────────────────────────────────────────────────────
@pytest.mark.parametrize("label,value,expected", [
    # unit in the VALUE
    ("Core",        "14mm",                      ["thickness"]),
    ("Core",        "16mm",                      ["thickness"]),
    # unit in the LABEL, bare number in the value
    ("Core (mm)",   "14",                        ["thickness"]),
    ("Core (mm)",   "12",                        ["thickness"]),
    ("Core (MM)",   "16",                        ["thickness"]),
    # material only
    ("Core",        "PP core",                   ["core_material"]),
    ("Core",        "PP core + EVA foam wall",   ["core_material"]),
    ("Core",        "X7 Thickset Honeycomb Core", ["core_material"]),
    ("Core",        "100% TruFoam Floating Core", ["core_material"]),
    # BOTH in one string (Franklin publishes it this way)
    ("Core",        "13mm Polypropylene",        ["thickness", "core_material"]),
    ("Core",        "16mm Polypropylene Honeycomb", ["thickness", "core_material"]),
])
def test_core_fields_routes_by_value_not_by_label(label, value, expected):
    assert core_fields(label, value) == expected


def test_bare_number_without_mm_in_label_is_not_a_thickness():
    """`Core: 14` with no unit anywhere is genuinely ambiguous. Do not guess a
    millimetre reading out of a naked integer."""
    assert core_fields("Core", "14") == ["core_material"]


def test_implausible_value_is_not_accepted_as_thickness():
    """A model number or year in a `(mm)` field must not become a thickness."""
    assert core_fields("Core (mm)", "2026") == ["core_material"]


# ── end-to-end through apply_pairs ──────────────────────────────────────────
def test_core_mm_populates_thickness_and_leaves_material_null():
    row = _row([("Core (mm)", "16")])
    assert row["thickness_mm"] == 16.0
    assert row["core_material"] is None


def test_core_with_unit_in_value_populates_thickness():
    """JOOLA 'Da Hammer' — the ONLY core field on the page is `Core: 14mm`.
    Storing "14mm" as the core material loses the thickness entirely."""
    row = _row([("Core", "14mm")])
    assert row["thickness_mm"] == 14.0
    assert row["core_material"] is None


def test_both_core_labels_on_one_page_route_independently():
    """JOOLA Ben Johns Perseus CFS 14 publishes both."""
    row = _row([("Core", "PP core"), ("Core (mm)", "14")])
    assert row["thickness_mm"] == 14.0
    assert row["core_material"] == "PP core"


def test_combined_string_yields_both_fields():
    row = _row([("Core", "13mm Polypropylene")])
    assert row["thickness_mm"] == 13.0
    assert row["core_material"] == "13mm Polypropylene"


# ── the flagship path must not regress ──────────────────────────────────────
def test_explicit_core_thickness_label_still_wins():
    row = _row([("Core", "PP Core + CF + EVA Foam"), ("Core Thickness", "16mm")])
    assert row["thickness_mm"] == 16.0
    assert row["core_material"] == "PP Core + CF + EVA Foam"


def test_selkirk_separate_material_and_thickness_labels_unaffected():
    row = _row([("Core thickness", "16mm"), ("Core material", "PureFoam")])
    assert row["thickness_mm"] == 16.0
    assert row["core_material"] == "PureFoam"


def test_six_zero_dual_unit_thickness_unaffected():
    row = _row([("Core Material", "G4 Aerospace Solid Foam Core"),
                ("Core Thickness", '0.55" // 14mm')])
    assert row["thickness_mm"] == 14.0
    assert row["core_material"] == "G4 Aerospace Solid Foam Core"


def test_raw_specs_still_records_the_verbatim_pair():
    """Whatever the routing decides, the original text must survive so a future
    re-parse can be done from the database without re-crawling."""
    row = _row([("Core (mm)", "14")])
    assert row["raw_specs"]["Core (mm)"] == "14"
