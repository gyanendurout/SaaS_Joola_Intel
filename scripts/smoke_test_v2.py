"""
HTTP smoke test for the V2 dashboard. Walks every page, measures load time,
checks status code, looks for common failure signatures in HTML.

Run AFTER starting `npm run dev`.
Run: python scripts/smoke_test_v2.py
"""

import time, sys, json, re
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import urllib.request as urlreq

BASE = "http://localhost:3002"

PAGES = [
    "/v2",
    "/v2/instagram",
    "/v2/youtube",
    "/v2/reddit",
    "/v2/comments",
    "/v2/influencers",
    "/v2/ads",
    "/v2/promotions",
    "/v2/products",
    "/v2/market",
    "/v2/twitter",
    "/v2/tiktok",
]

# Deleted in recent UI cleanup — these should now 404
DELETED = [
    "/v2/content-brief",
    "/v2/seo",
]


def fetch(path: str) -> tuple[int, float, str]:
    """Return (status, elapsed_seconds, body_text)."""
    url = BASE + path
    t0 = time.time()
    try:
        req = urlreq.Request(url, headers={
            "User-Agent": "JOOLAIntel-SmokeTest/1.0",
            "Accept": "text/html,application/xhtml+xml",
        })
        with urlreq.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", errors="replace")
            return r.status, time.time() - t0, body
    except urlreq.HTTPError as e:
        return e.code, time.time() - t0, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, time.time() - t0, f"EXCEPTION: {e}"


def analyze(path: str, status: int, elapsed: float, body: str) -> dict:
    """Inspect the HTML for common bug signatures."""
    findings = []

    # Status check
    expected_404 = path in DELETED
    if expected_404 and status != 404:
        findings.append(f"❌ Expected 404 (deleted page), got {status}")
    elif not expected_404 and status != 200:
        findings.append(f"❌ Got status {status}")

    # Load time bands
    if elapsed > 8:
        findings.append(f"🐢 Very slow load: {elapsed:.1f}s")
    elif elapsed > 4:
        findings.append(f"⏱  Slow load: {elapsed:.1f}s")

    if status == 200:
        # Error signatures
        if "Error: " in body and "Internal Server Error" in body:
            findings.append("❌ Internal server error in HTML")
        if "Application error" in body:
            findings.append("❌ Next.js application error overlay")
        if re.search(r"\bundefined\s*(?:%|users|posts|videos|tweets|comments)", body, re.I):
            findings.append("⚠ 'undefined' text visible in body (likely null data)")
        if "NaN" in body:
            findings.append("⚠ 'NaN' visible in body (numeric formatting bug)")

        # Sidebar present
        if "<aside" not in body and "sidebar" not in body.lower():
            findings.append("❌ Sidebar (<aside>) missing")
        # Brand filter dropdown
        if "topbar" not in body.lower() and "brandfilter" not in body.lower():
            findings.append("⚠ Top-bar / brand filter not detected in HTML")
        # PageHead present
        if "<h1" not in body:
            findings.append("⚠ No <h1> on page")
        # Title set
        title_match = re.search(r"<title>([^<]+)</title>", body, re.I)
        title = title_match.group(1).strip() if title_match else ""
        if not title or title.lower() == "create next app":
            findings.append(f"⚠ Missing or default <title>: '{title}'")

        # Size
        kb = len(body) / 1024
        if kb < 5:
            findings.append(f"⚠ Tiny response: {kb:.1f}KB — page may have failed to render")

    return {
        "path":        path,
        "status":      status,
        "elapsed_sec": round(elapsed, 2),
        "size_kb":     round(len(body) / 1024, 1),
        "findings":    findings,
    }


def main():
    print("=" * 70)
    print(f"JOOLA Intel V2 — HTTP Smoke Test ({BASE})")
    print("=" * 70)

    results = []
    for path in PAGES + DELETED:
        status, elapsed, body = fetch(path)
        result = analyze(path, status, elapsed, body)
        results.append(result)
        marker = "✅" if not result["findings"] else "⚠"
        print(f"  {marker} {path:25} {status:3}  {elapsed:5.2f}s  {result['size_kb']:6.1f}KB")
        for f in result["findings"]:
            print(f"        └─ {f}")

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total = len(results)
    ok = sum(1 for r in results if not r["findings"])
    print(f"  Pages tested        : {total}")
    print(f"  Clean (no findings) : {ok}")
    print(f"  With findings       : {total - ok}")

    median_sec = sorted([r["elapsed_sec"] for r in results])[len(results)//2]
    max_sec    = max(r["elapsed_sec"] for r in results)
    print(f"  Median load time    : {median_sec:.2f}s")
    print(f"  Max load time       : {max_sec:.2f}s")

    # Write JSON for downstream analysis
    out = "scripts/smoke_test_v2_results.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2)
    print(f"\n  Detailed JSON: {out}")


if __name__ == "__main__":
    main()
