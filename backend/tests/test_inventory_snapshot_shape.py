"""product_snapshots rows must leave the builders in ONE fixed shape.

`scrape_inventory_crawl4ai` built three different row literals — Shopify (11
keys), non-Shopify success (9), non-Shopify failure (7) — and then normalised them
at the call site with a dynamic union:

    all_keys = set().union(*(row.keys() for row in all_snaps))
    all_snaps = [{k: row.get(k) for k in all_keys} for row in all_snaps]

That predates `_uniform_batches()` in the shared client and solves the same
PGRST102 problem the wrong way. Union-filling with None writes an explicit SQL
NULL, and on INSERT an explicit NULL overrides the column DEFAULT. On
product_snapshots the columns carrying defaults are `currency` ('USD'),
`inventory_confidence` ('low'), `snapshot_time` (now()), `created_at` (now()) and
`id` (gen_random_uuid()) — so the union was one new partially-populated column
away from silently blanking them.

The shape is now an explicit tuple. These tests pin two things: every builder emits
the same keys, and the shape does NOT contain the default-bearing columns the
builders never set.
"""
import pytest

mod = pytest.importorskip(
    "backend.scraping.sales_intelligence.scrape_inventory_crawl4ai",
    reason="crawl4ai not installed",
)


# Columns that have a DEFAULT in product_snapshots and are NEVER set by these
# builders. If one of these ever appears in the fixed shape it would be written as
# an explicit NULL and the default would be lost.
DEFAULT_BEARING_UNSET = ("currency", "created_at", "id")


def test_fixed_shape_excludes_default_bearing_columns():
    for col in DEFAULT_BEARING_UNSET:
        assert col not in mod.SNAPSHOT_COLUMNS, (
            f"{col} has a DB DEFAULT and is never set by the builders; including "
            f"it in the fixed shape would write NULL and lose the default"
        )


def test_fixed_shape_keeps_the_columns_the_builders_do_set():
    for col in ("brand_id", "product_id", "variant_id", "snapshot_time",
                "product_url", "price", "compare_at_price",
                "availability_status", "inventory_signal_type",
                "inventory_confidence", "visible_inventory_qty"):
        assert col in mod.SNAPSHOT_COLUMNS


def test_snapshot_row_projects_onto_exactly_the_fixed_shape():
    row = mod._snapshot_row({"brand_id": "b1", "product_url": "u"})
    assert tuple(row.keys()) == mod.SNAPSHOT_COLUMNS
    assert row["brand_id"] == "b1"
    assert row["price"] is None          # absent -> present and None


def test_snapshot_row_ignores_keys_outside_the_shape():
    """A stray key must not reintroduce a second shape."""
    row = mod._snapshot_row({"brand_id": "b1", "currency": "AUD", "bogus": 1})
    assert "currency" not in row
    assert "bogus" not in row


def test_shopify_and_non_shopify_rows_have_identical_key_sets():
    """The actual regression: three builders, one shape."""
    shopify = mod._snapshot_row({
        "brand_id": "b1", "product_id": "p1", "snapshot_time": "t",
        "product_url": "u", "price": 1.0, "compare_at_price": 2.0,
        "availability_status": "in_stock", "inventory_signal_type": "shopify_json",
        "inventory_confidence": "medium", "visible_inventory_qty": None,
    })
    non_shopify_ok = mod._snapshot_row({
        "brand_id": "b1", "product_id": None, "snapshot_time": "t",
        "product_url": "u", "price": 1.0, "availability_status": "in_stock",
        "visible_inventory_qty": 3, "inventory_signal_type": "crawl4ai",
        "inventory_confidence": "high",
    })
    non_shopify_failed = mod._snapshot_row({
        "brand_id": "b1", "product_id": None, "snapshot_time": "t",
        "product_url": "u", "availability_status": "unknown",
        "inventory_signal_type": "crawl4ai_failed", "inventory_confidence": "low",
    })

    shapes = {tuple(sorted(r)) for r in (shopify, non_shopify_ok, non_shopify_failed)}
    assert len(shapes) == 1, f"builders still disagree: {shapes}"


def test_resolve_variant_fks_preserves_the_shape():
    """Dropping _ext_variant_id and adding variant_id must not change the shape."""
    row = mod._snapshot_row({"brand_id": "b1", "product_url": "u"})
    row["_ext_variant_id"] = "ext1"

    out = mod._resolve_variant_fks([row], {"ext1": "uuid-1"})

    assert len(out) == 1
    assert tuple(sorted(out[0])) == tuple(sorted(mod.SNAPSHOT_COLUMNS))
    assert out[0]["variant_id"] == "uuid-1"
    assert "_ext_variant_id" not in out[0]


def test_resolve_variant_fks_leaves_variant_id_none_when_unresolved():
    row = mod._snapshot_row({"brand_id": "b1", "product_url": "u"})
    row["_ext_variant_id"] = "missing"

    out = mod._resolve_variant_fks([row], {})

    assert out[0]["variant_id"] is None
    assert tuple(sorted(out[0])) == tuple(sorted(mod.SNAPSHOT_COLUMNS))
