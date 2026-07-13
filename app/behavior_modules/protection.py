from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_protection(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []
    states = character.runtime.states

    protective_aggression = get_state(states, "protective_aggression")
    concern = get_state(states, "concern")
    duty_pressure = get_state(states, "duty_pressure")
    threat_assessment = get_state(states, "threat_assessment")

    base = (
        protective_aggression * 0.25
        + concern * 0.20
        + duty_pressure * 0.15
        + threat_assessment * 0.15
        + relationship.attachment * 0.10
        + relationship.affection * 0.10
        + get_trait(character, "courage") * 0.10
        + get_trait(character, "discipline") * 0.05
        - get_trait(character, "selfishness", 30) * 0.10
    )

    if signals.danger_level > 30:
        base += 15
    if signals.player_is_injured:
        base += 18

    scores.append(BehaviorScore(
        behavior="protect_player",
        score=base,
        reason=["protective_instinct", "attachment"],
    ))

    intercept_score = base * 0.85
    if signals.rival_present and signals.rival_attention > 40:
        intercept_score += 12
    if signals.danger_level > 50:
        intercept_score += 10
    scores.append(BehaviorScore(
        behavior="move_between_player_and_threat",
        score=intercept_score,
        reason=["physical_interposition"],
    ))

    scores.append(BehaviorScore(
        behavior="remove_threat",
        score=base * 0.80 + get_trait(character, "courage") * 0.10,
        reason=["active_threat_elimination"],
    ))

    guard_score = base * 0.70
    if signals.player_is_leaving:
        guard_score += 8
    scores.append(BehaviorScore(
        behavior="guard_exit",
        score=guard_score,
        reason=["positional_protection"],
    ))

    check_score = base * 0.75
    if signals.player_is_injured:
        check_score += 15
    scores.append(BehaviorScore(
        behavior="check_injury",
        score=check_score,
        reason=["injury_assessment"],
    ))

    return scores
