"""Task F: Influencer sponsorship detection.

Detects is_sponsored=True on influencer_posts by:
1. Rule-based: #ad, #sponsored, #partner, "paid partnership", "#gifted"
2. AI-fallback: GPT-4o-mini classification for ambiguous posts

Also enriches the sentiment field added by migration 011.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.openai_client import call_openai
from ..core.settings import ENRICH_BATCH

log = get_logger("enrichment.influencer_sponsored")

SPONSORED_PATTERNS = re.compile(
    r"#ad\b|#sponsored\b|#partner\b|#gifted\b|paid\s+partnership|brand\s+partner",
    re.IGNORECASE,
)

SPONSORSHIP_PROMPT = (
    "Is this social media post a paid promotion, sponsored content, or brand partnership? "
    "Reply ONLY with a JSON object: {\"is_sponsored\": true/false, "
    "\"sentiment_label\": \"positive\"|\"neutral\"|\"negative\"|\"very_positive\"|\"very_negative\", "
    "\"sentiment_score\": -1.0..1.0}"
)


def _detect_sponsored(caption: str) -> tuple[bool, str]:
    """Rule-based check first. Returns (is_sponsored, method)."""
    if SPONSORED_PATTERNS.search(caption or ""):
        return True, "rule"
    return False, "unknown"


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)

    # Fetch unenriched influencer posts (those without sentiment set yet)
    posts = sb.get_filtered(
        "influencer_posts",
        "id,caption",
        f"enriched_at=is.null&limit={ENRICH_BATCH}",
    )
    log.info("Found %d unenriched influencer_posts", len(posts))

    if dry_run:
        log.info("[DRY-RUN] would process %d influencer_posts", len(posts))
        return 0

    processed = 0
    for post in posts:
        caption = post.get("caption") or ""
        is_sponsored, method = _detect_sponsored(caption)

        if method == "unknown" and len(caption.strip()) >= 10:
            result = call_openai(caption, system_prompt=SPONSORSHIP_PROMPT)
            if result:
                is_sponsored = result.get("is_sponsored", False)
                update: dict = {
                    "is_sponsored": is_sponsored,
                    "sentiment":    result.get("sentiment_label"),
                    "enriched_at":  datetime.utcnow().isoformat(),
                }
                sb.patch("influencer_posts", post["id"], update)
                processed += 1
                continue

        sb.patch("influencer_posts", post["id"], {
            "is_sponsored": is_sponsored,
            "enriched_at":  datetime.utcnow().isoformat(),
        })
        processed += 1

    log.info("✓ %d influencer_posts enriched for sponsorship", processed)
    return processed
