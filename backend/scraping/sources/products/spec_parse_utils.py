"""Shared plumbing for the per-brand paddle spec parsers.

Split out of :mod:`spec_parsers` purely for size — the seven brand parsers are
the interesting part and belong in a file you can read end to end. Everything
here is brand-agnostic: HTML-to-text, label vocabulary, the row template that
mirrors ``migrations/024_paddle_specs.sql``, and the guard that makes
"a parser never raises" structurally true rather than a convention.

Two rules this layer enforces on behalf of every brand:

* **All unit work goes through :mod:`spec_normalize`.** Nothing here converts a
  string to a number by itself; it only decides which text is which field.
* **A value that will not parse leaves the column alone.** :func:`assign` never
  writes ``None`` over an already-populated column, so a malformed duplicate
  label cannot erase a good earlier read.
"""
from __future__ import annotations

import html as html_lib
import re
import unicodedata
from typing import Any, Callable, Iterable

from .spec_normalize import (
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

# ── generic text helpers ────────────────────────────────────────────────────

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
# Brands split composite dimension strings with a bare `x` or an `×`, and Engage
# appends the handle with "with a": `16.5 inch x 7.5 inch with a 5.5 inch handle`.
_DIMENSION_SPLIT = re.compile(r"\s+x\s+|\s*×\s*|\s+with\s+(?:a\s+)?", re.I)


def text_of(fragment: str | None) -> str:
    """Tags out, entities in, whitespace collapsed. Never returns None."""
    if not fragment:
        return ""
    return _WS.sub(" ", html_lib.unescape(_TAG.sub(" ", fragment))).strip()


def split_dimensions(value: str | None) -> list[str]:
    """Split `7.35" x 16.5"` / `16.5 inch x 7.5 inch with a 5.5 inch handle`.

    Returned segments are handed to :func:`parse_length_in` one at a time so the
    inch conversion stays in ``spec_normalize`` — this function only decides
    where one measurement ends and the next begins.
    """
    if not value:
        return []
    return [part for part in _DIMENSION_SPLIT.split(value) if part and part.strip()]


def dimension_at(value: str | None, index: int) -> float | None:
    parts = split_dimensions(value)
    if index >= len(parts):
        return None
    return parse_length_in(parts[index])


def fold(value: str | None) -> str:
    """Aggressive fold for identity matching: NFKC, lowercase, alphanumerics only.

    NFKC is what turns CRBN's superscript column headings (`TFB¹`, `TFB³`) into
    `tfb1` / `tfb3` so they can be matched against the Shopify handle.
    """
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", str(value)).lower())


# ── certification ───────────────────────────────────────────────────────────

_USAP_BODY = re.compile(r"\b(usapa?|usa\s*pickleball)\b", re.I)
_USAP_AFFIRMS = re.compile(r"\b(yes|approved|approval|certified|registered)\b", re.I)
# "in process of being approved & listed" (Engage Pro1) asserts and retracts in
# one breath. NULL is the only honest reading of a self-contradicting claim.
_USAP_HEDGED = re.compile(r"\bin\s+process\b|\bpending\b|\bsubmitted\b", re.I)


def usap_from(text: str | None) -> bool | None:
    """True only for an unhedged affirmative. Never False — see module docstring."""
    body = text_of(text)
    if not body or not _USAP_BODY.search(body) or _USAP_HEDGED.search(body):
        return None
    return True if _USAP_AFFIRMS.search(body) else None


# ── label vocabulary ────────────────────────────────────────────────────────
# Keys are the output of spec_normalize.normalize_label(), which lowercases,
# drops parenthetical qualifiers and folds punctuation — so "Grip Circumference*",
# "Handle Circum." and "Average Swingweight (may vary +/- .2 pts)" all arrive
# here as stable stems.
_FIELD_ALIASES: dict[str, str] = {
    "average weight": "weight",
    "avg wt": "weight",
    "static weight": "weight",
    "weight range": "weight",
    "weight": "weight",

    "paddle length": "length",
    "paddle lengths": "length",
    "total length": "length",
    "length": "length",

    "paddle width": "width",
    "paddle widths": "width",
    "width": "width",

    "grip length": "handle_length",
    "handle length": "handle_length",
    "handle lengths": "handle_length",

    "grip circumference": "grip",
    "grip circum": "grip",
    "handle circumference": "grip",
    "handle circum": "grip",

    "core thickness": "thickness",
    "thickness": "thickness",

    # `core` alone is AMBIGUOUS — see core_fields(). It carries a material on
    # some paddles and a thickness on others, and `Core (mm)` folds to it too
    # because normalize_label strips parentheticals.
    "core": "core_ambiguous",
    "core material": "core_material",

    "face": "face_material",
    "face material": "face_material",
    "surface": "face_material",
    "skin": "face_material",

    "swing weight": "swing_weight",
    "swingweight": "swing_weight",
    "average swing weight": "swing_weight",
    "average swingweight": "swing_weight",

    "twist weight": "twist_weight",
    "twistweight": "twist_weight",
    "average twist weight": "twist_weight",
    "average twistweight": "twist_weight",

    "balance point": "balance_point",

    "shape": "shape",
    "class": "shape",

    "usap certified": "usap",
    "usap": "usap",
    "usa pickleball": "usap",
    "usa pickleball certified": "usap",
    "registered approval body": "usap",
    "certification": "usap",
}


def field_for(label: str | None) -> str | None:
    return _FIELD_ALIASES.get(normalize_label(label))


# `Core` is the one label in the table that cannot be resolved from the label
# alone. Three real forms, all from the 2026-08-26 crawl:
#
#     Core: PP core + EVA foam wall     -> material
#     Core: 14mm                        -> thickness
#     Core (mm): 14                     -> thickness, unit lives in the LABEL
#
# The third is the trap: normalize_label strips `(mm)` (it has to — Selkirk's
# swing-weight labels depend on that strip), leaving a naked `14` that no
# unit-aware parser will accept. 66 of 81 JOOLA paddles lost their thickness
# to this. Routing therefore happens on the VALUE, with the label consulted
# only for the unit.
_MM_IN_LABEL = re.compile(r"\bmm\b", re.I)
# Enough alphabetic run to be a material name rather than a stray unit word.
_MATERIAL_WORD = re.compile(r"[a-z]{3,}", re.I)
# Unit words that survive digit-stripping and must not be mistaken for a name.
_UNIT_WORDS = re.compile(r"\b(?:mm|cm|in|inch|inches|oz|g|gm|grams?)\b", re.I)


def core_fields(label: str | None, value: str | None) -> list[str]:
    """Which column(s) a `Core`-labelled value belongs in.

    Returns `["thickness"]`, `["core_material"]`, or both — Franklin publishes
    `13mm Polypropylene`, which is genuinely both facts in one string.
    """
    text = text_of(value)
    fields: list[str] = []

    if parse_thickness_mm(text) is not None:
        fields.append("thickness")
    elif _MM_IN_LABEL.search(label or ""):
        # Unit in the label: re-attach it so the plausibility guard in
        # parse_thickness_mm still gets to reject years and model numbers.
        bare = parse_numeric(text)
        if bare is not None and parse_thickness_mm(f"{bare}mm") is not None:
            fields.append("thickness")

    if _MATERIAL_WORD.search(_UNIT_WORDS.sub(" ", text)):
        fields.append("core_material")

    # A value that parsed as neither still belongs somewhere; material is the
    # lossless choice because assign() stores it verbatim.
    return fields or ["core_material"]


def mm_repaired(value: str | None) -> str:
    """Re-attach the millimetre unit that lived in the label.

    `assign` is unit-aware by design, so handing it the bare `14` from
    `Core (mm): 14` would parse to nothing. Only ever called after
    `core_fields` has already ruled the value a thickness.
    """
    text = text_of(value)
    if parse_thickness_mm(text) is not None:
        return text
    bare = parse_numeric(text)
    return f"{bare}mm" if bare is not None else text


def assign_labelled(row: dict[str, Any], label: str | None, value: str | None) -> None:
    """`assign`, for labels that cannot be resolved without seeing their value.

    Every path that turns a brand's verbatim `label: value` pair into columns
    goes through here, so a parser that reaches for `assign` directly (CRBN
    reads a comparison grid, not a list) still gets the ambiguous-`Core`
    handling instead of silently discarding the pair.
    """
    field = field_for(label)
    if field is None:
        return
    if field == "core_ambiguous":
        for resolved in core_fields(label, value):
            assign(row, resolved,
                   mm_repaired(value) if resolved == "thickness" else value)
        return
    assign(row, field, value)


def assign(row: dict[str, Any], field: str, value: str | None) -> None:
    """Convert `value` for `field` and write it, but only if it actually parsed.

    Never clears an already-populated column: a later unparseable duplicate label
    must not wipe out a good earlier read.
    """
    if field == "weight":
        low, high = parse_weight_oz_range(value)
        if low is not None:
            row["weight_oz_min"], row["weight_oz_max"] = low, high
        return
    if field == "core_ambiguous":
        # Reached when a caller resolves a label without its value. Route on the
        # value alone rather than dropping it — silently losing a spec is the
        # failure mode this whole module exists to prevent.
        assign_labelled(row, "Core", value)
        return
    if field in ("core_material", "face_material"):
        cleaned = text_of(value) or None
        if cleaned:
            row[field] = cleaned
        return

    converters: dict[str, tuple[str, Callable[[str | None], float | None]]] = {
        "length": ("length_in", parse_length_in),
        "width": ("width_in", parse_length_in),
        "handle_length": ("handle_length_in", parse_length_in),
        "grip": ("grip_circum_in", parse_grip_in),
        "thickness": ("thickness_mm", parse_thickness_mm),
        "swing_weight": ("swing_weight", parse_numeric),
        "twist_weight": ("twist_weight", parse_numeric),
        "balance_point": ("balance_point_mm", parse_numeric),
    }
    target = converters.get(field)
    if not target:
        return
    column, convert = target
    parsed = convert(value)
    if parsed is not None:
        row[column] = parsed


# ── row construction ────────────────────────────────────────────────────────

_CONFIDENCE_RANK = {"labelled": 0, "variant": 1, "prose": 2}

_COLUMNS = (
    "shape", "thickness_mm", "length_in", "width_in", "handle_length_in",
    "weight_oz_min", "weight_oz_max", "grip_circum_in", "core_material",
    "face_material", "swing_weight", "twist_weight", "balance_point_mm",
    "usap_approved",
)


def new_row(handle: str, url: str, name: str) -> dict[str, Any]:
    row: dict[str, Any] = {
        "source_handle": handle,
        "source_url": url,
        "product_name": name,
        "family_key": "",
        "variant_key": "",
        "raw_specs": {},
        "source_confidence": "labelled",
    }
    for column in _COLUMNS:
        row[column] = None
    return row


def downgrade(row: dict[str, Any], confidence: str) -> None:
    """Move source_confidence down (never up) to the weakest source used."""
    if _CONFIDENCE_RANK[confidence] > _CONFIDENCE_RANK[row["source_confidence"]]:
        row["source_confidence"] = confidence


# Athlete rosters, keyed by brand slug, populated once per run from
# `influencers.name` by the crawler. Module-level rather than threaded through
# every parser signature because it is read-only reference data — and it MUST
# match what the frontend uses, or family_key stops being a join key.
ENDORSERS: dict[str, tuple[str, ...]] = {}


def finalize(
    row: dict[str, Any],
    brand_slug: str,
    shape_label: str | None = None,
) -> dict[str, Any] | None:
    """Compute the two join keys. Returns None if the row cannot be keyed.

    ``shape_label`` is the brand's verbatim shape word, used to keep two shapes
    of one paddle apart when ``parse_shape`` refuses to canonicalise it (Selkirk
    Epic/Invikta, CRBN Square). ``shape`` itself stays NULL in that case.
    """
    row["family_key"] = family_key(row["product_name"], brand_slug,
                                   ENDORSERS.get(brand_slug, ()))
    if not row["family_key"]:
        return None
    row["variant_key"] = variant_key(
        row["shape"] or shape_discriminator(shape_label), row["thickness_mm"])
    return row


def shape_discriminator(shape_label: str | None) -> str | None:
    """A fallback variant_key token, but only when the label is a NAME.

    Engage publishes `Shape: 16.6" x 7.4" with a 6.0" handle length` — a
    measurement, not a shape. Feeding that to ``variant_key`` would bake paddle
    dimensions into the unique key, so a label containing digits or running past
    three words is rejected and the key falls back to `any`.
    """
    label = text_of(shape_label)
    if not label or any(char.isdigit() for char in label) or len(label.split()) > 3:
        return None
    return label


def guard(
    parser: Callable[[dict[str, Any], str | None], list[dict[str, Any]]],
    product_json: dict[str, Any] | None,
    page_html: str | None,
) -> list[dict[str, Any]]:
    """Run a parser so that no input can ever propagate an exception upward."""
    try:
        rows = parser(product_of(product_json), page_html or "")
    except Exception:  # noqa: BLE001 — a broken page must not kill the brand
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("variant_key")]


