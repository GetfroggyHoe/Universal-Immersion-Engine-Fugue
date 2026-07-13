from __future__ import annotations

from app.models.behavior import BehaviorResult, BehaviorScore, InternalConflict
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals
from app.behavior_modules.registry import BEHAVIOR_SCORERS
from app.utils.math_utils import get_state

CONTRADICTIONS: list[tuple[str, str]] = [
    ("initiate_closeness", "withdraw"),
    ("comfort_player", "confront"),
    ("protect_player", "take_control"),
    ("offer_intimate_honesty", "become_formal"),
    ("close_distance", "create_distance"),
    ("hold_eye_contact", "avoid_eye_contact"),
    ("soften_voice", "raise_voice"),
    ("stay_near_without_touching", "leave_room"),
    ("demand_answer", "go_quiet"),
    ("challenge_rival", "withdraw"),
    ("interfere_with_rival", "become_formal"),
]

BEHAVIOR_THRESHOLD = 25.0
INERTIA_CURRENT_BONUS = 12.0
INERTIA_LAST_BONUS = 5.0
COOLDOWN_PENALTY_PER_POINT = 0.5


def collect_behavior_scores(
    character: Character,
    relationship: Relationship,
    signals: SceneSignals,
) -> list[BehaviorScore]:
    all_scores: list[BehaviorScore] = []
    for scorer in BEHAVIOR_SCORERS:
        results = scorer(character, relationship, signals)
        all_scores.extend(results)
    return all_scores


def apply_inertia_and_cooldowns(
    character: Character,
    scores: list[BehaviorScore],
) -> list[BehaviorScore]:
    for s in scores:
        if s.behavior == character.current_behavior:
            s.score += INERTIA_CURRENT_BONUS
            s.reason.append("inertia_current")
        if s.behavior == character.last_behavior:
            s.score += INERTIA_LAST_BONUS
            s.reason.append("inertia_last")
        if s.behavior in character.behavior_cooldowns:
            penalty = character.behavior_cooldowns[s.behavior] * COOLDOWN_PENALTY_PER_POINT
            s.score -= penalty
            s.reason.append(f"cooldown_penalty:{penalty:.1f}")
    return scores


def detect_internal_conflict(scores: list[BehaviorScore]) -> InternalConflict | None:
    sorted_scores = sorted(scores, key=lambda s: s.score, reverse=True)
    if len(sorted_scores) < 2:
        return None

    top = sorted_scores[0]
    for second in sorted_scores[1:]:
        for a, b in CONTRADICTIONS:
            if (top.behavior == a and second.behavior == b) or \
               (top.behavior == b and second.behavior == a):
                gap = top.score - second.score
                if gap < 15 and second.score > BEHAVIOR_THRESHOLD:
                    intensity = (top.score + second.score) / 2
                    return InternalConflict(
                        primary=top.behavior,
                        secondary=second.behavior,
                        meaning=f"wants {top.behavior} but pulled toward {second.behavior}",
                        conflict_intensity=round(intensity, 1),
                    )
    return None


def select_behavior(
    character: Character,
    scores: list[BehaviorScore],
) -> tuple[BehaviorScore, InternalConflict | None]:
    scores = apply_inertia_and_cooldowns(character, scores)
    sorted_scores = sorted(scores, key=lambda s: s.score, reverse=True)

    conflict = detect_internal_conflict(sorted_scores)

    if sorted_scores and sorted_scores[0].score >= BEHAVIOR_THRESHOLD:
        return sorted_scores[0], conflict

    return BehaviorScore(
        behavior="neutral_continue_current_task",
        score=0,
        reason=["no_behavior_exceeded_threshold"],
    ), conflict


