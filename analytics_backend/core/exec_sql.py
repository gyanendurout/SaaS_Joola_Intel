"""Execute raw SQL via the Supabase REST `exec_sql` RPC.

The 3 mart refresh modules use this helper for `REFRESH MATERIALIZED VIEW`
statements. If the optional `exec_sql` Postgres function is not installed
in the Supabase project (common during initial setup), this helper logs a
clear warning with the SQL the operator must paste into the SQL editor —
the analytics run does NOT crash.

A minimal SQL function the operator can install once:

    create or replace function exec_sql(query text) returns void
    language plpgsql security definer as $$
    begin execute query; end;
    $$;
"""
from __future__ import annotations

from typing import Any

from backend.scraping.core.logger import get_logger
from backend.scraping.core.network import http_request
from backend.scraping.core.settings import SUPABASE_URL, require_supabase

log = get_logger("marts.exec_sql")


def exec_sql(sql: str) -> dict[str, Any]:
    """Execute raw SQL via Supabase REST RPC.

    Falls back to logging the SQL when `rpc/exec_sql` is not installed in
    the DB (initial setup state). Never raises — analytics pipeline must
    keep running even if the RPC isn't available yet.

    Returns:
        {"executed": True,  "sql": sql}                       on success
        {"executed": False, "sql": sql, "reason": "..."}      on fallback
    """
    _url, key = require_supabase()
    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    try:
        resp = http_request(
            "POST",
            rpc_url,
            headers=headers,
            json={"query": sql},
            timeout=120,
        )
    except Exception as exc:  # pragma: no cover — network already retried
        log.warning(
            "exec_sql network failure: %s\n"
            "Could not auto-exec; run this in Supabase SQL editor:\n%s",
            exc,
            sql,
        )
        return {"executed": False, "sql": sql, "reason": f"network:{exc}"}

    if resp.status_code in (200, 201, 204):
        return {"executed": True, "sql": sql}

    if resp.status_code in (400, 404):
        log.warning(
            "exec_sql RPC not installed or rejected (HTTP %d). "
            "Could not auto-exec; run this in Supabase SQL editor:\n%s",
            resp.status_code,
            sql,
        )
        return {
            "executed": False,
            "sql": sql,
            "reason": f"http_{resp.status_code}",
        }

    log.error(
        "exec_sql failed HTTP %d: %s\nCould not auto-exec; run this in Supabase SQL editor:\n%s",
        resp.status_code,
        resp.text[:300],
        sql,
    )
    return {"executed": False, "sql": sql, "reason": f"http_{resp.status_code}"}
