from __future__ import annotations

import json
import random
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Path settings relative to this file
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SOCIAL_FEED_PATH = DATA_DIR / "uie_instavibe_feed.json"
INSTAVIBE_STATE_PATH = DATA_DIR / "uie_instavibe_state.json"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def decode(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback

def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

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
        "tactics_seen": decode(row["tactics_seen"], {}),
        "updated_at": row["updated_at"],
    }

def save_character(conn: sqlite3.Connection, char: dict[str, Any]) -> None:
    conn.execute(
        """
        update characters set
            role=?, location=?, profile=?, needs=?, desires=?, stats=?,
            schedule=?, relationships=?, memories=?, tactics_seen=?, updated_at=?
        where name=?
        """,
        (
            char["role"],
            char["location"],
            encode(char["profile"]),
            encode(char["needs"]),
            encode(char["desires"]),
            encode(char["stats"]),
            encode(char["schedule"]),
            encode(char["relationships"]),
            encode(char["memories"]),
            encode(char["tactics_seen"]),
            now_iso(),
            char["name"],
        ),
    )

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

def add_event(conn: sqlite3.Connection, event_type: str, actor: str, location: str, payload: dict[str, Any]) -> dict[str, Any]:
    ts = now_iso()
    conn.execute(
        "insert into events (ts,type,actor,location,payload) values (?,?,?,?,?)",
        (ts, event_type, actor, location, encode(payload)),
    )
    event_id = conn.execute("select last_insert_rowid()").fetchone()[0]
    return {"id": event_id, "ts": ts, "type": event_type, "actor": actor, "location": location, "payload": payload}

def add_instavibe_post(post: dict[str, Any]) -> None:
    try:
        posts = []
        if SOCIAL_FEED_PATH.exists():
            try:
                posts = json.loads(SOCIAL_FEED_PATH.read_text(encoding="utf-8"))
            except Exception:
                posts = []
        posts.insert(0, post)
        posts = posts[:120]  # Cap feed size
        SOCIAL_FEED_PATH.parent.mkdir(parents=True, exist_ok=True)
        SOCIAL_FEED_PATH.write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

def simulate_world_events(conn: sqlite3.Connection, minutes: int) -> list[dict[str, Any]]:
    """Runs a smart evaluation of the living world to trigger high-impact events."""
    generated_events: list[dict[str, Any]] = []
    
    # 1. Random cooldown check (limit to ~1 major event per 4-6 hours of simulated time)
    # 5% chance per 60 mins simulated, scaled by minutes
    prob = 0.05 * (minutes / 60.0)
    if random.random() > prob:
        # Check for epidemic contagion spreads even if no new major event starts
        spread_diseases(conn)
        return []

    # Get all active characters
    rows = conn.execute("select * from characters where role != 'Deceased'").fetchall()
    if not rows:
        return []
    
    characters = [character_from_row(row) for row in rows]
    places_rows = conn.execute("select * from places").fetchall()
    places = [dict(row) for row in places_rows]
    
    # Choose a smart event category to trigger
    event_types = [
        "mortality", "bankruptcy", "takeover", "epidemic", 
        "scandal", "breakthrough", "disaster", "arrest", "startup"
    ]
    chosen_type = random.choice(event_types)
    
    # Simulate the chosen event
    if chosen_type == "mortality":
        event = trigger_npc_death(conn, characters)
    elif chosen_type == "bankruptcy":
        event = trigger_business_failure(conn, characters, places)
    elif chosen_type == "takeover":
        event = trigger_faction_takeover(conn, characters, places)
    elif chosen_type == "epidemic":
        event = trigger_plague_outbreak(conn, characters)
    elif chosen_type == "scandal":
        event = trigger_gossip_scandal(conn, characters)
    elif chosen_type == "breakthrough":
        event = trigger_magic_breakthrough(conn, characters)
    elif chosen_type == "disaster":
        event = trigger_natural_disaster(conn, places)
    elif chosen_type == "arrest":
        event = trigger_crime_arrest(conn, characters)
    else:  # startup
        event = trigger_business_startup(conn, characters, places)
        
    if event:
        generated_events.append(event)
        
    # Always check disease spread
    spread_diseases(conn)
    
    return generated_events

