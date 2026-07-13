from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_withdrawal(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []
    states = character.runtime.states

    avoidance = get_state(states, "avoidance_pressure")
    intimacy_discomfort = get_state(states, "intimacy_discomfort")
    shame = get_state(states, "shame")
    fear = get_state(states, "fear")
    emotional_suppression = get_state(states, "emotional_suppression")

    base = (
        avoidance * 0.25
        + intimacy_discomfort * 0.20
        + shame * 0.20
        + fear * 0.15
        + emotional_suppression * 0.20
        + relationship.resentment * 0.10
        + relationship.fear * 0.10
        - get_trait(character, "courage") * 0.15
        - get_trait(character, "impulsiveness") * 0.10
        - relationship.comfort * 0.10
    )

    if signals.player_rejected_npc:
        base += 18
    if signals.player_is_leaving:
        base += 8

    if signals.player_rejected_npc:
        base += 15
    if signals.intimacy_level > 50 and intimacy_discomfort > 40:
        base += 12
    if signals.humiliation_level > 40:
        base += 10

    scores.append(BehaviorScore(
        behavior="withdraw",
        score=base,
        reason=["avoidance", "emotional_retreat"],
    ))

    scores.append(BehaviorScore(
        behavior="go_quiet",
        score=base * 0.85 + shame * 0.10,
        reason=["silence_as_defense"],
    ))

    formal_score = base * 0.75
    if signals.public_setting:
        formal_score += 10
    scores.append(BehaviorScore(
        behavior="become_formal",
        score=formal_score,
        reason=["emotional_distance_through_formality"],
    ))

    scores.append(BehaviorScore(
        behavior="avoid_eye_contact",
        score=base * 0.70 + intimacy_discomfort * 0.10,
        reason=["nonverbal_withdrawal"],
    ))

    leave_score = base * 0.80
    if signals.player_is_leaving:
        leave_score -= 10
    if avoidance > 60:
        leave_score += 8
    scores.append(BehaviorScore(
        behavior="leave_room",
        score=leave_score,
        reason=["physical_withdrawal"],
    ))

    scores.append(BehaviorScore(
        behavior="create_distance",
        score=base * 0.75,
        reason=["spatial_emotional_distance"],
    ))

    return scores