# ── identity ────────────────────────────────────────────────────────────────

_BRAND_SITES = {
    "joola": "https://joola.com/products/{handle}",
    "selkirk": "https://www.selkirk.com/products/{handle}",
    "crbn": "https://crbnpickleball.com/products/{handle}",
    "paddletek": "https://www.paddletek.com/products/{handle}",
    "engage": "https://engagepickleball.com/products/{handle}",
    "six-zero": "https://www.sixzeropickleball.com/products/{handle}",
    # Adobe Commerce, not Shopify — "handle" is Magento's url key.
    "franklin": "https://franklinsports.com/products/{handle}",
}

_CANONICAL = re.compile(
    r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']', re.I)
_OG_URL = re.compile(
    r'<meta[^>]+property=["\']og:url["\'][^>]+content=["\']([^"\']+)["\']', re.I)
_TITLE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.I)


def product_of(product_json: dict[str, Any] | None) -> dict[str, Any]:
    """Unwrap Shopify's `{"product": {...}}` envelope, tolerating a bare product."""
    if not isinstance(product_json, dict):
        return {}
    inner = product_json.get("product", product_json)
    return inner if isinstance(inner, dict) else {}


def page_url(page_html: str) -> str:
    for pattern in (_CANONICAL, _OG_URL):
        found = pattern.search(page_html or "")
        if found:
            return html_lib.unescape(found.group(1)).strip()
    return ""


