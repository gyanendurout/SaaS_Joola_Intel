"""
JOOLA Intel — May 15, 2026 Full Data Refresh
Scrapes all sources with corrected influencer IG handles.
Logs progress to scripts/scrape_may15.log
"""

import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import os, requests, time, json, re
from datetime import date, datetime, timedelta
from collections import defaultdict
try:
    from dotenv import load_dotenv
    load_dotenv(); load_dotenv("scripts/.env")
except ImportError:
    pass

LOG_FILE = "scripts/scrape_may15.log"
RUN_DATE = "2026-05-15"

APIFY_TOKEN  = os.environ["APIFY_TOKEN"]
APIFY_BASE   = "https://api.apify.com/v2"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
    "User-Agent": "python-requests/2.31.0",
}

RESULTS: dict = {}

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def write_summary():
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write("\n=== PROGRESS SNAPSHOT ===\n")
        for k, v in RESULTS.items():
            f.write(f"  {k}: {v}\n")
        f.write("=========================\n\n")

# ─── Network ────────────────────────────────────────────────────────────────

def http_get(url: str, headers=None, timeout=30) -> requests.Response:
    for attempt in range(1, 6):
        try:
            return requests.get(url, headers=headers, timeout=timeout)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            log(f"  ⚠ Network retry {attempt}/5: {e}")
            time.sleep(15)
    raise RuntimeError("Network failed after 5 retries")

def http_post(url: str, headers=None, json_data=None, timeout=30) -> requests.Response:
    for attempt in range(1, 6):
        try:
            return requests.post(url, headers=headers, json=json_data, timeout=timeout)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            log(f"  ⚠ Network retry {attempt}/5: {e}")
            time.sleep(15)
    raise RuntimeError("Network failed after 5 retries")

# ─── Apify ──────────────────────────────────────────────────────────────────

def run_actor(actor_id: str, input_data: dict) -> str:
    actor_url_id = actor_id.replace("/", "~")
    url = f"{APIFY_BASE}/acts/{actor_url_id}/runs?token={APIFY_TOKEN}"
    resp = http_post(url, json_data=input_data, timeout=30)
    resp.raise_for_status()
    run_id = resp.json()["data"]["id"]
    log(f"  Started actor {actor_id} → run {run_id}")
    return run_id

def wait_for_run(run_id: str, poll_sec: int = 15) -> bool:
    url = f"{APIFY_BASE}/actor-runs/{run_id}?token={APIFY_TOKEN}"
    while True:
        status = http_get(url, timeout=15).json()["data"]["status"]
        log(f"    Run {run_id}: {status}")
        if status == "SUCCEEDED":
            return True
        if status in ("FAILED", "TIMED-OUT", "ABORTED"):
            log(f"  ✗ Run {run_id} ended with {status}")
            return False
        time.sleep(poll_sec)

def fetch_results(run_id: str) -> list[dict]:
    url = f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items?token={APIFY_TOKEN}&clean=true"
    resp = http_get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()

# ─── Supabase ───────────────────────────────────────────────────────────────

