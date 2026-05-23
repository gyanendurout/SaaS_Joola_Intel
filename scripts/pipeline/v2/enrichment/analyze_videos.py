"""GPT-4o-mini analysis of YouTube videos.

Reads yt_videos (joined with yt_video_transcripts), writes yt_video_analysis.
Explains WHY a video performed and extracts product/brand/athlete mentions.

Falls back gracefully when transcript is unavailable:
  - Uses title + description as LLM input
  - Sets transcript_id = NULL
  - Pipeline never fails on a missing transcript
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from ..core import supabase_client as sb
from ..core.logger import get_logger
from ..core.openai_client import call_openai
from ..core.settings import ENRICH_WORKERS, OPENAI_MODEL
from ..sources.products.product_alias_matcher import match as match_products

log = get_logger("enrichment.yt_analysis")

VIDEO_BATCH = 100
MAX_TRANSCRIPT_CHARS = 12000

VIDEO_ANALYSIS_PROMPT = (
    "You analyze a YouTube video about pickleball paddles and players. "
    "Return STRICT JSON with these keys (no prose):\n"
    "- summary: 1-2 sentence what the video is about\n"
    "- performance_thesis: short explanation of why this video likely performed well "
    "(hook strength, celebrity, tutorial value, controversy, timing, etc.)\n"
    "- performance_signals: array of short tags from "
    "['hook-strong','celebrity-cameo','tutorial','controversy','review','comparison',"
    "'unboxing','launch','trend','question-driven']\n"
    "- content_type: one of 'review'|'tutorial'|'highlight'|'unboxing'|'announcement'"
    "|'comparison'|'news'|'other'\n"
    "- is_paid_promo: boolean — true if disclosure language suggests sponsored content\n"
    "- sentiment_label: one of 'very_negative'|'negative'|'neutral'|'positive'|'very_positive'\n"
    "- sentiment_score: -1.0 to 1.0\n"
    "- products_mentioned: array of product names actually mentioned (e.g. 'JOOLA Perseus', 'Selkirk Vanguard')\n"
    "- brands_mentioned: array of brand slugs from "
    "['joola','selkirk','paddletek','crbn','six-zero','engage','onix','franklin','head','wilson','gamma']\n"
    "- players_mentioned: array of pickleball athlete full names\n"
    "- topics: array of 1-4 short topic tags (lowercase, hyphen-separated)\n"
    "- is_crisis: boolean — true if defect/recall/warranty/scandal\n"
    "- is_opportunity: boolean — true if buying-intent or switch-from-competitor content\n"
    "- crisis_keywords: array of crisis keywords found (empty if none)\n"
    "Return ONLY the JSON object."
)


def _build_input(video: dict, transcript_text: str | None) -> str:
    title = (video.get("title") or "").strip()
    desc  = (video.get("description") or "").strip()
    parts: list[str] = []
    if title:
        parts.append(f"TITLE: {title}")
    if desc:
        parts.append(f"DESCRIPTION: {desc[:1500]}")
    if transcript_text:
        parts.append(f"TRANSCRIPT (excerpt): {transcript_text[:MAX_TRANSCRIPT_CHARS]}")
    return "\n\n".join(parts)


def _resolve_products(
    products_mentioned: list[str] | None,
    transcript_text: str | None,
    title_desc: str,
    brand_id: str | None,
) -> tuple[list[str], list[str]]:
    """Run alias matcher across product names + raw text. Return (display_names, product_ids)."""
    display_names: list[str] = []
    seen_ids: set[str] = set()

    # 1. Match LLM-extracted names directly
    for name in (products_mentioned or []):
        for hit in match_products(name, hint_brand_id=brand_id):
            if hit["product_id"] not in seen_ids:
                seen_ids.add(hit["product_id"])
                display_names.append(hit["alias"])

    # 2. Also scan raw text — catches mentions LLM missed
    haystack = (transcript_text or "") + " " + title_desc
    for hit in match_products(haystack, hint_brand_id=brand_id):
        if hit["product_id"] not in seen_ids:
            seen_ids.add(hit["product_id"])
            display_names.append(hit["alias"])

    return display_names, list(seen_ids)


def _process_video(video: dict) -> str:
    """Run analysis for one video. Returns 'ok' | 'skipped' | 'failed'."""
    video_id = video["id"]
    transcript_text = video.get("transcript_text")
    transcript_id   = video.get("transcript_id")

    text = _build_input(video, transcript_text)
    if not text.strip():
        return "skipped"

    result = call_openai(text, system_prompt=VIDEO_ANALYSIS_PROMPT)
    if not result:
        return "failed"

    display_names, product_ids = _resolve_products(
        result.get("products_mentioned"),
        transcript_text,
        f"{video.get('title','')} {video.get('description','')}",
        video.get("brand_id"),
    )

    row = {
        "video_id":                  video_id,
        "youtube_video_id":          video.get("youtube_video_id"),
        "brand_id":                  video.get("brand_id"),
        "transcript_id":             transcript_id,
        "summary":                   (result.get("summary") or "")[:1000],
        "performance_thesis":        (result.get("performance_thesis") or "")[:500],
        "performance_signals":       result.get("performance_signals") or [],
        "content_type":              result.get("content_type") or "other",
        "is_paid_promo":             bool(result.get("is_paid_promo", False)),
        "sentiment_label":           result.get("sentiment_label"),
        "sentiment_score":           result.get("sentiment_score"),
        "products_mentioned":        display_names,
        "products_matched_ids":      product_ids,
        "brands_mentioned":          result.get("brands_mentioned") or [],
        "players_mentioned":         result.get("players_mentioned") or [],
        "topics":                    result.get("topics") or [],
        "is_crisis":                 bool(result.get("is_crisis", False)),
        "is_opportunity":            bool(result.get("is_opportunity", False)),
        "crisis_keywords":           result.get("crisis_keywords") or [],
        "view_count_at_analysis":    video.get("view_count"),
        "like_count_at_analysis":    video.get("like_count"),
        "comment_count_at_analysis": video.get("comment_count"),
        "model":                     OPENAI_MODEL,
    }

    n = sb.upsert("yt_video_analysis", [row], "video_id")
    return "ok" if n else "failed"


def _fetch_targets(limit_override: int | None) -> list[dict]:
    """Fetch yt_videos rows not yet analyzed, prefer those with transcripts."""
    cap = limit_override or VIDEO_BATCH

    # Pull recent transcripts (status='ok') so analysis prefers them
    transcripts = {}
    try:
        rows = sb.get_filtered(
            "yt_video_transcripts",
            "id,video_id,transcript_text,fetch_status",
            "fetch_status=eq.ok&limit=2000",
        )
        transcripts = {r["video_id"]: r for r in rows}
    except Exception as e:
        log.warning("Could not load transcripts: %s", e)

    # Get videos not yet in yt_video_analysis
    try:
        analyzed = sb.get("yt_video_analysis", "video_id")
        analyzed_ids = {r["video_id"] for r in analyzed}
    except Exception:
        analyzed_ids = set()

    videos = sb.get_filtered(
        "yt_videos",
        "id,brand_id,youtube_video_id,title,description,view_count,like_count,comment_count,is_short",
        f"is_short=eq.false&order=view_count.desc&limit={cap * 4}",
    )

    out: list[dict] = []
    for v in videos:
        if v["id"] in analyzed_ids:
            continue
        t = transcripts.get(v["id"])
        if t:
            v["transcript_id"]   = t["id"]
            v["transcript_text"] = t.get("transcript_text")
        out.append(v)
        if len(out) >= cap:
            break
    return out


def run(ctx: dict[str, Any]) -> int:
    dry_run: bool = ctx.get("dry_run", False)
    limit_override: int | None = ctx.get("limit")

    videos = _fetch_targets(limit_override)
    if not videos:
        log.info("No videos pending analysis")
        return 0

    log.info("Analyzing %d videos (workers=%d, transcripts available=%d)",
             len(videos), ENRICH_WORKERS,
             sum(1 for v in videos if v.get("transcript_text")))

    if dry_run:
        log.info("[DRY-RUN] would analyze %d videos", len(videos))
        return 0

    ok = failed = 0
    with ThreadPoolExecutor(max_workers=ENRICH_WORKERS) as pool:
        futures = [pool.submit(_process_video, v) for v in videos]
        for fut in as_completed(futures):
            try:
                status = fut.result()
            except Exception as e:
                log.warning("analyze worker raised: %s", e)
                status = "failed"
            if status == "ok":
                ok += 1
            elif status == "failed":
                failed += 1

    log.info("✓ %d videos analyzed (%d failed)", ok, failed)
    return ok
