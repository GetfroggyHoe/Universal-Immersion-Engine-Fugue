from __future__ import annotations

from app.models.state import StateDefinition, StateInstance
from app.models.character import Character, CharacterRuntimeState
from app.utils.math_utils import clamp

STATE_ALIASES: dict[str, str] = {
    "separation_anxiety": "fear_of_loss",
    "terror_of_being_left": "abandonment_panic",
    "clingy_fear": "cling_pressure",
    "possessiveness": "possessive_drive",
    "obsession": "obsessive_focus",
    "sadness": "sadness",
    "upset": "anger",
    "heartache": "fear_of_loss",
    "emotional_pain": "shame",
    "nervousness": "fear",
    "anxiety": "stress",
    "rage": "anger",
    "fury": "anger",
    "terror": "fear",
    "panic": "abandonment_panic",
    "jealous_rage": "anger",
    "hurt": "shame",
}

BASELINE_STATES: list[str] = [
    "stress",
    "anger",
    "fear",
    "fatigue",
    "confidence",
    "suspicion",
]

FAST_DECAY_STATES: set[str] = {
    "anger", "abandonment_panic", "fear", "adrenaline", "fluster",
    "shock", "shame", "stress",
}

SLOW_DECAY_STATES: set[str] = {
    "resentment", "suspicion", "fear_of_loss", "attachment_pull",
    "revenge_drive", "envy", "humiliation",
}

STATE_PACKS: dict[str, list[str]] = {
    "anxious_attachment": [
        "fear_of_loss",
        "reassurance_hunger",
        "cling_pressure",
        "abandonment_panic",
        "jealousy",
        "attachment_pull",
    ],
    "avoidant_attachment": [
        "intimacy_discomfort",
        "avoidance_pressure",
        "control_urge",
        "emotional_suppression",
        "freedom_pressure",
    ],
    "obsessive_fast_burn": [
        "obsessive_focus",
        "territoriality",
        "fear_of_loss",
        "possessive_drive",
        "surveillance_urge",
        "protective_aggression",
        "control_urge",
    ],
    "soft_empath": [
        "concern",
        "comfort_drive",
        "guilt_pressure",
        "emotional_safety",
        "mercy",
        "protective_tenderness",
    ],
    "rival": [
        "envy",
        "competitive_pressure",
        "humiliation",
        "defiance",
        "revenge_drive",
        "respect",
    ],
    "soldier": [
        "duty_pressure",
        "threat_assessment",
        "adrenaline",
        "fear",
        "discipline",
        "protective_aggression",
    ],
    "romantic_slow_burn": [
        "romantic_interest",
        "yearning",
        "restraint",
        "emotional_safety",
        "fluster",
        "temptation",
    ],
    "dangerous_protector": [
        "protective_aggression",
        "territoriality",
        "control_urge",
        "fear_of_loss",
        "threat_assessment",
        "duty_pressure",
        "possessive_drive",
    ],
    "guarded_healer": [
        "concern",
        "intimacy_discomfort",
        "avoidance_pressure",
        "emotional_suppression",
        "comfort_drive",
        "mercy",
        "guilt_pressure",
    ],
    "prideful_rival": [
        "envy",
        "competitive_pressure",
        "humiliation",
        "defiance",
        "revenge_drive",
        "pride_injury",
        "territoriality",
    ],
}

STATE_REGISTRY: dict[str, StateDefinition] = {}


