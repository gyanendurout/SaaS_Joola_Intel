"""Environment configuration loader for v2 pipeline."""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    # Repo root = parents[3]:
    # settings.py → core → scraping → scripts → joola-intel-nextjs (repo root)
    _root = Path(__file__).resolve().parents[3]
    load_dotenv(_root / "scripts" / ".env")
    load_dotenv(_root / ".env.local")
except ImportError:
    pass

from .errors import ConfigError


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise ConfigError(f"Required environment variable {name!r} is not set. "
                          "Add it to scripts/.env or export it before running.")
    return val


def _optional(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL: str = _optional("SUPABASE_URL", "https://loecyghnkkxyymelgexz.supabase.co")
SUPABASE_KEY: str = ""  # loaded lazily so import doesn't fail during --help

# ── Apify ─────────────────────────────────────────────────────────────────────
APIFY_BASE: str = "https://api.apify.com/v2"
APIFY_TOKEN: str = ""  # loaded lazily

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_MODEL: str = "gpt-4o-mini"

# ── Pipeline behaviour ────────────────────────────────────────────────────────
NETWORK_MAX_RETRIES: int = int(_optional("NETWORK_MAX_RETRIES", "80"))
NETWORK_RETRY_WAIT:  int = int(_optional("NETWORK_RETRY_WAIT", "30"))
ENRICH_WORKERS:      int = int(_optional("ENRICH_WORKERS", "5"))
ENRICH_BATCH:        int = int(_optional("ENRICH_BATCH", "500"))

# ── JOOLA brand constant ───────────────────────────────────────────────────────
JOOLA_BRAND_ID: str = "04db8591-37a3-4634-9d11-536975fa6935"

# ── Brand list ────────────────────────────────────────────────────────────────
BRAND_SLUGS: list[str] = [
    "joola", "selkirk", "paddletek", "crbn", "six-zero",
    "engage", "onix", "franklin", "head", "wilson", "gamma",
]


def require_supabase() -> tuple[str, str]:
    """Return (url, service_role_key). Raises ConfigError if key missing."""
    key = _require("SUPABASE_SERVICE_ROLE_KEY")
    return SUPABASE_URL, key


def require_apify() -> str:
    """Return Apify token. Raises ConfigError if missing."""
    return _require("APIFY_TOKEN")


def require_openai() -> str:
    """Return OpenAI key. Raises ConfigError if missing."""
    return (os.environ.get("OPENAI_API_KEY")
            or os.environ.get("NEXT_PUBLIC_OPENAI_KEY")
            or _require("OPENAI_API_KEY"))