def identity(
    product: dict[str, Any],
    page_html: str,
    brand_slug: str,
) -> tuple[str, str, str] | None:
    """(handle, name, url). Falls back to the rendered page when JSON is absent."""
    url = page_url(page_html)
    handle = str(product.get("handle") or "").strip()
    if not handle and url:
        handle = url.rstrip("/").rsplit("/", 1)[-1]
    name = text_of(product.get("title"))
    if not name and page_html:
        found = _TITLE.search(page_html)
        # Shopify appends " – Brand" / " | Brand" to <title>; the first segment
        # is the product name.
        name = re.split(r"\s+[–|-]\s+", text_of(found.group(1)))[0] if found else ""
    if not handle or not name:
        return None
    if not url:
        url = _BRAND_SITES.get(brand_slug, "{handle}").format(handle=handle)
    return handle, name, url


def body_text(product: dict[str, Any]) -> str:
    return text_of(product.get("body_html"))


def thickness_options(product: dict[str, Any]) -> list[tuple[str, float]]:
    """Shopify option values that name a core thickness.

    JOOLA calls the option `Size` (`16mm`, `14mm`), Paddletek calls it
    `Core Thickness` (`12.7 mm`, `14.3 mm`), Six Zero calls it `Thickness`. The
    option NAME is unreliable, so values are tested instead: an option counts
    only if its values parse to a plausible core thickness.
    """
    options = product.get("options")
    if not isinstance(options, list):
        return []
    for option in options:
        if not isinstance(option, dict):
            continue
        values = option.get("values")
        if not isinstance(values, list):
            continue
        found = [
            (str(value), parse_thickness_mm(str(value)))
            for value in values
            if parse_thickness_mm(str(value)) is not None
        ]
        if found:
            # Deduplicate while preserving publication order: "16mm" and "16 mm"
            # on one option must not become two rows.
            seen: set[float] = set()
            unique: list[tuple[str, float]] = []
            for raw, millimetres in found:
                if millimetres is not None and millimetres not in seen:
                    seen.add(millimetres)
                    unique.append((raw, millimetres))
            return unique
    return []


