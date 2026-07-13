import { getSettings } from "./core.js";
import { ensureMmoState, persistMmo, esc, uid, pick, clampText, getWorldBrief, aiJson, normalizeRole, randomName, toast } from "./mmoCommon.js";

let initialized = false;
let aiInFlight = false;

const DUNGEONS = [
  "Echo Vault",
  "Sunken Choir",
  "Aster Rift",
  "Glassroot Hollow",
  "Midnight Foundry",
  "Crownless Gate",
];

const CLASSES = {
  Tank: ["Guardian", "Vanguard", "Spellshield", "Bulwark"],
  Healer: ["Cleric", "Mender", "Cantor", "Lifebinder"],
  DPS: ["Arcanist", "Ranger", "Duelist", "Hexblade", "Gunner"],
};

function listing(raw = {}) {
  const dungeon = clampText(raw.dungeon || raw.name || pick(DUNGEONS), 80);
  const leader = clampText(raw.leader || randomName(), 48);
  const need = Array.isArray(raw.need) && raw.need.length ? raw.need.map(normalizeRole).slice(0, 3) : [pick(["Tank", "Healer", "DPS"])];
  return {
    id: raw.id || uid("lfg"),
    ts: Number(raw.ts || Date.now()) || Date.now(),
    dungeon,
    leader,
    level: Math.max(1, Math.min(99, Math.floor(Number(raw.level || (3 + Math.random() * 17))))),
    need,
    note: clampText(raw.note || pick([
      "Chill run, first-timers welcome.",
      "Quick clear, know basic mechanics.",
      "Exploration pace, loot all side rooms.",
      "Need steady comms and patience.",
    ]), 160),
  };
}

function ensureListings(s) {
  const m = ensureMmoState(s);
  const stale = Date.now() - Number(m.lfg.lastGeneratedAt || 0) > 8 * 60 * 1000;
  if (m.lfg.listings.length >= 4 && !stale) return;
  const count = 6;
  m.lfg.listings = Array.from({ length: count }, () => listing());
  m.lfg.lastGeneratedAt = Date.now();
}

async function aiListings() {
  if (aiInFlight) return null;
  aiInFlight = true;
  try {
    const brief = getWorldBrief();
    const prompt = [
      "Generate simulated MMORPG Looking For Group board listings.",
      "Return ONLY JSON: an array of 6 objects with dungeon, leader, level, need, note.",
      "need must be an array using only Tank, Healer, DPS. Keep notes short.",
      `World brief: ${JSON.stringify(brief)}`,
    ].join("\n");
    const data = await aiJson(prompt, "MMO LFG");
    const arr = Array.isArray(data) ? data : [];
    const out = arr.slice(0, 8).map((x) => listing(x));
    return out.length ? out : null;
  } finally {
    aiInFlight = false;
  }
}

function makePartyMember(role = "DPS", context = {}) {
  const lvl = Math.max(1, Math.min(99, Math.floor(Number(context.level || (3 + Math.random() * 14)))));
  const name = clampText(context.name || randomName(), 48);
  const cls = pick(CLASSES[role] || CLASSES.DPS);
  const base = 8 + lvl;
  return {
    id: uid("mmo_party"),
    identity: { name, class: cls, species: "Human", alignment: "Neutral" },
    images: { portrait: "" },
    stats: {
      str: role === "Tank" ? base + 4 : base,
      dex: role === "DPS" ? base + 3 : base,
      con: role === "Tank" ? base + 5 : base + 1,
      int: role === "Healer" ? base + 2 : base,
      wis: role === "Healer" ? base + 5 : base,
      cha: base,
      per: base,
      luk: base,
    },
    vitals: {
      hp: role === "Tank" ? 140 + lvl * 10 : 95 + lvl * 7,
      maxHp: role === "Tank" ? 140 + lvl * 10 : 95 + lvl * 7,
      mp: role === "Healer" ? 100 + lvl * 8 : 55 + lvl * 4,
      maxMp: role === "Healer" ? 100 + lvl * 8 : 55 + lvl * 4,
      ap: 10,
      maxAp: 10,
      stamina: 100,
      maxStamina: 100,
    },
    progression: { level: lvl, xp: 0, skillPoints: 0, perkPoints: 0, reborn: false, activeMedallion: null },
    equipment: {},
    trackers: [],
    partyRole: role,
    roles: ["MMO Simulated Player"],
    statusEffects: [],
    bio: `Recruited from the simulated LFG board for ${context.dungeon || "a dungeon run"}.`,
    notes: "Temporary MMO-mode companion.",
    customCSS: "",
    active: true,
    personalItems: [],
    tactics: { preset: "Balanced", focus: "auto", protectId: "", conserveMana: false },
  };
}

function addMemberFromListing(listingId, wantedRole = "") {
  const s = getSettings();
  const m = ensureMmoState(s);
  if (!s.party || typeof s.party !== "object") s.party = {};
  if (!Array.isArray(s.party.members)) s.party.members = [];
  const found = m.lfg.listings.find((x) => String(x.id) === String(listingId)) || listing();
  const role = normalizeRole(wantedRole || found.need?.[0] || "DPS");
  const member = makePartyMember(role, { dungeon: found.dungeon, level: found.level });
  s.party.members.push(member);
  m.lfg.listings = m.lfg.listings.filter((x) => String(x.id) !== String(listingId));
  persistMmo("mmo-lfg");
  try { window.importUieModule?.("party.js").then((mod) => mod.refreshParty?.()).catch(() => {}); } catch (_) {}
  toast("success", `${member.identity.name} joined your party as ${role}.`, "LFG");
  render();
}

