from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import mimetypes
import os
import random
import re
import sqlite3
import threading
import time
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest

from fastapi import BackgroundTasks, FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "uie_living_world.sqlite3"
GENERATED_ASSET_DIR = DATA_DIR / "generated_assets"
VOICE_REFERENCE_DIR = DATA_DIR / "voice_refs"
GAME_STATE_PATH = DATA_DIR / "uie_game_state.json"
BROWSER_PAGES_PATH = DATA_DIR / "uie_browser_pages.json"
SOCIAL_FEED_PATH = DATA_DIR / "uie_instavibe_feed.json"
INSTAVIBE_STATE_PATH = DATA_DIR / "uie_instavibe_state.json"
SAVED_VOICES_PATH = VOICE_REFERENCE_DIR / "saved_voices.json"
VOICE_REGISTRY_PATH = VOICE_REFERENCE_DIR / "voice_registry.json"
POCKET_TTS_ONNX_MODEL_DIR = ROOT / "models" / "Pocket-tts"
POCKET_TTS_ONNX_VOICE_DIR = POCKET_TTS_ONNX_MODEL_DIR / "embeddings_v3"
KOKORO_MODEL_DIR = ROOT / "models" / "Kokoro"
POCKET_BASE_PRESET_VOICES = [
    "cosette",
    "marius",
    "javert",
    "alba",
    "jean",
    "anna",
    "vera",
    "fantine",
    "charles",
    "paul",
    "eponine",
    "azelma",
    "george",
    "mary",
    "jane",
    "michael",
    "eve",
    "bill_boerst",
    "peter_yearsley",
    "stuart_bell",
    "caro_davy",
    "giovanni",
    "lola",
    "juergen",
    "rafael",
    "estelle",
]


def discover_local_pocket_voices() -> list[str]:
    if not POCKET_TTS_ONNX_VOICE_DIR.exists():
        return []
    available = {
        item.stem
        for item in POCKET_TTS_ONNX_VOICE_DIR.glob("*.json")
        if (POCKET_TTS_ONNX_VOICE_DIR / f"{item.stem}.bin").exists()
    }
    ordered = [voice for voice in POCKET_BASE_PRESET_VOICES if voice in available]
    extras = sorted(available.difference(POCKET_BASE_PRESET_VOICES))
    return [*ordered, *extras]


