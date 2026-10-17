import builtins

import pytest

from backend.scraping.sources.products import scrape_catalog_local as mod


def test_missing_playwright_raises(monkeypatch):
    real_import = builtins.__import__
    def fake_import(name, *a, **k):
        if name.startswith("playwright"):
            raise ImportError("No module named 'playwright'")
        return real_import(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(RuntimeError, match="playwright"):
        mod.run({"dry_run": False, "brands": None})


def test_dry_run_still_returns_zero_without_playwright(monkeypatch):
    real_import = builtins.__import__
    def fake_import(name, *a, **k):
        if name.startswith("playwright"):
            raise ImportError("No module named 'playwright'")
        return real_import(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert mod.run({"dry_run": True, "brands": None}) == 0
