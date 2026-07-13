from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_attachment(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    states = character.runtime.states

    if "fear_of_loss" in states:
        if signals.player_is_leaving:
            add_state(character, "fear_of_loss", 18 + relationship.attachment * 0.15)
        if signals.player_rejected_npc:
            add_state(character, "fear_of_loss", 22 + get_trait(character, "rejection_sensitivity") * 0.2)
        if signals.time_since_last_contact_hours > 12:
            add_state(character, "fear_of_loss", signals.time_since_last_contact_hours * 0.3)
        if relationship.trust < 40:
            add_state(character, "fear_of_loss", (40 - relationship.trust) * 0.1)
        if relationship.attachment > 60:
            add_state(character, "fear_of_loss", relationship.attachment * 0.05)

    if "reassurance_hunger" in states:
        if signals.player_rejected_npc:
            add_state(character, "reassurance_hunger", 20)
        if signals.player_is_leaving:
            add_state(character, "reassurance_hunger", 15)
        if get_state(states, "fear_of_loss") > 50:
            add_state(character, "reassurance_hunger", get_state(states, "fear_of_loss") * 0.2)

    if "abandonment_panic" in states:
        if signals.player_is_leaving and signals.player_rejected_npc:
            add_state(character, "abandonment_panic", 25 + get_trait(character, "rejection_sensitivity") * 0.25)
        elif signals.player_is_leaving:
            add_state(character, "abandonment_panic", 12)
        if get_state(states, "fear_of_loss") > 75:
            add_state(character, "abandonment_panic", 10)

    if "cling_pressure" in states:
        if get_state(states, "fear_of_loss") > 50:
            add_state(character, "cling_pressure", get_state(states, "fear_of_loss") * 0.25)
        if signals.time_since_last_contact_hours > 8:
            add_state(character, "cling_pressure", signals.time_since_last_contact_hours * 0.4)
        if relationship.attachment > 70:
            add_state(character, "cling_pressure", relationship.attachment * 0.1)

    if "avoidance_pressure" in states:
        if signals.intimacy_level > 50:
            add_state(character, "avoidance_pressure", signals.intimacy_level * 0.25)
        if signals.player_showed_vulnerability:
            add_state(character, "avoidance_pressure", 10)
        if relationship.attachment > 60 and get_trait(character, "empathy") < 40:
            add_state(character, "avoidance_pressure", relationship.attachment * 0.1)

    if "intimacy_discomfort" in states:
        if signals.intimacy_level > 40:
            add_state(character, "intimacy_discomfort", signals.intimacy_level * 0.2)
        if signals.private_setting:
            add_state(character, "intimacy_discomfort", 8)
        if signals.player_showed_vulnerability:
            add_state(character, "intimacy_discomfort", 12)

    if "attachment_pull" in states:
        if signals.player_is_leaving:
            add_state(character, "attachment_pull", 15 + relationship.attachment * 0.2)
        if signals.time_since_last_contact_hours > 6:
            add_state(character, "attachment_pull", signals.time_since_last_contact_hours * 0.3)

    return character
