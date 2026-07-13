import { getSettings, saveSettings } from "./core.js";

const ORG_CATEGORY_KEYWORDS = {
  guild: /\bguild\b|\btrade\b|\bcraft\b|\bartisan\b|\bblacksmith\b/i,
  school: /\bschool\b|\bacademy\b|\buniversity\b|\bcollege\b|\binstitute\b/i,
  club: /\bclub\b|\bsociety\b|\bcircle\b|\bsorority\b|\bfraternity\b/i,
  government: /\bgovernment\b|\bministry\b|\bsenate\b|\bparliament\b|\bcrown\b|\bstate\b|\bempire\b/i,
  council: /\bcouncil\b|\bassembly\b|\bcongress\b|\bcommittee\b|\bboard\b/i,
  crew: /\bcrew\b|\bship\b|\bvessel\b|\bsquad\b|\bunit\b/i,
  gang: /\bgang\b|\bmafia\b|\bsyndicate\b|\bcartel\b|\bmob\b/i,
  company: /\bcompany\b|\bcorp\b|\binc\b|\bltd\b|\bfirm\b|\bbusiness\b|\benterprise\b/i,
  agency: /\bagency\b|\bbureau\b|\boffice\b|\bdivision\b|\bdepartment\b|\bintelligence\b/i,
  cult: /\bcult\b|\btemple\b|\bchurch\b|\bsect\b|\bbrotherhood\b|\bsisterhood\b|\bfaith\b/i,
  order: /\border\b|\bknight\b|\bpaladin\b|\btemplar\b|\bmonk\b|\bmonastery\b/i,
  family: /\bfamily\b|\bhouse\b|\bclan\b|\bdynasty\b|\blineage\b|\btribe\b/i,
  team: /\bteam\b|\bsquad\b|\bparty\b|\bsports\b|\bleague\b/i
};

const ORG_NAME_PATTERN = /\b(guild|club|council|crew|gang|family|house|company|agency|order|cult|team|school|academy|government|watch|guard|syndicate|union|committee|department|class|faction|tribe|clan|brotherhood|sisterhood|sect|temple|church|ministry|senate|parliament|corporation|firm|bureau|office|society|circle|league|band|pack|ring|cartel|mafia|mob)\b/i;

function busId(prefix = "intel") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function inferCategory(name, text) {
  const hay = `${name || ""} ${text || ""}`.toLowerCase();
  for (const [key, pattern] of Object.entries(ORG_CATEGORY_KEYWORDS)) {
    if (pattern.test(hay)) return key;
  }
  return "";
}

function clampNum(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizePatch(raw = {}) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  const str = (key) => { const v = String(raw[key] || "").trim(); return v || undefined; };
  const list = (key) => Array.isArray(raw[key]) ? raw[key].map((x) => String(x || "").trim()).filter(Boolean) : undefined;
  const num = (key) => Number.isFinite(Number(raw[key])) ? Number(raw[key]) : undefined;

  if (str("leader")) out.leader = str("leader");
  if (str("leaderTitle")) out.leaderTitle = str("leaderTitle");
  if (list("members")) out.members = list("members");
  if (list("ranks")) out.ranks = list("ranks");
  if (str("base")) out.base = str("base");
  if (str("baseType")) out.baseType = str("baseType");
  if (list("controlledSpaces")) out.controlledSpaces = list("controlledSpaces");
  if (list("allies")) out.allies = list("allies");
  if (list("rivals")) out.rivals = list("rivals");
  if (list("rumors")) out.rumors = list("rumors");
  if (list("secrets")) out.secrets = list("secrets");
  if (list("currentIssues")) out.currentIssues = list("currentIssues");
  if (list("activeHooks")) out.activeHooks = list("activeHooks");
  if (list("majorEvents")) out.majorEvents = list("majorEvents");
  if (list("runIns")) out.runIns = list("runIns");
  if (list("services")) out.services = list("services");
  if (list("perks")) out.perks = list("perks");
  if (list("obligations")) out.obligations = list("obligations");
  if (list("entryRequirements")) out.entryRequirements = list("entryRequirements");
  if (str("membershipStatus")) out.membershipStatus = str("membershipStatus");
  if (str("accessLevel")) out.accessLevel = str("accessLevel");
  if (num("heatDelta") !== undefined) out.heatDelta = clampNum(raw.heatDelta, -100, 100);
  if (num("standingDelta") !== undefined) out.standingDelta = clampNum(raw.standingDelta, -100, 100);
  if (num("trustDelta") !== undefined) out.trustDelta = clampNum(raw.trustDelta, -100, 100);
  if (num("fearDelta") !== undefined) out.fearDelta = clampNum(raw.fearDelta, -100, 100);
  if (list("scheduleHints")) out.scheduleHints = list("scheduleHints");
  return out;
}

