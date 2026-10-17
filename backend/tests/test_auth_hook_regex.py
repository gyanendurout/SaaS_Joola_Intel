"""Guard against drift between the two sign-up domain allow-lists.

The login form (frontend/lib/auth/rules.ts) and the Supabase "before user
created" hook (migrations/029_auth_domain_hook.sql) each carry the email
regex. If one is edited without the other, a domain could be accepted by the
UI but refused by Supabase (or, worse, the reverse). This test rebuilds both
regexes from source and checks they agree on a fixed sample list.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL_FILE = ROOT / "migrations" / "029_auth_domain_hook.sql"
TS_FILE = ROOT / "frontend" / "lib" / "auth" / "rules.ts"

SAMPLES = {
    "a@joola.com": True,
    "a.b+c@joola.in": True,
    "o'neil@joola.com": True,
    "a@gmail.com": False,
    "a@sub.joola.com": False,
    "a@joola.com.": False,
    "a b@joola.com": False,
    '"a"@joola.com': False,
}


def sql_regex() -> str:
    text = SQL_FILE.read_text(encoding="utf-8")
    # SQL string literal: '...' with '' as an escaped quote.
    m = re.search(r"email ~ '((?:[^']|'')*)'", text)
    assert m, "could not find `email ~ '...'` in 029_auth_domain_hook.sql"
    return m.group(1).replace("''", "'")


def ts_regex() -> str:
    text = TS_FILE.read_text(encoding="utf-8")
    domains_m = re.search(r"ALLOWED_DOMAINS\s*=\s*\[([^\]]*)\]", text)
    assert domains_m, "could not find ALLOWED_DOMAINS in rules.ts"
    domains = re.findall(r"'([^']+)'", domains_m.group(1))
    assert domains, "ALLOWED_DOMAINS is empty"
    class_m = re.search(r"`\^(\[[^\]]+\]\+)@\(\$\{ALLOWED_DOMAINS", text)
    assert class_m, "could not find ALLOWED_EMAIL_RE template in rules.ts"
    alt = "|".join(re.escape(d) for d in domains)
    return f"^{class_m.group(1)}@({alt})$"


def test_both_regexes_found():
    assert sql_regex()
    assert ts_regex()


def test_sql_and_ts_regexes_agree_on_samples():
    sql_re = re.compile(sql_regex())
    ts_re = re.compile(ts_regex())
    for email, expected in SAMPLES.items():
        assert bool(sql_re.fullmatch(email)) is expected, f"SQL regex wrong for {email!r}"
        assert bool(ts_re.fullmatch(email)) is expected, f"TS regex wrong for {email!r}"


def test_domain_lists_match_exactly():
    # Samples alone would miss a domain added to only one side.
    sql_alt = re.search(r"@\(([^)]*)\)\$", sql_regex())
    ts_alt = re.search(r"@\(([^)]*)\)\$", ts_regex())
    assert sql_alt and ts_alt
    unescape = lambda s: {d.replace(r"\.", ".") for d in s.split("|")}
    assert unescape(sql_alt.group(1)) == unescape(ts_alt.group(1))
