const ASSET_ROOT = "./assets";

export const ADVENTURE_PATH_PRESET_ID = "adventure_path_story";

export const STORY_ASSET_ROUTES = Object.freeze({
  characters: [],
  lorebooks: []
});

const START = "Adventure'r's Path";
const BG = "./assets/backgrounds/adventure_path.png";

const clone = (value) => JSON.parse(JSON.stringify(value));
const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const CLASS_LOADOUTS = Object.freeze({
  warrior: {
    resourceProfile: "ap",
    stats: { str: 15, dex: 11, con: 14, int: 8, wis: 10, cha: 10 },
    skills: [
      { name: "Shield Break", type: "combat", level: 1, description: "A committed strike that pressures armored enemies and barred routes." },
      { name: "Hold the Line", type: "defense", level: 1, description: "Protect nearby allies and resist forced movement." }
    ],
    items: [
      { name: "Roadworn Broadsword", type: "weapon", quantity: 1, description: "A reliable steel blade balanced for long travel." },
      { name: "Gallian Field Shield", type: "armor", quantity: 1, description: "A scarred shield bearing a faded crimson device." },
      { name: "Healing Draught", type: "consumable", quantity: 2, description: "Restores health." }
    ]
  },
  mage: {
    resourceProfile: "mp",
    stats: { str: 7, dex: 10, con: 10, int: 16, wis: 14, cha: 11 },
    skills: [
      { name: "Arcane Dart", type: "magic", level: 1, description: "A precise bolt of magical force." },
      { name: "Comprehend Tongues", type: "utility", level: 1, description: "Interpret unfamiliar speech and inscriptions." }
    ],
    items: [
      { name: "Scholar's Focus", type: "focus", quantity: 1, description: "A crystal focus approved by the Gallian Royal Academy." },
      { name: "Blank Rune Leaves", type: "tool", quantity: 5, description: "Paper prepared for copying sigils." },
      { name: "Mana Tonic", type: "consumable", quantity: 2, description: "Restores magical energy." }
    ]
  },
  rogue: {
    resourceProfile: "ap",
    stats: { str: 9, dex: 16, con: 10, int: 13, wis: 11, cha: 12 },
    skills: [
      { name: "Lockwork", type: "utility", level: 1, description: "Open simple locks and identify trapped mechanisms." },
      { name: "Quiet Step", type: "stealth", level: 1, description: "Move through guarded spaces with less risk of detection." }
    ],
    items: [
      { name: "Matched Daggers", type: "weapon", quantity: 1, description: "Two compact blades in concealed sheaths." },
      { name: "Lockpick Roll", type: "tool", quantity: 1, description: "Fine picks, tension bars, and a tiny mirror." },
      { name: "Smoke Vial", type: "consumable", quantity: 2, description: "Creates a brief obscuring cloud." }
    ]
  },
  paladin: {
    resourceProfile: "both",
    stats: { str: 14, dex: 8, con: 13, int: 9, wis: 12, cha: 15 },
    skills: [
      { name: "Oathward", type: "defense", level: 1, description: "Raise a brief ward against corruption and fear." },
      { name: "Judgment", type: "combat", level: 1, description: "A radiant strike empowered by conviction." }
    ],
    items: [
      { name: "Oathbound Longsword", type: "weapon", quantity: 1, description: "A polished blade engraved with the Six Virtues." },
      { name: "Traveler's Reliquary", type: "focus", quantity: 1, description: "A small silver devotional case." },
      { name: "Healing Draught", type: "consumable", quantity: 2, description: "Restores health." }
    ]
  },
  ranger: {
    resourceProfile: "ap",
    stats: { str: 11, dex: 15, con: 11, int: 10, wis: 15, cha: 8 },
    skills: [
      { name: "Trailwise", type: "survival", level: 1, description: "Read tracks, weather, and signs of nearby danger." },
      { name: "Pinning Shot", type: "combat", level: 1, description: "Aimed shot that hinders a target's movement." }
    ],
    items: [
      { name: "Eldwyrd Longbow", type: "weapon", quantity: 1, description: "A flexible bow suited to forest paths." },
      { name: "Forager's Knife", type: "tool", quantity: 1, description: "Useful for harvesting herbs and preparing camp." },
      { name: "Field Rations", type: "food", quantity: 3, description: "A day's preserved meal." }
    ]
  },
  cleric: {
    resourceProfile: "mp",
    stats: { str: 10, dex: 8, con: 13, int: 11, wis: 16, cha: 12 },
    skills: [
      { name: "Mending Light", type: "healing", level: 1, description: "Restore a modest amount of health." },
      { name: "Turn Blight", type: "magic", level: 1, description: "Disrupt minor curses, sickness, and restless dead." }
    ],
    items: [
      { name: "Pilgrim's Mace", type: "weapon", quantity: 1, description: "A sturdy mace used by roadwardens and healers." },
      { name: "Herbal Poultice", type: "consumable", quantity: 3, description: "Treats common wounds and irritation." },
      { name: "Prayer Book", type: "book", quantity: 1, description: "Road prayers of the Six Virtues." }
    ]
  },
  druid: {
    resourceProfile: "mp",
    stats: { str: 8, dex: 11, con: 12, int: 12, wis: 16, cha: 10 },
    skills: [
      { name: "Rootsnare", type: "magic", level: 1, description: "Call roots to restrain a nearby threat." },
      { name: "Herbal Lore", type: "survival", level: 1, description: "Identify and safely harvest useful natural ingredients." }
    ],
    items: [
      { name: "Livingwood Staff", type: "weapon", quantity: 1, description: "A staff grown rather than carved." },
      { name: "Seed Satchel", type: "tool", quantity: 1, description: "Seeds, chalk, twine, and dried herbs." },
      { name: "Moonwell Water", type: "consumable", quantity: 2, description: "A restorative vial from the Silverwood Reach." }
    ]
  },
  bard: {
    resourceProfile: "both",
    stats: { str: 8, dex: 13, con: 10, int: 11, wis: 10, cha: 16 },
    skills: [
      { name: "Cutting Verse", type: "social", level: 1, description: "Disorient or provoke with a sharply delivered line." },
      { name: "Roadsong", type: "support", level: 1, description: "Bolster allies during travel and tense encounters." }
    ],
    items: [
      { name: "Travel Lute", type: "instrument", quantity: 1, description: "A compact instrument with a hidden document pocket." },
      { name: "Silverhand Letter of Introduction", type: "quest", quantity: 1, description: "A suspiciously broad introduction to merchants in Argent Port." },
      { name: "Field Rations", type: "food", quantity: 2, description: "A day's preserved meal." }
    ]
  }
});

