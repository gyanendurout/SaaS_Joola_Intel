"""
JOOLA Intel — Apify → Supabase Pipeline
Run: python apify_to_supabase.py
Requires: pip install requests
"""

import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import os, requests
import time
from datetime import date, datetime, timedelta
try:
    from dotenv import load_dotenv
    load_dotenv(); load_dotenv("scripts/.env")
except ImportError:
    pass


# ─── Network resilience ─────────────────────────────────────────────────────
# Wraps requests.get/post with automatic retry on connection failure.
# Tolerates ~40 min of network outage (80 retries × 30 s).

NETWORK_MAX_RETRIES = 80
NETWORK_RETRY_WAIT  = 30  # seconds


def http_request(method: str, url: str, **kwargs) -> requests.Response:
    """requests.request with retry on connection errors / timeouts."""
    last_exc = None
    for attempt in range(1, NETWORK_MAX_RETRIES + 1):
        try:
            return requests.request(method, url, **kwargs)
        except (requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ReadTimeout) as e:
            last_exc = e
            print(f"  ⚠ Network error (attempt {attempt}/{NETWORK_MAX_RETRIES}): "
                  f"{type(e).__name__}. Waiting {NETWORK_RETRY_WAIT}s before retry...",
                  flush=True)
            time.sleep(NETWORK_RETRY_WAIT)
    raise last_exc

# ─── Credentials ────────────────────────────────────────────────────────────

APIFY_TOKEN  = os.environ["APIFY_TOKEN"]
APIFY_BASE   = "https://api.apify.com/v2"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def week_start() -> str:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return str(monday)


def duration_to_seconds(s: str) -> int | None:
    if not s:
        return None
    parts = [int(p) for p in s.split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0]


BRAND_KEYWORDS = {
    "joola": "joola", "joola pickleball": "joola", "ben johns": "joola",
    "scorpeus": "joola", "hyperion": "joola", "solaire": "joola",
    "selkirk": "selkirk", "selkirk sport": "selkirk", "vanguard": "selkirk",
    "luxx": "selkirk", "halo": "selkirk",
    "paddletek": "paddletek", "paddle tek": "paddletek", "bantam": "paddletek",
    "crbn": "crbn", "crbn pickleball": "crbn",
    "six zero": "six-zero", "sixzero": "six-zero", "double black diamond": "six-zero",
    "engage": "engage", "engage pickleball": "engage", "pursuit": "engage",
    "onix": "onix", "onix pickleball": "onix", "z5": "onix",
    "franklin": "franklin", "franklin pickleball": "franklin", "franklin sports": "franklin",
    "head pickleball": "head", "head paddle": "head", "radical": "head",
    "wilson pickleball": "wilson", "wilson paddle": "wilson",
    "gamma": "gamma", "gamma pickleball": "gamma", "obsidian": "gamma",
}


def match_brands(text: str) -> list[str]:
    text_lower = text.lower()
    matched = set()
    for keyword, slug in BRAND_KEYWORDS.items():
        if keyword in text_lower:
            matched.add(slug)
    return list(matched)


FACEBOOK_PAGES = [
    {"slug": "joola",     "fb_url": "https://www.facebook.com/joolapickleball/",   "page_name": "JOOLA Pickleball"},
    {"slug": "selkirk",   "fb_url": "https://www.facebook.com/SelkirkSport/",      "page_name": "Selkirk Sport"},
    {"slug": "paddletek", "fb_url": "https://www.facebook.com/Paddletek/",         "page_name": "Paddletek"},
    {"slug": "crbn",      "fb_url": "https://www.facebook.com/crbnpickleball/",    "page_name": "CRBN Pickleball"},
    {"slug": "six-zero",  "fb_url": "https://www.facebook.com/sixzeropickleball/", "page_name": "Six Zero Pickleball"},
    {"slug": "engage",    "fb_url": "https://www.facebook.com/engagepickleball/",  "page_name": "Engage Pickleball"},
    {"slug": "onix",      "fb_url": "https://www.facebook.com/OnixPickleball/",    "page_name": "Onix Pickleball"},
    {"slug": "franklin",  "fb_url": "https://www.facebook.com/FranklinSports/",    "page_name": "Franklin Sports"},
    {"slug": "head",      "fb_url": "https://www.facebook.com/headpickleball/",    "page_name": "HEAD Pickleball"},
    {"slug": "wilson",    "fb_url": "https://www.facebook.com/WilsonPickleball/",  "page_name": "Wilson Pickleball"},
    {"slug": "gamma",     "fb_url": "https://www.facebook.com/GammaPickleball/",   "page_name": "Gamma Pickleball"},
]


def ad_library_url(query: str) -> str:
    from urllib.parse import quote
    return (
        "https://www.facebook.com/ads/library/"
        "?active_status=all&ad_type=all&country=US"
        f"&q={quote(query)}&search_type=keyword_unordered&media_type=all"
    )


# ─── Apify ───────────────────────────────────────────────────────────────────

def run_actor(actor_id: str, input_data: dict) -> str:
    actor_url_id = actor_id.replace("/", "~")
    url = f"{APIFY_BASE}/acts/{actor_url_id}/runs?token={APIFY_TOKEN}"
    resp = http_request("POST", url, json=input_data, timeout=30)
    if resp.status_code >= 400:
        print(f"  ✗ Actor start failed ({resp.status_code}): {resp.text[:400]}")
    resp.raise_for_status()
    run_id = resp.json()["data"]["id"]
    print(f"  Started actor {actor_id} → run {run_id}")
    return run_id


