from __future__ import annotations

from app.models.behavior import BehaviorResult
from app.models.character import Character
from app.models.relationship import Relationship
from app.models.runtime import RendererPayload


SHOW_THROUGH_MAP: dict[str, list[str]] = {
    "comfort_player": ["gentle proximity", "softened tone", "practical gestures"],
    "offer_practical_help": ["action over words", "quiet efficiency"],
    "stay_near_without_touching": ["physical closeness", "restrained body language"],
    "soften_voice": ["lowered volume", "gentle word choice"],
    "bring_supplies": ["quiet preparation", "anticipating needs"],
    "take_control": ["proximity", "controlled speech", "interruption", "physical positioning"],
    "block_exit": ["body blocking", "stepping into path", "firm voice"],
    "answer_for_player": ["speaking over", "finishing sentences"],
    "redirect_conversation": ["topic shifting", "selective attention"],
    "insist_on_accompanying_player": ["refusing to accept no", "physical following"],
    "confront": ["direct eye contact", "blunt language", "closing distance"],
    "demand_answer": ["repeated questions", "refusing to move on"],
    "name_the_problem": ["direct acknowledgment", "naming the tension"],
    "cut_off_excuse": ["interruption", "dismissive gesture"],
    "raise_voice": ["volume increase", "sharp tone", "uncontrolled emotion"],
    "step_closer": ["invading space", "physical pressure"],
    "withdraw": ["shorter replies", "physical retreat", "closed posture"],
    "go_quiet": ["silence", "minimal response", "avoiding engagement"],
    "become_formal": ["polite distance", "proper titles", "emotional wall"],
    "avoid_eye_contact": ["looking away", "focused on objects"],
    "leave_room": ["physical departure", "creating absence"],
    "create_distance": ["stepping back", "physical space"],
    "protect_player": ["positioning between", "scanning for threats", "alertness"],
    "move_between_player_and_threat": ["physical interposition", "blocking"],
    "remove_threat": ["aggressive action", "decisive movement"],
    "guard_exit": ["stationary vigilance", "watchful posture"],
    "check_injury": ["gentle examination", "careful questions"],
    "initiate_closeness": ["leaning in", "reduced distance", "open posture"],
    "hold_eye_contact": ["sustained gaze", "unbroken attention"],
    "reach_then_stop": ["hesitated hand movement", "pulled back gesture"],
    "close_distance": ["deliberate approach", "reduced space"],
    "test_boundary": ["probing question", "watching reaction"],
    "offer_intimate_honesty": ["vulnerable admission", "quiet confession"],
    "interfere_with_rival": ["positioning", "verbal redirection"],
    "move_between_player_and_rival": ["physical blocking", "claiming space"],
    "undercut_rival": ["backhanded compliment", "subtle dismissal"],
    "challenge_rival": ["direct confrontation", "status assertion"],
    "mark_territory_socially": ["possessive gesture", "public claim"],
    "neutral_continue_current_task": ["continuing current action"],
}

AVOID_ALWAYS: list[str] = [
    "explaining hidden math",
    "stating the character is obsessed directly",
    "writing the player's thoughts",
    "writing the player's actions",
    "narrating internal state values",
    "breaking character to explain motivations",
]


def build_renderer_payload(
    character: Character,
    relationship: Relationship,
    behavior_result: BehaviorResult,
) -> RendererPayload:
    behavior = behavior_result.chosen_behavior
    variant = behavior_result.behavior_variant

    show_through = SHOW_THROUGH_MAP.get(behavior, ["continuing current behavior"])
    if behavior_result.internal_conflict:
        secondary = behavior_result.internal_conflict.secondary
        secondary_shows = SHOW_THROUGH_MAP.get(secondary, [])
        show_through = show_through + [f"brief flash of {secondary}"]

    rel_snapshot: dict[str, float] = {}
    for key in ["trust", "respect", "affection", "attraction", "attachment",
                "resentment", "suspicion", "fear", "comfort"]:
        val = getattr(relationship, key, 0)
        if val != 0:
            rel_snapshot[key] = round(val, 1)

    return RendererPayload(
        character_id=character.id,
        character_name=character.name,
        chosen_behavior=behavior,
        behavior_variant=variant,
        dominant_states=behavior_result.dominant_states,
        relationship_snapshot=rel_snapshot,
        internal_conflict=behavior_result.internal_conflict,
        render_guidance={
            "show_through": show_through,
            "avoid": AVOID_ALWAYS,
        },
    )
