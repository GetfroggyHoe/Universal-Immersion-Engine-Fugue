from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_empathy(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states
    empathy = get_trait(character, "empathy")
    affection = relationship.affection

    if "concern" in states:
        if signals.player_is_injured:
            add_state(character, "concern", 20 + empathy * 0.2)
        if signals.player_showed_vulnerability:
            add_state(character, "concern", 12 + empathy * 0.15)
        if signals.vulnerability_level > 30:
            add_state(character, "concern", signals.vulnerability_level * 0.2)
        if affection > 50:
            add_state(character, "concern", affection * 0.1)

    if "comfort_drive" in states:
        if signals.player_is_injured:
            add_state(character, "comfort_drive", 18 + empathy * 0.2)
        if signals.player_showed_vulnerability:
            add_state(character, "comfort_drive", 10 + empathy * 0.1)
        if get_state(states, "concern") > 50:
            add_state(character, "comfort_drive", get_state(states, "concern") * 0.25)
        if relationship.resentment > 60:
            add_state(character, "comfort_drive", -relationship.resentment * 0.1)

    if "protective_tenderness" in states:
        if signals.player_is_injured:
            add_state(character, "protective_tenderness", 15 + empathy * 0.15)
        if signals.player_showed_vulnerability:
            add_state(character, "protective_tenderness", 10 + affection * 0.1)
        if get_state(states, "concern") > 40 and affection > 40:
            add_state(character, "protective_tenderness", 12)

    if "mercy" in states:
        if signals.player_showed_vulnerability:
            add_state(character, "mercy", 15 + empathy * 0.2)
        if get_state(states, "anger") > 60:
            add_state(character, "mercy", -get_state(states, "anger") * 0.1)
        if relationship.resentment < 30:
            add_state(character, "mercy", 8)

    if "guilt_pressure" in states:
        if signals.player_lied_to_npc:
            add_state(character, "guilt_pressure", -5)
        if signals.player_is_injured and get_state(states, "anger") > 40:
            add_state(character, "guilt_pressure", 15 + empathy * 0.15)
        if signals.player_rejected_npc and empathy > 60:
            add_state(character, "guilt_pressure", 10)

    return character
