"""Product alias matcher — text → list of matched (product_id, brand_id, alias, confidence).

Loads product_aliases once (lru_cache) into an in-memory dict keyed by alias_norm.
Disambiguates using the caller's optional brand_id hint:
  - Non-ambiguous alias: matches anywhere
  - Ambiguous alias (same alias_norm across multiple brands): only matches when
    hint_brand_id is supplied and matches a candidate; otherwise returns no hit.

This module is a library — no run(ctx) entry point. Imported by:
  - enrichment/analyze_videos.py
  - facts/populate_product_mentions.py
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

from ...core import supabase_client as sb
from ...core.logger import get_logger

log = get_logger("products.alias_matcher")

_PUNCT_RE = re.compile(r"[^a-z0-9 ]+")
_WS_RE    = re.compile(r"\s+")


def normalize(s: str | None) -> str:
    """Lowercase, ASCII-fold, strip punctuation, collapse whitespace.

    Matches the alias_norm form produced by Migration 012's seed query.
    """
    if not s:
        return ""
    folded = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", folded.lower())).strip()


@lru_cache(maxsize=1)
def _load_aliases() -> dict[str, list[dict]]:
    """Load all aliases into {alias_norm: [{product_id, brand_id, alias, confidence, is_ambiguous}]}."""
    try:
        rows = sb.get("product_aliases",
                      "product_id,brand_id,alias,alias_norm,confidence,is_ambiguous")
    except Exception as e:
        log.warning("Failed to load product_aliases (table missing?): %s", e)
        return {}

    idx: dict[str, list[dict]] = {}
    for r in rows:
        idx.setdefault(r["alias_norm"], []).append(r)
    log.info("Loaded %d aliases across %d normalized keys", len(rows), len(idx))
    return idx


def reload_aliases() -> None:
    """Force a fresh load (e.g. after the matcher first ran in a long-running process)."""
    _load_aliases.cache_clear()


def match(text: str | None, *, hint_brand_id: str | None = None) -> list[dict]:
    """Return list of {product_id, brand_id, alias, alias_norm, confidence} for all hits.

    Iterates aliases (typically a few hundred) and checks substring match against
    the normalized text. Ambiguous aliases require a brand hint.
    """
    if not text:
        return []

    norm_text = " " + normalize(text) + " "
    if not norm_text.strip():
        return []

    aliases = _load_aliases()
    if not aliases:
        return []

    out: list[dict] = []
    seen: set[str] = set()  # product_id, dedupe per text

    for alias_norm, candidates in aliases.items():
        # Word-boundary check (" alias " inside " norm_text ")
        if f" {alias_norm} " not in norm_text:
            continue

        # Filter ambiguous matches without a brand hint
        usable = [c for c in candidates if not c["is_ambiguous"] or hint_brand_id]
        if not usable:
            continue

        if hint_brand_id:
            # Prefer brand-matching candidate; else fall back to first non-ambiguous
            brand_match = [c for c in usable if c["brand_id"] == hint_brand_id]
            chosen = brand_match[0] if brand_match else (
                [c for c in usable if not c["is_ambiguous"]] or [None]
            )[0]
        else:
            chosen = usable[0]  # non-ambiguous only here

        if chosen is None or chosen["product_id"] in seen:
            continue
        seen.add(chosen["product_id"])

        # Down-weight if we had to ignore brand hint or if alias was ambiguous
        confidence = float(chosen.get("confidence") or 1.0)
        if chosen["is_ambiguous"] and (not hint_brand_id or chosen["brand_id"] != hint_brand_id):
            confidence *= 0.6

        out.append({
            "product_id":   chosen["product_id"],
            "brand_id":     chosen["brand_id"],
            "alias":        chosen["alias"],
            "alias_norm":   alias_norm,
            "confidence":   round(confidence, 2),
        })

    return out
