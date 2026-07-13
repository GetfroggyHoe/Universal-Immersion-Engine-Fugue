from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.runtime import ResolvedCharacter
from app.models.signals import SceneSignals
from app.services.character_runtime_service import CharacterRuntimeService

router = APIRouter(prefix="/characters", tags=["characters"])


class CharacterResolveRequest(BaseModel):
    character: Character
    relationship: Relationship = Relationship(character_id="npc")
    signals: dict = {}
    hours_passed: float = 0.1


@router.post("/resolve", response_model=ResolvedCharacter)
async def resolve_character(request: CharacterResolveRequest) -> ResolvedCharacter:
    signals = SceneSignals(**{
        **{k: v for k, v in request.signals.items() if k in SceneSignals.model_fields},
        "hours_passed": request.hours_passed,
        "extra": {k: v for k, v in request.signals.items() if k not in SceneSignals.model_fields},
    })
    request.relationship.character_id = request.character.id
    return CharacterRuntimeService.resolve(request.character, request.relationship, signals)