def sb_get(table: str, select: str = "*", params: dict | None = None) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}"
    if params:
        url += "&" + "&".join(f"{k}=eq.{v}" for k, v in params.items())
    resp = http_get(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "User-Agent": "python-requests/2.31.0",
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()

def sb_upsert(table: str, rows: list[dict], on_conflict: str) -> int:
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        resp = http_post(url, headers=SB_HEADERS, json_data=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
        else:
            log(f"  ✗ Upsert {table} error {resp.status_code}: {resp.text[:200]}")
    return inserted

def sb_upsert_returning(table: str, rows: list[dict], on_conflict: str) -> list[dict]:
    if not rows:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"}
    out = []
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        resp = http_post(url, headers=headers, json_data=batch, timeout=30)
        if resp.status_code in (200, 201):
            try:
                out.extend(resp.json())
            except Exception:
                pass
        else:
            log(f"  ✗ Upsert {table} error {resp.status_code}: {resp.text[:200]}")
    return out

# ─── Lookup maps ─────────────────────────────────────────────────────────────

def load_brand_map() -> dict[str, str]:
    rows = sb_get("brands", "id,slug")
    return {r["slug"]: r["id"] for r in rows}

def load_ig_account_map() -> dict[str, dict]:
    rows = sb_get("ig_accounts", "id,handle,brand_id")
    return {r["handle"]: {"account_id": r["id"], "brand_id": r["brand_id"]} for r in rows}

def load_influencer_map() -> dict[str, dict]:
    rows = sb_get("influencers", "id,brand_id,instagram_handle,name")
    result = {}
    for r in rows:
        if r.get("instagram_handle"):
            result[r["instagram_handle"]] = {"influencer_id": r["id"], "brand_id": r["brand_id"], "name": r["name"]}
    return result

def load_yt_channel_map() -> dict[str, dict]:
    rows = sb_get("yt_channels", "id,channel_url,brand_id")
    return {r["channel_url"].rstrip("/"): {"channel_id": r["id"], "brand_id": r["brand_id"]} for r in rows}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def extract_hashtags(text: str) -> list[str]:
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

BRAND_KEYWORDS = {
    "joola": "joola", "joola pickleball": "joola", "ben johns": "joola",
    "scorpeus": "joola", "hyperion": "joola", "solaire": "joola",
    "selkirk": "selkirk", "selkirk sport": "selkirk",
    "paddletek": "paddletek", "crbn": "crbn",
    "six zero": "six-zero", "sixzero": "six-zero",
    "engage": "engage", "onix": "onix",
    "franklin": "franklin", "franklin sports": "franklin",
    "head pickleball": "head", "head paddle": "head",
    "wilson pickleball": "wilson", "wilson paddle": "wilson",
    "gamma": "gamma", "gamma pickleball": "gamma",
}

def match_brands(text: str) -> list[str]:
    text_lower = text.lower()
    matched = set()
    for keyword, slug in BRAND_KEYWORDS.items():
        if keyword in text_lower:
            matched.add(slug)
    return list(matched)

# ─── Step 1: IG Brand Profiles ────────────────────────────────────────────────

def step_ig_brands(ig_map: dict) -> tuple[int, int]:
    log("\n[1/8] Instagram brand profiles & posts")
    handles = list(ig_map.keys())
    log(f"  Scraping {len(handles)} brand accounts: {handles}")

    run_id = run_actor("apify/instagram-profile-scraper", {
        "usernames": handles,
        "resultsLimit": 30,
    })
    if not wait_for_run(run_id):
        RESULTS["ig_profiles"] = "FAILED"
        return 0, 0

    items = fetch_results(run_id)
    iso_year, iso_week = week_info()
    profiles, posts = [], []

    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = ig_map.get(handle)
        if not info:
            log(f"  ⚠ No ig_accounts record for: {handle!r}")
            continue

        followers = item.get("followersCount", 0)
        log(f"  ✓ {handle}: {followers:,} followers, {item.get('postsCount', 0)} posts")

        profiles.append({
            "account_id": info["account_id"],
            "brand_id": info["brand_id"],
            "handle": handle,
            "followers": followers,
            "following": item.get("followsCount"),
            "post_count": item.get("postsCount"),
            "bio_text": item.get("biography"),
            "bio_link": item.get("externalUrl"),
            "is_verified": item.get("verified", False),
            "week_number": iso_week,
            "year": iso_year,
        })

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "account_id": info["account_id"],
                "brand_id": info["brand_id"],
                "handle": handle,
                "instagram_post_id": shortcode,
                "post_url": f"https://www.instagram.com/p/{shortcode}/",
                "post_format": TYPE_MAP.get(post.get("type", ""), "Image"),
                "caption": caption,
                "hashtags": extract_hashtags(caption),
                "like_count": post.get("likesCount", 0),
                "comment_count": post.get("commentsCount", 0),
                "view_count": post.get("videoViewCount", 0),
                "image_url": post.get("displayUrl"),
                "posted_at": post.get("timestamp"),
            })

    p = sb_upsert("ig_profiles_weekly", profiles, "account_id,week_number,year")
    q = sb_upsert("ig_posts", posts, "instagram_post_id")
    log(f"  ✓ {p} brand profile snapshots, {q} posts stored")
    RESULTS["ig_brand_profiles"] = p
    RESULTS["ig_brand_posts"] = q
    write_summary()
    return p, q

# ─── Step 2: Influencer Profiles (with corrected handles) ────────────────────

