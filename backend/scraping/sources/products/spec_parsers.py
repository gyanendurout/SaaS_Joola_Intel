"""Per-brand paddle specification parsers.

One function per in-scope brand, all with the same signature::

    parse_<brand>(product_json: dict | None, html: str | None) -> list[dict]

Each returns **zero or more** rows shaped exactly like the columns of
``migrations/024_paddle_specs.sql``. Zero or more, not one, because the table's
grain is (brand, source_handle, variant_key) and a multi-shape paddle publishes
a genuinely different spec set per shape — Selkirk's OMNI ships Widebody and
Elongated with different lengths, widths, handles, swing and twist weights, and
Six Zero's Coral ships three.

Design rules, all of them load-bearing:

* **Nothing raises.** Every parser body runs inside :func:`~.spec_parse_utils.guard`.
  A field that will not parse is ``None``; a page that will not parse is ``[]``.
  Losing one measurement must never lose a whole brand's crawl.
* **All unit work goes through :mod:`spec_normalize`.** These parsers only ever
  answer "which text is the weight?" — never "what does `8.0 - 8.3 oz // 230gm`
  mean?". Same for ``family_key`` / ``variant_key``, which are the join currency
  with the frontend and must not be re-derived here.
* **``usap_approved`` is True or None, never False.** Only 4 of the 7 brands
  publish certification despite all 7 being certified, so absence is silence,
  not a negative. An ambiguous statement (Engage's "USAP-Approved ... (in
  process of being approved & listed)") also reads as None.
* **No invented shape vocabulary.** ``parse_shape`` names four canonical shapes.
  Selkirk's "Epic"/"Invikta" and CRBN's "Square" are proper nouns from those
  brands' own product lines — Selkirk's site nav even lists *Widebody, Epic,
  Invikta* as siblings — so mapping them onto a canonical shape would be an
  editorial guess dressed up as scraped data. Those rows keep ``shape = NULL``
  and carry the verbatim word in ``raw_specs['Shape']``; the word is still used
  as the ``variant_key`` discriminator, because otherwise two shapes of one
  paddle collide on the unique constraint and one silently overwrites the other.

``source_confidence`` is the **weakest source used for any of the six universal
comparison fields** (thickness, length, width, handle length, weight, shape) —
so a row whose thickness came from a Shopify option is 'variant' even though its
length came from a spec table, and CRBN is 'prose' because its thickness exists
only in marketing copy. Ranking on a field is only ever as sound as its worst
input.

Shared plumbing lives in :mod:`spec_parse_utils`. Fixtures for every parser here
live in ``backend/tests/fixtures/paddle_specs/`` and are asserted in
``backend/tests/test_spec_parsers.py``.
"""
from __future__ import annotations

import html as html_lib
import re
from typing import Any

from .spec_normalize import normalize_label, parse_shape, parse_thickness_mm
from .spec_parse_utils import (
    LIST_ITEM,
    TABLE,
    apply_pairs,
    assign,
    assign_labelled,
    body_text,
    dimension_at,
    downgrade,
    field_for,
    finalize,
    fold,
    guard,
    identity,
    new_row,
    record,
    split_label_value,
    table_pairs,
    text_of,
    thickness_options,
    usap_from,
)

__all__ = [
    "parse_joola",
    "parse_selkirk",
    "parse_crbn",
    "parse_paddletek",
    "parse_engage",
    "parse_sixzero",
    "parse_franklin",
    "franklin_product_urls",
]

# ── JOOLA ───────────────────────────────────────────────────────────────────
# Spec carrier: `#product-tab-2 .specifications-section`, two <table>s side by
# side. Thickness is NOT in either — it exists only as the Shopify `Size` option
# (`16mm` / `14mm`), which is why every JOOLA row is 'variant' confidence and why
# one product yields one row per thickness.

_JOOLA_SPECS = re.compile(
    r'specifications-section[\s\S]*?(<table[\s\S]*?</table>[\s\S]*?</div>[\s\S]*?</div>)',
    re.I)


