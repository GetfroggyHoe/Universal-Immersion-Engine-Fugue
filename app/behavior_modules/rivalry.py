from __future__ import annotations

from app.models.behavior import BehaviorScore
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import register_behavior_scorer
from app.utils.math_utils import get_state, get_trait


@register_behavior_scorer
def score_rivalry(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    scores: list[BehaviorScore] = []

    if not signals.rival_present and signals.rival_attention <= 10:
        return scores

    states = character.runtime.states

    envy = get_state(states, "envy")
    competitive_pressure = get_state(states, "competitive_pressure")
    territoriality = get_state(states, "territoriality")
    humiliation = get_state(states, "humiliation")
    revenge_drive = get_state(states, "revenge_drive")

    base = (
        envy * 0.20
        + competitive_pressure * 0.20
        + territoriality * 0.15
        + humiliation * 0.15
        + revenge_drive * 0.10
        + signals.rival_attention * 0.15
        + get_trait(character, "pride") * 0.05
        - get_trait(character, "forgiveness") * 0.08
        - relationship.respect * 0.10
    )

    if signals.public_setting:
        base += 8

    scores.append(BehaviorScore(
        behavior="interfere_with_rival",
        score=base,
        reason=["rival_interference", "territoriality"],
    ))

    block_score = base * 0.85
    if territoriality > 50:
        block_score += 10
    if signals.rival_attention > 50:
        block_score += 8
    scores.append(BehaviorScore(
        behavior="move_between_player_and_rival",
        score=block_score,
        reason=["physical_blocking"],
    ))

    scores.append(BehaviorScore(
        behavior="undercut_rival",
        score=base * 0.80 + get_trait(character, "ambition") * 0.10,
        reason=["social_undermining"],
    ))

    challenge_score = base * 0.75
    if humiliation > 40:
        challenge_score += 10
    if get_trait(character, "dominance") > 60:
        challenge_score += 8
    scores.append(BehaviorScore(
        behavior="challenge_rival",
        score=challenge_score,
        reason=["direct_confrontation_with_rival"],
    ))

    mark_score = base * 0.70
    if signals.public_setting:
        mark_score += 10
    if signals.intimacy_level > 30:
        mark_score += 6
    scores.append(BehaviorScore(
        behavior="mark_territory_socially",
        score=mark_score,
        reason=["social_possession_display"],
    ))

    return scores
