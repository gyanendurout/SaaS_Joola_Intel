"""Python ↔ TypeScript parity for `family_key`.

WHY THIS FILE EXISTS
`family_key` is implemented twice: in Python (`spec_normalize.py`, which
computes the `paddle_specs.family_key` column at crawl time) and in TypeScript
(`frontend/lib/v2/paddleFamily.ts`, which computes keys for reviews, prices and
mentions in the browser). They are the join between those datasets.

If the two drift, nothing breaks loudly. The join simply matches fewer and fewer
rows, and Product Intel renders paddles with blank spec columns — which looks
exactly like "the brand doesn't publish that spec". docs/PRODUCT_INTEL_REDESIGN.md
lists this duplication as the design's main risk; this test is the mitigation.

Both implementations run over the same real product names — every distinct
`canonical_name` in `paddle_reviews` plus every `paddle_specs.product_name`,
captured to a fixture so the test needs no network.

Skipped, not failed, when node/tsc are unavailable: a missing toolchain is an
environment gap, not a defect in either implementation.
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import tempfile

import pytest

from backend.scraping.sources.products.spec_normalize import family_key

REPO = pathlib.Path(__file__).resolve().parents[2]
TS_SOURCE = REPO / "frontend" / "lib" / "v2" / "paddleFamily.ts"
FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "family_key_cases.json"

# npx/tsc resolve through the frontend's own node_modules.
FRONTEND = REPO / "frontend"


def _tool(name: str) -> str | None:
    return shutil.which(name) or shutil.which(f"{name}.cmd")


pytestmark = pytest.mark.skipif(
    _tool("node") is None or not TS_SOURCE.exists(),
    reason="node toolchain or paddleFamily.ts unavailable",
)


def _load_cases() -> list[dict]:
    if not FIXTURE.exists():
        pytest.skip(f"parity fixture missing: {FIXTURE}")
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _compile_ts(outdir: pathlib.Path) -> pathlib.Path:
    """Emit paddleFamily.ts to plain ESM so node can import it directly."""
    tsc = FRONTEND / "node_modules" / "typescript" / "bin" / "tsc"
    if not tsc.exists():
        pytest.skip("typescript not installed in frontend/node_modules")
    result = subprocess.run(
        [_tool("node"), str(tsc), str(TS_SOURCE),
         "--outDir", str(outdir),
         "--module", "es2020", "--target", "es2020",
         "--moduleResolution", "bundler", "--skipLibCheck"],
        capture_output=True, text=True, timeout=180,
    )
    emitted = outdir / "paddleFamily.js"
    if not emitted.exists():
        pytest.fail(f"tsc produced no output:\n{result.stdout}\n{result.stderr}")
    return emitted


def test_family_key_matches_the_typescript_implementation():
    cases = _load_cases()
    assert len(cases) >= 100, "fixture too small to be meaningful"

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = pathlib.Path(tmp)
        module = _compile_ts(tmpdir)

        runner = tmpdir / "run.mjs"
        runner.write_text(
            "import { familyKey } from './paddleFamily.js'\n"
            "import { readFileSync } from 'node:fs'\n"
            "const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))\n"
            "process.stdout.write(JSON.stringify(cases.map(c =>\n"
            "  familyKey(c.name, c.brand, c.endorsers || []))))\n",
            encoding="utf-8",
        )
        payload = tmpdir / "cases.json"
        payload.write_text(json.dumps(cases), encoding="utf-8")

        proc = subprocess.run(
            [_tool("node"), str(runner), str(payload)],
            capture_output=True, text=True, timeout=180,
        )
        if proc.returncode != 0:
            pytest.fail(f"node runner failed:\n{proc.stdout}\n{proc.stderr}")
        ts_keys = json.loads(proc.stdout)

    py_keys = [
        family_key(c["name"], c["brand"], tuple(c.get("endorsers") or ()))
        for c in cases
    ]

    mismatches = [
        (c["name"], c["brand"], py, ts)
        for c, py, ts in zip(cases, py_keys, ts_keys)
        if py != ts
    ]
    if mismatches:
        detail = "\n".join(
            f"  {brand:10s} {name[:56]:58s} py={py!r} ts={ts!r}"
            for name, brand, py, ts in mismatches[:25]
        )
        pytest.fail(
            f"{len(mismatches)} of {len(cases)} names key differently between "
            f"Python and TypeScript.\n"
            f"Every mismatch is a paddle whose specs will silently fail to "
            f"join on Product Intel.\n{detail}"
        )


def test_fixture_covers_the_hard_cases():
    """A green parity test over easy names would prove nothing."""
    names = " | ".join(c["name"] for c in _load_cases()).lower()
    for needle in ("ben johns", "crbn", "pro iv", "16mm"):
        assert needle in names, f"parity fixture lacks a {needle!r} case"