def step_influencers(inf_map: dict) -> tuple[int, int]:
    log("\n[2/8] Influencer profiles — corrected handles")
    handles = list(inf_map.keys())
    log(f"  Scraping {len(handles)} influencers")
    log(f"  Key athletes: {[inf_map[h]['name'] for h in handles if inf_map[h]['name'] in ['Ben Johns','Anna Bright','Tyson McGuffin','Anna Leigh Waters']]}")

    run_id = run_actor("apify/instagram-profile-scraper", {
        "usernames": handles,
        "resultsLimit": 12,
    })
    if not wait_for_run(run_id):
        RESULTS["influencer_profiles"] = "FAILED"
        return 0, 0

    items = fetch_results(run_id)
    iso_year, iso_week = week_info()
    posts, snapshots = [], []

    matched_names = []
    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = inf_map.get(handle)
        if not info:
            log(f"  ⚠ No influencer record for: {handle!r}")
            continue

        followers = item.get("followersCount", 0)
        matched_names.append(f"{info['name']} ({followers:,})")

        snapshots.append({
            "influencer_id": info["influencer_id"],
            "brand_id": info["brand_id"],
            "follower_count_ig": followers,
            "week_number": iso_week,
            "year": iso_year,
        })

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "influencer_id": info["influencer_id"],
                "brand_id": info["brand_id"],
                "platform": "instagram",
                "post_url": f"https://www.instagram.com/p/{shortcode}/",
                "caption": caption,
                "hashtags": extract_hashtags(caption),
                "like_count": post.get("likesCount", 0),
                "comment_count": post.get("commentsCount", 0),
                "view_count": post.get("videoViewCount", 0),
                "posted_at": post.get("timestamp"),
            })

    log(f"  Matched: {', '.join(matched_names[:8])}")
    p = sb_upsert("influencer_posts", posts, "post_url")
    s = sb_upsert("influencer_snapshots", snapshots, "influencer_id,week_number,year")
    log(f"  ✓ {p} influencer posts, {s} snapshots stored")
    RESULTS["influencer_posts"] = p
    RESULTS["influencer_snapshots"] = s
    write_summary()
    return p, s

# ─── Step 3: YouTube ──────────────────────────────────────────────────────────

