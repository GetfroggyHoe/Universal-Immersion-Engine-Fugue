from __future__ import annotations

from fastapi import APIRouter

from app.services.state_pack_service import STATE_PACKS, STATE_REGISTRY
from app.state_modules.registry import STATE_MODULES
from app.behavior_modules.registry import BEHAVIOR_SCORERS

router = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/state-packs")
async def get_state_packs():
    return {
        "state_packs": STATE_PACKS,
        "total_packs": len(STATE_PACKS),
    }


@router.get("/modules")
async def get_modules():
    return {
        "state_modules": [fn.__name__ for fn in STATE_MODULES],
        "behavior_modules": [fn.__name__ for fn in BEHAVIOR_SCORERS],
        "total_state_modules": len(STATE_MODULES),
        "total_behavior_modules": len(BEHAVIOR_SCORERS),
    }


@router.get("/state-registry")
async def get_state_registry():
    return {
        "total_states": len(STATE_REGISTRY),
        "states": {
            sid: {
                "id": d.id,
                "label": d.label,
                "family": d.family,
                "tags": d.tags,
                "baseline": d.baseline,
                "decay_rate": d.default_decay_rate,
            }
            for sid, d in STATE_REGISTRY.items()
        },
    }
