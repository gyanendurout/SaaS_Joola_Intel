"""
Data recovery + cleanup script.
Fixes ig_profiles_weekly, influencer_posts, influencer_snapshots
by fetching already-completed Apify run results and using delete+insert.

Run after scrape_may15.py completes.
"""

import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import os, requests, re
from datetime import date, datetime
try:
    from dotenv import load_dotenv
    load_dotenv(); load_dotenv("scripts/.env")
except ImportError:
    pass

APIFY_TOKEN  = os.environ["APIFY_TOKEN"]
APIFY_BASE   = "https://api.apify.com/v2"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SB_GET = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "User-Agent": "python-requests/2.31.0",
}
SB_WRITE = {**SB_GET, "Content-Type": "application/json", "Prefer": "return=minimal"}

# ── Known run IDs from the May 15 scrape ──────────────────────────────────────
IG_BRANDS_RUN_ID    = "bLckvwxm1JhSYfnjf"   # step 1 — brand profiles
IG_INFLUENCER_RUN_ID = "SxCkLTzWCaht3fq6W"  # step 2 — influencer profiles
YT_RUN_ID           = "B1EnVivVYopVhjUwm"   # step 3 — YouTube channels
REDDIT_RUN_IDS      = ["AIohhW4DUhuPo0MxN", "vUPBUQAfpsctmyZiB"]  # step 4 — Reddit


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def sb_get(table, select="*", extra=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}{extra}"
    r = requests.get(url, headers=SB_GET, timeout=15)
    r.raise_for_status()
    return r.json()


def sb_delete(table, filters: dict):
    """DELETE WHERE each key=val"""
    params = "&".join(f"{k}=eq.{v}" for k, v in filters.items())
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    r = requests.delete(url, headers=SB_WRITE, timeout=15)
    if r.status_code not in (200, 204):
        log(f"  ✗ DELETE {table} error {r.status_code}: {r.text[:200]}")
    return r.status_code


def sb_insert(table, rows):
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {**SB_WRITE}
    del headers["Prefer"]  # no Prefer for plain insert
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code in (200, 201):
            inserted += len(batch)
        else:
            log(f"  ✗ INSERT {table} error {r.status_code}: {r.text[:300]}")
    return inserted


def fetch_apify_results(run_id: str) -> list[dict]:
    url = f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items?token={APIFY_TOKEN}&clean=true"
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def extract_hashtags(text):
    return re.findall(r"#(\w+)", text or "")


TYPE_MAP = {
    "Image": "Image", "Video": "Video", "Sidecar": "Carousel",
    "GraphImage": "Image", "GraphVideo": "Video",
    "GraphSidecar": "Carousel", "XDTMediaTypeVideo": "Reel",
}


def week_info():
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()
    return iso_year, iso_week


# ── Step A: Clean up ig_profiles_weekly duplicates ────────────────────────────

def fix_ig_profiles_weekly():
    log("\n[A] Fixing ig_profiles_weekly — cleaning duplicates + re-inserting")

    iso_year, iso_week = week_info()

    # Load ig_accounts map
    accounts = sb_get("ig_accounts", "id,handle,brand_id")
    ig_map = {r["handle"]: {"account_id": r["id"], "brand_id": r["brand_id"]} for r in accounts}

    # Delete ALL existing week 20/2026 rows (duplicates and stale)
    all_rows = sb_get("ig_profiles_weekly", "id,account_id,week_number,year")
    week_rows = [r for r in all_rows if r["week_number"] == iso_week and r["year"] == iso_year]
    log(f"  Deleting {len(week_rows)} existing week {iso_week}/{iso_year} rows...")
    deleted = 0
    for r in week_rows:
        code = sb_delete("ig_profiles_weekly", {"id": r["id"]})
        if code in (200, 204):
            deleted += 1
    log(f"  ✓ Deleted {deleted} stale rows")

    # Fetch fresh results from the Apify run
    log(f"  Fetching results from Apify run {IG_BRANDS_RUN_ID}...")
    items = fetch_apify_results(IG_BRANDS_RUN_ID)
    log(f"  Got {len(items)} items from Apify")

    profiles = []
    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = ig_map.get(handle)
        if not info:
            log(f"  ⚠ No ig_accounts record for: {handle!r}")
            continue
        followers = item.get("followersCount", 0)
        log(f"  ✓ {handle}: {followers:,} followers")
        profiles.append({
            "account_id": info["account_id"],
            "brand_id":   info["brand_id"],
            "handle":     handle,
            "followers":  followers,
            "following":  item.get("followsCount"),
            "post_count": item.get("postsCount"),
            "bio_text":   item.get("biography"),
            "bio_link":   item.get("externalUrl"),
            "is_verified": item.get("verified", False),
            "week_number": iso_week,
            "year":        iso_year,
        })

    n = sb_insert("ig_profiles_weekly", profiles)
    log(f"  ✓ {n} brand profile snapshots inserted (clean, no duplicates)")
    return n


