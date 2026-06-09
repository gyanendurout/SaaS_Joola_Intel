"""Fix corrupted product prices in products_catalog.

Root cause: _parse_price() treated European-format commas (decimal separator)
as thousands separators, storing prices 100x–1000x too large.
Example: "$280,20" → "28020" → $28020 instead of $280.20

Run:  python scripts/fix_product_prices.py
Requires: SUPABASE_SERVICE_ROLE_KEY in environment or scripts/.env
"""
import os, sys

try:
    from dotenv import load_dotenv
    load_dotenv()
    load_dotenv("scripts/.env")
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY not set. Add it to scripts/.env and retry.")
    sys.exit(1)

import urllib.request, json

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def req(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f"{SUPABASE_URL}/rest/v1{path}", data=data, headers=HEADERS, method=method)
    resp = urllib.request.urlopen(r)
    return json.loads(resp.read())

# Fetch products with price > $1000 (almost certainly stored in milli-dollars)
rows = req("GET", "/products_catalog?select=id,name,price_usd,sale_price_usd&price_usd=gt.1000&limit=500")
print(f"Found {len(rows)} products with price_usd > $1000")

fixed = 0
for r in rows:
    orig = r["price_usd"]
    corrected = round(float(orig) / 1000, 2)
    sale_orig = r.get("sale_price_usd")
    sale_corrected = round(float(sale_orig) / 1000, 2) if sale_orig and float(sale_orig) > 1000 else sale_orig
    print(f"  {str(r['name'])[:45]:45s}  ${orig} → ${corrected:.2f}")
    req("PATCH", f"/products_catalog?id=eq.{r['id']}",
        {"price_usd": corrected, "sale_price_usd": sale_corrected})
    fixed += 1

print(f"\n✓ Fixed {fixed} products")

# Also fix sale prices that are > 1000 but didn't have price_usd > 1000
sale_rows = req("GET", "/products_catalog?select=id,name,sale_price_usd&sale_price_usd=gt.1000&limit=200")
for r in sale_rows:
    if float(r["sale_price_usd"]) > 1000:
        corrected = round(float(r["sale_price_usd"]) / 1000, 2)
        req("PATCH", f"/products_catalog?id=eq.{r['id']}", {"sale_price_usd": corrected})
        fixed += 1

print(f"✓ Total fixed: {fixed} records")
print("\nNext step: re-run the product catalog scraper to refresh with corrected parser.")
