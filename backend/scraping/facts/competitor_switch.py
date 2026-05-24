"""Populate competitor_switch_events from enriched reddit_mentions."""

from __future__ import annotations

from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("facts.competitor_switch")


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    # Reddit mentions with competitor switch data
    mentions = sb.get_filtered(
        "reddit_mentions",
        "id,brand_id,competitor_switch_from,competitor_switch_to,posted_at,post_url",
        "competitor_switch_from=not.is.null&limit=1000",
    )

    brand_map = {r["slug"]: r["id"] for r in sb.get("brands", "id,slug")}

    rows: list[dict] = []
    for m in mentions:
        from_slug = m.get("competitor_switch_from")
        to_slug   = m.get("competitor_switch_to")
        from_id   = brand_map.get(from_slug) if from_slug else None
        to_id     = brand_map.get(to_slug) if to_slug else None

        if not from_id and not to_id:
            continue

        rows.append({
            "source_mention_id": m["id"],
            "from_brand_id":     from_id,
            "to_brand_id":       to_id,
            "channel":           "reddit",
            "detected_at":       m.get("posted_at"),
            "post_url":          m.get("post_url"),
        })

    if dry_run:
        log.info("[DRY-RUN] would upsert %d competitor_switch_events", len(rows))
        return len(rows)

    n = sb.upsert("competitor_switch_events", rows, "source_mention_id") if rows else 0
    log.info("✓ %d competitor_switch_events upserted", n)
    return n
