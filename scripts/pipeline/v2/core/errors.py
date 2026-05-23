"""Custom exceptions for the v2 pipeline."""

from __future__ import annotations


class PipelineError(Exception):
    """Base class for all pipeline errors."""


class ActorStartError(PipelineError):
    """Apify actor failed to start."""


class ActorRunError(PipelineError):
    """Apify actor run ended in FAILED / TIMED-OUT / ABORTED state."""


class SupabaseError(PipelineError):
    """Supabase HTTP request failed."""


class EnrichmentError(PipelineError):
    """OpenAI enrichment call failed."""


class CheckpointError(PipelineError):
    """Checkpoint file read/write failed."""


class ConfigError(PipelineError):
    """Missing or invalid configuration."""


class NetworkError(PipelineError):
    """Network error after exhausting retries."""
