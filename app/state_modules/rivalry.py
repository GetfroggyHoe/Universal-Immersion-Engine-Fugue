from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_rivalry(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states

    if not signals.rival_present and signals.rival_attention <= 0:
        return character

    if "envy" in states:
        if signals.rival_attention > 30:
            add_state(character, "envy", signals.rival_attention * 0.25)
        if signals.public_setting:
            add_state(character, "envy", 8)
        if relationship.respect < 40:
            add_state(character, "envy", (40 - relationship.respect) * 0.1)

    if "competitive_pressure" in states:
        if signals.rival_attention > 30:
            add_state(character, "competitive_pressure", signals.rival_attention * 0.3)
        if signals.public_setting:
            add_state(character, "competitive_pressure", 10)
        add_state(character, "competitive_pressure", get_trait(character, "ambition") * 0.08)

    if "humiliation" in states:
        if signals.humiliation_level > 20:
            add_state(character, "humiliation", signals.humiliation_level * 0.3)
        if signals.rival_present and signals.public_setting:
            add_state(character, "humiliation", 12)

    if "defiance" in states:
        if signals.humiliation_level > 30:
            add_state(character, "defiance", signals.humiliation_level * 0.2)
        if signals.player_insulted_npc:
            add_state(character, "defiance", 15)
        if get_trait(character, "pride") > 60:
            add_state(character, "defiance", get_trait(character, "pride") * 0.1)

    if "revenge_drive" in states:
        if signals.humiliation_level > 40:
            add_state(character, "revenge_drive", signals.humiliation_level * 0.15)
        if signals.rival_attention > 50:
            add_state(character, "revenge_drive", signals.rival_attention * 0.1)

    if "territoriality" in states:
        if signals.rival_attention > 40:
            add_state(character, "territoriality", signals.rival_attention * 0.2)
        if signals.intimacy_level > 30:
            add_state(character, "territoriality", signals.intimacy_level * 0.1)

    return character
