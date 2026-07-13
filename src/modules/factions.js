import { getSettings, saveSettings } from "./core.js";
import { injectRpEvent } from "./features/rp_log.js";
import { customConfirm } from "./popups.js";
import { requestOrganizationAssets } from "./backendBridge.js";
import { consumeOrganizationIntel, removePendingIntelById } from "./organizationIntelBus.js";

let selectedId = "";
let selectedLawPlace = "";
let runInObserver = null;
let activeFilter = "all";
let searchQuery = "";
let intelDebounceTimer = null;

const PRESET_ORGANIZATION_NAMES = new Set([
  "merchant conclave of silverhand",
  "kingdom of gallia",
  "silverleaf council",
  "dwarven kingdom of kragheim"
]);

const ORG_TEMPLATES = {
  guild: {
    label: "Guild",
    icon: "fa-hammer",
    description: "Skilled trade or craft association",
    ranks: ["Guildmaster", "Officer", "Journeyman", "Apprentice", "Initiate"],
    rules: ["Pay guild dues on time", "Respect the guild hierarchy", "No poaching members from other guilds"],
    services: ["Crafting facilities", "Trade discounts", "Job board access", "Training"],
    perks: ["Guild hall access", "Reputation bonus", "Equipment loans"],
    obligations: ["Monthly dues", "Guild task participation"],
    entryRequirements: ["Skill demonstration", "Sponsor from existing member"],
    commonIssues: ["Rival guild tension", "Membership disputes", "Resource shortages"],
    suggestedRoles: ["Craftsman", "Trader", "Enforcer", "Scout", "Treasurer"]
  },
  school: {
    label: "School",
    icon: "fa-graduation-cap",
    description: "Educational institution or academy",
    ranks: ["Headmaster", "Professor", "Senior Student", "Student", "Freshman"],
    rules: ["Attend classes", "No fighting on campus", "Respect faculty authority"],
    services: ["Classes", "Library access", "Training grounds", "Mentorship"],
    perks: ["Degree/certification", "Alumni network", "Campus facilities"],
    obligations: ["Tuition/fees", "Attendance requirements", "Exams"],
    entryRequirements: ["Entrance exam or application", "Age requirement"],
    commonIssues: ["Student rivalries", "Budget cuts", "Scandal"],
    suggestedRoles: ["Teacher", "Class Representative", "Club Leader", "Athlete"]
  },
  club: {
    label: "Club",
    icon: "fa-people-group",
    description: "Social or hobby group",
    ranks: ["President", "Vice President", "Officer", "Member"],
    rules: ["Attend meetings", "Respect other members", "Participate in events"],
    services: ["Social events", "Shared resources", "Group activities"],
    perks: ["Community", "Skill sharing", "Networking"],
    obligations: ["Membership dues", "Event participation"],
    entryRequirements: ["Application or invitation"],
    commonIssues: ["Member turnover", "Leadership disputes", "Funding"],
    suggestedRoles: ["Organizer", "Treasurer", "Event Coordinator"]
  },
  government: {
    label: "Government",
    icon: "fa-landmark",
    description: "Official ruling body or administration",
    ranks: ["Head of State", "Minister", "Director", "Officer", "Clerk", "Citizen"],
    rules: ["Obey the law", "Pay taxes", "Respect authority"],
    services: ["Public services", "Legal protection", "Infrastructure", "Defense"],
    perks: ["Legal standing", "Public resources", "Protection"],
    obligations: ["Taxes", "Civic duty", "Legal compliance"],
    entryRequirements: ["Citizenship", "Appointment or election"],
    commonIssues: ["Political opposition", "Budget disputes", "Corruption allegations"],
    suggestedRoles: ["Advisor", "Enforcer", "Diplomat", "Inspector"]
  },
  council: {
    label: "Council",
    icon: "fa-landmark-dome",
    description: "Governing or advisory assembly",
    ranks: ["Chair", "Councilor", "Advisor", "Delegate", "Observer"],
    rules: ["Follow parliamentary procedure", "Respect the chair", "Maintain confidentiality"],
    services: ["Policy decisions", "Dispute resolution", "Advisory"],
    perks: ["Decision-making power", "Access to information", "Influence"],
    obligations: ["Attendance at sessions", "Voting duty"],
    entryRequirements: ["Appointment", "Election", "Invitation"],
    commonIssues: ["Deadlocked votes", "Faction infighting", "Secret agendas"],
    suggestedRoles: ["Secretary", "Enforcer", "Liaison", "Scribe"]
  },
  crew: {
    label: "Crew",
    icon: "fa-ship",
    description: "Ship, vehicle, or operational team",
    ranks: ["Captain", "First Mate", "Specialist", "Crew", "Deckhand"],
    rules: ["Follow the captain's orders", "Watch rotation", "Share the haul"],
    services: ["Transport", "Protection", "Specialized operations"],
    perks: ["Share of profits", "Loyalty network", "Skills training"],
    obligations: ["Duty assignments", "Risk sharing"],
    entryRequirements: ["Proven skill", "Captain's approval"],
    commonIssues: ["Mutiny risk", "Supply shortages", "Rival crews"],
    suggestedRoles: ["Navigator", "Lookout", "Engineer", "Medic"]
  },
  gang: {
    label: "Gang",
    icon: "fa-skull-crossbones",
    description: "Criminal or street organization",
    ranks: ["Boss", "Underboss", "Captain", "Soldier", "Associate"],
    rules: ["Omerta / no snitching", "Respect the chain", "Territory rules"],
    services: ["Protection", "Black market", "Enforcement", "Intelligence"],
    perks: ["Territory control", "Street reputation", "Quick money"],
    obligations: ["Cut of earnings", "Enforcement duty", "Loyalty"],
    entryRequirements: ["Sponsor", "Prove yourself", "Initiation"],
    commonIssues: ["Rival gang war", "Police heat", "Internal betrayal"],
    suggestedRoles: ["Enforcer", "Runner", "Lookout", "Broker"]
  },
  company: {
    label: "Company",
    icon: "fa-building",
    description: "Business or corporate entity",
    ranks: ["CEO", "Director", "Manager", "Employee", "Intern"],
    rules: ["Company policy", "Professional conduct", "NDA compliance"],
    services: ["Products", "Services", "Employment", "Benefits"],
    perks: ["Salary", "Benefits", "Career advancement", "Resources"],
    obligations: ["Work hours", "Performance targets", "Confidentiality"],
    entryRequirements: ["Application", "Interview", "Qualifications"],
    commonIssues: ["Market competition", "Internal politics", "Budget cuts"],
    suggestedRoles: ["Analyst", "Sales", "Engineer", "HR", "Security"]
  },
  agency: {
    label: "Agency",
    icon: "fa-user-secret",
    description: "Intelligence, spy, or special operations",
    ranks: ["Director", "Handler", "Agent", "Operative", "Asset"],
    rules: ["Classified information only", "Chain of command", "Deniability"],
    services: ["Intelligence", "Covert operations", "Extraction", "Analysis"],
    perks: ["Clearance", "Resources", "Training", "Network"],
    obligations: ["Missions", "Secrecy", "Availability"],
    entryRequirements: ["Recruitment", "Background check", "Skills assessment"],
    commonIssues: ["Compromised agents", "Mission failure", "Double agents"],
    suggestedRoles: ["Field Agent", "Analyst", "Tech Specialist", "Courier"]
  },
  cult: {
    label: "Cult",
    icon: "fa-eye",
    description: "Secretive religious or ideological group",
    ranks: ["Prophet/Leader", "Inner Circle", "Acolyte", "Initiate", "Seeker"],
    rules: ["Devotion to the cause", "Secrecy", "Obedience to leadership"],
    services: ["Rituals", "Teachings", "Community", "Protection"],
    perks: ["Purpose", "Belonging", "Secret knowledge", "Power"],
    obligations: ["Tithes/offerings", "Recruitment", "Rituals"],
    entryRequirements: ["Invitation", "Prove devotion", "Sacrifice"],
    commonIssues: ["Schisms", "Outside persecution", "Leader disputes"],
    suggestedRoles: ["Preacher", "Guardian", "Scribe", "Recruiter"]
  },
  order: {
    label: "Order",
    icon: "fa-shield-halved",
    description: "Knightly, monastic, or martial order",
    ranks: ["Grand Master", "Knight Commander", "Knight", "Squire", "Postulant"],
    rules: ["Code of honor", "Obedience to superiors", "Protect the weak"],
    services: ["Protection", "Training", "Sanctuary", "Judgment"],
    perks: ["Honor", "Combat training", "Equipment", "Network"],
    obligations: ["Missions", "Training", "Obedience"],
    entryRequirements: ["Noble birth or proven valor", "Sponsorship"],
    commonIssues: ["Code violations", "Rival orders", "Political pressure"],
    suggestedRoles: ["Champion", "Healer", "Scout", "Chaplain"]
  },
  family: {
    label: "Family",
    icon: "fa-house-chimney",
    description: "Blood relatives or chosen family unit",
    ranks: ["Patriarch/Matriarch", "Elder", "Adult", "Youth", "Child"],
    rules: ["Family loyalty", "Respect elders", "Protect each other"],
    services: ["Support", "Housing", "Resources", "Connections"],
    perks: ["Belonging", "Inheritance", "Unconditional support"],
    obligations: ["Family duty", "Loyalty", "Care for elders"],
    entryRequirements: ["Birth", "Marriage", "Adoption"],
    commonIssues: ["Inheritance disputes", "Feuds", "Secrets"],
    suggestedRoles: ["Heir", "Advisor", "Protector", "Mediator"]
  },
  team: {
    label: "Team",
    icon: "fa-people-arrows",
    description: "Sports, competition, or project team",
    ranks: ["Captain", "Vice Captain", "Starter", "Reserve", "Rookie"],
    rules: ["Team first", "Follow the coach", "Practice attendance"],
    services: ["Training", "Competition", "Coaching", "Facilities"],
    perks: ["Team identity", "Competition", "Skills", "Camaraderie"],
    obligations: ["Practice", "Games/matches", "Team events"],
    entryRequirements: ["Tryouts", "Skill assessment", "Coach approval"],
    commonIssues: ["Injuries", "Team conflicts", "Performance pressure"],
    suggestedRoles: ["Strategist", "Support", "Scorer", "Defender"]
  },
  custom: {
    label: "Custom",
    icon: "fa-pen-ruler",
    description: "Define your own organization type",
    ranks: ["Leader", "Officer", "Member"],
    rules: [],
    services: [],
    perks: [],
    obligations: [],
    entryRequirements: [],
    commonIssues: [],
    suggestedRoles: []
  }
};

const ORG_CATEGORY_KEYWORDS = {
  guild: /\bguild\b|\btrade\b|\bcraft\b|\bartisan\b|\bblacksmith\b/i,
  school: /\bschool\b|\bacademy\b|\buniversity\b|\bcollege\b|\binstitute\b|\bacadem/i,
  club: /\bclub\b|\bsociety\b|\bgroup\b|\bcircle\b|\bsorority\b|\bfraternity\b/i,
  government: /\bgovernment\b|\bministry\b|\bsenate\b|\bparliament\b|\bcrown\b|\bstate\b|\bempire\b/i,
  council: /\bcouncil\b|\bassembly\b|\bcongress\b|\bcommittee\b|\bboard\b/i,
  crew: /\bcrew\b|\bship\b|\bvessel\b|\bsquad\b|\bunit\b|\bteam\b/i,
  gang: /\bgang\b|\bmafia\b|\bsyndicate\b|\bcartel\b|\bmob\b|\bhood\b/i,
  company: /\bcompany\b|\bcorp\b|\binc\b|\bltd\b|\bfirm\b|\bbusiness\b|\benterprise\b|\bcorp/i,
  agency: /\bagency\b|\bbureau\b|\boffice\b|\bdivision\b|\bdepartment\b|\bintelligence\b|\bspy\b/i,
  cult: /\bcult\b|\btemple\b|\bchurch\b|\bsect\b|\bbrotherhood\b|\bsisterhood\b|\bfaith\b/i,
  order: /\border\b|\bknight\b|\bpaladin\b|\btemplar\b|\bmonk\b|\bmonastery\b/i,
  family: /\bfamily\b|\bhouse\b|\bclan\b|\bdynasty\b|\blineage\b|\btribe\b/i,
  team: /\bteam\b|\bsquad\b|\bparty\b|\bsports\b|\bleague\b/i
};

function id(prefix = "org") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x?.name || x?.text || x || "").trim()).filter(Boolean);
  return String(value || "").split(/\n|,/).map((x) => x.trim()).filter(Boolean);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function organizationSlug(value, fallback = "organization") {
  const out = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72);
  return out || fallback;
}

function markAutoChanged(data) {
  try { Object.defineProperty(data, "__uieOrgAutoChanged", { value: true, configurable: true }); } catch (_) { data.__uieOrgAutoChanged = true; }
}

function organizationAutoChanged(data) { return data?.__uieOrgAutoChanged === true; }

function clampNum(value, min, max) { return Math.max(min, Math.min(max, Number(value || 0))); }
function clampStanding(value) { return clampNum(value, 0, 100); }
function clampHeat(value) { return clampNum(value, 0, 100); }
function clampTrust(value) { return clampNum(value, 0, 100); }
function clampFear(value) { return clampNum(value, 0, 100); }

function standingLabel(value) {
  const n = Number(value || 0);
  if (n >= 85) return "Ally";
  if (n >= 65) return "Friendly";
  if (n >= 35) return "Neutral";
  if (n >= 15) return "Hostile";
  return "Enemy";
}

function glowForStanding(value) {
  const n = Number(value || 0);
  if (n >= 65) return "rgba(113,224,189,.28)";
  if (n <= 25) return "rgba(255,122,144,.28)";
  return "rgba(242,212,125,.23)";
}

function organizationCategory(org) {
  const cat = String(org?.category || "").trim().toLowerCase();
  if (cat && ORG_TEMPLATES[cat]) return cat;
  const type = String(org?.type || "").trim().toLowerCase();
  for (const [key, pattern] of Object.entries(ORG_CATEGORY_KEYWORDS)) {
    if (pattern.test(type)) return key;
  }
  const name = String(org?.name || "").toLowerCase();
  for (const [key, pattern] of Object.entries(ORG_CATEGORY_KEYWORDS)) {
    if (pattern.test(name)) return key;
  }
  return "custom";
}

