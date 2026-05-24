"""Apply migration 013 to Supabase.

Attempts (in order):
  1. Direct psycopg connection via SUPABASE_DB_URL  (best path)
  2. Direct psycopg via SUPABASE_URL + SUPABASE_DB_PASSWORD (pooler)
  3. PostgREST RPC /rest/v1/rpc/exec_sql (requires the `exec_sql` function)

If all three fail, prints the manual apply instructions and exits 0
(the migration file existing on disk is the primary deliverable).
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_FILE = REPO_ROOT / "migrations" / "013_analytics_foundation.sql"

EXPECTED_OBJECTS = [
    "dim_brand_calendar",
    "ad_pressure_daily",
    "promotion_daily",
    "price_daily",
    "availability_daily",
    "joola_timeseries_daily",
    "joola_timeseries_weekly",
    "analysis_results",
]


def load_env() -> None:
    """Load .env into os.environ if python-dotenv is available."""
    env_file = REPO_ROOT / "scripts" / ".env"
    if not env_file.exists():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
        return
    except ImportError:
        pass
    # Manual parse fallback
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def split_sql(sql: str) -> list[str]:
    """Naive splitter on ';' that respects $$ ... $$ blocks and -- comments."""
    statements: list[str] = []
    buf: list[str] = []
    in_dollar = False
    for raw_line in sql.splitlines():
        line = raw_line
        # Strip full-line comments outside dollar blocks
        stripped = line.strip()
        if not in_dollar and stripped.startswith("--"):
            continue
        # Track $$ ... $$ blocks (DO blocks, function bodies)
        dollar_hits = len(re.findall(r"\$\$", line))
        if dollar_hits % 2 == 1:
            in_dollar = not in_dollar
        buf.append(line)
        if not in_dollar and stripped.endswith(";"):
            stmt = "\n".join(buf).strip()
            if stmt and stmt != ";":
                statements.append(stmt)
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def try_psycopg(sql: str) -> tuple[bool, str]:
    """Try direct Postgres connection via psycopg/psycopg2.

    Looks for SUPABASE_DB_URL first; falls back to constructing the pooler
    URL if SUPABASE_DB_PASSWORD is set.
    """
    db_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not db_url:
        supabase_url = os.environ.get("SUPABASE_URL", "")
        db_password = os.environ.get("SUPABASE_DB_PASSWORD", "")
        if supabase_url and db_password:
            # https://<ref>.supabase.co → postgres.<ref>
            m = re.match(r"https://([^.]+)\.supabase\.co", supabase_url)
            if m:
                ref = m.group(1)
                db_url = (
                    f"postgresql://postgres.{ref}:{db_password}"
                    f"@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
                )
    if not db_url:
        return False, "no SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in env"

    try:
        import psycopg  # type: ignore
        driver = "psycopg3"
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
            driver = "psycopg2"
        except ImportError:
            return False, "psycopg/psycopg2 not installed"

    print(f"[psycopg] driver={driver} connecting...")
    try:
        conn = psycopg.connect(db_url)
    except Exception as e:
        return False, f"connection failed: {e}"

    statements = split_sql(sql)
    print(f"[psycopg] connected; executing {len(statements)} statements")
    ok, fail = 0, 0
    try:
        if driver == "psycopg3":
            conn.autocommit = True
            with conn.cursor() as cur:
                for i, stmt in enumerate(statements, 1):
                    head = stmt.splitlines()[0][:80] if stmt else ""
                    try:
                        cur.execute(stmt)
                        ok += 1
                        print(f"  [{i:02d}/{len(statements)}] OK   {head}")
                    except Exception as e:
                        fail += 1
                        print(f"  [{i:02d}/{len(statements)}] FAIL {head}\n        {e}")
        else:
            conn.autocommit = True
            cur = conn.cursor()
            for i, stmt in enumerate(statements, 1):
                head = stmt.splitlines()[0][:80] if stmt else ""
                try:
                    cur.execute(stmt)
                    ok += 1
                    print(f"  [{i:02d}/{len(statements)}] OK   {head}")
                except Exception as e:
                    fail += 1
                    print(f"  [{i:02d}/{len(statements)}] FAIL {head}\n        {e}")
            cur.close()

        # Verification
        verify_sql = (
            "SELECT relname FROM pg_class "
            "WHERE relname = ANY(%s) AND relkind IN ('r','m')"
        )
        if driver == "psycopg3":
            with conn.cursor() as cur:
                cur.execute(verify_sql, (EXPECTED_OBJECTS,))
                found = sorted(r[0] for r in cur.fetchall())
        else:
            cur = conn.cursor()
            cur.execute(verify_sql, (EXPECTED_OBJECTS,))
            found = sorted(r[0] for r in cur.fetchall())
            cur.close()

        print("\n[verify] objects present in DB:")
        for name in EXPECTED_OBJECTS:
            mark = "OK " if name in found else "-- "
            print(f"  {mark} {name}")
        missing = [n for n in EXPECTED_OBJECTS if n not in found]
        summary = (
            f"executed: ok={ok}, fail={fail}; verified found={len(found)}/"
            f"{len(EXPECTED_OBJECTS)} (missing={missing})"
        )
        return fail == 0 and not missing, summary
    finally:
        conn.close()


def try_postgrest_rpc(sql: str) -> tuple[bool, str]:
    """Last-resort: call /rest/v1/rpc/exec_sql (only works if that fn exists)."""
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not key:
        return False, "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    try:
        import requests  # type: ignore
    except ImportError:
        return False, "requests not installed"

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    url = f"{supabase_url}/rest/v1/rpc/exec_sql"
    print(f"[rpc] POST {url}")
    r = requests.post(url, headers=headers, json={"sql": sql}, timeout=120)
    if r.status_code in (200, 204):
        return True, "rpc exec_sql succeeded"
    return False, f"rpc {r.status_code}: {r.text[:300]}"


def manual_instructions() -> None:
    print("\n" + "=" * 64)
    print("MANUAL APPLY REQUIRED")
    print("=" * 64)
    print("Automatic apply could not find a direct Postgres connection.")
    print("Apply the migration manually via the Supabase SQL editor:")
    print()
    print(f"  1. Open: https://supabase.com/dashboard/project/"
          f"{os.environ.get('SUPABASE_URL', '').split('//')[-1].split('.')[0]}"
          f"/sql/new")
    print(f"  2. Paste the contents of:")
    print(f"     {MIGRATION_FILE}")
    print( "  3. Click Run.")
    print()
    print("To enable the automatic path next time, add ONE of these to")
    print(".env:")
    print( "  SUPABASE_DB_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>"
           ".pooler.supabase.com:6543/postgres")
    print( "  OR")
    print( "  SUPABASE_DB_PASSWORD=<your-db-password>   "
           "(combined with SUPABASE_URL)")


def main() -> int:
    load_env()
    if not MIGRATION_FILE.exists():
        print(f"ERROR: migration file not found: {MIGRATION_FILE}")
        return 1
    sql = MIGRATION_FILE.read_text(encoding="utf-8")
    print(f"Loaded {MIGRATION_FILE.name} ({len(sql)} bytes, "
          f"{sql.count(chr(10)) + 1} lines)")

    t0 = time.time()
    ok, msg = try_psycopg(sql)
    if ok:
        print(f"\n[done] psycopg path succeeded in {time.time()-t0:.1f}s")
        print(f"[done] {msg}")
        return 0
    print(f"[psycopg] skipped/failed: {msg}")

    ok, msg = try_postgrest_rpc(sql)
    if ok:
        print(f"\n[done] rpc path succeeded in {time.time()-t0:.1f}s — "
              f"{msg}")
        return 0
    print(f"[rpc] skipped/failed: {msg}")

    manual_instructions()
    return 0  # NOT an error — file on disk is the deliverable


if __name__ == "__main__":
    sys.exit(main())