def wait_for_run(run_id: str, poll_sec: int = 15) -> bool:
    url = f"{APIFY_BASE}/actor-runs/{run_id}?token={APIFY_TOKEN}"
    while True:
        status = http_request("GET", url, timeout=15).json()["data"]["status"]
        print(f"    Run {run_id}: {status}")
        if status == "SUCCEEDED":
            return True
        if status in ("FAILED", "TIMED-OUT", "ABORTED"):
            print(f"  ✗ Run {run_id} ended with {status}")
            return False
        time.sleep(poll_sec)


def fetch_results(run_id: str) -> list[dict]:
    url = f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items?token={APIFY_TOKEN}&clean=true"
    resp = http_request("GET", url, timeout=60)
    resp.raise_for_status()
    return resp.json()


# ─── Supabase ────────────────────────────────────────────────────────────────

def sb_get(table: str, select: str = "*", params: dict | None = None) -> list[dict]:
    url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}"
    if params:
        url += "&" + "&".join(f"{k}=eq.{v}" for k, v in params.items())
    resp = http_request("GET", url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def sb_upsert(table: str, rows: list[dict], on_conflict: str) -> int:
    if not rows:
        return 0
    url_upsert = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    url_plain  = f"{SUPABASE_URL}/rest/v1/{table}"
    plain_headers = {k: v for k, v in SB_HEADERS.items() if k != "Prefer"}
    plain_headers["Content-Type"] = "application/json"
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        resp = http_request("POST", url_upsert, headers=SB_HEADERS, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
            continue
        if resp.status_code == 400 and "42P10" in resp.text:
            print(f"  ⚠ {table}: no unique constraint for ON CONFLICT — use sb_delete_insert_weekly instead")
        else:
            print(f"  ✗ Upsert {table} error {resp.status_code}: {resp.text[:300]}")
    return inserted


def sb_delete_insert_weekly(table: str, rows: list[dict],
                             week_col: str, week_val: int,
                             year_val: int) -> int:
    """Delete existing rows for this week/year, then plain-insert fresh rows.
    Avoids duplicates for weekly snapshot tables that lack a unique constraint."""
    if not rows:
        return 0

    del_url = (f"{SUPABASE_URL}/rest/v1/{table}"
               f"?{week_col}=eq.{week_val}&year=eq.{year_val}")
    del_headers = {k: v for k, v in SB_HEADERS.items() if k != "Prefer"}
    del_headers["Content-Type"] = "application/json"
    dr = http_request("DELETE", del_url, headers=del_headers, timeout=15)
    if dr.status_code not in (200, 204):
        print(f"  ⚠ {table}: delete-before-insert failed {dr.status_code}: {dr.text[:200]}")

    url_plain = f"{SUPABASE_URL}/rest/v1/{table}"
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        resp = http_request("POST", url_plain, headers=del_headers, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
        else:
            print(f"  ✗ Insert {table} error {resp.status_code}: {resp.text[:300]}")
    return inserted


def sb_upsert_returning(table: str, rows: list[dict], on_conflict: str) -> list[dict]:
    """Upsert and return the inserted/updated rows (so we can grab their ids)."""
    if not rows:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {**SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"}
    out = []
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        resp = http_request("POST", url, headers=headers, json=batch, timeout=30)
        if resp.status_code not in (200, 201):
            print(f"  ✗ Upsert {table} error {resp.status_code}: {resp.text[:300]}")
            continue
        try:
            out.extend(resp.json())
        except Exception:
            pass
    return out


# ─── X (Twitter) handle registry ────────────────────────────────────────────
X_HANDLES = {
    "joola":     "joolausa",
    "selkirk":   "SelkirkSport",
    "franklin":  "FranklinSports",
    "engage":    "engagepickleball",
    "paddletek": "PaddletekLLC",
    "onix":      "OnixPickleball",
    "wilson":    "WilsonSportingG",
    "gamma":     "gammasportsusa",
}

# ─── TikTok handle registry ───────────────────────────────────────────────────
TIKTOK_HANDLES = {
    "joola":     "joolapickleball",
    "selkirk":   "selkirksport",
    "crbn":      "crbnpickleball",
    "franklin":  "franklinsportsofficial",
    "engage":    "engage_pickleball",
    "six-zero":  "sixzeropickleball",
    "onix":      "onix_pickleball",
    "wilson":    "wilsonsportinggoods",
    "gamma":     "gammasports",
    "prokennex": "prokennexpickleball",
}


# ─── Load lookup maps from Supabase ──────────────────────────────────────────

def load_brand_map() -> dict[str, str]:
    """slug → brand_id"""
    rows = sb_get("brands", "id,slug")
    return {r["slug"]: r["id"] for r in rows}


def load_ig_account_map() -> dict[str, dict]:
    """handle → {account_id, brand_id}"""
    rows = sb_get("ig_accounts", "id,handle,brand_id")
    return {r["handle"]: {"account_id": r["id"], "brand_id": r["brand_id"]} for r in rows}


def load_yt_channel_map() -> dict[str, dict]:
    """channel_url → {channel_id, brand_id}"""
    rows = sb_get("yt_channels", "id,channel_url,brand_id")
    return {r["channel_url"].rstrip("/"): {"channel_id": r["id"], "brand_id": r["brand_id"]} for r in rows}


def load_influencer_map() -> dict[str, dict]:
    """instagram_handle → {influencer_id, brand_id}"""
    rows = sb_get("influencers", "id,brand_id,instagram_handle")
    return {r["instagram_handle"]: {"influencer_id": r["id"], "brand_id": r["brand_id"]}
            for r in rows if r.get("instagram_handle")}


# ─── Step 1 — Instagram brands ───────────────────────────────────────────────

def run_instagram_brands(ig_map: dict[str, dict]) -> tuple[int, int]:
    print("\n[1/5] Instagram brand profiles & posts")
    run_id = run_actor("apify/instagram-profile-scraper", {
        "usernames": list(ig_map.keys()),
        "resultsLimit": 30,
    })
    if not wait_for_run(run_id):
        return 0, 0

    items = fetch_results(run_id)
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()
    profiles, posts = [], []

    import re
    def extract_hashtags(text: str) -> list[str]:
        return re.findall(r"#(\w+)", text or "")

    type_map = {"Image": "Image", "Video": "Video", "Sidecar": "Carousel",
                "GraphImage": "Image", "GraphVideo": "Video",
                "GraphSidecar": "Carousel", "XDTMediaTypeVideo": "Reel"}

    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = ig_map.get(handle)
        if not info:
            print(f"  ⚠ No ig_accounts record for IG handle: {handle!r}")
            continue
        brand_id   = info["brand_id"]
        account_id = info["account_id"]

        profiles.append({
            "account_id":   account_id,
            "brand_id":     brand_id,
            "handle":       handle,
            "followers":    item.get("followersCount"),
            "following":    item.get("followsCount"),
            "post_count":   item.get("postsCount"),
            "bio_text":     item.get("biography"),
            "bio_link":     item.get("externalUrl"),
            "is_verified":  item.get("verified", False),
            "week_number":  iso_week,
            "year":         iso_year,
        })

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "account_id":      account_id,
                "brand_id":        brand_id,
                "handle":          handle,
                "instagram_post_id": shortcode,
                "post_url":        f"https://www.instagram.com/p/{shortcode}/",
                "post_format":     type_map.get(post.get("type", ""), "Image"),
                "caption":         caption,
                "hashtags":        extract_hashtags(caption),
                "like_count":      post.get("likesCount", 0),
                "comment_count":   post.get("commentsCount", 0),
                "view_count":      post.get("videoViewCount", 0),
                "image_url":       post.get("displayUrl"),
                "posted_at":       post.get("timestamp"),
            })

    p = sb_delete_insert_weekly("ig_profiles_weekly", profiles, "week_number", iso_week, iso_year)
    q = sb_upsert("ig_posts", posts, "instagram_post_id")
    print(f"  ✓ {p} profile snapshots, {q} posts upserted")
    return p, q


# ─── Step 2 — YouTube ────────────────────────────────────────────────────────

def run_youtube(yt_map: dict[str, dict]) -> tuple[int, int]:
    print("\n[2/5] YouTube channels & videos")
    run_id = run_actor("streamers/youtube-scraper", {
        "startUrls": [{"url": u} for u in yt_map.keys()],
        "maxResults": 50,
        "maxResultsShorts": 0,
    })
    if not wait_for_run(run_id):
        return 0, 0

    items = fetch_results(run_id)
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

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
            print(f"  ⚠ No yt_channels record for YT channel: {ch_url!r}")
            continue
        brand_id   = info["brand_id"]
        channel_id = info["channel_id"]

        if ch_url not in channel_seen:
            channel_seen[ch_url] = {
                "channel_id":   channel_id,
                "brand_id":     brand_id,
                "subscribers":  item.get("numberOfSubscribers"),
                "total_videos": item.get("channelTotalVideos"),
                "total_views":  item.get("channelTotalViews"),
                "week_number":  iso_week,
                "year":         iso_year,
            }

        vid_id = item.get("id") or item.get("videoId")
        if not vid_id:
            continue
        videos.append({
            "channel_id":       channel_id,
            "brand_id":         brand_id,
            "youtube_video_id": vid_id,
            "video_url":        item.get("url"),
            "title":            item.get("title"),
            "description":      (item.get("description") or "")[:1000],
            "view_count":       item.get("viewCount", 0),
            "like_count":       item.get("likes", 0),
            "comment_count":    item.get("commentsCount", 0),
            "duration_seconds": duration_to_seconds(item.get("duration")),
            "thumbnail_url":    item.get("thumbnailUrl"),
            "published_at":     item.get("date"),
            "is_short":         False,
            "is_sponsored":     False,
            "is_live_recording": False,
        })

    c = sb_delete_insert_weekly("yt_channel_weekly", list(channel_seen.values()), "week_number", iso_week, iso_year)
    v = sb_upsert("yt_videos", videos, "youtube_video_id")
    print(f"  ✓ {c} channel snapshots, {v} videos upserted")
    return c, v


# ─── Step 3 — Reddit ─────────────────────────────────────────────────────────

def run_reddit(brand_map: dict[str, str]) -> int:
    print("\n[3/5] Reddit mentions")

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

    seen: set[tuple] = set()
    rows = []

    import re
    def extract_reddit_post_id(url: str, item_id: str | None) -> str:
        if item_id:
            return str(item_id) if str(item_id).startswith("t3_") else f"t3_{item_id}"
        m = re.search(r"/comments/([a-z0-9]+)/", url or "")
        return f"t3_{m.group(1)}" if m else ""

    for item in items_a + items_b:
        title   = item.get("title", "")
        body    = item.get("text") or item.get("body") or ""
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
                "brand_id":      brand_id,
                "reddit_post_id": reddit_post_id,
                "subreddit":     item.get("subreddit") or item.get("communityName", ""),
                "country_code":  "US",
                "post_title":    title[:500],
                "post_url":      post_url,
                "content_type":  "Post",
                "content_text":  body[:2000],
                "author":        item.get("author") or item.get("username", ""),
                "upvotes":       item.get("score") or item.get("upvotes", 0),
                "posted_at":     item.get("createdAt") or item.get("created", None),
            })

    n = sb_upsert("reddit_mentions", rows, "reddit_post_id,brand_id")
    print(f"  ✓ {n} Reddit mentions upserted")
    return n


