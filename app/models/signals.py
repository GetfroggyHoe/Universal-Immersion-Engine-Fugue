from __future__ import annotations

from pydantic import BaseModel, Field


class SceneSignals(BaseModel):
    player_is_leaving: bool = False
    player_rejected_npc: bool = False
    player_is_injured: bool = False
    player_protected_npc: bool = False
    player_lied_to_npc: bool = False
    player_insulted_npc: bool = False
    player_showed_vulnerability: bool = False
    rival_present: bool = False
    rival_attention: float = 0.0
    public_setting: bool = False
    private_setting: bool = False
    danger_level: float = 0.0
    intimacy_level: float = 0.0
    social_pressure: float = 0.0
    humiliation_level: float = 0.0
    trust_violation: float = 0.0
    vulnerability_level: float = 0.0
    time_since_last_contact_hours: float = 0.0
    hours_passed: float = 0.1
    extra: dict[str, float | bool | str] = Field(default_factory=dict)
