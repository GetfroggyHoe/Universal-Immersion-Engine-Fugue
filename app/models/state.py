from __future__ import annotations

from pydantic import BaseModel, Field


class StateDefinition(BaseModel):
    id: str
    label: str = ""
    family: str = "base_emotion"
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    baseline: float = 0.0
    default_decay_rate: float = 1.0
    default_volatility: float = 1.0
    min_value: float = 0.0
    max_value: float = 100.0
    opposing_states: list[str] = Field(default_factory=list)
    related_states: list[str] = Field(default_factory=list)
    behavior_biases: dict[str, float] = Field(default_factory=dict)
    valence: float = 0.0
    arousal: float = 0.0
    dominance: float = 0.0
    approach: float = 0.0
    social: float = 0.0
    threat: float = 0.0
    intimacy: float = 0.0
    morality: float = 0.0


class StateInstance(BaseModel):
    state_id: str
    value: float = 0.0
    baseline: float = 0.0
    decay_rate: float = 1.0
    volatility: float = 1.0
    min_value: float = 0.0
    max_value: float = 100.0
    source: str | None = None
    target_id: str | None = None
    lifecycle: str = "latent"
    turns_active: int = 0
    last_modified_turn: int = 0
