from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_control(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states

    if "control_urge" in states:
        if signals.danger_level > 20:
            add_state(character, "control_urge", signals.danger_level * 0.2)
        if signals.rival_attention > 40:
            add_state(character, "control_urge", signals.rival_attention * 0.15)
        if get_state(states, "fear_of_loss") > 50:
            add_state(character, "control_urge", get_state(states, "fear_of_loss") * 0.2)
        if relationship.trust < 40:
            add_state(character, "control_urge", (40 - relationship.trust) * 0.15)
        add_state(character, "control_urge", get_trait(character, "control_need") * 0.08)
        add_state(character, "control_urge", -get_trait(character, "self_control") * 0.05)

    if "territoriality" in states:
        if signals.rival_present and signals.rival_attention > 30:
            add_state(character, "territoriality", signals.rival_attention * 0.3)
        if signals.intimacy_level > 40:
            add_state(character, "territoriality", signals.intimacy_level * 0.1)
        if get_trait(character, "possessiveness") > 60:
            add_state(character, "territoriality", get_trait(character, "possessiveness") * 0.1)

    if "surveillance_urge" in states:
        if relationship.suspicion > 40:
            add_state(character, "surveillance_urge", relationship.suspicion * 0.2)
        if signals.rival_attention > 50:
            add_state(character, "surveillance_urge", signals.rival_attention * 0.15)
        if get_state(states, "fear_of_loss") > 60:
            add_state(character, "surveillance_urge", get_state(states, "fear_of_loss") * 0.15)
        if get_trait(character, "possessiveness") > 50:
            add_state(character, "surveillance_urge", get_trait(character, "possessiveness") * 0.1)

    if "possessive_drive" in states:
        if signals.rival_attention > 30:
            add_state(character, "possessive_drive", signals.rival_attention * 0.25)
        if relationship.attraction > 50:
            add_state(character, "possessive_drive", relationship.attraction * 0.1)
        if get_trait(character, "possessiveness") > 60:
            add_state(character, "possessive_drive", get_trait(character, "possessiveness") * 0.15)

    if "protective_aggression" in states:
        if signals.danger_level > 30:
            add_state(character, "protective_aggression", signals.danger_level * 0.25)
        if signals.player_is_injured:
            add_state(character, "protective_aggression", 15)
        if signals.rival_present and signals.rival_attention > 50:
            add_state(character, "protective_aggression", signals.rival_attention * 0.2)
        if get_state(states, "fear_of_loss") > 60:
            add_state(character, "protective_aggression", get_state(states, "fear_of_loss") * 0.15)

    return character
