import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { customConfirm } from "./popups.js";
import { inferTravelCategory } from "./travelAssets.js";
import {
  TRANSIT_MODES,
  accessModesForNode,
  applyTransitNeeds,
  availableModesForNode,
  buildTransitRoutes,
  creditTransitFare,
  debitTransitFare,
  ensureTravelState,
  evaluateTransitRoute,
  recordTransitArrival,
  selectTransitEvent,
  transitId,
} from "./travelRules.js";

let adapter = null;
let initialized = false;
let originNode = null;
let activeMode = "bus";
let routeCache = new Map();
let transitTimer = null;
let transitStartedAt = 0;
let returnFocus = null;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mapState() {
  return adapter?.getMapState?.() || getSettings()?.simpleMap || {};
}

async function ensureAdapter() {
  if (typeof adapter?.travelToLocationName === "function") return adapter;
  const map = await import("./map.js");
  adapter = {
    getMapState: () => getSettings()?.simpleMap || {},
    getNodeByName: map.getNodeByName,
    travelToLocationName: map.travelToLocationName,
    boardTravelAsset: map.boardTravelAsset,
    placeTravelAssetHere: map.placeTravelAssetHere,
    parkTravelAssetHere: map.parkTravelAssetHere,
  };
  return adapter;
}

function allNodes() {
  const state = mapState();
  return [
    ...(state.world || []),
    ...(state.region || []),
    ...(state.area || []),
    ...(state.vicinity || []),
    ...Object.values(state.vicinityByArea || {}).flatMap((entry) => Array.isArray(entry) ? entry : []),
    ...Object.values(state.blueprints || {}).flatMap((entry) => Array.isArray(entry?.rooms) ? entry.rooms : []),
  ].filter(Boolean);
}

function nodeById(value) {
  const key = transitId(value, "");
  const settings = getSettings();
  return allNodes().find((node) => transitId(node?.id || node?.name, "") === key || transitId(node?.name, "") === key)
    || Object.entries(settings?.worldState?.mapNodes || {}).map(([name, node]) => ({ name, ...(node || {}) }))
      .find((node) => transitId(node?.id || node?.name, "") === key || transitId(node?.name, "") === key)
    || adapter?.getNodeByName?.(String(value || ""))
    || null;
}

function currentLocationNode() {
  const settings = getSettings();
  const name = String(settings?.worldState?.currentLocation || settings?.worldState?.location || "").trim();
  return nodeById(name) || { id: transitId(name || "current_location"), name: name || "Current Location", type: "exterior", accessModes: ["road", "foot"] };
}

function atOrigin() {
  const settings = getSettings();
  const current = String(settings?.worldState?.currentLocation || settings?.worldState?.location || "");
  return transitId(current, "") === transitId(originNode?.name, "");
}