# ─── Step 4 — Products ───────────────────────────────────────────────────────

def run_products(brand_map: dict[str, str]) -> int:
    print("\n[4/5] Brand product pages")

    product_urls = [
        ("joola",     "https://joola.com/collections/pickleball-paddles"),
        ("selkirk",   "https://www.selkirk.com/collections/paddles"),
        ("paddletek", "https://www.paddletek.com/collections/paddles"),
        ("crbn",      "https://www.crbnpickleball.com/collections/paddles"),
        ("six-zero",  "https://www.sixzeropickleball.com/collections/paddles"),
        ("engage",    "https://engagepickleball.com/collections/paddles"),
        ("onix",      "https://www.onixpickleball.com/collections/paddles"),
        ("franklin",  "https://www.franklinsports.com/pickleball/paddles"),
        ("head",      "https://www.head.com/en_US/pickleball/paddles/"),
        ("wilson",    "https://www.wilson.com/en-us/collection/pickleball/paddles"),
        ("gamma",     "https://gammasports.com/pickleball/paddles/"),
    ]

    # pageFunction extracts products from Shopify / generic collection pages
    page_function = """
async function pageFunction(context) {
    const { page, request } = context;
    await page.waitForTimeout(2000);
    const items = await page.evaluate(() => {
        const results = [];
        // Shopify product cards
        document.querySelectorAll('.product-card, .product-item, [data-product-id], .grid__item').forEach(el => {
            const name  = el.querySelector('.product-card__title, .product__title, h3, h2, .title')?.innerText?.trim();
            const price = el.querySelector('.price, .product-price, .money, [class*="price"]')?.innerText?.trim();
            const img   = el.querySelector('img')?.src;
            const link  = el.querySelector('a')?.href;
            const ratingEl = el.querySelector('[class*="rating"], [class*="stars"], .star-rating');
            const rating = ratingEl?.getAttribute('data-rating') || ratingEl?.innerText?.trim();
            if (name) results.push({ name, price, img, link, rating });
        });
        return results;
    });
    return items;
}
"""

    run_id = run_actor("apify/playwright-scraper", {
        "startUrls": [{"url": u} for _, u in product_urls],
        "pageFunction": page_function,
        "maxRequestsPerCrawl": 20,
    })
    if not wait_for_run(run_id):
        return 0

    items = fetch_results(run_id)

    # build URL → slug map for lookup
    url_to_slug = {url: slug for slug, url in product_urls}

    def parse_price(raw: str) -> float | None:
        if not raw:
            return None
        import re
        m = re.search(r"[\d,]+\.?\d*", raw.replace(",", ""))
        return float(m.group()) if m else None

    rows = []
    for item in items:
        # item has request URL embedded in some scrapers
        source_url = item.get("requestUrl") or item.get("#referrer") or ""
        slug = None
        for u, s in url_to_slug.items():
            if u in source_url:
                slug = s
                break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue

        name = (item.get("name") or "").strip()
        if not name:
            continue

        rows.append({
            "brand_id":     brand_id,
            "name":         name[:300],
            "url":          item.get("link"),
            "price_usd":    parse_price(item.get("price")),
            "currency":     "USD",
            "country_code": "US",
            "avg_rating":   float(item["rating"]) if item.get("rating") else None,
            "in_stock":     True,
        })

    returned = sb_upsert_returning("products", rows, "name,brand_id")
    n = len(returned)
    print(f"  ✓ {n} products upserted")

    # Snapshot to product_price_history for time-series tracking
    history_rows = []
    for r in returned:
        history_rows.append({
            "product_id":   r["id"],
            "brand_id":     r["brand_id"],
            "price_usd":    r.get("price_usd"),
            "sale_price_usd": r.get("sale_price_usd"),
            "discount_pct": r.get("discount_pct"),
            "in_stock":     r.get("in_stock"),
            "stock_count":  r.get("stock_count"),
        })
    if history_rows:
        h = sb_upsert("product_price_history", history_rows, "product_id,captured_at")
        print(f"  ✓ {h} price-history snapshots written")
    return n


