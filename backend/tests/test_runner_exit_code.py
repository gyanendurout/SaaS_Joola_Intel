"""The runner must not exit 0 when a step failed.

On 2026-09-12 `--module reviews-crawl4ai` lost a 100-minute crawl to a constraint
violation. The runner logged

    WARNING  Failed steps: products_scrape_reviews_crawl4ai

and then exited **0**. Any cron, CI job, or shell chain reading `$?` saw success,
which is why the next module started as if nothing had happened. A non-zero exit
is the only signal automation can act on.

Contract pinned here:
  * failed steps            -> exit 2 (EXIT_PARTIAL: ran, but lost something)
  * clean run               -> exit 0 (no SystemExit, or SystemExit(0))
  * write-side schema gaps  -> exit 2 (rows silently stripped is a failure too)
  * KeyboardInterrupt       -> exit 0, unchanged; resumable state is not an error

2 rather than 1 because weekly_run.py skips the analytics phase on a non-zero
scraping exit. 1 is reserved for "could not run at all" (credential check), where
there genuinely is nothing for analytics to read; 2 says the surviving modules
wrote their rows and the derived layers are still worth rebuilding.
"""
import pytest

from backend.scraping import run as runmod


def _argv(monkeypatch, *args):
    monkeypatch.setattr("sys.argv", ["run.py", *args])


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Neutralise everything except the exit-code decision."""
    monkeypatch.setattr(runmod.sb, "SCHEMA_GAPS", {}, raising=False)
    monkeypatch.setattr(runmod.sb, "SCHEMA_GAPS_READ", {}, raising=False)
    monkeypatch.setattr(runmod, "check_credentials", lambda *a, **k: None, raising=False)


def _run(monkeypatch, rows, failed):
    monkeypatch.setattr(runmod, "_run_module", lambda *a, **k: (rows, failed))
    _argv(monkeypatch, "--module", "reviews-crawl4ai", "--no-parallel")
    try:
        runmod.main()
    except SystemExit as e:
        return e.code if e.code is not None else 0
    return 0


def test_failed_step_exits_nonzero(monkeypatch):
    assert _run(monkeypatch, 0, ["products_scrape_reviews_crawl4ai"]) == runmod.EXIT_PARTIAL


def test_failed_step_exits_nonzero_even_when_other_rows_landed(monkeypatch):
    """Partial success is still a failure — this is the case that bit us."""
    assert _run(monkeypatch, 8370, ["products_scrape_reviews_crawl4ai"]) == runmod.EXIT_PARTIAL


def test_clean_run_exits_zero(monkeypatch):
    assert _run(monkeypatch, 1234, []) == 0


def test_zero_rows_without_failures_is_not_an_error(monkeypatch):
    """A module with genuinely nothing new to write must stay exit 0."""
    assert _run(monkeypatch, 0, []) == 0


def test_write_schema_gap_exits_nonzero(monkeypatch):
    """Columns stripped so 'the rest of the row could land' = data not captured."""
    monkeypatch.setattr(runmod.sb, "SCHEMA_GAPS",
                        {"marketing_ads": {"cta_text"}}, raising=False)
    assert _run(monkeypatch, 500, []) == runmod.EXIT_PARTIAL


def test_read_schema_gap_alone_does_not_fail_the_run(monkeypatch):
    """A stale column name in a select degrades output but writes nothing wrong."""
    monkeypatch.setattr(runmod.sb, "SCHEMA_GAPS_READ",
                        {"products": {"old_col"}}, raising=False)
    assert _run(monkeypatch, 500, []) == 0


def test_keyboard_interrupt_still_exits_zero(monkeypatch):
    def boom(*a, **k):
        raise KeyboardInterrupt
    monkeypatch.setattr(runmod, "_run_module", boom)
    _argv(monkeypatch, "--module", "reviews-crawl4ai", "--no-parallel")
    with pytest.raises(SystemExit) as e:
        runmod.main()
    assert (e.value.code or 0) == 0


def test_partial_is_distinct_from_cannot_run():
    """weekly_run.py branches on these values; they must not collapse."""
    assert runmod.EXIT_PARTIAL != runmod.EXIT_CANNOT_RUN
    assert runmod.EXIT_OK == 0
