from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_confrontation(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []
    states = character.runtime.states

    anger = get_state(states, "anger")
    defiance = get_state(states, "defiance")
    revenge_drive = get_state(states, "revenge_drive")
    humiliation = get_state(states, "humiliation")

    base = (
        anger * 0.25
        + defiance * 0.20
        + revenge_drive * 0.15
        + humiliation * 0.15
        + get_trait(character, "pride") * 0.10
        + get_trait(character, "impulsiveness") * 0.10
        + get_trait(character, "dominance") * 0.05
        - get_trait(character, "patience") * 0.15
        - get_trait(character, "self_control") * 0.15
        - get_trait(character, "forgiveness") * 0.10
    )

    if signals.player_insulted_npc:
        base += 18
    if signals.humiliation_level > 30:
        base += 12
    if signals.trust_violation > 40:
        base += 10

    scores.append(BehaviorScore(
        behavior="confront",
        score=base,
        reason=["anger", "direct_confrontation"],
    ))

    demand_score = base * 0.85
    if signals.player_lied_to_npc:
        demand_score += 15
    if get_state(states, "suspicion") > 50:
        demand_score += 10
    scores.append(BehaviorScore(
        behavior="demand_answer",
        score=demand_score,
        reason=["demanding_truth"],
    ))

    scores.append(BehaviorScore(
        behavior="name_the_problem",
        score=base * 0.80 + get_trait(character, "honesty") * 0.10,
        reason=["direct_acknowledgment"],
    ))

    cutoff_score = base * 0.70
    if signals.player_lied_to_npc:
        cutoff_score += 10
    scores.append(BehaviorScore(
        behavior="cut_off_excuse",
        score=cutoff_score,
        reason=["rejecting_explanation"],
    ))

    raise_score = base * 0.75
    if signals.humiliation_level > 50:
        raise_score += 12
    if anger > 70:
        raise_score += 8
    scores.append(BehaviorScore(
        behavior="raise_voice",
        score=raise_score,
        reason=["vocal_escalation"],
    ))

    step_score = base * 0.65
    if signals.intimacy_level > 30:
        step_score += 8
    if get_trait(character, "dominance") > 60:
        step_score += 6
    scores.append(BehaviorScore(
        behavior="step_closer",
        score=step_score,
        reason=["physical_intimidation"],
    ))

    return scores