export function getAdventurePathClassLoadout(className = "warrior") {
  return clone(CLASS_LOADOUTS[String(className || "warrior").toLowerCase()] || CLASS_LOADOUTS.warrior);
}

function area(id, name, type, x, y, links, desc, extra = {}) {
  return {
    id, name, type, x, y, z: 0, links, desc,
    theme: extra.theme || type,
    faction: extra.faction || "Independent",
    district: extra.district || "Tellara Heartlands",
    discoveryState: extra.discoveryState || "known",
    blueprintId: extra.blueprintId || "",
    imagePrompt: extra.imagePrompt || `${name}, ${desc}, high fantasy visual novel background, wide establishing shot, no characters, no text, no UI`,
    interactions: extra.interactions || ["observe", "travel", "search"],
    encounters: extra.encounters || [],
    scavenge: extra.scavenge || [],
    hotspots: extra.hotspots || [],
    barrier: extra.barrier || null
  };
}

function room(id, name, x, y, desc, extra = {}) {
  return {
    id, name, x, y, z: 0, w: extra.w || 3, h: extra.h || 2, explored: extra.explored !== false,
    desc,
    isExit: extra.isExit === true,
    imagePrompt: extra.imagePrompt || `${name}, ${desc}, strict coherent room layout, high fantasy visual novel background, no characters, no text, no UI`,
    hotspots: extra.hotspots || [],
    scavenge: extra.scavenge || [],
    encounters: extra.encounters || [],
    barrier: extra.barrier || null,
    customRoomPresets: extra.customRoomPresets || []
  };
}

function blueprint(parentName, rooms, links) {
  return { id: `blueprint_${slug(parentName)}`, parentName, kind: "interior", width: 15, height: 12, rooms, links };
}

function genericSiteBlueprint(node) {
  const base = slug(node.name);
  const text = `${node.type || ""} ${node.name || ""}`.toLowerCase();
  const labels = /cave|dungeon|ruin|undercity|vault|temple/.test(text)
    ? ["Entrance Mouth", "Main Passage", "Side Gallery", "Old Camp", "Sealed Chamber", "Deep Exit"]
    : /city|town|village|port/.test(text)
      ? ["District Gate", "Public Hall", "Market Interior", "Service Passage", "Secured Archive", "Roof or Tower Access"]
      : /abbey|cathedral|grove|spring|shrine/.test(text)
        ? ["Pilgrim Threshold", "Ceremonial Hall", "Study or Vestry", "Relic Store", "Sealed Sanctum", "Caretaker Passage"]
        : /forest|mountain|exterior|field|plains|swamp|camp|road|path/.test(text)
          ? ["Sheltered Approach", "Waystation Interior", "Supply Nook", "Watch Post", "Sealed Lower Chamber", "Rear Escape"]
          : ["Entry Threshold", "Main Chamber", "Side Chamber", "Utility Room", "Locked Inner Room", "Secondary Exit"];
  const positions = [[1, 4], [5, 4], [5, 8], [9, 8], [9, 3], [13, 4]];
  const rooms = labels.map((label, index) => room(
    `${base}_site_${index + 1}`,
    `${node.name} - ${label}`,
    positions[index][0],
    positions[index][1],
    `${label} inside the primary bounded site at ${node.name}.`,
    {
      isExit: index === 0 || index === 5,
      hotspots: index === 1 ? [{ id: `${base}_site_hotspot`, label: `${node.name} Local Feature`, action: "inspect" }] : [],
      scavenge: index === 2 ? [{ item: `${node.name} Supplies`, quantity: 1, check: "per", dc: 10 }] : [],
      encounters: index === 3 ? clone(node.encounters || []).slice(0, 1) : [],
      barrier: index === 4 ? { state: "locked", requirementType: "skill", requirementId: "Lockwork", lockName: `${node.name} Inner Lock`, denial: "The secured inner route will not open without skill or a matching key." } : null
    }
  ));
  return blueprint(node.name, rooms, [
    [rooms[0].id, rooms[1].id],
    [rooms[1].id, rooms[2].id],
    [rooms[2].id, rooms[3].id],
    [rooms[1].id, rooms[4].id],
    [rooms[4].id, rooms[5].id]
  ]);
}

function nearbyPackage(node) {
  const base = slug(node.name);
  const names = /city|town|village|port/.test(String(node.type || ""))
    ? ["Current District", "Main Street", "Side Alley", "Public Landmark", "Building Entrance"]
    : ["Current Spot", "Forward Route", "Side Route", "Nearby Landmark", "Sheltered Entrance"];
  return names.map((label, index) => area(
    `vicinity_${base}_${index + 1}`,
    `${node.name} - ${label}`,
    index === 0 ? "current" : "nearby",
    [48, 48, 32, 64, 48][index],
    [52, 34, 54, 54, 72][index],
    index === 0
      ? [`vicinity_${base}_2`, `vicinity_${base}_3`, `vicinity_${base}_4`, `vicinity_${base}_5`]
      : [`vicinity_${base}_1`],
    index === 0 ? `Your exact position within ${node.name}.` : `${label} immediately reachable from ${node.name}.`,
    {
      district: node.name,
      faction: node.faction,
      discoveryState: index === 0 ? "visited" : "known",
      blueprintId: index === 4 ? node.name : "",
      hotspots: index === 3 ? [{ id: `${base}_nearby_landmark`, label: `${node.name} Landmark`, action: "inspect" }] : [],
      scavenge: index === 2 ? [{ item: `${node.name} Forage`, quantity: 1, check: "wis", dc: 9 }] : []
    }
  ));
}