function postListing() {
  const s = getSettings();
  const m = ensureMmoState(s);
  const dungeon = clampText(document.getElementById("uie-lfg-post-dungeon")?.value || pick(DUNGEONS), 80);
  const role = normalizeRole(document.getElementById("uie-lfg-post-role")?.value || "DPS");
  const note = clampText(document.getElementById("uie-lfg-post-note")?.value || "Looking for a group.", 180);
  const post = {
    id: uid("lfg_post"),
    ts: Date.now(),
    dungeon,
    role,
    note,
    applicants: Array.from({ length: 3 }, () => ({
      id: uid("lfg_app"),
      name: randomName(),
      role: pick(["Tank", "Healer", "DPS"]),
      level: 3 + Math.floor(Math.random() * 20),
    })),
  };
  m.lfg.posts.unshift(post);
  m.lfg.posts = m.lfg.posts.slice(0, 8);
  persistMmo("mmo-lfg");
  toast("info", "Your LFG post is live on the simulated board.", "LFG");
  render();
}

function acceptApplicant(postId, applicantId) {
  const s = getSettings();
  const m = ensureMmoState(s);
  if (!s.party || typeof s.party !== "object") s.party = {};
  if (!Array.isArray(s.party.members)) s.party.members = [];
  const post = m.lfg.posts.find((x) => String(x.id) === String(postId));
  const app = post?.applicants?.find((x) => String(x.id) === String(applicantId));
  if (!post || !app) return;
  const member = makePartyMember(normalizeRole(app.role), { name: app.name, dungeon: post.dungeon, level: app.level });
  s.party.members.push(member);
  post.applicants = post.applicants.filter((x) => String(x.id) !== String(applicantId));
  persistMmo("mmo-lfg");
  try { window.importUieModule?.("party.js").then((mod) => mod.refreshParty?.()).catch(() => {}); } catch (_) {}
  toast("success", `${member.identity.name} accepted your invite.`, "LFG");
  render();
}

function renderListings() {
  const s = getSettings();
  const m = ensureMmoState(s);
  ensureListings(s);
  const roleFilter = String(document.getElementById("uie-lfg-filter-role")?.value || "Any");
  const host = document.getElementById("uie-lfg-listings");
  if (!host) return;
  const rows = m.lfg.listings.filter((x) => roleFilter === "Any" || (x.need || []).includes(roleFilter));
  host.innerHTML = rows.length ? rows.map((x) => `
    <article class="lfg-row" data-id="${esc(x.id)}">
      <div class="lfg-main">
        <div class="lfg-title">${esc(x.dungeon)} <span>Lv ${esc(x.level)}</span></div>
        <div class="lfg-meta">${esc(x.leader)} - needs ${(x.need || []).map((r) => `<b>${esc(r)}</b>`).join(" ")}</div>
        <div class="lfg-note">${esc(x.note)}</div>
      </div>
      <button type="button" class="lfg-apply" data-id="${esc(x.id)}"><i class="fa-solid fa-right-to-bracket"></i><span>Apply</span></button>
    </article>
  `).join("") : `<div class="lfg-empty">No listings match that role.</div>`;
}

function renderPosts() {
  const s = getSettings();
  const m = ensureMmoState(s);
  const host = document.getElementById("uie-lfg-posts");
  if (!host) return;
  host.innerHTML = m.lfg.posts.length ? m.lfg.posts.map((post) => `
    <article class="lfg-post">
      <div class="lfg-title">${esc(post.dungeon)} <span>${esc(post.role)}</span></div>
      <div class="lfg-note">${esc(post.note)}</div>
      <div class="lfg-applicants">
        ${(post.applicants || []).length ? (post.applicants || []).map((app) => `
          <button type="button" class="lfg-applicant" data-post="${esc(post.id)}" data-app="${esc(app.id)}">
            <i class="fa-solid fa-user-plus"></i>
            <span>${esc(app.name)} - Lv ${esc(app.level)} ${esc(app.role)}</span>
          </button>
        `).join("") : `<div class="lfg-empty compact">No pending applicants.</div>`}
      </div>
    </article>
  `).join("") : `<div class="lfg-empty">Post a role to attract simulated applicants.</div>`;
}

function bindEvents() {
  const win = document.getElementById("uie-lfg-window");
  if (!win) return;
  win.addEventListener("click", async (ev) => {
    const target = ev.target;
    if (target?.closest?.("#uie-lfg-close")) {
      win.style.display = "none";
      return;
    }
    if (target?.closest?.("#uie-lfg-refresh")) {
      const s = getSettings();
      const m = ensureMmoState(s);
      const ai = await aiListings();
      m.lfg.listings = ai || Array.from({ length: 6 }, () => listing());
      m.lfg.lastGeneratedAt = Date.now();
      persistMmo("mmo-lfg");
      render();
      return;
    }
    const apply = target?.closest?.(".lfg-apply");
    if (apply) {
      addMemberFromListing(apply.getAttribute("data-id"));
      return;
    }
    const app = target?.closest?.(".lfg-applicant");
    if (app) {
      acceptApplicant(app.getAttribute("data-post"), app.getAttribute("data-app"));
    }
  });
  win.addEventListener("change", (ev) => {
    if (ev.target?.id === "uie-lfg-filter-role") renderListings();
  });
  win.addEventListener("submit", (ev) => {
    if (ev.target?.id !== "uie-lfg-post-form") return;
    ev.preventDefault();
    postListing();
  });
}

export function render() {
  const s = getSettings();
  ensureMmoState(s);
  ensureListings(s);
  renderListings();
  renderPosts();
}

export function initLfg() {
  if (!initialized) {
    initialized = true;
    bindEvents();
  }
  render();
}

export function openLfg() {
  const win = document.getElementById("uie-lfg-window");
  if (win) win.style.display = "flex";
  initLfg();
}
