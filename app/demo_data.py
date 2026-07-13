from __future__ import annotations

from app.models.character import Character
from app.models.relationship import Relationship
from app.models.signals import SceneSignals


def get_demo_characters() -> list[Character]:
    return [
        Character(
            id="demo_protector",
            name="Demo Protector",
            role="dangerous_protector",
            state_packs=["dangerous_protector", "obsessive_fast_burn"],
            traits={
                "empathy": 45,
                "pride": 60,
                "patience": 30,
                "honesty": 50,
                "courage": 85,
                "self_control": 35,
                "possessiveness": 78,
                "control_need": 80,
                "dominance": 75,
                "discipline": 55,
                "rejection_sensitivity": 40,
            },
        ),
        Character(
            id="demo_healer",
            name="Demo Healer",
            role="guarded_healer",
            state_packs=["guarded_healer", "soft_empath", "avoidant_attachment"],
            traits={
                "empathy": 82,
                "pride": 25,
                "patience": 70,
                "honesty": 75,
                "courage": 40,
                "self_control": 65,
                "possessiveness": 10,
                "control_need": 20,
                "dominance": 15,
                "discipline": 70,
                "kindness": 85,
                "forgiveness": 60,
                "rejection_sensitivity": 55,
            },
        ),
        Character(
            id="demo_rival",
            name="Demo Rival",
            role="prideful_rival",
            state_packs=["prideful_rival", "rival"],
            traits={
                "empathy": 25,
                "pride": 88,
                "patience": 20,
                "honesty": 40,
                "courage": 70,
                "self_control": 30,
                "possessiveness": 45,
                "control_need": 65,
                "dominance": 80,
                "ambition": 85,
                "impulsiveness": 60,
                "forgiveness": 15,
                "rejection_sensitivity": 70,
            },
        ),
    ]


def get_demo_relationships() -> dict[str, Relationship]:
    return {
        "demo_protector": Relationship(
            character_id="demo_protector",
            target_id="player",
            trust=42,
            respect=55,
            affection=65,
            attraction=70,
            attachment=78,
            resentment=10,
            suspicion=20,
            fear=15,
            comfort=35,
        ),
        "demo_healer": Relationship(
            character_id="demo_healer",
            target_id="player",
            trust=60,
            respect=65,
            affection=50,
            attraction=30,
            attachment=40,
            resentment=15,
            suspicion=10,
            fear=5,
            comfort=55,
        ),
        "demo_rival": Relationship(
            character_id="demo_rival",
            target_id="player",
            trust=35,
            respect=40,
            affection=20,
            attraction=10,
            attachment=15,
            resentment=45,
            suspicion=30,
            fear=5,
            comfort=25,
        ),
    }


def get_demo_signals() -> dict:
    return {
        "player_is_leaving": True,
        "player_rejected_npc": True,
        "rival_present": True,
        "rival_attention": 65,
        "private_setting": True,
        "danger_level": 20,
        "intimacy_level": 45,
        "hours_passed": 0.1,
    }