def select_variant(
    behavior: str,
    signals: SceneSignals,
    character: Character,
    relationship: Relationship,
) -> str:
    states = character.runtime.states

    if behavior == "take_control":
        if signals.player_is_leaving:
            return "block_exit"
        if signals.rival_attention > 50:
            return "move_between_player_and_rival"
        if signals.player_is_injured:
            return "insist_on_accompanying_player"
        return "redirect_conversation"

    if behavior == "confront":
        if signals.player_lied_to_npc:
            return "demand_truth"
        if signals.humiliation_level > 50:
            return "raise_voice"
        if signals.trust_violation > 40:
            return "name_the_problem"
        return "direct_confrontation"

    if behavior == "withdraw":
        if signals.public_setting:
            return "become_formal"
        if get_state(states, "shame") > 50:
            return "avoid_eye_contact"
        if get_state(states, "avoidance_pressure") > 60:
            return "leave_room"
        return "go_quiet"

    if behavior == "comfort_player":
        if signals.player_is_injured:
            return "check_injury"
        if signals.player_showed_vulnerability:
            return "soften_voice"
        return "offer_practical_help"

    if behavior == "protect_player":
        if signals.rival_present:
            return "move_between_player_and_threat"
        if signals.player_is_injured:
            return "check_injury"
        if signals.danger_level > 50:
            return "remove_threat"
        return "guard_exit"

    if behavior == "initiate_closeness":
        if signals.private_setting:
            return "close_distance"
        if get_state(states, "restraint") > 50:
            return "reach_then_stop"
        return "hold_eye_contact"

    if behavior == "interfere_with_rival":
        if signals.rival_attention > 60:
            return "move_between_player_and_rival"
        if signals.public_setting:
            return "mark_territory_socially"
        return "undercut_rival"

    if behavior == "neutral_continue_current_task":
        return "neutral"

    return "default"


def apply_consequences(
    character: Character,
    relationship: Relationship,
    behavior: str,
) -> tuple[Character, Relationship]:
    from app.utils.math_utils import add_state, modify_rel

    consequences = _get_consequences(behavior)

    for key, amount in consequences.get("states", {}).items():
        add_state(character, key, amount)

    for key, amount in consequences.get("relationship", {}).items():
        modify_rel(relationship, key, amount)

    character.last_behavior = character.current_behavior
    character.current_behavior = behavior

    if behavior in _HIGH_INTENSITY_BEHAVIORS:
        character.behavior_cooldowns[behavior] = 2.0

    return character, relationship


_HIGH_INTENSITY_BEHAVIORS = {
    "confront", "raise_voice", "block_exit", "demand_answer",
    "challenge_rival", "protect_player", "take_control",
    "interfere_with_rival", "remove_threat",
}


