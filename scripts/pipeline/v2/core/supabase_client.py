"""Supabase HTTP client with retry and batching."""

from __future__ import annotations

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
    url = f"{_url}/rest/v1/{table}?select={select}"
    if params:
        url += "&" + "&".join(f"{k}=eq.{v}" for k, v in params.items())
    hdrs = {k: v for k, v in _headers.items() if k != "Prefer"}
    resp = http_request("GET", url, headers=hdrs, timeout=15)
    if resp.status_code != 200:
        raise SupabaseError(f"GET {table} → {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def get_filtered(table: str, select: str, filters: str) -> list[dict]:
    """E.g. filters='enriched_at=is.null&limit=500'"""
    _init()
    hdrs = {k: v for k, v in _headers.items() if k != "Prefer"}
    url = f"{_url}/rest/v1/{table}?select={select}&{filters}"
    resp = http_request("GET", url, headers=hdrs, timeout=60)
    if resp.status_code != 200:
        raise SupabaseError(f"GET {table} → {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def upsert(table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
    _init()
    if not rows:
        return 0
    url = f"{_url}/rest/v1/{table}?on_conflict={on_conflict}"
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        resp = http_request("POST", url, headers=_headers, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
        elif resp.status_code == 400 and "42P10" in resp.text:
            log.warning("No unique constraint on %s for ON CONFLICT — use delete_insert_weekly", table)
        else:
            log.error("Upsert %s batch %d error %d: %s", table, i, resp.status_code, resp.text[:300])
    return inserted


def upsert_returning(table: str, rows: list[dict[str, Any]], on_conflict: str) -> list[dict]:
    _init()
    if not rows:
        return []
    url = f"{_url}/rest/v1/{table}?on_conflict={on_conflict}"
    hdrs = {**_headers, "Prefer": "resolution=merge-duplicates,return=representation"}
    out: list[dict] = []
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
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
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
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
        if attempt == 2:
            log.error("PATCH %s/%s failed %d: %s", table, row_id, resp.status_code, resp.text[:200])
            return False
        time.sleep(2)
    return False
