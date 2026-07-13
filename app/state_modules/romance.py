from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_romance(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states
    attraction = relationship.attraction
    comfort = relationship.comfort

    if "romantic_interest" in states:
        if signals.intimacy_level > 30:
            add_state(character, "romantic_interest", signals.intimacy_level * 0.2)
        if attraction > 40:
            add_state(character, "romantic_interest", attraction * 0.15)
        if signals.player_showed_vulnerability and comfort > 40:
            add_state(character, "romantic_interest", 8)

    if "sexual_tension" in states:
        if signals.intimacy_level > 50 and signals.private_setting:
            add_state(character, "sexual_tension", signals.intimacy_level * 0.25)
        if attraction > 60:
            add_state(character, "sexual_tension", attraction * 0.15)
        if get_state(states, "romantic_interest") > 50:
            add_state(character, "sexual_tension", get_state(states, "romantic_interest") * 0.2)

    if "restraint" in states:
        if get_state(states, "sexual_tension") > 50:
            add_state(character, "restraint", get_state(states, "sexual_tension") * 0.15)
        if signals.public_setting:
            add_state(character, "restraint", 10)
        add_state(character, "restraint", get_trait(character, "self_control") * 0.1)
        add_state(character, "restraint", get_trait(character, "discipline") * 0.08)

    if "temptation" in states:
        if get_state(states, "sexual_tension") > 40:
            add_state(character, "temptation", get_state(states, "sexual_tension") * 0.2)
        if signals.intimacy_level > 50:
            add_state(character, "temptation", signals.intimacy_level * 0.15)
        add_state(character, "temptation", -get_trait(character, "self_control") * 0.1)

    if "emotional_safety" in states:
        if relationship.trust > 60:
            add_state(character, "emotional_safety", relationship.trust * 0.15)
        if comfort > 50:
            add_state(character, "emotional_safety", comfort * 0.1)
        if signals.private_setting:
            add_state(character, "emotional_safety", 5)
        if relationship.fear > 40:
            add_state(character, "emotional_safety", -relationship.fear * 0.2)
        if relationship.resentment > 50:
            add_state(character, "emotional_safety", -relationship.resentment * 0.15)

    if "fluster" in states:
        if signals.intimacy_level > 40 and attraction > 40:
            add_state(character, "fluster", signals.intimacy_level * 0.15 + attraction * 0.1)
        if signals.player_showed_vulnerability and attraction > 30:
            add_state(character, "fluster", 8)

    if "yearning" in states:
        if signals.player_is_leaving:
            add_state(character, "yearning", 15 + attraction * 0.15)
        if signals.time_since_last_contact_hours > 10:
            add_state(character, "yearning", signals.time_since_last_contact_hours * 0.2)
        if get_state(states, "romantic_interest") > 50:
            add_state(character, "yearning", get_state(states, "romantic_interest") * 0.2)

    return character
