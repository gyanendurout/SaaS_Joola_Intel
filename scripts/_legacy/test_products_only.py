"""Standalone re-run of the products scraper now that migration 008 is applied."""
import os, sys
try: sys.stdout.reconfigure(encoding="utf-8")
except: pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_to_supabase import load_brand_map, run_products

if __name__ == "__main__":
    print("=" * 55, flush=True)
    print("Products-only re-run (post-migration 008)", flush=True)
    print("=" * 55, flush=True)
    brand_map = load_brand_map()
    n = run_products(brand_map)
    print(f"\nResult: {n} products upserted", flush=True)