def trigger_npc_death(conn: sqlite3.Connection, characters: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Simulates an NPC dying based on age, sickness, or dangerous associations."""
    # Find candidates (avoid player-adjacent names like "User" or main party if possible)
    candidates = [c for c in characters if c["role"] != "Player" and c["name"] not in {"User"}]
    if not candidates:
        return None
        
    # Smart scoring
    # Elders, sick NPCs, and those with high suspicion/tension have a higher chance of death
    scored_candidates = []
    for npc in candidates:
        score = 1.0
        stats = npc.get("stats", {})
        needs = npc.get("needs", {})
        profile = npc.get("profile", {})
        
        # Elder check
        if str(profile.get("age_group")).lower() == "elderly" or int(profile.get("age", 25)) > 70:
            score += 4.0
        # Disease/Sickness check
        if stats.get("infected") or stats.get("sick") or stats.get("health", 100) < 30:
            score += 5.0
        # High anxiety or high danger exposure
        if float(stats.get("anxiety", 0)) > 75:
            score += 2.0
        # High suspicion or active conflict
        if float(stats.get("suspicion", 0)) > 80:
            score += 3.0
            
        scored_candidates.append((score, npc))
        
    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    
    # Pick from top candidates using weighted choice
    total_score = sum(x[0] for x in scored_candidates)
    r = random.uniform(0, total_score)
    current = 0.0
    selected_npc = scored_candidates[-1][1]
    for score, npc in scored_candidates:
        current += score
        if current >= r:
            selected_npc = npc
            break
            
    # Mutate selected NPC to Deceased status
    name = selected_npc["name"]
    selected_npc["role"] = "Deceased"
    selected_npc["location"] = "Graveyard"
    selected_npc["profile"]["deceased_at"] = now_iso()
    selected_npc["schedule"] = [] # Clear schedules
    save_character(conn, selected_npc)
    
    cause = random.choice([
        "a severe sudden illness", 
        "a mysterious alchemical explosion in the laboratory", 
        "injuries sustained in a skirmish with highwaymen", 
        "natural causes in their sleep",
        "a fatal poisoning mystery that guards are currently investigating"
    ])
    
    # Notify family and friends - they become grieving
    grief_text = f"We are devastated to hear about the passing of {name}."
    for other in characters:
        if other["name"] == name:
            continue
        rels = other.get("relationships", {})
        if name in rels:
            # High affinity or family gets grieving memories
            affinity = float(rels[name].get("affinity", 50))
            is_family = rels[name].get("category") == "family" or rels[name].get("label") in ["Mother", "Father", "Sibling", "Son", "Daughter"]
            if affinity >= 60 or is_family:
                other.setdefault("memories", []).insert(0, {
                    "ts": now_iso(),
                    "type": "grief",
                    "text": f"Grieving the loss of my close friend/family member {name}. They died from {cause}.",
                    "importance": 0.95
                })
                # Affect needs
                other["needs"]["energy"] = max(0.1, float(other["needs"].get("energy", 0.8)) - 0.3)
                other["needs"]["social"] = max(0.1, float(other["needs"].get("social", 0.5)) - 0.3)
                other.setdefault("stats", {})["anxiety"] = min(100.0, float(other["stats"].get("anxiety", 0)) + 40)
                save_character(conn, other)
                
                # Send text message to player
                add_message(
                    conn, "sms", other["name"], "User", other["location"],
                    f"I can't believe it... {name} is gone. They said it was {cause}. I'm completely devastated.",
                    {"tragedy": True}
                )

    # Post to Instavibe News
    post_id = f"post_death_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "Town Chronicle",
        "content": f"🚨 OBITUARY: We are deeply saddened to announce the passing of {name}. Reports suggest the cause was {cause}. A service will be held at the Graveyard. Our thoughts are with the family. #RIP #Loss #TownChronicle",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(15, 60),
        "comments": [
            {"id": "c1", "author": "Anon", "content": "This is heartbreaking. They were a pillar of our community.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 5000},
            {"id": "c2", "author": "TownGuard", "content": "Our patrols are investigating the circumstances.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 12000}
        ],
        "likes_by": ["Anon"]
    }
    add_instavibe_post(post)
    
    return add_event(conn, "npc_death", name, "Graveyard", {"cause": cause})

def trigger_business_failure(conn: sqlite3.Connection, characters: list[dict[str, Any]], places: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Simulates a business failing due to economic issues or scandals."""
    # Find active merchants
    merchants = [c for c in characters if c["role"] in ["Merchant", "Shopkeeper", "Vendor"]]
    if not merchants:
        return None
        
    target_merchant = random.choice(merchants)
    name = target_merchant["name"]
    loc = target_merchant["location"]
    
    # Close shop or hike up prices
    target_merchant["role"] = "Unemployed"
    target_merchant.setdefault("stats", {})["anxiety"] = min(100.0, float(target_merchant["stats"].get("anxiety", 0)) + 50)
    target_merchant["schedule"] = [
        {"hour": 9, "location": "Tavern", "activity": "Looking for job leads", "follow_chance": 0.8},
        {"hour": 15, "location": "Town Square", "activity": "Lamenting bad economy", "follow_chance": 0.6}
    ]
    save_character(conn, target_merchant)
    
    # Mutate location payload to show closed
    for place in places:
        if place["id"] == loc or place["name"] == loc:
            payload = decode(place["payload"], {})
            payload["status"] = "Closed"
            payload["description"] = f"An empty shop lot. The board reads: Closed due to bankruptcy."
            conn.execute("update places set payload=? where id=?", (encode(payload), place["id"]))
            break
            
    # Direct SMS to Player
    add_message(
        conn, "sms", name, "User", loc,
        f"It's over... I had to close down my business at {loc} today. The overhead was just too high and supply costs skyrocketed. If you hear of any job openings, please let me know.",
        {"job_hunt": True}
    )
    
    # Instavibe post
    post_id = f"post_bankrupt_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "MarketWatch",
        "content": f"📉 ECONOMIC SHOCK: {name}'s retail business at {loc} has officially filed for bankruptcy! High logistics costs and decreased foot traffic are blamed. Local commerce is in distress. #Economy #Bankruptcy #MarketCollapse",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(5, 30),
        "comments": [
            {"id": "c1", "author": "Resident", "content": "Oh no, I loved shopping there! Where will we get gear now?", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 4000},
            {"id": "c2", "author": "BusinessUnion", "content": "Tax rates must be lowered or more stores will fail this quarter.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 9000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "business_failed", name, loc, {"original_role": "Merchant"})

def trigger_faction_takeover(conn: sqlite3.Connection, characters: list[dict[str, Any]], places: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Simulates a faction forcibly taking over a district or building."""
    if not places:
        return None
        
    # Get a list of places excluding starting zone
    options = [p for p in places if p["id"] not in {"Starting Location"}]
    if not options:
        return None
        
    target_place = random.choice(options)
    loc_id = target_place["id"]
    loc_name = target_place["name"]
    
    factions = ["Shadow Syndicate", "Royal Guard", "Iron Order", "Mages Guild", "Dawn Rebellion"]
    faction_a = random.choice(factions)
    faction_b = random.choice([f for f in factions if f != faction_a])
    
    # Mutate place payload owner
    payload = decode(target_place["payload"], {})
    payload["faction_control"] = faction_a
    payload["description"] = f"{target_place.get('description', '')} (Under strict control of the {faction_a})."
    conn.execute("update places set payload=? where id=?", (encode(payload), loc_id))
    
    # Degrade faction relations of NPCs in those factions
    for npc in characters:
        profile = npc.get("profile", {})
        if profile.get("faction") == faction_b:
            # Boost anxiety and hostility
            npc.setdefault("stats", {})["anxiety"] = min(100.0, float(npc["stats"].get("anxiety", 0)) + 30)
            npc.setdefault("memories", []).insert(0, {
                "ts": now_iso(),
                "type": "faction_defeat",
                "text": f"Outraged that {faction_a} seized control of {loc_name} from us.",
                "importance": 0.8
            })
            save_character(conn, npc)
            
    # Instavibe post
    post_id = f"post_takeover_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "FactionWatch",
        "content": f"⚔️ TERRITORY SHIFT: The {faction_a} has successfully executed a nighttime raid and taken absolute control of {loc_name}! The {faction_b} has reportedly retreated. Guard patrols have been doubled. #FactionWar #Takeover #BreakingNews",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(25, 80),
        "comments": [
            {"id": "c1", "author": "TownHeralder", "content": "Is it safe to walk through there now? I have classes nearby.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 3000},
            {"id": "c2", "author": "RebelOfficer", "content": "We won't let this stand. Reclaiming it is a top priority.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 8000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "faction_takeover", faction_a, loc_name, {"expelled": faction_b})

def trigger_plague_outbreak(conn: sqlite3.Connection, characters: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Starts a contagion epidemic that infects multiple NPCs."""
    # Choose 2-3 random NPCs to infect initially
    infected_candidates = [c for c in characters if c["role"] != "Player" and c["name"] not in {"User"}]
    if len(infected_candidates) < 2:
        return None
        
    plagues = ["Mana Flu", "Gloomrot Plague", "Rust Parasite Sickness", "Violet Scourge"]
    chosen_plague = random.choice(plagues)
    
    selected = random.sample(infected_candidates, min(len(infected_candidates), 3))
    names = []
    for npc in selected:
        npc.setdefault("stats", {})["infected"] = True
        npc["stats"]["disease"] = chosen_plague
        npc["stats"]["energy"] = max(0.1, float(npc["stats"].get("energy", 100)) - 40)
        
        # Schedule change: detour to Clinic
        npc["schedule"] = [
            {"hour": 10, "location": "Clinic", "activity": "Getting treated for infection", "follow_chance": 0.9},
            {"hour": 18, "location": "Home", "activity": "Bed rest", "follow_chance": 0.9}
        ]
        
        npc.setdefault("memories", []).insert(0, {
            "ts": now_iso(),
            "type": "illness",
            "text": f"Caught the {chosen_plague}. Feeling extremely weak and feverish.",
            "importance": 0.85
        })
        save_character(conn, npc)
        names.append(npc["name"])
        
        # SMS to Player
        add_message(
            conn, "sms", npc["name"], "User", npc["location"],
            f"Hey, I'm sorry I can't make it to hang out. I caught this nasty {chosen_plague} that's going around. I'm heading to the clinic. Take care of yourself, it spreads fast! 🤒",
            {"infected": True}
        )
        
    # Instavibe post
    post_id = f"post_outbreak_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "HealthBoard",
        "content": f"☣️ OUTBREAK WARNING: Cases of {chosen_plague} have been detected in our sector! Initial cases include {', '.join(names)}. Local alchemists report high demand for warding potions. Maintain distance. #Outbreak #Plague #Epidemic Alert",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(10, 45),
        "comments": [
            {"id": "c1", "author": "Apothecary", "content": "We are compounding cure charms. Visit us at the Shop.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 6000},
            {"id": "c2", "author": "ConcernedParent", "content": "Should we close the local academy until this passes?", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 15000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "plague_outbreak", chosen_plague, "Clinic", {"patient_zero": names})

def trigger_gossip_scandal(conn: sqlite3.Connection, characters: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Triggers a major relationship scandal/corruption exposure."""
    # Find NPCs with relationships
    candidates = []
    for npc in characters:
        if npc["role"] == "Player":
            continue
        rels = npc.get("relationships", {})
        # Find active romance
        romance_partners = [k for k, v in rels.items() if v.get("category") == "romance" or v.get("label") in ["Lover", "Crush", "Partner", "Spouse"]]
        if romance_partners:
            candidates.append((npc, romance_partners[0]))
            
    if not candidates:
        # Fallback to corruption scandal of suspicious character
        suspicious_candidates = [c for c in characters if float(c.get("stats", {}).get("suspicion", 0)) > 40]
        if not suspicious_candidates:
            return None
        target = random.choice(suspicious_candidates)
        name = target["name"]
        
        # Spikes suspicion
        target["stats"]["suspicion"] = min(100.0, float(target["stats"].get("suspicion", 0)) + 40)
        save_character(conn, target)
        
        # DM from gossip network
        gossiper = random.choice([c for c in characters if c["name"] != name])["name"]
        add_message(
            conn, "sms", gossiper, "User", target["location"],
            f"Oh my god, did you see the posts? {name} was caught laundering gold from the treasury! No wonder they bought that fancy gear recently. Talk about shady... 🤫",
            {"gossip": True}
        )
        
        # Instavibe post
        post_id = f"post_corruption_{int(datetime.now(timezone.utc).timestamp())}"
        post = {
            "id": post_id,
            "author": "TownGossip",
            "content": f"🔥 EXPOSED: Financial audits reveal {name} embezzled over 5,000 gold pieces from the public guild chest! Guard inquisitors are preparing arrest warrants. #GuildScandal #Embezzlement #Corruption",
            "ts": datetime.now(timezone.utc).timestamp() * 1000,
            "likes": random.randint(40, 110),
            "comments": [
                {"id": "c1", "author": "Guildmaster", "content": "We will recover every single coin. Justice will be swift.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 4000},
                {"id": "c2", "author": "TownCitizen", "content": "I always knew they couldn't be trusted! Shocking.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 10000}
            ],
            "likes_by": []
        }
        add_instavibe_post(post)
        return add_event(conn, "corruption_scandal", name, target["location"], {"type": "embezzlement"})
        
    # Romance affair scandal
    npc_a, partner_b = random.choice(candidates)
    name_a = npc_a["name"]
    # Pick a third character as the secret lover
    secret_lovers = [c["name"] for c in characters if c["name"] not in {name_a, partner_b, "User"}]
    if not secret_lovers:
        return None
    name_c = random.choice(secret_lovers)
    
    # Mutate relationships: lover B is now extremely angry
    # Reduce affinity, boost suspicion
    rels_a = npc_a.get("relationships", {})
    if partner_b in rels_a:
        rels_a[partner_b]["affinity"] = max(10, float(rels_a[partner_b].get("affinity", 50)) - 50)
        rels_a[partner_b]["suspicion"] = min(100, float(rels_a[partner_b].get("suspicion", 0)) + 60)
        rels_a[partner_b]["label"] = "Rival"
        rels_a[partner_b]["category"] = "rivals"
        
    npc_b_list = [c for c in characters if c["name"] == partner_b]
    if npc_b_list:
        npc_b = npc_b_list[0]
        rels_b = npc_b.get("relationships", {})
        if name_a in rels_b:
            rels_b[name_a]["affinity"] = max(10, float(rels_b[name_a].get("affinity", 50)) - 60)
            rels_b[name_a]["suspicion"] = min(100, float(rels_b[name_a].get("suspicion", 0)) + 70)
            rels_b[name_a]["label"] = "Ex-Lover"
            rels_b[name_a]["category"] = "rivals"
            
        npc_b.setdefault("memories", []).insert(0, {
            "ts": now_iso(),
            "type": "heartbreak",
            "text": f"Caught {name_a} cheating on me with {name_c}. Devastated and furious.",
            "importance": 0.95
        })
        save_character(conn, npc_b)
        
    save_character(conn, npc_a)
    
    # DM to player
    add_message(
        conn, "sms", partner_b, "User", npc_b["location"] if npc_b_list else "Home",
        f"I can't believe they did this to me... I found out {name_a} has been secretly seeing {name_c} behind my back. My relationship is completely over. I'm so angry right now.",
        {"betrayal": True}
    )
    
    # Instavibe post
    post_id = f"post_affair_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "DramaAlert",
        "content": f"💔 BETRAYAL EXPOSED: Social networks are blowing up! Proof has surfaced showing {name_a} was cheating on {partner_b} with {name_c}! The two have unfollowed each other, and mutual friends are picking sides. #Breakup #Infidelity #DramaAlert",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(30, 95),
        "comments": [
            {"id": "c1", "author": "MutualFriend", "content": "I am shocked. B deserved so much better.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 5000},
            {"id": "c2", "author": "DramaLover", "content": "Grab the popcorn, this is the best town gossip in months!", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 11000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "relationship_scandal", name_a, npc_a["location"], {"cheated_with": name_c, "victim": partner_b})

def trigger_magic_breakthrough(conn: sqlite3.Connection, characters: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Simulates an alchemist or mage NPC achieving a breakthrough."""
    # Find smart/scholarly NPCs
    scholars = [c for c in characters if c["role"] in ["Mage", "Alchemist", "Researcher", "Scholar"] or float(c.get("stats", {}).get("intelligence", 0)) > 60]
    if not scholars:
        # Fallback to any character
        scholars = [c for c in characters if c["role"] != "Player" and c["name"] not in {"User"}]
    if not scholars:
        return None
        
    scholar = random.choice(scholars)
    name = scholar["name"]
    
    # Boost stats
    scholar.setdefault("stats", {})["intelligence"] = min(100.0, float(scholar["stats"].get("intelligence", 0)) + 15)
    scholar["stats"]["level"] = int(scholar["stats"].get("level", 1)) + 1
    scholar.setdefault("desires", {}).setdefault("wants", []).append("publish thesis")
    scholar.setdefault("memories", []).insert(0, {
        "ts": now_iso(),
        "type": "breakthrough",
        "text": f"Successfully completed my research project and synthesized a rare magical formula.",
        "importance": 0.8
    })
    save_character(conn, scholar)
    
    formulas = ["Aetheric Elixir", "Chronos Sand potion", "Starlight Ward scroll", "Philosopher's Crucible spark"]
    item = random.choice(formulas)
    
    # Add to alchemist shop if it exists in DB, or simulated
    # SMS to Player
    add_message(
        conn, "sms", name, "User", scholar["location"],
        f"I did it! My experiments were a success! I've finally managed to synthesize the {item}. It offers immense properties. I've sent a batch to the local shop. Drop by if you want a sample!",
        {"breakthrough": True}
    )
    
    # Instavibe post
    post_id = f"post_breakthrough_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "ScienceDaily",
        "content": f"✨ BREAKTHROUGH: Scholar {name} has successfully synthesized the legendary {item}! Experiments prove it boosts arcane potential by 40%. Limited quantities are now stocked in the local Apothecary. #MagicBreakthrough #Alchemy #Innovation",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(20, 75),
        "comments": [
            {"id": "c1", "author": "ShopOwner", "content": "Stocking this now! Selling out extremely fast.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 4000},
            {"id": "c2", "author": "Apprentice", "content": "Unbelievable! This is going in the textbooks.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 10000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "scientific_breakthrough", name, scholar["location"], {"discovered_item": item})

def trigger_natural_disaster(conn: sqlite3.Connection, places: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Strikes a location with an extreme environmental disaster."""
    if not places:
        return None
        
    options = [p for p in places if p["id"] not in {"Starting Location"}]
    if not options:
        return None
        
    target_place = random.choice(options)
    loc_id = target_place["id"]
    loc_name = target_place["name"]
    
    disasters = ["Magical Portal Anomaly", "Aether Storm", "Toxic Waste Spill", "Mana Fissure", "Blizzard Vortex"]
    chosen_disaster = random.choice(disasters)
    
    # Mutate weather and state of place
    payload = decode(target_place["payload"], {})
    payload["weather"] = "Storm"
    payload["biome"] = "Anomaly"
    payload["status"] = "Locked"
    payload["description"] = f"{target_place.get('description', '')} (Warning: Evacuated due to a {chosen_disaster})."
    conn.execute("update places set payload=? where id=?", (encode(payload), loc_id))
    
    # Instavibe post
    post_id = f"post_disaster_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "EmergencyAlerts",
        "content": f"⚠️ HAZARD WARNING: A massive {chosen_disaster} has struck {loc_name}! Sector locks have been activated. Evacuate immediately. Stay inside and lock all runes. #EmergencyAlert #Hazard #AetherDisaster",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(40, 90),
        "comments": [
            {"id": "c1", "author": "CivilDefense", "content": "Evacuation transit portals are open. Head to the Town Square.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 2000},
            {"id": "c2", "author": "Traveler", "content": "I'm stuck on the other side of the pass! Hope everyone is ok.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 7000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "natural_disaster", chosen_disaster, loc_name, {"hazard_level": "Severe"})

def trigger_crime_arrest(conn: sqlite3.Connection, characters: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Arrests a high-suspicion NPC and sends them to Jail."""
    candidates = [c for c in characters if c["role"] != "Player" and c["name"] not in {"User"}]
    if not candidates:
        return None
        
    # Pick target with highest suspicion
    candidates.sort(key=lambda x: float(x.get("stats", {}).get("suspicion", 0)), reverse=True)
    target = candidates[0]
    name = target["name"]
    
    crime = random.choice(["smuggling forbidden runes", "trespassing in the faction vault", "assaulting a guard captain", "stealing enchanted potions"])
    
    # Mutate location and schedules
    target["location"] = "Jail"
    target["profile"]["map_position"] = {"x": 0.1, "y": 0.9, "z": -1}
    target["schedule"] = [
        {"hour": 8, "location": "Jail", "activity": "Locked in dungeon cell", "follow_chance": 1.0},
        {"hour": 14, "location": "Jail", "activity": "Dungeon yard exercise", "follow_chance": 1.0},
        {"hour": 20, "location": "Jail", "activity": "Locked in dungeon cell", "follow_chance": 1.0}
    ]
    target.setdefault("memories", []).insert(0, {
        "ts": now_iso(),
        "type": "arrest",
        "text": f"Arrested for {crime}. Sentenced to dungeon detention.",
        "importance": 0.9
    })
    save_character(conn, target)
    
    # Instavibe post
    post_id = f"post_arrest_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "TownGuardNews",
        "content": f"👮 JUSTICE SERVED: High-suspicion suspect {name} has been arrested for {crime}! They have been escorted to the Jail sector to await trial. Law enforcement remains vigilant. #Arrest #Justice #CrimeAlert",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(10, 50),
        "comments": [
            {"id": "c1", "author": "GuardOfficer", "content": "We maintain order. No one escapes the dungeon.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 4000},
            {"id": "c2", "author": "LocalCitizen", "content": "Good! They were always acting extremely suspicious around my shop.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 9000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "npc_arrested", name, "Jail", {"crime": crime})

def trigger_business_startup(conn: sqlite3.Connection, characters: list[dict[str, Any]], places: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Launches a new shop or business in a vacant sector."""
    # Find unemployed or low-income NPCs
    candidates = [c for c in characters if c["role"] in ["Unemployed", "Commoner", "Apprentice"]]
    if not candidates:
        candidates = [c for c in characters if c["role"] != "Player" and c["name"] not in {"User"}]
    if not candidates:
        return None
        
    founder = random.choice(candidates)
    name = founder["name"]
    
    # Pick a random vacant room (from places with few merchants)
    if not places:
        return None
    target_place = random.choice(places)
    loc_id = target_place["id"]
    loc_name = target_place["name"]
    
    biz_names = ["Gear & Glimmer", "Rune Syndicate Shop", "Apothecary Hub", "Spellbound Goods"]
    chosen_biz = random.choice(biz_names)
    
    # Mutate founder NPC status
    founder["role"] = "Merchant"
    founder["location"] = loc_name
    founder["schedule"] = [
        {"hour": 9, "location": loc_name, "activity": f"Running {chosen_biz}", "follow_chance": 0.95},
        {"hour": 18, "location": "Tavern", "activity": "Celebrating business growth", "follow_chance": 0.8}
    ]
    # Give some cash
    founder.setdefault("stats", {})["currency"] = float(founder["stats"].get("currency", 50)) + 300
    save_character(conn, founder)
    
    # Mutate place info
    payload = decode(target_place["payload"], {})
    payload["status"] = "Active"
    payload["merchant"] = name
    payload["description"] = f"{target_place.get('description', '')} (Home of the newly opened {chosen_biz} boutique)."
    conn.execute("update places set payload=? where id=?", (encode(payload), loc_id))
    
    # SMS to Player
    add_message(
        conn, "sms", name, "User", loc_name,
        f"Big news! I've finally gathered enough capital to launch my own business, {chosen_biz}, at {loc_name}! I have rare scrolls and items ready. Drop by for a friend discount! 🚀",
        {"startup": True}
    )
    
    # Instavibe post
    post_id = f"post_startup_{int(datetime.now(timezone.utc).timestamp())}"
    post = {
        "id": post_id,
        "author": "TownChronicle",
        "content": f"🚀 NEW BUSINESS: Entrepreneur {name} has officially launched {chosen_biz} boutique at {loc_name}! Featuring high-grade materials and gear. Support your local startups! #GrandOpening #Startup #Boutique #SupportLocal",
        "ts": datetime.now(timezone.utc).timestamp() * 1000,
        "likes": random.randint(15, 60),
        "comments": [
            {"id": "c1", "author": "ShopUnion", "content": "Welcome to the merchant board! Wishing you success.", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 5000},
            {"id": "c2", "author": "Customer1", "content": "I went there today, the layout is beautiful. Highly recommend!", "ts": datetime.now(timezone.utc).timestamp() * 1000 + 12000}
        ],
        "likes_by": []
    }
    add_instavibe_post(post)
    
    return add_event(conn, "business_startup", name, loc_name, {"business_name": chosen_biz})

def spread_diseases(conn: sqlite3.Connection) -> None:
    """Smart contagion simulation. If NPCs occupy the same location, the infection has a chance to spread."""
    # Find infected characters
    rows = conn.execute("select * from characters").fetchall()
    chars = [character_from_row(row) for row in rows]
    
    infected_map = {}
    for c in chars:
        stats = c.get("stats", {})
        if stats.get("infected") or stats.get("sick"):
            infected_map[c["location"]] = stats.get("disease", "Contagious Illness")
            
    if not infected_map:
        return
        
    for c in chars:
        if c["role"] == "Player" or c["name"] == "User":
            continue
        stats = c.setdefault("stats", {})
        if stats.get("infected") or stats.get("sick"):
            continue
            
        loc = c["location"]
        if loc in infected_map:
            # 15% chance to catch the disease if sharing the room
            if random.random() < 0.15:
                disease = infected_map[loc]
                stats["infected"] = True
                stats["disease"] = disease
                stats["energy"] = max(0.2, float(stats.get("energy", 100)) - 30)
                
                # Update schedule
                c["schedule"] = [
                    {"hour": 10, "location": "Clinic", "activity": "Seeking cure", "follow_chance": 0.8},
                    {"hour": 17, "location": "Home", "activity": "Sick rest", "follow_chance": 0.9}
                ]
                
                c.setdefault("memories", []).insert(0, {
                    "ts": now_iso(),
                    "type": "contagion",
                    "text": f"Caught {disease} from someone in {loc}. Feeling feverish.",
                    "importance": 0.75
                })
                save_character(conn, c)
                
                # Send text message to player
                add_message(
                    conn, "sms", c["name"], "User", loc,
                    f"Oh no... I just started coughing like crazy. I think I caught the {disease} while visiting {loc}. Going to rest. 😷",
                    {"infected": True}
                )