# ── Step B: Fix ig_posts from the brand scrape ────────────────────────────────

def fix_ig_posts():
    log("\n[B] Re-storing IG posts from brand scrape run")

    accounts = sb_get("ig_accounts", "id,handle,brand_id")
    ig_map = {r["handle"]: {"account_id": r["id"], "brand_id": r["brand_id"]} for r in accounts}

    items = fetch_apify_results(IG_BRANDS_RUN_ID)
    posts = []
    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = ig_map.get(handle)
        if not info:
            continue
        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "account_id":        info["account_id"],
                "brand_id":          info["brand_id"],
                "handle":            handle,
                "instagram_post_id": shortcode,
                "post_url":          f"https://www.instagram.com/p/{shortcode}/",
                "post_format":       TYPE_MAP.get(post.get("type", ""), "Image"),
                "caption":           caption,
                "hashtags":          extract_hashtags(caption),
                "like_count":        post.get("likesCount", 0),
                "comment_count":     post.get("commentsCount", 0),
                "view_count":        post.get("videoViewCount", 0),
                "image_url":         post.get("displayUrl"),
                "posted_at":         post.get("timestamp"),
            })

    # ig_posts uses instagram_post_id as unique key — just upsert normally
    url = f"{SUPABASE_URL}/rest/v1/ig_posts?on_conflict=instagram_post_id"
    headers = {**SB_WRITE, "Prefer": "resolution=merge-duplicates"}
    inserted = 0
    for i in range(0, len(posts), 500):
        batch = posts[i:i+500]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code in (200, 201):
            inserted += len(batch)
        else:
            # Fallback: plain insert
            r2 = requests.post(f"{SUPABASE_URL}/rest/v1/ig_posts", headers=SB_WRITE, json=batch, timeout=30)
            if r2.status_code in (200, 201):
                inserted += len(batch)
            else:
                log(f"  ✗ ig_posts insert error: {r2.text[:200]}")

    log(f"  ✓ {inserted} ig posts stored")
    return inserted


# ── Step C: Fix influencer snapshots ─────────────────────────────────────────

