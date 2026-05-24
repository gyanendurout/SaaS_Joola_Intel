"""JOOLA Intel — backend (scraping pipeline)

Top-level package marker so `python -m backend.scraping.run` works.

Modules:
    backend.scraping       — multi-source scraping pipeline (Instagram, YouTube,
                             Reddit, Twitter, TikTok, Meta/Google Ads, products,
                             news, SEO) plus AI enrichment and fact derivation.

Entry points:
    python -m backend.scraping.run --module all
    python -m backend.scraping.run --module enrichment
    python -m backend.scraping.run --module maintenance --source backfill_youtube_comments

See backend/README.md for full details.
"""
