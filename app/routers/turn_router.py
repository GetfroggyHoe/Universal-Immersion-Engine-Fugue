from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.runtime import ResolvedCharacter
from app.models.signals import SceneSignals
from app.services.character_runtime_service import CharacterRuntimeService

router = APIRouter(prefix="/turn", tags=["turn"])


class TurnRequest(BaseModel):
    scene_id: str = "scene_default"
    player_id: str = "player"
    characters: list[Character] = Field(default_factory=list)
    relationships: dict[str, Relationship] = Field(default_factory=dict)
    signals: dict = Field(default_factory=dict)
    hours_passed: float = 0.1


class TurnResponse(BaseModel):
    scene_id: str
    resolved_characters: list[ResolvedCharacter]
    renderer_payload: dict


@router.post("/resolve", response_model=TurnResponse)
async def resolve_turn(request: TurnRequest) -> TurnResponse:
    signals = SceneSignals(**{
        **{k: v for k, v in request.signals.items() if k in SceneSignals.model_fields},
        "hours_passed": request.hours_passed,
        "extra": {k: v for k, v in request.signals.items() if k not in SceneSignals.model_fields},
    })

    resolved: list[ResolvedCharacter] = []
    for char in request.characters:
        rel = request.relationships.get(char.id, Relationship(character_id=char.id))
        result = CharacterRuntimeService.resolve(char, rel, signals)
        resolved.append(result)

    payload_map = {}
    for r in resolved:
        payload_map[r.character_id] = r.renderer_payload.model_dump()

    return TurnResponse(
        scene_id=request.scene_id,
        resolved_characters=resolved,
        renderer_payload=payload_map,
    )