function completeBlueprint(bp, minimumRooms = 6) {
  if (!bp || !Array.isArray(bp.rooms) || !Array.isArray(bp.links)) return bp;
  const originalTail = bp.rooms[bp.rooms.length - 1];
  while (bp.rooms.length < minimumRooms) {
    const index = bp.rooms.length + 1;
    const previous = bp.rooms[bp.rooms.length - 1];
    const extension = room(
      `${slug(bp.parentName)}_extension_${index}`,
      `${bp.parentName} - ${index === minimumRooms ? "Secondary Exit" : `Hidden Annex ${index - 3}`}`,
      11 + ((index - 1) % 2) * 2,
      2 + ((index - 1) % 3) * 3,
      `A deliberately mapped extension of ${bp.parentName}, preserving strict physical continuity.`,
      {
        isExit: index === minimumRooms,
        hotspots: index === minimumRooms - 1 ? [{ id: `${slug(bp.parentName)}_annex_hotspot`, label: "Hidden Annex Feature", action: "inspect" }] : [],
        scavenge: index === minimumRooms - 1 ? [{ item: `${bp.parentName} Hidden Cache`, quantity: 1, check: "per", dc: 12 }] : []
      }
    );
    bp.rooms.push(extension);
    if (previous) bp.links.push([previous.id, extension.id]);
  }
  if (originalTail && !bp.links.some(([from, to]) => from === originalTail.id || to === originalTail.id)) {
    const prevIdx = bp.rooms.indexOf(originalTail) - 1;
    if (prevIdx >= 0) {
      bp.links.push([bp.rooms[prevIdx].id, originalTail.id]);
    }
  }
  return bp;
}