function organizationIcon(org) {
  const cat = organizationCategory(org);
  return ORG_TEMPLATES[cat]?.icon || "fa-network-wired";
}

function organizationHeatLabel(org) {
  const heat = Number(org?.heat || 0);
  if (heat >= 75) return "Critical";
  if (heat >= 50) return "High";
  if (heat >= 25) return "Elevated";
  if (heat > 0) return "Low";
  return "Clear";
}

function organizationMembershipLabel(org) {
  const status = String(org?.membershipStatus || "").trim().toLowerCase();
  if (!status || status === "none" || status === "stranger") return "Outsider";
  if (status === "member") return "Member";
  if (status === "ally") return "Ally";
  if (status === "leader") return "Leader";
  if (status === "associate") return "Associate";
  if (status === "enemy" || status === "outcast") return "Enemy";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function organizationPrimaryHook(org) {
  const hooks = Array.isArray(org?.activeHooks) ? org.activeHooks : [];
  if (hooks.length) return hooks[0];
  const issues = Array.isArray(org?.currentIssues) ? org.currentIssues : [];
  if (issues.length) return issues[0];
  const rumors = Array.isArray(org?.rumors) ? org.rumors : [];
  if (rumors.length) return rumors[0];
  return "";
}

function organizationAccessSummary(org) {
  const perks = Array.isArray(org?.perks) ? org.perks : [];
  const services = Array.isArray(org?.services) ? org.services : [];
  const items = [...perks, ...services].slice(0, 5);
  if (items.length) return items.join(", ");
  const access = String(org?.accessLevel || "").trim();
  return access || "No known access";
}

function organizationThreatSummary(org) {
  const heat = Number(org?.heat || 0);
  const standing = Number(org?.standing || 50);
  if (heat >= 50) return `High heat (${heat}) - active danger`;
  if (standing <= 15) return `Hostile (standing ${standing}) - threat level high`;
  if (standing <= 35) return `Unfriendly (standing ${standing}) - watch yourself`;
  const obligations = Array.isArray(org?.obligations) ? org.obligations : [];
  if (obligations.length) return `Obligations: ${obligations.slice(0, 3).join(", ")}`;
  return "Low immediate threat";
}

function organizationPowerSummary(org) {
  const spaces = Array.isArray(org?.controlledSpaces) ? org.controlledSpaces : [];
  const base = String(org?.base || "").trim();
  const locations = base ? [base, ...spaces.filter((s) => s !== base)] : spaces;
  if (locations.length) return `Controls: ${locations.slice(0, 4).join(", ")}`;
  return "No known territory";
}

function normalizeAssetRef(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      id: String(raw.id || raw.assetId || raw.name || id("asset")).trim(),
      name: String(raw.name || raw.title || "Unnamed Asset").trim(),
      category: String(raw.category || raw.type || "").trim(),
      description: String(raw.description || raw.desc || "").trim(),
      prompt: String(raw.prompt || raw.imagePrompt || "").trim(),
      source: String(raw.source || "").trim(),
      generatedAt: Number(raw.generatedAt || 0) || 0,
      memberCount: Number(raw.memberCount || 0) || 0
    };
  }
  const name = String(raw || "").trim();
  return name ? { id: name, name, category: "", description: "", prompt: "", source: "", generatedAt: 0, memberCount: 0 } : null;
}

function normalizeNodeType(node = {}, view = "") {
  const type = String(node?.type || view || "place").trim().toLowerCase();
  if (view === "world") return "world";
  if (view === "region") return "region";
  if (/(city|town|village|settlement|district|campus|area|local)/i.test(type)) return "settlement";
  if (/(room|interior|bedroom|office|classroom|shop|house|home|building|blueprint)/i.test(type)) return "building";
  return type || "place";
}

function normalizeMember(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      id: String(raw.id || id("mem")).trim(),
      name: String(raw.name || raw.label || "Unnamed Member").trim(),
      rank: String(raw.rank || raw.hierarchy || raw.status || "").trim(),
      role: String(raw.role || raw.job || "").trim(),
      authority: String(raw.authority ?? raw.level ?? "").trim(),
      location: String(raw.location || raw.place || "").trim(),
      notes: String(raw.notes || raw.description || "").trim(),
      sourceId: String(raw.sourceId || raw.personId || "").trim(),
      sourceType: String(raw.sourceType || raw.source || "").trim(),
      count: Math.max(1, Math.floor(Number(raw.count || raw.qty || 1) || 1))
    };
  }
  return { id: id("mem"), name: String(raw || "Unnamed Member").trim(), rank: "", role: "", authority: "", location: "", notes: "", sourceId: "", sourceType: "", count: 1 };
}

function memberRankMatches(member, pattern) {
  const hay = `${member?.rank || ""} ${member?.role || ""} ${member?.notes || ""}`.toLowerCase();
  return pattern.test(hay);
}

function organizationLeader(org) {
  if (String(org?.leader || "").trim()) return String(org.leader).trim();
  const found = (org?.members || []).map(normalizeMember).find((m) => memberRankMatches(m, /\b(leader|boss|captain|chief|chair|founder|king|queen|director|president|commander)\b/));
  return found?.name || "Unknown/Hidden";
}

function organizationLeaderTitle(org) { return String(org?.leaderTitle || org?.leaderRank || org?.leaderRole || "").trim(); }

function organizationSubLeaders(org) {
  const explicit = normalizeTextList(org?.subLeaders);
  if (explicit.length) return explicit;
  return (org?.members || []).map(normalizeMember)
    .filter((m) => memberRankMatches(m, /\b(sub|deputy|officer|lieutenant|commander|captain|manager|second|director|lead)\b/))
    .map((m) => m.name).slice(0, 8);
}

function mappedPlaces() {
  const s = getSettings();
  const map = s.simpleMap && typeof s.simpleMap === "object" ? s.simpleMap : {};
  const out = [];
  const seen = new Set();
  const worldById = new Map();
  const regionById = new Map();
  (Array.isArray(map.world) ? map.world : []).forEach((node) => { if (node?.id) worldById.set(String(node.id), String(node.name || node.id).trim()); });
  (Array.isArray(map.region) ? map.region : []).forEach((node) => { if (node?.id) regionById.set(String(node.id), node); });
  const worldNameFor = (node, view = "") => {
    const direct = String(node?.worldName || "").trim();
    if (direct) return direct;
    const wid = String(node?.worldId || "").trim();
    if (wid && worldById.has(wid)) return worldById.get(wid);
    const rid = String(node?.regionId || "").trim();
    const region = rid ? regionById.get(rid) : null;
    const regionWorld = String(region?.worldId || "").trim();
    if (regionWorld && worldById.has(regionWorld)) return worldById.get(regionWorld);
    if (view === "world" && node?.name) return String(node.name).trim();
    return String((Array.isArray(map.world) ? map.world : [])[0]?.name || "Current World").trim() || "Current World";
  };
  const push = (view, node) => {
    if (!node?.name) return;
    const name = String(node.name).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    const worldName = worldNameFor(node, view);
    out.push({ id: String(node.id || `${view}_${name}`).trim(), name, view, type: normalizeNodeType(node, view), theme: String(node.theme || node.faction || "").trim(), worldName, groupLabel: worldName || view || "Current World" });
  };
  ["world", "region", "area", "vicinity"].forEach((view) => (Array.isArray(map[view]) ? map[view] : []).forEach((node) => push(view, node)));
  const blueprints = map.blueprints && typeof map.blueprints === "object" ? map.blueprints : {};
  Object.values(blueprints).forEach((bp) => (Array.isArray(bp?.rooms) ? bp.rooms : []).forEach((room) => push("blueprint", { ...room, worldId: room.worldId || bp?.worldId || "", regionId: room.regionId || bp?.regionId || "", type: room.type || "room" })));
  const nodes = s.worldState?.mapNodes && typeof s.worldState.mapNodes === "object" ? s.worldState.mapNodes : {};
  Object.values(nodes).forEach((node) => push("story", node));
  if (!out.length) push("area", { name: s.worldState?.location || s.map?.location || "Current Location", type: "place", theme: "Current" });
  return out.slice(0, 120);
}

