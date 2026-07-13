from __future__ import annotations

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

from app.models.behavior import BehaviorResult
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.runtime import RendererPayload, ResolvedCharacter
from app.models.signals import SceneSignals
from app.services.state_pack_service import (
    build_runtime_state_for_character,
    decay_states,
    derive_composite_states,
    aggregate_dimensions,
    prune_states,
    update_state_lifecycles,
)
from app.services.behavior_service import (
    collect_behavior_scores,
    select_behavior,
    select_variant,
    apply_consequences,
)
from app.services.compiler_service import build_renderer_payload
from app.state_modules.registry import STATE_MODULES
from app.utils.math_utils import clamp


class CharacterRuntimeService:

    @staticmethod
    def resolve(
        character: Character,
        relationship: Relationship,
        signals: SceneSignals,
    ) -> ResolvedCharacter:
        if not character.runtime.states:
            character.runtime = build_runtime_state_for_character(character)

        decay_states(character, signals.hours_passed)

        for module_fn in STATE_MODULES:
            character = module_fn(character, relationship, signals)

        for state in character.runtime.states.values():
            state.value = clamp(state.value, state.min_value, state.max_value)

        derive_composite_states(character)
        aggregate_dimensions(character)
        update_state_lifecycles(character)

        all_scores = collect_behavior_scores(character, relationship, signals)
        best, conflict = select_behavior(character, all_scores)
        variant = select_variant(best.behavior, signals, character, relationship)

        dominant: dict[str, float] = {}
        latent: dict[str, float] = {}
        for sid, inst in character.runtime.states.items():
            if inst.lifecycle in ("dominant", "overwhelming"):
                dominant[sid] = round(inst.value, 1)
            elif inst.lifecycle == "active":
                latent[sid] = round(inst.value, 1)

        sorted_dominant = dict(sorted(dominant.items(), key=lambda x: x[1], reverse=True)[:5])
        sorted_latent = dict(sorted(latent.items(), key=lambda x: x[1], reverse=True)[:3])

        behavior_result = BehaviorResult(
            chosen_behavior=best.behavior,
            behavior_variant=variant,
            all_scores=all_scores,
            internal_conflict=conflict,
            dominant_states=sorted_dominant,
            latent_states=sorted_latent,
        )

        character, relationship = apply_consequences(character, relationship, best.behavior)

        for state in character.runtime.states.values():
            state.value = clamp(state.value, state.min_value, state.max_value)

        update_state_lifecycles(character)
        prune_states(character, character.max_active_states)

        for key in list(character.behavior_cooldowns.keys()):
            character.behavior_cooldowns[key] = max(
                0, character.behavior_cooldowns[key] - signals.hours_passed
            )
        character.behavior_cooldowns = {
            k: v for k, v in character.behavior_cooldowns.items() if v > 0
        }

        character.runtime.turn_count += 1
        character.runtime.last_resolved_turn = character.runtime.turn_count

        payload = build_renderer_payload(character, relationship, behavior_result)

        return ResolvedCharacter(
            character_id=character.id,
            character_name=character.name,
            behavior_result=behavior_result,
            renderer_payload=payload,
            updated_relationship=relationship,
        )