def _parse_joola(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "joola")
    if not who:
        return []
    handle, name, url = who

    section = _JOOLA_SPECS.search(page_html or "")
    if not section:
        return []
    pairs: list[tuple[str, str]] = []
    for table in TABLE.findall(section.group(1)):
        pairs.extend(table_pairs(table))
    if not pairs:
        return []

    thicknesses = thickness_options(product) or [("", None)]
    rows: list[dict[str, Any]] = []
    for raw_thickness, millimetres in thicknesses:
        row = new_row(handle, url, name)
        shape_label = apply_pairs(row, pairs)
        if millimetres is not None:
            row["thickness_mm"] = millimetres
            record(row, "Core Thickness", raw_thickness)
            downgrade(row, "variant")
        finalized = finalize(row, "joola", shape_label)
        if finalized:
            rows.append(finalized)
    return rows


def parse_joola(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_joola, product_json, html)


# ── Selkirk ─────────────────────────────────────────────────────────────────
# Spec carrier: the `div#tech-specs .metafield-rich_text_field` metafield — a
# <p> shape heading followed by a <ul> of `Label: value`, repeated per shape.
# LUXX nests: `Handle Lengths:` (no value) then `Epic: 5.25”`, so a sub-item
# labelled with the block's own shape name belongs to the preceding header.

_SELKIRK_METAFIELD = re.compile(
    r'id=["\']tech-specs["\'][\s\S]*?<div[^>]*metafield-rich_text_field[^>]*>([\s\S]*?)</div>',
    re.I)
_SELKIRK_BLOCK = re.compile(r"<p[^>]*>([\s\S]*?)</p>\s*<ul[^>]*>([\s\S]*?)</ul>", re.I)


