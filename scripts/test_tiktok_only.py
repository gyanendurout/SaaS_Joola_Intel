"""
Standalone TikTok scraper test — runs ONLY the TikTok step from the main
pipeline so we can validate the fix in isolation (without burning 90 min of
the full pipeline).

Run: python scripts/test_tiktok_only.py
"""

import os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Import functions from the main pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_to_supabase import (
    load_brand_map, run_tiktok,
)

if __name__ == "__main__":
    print("=" * 55, flush=True)
    print("TikTok isolation test", flush=True)
    print("=" * 55, flush=True)
    brand_map = load_brand_map()
    print(f"Loaded {len(brand_map)} brands", flush=True)
    p, q = run_tiktok(brand_map)
    print(f"\nResult: {p} profile snapshots, {q} videos", flush=True)