export function createAdventurePathMap() {
  const areas = [
    area("area_adventure_path", START, "exterior", 48, 54, ["area_wayfarer_camp", "area_eldwyrd_edge", "area_old_tollhouse"], "A winding trade road between Gallia and Argent Port, where every traveler seems to be carrying a rumor about the Crown of Aurelion.", {
      theme: "green hills and old trade road",
      encounters: [{ id: "enc_brannik", kind: "character", character: "Brannik Copperflip, Wandering Merchant", chance: 100, tone: "trade_or_rumor", prompt: "Brannik's tarp wagon blocks part of the road. He offers a bargain and a rumor about a broken circlet." }],
      scavenge: [{ item: "Roadside Yarrow", quantity: 2, check: "wis", dc: 8 }, { item: "Bent Silverhand Token", quantity: 1, check: "per", dc: 11 }],
      hotspots: [{ id: "weathered_signpost", label: "Weathered Signpost", action: "inspect", reveals: ["Argent Port", "Forest of Eldwyrd", "Altheris"] }, { id: "wagon_ruts", label: "Fresh Wagon Ruts", action: "track", reveals: ["Brannik's Roadside Camp"] }]
    }),
    area("area_wayfarer_camp", "Brannik's Roadside Camp", "exterior", 60, 58, ["area_adventure_path"], "A patched market tarp, a compact wagon, and a fire positioned where travelers cannot avoid seeing the merchandise.", {
      encounters: [{ id: "enc_brannik_shop", kind: "character", character: "Brannik Copperflip, Wandering Merchant", chance: 100, tone: "merchant" }],
      scavenge: [{ item: "Copper Ring", quantity: 1, check: "cha", dc: 10 }],
      hotspots: [{ id: "mystery_satchel", label: "Mystery Satchel", action: "shop" }, { id: "coin_game", label: "Copperflip Coin Game", action: "gamble" }]
    }),
    area("area_eldwyrd_edge", "Eldwyrd Forest Edge", "forest", 38, 42, ["area_adventure_path", "area_misty_glade", "area_silver_grove"], "The first sentient trees of Eldwyrd lean over the road, listening to travelers before allowing them deeper.", {
      encounters: [{ id: "enc_dire_wolves", kind: "combat", chance: 35, enemies: ["Dire Wolf", "Dire Wolf"], escape: "Return to Adventure'r's Path" }],
      scavenge: [{ item: "Eldwyrd Resin", quantity: 1, check: "wis", dc: 10 }],
      hotspots: [{ id: "listening_oak", label: "Listening Oak", action: "speak" }]
    }),
    area("area_misty_glade", "Misty Starlight Glade", "forest", 27, 36, ["area_eldwyrd_edge", "area_gerie_village"], "A moon-damp clearing where Starlight Mushrooms glow between fern roots.", {
      encounters: [{ id: "enc_sporelings", kind: "combat_or_avoid", chance: 45, enemies: ["Sporeling", "Sporeling", "Sporeling"], peacefulOption: "Use Herbal Lore or leave an offering." }],
      scavenge: [{ item: "Starlight Mushroom", quantity: 5, check: "wis", dc: 9 }],
      hotspots: [{ id: "mushroom_ring", label: "Starlight Mushroom Ring", action: "harvest" }]
    }),
    area("area_gerie_village", "Forestside Village", "village", 19, 46, ["area_misty_glade", "area_gerie_lab"], "A practical forest village built around herb gardens, rain barrels, and several alchemical scorch marks.", {
      encounters: [{ id: "enc_gerie", kind: "character", character: "Gerie, Forestside Alchemist", chance: 100, tone: "quest_giver" }],
      blueprintId: "Gerie's Alchemy Cottage"
    }),
    area("area_gerie_lab", "Gerie's Alchemy Cottage", "interior", 13, 52, ["area_gerie_village"], "A cramped cottage-laboratory where every surface supports a vial, herb bundle, or unfinished apology.", { blueprintId: "Gerie's Alchemy Cottage" }),
    area("area_silver_grove", "Silver Grove", "forest", 43, 27, ["area_eldwyrd_edge", "area_sylvanost"], "A quiet moonlit grove at the threshold of the Silverwood Reach.", {
      encounters: [{ id: "enc_revin", kind: "character", character: "Revin, Elven Mage", chance: 100, tone: "conversation_or_magic_lesson" }],
      scavenge: [{ item: "Moonwell Dew", quantity: 1, check: "wis", dc: 12 }]
    }),
    area("area_sylvanost", "Sylvanost", "city", 54, 20, ["area_silver_grove", "area_argent_road"], "The living-wood capital of the Silverwood Reach, where crystal spires grow through ancient trees.", { faction: "Silverleaf Council" }),
    area("area_old_tollhouse", "Abandoned Silverhand Tollhouse", "interior", 65, 45, ["area_adventure_path", "area_argent_road"], "A shuttered tollhouse whose cellar door bears a recently disturbed Silverhand seal.", {
      blueprintId: "Abandoned Silverhand Tollhouse",
      encounters: [{ id: "enc_smugglers", kind: "combat_or_talk", chance: 70, enemies: ["Silverhand Smuggler", "Silverhand Smuggler"], peacefulOption: "Present the Silverhand Letter or bargain." }]
    }),
    area("area_argent_road", "Argent Trade Road", "exterior", 72, 34, ["area_old_tollhouse", "area_sylvanost", "area_argent_port"], "A heavily traveled road patrolled by private Silverhand guards.", {
      encounters: [{ id: "enc_road_inspection", kind: "social", chance: 60, character: "Silverhand Inspector", tone: "checkpoint" }]
    }),
    area("area_argent_port", "Argent Port", "city", 84, 27, ["area_argent_road", "area_lysander_spire", "area_sunken_gate"], "Tellara's glittering trade capital, governed by contracts, leverage, and the Merchant Conclave of Silverhand.", {
      faction: "Merchant Conclave of Silverhand",
      hotspots: [{ id: "silverhand_exchange", label: "Silverhand Exchange", action: "trade" }, { id: "whisper_market", label: "Whisper Market", action: "investigate" }]
    }),
    area("area_lysander_spire", "Lysander's Silverhand Spire", "interior", 91, 18, ["area_argent_port"], "A severe merchant spire overlooking Argent Port, filled with ledgers, guarded vaults, and carefully curated lies.", {
      faction: "Merchant Conclave of Silverhand",
      blueprintId: "Lysander's Silverhand Spire",
      encounters: [{ id: "enc_lysander", kind: "character", character: "Lysander Vaylen", chance: 100, tone: "negotiation" }]
    }),
    area("area_sunken_gate", "Sunken City Gate", "dungeon", 91, 38, ["area_argent_port"], "A tide-locked descent toward the drowned ruins of K'tharr and an unstable portal shunt.", {
      blueprintId: "Sunken City Gate",
      barrier: { state: "locked", requirementType: "item", requirementId: "Tideglass Key", lockName: "Tide-Locked Gate", denial: "The drowned mechanism will not turn without a Tideglass Key." }
    }),
    area("area_altheris", "Altheris", "city", 51, 70, ["area_adventure_path", "area_crimson_camp", "area_ironhold_pass"], "Gallia's capital on the River Argent, tense after the Queen's death.", { faction: "Kingdom of Gallia" }),
    area("area_crimson_camp", "Crimson Blade War Camp", "camp", 38, 78, ["area_altheris", "area_ruined_cathedral"], "A disciplined war camp beneath fading crimson banners.", {
      encounters: [{ id: "enc_ronan", kind: "character", character: "Ronan, Valiant Defender", chance: 100, tone: "ally_or_training" }]
    }),
    area("area_ruined_cathedral", "Violet Ruined Cathedral", "interior", 25, 82, ["area_crimson_camp"], "A roofless cathedral washed in violet moonlight, its ritual circle undisturbed by rain.", {
      blueprintId: "Violet Ruined Cathedral",
      encounters: [{ id: "enc_maeve", kind: "character", character: "Maeve, Hexweaver", chance: 100, tone: "pact_or_warning" }]
    }),
    area("area_ironhold_pass", "Ironhold Mountain Pass", "mountain", 65, 79, ["area_altheris", "area_stoneforge"], "A hard northern pass where bandits, dwarven caravans, and dragon signs compete for attention.", {
      encounters: [{ id: "enc_bandits", kind: "combat", chance: 55, enemies: ["Ironhold Bandit", "Ironhold Bandit Scout"] }]
    }),
    area("area_stoneforge", "Stoneforge", "city", 79, 86, ["area_ironhold_pass"], "The colossal underground capital of Kragheim, built around the Great Forge and clan halls.", { faction: "Dwarven Kingdom of Kragheim" })
  ];

  areas.push(
    area("area_pahlor_plains", "Plains of Pahlor", "plains", 42, 91, ["area_altheris", "area_pahlor_ruins", "area_wildlands_watch"], "Wide southern grasslands crossed by nomadic riders, wild horses, and buried roads.", { district: "Southern Realms", encounters: [{ id: "enc_pahlor_riders", kind: "social_or_combat", chance: 45, character: "Pahlor Riders" }] }),
    area("area_pahlor_ruins", "Ruins of Pahlor", "ruins", 28, 93, ["area_pahlor_plains"], "Broken monuments and sealed chambers from a civilization older than Gallia.", { district: "Southern Realms", encounters: [{ id: "enc_ruin_guardian", kind: "combat", chance: 65, enemies: ["Pahlor Stone Guardian"] }] }),
    area("area_wildlands_watch", "Wildlands Border Watch", "camp", 57, 95, ["area_pahlor_plains", "area_spider_caves"], "A fortified watch camp facing the untamed Wildlands.", { district: "Eastern Wildlands" }),
    area("area_spider_caves", "Giant Spider Caves", "cave", 70, 96, ["area_wildlands_watch"], "A limestone cave network webbed across old smuggler tunnels.", { district: "Eastern Wildlands", encounters: [{ id: "enc_giant_spiders", kind: "combat", chance: 80, enemies: ["Giant Spider", "Giant Spider", "Brood Keeper"] }] }),
    area("area_thanir", "Thanir", "port", 13, 74, ["area_altheris", "area_thanir_undercity", "area_porthaven"], "A crowded coastal city of adventurers, pirates, and exotic cargo.", { district: "Western Coast", faction: "Merchant Guild of Thanir" }),
    area("area_thanir_undercity", "Thanir Undercity", "cave", 8, 84, ["area_thanir"], "A pirate haven carved through sea caves beneath Thanir.", { district: "Western Coast", encounters: [{ id: "enc_pirate_broker", kind: "social_or_combat", chance: 70, character: "Undercity Broker" }] }),
    area("area_forgotten_swamps", "Forgotten Swamps", "swamp", 16, 56, ["area_altheris", "area_witch_hut", "area_mire_ruin"], "A mist-covered wetland of dangerous plants, lizardfolk paths, and bad memories.", { district: "Northwestern Gallia" }),
    area("area_witch_hut", "Witch's Hut", "interior", 7, 48, ["area_forgotten_swamps"], "A crooked hut raised above black water, surrounded by charms that move without wind.", { district: "Northwestern Gallia" }),
    area("area_mire_ruin", "Mire of Ruin", "ruins", 5, 63, ["area_forgotten_swamps"], "The remains of the Ashen Sorcerer's ancient magical disaster.", { district: "Northwestern Gallia", encounters: [{ id: "enc_mire_blight", kind: "combat", chance: 75, enemies: ["Blighted Husk", "Mire Wisp"] }] }),
    area("area_borromeo", "Abbey of St. Borromeo", "interior", 67, 62, ["area_altheris", "area_sylvanost"], "A mountain abbey where monks preserve ancient texts and practice healing rites.", { district: "Gallia-Silverwood Border", faction: "Order of St. Borromeo" }),
    area("area_veiled_city", "The Veiled City", "city", 96, 54, ["area_argent_port", "area_shunt_nexus"], "A concealed Tellaran city reached through controlled portal shunts and false roads.", { district: "Hidden Tellara", faction: "Veiled Council" }),
    area("area_shunt_nexus", "Portal Shunt Nexus", "dungeon", 96, 68, ["area_veiled_city", "area_sunken_gate"], "A regulated nexus of unstable portals, investigation chambers, and emergency locks.", { district: "Hidden Tellara" }),
    area("area_ossendal", "Ossendal", "city", 5, 22, ["area_porthaven"], "An ivory kingdom built among the salt-scoured ribs of forgotten sea leviathans.", { district: "Western Realms", faction: "Kingdom of Ossendal" }),
    area("area_porthaven", "Porthaven", "port", 8, 38, ["area_thanir", "area_ossendal", "area_aeloria"], "Thalorian's naval capital, dominated by shipyards, the Grand Library, and Stormwatch Lighthouse.", { district: "Western Realms", faction: "Kingdom of Thalorian" }),
    area("area_aeloria", "Aeloria", "city", 18, 15, ["area_porthaven", "area_healing_springs"], "The agrarian capital of the Sun-Sheaf Realm, ringed by sunflower fields and druid groves.", { district: "Western Realms", faction: "Sun-Sheaf Realm" }),
    area("area_healing_springs", "Sun-Sheaf Healing Springs", "exterior", 30, 12, ["area_aeloria"], "Sacred springs now threatened by a spreading magical disease.", { district: "Western Realms", encounters: [{ id: "enc_sick_pilgrims", kind: "character", chance: 65, character: "Sun-Sheaf Healers" }] }),
    area("area_edrith", "Edrith", "city", 88, 6, ["area_veiled_city", "area_inquisition_vault"], "An austere isolationist capital ruled through fear of magic and the Faith of the One.", { district: "Outer Realms", faction: "Inquisition of Edrith" }),
    area("area_inquisition_vault", "Edrith Inquisition Vault", "dungeon", 98, 7, ["area_edrith"], "A fortified archive-prison for forbidden relics, testimony, and accused spellcasters.", { district: "Outer Realms", faction: "Inquisition of Edrith" }),
    area("area_karnash", "Zarhana", "city", 88, 96, ["area_pahlor_plains", "area_sunken_temple"], "The oasis capital of Karnash above vast underground districts.", { district: "Outer Realms", faction: "Desert Empire of Karnash" }),
    area("area_sunken_temple", "Karnash Sunken Temple", "dungeon", 97, 88, ["area_karnash"], "An astrological temple buried beneath shifting desert stone.", { district: "Outer Realms" }),
    area("area_valkrigar", "Valkrigar", "city", 82, 4, ["area_ironhold_pass", "area_ice_dragon_peak"], "A fortress city carved into a glacier beyond the Tundra of Icehold.", { district: "Outer Realms", faction: "Frostclaw Kingdom" }),
    area("area_ice_dragon_peak", "Ice Dragon Peak", "mountain", 68, 3, ["area_valkrigar"], "A wind-cut peak marked by ancient claws and fresh dragon heat beneath the ice.", { district: "Outer Realms", encounters: [{ id: "enc_ice_drake", kind: "combat", chance: 75, enemies: ["Ice Drake"] }] })
  );

  const vicinityByArea = Object.fromEntries(areas.map((node) => [node.name, nearbyPackage(node)]));
  const vicinity = vicinityByArea[START];

  const blueprints = {};
  blueprints["Gerie's Alchemy Cottage"] = blueprint("Gerie's Alchemy Cottage", [
    room("gerie_entry", "Cottage Entry", 1, 4, "Boots, baskets, and drying herbs crowd the entry.", { isExit: true, hotspots: [{ id: "herb_basket", label: "Herb Basket", action: "search" }] }),
    room("gerie_lab", "Main Alchemy Lab", 5, 4, "A strict work triangle of cauldron, reagent bench, and wash basin.", { encounters: [{ id: "enc_gerie_lab", kind: "character", character: "Gerie, Forestside Alchemist", chance: 100 }], hotspots: [{ id: "cauldron", label: "Unstable Cauldron", action: "brew" }] }),
    room("gerie_store", "Reagent Pantry", 9, 2, "Shelves of labeled ingredients and one conspicuously unlabeled jar.", { scavenge: [{ item: "Common Reagent", quantity: 2, check: "int", dc: 9 }] }),
    room("gerie_cellar", "Locked Root Cellar", 9, 7, "A cool cellar used for volatile reagents.", { barrier: { state: "locked", requirementType: "skill", requirementId: "Lockwork", lockName: "Three-Pin Cellar Lock", denial: "The delicate lock resists force." }, scavenge: [{ item: "Tideglass Key", quantity: 1, check: "per", dc: 12 }] })
  ], [["gerie_entry", "gerie_lab"], ["gerie_lab", "gerie_store"], ["gerie_lab", "gerie_cellar"]]);

  blueprints["Abandoned Silverhand Tollhouse"] = blueprint("Abandoned Silverhand Tollhouse", [
    room("toll_entry", "Tollhouse Lobby", 1, 4, "A dusty counter faces the road entrance.", { isExit: true }),
    room("toll_office", "Clerk's Office", 5, 2, "Discarded manifests cover a narrow desk.", { scavenge: [{ item: "Contraband Manifest", quantity: 1, check: "int", dc: 10 }] }),
    room("toll_bunks", "Guard Bunks", 5, 7, "Four bunks and an overturned weapon rack."),
    room("toll_cellar", "Sealed Smuggler Cellar", 10, 4, "A hidden cellar connects to an old drain tunnel.", { barrier: { state: "hidden", requirementType: "stat", requirementId: "wis", dc: 12, lockName: "False Floor", revealName: "Lift False Floor", denial: "The floor looks ordinary." }, encounters: [{ id: "enc_toll_smugglers", kind: "combat_or_talk", enemies: ["Silverhand Smuggler", "Silverhand Smuggler"] }] })
  ], [["toll_entry", "toll_office"], ["toll_entry", "toll_bunks"], ["toll_office", "toll_cellar"]]);

  blueprints["Lysander's Silverhand Spire"] = blueprint("Lysander's Silverhand Spire", [
    room("spire_foyer", "Spire Reception", 1, 5, "A controlled reception chamber watched by discreet guards.", { isExit: true }),
    room("spire_ledger", "Ledger Hall", 5, 5, "Tall desks divide public accounts from private business.", { hotspots: [{ id: "trade_ledgers", label: "Trade Ledgers", action: "investigate" }] }),
    room("spire_study", "Lysander's Candlelit Study", 9, 3, "A high study of ledgers, coin chests, and calculated hospitality.", { encounters: [{ id: "enc_lysander_study", kind: "character", character: "Lysander Vaylen", chance: 100 }] }),
    room("spire_vault", "Tethered Vault", 9, 8, "A hidden vault designed around a broken circlet-shaped recess.", { barrier: { state: "locked", requirementType: "rune", requirementId: "tethered_crown", lockName: "Tethered Crown Seal", denial: "The circlet-shaped runes flare and reject the pattern.", puzzle: { keySequence: [1, 5, 9, 8] } }, scavenge: [{ item: "Key of the Tethered Crown", quantity: 1, check: "int", dc: 16 }] })
  ], [["spire_foyer", "spire_ledger"], ["spire_ledger", "spire_study"], ["spire_study", "spire_vault"]]);

  blueprints["Violet Ruined Cathedral"] = blueprint("Violet Ruined Cathedral", [
    room("cathedral_nave", "Moonlit Nave", 1, 5, "A roofless nave divided by fallen columns.", { isExit: true }),
    room("cathedral_circle", "Salt-Bound Transept", 5, 5, "A precise ritual circle glows beneath violet moonlight.", { encounters: [{ id: "enc_maeve_circle", kind: "character", character: "Maeve, Hexweaver", chance: 100 }] }),
    room("cathedral_crypt", "Betrayer's Crypt", 9, 5, "A crypt door carries a warning written in living shadow.", { barrier: { state: "locked", requirementType: "item", requirementId: "Pilgrim's Chalk", lockName: "Living Shadow Seal", denial: "The shadow closes over the seam." }, scavenge: [{ item: "Hexwoven Thread", quantity: 1, check: "wis", dc: 13 }] })
  ], [["cathedral_nave", "cathedral_circle"], ["cathedral_circle", "cathedral_crypt"]]);

  blueprints["Sunken City Gate"] = blueprint("Sunken City Gate", [
    room("sunken_stairs", "Flooded Descent", 1, 4, "Stone steps descend beneath black tidal water.", { isExit: true }),
    room("sunken_shunt", "Portal Shunt Chamber", 5, 4, "A damaged portal shunt flickers between drowned streets.", { barrier: { state: "locked", requirementType: "item", requirementId: "Tideglass Key", lockName: "Tideglass Control", denial: "The shunt requires a Tideglass Key." } }),
    room("sunken_observatory", "Drowned Observatory", 9, 4, "An air pocket preserves a star map pointing toward another Crown key.", { scavenge: [{ item: "Aurelion Star Map", quantity: 1, check: "int", dc: 14 }] })
  ], [["sunken_stairs", "sunken_shunt"], ["sunken_shunt", "sunken_observatory"]]);

  for (const node of areas) {
    node.blueprintId = node.name;
    if (!blueprints[node.name]) blueprints[node.name] = genericSiteBlueprint(node);
    completeBlueprint(blueprints[node.name]);
    node.locationPackage = {
      nearbyCount: vicinityByArea[node.name].length,
      blueprintId: node.name,
      blueprintRooms: blueprints[node.name].rooms.length
    };
  }

  return {
    version: 2,
    view: "area",
    selectedId: "area_adventure_path",
    world: [{ id: "world_tellara", name: "Tellara", faction: "Contested Kingdoms", theme: "high fantasy intrigue", x: 48, y: 45, links: [], desc: "A continent of rival kingdoms, ancient relics, and dangerous trade routes." }],
    region: [
      { id: "region_heartlands", name: "Tellara Heartlands", faction: "Gallia / Silverhand", theme: "trade roads and royal tension", x: 42, y: 48, links: ["region_silverwood", "region_ironhold"], desc: "The central roads linking Gallia, Argent Port, and Eldwyrd." },
      { id: "region_silverwood", name: "Silverwood Reach", faction: "Silverleaf Council", theme: "ancient living forest", x: 68, y: 35, links: [], desc: "The elven southeast, centered on Sylvanost and the Moonwell." },
      { id: "region_ironhold", name: "Ironhold Mountains", faction: "Kragheim", theme: "mountain passes and deep halls", x: 68, y: 68, links: [], desc: "The harsh northern mountains and dwarven roads." },
      { id: "region_western_realms", name: "Western Realms", faction: "Thalorian / Ossendal / Sun-Sheaf", theme: "coasts, leviathan ivory, and fertile fields", x: 20, y: 68, links: [], desc: "Known lands prepared for later expansion." },
      { id: "region_outer_realms", name: "Outer Realms", faction: "Frostclaw / Karnash / Edrith", theme: "hostile distant kingdoms", x: 20, y: 25, links: [], desc: "Distant campaign regions prepared for later expansion." }
    ],
    area: areas,
    vicinity,
    vicinityByArea,
    blueprints,
    blueprint: blueprints[START],
    barriers: {},
    generated: { scope: "world", mode: "preset", seed: ADVENTURE_PATH_PRESET_ID, counts: { worlds: 1, regions: 5, places: areas.length, roomsPerInterior: 4 }, generatedAt: Date.now() }
  };
}