function normalizePeople(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    if (!p || typeof p !== "object") return null;
    const name = String(p.name || "").trim();
    if (!name) return null;
    return {
      name,
      rank: String(p.rank || p.status || "").trim(),
      role: String(p.role || p.job || "").trim(),
      location: String(p.location || p.currentLocation || "").trim(),
      sourceType: String(p.sourceType || p.source || "").trim(),
      sourceId: String(p.sourceId || p.id || "").trim(),
      count: Math.max(1, Math.floor(Number(p.count || 1) || 1))
    };
  }).filter(Boolean);
}

export function normalizeOrganizationIntel(input = {}) {
  if (!input || typeof input !== "object") return null;
  const name = String(input.organizationName || input.name || "").trim();
  if (!name) return null;
  const source = String(input.source || "unknown").trim();
  const sourceId = String(input.sourceId || "").trim();
  const confidence = clampNum(input.confidence ?? 0.5, 0, 1);
  const category = String(input.category || inferCategory(name, input.text || "")).trim();
  const text = String(input.text || "").trim();
  const reason = String(input.reason || "").trim();
  const aliases = Array.isArray(input.aliases)
    ? input.aliases.map((a) => String(a || "").trim()).filter(Boolean)
    : [];
  const people = normalizePeople(input.people);
  const proposedPatch = normalizePatch(input.proposedPatch || {});

  return {
    id: String(input.id || busId("intel")).trim(),
    source,
    sourceId,
    confidence,
    reason: reason || `Organization intel from ${source}.`,
    text,
    organizationName: name,
    aliases,
    category,
    people,
    proposedPatch,
    createdAt: Number(input.createdAt || Date.now())
  };
}

function ensureFactionsShape(s) {
  if (!s.factions || typeof s.factions !== "object") s.factions = {};
  if (!Array.isArray(s.factions.pendingIntel)) s.factions.pendingIntel = [];
  if (!Array.isArray(s.factions.intelLog)) s.factions.intelLog = [];
  return s.factions;
}

export function publishOrganizationIntel(input = {}) {
  const intel = normalizeOrganizationIntel(input);
  if (!intel) return null;
  const s = getSettings();
  const factions = ensureFactionsShape(s);
  const nameKey = normalizeKey(intel.organizationName);
  const sourceKey = `${intel.source}:${intel.sourceId || intel.organizationName}`.toLowerCase();
  const recentWindow = Date.now() - 30000;
  const duplicate = factions.pendingIntel.some((existing) => {
    if (normalizeKey(existing.organizationName) !== nameKey) return false;
    if (existing.source === intel.source && existing.sourceId === intel.sourceId) return true;
    if (Number(existing.createdAt || 0) > recentWindow && existing.confidence >= intel.confidence) return true;
    return false;
  });
  if (duplicate) return null;
  factions.pendingIntel.push(intel);
  factions.pendingIntel = factions.pendingIntel.slice(-100);
  factions.intelLog.push({ ...intel, consumedAt: 0 });
  factions.intelLog = factions.intelLog.slice(-200);
  try { saveSettings(); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent("uie:organization_intel", { detail: { intel, source: intel.source } })); } catch (_) {}
  return intel;
}