async function fetchTemplate(file) {
  const response = await fetch(new URL(`../templates/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`${file} could not be loaded (${response.status}).`);
  return response.text();
}

function installRuntimeStyles() {
  if (document.getElementById("uie-transit-bridge-styles")) return;
  const style = document.createElement("style");
  style.id = "uie-transit-bridge-styles";
  style.textContent = `
    #transit-hub-overlay[aria-hidden="false"], #transit-lock-overlay[aria-hidden="false"] { display:flex !important; }
    #transit-hub-overlay[aria-hidden="true"], #transit-lock-overlay[aria-hidden="true"] { display:none !important; }
    .uie-transit-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-left:auto; }
    .uie-transit-toolbar button { border:1px solid rgba(125,211,252,.28); background:rgba(15,23,42,.84); color:#dbeafe; border-radius:8px; min-height:36px; padding:7px 10px; cursor:pointer; }
    .uie-transit-toolbar button:disabled { opacity:.42; cursor:not-allowed; }
    .hub-route-name { display:flex; flex-direction:column; min-width:0; gap:3px; }
    .hub-route-name strong { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .hub-route-meta { font-size:10px; color:rgba(180,210,255,.56); white-space:normal; }
    .hub-route-warning { color:#fbbf24; }
    .uie-transit-current { color:#86efac; }
    .uie-transit-away { color:#fbbf24; }
    .uie-transit-event { position:absolute; left:50%; top:50%; z-index:8; width:min(520px,88vw); transform:translate(-50%,-50%); padding:18px; border:1px solid rgba(125,211,252,.35); border-radius:14px; background:rgba(5,10,18,.94); box-shadow:0 24px 80px rgba(0,0,0,.7); text-align:center; pointer-events:auto; }
    .uie-transit-event h3 { margin:0 0 8px; color:#bae6fd; }
    .uie-transit-event p { margin:0; color:#dbeafe; line-height:1.5; }
    body.uie-transit-modal-open { overflow:hidden !important; }
    #tlock-bg-train, #tlock-bg-subway, #tlock-bg-amtrak { background-image:linear-gradient(rgba(3,7,18,.2),rgba(3,7,18,.42)),url("./assets/generated/transit/transit-rail.webp") !important; background-size:cover !important; background-position:center !important; }
    #tlock-bg-walking, #tlock-bg-bicycle, #tlock-bg-motorcycle, #tlock-bg-bus, #tlock-bg-taxi, #tlock-bg-car, #tlock-bg-rideshare { background-image:linear-gradient(rgba(3,7,18,.18),rgba(3,7,18,.46)),url("./assets/generated/transit/transit-road.webp") !important; background-size:cover !important; background-position:center !important; }
    #tlock-bg-horse, #tlock-bg-carriage { background-image:linear-gradient(rgba(3,7,18,.14),rgba(3,7,18,.44)),url("./assets/generated/transit/transit-carriage.webp") !important; background-size:cover !important; background-position:center !important; }
    #tlock-bg-ferry, #tlock-bg-boat { background-image:linear-gradient(rgba(3,7,18,.12),rgba(3,7,18,.42)),url("./assets/generated/transit/transit-ship.webp") !important; background-size:cover !important; background-position:center !important; }
    #tlock-bg-airship, #tlock-bg-plane { background-image:linear-gradient(rgba(3,7,18,.08),rgba(3,7,18,.4)),url("./assets/generated/transit/transit-aircraft.webp") !important; background-size:cover !important; background-position:center !important; }
    #tlock-bg-spaceship { background-image:linear-gradient(rgba(3,7,18,.1),rgba(3,7,18,.44)),url("./assets/generated/transit/transit-spacecraft.webp") !important; background-size:cover !important; background-position:center !important; }
    #tlock-bg-portal { background-image:linear-gradient(rgba(3,7,18,.06),rgba(3,7,18,.35)),url("./assets/generated/transit/transit-portal.webp") !important; background-size:cover !important; background-position:center !important; }
    @media (max-width: 920px) and (orientation: landscape) {
      #transit-hub-topbar { padding:8px 14px; gap:10px; }
      #transit-hub-icon { width:38px; height:38px; font-size:18px; }
      #transit-hub-name { font-size:17px; }
      #transit-hub-tabs { padding:6px 12px 0; flex-wrap:nowrap; overflow-x:auto; }
      .transit-hub-tab { padding:7px 10px; flex:0 0 auto; }
      #transit-hub-body { padding:10px 14px; gap:10px; }
      .hub-departure-row, .hub-departure-header { grid-template-columns:minmax(150px,1fr) 64px 64px 96px; padding:8px 10px; }
      #tlock-status-bar { padding:8px 14px; }
      #tlock-controls { padding:10px 14px; gap:7px; }
      #tlock-btn-row button { padding:7px 10px; min-height:36px; }
    }
  `;
  document.head.appendChild(style);
}

async function ensureMounted() {
  installRuntimeStyles();
  const jobs = [];
  if (!document.getElementById("transit-hub-overlay")) jobs.push(fetchTemplate("transit_hub.html"));
  if (!document.getElementById("transit-lock-overlay")) jobs.push(fetchTemplate("transit_lock.html"));
  const html = await Promise.all(jobs);
  for (const template of html) document.body.insertAdjacentHTML("beforeend", template);
  const hub = document.getElementById("transit-hub-overlay");
  const lock = document.getElementById("transit-lock-overlay");
  if (!hub || !lock) throw new Error("Transit interface failed to mount.");
  hub.setAttribute("role", "dialog");
  hub.setAttribute("aria-modal", "true");
  hub.setAttribute("aria-hidden", "true");
  lock.setAttribute("role", "dialog");
  lock.setAttribute("aria-modal", "true");
  lock.setAttribute("aria-hidden", "true");
  ensureToolbar();
}

function ensureToolbar() {
  const topbar = document.getElementById("transit-hub-topbar");
  if (!topbar || document.getElementById("uie-transit-toolbar")) return;
  const toolbar = document.createElement("div");
  toolbar.id = "uie-transit-toolbar";
  toolbar.className = "uie-transit-toolbar";
  toolbar.innerHTML = `
    <button type="button" id="uie-transit-set-dock"><i class="fa-solid fa-location-crosshairs"></i> Set Current Dock</button>
    <button type="button" id="uie-transit-favorite"><i class="fa-regular fa-star"></i> Save Dock</button>
  `;
  topbar.insertBefore(toolbar, document.getElementById("transit-hub-close"));
}

function activeAssets() {
  const settings = getSettings();
  return [...(settings?.inventory?.assets || []), ...(settings?.assets || [])].map((asset) => {
    if (asset && !asset.travelCategory) asset.travelCategory = inferTravelCategory(asset);
    return asset;
  }).filter((asset, index, list) => {
    const key = transitId(asset?.name || asset?.title, "");
    return key && list.findIndex((entry) => transitId(entry?.name || entry?.title, "") === key) === index;
  });
}

function showHub() {
  const hub = document.getElementById("transit-hub-overlay");
  if (!hub) return;
  returnFocus = document.activeElement;
  hub.inert = false;
  hub.setAttribute("aria-hidden", "false");
  document.body.classList.add("uie-transit-modal-open");
  setTimeout(() => hub.querySelector("button:not([disabled])")?.focus?.(), 0);
}

export function closeTransitHub() {
  const hub = document.getElementById("transit-hub-overlay");
  if (!hub) return;
  if (hub.contains(document.activeElement)) document.activeElement?.blur?.();
  hub.setAttribute("aria-hidden", "true");
  hub.inert = true;
  if (document.getElementById("transit-lock-overlay")?.getAttribute("aria-hidden") !== "false") document.body.classList.remove("uie-transit-modal-open");
  if (returnFocus?.isConnected) returnFocus.focus?.();
  returnFocus = null;
}

function setDock() {
  if (!originNode || !atOrigin()) {
    notify("warning", "Reach this departure point before setting it as your current dock.", "Travel");
    return false;
  }
  const settings = getSettings();
  const travel = ensureTravelState(settings);
  travel.currentDockId = String(originNode.id || transitId(originNode.name));
  travel.currentDockName = String(originNode.name || "Current Dock");
  travel.discoveredDocks[travel.currentDockId] = true;
  settings.worldState.currentDock = travel.currentDockName;
  saveSettings();
  renderHub();
  notify("success", `${travel.currentDockName} is now your current departure point.`, "Dock Set");
  return true;
}

function toggleFavorite() {
  if (!originNode) return;
  const settings = getSettings();
  const travel = ensureTravelState(settings);
  const id = String(originNode.id || transitId(originNode.name));
  const index = travel.favoriteDocks.indexOf(id);
  if (index >= 0) travel.favoriteDocks.splice(index, 1);
  else travel.favoriteDocks.push(id);
  saveSettings();
  renderHub();
  notify("info", index >= 0 ? "Dock removed from saved departures." : "Dock saved for quick reference.", "Travel");
}

function renderTabs(modes) {
  const tabs = document.getElementById("transit-hub-tabs");
  if (!tabs) return;
  if (!modes.includes(activeMode)) activeMode = modes[0] || "bus";
  tabs.innerHTML = modes.map((mode) => {
    const config = TRANSIT_MODES[mode];
    return `<button type="button" class="transit-hub-tab${mode === activeMode ? " active" : ""}" data-transit-mode="${esc(mode)}"><i class="fa-solid ${esc(config.icon)}"></i>${esc(config.label)}</button>`;
  }).join("");
  document.querySelectorAll(".transit-hub-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `transit-hub-${activeMode}`));
}

function modeAsset(mode) {
  const category = TRANSIT_MODES[mode]?.assetCategory;
  if (!category) return null;
  const settings = getSettings();
  const current = transitId(originNode?.name, "");
  return activeAssets().find((asset) => String(asset?.travelCategory || "") === category && transitId(asset?.location || asset?.regionalLocation, "") === current)
    || activeAssets().find((asset) => String(asset?.travelCategory || "") === category && transitId(settings?.worldState?.activeVehicle?.name || settings?.worldState?.activeVehicle, "") === transitId(asset?.name || asset?.title, ""))
    || null;
}

function renderSlots(mode) {
  const grid = document.getElementById(`hub-${mode}-slots`);
  if (!grid) return;
  const config = TRANSIT_MODES[mode];
  const current = transitId(originNode?.name, "");
  const assets = activeAssets().filter((asset) => String(asset?.travelCategory || "") === config.assetCategory);
  if (!assets.length) {
    grid.innerHTML = `<div class="hub-no-routes">No compatible owned asset is registered.</div>`;
    return;
  }
  grid.innerHTML = assets.map((asset, index) => {
    const here = transitId(asset?.location || asset?.regionalLocation, "") === current;
    const active = transitId(getSettings()?.worldState?.activeVehicle?.name || getSettings()?.worldState?.activeVehicle, "") === transitId(asset?.name || asset?.title, "");
    return `<div class="hub-slot${here ? " occupied" : ""}">
      <div class="hub-slot-icon"><i class="fa-solid ${esc(config.icon)}"></i></div>
      <div class="hub-slot-name">${esc(asset?.name || asset?.title || `Asset ${index + 1}`)}</div>
      <div class="hub-slot-desc">${here ? (active ? "Ready to depart" : "Stored here") : `Located at ${esc(asset?.location || "another stop")}`}</div>
      ${here ? `<button type="button" class="hub-park-btn" data-transit-board-asset="${esc(transitId(asset?.name || asset?.title))}">${active ? "Selected" : "Board"}</button>` : ""}
    </div>`;
  }).join("");
}

function routeTooltip(result, route) {
  const parts = [...result.missing];
  if (route.schedule?.length) parts.push(`Schedule: ${route.schedule.join(", ")}`);
  parts.push(`Risk: ${Math.round(Number(route.risk || 0) * 100)}%`);
  return parts.join(" ");
}

function renderBoard(mode) {
  const board = document.getElementById(`hub-${mode}-board`);
  if (!board) return;
  board.querySelectorAll(".hub-departure-row").forEach((row) => row.remove());
  const noRoutes = document.getElementById(`hub-${mode}-no-routes`);
  const settings = getSettings();
  const routes = buildTransitRoutes({ settings, mapState: mapState(), origin: originNode, mode });
  const asset = modeAsset(mode);
  routeCache = new Map(routes.map((route) => [route.id, route]));
  noRoutes?.toggleAttribute("hidden", routes.length > 0);
  for (const route of routes) {
    const result = evaluateTransitRoute(settings, route);
    if (!atOrigin()) result.missing.unshift("Travel to this departure point before boarding.");
    if (TRANSIT_MODES[mode].assetCategory && !TRANSIT_MODES[mode].public && !asset) result.missing.unshift("A compatible vehicle must be present and boarded.");
    result.ok = result.missing.length === 0;
    const displayName = route.discovered || ensureTravelState(settings).discoveredDocks[route.toId] ? route.to : "Undiscovered arrival point";
    const row = document.createElement("div");
    row.className = "hub-departure-row";
    row.innerHTML = `
      <div class="hub-route-name"><strong>${esc(displayName)}</strong><span class="hub-route-meta">${esc(route.controllingFaction)} · ${route.duration} min · capacity ${route.capacity}${result.missing.length ? ` · <span class="hub-route-warning">${esc(result.missing[0])}</span>` : ""}</span></div>
      <span class="hub-dest-range ${esc(route.range)}">${esc(route.range)}</span>
      <span class="hub-dest-cost">${route.fare}${esc(settings.currencySymbol || "G")}</span>
      <button type="button" class="hub-board-btn" data-transit-route="${esc(route.id)}" ${result.ok ? "" : "disabled"} title="${esc(routeTooltip(result, route))}">${result.ok ? "Board" : "Unavailable"}</button>`;
    board.appendChild(row);
  }
}

function renderHub() {
  if (!originNode) originNode = currentLocationNode();
  const settings = getSettings();
  const travel = ensureTravelState(settings);
  const assets = activeAssets();
  const modes = availableModesForNode(originNode, assets);
  document.getElementById("transit-hub-name").textContent = originNode.name || "Transit Point";
  const status = atOrigin() ? "You are at this departure point" : "Route preview — travel here to board";
  document.getElementById("transit-hub-subtitle").innerHTML = `<span class="${atOrigin() ? "uie-transit-current" : "uie-transit-away"}">${esc(status)}</span> · ${esc(originNode.faction || "Public access")}`;
  const dockId = String(originNode.id || transitId(originNode.name));
  const setButton = document.getElementById("uie-transit-set-dock");
  if (setButton) {
    setButton.disabled = !atOrigin();
    setButton.innerHTML = travel.currentDockId === dockId ? '<i class="fa-solid fa-location-dot"></i> Current Dock' : '<i class="fa-solid fa-location-crosshairs"></i> Set Current Dock';
  }
  const favorite = document.getElementById("uie-transit-favorite");
  if (favorite) favorite.innerHTML = travel.favoriteDocks.includes(dockId) ? '<i class="fa-solid fa-star"></i> Saved' : '<i class="fa-regular fa-star"></i> Save Dock';
  renderTabs(modes);
  for (const mode of modes) {
    renderSlots(mode);
    if (mode === activeMode) renderBoard(mode);
  }
}

async function boardAsset(assetId) {
  const asset = activeAssets().find((entry) => transitId(entry?.name || entry?.title) === transitId(assetId));
  if (!asset) return;
  const ok = await adapter?.boardTravelAsset?.(asset?.name || asset?.title);
  if (ok === false) return;
  const settings = getSettings();
  settings.worldState = settings.worldState || {};
  settings.worldState.activeVehicle = { name: asset?.name || asset?.title, regionalLocation: originNode?.name || "" };
  asset.location = originNode?.name || asset.location || "";
  saveSettings();
  renderHub();
  notify("success", `${asset.name || asset.title} is ready to depart.`, "Travel");
}

function setTransitOverlay(route, event = null) {
  const overlay = document.getElementById("transit-lock-overlay");
  if (!overlay) return;
  overlay.inert = false;
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("uie-transit-modal-open");
  document.querySelectorAll(".tlock-bg, .tlock-interior").forEach((element) => { element.style.display = "none"; });
  const mode = route.mode === "rideshare" ? "car" : route.mode === "spaceship" ? "spaceship" : route.mode;
  const bg = document.getElementById(`tlock-bg-${mode}`) || document.getElementById("tlock-bg-fast");
  const interior = document.getElementById(`tlock-interior-${mode}`);
  if (bg) bg.style.display = "block";
  if (interior) interior.style.display = "block";
  document.getElementById("tlock-mode-label").textContent = TRANSIT_MODES[route.mode]?.label || "Transit";
  document.getElementById("tlock-mode-icon").className = `fa-solid ${TRANSIT_MODES[route.mode]?.icon || "fa-route"}`;
  document.getElementById("tlock-origin").textContent = route.controllingFaction || "Public route";
  document.getElementById("tlock-from-name").textContent = route.from;
  document.getElementById("tlock-to-name").textContent = route.to;
  document.getElementById("tlock-eta").textContent = `${route.duration}m`;
  document.getElementById("tlock-distance").textContent = `${route.distance}u`;
  document.getElementById("tlock-elapsed").textContent = "0m";
  document.getElementById("tlock-progress-fill").style.width = "0%";
  document.getElementById("tlock-progress-pct").textContent = "0%";
  document.getElementById("tlock-skip-btn").disabled = false;
  overlay.querySelector(".uie-transit-event")?.remove();
  if (event) {
    const card = document.createElement("div");
    card.className = "uie-transit-event";
    card.innerHTML = `<h3>${esc(event.title)}</h3><p>${esc(event.text)}</p>`;
    overlay.appendChild(card);
    setTimeout(() => card.remove(), 2600);
  }
}

function hideTransitOverlay() {
  if (transitTimer) clearInterval(transitTimer);
  transitTimer = null;
  const overlay = document.getElementById("transit-lock-overlay");
  if (overlay?.contains(document.activeElement)) document.activeElement?.blur?.();
  if (overlay) {
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
    overlay.querySelector(".uie-transit-event")?.remove();
  }
  document.body.classList.remove("uie-transit-modal-open");
}

async function applyEventConsequences(settings, event) {
  if (!event) return;
  if (Number(event.minutes || 0) > 0) {
    const { advanceWorldTimeMinutes } = await import("./timeProgress.js");
    advanceWorldTimeMinutes(settings, event.minutes, { reason: event.title });
  }
  if (Number(event.suspicion || 0)) {
    settings.worldState.suspicion = Math.max(0, Number(settings.worldState.suspicion || 0) + Number(event.suspicion));
  }
  if (event.journal) {
    if (!Array.isArray(settings.worldState.rumors)) settings.worldState.rumors = [];
    settings.worldState.rumors.push({ text: event.text, source: "travel", discoveredAt: Date.now() });
    settings.worldState.rumors = settings.worldState.rumors.slice(-100);
  }
  if (Number(event.relationship || 0) && Array.isArray(settings?.party?.members)) {
    const companion = settings.party.members.find((member) => member && member.active !== false && member.followsUser !== false);
    if (companion) companion.relationship = Number(companion.relationship || companion.affection || 0) + Number(event.relationship);
  }
}

async function finishTrip(route, event) {
  if (!transitTimer && !ensureTravelState(getSettings()).activeTrip) return false;
  if (transitTimer) clearInterval(transitTimer);
  transitTimer = null;
  document.getElementById("tlock-skip-btn").disabled = true;
  const privateMode = Boolean(TRANSIT_MODES[route.mode]?.assetCategory && !TRANSIT_MODES[route.mode]?.public);
  const ok = await adapter?.travelToLocationName?.(route.to, {
    reason: `${TRANSIT_MODES[route.mode]?.label || "Transit"} journey`,
    source: "travel_bridge",
    distance: route.distance,
    speedModifier: TRANSIT_MODES[route.mode]?.speed || 1,
    useActiveVehicle: privateMode,
  });
  const settings = getSettings();
  if (ok === false) {
    creditTransitFare(settings, route.fare);
    ensureTravelState(settings).activeTrip = null;
    saveSettings();
    hideTransitOverlay();
    notify("error", "The route could not complete. Your fare was refunded.", "Travel");
    return false;
  }
  await applyEventConsequences(settings, event);
  applyTransitNeeds(settings, Number(route.duration || 0) + Number(event?.minutes || 0), event);
  recordTransitArrival(settings, route, event);
  settings.worldState.currentDock = route.to;
  saveSettings();
  hideTransitOverlay();
  notify("success", `Arrived at ${route.to}.`, "Travel Complete");
  if (event) notify(event.severity || "info", event.text, event.title);
  try { window.dispatchEvent(new CustomEvent("uie:transit_arrival", { detail: { route, event } })); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent("uie:state_updated", { detail: { travel: true, route, event, autosave: true } })); } catch (_) {}
  return true;
}

function animateTrip(route, event, resumeProgress = 0) {
  setTransitOverlay(route, event);
  const totalMs = Math.max(4500, Math.min(10000, Number(route.duration || 10) * 150));
  transitStartedAt = Date.now() - totalMs * Math.max(0, Math.min(0.95, resumeProgress));
  if (transitTimer) clearInterval(transitTimer);
  transitTimer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - transitStartedAt) / totalMs);
    const pct = Math.round(progress * 100);
    const fill = document.getElementById("tlock-progress-fill");
    if (fill) fill.style.width = `${pct}%`;
    const pctEl = document.getElementById("tlock-progress-pct");
    if (pctEl) pctEl.textContent = `${pct}%`;
    const elapsed = document.getElementById("tlock-elapsed");
    if (elapsed) elapsed.textContent = `${Math.round(route.duration * progress)}m`;
    const settings = getSettings();
    const trip = ensureTravelState(settings).activeTrip;
    if (trip) trip.progress = progress;
    if (pct % 20 === 0) saveSettings();
    if (progress >= 1) void finishTrip(route, event);
  }, 120);
}

async function startTrip(route) {
  const settings = getSettings();
  const result = evaluateTransitRoute(settings, route);
  if (!atOrigin()) result.missing.unshift("Reach this departure point before boarding.");
  if (!result.ok || result.missing.length) {
    notify("warning", result.missing[0] || "This route is unavailable.", "Travel");
    return false;
  }
  const confirmed = await customConfirm(`Board ${TRANSIT_MODES[route.mode]?.label || route.mode} to ${route.to} for ${route.fare}${settings.currencySymbol || "G"}?`);
  if (!confirmed) return false;
  if (!debitTransitFare(settings, route.fare)) {
    notify("warning", "You cannot afford this fare.", "Travel");
    return false;
  }
  const travel = ensureTravelState(settings);
  const event = selectTransitEvent(settings, route);
  travel.activeTrip = { route: { ...route }, event, progress: 0, farePaid: route.fare, startedAt: Date.now() };
  saveSettings();
  closeTransitHub();
  animateTrip(route, event, 0);
  try { window.dispatchEvent(new CustomEvent("uie:transit_departure", { detail: { route, event } })); } catch (_) {}
  return true;
}

export function advanceTransitTime() {
  const trip = ensureTravelState(getSettings()).activeTrip;
  if (!trip?.route) return false;
  return finishTrip(trip.route, trip.event || null);
}

export function abortTransit() {
  const settings = getSettings();
  const travel = ensureTravelState(settings);
  const trip = travel.activeTrip;
  if (!trip?.route) return false;
  if (transitTimer) clearInterval(transitTimer);
  transitTimer = null;
  const refund = Math.floor(Number(trip.farePaid || 0) * 0.8);
  creditTransitFare(settings, refund);
  travel.history.push({ routeId: trip.route.id, from: trip.route.from, to: trip.route.to, mode: trip.route.mode, aborted: true, fareLost: Number(trip.farePaid || 0) - refund, at: Date.now() });
  travel.history = travel.history.slice(-50);
  travel.activeTrip = null;
  saveSettings();
  hideTransitOverlay();
  notify("warning", `Trip aborted. ${refund}${settings.currencySymbol || "G"} was refunded.`, "Travel");
  return true;
}

export function resumeTransit() {
  const trip = ensureTravelState(getSettings()).activeTrip;
  if (!trip?.route) return false;
  closeTransitHub();
  animateTrip(trip.route, trip.event || null, Number(trip.progress || 0));
  return true;
}

export async function openTransitHub(nodeId = "") {
  await ensureAdapter();
  await ensureMounted();
  const travel = ensureTravelState(getSettings());
  if (travel.activeTrip?.route) {
    resumeTransit();
    notify("info", "Your saved journey has resumed.", "Travel");
    return true;
  }
  originNode = nodeById(nodeId) || currentLocationNode();
  if (atOrigin()) {
    const id = String(originNode.id || transitId(originNode.name));
    travel.discoveredDocks[id] = true;
  }
  renderHub();
  showHub();
  saveSettings();
  return true;
}

export async function bookTransitRoute(mode = "rideshare", routeId = "", options = {}) {
  await ensureAdapter();
  await ensureMounted();
  originNode = currentLocationNode();
  const settings = getSettings();
  const routes = buildTransitRoutes({ settings, mapState: mapState(), origin: originNode, mode });
  const wanted = transitId(routeId, "");
  const found = routes.find((route) => route.id === routeId || transitId(route.toId, "") === wanted || transitId(route.to, "") === wanted);
  if (!found) {
    notify("warning", "That route is no longer available from your current location.", "Travel");
    return false;
  }
  const fare = Number.isFinite(Number(options.fareOverride))
    ? Math.max(0, Math.round(Number(options.fareOverride)))
    : Math.max(0, Math.round(Number(found.fare || 0) * Math.max(.1, Number(options.fareMultiplier || 1))));
  const route = {
    ...found,
    fare,
    serviceClass: String(options.serviceClass || ""),
    capacity: options.serviceClass === "cargo" ? Math.max(8, Number(found.capacity || 0)) : options.serviceClass === "premium" ? Math.min(3, Number(found.capacity || 3)) : found.capacity,
  };
  return startTrip(route);
}

function onDocumentClick(event) {
  const modeButton = event.target.closest?.("[data-transit-mode]");
  if (modeButton) {
    activeMode = String(modeButton.dataset.transitMode || "bus");
    renderHub();
    return;
  }
  const routeButton = event.target.closest?.("[data-transit-route]");
  if (routeButton) {
    const route = routeCache.get(String(routeButton.dataset.transitRoute || ""));
    if (route) void startTrip(route);
    return;
  }
  const assetButton = event.target.closest?.("[data-transit-board-asset]");
  if (assetButton) { void boardAsset(assetButton.dataset.transitBoardAsset); return; }
  if (event.target.closest?.("#transit-hub-close")) closeTransitHub();
  else if (event.target.closest?.("#uie-transit-set-dock")) setDock();
  else if (event.target.closest?.("#uie-transit-favorite")) toggleFavorite();
  else if (event.target.closest?.("#tlock-skip-btn")) advanceTransitTime();
  else if (event.target.closest?.("#tlock-abort-btn")) abortTransit();
}

function onKeyDown(event) {
  if (event.key !== "Escape") return;
  if (document.getElementById("transit-lock-overlay")?.getAttribute("aria-hidden") === "false") {
    event.preventDefault();
    abortTransit();
  } else if (document.getElementById("transit-hub-overlay")?.getAttribute("aria-hidden") === "false") {
    event.preventDefault();
    closeTransitHub();
  }
}

export function initTravelBridge(nextAdapter = null) {
  if (nextAdapter) adapter = nextAdapter;
  ensureTravelState(getSettings());
  if (!initialized) {
    initialized = true;
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
  }
  window.UIE_TravelBridge = { openTransitHub, closeTransitHub, bookTransitRoute, advanceTransitTime, abortTransit, resumeTransit, setDock };
  return window.UIE_TravelBridge;
}
