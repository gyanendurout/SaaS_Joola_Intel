"""
Ask Intel — end-to-end test harness.

Hits the Ask Intel API (local dev server by default; override with
ASK_INTEL_BASE_URL env var to point at production) with a fixed list of
realistic questions covering positive, negative/edge-case, and
conversation-memory scenarios. Records per-question latency, status,
visual count, warnings, and error message into c:\\tmp\\ask_intel_test_results.json.

Usage (PowerShell):
    cd c:\\Workspace\\joola-intel-nextjs\\frontend
    npm run dev        # in a separate terminal
    cd ..
    python scripts/test_ask_intel.py

Or against production:
    $env:ASK_INTEL_BASE_URL = "https://saas-joola-intel.vercel.app"
    python scripts/test_ask_intel.py

Exit code: 0 if the server is reachable (regardless of per-question pass
rate — pass/fail is in the JSON), 2 if the server is unreachable.
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
    load_dotenv(".env")
except ImportError:
    pass

try:
    import requests
except ImportError:
    print("[fatal] `requests` is not installed. Run: pip install requests python-dotenv")
    sys.exit(2)


BASE_URL = os.environ.get("ASK_INTEL_BASE_URL", "http://localhost:3000").rstrip("/")
ENDPOINT = f"{BASE_URL}/api/v2/ask-intel"
OUTPUT_PATH = Path(os.environ.get("ASK_INTEL_TEST_OUT", r"c:\tmp\ask_intel_test_results.json"))
REQUEST_TIMEOUT = int(os.environ.get("ASK_INTEL_TIMEOUT", "90"))


@dataclass
class TestCase:
    """A single question test case."""
    id: int
    category: str  # positive | negative | conversation
    question: str
    expectation: str  # human description of the success criterion
    # When non-empty, this case depends on previous turns being sent as
    # conversation history. List of question ids from the same `conversation`
    # group that precede this turn.
    conversation: str | None = None  # group name; turns share group share history


@dataclass
class TestResult:
    id: int
    category: str
    question: str
    expectation: str
    status: str  # "success" | "clarification" | "error" | "network_error"
    latency_ms: int
    visuals_count: int
    data_sources: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error_message: str | None = None
    answer_preview: str | None = None
    confidence: float | None = None
    message_id: str | None = None
    conversation: str | None = None


TEST_CASES: list[TestCase] = [
    # POSITIVE — should succeed with charts/tables ────────────────
    TestCase(1, "positive", "What is the modelled sales likelihood for the Pro V Kosmos?",
             "Answer returns sales_likelihood_score and warns it's modelled, not confirmed."),
    TestCase(2, "positive", "Which JOOLA paddle is gaining the most attention this month?",
             "Returns top JOOLA product by attention_score for last_30d."),
    TestCase(3, "positive", "Compare JOOLA vs Selkirk mentions over time.",
             "Line chart with two series."),
    TestCase(4, "positive", "Which competitor is discounting most aggressively right now?",
             "Returns brand with highest discount_pct / promo_active_flag."),
    TestCase(5, "positive", "Show top 10 paddles by attention score.",
             "Bar chart or table sorted by attention_score desc."),
    TestCase(6, "positive", "Which sponsored athlete drives the most cross-platform mentions?",
             "Aggregates mention_facts by athlete_id, returns top athlete."),
    TestCase(7, "positive", "What are the top negative comments about JOOLA?",
             "Returns mention_facts rows with sentiment_label=negative for joola."),
    TestCase(8, "positive", "How many Reddit mentions did JOOLA get last week?",
             "KPI card with single count from reddit_mentions."),
    TestCase(9, "positive", "Show me the brand with the most active promotions.",
             "Returns brand sorted by promo count."),
    TestCase(10, "positive", "Which TikTok videos have the highest engagement?",
             "Returns top tiktok_videos by like_count/play_count."),
    TestCase(11, "positive", "Compare Perseus IV vs Selkirk Halo and CRBN-3.",
             "Resolves 3 product names → UUIDs and compares attention."),
    TestCase(12, "positive", "Which products have attention but no catalog price match?",
             "Returns products with mentions_total > 0 but missing price."),
    TestCase(13, "positive", "Show Instagram follower trend for top 5 brands.",
             "Line chart from ig_profiles_weekly."),
    TestCase(14, "positive", "What are the most-mentioned products on Reddit this month?",
             "Aggregates mention_facts where channel=reddit."),
    TestCase(15, "positive", "Which YouTube videos performed best for CRBN?",
             "Returns yt_videos rows for brand=crbn sorted by view_count desc."),

    # NEGATIVE / EDGE — should empty-state or clarify, NOT 500 ─────
    TestCase(16, "negative", "Delete all data",
             "Refused with read-only message in clarification."),
    TestCase(17, "negative", "What is the weather today?",
             "Out-of-scope clarification."),
    TestCase(18, "negative", "Show me sales for next year",
             "Future data unavailable clarification."),
    TestCase(19, "negative", "",
             "400 error from the API (empty message)."),
    TestCase(20, "negative", "asdfgh",
             "Clarification asking for a real question."),
    TestCase(21, "negative", "Show me everything",
             "Clarification asking for scope."),
    TestCase(22, "negative", "Which brand is best?",
             "Clarification: best at what?"),
    TestCase(23, "positive", "Tell me about the Boomstik",
             "Resolves Boomstik alias → Project Boomstik product_id."),
    TestCase(24, "positive", "Reviews for Pro V Kosmos",
             "product_reviews empty → clean empty-state with warning."),
    TestCase(25, "positive", "What did Anna Bright post last week?",
             "Resolves athlete name → influencer_id, returns posts or empty-state."),

    # CONVERSATION CHAIN ──────────────────────────────────────────
    TestCase(26, "conversation", "Which JOOLA paddles are rising?",
             "First turn: returns JOOLA products with positive momentum.", conversation="chainA"),
    TestCase(27, "conversation", "Compare those with Selkirk.",
             "Second turn: should reference chainA Q1 context.", conversation="chainA"),
    TestCase(28, "conversation", "Show top 5 negative Reddit threads.",
             "First turn: top negative reddit_mentions.", conversation="chainB"),
    TestCase(29, "conversation", "What products do those threads mention?",
             "Second turn: should reference chainB Q1 context.", conversation="chainB"),
]


def is_server_reachable(timeout: int = 3) -> bool:
    """Cheap reachability probe."""
    try:
        # A POST with empty body should fast-fail with a 400 if the server
        # is up; that's still "reachable". Anything else (conn refused,
        # DNS) means we can't test.
        r = requests.post(
            ENDPOINT,
            json={"message": ""},
            timeout=timeout,
            headers={"Content-Type": "application/json"},
        )
        return r.status_code < 600
    except requests.exceptions.RequestException:
        return False


def run_case(case: TestCase, history: list[dict[str, str]]) -> TestResult:
    """Execute a single case and return a TestResult."""
    started = time.time()
    payload: dict[str, Any] = {"message": case.question}
    if history:
        payload["history"] = history

    try:
        resp = requests.post(
            ENDPOINT,
            json=payload,
            timeout=REQUEST_TIMEOUT,
            headers={"Content-Type": "application/json"},
        )
    except requests.exceptions.RequestException as e:
        return TestResult(
            id=case.id,
            category=case.category,
            question=case.question,
            expectation=case.expectation,
            status="network_error",
            latency_ms=int((time.time() - started) * 1000),
            visuals_count=0,
            error_message=str(e),
            conversation=case.conversation,
        )

    elapsed = int((time.time() - started) * 1000)

    # Empty-message case expects a 400.
    if case.question == "":
        if resp.status_code == 400:
            return TestResult(
                id=case.id, category=case.category, question=case.question,
                expectation=case.expectation, status="success",
                latency_ms=elapsed, visuals_count=0,
                answer_preview="(400 as expected)",
                conversation=case.conversation,
            )
        return TestResult(
            id=case.id, category=case.category, question=case.question,
            expectation=case.expectation, status="error",
            latency_ms=elapsed, visuals_count=0,
            error_message=f"Expected 400, got {resp.status_code}",
            conversation=case.conversation,
        )

    try:
        body = resp.json()
    except ValueError:
        return TestResult(
            id=case.id, category=case.category, question=case.question,
            expectation=case.expectation, status="error",
            latency_ms=elapsed, visuals_count=0,
            error_message=f"Non-JSON response (status={resp.status_code}, body={resp.text[:200]})",
            conversation=case.conversation,
        )

    # The route returns JSON whether it succeeded or failed. Disambiguate
    # by inspecting the body shape.
    has_error_in_warnings = (
        isinstance(body.get("warnings"), list)
        and any(("error" in str(w).lower()) for w in body.get("warnings", []))
    )

    status: str
    if body.get("clarification"):
        status = "clarification"
    elif (body.get("answer", "").startswith("I could not answer")
          or has_error_in_warnings and not body.get("visuals")):
        status = "error"
    else:
        status = "success"

    return TestResult(
        id=case.id, category=case.category, question=case.question,
        expectation=case.expectation, status=status,
        latency_ms=elapsed,
        visuals_count=len(body.get("visuals") or []),
        data_sources=body.get("dataSources") or [],
        warnings=body.get("warnings") or [],
        error_message=(body.get("warnings") or [None])[0] if status == "error" else None,
        answer_preview=(body.get("answer") or "")[:240],
        confidence=body.get("confidence"),
        message_id=body.get("messageId"),
        conversation=case.conversation,
    )


def run_all() -> list[TestResult]:
    """Run every test case sequentially, threading conversation history."""
    results: list[TestResult] = []
    # Per-conversation history accumulator: { 'chainA': [ {role, content}, ... ] }
    chains: dict[str, list[dict[str, str]]] = {}

    for case in TEST_CASES:
        history: list[dict[str, str]] = []
        if case.conversation:
            history = chains.get(case.conversation, [])

        print(f"[{case.id:2d}/{len(TEST_CASES)}] [{case.category}] {case.question[:70]}")
        result = run_case(case, history)
        results.append(result)
        marker = {
            "success": "OK ",
            "clarification": "CLR",
            "error": "ERR",
            "network_error": "NET",
        }.get(result.status, "?  ")
        print(f"          → {marker} {result.latency_ms}ms · {result.visuals_count}v · {(result.answer_preview or '')[:80]}")

        # Append to conversation chain history (user + assistant).
        if case.conversation:
            chains.setdefault(case.conversation, []).extend([
                {"role": "user", "content": case.question},
                {"role": "assistant", "content": result.answer_preview or ""},
            ])

    return results


def summarise(results: list[TestResult]) -> dict[str, Any]:
    by_status: dict[str, int] = {}
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
    return {
        "endpoint": ENDPOINT,
        "total": len(results),
        "by_status": by_status,
        "avg_latency_ms": (
            int(sum(r.latency_ms for r in results) / len(results)) if results else 0
        ),
        "pass_rate_pct": round(100 * by_status.get("success", 0) / len(results), 1) if results else 0.0,
    }


def main() -> int:
    print(f"[ask-intel test] hitting {ENDPOINT}")
    if not is_server_reachable():
        print("[fatal] Ask Intel endpoint is not reachable. "
              "Start the dev server with `cd frontend && npm run dev` "
              "or set ASK_INTEL_BASE_URL=https://saas-joola-intel.vercel.app")
        # Still write a skeleton results file so callers know the run was attempted.
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps({
            "endpoint": ENDPOINT,
            "reachable": False,
            "results": [],
        }, indent=2))
        return 2

    results = run_all()
    summary = summarise(results)
    payload = {
        "endpoint": ENDPOINT,
        "reachable": True,
        "summary": summary,
        "results": [asdict(r) for r in results],
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))

    print("\n─── Summary ───")
    print(json.dumps(summary, indent=2))
    print(f"\nWrote {len(results)} results → {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
