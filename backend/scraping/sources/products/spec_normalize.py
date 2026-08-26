"""Unit + name normalisation for crawled paddle specifications.

Seven brands publish the same six measurements in seven different notations.
This module is the single place that turns their strings into numbers, so the
per-brand parsers stay thin and only need to answer "which text is the weight?"
rather than "what does '8.0 - 8.3 oz // 230gm +/- 5gm' mean?".

Every format handled here was observed in the 2026-08-26 site recon; see
backend/tests/test_spec_normalize.py, where each case is asserted verbatim.

Two conventions worth knowing before editing:

* **Dual-unit strings prefer the unit the column is named for.** Six Zero writes
  `0.55" // 14mm` for thickness and `16.3” // 413mm` for length. Taking the
  wrong half stores 0.55 in a millimetre column, which looks plausible enough to
  survive review and is completely wrong.
* **Nothing here raises.** A parser that cannot read a field returns ``None`` and
  the column stays NULL. A spec crawl that throws on one odd string loses the
  whole brand, which is a far worse outcome than a missing measurement.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable

# ── shared primitives ───────────────────────────────────────────────────────

_NUM = r"\d+(?:\.\d+)?"
# Brands use hyphen, en dash and em dash interchangeably, sometimes within one
# page (Paddletek's spec rows use U+2013 while its prose uses U+002D).
_DASHES = "-–—"
_RANGE = re.compile(rf"({_NUM})\s*[{_DASHES}]\s*({_NUM})")
_PLUSMINUS = re.compile(r"[±]|\+/-")
# Inch markers: straight quote, curly right quote, double prime, `in`, `inch`.
_INCH = re.compile(rf"({_NUM})\s*(?:\"|”|″|''|in\b|inch)", re.I)
_MM = re.compile(rf"({_NUM})\s*mm\b", re.I)
_OZ = re.compile(rf"({_NUM})\s*oz\b", re.I)
# "4 1/4" — a mixed fraction, not two alternatives separated by a slash.
_MIXED_FRACTION = re.compile(rf"(\d+)\s+(\d+)\s*/\s*(\d+)")

# A paddle core is 10-25mm in practice. The guard exists because prose fields
# contain years, prices and model numbers that a bare \d+mm search will happily
# return ("2026mm" from a copyright line).
_THICKNESS_MIN_MM = 5.0
_THICKNESS_MAX_MM = 30.0

_SHAPES = (
    ("widebody", ("widebody", "wide body")),
    ("elongated", ("elongated",)),
    ("hybrid", ("hybrid",)),
    ("standard", ("standard",)),
)


def _clean(value: str | None) -> str:
    """Lowercase, strip the Unicode replacement char, normalise whitespace.

    U+FFFD appears in CRBN product names where the registered mark was mangled
    upstream. It must not change any parse result.
    """
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).replace("�", "")
    return re.sub(r"\s+", " ", text).strip()


def _first(pattern: re.Pattern[str], text: str) -> float | None:
    match = pattern.search(text)
    return round(float(match.group(1)), 3) if match else None


def _segment_for_unit(text: str, unit: re.Pattern[str]) -> str:
    """Pick the half of a `a // b` dual-unit string that carries `unit`."""
    if "//" not in text:
        return text
    for part in text.split("//"):
        if unit.search(part):
            return part
    return text


# ── individual fields ───────────────────────────────────────────────────────

def parse_thickness_mm(value: str | None) -> float | None:
    """Core thickness in millimetres.

    Handles `16mm`, `12.7 mm`, `13mm Polypropylene`, `0.55" // 14mm`.
    Returns None for implausible values rather than trusting a bare regex hit.
    """
    text = _clean(value)
    if not text:
        return None
    mm = _first(_MM, _segment_for_unit(text, _MM))
    if mm is None:
        return None
    return mm if _THICKNESS_MIN_MM <= mm <= _THICKNESS_MAX_MM else None


def parse_weight_oz_range(value: str | None) -> tuple[float | None, float | None]:
    """Static weight as a (min, max) ounce range.

    Every brand publishes a range; a point value returns equal bounds rather
    than a half-open one, so downstream averaging never divides by a None.
    """
    text = _clean(value)
    if not text:
        return (None, None)

    text = _segment_for_unit(text, _OZ)

    # "8.0 oz. ± 0.2" — a centre and a tolerance, not a range.
    if _PLUSMINUS.search(text):
        parts = _PLUSMINUS.split(text, maxsplit=1)
        if len(parts) == 2:
            centres = re.findall(_NUM, parts[0])
            deltas = re.findall(_NUM, parts[1])
            if centres and deltas:
                centre, delta = float(centres[-1]), float(deltas[0])
                return (round(centre - delta, 3), round(centre + delta, 3))

    span = _RANGE.search(text)
    if span:
        return (round(float(span.group(1)), 3), round(float(span.group(2)), 3))

    single = _first(_OZ, text) or _first(re.compile(f"({_NUM})"), text)
    return (single, single) if single is not None else (None, None)


def parse_length_in(value: str | None) -> float | None:
    """First inch measurement in the string.

    Composite strings (`7.5" x 16.5"`) yield the first value, which is the
    caller's responsibility to label correctly — CRBN writes `W x L`.
    """
    text = _clean(value)
    if not text:
        return None
    return _first(_INCH, _segment_for_unit(text, _INCH))


def parse_grip_in(value: str | None) -> float | None:
    """Grip circumference in inches, including mixed fractions.

    Engage writes `4 1/4”`. Read naively that is either 4 or 0.25; correctly it
    is 4.25. The fraction branch runs first because `4.250in/4.125in` (JOOLA's
    two grip options) must NOT be read as a fraction.
    """
    text = _clean(value)
    if not text:
        return None
    fraction = _MIXED_FRACTION.search(text)
    if fraction:
        whole, num, den = (int(g) for g in fraction.groups())
        if den:
            return round(whole + num / den, 3)
    return _first(_INCH, _segment_for_unit(text, _INCH))


def parse_shape(value: str | None) -> str | None:
    """Canonical shape token, or None when the text names no shape."""
    text = _clean(value).lower()
    if not text:
        return None
    for canonical, needles in _SHAPES:
        if any(needle in text for needle in needles):
            return canonical
    return None


def parse_numeric(value: str | None) -> float | None:
    """Swing weight, twist weight, balance point — a single number.

    `112 +/- 2` is a centre with a tolerance and yields 112.
    `118-120` is a genuine range and yields its midpoint.
    """
    text = _clean(value)
    if not text:
        return None
    if _PLUSMINUS.search(text):
        centres = re.findall(_NUM, _PLUSMINUS.split(text, maxsplit=1)[0])
        return round(float(centres[-1]), 3) if centres else None
    span = _RANGE.search(text)
    if span:
        return round((float(span.group(1)) + float(span.group(2))) / 2, 3)
    return _first(re.compile(f"({_NUM})"), text)


def normalize_label(value: str | None) -> str:
    """Fold a spec label for case-, punctuation- and whitespace-insensitive match.

    Brands drift against themselves: Selkirk writes `Average swing weight (as
    sold)` on one paddle and `Average Swingweight  (may vary +/- .2 pts)` on
    another. Parenthetical qualifiers are dropped so both fold to the same stem.
    """
    text = _clean(value).lower()
    if not text:
        return ""
    text = re.sub(r"\([^)]*\)", " ", text)      # drop qualifiers
    text = re.sub(r"[^a-z0-9]+", " ", text)     # punctuation, footnote marks
    return re.sub(r"\s+", " ", text).strip()


# ── join keys ───────────────────────────────────────────────────────────────

# Sub-brand and product-line words that sit between the brand and the model.
_SUBBRAND = ("sport", "labs", "lab", "by")
# Tokens that vary between SKUs of one paddle and must not split a family.
_VARIANT_NOISE = re.compile(
    rf"\b(?:{_NUM}\s*mm|pickleball|paddle|paddles|graphite|"
    r"raw\s+carbon|carbon\s+fiber|elongated|widebody|wide\s+body|hybrid)\b",
    re.I,
)


def family_key(
    product_name: str | None,
    brand_slug: str,
    endorsers: Iterable[str] = (),
) -> str:
    """Collapse SKU spellings of one paddle to a single stable key.

    This is the join currency between the three product ID spaces
    (`products_catalog`, `products`, `paddle_products`), none of which share a
    foreign key. Getting it wrong is visible immediately: JOOLA's Perseus Pro IV
    ships as 7 SKUs, so a key that fails to collapse hands one paddle 7 of that
    brand's 10 top-10 slots.

    Deliberately conservative. Model qualifiers (`Pro`) and generation markers
    (`IV` vs `V`) are preserved, because merging two real products is a worse
    error than listing one twice — the same rule the repo already applies to
    `buildProductMatches`.

    ``endorsers`` is the brand's athlete roster, read from `influencers.name`
    rather than hardcoded. Signature editions are listed both ways — "JOOLA Ben
    Johns Perseus Pro IV" and "JOOLA Perseus Pro IV" are one paddle, and each
    retailer copies whichever name it was handed. Left unstripped that split
    JOOLA's best seller into 176 and 140 reviews and spent two of its ten
    top-10 slots on the same product. Stripping is prefix-only, so a model
    genuinely named after somebody keeps its name.
    """
    raw = _clean(product_name)
    if not raw:
        return ""

    # Colorways and editions follow a spaced dash: "... Paddle - Tropical Red".
    # Split before normalisation, which would destroy the dash.
    raw = re.split(r"\s[-–—]\s", raw)[0]

    text = re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()

    # Strip the brand, then any sub-brand words now exposed at the front.
    for token in _clean(brand_slug).lower().replace("-", " ").split():
        # CRBN ships models as `CRBN²` / `CRBN³`. NFKC folds the superscript to
        # a plain digit, giving the single token `crbn2` — and since there is no
        # word boundary between `crbn` and `2`, the strip below silently misses
        # it. That left `CRBN² X Series` and `CRBN-2 X-Series` with different
        # keys: one paddle split across two families, neither matching the
        # catalog alias `CRBN 2`. Re-insert the boundary first.
        text = re.sub(rf"^{re.escape(token)}(?=\d)", token + " ", text)
        text = re.sub(rf"^{re.escape(token)}\b", "", text).strip()
    changed = True
    while changed:
        changed = False
        for token in _SUBBRAND:
            stripped = re.sub(rf"^{token}\b", "", text).strip()
            if stripped != text:
                text, changed = stripped, True

    # Endorser badge, prefix only. Longest roster name first so "Collin Johns"
    # is not partially consumed by a shorter overlapping entry.
    without_endorser = text
    for endorser in sorted(endorsers, key=len, reverse=True):
        folded = re.sub(r"[^a-z0-9]+", " ", str(endorser).lower()).strip()
        if not folded:
            continue
        stripped = re.sub(rf"^{re.escape(folded)}\b", "", text).strip()
        if stripped != text:
            without_endorser = stripped
            break

    # Emptiness has to be judged on the FINISHED key, not on the intermediate
    # text: "JOOLA Ben Johns Pickleball Paddle" survives the endorser strip as
    # "pickleball paddle", and only _VARIANT_NOISE reduces that to "". An empty
    # key is the worst possible outcome here — every unkeyable row shares it, so
    # they would all merge into one phantom product.
    finished = re.sub(r"\s+", " ", _VARIANT_NOISE.sub(" ", without_endorser)).strip()
    if finished:
        return finished
    return re.sub(r"\s+", " ", _VARIANT_NOISE.sub(" ", text)).strip()


def variant_key(shape: str | None, thickness_mm: float | None) -> str:
    """Deterministic NOT NULL key for the paddle_specs unique constraint.

    Migration 024 keys on (brand_id, source_handle, variant_key) rather than on
    (shape, thickness_mm) because Postgres treats NULLs as *distinct* in a
    unique constraint — a NULL shape would let every re-crawl insert a duplicate
    instead of updating in place. Several brands genuinely omit one of these, so
    NULLs are the normal case, not an edge case.

    Never returns an empty string.
    """
    shape_part = (shape or "").strip().lower() or "any"
    # 16 and 16.0 must not produce two rows for the same paddle.
    thick_part = f"{float(thickness_mm):.1f}" if thickness_mm is not None else "any"
    if shape_part == "any" and thick_part == "any":
        return "default"
    return f"{shape_part}|{thick_part}"
