from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.state_modules.registry import register_state_module
from app.utils.math_utils import add_state, get_state, get_trait


@register_state_module
def process_base_emotion(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> Character:
    if signals.player_insulted_npc:
        add_state(character, "anger", 15 + get_trait(character, "pride") * 0.15)
        add_state(character, "shame", 10 + signals.humiliation_level * 0.2)
        add_state(character, "stress", 8)

    if signals.player_lied_to_npc:
        add_state(character, "suspicion", 12 + signals.trust_violation * 0.3)
        add_state(character, "anger", 8)
        add_state(character, "stress", 6)

    if signals.trust_violation > 30:
        add_state(character, "anger", signals.trust_violation * 0.15)
        add_state(character, "suspicion", signals.trust_violation * 0.2)

    if signals.danger_level > 20:
        add_state(character, "fear", signals.danger_level * 0.3)
        add_state(character, "stress", signals.danger_level * 0.25)
        add_state(character, "confidence", -signals.danger_level * 0.1)

    if signals.humiliation_level > 20:
        add_state(character, "shame", signals.humiliation_level * 0.35)
        add_state(character, "anger", signals.humiliation_level * 0.15)
        add_state(character, "stress", signals.humiliation_level * 0.1)

    if signals.player_is_injured:
        add_state(character, "stress", 10)
        add_state(character, "fear", 6)

    if signals.player_showed_vulnerability:
        add_state(character, "stress", -3)
        if get_trait(character, "empathy") > 60:
            add_state(character, "anger", -2)

    if signals.social_pressure > 40:
        add_state(character, "stress", signals.social_pressure * 0.15)

    if signals.player_rejected_npc:
        add_state(character, "shame", 12 + get_trait(character, "rejection_sensitivity") * 0.2)
        add_state(character, "anger", 6)
        add_state(character, "stress", 8)

    return character
