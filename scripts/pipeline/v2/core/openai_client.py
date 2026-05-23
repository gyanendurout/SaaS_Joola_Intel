"""OpenAI GPT-4o-mini client for AI enrichment."""

from __future__ import annotations

import json
import time
from typing import Any

import requests

from .errors import EnrichmentError
from .logger import get_logger
from .settings import OPENAI_MODEL, require_openai

log = get_logger("openai")

BRAND_SLUGS = [
    "joola", "selkirk", "paddletek", "crbn", "six-zero",
    "engage", "onix", "franklin", "head", "wilson", "gamma",
]

ATHLETES = [
    "Ben Johns", "Tyson McGuffin", "Anna Leigh Waters", "Anna Bright",
    "Patrick Smith", "Catherine Parenteau", "Riley Newman", "Simone Jardim",
    "Zane Navratil", "James Ignatowich", "Jorja Johnson", "Jay Devilliers",
    "Jessie Irvine", "Kyle Yates", "Tanner Tomassi", "Bobbi Oshiro",
    "Sarah Ansboury", "Leigh Waters", "Connor Garnett", "Aspen Kern",
    "Roscoe Bellamy", "Alex Neumann", "Andrei Daescu", "Allyce Jones",
    "Blaine Hovenier", "Gabe Joseph", "Eric Oncins",
]

PRODUCTS_HINT = [
    "Perseus", "Hyperion", "Scorpeus", "Agassi Pro", "Solaire",
    "Vanguard Power Air", "Luxx Control", "Halo", "Invikta",
    "Bantam TS-5", "Tempest Reign",
    "CRBN-1", "CRBN-3", "CRBN-X",
    "Double Black Diamond", "DBD",
    "Pursuit Pro",
    "Z5", "Evoke",
    "Signature Pro",
    "Radical Pro",
    "Juice Pro",
    "Obsidian",
]

SYSTEM_PROMPT = (
    "You are an analyst classifying social media content about pickleball paddle brands. "
    "Output strict JSON only.\n\n"
    "For each input text, return:\n"
    "- sentiment_score: -1.0 (very negative) to 1.0 (very positive)\n"
    "- sentiment_label: \"very_negative\" | \"negative\" | \"neutral\" | \"positive\" | \"very_positive\"\n"
    "- topics: array of 1-4 short topic tags (lowercase, hyphen-separated)\n"
    "- brands_mentioned: array of brand slugs from: " + ", ".join(BRAND_SLUGS) + "\n"
    "- players_mentioned: array of athlete full names from: " + ", ".join(ATHLETES) + "\n"
    "- products_mentioned: array of product names from: " + ", ".join(PRODUCTS_HINT) + "\n"
    "- is_crisis: true if text describes product failure, defect, warranty problem, fraud, or reputation risk\n"
    "- is_opportunity: true if text is buying intent, switch-from-competitor, or positive UGC about JOOLA\n"
    "- purchase_intent_score: 0.0 (no intent) to 1.0 (explicit buying intent)\n"
    "- crisis_keywords: array of crisis keywords found (empty if none)\n"
    "- competitor_switch_from: brand slug if writer mentions switching FROM. Null otherwise.\n"
    "- competitor_switch_to: brand slug if writer mentions switching TO. Null otherwise.\n\n"
    "Return ONLY the JSON object. No prose."
)


def call_openai(
    text: str,
    *,
    allow_competitor_switch: bool = False,
    system_prompt: str | None = None,
) -> dict[str, Any] | None:
    """Single-row enrichment via GPT-4o-mini. Returns dict or None on failure."""
    if not text or len(text.strip()) < 3:
        return None

    api_key = require_openai()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": OPENAI_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
            {"role": "user", "content": text[:1500]},
        ],
    }
    for attempt in range(3):
        try:
            r = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=30,
            )
            if r.status_code == 429:
                wait = 2 ** attempt * 5
                log.warning("OpenAI rate-limited, waiting %ds", wait)
                time.sleep(wait)
                continue
            if r.status_code != 200:
                log.error("OpenAI error %d: %s", r.status_code, r.text[:300])
                return None
            result: dict = json.loads(r.json()["choices"][0]["message"]["content"])
            if not allow_competitor_switch:
                result.pop("competitor_switch_from", None)
                result.pop("competitor_switch_to", None)
            return result
        except (requests.exceptions.RequestException, json.JSONDecodeError, KeyError) as e:
            log.warning("OpenAI attempt %d/3 failed: %s", attempt + 1, e)
            time.sleep(2)
    return None
