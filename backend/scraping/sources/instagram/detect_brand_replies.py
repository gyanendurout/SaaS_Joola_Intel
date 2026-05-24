"""Task B: Detect JOOLA brand replies to Instagram comments.

Scans ig_comments for comments authored by JOOLA brand accounts,
links them back to the parent complaint, records response time, and
writes results to the brand_replies table.

Uses the real ig_comments columns: id, post_id, comment_text,
commenter_username, posted_at.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ...core import supabase_client as sb
from ...core.logger import get_logger
from ...core.settings import JOOLA_BRAND_ID

log = get_logger("ig.brand_replies")

JOOLA_IG_HANDLES = {"joolapickleball", "joola_pickleball", "joolausa"}


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _response_time_mins(original_ts: str | None, reply_ts: str | None) -> int | None:
    orig = _parse_dt(original_ts)
    reply = _parse_dt(reply_ts)
    if orig and reply:
        delta = reply - orig
        return max(0, int(delta.total_seconds() / 60))
    return None


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    comments = sb.get_filtered(
        "ig_comments",
        "id,post_id,comment_text,commenter_username,posted_at",
        "limit=5000&order=posted_at.desc",
    )

    joola_replies = [
        c for c in comments
        if (c.get("commenter_username") or "").lower() in JOOLA_IG_HANDLES
    ]
    log.info("Found %d potential JOOLA replies in ig_comments", len(joola_replies))

    if dry_run:
        log.info("[DRY-RUN] would write %d brand_replies records", len(joola_replies))
        return 0

    # post_id → earliest non-JOOLA comment timestamp (treated as "complaint")
    post_ts: dict[str, str] = {}
    for c in comments:
        if (c.get("commenter_username") or "").lower() not in JOOLA_IG_HANDLES:
            pid = c.get("post_id") or ""
            if pid and pid not in post_ts:
                post_ts[pid] = c.get("posted_at") or ""

    rows: list[dict] = []
    for reply in joola_replies:
        post_id = reply.get("post_id") or ""
        original_ts = post_ts.get(post_id)
        rows.append({
            "replying_brand_id":  JOOLA_BRAND_ID,
            "source_table":       "ig_comments",
            "source_row_id":      reply["id"],
            "original_text":      "",  # join could enrich this later
            "reply_text":         (reply.get("comment_text") or "")[:1000],
            "replied_at":         reply.get("posted_at"),
            "response_time_mins": _response_time_mins(original_ts, reply.get("posted_at")),
            "joola_responded":    True,
        })

    n = sb.upsert("brand_replies", rows, "source_table,source_row_id")
    log.info("✓ %d brand reply records upserted", n)
    return n
