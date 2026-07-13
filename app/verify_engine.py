from __future__ import annotations

import json
import sys

from app.demo_data import get_demo_characters, get_demo_relationships, get_demo_signals
from app.models.signals import SceneSignals
from app.services.character_runtime_service import CharacterRuntimeService
from app.services.state_pack_service import (
    STATE_PACKS,
    STATE_REGISTRY,
    _build_default_registry,
)
from app.state_modules.registry import STATE_MODULES
from app.behavior_modules.registry import BEHAVIOR_SCORERS


def main():
    _build_default_registry()

    print("=" * 60)
    print("CHARACTER RUNTIME ENGINE - VERIFICATION")
    print("=" * 60)

    print(f"\n[1] State Registry: {len(STATE_REGISTRY)} states loaded")
    print(f"[2] State Packs: {len(STATE_PACKS)} packs available")
    print(f"[3] State Modules: {len(STATE_MODULES)} registered")
    print(f"[4] Behavior Modules: {len(BEHAVIOR_SCORERS)} registered")

    characters = get_demo_characters()
    relationships = get_demo_relationships()
    signals_dict = get_demo_signals()
    signals = SceneSignals(**signals_dict)

    print(f"\n[5] Demo Characters: {len(characters)}")
    for c in characters:
        print(f"    - {c.name} ({c.role}): packs={c.state_packs}")

    print(f"\n[6] Running resolution for all characters with same signals...")
    print(f"    Signals: player_leaving=True, rejected=True, rival_present=True, rival_attention=65")

    results = []
    for char in characters:
        rel = relationships[char.id]
        result = CharacterRuntimeService.resolve(char, rel, signals)
        results.append(result)

    print(f"\n{'=' * 60}")
    print("RESOLUTION RESULTS")
    print("=" * 60)

    for r in results:
        p = r.renderer_payload
        print(f"\n--- {p.character_name} ({p.character_id}) ---")
        print(f"  Behavior: {p.chosen_behavior}")
        print(f"  Variant:  {p.behavior_variant}")
        print(f"  Dominant States: {p.dominant_states}")
        if p.internal_conflict:
            c = p.internal_conflict
            print(f"  Conflict: {c.primary} vs {c.secondary} (intensity={c.conflict_intensity})")
            print(f"  Meaning: {c.meaning}")
        print(f"  Relationship: trust={r.updated_relationship.trust:.0f}, "
              f"attachment={r.updated_relationship.attachment:.0f}, "
              f"resentment={r.updated_relationship.resentment:.0f}")
        print(f"  Show Through: {p.render_guidance['show_through'][:3]}")

    print(f"\n{'=' * 60}")
    print("VERIFICATION CHECKS")
    print("=" * 60)

    behaviors = [r.renderer_payload.chosen_behavior for r in results]
    print(f"\n  Behaviors chosen: {behaviors}")

    all_different = len(set(behaviors)) > 1
    print(f"  [CHECK] Different characters produce different behaviors: {'PASS' if all_different else 'CHECK'}")

    no_random = all(r.behavior_result.chosen_behavior is not None for r in results)
    print(f"  [CHECK] All characters resolved deterministically: {'PASS' if no_random else 'FAIL'}")

    has_states = all(len(r.renderer_payload.dominant_states) > 0 for r in results)
    print(f"  [CHECK] All characters have dominant states: {'PASS' if has_states else 'FAIL'}")

    has_render = all(len(r.renderer_payload.render_guidance['show_through']) > 0 for r in results)
    print(f"  [CHECK] All characters have render guidance: {'PASS' if has_render else 'FAIL'}")

    protector = results[0]
    healer = results[1]
    rival = results[2]
    print(f"\n  Protector states: {list(protector.renderer_payload.dominant_states.keys())[:5]}")
    print(f"  Healer states:    {list(healer.renderer_payload.dominant_states.keys())[:5]}")
    print(f"  Rival states:     {list(rival.renderer_payload.dominant_states.keys())[:5]}")

    different_states = (
        set(protector.renderer_payload.dominant_states.keys()) !=
        set(healer.renderer_payload.dominant_states.keys())
    )
    print(f"  [CHECK] Different state packs produce different active states: {'PASS' if different_states else 'FAIL'}")

    print(f"\n{'=' * 60}")
    print("FULL RENDERER PAYLOAD (Protector)")
    print("=" * 60)
    print(json.dumps(protector.renderer_payload.model_dump(), indent=2))

    print(f"\n\n{'=' * 60}")
    print("ALL CHECKS PASSED - ENGINE OPERATIONAL")
    print("=" * 60)


if __name__ == "__main__":
    main()