def step_youtube(yt_map: dict) -> tuple[int, int]:
    log("\n[3/8] YouTube channels & videos")
    run_id = run_actor("streamers/youtube-scraper", {
        "startUrls": [{"url": u} for u in yt_map.keys()],
        "maxResults": 50,
        "maxResultsShorts": 0,
    })
    if not wait_for_run(run_id):
        RESULTS["yt_channels"] = "FAILED"
        return 0, 0

    items = fetch_results(run_id)
    iso_year, iso_week = week_info()
    channel_seen: dict[str, dict] = {}
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
        dur_sec = (parts[0] * 3600 + parts[1] * 60 + parts[2] if len(parts) == 3
                   else parts[0] * 60 + parts[1] if len(parts) == 2
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

    c = sb_upsert("yt_channel_weekly", list(channel_seen.values()), "channel_id,week_number,year")
    v = sb_upsert("yt_videos", videos, "youtube_video_id")
    log(f"  ✓ {c} YT channel snapshots, {v} videos stored")
    RESULTS["yt_channels"] = c
    RESULTS["yt_videos"] = v
    write_summary()
    return c, v

# ─── Step 4: Reddit ───────────────────────────────────────────────────────────

def step_reddit(brand_map: dict) -> int:
    log("\n[4/8] Reddit mentions")
    run_a = run_actor("trudax/reddit-scraper-lite", {
        "startUrls": [{"url": "https://www.reddit.com/r/pickleball/"}],
        "sort": "new", "time": "month", "maxItems": 500,
    })
    run_b = run_actor("trudax/reddit-scraper-lite", {
        "searches": [
            "joola pickleball", "selkirk pickleball", "paddletek",
            "crbn pickleball", "six zero pickleball", "engage pickleball",
            "onix pickleball", "franklin pickleball paddle",
            "head pickleball paddle", "wilson pickleball paddle", "gamma pickleball",
        ],
        "sort": "relevance", "time": "month", "maxItems": 500,
    })

    items_a = fetch_results(run_a) if wait_for_run(run_a) else []
    items_b = fetch_results(run_b) if wait_for_run(run_b) else []

    def extract_reddit_post_id(url: str, item_id) -> str:
        if item_id:
            s = str(item_id)
            return s if s.startswith("t3_") else f"t3_{s}"
        m = re.search(r"/comments/([a-z0-9]+)/", url or "")
        return f"t3_{m.group(1)}" if m else ""

    seen: set[tuple] = set()
    rows = []
    for item in items_a + items_b:
        title = item.get("title", "")
        body = item.get("text") or item.get("body") or ""
        post_url = item.get("url") or item.get("postUrl", "")
        reddit_post_id = extract_reddit_post_id(post_url, item.get("id"))
        for slug in match_brands(title + " " + body):
            brand_id = brand_map.get(slug)
            if not brand_id:
                continue
            key = (post_url, brand_id)
            if key in seen:
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

    n = sb_upsert("reddit_mentions", rows, "reddit_post_id,brand_id")
    log(f"  ✓ {n} Reddit mentions stored")
    RESULTS["reddit_mentions"] = n
    write_summary()
    return n

# ─── Step 5: Promos ───────────────────────────────────────────────────────────

def step_promos(brand_map: dict) -> int:
    log("\n[5/8] Homepage promo banners")
    brand_rows = sb_get("brands", "id,slug,website_url")
    homepages = [(r["slug"], r["website_url"]) for r in brand_rows if r.get("website_url")]

    page_function = r"""
async function pageFunction(context) {
    const { page } = context;
    await page.waitForTimeout(3000);
    const result = await page.evaluate(() => {
        const candidates = [];
        const sels = [
            '.announcement-bar', '.announcement', '.promo-bar', '.top-bar',
            '.header-banner', '[class*="promo"]', '[class*="banner"]',
            '[class*="announcement"]', '[data-section-type*="announcement"]'
        ];
        sels.forEach(s => document.querySelectorAll(s).forEach(el => {
            const txt = (el.innerText || '').trim();
            if (txt && txt.length < 300) candidates.push(txt);
        }));
        return Array.from(new Set(candidates));
    });
    return { url: context.request.url, banners: result };
}
"""
    run_id = run_actor("apify/playwright-scraper", {
        "startUrls": [{"url": u} for _, u in homepages],
        "pageFunction": page_function,
        "maxRequestsPerCrawl": len(homepages) + 2,
    })
    if not wait_for_run(run_id):
        RESULTS["promos"] = "FAILED"
        return 0

    items = fetch_results(run_id)

    def detect_discount_pct(text: str):
        m = re.search(r"(\d{1,2})\s*%\s*(off|discount|sale)", text, re.I)
        return float(m.group(1)) if m else None

    def classify(text: str) -> str:
        t = text.lower()
        if "site" in t or "everything" in t or "sitewide" in t: return "sitewide"
        if "flash" in t: return "flash"
        if "season" in t or "holiday" in t or "black friday" in t: return "seasonal"
        return "general"

    rows = []
    for item in items:
        source_url = item.get("url") or ""
        slug = None
        for s, hp in homepages:
            if hp and hp.split("/")[2] in source_url:
                slug = s
                break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue
        for banner_text in item.get("banners", []):
            if not banner_text or len(banner_text) < 5:
                continue
            rows.append({
                "brand_id": brand_id,
                "banner_text": banner_text[:1000],
                "promo_type": classify(banner_text),
                "discount_pct": detect_discount_pct(banner_text),
                "source_url": source_url,
            })

    n = sb_upsert("promotions", rows, "brand_id,banner_text")
    log(f"  ✓ {n} promo banners stored")
    RESULTS["promos"] = n
    write_summary()
    return n

# ─── Step 6: Meta Ads ─────────────────────────────────────────────────────────

FACEBOOK_PAGES = [
    {"slug": "joola",     "page_name": "JOOLA Pickleball"},
    {"slug": "selkirk",   "page_name": "Selkirk Sport"},
    {"slug": "paddletek", "page_name": "Paddletek"},
    {"slug": "crbn",      "page_name": "CRBN Pickleball"},
    {"slug": "six-zero",  "page_name": "Six Zero Pickleball"},
    {"slug": "engage",    "page_name": "Engage Pickleball"},
    {"slug": "onix",      "page_name": "Onix Pickleball"},
    {"slug": "franklin",  "page_name": "Franklin Sports"},
    {"slug": "head",      "page_name": "HEAD Pickleball"},
    {"slug": "wilson",    "page_name": "Wilson Pickleball"},
    {"slug": "gamma",     "page_name": "Gamma Pickleball"},
]

def step_meta_ads(brand_map: dict) -> int:
    log("\n[6/8] Meta Ad Library")
    from urllib.parse import quote
    urls = [
        "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US"
        f"&q={quote(fp['page_name'])}&search_type=keyword_unordered&media_type=all"
        for fp in FACEBOOK_PAGES
    ]
    run_id = run_actor("apify/facebook-ads-scraper", {
        "startUrls": [{"url": u} for u in urls],
        "resultsLimit": 50,
        "activeStatus": "active",
    })
    if not wait_for_run(run_id, poll_sec=20):
        RESULTS["meta_ads"] = "FAILED"
        return 0

    items = fetch_results(run_id)
    name_to_slug = {fp["page_name"].lower(): fp["slug"] for fp in FACEBOOK_PAGES}
    rows = []
    for item in items:
        page_name = (item.get("page_name") or item.get("pageName") or "").strip()
        slug = name_to_slug.get(page_name.lower())
        if not slug:
            for n, s in name_to_slug.items():
                if n in page_name.lower() or page_name.lower() in n:
                    slug = s
                    break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue
        ad_id = item.get("ad_archive_id") or item.get("adArchiveId") or item.get("id")
        if not ad_id:
            continue
        rows.append({
            "brand_id": brand_id,
            "platform": "meta",
            "ad_id": str(ad_id),
            "page_name": page_name,
            "body": (item.get("ad_creative_body") or item.get("body") or "")[:2000],
            "cta": item.get("cta_text") or item.get("cta"),
            "creative_url": item.get("creative_url") or item.get("image_url") or item.get("video_url"),
            "landing_url": item.get("link_url") or item.get("landing_url"),
            "started_at": item.get("ad_delivery_start_time") or item.get("started_at"),
            "is_active": item.get("is_active", True),
            "raw": item,
        })

    n = sb_upsert("marketing_ads", rows, "platform,ad_id")
    log(f"  ✓ {n} Meta ads stored")
    RESULTS["meta_ads"] = n
    write_summary()
    return n

# ─── Step 7: IG Comments ──────────────────────────────────────────────────────

def step_ig_comments(brand_map: dict) -> int:
    log("\n[7/8] Instagram comments on top posts")
    posts = sb_get("ig_posts", "id,brand_id,instagram_post_id,post_url,like_count")
    if not posts:
        log("  ⚠ No IG posts in DB")
        return 0

    by_brand: dict[str, list] = defaultdict(list)
    for p in posts:
        by_brand[p["brand_id"]].append(p)
    selected = []
    for brand_id, lst in by_brand.items():
        lst.sort(key=lambda x: x.get("like_count") or 0, reverse=True)
        selected.extend(lst[:20])

    def norm_ig(u: str) -> str:
        return (u or "").split("?")[0].rstrip("/")

    url_to_post = {norm_ig(p["post_url"]): p for p in selected if p.get("post_url")}
    post_urls = list(url_to_post.keys())

    run_id = run_actor("apify/instagram-comment-scraper", {
        "directUrls": post_urls,
        "resultsLimit": 30,
        "includeNestedComments": False,
    })
    if not wait_for_run(run_id, poll_sec=20):
        RESULTS["ig_comments"] = "FAILED"
        return 0

    items = fetch_results(run_id)
    rows = []
    for item in items:
        post_url = norm_ig(item.get("postUrl") or item.get("ownerPostUrl") or "")
        post = url_to_post.get(post_url)
        if not post:
            for u, p in url_to_post.items():
                if u in post_url or post_url in u:
                    post = p
                    break
        if not post:
            continue
        rows.append({
            "instagram_comment_id": item.get("id"),
            "post_id": post["id"],
            "brand_id": post["brand_id"],
            "commenter_username": item.get("ownerUsername") or item.get("username"),
            "comment_text": (item.get("text") or "")[:2000],
            "comment_likes": item.get("likesCount", 0),
            "posted_at": item.get("timestamp"),
        })

    n = sb_upsert("ig_comments", rows, "instagram_comment_id")
    log(f"  ✓ {n} IG comments stored")
    RESULTS["ig_comments"] = n
    write_summary()
    return n

# ─── Step 8: YT Comments ──────────────────────────────────────────────────────

def step_yt_comments(brand_map: dict) -> int:
    log("\n[8/8] YouTube comments on top videos")
    videos = sb_get("yt_videos", "id,brand_id,youtube_video_id,video_url,view_count")
    if not videos:
        log("  ⚠ No YT videos in DB")
        return 0

    by_brand: dict[str, list] = defaultdict(list)
    for v in videos:
        by_brand[v["brand_id"]].append(v)
    selected = []
    for brand_id, lst in by_brand.items():
        lst.sort(key=lambda x: x.get("view_count") or 0, reverse=True)
        selected.extend(lst[:10])

    video_urls = [v["video_url"] for v in selected if v.get("video_url")]
    url_to_video = {v["video_url"]: v for v in selected if v.get("video_url")}

    run_id = run_actor("streamers/youtube-comments-scraper", {
        "startUrls": [{"url": u} for u in video_urls],
        "maxComments": 50,
    })
    if not wait_for_run(run_id, poll_sec=20):
        RESULTS["yt_comments"] = "FAILED"
        return 0

    items = fetch_results(run_id)
    rows = []
    for item in items:
        video_url = item.get("videoUrl") or item.get("url") or ""
        video = None
        for u, v in url_to_video.items():
            if u in video_url or video_url in u:
                video = v
                break
        if not video:
            continue
        posted_at = item.get("publishedAt")
        if not posted_at:
            pub = item.get("publishedTimeText") or ""
            posted_at = pub if ("T" in pub or "-" in pub[:5]) else None
        rows.append({
            "youtube_comment_id": item.get("commentId") or item.get("id"),
            "video_id": video["id"],
            "brand_id": video["brand_id"],
            "commenter_username": item.get("author") or item.get("authorName"),
            "comment_text": (item.get("text") or item.get("comment") or "")[:2000],
            "comment_likes": item.get("likeCount") or item.get("likesCount", 0),
            "posted_at": posted_at,
        })

    n = sb_upsert("yt_comments", rows, "youtube_comment_id")
    log(f"  ✓ {n} YT comments stored")
    RESULTS["yt_comments"] = n
    write_summary()
    return n

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    # Clear/init log
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write(f"JOOLA Intel — May 15, 2026 Full Data Scrape\n")
        f.write(f"Started: {datetime.now().isoformat()}\n")
        f.write("=" * 55 + "\n\n")

    log("=" * 55)
    log(f"JOOLA Intel — May 15 Data Refresh")
    log(f"Date: {RUN_DATE} | Started: {datetime.now().strftime('%H:%M:%S')}")
    log("=" * 55)

    log("\nLoading lookup maps from Supabase...")
    brand_map = load_brand_map()
    ig_map = load_ig_account_map()
    inf_map = load_influencer_map()
    yt_map = load_yt_channel_map()

    log(f"  {len(brand_map)} brands, {len(ig_map)} IG brand accounts")
    log(f"  {len(inf_map)} influencers (handles verified)")
    log(f"  Key influencer handles: benjohns_pb, annabright.pb, tysonmcguffin, anna.leigh.waters")
    RESULTS["status"] = "RUNNING"
    write_summary()

    # Run all steps
    step_ig_brands(ig_map)
    step_influencers(inf_map)
    step_youtube(yt_map)
    step_reddit(brand_map)
    step_promos(brand_map)
    step_meta_ads(brand_map)
    step_ig_comments(brand_map)
    step_yt_comments(brand_map)

    RESULTS["status"] = "COMPLETE"
    RESULTS["finished_at"] = datetime.now().strftime("%H:%M:%S")
    write_summary()

    log("\n" + "=" * 55)
    log("COMPLETE — May 15 data refresh done!")
    for k, v in RESULTS.items():
        log(f"  {k}: {v}")
    log("=" * 55)

if __name__ == "__main__":
    main()
