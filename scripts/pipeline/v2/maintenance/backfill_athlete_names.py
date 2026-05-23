"""Task J: Athlete name normalization on ig_posts.

The live ig_posts schema does NOT have an athletes_shown column. The closest
analogue is `tagged_accounts` (text[] of Instagram handles). Athletes are
normally referenced inside captions (via @handle or natural-language names)
and surface in the enriched yt_comments / ig_comments / x_posts tables as
`players_mentioned`, not on ig_posts directly.

This task is therefore a no-op against the current schema. We keep the
canonical name map for future use (e.g. an enrichment pass that derives
athletes from captions and writes back to ig_posts).
"""

from __future__ import annotations

from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger

log = get_logger("maintenance.athlete_names")

# Kept for future use — used by other modules that need name normalization
CANONICAL: dict[str, str] = {
    "ben johns": "Ben Johns", "bj": "Ben Johns",
    "tyson mcguffin": "Tyson McGuffin", "mcguffin": "Tyson McGuffin",
    "anna leigh waters": "Anna Leigh Waters", "anna leigh": "Anna Leigh Waters",
    "alw": "Anna Leigh Waters",
    "anna bright": "Anna Bright", "bright": "Anna Bright",
    "patrick smith": "Patrick Smith",
    "catherine parenteau": "Catherine Parenteau", "parenteau": "Catherine Parenteau",
    "riley newman": "Riley Newman",
    "simone jardim": "Simone Jardim",
    "zane navratil": "Zane Navratil", "navratil": "Zane Navratil",
    "james ignatowich": "James Ignatowich", "ignatowich": "James Ignatowich",
    "jorja johnson": "Jorja Johnson",
    "jay devilliers": "Jay Devilliers",
    "jessie irvine": "Jessie Irvine",
    "kyle yates": "Kyle Yates",
    "tanner tomassi": "Tanner Tomassi",
    "bobbi oshiro": "Bobbi Oshiro",
    "sarah ansboury": "Sarah Ansboury",
    "leigh waters": "Leigh Waters",
    "connor garnett": "Connor Garnett",
    "aspen kern": "Aspen Kern",
    "roscoe bellamy": "Roscoe Bellamy",
    "alex neumann": "Alex Neumann",
    "andrei daescu": "Andrei Daescu",
    "allyce jones": "Allyce Jones",
    "blaine hovenier": "Blaine Hovenier",
    "gabe joseph": "Gabe Joseph",
    "eric oncins": "Eric Oncins",
}


def normalise_names(raw: list[str] | None) -> list[str]:
    """Public helper — collapse spelling variants to canonical names."""
    if not raw:
        return []
    result: list[str] = []
    for name in raw:
        clean = (name or "").strip().lower()
        result.append(CANONICAL.get(clean, (name or "").strip()))
    return list(dict.fromkeys(result))  # dedupe preserving order


def run(ctx: dict[str, Any]) -> int:
    """No-op: ig_posts.athletes_shown does not exist in the live schema.

    Verified at runtime — if the column exists, we run the legacy normalization;
    otherwise we log and return 0 so the pipeline doesn't fail.
    """
    dry_run: bool = ctx.get("dry_run", False)

    # Probe ig_posts for the athletes_shown column. If absent, no-op.
    try:
        sb.get_filtered("ig_posts", "athletes_shown", "limit=1")
        has_column = True
    except Exception as e:
        if "athletes_shown" in str(e) or "42703" in str(e):
            has_column = False
        else:
            log.warning("Could not probe ig_posts.athletes_shown: %s", str(e)[:200])
            return 0

    if not has_column:
        log.info("ig_posts.athletes_shown column missing in live schema — task is a no-op")
        return 0

    posts = sb.get_filtered(
        "ig_posts", "id,athletes_shown",
        "athletes_shown=not.is.null&limit=5000",
    )

    updated = 0
    for post in posts:
        raw_athletes = post.get("athletes_shown") or []
        if not raw_athletes:
            continue
        normalised = normalise_names(raw_athletes)
        if normalised == raw_athletes:
            continue
        if dry_run:
            continue
        if sb.patch("ig_posts", post["id"], {"athletes_shown": normalised}):
            updated += 1

    log.info("✓ %d ig_posts athlete names normalised", updated)
    return updated
