"""Supabase HTTP client with retry and batching."""

from __future__ import annotations

import re
import time
from typing import Any

import requests

from .errors import SupabaseError
from .logger import get_logger
from .network import http_request
from .settings import require_supabase

log = get_logger("supabase")

_url: str = ""
_key: str = ""
_headers: dict[str, str] = {}

# Columns the live DB is missing, discovered at runtime via PGRST204.
# Populated by _strip_missing_column(); surfaced in the run summary so a
# schema gap can never pass as a clean run. Keyed by table name.
SCHEMA_GAPS: dict[str, set[str]] = {}

# Same idea, read side: columns a *select list* asked for that the DB doesn't
# have. Kept separate from SCHEMA_GAPS because the consequence differs — a write
# gap means data we held was dropped, a read gap means a field was never read
# and whatever derives from it is empty or zero.
SCHEMA_GAPS_READ: dict[str, set[str]] = {}

_PGRST204_COL = re.compile(r"Could not find the '([^']+)' column of '([^']+)'")
_PG42703_COL = re.compile(r'column (?:[\w]+\.)?"?([\w]+)"? does not exist')


def _strip_missing_column(table: str, rows: list[dict[str, Any]],
                          body: str) -> str | None:
    """PGRST204 means the payload names a column the DB doesn't have —
    almost always an unapplied migration.

    Rather than drop the whole batch (which is how ig_comments lost every
    row on 2026-08-14), remove just the offending key and let the rest of
    the data land. Returns the stripped column name, or None if the error
    wasn't a recognisable PGRST204.

    This is deliberately LOUD: the gap is logged as an error every time and
    recorded in SCHEMA_GAPS for the end-of-run report. It is a stopgap that
    keeps a 5-hour pipeline productive, NOT a substitute for the migration.
    """
    m = _PGRST204_COL.search(body)
    if not m:
        return None
    col = m.group(1)
    if not any(col in r for r in rows):
        return None
    for r in rows:
        r.pop(col, None)
    # Log once per (table, column), not once per batch — a 5,000-row insert
    # would otherwise emit the same error ten times and bury everything else.
    # The end-of-run SCHEMA GAPS block is what guarantees it stays visible.
    first_time = col not in SCHEMA_GAPS.get(table, set())
    SCHEMA_GAPS.setdefault(table, set()).add(col)
    if first_time:
        log.error(
            "SCHEMA GAP: %s.%s does not exist in the live database. Stripping the "
            "column and retrying so the rest of the row still lands. FIX: apply the "
            "migration that adds it, then re-run this module to backfill %s.",
            table, col, col,
        )
    return col


def _strip_missing_select_column(table: str, select: str,
                                body: str) -> str | None:
    """Read-side twin of _strip_missing_column().

    Postgres 42703 on a GET means the select list names a column the DB doesn't
    have. PostgREST rejects the whole request, so one stale name turns the entire
    fetch into an empty result. That is exactly how facts.mentions reported
    "0 facts" for five of ten channels on 2026-08-17 — a total failure that
    logged as a warning and still marked the step `done`.

    Drop just the offending column from the select so the rest of the row still
    comes back. Returns the stripped column, or None when the error isn't a 42703
    naming a column we can actually remove (e.g. `select=*`, or the last column).
    """
    m = _PG42703_COL.search(body)
    if not m:
        return None
    col = m.group(1)
    cols = [c.strip() for c in select.split(",") if c.strip()]
    if col not in cols or len(cols) <= 1:
        return None
    first_time = col not in SCHEMA_GAPS_READ.get(table, set())
    SCHEMA_GAPS_READ.setdefault(table, set()).add(col)
    if first_time:
        log.error(
            "SCHEMA GAP (read): %s.%s does not exist in the live database. Dropping "
            "it from the select so the remaining columns still load — anything "
            "derived from %s is empty/zero until this is resolved. FIX: apply the "
            "migration that adds it, or correct the column name in the caller.",
            table, col, col,
        )
    return col


def _select_without(select: str, col: str) -> str:
    return ",".join(c.strip() for c in select.split(",")
                    if c.strip() and c.strip() != col)


def _get_tolerating_read_gaps(table: str, select: str, url_suffix: str,
                              hdrs: dict[str, str], timeout: int) -> list[dict]:
    """GET, retrying with the offending column removed on each 42703."""
    attempt = select
    while True:
        url = f"{_url}/rest/v1/{table}?select={attempt}{url_suffix}"
        resp = http_request("GET", url, headers=hdrs, timeout=timeout)
        if resp.status_code == 200:
            return resp.json()
        col = _strip_missing_select_column(table, attempt, resp.text)
        if not col:
            raise SupabaseError(f"GET {table} → {resp.status_code}: {resp.text[:300]}")
        attempt = _select_without(attempt, col)


