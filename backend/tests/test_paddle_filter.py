"""Regression tests for the paddle/not-paddle filter in scrape_specs.

WHY THIS FILE EXISTS
The first version of `_NOT_PADDLE` used substring matching and contained the
word "ball". "ball" is a substring of "pickleball", so every single genuine
pickleball paddle was rejected — while "JOOLA Paddle Luggage Tag" sailed
through. Against the live JOOLA catalog the crawler found 2 "paddles", both
wrong, out of 97 real ones, and reported no error of any kind.

That is the worst class of scraper bug: a confident, quiet, wrong answer. These
tests pin the behaviour so it cannot return.

Every title below is verbatim from joola.com/products.json (2026-08-26).
"""
from __future__ import annotations

import pytest

from backend.scraping.sources.products.scrape_specs import _is_paddle


# Real paddles — must all be KEPT.
PADDLES = [
    'JOOLA "Da Hammer" Pickleball Paddle',
    "JOOLA Astro Pickleball Paddle",
    'JOOLA Graf Edge 16mm "Blemished" Pickleball Paddle',
    "JOOLA Ben Johns Perseus CFS 14 Pickleball Paddle",
    "JOOLA Hyperion CAS 16mm Pickleball Paddle",
    "JOOLA Hyperion Pro IV 16mm Pickleball Paddle - Tropical Blue/Green",
    "JOOLA Perseus Pro V Pickleball Paddle",
    "JOOLA Scorpeus Pro V Pickleball Paddle",
    "JOOLA Kosmos Pro V Pickleball Paddle",
    "JOOLA Agassi Pro V Pickleball Paddle",
    "JOOLA Graf Pro V Pickleball Paddle",
]

# Titles that contain the word "paddle" but are NOT paddles — must be REJECTED.
NOT_PADDLES = [
    "JOOLA Paddle Luggage Tag",
    "JOOLA Universal Neoprene Paddle Cover",
    "JOOLA Quattro Ping Pong 4 Paddle Set",      # table tennis, not pickleball
    "JOOLA Premium Pickleball Paddle Overgrip (4 Count)",
    "JOOLA Pickleball Trainer Paddle Set",
    "JOOLA Neoprene Pickleball Paddle Covers",
    "JOOLA Pro Pickleball Paddle Case",
    "JOOLA Vision Duo Pickleball Paddle Bag",
]


@pytest.mark.parametrize("title", PADDLES)
def test_real_paddles_are_kept(title):
    # product_type is deliberately the useless value the store actually sends:
    # JOOLA tags 377 of 391 products "Inventory Item".
    assert _is_paddle(title, "Inventory Item") is True


@pytest.mark.parametrize("title", NOT_PADDLES)
def test_accessories_and_other_sports_are_rejected(title):
    assert _is_paddle(title, "Inventory Item") is False


def test_ball_does_not_match_inside_pickleball():
    """The exact bug. 'ball' must not be found inside 'pickleball'."""
    assert _is_paddle("JOOLA Astro Pickleball Paddle", "Inventory Item") is True


def test_actual_balls_are_still_rejected():
    """...but a real ball must still be excluded."""
    assert _is_paddle("JOOLA Primo Outdoor Pickleball Balls 3 Pack", "") is False


def test_titles_without_paddle_are_rejected():
    for title in ["JOOLA Tour Elite Pickleball Bag", "JOOLA Performance Arm Sleeves"]:
        assert _is_paddle(title, "Inventory Item") is False


def test_empty_input_is_rejected_not_crashed():
    assert _is_paddle("", "") is False
    assert _is_paddle("", "Pickleball Paddle") is True   # type alone is enough