def fix_influencer_data():
    log("\n[C] Fixing influencer snapshots & posts from run {IG_INFLUENCER_RUN_ID}")

    iso_year, iso_week = week_info()

    # Load influencer map (now with corrected handles)
    inf_rows = sb_get("influencers", "id,brand_id,instagram_handle,name")
    inf_map = {r["instagram_handle"]: {"influencer_id": r["id"], "brand_id": r["brand_id"], "name": r["name"]}
               for r in inf_rows if r.get("instagram_handle")}

    log(f"  {len(inf_map)} influencers loaded")

    # Delete existing week snapshots for this week
    all_snaps = sb_get("influencer_snapshots", "id,influencer_id,week_number,year")
    week_snaps = [s for s in all_snaps if s["week_number"] == iso_week and s["year"] == iso_year]
    log(f"  Deleting {len(week_snaps)} existing influencer snapshots for week {iso_week}/{iso_year}...")
    deleted = 0
    for s in week_snaps:
        code = sb_delete("influencer_snapshots", {"id": s["id"]})
        if code in (200, 204):
            deleted += 1
    log(f"  ✓ Deleted {deleted} stale snapshots")

    # Fetch Apify results
    log(f"  Fetching influencer results from Apify run {IG_INFLUENCER_RUN_ID}...")
    items = fetch_apify_results(IG_INFLUENCER_RUN_ID)
    log(f"  Got {len(items)} items")

    snapshots = []
    posts = []
    matched = []

    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = inf_map.get(handle)
        if not info:
            log(f"  ⚠ No influencer for handle: {handle!r}")
            continue

        followers = item.get("followersCount", 0)
        matched.append(f"{info['name']} → {followers:,}")

        snapshots.append({
            "influencer_id":     info["influencer_id"],
            "brand_id":          info["brand_id"],
            "follower_count_ig": followers,
            "week_number":       iso_week,
            "year":              iso_year,
        })

        # Also update follower_count_ig on the influencer record itself
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/influencers?id=eq.{info['influencer_id']}",
            headers=SB_WRITE,
            json={"follower_count_ig": followers},
            timeout=15,
        )

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "influencer_id": info["influencer_id"],
                "brand_id":      info["brand_id"],
                "platform":      "instagram",
                "post_url":      f"https://www.instagram.com/p/{shortcode}/",
                "caption":       caption,
                "hashtags":      extract_hashtags(caption),
                "like_count":    post.get("likesCount", 0),
                "comment_count": post.get("commentsCount", 0),
                "view_count":    post.get("videoViewCount", 0),
                "posted_at":     post.get("timestamp"),
            })

    log(f"  Matched influencers: {', '.join(matched)}")

    # Insert snapshots (no constraint issue with delete+insert)
    s = sb_insert("influencer_snapshots", snapshots)
    log(f"  ✓ {s} influencer snapshots inserted")

    # Upsert posts (influencer_posts uses post_url — try upsert then fallback)
    url = f"{SUPABASE_URL}/rest/v1/influencer_posts?on_conflict=post_url"
    headers = {**SB_WRITE, "Prefer": "resolution=merge-duplicates"}
    p_inserted = 0
    for i in range(0, len(posts), 500):
        batch = posts[i:i+500]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code in (200, 201):
            p_inserted += len(batch)
        else:
            r2 = requests.post(f"{SUPABASE_URL}/rest/v1/influencer_posts", headers=SB_WRITE, json=batch, timeout=30)
            if r2.status_code in (200, 201):
                p_inserted += len(batch)
    log(f"  ✓ {p_inserted} influencer posts stored")

    return s, p_inserted


# ── Step D: Fix YouTube channel snapshots ────────────────────────────────────