def _build_default_registry() -> None:
    if STATE_REGISTRY:
        return

    defs: list[StateDefinition] = [
        StateDefinition(id="stress", label="Stress", family="base_emotion",
                        default_decay_rate=1.2, arousal=0.6, valence=-0.5, threat=0.4),
        StateDefinition(id="anger", label="Anger", family="base_emotion",
                        default_decay_rate=1.5, arousal=0.8, valence=-0.7, dominance=0.5, approach=0.6),
        StateDefinition(id="fear", label="Fear", family="base_emotion",
                        default_decay_rate=1.5, arousal=0.8, valence=-0.7, threat=0.8, avoidance=0.7),
        StateDefinition(id="fatigue", label="Fatigue", family="survival",
                        default_decay_rate=0.5, arousal=-0.4, valence=-0.3),
        StateDefinition(id="confidence", label="Confidence", family="base_emotion",
                        default_decay_rate=0.8, arousal=0.3, valence=0.6, dominance=0.5),
        StateDefinition(id="suspicion", label="Suspicion", family="base_emotion",
                        default_decay_rate=0.4, arousal=0.3, valence=-0.4, threat=0.5, social=0.3),
        StateDefinition(id="shame", label="Shame", family="base_emotion",
                        default_decay_rate=1.3, arousal=0.5, valence=-0.8, dominance=-0.6, social=0.5),
        StateDefinition(id="sadness", label="Sadness", family="base_emotion",
                        default_decay_rate=0.6, arousal=-0.3, valence=-0.7, dominance=-0.3),
        StateDefinition(id="fear_of_loss", label="Fear of Loss", family="attachment",
                        default_decay_rate=0.4, valence=-0.7, arousal=0.6, threat=0.7,
                        social=0.9, intimacy=0.7,
                        tags=["attachment", "romance", "threat"],
                        behavior_biases={"take_control": 0.35, "ask_for_reassurance": 0.45,
                                         "block_exit": 0.25, "withdraw": 0.12}),
        StateDefinition(id="reassurance_hunger", label="Reassurance Hunger", family="attachment",
                        default_decay_rate=0.6, valence=-0.4, arousal=0.5, social=0.9, approach=0.7,
                        tags=["attachment"]),
        StateDefinition(id="cling_pressure", label="Cling Pressure", family="attachment",
                        default_decay_rate=0.5, valence=-0.3, arousal=0.6, approach=0.8, social=0.9,
                        tags=["attachment"]),
        StateDefinition(id="abandonment_panic", label="Abandonment Panic", family="attachment",
                        default_decay_rate=1.4, valence=-0.9, arousal=0.9, threat=0.8, social=0.8,
                        tags=["attachment", "threat"]),
        StateDefinition(id="attachment_pull", label="Attachment Pull", family="attachment",
                        default_decay_rate=0.4, valence=-0.2, arousal=0.4, approach=0.7, social=0.9,
                        tags=["attachment"]),
        StateDefinition(id="jealousy", label="Jealousy", family="social_status",
                        default_decay_rate=0.7, valence=-0.7, arousal=0.8, dominance=0.4,
                        approach=0.5, social=1.0, threat=0.7, intimacy=0.6,
                        tags=["social", "attachment", "rivalry"]),
        StateDefinition(id="intimacy_discomfort", label="Intimacy Discomfort", family="attachment",
                        default_decay_rate=0.6, valence=-0.4, arousal=0.4, avoidance=0.8,
                        intimacy=0.7, tags=["attachment", "avoidance"]),
        StateDefinition(id="avoidance_pressure", label="Avoidance Pressure", family="attachment",
                        default_decay_rate=0.5, valence=-0.3, arousal=0.3, avoidance=0.9,
                        tags=["attachment", "avoidance"]),
        StateDefinition(id="emotional_suppression", label="Emotional Suppression", family="attachment",
                        default_decay_rate=0.4, valence=-0.2, arousal=-0.3, dominance=0.3,
                        tags=["attachment", "avoidance"]),
        StateDefinition(id="freedom_pressure", label="Freedom Pressure", family="attachment",
                        default_decay_rate=0.5, valence=-0.2, arousal=0.3, avoidance=0.7,
                        tags=["attachment", "avoidance"]),
        StateDefinition(id="obsessive_focus", label="Obsessive Focus", family="cognitive",
                        default_decay_rate=0.3, valence=-0.1, arousal=0.5, dominance=0.4,
                        social=0.7, tags=["cognitive", "attachment"]),
        StateDefinition(id="territoriality", label="Territoriality", family="control",
                        default_decay_rate=0.5, valence=-0.3, arousal=0.6, dominance=0.7,
                        approach=0.6, social=0.8, threat=0.5,
                        tags=["control", "rivalry", "romance"],
                        behavior_biases={"interfere_with_rival": 0.4, "move_between_player_and_rival": 0.35,
                                         "take_control": 0.3, "mark_territory_socially": 0.25}),
        StateDefinition(id="possessive_drive", label="Possessive Drive", family="control",
                        default_decay_rate=0.4, valence=-0.3, arousal=0.6, dominance=0.7,
                        social=0.8, threat=0.5, tags=["control", "romance"]),
        StateDefinition(id="surveillance_urge", label="Surveillance Urge", family="control",
                        default_decay_rate=0.5, valence=-0.3, arousal=0.4, dominance=0.5,
                        social=0.6, tags=["control"]),
        StateDefinition(id="protective_aggression", label="Protective Aggression", family="control",
                        default_decay_rate=0.7, valence=-0.2, arousal=0.8, dominance=0.8,
                        approach=0.7, threat=0.7, social=0.7,
                        tags=["control", "protection", "survival"],
                        behavior_biases={"protect_player": 0.4, "move_between_player_and_threat": 0.35}),
        StateDefinition(id="control_urge", label="Control Urge", family="control",
                        default_decay_rate=0.6, valence=-0.2, arousal=0.5, dominance=0.8,
                        approach=0.5, tags=["control"],
                        behavior_biases={"take_control": 0.4, "redirect_conversation": 0.3,
                                         "answer_for_player": 0.25}),
        StateDefinition(id="concern", label="Concern", family="base_emotion",
                        default_decay_rate=0.7, valence=-0.3, arousal=0.4, social=0.8,
                        approach=0.5, tags=["empathy", "social"],
                        behavior_biases={"comfort_player": 0.35, "check_injury": 0.3}),
        StateDefinition(id="comfort_drive", label="Comfort Drive", family="base_emotion",
                        default_decay_rate=0.6, valence=0.1, arousal=0.3, social=0.9,
                        approach=0.6, tags=["empathy", "social"]),
        StateDefinition(id="protective_tenderness", label="Protective Tenderness", family="base_emotion",
                        default_decay_rate=0.5, valence=0.3, arousal=0.3, social=0.9,
                        approach=0.5, intimacy=0.6, tags=["empathy", "romance"]),
        StateDefinition(id="guilt_pressure", label="Guilt Pressure", family="morality",
                        default_decay_rate=0.5, valence=-0.7, arousal=0.3, morality=0.8,
                        social=0.6, tags=["morality"]),
        StateDefinition(id="emotional_safety", label="Emotional Safety", family="romance",
                        default_decay_rate=0.4, valence=0.6, arousal=-0.2, intimacy=0.8,
                        social=0.7, tags=["romance", "attachment"]),
        StateDefinition(id="mercy", label="Mercy", family="morality",
                        default_decay_rate=0.5, valence=0.4, arousal=-0.2, morality=0.9,
                        dominance=-0.3, tags=["morality"]),
        StateDefinition(id="romantic_interest", label="Romantic Interest", family="romance",
                        default_decay_rate=0.4, valence=0.5, arousal=0.5, approach=0.7,
                        social=0.9, intimacy=0.7, tags=["romance"]),
        StateDefinition(id="sexual_tension", label="Sexual Tension", family="romance",
                        default_decay_rate=0.5, valence=0.3, arousal=0.8, approach=0.7,
                        intimacy=0.9, tags=["romance"]),
        StateDefinition(id="restraint", label="Restraint", family="romance",
                        default_decay_rate=0.5, valence=0.0, arousal=-0.3, dominance=0.3,
                        morality=0.4, tags=["romance"]),
        StateDefinition(id="temptation", label="Temptation", family="romance",
                        default_decay_rate=0.6, valence=0.2, arousal=0.7, approach=0.8,
                        intimacy=0.7, tags=["romance"]),
        StateDefinition(id="fluster", label="Fluster", family="romance",
                        default_decay_rate=1.3, valence=0.1, arousal=0.7, social=0.7,
                        intimacy=0.5, tags=["romance"]),
        StateDefinition(id="yearning", label="Yearning", family="romance",
                        default_decay_rate=0.4, valence=-0.2, arousal=0.5, approach=0.6,
                        social=0.8, intimacy=0.7, tags=["romance", "attachment"]),
        StateDefinition(id="envy", label="Envy", family="social_status",
                        default_decay_rate=0.5, valence=-0.7, arousal=0.6, dominance=0.2,
                        social=0.9, threat=0.4, tags=["rivalry", "social_status"]),
        StateDefinition(id="competitive_pressure", label="Competitive Pressure", family="social_status",
                        default_decay_rate=0.6, valence=-0.2, arousal=0.7, dominance=0.5,
                        approach=0.6, social=0.9, tags=["rivalry", "social_status"]),
        StateDefinition(id="humiliation", label="Humiliation", family="social_status",
                        default_decay_rate=0.6, valence=-0.9, arousal=0.6, dominance=-0.7,
                        social=0.9, tags=["social_status", "rivalry"]),
        StateDefinition(id="defiance", label="Defiance", family="social_status",
                        default_decay_rate=0.7, valence=-0.3, arousal=0.7, dominance=0.7,
                        approach=0.6, tags=["social_status", "rivalry"]),
        StateDefinition(id="respect", label="Respect", family="social_status",
                        default_decay_rate=0.3, valence=0.5, arousal=0.1, social=0.8,
                        tags=["social_status"]),
        StateDefinition(id="pride_injury", label="Pride Injury", family="social_status",
                        default_decay_rate=0.5, valence=-0.7, arousal=0.6, dominance=0.5,
                        tags=["social_status"]),
        StateDefinition(id="duty_pressure", label="Duty Pressure", family="morality",
                        default_decay_rate=0.5, valence=-0.1, arousal=0.4, dominance=0.4,
                        morality=0.8, tags=["morality", "survival"]),
        StateDefinition(id="threat_assessment", label="Threat Assessment", family="survival",
                        default_decay_rate=0.7, valence=-0.3, arousal=0.5, threat=0.9,
                        tags=["survival"]),
        StateDefinition(id="adrenaline", label="Adrenaline", family="survival",
                        default_decay_rate=1.5, valence=0.0, arousal=0.9, threat=0.7,
                        tags=["survival"]),
        StateDefinition(id="shock", label="Shock", family="survival",
                        default_decay_rate=1.2, valence=-0.5, arousal=0.8, threat=0.7,
                        tags=["survival"]),
        StateDefinition(id="injury_stress", label="Injury Stress", family="survival",
                        default_decay_rate=0.8, valence=-0.5, arousal=0.6, threat=0.6,
                        tags=["survival"]),
        StateDefinition(id="pain", label="Pain", family="survival",
                        default_decay_rate=1.0, valence=-0.8, arousal=0.7, tags=["survival"]),
        StateDefinition(id="hunger", label="Hunger", family="survival",
                        default_decay_rate=0.4, valence=-0.4, arousal=0.3, tags=["survival"]),
        StateDefinition(id="revenge_drive", label="Revenge Drive", family="morality",
                        default_decay_rate=0.3, valence=-0.6, arousal=0.7, dominance=0.6,
                        approach=0.6, morality=0.6, tags=["morality", "rivalry"]),
        StateDefinition(id="honor_pressure", label="Honor Pressure", family="morality",
                        default_decay_rate=0.5, valence=-0.1, arousal=0.4, dominance=0.5,
                        morality=0.8, social=0.7, tags=["morality"]),
        StateDefinition(id="justification", label="Justification", family="morality",
                        default_decay_rate=0.5, valence=-0.1, arousal=0.2, morality=0.7,
                        tags=["morality"]),
        StateDefinition(id="corruption_pressure", label="Corruption Pressure", family="morality",
                        default_decay_rate=0.3, valence=-0.5, arousal=0.4, dominance=0.5,
                        morality=0.9, tags=["morality"]),
        StateDefinition(id="curiosity", label="Curiosity", family="cognitive",
                        default_decay_rate=0.6, valence=0.4, arousal=0.4, approach=0.6,
                        tags=["cognitive"]),
        StateDefinition(id="doubt", label="Doubt", family="cognitive",
                        default_decay_rate=0.5, valence=-0.3, arousal=0.3, tags=["cognitive"]),
        StateDefinition(id="paranoia", label="Paranoia", family="cognitive",
                        default_decay_rate=0.4, valence=-0.6, arousal=0.6, threat=0.8,
                        tags=["cognitive"]),
        StateDefinition(id="discipline", label="Discipline", family="base_emotion",
                        default_decay_rate=0.3, valence=0.3, arousal=-0.1, dominance=0.4,
                        tags=["trait_state"]),
    ]

    for d in defs:
        STATE_REGISTRY[d.id] = d