# ─── Step 5+6 — Influencers ──────────────────────────────────────────────────

def run_influencers(inf_map: dict[str, dict]) -> tuple[int, int]:
    print("\n[5/5] Influencer posts & follower snapshots")
    active_handles = list(inf_map.keys())

    run_id = run_actor("apify/instagram-profile-scraper", {
        "usernames": active_handles,
        "resultsLimit": 12,
    })
    if not wait_for_run(run_id):
        return 0, 0

    items = fetch_results(run_id)
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    import re
    def extract_hashtags(text: str) -> list[str]:
        return re.findall(r"#(\w+)", text or "")

    posts, snapshots = [], []

    for item in items:
        handle = item.get("username") or item.get("inputUrl", "").split("/")[-1].strip("/")
        info = inf_map.get(handle)
        if not info:
            print(f"  ⚠ No influencer record for handle: {handle!r}")
            continue

        influencer_id = info["influencer_id"]
        brand_id      = info["brand_id"]

        snapshots.append({
            "influencer_id":     influencer_id,
            "brand_id":          brand_id,
            "follower_count_ig": item.get("followersCount"),
            "week_number":       iso_week,
            "year":              iso_year,
        })

        for post in item.get("latestPosts", []):
            shortcode = post.get("shortCode") or post.get("id")
            if not shortcode:
                continue
            caption = (post.get("caption") or "")[:2000]
            posts.append({
                "influencer_id": influencer_id,
                "brand_id":      brand_id,
                "platform":      "instagram",
                "post_url":      f"https://www.instagram.com/p/{shortcode}/",
                "caption":       caption,
                "hashtags":      extract_hashtags(caption),
                "like_count":    post.get("likesCount", 0),
                "comment_count": post.get("commentsCount", 0),
                "view_count":    post.get("videoViewCount", 0),
                "posted_at":     post.get("timestamp"),
            })

    p = sb_upsert("influencer_posts", posts, "post_url")
    s = sb_delete_insert_weekly("influencer_snapshots", snapshots, "week_number", iso_week, iso_year)
    print(f"  ✓ {p} influencer posts, {s} snapshots upserted")
    return p, s