def fix_youtube_data():
    log(f"\n[D] Fixing YouTube channel snapshots from run {YT_RUN_ID}")
    iso_year, iso_week = week_info()

    yt_rows = sb_get("yt_channels", "id,channel_url,brand_id")
    yt_map = {r["channel_url"].rstrip("/"): {"channel_id": r["id"], "brand_id": r["brand_id"]} for r in yt_rows}

    log(f"  Fetching YouTube results from Apify run {YT_RUN_ID}...")
    items = fetch_apify_results(YT_RUN_ID)
    log(f"  Got {len(items)} items from Apify")

    if not items:
        log("  ⚠ YouTube actor returned no results (possibly rate-limited)")
        return 0, 0

    channel_seen: dict = {}
    videos = []

    for item in items:
        ch_url = (item.get("channelUrl") or "").rstrip("/")
        info = yt_map.get(ch_url)
        if not info:
            for stored_url, stored_info in yt_map.items():
                if stored_url.lower() in ch_url.lower() or ch_url.lower() in stored_url.lower():
                    info = stored_info
                    ch_url = stored_url
                    break
        if not info:
            continue

        if ch_url not in channel_seen:
            channel_seen[ch_url] = {
                "channel_id": info["channel_id"],
                "brand_id": info["brand_id"],
                "subscribers": item.get("numberOfSubscribers"),
                "total_videos": item.get("channelTotalVideos"),
                "total_views": item.get("channelTotalViews"),
                "week_number": iso_week,
                "year": iso_year,
            }

        vid_id = item.get("id") or item.get("videoId")
        if not vid_id:
            continue
        dur = item.get("duration", "")
        parts = [int(p) for p in dur.split(":")] if dur else []
        dur_sec = (parts[0]*3600 + parts[1]*60 + parts[2] if len(parts)==3
                   else parts[0]*60+parts[1] if len(parts)==2
                   else parts[0] if parts else None)
        videos.append({
            "channel_id": info["channel_id"],
            "brand_id": info["brand_id"],
            "youtube_video_id": vid_id,
            "video_url": item.get("url"),
            "title": item.get("title"),
            "description": (item.get("description") or "")[:1000],
            "view_count": item.get("viewCount", 0),
            "like_count": item.get("likes", 0),
            "comment_count": item.get("commentsCount", 0),
            "duration_seconds": dur_sec,
            "thumbnail_url": item.get("thumbnailUrl"),
            "published_at": item.get("date"),
            "is_short": False,
            "is_sponsored": False,
            "is_live_recording": False,
        })

    log(f"  Found {len(channel_seen)} channels, {len(videos)} videos")

    # Delete + insert for yt_channel_weekly
    all_ch = sb_get("yt_channel_weekly", "id,week_number,year")
    week_ch = [r for r in all_ch if r["week_number"] == iso_week and r["year"] == iso_year]
    for r in week_ch:
        sb_delete("yt_channel_weekly", {"id": r["id"]})
    c = sb_insert("yt_channel_weekly", list(channel_seen.values()))

    # Upsert videos (youtube_video_id should have unique constraint)
    url = f"{SUPABASE_URL}/rest/v1/yt_videos?on_conflict=youtube_video_id"
    headers = {**SB_WRITE, "Prefer": "resolution=merge-duplicates"}
    v = 0
    for i in range(0, len(videos), 500):
        batch = videos[i:i+500]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code in (200, 201):
            v += len(batch)
        else:
            r2 = requests.post(f"{SUPABASE_URL}/rest/v1/yt_videos", headers=SB_WRITE, json=batch, timeout=30)
            if r2.status_code in (200, 201):
                v += len(batch)

    log(f"  ✓ {c} YT channel snapshots, {v} videos stored")
    return c, v


# ── Step E: Fix Reddit mentions ───────────────────────────────────────────────

def fix_reddit_mentions():
    log("\n[E] Fixing reddit_mentions — fetching from completed Reddit runs")

    brand_rows = sb_get("brands", "id,slug")
    brand_map = {r["slug"]: r["id"] for r in brand_rows}

    BRAND_KEYWORDS = {
        "joola": ["joola"],
        "selkirk": ["selkirk"],
        "paddletek": ["paddletek", "paddle tek"],
        "crbn": ["crbn"],
        "six-zero": ["six zero", "sixzero", "six-zero"],
        "engage": ["engage pickleball"],
        "onix": ["onix"],
        "franklin": ["franklin pickleball"],
        "head": ["head pickleball"],
        "wilson": ["wilson pickleball"],
        "gamma": ["gamma pickleball"],
    }

    def match_brands(text: str):
        t = text.lower()
        return [slug for slug, kws in BRAND_KEYWORDS.items() if any(kw in t for kw in kws)]

    def extract_reddit_post_id(url: str, item_id) -> str:
        import re
        if item_id:
            s = str(item_id)
            return s if s.startswith("t3_") else f"t3_{s}"
        m = re.search(r"/comments/([a-z0-9]+)/", url or "")
        return f"t3_{m.group(1)}" if m else ""

    all_items = []
    for run_id in REDDIT_RUN_IDS:
        log(f"  Fetching from Apify run {run_id}...")
        items = fetch_apify_results(run_id)
        log(f"    Got {len(items)} items")
        all_items.extend(items)

    # Get existing reddit_post_ids to avoid plain-insert duplicates
    existing = sb_get("reddit_mentions", "reddit_post_id,brand_id")
    existing_keys = {(r["reddit_post_id"], str(r["brand_id"])) for r in existing}
    log(f"  {len(existing_keys)} existing reddit_mention rows in DB")

    seen: set = set()
    rows = []
    for item in all_items:
        title = item.get("title", "")
        body = item.get("text") or item.get("body") or ""
        post_url = item.get("url") or item.get("postUrl", "")
        reddit_post_id = extract_reddit_post_id(post_url, item.get("id"))
        for slug in match_brands(title + " " + body):
            brand_id = brand_map.get(slug)
            if not brand_id:
                continue
            key = (reddit_post_id, str(brand_id))
            if key in seen or key in existing_keys:
                continue
            seen.add(key)
            rows.append({
                "brand_id": brand_id,
                "reddit_post_id": reddit_post_id,
                "subreddit": item.get("subreddit") or item.get("communityName", ""),
                "country_code": "US",
                "post_title": title[:500],
                "post_url": post_url,
                "content_type": "Post",
                "content_text": body[:2000],
                "author": item.get("author") or item.get("username", ""),
                "upvotes": item.get("score") or item.get("upvotes", 0),
                "posted_at": item.get("createdAt") or item.get("created"),
            })

    log(f"  Inserting {len(rows)} new Reddit mention rows...")
    n = sb_insert("reddit_mentions", rows)
    log(f"  ✓ {n} Reddit mentions stored")
    return n