def normalize_state_id(raw_id: str) -> str:
    clean = raw_id.lower().strip().replace(" ", "_").replace("-", "_")
    return STATE_ALIASES.get(clean, clean)


def get_decay_rate(state_id: str, base_rate: float = 1.0) -> float:
    if state_id in FAST_DECAY_STATES:
        return base_rate * 1.5
    if state_id in SLOW_DECAY_STATES:
        return base_rate * 0.4
    return base_rate


def build_runtime_state_for_character(character: Character) -> CharacterRuntimeState:
    _build_default_registry()

    states: dict[str, StateInstance] = {}

    for state_id in BASELINE_STATES:
        normalized = normalize_state_id(state_id)
        defn = STATE_REGISTRY.get(normalized)
        if defn:
            states[normalized] = StateInstance(
                state_id=normalized,
                value=defn.baseline,
                baseline=defn.baseline,
                decay_rate=get_decay_rate(normalized, defn.default_decay_rate),
                volatility=defn.default_volatility,
                min_value=defn.min_value,
                max_value=defn.max_value,
                source="baseline",
            )
        else:
            states[normalized] = StateInstance(
                state_id=normalized,
                value=0,
                baseline=0,
                decay_rate=get_decay_rate(normalized),
                source="baseline",
            )

    for pack_name in character.state_packs:
        pack_states = STATE_PACKS.get(pack_name, [])
        for state_id in pack_states:
            normalized = normalize_state_id(state_id)
            if normalized in states:
                continue
            defn = STATE_REGISTRY.get(normalized)
            if defn:
                states[normalized] = StateInstance(
                    state_id=normalized,
                    value=defn.baseline,
                    baseline=defn.baseline,
                    decay_rate=get_decay_rate(normalized, defn.default_decay_rate),
                    volatility=defn.default_volatility,
                    min_value=defn.min_value,
                    max_value=defn.max_value,
                    source=f"pack:{pack_name}",
                )
            else:
                states[normalized] = StateInstance(
                    state_id=normalized,
                    value=0,
                    baseline=0,
                    decay_rate=get_decay_rate(normalized),
                    source=f"pack:{pack_name}",
                )

    return CharacterRuntimeState(states=states)


