from __future__ import annotations

from pydantic import BaseModel, Field


class Relationship(BaseModel):
    character_id: str
    target_id: str = "player"
    trust: float = 50.0
    respect: float = 50.0
    affection: float = 0.0
    attraction: float = 0.0
    attachment: float = 0.0
    resentment: float = 0.0
    suspicion: float = 0.0
    fear: float = 0.0
    comfort: float = 0.0
    debt: float = 0.0
    extra: dict[str, float] = Field(default_factory=dict)