def _selkirk_pairs(list_html: str, heading: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    pending_header: str | None = None
    folded_heading = normalize_label(heading)
    for item in LIST_ITEM.findall(list_html):
        label, value = split_label_value(text_of(item))
        if not label:
            continue
        if not value:
            pending_header = label
            continue
        if pending_header and normalize_label(label) == folded_heading:
            pairs.append((pending_header, value))
            pending_header = None
            continue
        pending_header = None
        pairs.append((label, value))
    return pairs


def _parse_selkirk(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "selkirk")
    if not who:
        return []
    handle, name, url = who

    metafield = _SELKIRK_METAFIELD.search(page_html or "")
    if not metafield:
        return []

    rows: list[dict[str, Any]] = []
    for heading_html, list_html in _SELKIRK_BLOCK.findall(metafield.group(1)):
        heading = text_of(heading_html)
        pairs = _selkirk_pairs(list_html, heading)
        if not heading or not pairs:
            continue
        row = new_row(handle, url, name)
        row["shape"] = parse_shape(heading)
        record(row, "Shape", heading)
        apply_pairs(row, pairs)
        finalized = finalize(row, "selkirk", heading)
        if finalized:
            rows.append(finalized)
    return rows


def parse_selkirk(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_selkirk, product_json, html)


# ── CRBN ────────────────────────────────────────────────────────────────────
# Spec carrier: a four-column comparison grid that is IDENTICAL on every TruFoam
# Barrage page. The `active` CSS class marks column 1 on all of them regardless
# of which product loaded, so the column is matched on the superscript heading
# (`TFB³` -> `tfb3`, the Shopify handle) and, failing that, on the Shape row
# against the parenthetical in the product title.
# Thickness appears nowhere in the grid — only in marketing copy ("engineered at
# 14mm") — which is why every CRBN row is 'prose' confidence.

_CRBN_BLOCK = re.compile(r'class="[^"]*comparison-grid-(header|rows)-[^"]*"', re.I)
_CRBN_HEADING = re.compile(
    r'class="comparison-column-heading-[^"]*"[^>]*>([\s\S]*?)</a>', re.I)
_CRBN_VALUE = re.compile(r'<p class="comparison-value-[^"]*"[^>]*>([\s\S]*?)</p>', re.I)
_CRBN_LABEL = re.compile(r"<h3[^>]*>([\s\S]*?)</h3>", re.I)
_CRBN_PARENTHETICAL = re.compile(r"\(([^)]+)\)")
# Keep the slice short enough that a second comparison table further down the
# page cannot leak its values into this one.
_CRBN_BLOCK_SPAN = 20000


def _crbn_grid(page_html: str) -> tuple[list[str], list[tuple[str, list[str]]]] | None:
    """(column headings, [(row label, [values...])]) for the first grid on a page."""
    marks = [(m.start(), m.group(1).lower()) for m in _CRBN_BLOCK.finditer(page_html)]
    if not marks:
        return None
    headings: list[str] = []
    rows: list[tuple[str, list[str]]] = []
    started = False
    for index, (start, kind) in enumerate(marks):
        end = marks[index + 1][0] if index + 1 < len(marks) else len(page_html)
        block = page_html[start:min(end, start + _CRBN_BLOCK_SPAN)]
        if kind == "header":
            if started:            # a second table begins — stop at the first
                break
            headings = [text_of(h) for h in _CRBN_HEADING.findall(block)]
            started = bool(headings)
            continue
        if not started:
            continue
        label = _CRBN_LABEL.search(block)
        values = [text_of(v) for v in _CRBN_VALUE.findall(block)]
        if label and values:
            rows.append((text_of(label.group(1)), values))
    if not headings or not rows:
        return None
    return headings, rows


def _crbn_column(
    headings: list[str],
    rows: list[tuple[str, list[str]]],
    handle: str,
    name: str,
) -> int | None:
    """Pick this product's column. NEVER by `.active` — see module docstring."""
    folded_handle = fold(handle)
    for index, heading in enumerate(headings):
        if folded_handle and fold(heading) == folded_handle:
            return index

    hint = _CRBN_PARENTHETICAL.search(name)
    if not hint:
        return None
    folded_hint = fold(hint.group(1))
    shape_values = next(
        (values for label, values in rows if normalize_label(label) == "shape"), None)
    if not shape_values or not folded_hint:
        return None
    for index, value in enumerate(shape_values):
        if fold(value) == folded_hint:
            return index
    for index, value in enumerate(shape_values):      # last resort: containment
        if folded_hint in fold(value):
            return index
    return None


def _parse_crbn(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "crbn")
    if not who:
        return []
    handle, name, url = who

    grid = _crbn_grid(page_html or "")
    if not grid:
        return []
    headings, grid_rows = grid
    column = _crbn_column(headings, grid_rows, handle, name)
    if column is None:
        return []

    row = new_row(handle, url, name)
    shape_label: str | None = None
    for label, values in grid_rows:
        if column >= len(values):
            continue
        value = values[column]
        record(row, label, value)
        folded = normalize_label(label)
        if folded == "shape":
            shape_label = value
            row["shape"] = parse_shape(value)
            continue
        if folded == "w x l":                     # CRBN publishes WIDTH first
            row["width_in"] = dimension_at(value, 0)
            row["length_in"] = dimension_at(value, 1)
            continue
        if field_for(label) not in ("shape", "usap"):
            assign_labelled(row, label, value)

    thickness = parse_thickness_mm(body_text(product))
    if thickness is not None:
        row["thickness_mm"] = thickness
        record(row, "Core Thickness (prose)", f"{thickness:g}mm")
    downgrade(row, "prose")

    finalized = finalize(row, "crbn", shape_label)
    return [finalized] if finalized else []


def parse_crbn(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_crbn, product_json, html)


# ── Paddletek ───────────────────────────────────────────────────────────────
# Spec carrier: `.ptk-specs__row`, which renders the CURRENTLY SELECTED variant
# only — production re-fetches it per variant via the Section Rendering API.
# One capture therefore measures exactly one thickness. Every other thickness
# still gets a row (the grain requires it, and the upsert has to be stable), but
# carries only the product-level facts and 'variant' confidence.

_PTK_ROW = re.compile(r'<div class="ptk-specs__row[^"]*"[\s\S]*?</div>\s*</div>', re.I)


def _paddletek_pairs(page_html: str) -> list[tuple[str, str]]:
    """One `Label: value` per `.ptk-specs__row`.

    The label and value share an element, so the row is flattened to text and
    split on the first colon rather than by cell. Rows that render a slider
    instead of a number ("Power Level: Control All-Court Power") come through
    too; they are recorded in raw_specs and ignored by the field map.
    """
    pairs: list[tuple[str, str]] = []
    for block in _PTK_ROW.findall(page_html):
        label, value = split_label_value(text_of(block))
        if label and value:
            pairs.append((label, value))
    return pairs


def _parse_paddletek(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "paddletek")
    if not who:
        return []
    handle, name, url = who

    pairs = _paddletek_pairs(page_html or "")
    options = thickness_options(product)
    if not pairs and not options:
        return []

    measured = new_row(handle, url, name)
    shape_label = apply_pairs(measured, pairs, shape_from_dimensions=True)
    rendered_thickness = measured["thickness_mm"]

    if not options:
        finalized = finalize(measured, "paddletek", shape_label)
        return [finalized] if finalized else []

    rows: list[dict[str, Any]] = []
    for raw_thickness, millimetres in options:
        if rendered_thickness is not None and millimetres == rendered_thickness:
            row = measured
        else:
            # Shape is a product-level fact and carries over; measurements do not.
            row = new_row(handle, url, name)
            row["shape"] = measured["shape"]
            row["thickness_mm"] = millimetres
            record(row, "Core Thickness", raw_thickness)
            downgrade(row, "variant")
        finalized = finalize(row, "paddletek", shape_label)
        if finalized:
            rows.append(finalized)
    return rows


def parse_paddletek(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_paddletek, product_json, html)


# ── Engage ──────────────────────────────────────────────────────────────────
# Spec carrier: a `<p><strong>Specifications:</strong></p><ul>` block inside
# `body_html`. No page fetch needed at all — the `html` argument is accepted for
# signature parity and used only to recover identity if the JSON is thin.

_ENGAGE_SPEC_LIST = re.compile(
    r"Specifications\s*:?\s*(?:</strong>)?\s*(?:</p>)?\s*<ul[^>]*>([\s\S]*?)</ul>", re.I)


def _parse_engage(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "engage")
    if not who:
        return []
    handle, name, url = who

    body = product.get("body_html") or ""
    block = _ENGAGE_SPEC_LIST.search(body)
    if not block:
        return []

    pairs: list[tuple[str, str]] = []
    certification: list[str] = []
    for item in LIST_ITEM.findall(block.group(1)):
        line = text_of(item)
        if not line:
            continue
        label, value = split_label_value(line)
        if not value:
            # Unlabelled bullets: "USA Pickleball Certified and PBCoR .43 Approved".
            certification.append(label)
            continue
        pairs.append((label, value))

    row = new_row(handle, url, name)
    shape_label = apply_pairs(row, pairs, shape_from_dimensions=True)
    for index, line in enumerate(certification):
        record(row, f"Certification {index + 1}", line)
        if row["usap_approved"] is None:
            row["usap_approved"] = usap_from(line)

    finalized = finalize(row, "engage", shape_label)
    return [finalized] if finalized else []


def parse_engage(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_engage, product_json, html)


# ── Six Zero ────────────────────────────────────────────────────────────────
# Spec carrier: one `table.dcf-table` per shape, whose first row is a caption
# ("Coral 16mm Elongated"). Shape is derived from the caption; the caption minus
# the product name is the verbatim shape word.

_SIXZERO_TABLE = re.compile(r'<table[^>]*\bdcf-table\b[\s\S]*?</table>', re.I)


def _parse_sixzero(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "six-zero")
    if not who:
        return []
    handle, name, url = who

    rows: list[dict[str, Any]] = []
    for table in _SIXZERO_TABLE.findall(page_html or ""):
        pairs = table_pairs(table)
        if not pairs:
            continue
        caption, first_value = pairs[0]
        body_pairs = pairs[1:] if not first_value else pairs
        if not body_pairs:
            continue

        row = new_row(handle, url, name)
        shape_label: str | None = None
        if not first_value and caption:
            record(row, "Shape", caption)
            row["shape"] = parse_shape(caption)
            # "Coral 16mm Hybrid" minus "Coral 16mm" is the shape word; when the
            # caption IS the product name there is no shape to discriminate on.
            remainder = re.sub(re.escape(name), "", caption, flags=re.I).strip(" -–—")
            shape_label = remainder or None
        apply_pairs(row, body_pairs)

        finalized = finalize(row, "six-zero", shape_label)
        if finalized:
            rows.append(finalized)
    return rows


def parse_sixzero(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_sixzero, product_json, html)


# ── Franklin ────────────────────────────────────────────────────────────────
# !! UNVERIFIED !!
# There is no Franklin fixture — no product JSON, no captured page. Franklin is
# the only non-Shopify brand (Adobe Commerce) and the only one behind a
# Cloudflare Managed Challenge, so the recon captured none of its HTML. This
# parser is written from the recon notes in docs/PRODUCT_INTEL_REDESIGN.md §3
# ("freeform prose in description", difficulty moderate) plus the standard
# Magento additional-attributes markup, and it has NEVER RUN AGAINST A REAL
# FRANKLIN PAGE. Its selectors are a hypothesis.
#
# Consequences, deliberately chosen so that being wrong is cheap:
#   * The attribute-table branch is tried first and yields 'labelled'; if the
#     table is absent or differently classed, the branch simply finds nothing.
#   * The prose branch only fires on explicitly labelled fragments ("Core
#     Thickness: 16mm"), never on a bare number, and is always 'prose'.
#   * No shape is guessed from the product name.
# Before trusting any Franklin row, capture a real page into
# backend/tests/fixtures/paddle_specs/ and replace this comment with tests.

_FRANKLIN_ATTR_TABLE = re.compile(
    r'<table[^>]*(?:product-attribute-specs-table|additional-attributes)[\s\S]*?</table>', re.I)
_FRANKLIN_DESCRIPTION = re.compile(
    r'<div[^>]*(?:product attribute description|product-description|value)[^>]*>([\s\S]*?)</div>',
    re.I)
# Labelled prose fragments only — a bare "16mm" in a sentence is not a spec.
_FRANKLIN_PROSE = re.compile(
    r"(core thickness|thickness|paddle length|length|paddle width|width|"
    r"handle length|grip length|grip circumference|weight|core|face|surface|"
    r"swing weight|twist weight|shape)\s*[:\-–]\s*([^.;<\n]{1,60})", re.I)


def _parse_franklin(product: dict[str, Any], page_html: str) -> list[dict[str, Any]]:
    who = identity(product, page_html, "franklin")
    if not who:
        return []
    handle, name, url = who

    pairs: list[tuple[str, str]] = []
    confidence = "labelled"
    table = _FRANKLIN_ATTR_TABLE.search(page_html or "")
    if table:
        pairs = table_pairs(table.group(0))

    if not pairs:
        confidence = "prose"
        description = _FRANKLIN_DESCRIPTION.search(page_html or "")
        prose = text_of(description.group(1)) if description else body_text(product)
        pairs = [(label.strip(), value.strip())
                 for label, value in _FRANKLIN_PROSE.findall(prose)]

    if not pairs:
        return []

    row = new_row(handle, url, name)
    shape_label = apply_pairs(row, pairs, shape_from_dimensions=True)
    downgrade(row, confidence)

    # Refuse to emit a row that carries no measurement at all — for an unverified
    # parser, an empty row is indistinguishable from a mis-parse.
    if all(row[column] is None for column in
           ("thickness_mm", "length_in", "width_in", "weight_oz_min", "shape")):
        return []

    finalized = finalize(row, "franklin", shape_label)
    return [finalized] if finalized else []


def parse_franklin(product_json: dict[str, Any] | None, html: str | None) -> list[dict[str, Any]]:
    return guard(_parse_franklin, product_json, html)


# !! UNVERIFIED, same caveat as parse_franklin above !!
# `scrape_specs.py` calls this to enumerate Franklin's paddles, because Franklin
# publishes no sitemap and no /products.json — the only entry point is the
# collection page at /sports/pickleball/paddles (26 products at recon time).
_FRANKLIN_HREF = re.compile(r'<a\b[^>]*\bhref=["\']([^"\'#?]+)["\']', re.I)
# Adobe Commerce serves product pages either as /products/<key> or as
# <key>.html; both shapes are accepted, category and account paths are not.
_FRANKLIN_PRODUCT_PATH = re.compile(r"/products/[^/]+$|/[^/]+\.html$", re.I)
_FRANKLIN_NOT_PRODUCT = ("/customer/", "/checkout/", "/cart", "/wishlist",
                         "/catalogsearch/", "/sports/", "/collections/")


def franklin_product_urls(listing_html: str | None, domain: str) -> list[str]:
    """Absolute product URLs found on a Franklin collection page.

    Query strings are stripped at the regex level rather than filtered later,
    because Franklin's ``robots.txt`` carries ``Disallow: /*?`` — a URL with a
    query string must never be requested, not merely deprioritised.

    Never raises and never returns duplicates; an unrecognised page yields [].
    """
    if not listing_html or not domain:
        return []
    seen: set[str] = set()
    urls: list[str] = []
    for href in _FRANKLIN_HREF.findall(listing_html):
        path = html_lib.unescape(href).strip()
        if path.startswith("http"):
            if domain not in path:
                continue
            path = "/" + path.split(domain, 1)[1].lstrip("/")
        elif not path.startswith("/"):
            continue
        lowered = path.lower()
        if any(bad in lowered for bad in _FRANKLIN_NOT_PRODUCT):
            continue
        if not _FRANKLIN_PRODUCT_PATH.search(path):
            continue
        absolute = f"https://{domain}{path}"
        if absolute not in seen:
            seen.add(absolute)
            urls.append(absolute)
    return urls
