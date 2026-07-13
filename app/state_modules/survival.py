from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_survival(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states

    if "fatigue" in states:
        add_state(character, "fatigue", signals.hours_passed * 2)
        if signals.danger_level > 50:
            add_state(character, "fatigue", -3)

    if "pain" in states:
        if signals.player_is_injured:
            pass
        if signals.danger_level > 60:
            add_state(character, "pain", 5)

    if "hunger" in states:
        add_state(character, "hunger", signals.hours_passed * 3)

    if "adrenaline" in states:
        if signals.danger_level > 30:
            add_state(character, "adrenaline", signals.danger_level * 0.35)
        if signals.player_is_injured:
            add_state(character, "adrenaline", 12)
        if get_state(states, "fear") > 50:
            add_state(character, "adrenaline", get_state(states, "fear") * 0.15)

    if "threat_assessment" in states:
        if signals.danger_level > 10:
            add_state(character, "threat_assessment", signals.danger_level * 0.3)
        if signals.rival_present:
            add_state(character, "threat_assessment", 10)
        if relationship.suspicion > 40:
            add_state(character, "threat_assessment", relationship.suspicion * 0.15)

    if "shock" in states:
        if signals.danger_level > 70:
            add_state(character, "shock", signals.danger_level * 0.2)
        if signals.player_is_injured and relationship.affection > 50:
            add_state(character, "shock", 15)

    if "injury_stress" in states:
        if signals.player_is_injured:
            add_state(character, "injury_stress", 20)
        if signals.danger_level > 50:
            add_state(character, "injury_stress", signals.danger_level * 0.15)

    return character
