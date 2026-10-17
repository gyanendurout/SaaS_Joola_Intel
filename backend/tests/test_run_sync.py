"""run_sync must surface the coroutine's own error, never re-await it."""
import asyncio
import threading

import pytest

from backend.scraping.core.crawl4ai_client import run_sync


async def _boom():
    raise RuntimeError("chromium executable not found")


async def _ok():
    return 42


def test_returns_value_from_main_thread():
    assert run_sync(_ok()) == 42


def test_returns_value_from_worker_thread():
    out = {}
    t = threading.Thread(target=lambda: out.setdefault("v", run_sync(_ok())))
    t.start(); t.join()
    assert out["v"] == 42


def test_inner_runtime_error_is_not_masked():
    with pytest.raises(RuntimeError, match="chromium executable not found"):
        run_sync(_boom())


def test_inner_runtime_error_in_worker_thread_is_not_masked():
    err = {}
    def work():
        try:
            run_sync(_boom())
        except RuntimeError as e:
            err["msg"] = str(e)
    t = threading.Thread(target=work); t.start(); t.join()
    assert err["msg"] == "chromium executable not found"


def test_works_when_a_loop_is_already_running():
    async def outer():
        return run_sync(_ok())
    assert asyncio.run(outer()) == 42
