from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.behavior import BehaviorResult, InternalConflict
from app.models.relationship import Relationship


class RendererPayload(BaseModel):
    character_id: str
    character_name: str
    chosen_behavior: str
    behavior_variant: str = "neutral"
    dominant_states: dict[str, float] = Field(default_factory=dict)
    relationship_snapshot: dict[str, float] = Field(default_factory=dict)
    internal_conflict: InternalConflict | None = None
    render_guidance: dict[str, list[str]] = Field(default_factory=dict)


class ResolvedCharacter(BaseModel):
    character_id: str
    character_name: str
    behavior_result: BehaviorResult
    renderer_payload: RendererPayload
    updated_relationship: Relationship
