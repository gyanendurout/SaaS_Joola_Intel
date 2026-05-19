"""
Resume the Apify→Supabase pipeline from step 4 onwards.
Used after the earlier run crashed at step 4 (products) due to a rating-
parse bug. Steps 1-3 (IG, YT, Reddit) already populated their tables
this run — re-running them would just rescrape the same week's data and
waste Apify credit.

Run: python scripts/resume_pipeline.py
"""

import os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_to_supabase import (
    load_brand_map, load_ig_account_map, load_yt_channel_map,
    load_influencer_map, _safe_step,
    run_products, run_influencers, run_homepage_promos,
    run_meta_ad_library, run_google_ads_transparency,
    run_ig_comments, run_yt_comments, run_x_twitter, run_tiktok,
    run_x_influencers, week_start,
)


def unpack(result, default=(0, 0)):
    return result if isinstance(result, tuple) else default


def main():
    print("=" * 55, flush=True)
    print("JOOLA Intel — RESUME (steps 4-13 only)", flush=True)
    print(f"Week start: {week_start()}", flush=True)
    print("=" * 55, flush=True)

    print("\nLoading lookup maps from Supabase...", flush=True)
    brand_map  = load_brand_map()
    ig_map     = load_ig_account_map()
    yt_map     = load_yt_channel_map()
    inf_map    = load_influencer_map()
    print(f"  {len(brand_map)} brands, {len(ig_map)} IG, {len(yt_map)} YT, "
          f"{len(inf_map)} influencers", flush=True)

    product_rows            = _safe_step("products",         run_products, brand_map) or 0
    inf_posts, inf_snaps    = unpack(_safe_step("influencers", run_influencers, inf_map))
    promo_rows  = _safe_step("homepage_promos", run_homepage_promos, brand_map) or 0
    meta_ads    = _safe_step("meta_ads",        run_meta_ad_library, brand_map) or 0
    google_ads  = _safe_step("google_ads",      run_google_ads_transparency, brand_map) or 0
    ig_cmt      = _safe_step("ig_comments",     run_ig_comments, brand_map) or 0
    yt_cmt      = _safe_step("yt_comments",     run_yt_comments, brand_map) or 0
    x_profiles, x_posts       = unpack(_safe_step("x_twitter",     run_x_twitter, brand_map))
    tt_profiles, tt_videos    = unpack(_safe_step("tiktok",        run_tiktok, brand_map))
    inf_x_snaps, inf_x_posts  = unpack(_safe_step("x_influencers", run_x_influencers, brand_map))

    print("\n" + "=" * 55, flush=True)
    print("Resume Done.", flush=True)
    print(f"  Products:           {product_rows}", flush=True)
    print(f"  Influencer posts:   {inf_posts}", flush=True)
    print(f"  Influencer snaps:   {inf_snaps}", flush=True)
    print(f"  Promo banners:      {promo_rows}", flush=True)
    print(f"  Meta ads:           {meta_ads}", flush=True)
    print(f"  Google ads:         {google_ads}", flush=True)
    print(f"  IG comments:        {ig_cmt}", flush=True)
    print(f"  YT comments:        {yt_cmt}", flush=True)
    print(f"  X profiles:         {x_profiles}", flush=True)
    print(f"  X posts:            {x_posts}", flush=True)
    print(f"  TikTok profiles:    {tt_profiles}", flush=True)
    print(f"  TikTok videos:      {tt_videos}", flush=True)
    print(f"  Influencer X snaps: {inf_x_snaps}", flush=True)
    print(f"  Influencer X posts: {inf_x_posts}", flush=True)
    print("=" * 55, flush=True)


if __name__ == "__main__":
    main()