function makeCard(raw, route) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  const name = String(data?.name || raw?.name || "").trim();
  return {
    id: `story_${slug(name)}`,
    name,
    role: String(data?.role || data?.tags?.[0] || "Story Character"),
    hook: String(data?.first_mes || ""),
    bio: String(data?.description || ""),
    avatar: "",
    traits: String(data?.personality || ""),
    story_hooks: String(data?.scenario || ""),
    rules: String(data?.system_prompt || ""),
    mes_example: String(data?.mes_example || ""),
    sourceAsset: `${ASSET_ROOT}/${route}`
  };
}

export async function loadAdventurePathSourceData(settings = null) {
  const cards = [];
  for (const route of STORY_ASSET_ROUTES.characters) {
    const response = await fetch(`${ASSET_ROOT}/${route}`);
    if (!response.ok) throw new Error(`Missing character card route: ${route}`);
    cards.push(makeCard(await response.json(), route));
  }
  const lorebooks = [];
  for (const route of STORY_ASSET_ROUTES.lorebooks) {
    const response = await fetch(`${ASSET_ROOT}/${route}`);
    if (!response.ok) throw new Error(`Missing lorebook route: ${route}`);
    const raw = await response.json();
    lorebooks.push({ ...raw, sourceAsset: `${ASSET_ROOT}/${route}` });
  }
  if (settings) {
    const existing = new Map((Array.isArray(settings.character_cards) ? settings.character_cards : []).map((card) => [String(card?.name || "").toLowerCase(), card]));
    cards.forEach((card) => existing.set(card.name.toLowerCase(), { ...(existing.get(card.name.toLowerCase()) || {}), ...card }));
    settings.character_cards = Array.from(existing.values());
  }
  return { cards, lorebooks };
}

