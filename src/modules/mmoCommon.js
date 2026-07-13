import { getSettings, saveSettings, commitStateUpdate } from "./core.js";
import { getContext } from "./gameContext.js";
import { notify } from "./notifications.js";

export const MMO_EVENT = "uie:mmo_updated";

export function clampText(value, max = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, Math.max(1, Number(max) || 1));
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch] || ch));
}

export function uid(prefix = "mmo") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function pick(list, seed = Math.random()) {
  const arr = Array.isArray(list) ? list.filter((x) => x !== undefined && x !== null) : [];
  if (!arr.length) return "";
  const idx = Math.max(0, Math.min(arr.length - 1, Math.floor(Number(seed) * arr.length)));
  return arr[idx];
}

export function ensureMmoState(s = getSettings()) {
  if (!s || typeof s !== "object") return {};
  if (!s.mmo || typeof s.mmo !== "object") s.mmo = {};
  const m = s.mmo;
  if (typeof m.enabled !== "boolean") m.enabled = true;
  if (typeof m.aiEnabled !== "boolean") m.aiEnabled = true;
  if (typeof m.backgroundChat !== "boolean") m.backgroundChat = true;
  if (!m.chat || typeof m.chat !== "object") m.chat = {};
  if (!Array.isArray(m.chat.messages)) m.chat.messages = [];
  if (!Number.isFinite(Number(m.chat.lastGeneratedAt))) m.chat.lastGeneratedAt = 0;
  if (!Number.isFinite(Number(m.chat.nextPulseAt))) m.chat.nextPulseAt = Date.now() + 18000;
  if (!String(m.chat.playerHandle || "").trim()) m.chat.playerHandle = "You";
  if (!m.lfg || typeof m.lfg !== "object") m.lfg = {};
  if (!Array.isArray(m.lfg.listings)) m.lfg.listings = [];
  if (!Array.isArray(m.lfg.posts)) m.lfg.posts = [];
  if (!Number.isFinite(Number(m.lfg.lastGeneratedAt))) m.lfg.lastGeneratedAt = 0;
  if (!m.trade || typeof m.trade !== "object") m.trade = {};
  if (!Array.isArray(m.trade.log)) m.trade.log = [];
  if (!Array.isArray(m.trade.npcs)) m.trade.npcs = [];
  return m;
}

export function persistMmo(domain = "mmo") {
  try { saveSettings(); } catch (_) {}
  try { commitStateUpdate({ emit: true, domain }); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(MMO_EVENT, { detail: { domain } })); } catch (_) {}
}

export function toast(level, message, title = "MMO") {
  try { notify(level, message, title, "mmo"); }
  catch (_) { try { window.toastr?.[level]?.(message, title); } catch (_) {} }
}

export function getWorldBrief() {
  const s = getSettings();
  let ctx = {};
  try { ctx = getContext?.() || {}; } catch (_) {}
  const location = clampText(
    s?.map?.currentLocation ||
    s?.worldState?.currentLocation ||
    s?.location ||
    ctx?.location ||
    "the current zone",
    90
  );
  const campaign = clampText(s?.worldState?.campaign || s?.storyPreset || ctx?.scenario || "the active campaign", 180);
  const character = clampText(s?.character?.name || ctx?.name1 || "the player", 80);
  const party = (Array.isArray(s?.party?.members) ? s.party.members : [])
    .filter((m) => m && m.active !== false)
    .map((m) => clampText(m?.identity?.name || m?.name || "Member", 40))
    .slice(0, 5);
  const factions = (Array.isArray(s?.factions?.list) ? s.factions.list : [])
    .map((f) => clampText(f?.name || f?.title || f, 45))
    .filter(Boolean)
    .slice(0, 6);
  return { location, campaign, character, party, factions };
}

export function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    (raw.match(/\[[\s\S]*\]/) || [])[0],
    (raw.match(/\{[\s\S]*\}/) || [])[0],
  ].filter(Boolean);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (_) {}
  }
  return null;
}

export async function aiJson(prompt, type = "MMO Simulation") {
  const s = getSettings();
  ensureMmoState(s);
  if (s?.mmo?.aiEnabled === false) return null;
  try {
    const mod = await import("./apiClient.js");
    if (typeof mod.hasVerifiedTextConnection === "function" && !mod.hasVerifiedTextConnection()) return null;
    if (typeof mod.generateContent !== "function") return null;
    const out = await mod.generateContent(prompt, type);
    return parseJsonLoose(out);
  } catch (err) {
    console.warn("[MMO] AI simulation fallback:", err);
    return null;
  }
}

export function normalizeRole(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("tank")) return "Tank";
  if (raw.includes("heal") || raw.includes("support")) return "Healer";
  return "DPS";
}

export function randomName(seed = Math.random()) {
  const heads = ["Ari", "Nyx", "Mira", "Kade", "Sable", "Talon", "Ren", "Lio", "Vera", "Orin", "Juno", "Vale"];
  const tails = ["Starfall", "Ashveil", "Quickcast", "Moonforge", "Riftborn", "Dawnward", "Hexlane", "Ironnote", "Silkstep", "Brightbind"];
  return `${pick(heads, seed)} ${pick(tails, (seed * 7.13) % 1)}`;
}