# ── HTML table / list primitives ────────────────────────────────────────────

TABLE = re.compile(r"<table\b[\s\S]*?</table>", re.I)
ROW = re.compile(r"<tr\b[\s\S]*?</tr>", re.I)
CELL = re.compile(r"<t[dh]\b[^>]*>([\s\S]*?)</t[dh]>", re.I)
LIST_ITEM = re.compile(r"<li\b[^>]*>([\s\S]*?)</li>", re.I)


def table_pairs(table_html: str) -> list[tuple[str, str]]:
    """(label, value) for every two-or-more-cell row of an HTML table."""
    pairs: list[tuple[str, str]] = []
    for row in ROW.findall(table_html):
        cells = [text_of(cell) for cell in CELL.findall(row)]
        if len(cells) >= 2:
            pairs.append((cells[0].rstrip(":").strip(), cells[1]))
    return pairs


def split_label_value(line: str) -> tuple[str, str]:
    """`Average weight: 7.9-8.2 oz` -> ('Average weight', '7.9-8.2 oz')."""
    label, _, value = line.partition(":")
    return label.strip(), value.strip()


def record(row: dict[str, Any], label: str, value: str) -> None:
    """Stash the verbatim pair in raw_specs. Everything found lands here."""
    if label:
        row["raw_specs"][label] = value


def apply_pairs(
    row: dict[str, Any],
    pairs: Iterable[tuple[str, str]],
    *,
    shape_from_dimensions: bool = False,
) -> str | None:
    """Record and convert a stream of label/value pairs. Returns the shape label.

    ``shape_from_dimensions`` handles Engage and Paddletek, where the Shape line
    carries the shape word AND the length/width/handle in one string.
    """
    shape_label: str | None = None
    for label, value in pairs:
        if not label and not value:
            continue
        record(row, label, value)
        field = field_for(label)
        if field is None:
            continue
        if field == "usap":
            if row["usap_approved"] is None:
                row["usap_approved"] = usap_from(f"{label} {value}")
            continue
        if field == "core_ambiguous":
            assign_labelled(row, label, value)
            continue
        if field == "shape":
            shape_label = value or shape_label
            if row["shape"] is None:
                row["shape"] = parse_shape(value)
            if shape_from_dimensions:
                for index, column in enumerate(("length_in", "width_in", "handle_length_in")):
                    measurement = dimension_at(value, index)
                    if measurement is not None and row[column] is None:
                        row[column] = measurement
            continue
        assign(row, field, value)
    return shape_label