# ─── Step 6 — Homepage promo banner detection ────────────────────────────────

def run_homepage_promos(brand_map: dict[str, str]) -> int:
    print("\n[6/10] Homepage promo banners")

    # Pull brand → website_url from the brands table
    brand_rows = sb_get("brands", "id,slug,website_url")
    homepages = [(r["slug"], r["website_url"]) for r in brand_rows if r.get("website_url")]

    page_function = r"""
async function pageFunction(context) {
    const { page } = context;
    await page.waitForTimeout(3000);
    const result = await page.evaluate(() => {
        const candidates = [];
        // Common promo banner selectors
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
        return 0

    items = fetch_results(run_id)

    import re
    def detect_discount_pct(text: str) -> float | None:
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
            if hp.split("/")[2] in source_url:   # match by domain
                slug = s
                break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue
        for banner_text in item.get("banners", []):
            if not banner_text or len(banner_text) < 5:
                continue
            rows.append({
                "brand_id":     brand_id,
                "banner_text":  banner_text[:1000],
                "promo_type":   classify(banner_text),
                "discount_pct": detect_discount_pct(banner_text),
                "source_url":   source_url,
            })

    n = sb_upsert("promotions", rows, "brand_id,banner_text")
    print(f"  ✓ {n} promo banners detected")
    return n


# ─── Step 7 — Meta Ad Library ────────────────────────────────────────────────

def run_meta_ad_library(brand_map: dict[str, str]) -> int:
    print("\n[7/10] Meta Ad Library")

    actor_id = "apify/facebook-ads-scraper"
    urls = [ad_library_url(fp["page_name"]) for fp in FACEBOOK_PAGES]

    run_id = run_actor(actor_id, {
        "startUrls":      [{"url": u} for u in urls],
        "resultsLimit":   50,
        "activeStatus":   "active",
    })
    if not wait_for_run(run_id, poll_sec=20):
        return 0

    items = fetch_results(run_id)

    # Map page_name (lowercased) → slug for matching the ad's page_name back to a brand
    name_to_slug = {fp["page_name"].lower(): fp["slug"] for fp in FACEBOOK_PAGES}

    rows = []
    for item in items:
        page_name = (item.get("page_name") or item.get("pageName") or "").strip()
        slug = name_to_slug.get(page_name.lower())
        if not slug:
            # try partial match
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
            "brand_id":     brand_id,
            "platform":     "meta",
            "ad_id":        str(ad_id),
            "page_name":    page_name,
            "body":         (item.get("ad_creative_body") or item.get("body") or "")[:2000],
            "cta":          item.get("cta_text") or item.get("cta"),
            "creative_url": item.get("creative_url") or item.get("image_url") or item.get("video_url"),
            "landing_url":  item.get("link_url") or item.get("landing_url"),
            "started_at":   item.get("ad_delivery_start_time") or item.get("started_at"),
            "is_active":    item.get("is_active", True),
            "raw":          item,
        })

    n = sb_upsert("marketing_ads", rows, "platform,ad_id")
    print(f"  ✓ {n} Meta ads upserted")
    return n


# ─── Step 8 — Google Ads Transparency ────────────────────────────────────────

def run_google_ads_transparency(brand_map: dict[str, str]) -> int:
    print("\n[8/10] Google Ads Transparency")

    # Use brand domains as advertisers
    brand_rows = sb_get("brands", "id,slug,website_url")
    domains = []
    for r in brand_rows:
        url = r.get("website_url", "") or ""
        if "://" in url:
            dom = url.split("://")[1].split("/")[0].lstrip("www.")
            domains.append({"slug": r["slug"], "brand_id": r["id"], "domain": dom})

    # solidcode actor takes one searchQuery per run, so loop per brand
    actor_id = "solidcode/ads-transparency-scraper"
    rows = []

    for d in domains:
        try:
            run_id = run_actor(actor_id, {
                "searchQuery": d["domain"],
                "maxResults":  100,
                "region":      "US",
            })
        except Exception as e:
            print(f"  ✗ {d['slug']} ({d['domain']}) start failed: {e}")
            continue

        if not wait_for_run(run_id, poll_sec=20):
            print(f"  ✗ {d['slug']} run did not succeed")
            continue

        items = fetch_results(run_id)
        for item in items:
            ad_id = (item.get("adId") or item.get("ad_id")
                     or item.get("creativeId") or item.get("creative_id")
                     or item.get("id"))
            if not ad_id:
                continue
            rows.append({
                "brand_id":     d["brand_id"],
                "platform":     "google",
                "ad_id":        str(ad_id),
                "page_name":    item.get("advertiserName") or item.get("advertiser") or d["domain"],
                "body":         (item.get("adText") or item.get("description") or item.get("text") or "")[:2000],
                "cta":          item.get("cta"),
                "creative_url": item.get("imageUrl") or item.get("videoUrl") or item.get("creativeUrl") or item.get("preview_image_url"),
                "landing_url":  item.get("destinationUrl") or item.get("landingUrl") or item.get("landing_url"),
                "started_at":   item.get("firstShown") or item.get("startedAt") or item.get("first_shown"),
                "is_active":    item.get("isActive", True),
                "raw":          item,
            })
        print(f"  ✓ {d['slug']}: {len(items)} ads collected")

    n = sb_upsert("marketing_ads", rows, "platform,ad_id")
    print(f"  ✓ {n} Google ads upserted (total)")
    return n


# ─── Step 9 — Instagram comments (on existing posts) ─────────────────────────

def run_ig_comments(brand_map: dict[str, str], top_per_brand: int = 20) -> int:
    print("\n[9/10] Instagram comments")

    # Pull top posts (by likes) per brand from DB
    posts = sb_get("ig_posts",
                   "id,brand_id,instagram_post_id,post_url,like_count")
    if not posts:
        print("  ⚠ No IG posts in DB to scrape comments for")
        return 0

    # Top N per brand by likes
    from collections import defaultdict
    by_brand = defaultdict(list)
    for p in posts:
        by_brand[p["brand_id"]].append(p)
    selected = []
    for brand_id, lst in by_brand.items():
        lst.sort(key=lambda x: x.get("like_count") or 0, reverse=True)
        selected.extend(lst[:top_per_brand])

    # Normalize URLs (strip trailing slash + query) so dedup is robust
    def norm_ig(u: str) -> str:
        return (u or "").split("?")[0].rstrip("/")

    url_to_post = {norm_ig(p["post_url"]): p for p in selected if p.get("post_url")}
    post_urls = list(url_to_post.keys())  # deduplicated

    if not post_urls:
        return 0

    run_id = run_actor("apify/instagram-comment-scraper", {
        "directUrls": post_urls,
        "resultsLimit": 30,
        "includeNestedComments": False,
    })
    if not wait_for_run(run_id, poll_sec=20):
        return 0

    items = fetch_results(run_id)

    rows = []
    for item in items:
        post_url = norm_ig(item.get("postUrl") or item.get("ownerPostUrl") or "")
        post = url_to_post.get(post_url)
        if not post:
            # fallback substring match
            for u, p in url_to_post.items():
                if u in post_url or post_url in u:
                    post = p
                    break
        if not post:
            continue
        rows.append({
            "instagram_comment_id": item.get("id"),
            "post_id":              post["id"],
            "brand_id":             post["brand_id"],
            "commenter_username":   item.get("ownerUsername") or item.get("username"),
            "comment_text":         (item.get("text") or "")[:2000],
            "comment_likes":        item.get("likesCount", 0),
            "posted_at":            item.get("timestamp"),
        })

    n = sb_upsert("ig_comments", rows, "instagram_comment_id")
    print(f"  ✓ {n} IG comments upserted")
    return n


# ─── Step 10 — YouTube comments (on existing videos) ─────────────────────────

def run_yt_comments(brand_map: dict[str, str], top_per_brand: int = 10) -> int:
    print("\n[10/10] YouTube comments")

    videos = sb_get("yt_videos",
                    "id,brand_id,youtube_video_id,video_url,view_count")
    if not videos:
        print("  ⚠ No YT videos in DB to scrape comments for")
        return 0

    from collections import defaultdict
    by_brand = defaultdict(list)
    for v in videos:
        by_brand[v["brand_id"]].append(v)
    selected = []
    for brand_id, lst in by_brand.items():
        lst.sort(key=lambda x: x.get("view_count") or 0, reverse=True)
        selected.extend(lst[:top_per_brand])

    video_urls = [v["video_url"] for v in selected if v.get("video_url")]
    url_to_video = {v["video_url"]: v for v in selected if v.get("video_url")}

    if not video_urls:
        return 0

    run_id = run_actor("streamers/youtube-comments-scraper", {
        "startUrls": [{"url": u} for u in video_urls],
        "maxComments": 50,
    })
    if not wait_for_run(run_id, poll_sec=20):
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
        # Only keep ISO-ish timestamps; skip relative strings like "2 days ago"
        posted_at = item.get("publishedAt")
        if not posted_at:
            pub = item.get("publishedTimeText") or ""
            posted_at = pub if ("T" in pub or "-" in pub[:5]) else None
        rows.append({
            "youtube_comment_id": item.get("commentId") or item.get("id"),
            "video_id":           video["id"],
            "brand_id":           video["brand_id"],
            "commenter_username": item.get("author") or item.get("authorName"),
            "comment_text":       (item.get("text") or item.get("comment") or "")[:2000],
            "comment_likes":      item.get("likeCount") or item.get("likesCount", 0),
            "posted_at":          posted_at,
        })

    n = sb_upsert("yt_comments", rows, "youtube_comment_id")
    print(f"  ✓ {n} YT comments upserted")
    return n


# ─── Step 11 — X (Twitter) profiles + posts ──────────────────────────────────

def load_x_account_map(brand_map: dict[str, str]) -> dict[str, dict]:
    """handle → {account_id, brand_id, slug}"""
    rows = sb_get("x_accounts", "id,brand_id,handle")
    result = {}
    bid_to_slug = {v: k for k, v in brand_map.items()}
    for r in rows:
        result[r["handle"].lower()] = {
            "account_id": r["id"],
            "brand_id":   r["brand_id"],
            "slug":       bid_to_slug.get(r["brand_id"], ""),
            "handle":     r["handle"],
        }
    return result


def run_x_twitter(brand_map: dict[str, str]) -> tuple[int, int]:
    print("\n[11/12] X (Twitter) profiles & posts")

    # Build profile URL list from X_HANDLES
    profile_urls = [
        {"url": f"https://twitter.com/{handle}"}
        for handle in X_HANDLES.values()
    ]
    if not profile_urls:
        print("  ⚠ No X handles configured")
        return 0, 0

    run_id = run_actor("apidojo/twitter-scraper-lite", {
        "startUrls": profile_urls,
        "maxTweets": 20,
    })
    if not wait_for_run(run_id, poll_sec=20):
        return 0, 0

    items = fetch_results(run_id)
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    # Load account map from DB
    x_map = load_x_account_map(brand_map)

    profiles: dict[str, dict] = {}
    posts = []

    for item in items:
        user_name = (item.get("author", {}) or {}).get("userName") or item.get("userName") or ""
        handle_key = user_name.lower()

        # Try to match back to a known slug
        slug = None
        for s, h in X_HANDLES.items():
            if h.lower() == handle_key:
                slug = s
                break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue

        # Profile snapshot (take first occurrence per brand)
        if slug not in profiles:
            author = item.get("author") or item
            profiles[slug] = {
                "brand_id":    brand_id,
                "handle":      user_name,
                "followers":   author.get("followers") or author.get("followersCount", 0),
                "following":   author.get("following") or author.get("friendsCount", 0),
                "tweet_count": author.get("statusesCount") or author.get("tweetCount", 0),
                "is_verified": bool(author.get("isVerified") or author.get("verified", False)),
                "week_number": iso_week,
                "year":        iso_year,
            }

        # Post row
        tweet_id = str(item.get("id") or item.get("tweetId") or "")
        if not tweet_id:
            continue

        text = item.get("text") or item.get("fullText") or ""
        posts.append({
            "brand_id":      brand_id,
            "handle":        user_name,
            "tweet_id":      tweet_id,
            "post_url":      item.get("url") or f"https://twitter.com/{user_name}/status/{tweet_id}",
            "text":          text[:2000],
            "like_count":    item.get("likeCount") or item.get("favoriteCount", 0),
            "retweet_count": item.get("retweetCount", 0),
            "reply_count":   item.get("replyCount", 0),
            "view_count":    item.get("viewCount") or item.get("views", 0),
            "posted_at":     item.get("createdAt"),
        })

    # Upsert profiles (weekly delete-insert) and posts
    profile_rows = list(profiles.values())
    p = sb_delete_insert_weekly("x_profiles_weekly", profile_rows, "week_number", iso_week, iso_year)
    q = sb_upsert("x_posts", posts, "tweet_id")
    print(f"  ✓ {p} X profile snapshots, {q} posts upserted")
    return p, q


# ─── Step 12 — TikTok profiles + videos ──────────────────────────────────────

def load_tiktok_account_map(brand_map: dict[str, str]) -> dict[str, dict]:
    """handle → {account_id, brand_id, slug}"""
    rows = sb_get("tiktok_accounts", "id,brand_id,handle")
    bid_to_slug = {v: k for k, v in brand_map.items()}
    return {
        r["handle"].lower(): {
            "account_id": r["id"],
            "brand_id":   r["brand_id"],
            "slug":       bid_to_slug.get(r["brand_id"], ""),
            "handle":     r["handle"],
        }
        for r in rows
    }


def run_tiktok(brand_map: dict[str, str]) -> tuple[int, int]:
    print("\n[12/12] TikTok profiles & videos")

    profile_urls = [
        f"https://www.tiktok.com/@{handle}"
        for handle in TIKTOK_HANDLES.values()
    ]
    if not profile_urls:
        print("  ⚠ No TikTok handles configured")
        return 0, 0

    run_id = run_actor("clockworks/tiktok-scraper", {
        "startUrls": profile_urls,
        "type":      "user",
        "maxItems":  25,
    })
    if not wait_for_run(run_id, poll_sec=20):
        return 0, 0

    items = fetch_results(run_id)
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()

    profiles: dict[str, dict] = {}
    videos = []

    for item in items:
        author_meta = item.get("authorMeta") or {}
        handle_raw  = author_meta.get("name") or item.get("authorUniqueId") or ""
        handle_key  = handle_raw.lower()

        # Match back to a known slug
        slug = None
        for s, h in TIKTOK_HANDLES.items():
            if h.lower() == handle_key:
                slug = s
                break
        brand_id = brand_map.get(slug) if slug else None
        if not brand_id:
            continue

        # Profile snapshot
        if slug not in profiles:
            profiles[slug] = {
                "brand_id":    brand_id,
                "handle":      handle_raw,
                "followers":   author_meta.get("fans") or author_meta.get("followerCount", 0),
                "following":   author_meta.get("following", 0),
                "video_count": author_meta.get("video") or author_meta.get("videoCount", 0),
                "total_hearts": author_meta.get("heart") or author_meta.get("heartCount", 0),
                "is_verified": bool(author_meta.get("verified", False)),
                "week_number": iso_week,
                "year":        iso_year,
            }

        # Video row
        video_id = str(item.get("id") or "")
        if not video_id:
            continue

        create_time = item.get("createTime") or item.get("createTimeISO")
        posted_at = None
        if create_time:
            if isinstance(create_time, int):
                posted_at = datetime.utcfromtimestamp(create_time).isoformat()
            else:
                posted_at = str(create_time)

        videos.append({
            "brand_id":        brand_id,
            "handle":          handle_raw,
            "tiktok_video_id": video_id,
            "video_url":       item.get("webVideoUrl") or f"https://www.tiktok.com/@{handle_raw}/video/{video_id}",
            "text":            (item.get("text") or item.get("desc") or "")[:2000],
            "view_count":      item.get("playCount") or item.get("stats", {}).get("playCount", 0),
            "like_count":      item.get("diggCount") or item.get("stats", {}).get("diggCount", 0),
            "comment_count":   item.get("commentCount") or item.get("stats", {}).get("commentCount", 0),
            "share_count":     item.get("shareCount") or item.get("stats", {}).get("shareCount", 0),
            "duration_seconds": (item.get("videoMeta") or {}).get("duration") or item.get("duration"),
            "thumbnail_url":   (item.get("videoMeta") or {}).get("coverUrl") or item.get("thumbnailUrl"),
            "posted_at":       posted_at,
        })

    profile_rows = list(profiles.values())
    p = sb_delete_insert_weekly("tiktok_profiles_weekly", profile_rows, "week_number", iso_week, iso_year)
    q = sb_upsert("tiktok_videos", videos, "tiktok_video_id")
    print(f"  ✓ {p} TikTok profile snapshots, {q} videos upserted")
    return p, q


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("JOOLA Intel — Apify → Supabase")
    print(f"Week start: {week_start()}")
    print("=" * 55)

    print("\nLoading lookup maps from Supabase...")
    brand_map  = load_brand_map()
    ig_map     = load_ig_account_map()
    yt_map     = load_yt_channel_map()
    inf_map    = load_influencer_map()
    print(f"  {len(brand_map)} brands, {len(ig_map)} IG accounts, "
          f"{len(yt_map)} YT channels, {len(inf_map)} influencers loaded")

    ig_profiles, ig_posts = run_instagram_brands(ig_map)
    yt_channels, yt_videos = run_youtube(yt_map)
    reddit_rows = run_reddit(brand_map)
    product_rows = run_products(brand_map)
    inf_posts, inf_snaps = run_influencers(inf_map)

    # New Particl-style steps (run once)
    promo_rows  = run_homepage_promos(brand_map)
    meta_ads    = run_meta_ad_library(brand_map)
    google_ads  = run_google_ads_transparency(brand_map)
    ig_cmt      = run_ig_comments(brand_map)
    yt_cmt      = run_yt_comments(brand_map)
    x_profiles, x_posts   = run_x_twitter(brand_map)
    tt_profiles, tt_videos = run_tiktok(brand_map)

    print("\n" + "=" * 55)
    print("Done.")
    print(f"  IG profiles:        {ig_profiles}")
    print(f"  IG posts:           {ig_posts}")
    print(f"  YT channel snaps:   {yt_channels}")
    print(f"  YT videos:          {yt_videos}")
    print(f"  Reddit mentions:    {reddit_rows}")
    print(f"  Products:           {product_rows}")
    print(f"  Influencer posts:   {inf_posts}")
    print(f"  Influencer snaps:   {inf_snaps}")
    print(f"  Promo banners:      {promo_rows}")
    print(f"  Meta ads:           {meta_ads}")
    print(f"  Google ads:         {google_ads}")
    print(f"  IG comments:        {ig_cmt}")
    print(f"  YT comments:        {yt_cmt}")
    print(f"  X profiles:         {x_profiles}")
    print(f"  X posts:            {x_posts}")
    print(f"  TikTok profiles:    {tt_profiles}")
    print(f"  TikTok videos:      {tt_videos}")
    print("=" * 55)


if __name__ == "__main__":
    main()