def _get_consequences(behavior: str) -> dict:
    table: dict[str, dict] = {
        "comfort_player": {
            "states": {"stress": -6, "shame": -3},
            "relationship": {"trust": 4, "comfort": 8},
        },
        "offer_practical_help": {
            "states": {"stress": -4},
            "relationship": {"trust": 3, "comfort": 5},
        },
        "stay_near_without_touching": {
            "states": {"stress": -2},
            "relationship": {"comfort": 3},
        },
        "soften_voice": {
            "states": {"anger": -4, "stress": -3},
            "relationship": {"comfort": 4},
        },
        "bring_supplies": {
            "states": {"stress": -3},
            "relationship": {"trust": 2, "comfort": 4},
        },
        "take_control": {
            "states": {"control_urge": -5, "stress": -2},
            "relationship": {"trust": -3, "suspicion": 2, "attachment": 3},
        },
        "block_exit": {
            "states": {"control_urge": -8, "fear": 3},
            "relationship": {"trust": -5, "fear": 4, "attachment": 2},
        },
        "answer_for_player": {
            "states": {"control_urge": -3},
            "relationship": {"respect": -3, "trust": -2},
        },
        "redirect_conversation": {
            "states": {"control_urge": -3},
            "relationship": {"trust": -1},
        },
        "insist_on_accompanying_player": {
            "states": {"control_urge": -4, "fear_of_loss": -3},
            "relationship": {"trust": -2, "attachment": 3},
        },
        "confront": {
            "states": {"anger": -8, "stress": -3},
            "relationship": {"resentment": 5, "trust": -4},
        },
        "demand_answer": {
            "states": {"anger": -5, "suspicion": -3},
            "relationship": {"trust": -3, "respect": -2},
        },
        "name_the_problem": {
            "states": {"anger": -4, "stress": -4},
            "relationship": {"trust": 2, "respect": 2},
        },
        "cut_off_excuse": {
            "states": {"anger": -3},
            "relationship": {"respect": -2, "trust": -2},
        },
        "raise_voice": {
            "states": {"anger": -10, "shame": 5, "stress": -2},
            "relationship": {"trust": -5, "fear": 5, "resentment": 3},
        },
        "step_closer": {
            "states": {"anger": -2, "control_urge": -2},
            "relationship": {"fear": 2},
        },
        "withdraw": {
            "states": {"shame": -4, "stress": -3},
            "relationship": {"comfort": -3, "attachment": -2},
        },
        "go_quiet": {
            "states": {"shame": -3, "anger": -2},
            "relationship": {"comfort": -2},
        },
        "become_formal": {
            "states": {"shame": -2},
            "relationship": {"comfort": -4, "respect": 2},
        },
        "avoid_eye_contact": {
            "states": {"shame": -3},
            "relationship": {"comfort": -2},
        },
        "leave_room": {
            "states": {"stress": -5, "shame": -2},
            "relationship": {"comfort": -5, "attachment": -3},
        },
        "create_distance": {
            "states": {"stress": -3},
            "relationship": {"comfort": -3},
        },
        "protect_player": {
            "states": {"stress": -5, "protective_aggression": -5},
            "relationship": {"trust": 5, "attachment": 4},
        },
        "move_between_player_and_threat": {
            "states": {"protective_aggression": -8, "stress": -3},
            "relationship": {"trust": 4, "attachment": 3},
        },
        "remove_threat": {
            "states": {"protective_aggression": -10, "adrenaline": -5},
            "relationship": {"trust": 5, "respect": 3},
        },
        "guard_exit": {
            "states": {"protective_aggression": -4},
            "relationship": {"trust": 2, "attachment": 2},
        },
        "check_injury": {
            "states": {"stress": -4, "concern": -5},
            "relationship": {"trust": 3, "comfort": 4},
        },
        "initiate_closeness": {
            "states": {"romantic_interest": -3, "restraint": -3},
            "relationship": {"affection": 4, "attraction": 3, "comfort": 2},
        },
        "hold_eye_contact": {
            "states": {"romantic_interest": -2},
            "relationship": {"attraction": 2, "comfort": 2},
        },
        "reach_then_stop": {
            "states": {"romantic_interest": -2, "restraint": 3},
            "relationship": {"attraction": 2},
        },
        "close_distance": {
            "states": {"romantic_interest": -4, "restraint": -4},
            "relationship": {"attraction": 4, "comfort": 3},
        },
        "test_boundary": {
            "states": {"romantic_interest": -2},
            "relationship": {"attraction": 2, "comfort": 1},
        },
        "offer_intimate_honesty": {
            "states": {"romantic_interest": -3, "stress": -4},
            "relationship": {"trust": 5, "affection": 4, "comfort": 3},
        },
        "interfere_with_rival": {
            "states": {"territoriality": -5, "envy": -3},
            "relationship": {"trust": -2, "respect": -2},
        },
        "move_between_player_and_rival": {
            "states": {"territoriality": -6, "control_urge": -4},
            "relationship": {"trust": -3, "attachment": 2},
        },
        "undercut_rival": {
            "states": {"envy": -4, "competitive_pressure": -3},
            "relationship": {"respect": -3},
        },
        "challenge_rival": {
            "states": {"competitive_pressure": -6, "defiance": -4},
            "relationship": {"respect": -2, "trust": -1},
        },
        "mark_territory_socially": {
            "states": {"territoriality": -4, "possessive_drive": -3},
            "relationship": {"trust": -2, "attachment": 2},
        },
        "neutral_continue_current_task": {
            "states": {},
            "relationship": {},
        },
    }

    return table.get(behavior, {"states": {}, "relationship": {}})