POCKET_PRESET_VOICES = discover_local_pocket_voices()
POCKET_PRESET_VOICE_SET = set(POCKET_PRESET_VOICES)
POCKET_DEFAULT_VOICE = "alba" if "alba" in POCKET_PRESET_VOICE_SET else (
    POCKET_PRESET_VOICES[0] if POCKET_PRESET_VOICES else ""
)
POCKET_CUSTOM_REFERENCE = "custom_reference"
db_lock = threading.RLock()
image_job_lock = threading.RLock()
image_jobs_in_flight: set[str] = set()
tts_lock = threading.RLock()
pocket_models: dict[str, Any] = {}
kokoro_models: dict[str, Any] = {}
pocket_voice_states: dict[str, Any] = {}
active_websockets: set[WebSocket] = set()
app = FastAPI(title="UIE Living World Backend", version="0.1.0")
BACKEND_CAPABILITIES = {
    "assetImages": True,
    "mapLayout": True,
    "mapIntercept": True,
    "worldTick": True,
    "websocketStream": True,
    "npcProfiles": True,
    "relationships": True,
    "messages": True,
    "phone": True,
    "instavibe": True,
    "schoolLogic": True,
    "organizationAssets": True,
    "pocketTts": True,
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class NpcPayload(BaseModel):
    name: str
    role: str = "NPC"
    likes: list[str] = Field(default_factory=list)
    dislikes: list[str] = Field(default_factory=list)
    bio: str = ""
    voice_recipe: str = ""
    generate_missing_bio: bool = True
    location: str = "Starting Location"
    stats: dict[str, Any] = Field(default_factory=dict)
    wants: list[str] = Field(default_factory=list)
    needs: dict[str, Any] = Field(default_factory=dict)
    desires: list[str] = Field(default_factory=list)
    schedule: list[dict[str, Any]] = Field(default_factory=list)
    memory_profile: dict[str, Any] = Field(default_factory=dict)
    phone_number: str = ""
    availability: dict[str, Any] = Field(default_factory=dict)
    faction: str = ""
    party: str = ""
    map_position: dict[str, Any] = Field(default_factory=dict)
    personality: str = ""
    name_color: str = ""
    dialogue_color: str = ""
    text_effect_class: str = ""
    appearance: str = ""
    secrets: list[dict[str, Any]] = Field(default_factory=list)
    privateIntel: list[dict[str, Any]] = Field(default_factory=list)



class CharacterPayload(BaseModel):
    name: str
    current_location: str = "Starting Location"
    daily_routines: dict[str, Any] = Field(default_factory=dict)
    preferences: list[Any] = Field(default_factory=list)
    relationship_tier: float = 0
    suspicion_quotient: float = 0
    current_mood: str = "neutral"
    mood_tags: list[str] = Field(default_factory=list)
    keyword_flags: dict[str, Any] = Field(default_factory=dict)


class ActionPayload(BaseModel):
    actor: str = "User"
    action: str = ""
    text: str = ""
    location: str = "Starting Location"
    visible_to: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    tactic: dict[str, Any] = Field(default_factory=dict)


class TickPayload(BaseModel):
    minutes: int = 15
    current_location: str = "Starting Location"
    include_feed: bool = True
    active_party: str = "main"
    user_available: bool = True


class MessagePayload(BaseModel):
    sender: str = "System"
    recipient: str = ""
    channel: str = "world"
    text: str
    location: str = "Starting Location"


class PhonePayload(BaseModel):
    caller: str = "User"
    recipient: str
    mode: str = "call"
    text: str = ""
    location: str = "Starting Location"


class MapSyncPayload(BaseModel):
    places: list[dict[str, Any]] = Field(default_factory=list)
    current_location: str = "Starting Location"


class MovePayload(BaseModel):
    location: str
    reason: str = "manual move"
    x: float | None = None
    y: float | None = None
    z: float = 0
    force: bool = False


class MemoryPayload(BaseModel):
    kind: str = "memory"
    text: str
    importance: float = 0.5
    tags: list[str] = Field(default_factory=list)
    source: str = "system"
    visible_to: list[str] = Field(default_factory=list)


class RecallPayload(BaseModel):
    query: str = ""
    limit: int = 8
    include_distortions: bool = True


class RelationshipPayload(BaseModel):
    a: str
    b: str
    affinity: float | None = None
    trust: float | None = None
    suspicion: float | None = None
    romance: float | None = None
    rivalry: float | None = None
    note: str = ""


class SchedulePayload(BaseModel):
    schedule: list[dict[str, Any]]


class BattlePlanPayload(BaseModel):
    character: str
    opponent: str = "User"
    context: dict[str, Any] = Field(default_factory=dict)
    allies: list[str] = Field(default_factory=list)


class EnemyGeneratePayload(BaseModel):
    name: str
    context: str = ""
    player_level: int = 1
    player_stats: dict[str, Any] = Field(default_factory=dict)
    tier: int | None = None
    seed_nonce: str = ""


class FeedQuery(BaseModel):
    channel: str = ""
    location: str = ""
    party: str = ""
    recipient: str = ""
    limit: int = 50


class AssetImagePayload(BaseModel):
    asset_id: str = ""
    name: str = ""
    location_id: str = ""
    kind: str = "background"
    mode: str = "background"
    prompt: str = ""
    description: str = ""
    width: int | None = None
    height: int | None = None
    provider_settings: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_image_url: str = ""
    source_image_data_url: str = ""


class OrganizationAssetsPayload(BaseModel):
    organization: dict[str, Any] = Field(default_factory=dict)
    world_state: dict[str, Any] = Field(default_factory=dict)
    lore: str = ""


class CutsceneGeneratePayload(BaseModel):
    title: str = ""
    body: str = ""
    location: str = ""
    characters: list[str] = Field(default_factory=list)
    event_type: str = ""
    stakes: str = ""
    pov: str = ""
    context: str = ""
    duration: int = 6500


class AudioGenerationPayload(BaseModel):
    text: str
    character_id: str = "default"
    engine_preference: str = "pocket"
    reference_audio_url: str = ""
    reference_text: str = ""
    voice_recipe: str = ""
    voice: str = ""
    voice_id: str = ""
    language: str = "english"
    format: str = "wav"
    speed: float = 1.0
    reference_seconds: float = 6.0


class SavedVoicePayload(BaseModel):
    id: str = ""
    name: str = ""
    provider: str = "pocket"
    reference_audio_url: str = ""
    reference_text: str = ""
    voice: str = ""
    language: str = "english"
    speed: float = 1.0
    reference_seconds: float = 6.0
    gender_presentation: str = ""
    age_presentation: str = "adult"
    vocal_traits: list[str] = Field(default_factory=list)


class VoicePatchPayload(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    gender_presentation: str | None = None
    age_presentation: str | None = None
    vocal_traits: list[str] | None = None
    auto_assign: bool | None = None
    favorite: bool | None = None
    tags: list[str] | None = None
    accent: str | None = None
    tone: str | None = None
    pool_rules: dict[str, list[str]] | None = None


class VoiceAssignPayload(BaseModel):
    voice_id: str = ""
    locked: bool | None = None
    pool: str = "mixed"
    genre: str = ""
    race: str = ""
    region: str = ""
    npc_type: str = ""


class VoiceBatchPayload(BaseModel):
    voice_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    rename_prefix: str = ""


class MapInterceptPayload(BaseModel):
    text: str = ""
    current_location: str = "Starting Location"
    nav_graph: dict[str, Any] = Field(default_factory=dict)
    places: list[dict[str, Any]] = Field(default_factory=list)
    assets: list[dict[str, Any]] = Field(default_factory=list)
    world_state: dict[str, Any] = Field(default_factory=dict)


class LayoutPayload(BaseModel):
    location: str = "Starting Location"
    node: dict[str, Any] = Field(default_factory=dict)
    nav_graph: dict[str, Any] = Field(default_factory=dict)
    weather: str = "Clear"
    time_of_day: str = ""
    global_state: dict[str, Any] = Field(default_factory=dict)


class SchoolFinalEvaluationPayload(BaseModel):
    course_scores: dict[str, float] = Field(default_factory=dict)
    gpa: float | None = None
    discipline_level: int = 0
    completed_assignments: int = 0
    missed_assignments: int = 0
    leaderboard_size: int = 60
    school: str = "Current Academy"


class SchoolAssignmentPayload(BaseModel):
    course: str = "GEN-100"
    hours_required: float = 2
    hours_spent: float | None = None
    has_textbook: bool = False
    has_study_guide: bool = False
    active_roleplay: bool = False
    social_boost: float = 0
    cheating: bool = False
    catch_chance: float = 0.22


class SchoolApplicationPayload(BaseModel):
    gpa: float = 2.5
    rank: int = 50
    institution: dict[str, Any] = Field(default_factory=dict)
    funds: float = 0


class SchoolDeliveryPayload(BaseModel):
    world_state: dict[str, Any] = Field(default_factory=dict)
    text: str = ""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def decode(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def init_db() -> None:
    with db_lock, db() as conn:
        conn.executescript(
            """
            create table if not exists characters (
                name text primary key,
                role text not null default 'NPC',
                location text not null default 'Starting Location',
                profile text not null,
                needs text not null,
                desires text not null,
                stats text not null,
                schedule text not null,
                relationships text not null,
                memories text not null,
                tactics_seen text not null,
                updated_at text not null
            );
            create table if not exists events (
                id integer primary key autoincrement,
                ts text not null,
                type text not null,
                actor text not null default '',
                location text not null default '',
                payload text not null
            );
            create table if not exists messages (
                id integer primary key autoincrement,
                ts text not null,
                channel text not null,
                sender text not null,
                recipient text not null default '',
                location text not null default '',
                text text not null,
                payload text not null
            );
            create table if not exists places (
                id text primary key,
                name text not null,
                layer text not null default 'local',
                parent text not null default '',
                x real not null default 0.5,
                y real not null default 0.5,
                z real not null default 0,
                tags text not null,
                payload text not null,
                updated_at text not null
            );
            create table if not exists image_assets (
                id text primary key,
                cache_key text unique not null,
                kind text not null default 'background',
                status text not null default 'queued',
                location text not null default '',
                prompt text not null default '',
                provider text not null default '',
                url text not null default '',
                file_path text not null default '',
                content_type text not null default '',
                error text not null default '',
                payload text not null,
                created_at text not null,
                updated_at text not null
            );
            """
        )


def add_event(conn: sqlite3.Connection, event_type: str, actor: str, location: str, payload: dict[str, Any]) -> dict[str, Any]:
    ts = now_iso()
    conn.execute(
        "insert into events (ts,type,actor,location,payload) values (?,?,?,?,?)",
        (ts, event_type, actor, location, encode(payload)),
    )
    event_id = conn.execute("select last_insert_rowid()").fetchone()[0]
    return {"id": event_id, "ts": ts, "type": event_type, "actor": actor, "location": location, "payload": payload}


def add_message(
    conn: sqlite3.Connection,
    channel: str,
    sender: str,
    recipient: str,
    location: str,
    text: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ts = now_iso()
    data = payload or {}
    conn.execute(
        "insert into messages (ts,channel,sender,recipient,location,text,payload) values (?,?,?,?,?,?,?)",
        (ts, channel, sender, recipient, location, text, encode(data)),
    )
    msg_id = conn.execute("select last_insert_rowid()").fetchone()[0]
    return {
        "id": msg_id,
        "ts": ts,
        "channel": channel,
        "sender": sender,
        "recipient": recipient,
        "location": location,
        "text": text,
        "payload": data,
    }


def default_needs() -> dict[str, float]:
    return {"hunger": 0.2, "energy": 0.82, "social": 0.48, "safety": 0.78, "purpose": 0.55}


def default_memory_profile(role: str = "") -> dict[str, Any]:
    r = role.lower()
    reliability = 0.8
    if "forget" in r or "amnes" in r or "memory" in r:
        reliability = 0.42
    return {
        "reliability": reliability,
        "retention": 80,
        "distortion_chance": 0.12 if reliability >= 0.7 else 0.38,
        "forgets_names": reliability < 0.5,
        "notes": [],
    }


def default_availability(role: str = "") -> dict[str, Any]:
    r = role.lower()
    quiet_hours = [23, 0, 1, 2, 3, 4, 5]
    if "guard" in r or "night" in r:
        quiet_hours = [8, 9, 10, 11]
    return {
        "phone_answer_base": 0.55,
        "text_answer_base": 0.72,
        "quiet_hours": quiet_hours,
        "may_ignore_user": True,
        "may_contact_user": True,
    }


def default_map_position(location: str) -> dict[str, Any]:
    seed = sum(ord(ch) for ch in location) or 1
    rng = random.Random(seed)
    return {"x": round(rng.uniform(0.2, 0.8), 3), "y": round(rng.uniform(0.2, 0.8), 3), "z": 0}


def default_stats(role: str, supplied: dict[str, Any] | None = None) -> dict[str, int]:
    base = {"strength": 5, "agility": 5, "magic": 5, "resolve": 5, "tactics": 5, "charisma": 5}
    r = role.lower()
    if "mage" in r or "wizard" in r:
        base.update({"magic": 8, "tactics": 6})
    if "warrior" in r or "guard" in r or "defender" in r:
        base.update({"strength": 8, "resolve": 7})
    if "bard" in r or "idol" in r or "uie" in r:
        base.update({"charisma": 8, "agility": 6})
    for key, value in (supplied or {}).items():
        if key in base:
            base[key] = max(1, min(20, int(value)))
    return base


def default_desires(payload: NpcPayload) -> dict[str, Any]:
    likes = payload.likes[:4]
    dislikes = payload.dislikes[:4]
    return {
        "wants": payload.wants[:8] or likes or ["connection", "stability"],
        "needs": list(payload.needs.keys())[:8] or ["food", "rest", "belonging"],
        "desires": payload.desires[:8] or ["to be noticed", "to make meaningful choices"],
        "boundaries": dislikes,
        "current_goal": f"Find a way to matter as {payload.role or 'a person'}.",
    }


def default_schedule(role: str) -> list[dict[str, Any]]:
    r = role.lower()
    work = "Market District"
    if "student" in r or "academy" in r:
        work = "Academy"
    elif "guard" in r or "warrior" in r:
        work = "Training Yard"
    elif "merchant" in r or "shop" in r:
        work = "Market District"
    elif "idol" in r or "uie" in r or "bard" in r:
        work = "Practice Room"
    return [
        {"start": 6, "end": 9, "location": "Home", "activity": "morning routine", "follow_chance": 0.82},
        {"start": 9, "end": 12, "location": work, "activity": "work", "follow_chance": 0.72},
        {"start": 12, "end": 14, "location": "Cafe", "activity": "meal and overheard talk", "follow_chance": 0.64},
        {"start": 14, "end": 18, "location": work, "activity": "practice", "follow_chance": 0.68},
        {"start": 18, "end": 22, "location": "Town Square", "activity": "social time", "follow_chance": 0.58},
        {"start": 22, "end": 24, "location": "Home", "activity": "rest", "follow_chance": 0.86},
        {"start": 0, "end": 6, "location": "Home", "activity": "sleep", "follow_chance": 0.94},
    ]


def character_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "name": row["name"],
        "role": row["role"],
        "location": row["location"],
        "profile": decode(row["profile"], {}),
        "needs": decode(row["needs"], {}),
        "desires": decode(row["desires"], {}),
        "stats": decode(row["stats"], {}),
        "schedule": decode(row["schedule"], []),
        "relationships": decode(row["relationships"], {}),
        "memories": decode(row["memories"], []),
        "tactics_seen": decode(row["tactics_seen"], []),
        "updated_at": row["updated_at"],
    }


def save_character(conn: sqlite3.Connection, character: dict[str, Any]) -> dict[str, Any]:
    character["updated_at"] = now_iso()
    conn.execute(
        """
        insert into characters
        (name, role, location, profile, needs, desires, stats, schedule, relationships, memories, tactics_seen, updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?)
        on conflict(name) do update set
          role=excluded.role,
          location=excluded.location,
          profile=excluded.profile,
          needs=excluded.needs,
          desires=excluded.desires,
          stats=excluded.stats,
          schedule=excluded.schedule,
          relationships=excluded.relationships,
          memories=excluded.memories,
          tactics_seen=excluded.tactics_seen,
          updated_at=excluded.updated_at
        """,
        (
            character["name"],
            character.get("role", "NPC"),
            character.get("location", "Starting Location"),
            encode(character.get("profile", {})),
            encode(character.get("needs", {})),
            encode(character.get("desires", {})),
            encode(character.get("stats", {})),
            encode(character.get("schedule", [])),
            encode(character.get("relationships", {})),
            encode(character.get("memories", [])),
            encode(character.get("tactics_seen", [])),
            character["updated_at"],
        ),
    )
    return character


def remember(character: dict[str, Any], kind: str, text: str, *, importance: float = 0.5, tags: list[str] | None = None, source: str = "system") -> None:
    profile = character.setdefault("profile", {})
    memory_profile = profile.setdefault("memory_profile", default_memory_profile(character.get("role", "")))
    retention = max(5, min(500, int(memory_profile.get("retention", 80) or 80)))
    memories = character.setdefault("memories", [])
    memories.append(
        {
            "ts": now_iso(),
            "kind": kind,
            "text": text,
            "importance": max(0.0, min(1.0, float(importance))),
            "tags": tags or [],
            "source": source,
        }
    )
    memories.sort(key=lambda item: (float(item.get("importance", 0.5)), item.get("ts", "")))
    character["memories"] = memories[-retention:]


def recall_memories(character: dict[str, Any], query: str = "", limit: int = 8, include_distortions: bool = True) -> list[dict[str, Any]]:
    profile = character.get("profile", {})
    memory_profile = profile.get("memory_profile", default_memory_profile(character.get("role", "")))
    reliability = max(0.0, min(1.0, float(memory_profile.get("reliability", 0.8))))
    distortion_chance = max(0.0, min(1.0, float(memory_profile.get("distortion_chance", 0.12))))
    terms = {part.lower() for part in query.split() if len(part) > 2}
    scored = []
    for memory in character.get("memories", []):
        text = str(memory.get("text", ""))
        haystack = f"{text} {' '.join(memory.get('tags', []))}".lower()
        score = float(memory.get("importance", 0.5))
        if terms:
            score += sum(0.2 for term in terms if term in haystack)
        if not terms or score > float(memory.get("importance", 0.5)):
            scored.append((score, memory))
    scored.sort(key=lambda pair: (pair[0], pair[1].get("ts", "")), reverse=True)
    recalled = []
    for _, memory in scored[: max(1, min(50, limit))]:
        if random.random() > reliability + float(memory.get("importance", 0.5)) * 0.2:
            continue
        item = dict(memory)
        if include_distortions and random.random() < distortion_chance:
            item["distorted"] = True
            item["text"] = distort_memory(str(item.get("text", "")), bool(memory_profile.get("forgets_names", False)))
        recalled.append(item)
    return recalled[:limit]


def distort_memory(text: str, forgets_names: bool = False) -> str:
    if not text:
        return text
    replacements = [
        ("yesterday", "some other day"),
        ("always", "often"),
        ("never", "rarely"),
        ("Town Square", "a public place"),
        ("Cafe", "somewhere warm"),
        ("Training Yard", "an open yard"),
    ]
    out = text
    for old, new in replacements:
        if old in out and random.random() < 0.6:
            out = out.replace(old, new)
    if forgets_names:
        words = out.split()
        out = " ".join("someone" if word[:1].isupper() and len(word) > 3 else word for word in words)
    return out


def ensure_relationship(character: dict[str, Any], other: str) -> dict[str, float]:
    rels = character.setdefault("relationships", {})
    return rels.setdefault(other, {"affinity": 50.0, "trust": 50.0, "suspicion": 0.0, "romance": 0.0, "rivalry": 0.0, "notes": []})


def adjust_relationship(character: dict[str, Any], other: str, **deltas: float) -> dict[str, float]:
    rel = ensure_relationship(character, other)
    for key, delta in deltas.items():
        if key in {"note", "notes"}:
            continue
        current = float(rel.get(key, 0 if key in {"suspicion", "romance", "rivalry"} else 50))
        rel[key] = max(0.0, min(100.0, current + float(delta)))
    note = deltas.get("note")
    if note:
        rel.setdefault("notes", []).append({"ts": now_iso(), "text": str(note)})
        rel["notes"] = rel["notes"][-20:]
    return rel


def place_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "layer": row["layer"],
        "parent": row["parent"],
        "x": row["x"],
        "y": row["y"],
        "z": row["z"],
        "tags": decode(row["tags"], []),
        "payload": decode(row["payload"], {}),
        "updated_at": row["updated_at"],
    }


def upsert_place(conn: sqlite3.Connection, place: dict[str, Any]) -> dict[str, Any]:
    name = str(place.get("name") or place.get("id") or "Unknown Location").strip() or "Unknown Location"
    place_id = str(place.get("id") or name).strip().lower().replace(" ", "_")
    payload = dict(place)
    x = float(place.get("x", place.get("cx", 0.5)) or 0.5)
    y = float(place.get("y", place.get("cy", 0.5)) or 0.5)
    z = float(place.get("z", 0) or 0)
    tags = place.get("tags") if isinstance(place.get("tags"), list) else []
    conn.execute(
        """
        insert into places (id,name,layer,parent,x,y,z,tags,payload,updated_at)
        values (?,?,?,?,?,?,?,?,?,?)
        on conflict(id) do update set
          name=excluded.name, layer=excluded.layer, parent=excluded.parent, x=excluded.x,
          y=excluded.y, z=excluded.z, tags=excluded.tags, payload=excluded.payload, updated_at=excluded.updated_at
        """,
        (
            place_id,
            name,
            str(place.get("layer") or place.get("tier") or "local"),
            str(place.get("parent") or place.get("parentId") or ""),
            max(0.0, min(1.0, x)),
            max(0.0, min(1.0, y)),
            z,
            encode(tags),
            encode(payload),
            now_iso(),
        ),
    )
    row = conn.execute("select * from places where id=?", (place_id,)).fetchone()
    return place_from_row(row)


def known_places(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [place_from_row(row) for row in conn.execute("select * from places order by layer,name").fetchall()]


SECRET_FIELD_RE = re.compile(r"(?:api[_-]?key|authorization|bearer|token|secret|password|csrf|cookie)", re.I)
MOVEMENT_VERB_RE = re.compile(
    r"\b(?:go|going|head|heading|walk|walking|run|running|rush|rushing|drive|driving|ride|riding|travel|travelling|traveling|fly|flying|sail|sailing|move|moving|return|returning|enter|entering|board|boarding|mount|use|using|find|locate|approach|visit|visiting|reach|reaching|arrive|arriving|teleport|warp)\b",
    re.I,
)
NEGATED_MOVEMENT_RE = re.compile(
    r"\b(?:do not|don't|did not|didn't|will not|won't|not going to|refuse to)\s+(?:go|head|walk|run|drive|ride|travel|fly|sail|move|return|enter|board|mount|use|find|locate|approach|teleport|warp)\b",
    re.I,
)


def strip_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            if SECRET_FIELD_RE.search(str(key)):
                clean[key] = "***"
            else:
                clean[key] = strip_secrets(item)
        return clean
    if isinstance(value, list):
        return [strip_secrets(item) for item in value]
    return value


def normalize_provider(value: str = "") -> str:
    raw = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "comfyui": "comfy",
        "automatic1111": "sdwebui",
        "sdnext": "sdwebui",
        "stable_diffusion": "sdwebui",
        "dalle": "openai",
        "dall_e": "openai",
        "hf": "huggingface",
        "hugging_face": "huggingface",
        "builtin": "koji",
    }
    return aliases.get(raw, raw or "pollinations")


def first_string(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def nested_get(data: dict[str, Any], *path: str) -> Any:
    cur: Any = data
    for part in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def provider_api_key(settings: dict[str, Any], provider: str) -> str:
    env_key = {
        "openai": "OPENAI_API_KEY",
        "imagerouter": "IMAGEROUTER_API_KEY",
        "lmrouter": "LMROUTER_API_KEY",
        "arouter": "AROUTER_API_KEY",
        "nanogpt": "NANOGPT_API_KEY",
        "nvidia_nim": "NVIDIA_API_KEY",
        "stability": "STABILITY_API_KEY",
        "google": "GOOGLE_API_KEY",
        "pollinations": "POLLINATIONS_API_KEY",
        "huggingface": "HUGGINGFACE_API_TOKEN",
    }.get(provider, "")
    return first_string(
        settings.get("key"),
        settings.get("apiKey"),
        settings.get("token"),
        settings.get("pollinationsKey") if provider == "pollinations" else "",
        nested_get(settings, "providers", provider, "key"),
        nested_get(settings, "providerKeys", provider),
        nested_get(settings, provider, "key"),
        os.environ.get(env_key, "") if env_key else "",
        os.environ.get("HUGGINGFACE_API_TOKEN", "") if provider == "huggingface" else "",
        os.environ.get("HF_TOKEN", "") if provider == "huggingface" else "",
    )


def normalize_endpoint(raw: str, provider: str) -> str:
    value = str(raw or "").strip().rstrip("/")
    presets = {
        "openai": "https://api.openai.com/v1/images/generations",
        "imagerouter": "https://api.imagerouter.io/v1/openai/images/generations",
        "lmrouter": "https://api.lmrouter.com/openai/v1/images/generations",
        "arouter": "https://api.arouter.com/v1/images/generations",
        "nanogpt": "https://nano-gpt.com/v1/images/generations",
        "nvidia_nim": "https://integrate.api.nvidia.com/v1/images/generations",
        "pollinations": "https://image.pollinations.ai/prompt",
        "stability": "https://api.stability.ai/v2beta/stable-image/generate/core",
        "google": "https://generativelanguage.googleapis.com/v1beta",
        "huggingface": "",
    }
    if not value:
        return presets.get(provider, "")
    if provider in {"openai", "imagerouter", "lmrouter", "arouter", "nanogpt", "nvidia_nim"} and not re.search(r"/images/generations$", value, re.I):
        if value.endswith("/v1"):
            return f"{value}/images/generations"
    return value


def image_dimensions(kind: str, width: int | None, height: int | None) -> tuple[int, int]:
    if width and height:
        return max(128, min(2048, int(width))), max(128, min(2048, int(height)))
    k = str(kind or "").lower()
    if k == "background":
        return 1280, 720
    if k in {"thumbnail", "thumb"}:
        return 768, 512
    return 512, 512


def image_prompt(payload: AssetImagePayload) -> str:
    base = first_string(payload.prompt, payload.description, payload.name, payload.location_id)
    kind = str(payload.kind or payload.mode or "image").lower()
    if kind == "background":
        prefix = "Wide 16:9 empty visual novel environment background, no people, no text, no UI."
    elif kind in {"icon", "thumbnail", "thumb"}:
        prefix = "Readable visual asset thumbnail or icon for a custom location, no text, no UI."
    else:
        prefix = "Readable visual novel asset image, no text, no UI."
    return f"{prefix}\r\n{base}".strip()


def image_cache_key(payload: AssetImagePayload) -> tuple[str, str]:
    provider = normalize_provider(str(payload.provider_settings.get("provider") or payload.provider_settings.get("mode") or "pollinations"))
    width, height = image_dimensions(payload.kind, payload.width, payload.height)
    provider_model = first_string(
        payload.provider_settings.get("model"),
        payload.provider_settings.get("pollinationsModel"),
        nested_get(payload.provider_settings, "stability", "engine"),
    )
    material = {
        "asset_id": payload.asset_id,
        "location": payload.location_id or payload.name,
        "kind": payload.kind,
        "prompt": image_prompt(payload),
        "provider": provider,
        "model": provider_model,
        "width": width,
        "height": height,
        "source_image": bool(payload.source_image_url or payload.source_image_data_url),
    }
    digest = hashlib.sha256(encode(material).encode("utf-8")).hexdigest()
    explicit = str(payload.asset_id or "").strip().lower().replace("\\", "/")
    safe_explicit = re.sub(r"[^a-z0-9_.:/-]+", "_", explicit).strip("_").replace("/", "_").replace(":", "_")[:96]
    return digest, safe_explicit or f"asset_{digest[:24]}"


def content_extension(content_type: str) -> str:
    ct = str(content_type or "").split(";")[0].strip().lower()
    if ct == "image/jpeg":
        return ".jpg"
    if ct == "image/webp":
        return ".webp"
    if ct == "image/gif":
        return ".gif"
    if ct == "image/png":
        return ".png"
    guess = mimetypes.guess_extension(ct or "image/png") or ".png"
    return ".jpg" if guess == ".jpe" else guess


def http_bytes(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, body: bytes | None = None, timeout: int = 90) -> tuple[bytes, str]:
    req = urlrequest.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urlrequest.urlopen(req, timeout=timeout) as res:
            data = res.read()
            content_type = str(res.headers.get("content-type") or "application/octet-stream")
            return data, content_type
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:400]
        raise RuntimeError(f"HTTP {exc.code}: {detail or exc.reason}") from exc


def http_json(url: str, payload: dict[str, Any], *, headers: dict[str, str] | None = None, timeout: int = 90) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    data, _ = http_bytes(
        url,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json", **(headers or {})},
        body=body,
        timeout=timeout,
    )
    return json.loads(data.decode("utf-8", "ignore") or "{}")


def decode_data_url(value: str) -> tuple[bytes, str] | None:
    raw = str(value or "").strip()
    match = re.match(r"^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$", raw, re.I | re.S)
    if not match:
        return None
    content_type = match.group(1) or "image/png"
    return base64.b64decode(match.group(2)), content_type


def pollinations_image_bytes(prompt: str, settings: dict[str, Any], kind: str, width: int, height: int) -> tuple[bytes, str, str]:
    params = {
        "nologo": "true",
        "width": str(width),
        "height": str(height),
        "seed": str(random.randint(1, 999999999)),
    }
    model = first_string(settings.get("pollinationsModel"), settings.get("model"))
    if model:
        params["model"] = model
    api_key = provider_api_key(settings, "pollinations")
    if api_key:
        params["token"] = api_key
    url = f"https://image.pollinations.ai/prompt/{urlparse.quote(prompt[:3000])}?{urlparse.urlencode(params)}"
    headers = {"Accept": "image/*"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    data, content_type = http_bytes(url, headers=headers, timeout=120)
    return data, content_type, "pollinations"


def sdwebui_image_bytes(prompt: str, settings: dict[str, Any], kind: str, width: int, height: int) -> tuple[bytes, str, str]:
    base = first_string(settings.get("sdwebuiUrl"), settings.get("url"), settings.get("endpoint"))
    if not base:
        raise RuntimeError("SD WebUI URL is not configured")
    url = base.rstrip("/")
    if not re.search(r"/sdapi/v1/txt2img$", url, re.I):
        url = f"{url}/sdapi/v1/txt2img"
    sd = settings.get("sdwebui") if isinstance(settings.get("sdwebui"), dict) else {}
    payload = {
        "prompt": prompt,
        "negative_prompt": first_string(settings.get("negativePrompt"), settings.get("negative_prompt")),
        "steps": int(sd.get("steps") or 20),
        "width": width,
        "height": height,
        "cfg_scale": float(sd.get("cfg_scale") or sd.get("cfg") or 7),
    }
    key = provider_api_key(settings, "sdwebui")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    data = http_json(url, payload, headers=headers, timeout=180)
    image = ""
    if isinstance(data.get("images"), list) and data["images"]:
        image = str(data["images"][0] or "")
    if not image:
        raise RuntimeError("SD WebUI returned no image")
    if image.startswith("data:"):
        decoded = decode_data_url(image)
        if decoded:
            return decoded[0], decoded[1], "sdwebui"
    return base64.b64decode(image), "image/png", "sdwebui"


def stability_image_bytes(prompt: str, settings: dict[str, Any], kind: str, width: int, height: int) -> tuple[bytes, str, str]:
    api_key = provider_api_key(settings, "stability")
    if not api_key:
        raise RuntimeError("Stability API key is not configured")
    stability = settings.get("stability") if isinstance(settings.get("stability"), dict) else {}
    engine = str(stability.get("engine") or "core").lower()
    if engine not in {"core", "sd3", "ultra"}:
        engine = "core"
    aspect = "16:9" if width >= height * 1.4 else "1:1"
    boundary = f"----UIEForm{random.randint(1, 999999999):x}"
    fields = {
        "prompt": prompt,
        "aspect_ratio": aspect,
        "output_format": "png",
    }
    negative = first_string(settings.get("negativePrompt"), settings.get("negative_prompt"))
    if negative:
        fields["negative_prompt"] = negative
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode("utf-8"))
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    url = f"https://api.stability.ai/v2beta/stable-image/generate/{engine}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "image/*",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    data, content_type = http_bytes(url, method="POST", headers=headers, body=b"".join(chunks), timeout=180)
    return data, content_type, "stability"


def huggingface_image_bytes(prompt: str, settings: dict[str, Any], kind: str, width: int, height: int) -> tuple[bytes, str, str]:
    model = first_string(settings.get("model"), os.environ.get("HF_IMAGE_MODEL"), "stabilityai/stable-diffusion-xl-base-1.0")
    endpoint = first_string(settings.get("url"), settings.get("endpoint"))
    if not endpoint:
        endpoint = f"https://api-inference.huggingface.co/models/{model}"
    api_key = provider_api_key(settings, "huggingface")
    headers = {"Accept": "image/*", "Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body = {
        "inputs": prompt,
        "parameters": {
            "width": width,
            "height": height,
            "num_inference_steps": int(settings.get("steps") or 24),
        },
        "options": {"wait_for_model": True},
    }
    data, content_type = http_bytes(endpoint, method="POST", headers=headers, body=json.dumps(body).encode("utf-8"), timeout=180)
    if not str(content_type or "").lower().startswith("image/"):
        detail = data.decode("utf-8", "ignore")[:400]
        raise RuntimeError(f"Hugging Face returned non-image response: {detail}")
    return data, content_type, "huggingface"


def openai_compatible_image_bytes(prompt: str, settings: dict[str, Any], provider: str, kind: str, width: int, height: int) -> tuple[bytes, str, str]:
    endpoint = normalize_endpoint(first_string(settings.get("url"), settings.get("endpoint")), provider)
    if not endpoint:
        raise RuntimeError(f"{provider} endpoint is not configured")
    api_key = provider_api_key(settings, provider)
    if not api_key and not re.match(r"^https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:/|$)", endpoint, re.I):
        raise RuntimeError(f"{provider} API key is not configured")
    model = first_string(settings.get("model"), "gpt-image-1" if provider == "openai" else "")
    size = first_string(settings.get("backgroundSize") if kind == "background" else settings.get("size"), f"{width}x{height}")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if api_key and (provider == "nvidia_nim" or "nvidia.com" in endpoint):
        headers["x-api-key"] = api_key
        headers["api-key"] = api_key
    if api_key and provider == "nanogpt":
        headers["x-api-key"] = api_key
    request_body = {"model": model, "prompt": prompt, "n": 1, "size": size, "response_format": "b64_json"}
    negative = first_string(settings.get("negativePrompt"), settings.get("negative_prompt"))
    if provider == "nanogpt" and negative:
        request_body["negative_prompt"] = negative
    data = http_json(endpoint, request_body, headers=headers, timeout=180)
    first = data.get("data", [{}])[0] if isinstance(data.get("data"), list) and data.get("data") else {}
    b64 = first_string(first.get("b64_json"), first.get("b64"), data.get("b64_json"))
    if b64:
        if b64.startswith("data:"):
            decoded = decode_data_url(b64)
            if decoded:
                return decoded[0], decoded[1], provider
        return base64.b64decode(b64), "image/png", provider
    image_url = first_string(first.get("url"), data.get("url"))
    if image_url:
        data_bytes, content_type = http_bytes(image_url, headers={"Accept": "image/*"}, timeout=180)
        return data_bytes, content_type, provider
    raise RuntimeError(f"{provider} returned no image payload")


def generate_image_bytes(payload: AssetImagePayload) -> tuple[bytes, str, str]:
    settings = payload.provider_settings if isinstance(payload.provider_settings, dict) else {}
    provider = normalize_provider(str(settings.get("provider") or "pollinations"))
    width, height = image_dimensions(payload.kind, payload.width, payload.height)
    prompt = image_prompt(payload)
    preferred = [provider]
    if provider != "pollinations":
        preferred.append("pollinations")
    errors = []
    for candidate in preferred:
        try:
            if candidate == "pollinations":
                return pollinations_image_bytes(prompt, settings, payload.kind, width, height)
            if candidate == "sdwebui":
                return sdwebui_image_bytes(prompt, settings, payload.kind, width, height)
            if candidate == "stability":
                return stability_image_bytes(prompt, settings, payload.kind, width, height)
            if candidate == "huggingface":
                return huggingface_image_bytes(prompt, settings, payload.kind, width, height)
            if candidate in {"openai", "imagerouter", "lmrouter", "arouter", "nanogpt", "nvidia_nim"}:
                return openai_compatible_image_bytes(prompt, settings, candidate, payload.kind, width, height)
            errors.append(f"{candidate}: provider is not supported by FastAPI image manager yet")
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    raise RuntimeError("; ".join(errors) or "No image provider succeeded")


def image_asset_from_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "asset_id": row["id"],
        "cache_key": row["cache_key"],
        "kind": row["kind"],
        "status": row["status"],
        "location": row["location"],
        "prompt": row["prompt"],
        "provider": row["provider"],
        "url": row["url"],
        "content_type": row["content_type"],
        "error": row["error"],
        "payload": decode(row["payload"], {}),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def upsert_image_job(conn: sqlite3.Connection, payload: AssetImagePayload) -> dict[str, Any]:
    cache_key, asset_id = image_cache_key(payload)
    existing = conn.execute("select * from image_assets where cache_key=?", (cache_key,)).fetchone()
    if existing:
        asset = image_asset_from_row(existing)
        file_path = Path(existing["file_path"]) if existing["file_path"] else None
        if existing["status"] == "ready" and file_path and file_path.exists():
            return asset
        asset_id = existing["id"]
    provider = normalize_provider(str(payload.provider_settings.get("provider") or "pollinations"))
    now = now_iso()
    safe_payload = {
        **payload.model_dump(exclude={"provider_settings"}),
        "provider_settings": strip_secrets(payload.provider_settings),
    }
    conn.execute(
        """
        insert into image_assets
        (id,cache_key,kind,status,location,prompt,provider,url,file_path,content_type,error,payload,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        on conflict(id) do update set
          kind=excluded.kind,
          status=case when image_assets.status='ready' then image_assets.status else excluded.status end,
          location=excluded.location,
          prompt=excluded.prompt,
          provider=excluded.provider,
          payload=excluded.payload,
          updated_at=excluded.updated_at
        """,
        (
            asset_id,
            cache_key,
            str(payload.kind or payload.mode or "background"),
            "queued",
            str(payload.location_id or payload.name or ""),
            image_prompt(payload)[:3000],
            provider,
            "",
            "",
            "",
            "",
            encode(safe_payload),
            now,
            now,
        ),
    )
    row = conn.execute("select * from image_assets where id=?", (asset_id,)).fetchone()
    return image_asset_from_row(row) or {}


def update_image_asset_status(asset_id: str, **fields: Any) -> None:
    allowed = {"status", "provider", "url", "file_path", "content_type", "error"}
    updates = {key: value for key, value in fields.items() if key in allowed}
    if not updates:
        return
    updates["updated_at"] = now_iso()
    assignments = ", ".join(f"{key}=?" for key in updates)
    with db_lock, db() as conn:
        conn.execute(f"update image_assets set {assignments} where id=?", (*updates.values(), asset_id))


def queue_ws_broadcast(message: dict[str, Any]) -> None:
    loop = getattr(app.state, "loop", None)
    if not loop or not active_websockets:
        return
    try:
        asyncio.run_coroutine_threadsafe(broadcast_ws(message), loop)
    except Exception:
        return


async def broadcast_ws(message: dict[str, Any]) -> None:
    dead: list[WebSocket] = []
    for websocket in list(active_websockets):
        try:
            await websocket.send_json(message)
        except Exception:
            dead.append(websocket)
    for websocket in dead:
        active_websockets.discard(websocket)


def run_asset_image_job(asset_id: str) -> None:
    with image_job_lock:
        if asset_id in image_jobs_in_flight:
            return
        image_jobs_in_flight.add(asset_id)
    try:
        with db_lock, db() as conn:
            row = conn.execute("select * from image_assets where id=?", (asset_id,)).fetchone()
            if not row:
                return
            if row["status"] == "ready" and row["file_path"] and Path(row["file_path"]).exists():
                return
            update_image_asset_status(asset_id, status="generating", error="")
            raw_payload = decode(row["payload"], {})
        payload = AssetImagePayload(**raw_payload)
        data, content_type, provider = generate_image_bytes(payload)
        if not str(content_type or "").lower().startswith("image/"):
            content_type = "image/png"
        GENERATED_ASSET_DIR.mkdir(parents=True, exist_ok=True)
        ext = content_extension(content_type)
        file_path = GENERATED_ASSET_DIR / f"{asset_id}{ext}"
        file_path.write_bytes(data)
        url = f"/assets/image/file/{urlparse.quote(asset_id)}"
        update_image_asset_status(
            asset_id,
            status="ready",
            provider=provider,
            url=url,
            file_path=str(file_path),
            content_type=content_type,
            error="",
        )
        with db_lock, db() as conn:
            row = conn.execute("select * from image_assets where id=?", (asset_id,)).fetchone()
            asset = image_asset_from_row(row)
            add_event(conn, "asset_image_ready", "ImageManager", asset.get("location", "") if asset else "", {"asset": asset})
        queue_ws_broadcast({"type": "asset_image_ready", "payload": asset, "ts": now_iso()})
    except Exception as exc:
        message = str(exc)[:800]
        update_image_asset_status(asset_id, status="failed", error=message)
        with db_lock, db() as conn:
            row = conn.execute("select * from image_assets where id=?", (asset_id,)).fetchone()
            asset = image_asset_from_row(row)
            add_event(conn, "asset_image_failed", "ImageManager", asset.get("location", "") if asset else "", {"asset_id": asset_id, "error": message})
        queue_ws_broadcast({"type": "asset_image_failed", "payload": {"asset_id": asset_id, "error": message}, "ts": now_iso()})
    finally:
        with image_job_lock:
            image_jobs_in_flight.discard(asset_id)


def choose_unscheduled_location(conn: sqlite3.Connection, character: dict[str, Any]) -> str:
    places = known_places(conn)
    if places:
        likes = " ".join(character.get("profile", {}).get("likes", [])).lower()
        scored = []
        for place in places:
            haystack = f"{place['name']} {' '.join(place.get('tags', []))} {encode(place.get('payload', {}))}".lower()
            score = random.random()
            if any(term in haystack for term in likes.split()):
                score += 0.4
            scored.append((score, place["name"]))
        scored.sort(reverse=True)
        return scored[0][1]
    return random.choice(["Town Square", "Cafe", "Market District", "Training Yard", "Home"])


def battle_plan_for(character: dict[str, Any], opponent: str = "User", context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    stats = character.get("stats", {})
    seen = [item for item in character.get("tactics_seen", []) if item.get("actor") == opponent]
    strength = float(stats.get("strength", 5))
    agility = float(stats.get("agility", 5))
    magic = float(stats.get("magic", 5))
    resolve = float(stats.get("resolve", 5))
    tactics = float(stats.get("tactics", 5))
    known_user_patterns = [item.get("summary", "") for item in seen[-8:]]
    recent_actions = context.get("recentActions", []) if isinstance(context, dict) else []
    recent_user_actions = [
        str(item.get("actionName") or item.get("action") or "")
        for item in recent_actions
        if isinstance(item, dict) and str(item.get("actor", "")).lower() in {opponent.lower(), "user", "player"}
    ][-6:]

    if magic >= max(strength, agility):
        opener = "probe with ranged magic"
    elif agility >= strength:
        opener = "circle, feint, and test reaction speed"
    else:
        opener = "hold ground and force a strength contest"

    counters = []
    joined = " ".join([*known_user_patterns, *recent_user_actions]).lower()
    if "ranged" in joined or "magic" in joined:
        counters.append("break line of sight before committing")
    if "guard" in joined or "counter" in joined:
        counters.append("bait the counter before spending their strongest move")
    if "stealth" in joined or "ambush" in joined:
        counters.append("watch exits and keep an ally covering the flank")
    if "heal" in joined or "potion" in joined or "item" in joined:
        counters.append("pressure the user before they can stabilize")
    if not counters:
        counters.append("observe first; do not assume the user's habits yet")

    predicted_user_next_move = "standard attack"
    if re.search(r"\bheal|potion|item\b", joined):
        predicted_user_next_move = "recover or use an item"
    elif re.search(r"\bmagic|spell|ranged\b", joined):
        predicted_user_next_move = "ranged or magical pressure"
    elif re.search(r"\bguard|defend|counter\b", joined):
        predicted_user_next_move = "guard, counter, or delay"
    elif re.search(r"\bambush|stealth|feint\b", joined):
        predicted_user_next_move = "setup, feint, or reposition"

    player_ctx = context.get("player", {}) if isinstance(context.get("player", {}), dict) else {}
    hp = float(player_ctx.get("hp", 0) or 0)
    max_hp = max(1.0, float(player_ctx.get("maxHp", 100) or 100))
    if hp / max_hp <= 0.35:
        predicted_user_next_move = "recover, defend, or flee"
        if "pressure the user before they can stabilize" not in counters:
            counters.insert(0, "pressure the user before they can stabilize")

    risk = "low" if resolve + tactics >= 14 else "moderate" if resolve + tactics >= 9 else "high"
    recommended_response = counters[0] if counters else opener
    return {
        "character": character["name"],
        "opponent": opponent,
        "opener": opener,
        "counters": counters,
        "risk": risk,
        "predicted_user_next_move": predicted_user_next_move,
        "recommended_response": recommended_response,
        "uses_seen_user_tactics": bool(known_user_patterns),
        "known_user_patterns": known_user_patterns,
        "recent_user_actions": recent_user_actions,
          "stat_basis": stats,
        "context": context,
    }


ENEMY_ARCHETYPES: dict[str, dict[str, Any]] = {
    "beast": {
        "stats": {"str": 9, "dex": 8, "con": 7, "int": 2, "wis": 3, "cha": 3, "per": 6, "luk": 5},
        "skills": [("Savage Bite", "skill", "ap", 1), ("Pounce", "skill", "ap", 1), ("Howl", "skill", "ap", 2), ("Maul", "skill", "ap", 1)],
        "trackers": {"hp": 1.5, "mp": 0.0, "ap": 0.8},
        "threat": 2,
    },
    "undead": {
        "stats": {"str": 5, "dex": 4, "con": 6, "int": 8, "wis": 7, "cha": 2, "per": 5, "luk": 4},
        "skills": [("Life Drain", "magic", "mp", 8), ("Curse", "magic", "mp", 6), ("Spectral Wail", "skill", "ap", 2), ("Bone Spike", "skill", "ap", 1)],
        "trackers": {"hp": 1.1, "mp": 1.0, "ap": 0.6},
        "threat": 3,
    },
    "mage": {
        "stats": {"str": 3, "dex": 5, "con": 4, "int": 10, "wis": 7, "cha": 5, "per": 6, "luk": 5},
        "skills": [("Fireball", "magic", "mp", 10), ("Frost Lance", "magic", "mp", 8), ("Arcane Bolt", "magic", "mp", 6), ("Ward", "skill", "ap", 1)],
        "trackers": {"hp": 0.9, "mp": 1.6, "ap": 0.7},
        "threat": 3,
    },
    "brute": {
        "stats": {"str": 11, "dex": 4, "con": 9, "int": 2, "wis": 4, "cha": 3, "per": 4, "luk": 4},
        "skills": [("Crushing Blow", "skill", "ap", 1), ("Ground Slam", "skill", "ap", 2), ("Roar", "skill", "ap", 1), ("Shield Wall", "skill", "ap", 1)],
        "trackers": {"hp": 1.7, "mp": 0.2, "ap": 0.7},
        "threat": 2,
    },
    "assassin": {
        "stats": {"str": 6, "dex": 11, "con": 5, "int": 5, "wis": 6, "cha": 5, "per": 9, "luk": 7},
        "skills": [("Backstab", "skill", "ap", 1), ("Poison Dagger", "skill", "ap", 1), ("Smoke Step", "skill", "ap", 2), ("Venom Bolt", "magic", "mp", 6)],
        "trackers": {"hp": 1.0, "mp": 0.7, "ap": 1.2},
        "threat": 3,
    },
    "machine": {
        "stats": {"str": 8, "dex": 6, "con": 9, "int": 7, "wis": 6, "cha": 1, "per": 7, "luk": 3},
        "skills": [("Rail Shot", "skill", "ap", 1), ("Plasma Burst", "magic", "mp", 10), ("System Scan", "skill", "ap", 1), ("Overload", "magic", "mp", 12)],
        "trackers": {"hp": 1.3, "mp": 1.1, "ap": 1.0},
        "threat": 3,
    },
    "fiend": {
        "stats": {"str": 9, "dex": 7, "con": 8, "int": 9, "wis": 7, "cha": 6, "per": 6, "luk": 5},
        "skills": [("Hellfire", "magic", "mp", 12), ("Ravage", "skill", "ap", 2), ("Terrify", "skill", "ap", 1), ("Shadow Lash", "magic", "mp", 8)],
        "trackers": {"hp": 1.2, "mp": 1.3, "ap": 0.9},
        "threat": 4,
    },
    "humanoid": {
        "stats": {"str": 6, "dex": 6, "con": 6, "int": 5, "wis": 6, "cha": 5, "per": 6, "luk": 5},
        "skills": [("Strike", "skill", "ap", 1), ("Quick Jab", "skill", "ap", 1), ("Focus", "skill", "ap", 1), ("Spark", "magic", "mp", 6)],
        "trackers": {"hp": 1.0, "mp": 0.8, "ap": 0.8},
        "threat": 2,
    },
}

ENEMY_EQUIPMENT: dict[str, list[str]] = {
    "beast": ["Natural Hide", "Fangs"],
    "undead": ["Tarnished Mail", "Grave Relic"],
    "mage": ["Arcane Focus", "Ward Robes"],
    "brute": ["Heavy Armor", "Crushing Weapon"],
    "assassin": ["Light Armor", "Poisoned Blade"],
    "machine": ["Armor Plating", "Integrated Weapon"],
    "fiend": ["Infernal Hide", "Shadow Claws"],
    "humanoid": ["Travel Armor", "Sidearm"],
}

ENEMY_OBJECTIVES: dict[str, list[str]] = {
    "beast": ["defend its territory", "drive intruders away", "secure food"],
    "undead": ["guard a bound place", "recover a lost relic", "spread its curse"],
    "mage": ["complete a ritual", "capture forbidden knowledge", "force a surrender"],
    "brute": ["break the opposition", "hold the route", "take a valuable captive"],
    "assassin": ["escape unseen", "steal the objective", "disable the strongest threat"],
    "machine": ["protect its directive", "contain the area", "acquire a target"],
    "fiend": ["extract a bargain", "corrupt the site", "claim a living prisoner"],
    "humanoid": ["win control of the area", "take supplies", "force the enemy to retreat"],
}


def _enemy_archetype(name: str, context: str, declared_type: str = "") -> str:
    text = f"{declared_type} {name} {context}".lower()
    rules = [
        ("machine", ["robot", "drone", "automaton", "mech", "android", "construct", "turret", "sentinel", "droid"]),
        ("beast", ["wolf", "bear", "beast", "drake", "fang", "lion", "tiger", "serpent", "snake", "spider", "hound", "raptor", "wyrm", "creature"]),
        ("undead", ["ghost", "wraith", "skeleton", "zombie", "lich", "spirit", "phantom", "specter", "spectre", "ghoul", "undead"]),
        ("mage", ["mage", "wizard", "sorcerer", "witch", "warlock", "cultist", "necromancer", "shaman", "elemental", "arcane"]),
        ("brute", ["ogre", "troll", "giant", "golem", "brute", "berserker", "knight", "soldier", "marauder", "raider", "guard", "warrior"]),
        ("assassin", ["assassin", "rogue", "thief", "stalker", "ninja", "spy", "sniper"]),
        ("fiend", ["demon", "devil", "fiend", "imp", "incubus", "succubus", "horror", "abyss"]),
    ]
    for arch, keywords in rules:
        if any(kw in text for kw in keywords):
            return arch
    return "humanoid"


def _slug(value: str) -> str:
    raw = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
    return raw or "enemy"


def generate_enemy_definition(
    name: str,
    context: str = "",
    player_level: int = 1,
    player_stats: dict[str, Any] | None = None,
    tier: int | None = None,
    seed_nonce: str = "",
) -> dict[str, Any]:
    name = (name or "Enemy").strip() or "Enemy"
    player_level = max(1, int(player_level or 1))
    player_stats = player_stats or {}
    archetype = _enemy_archetype(name, context)
    arch = ENEMY_ARCHETYPES.get(archetype, ENEMY_ARCHETYPES["humanoid"])

    seed_text = f"{name}|{context}|{seed_nonce}|{tier}"
    seed = int(hashlib.sha256(seed_text.encode("utf-8")).hexdigest(), 16) % (2 ** 32)
    rng = random.Random(seed)

    tier = int(tier if tier is not None else arch["threat"])
    tier = max(1, min(5, tier))
    level = max(1, min(60, player_level + rng.choice([-1, 0, 0, 1, 1, 2])))
    stat_scale = 1 + (level - 1) * 0.14

    stats: dict[str, int] = {}
    for key, base in arch["stats"].items():
        jitter = rng.uniform(0.9, 1.15)
        stats[key] = max(1, round(base * stat_scale * jitter))

    tr = arch["trackers"]
    hp = int(round(max(20, (45 + level * 16) * tr["hp"]) * rng.uniform(0.92, 1.18)))
    mp = int(round((20 + level * 6) * tr["mp"] * rng.uniform(0.9, 1.2))) if tr["mp"] > 0 else 0
    ap = int(round((4 + level * 1.5) * tr["ap"] * rng.uniform(0.9, 1.2))) if tr["ap"] > 0 else 0

    pool = rng.sample(arch["skills"], k=min(len(arch["skills"]), rng.randint(2, 4)))
    attacks = []
    for sname, stype, cost_key, cost_val in pool:
        cost = max(1, round(cost_val * rng.uniform(0.85, 1.15)))
        attacks.append({
            "name": sname,
            "label": sname,
            "skillType": stype,
            "type": stype,
            "source": "Generated",
            "costs": {cost_key: cost},
            "description": f"{'A magical attack' if stype == 'magic' else 'A physical technique'} wielded by {name}.",
            "tags": ["magic" if stype == "magic" else "physical"],
        })

    xp = int(round((30 + level * 18) * rng.uniform(0.9, 1.15)))
    gold = int(round((10 + level * 8) * rng.uniform(0.8, 1.3)))
    loot = [f"{name.split()[0]} Essence"] if rng.random() < 0.5 else []
    enemy_id = f"enemy_{_slug(name)}_{seed_nonce or seed}"
    equipment = [
        {"name": item, "equipped": True, "source": "Generated"}
        for item in ENEMY_EQUIPMENT.get(archetype, ENEMY_EQUIPMENT["humanoid"])
    ]
    objective = rng.choice(ENEMY_OBJECTIVES.get(archetype, ENEMY_OBJECTIVES["humanoid"]))

    return {
        "id": enemy_id,
        "name": name,
        "archetype": archetype,
        "level": level,
        "tier": tier,
        "threatTier": tier,
        "className": archetype[:1].upper() + archetype[1:],
        "type": "enemy",
        "stats": stats,
        "hp": hp,
        "maxHp": hp,
        "mp": mp,
        "maxMp": mp,
        "ap": ap,
        "maxAp": ap,
        "attacks": attacks,
        "xp": xp,
        "gold": gold,
        "loot": loot,
        "equipment": equipment,
        "items": [],
        "objective": objective,
        "morale": rng.randint(45, 90),
        "disposition": "hostile",
        "imageUrl": "",
        "seed": seed,
    }


def get_colors_from_personality(personality: str) -> tuple[str, str, str]:
    p = personality.lower().strip()
    if "volatile" in p or "fiery" in p or "angry" in p or "hot" in p:
        return "#FF3333", "#FFA3A3", "text-shadow-unstable"
    elif "stoic" in p or "calm" in p or "quiet" in p or "slate" in p or "earth" in p:
        return "#708090", "#D3D3D3", "text-flat-clean"
    elif "refined" in p or "fancy" in p or "gold" in p or "purple" in p or "royal" in p:
        return "#9933FF", "#E6CCFF", "text-glow-purple"
    elif "melancholy" in p or "sad" in p or "blue" in p or "gloomy" in p:
        return "#3366FF", "#A3B8FF", "text-fade-blue"
    
    # Fallback to deterministic choice based on hash of personality
    choices = [
        ("#FF3333", "#FFA3A3", "text-shadow-unstable"),
        ("#708090", "#D3D3D3", "text-flat-clean"),
        ("#9933FF", "#E6CCFF", "text-glow-purple"),
        ("#3366FF", "#A3B8FF", "text-fade-blue")
    ]
    idx = sum(ord(c) for c in p) % len(choices) if p else 1 # default to stoic
    return choices[idx]


def assign_contextual_voice(profile: dict[str, Any], name: str, pool: str = "mixed", exclude: set[str] | None = None, context: dict[str, str] | None = None) -> tuple[str, str]:
    """Balance character fit with real assignment pressure; assets are never loaded here."""
    excluded = exclude or set()
    text = " ".join(str(profile.get(k, "")) for k in ("gender", "age", "personality", "appearance", "role", "bio")).lower()
    wanted_gender = "feminine" if any(x in text for x in ("female", "woman", "girl", "feminine")) else "masculine" if any(x in text for x in ("male", "man", "boy", "masculine")) else "neutral"
    wanted_age = "child" if any(x in text for x in ("child", "kid", "girl", "boy", "teen")) else "adult"
    context = context or {}
    candidates = [v for v in read_voice_registry()["voices"] if v.get("ready") and v.get("enabled") and v.get("autoAssign", True) and v["id"] not in excluded]
    if pool == "model": candidates = [v for v in candidates if v["category"] == "model"]
    if pool == "creator": candidates = [v for v in candidates if v["category"] == "creator"]
    if not candidates: return "", "No eligible voice in selected pool."
    def score(v: dict[str, Any]) -> tuple[float, int]:
        value = 0.0
        traits = " ".join([str(v.get("accent") or ""), str(v.get("tone") or ""), *[str(x) for x in v.get("vocalTraits", [])], *[str(x) for x in v.get("tags", [])]]).lower()
        if wanted_gender != "neutral" and v.get("genderPresentation") == wanted_gender: value += 5 # character match
        if v.get("agePresentation") == wanted_age: value += 4
        if wanted_age == "child" and v.get("agePresentation") != "child": value -= 8
        for key, weight in (("genre", 3), ("race", 2), ("region", 3), ("npc_type", 3)):
            wanted = str(context.get(key) or profile.get(key) or profile.get(key.replace("_", "")) or "").lower().strip()
            rules = [str(x).lower() for x in (v.get("poolRules") or {}).get(key, [])]
            if wanted and (wanted in traits or wanted in rules): value += weight
            elif wanted and rules: value -= 2
        quality = v.get("qualityScore")
        if isinstance(quality, (int, float)): value += max(-5, min(5, (float(quality) - 50) / 10))
        if str(v.get("status") or "") in {"degraded", "needs_review", "unavailable"}: value -= 7
        usage = v.get("usage") or {}; total = float(usage.get("totalAssignments") or 0); active = float(usage.get("activeAssignments") or 0)
        value -= min(10, total * .75 + active * 1.5) # overuse penalty
        last = str(usage.get("lastAssignedAt") or "")
        if last and last >= (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat(): value -= 6 # recent reuse penalty
        return value, -int(hashlib.sha256(f"{name}|{v['id']}".encode()).hexdigest()[:8], 16)
    selected = max(candidates, key=score)
    return selected["id"], f"automatic score {score(selected)[0]:.1f}: character + genre/accent/personality/preferences - reuse/overuse/quality penalties"


def ensure_npc(conn: sqlite3.Connection, payload: NpcPayload) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise ValueError("NPC name is required.")
    row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
    if row:
        character = character_from_row(row)
    else:
        character = {
            "name": name,
            "role": payload.role or "NPC",
            "location": payload.location or "Starting Location",
            "profile": {},
            "needs": {**default_needs(), **{k: float(v) for k, v in payload.needs.items() if isinstance(v, (int, float))}},
            "desires": default_desires(payload),
            "stats": default_stats(payload.role, payload.stats),
            "schedule": payload.schedule or default_schedule(payload.role),
            "relationships": {},
            "memories": [],
            "tactics_seen": [],
        }

    # Resolve personality
    personality = payload.personality.strip() if payload.personality else ""
    if not personality:
        personality = character.get("profile", {}).get("personality", "")
    if not personality:
        personality = random.choice(["volatile", "stoic", "refined", "melancholy"])

    # Determine colors based on personality
    nc_gen, dc_gen, te_gen = get_colors_from_personality(personality)

    name_color = payload.name_color.strip() if payload.name_color else ""
    if not name_color:
        name_color = character.get("profile", {}).get("name_color", "")
    if not name_color:
        name_color = nc_gen

    dialogue_color = payload.dialogue_color.strip() if payload.dialogue_color else ""
    if not dialogue_color:
        dialogue_color = character.get("profile", {}).get("dialogue_color", "")
    if not dialogue_color:
        dialogue_color = dc_gen

    text_effect_class = payload.text_effect_class.strip() if payload.text_effect_class else ""
    if not text_effect_class:
        text_effect_class = character.get("profile", {}).get("text_effect_class", "")
    if not text_effect_class:
        text_effect_class = te_gen

    bio = payload.bio.strip()
    if not bio and payload.generate_missing_bio:
        like_text = f" Likes: {', '.join(payload.likes)}." if payload.likes else ""
        dislike_text = f" Dislikes: {', '.join(payload.dislikes)}." if payload.dislikes else ""
        bio = f"{name} is a {payload.role or 'NPC'} with a private life, habits, and changing loyalties.{like_text}{dislike_text}"
    character["role"] = payload.role or character.get("role", "NPC")
    character["location"] = payload.location or character.get("location", "Starting Location")
    character["profile"].update(
        {
            "name": name,
            "role": character["role"],
            "bio": bio,
            "likes": payload.likes,
            "dislikes": payload.dislikes,
            "voice_recipe": payload.voice_recipe,
            "wants": payload.wants,
            "desires": payload.desires,
            "memory_profile": {**default_memory_profile(character["role"]), **payload.memory_profile},
            "availability": {**default_availability(character["role"]), **payload.availability},
            "phone_number": payload.phone_number,
            "faction": payload.faction,
            "party": payload.party,
            "map_position": payload.map_position or character.get("profile", {}).get("map_position") or default_map_position(character["location"]),
            "personality": personality,
            "name_color": name_color,
            "dialogue_color": dialogue_color,
            "text_effect_class": text_effect_class,
            "appearance": payload.appearance or character.get("profile", {}).get("appearance", ""),
            "secrets": payload.secrets or character.get("profile", {}).get("secrets", []),
            "privateIntel": payload.privateIntel or character.get("profile", {}).get("privateIntel", []),
        }

    )
    if payload.stats:
        character["stats"] = default_stats(character["role"], {**character.get("stats", {}), **payload.stats})
    if payload.schedule:
        character["schedule"] = payload.schedule
    if not character["profile"].get("voice_id") and not payload.voice_recipe:
        assigned, reason = assign_contextual_voice(character["profile"], name)
        if assigned:
            character["profile"].update({"voice_id": assigned, "voice_assignment": "automatic", "voice_assignment_reason": reason, "voice_locked": False})
    remember(character, "profile", f"{name}'s profile was created or updated.", importance=0.8, source="profile")
    save_character(conn, character)
    add_event(conn, "npc_profile_upserted", name, character["location"], {"npc": character})
    return character


def current_hour() -> int:
    return datetime.now().hour


def schedule_slot(schedule: list[dict[str, Any]], hour: int) -> dict[str, Any] | None:
    for item in schedule:
        start = int(item.get("start", 0))
        end = int(item.get("end", 24))
        if start <= hour < end or (start > end and (hour >= start or hour < end)):
            return item
    return None


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def simulate_character(conn: sqlite3.Connection, character: dict[str, Any], minutes: int, *, active_party: str = "main", user_available: bool = True) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    needs = character.get("needs", {})
    profile = character.setdefault("profile", {})
    availability = profile.get("availability", default_availability(character.get("role", "")))
    memory_profile = profile.get("memory_profile", default_memory_profile(character.get("role", "")))
    drift = max(1, minutes) / 240.0
    needs["hunger"] = clamp01(float(needs.get("hunger", 0.2)) + drift * random.uniform(0.04, 0.12))
    needs["energy"] = clamp01(float(needs.get("energy", 0.8)) - drift * random.uniform(0.03, 0.10))
    needs["social"] = clamp01(float(needs.get("social", 0.5)) - drift * random.uniform(0.01, 0.05))
    needs["purpose"] = clamp01(float(needs.get("purpose", 0.5)) + drift * random.uniform(-0.03, 0.04))

    slot = schedule_slot(character.get("schedule", []), current_hour())
    followed_schedule = False
    if slot and random.random() <= float(slot.get("follow_chance", 0.7)):
        followed_schedule = True
        next_location = str(slot.get("location") or character.get("location") or "Starting Location")
        if next_location != character.get("location"):
            old = character.get("location", "")
            character["location"] = next_location
            character["profile"]["map_position"] = default_map_position(next_location)
            remember(character, "movement", f"Went from {old or 'somewhere'} to {next_location} for {slot.get('activity', 'their plans')}.", importance=0.35, tags=["movement", next_location])
            events.append(add_event(conn, "npc_moved", character["name"], next_location, {"from": old, "to": next_location, "activity": slot.get("activity")}))
    elif slot and random.random() < 0.28:
        next_location = choose_unscheduled_location(conn, character)
        if next_location != character.get("location"):
            old = character.get("location", "")
            character["location"] = next_location
            character["profile"]["map_position"] = default_map_position(next_location)
            remember(character, "schedule_break", f"Skipped {slot.get('activity', 'their plan')} and went to {next_location}.", importance=0.45, tags=["movement", "unscheduled", next_location])
            events.append(add_event(conn, "npc_broke_schedule", character["name"], next_location, {"from": old, "planned": slot, "to": next_location}))

    if needs["hunger"] > 0.75 and character.get("location") != "Cafe":
        old = character.get("location", "")
        character["location"] = "Cafe"
        character["profile"]["map_position"] = default_map_position("Cafe")
        needs["hunger"] = 0.35
        remember(character, "need", "Got hungry enough to detour for food.", importance=0.35, tags=["hunger", "movement"])
        events.append(add_event(conn, "npc_need_detour", character["name"], "Cafe", {"from": old, "need": "hunger"}))
    if needs["social"] < 0.25:
        msg = add_message(conn, "local", character["name"], "", character.get("location", ""), "Anyone around? I could use company.", {"mood": "lonely"})
        events.append(add_event(conn, "npc_local_chat", character["name"], character.get("location", ""), {"message": msg}))
        needs["social"] = clamp01(needs["social"] + 0.18)

    nearby_rows = conn.execute(
        "select * from characters where location=? and name<>? order by name",
        (character.get("location", ""), character["name"]),
    ).fetchall()
    if nearby_rows and random.random() < min(0.65, 0.15 + drift):
        other = character_from_row(random.choice(nearby_rows))
        relation = ensure_relationship(character, other["name"])
        tone = "warm" if float(relation.get("affinity", 50)) >= 55 else "careful" if float(relation.get("suspicion", 0)) < 40 else "tense"
        line = {
            "warm": f"{character['name']} chats with {other['name']} about {random.choice(profile.get('likes') or ['the day'])}.",
            "careful": f"{character['name']} trades cautious small talk with {other['name']}.",
            "tense": f"{character['name']} keeps the exchange with {other['name']} clipped and wary.",
        }[tone]
        msg = add_message(conn, "local", character["name"], other["name"], character.get("location", ""), line, {"tone": tone})
        adjust_relationship(character, other["name"], affinity=1.5 if tone == "warm" else 0.3, trust=0.7 if tone != "tense" else -0.5, suspicion=-0.4 if tone == "warm" else 0.7, note=line)
        adjust_relationship(other, character["name"], affinity=1.0 if tone == "warm" else 0.2, trust=0.5 if tone != "tense" else -0.4, suspicion=-0.3 if tone == "warm" else 0.5, note=line)
        remember(character, "relationship", line, importance=0.45, tags=["relationship", other["name"]], source=other["name"])
        remember(other, "relationship", line, importance=0.45, tags=["relationship", character["name"]], source=character["name"])
        save_character(conn, other)
        events.append(add_event(conn, "npc_relationship_interaction", character["name"], character.get("location", ""), {"with": other["name"], "message": msg}))

    hour = current_hour()
    quiet_hours = set(int(h) for h in availability.get("quiet_hours", []))
    party = str(profile.get("party") or active_party or "main")
    if user_available and availability.get("may_contact_user", True) and hour not in quiet_hours and random.random() < min(0.35, 0.04 + drift):
        mode = "sms" if random.random() < 0.7 else "phone"
        hook = random.choice(profile.get("wants") or character.get("desires", {}).get("wants", []) or ["something"])
        text = f"{character['name']} reaches out about {hook}."
        msg = add_message(conn, mode, character["name"], "User", character.get("location", ""), text, {"spontaneous": True, "party": party})
        remember(character, "contact_user", f"Reached out to User about {hook}.", importance=0.5, tags=["phone", "user"])
        events.append(add_event(conn, "npc_contacted_user", character["name"], character.get("location", ""), {"mode": mode, "message": msg}))

    if profile.get("party") and random.random() < min(0.5, 0.08 + drift):
        text = f"{character['name']}: Status check from {character.get('location', 'somewhere')}."
        msg = add_message(conn, "party", character["name"], "", character.get("location", ""), text, {"party": profile.get("party")})
        events.append(add_event(conn, "party_chat", character["name"], character.get("location", ""), {"message": msg}))

    if random.random() > float(memory_profile.get("reliability", 0.8)) and character.get("memories"):
        forgotten = character["memories"].pop(0)
        events.append(add_event(conn, "npc_forgot_memory", character["name"], character.get("location", ""), {"forgotten": forgotten}))

    character["needs"] = needs
    if followed_schedule:
        profile["last_schedule_status"] = "followed"
    elif slot:
        profile["last_schedule_status"] = "deviated"
    save_character(conn, character)
    return events


def tactic_summary(payload: ActionPayload) -> str:
    if payload.tactic:
        return ", ".join(f"{key}={value}" for key, value in payload.tactic.items())
    text = f"{payload.action} {payload.text}".lower()
    tags = []
    for word in ["ambush", "guard", "heal", "counter", "magic", "ranged", "stealth", "taunt", "combo", "retreat"]:
        if word in text:
            tags.append(word)
    return ", ".join(tags) or "improvised action"


def clamp_py(value: Any, low: float, high: float, fallback: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = fallback
    if not n == n:
        n = fallback
    return max(low, min(high, n))


def school_average_from_payload(payload: SchoolFinalEvaluationPayload) -> float:
    scores = [clamp_py(v, 0, 100, 0) for v in payload.course_scores.values()]
    if scores:
        return sum(scores) / len(scores)
    if payload.gpa is not None:
        return clamp_py(payload.gpa, 0, 4, 2.5) * 25
    return 62.5


def school_delivery_mode(payload: SchoolDeliveryPayload) -> dict[str, Any]:
    state_text = " ".join(str(v) for v in payload.world_state.values())
    text = f"{state_text} {payload.text}".lower()
    if re.search(r"\b(fantasy|medieval|historical|ancient|guild|kingdom|magic|patron|courier|scroll)\b", text):
        return {
            "mode": "physical",
            "macro": "ACADEMY_FANTASY_DELIVERY",
            "surface": "guild hall, notice board, courier, patron contract",
        }
    if re.search(r"\b(sci[-\s]?fi|cyber|space|future|terminal)\b", text):
        return {
            "mode": "digital",
            "macro": "ACADEMY_CAREER_EDUCATION_APP",
            "surface": "smart device or terminal",
        }
    return {
        "mode": "digital",
        "macro": "ACADEMY_CAREER_EDUCATION_APP",
        "surface": "phone app or PC terminal",
    }


def org_slug(value: str, fallback: str = "organization") -> str:
    out = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")[:72]
    return out or fallback


def generated_organization_assets(payload: OrganizationAssetsPayload) -> list[dict[str, Any]]:
    org = payload.organization if isinstance(payload.organization, dict) else {}
    name = first_string(org.get("name"), "Organization")
    org_type = first_string(org.get("type"), "organization")
    controlled = org.get("controlledSpaces") if isinstance(org.get("controlledSpaces"), list) else []
    base = first_string(org.get("base"), *controlled, "unmapped influence")
    influence = first_string(org.get("influence"), org.get("scope"), "local")
    members = org.get("members") if isinstance(org.get("members"), list) else []
    member_count = len(members)
    slug = org_slug(name)
    prompt_context = " ".join(
        str(x)
        for x in [
            name,
            org_type,
            base,
            influence,
            org.get("notes", ""),
            payload.lore,
        ]
        if x
    ).strip()
    return [
        {
            "id": f"org_asset_{slug}_field_kit",
            "name": f"{name} Field Kit",
            "category": "organization",
            "description": f"Auto-generated asset bundle for {name}: credentials, contact paths, operating notes, and access hooks tied to {base}.",
            "source": "fastapi_organization_assets",
            "memberCount": member_count,
            "prompt": f"Create a practical organization asset image for {prompt_context}. Show a clean emblem, access cards, dossier pages, and location clues. No readable text, no watermark.",
        },
        {
            "id": f"org_asset_{slug}_base_access",
            "name": f"{name} Base Access",
            "category": "access",
            "description": f"Access and logistics record for {name}'s {influence} influence around {base}.",
            "source": "fastapi_organization_assets",
            "prompt": f"Create a location-linked access asset for {name} at {base}. Modern practical life-sim props, subtle emblem, routes and keys, no text, no watermark.",
        },
    ]


@app.on_event("startup")
async def startup() -> None:
    app.state.loop = asyncio.get_running_loop()
    init_db()


def voice_runtime_health() -> dict[str, Any]:
    """Validate local voice engines without loading their large models.

    Startup succeeds when at least one bundled voice engine is usable. Optional
    engines that are not installed are reported as warnings instead of blocking
    the entire game.
    """
    try:
        import importlib.util

        required_modules = ("numpy", "onnxruntime", "soundfile", "sentencepiece")
        missing_modules = [name for name in required_modules if importlib.util.find_spec(name) is None]
        pocket_assets = (
            "bundle.json",
            "flow_lm_main_int8.onnx",
            "flow_lm_flow_int8.onnx",
            "mimi_decoder_int8.onnx",
            "text_conditioner.onnx",
            "tokenizer.model",
        )
        missing_pocket_assets = [name for name in pocket_assets if not (POCKET_TTS_ONNX_MODEL_DIR / name).exists()]
        pocket_ready = not missing_modules and not missing_pocket_assets and bool(POCKET_PRESET_VOICES)

        kokoro_model = next((path for path in (
            KOKORO_MODEL_DIR / "kokoro-v1.0.int8.onnx",
            KOKORO_MODEL_DIR / "kokoro-v1.0.onnx",
            KOKORO_MODEL_DIR / "kokoro-v1.0.fp16.onnx",
        ) if path.exists()), None)
        kokoro_voices = next((path for path in (
            KOKORO_MODEL_DIR / "voices-v1.0.bin",
            KOKORO_MODEL_DIR / "voices.bin",
        ) if path.exists()), None)
        kokoro_package = importlib.util.find_spec("kokoro_onnx") is not None or importlib.util.find_spec("kokoro") is not None
        kokoro_ready = bool(kokoro_package and kokoro_model and kokoro_voices)
        voice_ready = pocket_ready or kokoro_ready

        pocket_issues = []
        if missing_modules:
            pocket_issues.append(f"Missing Python voice packages: {', '.join(missing_modules)}")
        if missing_pocket_assets:
            pocket_issues.append(f"Missing Pocket TTS assets: {', '.join(missing_pocket_assets)}")
        if not POCKET_PRESET_VOICES:
            pocket_issues.append("No Pocket TTS voice embeddings were found.")

        kokoro_issue = "Kokoro package or bundled model assets are missing."
        errors = [] if voice_ready else [*pocket_issues, kokoro_issue]
        warnings = []
        if voice_ready and not pocket_ready:
            warnings.extend(pocket_issues)
        if voice_ready and not kokoro_ready:
            warnings.append(kokoro_issue)

        return {
            "ok": voice_ready,
            "pocket": {"ready": pocket_ready, "voices": len(POCKET_PRESET_VOICES)},
            "kokoro": {"ready": kokoro_ready},
            "errors": errors,
            "warnings": warnings,
        }
    except Exception as exc:
        return {
            "ok": False,
            "pocket": {"ready": False, "voices": 0},
            "kokoro": {"ready": False},
            "errors": [str(exc)],
            "warnings": [],
        }


@app.get("/health")
def health() -> dict[str, Any]:
    init_db()
    with db_lock, db() as conn:
        characters = conn.execute("select count(*) from characters").fetchone()[0]
        events = conn.execute("select count(*) from events").fetchone()[0]
        image_assets = conn.execute("select count(*) from image_assets").fetchone()[0]
    return {
        "ok": True,
        "service": "uie-living-world",
        "version": app.version,
        "db_path": str(DB_PATH),
        "characters": characters,
        "events": events,
        "image_assets": image_assets,
        "capabilities": BACKEND_CAPABILITIES,
        "voice_bridge": voice_runtime_health(),
    }


@app.post("/school/evaluate/final")
def school_evaluate_final(payload: SchoolFinalEvaluationPayload) -> dict[str, Any]:
    average = school_average_from_payload(payload)
    gpa = clamp_py(average / 25, 0, 4, 2.5)
    rank = round(
        clamp_py(
            61
            - (average * 0.55)
            + (clamp_py(payload.discipline_level, 0, 4, 0) * 4)
            + clamp_py(payload.missed_assignments, 0, 999, 0)
            - min(8, clamp_py(payload.completed_assignments, 0, 999, 0)),
            1,
            max(1, payload.leaderboard_size),
            50,
        )
    )
    title = "Valedictorian" if rank == 1 else "Honor Graduate" if rank <= 10 else "Barely Graduated" if rank >= max(1, payload.leaderboard_size - 5) else "Graduate"
    return {
        "macro": "ACADEMY_FINAL_EVALUATION",
        "school": payload.school,
        "gpa": round(gpa, 2),
        "average": round(average),
        "rank": rank,
        "leaderboardTitle": title,
        "disciplineLevel": round(clamp_py(payload.discipline_level, 0, 4, 0)),
        "completedAssignments": payload.completed_assignments,
        "missedAssignments": payload.missed_assignments,
        "memoryTag": f"{title}: {payload.school}, {round(gpa, 2)} GPA, Rank #{rank}",
    }


@app.post("/school/assignment/grade")
def school_assignment_grade(payload: SchoolAssignmentPayload) -> dict[str, Any]:
    quality = 68 if payload.has_textbook else 45
    if payload.has_study_guide:
        quality += 20
    if payload.active_roleplay:
        quality += 30
    quality += clamp_py(payload.social_boost, 0, 30, 0)
    if payload.cheating:
        quality += 12
    spent = clamp_py(payload.hours_spent if payload.hours_spent is not None else payload.hours_required, 0, 24, payload.hours_required)
    required = max(1, clamp_py(payload.hours_required, 1, 24, 2))
    if spent < required:
        quality -= (1 - (spent / required)) * 25
    quality = round(clamp_py(quality, 0, 100, 50))
    caught = bool(payload.cheating and random.random() < clamp_py(payload.catch_chance, 0, 1, 0.22))
    return {
        "macro": "ACADEMY_STUDY_RESOLUTION",
        "course": payload.course,
        "quality": quality,
        "gradeBand": "A" if quality >= 90 else "B" if quality >= 80 else "C" if quality >= 70 else "D" if quality >= 60 else "F",
        "caughtCheating": caught,
        "disciplineSeverity": 3 if caught else 0,
        "evidence": {
            "textbook": payload.has_textbook,
            "studyGuide": payload.has_study_guide,
            "activeRoleplay": payload.active_roleplay,
            "cheating": payload.cheating,
        },
    }


@app.post("/school/application/check")
def school_application_check(payload: SchoolApplicationPayload) -> dict[str, Any]:
    inst = payload.institution or {}
    min_gpa = clamp_py(inst.get("minGpa", inst.get("min_gpa", 0)), 0, 4, 0)
    min_rank = int(clamp_py(inst.get("minRank", inst.get("min_rank", 9999)), 1, 9999, 9999))
    tuition = clamp_py(inst.get("tuition", 0), 0, 1_000_000_000, 0)
    accepted = payload.gpa >= min_gpa and payload.rank <= min_rank
    if payload.gpa < min_gpa:
        reason = "GPA below requirement"
    elif payload.rank > min_rank:
        reason = "Bulletin Board rank below requirement"
    else:
        reason = "Eligible"
    return {
        "macro": "ACADEMY_CAREER_EDUCATION_APP",
        "institution": inst.get("name", "Institution"),
        "accepted": accepted,
        "reason": reason,
        "tuition": tuition,
        "needsFunding": bool(accepted and payload.funds < tuition),
        "fundingGap": max(0, tuition - clamp_py(payload.funds, 0, 1_000_000_000, 0)),
    }


@app.post("/school/delivery/mode")
def school_delivery(payload: SchoolDeliveryPayload) -> dict[str, Any]:
    return school_delivery_mode(payload)


@app.post("/organizations/assets/generate")
def organization_assets_generate(payload: OrganizationAssetsPayload) -> dict[str, Any]:
    init_db()
    assets = generated_organization_assets(payload)
    org = payload.organization if isinstance(payload.organization, dict) else {}
    name = first_string(org.get("name"), "Organization")
    with db_lock, db() as conn:
        add_event(conn, "organization_assets_generated", name, first_string(org.get("base"), ""), {"assets": assets})
    return {"ok": True, "source": "fastapi", "assets": assets}


@app.post("/assets/image/request", status_code=202)
def request_asset_image(payload: AssetImagePayload, background_tasks: BackgroundTasks, response: Response) -> dict[str, Any]:
    init_db()
    with db_lock, db() as conn:
        asset = upsert_image_job(conn, payload)
        row = conn.execute("select * from image_assets where id=?", (asset.get("asset_id"),)).fetchone()
        asset = image_asset_from_row(row) or asset
        if asset.get("status") == "ready":
            response.status_code = 200
            return {"accepted": False, "asset": asset}
        add_event(conn, "asset_image_requested", "ImageManager", asset.get("location", ""), {"asset": asset})
    with image_job_lock:
        already_running = asset["asset_id"] in image_jobs_in_flight
    if not already_running:
        background_tasks.add_task(run_asset_image_job, asset["asset_id"])
    return {"accepted": True, "asset": asset}


@app.get("/assets/image/status/{asset_id}")
def asset_image_status(asset_id: str) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from image_assets where id=?", (asset_id,)).fetchone()
    return {"asset": image_asset_from_row(row)}


@app.post("/cutscene/generate")
def generate_cutscene(payload: CutsceneGeneratePayload) -> dict[str, Any]:
    init_db()
    location = payload.location or "an unknown location"
    characters = ", ".join(payload.characters) if payload.characters else "the scene"
    context_parts = [
        f"Location: {location}",
        f"Characters present: {characters}",
    ]
    if payload.event_type:
        context_parts.append(f"Event type: {payload.event_type}")
    if payload.stakes:
        context_parts.append(f"Stakes: {payload.stakes}")
    if payload.context:
        context_parts.append(f"Context: {payload.context}")
    if payload.body:
        context_parts.append(f"Scene description: {payload.body}")
    context_block = "\r\n".join(context_parts)
    narration = (
        f"The air shifts as the scene unfolds at {location}. "
        f"{'The presence of ' + characters + ' fills the space. ' if characters != 'the scene' else ''}"
        f"A moment of significance crystallizes — the world holds its breath."
    )
    title = payload.title or "Cutscene"
    with db_lock, db() as conn:
        add_event(conn, "cutscene_generated", title, location, {
            "characters": payload.characters,
            "event_type": payload.event_type,
            "duration": payload.duration,
        })
    return {
        "ok": True,
        "source": "fastapi",
        "cutscene": {
            "title": title,
            "body": narration,
            "location": location,
            "characters": payload.characters,
            "eventType": payload.event_type,
            "pov": payload.pov or "Breakaway",
            "duration": max(1200, min(120000, payload.duration)),
        },
    }


@app.get("/assets/image/file/{asset_id}")
def asset_image_file(asset_id: str) -> FileResponse:
    with db_lock, db() as conn:
        row = conn.execute("select * from image_assets where id=?", (asset_id,)).fetchone()
    asset = image_asset_from_row(row)
    if not asset or asset.get("status") != "ready":
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="image asset is not ready")
    file_path = Path(row["file_path"]) if row and row["file_path"] else GENERATED_ASSET_DIR / f"{asset_id}.png"
    if not file_path.exists():
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="image file is missing")
    return FileResponse(file_path, media_type=asset.get("content_type") or "image/png")


KOKORO_PRESET_VOICES = [
    "af_heart",
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_jessica",
    "af_kore",
    "af_nicole",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_echo",
    "am_eric",
    "am_fenrir",
    "am_liam",
    "am_michael",
    "am_onyx",
    "am_puck",
    "am_santa",
    "bf_alice",
    "bf_emma",
    "bf_isabella",
    "bf_lily",
    "bm_daniel",
    "bm_fable",
    "bm_george",
    "bm_lewis",
]


def package_available(module_name: str) -> bool:
    try:
        import importlib.util

        return importlib.util.find_spec(module_name) is not None
    except Exception:
        return False


def kokoro_onnx_paths() -> tuple[Path, Path]:
    model_candidates = [
        KOKORO_MODEL_DIR / "kokoro-v1.0.int8.onnx",
        KOKORO_MODEL_DIR / "kokoro-v1.0.onnx",
        KOKORO_MODEL_DIR / "kokoro-v1.0.fp16.onnx",
    ]
    voice_candidates = [
        KOKORO_MODEL_DIR / "voices-v1.0.bin",
        KOKORO_MODEL_DIR / "voices.bin",
    ]
    model_path = next((path for path in model_candidates if path.exists()), model_candidates[0])
    voices_path = next((path for path in voice_candidates if path.exists()), voice_candidates[0])
    return model_path, voices_path


def kokoro_available() -> bool:
    model_path, voices_path = kokoro_onnx_paths()
    return (package_available("kokoro_onnx") and model_path.exists() and voices_path.exists()) or package_available("kokoro")


def safe_voice_id(value: str = "") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value or "").strip()).strip("_")
    return cleaned[:64] or hashlib.sha256(os.urandom(16)).hexdigest()[:16]


def read_saved_voices() -> list[dict[str, Any]]:
    try:
        if not SAVED_VOICES_PATH.exists():
            return []
        data = json.loads(SAVED_VOICES_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]
    except Exception:
        return []


def write_saved_voices(items: list[dict[str, Any]]) -> None:
    VOICE_REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    atomic_json_write(SAVED_VOICES_PATH, items)


# The registry is intentionally independent from recipes. Recipes remain on old
# characters, while the registry provides stable IDs, status, and UI metadata.
VOICE_PRESENTATION: dict[str, tuple[str, str]] = {
    "cosette": ("feminine", "child"), "azelma": ("feminine", "child"),
    "alba": ("feminine", "adult"), "anna": ("feminine", "adult"),
    "vera": ("feminine", "adult"), "fantine": ("feminine", "adult"),
    "eponine": ("feminine", "adult"), "mary": ("feminine", "adult"),
    "jane": ("feminine", "adult"), "eve": ("feminine", "adult"),
    "lola": ("feminine", "adult"), "estelle": ("feminine", "adult"),
    "marius": ("masculine", "adult"), "javert": ("masculine", "adult"),
    "jean": ("masculine", "adult"), "charles": ("masculine", "adult"),
    "paul": ("masculine", "adult"), "george": ("masculine", "adult"),
    "michael": ("masculine", "adult"), "bill_boerst": ("masculine", "adult"),
    "peter_yearsley": ("masculine", "adult"), "stuart_bell": ("masculine", "adult"),
    "caro_davy": ("masculine", "adult"), "giovanni": ("masculine", "adult"),
    "juergen": ("masculine", "adult"), "rafael": ("masculine", "adult"),
}


def atomic_json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def pretty_voice_name(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", str(value or "Voice").strip())).title()


def model_registry_voice(engine: str, voice: str) -> dict[str, Any]:
    gender, age = VOICE_PRESENTATION.get(voice, ("neutral", "adult"))
    return {"id": f"model_{engine}_{safe_voice_id(voice).lower()}", "name": pretty_voice_name(voice),
            "category": "model", "engine": engine, "engineVoice": voice, "sourceType": "bundled",
            "language": "en", "genderPresentation": gender, "agePresentation": age,
            "vocalTraits": [], "tags": [], "accent": "", "tone": "", "favorite": False,
            "poolRules": {}, "usage": {"totalAssignments": 0, "activeAssignments": 0, "lastAssignedAt": "", "recentlyUsed": False},
            "qualityScore": None, "latencyScore": None, "enabled": True,
            "ready": True, "status": "ready", "autoAssign": True, "createdAt": "", "updatedAt": ""}


def normalize_creator_voice(item: dict[str, Any], used: set[str]) -> dict[str, Any]:
    base = safe_voice_id(str(item.get("id") or item.get("name") or "creator_voice")).lower()
    voice_id = base if base.startswith("creator_") else f"creator_{base}"
    suffix = 2
    while voice_id in used:
        voice_id = f"{base}_{suffix}" if base.startswith("creator_") else f"creator_{base}_{suffix}"
        suffix += 1
    used.add(voice_id)
    reference = str(item.get("referenceAudioPath") or item.get("reference") or "")
    valid = bool(reference) and (not reference.startswith(("/", "\\")) or Path(reference).exists())
    return {"id": voice_id, "name": str(item.get("name") or pretty_voice_name(voice_id)),
            "category": "creator", "engine": str(item.get("provider") or item.get("engine") or "pocket"),
            "sourceType": str(item.get("sourceType") or "voice_clone"), "referenceAudioPath": reference,
            "referenceText": str(item.get("referenceText") or ""), "engineVoice": str(item.get("voice") or ""),
            "voiceRecipe": str(item.get("voiceRecipe") or ""), "language": str(item.get("language") or "english"),
            "genderPresentation": str(item.get("genderPresentation") or item.get("gender_presentation") or "neutral"),
            "agePresentation": str(item.get("agePresentation") or item.get("age_presentation") or "adult"),
            "vocalTraits": list(item.get("vocalTraits") or item.get("vocal_traits") or []),
            "tags": list(item.get("tags") or []), "accent": str(item.get("accent") or ""), "tone": str(item.get("tone") or ""),
            "favorite": bool(item.get("favorite", False)), "poolRules": dict(item.get("poolRules") or item.get("pool_rules") or {}),
            "usage": dict(item.get("usage") or {"totalAssignments": 0, "activeAssignments": 0, "lastAssignedAt": "", "recentlyUsed": False}),
            "qualityScore": item.get("qualityScore"), "latencyScore": item.get("latencyScore"),
            "enabled": bool(item.get("enabled", True)), "ready": bool(item.get("ready", valid)),
            "status": str(item.get("status") or ("ready" if valid else "unavailable")),
            "autoAssign": bool(item.get("autoAssign", True)), "sourceHash": str(item.get("sourceHash") or ""),
            "createdAt": str(item.get("createdAt") or now_iso()), "updatedAt": str(item.get("updatedAt") or now_iso())}


def read_voice_registry() -> dict[str, Any]:
    try:
        saved = json.loads(VOICE_REGISTRY_PATH.read_text(encoding="utf-8")) if VOICE_REGISTRY_PATH.exists() else {}
    except Exception:
        saved = {}
    prior = {str(v.get("id")): v for v in saved.get("voices", []) if isinstance(v, dict)} if isinstance(saved, dict) else {}
    used: set[str] = set()
    voices = []
    for engine, names in (("pocket", POCKET_PRESET_VOICES), ("kokoro", KOKORO_PRESET_VOICES)):
        for name in names:
            entry = model_registry_voice(engine, name); entry.update({k: v for k, v in prior.get(entry["id"], {}).items() if k in {"name", "enabled", "vocalTraits", "autoAssign", "tags", "accent", "tone", "favorite", "poolRules", "usage", "qualityScore", "status"}})
            voices.append(entry); used.add(entry["id"])
    legacy = read_saved_voices()
    creator_sources = [*legacy, *[v for v in prior.values() if v.get("category") == "creator"]]
    fingerprints: set[str] = set()
    for source in creator_sources:
        fingerprint = str(source.get("sourceHash") or source.get("referenceAudioPath") or source.get("reference") or source.get("id") or "")
        if fingerprint and fingerprint in fingerprints: continue
        entry = normalize_creator_voice(source, used); fingerprints.add(fingerprint or entry["id"]); voices.append(entry)
    registry = {"schemaVersion": 2, "voices": voices, "updatedAt": str(saved.get("updatedAt") or now_iso()) if isinstance(saved, dict) else now_iso()}
    if not VOICE_REGISTRY_PATH.exists() or saved.get("voices") != voices if isinstance(saved, dict) else True:
        registry["updatedAt"] = now_iso(); atomic_json_write(VOICE_REGISTRY_PATH, registry)
    return registry


def registry_voice(voice_id: str) -> dict[str, Any] | None:
    return next((v for v in read_voice_registry()["voices"] if v["id"] == str(voice_id or "")), None)


def build_pocket_recipe(reference: str, ref_text: str, label: str, language: str) -> str:
    return "|".join(
        [
            "pocket-tts-v1",
            urlparse.quote(str(reference or "")),
            urlparse.quote(str(ref_text or "")),
            urlparse.quote(str(label or "Pocket Reference Voice")),
            urlparse.quote(str(language or "english")),
        ]
    )


@app.get("/audio/saved-voices")
def list_saved_voices() -> dict[str, Any]:
    return {"voices": read_saved_voices()}


@app.post("/audio/saved-voices")
def save_voice(payload: SavedVoicePayload) -> dict[str, Any]:
    provider = str(payload.provider or "pocket").strip().lower() or "pocket"
    name = str(payload.name or payload.voice or "Saved Voice").strip() or "Saved Voice"
    voice_id = safe_voice_id(payload.id or name).lower()
    if not voice_id.startswith("creator_"):
        voice_id = f"creator_{voice_id}"
    reference = str(payload.reference_audio_url or "").strip()
    if reference.startswith("data:"):
        reference = str(data_url_to_voice_file(reference))
    language = str(payload.language or "english").strip() or "english"
    item = {
        "id": voice_id,
        "name": name,
        "provider": provider,
        "reference": reference,
        "referenceText": str(payload.reference_text or ""),
        "voice": str(payload.voice or ""),
        "language": language,
        "speed": max(0.25, min(4.0, float(payload.speed or 1.0))),
        "referenceSeconds": max(1.0, min(15.0, float(payload.reference_seconds or 6.0))),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "genderPresentation": payload.gender_presentation or "neutral",
        "agePresentation": payload.age_presentation or "adult",
        "vocalTraits": payload.vocal_traits,
        "status": "processing",
    }
    if provider == "pocket":
        item["voiceRecipe"] = build_pocket_recipe(reference or item["voice"], item["referenceText"], name, language)

    items = [entry for entry in read_saved_voices() if str(entry.get("id") or "") != voice_id]
    items.insert(0, item)
    item["sourceHash"] = hashlib.sha256((reference + item["referenceText"]).encode("utf-8", "ignore")).hexdigest()
    # Pocket uses normalized reference data plus its cached speaker state as the
    # compiled preset; no model-wide recompilation is required.
    # A built-in Pocket voice is a usable saved voice too; a reference clip is
    # optional cloning data, not a requirement for saving a voice the player has.
    item["ready"] = bool(reference or item["voice"] or provider != "pocket")
    item["status"] = "ready" if item["ready"] else "unavailable"
    write_saved_voices(items[:100])
    registry = read_voice_registry()
    registered = next((v for v in registry["voices"] if v["id"] == voice_id), None)
    return {"voice": registered or item, "voices": registry["voices"]}


@app.delete("/audio/saved-voices/{voice_id}")
def delete_saved_voice(voice_id: str) -> dict[str, Any]:
    target = str(voice_id or "").strip()
    items = [entry for entry in read_saved_voices() if str(entry.get("id") or "") != target]
    write_saved_voices(items)
    return {"ok": True, "voices": read_voice_registry()["voices"]}


@app.get("/api/tts/voices")
@app.get("/audio/voice-registry")
def list_voice_registry() -> dict[str, Any]:
    registry = read_voice_registry()
    voices = sorted(registry["voices"], key=lambda v: (v["category"], v["name"].lower(), v["id"]))
    return {**registry, "voices": voices, "groups": {"model": [v for v in voices if v["category"] == "model"], "creator": [v for v in voices if v["category"] == "creator"]}}


@app.post("/api/tts/voices/refresh")
def refresh_voice_registry() -> dict[str, Any]:
    return list_voice_registry()


@app.patch("/api/tts/voices/{voice_id}")
def patch_voice(voice_id: str, payload: VoicePatchPayload) -> dict[str, Any]:
    registry = read_voice_registry(); voice = next((v for v in registry["voices"] if v["id"] == voice_id), None)
    if not voice: raise HTTPException(status_code=404, detail="Voice not found.")
    patch = payload.model_dump(exclude_none=True)
    keymap = {"gender_presentation": "genderPresentation", "age_presentation": "agePresentation", "vocal_traits": "vocalTraits", "auto_assign": "autoAssign"}
    for key, value in patch.items(): voice[keymap.get(key, key)] = value
    voice["updatedAt"] = now_iso(); atomic_json_write(VOICE_REGISTRY_PATH, registry)
    return {"ok": True, "voice": voice}


@app.post("/api/tts/voices/{voice_id}/compile")
def compile_voice(voice_id: str) -> dict[str, Any]:
    voice = registry_voice(voice_id)
    if not voice or voice.get("category") != "creator": raise HTTPException(status_code=404, detail="Creator voice not found.")
    reference = str(voice.get("referenceAudioPath") or "")
    if not reference: raise HTTPException(status_code=400, detail="Creator voice has no reference audio.")
    voice["ready"] = True; voice["status"] = "ready"; voice["updatedAt"] = now_iso()
    registry = read_voice_registry(); next(v for v in registry["voices"] if v["id"] == voice_id).update(voice); atomic_json_write(VOICE_REGISTRY_PATH, registry)
    return {"ok": True, "voice": voice, "compiled": "cached_reference"}


def update_voice_usage(voice_id: str, previous_voice_id: str = "") -> None:
    """Persist lightweight registry counters; never touches voice assets or embeddings."""
    registry = read_voice_registry()
    for voice in registry["voices"]:
        usage = voice.setdefault("usage", {"totalAssignments": 0, "activeAssignments": 0, "lastAssignedAt": "", "recentlyUsed": False})
        if voice["id"] == previous_voice_id and previous_voice_id != voice_id:
            usage["activeAssignments"] = max(0, int(usage.get("activeAssignments") or 0) - 1)
        if voice["id"] == voice_id:
            usage["totalAssignments"] = int(usage.get("totalAssignments") or 0) + 1
            usage["activeAssignments"] = int(usage.get("activeAssignments") or 0) + 1
            usage["lastAssignedAt"] = now_iso(); usage["recentlyUsed"] = True
    atomic_json_write(VOICE_REGISTRY_PATH, registry)


@app.post("/api/tts/voices/bulk/compile")
def bulk_compile_voices(payload: VoiceBatchPayload) -> dict[str, Any]:
    results = []
    for voice_id in payload.voice_ids:
        try: results.append({"voiceId": voice_id, "ok": True, **compile_voice(voice_id)})
        except HTTPException as exc: results.append({"voiceId": voice_id, "ok": False, "error": str(exc.detail)})
    return {"ok": True, "results": results, "registry": list_voice_registry()}


@app.post("/api/tts/voices/bulk/scan")
def bulk_scan_voices(payload: VoiceBatchPayload) -> dict[str, Any]:
    registry = read_voice_registry(); requested = set(payload.voice_ids)
    for voice in registry["voices"]:
        if requested and voice["id"] not in requested: continue
        reference = str(voice.get("referenceAudioPath") or "")
        voice["qualityScore"] = 88 if voice.get("category") == "model" else (82 if reference and Path(reference).exists() else 45)
        voice["status"] = "ready" if voice.get("qualityScore", 0) >= 60 else "needs_review"
        voice["updatedAt"] = now_iso()
    atomic_json_write(VOICE_REGISTRY_PATH, registry)
    return {"ok": True, "registry": list_voice_registry()}


@app.post("/api/tts/voices/bulk/metadata")
def bulk_voice_metadata(payload: VoiceBatchPayload) -> dict[str, Any]:
    registry = read_voice_registry(); selected = set(payload.voice_ids)
    for index, voice in enumerate(v for v in registry["voices"] if v["id"] in selected):
        if payload.tags: voice["tags"] = sorted(set([*voice.get("tags", []), *payload.tags]))
        if payload.rename_prefix: voice["name"] = f"{payload.rename_prefix} {index + 1}"
        voice["updatedAt"] = now_iso()
    atomic_json_write(VOICE_REGISTRY_PATH, registry)
    return {"ok": True, "registry": list_voice_registry()}


@app.post("/api/tts/voices/watch/refresh")
def refresh_creator_voice_watch() -> dict[str, Any]:
    """Folder polling endpoint used by the UI; import metadata only, assets remain lazy."""
    VOICE_REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    registry = read_voice_registry()
    known = {str(v.get("referenceAudioPath") or "") for v in registry["voices"]}
    for path in VOICE_REFERENCE_DIR.iterdir():
        if path.suffix.lower() not in {".wav", ".mp3", ".ogg", ".m4a", ".flac"} or str(path) in known: continue
        registry["voices"].append(normalize_creator_voice({"name": pretty_voice_name(path.stem), "referenceAudioPath": str(path), "status": "processing"}, {v["id"] for v in registry["voices"]}))
    atomic_json_write(VOICE_REGISTRY_PATH, registry)
    return {"ok": True, "watching": str(VOICE_REFERENCE_DIR), "registry": list_voice_registry()}


@app.get("/audio/voices")
def audio_voices() -> dict[str, Any]:
    voices = [*POCKET_PRESET_VOICES, POCKET_CUSTOM_REFERENCE]
    kokoro_ready = kokoro_available()
    return {
        "engines": [
            {
                "id": "pocket",
                "label": "Pocket TTS ONNX Local",
                "voices": voices,
                "preset_voices": POCKET_PRESET_VOICES,
                "default_voice": POCKET_DEFAULT_VOICE,
                "supports_reference_audio": True,
                "runs_in_backend": True,
                "supports_file_pick_voice_cloning": True,
                "local_only": True,
            },
            {
                "id": "kokoro",
                "label": "Kokoro TTS Pipeline",
                "voices": KOKORO_PRESET_VOICES,
                "preset_voices": KOKORO_PRESET_VOICES,
                "default_voice": "af_heart",
                "supports_reference_audio": False,
                "runs_in_backend": True,
                "available": kokoro_ready,
                "install_hint": "" if kokoro_ready else "Install `kokoro-onnx` and place kokoro-v1.0.int8.onnx plus voices-v1.0.bin under models/Kokoro.",
            },
        ],
        "voices": voices,
        "preset_voices": POCKET_PRESET_VOICES,
        "kokoro_voices": KOKORO_PRESET_VOICES,
        "default_voice": POCKET_DEFAULT_VOICE,
        "saved_voices": read_saved_voices(),
        "engine": "pocket-onnx-local",
    }


def parse_pocket_voice_recipe(recipe: str = "") -> dict[str, str]:
    parts = str(recipe or "").strip().split("|")
    if parts and parts[0] == "pocket-tts-v1":
        return {
            "reference_audio_url": urlparse.unquote(parts[1] if len(parts) > 1 else ""),
            "reference_text": urlparse.unquote(parts[2] if len(parts) > 2 else ""),
            "label": urlparse.unquote(parts[3] if len(parts) > 3 else "Pocket Reference Voice"),
            "language": urlparse.unquote(parts[4] if len(parts) > 4 else "english"),
        }
    return {
        "reference_audio_url": "",
        "reference_text": "",
        "label": "Pocket Reference Voice",
        "language": "english",
    }


def data_url_to_voice_file(data_url: str) -> Path:
    VOICE_REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    header, _, encoded = str(data_url or "").partition(",")
    if not encoded:
        raise HTTPException(status_code=400, detail="Invalid reference audio data URL.")
    media = "audio/wav"
    match = re.match(r"^data:([^;,]+)", header, re.I)
    if match:
        media = match.group(1).lower()
    ext = mimetypes.guess_extension(media) or ".wav"
    if ext == ".mpga":
        ext = ".mp3"
    digest = hashlib.sha256(encoded[:1024].encode("utf-8") + str(len(encoded)).encode("ascii")).hexdigest()[:24]
    path = VOICE_REFERENCE_DIR / f"voice_ref_{digest}{ext}"
    if not path.exists():
        try:
            path.write_bytes(base64.b64decode(encoded))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not decode reference audio: {exc}") from exc
    return path


def normalize_pocket_voice_name(value: str = "", fallback: str = "alba") -> str:
    raw = str(value or "").strip().lower()
    if raw == POCKET_CUSTOM_REFERENCE:
        return ""
    if raw in POCKET_PRESET_VOICE_SET:
        return raw
    fallback_raw = str(fallback or POCKET_DEFAULT_VOICE).strip().lower()
    if fallback_raw in POCKET_PRESET_VOICE_SET:
        return fallback_raw
    return POCKET_DEFAULT_VOICE


def resolve_pocket_reference(payload: AudioGenerationPayload) -> tuple[str, str, str, str]:
    recipe = parse_pocket_voice_recipe(payload.voice_recipe)
    recipe_reference = str(recipe.get("reference_audio_url") or "").strip()
    fallback_voice = normalize_pocket_voice_name(
        payload.voice or recipe_reference or POCKET_DEFAULT_VOICE,
        POCKET_DEFAULT_VOICE,
    ) or POCKET_DEFAULT_VOICE
    reference = str(payload.reference_audio_url or recipe_reference or "").strip()
    ref_text = str(payload.reference_text or recipe.get("reference_text") or "").strip()
    language = str(payload.language or recipe.get("language") or "english").strip() or "english"
    if not reference or reference.lower() == POCKET_CUSTOM_REFERENCE:
        reference = fallback_voice
    elif reference.lower() in POCKET_PRESET_VOICE_SET:
        reference = reference.lower()
    elif reference.startswith("data:"):
        reference = str(data_url_to_voice_file(reference))
    return reference, ref_text, language, fallback_voice


def get_pocket_model(language: str = "english") -> Any:
    lang = str(language or "english").strip() or "english"
    with tts_lock:
        model = pocket_models.get(lang)
        if model is not None:
            return model
        required = [
            "bundle.json",
            "tokenizer.model",
            "bos_before_voice.npy",
            "flow_lm_main_int8.onnx",
            "flow_lm_flow_int8.onnx",
            "mimi_decoder_int8.onnx",
            "mimi_encoder.onnx",
            "text_conditioner.onnx",
        ]
        missing = [name for name in required if not (POCKET_TTS_ONNX_MODEL_DIR / name).exists()]
        if missing:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Local Pocket TTS ONNX bundle is incomplete. Missing: "
                    + ", ".join(missing)
                    + f". Expected assets under {POCKET_TTS_ONNX_MODEL_DIR}."
                ),
            )
        try:
            try:
                from .pocket_tts_onnx import PocketTTSOnnx
            except ImportError:
                from pocket_tts_onnx import PocketTTSOnnx
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail="Pocket TTS ONNX runtime is missing. Keep python/pocket_tts_onnx.py and run `python -m pip install -r python/requirements.txt`.",
            ) from exc
        try:
            model = PocketTTSOnnx(
                models_dir=str(POCKET_TTS_ONNX_MODEL_DIR),
                language=lang,
                precision="int8",
                predefined_voice_dir=str(POCKET_TTS_ONNX_VOICE_DIR),
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Pocket TTS ONNX model failed to load: {exc}") from exc
        pocket_models[lang] = model
        return model


def get_pocket_onnx_voice(model: Any, reference: str, fallback_voice: str = "alba") -> tuple[str, str, str]:
    requested = str(reference or "").strip()
    fallback = normalize_pocket_voice_name(fallback_voice, POCKET_DEFAULT_VOICE) or POCKET_DEFAULT_VOICE
    candidates: list[str] = []
    for item in [requested, fallback, POCKET_DEFAULT_VOICE]:
        clean = str(item or "").strip()
        if not clean or clean.lower() == POCKET_CUSTOM_REFERENCE:
            continue
        if clean.lower() in POCKET_PRESET_VOICE_SET:
            clean = clean.lower()
        if clean not in candidates:
            candidates.append(clean)
    for index, candidate in enumerate(candidates):
        candidate_path = Path(candidate)
        if candidate in getattr(model, "predefined_voices", ()) or candidate_path.exists():
            reason = "" if index == 0 else f"Fell back from {requested or 'custom reference'} to {candidate}."
            return candidate, candidate, reason
    raise HTTPException(
        status_code=500,
        detail=(
            "Pocket TTS has no local voice state/reference to use. "
            f"Add preset .json/.bin files under {POCKET_TTS_ONNX_VOICE_DIR} "
            "or provide a local/data URL reference audio clip."
        ),
    )


def cache_pocket_voice_state(language: str, reference: str, state: Any) -> None:
    key = hashlib.sha256(f"{language}|{reference}".encode("utf-8", "ignore")).hexdigest()
    pocket_voice_states[key] = state
    if len(pocket_voice_states) > 32:
        for old_key in list(pocket_voice_states.keys())[:8]:
            pocket_voice_states.pop(old_key, None)


def get_pocket_voice_state(model: Any, reference: str, language: str, fallback_voice: str = "alba") -> tuple[Any, str, str]:
    requested = str(reference or "").strip()
    fallback = normalize_pocket_voice_name(fallback_voice, "alba") or "alba"
    candidates: list[str] = []
    for item in [requested, fallback, "alba"]:
        clean = normalize_pocket_voice_name(item, "") if str(item or "").strip().lower() in POCKET_PRESET_VOICE_SET else str(item or "").strip()
        if not clean or clean.lower() == POCKET_CUSTOM_REFERENCE:
            continue
        if clean not in candidates:
            candidates.append(clean)
    if not candidates:
        candidates = [fallback]
    with tts_lock:
        first_error: Exception | None = None
        last_error: Exception | None = None
        for index, candidate in enumerate(candidates):
            key = hashlib.sha256(f"{language}|{candidate}".encode("utf-8", "ignore")).hexdigest()
            if key in pocket_voice_states:
                reason = "" if index == 0 else f"Fell back from {requested or 'custom reference'} to {candidate}."
                return pocket_voice_states[key], candidate, reason
            try:
                state = model.get_state_for_audio_prompt(candidate)
                cache_pocket_voice_state(language, candidate, state)
                reason = "" if index == 0 else f"Fell back from {requested or 'custom reference'} to {candidate} because the requested voice/reference could not load."
                return state, candidate, reason
            except Exception as exc:
                if first_error is None:
                    first_error = exc
                last_error = exc
        detail = f"Pocket TTS voice cloning failed: {first_error or last_error}"
        if requested not in POCKET_PRESET_VOICE_SET:
            detail += f" Fallback preset '{fallback}' also failed: {last_error or first_error}"
        raise HTTPException(status_code=500, detail=detail) from (last_error or first_error)


def tensor_to_numpy(audio: Any) -> Any:
    try:
        import numpy as np
    except Exception as exc:
        raise HTTPException(status_code=503, detail="numpy is required for Pocket TTS audio output.") from exc
    if hasattr(audio, "detach"):
        audio = audio.detach()
    if hasattr(audio, "cpu"):
        audio = audio.cpu()
    if hasattr(audio, "numpy"):
        audio = audio.numpy()
    arr = np.asarray(audio)
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    return arr.astype("float32", copy=False)


def apply_audio_speed(audio: Any, speed: float = 1.0) -> Any:
    try:
        import numpy as np
        import scipy.signal
    except Exception:
        return audio
    value = max(0.25, min(4.0, float(speed or 1.0)))
    arr = np.asarray(audio, dtype="float32").reshape(-1)
    if arr.size <= 1 or abs(value - 1.0) < 0.01:
        return np.clip(arr, -1.0, 1.0).astype("float32", copy=False)
    target_len = max(1, int(round(arr.size / value)))
    adjusted = scipy.signal.resample(arr, target_len)
    return np.clip(adjusted, -1.0, 1.0).astype("float32", copy=False)


def kokoro_lang_code(language: str = "english") -> str:
    raw = str(language or "english").strip().lower()
    if raw in {"en-gb", "gb", "british", "british_english"}:
        return "b"
    if raw in {"ja", "jp", "japanese"}:
        return "j"
    if raw in {"zh", "cmn", "chinese", "mandarin"}:
        return "z"
    if raw in {"es", "spanish"}:
        return "e"
    if raw in {"fr", "french"}:
        return "f"
    if raw in {"hi", "hindi"}:
        return "h"
    if raw in {"it", "italian"}:
        return "i"
    if raw in {"pt", "portuguese"}:
        return "p"
    return "a"


def normalize_kokoro_voice(value: str = "") -> str:
    raw = str(value or "").strip().lower()
    if raw in KOKORO_PRESET_VOICES:
        return raw
    return "af_heart"


def get_kokoro_pipeline(language: str = "english") -> Any:
    lang_code = kokoro_lang_code(language)
    model_path, voices_path = kokoro_onnx_paths()
    if package_available("kokoro_onnx") and model_path.exists() and voices_path.exists():
        key = f"onnx:{model_path}:{voices_path}"
        with tts_lock:
            pipeline = kokoro_models.get(key)
            if pipeline is not None:
                return pipeline
            try:
                from kokoro_onnx import Kokoro
            except Exception as exc:
                raise HTTPException(
                    status_code=503,
                    detail="kokoro-onnx is not installed. Run `python -m pip install kokoro-onnx`.",
                ) from exc
            try:
                pipeline = Kokoro(str(model_path), str(voices_path))
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Kokoro ONNX pipeline failed to load: {exc}") from exc
            kokoro_models[key] = pipeline
            return pipeline

    key = f"kpipeline:{lang_code}"
    with tts_lock:
        pipeline = kokoro_models.get(key)
        if pipeline is not None:
            return pipeline
        try:
            from kokoro import KPipeline
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Kokoro TTS is not ready. Install `kokoro-onnx` and place kokoro-v1.0.int8.onnx "
                    "plus voices-v1.0.bin under models/Kokoro, or install the Python `kokoro` package."
                ),
            ) from exc
        try:
            pipeline = KPipeline(lang_code=lang_code)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Kokoro TTS pipeline failed to load: {exc}") from exc
        kokoro_models[key] = pipeline
        return pipeline


def generate_kokoro_audio(payload: AudioGenerationPayload) -> tuple[Any, int, str, str]:
    pipeline = get_kokoro_pipeline(payload.language)
    voice = normalize_kokoro_voice(payload.voice)
    speed = max(0.25, min(4.0, float(payload.speed or 1.0)))
    chunks = []
    try:
        if hasattr(pipeline, "create"):
            audio, sample_rate = pipeline.create(
                str(payload.text or ""),
                voice=voice,
                speed=speed,
                lang="en-us" if kokoro_lang_code(payload.language) == "a" else str(payload.language or "en-us"),
            )
            audio_np = tensor_to_numpy(audio)
            if audio_np.size:
                chunks.append(audio_np)
            return audio_np, int(sample_rate or 24000), voice, ""

        generator = pipeline(str(payload.text or ""), voice=voice, speed=speed)
        for item in generator:
            audio = item[-1] if isinstance(item, tuple) else item
            audio_np = tensor_to_numpy(audio)
            if audio_np.size:
                chunks.append(audio_np)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Kokoro TTS generation failed: {exc}") from exc

    if not chunks:
        raise HTTPException(status_code=500, detail="Kokoro TTS returned no audio.")

    try:
        import numpy as np
    except Exception as exc:
        raise HTTPException(status_code=503, detail="numpy is required for Kokoro TTS audio output.") from exc
    return np.concatenate(chunks), 24000, voice, ""


@app.post("/audio/generate")
def generate_audio(payload: AudioGenerationPayload) -> Response:
    if payload.voice_id:
        entry = registry_voice(payload.voice_id)
        if not entry or not entry.get("enabled") or not entry.get("ready"):
            raise HTTPException(status_code=409, detail="Requested voice is unavailable.")
        if entry.get("engine") == "kokoro":
            payload = payload.model_copy(update={"engine_preference": "kokoro", "voice": entry.get("engineVoice", "af_heart")})
        elif entry.get("category") == "creator":
            payload = payload.model_copy(update={"engine_preference": "pocket", "reference_audio_url": entry.get("referenceAudioPath", ""), "reference_text": entry.get("referenceText", ""), "voice_recipe": entry.get("voiceRecipe", ""), "voice": entry.get("engineVoice", "") or POCKET_DEFAULT_VOICE})
        else:
            payload = payload.model_copy(update={"engine_preference": "pocket", "voice": entry.get("engineVoice", POCKET_DEFAULT_VOICE)})
    started = time.perf_counter()
    text = str(payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")
    engine = str(payload.engine_preference or "pocket").strip().lower()
    if len(text) > 1200:
        text = text[:1200].rsplit(" ", 1)[0] or text[:1200]
        if not text.endswith((".", "!", "?")):
            text += "."
    if engine == "kokoro":
        audio, sample_rate, effective_voice, fallback_reason = generate_kokoro_audio(
            payload.model_copy(update={"text": text})
        )
        response_engine = "kokoro"
    else:
        reference, _ref_text, language, fallback_voice = resolve_pocket_reference(payload)
        with tts_lock:
            model = get_pocket_model(language)
            if hasattr(model, "max_reference_seconds"):
                model.max_reference_seconds = max(1.0, min(15.0, float(payload.reference_seconds or 6.0)))
            try:
                if hasattr(model, "generate") and not hasattr(model, "generate_audio"):
                    voice, effective_voice, fallback_reason = get_pocket_onnx_voice(
                        model,
                        reference,
                        fallback_voice,
                    )
                    audio = model.generate(text, voice=voice)
                else:
                    state, effective_voice, fallback_reason = get_pocket_voice_state(
                        model,
                        reference,
                        language,
                        fallback_voice,
                    )
                    audio = model.generate_audio(state, text)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Pocket TTS generation failed: {exc}") from exc
        sample_rate = int(getattr(model, "sample_rate", 24000) or 24000)
        response_engine = "pocket"

    try:
        import scipy.io.wavfile
    except Exception as exc:
        raise HTTPException(status_code=503, detail="scipy is required for Pocket TTS WAV output.") from exc

    audio_np = tensor_to_numpy(audio)
    if response_engine == "pocket":
        audio_np = apply_audio_speed(audio_np, payload.speed)
    else:
        audio_np = apply_audio_speed(audio_np, 1.0)
    wav = io.BytesIO()
    scipy.io.wavfile.write(wav, sample_rate, audio_np)
    duration_ms = int((len(audio_np) / max(1, sample_rate)) * 1000)
    generation_ms = int((time.perf_counter() - started) * 1000)
    if duration_ms <= 0 or not getattr(audio_np, "size", 0):
        raise HTTPException(status_code=500, detail="TTS returned empty audio.")
    peak = float(abs(audio_np).max()) if getattr(audio_np, "size", 0) else 0.0
    if peak < 0.0001: raise HTTPException(status_code=500, detail="TTS returned silent audio.")
    return Response(
        content=wav.getvalue(),
        media_type="audio/wav",
        headers={
            "X-UIE-TTS-Engine": response_engine,
            "X-UIE-TTS-Sample-Rate": str(sample_rate),
            "X-UIE-TTS-Voice": effective_voice,
            "X-UIE-TTS-Voice-Fallback": fallback_reason,
            "X-UIE-TTS-Generation-Ms": str(generation_ms),
            "X-UIE-TTS-Audio-Duration-Ms": str(duration_ms),
            "X-UIE-TTS-Real-Time-Factor": f"{generation_ms / max(1, duration_ms):.3f}",
        },
    )
@app.post("/api/tts/voices/{voice_id}/test")
def test_voice(voice_id: str) -> Response:
    # Direct synthesis endpoint: never relies on chat generation or old recipes.
    return generate_audio(AudioGenerationPayload(text="Hello. This is a preview of the selected voice.", voice_id=voice_id))


@app.get("/characters")
def list_characters() -> dict[str, Any]:
    with db_lock, db() as conn:
        rows = conn.execute("select * from characters order by name").fetchall()
    return {"characters": [character_from_row(row) for row in rows]}


@app.get("/characters/{name}")
def get_character(name: str) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
    return {"character": character_from_row(row) if row else None}


@app.put("/characters/{name}")
def upsert_character(name: str, payload: CharacterPayload) -> dict[str, Any]:
    npc_payload = NpcPayload(
        name=name or payload.name,
        role="NPC",
        likes=[str(item) for item in payload.preferences[:8]],
        dislikes=[],
        bio=f"{name or payload.name} currently feels {payload.current_mood}.",
        location=payload.current_location,
    )
    with db_lock, db() as conn:
        character = ensure_npc(conn, npc_payload)
        character["profile"].update(payload.model_dump())
        character["location"] = payload.current_location
        if payload.daily_routines:
            character["schedule"] = [
                {"start": int(k) if str(k).isdigit() else 9, "end": min(24, (int(k) if str(k).isdigit() else 9) + 2), "location": str(v), "activity": "routine", "follow_chance": 0.65}
                for k, v in payload.daily_routines.items()
            ]
        save_character(conn, character)
    return {"character": character}


@app.post("/npc/create")
def create_npc(payload: NpcPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        npc = ensure_npc(conn, payload)
    npc_data = {
        "name": npc.get("name", ""),
        "role": npc.get("role", "NPC"),
        "age": npc.get("profile", {}).get("age", ""),
        "gender": npc.get("profile", {}).get("gender", ""),
        "hair": npc.get("profile", {}).get("hair", ""),
        "expression": npc.get("profile", {}).get("expression", ""),
        "clothing": npc.get("profile", {}).get("appearance", ""),
        "setting": npc.get("location", ""),
        "appearance": npc.get("profile", {}).get("appearance", ""),
    }
    visual_result = trigger_npc_portrait(npc.get("name", ""), npc_data)
    return {"npc": npc, "visual": visual_result, "source": "fastapi"}


@app.post("/api/npcs/{npc_id}/voice/assign")
def assign_npc_voice(npc_id: str, payload: VoiceAssignPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (npc_id,)).fetchone()
        if not row: raise HTTPException(status_code=404, detail="NPC not found.")
        character = character_from_row(row); profile = character.setdefault("profile", {})
        prior_voice_id = str(profile.get("voice_id") or "")
        if payload.voice_id:
            if not registry_voice(payload.voice_id): raise HTTPException(status_code=404, detail="Voice not found.")
            profile.update({"voice_id": payload.voice_id, "voice_assignment": "manual", "voice_assignment_reason": "manual selection"})
        else:
            voice_id, reason = assign_contextual_voice(profile, character["name"], payload.pool, context={"genre": payload.genre, "race": payload.race, "region": payload.region, "npc_type": payload.npc_type})
            if not voice_id: raise HTTPException(status_code=409, detail="No valid voice available.")
            profile.update({"voice_id": voice_id, "voice_assignment": "automatic", "voice_assignment_reason": reason})
        if payload.locked is not None: profile["voice_locked"] = payload.locked
        save_character(conn, character)
    update_voice_usage(profile["voice_id"], prior_voice_id)
    return {"ok": True, "voiceId": profile["voice_id"], "assignment": profile.get("voice_assignment"), "locked": bool(profile.get("voice_locked"))}


@app.post("/api/npcs/{npc_id}/voice/reroll")
def reroll_npc_voice(npc_id: str, payload: VoiceAssignPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (npc_id,)).fetchone()
        if not row: raise HTTPException(status_code=404, detail="NPC not found.")
        character = character_from_row(row); profile = character.setdefault("profile", {})
        if profile.get("voice_locked"): raise HTTPException(status_code=409, detail="Voice is locked.")
        prior_voice_id = str(profile.get("voice_id") or "")
        voice_id, reason = assign_contextual_voice(profile, character["name"] + now_iso(), payload.pool, {prior_voice_id}, {"genre": payload.genre, "race": payload.race, "region": payload.region, "npc_type": payload.npc_type})
        if not voice_id: raise HTTPException(status_code=409, detail="No alternative voice available.")
        profile.update({"voice_id": voice_id, "voice_assignment": "automatic", "voice_assignment_reason": reason}); save_character(conn, character)
    update_voice_usage(voice_id, prior_voice_id)
    return {"ok": True, "voiceId": voice_id, "assignment": "automatic", "reason": reason}


def normalize_match_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def text_mentions_name(text: str, name: str) -> bool:
    wanted = normalize_match_text(name)
    if not wanted:
        return False
    pattern = re.compile(rf"(^|[^a-z0-9])(?:the\s+)?{re.escape(wanted)}(?=$|[^a-z0-9])", re.I)
    return bool(pattern.search(normalize_match_text(text)))


def classify_environment_py(place: dict[str, Any]) -> str:
    text = normalize_match_text(" ".join(str(place.get(key, "")) for key in ["type", "name", "theme", "district", "description", "desc"]))
    if re.search(r"\b(ocean|sea|lake|river|water|reef|shallows|channel|bay)\b", text):
        return "aquatic"
    if re.search(r"\b(field|meadow|grassland|prairie|plains)\b", text):
        return "field"
    if re.search(r"\b(forest|woods|grove|jungle|wild|wilderness|mountain|valley|desert|swamp|marsh|trail|path)\b", text):
        return "wild"
    if re.search(r"\b(cave|cavern|mine|tunnel|dungeon|crypt|catacomb)\b", text):
        return "subterranean"
    if re.search(r"\b(ship|spacecraft|starship|vehicle|train|aircraft|submarine|station deck)\b", text):
        return "vehicle"
    if re.search(r"\b(city|town|street|road|alley|plaza|market|district|village|harbor|dock|port)\b", text):
        return "urban"
    if re.search(r"\b(interior|inside|room|building|house|home|castle|tower|temple|inn|school|office|station)\b", text):
        return "interior"
    return "wild" if str(place.get("type", "")).lower() == "exterior" else "interior"


def graph_from_payload(nav_graph: dict[str, Any], places: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    graph: dict[str, dict[str, str]] = {}
    for name, exits in (nav_graph or {}).items():
        if isinstance(exits, dict):
            graph[str(name)] = {str(direction): str(target) for direction, target in exits.items() if str(target or "").strip()}
    for place in places:
        name = str(place.get("name") or place.get("id") or "").strip()
        exits = place.get("exits") or place.get("payload", {}).get("exits") if isinstance(place.get("payload"), dict) else place.get("exits")
        if name and isinstance(exits, dict):
            graph.setdefault(name, {}).update({str(direction): str(target) for direction, target in exits.items() if str(target or "").strip()})
    return graph


def choose_intercept_action(payload: MapInterceptPayload, places: list[dict[str, Any]]) -> dict[str, Any] | None:
    text = str(payload.text or "")
    normalized = normalize_match_text(text)
    if not normalized or NEGATED_MOVEMENT_RE.search(normalized) or not MOVEMENT_VERB_RE.search(normalized):
        return None
    current = str(payload.current_location or "").strip()
    graph = graph_from_payload(payload.nav_graph, places)

    asset_matches = []
    for asset in payload.assets or []:
        name = str(asset.get("name") or asset.get("title") or "").strip()
        if name and text_mentions_name(text, name):
            asset_matches.append((len(name), asset))
    if asset_matches:
        asset = sorted(asset_matches, reverse=True, key=lambda item: item[0])[0][1]
        asset_name = str(asset.get("name") or asset.get("title") or "Asset").strip()
        if re.search(r"\b(?:board|enter|get in|get into|climb aboard|step aboard|mount|ride|drive|sail|fly|use)\b", normalized):
            return {
                "kind": "board_asset",
                "asset": asset_name,
                "target": str(asset.get("location") or current),
                "label": f"Board {asset_name}",
                "button": "Board Asset",
            }
        if re.search(r"\b(?:find|locate|approach|go|head|walk|run|travel|return)\b", normalized):
            return {
                "kind": "asset_navigation",
                "asset": asset_name,
                "target": str(asset.get("location") or ""),
                "label": f"Go to {asset_name}",
                "button": "Approach Asset",
            }

    place_matches = []
    for place in places:
        name = str(place.get("name") or "").strip()
        if name and name.lower() != current.lower() and text_mentions_name(text, name):
            place_matches.append((len(name), place))
    if place_matches:
        place = sorted(place_matches, reverse=True, key=lambda item: item[0])[0][1]
        target = str(place.get("name") or "").strip()
        return {
            "kind": "location_travel",
            "target": target,
            "label": f"Cross Threshold: {target}",
            "button": "Cross Threshold",
        }

    if re.search(r"\b(?:leave|exit|go outside|step outside|head outside|return|go back|walk back)\b", normalized):
        exits = graph.get(current, {})
        for direction, target in exits.items():
            if direction == "south" or re.search(r"\b(?:outside|exit|threshold|return)\b", str(target), re.I):
                return {
                    "kind": "location_exit",
                    "target": target,
                    "direction": direction,
                    "label": f"Cross Threshold: {target}",
                    "button": "Cross Threshold",
                }
    return None


def weather_layout_modifiers(environment: str, weather: str, exits: dict[str, Any]) -> dict[str, Any]:
    text = normalize_match_text(weather)
    stormy = bool(re.search(r"\b(storm|blizzard|hurricane|maelstrom|acid rain|solar flare|space storm|dust storm|sandstorm)\b", text))
    wet = bool(re.search(r"\b(rain|snow|fog|mist|high wind|rough)\b", text))
    threat = 0.0
    overlays: list[str] = []
    exit_modifiers: dict[str, dict[str, Any]] = {}
    if stormy:
        threat = 0.7
        overlays.append("storm")
        for direction, target in exits.items():
            modifier = {"state": "open", "labelSuffix": "storm risk", "threat": threat}
            if environment in {"aquatic", "vehicle"}:
                modifier = {"state": "blocked", "label": f"Weather-blocked: {target}", "threat": threat}
            exit_modifiers[str(direction)] = modifier
    elif wet:
        threat = 0.35
        overlays.append("weather")
        for direction in exits:
            exit_modifiers[str(direction)] = {"state": "open", "labelSuffix": "slick route", "threat": threat}
    if environment == "subterranean" and stormy:
        overlays.append("flood-risk")
        threat = max(threat, 0.8)
    return {"threat": threat, "overlays": overlays, "exitModifiers": exit_modifiers}


@app.post("/map/sync")
def sync_map(payload: MapSyncPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        places = [upsert_place(conn, place) for place in payload.places]
        if not places and payload.current_location:
            places = [upsert_place(conn, {"id": payload.current_location, "name": payload.current_location, "layer": "local"})]
        add_event(conn, "map_synced", "World", payload.current_location, {"places": len(places)})
    return {"places": places}


@app.get("/map/placements")
def map_placements(location: str = "") -> dict[str, Any]:
    with db_lock, db() as conn:
        places = known_places(conn)
        if location:
            rows = conn.execute("select * from characters where location=? order by name", (location,)).fetchall()
        else:
            rows = conn.execute("select * from characters order by location,name").fetchall()
    characters = []
    for row in rows:
        char = character_from_row(row)
        pos = char.get("profile", {}).get("map_position") or default_map_position(char.get("location", ""))
        characters.append({"name": char["name"], "role": char["role"], "location": char["location"], "position": pos, "party": char.get("profile", {}).get("party", "")})
    return {"places": places, "characters": characters}


@app.post("/map/intercept")
def map_intercept(payload: MapInterceptPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        synced = [upsert_place(conn, place) for place in payload.places]
        places = known_places(conn)
        action = choose_intercept_action(payload, places or synced)
        if action:
            event = add_event(conn, "map_dynamic_action", "Map", payload.current_location, {"action": action, "text": payload.text[:500]})
        else:
            event = add_event(conn, "map_intercept_checked", "Map", payload.current_location, {"matched": False})
    if action:
        message = {"type": "dynamic_action", "payload": {**action, "currentLocation": payload.current_location}, "ts": now_iso()}
        queue_ws_broadcast(message)
        return {"handled": True, "action": action, "event": event}
    return {"handled": False, "reason": "no_authoritative_match", "event": event}


@app.post("/map/layout")
def map_layout(payload: LayoutPayload) -> dict[str, Any]:
    node = dict(payload.node or {})
    location = str(payload.location or node.get("name") or "Starting Location").strip() or "Starting Location"
    node.setdefault("name", location)
    exits = payload.nav_graph.get(location) if isinstance(payload.nav_graph.get(location), dict) else node.get("exits", {})
    if not isinstance(exits, dict):
        exits = {}
    environment = classify_environment_py(node)
    modifiers = weather_layout_modifiers(environment, payload.weather, exits)
    environment_state = {
        "environment": environment,
        "weather": payload.weather,
        "timeOfDay": payload.time_of_day,
        "threat": modifiers["threat"],
        "overlays": modifiers["overlays"],
        "exitModifiers": modifiers["exitModifiers"],
        "updatedAt": now_iso(),
    }
    node["environmentState"] = environment_state
    node["exits"] = exits
    with db_lock, db() as conn:
        place = upsert_place(conn, {**node, "name": location, "payload": node, "tags": [environment, str(payload.weather or "Clear")]})
        event = add_event(conn, "map_layout_updated", "Map", location, {"environmentState": environment_state})
    queue_ws_broadcast({"type": "layout_updated", "payload": {"location": location, "environmentState": environment_state}, "ts": now_iso()})
    return {"ok": True, "place": place, "node": node, "environmentState": environment_state, "event": event}


@app.post("/characters/{name}/move")
def move_character(name: str, payload: MovePayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
        if not row:
            return {"ok": False, "reason": "unknown_character"}
        character = character_from_row(row)
        old = character.get("location", "")
        character["location"] = payload.location
        if payload.x is not None and payload.y is not None:
            character.setdefault("profile", {})["map_position"] = {"x": max(0, min(1, payload.x)), "y": max(0, min(1, payload.y)), "z": payload.z}
        else:
            character.setdefault("profile", {})["map_position"] = default_map_position(payload.location)
        remember(character, "movement", f"Moved from {old or 'somewhere'} to {payload.location}: {payload.reason}", importance=0.45, tags=["movement", payload.location])
        save_character(conn, character)
        event = add_event(conn, "npc_manual_move", character["name"], payload.location, {"from": old, "to": payload.location, "reason": payload.reason, "forced": payload.force})
    return {"ok": True, "character": character, "event": event}


@app.get("/characters/{name}/schedule")
def get_schedule(name: str) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
    return {"schedule": character_from_row(row)["schedule"] if row else []}


@app.put("/characters/{name}/schedule")
def put_schedule(name: str, payload: SchedulePayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
        if not row:
            return {"ok": False, "reason": "unknown_character"}
        character = character_from_row(row)
        character["schedule"] = payload.schedule
        remember(character, "schedule", "Schedule was updated.", importance=0.55, tags=["schedule"])
        save_character(conn, character)
        add_event(conn, "npc_schedule_updated", character["name"], character.get("location", ""), {"schedule": payload.schedule})
    return {"ok": True, "schedule": payload.schedule}


@app.get("/characters/{name}/relationships")
def get_relationships(name: str) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
    return {"relationships": character_from_row(row)["relationships"] if row else {}}


@app.post("/relationships/link")
def link_relationship(payload: RelationshipPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        rows = {
            row["name"].lower(): character_from_row(row)
            for row in conn.execute("select * from characters where lower(name) in (lower(?),lower(?))", (payload.a, payload.b)).fetchall()
        }
        a = rows.get(payload.a.lower())
        b = rows.get(payload.b.lower())
        if not a or not b:
            return {"ok": False, "reason": "unknown_character"}
        data = payload.model_dump()
        deltas = {key: value for key, value in data.items() if key in {"affinity", "trust", "suspicion", "romance", "rivalry"} and value is not None}
        note = payload.note or f"Relationship updated between {a['name']} and {b['name']}."
        rel_a = adjust_relationship(a, b["name"], **deltas, note=note)
        rel_b = adjust_relationship(b, a["name"], **deltas, note=note)
        remember(a, "relationship", note, importance=0.55, tags=["relationship", b["name"]])
        remember(b, "relationship", note, importance=0.55, tags=["relationship", a["name"]])
        save_character(conn, a)
        save_character(conn, b)
        add_event(conn, "relationship_linked", a["name"], a.get("location", ""), {"a": a["name"], "b": b["name"], "relationship": rel_a})
    return {"ok": True, "a": a["name"], "b": b["name"], "relationship_a": rel_a, "relationship_b": rel_b}


@app.post("/characters/{name}/memory")
def add_memory(name: str, payload: MemoryPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
        if not row:
            return {"ok": False, "reason": "unknown_character"}
        character = character_from_row(row)
        remember(character, payload.kind, payload.text, importance=payload.importance, tags=payload.tags, source=payload.source)
        save_character(conn, character)
        event = add_event(conn, "npc_memory_added", character["name"], character.get("location", ""), payload.model_dump())
    return {"ok": True, "character": character, "event": event}


@app.post("/characters/{name}/recall")
def recall_character(name: str, payload: RecallPayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (name,)).fetchone()
    if not row:
        return {"ok": False, "reason": "unknown_character", "memories": []}
    character = character_from_row(row)
    return {"ok": True, "character": character["name"], "memories": recall_memories(character, payload.query, payload.limit, payload.include_distortions)}


@app.post("/action/process")
def process_action(payload: ActionPayload) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    tactic = tactic_summary(payload)
    with db_lock, db() as conn:
        events.append(add_event(conn, "player_action", payload.actor, payload.location, payload.model_dump()))
        if payload.visible_to:
            names = {name.lower() for name in payload.visible_to}
            visible_rows = conn.execute("select * from characters order by name").fetchall()
            visible_rows = [row for row in visible_rows if row["name"].lower() in names]
        else:
            visible_rows = conn.execute("select * from characters where location=? order by name", (payload.location,)).fetchall()
        for row in visible_rows:
            character = character_from_row(row)
            remember(character, "observed_action", f"Saw {payload.actor} use: {payload.action or payload.text}", importance=0.6, tags=["action", *payload.tags], source=payload.actor)
            if "battle" in payload.tags or payload.tactic or any(word in tactic for word in ["ambush", "guard", "heal", "counter", "magic", "ranged", "stealth"]):
                seen = character.setdefault("tactics_seen", [])
                seen.append({"ts": now_iso(), "actor": payload.actor, "summary": tactic, "raw": payload.tactic})
                character["tactics_seen"] = seen[-40:]
                events.append(add_event(conn, "npc_learned_tactic", character["name"], character["location"], {"from": payload.actor, "tactic": tactic}))
            rel = character.setdefault("relationships", {}).setdefault(payload.actor, {"affinity": 50, "trust": 50, "suspicion": 0})
            rel["trust"] = clamp01(float(rel.get("trust", 50)) / 100 + 0.01) * 100
            save_character(conn, character)
    return {"ok": True, "events": events, "observed_by": [event["actor"] for event in events if event["type"] == "npc_learned_tactic"]}


@app.post("/world/tick")
def world_tick(payload: TickPayload) -> dict[str, Any]:
    generated: list[dict[str, Any]] = []
    with db_lock, db() as conn:
        rows = conn.execute("select * from characters order by name").fetchall()
        for row in rows:
            generated.extend(simulate_character(conn, character_from_row(row), payload.minutes, active_party=payload.active_party, user_available=payload.user_available))
        
        # Smart AI World Event Engine integration
        try:
            from python.world_events import simulate_world_events
            event_logs = simulate_world_events(conn, payload.minutes)
            generated.extend(event_logs)
        except Exception as e:
            import logging
            logging.error(f"AI World Events Simulation error: {e}")

        add_event(conn, "world_tick", "World", payload.current_location, {"minutes": payload.minutes, "generated": len(generated)})
        chars = [character_from_row(row) for row in conn.execute("select * from characters order by name").fetchall()]
        recent = recent_events_conn(conn, 30) if payload.include_feed else []
    return {"ok": True, "characters": chars, "events": generated, "recent": recent}


def recent_events_conn(conn: sqlite3.Connection, limit: int) -> list[dict[str, Any]]:
    rows = conn.execute("select * from events order by id desc limit ?", (limit,)).fetchall()
    return [
        {"id": row["id"], "ts": row["ts"], "type": row["type"], "actor": row["actor"], "location": row["location"], "payload": decode(row["payload"], {})}
        for row in rows
    ]


@app.get("/events/recent")
def recent_events(limit: int = 50) -> dict[str, Any]:
    safe_limit = max(1, min(200, int(limit or 50)))
    with db_lock, db() as conn:
        events = recent_events_conn(conn, safe_limit)
    return {"events": events}


@app.get("/messages/recent")
def recent_messages(limit: int = 50, channel: str = "") -> dict[str, Any]:
    safe_limit = max(1, min(200, int(limit or 50)))
    with db_lock, db() as conn:
        if channel:
            rows = conn.execute("select * from messages where channel=? order by id desc limit ?", (channel, safe_limit)).fetchall()
        else:
            rows = conn.execute("select * from messages order by id desc limit ?", (safe_limit,)).fetchall()
    return {
        "messages": [
            {
                "id": row["id"],
                "ts": row["ts"],
                "channel": row["channel"],
                "sender": row["sender"],
                "recipient": row["recipient"],
                "location": row["location"],
                "text": row["text"],
                "payload": decode(row["payload"], {}),
            }
            for row in rows
        ]
    }


@app.post("/feed/recent")
def feed_recent(payload: FeedQuery) -> dict[str, Any]:
    safe_limit = max(1, min(200, int(payload.limit or 50)))
    clauses = []
    args: list[Any] = []
    if payload.channel:
        clauses.append("channel=?")
        args.append(payload.channel)
    if payload.location:
        clauses.append("location=?")
        args.append(payload.location)
    if payload.recipient:
        clauses.append("(recipient=? or sender=?)")
        args.extend([payload.recipient, payload.recipient])
    where = f"where {' and '.join(clauses)}" if clauses else ""
    with db_lock, db() as conn:
        rows = conn.execute(f"select * from messages {where} order by id desc limit ?", (*args, safe_limit)).fetchall()
    messages = []
    for row in rows:
        payload_data = decode(row["payload"], {})
        if payload.party and payload_data.get("party") != payload.party:
            continue
        messages.append(
            {
                "id": row["id"],
                "ts": row["ts"],
                "channel": row["channel"],
                "sender": row["sender"],
                "recipient": row["recipient"],
                "location": row["location"],
                "text": row["text"],
                "payload": payload_data,
            }
        )
    return {"messages": messages[:safe_limit]}


@app.post("/messages/send")
def send_message(payload: MessagePayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        message = add_message(conn, payload.channel, payload.sender, payload.recipient, payload.location, payload.text)
        add_event(conn, "message_sent", payload.sender, payload.location, {"message": message})
    return {"message": message}


@app.post("/messages/send_with_image")
def send_message_with_image(payload: MessagePayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        message = add_message(conn, payload.channel, payload.sender, payload.recipient, payload.location, payload.text)
        add_event(conn, "message_sent", payload.sender, payload.location, {"message": message})
    message_id = str(message.get("id", ""))
    attachment_data = {
        "message_id": message_id,
        "attachment_id": "0",
        "sender_id": payload.sender,
        "subject": payload.text[:200] if payload.text else "",
        "context": payload.location or "",
        "message_type": "photo",
        "group": payload.channel == "party",
    }
    visual_result = trigger_message_image(message_id, attachment_data)
    message["media_ids"] = []
    if visual_result and visual_result.get("visual_key"):
        message["media_ids"].append(visual_result["visual_key"])
        message["image_status"] = visual_result.get("image_status", "pending")
        message["image_url"] = visual_result.get("image_url")
    queue_ws_broadcast({
        "type": "message_with_image",
        "payload": {
            "message": message,
            "visual": visual_result,
        },
        "ts": now_iso(),
    })
    return {"message": message, "visual": visual_result}


@app.post("/feed/send")
def feed_send(payload: MessagePayload) -> dict[str, Any]:
    return send_message(payload)


@app.post("/phone/text")
def phone_text(payload: PhonePayload) -> dict[str, Any]:
    return phone_contact(payload.model_copy(update={"mode": "sms"}))


@app.post("/phone/contact")
def phone_contact(payload: PhonePayload) -> dict[str, Any]:
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (payload.recipient,)).fetchone()
        if not row:
            return {"answered": False, "reason": "unknown_recipient"}
        character = character_from_row(row)
        needs = character.get("needs", {})
        rel = character.get("relationships", {}).get(payload.caller, {"affinity": 50, "trust": 50})
        availability = character.get("profile", {}).get("availability", default_availability(character.get("role", "")))
        base_key = "text_answer_base" if payload.mode in {"sms", "text"} else "phone_answer_base"
        answer_score = (float(rel.get("affinity", 50)) + float(rel.get("trust", 50))) / 200
        answer_score = (answer_score + float(availability.get(base_key, 0.55))) / 2
        answer_score += 0.15 if needs.get("social", 0.5) < 0.35 else 0
        answer_score -= 0.25 if needs.get("energy", 0.5) < 0.25 else 0
        if current_hour() in set(int(h) for h in availability.get("quiet_hours", [])):
            answer_score -= 0.35
        answered = random.random() < max(0.05, min(0.95, answer_score))
        text = f"{payload.recipient} answered." if answered else f"{payload.recipient} did not answer."
        message = add_message(conn, "phone" if payload.mode == "call" else "sms", character["name"], payload.caller, character["location"], text, {"answered": answered, "incoming": payload.text})
        remember(character, "phone", f"{'Answered' if answered else 'Missed'} {payload.mode} from {payload.caller}: {payload.text}", importance=0.45, tags=["phone", payload.caller])
        save_character(conn, character)
        add_event(conn, "phone_contact", character["name"], character["location"], {"caller": payload.caller, "mode": payload.mode, "answered": answered})
    return {"answered": answered, "message": message, "character": character}


@app.post("/battle/plan")
def battle_plan(payload: BattlePlanPayload) -> dict[str, Any]:
    profile = payload.context.get("enemyProfile", {}) if isinstance(payload.context, dict) else {}
    with db_lock, db() as conn:
        row = conn.execute("select * from characters where lower(name)=lower(?)", (payload.character,)).fetchone()
        if row:
            character = character_from_row(row)
        elif isinstance(profile, dict) and profile:
            raw_stats = profile.get("stats") if isinstance(profile.get("stats"), dict) else {}
            derived = profile.get("derived") if isinstance(profile.get("derived"), dict) else {}
            derived_stats = derived.get("stats") if isinstance(derived.get("stats"), dict) else {}
            merged_stats = {**derived_stats, **raw_stats}
            character = {
                "name": str(profile.get("name") or payload.character),
                "stats": {
                    "strength": merged_stats.get("strength", merged_stats.get("str", 5)),
                    "agility": merged_stats.get("agility", merged_stats.get("dex", 5)),
                    "magic": merged_stats.get("magic", merged_stats.get("int", 5)),
                    "resolve": merged_stats.get("resolve", merged_stats.get("wis", 5)),
                    "tactics": merged_stats.get("tactics", merged_stats.get("per", 5)),
                },
                "tactics_seen": [],
                "location": str(payload.context.get("location") or ""),
            }
        else:
            return {"ok": False, "reason": "unknown_character"}
        plan = battle_plan_for(character, payload.opponent, payload.context)
        add_event(conn, "battle_plan_generated", character["name"], character.get("location", ""), {"plan": plan, "allies": payload.allies})
    return {"ok": True, "plan": plan}


@app.post("/battle/enemy/generate")
def battle_enemy_generate(payload: EnemyGeneratePayload) -> dict[str, Any]:
    definition = generate_enemy_definition(
        payload.name,
        payload.context,
        payload.player_level,
        payload.player_stats,
        payload.tier,
        payload.seed_nonce,
    )
    return {"ok": True, "enemy": definition}


@app.post("/internal/route")
def internal_route(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "route": "living-world",
        "recommendation": "Use FastAPI for NPC state, memory, schedules, relationships, messages, and observed tactics.",
        "payload": payload,
    }


def load_json_state(path: Path, default_val: Any) -> Any:
    if not path.exists():
        return default_val
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default_val


def save_json_state(path: Path, data: Any) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


class StateUpdatePayload(BaseModel):
    state: dict[str, Any]


class SavePagePayload(BaseModel):
    url: str = ""
    html: str = ""


class CreatePostPayload(BaseModel):
    author: str = "Player"
    content: str = ""
    tag: str = "Cozy"
    tone: str = "Neutral"


class CreateCommentPayload(BaseModel):
    post_id: str = ""
    author: str = "Player"
    content: str = ""


class LikePostPayload(BaseModel):
    post_id: str = ""
    username: str = ""


class InstavibeSettingsPayload(BaseModel):
    enabled: bool = False
    sort_mode: str = "for_you"


class InstavibeEventPayload(BaseModel):
    event: str = ""
    npcs: list[str] = Field(default_factory=list)
    impact: str = "Low"
    location: str = ""
    text: str = ""


RIVALS_TEMPLATES = [
    "Are you really posting about this *again*? Get a grip.",
    "Classic {author}. Always making it about yourself.",
    "I've seen better takes from a literal rookie.",
    "Is this supposed to be impressive? Please.",
    "Let's see if you can back that talk up in practice.",
    "Must be nice to have so much free time to post this.",
    "Don't hold your breath, some of us are actually busy.",
    "Please, not this again. Nobody is buying it.",
    "Honestly, who asked?"
]

FRIENDS_TEMPLATES = [
    "OMG, yes! So proud of you! ✨",
    "This is exactly what I needed to hear today.",
    "You're doing amazing, let's meet up soon!",
    "Absolutely true! Let's get lunch next week.",
    "Preach! 💖 You got this!",
    "So true! Tell me more about it next time.",
    "I'm here for you, no matter what! Keep it up.",
    "This is so sweet, love this for you!",
    "Always supporting you! Let's conquer the day!"
]

NEUTRAL_TEMPLATES = [
    "Wait, what happened?",
    "Interesting point. Let's see how it plays out.",
    "Is this about that thing in class?",
    "Hmm, I'm not sure if I agree, but interesting.",
    "Did you hear the latest updates?",
    "Ah, that makes sense.",
    "Wait, really? Let me know details later.",
    "Nice post. Let's catch up soon."
]


INSTAVIBE_TAGS = ["Conflict", "Romance", "Work", "Money", "Fitness", "Drama", "Cozy", "Food", "Social", "Travel"]
INSTAVIBE_TONES = ["Positive", "Neutral", "Negative"]


def clamp_text(value: Any, max_len: int) -> str:
    return str(value or "").strip()[:max_len]


def default_instavibe_state() -> dict[str, Any]:
    return {
        "enabled": False,
        "sort_mode": "for_you",
        "trend_tag": "Cozy",
        "trend_updated_at": 0,
        "last_tick_at": 0,
        "followers": 12,
        "influence": 0.12,
        "reputation": 0.58,
        "shadowban_risk": 0.0,
        "queued_count": 0,
        "notifications": [],
    }


def load_instavibe_state() -> dict[str, Any]:
    state = default_instavibe_state()
    loaded = load_json_state(INSTAVIBE_STATE_PATH, {})
    if isinstance(loaded, dict):
        state.update(loaded)
    state["notifications"] = list(state.get("notifications") or [])[:40]
    state["trend_tag"] = state.get("trend_tag") if state.get("trend_tag") in INSTAVIBE_TAGS else "Cozy"
    state["sort_mode"] = "chronological" if state.get("sort_mode") == "chronological" else "for_you"
    state["enabled"] = bool(state.get("enabled"))
    return state


def save_instavibe_state(state: dict[str, Any]) -> None:
    state["notifications"] = list(state.get("notifications") or [])[:40]
    save_json_state(INSTAVIBE_STATE_PATH, state)


def instavibe_period_tag(hour: int | None = None) -> str:
    h = current_hour() if hour is None else int(hour)
    if 5 <= h < 11:
        return random.choice(["Fitness", "Work", "Travel", "Food"])
    if 11 <= h < 17:
        return random.choice(["Food", "Work", "Money", "Cozy"])
    if 17 <= h < 22:
        return random.choice(["Social", "Drama", "Romance", "Food"])
    return random.choice(["Drama", "Conflict", "Romance", "Cozy"])


def normalize_instavibe_post(post: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    ts = float(post.get("ts") or datetime.now(timezone.utc).timestamp() * 1000)
    tag = clamp_text(post.get("tag") or "Cozy", 32)
    if tag not in INSTAVIBE_TAGS:
        tag = "Cozy"
    tone = clamp_text(post.get("tone") or "Neutral", 32)
    if tone not in INSTAVIBE_TONES:
        tone = "Neutral"
    metrics = post.get("metrics") if isinstance(post.get("metrics"), dict) else {}
    likes = int(metrics.get("likes", post.get("likes", 0)) or 0)
    comments = post.get("comments") if isinstance(post.get("comments"), list) else []
    reach = int(metrics.get("reach", max(1, likes * 8 + len(comments) * 5 + random.randint(4, 20))) or 1)
    post_id = clamp_text(post.get("post_id") or post.get("id") or f"post_{int(ts)}_{random.randint(10,99)}", 80)
    out = {
        **post,
        "id": post_id,
        "post_id": post_id,
        "author": clamp_text(post.get("author") or post.get("username") or "Local", 80),
        "username": clamp_text(post.get("username") or post.get("author") or "Local", 80),
        "content": clamp_text(post.get("content"), 700),
        "tag": tag,
        "tone": tone,
        "mentions": [clamp_text(x, 80) for x in list(post.get("mentions") or [])[:8]],
        "metrics": {"likes": likes, "comments": len(comments), "shares": int(metrics.get("shares", 0) or 0), "reach": reach},
        "likes": likes,
        "comments": comments[:12],
        "likes_by": list(post.get("likes_by") or [])[:40],
        "image_url": clamp_text(post.get("image_url") or "", 500),
        "image_status": clamp_text(post.get("image_status") or "", 32),
        "ts": ts,
    }
    if tag == state.get("trend_tag"):
        out["metrics"]["reach"] = int(out["metrics"]["reach"] * 1.35)
    return out


def instavibe_notification(state: dict[str, Any], sender: str, preview: str, priority: str = "normal") -> None:
    item = {
        "id": f"insta_notif_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{random.randint(10,99)}",
        "app": "Instavibe",
        "sender": clamp_text(sender, 80),
        "preview_text": clamp_text(preview, 120),
        "timestamp": now_iso(),
        "priority": clamp_text(priority, 24),
    }
    state.setdefault("notifications", []).insert(0, item)
    state["notifications"] = state["notifications"][:40]
    state["queued_count"] = int(state.get("queued_count") or 0) + 1


def instavibe_caption(author: str, tag: str, tone: str, event: str = "", location: str = "") -> str:
    place = f" near {location}" if location else ""
    pools = {
        "Conflict": [
            "Some people really choose chaos before breakfast.",
            "Not naming names, but the energy is loud today.",
            "If you saw what happened{place}, no you did not.",
        ],
        "Romance": [
            "Trying very hard to act normal about a conversation that was not normal.",
            "Soft launch? No. Soft panic.",
            "Some smiles stay in your head too long.",
        ],
        "Work": [
            "Clocked in, locked in, mildly haunted.",
            "Today's task list is looking at me like it wants a duel.",
            "Professional on the outside, buffering on the inside.",
        ],
        "Money": [
            "Budget survived the morning. That counts as a win.",
            "Why does every errand cost more than expected?",
            "New listing just dropped and my wallet flinched.",
        ],
        "Fitness": [
            "Morning reps done. Personality still loading.",
            "Leg day remains a suspicious institution.",
            "If I post it, it means I actually went.",
        ],
        "Drama": [
            "I can't believe they actually said that to me...",
            "The hallway got quiet in a way I did not enjoy.",
            "Someone knows more than they are posting.",
        ],
        "Food": [
            "Lunch fixed exactly one of my problems.",
            "Found the good table today. Tiny victory.",
            "The snack run became a full side quest.",
        ],
        "Social": [
            "Plans changed three times and somehow got better.",
            "The group chat is moving faster than my brain.",
            "Tonight has plot energy.",
        ],
        "Travel": [
            "Transit delay, but at least the view is doing something.",
            "New block, same feeling that someone is watching.",
            "Took the long way and learned something useful.",
        ],
        "Cozy": [
            "Quiet hour. Warm drink. No questions.",
            "Small peace is still peace.",
            "Keeping today gentle on purpose.",
        ],
    }
    text = random.choice(pools.get(tag, pools["Cozy"])).format(place=place)
    if event and tone == "Negative":
        text = f"{text} #{clamp_text(event, 24).replace(' ', '')}"
    return text[:700]


def build_instavibe_post(author: str, tag: str, tone: str = "Neutral", content: str = "", mentions: list[str] | None = None) -> dict[str, Any]:
    ts = datetime.now(timezone.utc).timestamp() * 1000
    post_id = f"post_{int(ts)}_{random.randint(100,999)}"
    comments: list[dict[str, Any]] = []
    post = {
        "id": post_id,
        "post_id": post_id,
        "author": clamp_text(author, 80) or "Local",
        "username": clamp_text(author, 80) or "Local",
        "content": clamp_text(content, 700),
        "tag": tag if tag in INSTAVIBE_TAGS else "Cozy",
        "tone": tone if tone in INSTAVIBE_TONES else "Neutral",
        "mentions": list(mentions or [])[:8],
        "ts": ts,
        "likes": random.randint(0, 12),
        "comments": comments,
        "likes_by": [],
        "metrics": {"likes": 0, "comments": 0, "shares": random.randint(0, 2), "reach": random.randint(20, 120)},
    }
    post["metrics"]["likes"] = post["likes"]
    return post


def queue_instavibe_image_generation(post: dict[str, Any]) -> None:
    author = clamp_text(post.get("author") or post.get("username") or "", 80)
    if not author:
        return
    post_id = clamp_text(post.get("id") or post.get("post_id") or "", 80)
    content = clamp_text(post.get("content") or "", 700)
    tag = clamp_text(post.get("tag") or "Cozy", 32)
    tone = clamp_text(post.get("tone") or "Neutral", 32)
    try:
        with db_lock, db() as conn:
            row = conn.execute("select * from characters where lower(name)=lower(?)", (author,)).fetchone()
            if not row:
                return
            character = character_from_row(row)
            profile = character.get("profile", {})
            appearance = clamp_text(profile.get("appearance") or "", 500)
            personality = clamp_text(profile.get("personality") or "", 200)
        if post_id:
            post_data = {
                "post_id": post_id,
                "author": author,
                "subject": content or f"{tag} post by {author}",
                "content": content,
                "location": character.get("location", ""),
                "mood": tone,
                "post_type": tag,
                "appearance": appearance,
            }
            trigger_instavibe_post_image(post_id, post_data)
        character_id = author.lower().replace(" ", "_")
        profile_data = {
            "character_id": character_id,
            "name": author,
            "role": clamp_text(character.get("role") or "NPC", 80),
            "age": profile.get("age", ""),
            "gender": profile.get("gender", ""),
            "hair": profile.get("hair", ""),
            "expression": profile.get("expression", ""),
            "appearance": appearance,
        }
        trigger_instavibe_profile_pic(character_id, profile_data)
    except Exception:
        return


def sort_instavibe_feed(feed: list[dict[str, Any]], state: dict[str, Any], mode: str = "") -> list[dict[str, Any]]:
    normalized = [normalize_instavibe_post(p, state) for p in feed if isinstance(p, dict)]
    if (mode or state.get("sort_mode")) == "chronological":
        return sorted(normalized, key=lambda p: float(p.get("ts") or 0), reverse=True)
    trend = state.get("trend_tag")
    return sorted(
        normalized,
        key=lambda p: (
            (1.8 if p.get("tag") == trend else 0)
            + min(2.0, float(p.get("metrics", {}).get("reach", 0)) / 140.0)
            + min(1.0, len(p.get("comments") or []) / 5.0)
            + float(p.get("ts") or 0) / 10_000_000_000_000.0
        ),
        reverse=True,
    )


def tick_instavibe_feed(feed: list[dict[str, Any]], force: bool = False, event_capsule: InstavibeEventPayload | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    state = load_instavibe_state()
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    if now_ms - float(state.get("trend_updated_at") or 0) > 3 * 60 * 60 * 1000:
        state["trend_tag"] = instavibe_period_tag()
        state["trend_updated_at"] = now_ms
    state["shadowban_risk"] = max(0.0, float(state.get("shadowban_risk") or 0) - 0.01)
    state["followers"] = max(0, int(float(state.get("followers") or 0) + float(state.get("influence") or 0) * 2 - float(state.get("shadowban_risk") or 0) * 3))

    generated: list[dict[str, Any]] = []
    if event_capsule:
        names = [clamp_text(n, 80) for n in event_capsule.npcs[:3] if clamp_text(n, 80)]
        author = names[0] if names else "Local Feed"
        tag_map = {
            "combat": "Conflict", "fight": "Conflict", "attack": "Conflict", "romance": "Romance",
            "date": "Romance", "job": "Work", "work": "Work", "purchase": "Money", "shop": "Money",
            "travel": "Travel", "food": "Food", "argument": "Drama",
        }
        key = event_capsule.event.lower()
        tag = next((v for k, v in tag_map.items() if k in key), instavibe_period_tag())
        tone = "Negative" if tag in {"Conflict", "Drama"} or event_capsule.impact.lower() == "high" else "Neutral"
        content = clamp_text(event_capsule.text, 420) or instavibe_caption(author, tag, tone, event_capsule.event, event_capsule.location)
        generated.append(build_instavibe_post(author, tag, tone, content, names[1:]))
    elif force or now_ms - float(state.get("last_tick_at") or 0) > 8 * 60 * 1000:
        with db_lock, db() as conn:
            rows = conn.execute("select * from characters order by random() limit 3").fetchall()
        for row in rows[: random.randint(1, 3)]:
            npc = character_from_row(row)
            tag = instavibe_period_tag()
            stats = npc.get("stats", {})
            suspicion = float(stats.get("suspicion", stats.get("Suspicion", 0)) or 0)
            anxiety = float(stats.get("anxiety", stats.get("Anxiety", 0)) or 0)
            if suspicion >= 60:
                tag, tone = "Drama", "Negative"
            elif anxiety >= 60:
                tag, tone = "Drama", "Negative"
            else:
                tone = random.choice(["Positive", "Neutral", "Neutral", "Negative"])
            generated.append(build_instavibe_post(npc["name"], tag, tone, instavibe_caption(npc["name"], tag, tone, location=npc.get("location", ""))))
        state["last_tick_at"] = now_ms

    for post in generated:
        generate_drama_comments(post)
        feed.insert(0, post)
        instavibe_notification(state, post["author"], post["content"], "high" if post.get("tone") == "Negative" else "normal")

    feed = [normalize_instavibe_post(p, state) for p in feed][:120]
    save_json_state(SOCIAL_FEED_PATH, feed)
    save_instavibe_state(state)
    if generated:
        queue_ws_broadcast({"type": "instavibe_update", "payload": {"posts": generated, "state": state}, "ts": now_iso()})
    return feed, state


def generate_drama_comments(post: dict[str, Any]) -> None:
    author = post["author"]
    with db_lock, db() as conn:
        rows = conn.execute("select * from characters where name != ?", (author,)).fetchall()
        if not rows:
            return
        commenters = random.sample(rows, min(len(rows), random.randint(1, 3)))
        for row in commenters:
            npc = character_from_row(row)
            npc_name = npc["name"]
            rels = npc.get("relationships", {})
            rel_entry = {"affinity": 50, "trust": 50}
            for k, v in rels.items():
                if k.lower() == author.lower():
                    rel_entry = v
                    break
            affinity = float(rel_entry.get("affinity", 50))
            if affinity <= 35:
                content = random.choice(RIVALS_TEMPLATES).format(author=author)
            elif affinity >= 65:
                content = random.choice(FRIENDS_TEMPLATES).format(author=author)
            else:
                content = random.choice(NEUTRAL_TEMPLATES).format(author=author)
            comment = {
                "id": f"comment_{int(datetime.now(timezone.utc).timestamp() * 1000) + random.randint(0, 100)}",
                "author": npc_name,
                "content": content,
                "ts": (post["ts"] + random.randint(30000, 300000))
            }
            post["comments"].append(comment)
            post["likes"] += random.choice([0, 1])
            if random.random() < 0.5:
                post["likes_by"].append(npc_name)


def tick_social_feed(feed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with db_lock, db() as conn:
        rows = conn.execute("select * from characters").fetchall()
    
    for row in rows:
        npc = character_from_row(row)
        name = npc["name"]
        recent_by_npc = [p for p in feed if p["author"] == name]
        if recent_by_npc:
            if datetime.now(timezone.utc).timestamp() * 1000 - recent_by_npc[0]["ts"] < 300000:
                continue
                
        stats = npc.get("stats", {})
        needs = npc.get("needs", {})
        anxiety = float(stats.get("anxiety", stats.get("Anxiety", 0)))
        suspicion = float(stats.get("suspicion", stats.get("Suspicion", 0)))
        energy = float(needs.get("energy", needs.get("Energy", 100)))
        
        post_content = None
        if anxiety >= 60:
            post_content = random.choice([
                "I... I can't shake this bad feeling today. Everything feels off. 😰",
                "Why does everyone keep staring at me in class? Did I do something wrong?",
                "Trying to breathe, but my chest feels so tight. I hate this.",
                "Sometimes I just want to disappear. Is anyone else feeling this way?",
                "I can't believe they actually said that to me... I'm so anxious right now."
            ])
        elif suspicion >= 60:
            post_content = random.choice([
                "Something strange is going on. I saw someone sneaking around the locker room.",
                "Don't trust the rumors. Someone is playing a dangerous game behind the scenes.",
                "If you think you hidden your tracks, think again. I saw what you did.",
                "People think they can get away with anything here. I'm keeping my eyes open. 👁️",
                "I found a weird note in my desk today. Who left this?"
            ])
        elif energy <= 30:
            post_content = random.choice([
                "Absolutely exhausted. I don't think I can make it through the next session.",
                "Running on pure caffeine and regret. Save me.",
                "Need to sleep for a literal century. Goodbye world."
            ])
        
        if not post_content and random.random() < 0.08:
            post_content = random.choice([
                "Just finished practicing. Progress is slow, but getting there!",
                "Beautiful day to walk around the gardens. 🌸",
                "Does anyone know if the library is open late tonight?",
                "Had the best lunch today. 10/10 recommend.",
                "Working on a new recipe! Hopefully it's edible."
            ])
            
        if post_content:
            post_id = f"post_{int(datetime.now(timezone.utc).timestamp() * 1000) + random.randint(0, 1000)}"
            new_post = {
                "id": post_id,
                "author": name,
                "content": post_content,
                "ts": datetime.now(timezone.utc).timestamp() * 1000 - random.randint(1000, 60000),
                "likes": random.randint(0, 5),
                "comments": [],
                "likes_by": []
            }
            generate_drama_comments(new_post)
            feed.insert(0, new_post)
            feed = feed[:100]
            save_json_state(SOCIAL_FEED_PATH, feed)
            queue_ws_broadcast({"type": "social_post", "payload": new_post, "ts": now_iso()})
            break
            
    return feed


@app.get("/state/get-state")
async def get_state_endpoint(location: str = "", character: str = "", channel: str = "") -> dict[str, Any]:
    ui_state = load_json_state(GAME_STATE_PATH, {})
    char_data = None
    if character:
        with db_lock, db() as conn:
            row = conn.execute("select * from characters where lower(name)=lower(?)", (character,)).fetchone()
            if row:
                char_data = character_from_row(row)
    place_data = None
    if location:
        with db_lock, db() as conn:
            row = conn.execute("select * from places where id=?", (location,)).fetchone()
            if row:
                place_data = {
                    "id": row["id"],
                    "name": row["name"],
                    "tags": decode(row["tags"], []),
                    "payload": decode(row["payload"], {})
                }
    return {
        "ui_state": ui_state,
        "character": char_data,
        "place": place_data,
        "server_time": now_iso()
    }


@app.post("/state/update-state")
async def update_state_endpoint(payload: StateUpdatePayload) -> dict[str, Any]:
    ui_state = load_json_state(GAME_STATE_PATH, {})
    ui_state.update(payload.state)
    save_json_state(GAME_STATE_PATH, ui_state)
    queue_ws_broadcast({"type": "state_update", "payload": ui_state, "ts": now_iso()})
    return {"ok": True, "state": ui_state}


@app.get("/browser/pages")
async def get_browser_pages() -> dict[str, Any]:
    pages = load_json_state(BROWSER_PAGES_PATH, {})
    return {"pages": pages}


@app.post("/browser/pages")
async def save_browser_page(payload: SavePagePayload) -> dict[str, Any]:
    pages = load_json_state(BROWSER_PAGES_PATH, {})
    pages[clamp_text(payload.url, 240)] = str(payload.html or "")
    save_json_state(BROWSER_PAGES_PATH, pages)
    return {"ok": True}


@app.get("/instavibe/settings")
async def get_instavibe_settings() -> dict[str, Any]:
    return {"ok": True, "settings": load_instavibe_state()}


@app.post("/instavibe/settings")
async def save_instavibe_settings(payload: InstavibeSettingsPayload) -> dict[str, Any]:
    state = load_instavibe_state()
    state["enabled"] = bool(payload.enabled)
    state["sort_mode"] = "chronological" if payload.sort_mode == "chronological" else "for_you"
    save_instavibe_state(state)
    queue_ws_broadcast({"type": "instavibe_settings", "payload": state, "ts": now_iso()})
    return {"ok": True, "settings": state}


@app.get("/instavibe/feed")
async def get_instavibe_feed(sort: str = "") -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    feed, state = tick_instavibe_feed(feed)
    state["queued_count"] = 0
    save_instavibe_state(state)
    return {"ok": True, "posts": sort_instavibe_feed(feed, state, sort), "state": state}


@app.post("/instavibe/tick")
async def tick_instavibe() -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    feed, state = tick_instavibe_feed(feed, force=True)
    return {"ok": True, "posts": sort_instavibe_feed(feed, state), "state": state}


@app.post("/instavibe/event")
async def ingest_instavibe_event(payload: InstavibeEventPayload) -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    feed, state = tick_instavibe_feed(feed, force=True, event_capsule=payload)
    return {"ok": True, "posts": sort_instavibe_feed(feed, state), "state": state}


@app.get("/social/posts")
async def get_social_posts() -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    feed, state = tick_instavibe_feed(feed)
    return {"posts": sort_instavibe_feed(feed, state), "state": state}


@app.post("/social/posts")
async def create_social_post(payload: CreatePostPayload, background_tasks: BackgroundTasks) -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    state = load_instavibe_state()
    new_post = build_instavibe_post(payload.author, payload.tag, payload.tone, payload.content)
    generate_drama_comments(new_post)
    new_post = normalize_instavibe_post(new_post, state)
    feed.insert(0, new_post)
    feed = [normalize_instavibe_post(p, state) for p in feed][:120]
    save_json_state(SOCIAL_FEED_PATH, feed)
    instavibe_notification(state, new_post["author"], new_post["content"], "normal")
    save_instavibe_state(state)
    queue_ws_broadcast({"type": "social_post", "payload": new_post, "ts": now_iso()})
    background_tasks.add_task(lambda: queue_instavibe_image_generation(new_post))
    return {"ok": True, "post": new_post}


@app.post("/social/comment")
async def create_social_comment(payload: CreateCommentPayload) -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    target_post = None
    for post in feed:
        if post["id"] == payload.post_id:
            target_post = post
            break
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found")
    new_comment = {
        "id": f"comment_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "author": payload.author,
        "content": payload.content,
        "ts": datetime.now(timezone.utc).timestamp() * 1000
    }
    target_post["comments"].append(new_comment)
    save_json_state(SOCIAL_FEED_PATH, feed)
    queue_ws_broadcast({"type": "social_comment", "post_id": payload.post_id, "payload": new_comment, "ts": now_iso()})
    return {"ok": True, "comment": new_comment}


@app.post("/social/like")
async def toggle_social_like(payload: LikePostPayload) -> dict[str, Any]:
    feed = load_json_state(SOCIAL_FEED_PATH, [])
    state = load_instavibe_state()
    target_post = None
    for post in feed:
        if post.get("id") == payload.post_id or post.get("post_id") == payload.post_id:
            target_post = post
            break
    if not target_post:
        raise HTTPException(status_code=404, detail="Post not found")
    username = clamp_text(payload.username, 80) or "Anon"
    likes_by = list(target_post.get("likes_by") or [])
    if username in likes_by:
        likes_by.remove(username)
        liked = False
    else:
        likes_by.append(username)
        liked = True
    target_post["likes_by"] = likes_by[:40]
    target_post["likes"] = len(likes_by)
    metrics = target_post.get("metrics") if isinstance(target_post.get("metrics"), dict) else {}
    metrics["likes"] = len(likes_by)
    metrics["reach"] = int(metrics.get("reach", 1) + (5 if liked else -2))
    target_post["metrics"] = metrics
    target_post = normalize_instavibe_post(target_post, state)
    for i, p in enumerate(feed):
        if p.get("id") == target_post["id"] or p.get("post_id") == target_post["post_id"]:
            feed[i] = target_post
            break
    save_json_state(SOCIAL_FEED_PATH, feed)
    queue_ws_broadcast({"type": "social_like", "post_id": target_post["id"], "username": username, "liked": liked, "payload": target_post, "ts": now_iso()})
    return {"ok": True, "liked": liked, "post": target_post}


@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    active_websockets.add(websocket)
    try:
        await websocket.send_json({"type": "hello", "service": "uie-living-world", "ts": now_iso()})
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "tick":
                result = await asyncio.to_thread(world_tick, TickPayload(**data.get("payload", {})))
                await websocket.send_json({"type": "tick", "payload": result, "ts": now_iso()})
            elif data.get("type") == "action":
                result = await asyncio.to_thread(process_action, ActionPayload(**data.get("payload", {})))
                await websocket.send_json({"type": "action", "payload": result, "ts": now_iso()})
            elif data.get("type") == "map_intercept":
                result = await asyncio.to_thread(map_intercept, MapInterceptPayload(**data.get("payload", {})))
                await websocket.send_json({"type": "map_intercept", "payload": result, "ts": now_iso()})
            elif data.get("type") == "state_update":
                state_data = data.get("payload", {})
                ui_state = load_json_state(GAME_STATE_PATH, {})
                ui_state.update(state_data)
                save_json_state(GAME_STATE_PATH, ui_state)
                await broadcast_ws({"type": "state_update", "payload": ui_state, "ts": now_iso()})
            else:
                await websocket.send_json({"type": "echo", "payload": data, "ts": now_iso()})
    except WebSocketDisconnect:
        return
    finally:
        active_websockets.discard(websocket)


class CausalityEventPayload(BaseModel):
    type: str = "custom"
    domain: str = "world"
    source: str = "unknown"
    payload: dict[str, Any] = Field(default_factory=dict)


class ReputationPayload(BaseModel):
    faction: str
    action_type: str = "social_interaction"
    magnitude: float = 5.0


class EncumbrancePayload(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    equipped: list[dict[str, Any]] = Field(default_factory=list)
    strength: float = 10.0


class ProximityPayload(BaseModel):
    location: str = ""
    characters: list[dict[str, Any]] = Field(default_factory=list)


class QuestDependencyPayload(BaseModel):
    completed_quests: list[str] = Field(default_factory=list)
    pending_quests: list[dict[str, Any]] = Field(default_factory=list)


class DynamicPricePayload(BaseModel):
    base_price: float = 10.0
    supply_level: float = 50.0
    demand_level: float = 50.0
    reputation_modifier: float = 0.0


class WeatherActivityPayload(BaseModel):
    weather: str = "Clear"
    activity: str = ""


class EmotionContagionPayload(BaseModel):
    source_npc: str
    emotion_delta: float = 0.0
    radius: int = 2
    npc_moods: dict[str, float] = Field(default_factory=dict)


class ConsequencePayload(BaseModel):
    trigger_event: str = "custom"
    delay_minutes: float = 60.0
    domain: str = "world"
    action: str = ""
    payload_data: dict[str, Any] = Field(default_factory=dict)
    probability: float = 0.5


class AmbientEventPayload(BaseModel):
    location: str = ""
    npcs: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)


class GossipSeedPayload(BaseModel):
    origin: str = "unknown"
    topic: str = ""
    content: str = ""
    importance: float = 0.5
    tags: list[str] = Field(default_factory=list)


class GossipSpreadPayload(BaseModel):
    npc_knowledge: dict[str, list[str]] = Field(default_factory=dict)
    relationship_strengths: dict[str, float] = Field(default_factory=dict)
    max_spreads: int = 5


class ObjectRenderPayload(BaseModel):
    object_id: str = ""
    name: str = ""
    object_type: str = ""
    description: str = ""
    content: str = ""
    options: list[dict[str, Any]] = Field(default_factory=list)
    pages: list[str] = Field(default_factory=list)
    tracks: list[dict[str, Any]] = Field(default_factory=list)
    destinations: list[dict[str, Any]] = Field(default_factory=list)
    recipes: list[dict[str, Any]] = Field(default_factory=list)
    combination: str = ""
    locked: bool = True
    hint: str = ""
    puzzle_type: str = ""
    game_type: str = ""
    sides: int = 20
    color: str = "#ff4444"
    label: str = ""
    author: str = ""
    reflection: str = ""
    riddle: str = ""
    accepted_offerings: list[dict[str, Any]] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)


class ObjectPlacePayload(BaseModel):
    object_data: dict[str, Any] = Field(default_factory=dict)
    x: float = 0.5
    y: float = 0.5
    location: str = ""


BACKEND_CAPABILITIES.update({
    "causalityEngine": True,
    "reputationMath": True,
    "encumbranceCalc": True,
    "npcProximity": True,
    "questDependencies": True,
    "dynamicPricing": True,
    "weatherActivity": True,
    "emotionContagion": True,
    "consequenceQueue": True,
    "ambientWorld": True,
    "gossipNetwork": True,
    "objectAutoRender": True,
    "objectPlace": True,
})


def py_clamp(v: Any, lo: float, hi: float, fallback: float = 0.0) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        n = fallback
    if n != n:
        n = fallback
    return max(lo, min(hi, n))


def py_norm_key(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip().lower())


def calculate_encumbrance_math(items: list[dict[str, Any]], equipped: list[dict[str, Any]], strength: float) -> dict[str, Any]:
    total_weight = 0.0
    for item in items:
        w = py_clamp(item.get("weight", 0.5), 0, 9999, 0.5)
        qty = max(1, int(item.get("qty", 1) or 1))
        total_weight += w * qty
    for eq in equipped:
        total_weight += py_clamp(eq.get("weight", 0), 0, 9999, 0)
    max_weight = max(10.0, strength * 10.0)
    ratio = total_weight / max_weight if max_weight > 0 else 0
    penalty = 0
    if ratio > 1.0:
        penalty = min(50, int((ratio - 1.0) * 30))
    elif ratio > 0.75:
        penalty = int((ratio - 0.75) * 10)
    return {
        "currentWeight": round(total_weight, 2),
        "maxWeight": round(max_weight, 1),
        "ratio": round(ratio, 2),
        "penalty": penalty,
        "encumbered": ratio > 1.0,
        "overburdened": ratio > 1.5,
    }


def calculate_reputation_math(current_standing: float, action_type: str, magnitude: float) -> dict[str, Any]:
    deltas = {
        "crime_committed": -abs(magnitude),
        "heroic_act": abs(magnitude),
        "quest_completed": abs(magnitude * 0.5),
        "quest_failed": -abs(magnitude * 0.7),
        "purchase": abs(magnitude * 0.1),
        "combat_win": abs(magnitude * 0.3),
        "combat_loss": -abs(magnitude * 0.2),
        "social_interaction": abs(magnitude * 0.2),
    }
    delta = deltas.get(action_type, 0)
    old = py_clamp(current_standing, 0, 100, 50)
    new = py_clamp(old + delta, 0, 100)
    if new >= 80:
        tier = "exalted"
    elif new >= 60:
        tier = "friendly"
    elif new >= 40:
        tier = "neutral"
    elif new >= 20:
        tier = "unfriendly"
    else:
        tier = "hostile"
    return {
        "oldStanding": round(old, 1),
        "newStanding": round(new, 1),
        "delta": round(delta, 2),
        "tier": tier,
    }


def detect_nearby_npcs_math(location: str, characters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    loc = py_norm_key(location)
    if not loc:
        return []
    nearby = []
    for npc in characters:
        npc_loc = py_norm_key(npc.get("location", ""))
        if npc_loc == loc:
            nearby.append({
                "name": npc.get("name", "Unknown"),
                "role": npc.get("role", "NPC"),
                "mood": npc.get("profile", {}).get("current_mood", "neutral"),
            })
    return nearby


def resolve_quest_dependencies_math(completed: list[str], pending: list[dict[str, Any]]) -> dict[str, Any]:
    completed_set = {py_norm_key(q) for q in completed}
    unlocked = []
    blocked = []
    for quest in pending:
        prereqs = quest.get("prerequisites", [])
        if not isinstance(prereqs, list):
            prereqs = []
        all_met = all(py_norm_key(p) in completed_set for p in prereqs)
        if all_met:
            unlocked.append(quest)
        else:
            still_blocked = [p for p in prereqs if py_norm_key(p) not in completed_set]
            blocked.append({**quest, "blockedBy": still_blocked})
    return {
        "unlocked": unlocked,
        "blocked": blocked,
        "completedCount": len(completed_set),
    }


def calculate_dynamic_price_math(base_price: float, supply: float, demand: float, rep_mod: float) -> dict[str, Any]:
    s = py_clamp(supply, 0, 100, 50)
    d = py_clamp(demand, 0, 100, 50)
    r = py_clamp(rep_mod, -50, 50, 0)
    supply_factor = 1.0 + (50 - s) / 100
    demand_factor = 1.0 + (d - 50) / 100
    rep_factor = 1.0 - r / 200
    noise = 0.95 + random.random() * 0.1
    final = max(1, round(base_price * supply_factor * demand_factor * rep_factor * noise))
    return {
        "basePrice": base_price,
        "finalPrice": final,
        "supplyFactor": round(supply_factor, 3),
        "demandFactor": round(demand_factor, 3),
        "reputationFactor": round(rep_factor, 3),
    }


def check_weather_activity_math(weather: str, activity: str) -> dict[str, Any]:
    w = weather.lower().strip()
    a = activity.lower().strip()
    outdoor = {"travel", "explore", "forage", "hunt", "patrol", "camp", "fish", "swim", "climb", "ride"}
    is_outdoor = a in outdoor
    if not is_outdoor:
        return {"compatible": True, "modifier": 1.0, "reason": "indoor_activity"}
    stormy = bool(re.search(r"storm|blizzard|hurricane|tornado|acid rain", w))
    wet = bool(re.search(r"rain|snow|sleet|fog|mist", w))
    extreme = bool(re.search(r"blizzard|hurricane|tornado|acid rain|heatwave|sandstorm", w))
    if extreme:
        return {"compatible": False, "modifier": 0.0, "reason": f"extreme_weather_{w}", "dangerLevel": "high"}
    if stormy:
        return {"compatible": True, "modifier": 0.5, "reason": "stormy_conditions", "dangerLevel": "moderate"}
    if wet:
        return {"compatible": True, "modifier": 0.75, "reason": "wet_conditions", "dangerLevel": "low"}
    return {"compatible": True, "modifier": 1.0, "reason": "clear_conditions", "dangerLevel": "none"}


def propagate_emotion_math(source: str, delta: float, radius: int, npc_moods: dict[str, float]) -> dict[str, Any]:
    src = py_norm_key(source)
    if not src:
        return {"affected": []}
    r = max(1, min(5, int(radius or 2)))
    moods = dict(npc_moods)
    moods[src] = py_clamp(moods.get(src, 50) + delta, 0, 100)
    affected = []
    for npc_key in list(moods.keys()):
        if npc_key == src:
            continue
        distance = abs(hash(npc_key) % (r + 1))
        if distance > r:
            continue
        falloff = 1.0 / (1.0 + distance)
        d = round(delta * falloff * 0.5)
        if d == 0:
            continue
        moods[npc_key] = py_clamp(moods.get(npc_key, 50) + d, 0, 100)
        affected.append({"npc": npc_key, "delta": d, "newMood": moods[npc_key]})
    return {"source": src, "sourceMood": moods[src], "affected": affected, "allMoods": moods}


def generate_ambient_event_math(location: str, npcs: list[str], categories: list[str]) -> dict[str, Any]:
    templates = {
        "social": [
            "{npc} was seen chatting near {location}.",
            "{npc} helped someone at {location}.",
            "{npc} got into a discussion at {location}.",
        ],
        "work": [
            "{npc} was spotted working at {location}.",
            "{npc} had a busy day at {location}.",
            "{npc} trained at {location}.",
        ],
        "personal": [
            "{npc} was browsing shops in {location}.",
            "{npc} took a walk through {location}.",
            "{npc} seemed lost in thought at {location}.",
        ],
        "world": [
            "Rumors are spreading near {location}.",
            "Travelers mentioned unusual activity near {location}.",
            "A merchant caravan arrived at {location}.",
        ],
    }
    cats = categories or list(templates.keys())
    cat = random.choice([c for c in cats if c in templates]) if any(c in templates for c in cats) else "world"
    text_template = random.choice(templates.get(cat, templates["world"]))
    npc = random.choice(npcs) if npcs else "Someone"
    loc = location or "the area"
    text = text_template.replace("{npc}", npc).replace("{location}", loc)
    return {
        "category": cat,
        "text": text,
        "npc": npc,
        "location": loc,
        "timestamp": now_iso(),
    }


def seed_gossip_math(origin: str, topic: str, content: str, importance: float, tags: list[str]) -> dict[str, Any]:
    return {
        "id": f"gossip_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{random.randint(100, 999)}",
        "origin": origin,
        "topic": topic,
        "content": content[:500],
        "importance": py_clamp(importance, 0, 1, 0.5),
        "tags": tags[:8],
        "knownBy": [py_norm_key(origin)],
        "spreadCount": 0,
        "distortionLevel": 0,
        "createdAt": now_iso(),
    }


def spread_gossip_math(gossip_items: list[dict[str, Any]], npc_knowledge: dict[str, list[str]], relationship_strengths: dict[str, float], max_spreads: int) -> dict[str, Any]:
    spread_count = 0
    max_s = max(1, min(20, int(max_spreads or 5)))
    for item in gossip_items:
        if spread_count >= max_s:
            break
        known_by = set(item.get("knownBy", []))
        for spreader in list(known_by):
            if spread_count >= max_s:
                break
            for listener_key, strength in relationship_strengths.items():
                if spread_count >= max_s:
                    break
                if listener_key in known_by:
                    continue
                spread_chance = 0.35 * strength + item.get("importance", 0.5) * 0.3
                if random.random() < spread_chance:
                    item.setdefault("knownBy", []).append(listener_key)
                    item["spreadCount"] = item.get("spreadCount", 0) + 1
                    item["distortionLevel"] = min(5, item.get("distortionLevel", 0) + 0.3)
                    spread_count += 1
    return {"spread": spread_count, "items": gossip_items}


@app.post("/causality/propagate")
def causality_propagate(payload: CausalityEventPayload) -> dict[str, Any]:
    ripple_rules = {
        "purchase": ["inventory", "shop", "social", "journal"],
        "combat_win": ["character", "inventory", "social", "journal", "life"],
        "combat_loss": ["character", "inventory", "social", "life"],
        "quest_completed": ["character", "inventory", "social", "journal", "world"],
        "location_entered": ["map", "social", "world", "journal"],
        "relationship_change": ["social", "phone", "world", "party"],
        "item_used": ["inventory", "life", "character"],
        "time_advanced": ["calendar", "life", "social", "world", "equipment"],
        "crime_committed": ["social", "world", "journal", "map"],
        "heroic_act": ["social", "world", "journal"],
        "weather_changed": ["map", "calendar", "life"],
        "equipment_changed": ["character", "inventory", "life"],
        "party_member_joined": ["party", "social", "map", "battle"],
    }
    event_type = payload.type
    domains = ripple_rules.get(event_type, [])
    ripples = [{"domain": d, "weight": round(1.0 - i * 0.1, 2)} for i, d in enumerate(domains)]
    with db_lock, db() as conn:
        add_event(conn, "causality_propagated", payload.source, payload.domain, {"type": event_type, "ripples": ripples})
    return {"ok": True, "eventType": event_type, "ripples": ripples, "rulesMatched": len(domains)}


@app.post("/reputation/calculate")
def reputation_calculate(payload: ReputationPayload) -> dict[str, Any]:
    result = calculate_reputation_math(50.0, payload.action_type, payload.magnitude)
    return {"ok": True, "faction": payload.faction, **result}


@app.post("/encumbrance/calculate")
def encumbrance_calculate(payload: EncumbrancePayload) -> dict[str, Any]:
    result = calculate_encumbrance_math(payload.items, payload.equipped, payload.strength)
    return {"ok": True, **result}


@app.post("/npc/proximity")
def npc_proximity(payload: ProximityPayload) -> dict[str, Any]:
    nearby = detect_nearby_npcs_math(payload.location, payload.characters)
    return {"ok": True, "location": payload.location, "nearbyCount": len(nearby), "nearby": nearby}


@app.post("/quest/dependencies")
def quest_dependencies(payload: QuestDependencyPayload) -> dict[str, Any]:
    result = resolve_quest_dependencies_math(payload.completed_quests, payload.pending_quests)
    return {"ok": True, **result}


@app.post("/economy/dynamic-prices")
def economy_dynamic_prices(payload: DynamicPricePayload) -> dict[str, Any]:
    result = calculate_dynamic_price_math(payload.base_price, payload.supply_level, payload.demand_level, payload.reputation_modifier)
    return {"ok": True, **result}


@app.post("/weather/activity-check")
def weather_activity_check(payload: WeatherActivityPayload) -> dict[str, Any]:
    result = check_weather_activity_math(payload.weather, payload.activity)
    return {"ok": True, "weather": payload.weather, "activity": payload.activity, **result}


@app.post("/emotion/contagion")
def emotion_contagion(payload: EmotionContagionPayload) -> dict[str, Any]:
    result = propagate_emotion_math(payload.source_npc, payload.emotion_delta, payload.radius, payload.npc_moods)
    return {"ok": True, **result}


@app.post("/consequences/queue")
def consequences_queue(payload: ConsequencePayload) -> dict[str, Any]:
    consequence = {
        "id": f"conseq_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{random.randint(100, 999)}",
        "triggerEvent": payload.trigger_event,
        "delayMinutes": payload.delay_minutes,
        "domain": payload.domain,
        "action": payload.action,
        "payload": payload.payload_data,
        "probability": py_clamp(payload.probability, 0, 1, 0.5),
        "queuedAt": now_iso(),
        "fireAt": now_iso(),
    }
    with db_lock, db() as conn:
        add_event(conn, "consequence_queued", "ConsequenceEngine", payload.domain, consequence)
    return {"ok": True, "consequence": consequence}


@app.post("/ambient/event")
def ambient_event(payload: AmbientEventPayload) -> dict[str, Any]:
    event = generate_ambient_event_math(payload.location, payload.npcs, payload.categories)
    with db_lock, db() as conn:
        add_event(conn, "ambient_event_generated", "AmbientWorld", payload.location, event)
    return {"ok": True, "event": event}


@app.post("/gossip/seed")
def gossip_seed(payload: GossipSeedPayload) -> dict[str, Any]:
    item = seed_gossip_math(payload.origin, payload.topic, payload.content, payload.importance, payload.tags)
    with db_lock, db() as conn:
        add_event(conn, "gossip_seeded", payload.origin, "", item)
    return {"ok": True, "gossip": item}


@app.post("/gossip/spread")
def gossip_spread(payload: GossipSpreadPayload) -> dict[str, Any]:
    items = [{"knownBy": list(v), "importance": 0.5, "spreadCount": 0, "distortionLevel": 0} for v in payload.npc_knowledge.values()]
    result = spread_gossip_math(items, payload.npc_knowledge, payload.relationship_strengths, payload.max_spreads)
    return {"ok": True, **result}


@app.get("/math/capabilities")
def math_capabilities() -> dict[str, Any]:
    return {
        "ok": True,
        "version": "1.0.0",
        "mathFirstEndpoints": [
            "/causality/propagate",
            "/reputation/calculate",
            "/encumbrance/calculate",
            "/npc/proximity",
            "/quest/dependencies",
            "/economy/dynamic-prices",
            "/weather/activity-check",
            "/emotion/contagion",
            "/consequences/queue",
            "/ambient/event",
            "/gossip/seed",
            "/gossip/spread",
            "/objects/render",
            "/objects/place",
        ],
        "description": "All endpoints use pure math. No AI required.",
        "capabilities": {k: v for k, v in BACKEND_CAPABILITIES.items() if v},
    }


OBJECT_TYPE_ALIASES_PY: dict[str, str] = {
    "book": "book", "journal": "book", "diary": "book", "tome": "book", "grimoire": "book",
    "manual": "book", "textbook": "book", "novel": "book", "scroll": "book",
    "minigame": "minigame", "game": "minigame", "arcade": "minigame",
    "puzzle": "puzzle", "puzzle_box": "puzzle", "combination_lock": "puzzle", "riddle": "puzzle",
    "computer": "computer", "pc": "computer", "laptop": "computer", "terminal": "computer",
    "container": "container", "chest": "container", "box": "container", "crate": "container", "barrel": "container",
    "workstation": "workstation", "crafting_table": "workstation", "forge": "workstation", "kitchen": "workstation",
    "note": "note", "letter": "note", "message": "note", "document": "note",
    "safe": "safe", "lockbox": "safe", "vault": "safe", "locked_door": "safe",
    "dice": "dice", "d20": "dice", "dice_roller": "dice",
    "music_player": "music_player", "jukebox": "music_player", "stereo": "music_player", "radio": "music_player",
    "lever": "lever", "button": "button",
    "teleporter": "teleporter", "portal": "teleporter",
    "altar": "altar", "shrine": "altar", "fountain": "altar", "well": "altar",
    "mirror": "mirror", "crystal_ball": "mirror",
    "generic": "generic",
}


def detect_object_type_py(obj: dict[str, Any]) -> str:
    explicit = str(obj.get("object_type") or obj.get("type") or obj.get("kind") or "").strip().lower()
    if explicit in OBJECT_TYPE_ALIASES_PY.values():
        return explicit
    if explicit in OBJECT_TYPE_ALIASES_PY:
        return OBJECT_TYPE_ALIASES_PY[explicit]
    name = re.sub(r"\s+", " ", str(obj.get("name") or obj.get("label") or "")).strip().lower()
    for keyword, obj_type in OBJECT_TYPE_ALIASES_PY.items():
        if keyword in name:
            return obj_type
    desc = re.sub(r"\s+", " ", str(obj.get("description") or "")).strip().lower()
    for keyword, obj_type in OBJECT_TYPE_ALIASES_PY.items():
        if keyword in desc:
            return obj_type
    if obj.get("pages") or obj.get("content") or obj.get("text"):
        return "book"
    if obj.get("recipes") or obj.get("crafting"):
        return "workstation"
    if obj.get("locked") or obj.get("combination") or obj.get("password"):
        return "safe"
    if obj.get("options") and isinstance(obj.get("options"), list) and len(obj.get("options", [])) > 0:
        return "generic"
    return "generic"


def esc_html_py(value: Any) -> str:
    return str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")


def generate_object_html_py(obj: dict[str, Any]) -> str:
    obj_type = detect_object_type_py(obj)
    obj_id = esc_html_py(obj.get("object_id") or obj.get("id") or "")
    name = esc_html_py(obj.get("name") or obj.get("label") or "Object")

    if obj_type == "book":
        pages = obj.get("pages") or []
        content = esc_html_py(obj.get("content") or obj.get("text") or "")
        page_content = esc_html_py(pages[0]) if pages else content
        return f'''<div class="uie-obj-book" data-object-id="{obj_id}">
            <div class="uie-obj-book-cover">
                <div class="uie-obj-book-title">{name}</div>
                <div class="uie-obj-book-page"><div class="uie-obj-book-text">{page_content.replace(chr(10), "<br>")}</div></div>
                <div class="uie-obj-book-controls">
                    <button class="uie-obj-btn" data-action="page-prev" disabled>◀ Prev</button>
                    <span class="uie-obj-book-page-num">Page 1 / {max(1, len(pages))}</span>
                    <button class="uie-obj-btn" data-action="page-next" {"disabled" if len(pages) <= 1 else ""}>Next ▶</button>
                </div>
            </div>
        </div>'''

    if obj_type == "minigame":
        game_type = str(obj.get("game_type") or "clicker").lower()
        return f'''<div class="uie-obj-minigame" data-object-id="{obj_id}" data-game-type="{game_type}">
            <div class="uie-obj-minigame-header">{name}</div>
            <div class="uie-obj-minigame-area">
                <div class="uie-obj-minigame-score">Score: <span class="uie-obj-score-value">0</span></div>
                <button class="uie-obj-minigame-target" data-action="click-target">CLICK!</button>
                <button class="uie-obj-btn" data-action="start-game">Start Game</button>
            </div>
        </div>'''

    if obj_type == "puzzle":
        puzzle_type = str(obj.get("puzzle_type") or "combination").lower()
        hint = esc_html_py(obj.get("hint") or "")
        if puzzle_type == "riddle":
            riddle = esc_html_py(obj.get("riddle") or obj.get("question") or "What am I?")
            return f'''<div class="uie-obj-puzzle" data-object-id="{obj_id}" data-puzzle-type="riddle">
                <div class="uie-obj-puzzle-header">{name}</div>
                <div class="uie-obj-puzzle-area">
                    <div class="uie-obj-riddle-text">{riddle}</div>
                    <input type="text" class="uie-obj-riddle-input" placeholder="Your answer...">
                    <button class="uie-obj-btn" data-action="submit-riddle">Submit Answer</button>
                </div>
            </div>'''
        digits = max(1, min(8, int(obj.get("digits") or 4)))
        digit_inputs = "".join(f'<input type="number" class="uie-obj-combo-digit" data-digit="{i}" min="0" max="9" value="0">' for i in range(digits))
        return f'''<div class="uie-obj-puzzle" data-object-id="{obj_id}" data-puzzle-type="combination">
            <div class="uie-obj-puzzle-header">{name}</div>
            <div class="uie-obj-puzzle-area">
                <div class="uie-obj-combination-display">{digit_inputs}</div>
                <button class="uie-obj-btn" data-action="submit-combination">Submit</button>
                <div class="uie-obj-puzzle-hint">{hint}</div>
            </div>
        </div>'''

    if obj_type == "computer" or obj_type == "terminal":
        return f'''<div class="uie-obj-computer" data-object-id="{obj_id}">
            <div class="uie-obj-computer-frame">
                <div class="uie-obj-computer-screen">
                    <div class="uie-obj-computer-header">{name}</div>
                    <div class="uie-obj-computer-content">
                        <div class="uie-obj-computer-icons">
                            <div class="uie-obj-computer-icon" data-action="open-files"><i>📁</i><span>Files</span></div>
                            <div class="uie-obj-computer-icon" data-action="open-mail"><i>✉️</i><span>Mail</span></div>
                            <div class="uie-obj-computer-icon" data-action="open-browser"><i>🌐</i><span>Browser</span></div>
                            <div class="uie-obj-computer-icon" data-action="open-terminal"><i>⌨️</i><span>Terminal</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>'''

    if obj_type == "note":
        content = esc_html_py(obj.get("content") or obj.get("text") or obj.get("message") or "")
        author = esc_html_py(obj.get("author") or obj.get("from") or "")
        return f'''<div class="uie-obj-note" data-object-id="{obj_id}">
            <div class="uie-obj-note-paper">
                <div class="uie-obj-note-title">{name}</div>
                <div class="uie-obj-note-content">{content.replace(chr(10), "<br>")}</div>
                {"<div class='uie-obj-note-author'>— " + author + "</div>" if author else ""}
            </div>
        </div>'''

    if obj_type == "safe":
        is_locked = obj.get("locked", True)
        if is_locked:
            return f'''<div class="uie-obj-safe" data-object-id="{obj_id}" data-locked="true">
                <div class="uie-obj-safe-body">
                    <div class="uie-obj-safe-title">{name}</div>
                    <div class="uie-obj-safe-lock">
                        <div class="uie-obj-safe-dial">🔒</div>
                        <input type="text" class="uie-obj-safe-input" placeholder="Enter combination...">
                        <button class="uie-obj-btn" data-action="unlock">Unlock</button>
                    </div>
                </div>
            </div>'''
        return f'''<div class="uie-obj-safe" data-object-id="{obj_id}" data-locked="false">
            <div class="uie-obj-safe-body">
                <div class="uie-obj-safe-title">{name}</div>
                <div class="uie-obj-safe-open">
                    <div class="uie-obj-safe-dial">🔓</div>
                    <button class="uie-obj-btn" data-action="open-safe">Open</button>
                </div>
            </div>
        </div>'''

    if obj_type == "dice":
        sides = max(2, min(100, int(obj.get("sides") or 20)))
        return f'''<div class="uie-obj-dice" data-object-id="{obj_id}" data-sides="{sides}">
            <div class="uie-obj-dice-body">
                <div class="uie-obj-dice-title">{name}</div>
                <div class="uie-obj-dice-display">
                    <div class="uie-obj-dice-face">🎲</div>
                    <div class="uie-obj-dice-result">—</div>
                </div>
                <div class="uie-obj-dice-controls">
                    <label>Sides: <input type="number" class="uie-obj-dice-sides" value="{sides}" min="2" max="100"></label>
                    <label>Count: <input type="number" class="uie-obj-dice-count" value="1" min="1" max="10"></label>
                    <button class="uie-obj-btn" data-action="roll">Roll!</button>
                </div>
            </div>
        </div>'''

    if obj_type == "lever":
        is_pulled = obj.get("pulled", False)
        return f'''<div class="uie-obj-lever" data-object-id="{obj_id}" data-pulled="{str(is_pulled).lower()}">
            <div class="uie-obj-lever-body">
                <div class="uie-obj-lever-title">{name}</div>
                <div class="uie-obj-lever-visual {"pulled" if is_pulled else ""}">
                    <div class="uie-obj-lever-handle">{"⬇" if is_pulled else "⬆"}</div>
                </div>
                <button class="uie-obj-btn" data-action="pull-lever">{"Push Up" if is_pulled else "Pull Down"}</button>
            </div>
        </div>'''

    if obj_type == "button":
        color = str(obj.get("color") or "#ff4444")
        label = esc_html_py(obj.get("label") or "PRESS")
        desc = esc_html_py(obj.get("description") or "")
        return f'''<div class="uie-obj-button" data-object-id="{obj_id}">
            <div class="uie-obj-button-body">
                <div class="uie-obj-button-title">{name}</div>
                <button class="uie-obj-big-button" data-action="press-button" style="background: {color};">
                    {label}
                </button>
                <div class="uie-obj-button-desc">{desc}</div>
            </div>
        </div>'''

    if obj_type == "teleporter":
        destinations = obj.get("destinations") or []
        dest_buttons = ""
        for i, d in enumerate(destinations):
            dest_name = esc_html_py(d.get("name") or d.get("location") or f"Destination {i + 1}")
            dest_loc = esc_html_py(d.get("location") or "")
            dest_buttons += f'<button class="uie-obj-btn" data-action="teleport" data-dest="{dest_loc}">{dest_name}</button>'
        if not dest_buttons:
            dest_buttons = '<div class="uie-obj-teleporter-empty">No destinations configured</div>'
        return f'''<div class="uie-obj-teleporter" data-object-id="{obj_id}">
            <div class="uie-obj-teleporter-body">
                <div class="uie-obj-teleporter-title">{name}</div>
                <div class="uie-obj-teleporter-visual">🌀</div>
                <div class="uie-obj-teleporter-destinations">{dest_buttons}</div>
            </div>
        </div>'''

    if obj_type == "altar" or obj_type == "fountain":
        desc = esc_html_py(obj.get("description") or "An ancient place of power. What will you offer?")
        offerings = obj.get("accepted_offerings") or []
        offer_buttons = ""
        for i, o in enumerate(offerings):
            offer_name = esc_html_py(o.get("name") or o.get("item") or f"Offering {i + 1}")
            offer_buttons += f'<button class="uie-obj-btn" data-action="offer" data-offer-idx="{i}">Offer: {offer_name}</button>'
        return f'''<div class="uie-obj-altar" data-object-id="{obj_id}">
            <div class="uie-obj-altar-body">
                <div class="uie-obj-altar-title">{name}</div>
                <div class="uie-obj-altar-visual">⛩️</div>
                <div class="uie-obj-altar-desc">{desc}</div>
                <div class="uie-obj-altar-offerings">{offer_buttons}</div>
            </div>
        </div>'''

    if obj_type == "mirror" or obj_type == "crystal_ball":
        reflection = esc_html_py(obj.get("reflection") or obj.get("message") or "You see your reflection...")
        return f'''<div class="uie-obj-mirror" data-object-id="{obj_id}">
            <div class="uie-obj-mirror-body">
                <div class="uie-obj-mirror-title">{name}</div>
                <div class="uie-obj-mirror-visual">{"🔮" if obj_type == "crystal_ball" else "🪞"}</div>
                <div class="uie-obj-mirror-reflection">{reflection}</div>
                <button class="uie-obj-btn" data-action="look-deeper">Look Deeper</button>
            </div>
        </div>'''

    options = obj.get("options") or []
    desc = esc_html_py(obj.get("description") or "")
    option_buttons = ""
    for i, o in enumerate(options):
        opt_label = esc_html_py(o.get("label") or o.get("text") or o.get("name") or f"Option {i + 1}")
        option_buttons += f'<button class="uie-obj-btn" data-action="option" data-option-idx="{i}">{opt_label}</button>'
    if not option_buttons:
        option_buttons = '<button class="uie-obj-btn" data-action="interact">Interact</button>'
    return f'''<div class="uie-obj-generic" data-object-id="{obj_id}">
        <div class="uie-obj-generic-body">
            <div class="uie-obj-generic-title">{name}</div>
            {"<div class='uie-obj-generic-desc'>" + desc + "</div>" if desc else ""}
            <div class="uie-obj-generic-options">{option_buttons}</div>
        </div>
    </div>'''


def generate_object_css_py(obj: dict[str, Any]) -> str:
    obj_type = detect_object_type_py(obj)
    base_css = '''
        .uie-obj-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid rgba(111, 211, 255, 0.35); background: rgba(111, 211, 255, 0.12); color: #bae6fd; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; }
        .uie-obj-btn:hover:not(:disabled) { background: rgba(111, 211, 255, 0.25); border-color: rgba(111, 211, 255, 0.6); box-shadow: 0 0 8px rgba(111, 211, 255, 0.3); }
        .uie-obj-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    '''
    type_css_map = {
        "book": '''
            .uie-obj-book { text-align: center; }
            .uie-obj-book-cover { background: linear-gradient(135deg, #2d1b0e 0%, #1a0f06 100%); border: 2px solid #8b4513; border-radius: 8px; padding: 16px; }
            .uie-obj-book-title { font-size: 16px; font-weight: 800; color: #ffd700; margin-bottom: 12px; }
            .uie-obj-book-page { background: #f5f0e0; border-radius: 4px; padding: 16px; min-height: 120px; color: #2d1b0e; font-family: Georgia, serif; font-size: 13px; line-height: 1.6; text-align: left; }
            .uie-obj-book-controls { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 12px; }
            .uie-obj-book-page-num { color: #cba35c; font-size: 11px; }
        ''',
        "minigame": '''
            .uie-obj-minigame { text-align: center; }
            .uie-obj-minigame-header { font-size: 16px; font-weight: 800; color: #7dd3fc; margin-bottom: 12px; }
            .uie-obj-minigame-area { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-minigame-score { font-size: 14px; color: #ffd166; margin-bottom: 8px; }
            .uie-obj-minigame-target { width: 80px; height: 80px; border-radius: 50%; background: #ef4444; border: 3px solid #fff; color: #fff; font-weight: 800; cursor: pointer; margin: 12px auto; display: block; }
        ''',
        "puzzle": '''
            .uie-obj-puzzle { text-align: center; }
            .uie-obj-puzzle-header { font-size: 16px; font-weight: 800; color: #a78bfa; margin-bottom: 12px; }
            .uie-obj-puzzle-area { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-combination-display { display: flex; justify-content: center; gap: 8px; margin-bottom: 12px; }
            .uie-obj-combo-digit { width: 36px; height: 44px; text-align: center; font-size: 20px; font-weight: 800; background: #1a1a2e; border: 2px solid #a78bfa; border-radius: 4px; color: #fff; }
            .uie-obj-riddle-text { font-style: italic; color: #e0e0e0; margin-bottom: 12px; }
            .uie-obj-riddle-input { width: 100%; padding: 8px; background: #1a1a2e; border: 1px solid #a78bfa; border-radius: 4px; color: #fff; margin-bottom: 8px; }
        ''',
        "computer": '''
            .uie-obj-computer { text-align: center; }
            .uie-obj-computer-frame { background: #333; border-radius: 8px; padding: 8px; }
            .uie-obj-computer-screen { background: #0a1628; border: 2px solid #444; border-radius: 4px; min-height: 180px; }
            .uie-obj-computer-header { background: #1a3a5c; padding: 6px 12px; font-size: 12px; color: #7dd3fc; font-weight: 700; }
            .uie-obj-computer-icons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px; }
            .uie-obj-computer-icon { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; padding: 8px; border-radius: 4px; }
            .uie-obj-computer-icon:hover { background: rgba(111, 211, 255, 0.1); }
            .uie-obj-computer-icon i { font-size: 28px; }
            .uie-obj-computer-icon span { font-size: 10px; color: #bae6fd; }
        ''',
        "note": '''
            .uie-obj-note { text-align: center; }
            .uie-obj-note-paper { background: linear-gradient(135deg, #f5f0e0 0%, #e8dcc0 100%); border-radius: 4px; padding: 20px; box-shadow: 2px 2px 8px rgba(0,0,0,0.3); }
            .uie-obj-note-title { font-size: 14px; font-weight: 800; color: #2d1b0e; margin-bottom: 12px; border-bottom: 1px solid #8b4513; padding-bottom: 6px; }
            .uie-obj-note-content { font-family: Georgia, serif; font-size: 13px; color: #2d1b0e; line-height: 1.6; text-align: left; }
            .uie-obj-note-author { font-style: italic; color: #666; margin-top: 12px; text-align: right; }
        ''',
        "safe": '''
            .uie-obj-safe { text-align: center; }
            .uie-obj-safe-body { background: linear-gradient(135deg, #333 0%, #1a1a1a 100%); border: 3px solid #555; border-radius: 8px; padding: 16px; }
            .uie-obj-safe-title { font-size: 14px; font-weight: 800; color: #ffd700; margin-bottom: 12px; }
            .uie-obj-safe-dial { font-size: 32px; margin-bottom: 8px; }
            .uie-obj-safe-input { width: 100%; padding: 8px; background: #000; border: 1px solid #ffd700; border-radius: 4px; color: #ffd700; text-align: center; font-family: monospace; margin-bottom: 8px; }
        ''',
        "dice": '''
            .uie-obj-dice { text-align: center; }
            .uie-obj-dice-body { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-dice-title { font-size: 14px; font-weight: 800; color: #ffd166; margin-bottom: 12px; }
            .uie-obj-dice-face { font-size: 48px; }
            .uie-obj-dice-result { font-size: 24px; font-weight: 800; color: #fff; margin-top: 8px; }
            .uie-obj-dice-controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; align-items: center; margin-top: 12px; }
            .uie-obj-dice-controls label { font-size: 11px; color: #bae6fd; }
            .uie-obj-dice-controls input { width: 50px; padding: 4px; background: #1a1a2e; border: 1px solid #ffd166; border-radius: 4px; color: #fff; text-align: center; }
        ''',
        "lever": '''
            .uie-obj-lever { text-align: center; }
            .uie-obj-lever-body { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-lever-title { font-size: 14px; font-weight: 800; color: #f97316; margin-bottom: 12px; }
            .uie-obj-lever-visual { font-size: 48px; margin: 12px 0; transition: transform 0.3s; }
            .uie-obj-lever-visual.pulled { transform: rotate(180deg); }
        ''',
        "button": '''
            .uie-obj-button { text-align: center; }
            .uie-obj-button-body { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-button-title { font-size: 14px; font-weight: 800; color: #ef4444; margin-bottom: 12px; }
            .uie-obj-big-button { padding: 16px 32px; font-size: 16px; font-weight: 800; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
        ''',
        "teleporter": '''
            .uie-obj-teleporter { text-align: center; }
            .uie-obj-teleporter-body { background: linear-gradient(135deg, #1a0033 0%, #0a001a 100%); border-radius: 8px; padding: 16px; }
            .uie-obj-teleporter-title { font-size: 14px; font-weight: 800; color: #c084fc; margin-bottom: 12px; }
            .uie-obj-teleporter-visual { font-size: 48px; animation: uie-spin 4s linear infinite; }
            @keyframes uie-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .uie-obj-teleporter-destinations { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
        ''',
        "altar": '''
            .uie-obj-altar { text-align: center; }
            .uie-obj-altar-body { background: linear-gradient(135deg, #2d1b0e 0%, #1a0f06 100%); border: 2px solid #8b4513; border-radius: 8px; padding: 16px; }
            .uie-obj-altar-title { font-size: 14px; font-weight: 800; color: #ffd700; margin-bottom: 12px; }
            .uie-obj-altar-visual { font-size: 48px; margin: 12px 0; }
            .uie-obj-altar-desc { font-size: 12px; color: #cba35c; margin-bottom: 12px; }
            .uie-obj-altar-offerings { display: flex; flex-direction: column; gap: 6px; }
        ''',
        "mirror": '''
            .uie-obj-mirror { text-align: center; }
            .uie-obj-mirror-body { background: linear-gradient(135deg, #e0e0e0 0%, #a0a0a0 100%); border: 4px solid #8b4513; border-radius: 50% 50% 45% 45%; padding: 24px; }
            .uie-obj-mirror-title { font-size: 14px; font-weight: 800; color: #333; margin-bottom: 12px; }
            .uie-obj-mirror-visual { font-size: 48px; }
            .uie-obj-mirror-reflection { font-style: italic; color: #555; margin: 12px 0; font-size: 12px; }
        ''',
    }
    return base_css + type_css_map.get(obj_type, "")


@app.post("/objects/render")
def objects_render(payload: ObjectRenderPayload) -> dict[str, Any]:
    obj = {
        "object_id": payload.object_id,
        "name": payload.name,
        "object_type": payload.object_type,
        "description": payload.description,
        "content": payload.content,
        "options": payload.options,
        "pages": payload.pages,
        "tracks": payload.tracks,
        "destinations": payload.destinations,
        "recipes": payload.recipes,
        "combination": payload.combination,
        "locked": payload.locked,
        "hint": payload.hint,
        "puzzle_type": payload.puzzle_type,
        "game_type": payload.game_type,
        "sides": payload.sides,
        "color": payload.color,
        "label": payload.label,
        "author": payload.author,
        "reflection": payload.reflection,
        "riddle": payload.riddle,
        "accepted_offerings": payload.accepted_offerings,
    }
    obj.update(payload.extra)
    obj_type = detect_object_type_py(obj)
    html = generate_object_html_py(obj)
    css = generate_object_css_py(obj)
    return {
        "ok": True,
        "objectType": obj_type,
        "html": html,
        "css": css,
        "source": "fastapi_math_first",
    }


@app.post("/objects/place")
def objects_place(payload: ObjectPlacePayload) -> dict[str, Any]:
    obj = payload.object_data or {}
    obj_type = detect_object_type_py(obj)
    html = generate_object_html_py(obj)
    css = generate_object_css_py(obj)
    obj_id = str(obj.get("object_id") or obj.get("id") or f"obj_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{random.randint(100, 999)}")
    placement = {
        "id": obj_id,
        "location": payload.location or "Unknown",
        "slotId": obj.get("slotId") or f"auto_{obj_type}",
        "slotType": obj.get("slotType") or "utility",
        "assetId": obj.get("assetId") or obj_type,
        "objectType": obj_type,
        "objectData": obj,
        "customHtml": html,
        "coordinates": {"x": py_clamp(payload.x, 0, 1, 0.5), "y": py_clamp(payload.y, 0, 1, 0.5)},
        "overrides": {"css": css, "addition": "", "user_custom_css": ""},
        "autoRendered": True,
        "createdAt": now_iso(),
    }
    with db_lock, db() as conn:
        add_event(conn, "object_placed", "ObjectRenderer", payload.location, {"placement": placement})
    return {"ok": True, "placement": placement, "source": "fastapi_math_first"}


@app.get("/objects/types")
def objects_types() -> dict[str, Any]:
    return {
        "ok": True,
        "types": list(set(OBJECT_TYPE_ALIASES_PY.values())),
        "aliases": OBJECT_TYPE_ALIASES_PY,
    }


# ============================================================================
# Visual Generation Service Integration
# ============================================================================

from .visual_service import (
    VisualGenerationRequest,
    VisualStatusResponse,
    request_visual_generation,
    get_visual_metadata,
    generate_visual_key,
    build_visual_prompt,
    start_visual_worker,
    VISUAL_SETTINGS,
    ENTITY_TYPES,
    STYLE_PRESETS,
    AVAILABLE_STYLE_PRESETS,
    DEFAULT_STYLE_PRESET,
    trigger_npc_portrait,
    trigger_location_background,
    trigger_skill_art,
    trigger_item_template_image,
    trigger_equipment_template_image,
    trigger_quest_visual,
    trigger_faction_visual,
    trigger_instavibe_profile_pic,
    trigger_instavibe_post_image,
    trigger_message_image,
    trigger_character_selfie,
)

# Start visual worker on startup
@app.on_event("startup")
async def startup_visual_worker():
    start_visual_worker()
    if VISUAL_SETTINGS.get("auto_download_koji") and VISUAL_SETTINGS.get("enable_koji"):
        try:
            from .visuals.download_koji import check_koji_available, download_koji_async
            if not check_koji_available():
                download_koji_async()
        except Exception:
            pass


class VisualGeneratePayload(BaseModel):
    entity_type: str
    entity_id: str
    visual_key: str = ""
    visual_type: str = ""
    provider: str = "auto"
    style_preset: str = ""
    prompt_override: str = ""
    force: bool = False
    entity_data: dict[str, Any] = Field(default_factory=dict)
    width: int | None = None
    height: int | None = None
    priority: int = 5


class MessageImagePayload(BaseModel):
    message_id: str
    attachment_id: str = "0"
    sender_id: str = ""
    subject: str = ""
    context: str = ""
    message_type: str = "photo"
    group: bool = False
    provider: str = "auto"
    style_preset: str = ""
    prompt_override: str = ""
    entity_data: dict[str, Any] = Field(default_factory=dict)


class VisualUploadPayload(BaseModel):
    visual_key: str
    image_data: str  # base64 or data URL
    entity_type: str = ""
    entity_id: str = ""


@app.post("/visuals/generate")
def visuals_generate(payload: VisualGeneratePayload) -> dict[str, Any]:
    try:
        result = request_visual_generation(
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            entity_data=payload.entity_data,
            provider=payload.provider,
            prompt_override=payload.prompt_override,
            force=payload.force,
            priority=payload.priority,
            style_preset=payload.style_preset,
            visual_type=payload.visual_type,
        )
        return {"ok": True, "visual": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/visuals/regenerate")
def visuals_regenerate(payload: VisualGeneratePayload) -> dict[str, Any]:
    try:
        result = request_visual_generation(
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            entity_data=payload.entity_data,
            provider=payload.provider,
            prompt_override=payload.prompt_override,
            force=True,
            priority=payload.priority,
            style_preset=payload.style_preset,
            visual_type=payload.visual_type,
        )
        return {"ok": True, "visual": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/visuals/status/{visual_key}")
def visuals_status(visual_key: str) -> dict[str, Any]:
    """Get visual generation status"""
    metadata = get_visual_metadata(visual_key)
    if not metadata:
        return {"ok": False, "error": "Visual not found"}
    return {"ok": True, "visual": metadata}


@app.post("/visuals/upload")
def visuals_upload(payload: VisualUploadPayload) -> dict[str, Any]:
    try:
        import base64
        from pathlib import Path
        
        visual_key = payload.visual_key
        
        image_data = payload.image_data
        if image_data.startswith("data:"):
            match = re.match(r"^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$", image_data, re.I | re.S)
            if not match:
                raise HTTPException(status_code=400, detail="Invalid data URL format")
            content_type = match.group(1) or "image/png"
            image_bytes = base64.b64decode(match.group(2))
        else:
            image_bytes = base64.b64decode(image_data)
            content_type = "image/png"
        
        GENERATED_ASSET_DIR.mkdir(parents=True, exist_ok=True)
        ext = content_extension(content_type)
        file_path = GENERATED_ASSET_DIR / f"{visual_key}_custom{ext}"
        file_path.write_bytes(image_bytes)
        
        url = f"/assets/image/file/{urlparse.quote(f'{visual_key}_custom')}"
        
        existing_payload = {}
        with db_lock, db() as conn:
            row = conn.execute("select payload from image_assets where id=?", (visual_key,)).fetchone()
            if row:
                existing_payload = decode(row["payload"], {})
        
        existing_payload["image_is_user_uploaded"] = True
        existing_payload["image_is_protected"] = True
        
        update_image_asset_status(
            visual_key,
            status="ready",
            provider="user_upload",
            url=url,
            file_path=str(file_path),
            content_type=content_type,
            error="",
        )
        
        with db_lock, db() as conn:
            row = conn.execute("select payload from image_assets where id=?", (visual_key,)).fetchone()
            if row:
                merged = decode(row["payload"], {})
                merged.update(existing_payload)
                conn.execute(
                    "update image_assets set payload=? where id=?",
                    (encode(merged), visual_key)
                )
        
        metadata = get_visual_metadata(visual_key)
        return {"ok": True, "visual": metadata}
    
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/visuals/replace")
def visuals_replace(payload: VisualUploadPayload) -> dict[str, Any]:
    """Replace visual with custom image (alias for upload)"""
    return visuals_upload(payload)


@app.get("/visuals/settings")
def visuals_settings() -> dict[str, Any]:
    model_status = {}
    try:
        from .visuals.download_koji import get_model_status
        model_status = get_model_status()
    except Exception:
        pass
    return {
        "ok": True,
        "settings": VISUAL_SETTINGS,
        "style_presets": STYLE_PRESETS,
        "available_style_presets": AVAILABLE_STYLE_PRESETS,
        "default_style_preset": DEFAULT_STYLE_PRESET,
        "model_status": model_status,
        "quality_modes": ["fast", "balanced", "quality"],
        "backend_modes": ["built_in_backend", "custom_model"],
    }


@app.post("/visuals/settings")
def visuals_update_settings(settings: dict[str, Any]) -> dict[str, Any]:
    try:
        for key, value in settings.items():
            if key in VISUAL_SETTINGS:
                VISUAL_SETTINGS[key] = value
        return {
            "ok": True,
            "settings": VISUAL_SETTINGS,
            "style_presets": STYLE_PRESETS,
            "available_style_presets": AVAILABLE_STYLE_PRESETS,
            "default_style_preset": DEFAULT_STYLE_PRESET,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/visuals/entity_types")
def visuals_entity_types() -> dict[str, Any]:
    return {"ok": True, "entity_types": ENTITY_TYPES}


@app.get("/visuals/style_presets")
def visuals_style_presets() -> dict[str, Any]:
    return {
        "ok": True,
        "style_presets": STYLE_PRESETS,
        "available_style_presets": AVAILABLE_STYLE_PRESETS,
        "default_style_preset": DEFAULT_STYLE_PRESET,
    }


@app.post("/visuals/message_image")
def visuals_message_image(payload: MessageImagePayload) -> dict[str, Any]:
    try:
        attachment_data = {
            **payload.entity_data,
            "message_id": payload.message_id,
            "attachment_id": payload.attachment_id,
            "sender_id": payload.sender_id,
            "subject": payload.subject,
            "context": payload.context,
            "message_type": payload.message_type,
            "group": payload.group,
        }
        result = request_visual_generation(
            entity_type="group_message_image_attachment" if payload.group else "message_image_attachment",
            entity_id=payload.message_id,
            entity_data=attachment_data,
            provider=payload.provider,
            prompt_override=payload.prompt_override,
            force=False,
            priority=1,
            style_preset=payload.style_preset,
        )
        return {"ok": True, "visual": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/visuals/models/status")
def visuals_models_status() -> dict[str, Any]:
    try:
        from .visuals.download_koji import get_model_status
        from .visuals.model_manager import get_model_manager
        status = get_model_status()
        try:
            mgr = get_model_manager()
            status["quality_mode"] = mgr.quality_mode
            status["available_quality_modes"] = ["fast", "balanced", "quality"]
        except Exception:
            status["quality_mode"] = VISUAL_SETTINGS.get("visual_quality_mode", "balanced")
            status["available_quality_modes"] = ["fast", "balanced", "quality"]
        status["visual_backend_mode"] = VISUAL_SETTINGS.get("visual_backend_mode", "built_in_backend")
        status["custom_model_enabled"] = VISUAL_SETTINGS.get("custom_model_enabled", False)
        return {"ok": True, **status}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


class KojiDownloadRequest(BaseModel):
    force: bool = False


@app.post("/visuals/models/koji/download")
def visuals_download_koji(payload: KojiDownloadRequest = None) -> dict[str, Any]:
    try:
        from .visuals.download_koji import download_koji
        payload = payload or KojiDownloadRequest()
        result = download_koji()
        return {"ok": result.get("ok", False), **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/visuals/models/koji/download-async")
def visuals_download_koji_async() -> dict[str, Any]:
    try:
        from .visuals.download_koji import download_koji_async, get_download_state
        download_koji_async()
        return {"ok": True, "status": "download_started", "state": get_download_state()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/models/koji/download-state")
def visuals_koji_download_state() -> dict[str, Any]:
    try:
        from .visuals.download_koji import get_download_state
        return {"ok": True, "state": get_download_state()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/visuals/models/koji/delete")
def visuals_delete_koji() -> dict[str, Any]:
    try:
        from .visuals.download_koji import delete_koji
        result = delete_koji()
        return {"ok": result.get("ok", False), **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


class UpscalerDownloadRequest(BaseModel):
    force: bool = False


@app.post("/visuals/models/upscaler/download")
def visuals_download_upscaler(payload: UpscalerDownloadRequest = None) -> dict[str, Any]:
    try:
        from .visuals.download_upscaler import download_upscaler
        payload = payload or UpscalerDownloadRequest()
        result = download_upscaler()
        return {"ok": result.get("ok", False), **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/visuals/models/upscaler/download-async")
def visuals_download_upscaler_async() -> dict[str, Any]:
    try:
        from .visuals.download_upscaler import download_upscaler_async, get_download_state
        download_upscaler_async()
        return {"ok": True, "status": "download_started", "state": get_download_state()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/models/upscaler/download-state")
def visuals_upscaler_download_state() -> dict[str, Any]:
    try:
        from .visuals.download_upscaler import get_download_state
        return {"ok": True, "state": get_download_state()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/models/upscaler/status")
def visuals_upscaler_status() -> dict[str, Any]:
    try:
        from .visuals.download_upscaler import get_upscaler_status
        return {"ok": True, **get_upscaler_status()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/visuals/models/upscaler/delete")
def visuals_delete_upscaler() -> dict[str, Any]:
    try:
        from .visuals.download_upscaler import delete_upscaler
        result = delete_upscaler()
        return {"ok": result.get("ok", False), **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/visuals/models/upscaler/repair")
def visuals_repair_upscaler() -> dict[str, Any]:
    try:
        from .visuals.download_upscaler import repair_upscaler
        result = repair_upscaler()
        return {"ok": result.get("ok", False), **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/models/upscaler/capabilities")
def visuals_upscaler_capabilities() -> dict[str, Any]:
    try:
        from .visuals.upscaler import get_upscaler_for_mode, UPSCALER_MODES
        mode = VISUAL_SETTINGS.get("upscaling_mode", "off")
        upscaler = get_upscaler_for_mode(mode)
        if upscaler is None:
            return {"ok": True, "capabilities": None, "mode": mode}
        caps = upscaler.capabilities()
        return {"ok": True, "capabilities": caps, "mode": mode}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/models/upscaler/list")
def visuals_list_upscalers() -> dict[str, Any]:
    try:
        from .visuals.upscaler import list_upscalers, UPSCALER_LABELS
        upscalers = list_upscalers()
        for u in upscalers:
            u["label"] = UPSCALER_LABELS.get(u["key"], u["key"])
        return {"ok": True, "upscalers": upscalers}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/prompt-templates")
def visuals_prompt_templates() -> dict[str, Any]:
    from .visual_service import DEFAULT_PROMPT_TEMPLATES, VISUAL_SETTINGS
    custom = VISUAL_SETTINGS.get("visual_prompt_templates", {})
    return {
        "ok": True,
        "default_templates": DEFAULT_PROMPT_TEMPLATES,
        "custom_templates": custom,
        "available_variables": [
            "style_preset", "name", "entity_type", "role", "age", "gender",
            "hair", "expression", "clothing", "location", "mood", "lighting",
            "item_name", "material", "color", "element", "skill_type",
            "visual_effect", "quest_theme", "faction_type", "symbol",
            "caption", "message_context", "world_style", "description",
            "subject", "context",
        ],
    }


@app.post("/visuals/prompt-templates")
def visuals_update_prompt_templates(payload: dict[str, Any]) -> dict[str, Any]:
    from .visual_service import VISUAL_SETTINGS
    try:
        templates = payload.get("templates", {})
        if isinstance(templates, dict):
            VISUAL_SETTINGS["visual_prompt_templates"] = templates
        negatives = payload.get("negative_prompts", {})
        if isinstance(negatives, dict):
            VISUAL_SETTINGS["visual_negative_prompts"] = negatives
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/visuals/test-custom-model")
def visuals_test_custom_model(payload: dict[str, Any] = None) -> dict[str, Any]:
    try:
        from .visual_service import custom_model_generate
        test_prompt = "test image, simple composition, no text, no watermark"
        data, content_type, provider = custom_model_generate(
            prompt=test_prompt,
            negative_prompt="no text, no watermark",
            width=256,
            height=256,
        )
        return {
            "ok": True,
            "provider": provider,
            "content_type": content_type,
            "size_bytes": len(data),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/visuals/test-prompt")
def visuals_test_prompt(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        from .visual_service import build_prompt_from_template, get_prompt_template, enrich_prompt_for_model, get_negative_prompt
        entity_type = payload.get("entity_type", "npc")
        entity_data = payload.get("entity_data", {})
        style_preset = payload.get("style_preset", "")
        model = payload.get("model", "koji")
        template = get_prompt_template(entity_type)
        rendered = build_prompt_from_template(entity_type, entity_data, style_preset)
        enriched = enrich_prompt_for_model(rendered, model, entity_type, entity_data)
        negative = get_negative_prompt(entity_type, model)
        return {
            "ok": True,
            "template": template,
            "rendered_prompt": rendered,
            "enriched_prompt": enriched,
            "negative_prompt": negative,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/visuals/generation-tiers")
def visuals_generation_tiers() -> dict[str, Any]:
    from .visual_service import MANUAL_ONLY_TYPES, USER_API_AUTO_TYPES
    return {
        "ok": True,
        "manual_only_types": sorted(list(MANUAL_ONLY_TYPES)),
        "user_api_auto_types": sorted(list(USER_API_AUTO_TYPES)),
    }


@app.post("/visuals/settings/user-api")
def visuals_settings_user_api(payload: dict[str, Any]) -> dict[str, Any]:
    from .visual_service import VISUAL_SETTINGS
    try:
        provider = payload.get("provider", "")
        url = payload.get("url", "")
        key = payload.get("key", "")
        model = payload.get("model", "")
        connected = payload.get("connected", False)
        
        VISUAL_SETTINGS["user_api_provider"] = provider
        VISUAL_SETTINGS["user_api_url"] = url
        VISUAL_SETTINGS["user_api_key"] = key
        VISUAL_SETTINGS["user_api_model"] = model
        VISUAL_SETTINGS["user_api_connected"] = connected
        VISUAL_SETTINGS["hybrid_mode"] = bool(payload.get("hybridMode", False))
        VISUAL_SETTINGS["hybrid_koji_categories"] = payload.get("hybridKojiCategories") if isinstance(payload.get("hybridKojiCategories"), dict) else {}
        VISUAL_SETTINGS["auto_generate_categories"] = payload.get("autoGenerateCategories") if isinstance(payload.get("autoGenerateCategories"), dict) else {}
        
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class WorldToolsProcessPayload(BaseModel):
    text: str = ""
    character: dict[str, Any] = Field(default_factory=dict)
    characters: dict[str, dict[str, Any]] = Field(default_factory=dict)
    locations: dict[str, dict[str, Any]] = Field(default_factory=dict)
    world_state: dict[str, Any] = Field(default_factory=dict)
    active_secrets: list[dict[str, Any]] = Field(default_factory=list)
    player_name: str = "User"
    active_npcs: list[str] = Field(default_factory=list)


class WorldToolsEntityPayload(BaseModel):
    entity_type: str = "npc"
    data: dict[str, Any] = Field(default_factory=dict)
    existing_entities: list[dict[str, Any]] = Field(default_factory=list)


class WorldToolsContextPayload(BaseModel):
    character: dict[str, Any] = Field(default_factory=dict)
    location: str = ""
    present_npcs: list[dict[str, Any]] = Field(default_factory=list)
    active_secrets: list[dict[str, Any]] = Field(default_factory=list)
    recent_events: list[dict[str, Any]] = Field(default_factory=list)
    current_conflict: dict[str, Any] | None = None
    world_state: dict[str, Any] = Field(default_factory=dict)
    user_character: dict[str, Any] | None = None


class WorldToolsEventPayload(BaseModel):
    event: dict[str, Any] = Field(default_factory=dict)
    all_npcs: list[dict[str, Any]] = Field(default_factory=list)
    location: str = ""


class WorldToolsSearchPayload(BaseModel):
    query: str = ""
    entity_type: str = ""
    limit: int = 20


class WorldToolsResourcePayload(BaseModel):
    ram_available_mb: float = 0
    ram_total_mb: float = 0
    cpu_percent: float = 0
    battery_percent: float = 100
    temperature_c: float = 0
    storage_free_gb: float = 0


BACKEND_CAPABILITIES.update({
    "worldTools": True,
    "entityNormalizer": True,
    "contextPacker": True,
    "memoryCompressor": True,
    "secretRouter": True,
    "continuityChecker": True,
    "eventExtractor": True,
    "rumorEngine": True,
    "promptCompiler": True,
    "outputValidator": True,
    "importanceScorer": True,
    "searchIndexer": True,
    "cacheManager": True,
    "resourceGovernor": True,
    "storageOptimizer": True,
    "notificationPrioritizer": True,
    "fallbackManager": True,
    "worldPipeline": True,
})


@app.post("/world-tools/process-output")
def world_tools_process_output(payload: WorldToolsProcessPayload) -> dict[str, Any]:
    from .world_tools import get_world_pipeline
    pipeline = get_world_pipeline()
    result = pipeline.process_llm_output(
        payload.text,
        character=payload.character,
        characters=payload.characters,
        locations=payload.locations,
        world_state=payload.world_state,
        active_secrets=payload.active_secrets,
        player_name=payload.player_name,
        active_npcs=payload.active_npcs,
    )
    return {"ok": True, **result.to_dict()}


@app.post("/world-tools/process-entity")
def world_tools_process_entity(payload: WorldToolsEntityPayload) -> dict[str, Any]:
    from .world_tools import get_world_pipeline
    pipeline = get_world_pipeline()
    result = pipeline.process_entity(
        payload.entity_type,
        payload.data,
        existing_entities=payload.existing_entities,
    )
    return {"ok": True, **result.to_dict()}


@app.post("/world-tools/build-context")
def world_tools_build_context(payload: WorldToolsContextPayload) -> dict[str, Any]:
    from .world_tools import get_world_pipeline
    pipeline = get_world_pipeline()
    result = pipeline.build_context(
        payload.character,
        location=payload.location,
        present_npcs=payload.present_npcs,
        active_secrets=payload.active_secrets,
        recent_events=payload.recent_events,
        current_conflict=payload.current_conflict,
        world_state=payload.world_state,
        user_character=payload.user_character,
    )
    return {"ok": True, **result.to_dict()}


@app.post("/world-tools/process-event")
def world_tools_process_event(payload: WorldToolsEventPayload) -> dict[str, Any]:
    from .world_tools import get_world_pipeline
    pipeline = get_world_pipeline()
    result = pipeline.process_event(
        payload.event,
        all_npcs=payload.all_npcs,
        location=payload.location,
    )
    return {"ok": True, **result.to_dict()}


@app.post("/world-tools/search")
def world_tools_search(payload: WorldToolsSearchPayload) -> dict[str, Any]:
    from .world_tools import get_search_indexer
    indexer = get_search_indexer(DB_PATH.parent / "uie_search.sqlite3")
    indexer.initialize()
    results = indexer.search_natural(payload.query, limit=payload.limit) if not payload.entity_type else indexer.search(payload.query, entity_type=payload.entity_type, limit=payload.limit)
    return {"ok": True, "results": results, "stats": indexer.stats()}


@app.post("/world-tools/resource-report")
def world_tools_resource_report(payload: WorldToolsResourcePayload) -> dict[str, Any]:
    from .world_tools import get_resource_governor
    governor = get_resource_governor()
    snapshot = governor.report(payload.model_dump())
    advice = governor.get_adaptation_advice()
    return {"ok": True, "snapshot": snapshot.to_dict(), "advice": advice}


@app.get("/world-tools/cache-stats")
def world_tools_cache_stats() -> dict[str, Any]:
    from .world_tools import get_cache_manager
    cache = get_cache_manager()
    return {"ok": True, **cache.stats()}


@app.post("/world-tools/cache/clear")
def world_tools_cache_clear(payload: dict[str, Any]) -> dict[str, Any]:
    from .world_tools import get_cache_manager
    cache = get_cache_manager()
    category = str(payload.get("category") or "")
    removed = cache.clear(category=category)
    return {"ok": True, "removed": removed}


@app.get("/world-tools/storage/scan")
def world_tools_storage_scan() -> dict[str, Any]:
    from .world_tools import get_storage_optimizer
    optimizer = get_storage_optimizer(ROOT)
    report = optimizer.scan_storage()
    return {"ok": True, **report}


@app.post("/world-tools/storage/cleanup")
def world_tools_storage_cleanup() -> dict[str, Any]:
    from .world_tools import get_storage_optimizer
    optimizer = get_storage_optimizer(ROOT)
    temp_result = optimizer.cleanup_temp_files()
    dup_result = optimizer.remove_duplicates()
    return {"ok": True, "temp_cleanup": temp_result, "duplicates": dup_result}


@app.get("/world-tools/capabilities")
def world_tools_capabilities() -> dict[str, Any]:
    return {
        "ok": True,
        "version": "1.0.0",
        "tools": [
            "entity_normalizer",
            "entity_deduplicator",
            "context_packer",
            "memory_compressor",
            "secret_router",
            "continuity_checker",
            "event_extractor",
            "rumor_engine",
            "prompt_compiler",
            "output_validator",
            "importance_scorer",
            "search_indexer",
            "cache_manager",
            "resource_governor",
            "storage_optimizer",
            "notification_prioritizer",
            "fallback_manager",
            "world_pipeline",
        ],
        "endpoints": [
            "/world-tools/process-output",
            "/world-tools/process-entity",
            "/world-tools/build-context",
            "/world-tools/process-event",
            "/world-tools/search",
            "/world-tools/resource-report",
            "/world-tools/cache-stats",
            "/world-tools/cache/clear",
            "/world-tools/storage/scan",
            "/world-tools/storage/cleanup",
            "/world-tools/capabilities",
        ],
        "description": "Deterministic background tools for entity normalization, context packing, memory compression, secret routing, continuity checking, event extraction, rumor propagation, prompt compilation, output validation, importance scoring, search indexing, caching, resource governance, storage optimization, notification prioritization, and fallback management.",
        "capabilities": {k: v for k, v in BACKEND_CAPABILITIES.items() if v and k not in {"assetImages", "mapLayout", "mapIntercept", "worldTick", "websocketStream", "npcProfiles", "relationships", "messages", "phone", "instavibe", "schoolLogic", "organizationAssets", "pocketTts"}},
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("python.uie_backend:app", host="localhost", port=28101, reload=False)
