from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_morality(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states

    if "duty_pressure" in states:
        if signals.danger_level > 30:
            add_state(character, "duty_pressure", signals.danger_level * 0.2)
        if signals.player_is_injured:
            add_state(character, "duty_pressure", 10)
        add_state(character, "duty_pressure", get_trait(character, "discipline") * 0.08)

    if "guilt_pressure" in states:
        if signals.trust_violation > 30:
            add_state(character, "guilt_pressure", signals.trust_violation * 0.15)
        if signals.player_lied_to_npc and get_trait(character, "honesty") > 60:
            add_state(character, "guilt_pressure", 12)
        if get_state(states, "anger") > 60 and get_trait(character, "forgiveness") > 50:
            add_state(character, "guilt_pressure", 8)

    if "revenge_drive" in states:
        if signals.player_insulted_npc:
            add_state(character, "revenge_drive", 12 + get_trait(character, "pride") * 0.1)
        if signals.trust_violation > 40:
            add_state(character, "revenge_drive", signals.trust_violation * 0.2)
        if relationship.resentment > 50:
            add_state(character, "revenge_drive", relationship.resentment * 0.15)
        add_state(character, "revenge_drive", -get_trait(character, "forgiveness") * 0.1)

    if "mercy" in states:
        if signals.player_showed_vulnerability:
            add_state(character, "mercy", 12 + get_trait(character, "kindness") * 0.15)
        if get_state(states, "revenge_drive") > 50:
            add_state(character, "mercy", -get_state(states, "revenge_drive") * 0.1)
        if get_trait(character, "forgiveness") > 60:
            add_state(character, "mercy", get_trait(character, "forgiveness") * 0.1)

    if "honor_pressure" in states:
        if signals.public_setting and signals.humiliation_level > 30:
            add_state(character, "honor_pressure", signals.humiliation_level * 0.2)
        if signals.player_insulted_npc:
            add_state(character, "honor_pressure", 10 + get_trait(character, "pride") * 0.1)

    if "justification" in states:
        if signals.trust_violation > 30:
            add_state(character, "justification", signals.trust_violation * 0.15)
        if get_state(states, "anger") > 50:
            add_state(character, "justification", get_state(states, "anger") * 0.1)

    if "corruption_pressure" in states:
        if get_state(states, "revenge_drive") > 60 and get_state(states, "mercy") < 30:
            add_state(character, "corruption_pressure", 15)
        if relationship.resentment > 60 and get_trait(character, "forgiveness") < 30:
            add_state(character, "corruption_pressure", 10)

    return character