function collectPeopleOptions() {
  const s = getSettings();
  const out = [];
  const seen = new Set();
  const push = (name, sourceType, sourceId = "") => {
    const label = String(name || "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push({ name: label, sourceType, sourceId: String(sourceId || "").trim() });
  };
  push("Unknown/Hidden", "system", "unknown");
  push(s.character?.name || getContextName() || "User", "user", "user");
  (Array.isArray(s.character_cards) ? s.character_cards : []).forEach((card) => push(card?.name, "character_card", card?.id));
  const social = s.social && typeof s.social === "object" ? s.social : {};
  ["friends", "associates", "romance", "family", "rivals"].forEach((tab) => { (Array.isArray(social[tab]) ? social[tab] : []).forEach((p) => push(p?.name, "npc", p?.id || p?.name)); });
  const activeNpcs = s.genericNpcs?.active && typeof s.genericNpcs.active === "object" ? s.genericNpcs.active : {};
  Object.entries(activeNpcs).forEach(([npcId, npc]) => push(npc?.name || npc?.archetype, "npc", npcId));
  return out;
}

function currentUserMemberName(s = getSettings()) { return String(s.character?.name || getContextName() || "User").trim() || "User"; }

function isUserInOrganization(org, s = getSettings()) {
  const userName = normalizeKey(currentUserMemberName(s));
  const memberHit = (Array.isArray(org?.members) ? org.members : []).map(normalizeMember)
    .some((m) => normalizeKey(m.name) === userName || String(m.sourceType || "") === "user");
  return memberHit || !/^(?:none|stranger|enemy|outcast|unaffiliated)?$/i.test(String(org?.membershipStatus || "").trim());
}

function affiliationNamesFrom(person = {}) {
  const names = [
    ...normalizeTextList(person.organizationAffiliations),
    ...normalizeTextList(person.affiliations),
    ...normalizeTextList(person.organizations),
    ...normalizeTextList(person.factions),
    ...normalizeTextList(person.faction),
    ...normalizeTextList(person.organization),
    ...normalizeTextList(person.org)
  ];
  const blocked = /^(?:none|no organization|unaffiliated|independent|unknown|hidden|n\/a|na|-|user)$/i;
  return Array.from(new Set(names.map((name) => String(name || "").trim()).filter((name) => name && name.length >= 3 && !blocked.test(name))));
}

function collectAffiliatedPeople(s = getSettings()) {
  const out = [];
  const seen = new Set();
  const pushPerson = (person, sourceType, sourceId = "") => {
    const name = String(person?.name || person?.char_name || person?.label || "").trim();
    if (!name) return;
    const affiliations = affiliationNamesFrom(person);
    if (!affiliations.length) return;
    const key = `${sourceType}:${sourceId || name}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, sourceType, sourceId: String(sourceId || person?.id || person?.cardId || name).trim(), role: String(person?.role || person?.title || person?.job || "member").trim(), rank: String(person?.rank || person?.status || "").trim(), location: String(person?.currentLocation || person?.location || person?.place || "").trim(), affiliations });
  };
  (Array.isArray(s.character_cards) ? s.character_cards : []).forEach((card) => pushPerson(card, "character_card", card?.id));
  (Array.isArray(s.npcs) ? s.npcs : []).forEach((npc) => pushPerson(npc, "npc", npc?.id || npc?.cardId || npc?.name));
  const social = s.social && typeof s.social === "object" ? s.social : {};
  ["friends", "associates", "romance", "family", "rivals"].forEach((tab) => { (Array.isArray(social[tab]) ? social[tab] : []).forEach((person) => pushPerson(person, "social", person?.id || person?.cardId || person?.name)); });
  const activeNpcs = s.genericNpcs?.active && typeof s.genericNpcs.active === "object" ? s.genericNpcs.active : {};
  Object.entries(activeNpcs).forEach(([npcId, npc]) => pushPerson(npc, "generic_npc", npcId));
  return out;
}

function defaultOrganizationAssets(org = {}) {
  const slug = organizationSlug(org.name);
  const base = String(org.base || org.controlledSpaces?.[0] || "unmapped influence").trim();
  return [{
    id: `org_asset_${slug}_registry`,
    name: `${String(org.name || "Organization").trim()} Field Kit`,
    category: "organization",
    description: `Auto-generated organization asset for ${org.name || "this organization"}: credentials, contact routes, operating notes, and access hooks tied to ${base}.`,
    source: "organization_auto_asset",
    prompt: `Create a clean organization asset image for ${org.name || "an organization"} in ${base}. Show practical modern dossier materials, a neutral emblem, access cards, and location notes. No text or watermark.`
  }];
}

function ensureOrganizationAssets(org) {
  if (!org || typeof org !== "object") return false;
  const current = Array.isArray(org.assets) ? org.assets.map(normalizeAssetRef).filter(Boolean) : [];
  if (current.length) { org.assets = current; return false; }
  org.assets = defaultOrganizationAssets(org);
  return true;
}

function syncOrganizationsFromPeople(s, data) {
  if (!data || !Array.isArray(data.list)) return false;
  let changed = false;
  const byName = new Map(data.list.map((org) => [normalizeKey(org.name), org]));
  const firstPlace = mappedPlaces()[0];
  for (const person of collectAffiliatedPeople(s)) {
    for (const affiliation of person.affiliations) {
      const key = normalizeKey(affiliation);
      if (!key) continue;
      let org = byName.get(key);
      if (!org) {
        org = {
          id: `auto_org_${organizationSlug(affiliation)}_${Date.now().toString(36)}`,
          name: affiliation,
          type: "organization",
          category: inferOrganizationCategory(affiliation, ""),
          standing: 50,
          membershipStatus: "",
          accessLevel: "",
          heat: 0,
          trust: 50,
          fear: 0,
          resources: 0,
          services: [],
          perks: [],
          obligations: [],
          entryRequirements: [],
          rivals: [],
          allies: [],
          secrets: [],
          rumors: [],
          currentIssues: [],
          activeHooks: [],
          publicFace: "",
          privateTruth: "",
          uniformStyle: "",
          scope: "local",
          influence: "local",
          base: person.location || firstPlace?.name || "",
          baseType: firstPlace?.type || "place",
          controlledSpaces: person.location ? [person.location] : (firstPlace?.name ? [firstPlace.name] : []),
          assets: defaultOrganizationAssets({ name: affiliation, base: person.location || firstPlace?.name || "" }),
          ranks: ORG_TEMPLATES[inferOrganizationCategory(affiliation, "")]?.ranks?.slice(0, 3) || [],
          members: [],
          leader: "Unknown/Hidden",
          leaderTitle: "",
          subLeaders: [],
          runIns: [],
          majorEvents: [],
          notes: "Auto-generated from character, NPC, lore, or chat-derived affiliation data.",
          npcTemplate: "",
          sourceRefs: [{ source: "affiliations", person: person.name, timestamp: Date.now() }],
          confidence: 0.6,
          generatedFrom: "affiliations",
          lastSeenAt: Date.now(),
          updatedAt: Date.now()
        };
        data.list.push(org);
        byName.set(key, org);
        changed = true;
      }
      if (!Array.isArray(org.members)) org.members = [];
      const memberKey = normalizeKey(person.name);
      if (memberKey && !org.members.some((m) => normalizeKey(normalizeMember(m).name) === memberKey)) {
        org.members.push(normalizeMember({ name: person.name, rank: person.rank || "Member", role: person.role || "member", location: person.location || org.base, sourceType: person.sourceType, sourceId: person.sourceId }));
        changed = true;
      }
      if (!org.base && person.location) {
        org.base = person.location;
        org.controlledSpaces = Array.from(new Set([...(org.controlledSpaces || []), person.location]));
        changed = true;
      }
    }
  }
  for (const org of data.list) { if (ensureOrganizationAssets(org)) changed = true; }
  return changed;
}

async function enrichOrganizationAssets(org, { force = false } = {}) {
  if (!org || typeof org !== "object") return false;
  if (org.backendAssetsRequested && !force) return false;
  org.backendAssetsRequested = Date.now();
  try {
    const data = await requestOrganizationAssets({
      organization: { id: org.id, name: org.name, type: org.type, base: org.base, baseType: org.baseType, influence: org.influence || org.scope, controlledSpaces: org.controlledSpaces || [], members: (org.members || []).map(normalizeMember), notes: org.notes || "" }
    }, { required: false, timeoutMs: 1600 });
    const assets = Array.isArray(data?.assets) ? data.assets.map(normalizeAssetRef).filter(Boolean) : [];
    if (!assets.length) return false;
    org.assets = assets;
    org.updatedAt = Date.now();
    saveSettings();
    renderOrganizations();
    if ($("#uie-organization-dossier").attr("aria-hidden") === "false") renderDossier();
    return true;
  } catch (_) { return false; }
}

function getContextName() {
  try { return String(window?.name1 || window?.UIE?.characterName || "").trim(); } catch (_) { return ""; }
}

function collectInventoryAssets() {
  const s = getSettings();
  const assets = Array.isArray(s.inventory?.assets) ? s.inventory.assets : [];
  const out = [];
  const seen = new Set();
  assets.forEach((asset, index) => {
    const ref = normalizeAssetRef({ ...asset, id: asset?.id || asset?.assetId || `inventory_asset_${index}` });
    if (!ref?.name) return;
    const key = String(ref.name).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  });
  return out;
}

function collectRankOptions(org) {
  const ranks = normalizeTextList(org?.ranks);
  (org?.members || []).map(normalizeMember).forEach((m) => { if (m.rank) ranks.push(m.rank); });
  if (organizationLeaderTitle(org)) ranks.unshift(organizationLeaderTitle(org));
  return Array.from(new Set(ranks.map((r) => String(r || "").trim()).filter(Boolean)));
}

function getMapNodeByName(name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  const s = getSettings();
  const map = s.simpleMap && typeof s.simpleMap === "object" ? s.simpleMap : {};
  for (const view of ["world", "region", "area", "vicinity"]) {
    for (const node of Array.isArray(map[view]) ? map[view] : []) {
      if (String(node?.name || "").trim().toLowerCase() === target) return { node, view };
    }
  }
  const blueprints = map.blueprints && typeof map.blueprints === "object" ? map.blueprints : {};
  for (const bp of Object.values(blueprints)) {
    for (const room of Array.isArray(bp?.rooms) ? bp.rooms : []) {
      if (String(room?.name || "").trim().toLowerCase() === target) return { node: room, view: "blueprint" };
    }
  }
  const nodes = s.worldState?.mapNodes && typeof s.worldState.mapNodes === "object" ? s.worldState.mapNodes : {};
  for (const node of Object.values(nodes)) {
    if (String(node?.name || "").trim().toLowerCase() === target) return { node, view: "story" };
  }
  return null;
}

function mapLayerForPlace(place = "", type = "", influence = "") {
  const raw = `${place} ${type} ${influence}`.toLowerCase();
  if (/\b(world|planet|realm|plane|continent)\b/.test(raw)) return "world";
  if (/\b(region|province|kingdom|state|territory|county)\b/.test(raw)) return "region";
  if (/\b(room|office|hall|shop|apartment|house|building|floor|nearby|vicinity|safehouse|base)\b/.test(raw)) return "vicinity";
  return "area";
}

function mapTypeForPlace(place = "", type = "") {
  const raw = `${place} ${type}`.toLowerCase();
  if (/\b(world|planet|realm|plane)\b/.test(raw)) return "world";
  if (/\b(region|province|kingdom|state|territory)\b/.test(raw)) return "region";
  if (/\b(city|town|village|district|harbor|campus|market)\b/.test(raw)) return "city";
  if (/\b(room|office|hall|shop|apartment|house|building|tower|base|safehouse)\b/.test(raw)) return "building";
  return String(type || "place").trim() || "place";
}

async function offerAddPlaceToMap(place, org, options = {}) {
  const name = String(place || "").trim();
  if (!name || getMapNodeByName(name)) return false;
  const yes = await customConfirm(`${name} is not on the map yet. Add it now so organization influence, assets, NPCs, and route connections have a real place?`);
  if (!yes) return false;
  const leaders = [organizationLeader(org), ...organizationSubLeaders(org)].filter(Boolean);
  try {
    const map = await import("./map.js");
    await map.openAddLocationModal?.({
      name,
      layer: mapLayerForPlace(name, options.type || org?.baseType, org?.influence || org?.scope),
      type: mapTypeForPlace(name, options.type || org?.baseType),
      faction: org?.name || "",
      influence: org?.influence || org?.scope || "",
      assets: org?.assets || [],
      npcs: [...leaders, ...(org?.members || []).map((m) => normalizeMember(m).name)].filter(Boolean).slice(0, 24),
      desc: `${name} is tied to ${org?.name || "this organization"}. Place it where it belongs on the atlas, connect it to nearby routes, and add any assets or NPCs that should operate there.`
    });
    closeDossier();
    $("#uie-factions-window").hide();
    return true;
  } catch (err) {
    console.warn("[UIE Organizations] Could not open map location modal", err);
    try { window.toastr?.error?.("Could not open map add-location popup."); } catch (_) {}
    return false;
  }
}

function ensureGovernorRulesModel(s) {
  if (!s.governorRules || typeof s.governorRules !== "object") s.governorRules = { worldRules: [], regionalRules: {}, localRules: {}, heatLevel: 0 };
  if (!Array.isArray(s.governorRules.worldRules)) s.governorRules.worldRules = [];
  if (!s.governorRules.regionalRules || typeof s.governorRules.regionalRules !== "object") s.governorRules.regionalRules = {};
  if (!s.governorRules.localRules || typeof s.governorRules.localRules !== "object") s.governorRules.localRules = {};
  return s.governorRules;
}

function syncPlaceLawToGovernor(s, placeName, law) {
  const gov = ensureGovernorRulesModel(s);
  const key = String(placeName || "current").trim() || "current";
  const rule = { id: law.id, target: law.text, description: law.text, severity: 5, exceptions: [], scope: law.scope, timestamp: Date.now() };
  if (law.scope === "world") gov.worldRules.push(rule);
  else if (law.scope === "region") { if (!gov.regionalRules[key]) gov.regionalRules[key] = []; gov.regionalRules[key].push(rule); }
  else { if (!gov.localRules[key]) gov.localRules[key] = []; gov.localRules[key].push(rule); }
}

function ensureAutoDiscovery(s) {
  if (!s.factions) s.factions = {};
  if (!s.factions.autoDiscovery || typeof s.factions.autoDiscovery !== "object") {
    s.factions.autoDiscovery = {
      enabled: true,
      mode: "review",
      minConfidenceToAutoAdd: 0.78,
      minConfidenceToAutoUpdate: 0.65,
      useSecondaryGenerationApi: true,
      secondaryApiMinConfidence: 0.45,
      sources: { chat: true, lorebook: true, characterCards: true, map: true }
    };
  }
  if (!Array.isArray(s.factions.pendingIntel)) s.factions.pendingIntel = [];
  return s.factions.autoDiscovery;
}

export function normalizeFactions(s = getSettings()) {
  if (Array.isArray(s.factions)) {
    s.factions = {
      list: s.factions.map((f, index) => ({ ...f, id: f?.id || `legacy_group_${index + 1}`, standing: Number(f?.standing ?? f?.reputation ?? 0), type: f?.type || "group" })),
      laws: []
    };
  }
  if (!s.factions || typeof s.factions !== "object") s.factions = {};
  if (!Array.isArray(s.factions.list)) s.factions.list = [];
  if (!Array.isArray(s.factions.laws)) s.factions.laws = [];
  ensureAutoDiscovery(s);
  s.factions.list = s.factions.list.filter((f) => {
    const name = String(f?.name || "").trim().toLowerCase();
    return !PRESET_ORGANIZATION_NAMES.has(name);
  }).map((f) => ({
    id: String(f?.id || id()).trim(),
    name: String(f?.name || "Unnamed Organization").trim(),
    type: String(f?.type || "organization").trim(),
    category: String(f?.category || inferOrganizationCategory(f?.name, f?.type)).trim(),
    standing: clampStanding(f?.standing ?? f?.reputation ?? 0),
    membershipStatus: String(f?.membershipStatus || f?.status || "").trim(),
    accessLevel: String(f?.accessLevel || "").trim(),
    heat: clampHeat(f?.heat || 0),
    trust: clampTrust(f?.trust ?? 50),
    fear: clampFear(f?.fear || 0),
    resources: Number(f?.resources || 0),
    services: normalizeTextList(f?.services),
    perks: normalizeTextList(f?.perks),
    obligations: normalizeTextList(f?.obligations),
    entryRequirements: normalizeTextList(f?.entryRequirements),
    rivals: normalizeTextList(f?.rivals),
    allies: normalizeTextList(f?.allies),
    secrets: normalizeTextList(f?.secrets),
    rumors: normalizeTextList(f?.rumors),
    currentIssues: normalizeTextList(f?.currentIssues),
    activeHooks: normalizeTextList(f?.activeHooks),
    publicFace: String(f?.publicFace || "").trim(),
    privateTruth: String(f?.privateTruth || "").trim(),
    uniformStyle: String(f?.uniformStyle || "").trim(),
    aliases: normalizeTextList(f?.aliases),
    sourceRefs: Array.isArray(f?.sourceRefs) ? f.sourceRefs : [],
    confidence: Number(f?.confidence || 0),
    generatedFrom: String(f?.generatedFrom || "").trim(),
    lastSeenAt: Number(f?.lastSeenAt || f?.updatedAt || Date.now()),
    scope: String(f?.scope || "local").trim(),
    influence: String(f?.influence || f?.influenceRange || f?.reach || f?.scope || "local").trim(),
    base: String(f?.base || f?.headquarters || "").trim(),
    baseType: String(f?.baseType || "").trim(),
    controlledSpaces: normalizeTextList(f?.controlledSpaces),
    ranks: normalizeTextList(f?.ranks || f?.rankOptions),
    assets: Array.isArray(f?.assets) ? f.assets.map(normalizeAssetRef).filter(Boolean) : normalizeTextList(f?.assets).map(normalizeAssetRef).filter(Boolean),
    members: Array.isArray(f?.members) ? f.members.map(normalizeMember).filter((m) => m.name) : normalizeTextList(f?.members).map(normalizeMember).filter((m) => m.name),
    leader: String(f?.leader || f?.head || "").trim(),
    leaderTitle: String(f?.leaderTitle || f?.leaderRank || f?.leaderRole || "").trim(),
    subLeaders: normalizeTextList(f?.subLeaders || f?.subleaders || f?.officers || f?.lieutenants),
    runIns: normalizeTextList(f?.runIns || f?.runins || f?.encounters),
    majorEvents: normalizeTextList(f?.majorEvents || f?.events || f?.history),
    notes: String(f?.notes || "").trim(),
    npcTemplate: String(f?.npcTemplate || f?.template || "").trim(),
    updatedAt: Number(f?.updatedAt || Date.now())
  }));
  s.factions.laws = s.factions.laws.map((law) => ({
    id: String(law?.id || id("law")).trim(),
    scope: String(law?.scope || "local").trim(),
    place: String(law?.place || law?.location || "").trim(),
    factionId: String(law?.factionId || "").trim(),
    text: String(law?.text || "").trim()
  })).filter((law) => law.text);
  if (syncOrganizationsFromPeople(s, s.factions)) markAutoChanged(s.factions);
  return s.factions;
}

function currentOrganization() {
  const s = getSettings();
  const data = normalizeFactions(s);
  return data.list.find((org) => String(org.id) === String(selectedId)) || data.list[0] || null;
}

function populatePlaceDatalist() {
  const options = mappedPlaces().map((place) => `<option value="${esc(place.name)}">${esc(place.worldName || place.view)} / ${esc(place.view)} / ${esc(place.type)}</option>`).join("");
  $("#uie-organization-place-options").html(options);
  renderLocationDropdowns();
}

function groupedLocationOptions() {
  const groups = new Map();
  for (const place of mappedPlaces()) {
    const group = String(place.groupLabel || place.worldName || "Current World").trim() || "Current World";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(place);
  }
  return groups;
}

function renderLocationDropdowns(filterText = "") {
  const needle = String(filterText || "").trim().toLowerCase();
  const groups = groupedLocationOptions();
  const html = Array.from(groups.entries()).map(([group, places]) => {
    const filtered = places.filter((place) => {
      if (!needle) return true;
      return `${place.name} ${place.view} ${place.type} ${place.theme || ""} ${place.worldName || ""}`.toLowerCase().includes(needle);
    });
    if (!filtered.length) return "";
    return `<div class="uie-org-location-group"><div class="uie-org-location-group-title">${esc(group)}</div>${filtered.map((place) => `<button type="button" class="uie-org-location-option" data-org-location-value="${esc(place.name)}" data-org-location-type="${esc(place.type)}"><b>${esc(place.name)}</b><small>${esc(place.view)} / ${esc(place.type)}</small></button>`).join("")}</div>`;
  }).filter(Boolean).join("") || `<div class="uie-org-empty">No mapped locations yet.</div>`;
  $("[data-org-location-menu]").html(html);
}

function openLocationDropdown(inputId, filterText = "") {
  renderLocationDropdowns(filterText);
  $(".uie-org-location-combo").removeClass("is-open");
  $(`[data-org-location-combo="${inputId}"]`).addClass("is-open");
}

function closeLocationDropdowns() { $(".uie-org-location-combo").removeClass("is-open"); }

function populateLeaderSelect(org) {
  const current = String(org?.leader || "Unknown/Hidden").trim() || "Unknown/Hidden";
  const options = collectPeopleOptions();
  if (current && !options.some((p) => p.name.toLowerCase() === current.toLowerCase())) options.push({ name: current, sourceType: "legacy", sourceId: "" });
  $("#uie-org-leader").html(options.map((p) => `<option value="${esc(p.name)}" data-source-type="${esc(p.sourceType)}" data-source-id="${esc(p.sourceId)}">${esc(p.name)}${p.sourceType ? ` (${esc(p.sourceType.replace(/_/g, " "))})` : ""}</option>`).join(""));
  $("#uie-org-leader").val(current);
}

function populateAssetSelect() {
  const assets = collectInventoryAssets();
  $("#uie-org-asset-add").html(assets.length
    ? `<option value="">Choose inventory asset...</option>${assets.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.category ? ` / ${esc(a.category)}` : ""}</option>`).join("")}`
    : `<option value="">No inventory assets available</option>`);
}

function populateMemberModal(org) {
  const people = collectPeopleOptions().filter((p) => p.sourceType !== "system");
  $("#uie-org-member-person").html([
    `<option value="">Choose NPC, character card, or user...</option>`,
    ...people.map((p) => `<option value="${esc(p.name)}" data-source-type="${esc(p.sourceType)}" data-source-id="${esc(p.sourceId)}">${esc(p.name)} (${esc(p.sourceType.replace(/_/g, " "))})</option>`),
    `<option value="__custom_group__">Custom group / many members</option>`
  ].join(""));
  const ranks = collectRankOptions(org);
  $("#uie-org-member-rank").html([`<option value="">Choose rank...</option>`, ...ranks.map((rank) => `<option value="${esc(rank)}">${esc(rank)}</option>`)].join(""));
}

function clearMemberModal() {
  $("#uie-org-member-edit-index").val("");
  $("#uie-org-member-title").text("Add Member");
  $("#uie-org-member-add").html(`<i class="fa-solid fa-user-plus"></i> Save Member`);
  $("#uie-org-member-person,#uie-org-member-custom-name,#uie-org-member-rank,#uie-org-member-rank-new,#uie-org-member-role,#uie-org-member-authority,#uie-org-member-location,#uie-org-member-notes").val("");
  $("#uie-org-member-count").val("1");
  $("#uie-org-member-custom-wrap").hide();
}

function openMemberModal(index = null) {
  const org = currentOrganization();
  if (!org) return;
  populateMemberModal(org);
  clearMemberModal();
  if (Number.isInteger(index) && Array.isArray(org.members) && org.members[index]) {
    const member = normalizeMember(org.members[index]);
    $("#uie-org-member-edit-index").val(String(index));
    $("#uie-org-member-title").text("Edit Member");
    const personOption = $(`#uie-org-member-person option`).filter(function () { return String($(this).val() || "").trim().toLowerCase() === member.name.toLowerCase(); }).first();
    if (personOption.length) { $("#uie-org-member-person").val(personOption.val()); $("#uie-org-member-custom-wrap").hide(); }
    else { $("#uie-org-member-person").val("__custom_group__"); $("#uie-org-member-custom-name").val(member.name); $("#uie-org-member-custom-wrap").show(); }
    if (member.rank && !$(`#uie-org-member-rank option`).filter(function () { return String($(this).val() || "").toLowerCase() === member.rank.toLowerCase(); }).length) {
      $("#uie-org-member-rank").append(`<option value="${esc(member.rank)}">${esc(member.rank)}</option>`);
    }
    $("#uie-org-member-rank").val(member.rank);
    $("#uie-org-member-role").val(member.role);
    $("#uie-org-member-authority").val(member.authority);
    $("#uie-org-member-location").val(member.location);
    $("#uie-org-member-notes").val(member.notes);
    $("#uie-org-member-count").val(String(member.count || 1));
  }
  $("#uie-org-member-modal").css("display", "flex");
  setTimeout(() => $("#uie-org-member-person").trigger("focus"), 0);
}

function readDossierInto(org) {
  org.name = String($("#uie-org-name").val() || "Unnamed Organization").trim().slice(0, 100);
  org.type = String($("#uie-org-type").val() || "organization").trim().slice(0, 80);
  org.standing = clampStanding($("#uie-org-standing").val());
  org.influence = String($("#uie-org-influence").val() || org.scope || "local").trim().slice(0, 120);
  org.scope = org.influence || org.scope || "local";
  org.base = String($("#uie-org-base").val() || "").trim().slice(0, 160);
  org.baseType = String($("#uie-org-base-type").val() || "").trim().slice(0, 80);
  org.leader = String($("#uie-org-leader").val() || "").trim().slice(0, 120);
  org.leaderTitle = String($("#uie-org-leader-title").val() || "").trim().slice(0, 120);
  org.subLeaders = normalizeTextList($("#uie-org-subleaders").val()).slice(0, 12);
  org.notes = String($("#uie-org-notes").val() || "").trim().slice(0, 6000);
  // Newer intelligence fields added to Info tab
  const heatVal = Number($("#uie-org-heat").val());
  if (!isNaN(heatVal)) org.heat = Math.max(0, Math.min(100, heatVal));
  const membershipVal = String($("#uie-org-membership-status").val() || "").trim();
  if (membershipVal) org.membershipStatus = membershipVal;
  const accessVal = String($("#uie-org-access-level").val() || "").trim();
  if (accessVal) org.accessLevel = accessVal;
  org.updatedAt = Date.now();
  return org;
}

function organizationCardHtml(org) {
  const cat = organizationCategory(org);
  const icon = organizationIcon(org);
  const leader = organizationLeader(org);
  const base = org.base || "No mapped base";
  const standing = Number(org.standing || 0);
  const heat = Number(org.heat || 0);
  const joined = isUserInOrganization(org);
  const memberCount = (org.members || []).length;
  const hook = organizationPrimaryHook(org);
  const standingColor = standing >= 65 ? "#7edba5" : standing <= 25 ? "#ff8a70" : "#d6b468";
  const heatClass = heat >= 50 ? "heat high" : heat > 0 ? "heat" : "";
  const heatText = heat > 0 ? organizationHeatLabel(org) : "";
  return `
    <article class="uie-org-card" data-org-open="${esc(org.id)}" style="--org-accent:${esc(standingColor)}">
      <div class="uie-org-card-inner">
        <div class="uie-org-emblem"><i class="fa-solid ${esc(icon)}"></i></div>
        <div class="uie-org-card-body">
          <div class="uie-org-card-top">
            <button type="button" class="uie-org-name" data-org-open="${esc(org.id)}">${esc(org.name)}</button>
            <div class="uie-org-card-badges">
              ${heat > 0 ? `<span class="uie-org-badge ${heatClass}"><i class="fa-solid fa-fire-flame-curved"></i> ${esc(heatText)}</span>` : ""}
              ${joined ? `<span class="uie-org-badge member"><i class="fa-solid fa-user-check"></i> Joined</span>` : ""}
              ${hook ? `<span class="uie-org-badge hook"><i class="fa-solid fa-bolt"></i> Hook</span>` : ""}
            </div>
          </div>
          <div class="uie-org-card-meta">
            <span class="uie-org-chip"><i class="fa-solid fa-location-dot"></i> ${esc(base)}</span>
            <span class="uie-org-chip">${esc(standingLabel(standing))} ${standing}</span>
            <span class="uie-org-chip">${esc(ORG_TEMPLATES[cat]?.label || cat)}</span>
          </div>
          <div class="uie-org-standing-bar"><div class="uie-org-standing-fill" style="width:${standing}%;background:${standingColor}"></div></div>
          <div class="uie-org-card-footer">
            <span class="uie-org-card-hook">${hook ? esc(hook) : `${esc(leader)} &bull; ${memberCount} members`}</span>
            <div class="uie-org-card-actions">
              <button type="button" class="uie-org-btn icon" data-org-open="${esc(org.id)}" title="Open dossier"><i class="fa-solid fa-folder-open"></i></button>
              ${!joined ? `<button type="button" class="uie-org-btn primary" data-org-join="${esc(org.id)}"><i class="fa-solid fa-user-plus"></i> Join</button>` : ""}
            </div>
          </div>
        </div>
      </div>
    </article>`;
}

function organizationDashboardHtml(org) {
  const leader = organizationLeader(org);
  const leaderTitle = organizationLeaderTitle(org);
  const subs = organizationSubLeaders(org);
  const power = organizationPowerSummary(org);
  const access = organizationAccessSummary(org);
  const threat = organizationThreatSummary(org);
  const issues = Array.isArray(org?.currentIssues) ? org.currentIssues : [];
  const hooks = Array.isArray(org?.activeHooks) ? org.activeHooks : [];
  const runIns = Array.isArray(org?.runIns) ? org.runIns : [];
  const events = Array.isArray(org?.majorEvents) ? org.majorEvents : [];
  const rumors = Array.isArray(org?.rumors) ? org.rumors : [];
  const secrets = Array.isArray(org?.secrets) ? org.secrets : [];
  const rules = Array.isArray(org?.ranks) ? org.ranks : [];
  const obligations = Array.isArray(org?.obligations) ? org.obligations : [];
  const services = Array.isArray(org?.services) ? org.services : [];
  const perks = Array.isArray(org?.perks) ? org.perks : [];
  const allies = Array.isArray(org?.allies) ? org.allies : [];
  const rivals = Array.isArray(org?.rivals) ? org.rivals : [];
  const drama = [...issues, ...hooks, ...runIns.slice(0, 2), ...events.slice(0, 2)].slice(0, 6);
  return `
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-bolt"></i> Power</h4>
      <p>${esc(power)}</p>
      ${org.base ? `<p style="margin-top:4px;color:#6a6050;font-size:10px;">Base: ${esc(org.base)} | Influence: ${esc(org.influence || org.scope || "local")}</p>` : ""}
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-key"></i> Access</h4>
      <p>${esc(access)}</p>
      ${perks.length ? `<ul style="margin-top:4px;">${perks.slice(0, 4).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-triangle-exclamation"></i> Threat</h4>
      <p>${esc(threat)}</p>
      ${rivals.length ? `<p style="margin-top:4px;color:#ff8a70;font-size:10px;">Rivals: ${esc(rivals.join(", "))}</p>` : ""}
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-masks-theater"></i> Current Drama</h4>
      ${drama.length ? `<ul>${drama.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "<p>No active drama.</p>"}
      ${rumors.length ? `<p style="margin-top:4px;color:#d6b468;font-size:10px;"><i class="fa-solid fa-comment-dots"></i> ${esc(rumors[0])}</p>` : ""}
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-users"></i> Key People</h4>
      <p>${esc(leaderTitle ? `${leader} (${leaderTitle})` : leader)}</p>
      ${subs.length ? `<p style="margin-top:4px;color:#a89878;font-size:10px;">Sub-leaders: ${esc(subs.slice(0, 4).join(", "))}</p>` : ""}
      <p style="margin-top:4px;color:#6a6050;font-size:10px;">${(org.members || []).length} total members</p>
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-scale-balanced"></i> Rules / Requirements</h4>
      ${rules.length ? `<ul>${rules.slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "<p>No rules recorded.</p>"}
      ${obligations.length ? `<p style="margin-top:4px;color:#ff8a70;font-size:10px;">Obligations: ${esc(obligations.join(", "))}</p>` : ""}
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-gift"></i> Rewards / Services</h4>
      ${services.length ? `<ul>${services.slice(0, 4).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${perks.length ? `<ul>${perks.slice(0, 4).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      ${!services.length && !perks.length ? "<p>No known rewards or services.</p>" : ""}
    </div>
    <div class="uie-org-dashboard-card">
      <h4><i class="fa-solid fa-handshake-angle"></i> Relations</h4>
      ${allies.length ? `<p style="color:#7edba5;">Allies: ${esc(allies.join(", "))}</p>` : ""}
      ${rivals.length ? `<p style="color:#ff8a70;">Rivals: ${esc(rivals.join(", "))}</p>` : ""}
      ${!allies.length && !rivals.length ? "<p>No known allies or rivals.</p>" : ""}
      ${secrets.length ? `<p style="margin-top:4px;color:#b8a8ff;font-size:10px;"><i class="fa-solid fa-lock"></i> ${secrets.length} secret(s) known</p>` : ""}
    </div>`;
}

function networkHooks(data) {
  const list = data?.list || [];
  const hooks = [];
  for (const org of list) {
    const name = org.name || "Unknown";
    (org.activeHooks || []).forEach((h) => hooks.push({ text: h, source: name, type: "opportunity", orgId: org.id }));
    (org.currentIssues || []).forEach((i) => hooks.push({ text: i, source: name, type: "conflict", orgId: org.id }));
    (org.runIns || []).slice(0, 2).forEach((r) => hooks.push({ text: r, source: name, type: "intel", orgId: org.id }));
    (org.majorEvents || []).slice(0, 1).forEach((e) => hooks.push({ text: e, source: name, type: "intel", orgId: org.id }));
    (org.rumors || []).slice(0, 1).forEach((r) => hooks.push({ text: r, source: name, type: "rumor", orgId: org.id }));
    (org.secrets || []).slice(0, 1).forEach((s) => hooks.push({ text: s, source: name, type: "rumor", orgId: org.id }));
  }
  return hooks.slice(0, 30);
}

function renderSnapshot(data) {
  const list = data.list || [];
  const places = new Set();
  list.forEach((org) => [org.base, ...(org.controlledSpaces || [])].forEach((place) => { if (place) places.add(place.toLowerCase()); }));
  const allies = list.filter((org) => Number(org.standing || 0) >= 65).length;
  const hostile = list.filter((org) => Number(org.standing || 0) <= 15).length;
  const highHeat = list.filter((org) => Number(org.heat || 0) >= 50).length;
  const joined = list.filter((org) => isUserInOrganization(org)).length;
  const withHooks = list.filter((org) => (org.activeHooks || []).length > 0 || (org.currentIssues || []).length > 0).length;
  const obligations = list.reduce((sum, org) => sum + (Array.isArray(org.obligations) ? org.obligations.length : 0), 0);
  const restricted = list.filter((org) => Number(org.standing || 0) < 35 && Number(org.heat || 0) > 0).length;
  const pendingIntel = Array.isArray(data.pendingIntel) ? data.pendingIntel.length : 0;
  $("#uie-org-snapshot").html([
    ["Organizations", String(list.length), ""],
    ["Allies", String(allies), "good"],
    ["Hostile", String(hostile), "alert"],
    ["Controlled Places", String(places.size), "info"],
    ["Joined", String(joined), "good"],
    ["Active Hooks", String(withHooks), "info"],
    ["High Heat", String(highHeat), highHeat > 0 ? "alert" : ""],
    ["Obligations", String(obligations), obligations > 0 ? "alert" : ""],
    ["Restricted", String(restricted), restricted > 0 ? "alert" : ""],
    ["Pending Intel", String(pendingIntel), pendingIntel > 0 ? "info" : ""]
  ].map(([label, value, cls]) => `<div class="uie-org-stat ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join(""));
}

function renderHooksFeed(data) {
  const hooks = networkHooks(data);
  if (!hooks.length) {
    $("#uie-org-hooks-feed").html(`<div class="uie-org-empty">No active hooks, conflicts, or rumors detected. Organizations will generate hooks from chat, lorebook, and events.</div>`);
    return;
  }
  const iconMap = { conflict: "fa-burst", intel: "fa-satellite-dish", opportunity: "fa-bolt", rumor: "fa-comment-dots" };
  $("#uie-org-hooks-feed").html(hooks.map((h) => `
    <div class="uie-org-hook-item" data-org-open="${esc(h.orgId || "")}">
      <div class="uie-org-hook-icon ${esc(h.type)}"><i class="fa-solid ${iconMap[h.type] || "fa-circle-info"}"></i></div>
      <div>
        <div class="uie-org-hook-text">${esc(h.text)}</div>
        <div class="uie-org-hook-source">${esc(h.source)}</div>
      </div>
    </div>
  `).join(""));
}

function renderIntelPanel(data) {
  renderPendingIntelPanel();
}

function getFilteredOrganizations(data) {
  let list = data.list || [];
  const q = String(searchQuery || "").trim().toLowerCase();
  if (q) {
    list = list.filter((org) => {
      const hay = `${org.name} ${org.type} ${org.category} ${org.base} ${org.leader} ${(org.members || []).map((m) => normalizeMember(m).name).join(" ")} ${(org.allies || []).join(" ")} ${(org.rivals || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (activeFilter === "all") return list;
  if (activeFilter === "joined") return list.filter((org) => isUserInOrganization(org));
  if (activeFilter === "friendly") return list.filter((org) => Number(org.standing || 0) >= 65);
  if (activeFilter === "hostile") return list.filter((org) => Number(org.standing || 0) <= 15);
  if (activeFilter === "highheat") return list.filter((org) => Number(org.heat || 0) >= 50);
  if (activeFilter === "hashook") return list.filter((org) => (org.activeHooks || []).length > 0 || (org.currentIssues || []).length > 0);
  if (activeFilter === "haslocation") return list.filter((org) => org.base || (org.controlledSpaces || []).length > 0);
  if (ORG_TEMPLATES[activeFilter]) return list.filter((org) => organizationCategory(org) === activeFilter);
  return list;
}

function renderOrganizations() {
  const s = getSettings();
  const data = normalizeFactions(s);
  if (organizationAutoChanged(data)) {
    saveSettings();
    try { delete data.__uieOrgAutoChanged; } catch (_) {}
  }
  if (!selectedId && data.list[0]) selectedId = data.list[0].id;
  populatePlaceDatalist();
  renderSnapshot(data);
  renderHooksFeed(data);
  renderIntelPanel(data);
  let filtered = getFilteredOrganizations(data);
  // Auto-fallback: if a non-default filter hides all orgs, silently reset to "all"
  if (!filtered.length && activeFilter !== "all" && data.list.length > 0) {
    activeFilter = "all";
    $(".uie-org-filter-chip").removeClass("active").filter("[data-org-filter='all']").addClass("active");
    filtered = getFilteredOrganizations(data);
  }
  let html;
  if (filtered.length) {
    html = filtered.map((org) => organizationCardHtml(org)).join("");
  } else if (data.list.length > 0) {
    html = `<div class="uie-org-empty">No organizations match this filter. Clear filters or create a new organization.<br><button type="button" class="uie-org-btn" data-org-filter="all" style="margin-top:10px;">Clear Filter</button></div>`;
  } else {
    html = `<div class="uie-org-empty">No organizations yet. Use <b>New</b> to create one, or scan chat to discover organizations from the story.</div>`;
  }
  $("#uie-organization-list").html(html);
}

function heroHtml(org) {
  const subs = organizationSubLeaders(org);
  return [
    ["Name", org.name || "Unnamed Organization"],
    ["Category", ORG_TEMPLATES[organizationCategory(org)]?.label || organizationCategory(org)],
    ["Location", org.base || "No mapped base"],
    ["Standing", `${standingLabel(org.standing)} (${Number(org.standing || 0)}/100)`],
    ["Heat", organizationHeatLabel(org)],
    ["Membership", organizationMembershipLabel(org)],
    ["Leader Title", organizationLeaderTitle(org) || "Unset"],
    ["Leader", organizationLeader(org) || "Unassigned"],
    ["Sub Leaders", subs.length ? subs.join(", ") : "None recorded"]
  ].map(([label, value]) => `<div class="uie-org-hero-chip"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("");
}

function itemListHtml(items, kind, empty = "Nothing recorded yet.") {
  return items.length ? items.map((raw, index) => {
    const value = kind === "assets" ? normalizeAssetRef(raw)?.name : String(raw || "");
    const sub = kind === "assets" ? [normalizeAssetRef(raw)?.category, normalizeAssetRef(raw)?.description].filter(Boolean).join(" / ") : "";
    return `<div class="uie-org-row"><div><b>${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div><div>${kind === "controlledSpaces" ? `<button type="button" class="uie-org-btn icon" data-org-map-place="${esc(value)}" title="Check on map"><i class="fa-solid fa-map-pin"></i></button>` : ""}<button type="button" class="uie-org-btn danger icon uie-org-item-remove" data-kind="${esc(kind)}" data-index="${index}" title="Remove"><i class="fa-solid fa-xmark"></i></button></div></div>`;
  }).join("") : `<div class="uie-org-empty">${esc(empty)}</div>`;
}

function memberListHtml(members = []) {
  if (!members.length) return `<div class="uie-org-empty">No members recorded yet.</div>`;
  return `<div class="uie-org-member-row head"><span>Name</span><span>Rank</span><span>Role</span><span>Authority</span><span>Location</span><span></span></div>${members.map((raw, index) => { const m = normalizeMember(raw); return `<div class="uie-org-member-row"><span><b>${esc(m.name)}${m.count > 1 ? ` x${esc(m.count)}` : ""}</b>${m.notes ? `<small>${esc(m.notes)}</small>` : ""}</span><span>${esc(m.rank || "-")}</span><span>${esc(m.role || "-")}</span><span>${esc(m.authority || "-")}</span><span>${esc(m.location || "-")}</span><span><button type="button" class="uie-org-btn icon" data-org-edit-member="${index}" title="Edit member"><i class="fa-solid fa-pen"></i></button>${m.location ? `<button type="button" class="uie-org-btn icon" data-org-map-place="${esc(m.location)}" title="Check on map"><i class="fa-solid fa-map-pin"></i></button>` : ""}<button type="button" class="uie-org-btn danger icon uie-org-item-remove" data-kind="members" data-index="${index}" title="Remove member"><i class="fa-solid fa-xmark"></i></button></span></div>`; }).join("")}`;
}

function lawListHtml(org, laws) {
  const controlled = new Set([org?.base, ...(org?.controlledSpaces || [])].map((name) => String(name || "").toLowerCase()).filter(Boolean));
  const relevant = laws.filter((law) => !law.factionId || law.factionId === org?.id || controlled.has(String(law.place || "").toLowerCase()));
  return relevant.length ? relevant.map((law) => `<div class="uie-org-row" data-law-id="${esc(law.id)}"><div><b>${esc(law.place || "Organization Rule")}</b><small>${esc(law.text)}</small></div><button type="button" class="uie-org-btn danger icon uie-org-law-del" title="Remove rule"><i class="fa-solid fa-xmark"></i></button></div>`).join("") : `<div class="uie-org-empty">No rules saved for this organization yet.</div>`;
}

function rankListHtml(org) {
  const ranks = collectRankOptions(org);
  return ranks.length ? ranks.map((rank, index) => `<div class="uie-org-row"><div>${esc(rank)}</div><button type="button" class="uie-org-btn danger icon uie-org-rank-remove" data-index="${index}" title="Remove rank"><i class="fa-solid fa-xmark"></i></button></div>`).join("") : `<div class="uie-org-empty">Create rank options before adding members, or add a rank inside the member popup.</div>`;
}

function renderDossier() {
  const s = getSettings();
  const data = normalizeFactions(s);
  const org = currentOrganization();
  if (!org) return;
  selectedId = org.id;
  populatePlaceDatalist();
  populateLeaderSelect(org);
  populateAssetSelect();
  populateMemberModal(org);
  const cat = organizationCategory(org);
  const icon = organizationIcon(org);
  $("#uie-org-dossier-sigil-icon").html(`<i class="fa-solid ${icon}"></i>`);
  $("#uie-org-name").val(org.name);
  $("#uie-org-subtitle").text(`${ORG_TEMPLATES[cat]?.label || org.type || "organization"} / ${org.influence || org.scope || "local"}`);
  $("#uie-org-type").val(org.type);
  $("#uie-org-standing").val(org.standing);
  $("#uie-org-influence").val(org.influence || org.scope || "local");
  // Intelligence fields (Info tab)
  $("#uie-org-heat").val(Number(org.heat || 0));
  $("#uie-org-membership-status").val(org.membershipStatus || "");
  $("#uie-org-access-level").val(org.accessLevel || "");
  $("#uie-org-base").val(org.base);
  $("#uie-org-base-type").val(org.baseType);
  $("#uie-org-leader-title").val(organizationLeaderTitle(org));
  $("#uie-org-leader").val(org.leader || organizationLeader(org));
  $("#uie-org-subleaders").val(organizationSubLeaders(org).join(", "));
  $("#uie-org-notes").val(org.notes);
  $("#uie-org-hero-grid").html(heroHtml(org));
  // Dashboard content now lives in Run-ins tab (data-org-panel="history")
  $("#uie-org-dashboard").html(organizationDashboardHtml(org));
  $("#uie-org-members-list").html(memberListHtml(org.members || []));
  $("#uie-org-ranks-list").html(rankListHtml(org));
  $("#uie-org-spaces-list").html(itemListHtml(org.controlledSpaces || [], "controlledSpaces", "No mapped influence places yet."));
  $("#uie-org-assets-list").html(itemListHtml(org.assets || [], "assets", "No assets tracked yet."));
  $("#uie-org-runins-list").html(itemListHtml(org.runIns || [], "runIns", "No user run-ins recorded yet."));
  $("#uie-org-events-list").html(itemListHtml(org.majorEvents || [], "majorEvents", "No major events recorded yet."));
  $("#uie-org-laws-list").html(lawListHtml(org, data.laws || []));
}

function openDossier(orgId = "") {
  if (orgId) selectedId = String(orgId);
  renderDossier();
  activateDossierTab("info");
  $("#uie-organization-dossier").attr("aria-hidden", "false").show();
  setTimeout(() => { enrichOrganizationAssets(currentOrganization()).catch(() => {}); }, 0);
}

function joinOrganization(orgId = "") {
  const s = getSettings();
  const data = normalizeFactions(s);
  const org = data.list.find((entry) => String(entry.id) === String(orgId || selectedId));
  if (!org) return;
  const userName = currentUserMemberName(s);
  if (!Array.isArray(org.members)) org.members = [];
  if (!isUserInOrganization(org, s)) {
    org.members.unshift(normalizeMember({ name: userName, rank: "Member", role: "member", sourceType: "user", sourceId: "user", location: org.base || "" }));
  }
  org.membershipStatus = "member";
  org.standing = Math.max(Number(org.standing || 0), 30);
  org.updatedAt = Date.now();
  s.character = s.character && typeof s.character === "object" ? s.character : {};
  s.character.organization = org.name;
  s.character.affiliation = org.name;
  const affiliations = new Set(normalizeTextList(s.character.organizationAffiliations));
  affiliations.add(org.name);
  s.character.organizationAffiliations = Array.from(affiliations);
  saveSettings();
  renderOrganizations();
  if ($("#uie-organization-dossier").attr("aria-hidden") === "false") renderDossier();
  try { injectRpEvent(`[System: ${userName} joined organization: ${org.name}.]`); } catch (_) {}
  try { window.toastr?.success?.(`Joined ${org.name}.`); } catch (_) {}
}

function closeDossier() {
  $("#uie-organization-dossier").attr("aria-hidden", "true").hide();
}

function activateDossierTab(tab) {
  const next = String(tab || "info");
  $(".uie-org-tab").removeClass("active").filter(`[data-org-tab="${next}"]`).addClass("active");
  $(".uie-org-dossier-section").removeClass("active").filter(`[data-org-panel="${next}"]`).addClass("active");
}

function renderTemplatePicker() {
  const grid = $("#uie-org-template-grid");
  grid.html(Object.entries(ORG_TEMPLATES).map(([key, tpl]) => `
    <div class="uie-org-template-card" data-org-template="${esc(key)}">
      <i class="fa-solid ${esc(tpl.icon)}"></i>
      <div class="tpl-name">${esc(tpl.label)}</div>
      <div class="tpl-desc">${esc(tpl.description)}</div>
    </div>
  `).join(""));
}

function createOrganization(templateKey = "") {
  if (!templateKey) {
    renderTemplatePicker();
    $("#uie-org-template-modal").css("display", "flex");
    return;
  }
  const tpl = ORG_TEMPLATES[templateKey] || ORG_TEMPLATES.custom;
  const s = getSettings();
  const data = normalizeFactions(s);
  const firstPlace = mappedPlaces()[0];
  const org = {
    id: id(),
    name: `New ${tpl.label}`,
    type: templateKey,
    category: templateKey,
    standing: 50,
    membershipStatus: "",
    accessLevel: "",
    heat: 0,
    trust: 50,
    fear: 0,
    resources: 0,
    services: [...(tpl.services || [])],
    perks: [...(tpl.perks || [])],
    obligations: [...(tpl.obligations || [])],
    entryRequirements: [...(tpl.entryRequirements || [])],
    rivals: [],
    allies: [],
    secrets: [],
    rumors: [],
    currentIssues: [...(tpl.commonIssues || []).slice(0, 2)],
    activeHooks: [],
    publicFace: "",
    privateTruth: "",
    uniformStyle: "",
    scope: "local",
    influence: "local",
    base: firstPlace?.name || "",
    baseType: firstPlace?.type || "",
    controlledSpaces: firstPlace?.name ? [firstPlace.name] : [],
    assets: [],
    ranks: [...(tpl.ranks || [])],
    members: [],
    leader: "Unknown/Hidden",
    leaderTitle: tpl.ranks?.[0] || "",
    subLeaders: [],
    runIns: [],
    majorEvents: [],
    notes: `${tpl.label} organization. ${tpl.description}.`,
    npcTemplate: "",
    sourceRefs: [],
    confidence: 1,
    generatedFrom: "manual",
    lastSeenAt: Date.now(),
    updatedAt: Date.now()
  };
  ensureOrganizationAssets(org);
  data.list.unshift(org);
  selectedId = org.id;
  selectedLawPlace = org.base;
  saveSettings();
  renderOrganizations();
  openDossier(org.id);
  setTimeout(() => { enrichOrganizationAssets(org).catch(() => {}); }, 0);
  try { injectRpEvent(`[System: Created new organization: ${org.name} (${tpl.label}).]`); } catch (_) {}
}

async function saveCurrentOrganization({ checkMap = false } = {}) {
  const org = currentOrganization();
  if (!org) return;
  const oldStanding = org.standing;
  readDossierInto(org);
  saveSettings();
  if (checkMap && org.base) await offerAddPlaceToMap(org.base, org, { type: org.baseType });
  renderOrganizations();
  renderDossier();
  try {
    if (oldStanding !== org.standing) injectRpEvent(`[System: Organization standing with ${org.name} updated: ${org.standing} (previously ${oldStanding}).]`);
    else injectRpEvent(`[System: Organization dossier updated for ${org.name}.]`);
  } catch (_) {}
}

async function addMember() {
  const org = currentOrganization();
  if (!org) return;
  readDossierInto(org);
  const selected = $("#uie-org-member-person option:selected");
  const personValue = String($("#uie-org-member-person").val() || "").trim();
  const customName = String($("#uie-org-member-custom-name").val() || "").trim();
  const rankValue = String($("#uie-org-member-rank").val() || "").trim();
  const newRank = String($("#uie-org-member-rank-new").val() || "").trim();
  const rank = newRank || rankValue;
  if (newRank) {
    if (!Array.isArray(org.ranks)) org.ranks = [];
    if (!org.ranks.some((r) => String(r).toLowerCase() === newRank.toLowerCase())) org.ranks.push(newRank);
  }
  const member = normalizeMember({
    name: personValue === "__custom_group__" ? customName : personValue,
    rank,
    role: $("#uie-org-member-role").val(),
    authority: $("#uie-org-member-authority").val(),
    location: $("#uie-org-member-location").val(),
    notes: $("#uie-org-member-notes").val(),
    count: $("#uie-org-member-count").val(),
    sourceType: selected.attr("data-source-type") || (personValue === "__custom_group__" ? "group" : ""),
    sourceId: selected.attr("data-source-id") || ""
  });
  if (!member.name || !member.rank) { try { window.toastr?.info?.("Choose or create a rank before adding the member."); } catch (_) {} return; }
  if (member.location) await offerAddPlaceToMap(member.location, org);
  if (!Array.isArray(org.members)) org.members = [];
  const editIndex = Number($("#uie-org-member-edit-index").val());
  const key = `${member.name}|${member.rank}|${member.role}`.toLowerCase();
  if (Number.isInteger(editIndex) && editIndex >= 0 && editIndex < org.members.length) { org.members[editIndex] = member; }
  else if (!org.members.some((entry) => { const m = normalizeMember(entry); return `${m.name}|${m.rank}|${m.role}`.toLowerCase() === key; })) { org.members.push(member); }
  clearMemberModal();
  $("#uie-org-member-modal").hide();
  org.updatedAt = Date.now();
  saveSettings();
  renderOrganizations();
  renderDossier();
}

async function addTextItem(kind) {
  const org = currentOrganization();
  if (!org) return;
  readDossierInto(org);
  const config = { spaces: { field: "controlledSpaces", input: "#uie-org-space-add" }, runIns: { field: "runIns", input: "#uie-org-runin-add" }, majorEvents: { field: "majorEvents", input: "#uie-org-event-add" } }[kind];
  if (!config) return;
  const value = String($(config.input).val() || "").trim();
  if (!value) return;
  if (config.field === "controlledSpaces") await offerAddPlaceToMap(value, org, { type: org.baseType });
  if (!Array.isArray(org[config.field])) org[config.field] = [];
  if (!org[config.field].some((item) => item.toLowerCase() === value.toLowerCase())) org[config.field].push(value);
  $(config.input).val("");
  org.updatedAt = Date.now();
  saveSettings();
  renderOrganizations();
  renderDossier();
}

function addSelectedAsset() {
  const org = currentOrganization();
  if (!org) return;
  readDossierInto(org);
  const assetId = String($("#uie-org-asset-add").val() || "").trim();
  const asset = collectInventoryAssets().find((a) => String(a.id) === assetId);
  if (!asset) return;
  if (!Array.isArray(org.assets)) org.assets = [];
  if (!org.assets.some((item) => String(normalizeAssetRef(item)?.name || "").toLowerCase() === asset.name.toLowerCase())) { org.assets.push(asset); }
  org.updatedAt = Date.now();
  saveSettings();
  renderOrganizations();
  renderDossier();
}

function addRankOption() {
  const org = currentOrganization();
  if (!org) return;
  readDossierInto(org);
  const rank = String($("#uie-org-rank-add").val() || "").trim();
  if (!rank) return;
  if (!Array.isArray(org.ranks)) org.ranks = [];
  if (!org.ranks.some((r) => String(r).toLowerCase() === rank.toLowerCase())) org.ranks.push(rank);
  $("#uie-org-rank-add").val("");
  org.updatedAt = Date.now();
  saveSettings();
  renderDossier();
}

async function addLaw() {
  const s = getSettings();
  const data = normalizeFactions(s);
  const org = currentOrganization();
  if (!org) return;
  readDossierInto(org);
  const text = String($("#uie-org-law-text").val() || "").trim();
  if (!text) return;
  const law = { id: id("law"), scope: "organization", place: "", factionId: org.id, text };
  data.laws.push(law);
  $("#uie-org-law-text").val("");
  saveSettings();
  renderOrganizations();
  renderDossier();
}

function inferOrganizationCategory(name, text) {
  const hay = `${name || ""} ${text || ""}`.toLowerCase();
  for (const [key, pattern] of Object.entries(ORG_CATEGORY_KEYWORDS)) {
    if (pattern.test(hay)) return key;
  }
  return "custom";
}

function extractOrganizationIntelFromText(raw, source = "chat") {
  if (!raw || raw.length < 20) return [];
  const text = String(raw || "");
  const lower = text.toLowerCase();
  const candidates = [];
  const orgWords = /\b(guild|club|council|crew|gang|family|house|company|agency|order|cult|team|school|academy|government|watch|guard|syndicate|union|committee|department|class|faction|tribe|clan|brotherhood|sisterhood|sect|temple|church|ministry|senate|parliament|corporation|firm|bureau|office|society|circle|league|squad|unit|band|pack|ring|cartel|mafia|mob)\b/gi;
  const patterns = [
    /(?:the|a|an)\s+([A-Z][A-Za-z\s]{2,30})\s+(?:guild|club|council|crew|gang|family|house|company|agency|order|cult|team|school|academy|watch|guard|syndicate|union|committee|department|faction|tribe|clan)/gi,
    /(?:the|a|an)\s+([A-Z][A-Za-z\s]{2,30})\s+(?:controls|owns|rules|governs|protects|watches|follows|tracks|recruits|banned|arrested|attacked|is at war with|works with)\b/gi,
    /([A-Z][A-Za-z\s]{2,30})\s+(?:captain|president|director|chief|boss|leader|head|commander|chair|founder|king|queen)\s+(?:is|was)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/gi,
    /(?:the|a|an)\s+([A-Z][A-Za-z\s]{2,30})\s+(?:is led by|is run by|is headed by)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/gi
  ];
  const foundNames = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = String(match[1] || "").trim();
      if (name.length >= 3 && name.length <= 40) foundNames.add(name);
    }
  }
  const wordMatches = [];
  let wordMatch;
  while ((wordMatch = orgWords.exec(text)) !== null) {
    const before = text.slice(Math.max(0, wordMatch.index - 40), wordMatch.index);
    const after = text.slice(wordMatch.index + wordMatch[0].length, wordMatch.index + wordMatch[0].length + 40);
    const namePattern = /([A-Z][A-Za-z\s]{1,30}?)\s+$/;
    const nameBefore = before.match(namePattern);
    if (nameBefore) {
      const fullName = `${nameBefore[1].trim()} ${wordMatch[0]}`.trim();
      if (fullName.length >= 4) foundNames.add(fullName);
    }
  }
  for (const name of foundNames) {
    const category = inferOrganizationCategory(name, text);
    const leaderMatch = text.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,30}(?:captain|president|director|chief|boss|leader|head|commander)\\s+(?:is|was)\\s+([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)`, "i"));
    const baseMatch = text.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,30}(?:controls|owns|based in|headquartered)\\s+(?:the\\s+)?([A-Z][A-Za-z\\s]{2,30}?)(?:\\.|,|$)`, "i"));
    const confidence = leaderMatch ? 0.8 : baseMatch ? 0.7 : 0.55;
    candidates.push({
      name,
      aliases: [],
      category,
      type: "organization",
      confidence,
      source,
      leader: leaderMatch ? leaderMatch[1] : "",
      base: baseMatch ? baseMatch[1].trim() : "",
      controlledSpaces: baseMatch ? [baseMatch[1].trim()] : [],
      ranks: ORG_TEMPLATES[category]?.ranks?.slice(0, 3) || [],
      members: [],
      allies: [],
      rivals: [],
      rules: [],
      laws: [],
      rumors: [],
      secrets: [],
      currentIssues: [],
      activeHooks: [],
      services: [],
      perks: [],
      obligations: [],
      standingDelta: 0,
      heatDelta: 0,
      trustDelta: 0,
      fearDelta: 0,
      notes: `Detected from ${source} text.`,
      reason: `Organization name "${name}" detected in ${source} text. Category: ${ORG_TEMPLATES[category]?.label || category}.`
    });
  }
  return dedupeIntelCandidates(candidates);
}

function dedupeIntelCandidates(candidates) {
  const seen = new Map();
  for (const c of candidates) {
    const key = normalizeKey(c.name);
    if (!seen.has(key) || seen.get(key).confidence < c.confidence) seen.set(key, c);
  }
  return Array.from(seen.values());
}

function findMatchingOrganization(data, candidate) {
  const name = normalizeKey(candidate?.name);
  if (!name) return null;
  for (const org of data.list || []) {
    if (normalizeKey(org.name) === name) return org;
    const aliases = normalizeTextList(org.aliases);
    if (aliases.some((a) => normalizeKey(a) === name)) return org;
  }
  const leaderMatch = normalizeKey(candidate?.leader);
  const baseMatch = normalizeKey(candidate?.base);
  const catMatch = String(candidate?.category || "").toLowerCase();
  for (const org of data.list || []) {
    let score = 0;
    if (leaderMatch && normalizeKey(organizationLeader(org)) === leaderMatch) score += 2;
    if (baseMatch && normalizeKey(org.base) === baseMatch) score += 2;
    if (catMatch && organizationCategory(org) === catMatch) score += 1;
    if (score >= 3) return org;
  }
  return null;
}

function applyOrganizationPatch(org, candidate) {
  if (!org || !candidate) return false;
  let changed = false;
  const appendUnique = (field, values) => {
    if (!Array.isArray(values) || !values.length) return;
    if (!Array.isArray(org[field])) org[field] = [];
    for (const v of values) {
      const key = String(v || "").trim().toLowerCase();
      if (key && !org[field].some((existing) => String(existing || "").toLowerCase() === key)) {
        org[field].push(String(v || "").trim());
        changed = true;
      }
    }
  };
  if (candidate.base && !String(org.base || "").trim()) { org.base = candidate.base; changed = true; }
  if (Array.isArray(candidate.controlledSpaces)) appendUnique("controlledSpaces", candidate.controlledSpaces);
  if (candidate.leader && (!String(org.leader || "").trim() || org.leader === "Unknown/Hidden")) { org.leader = candidate.leader; changed = true; }
  if (candidate.leaderTitle && !String(org.leaderTitle || "").trim()) { org.leaderTitle = candidate.leaderTitle; changed = true; }
  appendUnique("ranks", candidate.ranks);
  appendUnique("allies", candidate.allies);
  appendUnique("rivals", candidate.rivals);
  appendUnique("rumors", candidate.rumors);
  appendUnique("secrets", candidate.secrets);
  appendUnique("currentIssues", candidate.currentIssues);
  appendUnique("activeHooks", candidate.activeHooks);
  appendUnique("services", candidate.services);
  appendUnique("perks", candidate.perks);
  appendUnique("obligations", candidate.obligations);
  appendUnique("members", (candidate.members || []).map((m) => m?.name).filter(Boolean));
  if (candidate.standingDelta) { org.standing = clampStanding(Number(org.standing || 50) + Number(candidate.standingDelta || 0)); changed = true; }
  if (candidate.heatDelta) { org.heat = clampHeat(Number(org.heat || 0) + Number(candidate.heatDelta || 0)); changed = true; }
  if (candidate.trustDelta) { org.trust = clampTrust(Number(org.trust || 50) + Number(candidate.trustDelta || 0)); changed = true; }
  if (candidate.fearDelta) { org.fear = clampFear(Number(org.fear || 0) + Number(candidate.fearDelta || 0)); changed = true; }
  if (candidate.source) {
    if (!Array.isArray(org.sourceRefs)) org.sourceRefs = [];
    org.sourceRefs.push({ source: candidate.source, sourceId: candidate.sourceId || "", timestamp: Date.now() });
    changed = true;
  }
  if (candidate.category && (!org.category || org.category === "custom")) { org.category = candidate.category; changed = true; }
  org.lastSeenAt = Date.now();
  org.updatedAt = Date.now();
  return changed;
}

function queueOrganizationIntel(s, candidate, reason) {
  ensureAutoDiscovery(s);
  if (!Array.isArray(s.factions.pendingIntel)) s.factions.pendingIntel = [];
  s.factions.pendingIntel.push({
    ...candidate,
    id: id("intel"),
    reason: reason || candidate.reason || `Detected from ${candidate.source || "unknown"}.`,
    timestamp: Date.now()
  });
  s.factions.pendingIntel = s.factions.pendingIntel.slice(-50);
}

function processOrganizationIntel(candidates, options = {}) {
  const s = getSettings();
  const data = normalizeFactions(s);
  const ad = ensureAutoDiscovery(s);
  let changed = false;
  for (const candidate of candidates) {
    const existing = findMatchingOrganization(data, candidate);
    if (existing) {
      if (candidate.confidence >= ad.minConfidenceToAutoUpdate) {
        if (applyOrganizationPatch(existing, candidate)) changed = true;
      } else if (ad.mode === "review") {
        queueOrganizationIntel(s, candidate, `Update for existing "${existing.name}" needs review (confidence: ${Math.round(candidate.confidence * 100)}%).`);
      }
    } else {
      if (candidate.confidence >= ad.minConfidenceToAutoAdd && ad.mode !== "review") {
        const org = createOrganizationFromIntel(candidate);
        if (org) { data.list.unshift(org); changed = true; }
      } else {
        queueOrganizationIntel(s, candidate);
      }
    }
  }
  if (changed) { saveSettings(); renderOrganizations(); }
  return changed;
}

function createOrganizationFromIntel(candidate) {
  const firstPlace = mappedPlaces()[0];
  const cat = candidate.category || inferOrganizationCategory(candidate.name, "");
  const tpl = ORG_TEMPLATES[cat] || ORG_TEMPLATES.custom;
  const org = {
    id: id(),
    name: String(candidate.name || "Unknown Organization").trim().slice(0, 100),
    type: candidate.type || cat,
    category: cat,
    standing: clampStanding(50 + (candidate.standingDelta || 0)),
    membershipStatus: "",
    accessLevel: "",
    heat: clampHeat(candidate.heatDelta || 0),
    trust: clampTrust(50 + (candidate.trustDelta || 0)),
    fear: clampFear(candidate.fearDelta || 0),
    resources: 0,
    services: [...(candidate.services || []), ...(tpl.services || [])],
    perks: [...(candidate.perks || []), ...(tpl.perks || [])],
    obligations: [...(candidate.obligations || []), ...(tpl.obligations || [])],
    entryRequirements: [...(candidate.entryRequirements || []), ...(tpl.entryRequirements || [])],
    rivals: [...(candidate.rivals || [])],
    allies: [...(candidate.allies || [])],
    secrets: [...(candidate.secrets || [])],
    rumors: [...(candidate.rumors || [])],
    currentIssues: [...(candidate.currentIssues || [])],
    activeHooks: [...(candidate.activeHooks || [])],
    publicFace: "",
    privateTruth: "",
    uniformStyle: "",
    aliases: [...(candidate.aliases || [])],
    scope: "local",
    influence: "local",
    base: candidate.base || firstPlace?.name || "",
    baseType: firstPlace?.type || "",
    controlledSpaces: [...(candidate.controlledSpaces || [])],
    assets: [],
    ranks: [...(candidate.ranks || tpl.ranks || [])],
    members: (candidate.members || []).map(normalizeMember),
    leader: candidate.leader || "Unknown/Hidden",
    leaderTitle: candidate.leaderTitle || tpl.ranks?.[0] || "",
    subLeaders: [],
    runIns: [],
    majorEvents: [],
    notes: candidate.notes || `Auto-discovered from ${candidate.source || "unknown"}.`,
    npcTemplate: "",
    sourceRefs: [{ source: candidate.source || "discovery", sourceId: candidate.sourceId || "", timestamp: Date.now() }],
    confidence: candidate.confidence || 0.5,
    generatedFrom: candidate.source || "discovery",
    lastSeenAt: Date.now(),
    updatedAt: Date.now()
  };
  ensureOrganizationAssets(org);
  return org;
}

function acceptOrganizationIntel(intelId) {
  const s = getSettings();
  const intel = (s.factions.pendingIntel || []).find((i) => String(i.id) === String(intelId));
  if (!intel) return;
  applyOrganizationIntel(intel);
  removePendingIntelById(s, intelId);
  saveSettings();
  renderOrganizations();
  const displayName = intel.organizationName || intel.name || "Organization";
  try { window.toastr?.success?.(`Intel accepted: ${displayName}`); } catch (_) {}
}

function rejectOrganizationIntel(intelId) {
  const s = getSettings();
  removePendingIntelById(s, intelId);
  renderOrganizations();
}

function mergeIntelWithOrganization(intelId, orgId) {
  const s = getSettings();
  const data = normalizeFactions(s);
  const intel = (s.factions.pendingIntel || []).find((i) => String(i.id) === String(intelId));
  const org = data.list.find((o) => String(o.id) === String(orgId));
  if (!intel || !org) return;
  applyOrganizationPatch(org, intel);
  s.factions.pendingIntel = (s.factions.pendingIntel || []).filter((i) => String(i.id) !== String(intelId));
  saveSettings();
  renderOrganizations();
  renderDossier();
  try { window.toastr?.success?.(`Intel merged into ${org.name}`); } catch (_) {}
}

function findOrganizationByIntel(intel) {
  if (!intel) return null;
  const s = getSettings();
  const data = normalizeFactions(s);
  const candidate = {
    name: intel.organizationName || intel.name,
    leader: intel.proposedPatch?.leader,
    base: intel.proposedPatch?.base,
    category: intel.category
  };
  return findMatchingOrganization(data, candidate);
}

function applyOrganizationIntel(intel) {
  if (!intel) return false;
  const s = getSettings();
  const data = normalizeFactions(s);
  const existing = findOrganizationByIntel(intel);
  const patch = {
    ...intel.proposedPatch,
    source: intel.source,
    sourceId: intel.sourceId,
    category: intel.category,
    aliases: intel.aliases || []
  };
  if (existing) {
    const changed = applyOrganizationPatch(existing, patch);
    if (changed) {
      existing.lastSeenAt = Date.now();
      existing.updatedAt = Date.now();
    }
    return changed;
  }
  const org = createOrganizationFromIntel({
    name: intel.organizationName || intel.name,
    category: intel.category,
    aliases: intel.aliases || [],
    source: intel.source,
    sourceId: intel.sourceId,
    confidence: intel.confidence,
    notes: intel.reason || "",
    ...patch
  });
  if (org) {
    data.list.unshift(org);
    return true;
  }
  return false;
}

function consumePendingIntelIntoOrganizations() {
  const s = getSettings();
  const ad = ensureAutoDiscovery(s);
  const { auto } = consumeOrganizationIntel(s, { mode: ad.mode || "review", autoMergeThreshold: ad.minConfidenceToAutoAdd, autoUpdateThreshold: ad.minConfidenceToAutoUpdate });
  if (!auto.length) return false;
  let changed = false;
  for (const intel of auto) {
    if (applyOrganizationIntel(intel)) changed = true;
    removePendingIntelById(s, intel.id);
  }
  if (changed) {
    saveSettings();
    renderOrganizations();
    if ($("#uie-organization-dossier").attr("aria-hidden") === "false") renderDossier();
  }
  return changed;
}

function renderPendingIntelPanel() {
  const s = getSettings();
  const pending = Array.isArray(s.factions?.pendingIntel) ? s.factions.pendingIntel : [];
  if (!pending.length) {
    $("#uie-org-intel-container").html("");
    return;
  }
  $("#uie-org-intel-container").html(`
    <div class="uie-org-intel-panel" style="margin-top:12px;">
      <h4 class="uie-org-section-title"><i class="fa-solid fa-satellite-dish"></i> Intel Found (${pending.length})</h4>
      ${pending.map((intel, idx) => {
        const patch = intel.proposedPatch || {};
        const changes = [];
        if (patch.members?.length) changes.push(`${patch.members.length} member(s)`);
        if (patch.base) changes.push(`base: ${patch.base}`);
        if (patch.controlledSpaces?.length) changes.push(`${patch.controlledSpaces.length} location(s)`);
        if (patch.activeHooks?.length) changes.push(`${patch.activeHooks.length} hook(s)`);
        if (patch.currentIssues?.length) changes.push(`${patch.currentIssues.length} issue(s)`);
        if (patch.runIns?.length) changes.push(`${patch.runIns.length} run-in(s)`);
        if (patch.majorEvents?.length) changes.push(`${patch.majorEvents.length} event(s)`);
        if (patch.rumors?.length) changes.push(`${patch.rumors.length} rumor(s)`);
        if (patch.heatDelta) changes.push(`heat ${patch.heatDelta > 0 ? "+" : ""}${patch.heatDelta}`);
        if (patch.standingDelta) changes.push(`standing ${patch.standingDelta > 0 ? "+" : ""}${patch.standingDelta}`);
        const changesText = changes.length ? changes.join(", ") : "New organization data";
        return `
        <div class="uie-org-intel-item" data-intel-index="${idx}">
          <div class="uie-org-intel-header">
            <span class="uie-org-intel-name">${esc(intel.organizationName || intel.name || "Unknown")}</span>
            <span class="uie-org-intel-meta">${esc(intel.source || "unknown")} &bull; ${Math.round((Number(intel.confidence) || 0) * 100)}%</span>
          </div>
          <div class="uie-org-intel-reason">${esc(intel.reason || "New organization detected.")}</div>
          <div class="uie-org-intel-reason" style="color:#8ab4f8;font-size:9px;">Proposed: ${esc(changesText)}</div>
          <div class="uie-org-intel-actions">
            <button type="button" class="uie-org-btn primary" data-intel-accept="${esc(intel.id)}"><i class="fa-solid fa-check"></i> Accept</button>
            <button type="button" class="uie-org-btn danger" data-intel-reject="${esc(intel.id)}"><i class="fa-solid fa-xmark"></i> Reject</button>
            <button type="button" class="uie-org-btn" data-intel-merge="${esc(intel.id)}"><i class="fa-solid fa-code-merge"></i> Merge</button>
            <button type="button" class="uie-org-btn" data-intel-edit="${idx}"><i class="fa-solid fa-pen"></i> Edit</button>
          </div>
        </div>
      `;}).join("")}
    </div>
  `);
}

function deleteCurrentOrganization() {
  const s = getSettings();
  const data = normalizeFactions(s);
  const deleted = data.list.find((org) => String(org.id) === String(selectedId));
  data.list = data.list.filter((org) => String(org.id) !== String(selectedId));
  selectedId = String(data.list[0]?.id || "");
  saveSettings();
  closeDossier();
  renderOrganizations();
  if (deleted) { try { injectRpEvent(`[System: Organization deleted: ${deleted.name}.]`); } catch (_) {} }
}

function startRunInAutoSync() {
  if (runInObserver || window.UIE_orgRunInObserver) return;
  const chat = document.querySelector("#chat");
  if (!chat) { setTimeout(() => { try { startRunInAutoSync(); } catch (_) {} }, 1000); return; }
  const sync = () => {
    try {
      if (!window.UIE_bootFinished) return;
      const last = $(".chat-msg-txt").last();
      const raw = String(last.length ? last.text() : (Array.from(chat.querySelectorAll(".mes")).pop()?.textContent || "")).trim();
      if (raw.length < 12) return;
      const hash = `${raw.length}:${raw.slice(0, 80)}:${raw.slice(-80)}`;
      if (window.UIE_orgRunInLastHash === hash) return;
      window.UIE_orgRunInLastHash = hash;
      const s = getSettings();
      const data = normalizeFactions(s);
      let changed = false;
      for (const org of data.list || []) {
        const name = String(org?.name || "").trim();
        if (name.length < 3) continue;
        if (!raw.toLowerCase().includes(name.toLowerCase())) continue;
        if (!Array.isArray(org.runIns)) org.runIns = [];
        const note = `Auto ${new Date().toLocaleDateString()}: ${raw.replace(/\s+/g, " ").slice(0, 220)}`;
        if (!org.runIns.some((item) => String(item || "").includes(note.slice(0, 90)))) {
          org.runIns.unshift(note);
          org.runIns = org.runIns.slice(0, 80);
          org.updatedAt = Date.now();
          changed = true;
        }
      }
      const ad = ensureAutoDiscovery(s);
      if (ad.enabled && ad.sources?.chat) {
        const candidates = extractOrganizationIntelFromText(raw, "chat");
        if (candidates.length) processOrganizationIntel(candidates);
      }
      if (changed) {
        saveSettings();
        if ($("#uie-factions-window").is(":visible")) {
          renderOrganizations();
          if ($("#uie-organization-dossier").attr("aria-hidden") === "false") renderDossier();
        }
      }
    } catch (_) {}
  };
  runInObserver = new MutationObserver(() => {
    if (intelDebounceTimer) clearTimeout(intelDebounceTimer);
    intelDebounceTimer = setTimeout(sync, 300);
  });
  runInObserver.observe(chat, { childList: true, subtree: true });
  window.UIE_orgRunInObserver = runInObserver;
}

export function renderFactions() { renderOrganizations(); }

export function openFactions(mode = "") {
  initFactions();
  $("#uie-factions-window").css("display", "flex");
  if (mode === "laws" && currentOrganization()) {
    openDossier(currentOrganization().id);
    activateDossierTab("rules");
    setTimeout(() => $("#uie-org-law-text").trigger("focus"), 0);
  }
}

function _onOrgIntelEvent() {
  try {
    const s = getSettings();
    consumePendingIntelIntoOrganizations();
    saveSettings();
    if ($("#uie-factions-window").is(":visible")) renderOrganizations();
  } catch (_) {}
}

export function initFactions() {
  normalizeFactions(getSettings());
  consumePendingIntelIntoOrganizations();
  renderOrganizations();
  startRunInAutoSync();

  window.removeEventListener("uie:organization_intel", _onOrgIntelEvent);
  window.addEventListener("uie:organization_intel", _onOrgIntelEvent);

  $(document)
    .off(".uieOrg")
    .on("click.uieOrg", "#uie-faction-close", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if ($("#uie-org-member-modal").is(":visible") || $("#uie-org-member-modal").css("display") === "flex") {
        clearMemberModal();
        $("#uie-org-member-modal").hide();
        return;
      }
      if ($("#uie-org-template-modal").is(":visible") || $("#uie-org-template-modal").css("display") === "flex") {
        $("#uie-org-template-modal").hide();
        return;
      }
      if ($("#uie-organization-dossier").attr("aria-hidden") === "false" || $("#uie-organization-dossier").is(":visible") || $("#uie-organization-dossier").css("display") === "flex") {
        closeDossier();
        return;
      }
      $("#uie-factions-window").hide();
    })
    .on("click.uieOrg", "#uie-org-new", (event) => {
      event.preventDefault();
      createOrganization();
    })
    .on("click.uieOrg", "[data-org-template]", function (event) {
      event.preventDefault();
      const key = String($(this).attr("data-org-template") || "");
      $("#uie-org-template-modal").hide();
      createOrganization(key);
    })
    .on("click.uieOrg", "#uie-org-template-close", (event) => {
      event.preventDefault();
      event.stopPropagation();
      $("#uie-org-template-modal").hide();
    })
    .on("click.uieOrg", "#uie-org-template-modal", function (event) {
      if (event.target === this) $("#uie-org-template-modal").hide();
    })
    .on("click.uieOrg", ".uie-org-name,[data-org-open]", function (event) {
      event.preventDefault();
      const orgId = $(this).attr("data-org-open") || $(this).closest("[data-org-open]").attr("data-org-open");
      if (orgId && !$(this).closest("[data-org-join]").length) openDossier(orgId);
    })
    .on("click.uieOrg", "[data-org-join]", function (event) {
      event.preventDefault();
      event.stopPropagation();
      joinOrganization($(this).attr("data-org-join"));
    })
    .on("click.uieOrg", "#uie-org-dossier-close", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeDossier();
    })
    .on("click.uieOrg", ".uie-org-tab", function (event) {
      event.preventDefault();
      activateDossierTab($(this).attr("data-org-tab"));
    })
    .on("click.uieOrg", "[data-org-filter]", function (event) {
      event.preventDefault();
      activeFilter = String($(this).attr("data-org-filter") || "all");
      $(".uie-org-filter-chip").removeClass("active");
      $(this).addClass("active");
      renderOrganizations();
    })
    .on("input.uieOrg", "#uie-org-search", function () {
      searchQuery = String($(this).val() || "");
      renderOrganizations();
    })
    .on("click.uieOrg", "#uie-org-scan-chat", (event) => {
      event.preventDefault();
      const chat = document.querySelector("#chat");
      const last = $(".chat-msg-txt").last();
      const raw = String(last.length ? last.text() : (Array.from(chat?.querySelectorAll(".mes") || []).pop()?.textContent || "")).trim();
      if (raw.length < 12) { try { window.toastr?.info?.("No recent chat text to scan."); } catch (_) {} return; }
      const candidates = extractOrganizationIntelFromText(raw, "chat");
      if (candidates.length) { processOrganizationIntel(candidates); try { window.toastr?.success?.(`Found ${candidates.length} organization(s) from chat.`); } catch (_) {} }
      else { try { window.toastr?.info?.("No organizations detected in recent chat."); } catch (_) {} }
    })
    .on("click.uieOrg", "#uie-org-scan-lorebook", (event) => {
      event.preventDefault();
      const s = getSettings();
      const entries = Array.isArray(s.lorebook || s.worldInfo || s.worldinfo) ? (s.lorebook || s.worldInfo || s.worldinfo) : [];
      const allText = entries.map((e) => `${e.name || ""} ${e.content || e.text || ""} ${e.comment || ""}`).join(" ");
      if (allText.length < 20) { try { window.toastr?.info?.("No lorebook entries to scan."); } catch (_) {} return; }
      const candidates = extractOrganizationIntelFromText(allText, "lorebook");
      if (candidates.length) { processOrganizationIntel(candidates); try { window.toastr?.success?.(`Found ${candidates.length} organization(s) from lorebook.`); } catch (_) {} }
      else { try { window.toastr?.info?.("No organizations detected in lorebook."); } catch (_) {} }
    })
    .on("click.uieOrg", "#uie-org-review-intel", (event) => {
      event.preventDefault();
      const s = getSettings();
      const pending = Array.isArray(s.factions?.pendingIntel) ? s.factions.pendingIntel : [];
      if (!pending.length) { try { window.toastr?.info?.("No pending intel to review."); } catch (_) {} return; }
      renderOrganizations();
      try { window.toastr?.info?.(`${pending.length} pending intel item(s) shown below.`); } catch (_) {}
    })
    .on("click.uieOrg", "[data-intel-accept]", function (event) {
      event.preventDefault();
      acceptOrganizationIntel($(this).attr("data-intel-accept"));
    })
    .on("click.uieOrg", "[data-intel-reject]", function (event) {
      event.preventDefault();
      rejectOrganizationIntel($(this).attr("data-intel-reject"));
    })
    .on("click.uieOrg", "[data-intel-merge]", function (event) {
      event.preventDefault();
      const intelId = $(this).attr("data-intel-merge");
      if (currentOrganization()) mergeIntelWithOrganization(intelId, currentOrganization().id);
      else try { window.toastr?.info?.("Open an organization dossier first to merge into."); } catch (_) {}
    })
    .on("click.uieOrg", "[data-intel-edit]", function (event) {
      event.preventDefault();
      const idx = Number($(this).attr("data-intel-edit"));
      const s = getSettings();
      const intel = (s.factions?.pendingIntel || [])[idx];
      if (!intel) return;
      const org = createOrganizationFromIntel(intel);
      if (org) {
        const data = normalizeFactions(s);
        data.list.unshift(org);
        selectedId = org.id;
        s.factions.pendingIntel.splice(idx, 1);
        saveSettings();
        renderOrganizations();
        openDossier(org.id);
        activateDossierTab("info");
      }
    })
    .on("click.uieOrg", "#uie-org-save", async (event) => {
      event.preventDefault();
      await saveCurrentOrganization({ checkMap: false });
      try { window.toastr?.success?.("Organization saved."); } catch (_) {}
    })
    .on("click.uieOrg", "#uie-org-delete", (event) => {
      event.preventDefault();
      deleteCurrentOrganization();
    })
    .on("click.uieOrg", "#uie-org-member-open", (event) => {
      event.preventDefault();
      openMemberModal();
    })
    .on("click.uieOrg", "#uie-org-member-cancel,#uie-org-member-modal-close", (event) => {
      event.preventDefault();
      clearMemberModal();
      $("#uie-org-member-modal").hide();
    })
    .on("click.uieOrg", "#uie-org-member-modal", function (event) {
      if (event.target === this) { clearMemberModal(); $("#uie-org-member-modal").hide(); }
    })
    .on("change.uieOrg", "#uie-org-member-person", function () {
      $("#uie-org-member-custom-wrap").toggle(String($(this).val() || "") === "__custom_group__");
    })
    .on("click.uieOrg", "#uie-org-member-add", async (event) => {
      event.preventDefault();
      await addMember();
    })
    .on("click.uieOrg", "#uie-org-rank-add-btn", (event) => {
      event.preventDefault();
      addRankOption();
    })
    .on("click.uieOrg", ".uie-org-rank-remove", function (event) {
      event.preventDefault();
      const org = currentOrganization();
      const index = Number($(this).attr("data-index"));
      if (!org || !Array.isArray(org.ranks) || !Number.isInteger(index)) return;
      org.ranks.splice(index, 1);
      org.updatedAt = Date.now();
      saveSettings();
      renderDossier();
    })
    .on("click.uieOrg", "#uie-org-asset-track", (event) => {
      event.preventDefault();
      addSelectedAsset();
    })
    .on("click.uieOrg", "[data-org-add]", async function (event) {
      event.preventDefault();
      await addTextItem(String($(this).attr("data-org-add") || ""));
    })
    .on("click.uieOrg", ".uie-org-item-remove", function (event) {
      event.preventDefault();
      const org = currentOrganization();
      const kind = String($(this).attr("data-kind") || "");
      const index = Number($(this).attr("data-index"));
      if (!org || !["controlledSpaces", "assets", "members", "runIns", "majorEvents"].includes(kind) || !Number.isInteger(index)) return;
      org[kind].splice(index, 1);
      org.updatedAt = Date.now();
      saveSettings();
      renderOrganizations();
      renderDossier();
    })
    .on("click.uieOrg", "[data-org-edit-member]", function (event) {
      event.preventDefault();
      event.stopPropagation();
      const index = Number($(this).attr("data-org-edit-member"));
      if (!Number.isInteger(index)) return;
      openMemberModal(index);
    })
    .on("click.uieOrg", "[data-org-map-place]", async function (event) {
      event.preventDefault();
      const org = currentOrganization();
      if (!org) return;
      await offerAddPlaceToMap(String($(this).attr("data-org-map-place") || ""), org, { type: org.baseType });
      renderOrganizations();
      renderDossier();
    })
    .on("click.uieOrg", "#uie-org-law-add", async (event) => {
      event.preventDefault();
      await addLaw();
    })
    .on("click.uieOrg", ".uie-org-law-del", function (event) {
      event.preventDefault();
      const lawId = String($(this).closest("[data-law-id]").attr("data-law-id") || "");
      const s = getSettings();
      const data = normalizeFactions(s);
      const law = data.laws.find((entry) => String(entry.id) === lawId);
      data.laws = data.laws.filter((entry) => String(entry.id) !== lawId);
      const mapHit = law?.place ? getMapNodeByName(law?.place) : null;
      if (mapHit?.node && law?.text) {
        mapHit.node.laws = (Array.isArray(mapHit.node.laws) ? mapHit.node.laws : []).filter((item) => String(item || "") !== String(law.text));
        mapHit.node.rules = (Array.isArray(mapHit.node.rules) ? mapHit.node.rules : []).filter((item) => String(item || "") !== String(law.text));
      }
      saveSettings();
      renderDossier();
    })
    .on("click.uieOrg", "[data-org-location-toggle]", function (event) {
      event.preventDefault();
      event.stopPropagation();
      const inputId = String($(this).attr("data-org-location-toggle") || "");
      openLocationDropdown(inputId, $(`#${inputId}`).val());
    })
    .on("focus.uieOrg input.uieOrg", ".uie-org-location-combo input", function () {
      openLocationDropdown(String(this.id || ""), $(this).val());
    })
    .on("click.uieOrg", ".uie-org-location-option", function (event) {
      event.preventDefault();
      event.stopPropagation();
      const combo = $(this).closest(".uie-org-location-combo");
      const inputId = String(combo.attr("data-org-location-combo") || "");
      const value = String($(this).attr("data-org-location-value") || "");
      const type = String($(this).attr("data-org-location-type") || "");
      if (inputId) $(`#${inputId}`).val(value).trigger("change");
      if (inputId === "uie-org-base" && type && !String($("#uie-org-base-type").val() || "").trim()) $("#uie-org-base-type").val(type);
      closeLocationDropdowns();
    })
    .on("click.uieOrg", function (event) {
      if (!$(event.target).closest(".uie-org-location-combo").length) closeLocationDropdowns();
    })
    .on("keydown.uieOrg", "#uie-org-space-add,#uie-org-rank-add,#uie-org-runin-add,#uie-org-event-add,#uie-org-law-text,#uie-org-member-custom-name,#uie-org-member-rank-new,#uie-org-member-role,#uie-org-member-authority,#uie-org-member-location,#uie-org-member-notes", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const idAttr = String(this.id || "");
      if (idAttr === "uie-org-law-text") $("#uie-org-law-add").trigger("click");
      else if (idAttr === "uie-org-rank-add") $("#uie-org-rank-add-btn").trigger("click");
      else if (idAttr.startsWith("uie-org-member-")) $("#uie-org-member-add").trigger("click");
      else $(this).closest(".uie-org-add-row").find("[data-org-add]").trigger("click");
    });
}

try {
  window.UIE_openFactions = openFactions;
  window.UIE_openOrganizations = openFactions;
} catch (_) {}
