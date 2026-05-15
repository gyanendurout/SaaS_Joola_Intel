"""Count rows in every active table to show current state."""
import os, requests
try:
    from dotenv import load_dotenv
    load_dotenv(); load_dotenv("scripts/.env")
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TABLES = [
    "brands", "ig_accounts", "ig_profiles_weekly", "ig_posts", "ig_comments",
    "yt_channels", "yt_channel_weekly", "yt_videos", "yt_comments",
    "reddit_mentions", "products", "product_price_history",
    "influencers", "influencer_posts", "influencer_snapshots",
    "promotions", "marketing_ads",
]

for t in TABLES:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{t}?select=*",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "count=exact",
            "Range": "0-0",
        },
        timeout=20,
    )
    cr = r.headers.get("content-range", "?/?")
    total = cr.split("/")[-1] if "/" in cr else "?"
    status = "ok" if r.status_code in (200, 206) else f"err{r.status_code}"
    print(f"  {t:<28} {total:>10}  [{status}]")