export function consumeOrganizationIntel(settings, options = {}) {
  const s = settings || getSettings();
  const factions = ensureFactionsShape(s);
  const mode = String(options.mode || "review").trim();
  const autoMergeThreshold = clampNum(options.autoMergeThreshold ?? 0.78, 0, 1);
  const autoUpdateThreshold = clampNum(options.autoUpdateThreshold ?? 0.65, 0, 1);
  const pending = [...factions.pendingIntel];
  const auto = [];
  const review = [];
  for (const intel of pending) {
    if (intel.confidence >= autoMergeThreshold && mode === "silent") {
      auto.push(intel);
    } else if (intel.confidence >= autoUpdateThreshold && mode === "aggressive") {
      auto.push(intel);
    } else {
      review.push(intel);
    }
  }
  return { auto, review, pending, mode };
}

export function queueOrganizationIntel(settings, intel) {
  const normalized = normalizeOrganizationIntel(intel);
  if (!normalized) return null;
  const s = settings || getSettings();
  const factions = ensureFactionsShape(s);
  factions.pendingIntel.push(normalized);
  factions.pendingIntel = factions.pendingIntel.slice(-100);
  try { saveSettings(); } catch (_) {}
  return normalized;
}

export function getPendingOrganizationIntel(settings) {
  const s = settings || getSettings();
  const factions = ensureFactionsShape(s);
  return [...factions.pendingIntel];
}

export function clearOrganizationIntelQueue(settings) {
  const s = settings || getSettings();
  const factions = ensureFactionsShape(s);
  const cleared = factions.pendingIntel.length;
  factions.pendingIntel = [];
  try { saveSettings(); } catch (_) {}
  return cleared;
}

export function removePendingIntelById(settings, intelId) {
  const s = settings || getSettings();
  const factions = ensureFactionsShape(s);
  const before = factions.pendingIntel.length;
  factions.pendingIntel = factions.pendingIntel.filter((i) => String(i.id) !== String(intelId));
  const removed = before - factions.pendingIntel.length;
  if (removed) try { saveSettings(); } catch (_) {}
  return removed > 0;
}

export function detectOrganizationNamesInText(text) {
  if (!text || typeof text !== "string") return [];
  const found = new Set();
  const namePattern = /(?:the|a|an)\s+([A-Z][A-Za-z\s]{2,30}?)\s+(guild|club|council|crew|gang|family|house|company|agency|order|cult|team|school|academy|watch|guard|syndicate|union|committee|department|faction|tribe|clan|brotherhood|sisterhood|sect|temple|church|ministry|senate|parliament|corporation|firm|bureau|office|society|circle|league|band|pack|ring|cartel|mafia|mob)/gi;
  let match;
  while ((match = namePattern.exec(text)) !== null) {
    const fullName = `${match[1].trim()} ${match[2]}`.trim();
    if (fullName.length >= 4) found.add(fullName);
  }
  const leaderPattern = /([A-Z][A-Za-z\s]{2,30}?)\s+(?:captain|president|director|chief|boss|leader|head|commander|chair|founder)\s+(?:of|from|in|at)\s+(?:the\s+)?([A-Z][A-Za-z\s]{2,30}?)(?:\.|,|$)/gi;
  while ((match = leaderPattern.exec(text)) !== null) {
    const orgName = match[2].trim();
    if (orgName.length >= 3) found.add(orgName);
  }
  return Array.from(found);
}

export { ORG_NAME_PATTERN, ORG_CATEGORY_KEYWORDS };

try {
  window.UIE_ORG_INTEL_BUS = {
    publishOrganizationIntel,
    consumeOrganizationIntel,
    normalizeOrganizationIntel,
    queueOrganizationIntel,
    getPendingOrganizationIntel,
    clearOrganizationIntelQueue,
    removePendingIntelById,
    detectOrganizationNamesInText
  };
} catch (_) {}