export function applyAdventurePathPresetState(state, sourceData = {}) {
  const loadout = getAdventurePathClassLoadout(state.character?.class);
  state.presetId = ADVENTURE_PATH_PRESET_ID;
  state.character.mode = "rpg";
  state.character.resourceProfile = loadout.resourceProfile;
  state.character.stats = loadout.stats;
  state.currency = { name: "Gold", symbol: "G", amount: 75, realValue: 0.01 };
  state.inventory = loadout.items;
  state.skills = loadout.skills;
  state.assets = [{ name: "Adventurer's Field Kit", category: "equipment", owned: true, description: "Bedroll, rope, flint, waterskin, and route notes." }];
  state.quests = [{
    id: "quest_tethered_crown",
    title: "The Tethered Crown",
    type: "main",
    status: "active",
    description: "Follow the Silverhand trail, learn why the Crown of Aurelion's keys are moving again, and decide who should be allowed to reunite them.",
    objectives: ["Question Brannik on Adventure'r's Path", "Investigate the abandoned Silverhand tollhouse", "Reach Argent Port", "Learn what Lysander Vaylen is hiding"]
  }, {
    id: "quest_starlight_mushrooms",
    title: "Starlight Emergency",
    type: "side",
    status: "available",
    description: "Gerie needs five Starlight Mushrooms from the Misty Glade.",
    objectives: ["Meet Gerie in Forestside Village", "Collect 5 Starlight Mushrooms", "Return to Gerie's Alchemy Cottage"]
  }];
  state.factions = [];
  state.location = {
    type: "exterior",
    name: START,
    description: "A winding trade road between Gallia, the Forest of Eldwyrd, and Argent Port. A patched merchant tarp waits ahead while old Silverhand wagon ruts cut east.",
    terrain: "plains",
    danger: "moderate",
    npcs: ["Brannik Copperflip, Wandering Merchant"],
    npcDetails: (sourceData.cards || []).filter((card) => card.name === "Brannik Copperflip, Wandering Merchant").map((card) => ({
      id: card.id, cardId: card.id, source: "character_card", name: card.name, className: "Wandering Merchant", description: card.bio, avatar: card.avatar, inParty: false
    })),
    bg: BG
  };
  state.worldScope = {
    type: "world",
    mode: "preset",
    seedName: "Tellara",
    counts: { worlds: 1, regions: 5, settlements: 7, places: 18, roomsPerInterior: 4 },
    description: "Self-contained preset story atlas for Tellara. The central goal is the race for the Crown of Aurelion."
  };
  state.lorebook.entries = (sourceData.lorebooks || []).flatMap((book, bookIndex) => {
    const entries = Array.isArray(book?.entries) ? book.entries : Object.values(book?.entries || {});
    return entries.map((entry, index) => ({ ...entry, uid: `${bookIndex}_${entry?.uid ?? index}` }));
  });
  return state;
}

