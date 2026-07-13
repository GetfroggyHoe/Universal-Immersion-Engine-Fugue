from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_comfort(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []
    states = character.runtime.states
    empathy = get_trait(character, "empathy")
    kindness = get_trait(character, "kindness")

    concern = get_state(states, "concern")
    comfort_drive = get_state(states, "comfort_drive")
    protective_tenderness = get_state(states, "protective_tenderness")

    base = (
        concern * 0.30
        + comfort_drive * 0.25
        + protective_tenderness * 0.20
        + empathy * 0.15
        + kindness * 0.10
        + relationship.affection * 0.15
        - relationship.resentment * 0.20
        - get_state(states, "anger") * 0.15
    )

    if signals.player_is_injured:
        base += 20
    if signals.player_showed_vulnerability:
        base += 12

    scores.append(BehaviorScore(
        behavior="comfort_player",
        score=base,
        reason=["concern", "empathy", "comfort_drive"],
    ))

    scores.append(BehaviorScore(
        behavior="offer_practical_help",
        score=base * 0.85 + get_trait(character, "discipline") * 0.10,
        reason=["practical_empathy", "discipline"],
    ))

    stay_near = base * 0.70
    if get_state(states, "intimacy_discomfort") > 50:
        stay_near += 10
    scores.append(BehaviorScore(
        behavior="stay_near_without_touching",
        score=stay_near,
        reason=["proximity_without_intimacy"],
    ))

    scores.append(BehaviorScore(
        behavior="soften_voice",
        score=base * 0.75 + relationship.comfort * 0.10,
        reason=["gentle_approach"],
    ))

    supply_score = base * 0.60
    if signals.player_is_injured:
        supply_score += 15
    scores.append(BehaviorScore(
        behavior="bring_supplies",
        score=supply_score,
        reason=["practical_care"],
    ))

    return scores
