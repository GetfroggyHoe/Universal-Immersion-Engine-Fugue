from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_romance(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []
    states = character.runtime.states

    romantic_interest = get_state(states, "romantic_interest")
    sexual_tension = get_state(states, "sexual_tension")
    temptation = get_state(states, "temptation")
    yearning = get_state(states, "yearning")
    restraint = get_state(states, "restraint")
    emotional_safety = get_state(states, "emotional_safety")
    fluster = get_state(states, "fluster")
    avoidance = get_state(states, "avoidance_pressure")
    intimacy_discomfort = get_state(states, "intimacy_discomfort")

    base = (
        romantic_interest * 0.20
        + sexual_tension * 0.15
        + temptation * 0.15
        + yearning * 0.15
        + relationship.attraction * 0.15
        + relationship.affection * 0.10
        + emotional_safety * 0.15
        - restraint * 0.25
        - relationship.fear * 0.10
        - relationship.resentment * 0.10
        - avoidance * 0.30
        - intimacy_discomfort * 0.25
    )

    if signals.intimacy_level > 40:
        base += 10
    if signals.private_setting:
        base += 8

    scores.append(BehaviorScore(
        behavior="initiate_closeness",
        score=base,
        reason=["romantic_approach", "attraction"],
    ))

    eye_score = base * 0.75
    if signals.intimacy_level > 30:
        eye_score += 8
    if fluster > 40:
        eye_score += 5
    scores.append(BehaviorScore(
        behavior="hold_eye_contact",
        score=eye_score,
        reason=["sustained_gaze", "romantic_signal"],
    ))

    reach_score = base * 0.70
    if sexual_tension > 50:
        reach_score += 8
    if restraint > 50:
        reach_score -= 5
    scores.append(BehaviorScore(
        behavior="reach_then_stop",
        score=reach_score,
        reason=["hesitated_physical_contact"],
    ))

    close_score = base * 0.85
    if signals.private_setting:
        close_score += 6
    if temptation > 50:
        close_score += 8
    scores.append(BehaviorScore(
        behavior="close_distance",
        score=close_score,
        reason=["physical_approach"],
    ))

    test_score = base * 0.65
    if emotional_safety > 50:
        test_score += 8
    scores.append(BehaviorScore(
        behavior="test_boundary",
        score=test_score,
        reason=["probing_emotional_response"],
    ))

    honest_score = base * 0.70
    if emotional_safety > 60:
        honest_score += 10
    if get_trait(character, "honesty") > 60:
        honest_score += 6
    scores.append(BehaviorScore(
        behavior="offer_intimate_honesty",
        score=honest_score,
        reason=["emotional_vulnerability"],
    ))

    return scores