export function applyAdventurePathClassLoadout(state, className) {
  if (state?.presetId !== ADVENTURE_PATH_PRESET_ID) return state;
  const loadout = getAdventurePathClassLoadout(className);
  state.character.resourceProfile = loadout.resourceProfile;
  state.character.stats = loadout.stats;
  state.inventory = loadout.items;
  state.skills = loadout.skills;
  return state;
}

export function installAdventurePathMap(settings) {
  const map = createAdventurePathMap();
  settings.simpleMap = map;
  settings.storyPreset = {
    id: ADVENTURE_PATH_PRESET_ID,
    name: "Adventure'r's Path",
    goal: "Find the keys of the Crown of Aurelion before Tellara's rival powers do.",
    sourceRoutes: clone(STORY_ASSET_ROUTES)
  };
  settings.worldState = settings.worldState || {};
  settings.worldState.location = START;
  settings.worldState.currentLocation = START;
  settings.worldState.locationDesc = map.area[0].desc;
  settings.worldState.currentCoords = { x: map.area[0].x, y: map.area[0].y, z: 0 };
  settings.worldState.x = map.area[0].x;
  settings.worldState.y = map.area[0].y;
  settings.worldState.background = BG;
  settings.worldState.backgroundUrl = BG;
  settings.worldState.mapNodes = {};
  settings.worldState.navGraph = {};
  settings.worldState.areaScenes = {};
  settings.worldState.rooms = {};

  const allVicinity = Object.values(map.vicinityByArea || {}).flat();
  const allNodes = [...map.area, ...allVicinity];
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  for (const node of allNodes) {
    settings.worldState.mapNodes[node.name] = clone(node);
    settings.worldState.navGraph[node.name] = {};
    settings.worldState.areaScenes[node.name] = { name: node.name, description: node.desc, imagePrompt: node.imagePrompt, imageUrl: node.name === START ? BG : "" };
  }
  for (const node of allNodes) {
    (node.links || []).forEach((targetId, index) => {
      const target = byId.get(targetId);
      if (!target) return;
      const directions = ["north", "east", "south", "west", "forward", "back"];
      settings.worldState.navGraph[node.name][directions[index % directions.length]] = target.name;
    });
    settings.worldState.mapNodes[node.name].exits = { ...settings.worldState.navGraph[node.name] };
  }
  for (const bp of Object.values(map.blueprints)) {
    const roomById = new Map(bp.rooms.map((entry) => [entry.id, entry]));
    for (const entry of bp.rooms) {
      settings.worldState.rooms[entry.name] = { ...clone(entry), blueprintParent: bp.parentName };
      settings.worldState.mapNodes[entry.name] = { ...clone(entry), type: "interior", district: bp.parentName, blueprintParent: bp.parentName, exits: {} };
      settings.worldState.navGraph[entry.name] = {};
    }
    for (const [fromId, toId] of bp.links) {
      const from = roomById.get(fromId);
      const to = roomById.get(toId);
      if (!from || !to) continue;
      settings.worldState.navGraph[from.name][`route_${toId}`] = to.name;
      settings.worldState.navGraph[to.name][`route_${fromId}`] = from.name;
    }
    const exit = bp.rooms.find((entry) => entry.isExit) || bp.rooms[0];
    if (exit) {
      settings.worldState.navGraph[bp.parentName] = settings.worldState.navGraph[bp.parentName] || {};
      settings.worldState.navGraph[bp.parentName].enter = exit.name;
      settings.worldState.navGraph[exit.name].exit = bp.parentName;
    }
    bp.rooms.forEach((entry) => {
      settings.worldState.mapNodes[entry.name].exits = { ...settings.worldState.navGraph[entry.name] };
    });
  }
  settings.map = {
    location: START,
    data: {
      preset: ADVENTURE_PATH_PRESET_ID,
      worlds: map.world.map((entry) => entry.name),
      regions: map.region.map((entry) => entry.name),
      locations: map.area,
      vicinity: map.vicinity,
      vicinityByArea: map.vicinityByArea,
      blueprints: Object.keys(map.blueprints)
    }
  };
  settings.realityEngine = settings.realityEngine || {};
  settings.realityEngine.backgrounds = settings.realityEngine.backgrounds || {};
  settings.realityEngine.backgrounds[START] = BG;
  return map;
}
