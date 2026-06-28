"""Apply a single migration file to Supabase.

Usage:
  python scripts/apply_migration.py 018_product_images.sql
  python scripts/apply_migration.py migrations/018_product_images.sql

Strategy is the same as apply_migration_013.py but parameterized: tries
psycopg first (SUPABASE_DB_URL or SUPABASE_URL+SUPABASE_DB_PASSWORD), then
PostgREST RPC exec_sql, then prints manual instructions and exits 0.
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    env_file = REPO_ROOT / "scripts" / ".env"
    if not env_file.exists():
        env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
        return
    except ImportError:
        pass
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def split_sql(sql: str) -> list[str]:
    statements: list[str] = []
    buf: list[str] = []
    in_dollar = False
    for raw_line in sql.splitlines():
        line = raw_line
        stripped = line.strip()
        if not in_dollar and stripped.startswith("--"):
            continue
        if len(re.findall(r"\$\$", line)) % 2 == 1:
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
    db_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not db_url:
        supabase_url = os.environ.get("SUPABASE_URL", "")
        db_password = os.environ.get("SUPABASE_DB_PASSWORD", "")
        if supabase_url and db_password:
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
        return fail == 0, f"executed: ok={ok}, fail={fail}"
    finally:
        conn.close()


def try_rpc(sql: str) -> tuple[bool, str]:
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


def manual_instructions(migration_file: Path) -> None:
    print("\n" + "=" * 64)
    print("MANUAL APPLY REQUIRED")
    print("=" * 64)
    supabase_url = os.environ.get("SUPABASE_URL", "")
    ref = ""
    if supabase_url:
        ref = supabase_url.split("//")[-1].split(".")[0]
    print(f"  1. Open: https://supabase.com/dashboard/project/{ref}/sql/new")
    print(f"  2. Paste the contents of:\n     {migration_file}")
    print("  3. Click Run.")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python scripts/apply_migration.py <migration-filename-or-path>")
        return 2

    arg = argv[1]
    path = Path(arg)
    if not path.is_absolute():
        path = REPO_ROOT / arg
    if not path.exists() and "/" not in arg and "\\" not in arg:
        path = REPO_ROOT / "migrations" / arg
    if not path.exists():
        print(f"ERROR: migration file not found: {arg}")
        return 1

    load_env()
    sql = path.read_text(encoding="utf-8")
    print(f"Loaded {path.name} ({len(sql)} bytes, {sql.count(chr(10)) + 1} lines)")

    t0 = time.time()
    ok, msg = try_psycopg(sql)
    if ok:
        print(f"\n[done] psycopg ok in {time.time()-t0:.1f}s — {msg}")
        return 0
    print(f"[psycopg] failed: {msg}")

    ok, msg = try_rpc(sql)
    if ok:
        print(f"\n[done] rpc ok in {time.time()-t0:.1f}s — {msg}")
        return 0
    print(f"[rpc] failed: {msg}")

    manual_instructions(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