# ── Step F: Update follower counts on influencers table ───────────────────────

def update_influencer_follower_counts():
    """Make sure the follower_count_ig column on influencers matches latest snapshot."""
    log("\n[D] Syncing follower counts on influencers table")
    iso_year, iso_week = week_info()

    snaps = sb_get("influencer_snapshots",
                   "influencer_id,follower_count_ig,week_number,year",
                   f"&week_number=eq.{iso_week}&year=eq.{iso_year}")
    updated = 0
    for s in snaps:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/influencers?id=eq.{s['influencer_id']}",
            headers=SB_WRITE,
            json={"follower_count_ig": s["follower_count_ig"]},
            timeout=15,
        )
        if r.status_code in (200, 204):
            updated += 1
    log(f"  ✓ {updated} influencer follower counts synced")
    return updated


# ── Step E: Data accuracy summary ─────────────────────────────────────────────

def print_accuracy_report():
    log("\n[E] DATA ACCURACY REPORT — May 15, 2026")
    log("=" * 55)

    iso_year, iso_week = week_info()

    # IG brand profiles
    ig_profs = sb_get("ig_profiles_weekly", "handle,followers,week_number,year",
                      f"&week_number=eq.{iso_week}&year=eq.{iso_year}&order=followers.desc")
    log(f"\n  IG Brand Profiles (week {iso_week}/{iso_year}):")
    for r in ig_profs:
        log(f"    {r['handle']:25} — {r['followers']:>8,} followers")

    # Key influencers
    key_handles = ["benjohns_pb", "annabright.pb", "tysonmcguffin", "anna.leigh.waters"]
    infs = sb_get("influencers", "name,instagram_handle,follower_count_ig",
                  "&order=follower_count_ig.desc")
    log(f"\n  Key Influencer Followers (corrected handles):")
    for r in infs:
        marker = " ✓ CORRECTED" if r["instagram_handle"] in ["benjohns_pb", "annabright.pb", "anna.leigh.waters"] else ""
        if r["instagram_handle"] in key_handles or r.get("follower_count_ig", 0) > 50000:
            log(f"    @{r['instagram_handle']:30} — {r['follower_count_ig']:>8,} followers{marker}")

    # Row counts
    tables = ["ig_profiles_weekly", "ig_posts", "influencer_posts",
              "influencer_snapshots", "reddit_mentions", "marketing_ads",
              "yt_videos", "ig_comments"]
    log(f"\n  Table row counts:")
    for t in tables:
        rows = sb_get(t, "id")
        log(f"    {t:30} — {len(rows):>6} rows")

    log("\n" + "=" * 55)


def main():
    log("=" * 55)
    log("JOOLA Intel — Data Recovery & Accuracy Fix")
    log(f"Date: 2026-05-15 | Started: {datetime.now().strftime('%H:%M:%S')}")
    log("=" * 55)

    fix_ig_profiles_weekly()
    fix_ig_posts()
    fix_influencer_data()
    fix_youtube_data()
    fix_reddit_mentions()
    update_influencer_follower_counts()
    print_accuracy_report()

    log("\nDone. Run 'python scripts/pipeline/count_rows.py' to verify all counts.")


if __name__ == "__main__":
    main()
