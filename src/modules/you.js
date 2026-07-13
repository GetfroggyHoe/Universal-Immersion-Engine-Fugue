import { getSettings, saveSettings } from "./core.js";
import { formatRemaining, normalizeStatusList } from "./statusFx.js";

let initialized = false;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function slug(value, fallback = "you") {
  const raw = String(value || "").trim().toLowerCase();
  const clean = raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function firstText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map((x) => String(x || "").trim()).filter(Boolean).join(", ");
      if (joined) return joined;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function sameId(a, b) {
  const aa = String(a || "").trim().toLowerCase();
  const bb = String(b || "").trim().toLowerCase();
  return !!aa && !!bb && aa === bb;
}

function activePersona(s) {
  const personas = Array.isArray(s.personas) ? s.personas : [];
  const activeId = String(s.activePersonaId || s.character?.activePersonaId || "").trim();
  return personas.find((p) => sameId(p?.id, activeId))
    || personas.find((p) => sameId(p?.name, s.character?.name))
    || personas[0]
    || null;
}

function activeYouKey(s, persona = activePersona(s)) {
  const explicit = String(s.activePersonaId || s.character?.activePersonaId || persona?.id || "").trim();
  if (explicit && explicit !== "__uie_narrator__") return slug(explicit, "you");
  const name = firstText(s.character?.id, persona?.id, s.character?.name, persona?.name, "you");
  return slug(name, "you");
}

function photoFor(s, persona) {
  return firstText(
    s.character?.portrait,
    s.character?.avatar,
    s.character?.photo,
    persona?.portrait,
    persona?.avatar,
    persona?.photo,
    persona?.image,
    persona?.url
  );
}

function collectStatusEffects(s) {
  const raw = [
    ...asArray(s.statusEffects),
    ...asArray(s.character?.statusEffects),
    ...asArray(s.inventory?.statusEffects),
    ...asArray(s.inventory?.vitals?.statusEffects)
  ];
  return normalizeStatusList(raw).filter((fx) => {
    const t = Number(fx?.expiresAt || 0);
    return !Number.isFinite(t) || !t || t > Date.now();
  });
}

function allSocialPeople(s) {
  const out = [];
  const social = s.social && typeof s.social === "object" ? s.social : {};
  for (const tab of ["family", "romance", "friends", "associates", "rivals"]) {
    for (const person of Array.isArray(social[tab]) ? social[tab] : []) {
      if (!person || typeof person !== "object") continue;
      out.push({ ...person, tab });
    }
  }
  return out;
}

function rosterMap(s, persona) {
  const map = new Map();
  const add = (person = {}, fallbackId = "") => {
    const id = String(person.id || person.key || fallbackId || person.name || "").trim();
    const name = String(person.name || person.title || id || "").trim();
    if (!id && !name) return;
    const rec = { id: id || slug(name), name: name || id, ...person };
    for (const key of [rec.id, rec.name]) {
      const clean = String(key || "").trim().toLowerCase();
      if (clean && !map.has(clean)) map.set(clean, rec);
    }
  };
  add({ ...(s.character || {}), name: s.character?.name || persona?.name || "You" }, activeYouKey(s, persona));
  for (const p of Array.isArray(s.personas) ? s.personas : []) add(p);
  for (const p of allSocialPeople(s)) add(p);
  for (const [id, rec] of Object.entries(s.relationships || {})) add(rec, id);
  return map;
}

function nameForId(roster, id, fallback = "") {
  const key = String(id || "").trim().toLowerCase();
  const rec = key ? roster.get(key) : null;
  return String(rec?.name || fallback || id || "").trim();
}

function roleText(person) {
  return String(person?.familyRole || person?.relationshipStatus || person?.role || "").trim().toLowerCase();
}

function uniqueNames(names) {
  const out = [];
  const seen = new Set();
  for (const raw of names) {
    const name = String(raw || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function lineageFor(s, key, persona) {
  const roster = rosterMap(s, persona);
  const tree = s.lineageTree && typeof s.lineageTree === "object" ? s.lineageTree : {};
  const ids = [
    key,
    s.activePersonaId,
    s.character?.activePersonaId,
    persona?.id,
    persona?.name,
    s.character?.id,
    s.character?.name,
    "player"
  ].filter(Boolean);
  const treeKey = ids.find((id) => tree[id]) || ids.find((id) => tree[slug(id)]) || "";
  const node = tree[treeKey] || tree[slug(treeKey)] || {};
  const contacts = allSocialPeople(s);

  const parentIds = [
    node.parentId,
    ...(Array.isArray(node.parentIds) ? node.parentIds : [])
  ].filter(Boolean);
  const parents = uniqueNames([
    ...parentIds.map((id) => nameForId(roster, id)),
    ...contacts.filter((p) => /\b(parent|mother|father|guardian)\b/i.test(roleText(p)) && !/\bgrand\b/i.test(roleText(p))).map((p) => p.name)
  ]);

  const grandparentIds = [];
  for (const parentId of parentIds) {
    const pNode = tree[parentId] || tree[slug(parentId)] || {};
    if (pNode.parentId) grandparentIds.push(pNode.parentId);
    if (Array.isArray(pNode.parentIds)) grandparentIds.push(...pNode.parentIds);
  }
  const grandparents = uniqueNames([
    ...grandparentIds.map((id) => nameForId(roster, id)),
    ...contacts.filter((p) => /\b(grandparent|grandmother|grandfather)\b/i.test(roleText(p))).map((p) => p.name)
  ]);

  const childIds = Array.isArray(node.childIds) ? node.childIds : [];
  const children = uniqueNames([
    ...childIds.map((id) => nameForId(roster, id)),
    ...contacts.filter((p) => /\b(child|daughter|son)\b/i.test(roleText(p))).map((p) => p.name)
  ]);

  return { parents, grandparents, children };
}

function chosenPartner(s, key, persona) {
  const roster = rosterMap(s, persona);
  const direct = firstText(
    s.character?.spouse,
    s.character?.partner,
    s.character?.spouseName,
    s.character?.partnerName,
    s.you?.spouse,
    s.you?.partner
  );
  if (direct) return direct;

  const partnerId = firstText(s.character?.spouseId, s.character?.partnerId, s.you?.spouseId, s.you?.partnerId);
  if (partnerId) return nameForId(roster, partnerId, partnerId);

  const tree = s.lineageTree && typeof s.lineageTree === "object" ? s.lineageTree : {};
  const ids = [key, s.activePersonaId, s.character?.activePersonaId, persona?.id, persona?.name, s.character?.id, s.character?.name, "player"].filter(Boolean);
  const treeKey = ids.find((id) => tree[id]) || ids.find((id) => tree[slug(id)]) || "";
  const spouseId = firstText(tree[treeKey]?.spouseId, tree[slug(treeKey)]?.spouseId);
  if (spouseId) return nameForId(roster, spouseId, spouseId);

  const actual = allSocialPeople(s).find((p) => {
    if (p.tab !== "romance" && p.tab !== "family") return false;
    const role = roleText(p);
    return /\b(married|spouse|husband|wife|partner|fiance|fiancee)\b/i.test(role);
  });
  return actual?.name || "";
}

function currentSchool(s, persona) {
  return firstText(
    s.character?.school,
    persona?.school,
    s.academy?.profile?.school,
    s.academy?.profile?.name,
    s.school?.profile?.name,
    s.school?.name
  );
}

function currentOccupation(s, persona) {
  return firstText(
    s.character?.occupation,
    s.character?.job,
    s.character?.profession,
    persona?.occupation,
    persona?.job,
    persona?.profession,
    s.jobs?.current?.title,
    s.jobs?.currentJob?.title
  );
}

function currentAffiliation(s, persona) {
  const orgNames = [];
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === "object") add(value.name || value.label || "");
    else {
      const text = String(value || "").trim();
      if (text && !/^(none|unaffiliated|n\/a|na|-|\[object object\])$/i.test(text)) orgNames.push(text);
    }
  };
  add(s.character?.organizationAffiliations);
  add(persona?.organizationAffiliations);
  const userName = String(s.character?.name || persona?.name || "").trim().toLowerCase();
  const factions = s.factions && typeof s.factions === "object" ? s.factions.list : s.factions;
  (Array.isArray(factions) ? factions : []).forEach((org) => {
    const status = String(org?.membershipStatus || "").trim();
    const memberHit = (Array.isArray(org?.members) ? org.members : []).some((member) => {
      const memberName = String(member?.name || member || "").trim().toLowerCase();
      return memberName && userName && memberName === userName;
    });
    if (memberHit || (status && !/^(none|stranger|enemy|outcast)$/i.test(status))) add(org?.name);
  });
  if (orgNames.length) return Array.from(new Set(orgNames))[0];
  return firstText(
    s.character?.affiliation,
    s.character?.faction,
    s.character?.organization,
    persona?.affiliation,
    persona?.faction,
    persona?.organization,
    s.organizationAffiliations,
    s.affiliations
  );
}

function buildSnapshot(s) {
  const persona = activePersona(s);
  const key = activeYouKey(s, persona);
  const vit = s.inventory?.vitals && typeof s.inventory.vitals === "object" ? s.inventory.vitals : {};
  const stats = (s.character?.stats && typeof s.character.stats === "object") ? { ...s.character.stats } : {};
  const lineage = lineageFor(s, key, persona);
  const name = firstText(s.character?.name, persona?.name, "You");
  const className = firstText(s.character?.className, s.character?.class, persona?.className, persona?.class, "Adventurer");
  const level = Number(s.character?.level || s.level || persona?.level || 1) || 1;
  return {
    key,
    name,
    className,
    level,
    photo: photoFor(s, persona),
    occupation: currentOccupation(s, persona),
    school: currentSchool(s, persona),
    affiliation: currentAffiliation(s, persona),
    partner: chosenPartner(s, key, persona),
    lineage,
    statusEffects: collectStatusEffects(s),
    stats,
    vitals: {
      hp: Number.isFinite(Number(s.hp)) ? Number(s.hp) : Number(vit.hp || 0),
      maxHp: Number.isFinite(Number(s.maxHp)) ? Number(s.maxHp) : Number(vit.maxHp || 0),
      mp: Number.isFinite(Number(s.mp)) ? Number(s.mp) : Number(vit.mp || 0),
      maxMp: Number.isFinite(Number(s.maxMp)) ? Number(s.maxMp) : Number(vit.maxMp || 0),
      ap: Number.isFinite(Number(s.ap)) ? Number(s.ap) : Number(vit.sp || 0),
      maxAp: Number.isFinite(Number(s.maxAp)) ? Number(s.maxAp) : Number(vit.maxSp || 0),
      xp: Number.isFinite(Number(s.xp)) ? Number(s.xp) : Number(vit.xp || 0),
      maxXp: Number.isFinite(Number(s.maxXp)) ? Number(s.maxXp) : Number(vit.maxXp || 0)
    },
    location: firstText(s.worldState?.location, s.map?.location),
    updatedAt: Date.now()
  };
}

function updateYouFile() {
  const s = getSettings();
  if (!s.youFiles || typeof s.youFiles !== "object") s.youFiles = {};
  const snapshot = buildSnapshot(s);
  const existing = s.youFiles[snapshot.key];
  const file = existing && typeof existing === "object"
    ? existing
    : { id: snapshot.key, createdAt: Date.now(), readOnly: true };
  file.readOnly = true;
  file.snapshot = snapshot;
  file.updatedAt = snapshot.updatedAt;
  s.youFiles[snapshot.key] = file;
  s.activeYouFileId = snapshot.key;
  saveSettings();
  return file;
}

function renderVitals(vitals = {}) {
  const rows = [
    ["HP", vitals.hp, vitals.maxHp],
    ["MP", vitals.mp, vitals.maxMp],
    ["AP", vitals.ap, vitals.maxAp],
    ["XP", vitals.xp, vitals.maxXp]
  ];
  return rows.map(([label, raw, rawMax]) => {
    const value = Number(raw || 0);
    const max = Math.max(0, Number(rawMax || 0));
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
    const text = max > 0 ? `${value}/${max}` : `${value}`;
    return `<div class="uie-you-vital"><span>${esc(label)}</span><div class="uie-you-track"><div class="uie-you-fill" style="width:${pct}%"></div></div><span>${esc(text)}</span></div>`;
  }).join("");
}

function renderKv(label, value) {
  return `<div class="uie-you-kv"><span>${esc(label)}</span><b>${esc(value || "None")}</b></div>`;
}

function renderLine(label, values = []) {
  const text = Array.isArray(values) && values.length ? values.join(", ") : "None";
  return `<div class="uie-you-line"><span>${esc(label)}</span><b>${esc(text)}</b></div>`;
}

export function renderYou() {
  const $win = $("#uie-you-window");
  if (!$win.length) return;
  const file = updateYouFile();
  const snap = file.snapshot || {};
  const photo = String(snap.photo || "").trim();
  $("#uie-you-photo").html(photo ? `<img src="${esc(photo)}" alt="">` : `<i class="fa-solid fa-user"></i>`);
  $("#uie-you-name").text(snap.name || "You");
  $("#uie-you-class-level").text(`Level ${snap.level || 1} ${snap.className || "Adventurer"}`);
  $("#uie-you-vitals").html(renderVitals(snap.vitals || {}));
  $("#uie-you-core-grid").html([
    renderKv("Occupation", snap.occupation),
    renderKv("School", snap.school),
    renderKv("Affiliation", snap.affiliation),
    renderKv("Spouse / Partner", snap.partner),
    renderKv("Location", snap.location),
    renderKv("File", snap.key)
  ].join(""));

  const effects = Array.isArray(snap.statusEffects) ? snap.statusEffects : [];
  $("#uie-you-status-list").html(effects.length
    ? effects.map((fx) => {
      const rem = formatRemaining(fx.expiresAt);
      return `<span class="uie-you-effect">${esc(fx.name || "Effect")}${rem ? `<small>${esc(rem)}</small>` : ""}</span>`;
    }).join("")
    : `<div class="uie-you-empty">None</div>`);

  const stats = snap.stats && typeof snap.stats === "object" ? snap.stats : {};
  const statEntries = Object.entries(stats).filter(([k]) => String(k || "").trim());
  $("#uie-you-stats-grid").html(statEntries.length
    ? statEntries.map(([key, value]) => `<div class="uie-you-stat"><span>${esc(key)}</span><b>${esc(value)}</b></div>`).join("")
    : `<div class="uie-you-empty">No stats recorded</div>`);

  const lineage = snap.lineage || {};
  $("#uie-you-lineage-grid").html([
    renderLine("Parents", lineage.parents || []),
    renderLine("Grandparents", lineage.grandparents || []),
    renderLine("Children", lineage.children || [])
  ].join(""));
}

export function initYou() {
  if (initialized) return;
  initialized = true;
  const $doc = $(document);
  $doc.off("click.uieYouClose", "#uie-you-close").on("click.uieYouClose", "#uie-you-close", (event) => {
    event.preventDefault();
    $("#uie-you-window").hide();
  });
  $doc.off("click.uieYouRefresh", "#uie-you-refresh").on("click.uieYouRefresh", "#uie-you-refresh", (event) => {
    event.preventDefault();
    renderYou();
  });
  window.addEventListener("uie:state_updated", () => {
    try {
      if ($("#uie-you-window").is(":visible")) renderYou();
    } catch (_) {}
  });
}

export async function openYou() {
  initYou();
  const $win = $("#uie-you-window");
  if ($win.length) {
    $(".uie-window").not("#uie-you-window").hide();
    $win.css("display", "flex");
    renderYou();
  }
}

try {
  window.UIE_openYouWindow = openYou;
  window.UIE_renderYou = renderYou;
} catch (_) {}
