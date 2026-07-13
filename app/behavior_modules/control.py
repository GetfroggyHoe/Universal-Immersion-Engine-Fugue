from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_control(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []
    states = character.runtime.states

    control_urge = get_state(states, "control_urge")
    territoriality = get_state(states, "territoriality")
    possessive_drive = get_state(states, "possessive_drive")
    protective_aggression = get_state(states, "protective_aggression")
    fear_of_loss = get_state(states, "fear_of_loss")

    base = (
        control_urge * 0.30
        + territoriality * 0.15
        + possessive_drive * 0.15
        + protective_aggression * 0.10
        + fear_of_loss * 0.10
        + get_trait(character, "control_need") * 0.10
        + get_trait(character, "dominance") * 0.10
        - get_trait(character, "patience") * 0.10
        - get_trait(character, "self_control") * 0.10
    )

    if signals.danger_level > 30:
        base += 12
    if signals.rival_attention > 40:
        base += 10

    scores.append(BehaviorScore(
        behavior="take_control",
        score=base,
        reason=["control_urge", "dominance"],
    ))

    block_score = base * 0.85
    if signals.player_is_leaving:
        block_score += 20
    if fear_of_loss > 60:
        block_score += 10
    scores.append(BehaviorScore(
        behavior="block_exit",
        score=block_score,
        reason=["blocking_departure", "fear_of_loss"],
    ))

    scores.append(BehaviorScore(
        behavior="answer_for_player",
        score=base * 0.70 + get_trait(character, "dominance") * 0.15,
        reason=["speaking_over_player"],
    ))

    scores.append(BehaviorScore(
        behavior="redirect_conversation",
        score=base * 0.75 + get_trait(character, "control_need") * 0.10,
        reason=["conversational_control"],
    ))

    accompany_score = base * 0.80
    if signals.player_is_leaving:
        accompany_score += 8
    if signals.player_is_injured:
        accompany_score += 12
    scores.append(BehaviorScore(
        behavior="insist_on_accompanying_player",
        score=accompany_score,
        reason=["enforced_proximity"],
    ))

    return scores