def prune_states(character: Character, max_states: int = 40) -> Character:
    protected = set(BASELINE_STATES)
    items = list(character.runtime.states.items())
    sorted_items = sorted(
        items,
        key=lambda item: (
            item[0] in protected,
            item[1].value,
            abs(item[1].value - item[1].baseline),
        ),
        reverse=True,
    )
    kept = dict(sorted_items[:max_states])
    character.runtime.states = kept
    return character


def update_state_lifecycles(character: Character) -> Character:
    for state in character.runtime.states.values():
        if state.value <= 5:
            state.lifecycle = "inactive"
        elif state.value < 20:
            state.lifecycle = "latent"
        elif state.value < 50:
            state.lifecycle = "active"
        elif state.value < 80:
            state.lifecycle = "dominant"
        else:
            state.lifecycle = "overwhelming"
    return character


def decay_states(character: Character, hours_passed: float) -> Character:
    for state in character.runtime.states.values():
        if state.value > state.baseline:
            delta = (state.value - state.baseline) * state.decay_rate * hours_passed * 0.1
            state.value = clamp(state.value - delta, state.min_value, state.max_value)
        elif state.value < state.baseline:
            delta = (state.baseline - state.value) * state.decay_rate * hours_passed * 0.1
            state.value = clamp(state.value + delta, state.min_value, state.max_value)
    return character


