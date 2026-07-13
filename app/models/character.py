from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.state import StateInstance


class CharacterRuntimeState(BaseModel):
    states: dict[str, StateInstance] = Field(default_factory=dict)
    turn_count: int = 0
    last_resolved_turn: int = 0
    composite_states: dict[str, float] = Field(default_factory=dict)
    emotional_dimensions: dict[str, float] = Field(default_factory=dict)


class Character(BaseModel):
    id: str
    name: str
    role: str = "npc"
    state_packs: list[str] = Field(default_factory=list)
    traits: dict[str, float] = Field(default_factory=dict)
    runtime: CharacterRuntimeState = Field(default_factory=CharacterRuntimeState)
    current_behavior: str | None = None
    last_behavior: str | None = None
    behavior_cooldowns: dict[str, float] = Field(default_factory=dict)
    max_active_states: int = 40