def _init() -> None:
    global _url, _key, _headers
    if _url:
        return
    _url, _key = require_supabase()
    _headers = {
        "apikey": _key,
        "Authorization": f"Bearer {_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def get(table: str, select: str = "*", params: dict[str, str] | None = None) -> list[dict]:
    _init()
    suffix = ""
    if params:
        suffix = "&" + "&".join(f"{k}=eq.{v}" for k, v in params.items())
    hdrs = {k: v for k, v in _headers.items() if k != "Prefer"}
    return _get_tolerating_read_gaps(table, select, suffix, hdrs, timeout=15)


def get_filtered(table: str, select: str, filters: str) -> list[dict]:
    """E.g. filters='enriched_at=is.null&limit=500'"""
    _init()
    hdrs = {k: v for k, v in _headers.items() if k != "Prefer"}
    return _get_tolerating_read_gaps(table, select, f"&{filters}", hdrs, timeout=60)


# PostgREST rejects a bulk POST whose objects do not all carry an identical key
# set: 400 PGRST102 "All object keys must match". The rejection takes the WHOLE
# array with it, so one row with an extra key loses every row in the batch.
_BATCH_SIZE = 500


def _uniform_batches(table: str, rows: list[dict[str, Any]],
                     size: int = _BATCH_SIZE) -> list[list[dict[str, Any]]]:
    """Split rows into POST-able batches whose objects all share one key set.

    This is the guard for PGRST102 "All object keys must match". On 2026-09-12
    the ads module threw away 822 freshly scraped creatives to it -- 168 Meta
    and 654 Google rows, 0 written, Apify credits already spent -- because the
    row builders emitted only the keys that happened to carry a value, so one
    ad with no CTA gave the batch a second key set.

    Rows are GROUPED by key set rather than padded out to the key union with
    None. Padding reads tidier and is one line, but it is not semantics
    preserving and would quietly corrupt tables:

      * under ``Prefer: resolution=merge-duplicates`` every key in the payload
        becomes ``SET col = excluded.col``, so a NULL this run happens to carry
        blanks a value an earlier run or a backfill had captured;
      * on INSERT an explicit NULL *overrides the column DEFAULT*. marketing_ads
        has ``is_active BOOLEAN DEFAULT true`` and ``is_template_ad boolean
        DEFAULT false``, both of which the Meta builder legitimately omits --
        padding would turn every such row into NULL and make "is this ad running"
        unanswerable.

    Grouping sends strictly the keys the caller asked for, so no existing
    caller's write semantics change at all: rows that are already key-uniform
    -- every write path audited on 2026-09-12 except the two ad builders and
    sales_intelligence/scrape_inventory_crawl4ai.py -- produce exactly one group
    and byte-identical requests to before this function existed.

    Ragged input is still a caller bug -- it costs one extra round trip per
    distinct shape -- so it is logged with the differing keys named, loudly
    enough that the builder gets fixed rather than leaning on this net forever.
    """
    groups: dict[frozenset[str], list[dict[str, Any]]] = {}
    for r in rows:
        # dict preserves insertion order, so group order (and therefore write
        # order) stays deterministic.
        groups.setdefault(frozenset(r.keys()), []).append(r)

    if len(groups) > 1:
        shapes = [set(k) for k in groups]
        ragged = sorted(set().union(*shapes) - set.intersection(*shapes))
        log.warning(
            "%s rows are not key-uniform: %d distinct key sets across %d rows. "
            "Grouping them into %d key-uniform request set(s) so PostgREST does "
            "not reject the batch with PGRST102. Keys present on some rows but "
            "not others: %s. FIX the row builder to emit a fixed key set "
            "(explicit None, or the column default, for absent values).",
            table, len(groups), len(rows), len(groups), ", ".join(ragged) or "(none)",
        )

    return [g[i:i + size] for g in groups.values()
            for i in range(0, len(g), size)]


def _assert_wrote_something(verb: str, table: str, attempted: int,
                            written: int, failed_batches: int) -> None:
    """A write given rows that lands nothing is always a failure, never a 0.

    Individual batch errors are logged and skipped so one bad batch can't lose a
    whole 5-hour run. But when *every* batch fails, the caller receives 0 and
    happily reports `done` — that is how reddit_scrape_mentions logged
    "0 Reddit mentions upserted" as a success while dropping every row. This is
    the "scraped N, wrote 0" assertion TODO.md asked for, placed where the row
    counts actually exist rather than in run.py.
    """
    if attempted and not written:
        raise SupabaseError(
            f"{verb} {table}: {attempted} rows attempted, 0 written "
            f"({failed_batches} batch(es) failed). See the batch errors above — "
            f"the payload shape or a constraint is wrong, not the upstream scrape."
        )
    if failed_batches:
        log.error("%s %s: %d of %d rows written — %d batch(es) failed. This run is "
                  "INCOMPLETE for this table.", verb, table, written, attempted,
                  failed_batches)


def upsert(table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
    """Upsert with ON CONFLICT. Raises if the constraint is missing (42P10)
    so callers don't silently drop data — historically this swallowed the
    error and returned 0, which masked the mention_facts / analysis_results
    empty-table bugs for weeks.

    If you're rebuilding the whole table (delete-then-insert pattern),
    prefer `insert()` below — no ON CONFLICT needed, no constraint dance.
    """
    _init()
    if not rows:
        return 0

    # Deduplicate by the conflict key before batching. PostgREST returns 500
    # 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time")
    # when one batch carries the same key twice, and that drops the ENTIRE
    # batch — which is how ig influencer_posts and reddit_mentions were losing
    # every row. Keeping the last occurrence matches ON CONFLICT DO UPDATE
    # semantics, where the last write would have won anyway.
    key_cols = [c.strip() for c in on_conflict.split(",") if c.strip()]
    if key_cols and all(all(c in r for c in key_cols) for r in rows):
        deduped = {tuple(r[c] for c in key_cols): r for r in rows}
        if len(deduped) < len(rows):
            log.info("Deduped %s: %d rows → %d unique (%s)",
                     table, len(rows), len(deduped), on_conflict)
            rows = list(deduped.values())

    url = f"{_url}/rest/v1/{table}?on_conflict={on_conflict}"
    inserted = 0
    failed_batches = 0
    attempted = len(rows)
    for i, batch in enumerate(_uniform_batches(table, rows)):
        resp = http_request("POST", url, headers=_headers, json=batch, timeout=30)
        # A batch may name more than one missing column; strip and retry until
        # the payload is clean or the error is something else.
        while resp.status_code == 400 and "PGRST204" in resp.text:
            if not _strip_missing_column(table, batch, resp.text):
                break
            resp = http_request("POST", url, headers=_headers, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
        elif resp.status_code == 400 and "42P10" in resp.text:
            raise SupabaseError(
                f"No unique constraint on {table} matches on_conflict='{on_conflict}'. "
                f"Either add a UNIQUE CONSTRAINT (not just an expression index) covering "
                f"these columns exactly, or switch the caller to sb.insert() / "
                f"sb.delete_insert_weekly() so ON CONFLICT isn't needed."
            )
        elif resp.status_code == 500 and "21000" in resp.text:
            raise SupabaseError(
                f"Duplicate on_conflict='{on_conflict}' values inside a single "
                f"{table} batch — ON CONFLICT cannot update the same row twice. "
                f"Deduplicate rows by {on_conflict} in the caller before upserting."
            )
        else:
            failed_batches += 1
            log.error("Upsert %s batch #%d error %d: %s", table, i, resp.status_code, resp.text[:300])
    _assert_wrote_something("upsert", table, attempted, inserted, failed_batches)
    return inserted


def insert(table: str, rows: list[dict[str, Any]]) -> int:
    """Plain INSERT — no ON CONFLICT. Use this after _clear_channel_*()
    style truncation, where rebuilds happen weekly and idempotency comes
    from the upstream DELETE. Avoids the unique-constraint dance that
    PostgREST requires for upsert."""
    _init()
    if not rows:
        return 0
    url = f"{_url}/rest/v1/{table}"
    inserted = 0
    failed_batches = 0
    attempted = len(rows)
    # No "resolution=merge-duplicates" header — straight insert.
    hdrs = {k: v for k, v in _headers.items() if k != "Prefer"}
    hdrs["Prefer"] = "return=minimal"
    for i, batch in enumerate(_uniform_batches(table, rows)):
        resp = http_request("POST", url, headers=hdrs, json=batch, timeout=30)
        while resp.status_code == 400 and "PGRST204" in resp.text:
            if not _strip_missing_column(table, batch, resp.text):
                break
            resp = http_request("POST", url, headers=hdrs, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
        else:
            failed_batches += 1
            log.error("Insert %s batch #%d error %d: %s", table, i, resp.status_code, resp.text[:300])
    _assert_wrote_something("insert", table, attempted, inserted, failed_batches)
    return inserted


def upsert_returning(table: str, rows: list[dict[str, Any]], on_conflict: str) -> list[dict]:
    _init()
    if not rows:
        return []
    url = f"{_url}/rest/v1/{table}?on_conflict={on_conflict}"
    hdrs = {**_headers, "Prefer": "resolution=merge-duplicates,return=representation"}
    out: list[dict] = []
    for batch in _uniform_batches(table, rows):
        resp = http_request("POST", url, headers=hdrs, json=batch, timeout=30)
        if resp.status_code not in (200, 201):
            log.error("Upsert-returning %s error %d: %s", table, resp.status_code, resp.text[:300])
            continue
        try:
            out.extend(resp.json())
        except Exception:
            pass
    return out


def delete_insert_weekly(table: str, rows: list[dict[str, Any]],
                          week_col: str, week_val: int, year_val: int) -> int:
    _init()
    if not rows:
        return 0
    hdrs = {k: v for k, v in _headers.items() if k != "Prefer"}
    del_url = f"{_url}/rest/v1/{table}?{week_col}=eq.{week_val}&year=eq.{year_val}"
    dr = http_request("DELETE", del_url, headers=hdrs, timeout=15)
    if dr.status_code not in (200, 204):
        log.warning("delete-before-insert %s failed %d: %s", table, dr.status_code, dr.text[:200])
    inserted = 0
    url_plain = f"{_url}/rest/v1/{table}"
    for batch in _uniform_batches(table, rows):
        resp = http_request("POST", url_plain, headers=hdrs, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
        else:
            log.error("Insert %s error %d: %s", table, resp.status_code, resp.text[:300])
    return inserted


def patch(table: str, row_id: str, data: dict[str, Any]) -> bool:
    _init()
    url = f"{_url}/rest/v1/{table}?id=eq.{row_id}"
    for attempt in range(3):
        resp = http_request("PATCH", url, headers=_headers, json=data, timeout=60)
        if resp.status_code in (200, 204):
            return True
        # A missing column is deterministic — retrying twice more just burns
        # 4 seconds per row. Fail fast and record the gap.
        #
        # Deliberately NOT stripping the column here, unlike upsert(): a PATCH
        # payload IS the enrichment result. Dropping sentiment_score and
        # writing only enriched_at would stamp the row "enriched" while storing
        # nothing — silent corruption that is worse than a visible failure.
        if resp.status_code == 400 and "PGRST204" in resp.text:
            m = _PGRST204_COL.search(resp.text)
            col = m.group(1) if m else "?"
            if col not in SCHEMA_GAPS.get(table, set()):
                SCHEMA_GAPS.setdefault(table, set()).add(col)
                log.error(
                    "SCHEMA GAP: %s.%s does not exist — PATCH abandoned. Rows in "
                    "%s will NOT be enriched until the migration is applied. "
                    "(Not stripping the column: a partial enrichment write would "
                    "mark rows done while storing nothing.)",
                    table, col, table,
                )
            return False
        if attempt == 2:
            log.error("PATCH %s/%s failed %d: %s", table, row_id, resp.status_code, resp.text[:200])
            return False
        time.sleep(2)
    return False


def delete_where(table: str, filters: str) -> int:
    """DELETE rows matching a raw PostgREST filter string. Returns rows deleted.

    `filters` is passed through verbatim (e.g. `brand_id=eq.<uuid>&scraped_at=lt.<ts>`),
    so the caller owns correctness of the predicate.

    Guard rail: an empty filter string is refused rather than deleting the whole
    table. There is no legitimate caller for an unfiltered delete here, and the
    cost of getting it wrong is the entire table.
    """
    _init()
    if not filters or not filters.strip():
        raise ValueError(f"delete_where({table!r}) refused: empty filter would delete every row")
    hdrs = {**_headers, "Prefer": "return=representation"}
    url = f"{_url}/rest/v1/{table}?{filters}"
    resp = http_request("DELETE", url, headers=hdrs, timeout=60)
    if resp.status_code not in (200, 204):
        # Deliberately raising rather than returning 0. A rejected DELETE and a
        # DELETE that matched nothing both "delete zero rows", and a caller that
        # cannot tell them apart reports a successful no-op prune while stale
        # rows stay in the table.
        raise SupabaseError(
            f"DELETE {table} → {resp.status_code}: {resp.text[:300]}")
    try:
        return len(resp.json())
    except Exception:  # noqa: BLE001 - 204 carries no body
        return 0