def derive_composite_states(character: Character) -> Character:
    s = character.runtime.states
    traits = character.traits

    from app.utils.math_utils import get_state

    fear_of_loss = get_state(s, "fear_of_loss")
    territoriality = get_state(s, "territoriality")
    self_control = traits.get("self_control", 50)

    possessive_panic = fear_of_loss * 0.45 + territoriality * 0.40 - self_control * 0.25
    if possessive_panic >= 30:
        character.runtime.composite_states["possessive_panic"] = clamp(possessive_panic)

    romantic_conflict = (
        get_state(s, "romantic_interest", 0) * 0.35
        + get_state(s, "intimacy_discomfort", 0) * 0.35
        + get_state(s, "fear_of_loss", 0) * 0.30
    )
    if romantic_conflict >= 30:
        character.runtime.composite_states["romantic_conflict"] = clamp(romantic_conflict)

    revenge_fixation = (
        get_state(s, "humiliation", 0) * 0.30
        + get_state(s, "resentment", 0) * 0.30
        + get_state(s, "revenge_drive", 0) * 0.30
        + (100 - traits.get("forgiveness", 50)) * 0.10
    )
    if revenge_fixation >= 30:
        character.runtime.composite_states["revenge_fixation"] = clamp(revenge_fixation)

    protective_tenderness = (
        get_state(s, "concern", 0) * 0.30
        + get_state(s, "affection", 0) * 0.25
        + get_state(s, "emotional_safety", 0) * 0.25
        + traits.get("empathy", 50) * 0.20
    )
    if protective_tenderness >= 30:
        character.runtime.composite_states["protective_tenderness"] = clamp(protective_tenderness)

    cold_withdrawal = (
        get_state(s, "resentment", 0) * 0.35
        + get_state(s, "emotional_suppression", 0) * 0.30
        + (100 - get_state(s, "trust", 50)) * 0.35
    )
    if cold_withdrawal >= 30:
        character.runtime.composite_states["cold_withdrawal"] = clamp(cold_withdrawal)

    return character


def aggregate_dimensions(character: Character) -> dict[str, float]:
    totals = {
        "valence": 0.0, "arousal": 0.0, "dominance": 0.0, "approach": 0.0,
        "social": 0.0, "threat": 0.0, "intimacy": 0.0, "morality": 0.0,
    }
    total_weight = 0.0

    for instance in character.runtime.states.values():
        defn = STATE_REGISTRY.get(instance.state_id)
        if not defn:
            continue
        weight = instance.value / 100.0
        total_weight += weight
        for dim in totals:
            totals[dim] += getattr(defn, dim, 0.0) * weight

    if total_weight > 0:
        for dim in totals:
            totals[dim] /= total_weight

    character.runtime.emotional_dimensions = totals
    return totals
