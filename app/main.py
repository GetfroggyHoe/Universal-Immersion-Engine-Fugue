from __future__ import annotations

from fastapi import FastAPI

from app.routers import turn_router, character_router, debug_router

import app.state_modules.base_emotion
import app.state_modules.attachment
import app.state_modules.control
import app.state_modules.empathy
import app.state_modules.romance
import app.state_modules.survival
import app.state_modules.morality
import app.state_modules.rivalry

import app.behavior_modules.comfort
import app.behavior_modules.control
import app.behavior_modules.confrontation
import app.behavior_modules.withdrawal
import app.behavior_modules.protection
import app.behavior_modules.romance
import app.behavior_modules.rivalry

from app.services.state_pack_service import _build_default_registry
_build_default_registry()

app = FastAPI(
    title="Character Runtime Engine",
    description="Deterministic character state resolution for AI roleplay/simulation",
    version="1.0.0",
)

app.include_router(turn_router.router)
app.include_router(character_router.router)
app.include_router(debug_router.router)


@app.get("/")
async def root():
    return {
        "service": "Character Runtime Engine",
        "version": "1.0.0",
        "endpoints": [
            "POST /turn/resolve",
            "POST /characters/resolve",
            "GET /debug/state-packs",
            "GET /debug/modules",
            "GET /debug/state-registry",
        ],
    }
