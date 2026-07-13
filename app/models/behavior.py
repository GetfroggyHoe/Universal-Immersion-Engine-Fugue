from __future__ import annotations

from pydantic import BaseModel, Field


class BehaviorScore(BaseModel):
    behavior: str
    score: float = 0.0
    reason: list[str] = Field(default_factory=list)


class BehaviorVariant(BaseModel):
    behavior: str
    variant: str
    context_reason: str = ""


class InternalConflict(BaseModel):
    primary: str
    secondary: str
    meaning: str = ""
    conflict_intensity: float = 0.0


class BehaviorResult(BaseModel):
    chosen_behavior: str
    behavior_variant: str = "neutral"
    all_scores: list[BehaviorScore] = Field(default_factory=list)
    internal_conflict: InternalConflict | None = None
    dominant_states: dict[str, float] = Field(default_factory=dict)
    latent_states: dict[str, float] = Field(default_factory=dict)
