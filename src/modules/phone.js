import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "./gameContext.js";
import { injectRpEvent } from "./features/rp_log.js";
import { notify } from "./notifications.js";
import { checkAndGenerateImage } from "./imageGen.js";
import { applyI18n } from "./i18n.js";
import { ensureEconomyState, formatCurrency, payTransitFare, LOAN_TIERS, openLoan, payLoan } from "./economy.js";
import { getGameMode } from "./gameModeManager.js";
import { receiveMessage as receiveCourierMessage, sendMessage as sendCourierMessage, sendEmail, registerApplication } from "./CommunicationsManager.js";
import { openHelpManualWindow } from "./helpManual.js";
import {
    TRANSIT_MODES,
    availableModesForNode,
    buildTransitRoutes,
    collectTransitNodes,
    ensureTravelState,
    evaluateTransitRoute,
    transitId,
} from "./travelRules.js";
import { inferTravelCategory } from "./travelAssets.js";
import { initCredentialForgeUI } from "./credentialForgeUI.js";
import { getDefaultCredential, syncAutomaticCredentials, useCredential } from "./credentialSystem.js";

export function parseMarkdown(text) {
    if (!text) return "";
    let s = String(text);
    s = s.replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\.\.\./g, "…");
    s = s.replace(/\n/g, "<br>");
    return s;
}

try {
    window.UIE = window.UIE || {};
    window.UIE.parseMarkdown = parseMarkdown;
} catch (_) {}

let callTimerInt = null;
let activeContact = null; // Tracks who we are texting
let dialBuf = "";
let chatClock = null;
let phoneClockInt = null;
let phonePowerInt = null;
let arrivalObserver = null;
let arrivalLastMesId = null;
let callChatContext = "";
let phoneTravelRoutes = new Map();
let credentialForgeUI = null;

function ensurePhonePowerState(s = getSettings()) {
    if (!s.phone || typeof s.phone !== "object") s.phone = {};
    if (!s.phone.power || typeof s.phone.power !== "object") {
        s.phone.power = {};
    }
    const p = s.phone.power;
    if (typeof p.batterySimulationEnabled !== "boolean") p.batterySimulationEnabled = true;
    if (typeof p.networkSimulationEnabled !== "boolean") p.networkSimulationEnabled = true;
    if (!Number.isFinite(Number(p.batteryLevel))) p.batteryLevel = 100;
    p.batteryLevel = Math.max(0, Math.min(100, Number(p.batteryLevel)));
    if (typeof p.charging !== "boolean") p.charging = false;
    if (!["wall", "usb", "wireless", "vehicle", "solar"].includes(String(p.charger || ""))) p.charger = "wall";
    if (!Number.isFinite(Number(p.lastTickAt))) p.lastTickAt = Date.now();
    if (!Number.isFinite(Number(p.lastWarnLevel))) p.lastWarnLevel = 101;
    if (!Number.isFinite(Number(p.signal))) p.signal = 4;
    if (typeof p.serviceSuspended !== "boolean") p.serviceSuspended = false;
    if (typeof p.shutDown !== "boolean") p.shutDown = p.batteryLevel <= 0;
    if (!Number.isFinite(Number(p.monthlyPlanCost))) p.monthlyPlanCost = 35;
    return p;
}

function phoneAvailability(s = getSettings()) {
    const p = ensurePhonePowerState(s);
    const dead = p.batterySimulationEnabled && (p.shutDown || p.batteryLevel <= 0);
    const offline = p.networkSimulationEnabled && (p.serviceSuspended || Number(p.signal || 0) <= 0);
    return { p, dead, offline, ok: !dead && !offline };
}

function renderPhonePowerStatus() {
    const s = getSettings();
    const { p, dead, offline } = phoneAvailability(s);
    const level = Math.round(p.batteryLevel);
    const batteryIcon = p.charging ? "fa-bolt" : level <= 10 ? "fa-battery-empty" : level <= 35 ? "fa-battery-quarter" : level <= 65 ? "fa-battery-half" : level <= 90 ? "fa-battery-three-quarters" : "fa-battery-full";
    try {
        $("#uie-phone-battery").html(`<i class="fa-solid ${batteryIcon}"></i> ${p.batterySimulationEnabled ? `${level}%` : "∞"}`);
        $("#uie-phone-network").html(`<i class="fa-solid ${offline ? "fa-signal-slash" : "fa-signal"}"></i> ${p.networkSimulationEnabled ? (p.serviceSuspended ? "Suspended" : `${Math.max(0, Math.min(4, Math.round(p.signal)))}/4`) : "Always on"}`);
        $("#uie-phone-power-level").text(`${level}%`);
        $("#uie-phone-power-charger").val(String(p.charger || "wall"));
        $("#uie-phone-charge-toggle").html(p.charging ? '<i class="fa-solid fa-plug-circle-xmark"></i> Disconnect charger' : '<i class="fa-solid fa-plug-circle-bolt"></i> Connect charger');
        $("#p-battery-sim").prop("checked", p.batterySimulationEnabled);
        $("#p-network-sim").prop("checked", p.networkSimulationEnabled);
        $("#p-phone-plan-cost").val(String(p.monthlyPlanCost));
        $("#p-charger-type").val(String(p.charger || "wall"));
        if (dead) {
            $("#uie-phone-power-screen").css("display", "flex");
            $("#uie-phone-lockscreen, #uie-phone-homescreen, .phone-app-window").hide();
        } else if ($("#uie-phone-power-screen").is(":visible")) {
            $("#uie-phone-power-screen").hide();
            $("#uie-phone-lockscreen").css("display", "flex");
        }
    } catch (_) {}
}

function setPhoneCharging(charging, charger = "") {
    const s = getSettings();
    const p = ensurePhonePowerState(s);
    if (charger) p.charger = String(charger);
    p.charging = charging === true;
    p.lastTickAt = Date.now();
    if (p.charging && p.batteryLevel <= 0) p.shutDown = true;
    saveSettings();
    renderPhonePowerStatus();
    notify(p.charging ? "success" : "info", p.charging ? `Phone connected to the ${p.charger} charger.` : "Phone disconnected from its charger.", "Phone Power", "phoneBattery");
    return p;
}

function tickPhonePower() {
    const s = getSettings();
    const p = ensurePhonePowerState(s);
    const now = Date.now();
    const elapsedMinutes = Math.max(0, Math.min(60, (now - Number(p.lastTickAt || now)) / 60000));
    p.lastTickAt = now;
    if (p.batterySimulationEnabled && elapsedMinutes > 0) {
        const before = p.batteryLevel;
        p.batteryLevel += p.charging ? elapsedMinutes * 5 : -elapsedMinutes * 0.35;
        p.batteryLevel = Math.max(0, Math.min(100, p.batteryLevel));
        if (p.batteryLevel <= 0) {
            p.shutDown = true;
            p.charging = false;
        } else if (p.shutDown && p.charging && p.batteryLevel >= 2) {
            p.shutDown = false;
        }
        if (p.batteryLevel >= 100) p.charging = false;
        for (const threshold of [20, 10, 5]) {
            if (before > threshold && p.batteryLevel <= threshold && p.lastWarnLevel > threshold) {
                p.lastWarnLevel = threshold;
                notify("warning", `Phone battery is down to ${threshold}%.`, "Phone Power", "phoneBattery");
                break;
            }
        }
        if (p.batteryLevel > 25) p.lastWarnLevel = 101;
    } else if (!p.batterySimulationEnabled) {
        p.shutDown = false;
    }
    saveSettings();
    renderPhonePowerStatus();
}

async function renderBillsApp() {
    const body = document.getElementById("phone-bills-list");
    if (!body) return;
    try {
        const mod = await import("./taxJailManager.js");
        const s = getSettings();
        const bills = mod.listBills?.(s) || [];
        const symbol = String(s.currencySymbol || "G");
        const unpaid = bills.filter((bill) => bill.status === "unpaid");
        $("#phone-bills-summary").text(`${unpaid.length} unpaid · ${unpaid.reduce((sum, bill) => sum + Number(bill.amount || 0), 0)} ${symbol} due`);
        body.innerHTML = bills.length ? bills.map((bill) => `
            <article style="padding:12px; border:1px solid rgba(255,255,255,.1); border-radius:14px; background:rgba(255,255,255,.05); display:grid; gap:6px;">
                <div style="display:flex; justify-content:space-between; gap:10px;"><strong>${parseMarkdown(String(bill.name || "Bill"))}</strong><span>${Math.round(Number(bill.amount || 0))} ${symbol}</span></div>
                <div style="font-size:11px; opacity:.72;">${parseMarkdown(String(bill.source || bill.category || "General"))} · due Day ${Number(bill.dueDay || 0)}</div>
                ${bill.status === "unpaid" ? `<button class="phone-pay-bill" data-bill-id="${String(bill.id || "")}" style="height:36px; border:0; border-radius:10px; background:#2dd4bf; color:#00110a; font-weight:900;">Pay bill</button>` : '<div style="color:#86efac; font-weight:800;">Paid</div>'}
            </article>`).join("") : '<div style="padding:20px; text-align:center; opacity:.72;">No bills have been issued yet. Home, phone-plan, vehicle, property, and business costs appear here as the calendar advances.</div>';
    } catch (_) {
        body.innerHTML = '<div style="padding:20px; text-align:center;">Bills could not be loaded.</div>';
    }
}

async function renderHomesteadApp() {
    const $view = $("#uie-app-homestead-view");
    if (!$view.length) return;
    
    const s = getSettings();
    const home = s.primaryHome;
    const currency = s.currencySymbol || "G";
    
    if (!home || !home.name) {
        $view.find("#homestead-name").text("No Primary Home");
        $view.find("#homestead-desc").text("Pick a residence on the map and register it as your home anchor to unlock manager tools.");
        $view.find("#homestead-stats").html("");
        $view.find("#homestead-upgrades-section").hide();
        return;
    }
    
    $view.find("#homestead-name").text(home.name);
    $view.find("#homestead-desc").text(home.description || "Your registered primary residence.");
    
    const unpaidBills = Array.isArray(home.bills) ? home.bills.filter((bill) => bill?.status === "unpaid") : [];
    const currentDay = Math.max(1, Number(s.playerRoom?.day || 1));
    const establishedDay = Math.max(1, Number(home.establishedDay || home.lastBilledDay || currentDay));
    
    $view.find("#homestead-stats").html(`
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Established:</span><strong>Day ${establishedDay}</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Bills Pending:</span><strong style="color:${unpaidBills.length ? '#f87171' : '#4ade80'}">${unpaidBills.length} unpaid</strong></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Current Funds:</span><strong style="color:#fbbf24;">${Number(s.gold || s.currency || 0)}${currency}</strong></div>
    `);
    
    const upgrades = home.upgrades || {};
    const securityActive = upgrades.securityBoundary === true;
    const hearthActive = upgrades.cozyHearth === true;
    const teleportActive = upgrades.teleportAnchor === true;
    
    const upgradesHtml = `
        <div style="display:flex; flex-direction:column; gap:10px;">
            <button type="button" class="homestead-upgrade-btn ${securityActive ? 'is-active' : ''}" data-upgrade="securityBoundary" data-cost="120" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:10px 14px; border-radius:10px; border:1px solid ${securityActive ? '#cba35c' : 'rgba(255,255,255,0.15)'}; background:${securityActive ? 'rgba(203,163,92,0.15)' : 'rgba(0,0,0,0.2)'}; color:${securityActive ? '#cba35c' : '#ddd'}; font-size:12px; cursor:pointer;">
                <span><i class="fa-solid fa-shield" style="margin-right:6px;"></i> Security Boundary</span>
                <strong>${securityActive ? 'Active' : '120G'}</strong>
            </button>
            <button type="button" class="homestead-upgrade-btn ${hearthActive ? 'is-active' : ''}" data-upgrade="cozyHearth" data-cost="80" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:10px 14px; border-radius:10px; border:1px solid ${hearthActive ? '#cba35c' : 'rgba(255,255,255,0.15)'}; background:${hearthActive ? 'rgba(203,163,92,0.15)' : 'rgba(0,0,0,0.2)'}; color:${hearthActive ? '#cba35c' : '#ddd'}; font-size:12px; cursor:pointer;">
                <span><i class="fa-solid fa-fire" style="margin-right:6px;"></i> Cozy Rest Hearth</span>
                <strong>${hearthActive ? 'Active' : '80G'}</strong>
            </button>
            <button type="button" class="homestead-upgrade-btn ${teleportActive ? 'is-active' : ''}" data-upgrade="teleportAnchor" data-cost="150" style="display:flex; justify-content:space-between; align-items:center; width:100%; padding:10px 14px; border-radius:10px; border:1px solid ${teleportActive ? '#cba35c' : 'rgba(255,255,255,0.15)'}; background:${teleportActive ? 'rgba(203,163,92,0.15)' : 'rgba(0,0,0,0.2)'}; color:${teleportActive ? '#cba35c' : '#ddd'}; font-size:12px; cursor:pointer;">
                <span><i class="fa-solid fa-circle-nodes" style="margin-right:6px;"></i> Teleport Anchor</span>
                <strong>${teleportActive ? 'Active' : '150G'}</strong>
            </button>
        </div>
    `;
    
    $view.find("#homestead-upgrades-list").html(upgradesHtml);
    $view.find("#homestead-upgrades-section").show();
}

function isPhoneMobileViewport() {
    try {
        const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
        return coarse || Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 760;
    } catch (_) {
        return false;
    }
}
const phoneEventSeen = new Set();
const phoneEventSeenOrder = [];
const PHONE_EVENT_SEEN_MAX = 320;

function isCodiceMode(settings = getSettings()) {
    const mode = (() => {
        try { return String(getGameMode(settings) || "").toLowerCase(); } catch (_) { return ""; }
    })();
    return mode === "high-fantasy" || mode === "rpg";
}

function deviceSkinForCurrentMode(settings = getSettings()) {
    if (isCodiceMode(settings)) return "scroll";
    const stored = String(settings?.phone?.deviceSkin || "modern");
    return ["modern", "y2k", "future", "scroll"].includes(stored) ? stored : "modern";
}

function seenPhoneEvent(key) {
    const k = String(key || "").trim();
    if (!k) return false;
    if (phoneEventSeen.has(k)) return true;
    phoneEventSeen.add(k);
    phoneEventSeenOrder.push(k);
    while (phoneEventSeenOrder.length > PHONE_EVENT_SEEN_MAX) {
        const drop = phoneEventSeenOrder.shift();
        if (drop) phoneEventSeen.delete(drop);
    }
    return false;
}

function isInactiveChatMesNode(m) {
    try {
        if (!m) return true;
        if (m.hidden === true) return true;
        if (m.getAttribute?.("hidden") != null) return true;
        const cls = String(m.className || "").toLowerCase();
        if (/(swipe|swiped|deleted|is_deleted|is-hidden|is_hidden|mes_hide|mes_hidden|mes_removed|mes_deleted)/i.test(cls)) return true;
        const dd = String(m.getAttribute?.("data-deleted") || "").toLowerCase();
        const dh = String(m.getAttribute?.("data-hidden") || "").toLowerCase();
        if (dd === "true" || dh === "true") return true;
        return false;
    } catch (_) {
        return false;
    }
}

function getMainChatContext(lines) {
    try {
        const max = Math.max(3, Number(lines || 10));
        const nodes = Array.from(document.querySelectorAll("#chat .mes"))
            .filter((m) => !isInactiveChatMesNode(m))
            .slice(-1 * max);
        const out = [];
        for (const m of nodes) {
            const name =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                "";
            const text =
                m.querySelector(".mes_text")?.textContent ||
                m.querySelector(".mes-text")?.textContent ||
                m.querySelector(".message")?.textContent ||
                m.textContent ||
                "";
            const nm = String(name || "").trim() || "Unknown";
            const tx = String(text || "").trim();
            if (!tx) continue;
            out.push(`${nm}: ${tx}`.slice(0, 360));
        }
        if (!out.length) return "";
        return `[Recent RP]\n${out.join("\n")}`.slice(0, 2200);
    } catch (_) {
        return "";
    }
}

function ensurePhoneWindowOnScreen(forceCenter = false) {
    try {
        const el = document.getElementById("uie-phone-window");
        if (!el) return;
        const $p = $(el);
        const vw = Number(window.innerWidth || document.documentElement.clientWidth || 0);
        const vh = Number(window.innerHeight || document.documentElement.clientHeight || 0);
        if (!vw || !vh) return;

        // Ensure measurable
        try { $p.css("position", "fixed"); } catch (_) {}

        const rect = el.getBoundingClientRect();
        const w = Number(rect?.width) || Number($p.outerWidth?.() || 0) || 380;
        const h = Number(rect?.height) || Number($p.outerHeight?.() || 0) || 720;
        const margin = 8;

        const curLeft = parseFloat(String($p.css("left") || ""));
        const curTop = parseFloat(String($p.css("top") || ""));
        const hasCur = Number.isFinite(curLeft) && Number.isFinite(curTop);

        const offScreen =
            !rect ||
            rect.top < margin ||
            rect.left < margin ||
            rect.bottom > (vh - margin) ||
            rect.right > (vw - margin);

        if (!forceCenter && hasCur && !offScreen) return;

        const maxX = Math.max(margin, vw - w - margin);
        const maxY = Math.max(margin, vh - h - margin);
        const cx = Math.max(margin, Math.min(Math.round((vw - w) / 2), maxX));
        const cy = Math.max(margin, Math.min(Math.round((vh - h) / 2), maxY));

        $p.css({
            position: "fixed",
            left: `${cx}px`,
            top: `${cy}px`,
            right: "auto",
            bottom: "auto",
            transform: "none",
        });
    } catch (_) {}
}

async function relayRelationship(name, text, source) {
    try {
        const mod = await import("./social.js");
        if (typeof mod?.updateRelationshipScore !== "function") return;
        await mod.updateRelationshipScore(String(name || ""), String(text || ""), String(source || ""));
    } catch (_) {}
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensurePhoneEconomyState(s) {
    return ensureEconomyState(s);
}

function formatPhoneCurrency(amount, s = getSettings()) {
    return formatCurrency(amount, s);
}

function ensurePhoneMailState(s) {
    if (!s.phone) s.phone = {};
    if (!s.phone.email || typeof s.phone.email !== "object") s.phone.email = {};
    if (!Array.isArray(s.phone.email.inbox)) s.phone.email.inbox = [];
    if (!Array.isArray(s.phone.email.sent)) s.phone.email.sent = [];
    if (!Array.isArray(s.phone.applications)) s.phone.applications = [];
}

function inferApplicationKindFromText(text) {
    const hay = String(text || "").toLowerCase();
    if (/\b(school|academy|college|university|class|course|enroll|admission)\b/.test(hay)) return "school";
    if (/\b(gig|contract|freelance|quest|commission|shift)\b/.test(hay)) return "gig";
    return "job";
}

function renderEmailApp() {
    const s = ensurePhoneEconomyState(getSettings());
    ensurePhoneMailState(s);
    const inbox = s.phone.email.inbox || [];
    const sent = s.phone.email.sent || [];
    const apps = s.phone.applications || [];
    const $inbox = $("#email-inbox").empty();
    const $sent = $("#email-sent").empty();
    const $apps = $("#email-applications").empty();
    if (!$inbox.length) return;
    if (!inbox.length) $inbox.html('<div style="opacity:0.7; text-align:center; padding:12px; border:1px dashed rgba(255,255,255,0.16); border-radius:14px;">No email yet.</div>');
    inbox.slice(0, 40).forEach((m) => {
        const links = (Array.isArray(m.links) ? m.links : []).map((l) => `<button class="email-open-link" data-url="${esc(l.url || l.href || l)}" style="height:28px; padding:0 10px; border-radius:10px; border:none; background:#60a5fa; color:#001329; font-weight:900; cursor:pointer; margin-top:8px;">${esc(l.label || l.url || l.href || "Open")}</button>`).join(" ");
        $inbox.append(`<article class="email-card ${m.unread ? "unread" : ""}" data-id="${esc(m.id)}"><div style="font-weight:900;">${esc(m.subject || "Message")}</div><div style="font-size:12px; opacity:0.72;">${esc(m.from || "unknown")} · ${new Date(m.receivedAt || Date.now()).toLocaleString()}</div><div style="margin-top:8px; white-space:pre-wrap;">${parseMarkdown(m.body || "")}</div>${links}</article>`);
    });
    if (!sent.length) $sent.html('<div style="opacity:0.65; text-align:center; padding:10px;">No sent mail.</div>');
    sent.slice(0, 20).forEach((m) => $sent.append(`<article class="email-card"><div style="font-weight:900;">${esc(m.subject || "Message")}</div><div style="font-size:12px; opacity:0.72;">To ${esc(m.to || "unknown")}</div><div style="margin-top:8px; white-space:pre-wrap;">${parseMarkdown(m.body || "")}</div></article>`));
    if (!apps.length) $apps.html('<div style="opacity:0.65; text-align:center; padding:10px;">No applications registered.</div>');
    apps.slice(0, 30).forEach((a) => $apps.append(`<div class="email-app-row"><strong>${esc(a.title || "Application")}</strong><span>${esc(a.type || "job")} · ${esc(a.status || "submitted")}</span></div>`));
}

function getPhoneSocialContacts(s) {
    const out = [];
    for (const group of ["friends", "associates", "romance", "family", "rivals"]) {
        const list = Array.isArray(s?.social?.[group]) ? s.social[group] : [];
        for (const p of list) {
            const name = String(p?.name || "").trim();
            if (name && !out.find(x => x.name.toLowerCase() === name.toLowerCase())) out.push({ name, person: p, group });
        }
    }
    return out;
}

function phoneTransitContext(s) {
    const nodes = collectTransitNodes(s?.simpleMap || {}, s);
    const location = String(s?.worldState?.currentLocation || s?.worldState?.location || "Current Location").trim();
    const origin = nodes.find((node) => transitId(node?.name, "") === transitId(location, ""))
        || { id: transitId(location), name: location, type: "exterior", accessModes: ["road", "foot"] };
    const assets = [...(s?.inventory?.assets || []), ...(s?.assets || [])].map((asset) => ({
        ...asset,
        travelCategory: asset?.travelCategory || inferTravelCategory(asset),
    }));
    return { origin, assets, modes: availableModesForNode(origin, assets) };
}

function selectedPhoneTravelRoute() {
    return phoneTravelRoutes.get(String($("#travel-destination").val() || "")) || null;
}

function phoneTransitCredential(settings, locationId = "") {
    const credential = getDefaultCredential(settings, "transit", { locationId });
    if (!credential || credential.status !== "active") return null;
    if (credential.expiresAt !== null && credential.expiresAt <= Date.now()) return null;
    return credential;
}

function renderPhoneRouteSelection(s, context, preferredMode = "") {
    const $mode = $("#travel-mode");
    const previousMode = String(preferredMode || $mode.val() || "rideshare");
    const modes = context.modes.length ? context.modes : ["rideshare", "bus"];
    $mode.empty();
    modes.forEach((mode) => {
        const config = TRANSIT_MODES[mode];
        if (config) $mode.append(`<option value="${esc(mode)}">${esc(config.label)}</option>`);
    });
    $mode.val(modes.includes(previousMode) ? previousMode : modes[0]);
    const mode = String($mode.val() || modes[0]);
    const transitPass = phoneTransitCredential(s, context.origin.id || context.origin.name);
    const passApplies = Boolean(transitPass && ["train", "bus", "boat"].includes(mode));
    const routes = buildTransitRoutes({ settings: s, mapState: s.simpleMap || {}, origin: context.origin, mode });
    phoneTravelRoutes = new Map(routes.map((route) => [route.id, { ...route, phoneFare: passApplies ? 0 : route.fare, passApplies, passCredentialId: passApplies ? transitPass.id : null }]));
    const $dest = $("#travel-destination").empty();
    if (!routes.length) {
        $dest.append('<option value="">No compatible routes from here</option>').prop("disabled", true);
    } else {
        $dest.prop("disabled", false);
        routes.forEach((route) => {
            const visibleName = route.discovered || ensureTravelState(s).discoveredDocks[route.toId] ? route.to : "Undiscovered arrival point";
            $dest.append(`<option value="${esc(route.id)}">${esc(visibleName)} · ${route.duration}m</option>`);
        });
    }
    $("#travel-rideshare-panel").toggle(mode === "rideshare");
}

function updatePhoneTravelQuote(s) {
    const route = selectedPhoneTravelRoute();
    if (!route) {
        $("#travel-fare").val("No route selected");
        $("#travel-route-summary").text("Reach a mapped departure point or discover a compatible destination.");
        $("#travel-pay-go, #travel-rideshare-dispatch").prop("disabled", true).css("opacity", .45);
        return;
    }
    const serviceOption = document.querySelector("#travel-rideshare-class option:checked");
    const serviceMultiplier = route.mode === "rideshare" ? Math.max(1, Number(serviceOption?.dataset?.multiplier || 1)) : 1;
    const quoted = {
        ...route,
        fare: route.passApplies ? 0 : Math.round(Number(route.phoneFare ?? route.fare) * serviceMultiplier),
        capacity: route.mode === "rideshare" && serviceOption?.value === "cargo" ? Math.max(8, Number(route.capacity || 0)) : route.capacity,
    };
    const evaluation = evaluateTransitRoute(s, quoted);
    const pass = route.passCredentialId ? (s.phone.credentials || []).find((credential) => credential.id === route.passCredentialId) : null;
    $("#travel-fare").val(route.passApplies ? `Covered by ${pass?.typeName || "Transit Pass"}` : formatPhoneCurrency(quoted.fare, s));
    const schedule = route.schedule?.length ? ` · ${route.schedule.join(", ")}` : "";
    const warning = evaluation.missing.length ? ` · ${evaluation.missing[0]}` : "";
    $("#travel-route-summary").text(`${route.distance} route units · ${route.duration} min · ${Math.round(route.risk * 100)}% event risk · ${route.controllingFaction}${schedule}${warning}`);
    $("#travel-pay-go, #travel-rideshare-dispatch").prop("disabled", !evaluation.ok).css("opacity", evaluation.ok ? 1 : .45);
    if (route.mode === "rideshare") {
        const service = String($("#travel-rideshare-class").val() || "standard");
        const pickup = 2 + (parseInt(transitId(route.id).slice(-2), 36) || 0) % 7;
        $("#travel-rideshare-status").text(`${service[0].toUpperCase()}${service.slice(1)} pickup estimated in ${pickup} min. Driver and vehicle are assigned when requested.`);
    }
}

function renderTravelApp(preferredMode = "") {
    const s = ensurePhoneEconomyState(getSettings());
    const travel = ensureTravelState(s);
    const context = phoneTransitContext(s);
    $("#travel-wallet-line").text(`Wallet: ${formatPhoneCurrency(s.currency, s)}`);
    $("#travel-current-dock").text(`Current departure: ${travel.currentDockName || context.origin.name}${travel.activeTrip ? " · journey in progress" : ""}`);
    renderPhoneRouteSelection(s, context, preferredMode);
    updatePhoneTravelQuote(s);

    const $list = $("#travel-recent").empty();
    const recent = [...(travel.history || []), ...(s.phone.travel.history || [])]
        .sort((a, b) => Number(b.at || b.t || 0) - Number(a.at || a.t || 0))
        .slice(0, 8);
    if (!recent.length) {
        $list.html('<div style="opacity:0.7; text-align:center; padding:12px; border:1px dashed rgba(255,255,255,0.2); border-radius:14px;">No completed journeys yet.</div>');
        return;
    }
    recent.forEach((trip) => {
        const destination = trip.to || trip.destination || "Unknown destination";
        const mode = TRANSIT_MODES[trip.mode]?.label || trip.mode || "Transit";
        const detail = trip.aborted ? `Aborted · lost ${formatPhoneCurrency(trip.fareLost || 0, s)}` : `${formatPhoneCurrency(trip.fare || 0, s)} · ${trip.duration || "?"} min${trip.event ? ` · ${trip.event}` : ""}`;
        $list.append(`
            <div style="border-radius:14px; padding:10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08);">
                <div style="font-weight:900;">${esc(destination)}</div>
                <div style="font-size:12px; opacity:0.72;">${esc(mode)} · ${esc(detail)}</div>
            </div>
        `);
    });
}

function renderBankApp() {
    const s = ensurePhoneEconomyState(getSettings());
    syncAutomaticCredentials(s);
    const bank = s.phone.bank;
    const loggedIn = Boolean(bank.loggedIn || bank.username);
    $("#bank-login-screen").toggle(!loggedIn);
    $("#bank-dashboard").css("display", loggedIn ? "flex" : "none");
    if (!loggedIn) return;
    
    const bankCard = getDefaultCredential(s, "payment");
    const $container = $("#bank-card-visual-container");
    if ($container.length) {
        if (bankCard) {
            $container.html(`<img src="${bankCard.appearance?.frontImage || bankCard.image || ""}" alt="${esc(bankCard.typeName)}" style="width:100%; border-radius:8px; box-shadow:0 6px 14px rgba(0,0,0,0.4); margin-bottom:12px; border:1px solid rgba(255,255,255,0.08);">`);
        } else {
            $container.html('<div style="padding:10px; text-align:center; border:1px dashed rgba(255,255,255,0.15); border-radius:8px; font-size:11px; opacity:0.75; margin-bottom:12px;"><i class="fa-solid fa-id-card"></i> No active payment credential.</div>');
        }
    }
    
    $("#bank-welcome").text(String(bank.username || "Account holder"));
    $("#bank-checking").text(formatPhoneCurrency(s.currency, s));
    $("#bank-savings").text(formatPhoneCurrency(bank.savings || 0, s));

    // Render Job Details
    if (s.activeJob) {
        $("#bank-job-details").text(`Active Job: ${s.activeJob.title} (${formatPhoneCurrency(s.activeJob.salary, s)}/day, ${(s.activeJob.taxRate * 100).toFixed(0)}% tax)`);
    } else {
        $("#bank-job-details").text("Active Job: Unemployed");
    }

    // Render Taxes Paid
    const taxesPaid = s.taxRefundState?.taxesPaidThisYear || 0;
    $("#bank-taxes-paid").text(`Taxes Paid This Year: ${formatPhoneCurrency(taxesPaid, s)}`);

    // Render Home details
    if (s.primaryHome && s.primaryHome.name) {
        $("#bank-home-details").text(`Primary Home: ${s.primaryHome.name}`);
    } else {
        $("#bank-home-details").text("Primary Home: None registered");
    }

    // Render Bills list
    const $billsList = $("#bank-bills-list").empty();
    const bills = s.primaryHome?.bills || [];
    const unpaid = bills.filter(b => b.status === "unpaid");
    if (!unpaid.length) {
        $billsList.html('<div style="opacity:0.75; font-size:12px; padding:4px;">No outstanding bills!</div>');
    } else {
        unpaid.forEach(b => {
            $billsList.append(`
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.06); padding:6px 8px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); font-size:12px; margin-bottom:4px;">
                    <div style="min-width:0; flex:1; padding-right:8px;">
                        <div style="font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(b.name)}</div>
                        <div style="opacity:0.75; font-size:11px;">Due: Day ${b.dueDay}</div>
                    </div>
                    <button class="pay-bill-btn" data-bill-id="${b.id}" style="padding:5px 10px; background:#22c55e; border:none; border-radius:10px; color:#fff; font-weight:800; cursor:pointer; font-size:11px; flex-shrink:0;">Pay ${formatPhoneCurrency(b.amount, s)}</button>
                </div>
            `);
        });
    }

    const $contact = $("#bank-contact").empty();
    const contacts = getPhoneSocialContacts(s);
    if (!contacts.length) $contact.append('<option value="">No contacts found</option>');
    contacts.forEach(c => $contact.append(`<option value="${esc(c.name)}">${esc(c.name)}</option>`));
    const $history = $("#bank-history").empty();
    const recent = (bank.history || []).slice(0, 8);
    if (!recent.length) {
        $history.html('<div style="opacity:0.7; text-align:center; padding:10px; border:1px dashed rgba(255,255,255,0.16); border-radius:14px;">No banking activity yet.</div>');
        return;
    }
    recent.forEach(h => {
        $history.append(`
            <div style="border-radius:14px; padding:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08);">
                <div style="font-weight:900;">${esc(h.title || "Transaction")}</div>
                <div style="font-size:12px; opacity:0.72;">${formatPhoneCurrency(h.amount || 0, s)} · ${new Date(h.t || Date.now()).toLocaleString()}</div>
            </div>
        `);
    });
}

function openPhoneHome() {
    try {
        const s = ensurePhoneEconomyState(getSettings());
        if (s?.phone) {
            s.phone.activeApp = "home";
            s.phone.activeAppName = "Home";
        }
        $("#uie-phone-window").show().css("display", "flex");
        $("#uie-phone-lockscreen").hide();
        $(".phone-app-window").hide();
        $("#uie-phone-homescreen").css("display", "flex").show();
        ensurePhoneWindowOnScreen(true);
    } catch (_) {}
}

function ensurePhoneMemoryLog(s) {
  s.phone = s.phone || {};
  if (!Array.isArray(s.phone.memoryLog)) s.phone.memoryLog = [];
}

function pushPhoneMemory(s, entry) {
  ensurePhoneMemoryLog(s);
  s.phone.memoryLog.unshift({
    id: `phmem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    t: Date.now(),
    ...entry,
  });
  s.phone.memoryLog = s.phone.memoryLog.slice(0, 200);
}

function renderPhoneMemories() {
  const s = getSettings();
  const box = $("#phone-memories-scroll");
  if (!box.length) return;
  const chunks = [];
  const ev = Array.isArray(s.phone?.events) ? s.phone.events : [];
  ev.slice(0, 40).forEach((e) => {
    const k = String(e?.kind || "event");
    const from = String(e?.from || e?.name || "").trim();
    const msg = String(e?.message || e?.body || "").trim();
    const line = `${k}${from ? ` · ${from}` : ""}${msg ? ` — ${msg.slice(0, 280)}` : ""}`;
    chunks.push(`<div style="border-bottom:1px solid rgba(255,255,255,0.08); padding:7px 0; font-size:12px;">${esc(line)}</div>`);
  });
  const ch = Array.isArray(s.phone?.callHistory) ? s.phone.callHistory : [];
  ch.slice(-12).reverse().forEach((c) => {
    const who = String(c?.who || "").trim() || "Unknown";
    const dur = Math.max(0, Math.round((Number(c?.endedAt || 0) - Number(c?.startedAt || 0)) / 1000));
    chunks.push(`<div style="border-bottom:1px solid rgba(255,255,255,0.08); padding:7px 0; font-size:12px; opacity:0.92;"><strong>Call</strong> · ${esc(who)} · ${dur}s</div>`);
  });
  const tabs = ["friends", "rivals", "romance", "family", "associate", "npc"];
  tabs.forEach((tab) => {
    const list = Array.isArray(s.social?.[tab]) ? s.social[tab] : [];
    list.forEach((p) => {
      const nm = String(p?.name || "").trim();
      (Array.isArray(p?.memories) ? p.memories : []).slice(0, 4).forEach((m) => {
        const tx = String(m?.text || "").trim();
        if (!tx) return;
        chunks.push(`<div style="border-bottom:1px solid rgba(255,255,255,0.08); padding:7px 0; font-size:12px;"><strong>${esc(nm)}</strong> <span style="opacity:0.65;">(${tab})</span><br/><span style="opacity:0.88;">${esc(tx.slice(0, 360))}</span></div>`);
      });
    });
  });
  const ml = Array.isArray(s.phone?.memoryLog) ? s.phone.memoryLog : [];
  ml.slice(0, 40).forEach((m) => {
    const t = String(m?.text || m?.summary || "").trim();
    if (!t) return;
    chunks.push(`<div style="border-bottom:1px solid rgba(255,255,255,0.08); padding:7px 0; font-size:12px; opacity:0.9;">${esc(t.slice(0, 400))}</div>`);
  });
  box.html(chunks.length ? chunks.join("") : `<div style="opacity:0.75;">No phone or social memories yet.</div>`);
}

function ensureInstavibePhoneSettings(s = getSettings()) {
    if (!s.phone) s.phone = {};
    if (!s.phone.instavibe || typeof s.phone.instavibe !== "object") s.phone.instavibe = {};
    const iv = s.phone.instavibe;
    if (typeof iv.enabled !== "boolean") iv.enabled = false;
    if (typeof iv.prompted !== "boolean") iv.prompted = false;
    if (!["for_you", "chronological"].includes(String(iv.sortMode || ""))) iv.sortMode = "for_you";
    if (!Array.isArray(iv.notifications)) iv.notifications = [];
    return iv;
}

function setInstavibeOnboardingStage(stage = 1) {
    const $gate = $("#instavibe-onboarding");
    if (!$gate.length) return;
    if (stage === 2) {
        $("#instavibe-onboarding-title").text("Instavibe is on");
        $("#instavibe-onboarding-copy").text("You can always turn this feature off in Phone settings.");
        $("#instavibe-onboarding-actions").html('<button type="button" id="instavibe-ok-btn" style="width:100%; min-height:40px; border:none; border-radius:12px; background:#e21d5a; color:#fff; font-weight:900; cursor:pointer;">OK</button>');
    } else {
        $("#instavibe-onboarding-title").text("Turn on Instavibe?");
        $("#instavibe-onboarding-copy").text("Instavibe adds a live social feed that updates over time.");
        $("#instavibe-onboarding-actions").html(`
            <button type="button" id="instavibe-enable-btn" style="flex:1; min-height:40px; border:none; border-radius:12px; background:#e21d5a; color:#fff; font-weight:900; cursor:pointer;">Enable</button>
            <button type="button" id="instavibe-later-btn" style="flex:1; min-height:40px; border:1px solid #475569; border-radius:12px; background:#1e293b; color:#f8fafc; font-weight:800; cursor:pointer;">Not now</button>
        `);
    }
    $gate.css("display", "flex");
}

function maybeShowInstavibeGate() {
    const s = getSettings();
    const iv = ensureInstavibePhoneSettings(s);
    if (!iv.prompted && !iv.enabled) {
        setInstavibeOnboardingStage(1);
        return true;
    }
    $("#instavibe-onboarding").hide();
    return false;
}

async function syncInstavibeSetting(enabled, sortMode) {
    const s = getSettings();
    const iv = ensureInstavibePhoneSettings(s);
    iv.enabled = !!enabled;
    iv.prompted = true;
    if (sortMode) iv.sortMode = sortMode;
    saveSettings();
    try {
        await window.UIE_BACKEND_BRIDGE?.saveInstavibeSettings?.(iv.enabled, iv.sortMode);
    } catch (_) {}
    $("#p-instavibe-enabled").prop("checked", iv.enabled);
}

const IV_TAGS = ["Conflict", "Romance", "Work", "Money", "Fitness", "Drama", "Cozy", "Food", "Social", "Travel"];
const IV_TONES = ["Positive", "Neutral", "Negative"];
let _ivActiveTab = "home";
let _ivComposerTag = "Cozy";
let _ivComposerTone = "Neutral";
let _ivSearchQuery = "";
let _ivActiveTrend = "";
let _ivAllPosts = [];
let _ivFollowedNpcs = null;

function _ivLoadFollowed() {
    if (_ivFollowedNpcs !== null) return _ivFollowedNpcs;
    try {
        const s = getSettings();
        _ivFollowedNpcs = new Set(Array.isArray(s?.phone?.instavibe?.following) ? s.phone.instavibe.following : []);
    } catch (_) { _ivFollowedNpcs = new Set(); }
    return _ivFollowedNpcs;
}

function _ivSaveFollowed() {
    try {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!s.phone.instavibe) s.phone.instavibe = {};
        s.phone.instavibe.following = [..._ivLoadFollowed()];
        saveSettings();
    } catch (_) {}
}

function _ivProfile() {
    const s = getSettings();
    const iv = ensureInstavibePhoneSettings(s);
    if (!iv.profile || typeof iv.profile !== "object") iv.profile = {};
    return iv.profile;
}

function _ivExtractMentions(content) {
    const known = new Map();
    _ivAllPosts.forEach((post) => {
        const name = String(post?.username || post?.author || "").trim();
        if (name) known.set(name.toLowerCase().replace(/\s+/g, "_"), name);
    });
    return [...new Set((String(content || "").match(/@([a-zA-Z][\w-]{1,63})/g) || [])
        .map((token) => known.get(token.slice(1).toLowerCase()) || token.slice(1).replace(/[_-]+/g, " ")))].slice(0, 16);
}

function _ivRenderContent(content) {
    return parseMarkdown(String(content || "")).replace(/(^|\s)@([a-zA-Z][\w-]{1,63})/g, (_all, prefix, handle) =>
        `${prefix}<button type="button" class="iv-mention" data-npc-profile="${esc(handle.replace(/[_-]+/g, " "))}">@${esc(handle)}</button>`
    );
}

function _ivAvatarHtml(name, url, size) {
    const sz = size || 38;
    const initial = String(name || "?").charAt(0).toUpperCase();
    if (url) {
        return `<div class="iv-avatar" style="width:${sz}px;height:${sz}px;" data-npc="${esc(name)}"><img src="${esc(url)}" alt="${esc(name)}" onerror="this.style.display='none';this.parentNode.textContent='${initial}'"></div>`;
    }
    return `<div class="iv-avatar" style="width:${sz}px;height:${sz}px;" data-npc="${esc(name)}">${initial}</div>`;
}

function _ivGetAvatarUrl(name) {
    return `/assets/image/file/npc_avatar_${String(name || "").toLowerCase().replace(/\s+/g, "_")}`;
}

async function renderSocialApp() {
    const container = $("#social-feed-container");
    if (!container.length) return;
    const s = getSettings();
    const iv = ensureInstavibePhoneSettings(s);
    if (!iv.enabled) {
        container.html('<div class="iv-empty">Instavibe is off.</div>');
        maybeShowInstavibeGate();
        return;
    }
    $("#instavibe-onboarding").hide();
    _ivRenderComposerPills();
    _ivRenderTab(_ivActiveTab);
}

function _ivRenderComposerPills() {
    const $tags = $("#iv-tag-pills").empty();
    IV_TAGS.forEach(t => {
        $tags.append(`<button type="button" class="iv-pill-btn ${t === _ivComposerTag ? "is-active" : ""}" data-iv-tag="${esc(t)}">${esc(t)}</button>`);
    });
    const $tones = $("#iv-tone-pills").empty();
    IV_TONES.forEach(t => {
        $tones.append(`<button type="button" class="iv-pill-btn ${t === _ivComposerTone ? "is-active" : ""}" data-iv-tone="${esc(t)}">${esc(t)}</button>`);
    });
}

function _ivSwitchTab(tab) {
    _ivActiveTab = tab;
    $(".iv-tab").removeClass("is-active");
    $(`.iv-tab[data-iv-tab="${tab}"]`).addClass("is-active");
    $(".iv-sub-view").removeClass("is-active");
    $(`#iv-tab-${tab}`).addClass("is-active");
    _ivRenderTab(tab);
}

async function _ivRenderTab(tab) {
    if (tab === "home") await _ivRenderHomeFeed();
    else if (tab === "explore") await _ivRenderExplore();
    else if (tab === "alerts") _ivRenderNotifications();
    else if (tab === "profile") _ivRenderMyProfile();
}

async function _ivRenderHomeFeed() {
    const container = $("#social-feed-container");
    container.html('<div class="iv-empty"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5em;"></i><br>Loading...</div>');
    try {
        const s = getSettings();
        const iv = ensureInstavibePhoneSettings(s);
        const res = await (window.UIE_BACKEND_BRIDGE?.getInstavibeFeed
            ? window.UIE_BACKEND_BRIDGE.getInstavibeFeed(iv.sortMode)
            : window.UIE_BACKEND_BRIDGE.getSocialPosts());
        _ivAllPosts = res?.posts || [];
        const queued = Number(res?.state?.queued_count || 0);
        if (queued > 0) {
            try { notify("info", `${queued} new post${queued === 1 ? "" : "s"} available.`, "Instavibe"); } catch (_) {}
        }
        _ivRenderFilteredFeed();
    } catch (e) {
        container.html('<div class="iv-empty">Instavibe needs the local backend for live updates.</div>');
    }
}

function _ivRenderFilteredFeed() {
    const container = $("#social-feed-container");
    const persona = getPersonaName() || "Player";
    let posts = _ivAllPosts;
    const q = _ivSearchQuery.trim().toLowerCase();
    const trend = _ivActiveTrend;
    if (q) {
        posts = posts.filter(p => {
            const author = String(p.username || p.author || "").toLowerCase();
            const content = String(p.content || "").toLowerCase();
            const tag = String(p.tag || "").toLowerCase();
            return author.includes(q) || content.includes(q) || tag.includes(q);
        });
    }
    if (trend) {
        posts = posts.filter(p => String(p.tag || "").toLowerCase() === trend.toLowerCase());
    }
    if (!posts.length) {
        container.html('<div class="iv-empty">No posts found.</div>');
        return;
    }
    let html = "";
    posts.forEach(post => {
        const dateStr = _ivTimeAgo(post.ts);
        const liked = (post.likes_by || []).includes(persona);
        const likeCount = post.metrics?.likes ?? post.likes ?? 0;
        const imgUrl = post.image_url || "";
        const imgStatus = post.image_status || "";
        let imageHtml = "";
        if (imgUrl) {
            imageHtml = `<div class="iv-post-image"><img src="${esc(imgUrl)}" alt="post image" onerror="this.parentNode.style.display='none'"></div>`;
        } else if (imgStatus === "queued" || imgStatus === "processing") {
            imageHtml = `<div class="iv-post-image-skeleton"></div>`;
        }
        const commentsHtml = (post.comments || []).map(comment => `
            <div class="iv-comment">
                <span class="iv-comment-author" data-npc-profile="${esc(comment.author)}">${esc(comment.author)}</span>
                <span class="iv-comment-text">${parseMarkdown(comment.content)}</span>
            </div>
        `).join("");
        html += `
            <div class="iv-post-card" data-post-id="${esc(post.id)}">
                <div class="iv-post-header">
                    ${_ivAvatarHtml(post.username || post.author, _ivGetAvatarUrl(post.username || post.author))}
                    <div class="iv-post-meta">
                        <span class="iv-author-name" data-npc-profile="${esc(post.username || post.author)}">${esc(post.username || post.author)}</span>
                        <div class="iv-post-time">${esc(dateStr)}</div>
                    </div>
                </div>
                <div class="iv-post-content">${_ivRenderContent(post.content)}</div>
                ${imageHtml}
                <div class="iv-post-tags">
                    <span class="iv-tag-pill">#${esc(post.tag || "Cozy")}</span>
                    <span class="iv-tag-pill">${esc(post.tone || "Neutral")}</span>
                    <span class="iv-tag-pill">Reach ${Number(post.metrics?.reach || 0)}</span>
                </div>
                <div class="iv-actions">
                    <button class="iv-action-btn iv-like-btn ${liked ? "liked" : ""}" data-post-id="${esc(post.id)}">
                        <i class="fa-${liked ? "solid" : "regular"} fa-heart"></i>
                        <span class="iv-like-count">${likeCount}</span>
                    </button>
                    <button class="iv-action-btn iv-comment-toggle">
                        <i class="fa-regular fa-comment"></i>
                        <span>${(post.comments || []).length}</span>
                    </button>
                </div>
                <div class="iv-comments-section">
                    ${commentsHtml}
                    <form class="iv-comment-form" data-post-id="${esc(post.id)}">
                        <input type="text" class="iv-comment-input" placeholder="Write a comment..." required>
                        <button type="submit" class="iv-comment-submit">Reply</button>
                    </form>
                </div>
            </div>
        `;
    });
    container.html(html);
    _ivBindFeedEvents();
}

function _ivBindFeedEvents() {
    const container = $("#social-feed-container");
    container.find(".iv-like-btn").off("click").on("click", async function(e) {
        e.preventDefault();
        const postId = $(this).data("post-id");
        const persona = getPersonaName() || "Player";
        const $btn = $(this);
        const $count = $btn.find(".iv-like-count");
        const isLiked = $btn.hasClass("liked");
        if (!isLiked) {
            $btn.addClass("liked").find("i").attr("class", "fa-solid fa-heart");
            $count.text((parseInt($count.text()) || 0) + 1);
        } else {
            $btn.removeClass("liked").find("i").attr("class", "fa-regular fa-heart");
            $count.text(Math.max(0, (parseInt($count.text()) || 0) - 1));
        }
        try { await window.UIE_BACKEND_BRIDGE.toggleSocialLike(postId, persona); } catch (_) {}
    });
    container.find(".iv-comment-form").off("submit").on("submit", async function(e) {
        e.preventDefault();
        const postId = $(this).data("post-id");
        const $input = $(this).find(".iv-comment-input");
        const content = $input.val();
        if (!content.trim()) return;
        const persona = getPersonaName() || "Player";
        try {
            await window.UIE_BACKEND_BRIDGE.createSocialComment(postId, persona, content);
            $input.val("");
            await _ivRenderHomeFeed();
        } catch (err) {
            try { notify("error", "Could not send comment."); } catch (_) {}
        }
    });
    container.find("[data-npc-profile]").off("click").on("click", function(e) {
        e.preventDefault();
        const name = String($(this).data("npc-profile") || "");
        if (name) _ivOpenNpcProfile(name);
    });
}

async function _ivRenderExplore() {
    if (!_ivAllPosts.length) {
        try {
            const s = getSettings();
            const iv = ensureInstavibePhoneSettings(s);
            const res = await (window.UIE_BACKEND_BRIDGE?.getInstavibeFeed
                ? window.UIE_BACKEND_BRIDGE.getInstavibeFeed(iv.sortMode)
                : window.UIE_BACKEND_BRIDGE.getSocialPosts());
            _ivAllPosts = res?.posts || [];
        } catch (_) {}
    }
    const $trending = $("#iv-trending-tags").empty();
    const tagCounts = {};
    _ivAllPosts.forEach(p => { const t = p.tag || "Cozy"; tagCounts[t] = (tagCounts[t] || 0) + 1; });
    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    const allTags = sorted.length ? sorted.map(([t]) => t) : IV_TAGS;
    allTags.forEach(t => {
        $trending.append(`<button type="button" class="iv-trend-pill ${t === _ivActiveTrend ? "is-active" : ""}" data-iv-trend="${esc(t)}">#${esc(t)}</button>`);
    });
    const $suggest = $("#iv-suggested-people").empty();
    const authors = new Map();
    _ivAllPosts.forEach(p => {
        const name = String(p.username || p.author || "");
        if (name && !authors.has(name)) authors.set(name, p);
    });
    const followed = _ivLoadFollowed();
    const persona = (getPersonaName() || "Player").toLowerCase();
    let count = 0;
    for (const [name] of authors) {
        if (count >= 10) break;
        if (name.toLowerCase() === persona) continue;
        const isFollowing = followed.has(name);
        $suggest.append(`
            <div class="iv-suggest-row">
                ${_ivAvatarHtml(name, _ivGetAvatarUrl(name), 36)}
                <div class="iv-suggest-info">
                    <div class="iv-suggest-name" data-npc-profile="${esc(name)}">${esc(name)}</div>
                    <div class="iv-suggest-bio">${esc(name)} on Instavibe</div>
                </div>
                <button type="button" class="iv-follow-btn ${isFollowing ? "is-following" : ""}" data-follow-npc="${esc(name)}">${isFollowing ? "Following" : "Follow"}</button>
            </div>
        `);
        count++;
    }
    if (!count) $suggest.html('<div class="iv-empty">No suggestions yet.</div>');
    $suggest.find("[data-npc-profile]").off("click").on("click", function() { _ivOpenNpcProfile(String($(this).data("npc-profile"))); });
    $suggest.find("[data-follow-npc]").off("click").on("click", function() {
        const name = String($(this).data("follow-npc"));
        const followed = _ivLoadFollowed();
        const $btn = $(this);
        if (followed.has(name)) {
            followed.delete(name);
            $btn.removeClass("is-following").text("Follow");
        } else {
            followed.add(name);
            $btn.addClass("is-following").text("Following");
        }
        _ivSaveFollowed();
    });
}

function _ivRenderNotifications() {
    const $list = $("#iv-notifications-list").empty();
    const s = getSettings();
    const iv = ensureInstavibePhoneSettings(s);
    const notifs = Array.isArray(iv.notifications) ? iv.notifications : [];
    if (!notifs.length) {
        $list.html('<div class="iv-empty">No notifications yet.</div>');
        return;
    }
    let html = "";
    notifs.forEach(n => {
        const type = String(n.type || n.priority || "normal");
        const icon = type === "like" ? "fa-heart" : type === "follow" ? "fa-user-plus" : "fa-comment";
        const iconClass = type === "like" ? "like" : type === "follow" ? "follow" : "comment";
        html += `
            <div class="iv-notif-item">
                <div class="iv-notif-icon ${iconClass}"><i class="fa-solid ${icon}"></i></div>
                <div class="iv-notif-body">
                    <div class="iv-notif-text">${esc(n.sender || "")} ${esc(n.text || n.preview || "")}</div>
                    <div class="iv-notif-time">${n.ts ? _ivTimeAgo(n.ts) : ""}</div>
                </div>
            </div>
        `;
    });
    $list.html(html);
    $("#iv-alerts-badge").hide().text("0");
}

async function _ivRenderMyProfile() {
    if (!_ivAllPosts.length) {
        try {
            const s = getSettings();
            const iv = ensureInstavibePhoneSettings(s);
            const res = await (window.UIE_BACKEND_BRIDGE?.getInstavibeFeed
                ? window.UIE_BACKEND_BRIDGE.getInstavibeFeed(iv.sortMode)
                : window.UIE_BACKEND_BRIDGE.getSocialPosts());
            _ivAllPosts = res?.posts || [];
        } catch (_) {}
    }
    const $view = $("#iv-profile-view").empty();
    const profile = _ivProfile();
    const persona = String(profile.username || getPersonaName() || "Player").trim() || "Player";
    const personaPosts = _ivAllPosts.filter(p => String(p.username || p.author || "").toLowerCase() === persona.toLowerCase());
    const followed = _ivLoadFollowed();
    $view.html(`
        <div class="iv-profile-banner"></div>
        <div class="iv-profile-header">
            ${_ivAvatarHtml(persona, "", 56)}
            <div class="iv-profile-info">
                <div class="iv-profile-name">${esc(persona)}</div>
                <div class="iv-profile-handle">@${esc(persona.toLowerCase().replace(/\s+/g, "_"))}</div>
            </div>
            <button type="button" id="iv-profile-edit" class="iv-follow-btn" style="margin-left:auto;">Edit profile</button>
        </div>
        <div class="iv-profile-stats">
            <div class="iv-profile-stat"><b>${personaPosts.length}</b> posts</div>
            <div class="iv-profile-stat"><b>${followed.size}</b> following</div>
        </div>
        <div class="iv-profile-bio">${esc(String(profile.bio || "Your in-world social presence."))}</div>
        <div class="iv-section-label">Your Posts</div>
        <div class="iv-profile-posts" id="iv-my-posts"></div>
    `);
    const $myPosts = $("#iv-my-posts");
    $view.find("#iv-profile-edit").off("click").on("click", () => {
        const username = String(prompt("Instavibe username", profile.username || persona) || "").trim().replace(/^@/, "").slice(0, 40);
        if (!username) return;
        profile.username = username;
        profile.bio = String(prompt("Profile bio", profile.bio || "Your in-world social presence.") || "").trim().slice(0, 160);
        saveSettings();
        _ivRenderMyProfile();
    });
    if (!personaPosts.length) {
        $myPosts.html('<div class="iv-empty">You haven\'t posted yet.</div>');
        return;
    }
    let html = "";
    personaPosts.forEach(post => {
        const dateStr = _ivTimeAgo(post.ts);
        html += `
            <div class="iv-post-card">
                <div class="iv-post-header">
                    ${_ivAvatarHtml(post.username || post.author, _ivGetAvatarUrl(post.username || post.author))}
                    <div class="iv-post-meta">
                        <span class="iv-author-name">${esc(post.username || post.author)}</span>
                        <div class="iv-post-time">${esc(dateStr)}</div>
                    </div>
                </div>
                <div class="iv-post-content">${parseMarkdown(post.content)}</div>
                <div class="iv-post-tags">
                    <span class="iv-tag-pill">#${esc(post.tag || "Cozy")}</span>
                    <span class="iv-tag-pill">${esc(post.tone || "Neutral")}</span>
                </div>
            </div>
        `;
    });
    $myPosts.html(html);
}

async function _ivOpenNpcProfile(name) {
    const $overlay = $("#iv-npc-overlay");
    $("#iv-npc-overlay-name").text(name);
    const $content = $("#iv-npc-overlay-content").html('<div class="iv-empty"><i class="fa-solid fa-spinner fa-spin"></i><br>Loading...</div>');
    $overlay.addClass("is-open");
    const npcPosts = _ivAllPosts.filter(p => String(p.username || p.author || "").toLowerCase() === name.toLowerCase());
    const followed = _ivLoadFollowed();
    const isFollowing = followed.has(name);
    const postCount = npcPosts.length;
    let followerCount = 0;
    _ivAllPosts.forEach(p => { if ((p.likes_by || []).length > 3) followerCount++; });
    $content.html(`
        <div class="iv-profile-banner"></div>
        <div class="iv-profile-header">
            ${_ivAvatarHtml(name, _ivGetAvatarUrl(name), 56)}
            <div class="iv-profile-info">
                <div class="iv-profile-name">${esc(name)}</div>
                <div class="iv-profile-handle">@${esc(name.toLowerCase().replace(/\s+/g, "_"))}</div>
            </div>
        </div>
        <div style="padding:0 12px 8px;">
            <button type="button" class="iv-follow-btn ${isFollowing ? "is-following" : ""}" id="iv-npc-follow-btn" data-follow-npc="${esc(name)}" style="width:100%;">${isFollowing ? "Following" : "Follow"}</button>
        </div>
        <div class="iv-profile-stats">
            <div class="iv-profile-stat"><b>${postCount}</b> posts</div>
            <div class="iv-profile-stat"><b>${followerCount}</b> followers</div>
        </div>
        <div class="iv-section-label">Posts by ${esc(name)}</div>
        <div id="iv-npc-posts" style="padding:0 12px;"></div>
    `);
    const $npcPosts = $("#iv-npc-posts");
    if (!npcPosts.length) {
        $npcPosts.html('<div class="iv-empty">No posts from this user yet.</div>');
    } else {
        const persona = getPersonaName() || "Player";
        let html = "";
        npcPosts.forEach(post => {
            const dateStr = _ivTimeAgo(post.ts);
            const liked = (post.likes_by || []).includes(persona);
            const likeCount = post.metrics?.likes ?? post.likes ?? 0;
            const imgUrl = post.image_url || "";
            let imageHtml = "";
            if (imgUrl) {
                imageHtml = `<div class="iv-post-image"><img src="${esc(imgUrl)}" alt="post image" onerror="this.parentNode.style.display='none'"></div>`;
            } else if ((post.image_status || "") === "queued" || (post.image_status || "") === "processing") {
                imageHtml = `<div class="iv-post-image-skeleton"></div>`;
            }
            html += `
                <div class="iv-post-card" data-post-id="${esc(post.id)}">
                    <div class="iv-post-header">
                        ${_ivAvatarHtml(post.username || post.author, _ivGetAvatarUrl(post.username || post.author))}
                        <div class="iv-post-meta">
                            <span class="iv-author-name" data-npc-profile="${esc(post.username || post.author)}">${esc(post.username || post.author)}</span>
                            <div class="iv-post-time">${esc(dateStr)}</div>
                        </div>
                    </div>
                    <div class="iv-post-content">${parseMarkdown(post.content)}</div>
                    ${imageHtml}
                    <div class="iv-post-tags">
                        <span class="iv-tag-pill">#${esc(post.tag || "Cozy")}</span>
                        <span class="iv-tag-pill">${esc(post.tone || "Neutral")}</span>
                    </div>
                    <div class="iv-actions">
                        <button class="iv-action-btn iv-like-btn ${liked ? "liked" : ""}" data-post-id="${esc(post.id)}">
                            <i class="fa-${liked ? "solid" : "regular"} fa-heart"></i>
                            <span class="iv-like-count">${likeCount}</span>
                        </button>
                        <button class="iv-action-btn">
                            <i class="fa-regular fa-comment"></i>
                            <span>${(post.comments || []).length}</span>
                        </button>
                    </div>
                </div>
            `;
        });
        $npcPosts.html(html);
        $npcPosts.find(".iv-like-btn").off("click").on("click", async function(e) {
            e.preventDefault();
            const postId = $(this).data("post-id");
            const persona = getPersonaName() || "Player";
            const $btn = $(this);
            const $count = $btn.find(".iv-like-count");
            const isLiked = $btn.hasClass("liked");
            if (!isLiked) { $btn.addClass("liked").find("i").attr("class", "fa-solid fa-heart"); $count.text((parseInt($count.text()) || 0) + 1); }
            else { $btn.removeClass("liked").find("i").attr("class", "fa-regular fa-heart"); $count.text(Math.max(0, (parseInt($count.text()) || 0) - 1)); }
            try { await window.UIE_BACKEND_BRIDGE.toggleSocialLike(postId, persona); } catch (_) {}
        });
    }
    $content.find("[data-follow-npc]").off("click").on("click", function() {
        const n = String($(this).data("follow-npc"));
        const followed = _ivLoadFollowed();
        const $btn = $(this);
        if (followed.has(n)) { followed.delete(n); $btn.removeClass("is-following").text("Follow"); }
        else { followed.add(n); $btn.addClass("is-following").text("Following"); }
        _ivSaveFollowed();
    });
    $content.find("[data-npc-profile]").off("click").on("click", function() { _ivOpenNpcProfile(String($(this).data("npc-profile"))); });
}

function _ivTimeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - Number(ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(ts).toLocaleDateString();
}

function getPersonaName() {
    try {
        const ctx = getContext?.();
        return String(ctx?.name1 || "You").trim() || "You";
    } catch (_) {
        return "You";
    }
}

function getSocialMemoryBlockForName(targetName, maxItems = 8) {
    const s = getSettings();
    const nm = String(targetName || "").trim().toLowerCase();
    if (!nm) return "";
    const all = ["friends", "associates", "romance", "family", "rivals"].flatMap(k => (s?.social?.[k] || []));
    const p = all.find(x => String(x?.name || "").trim().toLowerCase() === nm);
    const aff = Math.max(0, Math.min(100, Number(p?.affinity ?? 50)));
    const disp = (() => {
        if (aff <= 10) return "Hostile";
        if (aff <= 25) return "Wary";
        if (aff <= 45) return "Cold";
        if (aff <= 60) return "Neutral";
        if (aff <= 75) return "Warm";
        if (aff <= 90) return "Friendly";
        return "Devoted";
    })();
    const talkCap = (() => {
        if (aff <= 10) return 25;
        if (aff <= 25) return 40;
        if (aff <= 45) return 55;
        if (aff <= 60) return 70;
        if (aff <= 75) return 85;
        if (aff <= 90) return 92;
        return 100;
    })();
    const mems = Array.isArray(p?.memories) ? p.memories.slice() : [];
    if (!mems.length) return "";
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const who = getPersonaName();
    const lines = mems.slice(0, Math.max(1, Number(maxItems || 8))).map(m => `- ${String(m?.text || "").trim()}${m?.impact ? ` (Impact: ${String(m.impact).trim()})` : ""}`).filter(Boolean);
    if (!lines.length) return "";
    return `\n[RELATIONSHIP STATE]\nNPC: ${targetName}\nAffinity: ${aff}/100\nDisposition: ${disp}\nTalk-only cap: ${talkCap}/100 (words alone cannot exceed this; action is required beyond)\nRules: hostile NPCs do not de-escalate from words alone; compliments/manipulation can backfire.\n[/RELATIONSHIP STATE]\n\nVITAL SOCIAL MEMORIES (${targetName}'s memory of ${who}):\n${lines.join("\n")}\n`;
}

function getCharacterCardBlock(maxLen = 2200) {
    try {
        const ctx = getContext?.();
        const candidate =
            ctx?.character ||
            ctx?.char ||
            ctx?.characterCard ||
            (Array.isArray(ctx?.characters) ? ctx.characters[0] : null) ||
            null;
        const card = candidate?.data?.data || candidate?.data || candidate || {};

        const name = String(card?.name || candidate?.name || ctx?.name2 || "").trim();
        const description = String(card?.description || card?.desc || "").trim();
        const personality = String(card?.personality || "").trim();
        const scenario = String(card?.scenario || "").trim();
        const firstMes = String(card?.first_mes || card?.firstMessage || "").trim();
        const mesExample = String(card?.mes_example || card?.example_dialogue || card?.exampleDialogue || "").trim();
        const tags = Array.isArray(card?.tags) ? card.tags.map(t => String(t || "").trim()).filter(Boolean) : [];

        const lines = [];
        if (name) lines.push(`Name: ${name}`);
        if (description) lines.push(`Description: ${description}`);
        if (personality) lines.push(`Personality: ${personality}`);
        if (scenario) lines.push(`Scenario: ${scenario}`);
        if (firstMes) lines.push(`First Message: ${firstMes}`);
        if (mesExample) lines.push(`Example Dialogue: ${mesExample}`);
        if (tags.length) lines.push(`Tags: ${tags.slice(0, 20).join(", ")}`);

        return lines.join("\n").slice(0, maxLen);
    } catch (_) {
        return "";
    }
}

function getThreadTail(name, max = 10) {
    try {
        const s = getSettings();
        const list = (s.phone?.smsThreads && Array.isArray(s.phone.smsThreads[name])) ? s.phone.smsThreads[name] : [];
        return list.slice(-max).map(m => `${m.isUser ? getPersonaName() : name}: ${String(m.text || "").slice(0, 220)}`).join("\n");
    } catch (_) {
        return "";
    }
}

function shouldLogPhoneToChat() {
    return true;
}

function sanitizePhoneLine(text, maxLen = 600) {
    let t = String(text || "");
    t = t.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "");
    t = t.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "");
    t = t.replace(/\*[^*]{0,400}\*/g, " ");
    t = t.replace(/\[[^\]]{0,400}\]/g, " ");
    t = t.replace(/\([^)]{0,400}\)/g, " ");
    t = t.replace(/\b(narration|scene|action|stage directions)\s*:\s*/gi, "");
    t = t.replace(/\s*\n+\s*/g, " ");
    t = t.replace(/\s{2,}/g, " ").trim();
    if (!t) return "";
    return t.slice(0, maxLen);
}

function cleanIncomingWho(raw) {
    let who = String(raw || "").trim();
    if (!who) return "";
    who = who
        .replace(/^[<[\("'\s]+/, "")
        .replace(/[>\])"'\s]+$/, "")
        .replace(/^(?:from|caller|npc)\s*[:\-]?\s*/i, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    return who.slice(0, 80);
}

/** Shared parser for [UIE_CALL] / [UIE_TEXT] and plain-language phone cues (also used by VN game shell). */
function parsePhoneEventsFromText(txt) {
    const src = String(txt || "");
    if (!src) return [];
    const out = [];
    const seenLocal = new Set();

    const pushEvent = (kind, whoRaw, bodyRaw = "") => {
        const type = String(kind || "").toLowerCase();
        const who = cleanIncomingWho(whoRaw);
        if (!who) return;
        const body = type === "text" ? sanitizePhoneLine(bodyRaw, 1200) : "";
        if (type === "text" && !body) return;
        const key = `${type}|${who.toLowerCase()}|${String(body || "").toLowerCase().slice(0, 180)}`;
        if (seenLocal.has(key)) return;
        seenLocal.add(key);
        out.push({ type, who, body });
    };

    const tagRe = /\[\s*UIE_(CALL|TEXT)\s*:\s*([^|\]]+?)(?:\s*\|\s*([^\]]+?))?\s*\]/gi;
    let m = null;
    while ((m = tagRe.exec(src)) !== null) {
        const t = String(m[1] || "").toLowerCase();
        if (t === "call") pushEvent("call", m[2], "");
        if (t === "text") pushEvent("text", m[2], m[3] || "");
    }

    const callPlainRe = /\b(?:incoming\s+call|call\s+incoming|call\s+from|phone\s+rings?\s*(?:from)?)\s*[:\-]?\s*([A-Za-z0-9 _'".-]{2,60})/gi;
    while ((m = callPlainRe.exec(src)) !== null) {
        pushEvent("call", m[1], "");
    }

    const textPlainRe = /\b(?:new\s+(?:text|message)|(?:text|sms|message)\s+(?:incoming|received)|(?:text|message|sms)\s+from)\s*(?:from)?\s*[:\-]?\s*([A-Za-z0-9 _'".-]{2,60})\s*[:\-]\s*([^\n]{1,600})/gi;
    while ((m = textPlainRe.exec(src)) !== null) {
        pushEvent("text", m[1], m[2]);
    }

    const callBuzz = /\b(?:phone\s+buzz(?:es)?|cell\s+buzz(?:es)?|(?:got|getting)\s+a\s+(?:buzz|vibrate)|vibrat\w*\s+in\s+(?:my|your)\s+pocket)\b[^.!?]*\b(?:from|it's|its)\s+([A-Za-z][A-Za-z0-9 _'".-]{1,50})/gi;
    while ((m = callBuzz.exec(src)) !== null) {
        pushEvent("call", m[1], "");
    }

    const textPing = /\b(?:ping(?:ed)?|dm(?:ed)?|slid(?:e)?\s+into\s+(?:my|your)\s+dms)\s+from\s+([A-Za-z][A-Za-z0-9 _'".-]{1,50})\s*[:\-]\s*([^\n]{1,600})/gi;
    while ((m = textPing.exec(src)) !== null) {
        pushEvent("text", m[1], m[2]);
    }

    return out;
}

function getAffinityForContactName(name) {
    const s = getSettings();
    const want = String(name || "")
        .trim()
        .toLowerCase();
    if (!want) return 50;
    const tabs = ["friends", "associates", "romance", "family", "rivals"];
    for (const k of tabs) {
        for (const p of s.social?.[k] || []) {
            if (String(p?.name || "")
                .trim()
                .toLowerCase() === want) {
                return Math.max(0, Math.min(100, Number(p?.affinity ?? 50)));
            }
        }
    }
    return 50;
}

function computeMaxCallDurationMs(who) {
    const aff = getAffinityForContactName(who);
    const baseMs = 90 * 1000;
    const extraMs = aff * 1500;
    return Math.min(15 * 60 * 1000, Math.max(45 * 1000, baseMs + extraMs));
}

/**
 * Full-line user commands: `call Ren`, `/phone Mom`, `text Mika: meet me at the station`.
 * Returns { handled, toast } when the line was consumed (no RP send).
 */
export function tryHandleUserPhoneIntentLine(rawText) {
    const raw = String(rawText || "").trim();
    if (!raw) return { handled: false, toast: "" };

    const chargeIntent = /\b(?:put|place|plug|connect|set)\b[\s\S]{0,40}\b(?:phone|cell|mobile)\b[\s\S]{0,40}\b(?:charger|charging pad|cable|dock|power)\b/i.test(raw)
        || /^\/?(?:charge|plug in)\s+(?:my\s+|the\s+)?phone\b/i.test(raw);
    if (chargeIntent) {
        const charger =
            /\b(?:car|vehicle)\b/i.test(raw) ? "vehicle" :
            /\bsolar\b/i.test(raw) ? "solar" :
            /\bwireless|pad|dock\b/i.test(raw) ? "wireless" :
            /\busb|cable\b/i.test(raw) ? "usb" :
            "wall";
        setPhoneCharging(true, charger);
        const explicitCommand = /^\/?(?:charge|plug in)\s+(?:my\s+|the\s+)?phone\b/i.test(raw);
        return { handled: explicitCommand, toast: `Phone charging from the ${charger} charger.` };
    }
    if (/\b(?:unplug|disconnect|take|remove)\b[\s\S]{0,35}\b(?:phone|charger|charging pad|cable|dock)\b/i.test(raw)) {
        setPhoneCharging(false);
        return { handled: /^\/?(?:unplug|disconnect)\b/i.test(raw), toast: "Phone disconnected from the charger." };
    }

    const callM = raw.match(
        /^\/?(?:call|phone|dial|ring)\s+([A-Za-z\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F _.'-]{0,78})\s*\.?!?$/i,
    );
    if (callM) {
        const who = callM[1].trim().replace(/\s{2,}/g, " ");
        const s = getSettings();
        const availability = phoneAvailability(s);
        if (availability.dead) return { handled: true, toast: "The phone battery is dead. Connect a charger first." };
        if (availability.offline) return { handled: true, toast: availability.p.serviceSuspended ? "Phone service is suspended until the overdue plan bill is paid." : "The phone has no network signal." };
        if (isCodiceMode(s)) {
            return { handled: true, toast: "The Codice carries letters, not calls." };
        }
        if (who && typeof window.UIE_phone_startOutboundCall === "function") {
            void window.UIE_phone_startOutboundCall(who);
            return { handled: true, toast: `Calling ${who}…` };
        }
    }

    const txtM = raw.match(
        /^\/?(?:text|sms|message)\s+([A-Za-z\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F _.'-]{0,48})\s*[:|\-—]\s*(.+)$/is,
    );
    if (txtM) {
        const who = txtM[1].trim().replace(/\s{2,}/g, " ");
        const body = String(txtM[2] || "").trim();
        if (who && body) {
            const s = getSettings();
            const availability = phoneAvailability(s);
            if (!isCodiceMode(s) && availability.dead) return { handled: true, toast: "The phone battery is dead. Connect a charger first." };
            if (!isCodiceMode(s) && availability.offline) return { handled: true, toast: availability.p.serviceSuspended ? "Phone service is suspended until the overdue plan bill is paid." : "The phone has no network signal." };
            if (isCodiceMode(s)) {
                const socialHit = getPhoneSocialContacts(s).find((c) => String(c?.name || "").trim().toLowerCase() === who.toLowerCase());
                const targetLocation = socialHit?.person?.homeLocation || socialHit?.person?.home || socialHit?.person?.location || socialHit?.person?.locId || null;
                void sendCourierMessage(who, body, targetLocation)
                    .then(() => {
                        try { notify("success", `Letter sent to ${who}.`, "Codice", "phoneMessages"); } catch (_) {}
                    })
                    .catch(() => {
                        try { notify("warning", "The courier could not take that letter.", "Codice", "phoneMessages"); } catch (_) {}
                    });
                pushPhoneMemory(s, { kind: "outbound_letter", text: `Letter to ${who}: ${body.slice(0, 500)}` });
                saveSettings();
                return { handled: true, toast: `Letter sent to ${who}` };
            }
            s.phone = s.phone || {};
            if (!Array.isArray(s.phone.events)) s.phone.events = [];
            s.phone.events.unshift({
                id: `phone_evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "text",
                from: who,
                message: body,
                outbound: true,
                at: Date.now(),
            });
            s.phone.events = s.phone.events.slice(0, 60);
            pushPhoneMemory(s, { kind: "outbound_text", text: `Text → ${who}: ${body.slice(0, 500)}` });
            saveSettings();
            try {
                notify("info", `Text to ${who}: ${body.slice(0, 120)}${body.length > 120 ? "…" : ""}`, "Phone", "phoneMessages");
            } catch (_) {}
            return { handled: true, toast: `Text sent to ${who}` };
        }
    }

    return { handled: false, toast: "" };
}

/**
 * Run immediately when the assistant finishes a line (before visible strip), so phone events are not missed.
 * @param {string} txt
 * @param {string} [messageKey] dedupe key, e.g. mes id
 */
export function ingestPhoneEventsFromAssistantText(txt, messageKey = "") {
    const s = getSettings();
    if (isCodiceMode(s)) return;
    if (s?.phone && s.phone.allowCalls === false && s.phone.allowTexts === false) return;
    const events = parsePhoneEventsFromText(txt);
    if (!events.length) return;
    const base = String(messageKey || `ing_${Date.now()}`);
    for (const ev of events) {
        const fp = `${base}|${ev.type}|${String(ev.who || "").toLowerCase()}|${String(ev.body || "").toLowerCase().slice(0, 180)}`;
        if (seenPhoneEvent(fp)) continue;
        if (ev.type === "call") {
            if (s?.phone?.allowCalls === false) continue;
            if (typeof window.UIE_phone_incomingCall === "function") window.UIE_phone_incomingCall(ev.who);
            else notify("info", `Incoming call from ${ev.who}`, "Phone", "phoneCalls");
        } else if (ev.type === "text") {
            if (s?.phone?.allowTexts === false) continue;
            if (typeof window.UIE_phone_incomingText === "function") window.UIE_phone_incomingText(ev.who, ev.body);
            else notify("info", `New message from ${ev.who}`, "Phone", "phoneMessages");
        }
    }
}

function cleanOutput(text, type) {
    if(!text) return "";
    let clean = text.trim();
    clean = clean.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "");
    if (type === "web") {
        if (clean.startsWith("# ")) clean = "<h1>" + clean.substring(2) + "</h1>";
        const match = clean.match(/<(div|style|body|html|header|nav|main|h1|h2|p)/i);
        if (match && match.index > -1) clean = clean.substring(match.index);
        else clean = `<div style="padding:20px; text-align:center; font-family:sans-serif;">${clean}</div>`;
    } else if (type === "json") {
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start > -1 && end > -1) clean = clean.substring(start, end + 1);
        else clean = "{}";
    }
    return clean;
}

function syncToMainChat(actionDescription) {
    const msg = String(actionDescription || "").trim();
    if (!msg) return;
    try {
        if (typeof window.showToast === "function") {
            window.showToast(msg, 2400);
            return;
        }
    } catch (_) {}
    try {
        injectRpEvent(`[Phone] ${msg}`, { uie: { type: "phone" } });
    } catch (_) {}
}

export function initPhone() {
    const $win = $("#uie-phone-window");
    if (!$win.length) {
        const g = (window.__uiePhoneTemplateGate = window.__uiePhoneTemplateGate || { loading: false, tries: 0, gaveUp: false });
        if (g.gaveUp) return;

        if (g.loading) return;

        g.tries = Number(g.tries || 0) + 1;

        // Attempt to lazy-mount template in standalone / when templates weren't preloaded.
        if (typeof fetch === "function") {
            g.loading = true;
            const base = (() => {
                try { return String(window.UIE_BASEURL || "").trim() || "./"; } catch (_) { return "./"; }
            })();
            const url = `${base.replace(/\/+$/, "")}/src/templates/phone.html`;
            fetch(url)
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.text();
                })
                .then((html) => {
                    try {
                        if (!document.getElementById("uie-phone-window")) {
                            $("body").append(html);
                        }
                    } catch (_) {}
                })
                .catch((e) => {
                    try { console.warn("[UIE] Phone template load failed:", e); } catch (_) {}
                })
                .finally(() => {
                    g.loading = false;
                    setTimeout(initPhone, 50);
                });
            return;
        }

        // Limited retries to avoid flooding console / killing interactivity.
        if (g.tries <= 12) {
            try {
                console.warn("[UIE] Phone template not in DOM yet; retrying in 500ms...");
                setTimeout(initPhone, 500);
            } catch (_) {}
        } else {
            g.gaveUp = true;
            try { console.warn("[UIE] Phone template missing; giving up initPhone."); } catch (_) {}
        }
        return;
    }
    $win.off("click.phone change.phone input.phone keypress.phone");
    $(document).off("click.phone change.phone input.phone keypress.phone");
    credentialForgeUI = initCredentialForgeUI({
        root: $win[0],
        getSettings,
        saveSettings,
        notify,
        onRpEvent: syncToMainChat,
        confirmAction: (message) => Promise.resolve(window.confirm(message)),
    });

    // Fallback launcher only: game.html is authoritative when it provides the managed opener.
    $(document).off("click.phoneLauncher", "#btn-phn");
    if (typeof window.UIE_forceOpenWindow !== "function") {
        $(document).on("click.phoneLauncher", "#btn-phn", () => {
            const $p = $("#uie-phone-window");
            const wasVisible = $p.is(":visible");
            openPhoneHome();
            try {
                if (typeof updateClock === "function") updateClock();
                if (phoneClockInt) clearInterval(phoneClockInt);
                phoneClockInt = setInterval(updateClock, 15000);
            } catch (_) {}
            if (!wasVisible) try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
            setTimeout(() => { try { renderPhoneReceiveIndicators(); } catch (_) {} }, 220);
        });
    }

    const parseChatTimestamp = () => {
        try {
            const chat = document.querySelector("#chat");
            if (!chat) return null;

            const last =
                chat.querySelector(".mes:last-child") ||
                chat.querySelector(".mes")?.parentElement?.lastElementChild ||
                chat.lastElementChild;
            if (!last) return null;

            const timeEl =
                last.querySelector("time") ||
                last.querySelector(".timestamp") ||
                last.querySelector(".mes_time") ||
                last.querySelector(".mes__time") ||
                last.querySelector("[data-timestamp]") ||
                last.querySelector("[datetime]");

            const raw =
                (timeEl && (timeEl.getAttribute("datetime") || timeEl.getAttribute("data-timestamp") || timeEl.textContent)) ||
                last.getAttribute("data-timestamp") ||
                last.getAttribute("datetime") ||
                "";

            const txt = String(raw || "").trim();
            if (!txt) return null;

            const ms = Date.parse(txt);
            if (!Number.isNaN(ms)) return new Date(ms);

            const m = txt.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
            if (m) {
                let hh = Number(m[1]);
                const mm = Number(m[2]);
                const ap = (m[3] || "").toUpperCase();
                if (ap === "PM" && hh < 12) hh += 12;
                if (ap === "AM" && hh === 12) hh = 0;
                const now = new Date();
                now.setHours(hh, mm, 0, 0);
                return now;
            }
        } catch (_) {}
        return null;
    };

    const updateClock = () => {
        const fromChat = parseChatTimestamp();
        if (fromChat) chatClock = { base: fromChat.getTime(), at: Date.now() };

        const now = chatClock ? new Date(chatClock.base + (Date.now() - chatClock.at)) : new Date();
        const time12 = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
        const parts = String(time12 || "").trim().split(/\s+/);
        const tMain = parts[0] || now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const tAmPm = (parts[1] || "").toUpperCase();
        const date = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
        $(".uie-phone-clock").text(tMain);
        const $timeLg = $(".uie-phone-clock-time-lg");
        const $ampmLg = $(".uie-phone-clock-ampm-lg");
        if ($timeLg.length && $ampmLg.length) {
            $timeLg.text(tMain);
            $ampmLg.text(tAmPm || "AM");
        } else {
            $(".uie-phone-clock-lg").text(tAmPm ? `${tMain} ${tAmPm}` : tMain);
        }
        $(".uie-phone-date").text(date);
    };
    try {
        if ($win.is(":visible")) {
            updateClock();
            if (phoneClockInt) clearInterval(phoneClockInt);
            phoneClockInt = setInterval(updateClock, 15000);
        }
    } catch (_) {}

    const getChatSnippet = (n = 20) => {
        try {
            let raw = "";
            const $txt = $(".chat-msg-txt");
            if ($txt.length) {
                $txt.slice(-Math.max(1, Number(n) || 20)).each(function () { raw += $(this).text() + "\n"; });
                return raw.trim().slice(0, 5200);
            }
            const chatEl = document.querySelector("#chat");
            if (!chatEl) return "";
            const msgs = Array.from(chatEl.querySelectorAll(".mes"))
                .filter((m) => !isInactiveChatMesNode(m))
                .slice(-Math.max(1, Number(n) || 20));
            for (const m of msgs) {
                const isUser =
                    m.classList?.contains("is_user") ||
                    m.getAttribute("is_user") === "true" ||
                    m.getAttribute("data-is-user") === "true" ||
                    m.dataset?.isUser === "true";
                const t =
                    m.querySelector(".mes_text")?.textContent ||
                    m.querySelector(".mes-text")?.textContent ||
                    m.textContent ||
                    "";
                raw += `${isUser ? "You" : "Story"}: ${String(t).trim()}\n`;
            }
            return raw.trim().slice(0, 5200);
        } catch (_) {
            return "";
        }
    };

    const ensureUnreadState = (s) => {
        if (!s.phone) s.phone = {};
        const tx = Number(s.phone.unreadTextCount);
        const cl = Number(s.phone.unreadCallCount);
        s.phone.unreadTextCount = Number.isFinite(tx) ? Math.max(0, Math.floor(tx)) : 0;
        s.phone.unreadCallCount = Number.isFinite(cl) ? Math.max(0, Math.floor(cl)) : 0;
        s.phone.unreadCount = s.phone.unreadTextCount + s.phone.unreadCallCount;
        if (!s.phone.lastInbound || typeof s.phone.lastInbound !== "object") {
            s.phone.lastInbound = { type: "", from: "", at: 0, preview: "" };
        }
    };

    const ensureInboundIndicatorDom = () => {
        if (!$("#uie-phone-inbound-indicator").length) {
            $("body").append(`
                <button id="uie-phone-inbound-indicator" style="display:none; position:fixed; right:14px; bottom:86px; z-index:2147483646; border:1px solid rgba(203, 163, 92,0.45); background:rgba(16,18,26,0.96); color:#fff; border-radius:12px; padding:8px 10px; min-width:180px; text-align:left; box-shadow:0 8px 24px rgba(0,0,0,0.38); cursor:pointer;">
                    <div style="font-size:11px; opacity:0.8; margin-bottom:2px;">Phone Alert</div>
                    <div id="uie-phone-inbound-indicator-main" style="font-weight:900; font-size:12px; line-height:1.3;">Incoming activity</div>
                </button>
            `);
        }
        if (!$("#uie-phone-inbound-banner").length) {
            $("body").append(`
                <div id="uie-phone-inbound-banner" style="display:none; position:fixed; top:14px; right:14px; z-index:2147483647; border:1px solid rgba(203, 163, 92,0.45); background:rgba(12,14,20,0.96); color:#fff; border-radius:12px; padding:10px 12px; max-width:min(360px,92vw); box-shadow:0 10px 28px rgba(0,0,0,0.45);">
                    <div id="uie-phone-inbound-banner-title" style="font-size:11px; opacity:0.8;">Incoming</div>
                    <div id="uie-phone-inbound-banner-main" style="font-weight:900; line-height:1.35;">New phone event</div>
                </div>
            `);
        }
    };

    const setIconBadge = (selector, count, color = "#e74c3c") => {
        $(selector).each(function () {
            const $el = $(this);
            if (!$el.length) return;
            if (($el.css("position") || "static") === "static") $el.css("position", "relative");
            let $b = $el.children(".uie-phone-notif-badge");
            if (!$b.length) {
                $b = $("<span class=\"uie-phone-notif-badge\" style=\"position:absolute; top:-6px; right:-6px; min-width:16px; height:16px; border-radius:999px; padding:0 4px; display:grid; place-items:center; font-size:10px; font-weight:900; color:#fff; border:1px solid rgba(255,255,255,0.35);\"></span>");
                $el.append($b);
            }
            if (count > 0) {
                $b.text(count > 99 ? "99+" : String(count));
                $b.css({ display: "grid", background: color });
            } else {
                $b.hide();
            }
        });
    };

    const renderPhoneReceiveIndicators = () => {
        const s = getSettings();
        ensureUnreadState(s);
        const textCount = Math.max(0, Number(s?.phone?.unreadTextCount || 0));
        // Calls do not exist in the Codice. Clear stale modern-phone state so
        // it cannot leak into parchment badges or delivery notices.
        if (isCodiceMode(s)) s.phone.unreadCallCount = 0;
        const callCount = Math.max(0, Number(s?.phone?.unreadCallCount || 0));
        s.phone.unreadCount = textCount + callCount;
        saveSettings();

        setIconBadge("#app-msg, #dock-btn-msg", textCount, "#2ecc71");
        setIconBadge("#dock-btn-phone", callCount, "#e74c3c");

        ensureInboundIndicatorDom();
        const total = textCount + callCount;
        const visible = $("#uie-phone-window").is(":visible");
        const from = String(s?.phone?.lastInbound?.from || "").trim();
        const summary = `${callCount > 0 ? `${callCount} call${callCount === 1 ? "" : "s"}` : ""}${callCount > 0 && textCount > 0 ? " • " : ""}${textCount > 0 ? `${textCount} text${textCount === 1 ? "" : "s"}` : ""}` || "Incoming activity";
        $("#uie-phone-inbound-indicator-main").text(from ? `${summary} from ${from}` : summary);
        if (isCodiceMode(s) && textCount > 0) {
            const letterSummary = `${callCount > 0 ? `${callCount} call${callCount === 1 ? "" : "s"} - ` : ""}${textCount} letter${textCount === 1 ? "" : "s"}`;
            $("#uie-phone-inbound-indicator-main").text(from ? `${letterSummary} from ${from}` : letterSummary);
        }
        if (total > 0 && !visible) $("#uie-phone-inbound-indicator").css("display", "block");
        else $("#uie-phone-inbound-indicator").hide();
    };

    const bumpUnread = (kind, who = "", preview = "") => {
        const s = getSettings();
        ensureUnreadState(s);
        if (kind === "call") s.phone.unreadCallCount = Math.max(0, Number(s.phone.unreadCallCount || 0)) + 1;
        if (kind === "text") s.phone.unreadTextCount = Math.max(0, Number(s.phone.unreadTextCount || 0)) + 1;
        s.phone.unreadCount = s.phone.unreadTextCount + s.phone.unreadCallCount;
        s.phone.lastInbound = { type: String(kind || ""), from: String(who || "").slice(0, 80), at: Date.now(), preview: String(preview || "").slice(0, 180) };
        saveSettings();
        renderPhoneReceiveIndicators();
    };

    const clearUnread = ({ calls = false, texts = false, all = false } = {}) => {
        const s = getSettings();
        ensureUnreadState(s);
        if (all || calls) s.phone.unreadCallCount = 0;
        if (all || texts) s.phone.unreadTextCount = 0;
        s.phone.unreadCount = s.phone.unreadTextCount + s.phone.unreadCallCount;
        saveSettings();
        renderPhoneReceiveIndicators();
    };

    const showInboundBanner = (kind, who, body = "") => {
        ensureInboundIndicatorDom();
        const k = String(kind || "").toLowerCase();
        const w = String(who || "Unknown").trim() || "Unknown";
        const codiceMode = isCodiceMode(getSettings());
        const t = k === "call" ? "Incoming Call" : codiceMode ? "Letter Delivered" : "New Text Message";
        const msg = k === "call" ? `${w} is calling you.` : codiceMode ? `A sealed letter from ${w} arrived.` : `${w}: ${String(body || "").slice(0, 140)}`;
        $("#uie-phone-inbound-banner-title").text(t);
        $("#uie-phone-inbound-banner-main").text(msg);
        const $b = $("#uie-phone-inbound-banner");
        $b.stop(true, true).fadeIn(120);
        setTimeout(() => { try { $b.fadeOut(180); } catch (_) {} }, 3800);
    };

    const scheduleArrival = (who, turns = 1, reason = "") => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
        const eta = Math.max(1, Math.min(2, Number(turns) || 1));
        s.phone.arrivals.push({ id: Date.now(), who: String(who || "Someone"), etaTurns: eta, reason: String(reason || "").slice(0, 200) });
        saveSettings();
    };

    const tickArrivalsOnAssistantTurn = async () => {
        const s = getSettings();
        if (!s?.phone?.arrivals || !Array.isArray(s.phone.arrivals) || !s.phone.arrivals.length) return;
        let changed = false;
        for (const a of s.phone.arrivals) {
            if (typeof a.etaTurns !== "number") a.etaTurns = 1;
            a.etaTurns -= 1;
            changed = true;
        }
        const due = s.phone.arrivals.filter(a => a.etaTurns <= 0);
        s.phone.arrivals = s.phone.arrivals.filter(a => a.etaTurns > 0);
        if (changed) saveSettings();
        for (const a of due) {
            const who = String(a.who || "Someone");
            const why = String(a.reason || "").trim();
            const msg = why ? `${who} arrives. (${why})` : `${who} arrives.`;
            await injectRpEvent(msg, { uie: { type: "arrival", who, why } });
        }
    };

    const getAmbientCommunicationChance = (txt, s, codiceMode) => {
        const explicit = Number(s?.phone?.ambientCommunicationChance);
        if (Number.isFinite(explicit)) return Math.max(0, Math.min(1, explicit));
        const hay = String(txt || "").toLowerCase();
        let chance = codiceMode ? 0.14 : 0.16;
        if (/\b(phone|call|called|calling|rang|ringing|buzz|text|message|sms|dm|email|mail|letter|courier|post|parcel|notice)\b/.test(hay)) chance += 0.2;
        if (/\b(urgent|emergency|invite|invitation|meet|meeting|date|delivery|appointment|job|school|guild|quest|contract|family|friend|rival|deadline)\b/.test(hay)) chance += 0.12;
        if (/\b(waiting|expecting|promised|forgot|missed|news|rumor|warning|reminder)\b/.test(hay)) chance += 0.08;
        return Math.max(0.03, Math.min(0.55, chance));
    };

    const getCommunicationContactsBrief = (s) => {
        const contacts = getPhoneSocialContacts(s)
            .map((c) => ({
                name: String(c?.name || "").trim(),
                group: String(c?.group || "").trim(),
                affinity: Number(c?.person?.affinity ?? 50),
                location: String(c?.person?.location || c?.person?.homeLocation || c?.person?.locId || "").trim(),
                notes: String(c?.person?.thoughts || c?.person?.background || c?.person?.notes || "").trim().slice(0, 180),
            }))
            .filter((c) => c.name);
        return contacts.slice(0, 20);
    };

    const normalizeAmbientCommunicationType = (rawType, codiceMode) => {
        const t = String(rawType || "").trim().toLowerCase();
        if (codiceMode) {
            if (/(mail|post|notice|parcel)/.test(t)) return "mail";
            return "letter";
        }
        if (/(call|phone|ring)/.test(t)) return "call";
        if (/(mail|email|post|notice|parcel)/.test(t)) return "mail";
        return "text";
    };

    const deliverAmbientMail = async (who, body, codiceMode, reason = "") => {
        const s = getSettings();
        s.phone = s.phone || {};
        if (!Array.isArray(s.phone.events)) s.phone.events = [];
        const source = codiceMode ? "Mail" : "Mail";
        const msg = sanitizePhoneLine(body, 1200);
        if (!msg) return false;
        s.phone.events.unshift({
            id: `mail_evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: codiceMode ? "mail" : "email",
            from: who,
            message: msg,
            reason: String(reason || "").slice(0, 220),
            at: Date.now(),
        });
        s.phone.events = s.phone.events.slice(0, 80);
        pushPhoneMemory(s, { kind: codiceMode ? "inbound_mail" : "inbound_email", text: `${source} from ${who}: ${msg.slice(0, 500)}` });
        saveSettings();
        notify("info", `${source} from ${who}: ${msg.slice(0, 140)}${msg.length > 140 ? "..." : ""}`, source, "phoneMessages");
        try { await injectRpEvent(`(${source}) ${who} -> ${getPersonaName()}: "${msg.slice(0, 500)}"`, { uie: { type: codiceMode ? "mail" : "email", who } }); } catch (_) {}
        try { relayRelationship(who, msg, codiceMode ? "mail" : "email"); } catch (_) {}
        return true;
    };

    const deliverAmbientCommunication = async (event, id, codiceMode) => {
        const type = normalizeAmbientCommunicationType(event?.type, codiceMode);
        const who = cleanIncomingWho(event?.from || event?.who || event?.sender || "Unknown") || "Unknown";
        const body = sanitizePhoneLine(event?.body || event?.message || event?.text || "", 1200);
        const fp = `${id}|ambient|${type}|${who.toLowerCase()}|${body.toLowerCase().slice(0, 180)}`;
        if (seenPhoneEvent(fp)) return false;

        if (codiceMode) {
            if (type === "mail") return deliverAmbientMail(who, body, true, event?.reason);
            const msg = body || "A sealed letter arrives for you.";
            receiveCourierMessage(who, msg, event?.sourceLocation || null, "rpg");
            try { pushPhoneMemory(getSettings(), { kind: "inbound_letter", text: `Letter from ${who}: ${msg.slice(0, 500)}` }); saveSettings(); } catch (_) {}
            try { await injectRpEvent(`(Letter) ${who} -> ${getPersonaName()}: "${msg.slice(0, 500)}"`, { uie: { type: "codice_letter", who } }); } catch (_) {}
            try { relayRelationship(who, msg, "letter"); } catch (_) {}
            return true;
        }

        if (type === "mail") return deliverAmbientMail(who, body, false, event?.reason);
        if (type === "call") {
            if (getSettings()?.phone?.allowCalls === false) return false;
            notify("info", `Incoming call from ${who}`, "Phone", "phoneCalls");
            window.UIE_phone_incomingCall?.(who);
            return true;
        }
        if (getSettings()?.phone?.allowTexts === false) return false;
        if (!body) return false;
        notify("info", `New message from ${who}`, "Phone", "phoneMessages");
        window.UIE_phone_incomingText?.(who, body);
        return true;
    };

    const maybeGenerateAmbientCommunication = async (id, txt, codiceMode) => {
        const s = getSettings();
        s.phone = s.phone || {};
        if (s.phone.contextualCommunications === false || s.phone.ambientCommunications === false) return false;
        const currentId = String(id || "").slice(0, 120);
        if (currentId && s.phone.lastAmbientCommunicationMessageId === currentId) return false;

        const now = Date.now();
        const minGapMs = Math.max(30000, Number(s.phone.ambientCommunicationCooldownMs || 150000));
        if (now - Number(s.phone.lastAmbientCommunicationAt || 0) < minGapMs) return false;

        const chance = getAmbientCommunicationChance(txt, s, codiceMode);
        if (Math.random() > chance) return false;

        const recent = `${getMainChatContext(8)}\n\nLatest turn:\n${String(txt || "").slice(0, 1800)}`.slice(0, 3600);
        const contacts = getCommunicationContactsBrief(s);
        const modeLabel = codiceMode ? "fantasy/RPG mode: letters, mail, couriers, notices" : "modern/life sim mode: calls, texts, email/mail";
        const prompt = `Decide whether a context-based or random communication event should happen now in a roleplay scene.

Rules:
- Return ONLY compact JSON.
- Use the story context first. Random ambient events are allowed, but must feel plausible.
- It is okay to choose no event.
- Prefer known contacts when they fit. Unknown senders are allowed for mail, notices, wrong numbers, quests, deliveries, institutions, rivals, or plot hooks.
- ${modeLabel}.
- Modern calls should have no body. Modern texts/mail need a short realistic body.
- Fantasy letters/mail need a short readable body.
- Do not reveal hidden knowledge the sender could not know.

JSON shape:
{"willTrigger":false,"type":"text","from":"","body":"","reason":""}

Known contacts:
${JSON.stringify(contacts).slice(0, 2200)}

Recent context:
${recent}`.slice(0, 6200);

        try {
            const res = await generateContent(prompt, "communications");
            const logic = JSON.parse(cleanOutput(res, "json"));
            if (!logic?.willTrigger) {
                s.phone.lastAmbientCommunicationMessageId = currentId;
                saveSettings();
                return false;
            }
            const delivered = await deliverAmbientCommunication(logic, currentId || `ambient_${now}`, codiceMode);
            if (delivered) {
                const s2 = getSettings();
                s2.phone = s2.phone || {};
                s2.phone.lastAmbientCommunicationAt = now;
                s2.phone.lastAmbientCommunicationMessageId = currentId;
                saveSettings();
            }
            return delivered;
        } catch (e) {
            try { console.warn("[UIE] Ambient communication generation failed:", e); } catch (_) {}
            return false;
        }
    };

    // --- STRICT PHONE TRIGGER WATCHER ---
    const scanForPhoneEvents = async () => {
        const s = getSettings();
        const codiceMode = isCodiceMode(s);

        const chatEl = document.querySelector("#chat");
        if (!chatEl) return;
        const all = Array.from(chatEl.querySelectorAll(".mes")).filter((m) => !isInactiveChatMesNode(m));
        const last = all[all.length - 1] || null;
        if (!last) return;

        // Only scan AI messages
        const isUser =
            last.classList?.contains("is_user") ||
            last.getAttribute("is_user") === "true" ||
            last.getAttribute("data-is-user") === "true";
        if (isUser) return;

        const id = last.getAttribute("mesid") || last.getAttribute("data-id") || last.textContent.substring(0, 20);
        if (id === arrivalLastMesId) return; // Re-using this var to track last processed message
        arrivalLastMesId = id;

        const lastText =
            last.querySelector(".mes_text")?.textContent ||
            last.querySelector(".mes-text")?.textContent ||
            last.textContent ||
            "";
        const txt = String(lastText || "").trim();
        if (!txt) return;

        const events = codiceMode ? [] : parsePhoneEventsFromText(txt);
        if (!events.length) {
            await maybeGenerateAmbientCommunication(id, txt, codiceMode);
            return;
        }

        for (const ev of events) {
            const fp = `${id}|${ev.type}|${String(ev.who || "").toLowerCase()}|${String(ev.body || "").toLowerCase().slice(0, 180)}`;
            if (seenPhoneEvent(fp)) continue;
            if (ev.type === "call") {
                if (s?.phone?.allowCalls === false) continue;
                notify("info", `Incoming call from ${ev.who}`, "Phone", "phoneCalls");
                window.UIE_phone_incomingCall(ev.who);
                continue;
            }
            if (ev.type === "text") {
                if (s?.phone?.allowTexts === false) continue;
                notify("info", `New message from ${ev.who}`, "Phone", "phoneMessages");
                window.UIE_phone_incomingText(ev.who, ev.body);
            }
        }
    };

    const startArrivalWatcher = () => {
        if (window.UIE_phone_arrivalObserver) return;
        if (arrivalObserver) return;
        const chatEl = document.querySelector("#chat");
        if (!chatEl) return;

        arrivalObserver = new MutationObserver(async () => {
            const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
            if (!last) return;

            // Run Arrival Logic
            const isUser =
                last.classList?.contains("is_user") ||
                last.getAttribute("is_user") === "true" ||
                last.getAttribute("data-is-user") === "true";
            if (!isUser) {
                await tickArrivalsOnAssistantTurn();
                // Run Phone Event Scan
                setTimeout(scanForPhoneEvents, 1500); // Small delay to let text settle
            }
        });
        arrivalObserver.observe(chatEl, { childList: true, subtree: false });
        window.UIE_phone_arrivalObserver = arrivalObserver;
    };

    const loadPhoneVisuals = () => {
        const s = getSettings();
        if(!s.phone) s.phone = { pin: "", deviceSkin: "modern", customApps: [], bookmarks: [], browser: { pages: {}, history: [], index: -1 }, smsThreads: {}, arrivals: [], blockedContacts: [], numberBook: [] };
        if(!s.social || typeof s.social !== "object") s.social = { friends: [], associates: [], romance: [], family: [], rivals: [], stats: {} };
        for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
            if (!Array.isArray(s.social[k])) s.social[k] = [];
        }
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        if(!s.phone.browser.pages) s.phone.browser.pages = {};
        if(!Array.isArray(s.phone.browser.history)) s.phone.browser.history = [];
        if(typeof s.phone.browser.index !== "number") s.phone.browser.index = -1;
        if(!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        if(!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        try {
            const wp = s.phone.windowPos || null;
            const x = Number(wp?.x);
            const y = Number(wp?.y);
            if (!isPhoneMobileViewport() && Number.isFinite(x) && Number.isFinite(y)) {
                const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                const el = document.getElementById("uie-phone-window");
                const w = el?.getBoundingClientRect?.().width || Math.min(380, vw * 0.95);
                const h = el?.getBoundingClientRect?.().height || Math.min(vh * 0.9, 900);
                const clampedX = Math.max(0, Math.min(x, Math.max(0, vw - w)));
                const clampedY = Math.max(0, Math.min(y, Math.max(0, vh - h)));
                $("#uie-phone-window").css({ left: clampedX, top: clampedY, transform: "none" });
            }
        } catch (_) {}

        const storedSkinRaw = String(s.phone.deviceSkin || "modern");
        const storedSkin = storedSkinRaw === "classic" || storedSkinRaw === "notch" || storedSkinRaw === "onyx" ? "modern" : storedSkinRaw;
        s.phone.deviceSkin = ["modern", "y2k", "future", "scroll"].includes(storedSkin) ? storedSkin : "modern";
        const activeSkin = deviceSkinForCurrentMode(s);
        const codice = isCodiceMode(s);
        $("#uie-phone-window")
            .attr("data-device", activeSkin)
            .attr("data-codice", codice ? "true" : "false")
            .removeClass("is-rolling")
            .css("background-image", "");
        const wallpaper = String(s.phone.wallpaper || "").trim();
        const wallpaperCss = wallpaper ? `url(${JSON.stringify(wallpaper)})` : "";
        $("#uie-phone-lockscreen").css({
            "background-image": wallpaperCss,
            "background-size": wallpaper ? "cover" : "",
            "background-position": wallpaper ? "center" : ""
        });
        const theme = activeSkin === "scroll"
            ? { accent:"#7a2618", glass:"rgba(115,67,27,.18)", surface:"rgba(124,73,31,.18)", surface2:"rgba(235,199,130,.45)", text:"#2b170b" }
            : activeSkin === "y2k"
            ? { accent:"#315f43", glass:"#b9d0ae", surface:"#718a76", surface2:"#c5d8bd", text:"#17231c" }
            : activeSkin === "future"
                ? { accent:"#5ef5ff", glass:"rgba(4,20,34,.86)", surface:"rgba(5,25,42,.94)", surface2:"rgba(2,13,26,.96)", text:"#d9fdff" }
                : { accent:"#007aff", glass:"rgba(0,0,0,0.28)", surface:"rgba(11,16,28,0.82)", surface2:"rgba(11,16,28,0.94)", text:"#ffffff" };
        const bubbleColors = s.phone.bubbleColors || {};
        const sentColor = String(bubbleColors.sent || theme.accent);
        const recvColor = String(bubbleColors.received || "").trim() || "#ffffff";
        $("#uie-phone-custom-css").text(`
            #uie-phone-window .phone-screen { background: transparent; }
            #uie-phone-window #uie-phone-homescreen {
                background-image: ${wallpaperCss || "none"};
                background-size: ${wallpaper ? "cover" : "auto"};
                background-position: center;
                background-color: ${theme.surface2};
            }
            #uie-phone-window #uie-phone-homescreen::before {
                content:""; position:absolute; inset:0; pointer-events:none;
                background:linear-gradient(180deg, ${theme.glass}, rgba(0,0,0,0.18));
            }
            #uie-phone-window #uie-phone-homescreen > * { position:relative; z-index:1; }
            #uie-phone-window .phone-status-bar { background: ${theme.glass}; }
            #uie-phone-window .phone-app-header { background: ${theme.surface}; border-bottom: 1px solid rgba(255,255,255,0.10); color:${theme.text}; }
            #uie-phone-window .phone-app-content { background: ${theme.surface2}; color:${theme.text}; }
            #uie-phone-window .phone-nav-bar { background: ${theme.surface}; border-top: 1px solid rgba(255,255,255,0.10); }
            #uie-phone-window .p-nav-btn { color: rgba(255,255,255,0.88); }

            #uie-phone-window #p-browser-content { background: #fff; color:#222; }
            #uie-phone-window .p-input-area{ display:flex; gap:8px; padding:10px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background:${theme.surface}; border-top:1px solid rgba(255,255,255,0.10); position:sticky; bottom:0; z-index:5; align-items:flex-end; }
            #uie-phone-window #msg-input{ background: rgba(0,0,0,0.18); border:1px solid rgba(255,255,255,0.12); color:${theme.text}; min-height:40px; border-radius:18px; padding:10px 14px; outline:none; pointer-events:auto; line-height:1.35; }
            #uie-phone-window #msg-input::placeholder{ color: rgba(255,255,255,0.6); }
            #uie-phone-window #msg-send-btn{ background:${theme.accent}; color:#000; border:none; border-radius:999px; width:44px; height:40px; display:grid; place-items:center; cursor:pointer; }
            #uie-phone-window #contact-add-manual{ position:relative; z-index:6; padding:10px; margin:-10px -6px -10px 0; }
            #uie-phone-window .p-msg-list{ padding: 10px 10px 0 10px; gap:10px; }
            #uie-phone-window .p-bubble{ max-width: 86%; padding:10px 12px; border-radius:14px; line-height:1.35; font-size:13px; border:1px solid rgba(255,255,255,0.10); }
            #uie-phone-window .p-bubble.sent{ margin-left:auto; background: ${sentColor}; border-color: rgba(255,255,255,0.10); color:${theme.text}; }
            #uie-phone-window .p-bubble.received{ margin-right:auto; background: ${recvColor}; border-color: rgba(0,0,0,0.10); color:#111; }
            #uie-phone-window #msg-block{ color: rgba(255,255,255,0.85); }
            #uie-phone-window #msg-block.blocked{ color: #f38ba8; }
            #uie-phone-window[data-codice="true"] #uie-phone-lockscreen,
            #uie-phone-window[data-codice="true"] #uie-phone-lock-btn { display:none !important; }
        `);

        if (codice) {
            s.phone.allowCalls = false;
            $(".uie-phone-clock").text("Courier");
            $(".uie-phone-date").text(activeSkin === "scroll" ? "The sealed scroll waits." : "Codice is open.");
            $("#uie-phone-lockscreen div").filter((_, el) => String(el.textContent || "").includes("Swipe")).text("Break the seal");
            $("#uie-phone-unlock-btn").text("Open Codice");
            $("#app-msg i").attr("class", "fa-solid fa-feather-pointed");
            $("#app-contacts i").attr("class", "fa-solid fa-address-book");
            $("#app-calc i").attr("class", "fa-solid fa-scale-balanced");
            $("#app-settings i").attr("class", "fa-solid fa-stamp");
            $("#uie-app-msg-view .phone-app-header #msg-contact-name").text(activeContact || "Letters");
            $("#uie-app-contacts-view .phone-app-header span").text("Address Book");
            $("#uie-app-calc-view .phone-app-header span").text("Ledger");
            // Keep the launcher and destination explicit: the parchment skin changes
            // the presentation, not what this control does.
            $("#uie-app-settings-view .phone-app-header span").text("Settings");
            $("#uie-app-settings-view .phone-app-content > div").first().text("Settings");
            $("#uie-app-settings-view .phone-app-content > div").eq(1).text("This is a parchment Codice. It sends and receives sealed letters by courier, not phone messages.");
            $("#p-device-style").val("scroll").prop("disabled", true).closest(".p-setting-row").hide();
            $("#p-wallpaper-file").closest(".p-setting-row").hide();
            $("#p-set-pin").closest(".p-setting-row").hide();
            $("#p-device-style").closest(".p-setting-row").find(".p-setting-label").text("Parchment Form");
            $("#p-allow-texts").closest(".p-setting-row").find(".p-setting-label").text("Incoming Letters");
            $("#p-allow-calls").prop("checked", false).closest(".p-setting-row").hide();
            $("#p-bubble-sent").closest(".p-setting-row").find(".p-setting-label").text("Outbound Ink");
            $("#p-bubble-recv").closest(".p-setting-row").find(".p-setting-label").text("Inbound Ink");
            $("#msg-input").attr("placeholder", "Write a letter...");
            $("#msg-send-btn").attr("title", "Send Letter").html('<i class="fa-solid fa-envelope"></i>');
            $("#msg-new-number").attr("title", "Write Letter");
        } else {
            $("#p-device-style, #p-wallpaper-file, #p-set-pin").closest(".p-setting-row").show();
            $("#p-allow-calls").closest(".p-setting-row").show();
            $("#p-device-style").prop("disabled", false);
            $("#app-msg i").attr("class", "fa-solid fa-comment");
            $("#app-contacts i").attr("class", "fa-solid fa-address-book");
            $("#app-calc i").attr("class", "fa-solid fa-calculator");
            $("#app-settings i").attr("class", "fa-solid fa-gear");
            $("#uie-app-contacts-view .phone-app-header span").text("Contacts");
            $("#uie-app-calc-view .phone-app-header span").text("Calculator");
            $("#uie-app-settings-view .phone-app-header span").text("Settings");
            $("#uie-app-settings-view .phone-app-content > div").first().text("Phone Settings");
            $("#uie-app-settings-view .phone-app-content > div").eq(1).text("Choose a device body and interface. Each style changes the phone itself, not just its colors.");
            $("#p-device-style").closest(".p-setting-row").find(".p-setting-label").text("Device Style");
            $("#p-allow-texts").closest(".p-setting-row").find(".p-setting-label").text("Incoming Texts");
            $("#p-allow-calls").closest(".p-setting-row").find(".p-setting-label").text("Incoming Calls");
            $("#p-bubble-sent").closest(".p-setting-row").find(".p-setting-label").text("Bubble Color (You)");
            $("#p-bubble-recv").closest(".p-setting-row").find(".p-setting-label").text("Bubble Color (Them)");
            $("#msg-input").attr("placeholder", "Message...");
            $("#msg-send-btn").attr("title", "Send").html('<i class="fa-solid fa-arrow-up"></i>');
            $("#msg-new-number").attr("title", "Text a number");
        }

        if (codice) {
            $("#uie-phone-pin").hide().val("");
            $("#uie-phone-lockscreen").hide();
            $("#uie-phone-unlock-btn").text("Open Codice");
        } else if(s.phone.pin && s.phone.pin.length > 0) {
            $("#uie-phone-pin").show().val("");
            $("#uie-phone-unlock-btn").text("Enter PIN");
        } else {
            $("#uie-phone-pin").hide();
            $("#uie-phone-unlock-btn").text("Swipe / Tap to Unlock");
        }

        $(".custom-app-icon").remove();
        if(!codice && s.phone.customApps) {
            s.phone.customApps.forEach(app => {
                $("#uie-phone-grid").append(`
                    <div class="phone-app-icon custom-app-icon" data-id="${app.id}" style="background:${app.color}; color:#fff;">
                        <i class="${app.icon}"></i>
                        <div class="custom-app-delete" title="Delete">x</div>
                    </div>
                `);
            });
        }
    };
    const openApp = (id) => {
        try {
            const s = getSettings();
            const codice = isCodiceMode(s);
            const codiceApps = new Set(["#uie-app-msg-view", "#uie-app-contacts-view", "#uie-app-calc-view", "#uie-app-settings-view"]);
            if (codice && !codiceApps.has(String(id || ""))) {
                goHome();
                return;
            }
            if (s?.phone) {
                s.phone.activeApp = String(id || "");
                const name =
                    id === "#uie-app-msg-view" ? (codice ? "Letters" : "Messages") :
                    id === "#uie-app-dial-view" ? "Phone" :
                    id === "#uie-app-browser-view" ? "Browser" :
                    id === "#uie-app-contacts-view" ? (codice ? "Contact List" : "Contacts") :
                    id === "#uie-app-store-view" ? "App Builder" :
                    id === "#uie-app-settings-view" ? "Settings" :
                    id === "#uie-app-calc-view" ? (codice ? "Ledger" : "Calculator") :
                    id === "#uie-app-cookies-view" ? "Cookies" :
                    id === "#uie-app-travel-view" ? "Transit" :
                    id === "#uie-app-bank-view" ? "Universal Bank" :
                    id === "#uie-app-bills-view" ? "Bills" :
                    id === "#uie-app-homestead-view" ? "Homestead" :
                    id === "#uie-app-cardforge-view" ? "Card Forge" :
                    id === "#uie-app-social-view" ? "Instavibe" :
                    id === "#uie-call-screen" ? "Call" :
                    (codice ? "Codice" : "Phone");
                s.phone.activeAppName = name;
            }
        } catch (_) {}
        $(".phone-app-window").hide();
        $("#uie-phone-homescreen").hide();
        $(id).css("display", "flex").hide().fadeIn(150);
 
        if(id === "#uie-app-contacts-view") renderContacts();
        if(id === "#uie-app-dial-view") {
            clearUnread({ calls: true });
            try { renderDialRecents(); } catch (_) {}
            try { $("#dial-display").text(dialBuf ? dialBuf : "—"); } catch (_) {}
            try {
                $("#dial-keypad-section").hide();
                $("#dial-toggle-keypad").text("Number pad");
            } catch (_) {}
        }
        if(id === "#uie-app-msg-view") {
            clearUnread({ texts: true });
            if(!activeContact) $("#msg-contact-name").text(isCodiceMode(getSettings()) ? "Letters" : "Messages");
            else $("#msg-contact-name").text(activeContact);
            renderMessages();
        }
        if(id === "#uie-app-store-view") renderAppStore();
        if(id === "#uie-app-browser-view") renderBrowserHome();
        if(id === "#uie-app-cookies-view") renderCookies();
        if(id === "#uie-app-travel-view") renderTravelApp();
        if(id === "#uie-app-bank-view") renderBankApp();
        if(id === "#uie-app-bills-view") void renderBillsApp();
        if(id === "#uie-app-homestead-view") void renderHomesteadApp();
        if(id === "#uie-app-cardforge-view") {
            try { credentialForgeUI?.open(); } catch (_) {}
        }
        if(id === "#uie-app-social-view") {
            maybeShowInstavibeGate();
            renderSocialApp();
        }
        if(id === "#uie-app-settings-view") {
            const s2 = getSettings();
            if (!s2.phone) s2.phone = {};
            $("#p-set-pin").val(String(s2.phone.pin || ""));
            $("#p-device-style").val(String(s2.phone.deviceSkin || "modern"));
            $("#p-wallpaper-name").text(s2.phone.wallpaper ? "Custom wallpaper selected" : "No custom wallpaper");
            $("#p-allow-calls").prop("checked", !isCodiceMode(s2) && s2.phone.allowCalls !== false);
            $("#p-allow-texts").prop("checked", s2.phone.allowTexts !== false);
            const power = ensurePhonePowerState(s2);
            $("#p-battery-sim").prop("checked", power.batterySimulationEnabled);
            $("#p-network-sim").prop("checked", power.networkSimulationEnabled);
            $("#p-phone-plan-cost").val(String(power.monthlyPlanCost));
            $("#p-charger-type").val(String(power.charger || "wall"));
            ensureInstavibePhoneSettings(s2);
            if (!$("#p-instavibe-enabled").length) {
                const $ivRow = $(`
                    <label for="p-instavibe-enabled" class="p-setting-row" style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px;">
                        <span class="p-setting-label" style="margin:0;">Instavibe</span>
                        <input type="checkbox" id="p-instavibe-enabled">
                    </label>
                `);
                $("#p-allow-texts").closest(".p-setting-row").after($ivRow);
            }
            $("#p-instavibe-enabled").prop("checked", s2.phone.instavibe.enabled === true);
            const isScrollSkin = String(s2.phone.deviceSkin || "") === "scroll" || isCodiceMode(s2);
            $("#p-instavibe-enabled").closest("label, .p-setting-row").toggle(!isScrollSkin);
            if (!$("#p-npc-phone-prompt-injection").length) {
                const $row = $(`
                    <label for="p-npc-phone-prompt-injection" style="display:flex; align-items:center; gap:8px; margin-top:8px; opacity:0.95; font-size:12px;">
                        <input type="checkbox" id="p-npc-phone-prompt-injection">
                        NPC phone trigger prompt injection (optional)
                    </label>
                `);
                const $anchor = $("#p-allow-texts").closest("label, .setting-row, .p-setting, div");
                if ($anchor.length) $anchor.after($row);
                else $("#uie-app-settings-view .phone-app-content, #uie-app-settings-view").first().append($row);
            }
            $("#p-npc-phone-prompt-injection").prop("checked", s2.phone.npcPhonePromptInjection === true);
            $("#p-npc-phone-prompt-injection").closest("label, .p-setting-row").toggle(!isScrollSkin);
            const bc = s2.phone.bubbleColors || {};
            $("#p-bubble-sent").val(String(bc.sent || "#cba35c"));
            $("#p-bubble-recv").val(String(bc.received || "#111111"));
        }
        renderPhoneReceiveIndicators();
    };

    const goHome = () => {
        const wasBrowserOpen = $("#uie-app-browser-view").is(":visible");
        $(".phone-app-window").hide();
        $("#uie-app-browser-view").removeClass("browser-app-mode");
        $("#uie-phone-homescreen").css("display", "flex").hide().fadeIn(150);
        activeContact = null; // Reset selection on home
        try {
            const s = getSettings();
            if (s?.phone) {
                s.phone.activeApp = "home";
                s.phone.activeAppName = "Home";
            }
        } catch (_) {}
        if (wasBrowserOpen) {
            try { $("#p-browser-url").val(""); } catch (_) {}
            try { renderBrowserHome(); } catch (_) {}
        }
        renderPhoneReceiveIndicators();
    };

    // --- MESSAGING LOGIC ---
    const getThread = (name) => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        const resolved = resolveContactName(s, name);
        const socialHit = findSocialPersonByNameOrNumber(s, resolved);
        const key = socialHit?.id ? `person:${String(socialHit.id)}` : (resolved || "_unknown");
        if(!Array.isArray(s.phone.smsThreads[key])) s.phone.smsThreads[key] = [];
        return { s, key, list: s.phone.smsThreads[key], displayName: socialHit?.name || resolved || "Unknown" };
    };

    const norm = (x) => String(x || "").trim();
    const isBlocked = (s, name) => {
        const n = norm(name).toLowerCase();
        if (!n) return false;
        const list = Array.isArray(s?.phone?.blockedContacts) ? s.phone.blockedContacts : [];
        return list.some(x => String(x || "").trim().toLowerCase() === n);
    };
    const setBlocked = (s, name, blocked) => {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        const n = norm(name);
        if (!n) return;
        const low = n.toLowerCase();
        s.phone.blockedContacts = s.phone.blockedContacts
            .map(x => String(x || "").trim())
            .filter(Boolean)
            .filter(x => x.toLowerCase() !== low);
        if (blocked) s.phone.blockedContacts.push(n);
    };

    const normalizeNumber = (n) => String(n || "").replace(/[^\d]/g, "").slice(0, 15);
    const formatNumber = (n) => {
        const d = normalizeNumber(n);
        if (d.length === 11 && d[0] === "1") {
            const rest = d.slice(1);
            return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
        }
        if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
        if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
        if (d.length > 10) {
            let out = "";
            let i = d.length;
            while (i > 0) {
                const start = Math.max(0, i - 3);
                const chunk = d.slice(start, i);
                out = chunk + (out ? ` ${out}` : "");
                i = start;
            }
            return `+${out.trim()}`;
        }
        return d || "—";
    };
    const generateFictionalNumber = (used) => {
        const u = used || new Set();
        for (let i = 0; i < 200; i++) {
            const mid = 100 + Math.floor(Math.random() * 900);
            const tail = 1000 + Math.floor(Math.random() * 9000);
            const digits = `555${String(mid).padStart(3, "0")}${tail}`.slice(0, 10);
            if (!u.has(digits)) return digits;
        }
        return `555${String(Date.now()).slice(-7)}`.slice(0, 10);
    };
    const SOCIAL_BUCKETS = ["friends", "associates", "romance", "family", "rivals"];
    const getSocialPeople = (s) => {
        const out = [];
        const social = s?.social && typeof s.social === "object" ? s.social : {};
        for (const k of SOCIAL_BUCKETS) {
            const arr = Array.isArray(social?.[k]) ? social[k] : [];
            for (const p of arr) {
                if (!p || typeof p !== "object") continue;
                const name = String(p.name || "").trim();
                if (!name) continue;
                out.push(p);
            }
        }
        return out;
    };
    const findSocialPersonByNameOrNumber = (s, value) => {
        const want = String(value || "").trim();
        if (!want) return null;
        const wantNum = normalizeNumber(want);
        for (const p of getSocialPeople(s)) {
            const name = String(p?.name || "").trim();
            const pNum = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (name && name.toLowerCase() === want.toLowerCase()) return p;
            if (wantNum && pNum && wantNum === pNum) return p;
        }
        return null;
    };
    const resolveContactName = (s, value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const hit = findSocialPersonByNameOrNumber(s, raw);
        if (hit?.name) return String(hit.name).trim();
        const nb = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const wantNum = normalizeNumber(raw);
        const hit2 = nb.find((x) => String(x?.name || "").trim().toLowerCase() === raw.toLowerCase() || (wantNum && normalizeNumber(x?.number || "") === wantNum));
        if (hit2?.name) return String(hit2.name).trim();
        return raw;
    };
    const displayNameFromThreadKey = (s, key) => {
        const k = String(key || "").trim();
        if (!k) return "Unknown";
        if (k.startsWith("person:")) {
            const pid = k.slice("person:".length).trim();
            const hit = getSocialPeople(s).find((p) => String(p?.id || "").trim() === pid);
            if (hit?.name) return String(hit.name).trim();
        }
        return k;
    };
    const displayNameFromCommunicationTarget = (s, target) => {
        const raw = String(target || "").trim();
        if (!raw) return "Unknown";
        const hit = getSocialPeople(s).find((p) =>
            String(p?.id || "").trim() === raw ||
            String(p?.name || "").trim().toLowerCase() === raw.toLowerCase()
        );
        return String(hit?.name || raw).trim() || "Unknown";
    };
    const communicationTargetForName = (s, name) => {
        const raw = String(name || "").trim();
        if (!raw) return "";
        const hit = getSocialPeople(s).find((p) => String(p?.name || "").trim().toLowerCase() === raw.toLowerCase());
        return String(hit?.id || hit?.name || raw).trim();
    };
    const communicationLocationForName = (s, name) => {
        const raw = String(name || "").trim();
        const hit = getSocialPeople(s).find((p) => String(p?.name || "").trim().toLowerCase() === raw.toLowerCase() || String(p?.id || "").trim() === raw);
        return hit?.homeLocation || hit?.home || hit?.location || hit?.locId || null;
    };
    const getCommunicationMessagesForName = (s, name) => {
        const nm = String(name || "").trim();
        const target = communicationTargetForName(s, nm);
        const names = new Set([nm, target].map((x) => String(x || "").trim()).filter(Boolean));
        return (Array.isArray(s?.relationships?.messages) ? s.relationships.messages : [])
            .filter((m) =>
                names.has(String(m?.targetNpcId || "").trim()) ||
                names.has(String(m?.from || "").trim()) ||
                names.has(String(m?.to || "").trim())
            )
            .sort((a, b) => Number(a?.sentAt || a?.deliveredAt || 0) - Number(b?.sentAt || b?.deliveredAt || 0));
    };
    const getCommunicationThreadTargets = (s) => {
        const map = new Map();
        for (const m of (Array.isArray(s?.relationships?.messages) ? s.relationships.messages : [])) {
            const raw = String(m?.targetNpcId || m?.from || m?.to || "").trim();
            if (!raw || raw === "player") continue;
            const label = displayNameFromCommunicationTarget(s, raw);
            const ts = Number(m?.deliveredAt || m?.sentAt || 0);
            const prev = map.get(label);
            if (!prev || ts >= prev.ts) map.set(label, { label, body: String(m?.body || ""), ts, delivered: !!m?.deliveredAt || m?.direction === "inbound" });
        }
        return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
    };
    const formatLetterTime = (ts) => {
        const n = Number(ts || 0);
        if (!Number.isFinite(n) || n <= 0) return "Undated";
        try {
            return new Date(n).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        } catch (_) {
            return "Undated";
        }
    };
    const renderLetterDocument = (s, m, fallbackName) => {
        const outbound = String(m?.direction || "") === "outbound" || String(m?.from || "") === "player";
        const persona = getPersonaName();
        const targetLabel = displayNameFromCommunicationTarget(s, m?.targetNpcId || fallbackName);
        const from = outbound ? persona : displayNameFromCommunicationTarget(s, m?.from || targetLabel);
        const to = outbound ? targetLabel : persona;
        const sent = Number(m?.sentAt || 0);
        const delivered = Number(m?.deliveredAt || 0);
        const inTransit = outbound && !delivered;
        const direction = outbound ? "outbound" : "inbound";
        const status = inTransit ? "In transit by courier" : outbound ? "Sent letter" : "Received letter";
        return `
            <article class="uie-letter-doc" data-direction="${direction}">
                <header>
                    <address>
                        <strong>${esc(from)}</strong><br>
                        <span>to ${esc(to)}</span>
                    </address>
                    <time datetime="${esc(new Date(sent || delivered || Date.now()).toISOString())}">${esc(formatLetterTime(sent || delivered))}</time>
                </header>
                <section class="uie-letter-body">${parseMarkdown(m?.body || "")}</section>
                <footer>
                    <span class="${inTransit ? "uie-letter-transit" : ""}">${esc(status)}</span>
                    <span class="uie-letter-seal" aria-label="Wax seal"><i class="fa-solid fa-feather-pointed"></i></span>
                </footer>
            </article>
        `;
    };
    const ensureNumbersState = (s) => {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];
        if (!Array.isArray(s.phone.callLog)) s.phone.callLog = [];
        if (!Array.isArray(s.phone.callHistory)) s.phone.callHistory = [];
        if (!s.social) s.social = {};
        for (const k of SOCIAL_BUCKETS) if (!Array.isArray(s.social[k])) s.social[k] = [];
    };
    const ensureContactNumbers = (s) => {
        ensureNumbersState(s);
        const used = new Set();
        for (const p of getSocialPeople(s)) {
            const d = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (d) used.add(d);
        }
        for (const nb of (s.phone.numberBook || [])) {
            const d = normalizeNumber(nb?.number || "");
            if (d) used.add(d);
        }
        let changed = false;
        for (const p of getSocialPeople(s)) {
            const cur = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (cur) continue;
            const digits = generateFictionalNumber(used);
            used.add(digits);
            p.phone = formatNumber(digits);
            changed = true;
        }
        if (changed) saveSettings();
    };

    const isLikelyNumber = (v) => {
        const s = String(v || "").trim();
        if (!s) return false;
        const d = normalizeNumber(s);
        return !!d && d.length >= 7;
    };

    const ensureInboundContact = (s, rawName) => {
        const name = resolveContactName(s, rawName);
        const nm = String(name || "").trim().slice(0, 80);
        if (!nm) return "";

        if (!s.social || typeof s.social !== "object") s.social = {};
        for (const k of SOCIAL_BUCKETS) {
            if (!Array.isArray(s.social[k])) s.social[k] = [];
        }
        const hit = findSocialPersonByNameOrNumber(s, nm);
        if (!hit) {
            const id = `person_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
            s.social.associates.push({
                id,
                name: nm,
                affinity: 50,
                thoughts: "",
                avatar: "",
                likes: "",
                dislikes: "",
                birthday: "",
                location: "",
                age: "",
                knownFamily: "",
                familyRole: "",
                relationshipStatus: "",
                url: "",
                tab: "associates",
                memories: [],
                liveSync: true,
                met_physically: false,
                known_from_past: false,
            });
        }
        ensureContactNumbers(s);
        return nm;
    };

    const lookupNumberForName = (s, name) => {
        const nm = resolveContactName(s, name);
        if (!nm) return "";
        if (isLikelyNumber(nm)) return formatNumber(normalizeNumber(nm));
        const hit = findSocialPersonByNameOrNumber(s, nm);
        const raw = String(hit?.phone || hit?.phoneNumber || "").trim();
        if (raw) return formatNumber(normalizeNumber(raw));
        const nb = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const hit2 = nb.find(x => String(x?.name || "").trim().toLowerCase() === nm.toLowerCase());
        const raw2 = String(hit2?.number || "").trim();
        if (raw2) return formatNumber(normalizeNumber(raw2));
        return "";
    };

    const pushCallLog = (entry) => {
        try {
            const s = getSettings();
            ensureNumbersState(s);
            const e = entry && typeof entry === "object" ? entry : {};
            const who = String(e.who || "").trim();
            const number = String(e.number || "").trim();
            const dir = String(e.dir || "").trim() || "out";
            const startedAt = Number(e.startedAt || 0) || Date.now();
            const endedAt = Number(e.endedAt || 0) || 0;
            const durationSec = endedAt && startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0;
            const missed = e.missed === true;
            const id = `call_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
            s.phone.callLog.unshift({ id, who: who.slice(0, 80), number: number.slice(0, 40), dir, startedAt, endedAt, durationSec, missed });
            s.phone.callLog = (s.phone.callLog || []).slice(0, 80);
            saveSettings();
        } catch (_) {}
        try { renderDialRecents(); } catch (_) {}
    };

    const openMessagesToLabel = (labelRaw) => {
        const s = getSettings();
        const label = String(labelRaw || "").trim();
        if (!label) return;
        const resolved = resolveContactName(s, label) || label;
        activeContact = resolved;
        openApp("#uie-app-msg-view");
        renderMessages();
    };

    const blockContactFromLabel = (labelRaw) => {
        const s = getSettings();
        const label = String(labelRaw || "").trim();
        if (!label) return;
        const resolved = resolveContactName(s, label) || label;
        const blocked = isBlocked(s, resolved);
        setBlocked(s, resolved, !blocked);
        saveSettings();
        notify("info", `${!blocked ? "Blocked" : "Unblocked"} ${resolved}.`, "Messages", "phoneMessages");
        renderDialRecents();
    };

    const renderDialRecents = () => {
        const box = $("#dial-recents");
        if (!box.length) return;
        const s = getSettings();
        ensureNumbersState(s);
        const list = Array.isArray(s?.phone?.callLog) ? s.phone.callLog : [];
        if (!list.length) {
            box.html(`<div style="opacity:0.65; color:#fff; text-align:center; padding:14px; font-weight:900;">No recent calls.</div>`);
            return;
        }
        const fmtTime = (ts) => {
            try { return new Date(Number(ts || 0) || Date.now()).toLocaleString(); } catch (_) { return ""; }
        };
        box.empty();
        for (const c of list.slice(0, 30)) {
            const who = String(c?.who || "").trim();
            const number = String(c?.number || "").trim();
            const label = who || number || "Unknown";
            const sub = number && who && who !== number ? number : fmtTime(c?.startedAt);
            const dir = String(c?.dir || "out");
            const missed = c?.missed === true;
            const declined = dir === "declined" || c?.declined === true;
            const badge = missed ?
                 `<span style="margin-left:8px; font-size:11px; color:#f38ba8; font-weight:900;">MISSED</span>`
                : declined ?
                   `<span style="margin-left:8px; font-size:11px; color:#fab387; font-weight:900;">DECLINED</span>`
                  : "";
            const dirIco =
                dir === "in" ? "fa-arrow-down" : dir === "declined" ? "fa-phone-slash" : "fa-arrow-up";
            const dialNum = number || (isLikelyNumber(who) ? who : "");
            const durSec = Math.max(0, Number(c?.durationSec || 0));
            const durTxt =
                durSec > 0 ?
                     `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, "0")} on call`
                    : missed ?
                       "No answer"
                      : declined ?
                         "Declined"
                        : "";
            box.append(`
                <div class="dial-recent-row" data-number="${esc(dialNum)}" style="display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); margin-bottom:6px; cursor:pointer;">
                    <i class="fa-solid ${dirIco}" style="opacity:0.75; flex-shrink:0;"></i>
                    <div style="flex:1; min-width:0;">
                        <div style="color:#fff; font-weight:900; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(label)}${badge}</div>
                        <div style="color:rgba(255,255,255,0.72); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(sub || "")}</div>
                        <div style="color:rgba(255,255,255,0.55); font-size:10px; margin-top:2px;">${esc(fmtTime(c?.startedAt))}${durTxt ? ` · ${esc(durTxt)}` : ""}</div>
                    </div>
                    <div style="display:flex; flex-direction:row; gap:4px; flex-shrink:0; align-items:center;">
                        <button type="button" class="dial-recent-call" data-number="${esc(dialNum)}" style="height:32px; width:38px; border-radius:12px; border:none; background:#2ecc71; color:#000; font-weight:900; cursor:pointer;"><i class="fa-solid fa-phone"></i></button>
                        <button type="button" class="dial-recent-msg" data-contact="${esc(label)}" title="Open Messages" style="height:32px; width:38px; border-radius:12px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.28); color:#fff; font-weight:900; cursor:pointer;"><i class="fa-solid fa-comment"></i></button>
                        <button type="button" class="dial-recent-block" data-contact="${esc(label)}" title="Block / unblock" style="height:32px; width:38px; border-radius:12px; border:1px solid rgba(243,139,168,0.35); background:rgba(0,0,0,0.28); color:#f38ba8; font-weight:900; cursor:pointer;"><i class="fa-solid fa-ban"></i></button>
                    </div>
                </div>
            `);
        }
    };

    $win.off("click.phoneDialRecentsClear", "#dial-recents-clear").on("click.phoneDialRecentsClear", "#dial-recents-clear", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const ok = await customConfirm("Clear call log?");
        if (!ok) return;
        const s = getSettings();
        ensureNumbersState(s);
        s.phone.callLog = [];
        saveSettings();
        renderDialRecents();
    });

    $win.off("click.phoneDialRecentCall", "#dial-recents .dial-recent-call").on("click.phoneDialRecentCall", "#dial-recents .dial-recent-call", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String($(this).data("number") || "").trim();
        if (!raw) return;
        const digits = normalizeNumber(raw);
        dialBuf = digits || raw;
        try { $("#dial-display").text(dialBuf || "—"); } catch (_) {}
        $("#dial-call").trigger("click");
    });

    $win.off("click.phoneDialRecentMsg", "#dial-recents .dial-recent-msg").on("click.phoneDialRecentMsg", "#dial-recents .dial-recent-msg", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String($(this).data("contact") || "").trim();
        openMessagesToLabel(raw);
    });
    $win.off("click.phoneDialRecentBlock", "#dial-recents .dial-recent-block").on("click.phoneDialRecentBlock", "#dial-recents .dial-recent-block", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String($(this).data("contact") || "").trim();
        blockContactFromLabel(raw);
    });
    $win.off("click.phoneDialKeypadToggle", "#dial-toggle-keypad").on("click.phoneDialKeypadToggle", "#dial-toggle-keypad", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const sec = $("#dial-keypad-section");
        const open = sec.is(":visible");
        if (open) {
            sec.hide();
            $(this).text("Number pad");
        } else {
            sec.css("display", "flex").show();
            $(this).text("Hide pad");
        }
    });
    $win.off("click.phoneDialRecentPick", "#dial-recents .dial-recent-row").on("click.phoneDialRecentPick", "#dial-recents .dial-recent-row", function (e) {
        if ($(e.target).closest(".dial-recent-call, .dial-recent-msg, .dial-recent-block").length) return;
        e.preventDefault();
        e.stopPropagation();
        const raw = String($(this).data("number") || "").trim();
        if (!raw) return;
        const digits = normalizeNumber(raw);
        dialBuf = digits || raw;
        try { $("#dial-display").text(dialBuf || "—"); } catch (_) {}
    });

    const renderMessages = () => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        if(!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        const container = $("#msg-container");
        container.empty();

        const $inputArea = $("#uie-app-msg-view .p-input-area");
        const $header = $("#msg-contact-name");
        const blocked = !!(activeContact && isBlocked(s, activeContact));
        const codiceMode = isCodiceMode(s);
        $inputArea.toggleClass("uie-letter-compose", codiceMode && !!activeContact && !blocked);
        if (codiceMode && activeContact) $inputArea.attr("data-letter-to", String(activeContact));
        else $inputArea.removeAttr("data-letter-to");
        $("#msg-block").toggle(!!activeContact);
        $("#msg-block").toggleClass("blocked", blocked);

        if(!activeContact) {
            $header.text(codiceMode ? "Letters" : "Messages");
            $inputArea.hide();

            const keys = codiceMode ? [] : Object.keys(s.phone.smsThreads || {})
                .filter(k => Array.isArray(s.phone.smsThreads[k]) && s.phone.smsThreads[k].length)
                .filter(k => !isBlocked(s, displayNameFromThreadKey(s, k)));
            const letterThreads = codiceMode ? getCommunicationThreadTargets(s).filter((x) => !isBlocked(s, x.label)) : [];
            if(!keys.length && !letterThreads.length) {
                container.html(`
                    <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; opacity:0.7;">
                        <i class="fa-solid ${codiceMode ? "fa-feather-pointed" : "fa-comments"}" style="font-size:3em; margin-bottom:10px;"></i>
                        <span style="font-size:1.2em; font-weight:900;">${codiceMode ? "No Letters" : "No Conversations"}</span>
                        <div style="margin-top:8px; font-size:0.9em;">Open the address book to ${codiceMode ? "write a sealed letter" : "start a text"}.</div>
                    </div>
                `);
                return;
            }

            letterThreads.forEach(t => {
                container.append(`
                    <section class="contact-row uie-letter-list-row" data-name="${esc(t.label)}" aria-label="Open letters from ${esc(t.label)}">
                        <div class="uie-letter-seal"><i class="fa-solid fa-feather-pointed"></i></div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:900; color:#2b170b;">${esc(t.label)}</div>
                            <div style="opacity:0.7; font-size:0.85em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.delivered ? "Delivered letter" : "Letter in transit"} - ${esc(t.body || "")}</div>
                        </div>
                    </section>
                `);
            });
            keys.slice(0, 60).forEach(k => {
                const t = s.phone.smsThreads[k];
                const last = t[t.length - 1];
                const displayName = displayNameFromThreadKey(s, k);
                container.append(`
                    <div class="contact-row" data-thread="${esc(k)}" data-name="${esc(displayName)}" style="display:flex; align-items:center; padding:15px; border-bottom:1px solid #eee; cursor:pointer;">
                        <div class="contact-avatar" style="width:40px; height:40px; background:#ddd; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:15px; font-weight:bold; color:#555;">${esc(displayName).charAt(0)}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:900; color:#222;">${esc(displayName)}</div>
                            <div style="opacity:0.7; font-size:0.85em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(last?.text || "")}</div>
                        </div>
                    </div>
                `);
            });
            return;
        }

        $header.text(String(activeContact));
        if (blocked) {
            $inputArea.hide();
            container.append(`<div style="padding:12px; margin:10px; border-radius:10px; border:1px solid rgba(243,139,168,0.35); background:rgba(243,139,168,0.12); color:#f38ba8; font-weight:900;">Blocked contact</div>`);
        } else {
            $inputArea.show();
        }

        if (codiceMode) {
            const letters = getCommunicationMessagesForName(s, activeContact);
            if (!letters.length) {
                container.html(`<section class="uie-letter-thread"><article class="uie-letter-doc" data-direction="outbound"><header><address><strong>Fresh parchment</strong><br><span>to ${esc(activeContact)}</span></address><time>Ready</time></header><section class="uie-letter-body">No letters with ${esc(activeContact)} yet. Write below and send it by bird or courier.</section><footer><span>Unsealed</span><span class="uie-letter-seal" aria-label="Wax seal"><i class="fa-solid fa-feather-pointed"></i></span></footer></article></section>`);
                return;
            }
            container.append(`<section class="uie-letter-thread"></section>`);
            const thread = container.find(".uie-letter-thread");
            letters.forEach((m, idx) => {
                thread.append(renderLetterDocument(s, m, activeContact));
            });
            container.scrollTop(container.prop("scrollHeight"));
            return;
        }

        const { list } = getThread(activeContact);
        if (!list.length) {
            container.html(`<div style="padding:20px; text-align:center; opacity:0.65;">No texts with ${esc(activeContact)} yet.</div>`);
            return;
        }

        list.forEach((m, idx) => {
            const cls = m.isUser ? "sent" : "received";
            const text = String(m.text || "");
            const img = String(m.image || "");
            const preview = img ? `<div style="margin-bottom:${text ? "8px" : "0"};"><img src="${esc(img)}" style="max-width:220px; width:100%; height:auto; border-radius:12px; display:block; border:1px solid rgba(255,255,255,0.10);"></div>` : "";
            const body = text ? `<div style="white-space:pre-wrap; word-break:break-word;">${parseMarkdown(text)}</div>` : "";
            container.append(`<div class="p-bubble ${cls}" data-mid="${idx}" style="position:relative;">${preview}${body}</div>`);
        });
        container.scrollTop(container.prop("scrollHeight"));
    };

    $win.off("click.phoneMsgSend", "#msg-send-btn");
    $win.on("click.phoneMsgSend", "#msg-send-btn", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = String($("#msg-input").val() || "");
        if(!t.trim()) return;

        // If no contact selected, check Social for a default or prompt
        let targetName = activeContact;
        if(!targetName) {
            const s = getSettings();
            if(s.social.friends.length > 0) targetName = s.social.friends[0].name; // Default to first friend
            else targetName = "Unknown";
        }
        const sBlock = getSettings();
        if (isBlocked(sBlock, targetName)) {
            notify("warning", "That contact is blocked.", "Messages", "phoneMessages");
            $("#msg-input").val("");
            renderMessages();
            return;
        }

        if (isCodiceMode(sBlock)) {
            try {
                const targetId = communicationTargetForName(sBlock, targetName) || targetName;
                const targetLocation = communicationLocationForName(sBlock, targetName);
                await sendCourierMessage(targetId, t, targetLocation);
                $("#msg-input").val("");
                try { $("#msg-input").css("height", ""); } catch (_) {}
                notify("success", `Letter sent to ${targetName}.`, "Codice", "phoneMessages");
                try { relayRelationship(targetName, t, "letter"); } catch (_) {}
                try { injectRpEvent(`(Letter) ${getPersonaName()} sends a sealed letter to ${targetName}: "${String(t).slice(0, 500)}"`, { uie: { type: "codice_letter", who: targetName } }); } catch (_) {}
                renderMessages();
                return;
            } catch (_) {
                notify("warning", "The courier could not take that letter.", "Codice", "phoneMessages");
                return;
            }
        }

        const th = getThread(targetName);
        const msgObj = { isUser: true, text: t, ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        $("#msg-input").val("");
        try { $("#msg-input").css("height", ""); } catch (_) {}
        notify("success", "Message sent.", "Messages", "phoneMessages");
        try { relayRelationship(targetName, t, "text"); } catch (_) {}
        try {
            const inj = await injectRpEvent(`(Text) ${getPersonaName()} → ${targetName}: "${String(t).slice(0, 500)}"`, { uie: { type: "phone_text", who: targetName } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}

        const s2 = getSettings();
        const allow = !!(s2?.ai?.phoneMessages);
        if (!allow) return;

        const mainCtx = getMainChatContext(5);
        const chat = getChatSnippet(50);
        const lore = (() => { try { const ctx = getContext?.(); const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo; const keys=[]; if(Array.isArray(maybe)){ for(const it of maybe){ const k=it?.key||it?.name||it?.title; if(k) keys.push(String(k)); } } return Array.from(new Set(keys)).slice(0, 60).join(", "); } catch(_) { return ""; } })();
        const character = (() => { try { const ctx = getContext?.(); return JSON.stringify({ user: ctx?.name1, character: ctx?.name2, chatId: ctx?.chatId, characterId: ctx?.characterId, groupId: ctx?.groupId }); } catch(_) { return "{}"; } })();
        const threadTail = getThreadTail(targetName, 10);
        const persona = getPersonaName();
        const card = getCharacterCardBlock(2600);
        const mem = getSocialMemoryBlockForName(targetName, 8);
        const prompt = `
${mainCtx ? `${mainCtx}\n\n` : ""}The user is texting you.

Phone Text Rules:
- You are ${targetName} replying by text to ${persona}.
- This is a ROLEPLAY response. Treat the provided Chat Log as the story so far.
- IMPORTANT: You only know what you have personally witnessed or been told in the Chat Log. You are NOT omniscient.
- Reply MUST be a realistic text message (short).
- ABSOLUTE RULE: no narration, no scene description, no roleplay formatting, no quotes.
- Do NOT include: asterisks (*like this*), brackets [like this], parentheses (like this), or prefixes like "${targetName}:".
- Decide based on CONTEXT; if uncertain, keep the reply short or choose no reply.
- If the user asks ${targetName} to come over / meet up and ${targetName} agrees, set arrivalInTurns to 1 or 2.
- If you cannot comply with the formatting rules, set willReply=false.

Return ONLY JSON:
{
  "hasPhone": true,
  "willReply": true,
  "reply": "short realistic text reply (no narration)",
  "reason": "why they did/didn't reply",
  "arrivalInTurns": 0,
  "arrivalReason": ""
}

TEXT SENT: "${t}"
TARGET: "${targetName}"
RECENT TEXT THREAD:
${threadTail}
<character_card>
${card}
</character_card>
${mem}
CONTEXT (recent chat log - USE THIS):
${chat}`.slice(0, 6000);

        try {
            const res = await generateContent(prompt, "System Check");
            const logic = JSON.parse(cleanOutput(res, "json"));

            if(logic.willReply) {
                setTimeout(async () => {
                    const th2 = getThread(targetName);
                    const replyText = sanitizePhoneLine(String(logic.reply || ""), 500);
                    if (!replyText) return;
                    const replyObj = { isUser: false, text: replyText, ts: Date.now() };
                    try {
                        const sImg = getSettings();
                        const img = await checkAndGenerateImage(`Phone text from ${targetName}:\n${replyText.slice(0, 800)}`, "msg");
                        if (img) replyObj.image = img;
                    } catch (_) {}
                    th2.list.push(replyObj);
                    saveSettings();
                    if($("#uie-app-msg-view").is(":visible")) renderMessages();
                    notify("success", `${targetName} replied.`, "Messages", "phoneMessages");
                    try { relayRelationship(targetName, replyText, "text"); } catch (_) {}
                    try {
                        const inj = await injectRpEvent(`(Text) ${targetName} → ${persona}: "${replyText}"${replyObj.image ? " [Image]" : ""}`, { uie: { type: "phone_text", who: targetName } });
                        if (inj && inj.ok && inj.mesid) {
                            replyObj.chatMesId = inj.mesid;
                            saveSettings();
                        }
                    } catch (_) {}
                }, 2000);

                const turns = Number(logic.arrivalInTurns || 0);
                if (turns > 0) scheduleArrival(targetName, turns, logic.arrivalReason || "They agreed to come over.");
            }
        } catch(e) {}
    });

    $win
        .off("keydown.phoneMsgEnter", "#msg-input")
        .on("keydown.phoneMsgEnter", "#msg-input", function (e) {
            if (e.key !== "Enter") return;
            if (e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();
            $("#msg-send-btn").trigger("click");
        });


    $win.off("input.phoneMsgGrow", "#msg-input").on("input.phoneMsgGrow", "#msg-input", function () {
        try {
            this.style.height = "0px";
            const max = 120;
            const h = Math.min(max, this.scrollHeight || 0);
            this.style.height = `${Math.max(40, h)}px`;
        } catch (_) {}
    });

    $win.off("click.phoneMsgAttach", "#msg-attach-btn").on("click.phoneMsgAttach", "#msg-attach-btn", function(e){
        e.preventDefault();
        e.stopPropagation();
        $("#msg-attach-file").trigger("click");
    });
    $win.off("change.phoneMsgAttach", "#msg-attach-file").on("change.phoneMsgAttach", "#msg-attach-file", async function(e){
        const f = (e.target.files || [])[0];
        $(this).val("");
        if (!f) return;
        if (!activeContact) return;
        const s = getSettings();
        if (isBlocked(s, activeContact)) return;
        const dataUrl = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = (ev) => resolve(String(ev?.target?.result || ""));
            r.onerror = () => resolve("");
            r.readAsDataURL(f);
        });
        if (!dataUrl) return;
        const th = getThread(activeContact);
        const msgObj = { isUser: true, text: "", image: dataUrl, ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        try {
            const persona = getPersonaName();
            const desc = `User sent an image file to ${String(activeContact)}.`;
            await injectRpEvent(`[System: User sent an image file to ${String(activeContact)}. Description: ${desc}. Prompt used: (none).]`);
            const inj = await injectRpEvent(`(Text) ${persona} → ${activeContact}: [Image]`, { uie: { type: "phone_text", who: activeContact } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}
    });

    const ensurePhoneStickers = (s) => {
        if (!s.phone) s.phone = {};
        if (!s.phone.stickers) s.phone.stickers = { packs: [], active: "" };
        if (!Array.isArray(s.phone.stickers.packs)) s.phone.stickers.packs = [];
        if (!s.phone.stickers.active) s.phone.stickers.active = s.phone.stickers.packs[0]?.name || "";
    };

    const renderStickerDrawer = () => {
        const s = getSettings();
        ensurePhoneStickers(s);
        let root = document.getElementById("uie-phone-sticker-drawer");
        if (!root) {
            root = document.createElement("div");
            root.id = "uie-phone-sticker-drawer";
            root.style.cssText = "position:fixed;inset:0;z-index:2147483642;display:none;background:rgba(0,0,0,0.35);backdrop-filter:blur(10px);";
            root.innerHTML = `
              <div style="position:absolute; inset:0; display:flex; flex-direction:column; background:rgba(10,12,18,0.92); border-top:1px solid rgba(255,255,255,0.10);">
                <div style="height:52px; display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.10);">
                  <div style="font-weight:900; color:#cba35c; letter-spacing:0.6px;">Stickers</div>
                  <button id="uie-phone-sticker-import" style="margin-left:auto; height:34px; padding:0 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:#fff; font-weight:900; cursor:pointer;">Import Pack</button>
                  <button id="uie-phone-sticker-close" style="width:38px; height:34px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.18); color:#fff; font-weight:900; cursor:pointer;">×</button>
                  <input type="file" id="uie-phone-sticker-files" accept="image/*" multiple style="display:none;">
                </div>
                <div id="uie-phone-sticker-tabs" style="display:flex; gap:8px; padding:10px 12px; overflow:auto; border-bottom:1px solid rgba(255,255,255,0.10);"></div>
                <div id="uie-phone-sticker-grid" style="flex:1; min-height:0; overflow:auto; padding:12px; display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px;"></div>
                <div id="uie-phone-sticker-empty" style="display:none; padding:18px; text-align:center; opacity:0.75; font-weight:900;">No sticker packs yet. Import one.</div>
              </div>
            `;
            document.body.appendChild(root);
        }
        const packs = s.phone.stickers.packs || [];
        const active = String(s.phone.stickers.active || "");
        const tabs = root.querySelector("#uie-phone-sticker-tabs");
        const grid = root.querySelector("#uie-phone-sticker-grid");
        const empty = root.querySelector("#uie-phone-sticker-empty");
        if (tabs) tabs.innerHTML = "";
        if (grid) grid.innerHTML = "";
        if (empty) empty.style.display = "none";

        packs.forEach(p => {
            const b = document.createElement("button");
            b.className = "uie-phone-sticker-tab";
            b.setAttribute("data-pack", String(p.name || ""));
            b.textContent = String(p.name || "Pack");
            b.style.cssText = `height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:${String(p.name||"")===active ? "rgba(203, 163, 92,0.18)" : "rgba(0,0,0,0.18)"};color:${String(p.name||"")===active ? "#cba35c" : "#fff"};font-weight:900;cursor:pointer;white-space:nowrap;`;
            tabs?.appendChild(b);
        });

        const pack = packs.find(p => String(p.name || "") === active) || packs[0] || null;
        if (!pack || !Array.isArray(pack.images) || !pack.images.length) {
            if (empty) empty.style.display = "block";
            return;
        }
        (pack.images || []).slice(0, 240).forEach((im, idx) => {
            const src = String(im?.dataUrl || "");
            if (!src) return;
            const tile = document.createElement("button");
            tile.className = "uie-phone-sticker-tile";
            tile.setAttribute("data-pack", String(pack.name || ""));
            tile.setAttribute("data-idx", String(idx));
            tile.style.cssText = "border:none;background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;overflow:hidden;padding:0;cursor:pointer;aspect-ratio:1/1;";
            tile.innerHTML = `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:contain;display:block;">`;
            grid?.appendChild(tile);
        });
    };

    const openStickerDrawer = () => {
        renderStickerDrawer();
        const root = document.getElementById("uie-phone-sticker-drawer");
        if (root) root.style.display = "block";
    };

    const closeStickerDrawer = () => {
        const root = document.getElementById("uie-phone-sticker-drawer");
        if (root) root.style.display = "none";
    };

    $win
        .off("click.phoneStickerOpen pointerup.phoneStickerOpen touchend.phoneStickerOpen", "#msg-sticker-btn")
        .on("click.phoneStickerOpen pointerup.phoneStickerOpen touchend.phoneStickerOpen", "#msg-sticker-btn", function(e){
        if (e.type === "pointerup") {
            const pt = String(e.pointerType || "").toLowerCase();
            if (pt && pt !== "touch" && pt !== "pen") return;
        }
        e.preventDefault();
        e.stopPropagation();
        openStickerDrawer();
    });
    $("body").off("click.phoneStickerClose", "#uie-phone-sticker-close").on("click.phoneStickerClose", "#uie-phone-sticker-close", function(e){
        e.preventDefault();
        e.stopPropagation();
        closeStickerDrawer();
    });
    $("body").off("click.phoneStickerTab", ".uie-phone-sticker-tab").on("click.phoneStickerTab", ".uie-phone-sticker-tab", function(e){
        e.preventDefault();
        e.stopPropagation();
        const pack = String($(this).data("pack") || "");
        const s = getSettings();
        ensurePhoneStickers(s);
        s.phone.stickers.active = pack;
        saveSettings();
        renderStickerDrawer();
    });
    $("body").off("click.phoneStickerImport", "#uie-phone-sticker-import").on("click.phoneStickerImport", "#uie-phone-sticker-import", function(e){
        e.preventDefault();
        e.stopPropagation();
        const name = (prompt("Sticker pack name:", "My Stickers") || "").trim();
        if (!name) return;
        const root = document.getElementById("uie-phone-sticker-drawer");
        if (!root) return;
        root.setAttribute("data-import-name", name.slice(0, 60));
        const input = root.querySelector("#uie-phone-sticker-files");
        try { input?.click(); } catch (_) {}
    });
    $("body").off("change.phoneStickerFiles", "#uie-phone-sticker-files").on("change.phoneStickerFiles", "#uie-phone-sticker-files", async function(e){
        const root = document.getElementById("uie-phone-sticker-drawer");
        const name = String(root?.getAttribute("data-import-name") || "").trim();
        if (root) root.removeAttribute("data-import-name");
        const files = Array.from(e.target.files || []);
        $(this).val("");
        if (!name || !files.length) return;
        const images = [];
        for (const f of files.slice(0, 120)) {
            const fname = String(f?.name || "");
            if (!fname) continue;
            const dataUrl = await new Promise((resolve) => {
                const r = new FileReader();
                r.onload = (ev) => resolve(String(ev?.target?.result || ""));
                r.onerror = () => resolve("");
                r.readAsDataURL(f);
            });
            if (!dataUrl) continue;
            images.push({ name: fname.slice(0, 120), dataUrl });
        }
        const s = getSettings();
        ensurePhoneStickers(s);
        s.phone.stickers.packs = (s.phone.stickers.packs || []).filter(p => String(p?.name || "") !== name);
        s.phone.stickers.packs.push({ name, images });
        s.phone.stickers.active = name;
        saveSettings();
        renderStickerDrawer();
    });
    $("body").off("click.phoneStickerPick", ".uie-phone-sticker-tile").on("click.phoneStickerPick", ".uie-phone-sticker-tile", async function(e){
        e.preventDefault();
        e.stopPropagation();
        if (!activeContact) return;
        const s = getSettings();
        ensurePhoneStickers(s);
        if (isBlocked(s, activeContact)) return;
        const packName = String($(this).data("pack") || "");
        const idx = Number($(this).data("idx"));
        const pack = (s.phone.stickers.packs || []).find(p => String(p?.name || "") === packName);
        const img = pack?.images?.[idx]?.dataUrl || "";
        if (!img) return;
        const th = getThread(activeContact);
        const msgObj = { isUser: true, text: "", image: String(img), ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        closeStickerDrawer();
        try {
            const inj = await injectRpEvent(`(Text) ${getPersonaName()} → ${activeContact}: [Sticker]`, { uie: { type: "phone_text", who: activeContact } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}
    });

    $win.off("click.phoneMsgThread", "#msg-container .contact-row[data-thread]").on("click.phoneMsgThread", "#msg-container .contact-row[data-thread]", function(e){
        e.preventDefault();
        e.stopPropagation();
        const rowName = String($(this).data("name") || "").trim();
        const rowThread = String($(this).data("thread") || "").trim();
        const s = getSettings();
        activeContact = resolveContactName(s, rowName || displayNameFromThreadKey(s, rowThread));
        renderMessages();
    });
    $win.off("click.phoneMsgLetterThread", "#msg-container .contact-row[data-name]").on("click.phoneMsgLetterThread", "#msg-container .contact-row[data-name]", function(e){
        if ($(this).is("[data-thread]")) return;
        e.preventDefault();
        e.stopPropagation();
        const rowName = String($(this).data("name") || "").trim();
        if (!rowName) return;
        const s = getSettings();
        activeContact = resolveContactName(s, rowName);
        renderMessages();
    });

    const removeChatMes = (mesid) => {
        const id = String(mesid || "").trim();
        if (!id) return;
        try {
            const sel = `#chat .mes[mesid="${CSS.escape(id)}"], #chat .mes[data-id="${CSS.escape(id)}"]`;
            const el = document.querySelector(sel);
            if (el) el.remove();
        } catch (_) {}
    };

    $win.off("click.phoneMsgDel", "#msg-container .msg-del");

    $win.off("click.phoneMsgDelThread", "#msg-del-thread").on("click.phoneMsgDelThread", "#msg-del-thread", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s) return;
        if (!s.phone) s.phone = {};
        if (!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};

        if (!activeContact) {
            if (!(await customConfirm("Delete ALL conversations?"))) return;
            s.phone.smsThreads = {};
            saveSettings();
            renderMessages();
            return;
        }

        const name = String(activeContact || "").trim();
        if (!name) return;
        if (!(await customConfirm(`Delete conversation with ${name}?`))) return;
        const th = getThread(name);
        for (const m of th.list) {
            if (m?.chatMesId) removeChatMes(m.chatMesId);
        }
        delete s.phone.smsThreads[th.key];
        activeContact = null;
        saveSettings();
        renderMessages();
    });

    $win.off("click.phoneSnoop", "#msg-snoop").on("click.phoneSnoop", "#msg-snoop", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const snooper = (prompt("Who is going through your phone?") || "").trim();
        if(!snooper) return;
        const s = getSettings();
        if(!s.phone?.smsThreads) return;
        const keys = Object.keys(s.phone.smsThreads);
        const lines = [];
        for (const k of keys) {
            const list = s.phone.smsThreads[k];
            if (!Array.isArray(list) || !list.length) continue;
            const displayName = displayNameFromThreadKey(s, k);
            const tail = list.slice(-4);
            tail.forEach(m => {
                const who = m.isUser ? "You" : displayName;
                lines.push(`[Text ${displayName}] ${who}: ${String(m.text || "").slice(0, 180)}`);
            });
        }
        if (!lines.length) return;
        await injectRpEvent(`${snooper} goes through your phone and reads your messages:\n${lines.join("\n")}`, { uie: { type: "phone_snoop", who: snooper } });
    });

    $win.off("click.phoneMsgBlock", "#msg-block").on("click.phoneMsgBlock", "#msg-block", function(e){
        e.preventDefault();
        e.stopPropagation();
        if (!activeContact) return;
        const s = getSettings();
        const blocked = isBlocked(s, activeContact);
        setBlocked(s, activeContact, !blocked);
        saveSettings();
        notify("info", `${!blocked ? "Blocked" : "Unblocked"} ${activeContact}.`, "Messages", "phoneMessages");
        renderMessages();
    });

    // --- CONTACTS LOGIC (Fixed Buttons) ---
    const renderContacts = () => {
        const s = getSettings();
        try { ensureContactNumbers(s); } catch (_) {}
        const l = $("#contact-list");
        l.empty();
        const codice = isCodiceMode(s);

        const socialPeople = getSocialPeople(s);
        const byName = new Set(socialPeople.map(p => String(p?.name || "").trim().toLowerCase()).filter(Boolean));
        const byNum = new Set(socialPeople.map(p => normalizeNumber(p?.phone || p?.phoneNumber || "")).filter(Boolean));
        const phoneBook = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const phoneOnly = phoneBook
            .map(x => ({ name: String(x?.name || "").trim(), number: String(x?.number || "").trim() }))
            .filter(x => x.name)
            .filter(x => !byName.has(x.name.toLowerCase()) && !byNum.has(normalizeNumber(x.number)));
        const combined = [
            ...socialPeople.map(p => ({ kind: "social", name: p.name, number: codice ? String(p?.homeLocation || p?.home || p?.location || p?.tab || "Known contact") : formatNumber(p?.phone || p?.phoneNumber || ""), avatar: p.avatar || "" })),
            ...(codice ? [] : phoneOnly.map(p => ({ kind: "phone", name: p.name, number: formatNumber(p.number), avatar: "" })))
        ].filter(p => p?.name).filter(p => !isBlocked(s, p.name));

        if(!combined.length) {
            l.html(`<div style="padding:30px; text-align:center; color:#aaa;">No contacts found.<br>${codice ? "Meet people through Social to write them." : "Tap + to add one."}</div>`);
        } else {
            combined.forEach(p => {
                const num = String(p.number || "—");
                const av = String(p.avatar || "").trim();
                const avatarHtml = av ?
                     `<img src="${esc(av)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
                    : `${String(p.name || "?").charAt(0)}`;

                l.append(`
                    <div class="contact-row" data-name="${esc(p.name)}" style="display:flex; flex-direction:column; padding:15px; border-bottom:1px solid #eee; cursor:pointer;">
                        <div style="display:flex; align-items:center; width:100%;">
                            <div class="contact-avatar" style="width:40px; height:40px; background:#ddd; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:15px; font-weight:bold; color:#555; overflow:hidden;">${avatarHtml}</div>
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:bold; color:#333; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
                                <div style="font-size:0.78em; opacity:0.65; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(num)}</div>
                            </div>

                            <i class="fa-solid ${codice ? "fa-feather-pointed" : "fa-comment"} phone-msg-trigger" data-name="${p.name}" style="color:${codice ? "#7a2618" : "#3498db"}; padding:10px; cursor:pointer; font-size:1.2em; margin-right:10px;" title="${codice ? "Write Letter" : "Message"}"></i>

                            ${codice ? "" : `<i class="fa-solid fa-phone phone-call-trigger" data-name="${p.name}" style="color:#2ecc71; padding:10px; cursor:pointer; font-size:1.2em;" title="Call"></i>`}
                        </div>
                        <div class="contact-details-expansion" style="display:none; margin-top:10px; padding:10px; border-top:1px solid rgba(0,0,0,0.05); font-size:12px; color:#555; width:100%;"></div>
                    </div>
                `);
            });
        }
    };

    const openThread = (name) => {
        if (!name) return;
        const s = getSettings();
        activeContact = resolveContactName(s, name);
        if (!isCodiceMode(s)) {
            try { getThread(activeContact); } catch (_) {}
        }
        {
            const $p = $("#uie-phone-window");
            const wasVisible = $p.is(":visible");
            $p.show().css("display", "flex");
            if (!wasVisible) {
                try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
            }
        }
        openApp("#uie-app-msg-view");
        try { $("#msg-contact-name").text(String(activeContact || "Messages")); } catch (_) {}
        try { renderMessages(); } catch (_) {}
        try { $("#msg-input").trigger("focus"); } catch (_) {}
    };

    const promptAddContact = () => {
        const s = getSettings();
        ensureNumbersState(s);
        const name = String(window.prompt("Contact name:", "") || "").trim();
        if (!name) return;
        const used = new Set();
        for (const nb of (s.phone.numberBook || [])) used.add(normalizeNumber(nb?.number || ""));
        for (const p of getSocialPeople(s)) {
            const d = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (d) used.add(d);
        }
        const digits = generateFictionalNumber(used);
        const formatted = formatNumber(digits);
        s.phone.numberBook = (s.phone.numberBook || []).filter(x => normalizeNumber(x?.number || "") !== digits);
        s.phone.numberBook.push({ name: name.slice(0, 60), number: formatted, ts: Date.now() });
        saveSettings();
        renderContacts();
        notify("success", `Added ${name}`, "Contacts", "phoneMessages");
    };
    try { window.UIE_phone_openThread = openThread; } catch (_) {}

    $win.on("click.phone", "#contact-add-manual", (e) => { e.preventDefault(); e.stopPropagation(); promptAddContact(); });
    $win.on("click.phone", "#contact-add-fab", (e) => { e.preventDefault(); e.stopPropagation(); promptAddContact(); });

    // --- MESSAGE SHORTCUT (Contacts) ---
    $win.off("click.phoneMsgTrigger", ".phone-msg-trigger");
    $win.on("click.phoneMsgTrigger", ".phone-msg-trigger", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const nm = String($(this).data("name") || "").trim();
        if (!nm) return;
        openThread(nm);
    });

    // --- CALL LOGIC ---
    $win.off("click.phoneCallTrigger", ".phone-call-trigger");
    $win.on("click.phoneCallTrigger", ".phone-call-trigger", function(e) {
        e.stopPropagation();
        activeContact = $(this).data("name");
        startCall(activeContact, { dir: "out" });
    });

    // Homestead Manager App Upgrades
    $win.off("click.phoneHomesteadUpgrade", ".homestead-upgrade-btn").on("click.phoneHomesteadUpgrade", ".homestead-upgrade-btn", async function (e) {
        e.preventDefault();
        const upgradeId = $(this).data("upgrade");
        const cost = Number($(this).data("cost") || 0);
        const s = getSettings();
        if (!s.primaryHome) return;
        s.primaryHome.upgrades = s.primaryHome.upgrades || {};
        if (s.primaryHome.upgrades[upgradeId]) {
            notify?.("info", "Upgrade already active.", "Homestead Manager");
            return;
        }
        const { spendCurrency } = await import("./economy.js");
        if (!spendCurrency(s, cost)) {
            notify?.("warning", `Insufficient gold. Upgrading costs ${cost}G.`, "Homestead Manager");
            return;
        }
        s.primaryHome.upgrades[upgradeId] = true;
        saveSettings();
        notify?.("success", "Purchased homestead upgrade!", "Homestead Manager");
        renderHomesteadApp();
        
        // Re-render map details if it exists
        try {
            const mapMod = window.UIE_MapEngine || window.UIE?.map;
            if (mapMod && typeof mapMod.renderDetails === "function") mapMod.renderDetails();
        } catch (_) {}
    });

    // Contact Details Expansion Toggle
    $win.off("click.phoneContactRow", ".contact-row").on("click.phoneContactRow", ".contact-row", function(e) {
        if ($(e.target).closest(".phone-msg-trigger, .phone-call-trigger, button").length) return;
        
        const $this = $(this);
        const $exp = $this.find(".contact-details-expansion");
        const npcName = $this.data("name");
        
        if ($exp.is(":visible")) {
            $exp.slideUp(150);
            $this.removeClass("is-expanded");
        } else {
            $(".contact-details-expansion").slideUp(150);
            $(".contact-row").removeClass("is-expanded");
            
            const s = getSettings();
            const social = s.social || {};
            const buckets = ["friends", "associates", "romance", "family", "rivals"];
            let person = null;
            for (const b of buckets) {
                const arr = social[b] || [];
                person = arr.find(p => p && String(p.name).toLowerCase() === npcName.toLowerCase());
                if (person) break;
            }
            
            const affinity = person ? Number(person.affinity ?? 50) : 50;
            const mood = person ? String(person.mood || "neutral") : "neutral";
            const role = person ? String(person.role || "Contact") : "Contact";
            
            const isAtHome = s.primaryHome && s.primaryHome.name && (s.worldState?.currentLocation === s.primaryHome.name);
            
            let inviteButtonHtml = "";
            if (isAtHome) {
                if (affinity >= 30) {
                    inviteButtonHtml = `
                        <button type="button" class="phone-invite-hangout-btn" data-name="${esc(npcName)}" style="margin-top:8px; width:100%; height:30px; border-radius:6px; background:linear-gradient(135deg, #cba35c, #b58d43); border:none; color:#000; font-weight:bold; cursor:pointer; font-size:11px;">
                            <i class="fa-solid fa-house-user"></i> Invite to Hangout
                        </button>
                    `;
                } else {
                    inviteButtonHtml = `
                        <div style="margin-top:8px; font-size:11px; color:#888; text-align:center; padding:4px; background:rgba(0,0,0,0.03); border-radius:4px;">
                            <i class="fa-solid fa-lock"></i> Needs 30% affinity to invite (Current: ${affinity}%)
                        </div>
                    `;
                }
            } else if (s.primaryHome && s.primaryHome.name) {
                inviteButtonHtml = `
                    <div style="margin-top:8px; font-size:11px; color:#888; text-align:center; padding:4px; background:rgba(0,0,0,0.03); border-radius:4px;">
                        Must be at home (${s.primaryHome.name}) to invite them over.
                    </div>
                `;
            }
            
            $exp.html(`
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                    <div><strong>Affinity:</strong> ${affinity}%</div>
                    <div><strong>Mood:</strong> ${mood}</div>
                    <div><strong>Role:</strong> ${role}</div>
                </div>
                ${inviteButtonHtml}
            `);
            
            $exp.slideDown(150);
            $this.addClass("is-expanded");
        }
    });

    // NPC Hangout Click Handler
    $win.off("click.phoneInviteHangout", ".phone-invite-hangout-btn").on("click.phoneInviteHangout", ".phone-invite-hangout-btn", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const npcName = $(this).data("name");
        const s = getSettings();
        
        const social = s.social || {};
        const buckets = ["friends", "associates", "romance", "family", "rivals"];
        let foundPerson = null;
        for (const b of buckets) {
            const arr = social[b] || [];
            foundPerson = arr.find(p => p && String(p.name).toLowerCase() === npcName.toLowerCase());
            if (foundPerson) break;
        }
        if (foundPerson) {
            foundPerson.affinity = Math.min(100, (Number(foundPerson.affinity) || 50) + 10);
        }
        saveSettings();
        
        await injectRpEvent(`[System: You invited ${npcName} over to your home at ${s.primaryHome.name}. They arrived a short while later to hangout, sharing a pleasant time with you. Affinity with ${npcName} increased by +10!]`);
        
        notify?.("success", `Invited ${npcName} over to hangout!`, "Hangout");
        
        // Re-render contacts
        renderContacts();
    });

    const setCallUiState = (state) => {
        const st = String(state || "");
        const $incoming = $("#call-incoming-actions");
        const $controls = $("#call-incall-controls");
        const $inputRow = $("#uie-call-screen .call-input-row");
        const $endRow = $("#call-end-btn").closest(".call-actions");

        if ($incoming.length) {
            if (st === "incoming") $incoming.css("display", "flex");
            else $incoming.css("display", "none");
        }
        if ($controls.length) {
            if (st === "connected") $controls.show();
            else if (st === "incoming") $controls.hide();
            else $controls.show();
        }
        if ($inputRow.length) {
            if (st === "connected") $inputRow.css("display", "flex");
            else $inputRow.hide();
        }
        if ($endRow.length) {
            if (st === "incoming") $endRow.hide();
            else $endRow.show();
        }

        if (st !== "connected") {
            try { $("#call-timer-disp").text("00:00"); } catch (_) {}
        }
    };

    const setCallAvatar = (s0, name) => {
        const who = String(name || "").trim();
        const $av = $("#call-avatar-img");
        if (!$av.length) return;
        let src = "";
        try {
            for (const p of getSocialPeople(s0)) {
                if (String(p?.name || "").trim() === who) {
                    src = String(p?.avatar || p?.img || p?.image || "").trim();
                    break;
                }
            }
        } catch (_) {}

        if (src) {
            $av.html(`<img src="${esc(src)}">`);
        } else {
            const initial = who ? who.charAt(0).toUpperCase() : "?";
            $av.html(`<span style="font-weight:800; font-size:34px; opacity:0.9;">${esc(initial)}</span>`);
        }
    };

    const startCall = async (name, opts = {}) => {
        if (deviceSkinForCurrentMode(getSettings()) === "scroll" || isCodiceMode(getSettings())) return;
        try { openApp("#uie-call-screen"); } catch (_) {
            $(".phone-app-window").hide();
            $("#uie-phone-homescreen").hide();
            $("#uie-call-screen").css("display", "flex").hide().fadeIn(200);
        }
        const rawName = String(name || "").trim();
        const dir = String(opts?.dir || "out").trim() || "out";
        $("#call-name-disp").text(rawName || "Unknown");
        $(".call-status").text(dir === "in" ? "Incoming call..." : "Dialing...");
        $("#call-transcript").empty();
        try {
            const s0 = getSettings();
            if (s0?.phone) {
                if (!Array.isArray(s0.phone.callHistory)) s0.phone.callHistory = [];
                ensureNumbersState(s0);
                let number = String(opts?.number || "").trim();
                if (!number) number = lookupNumberForName(s0, rawName);
                if (!number && dir === "in") {
                    const used = new Set();
                    for (const p of getSocialPeople(s0)) {
                        const d = normalizeNumber(p?.phone || p?.phoneNumber || "");
                        if (d) used.add(d);
                    }
                    for (const nb of (s0.phone.numberBook || [])) {
                        const d = normalizeNumber(nb?.number || "");
                        if (d) used.add(d);
                    }
                    number = formatNumber(generateNumber(used));
                }
                const who = rawName || (number || "Unknown");
                s0.phone.activeCall = { who, number, dir, startedAt: Date.now(), lines: [], answered: false };
                saveSettings();
                try { setCallAvatar(s0, who); } catch (_) {}
            }
        } catch (_) {}
        if (dir === "in") syncToMainChat(`(On phone) Incoming call from ${rawName || "Unknown"}...`);
        else syncToMainChat(`(On phone) Calling ${rawName || "Unknown"}...`);

        try { callChatContext = getChatSnippet(50); } catch (_) {}

        if (dir === "in") {
            setCallUiState("incoming");
            return;
        }

        setCallUiState("dialing");

        const sAllow = getSettings();
        if (sAllow?.ai && sAllow.ai.phoneCalls === false) {
            $(".call-status").text("Calling disabled in settings");
            setTimeout(endCall, 2000);
            return;
        }

        try {
            const chat = callChatContext;
            const persona = getPersonaName();
            const card = getCharacterCardBlock(2600);
            const st = await generateContent(`
Phone Call Rules:
- Phone calls are audible to people in the room (not private like texts).
- You are a strict logic engine deciding if a call connects based on context.
- Decide if ${name} has a phone, answers, is busy, refuses, or is unreachable.
- If uncertain, set answers=false with a believable reason.
- If the user asks ${name} to come over / meet up and ${name} agrees, set arrivalInTurns to 1 or 2.
- greeting must be spoken words only: no narration, no roleplay formatting, no quotes, no speaker labels.

Return ONLY JSON:
{
  "hasPhone": true,
  "answers": true,
  "reason": "",
  "greeting": "short spoken greeting (spoken words only, one line)",
  "arrivalInTurns": 0,
  "arrivalReason": ""
}

TARGET: "${name}"
CALLER: "${persona}"
<character_card>
${card}
</character_card>
Context (recent chat, trimmed):
${chat}`.slice(0, 6000), "System Check");
            const logic = JSON.parse(cleanOutput(st, "json"));

            if (logic.hasPhone === false) {
                $(".call-status").text("No Phone");
                setTimeout(endCall, 2500);
                return;
            }
            if (logic.answers === false) {
                $(".call-status").text(logic.reason || "No Answer");
                setTimeout(endCall, 3000);
                return;
            }

            $(".call-status").text("Ringing...");
            setCallUiState("ringing");
            setTimeout(() => connectCall(String(logic.greeting || "Hello?"), Number(logic.arrivalInTurns || 0), String(logic.arrivalReason || "")), 1200);
        } catch(e) { connectCall("Hello?", 0, ""); }
    };

    try {
        window.UIE_phone_startOutboundCall = (name) => startCall(String(name || "").trim(), { dir: "out" });
    } catch (_) {}

    const connectCall = (greetingLine = "Hello?", arrivalTurns = 0, arrivalReason = "") => {
        $(".call-status").text("Connected");
        setCallUiState("connected");
        $("#call-timer-disp").text("00:00");
        let callSeconds = 0;
        if(callTimerInt) clearInterval(callTimerInt);
        callTimerInt = setInterval(() => {
            callSeconds++;
            $("#call-timer-disp").text(new Date(callSeconds * 1000).toISOString().substr(14, 5));
        }, 1000);
        const n = $("#call-name-disp").text();
        const lowerGreeting = String(greetingLine || "").toLowerCase();
        const hasInvite = /\b(come over|invite|my place|my home|my residence|my apartment|my house|meet at my)\b/.test(lowerGreeting);
        if (hasInvite) {
            setTimeout(() => {
                ensureNpcResidencePlaced(n).catch(e => console.warn("[Phone] Residence placement from call failed:", e));
            }, 100);
        }
        try {
            if (window.__uieCallMaxTimer) {
                clearTimeout(window.__uieCallMaxTimer);
                window.__uieCallMaxTimer = null;
            }
            const maxMs = computeMaxCallDurationMs(String(n || "").trim());
            window.__uieCallMaxTimer = setTimeout(() => {
                try {
                    $(".call-status").text("Time limit");
                } catch (_) {}
                try {
                    endCall();
                } catch (_) {}
            }, maxMs);
        } catch (_) {}
        const glRaw = sanitizePhoneLine(cleanOutput(greetingLine, "chat"), 240);
        if (glRaw) {
            $("#call-transcript").append(`<div style="text-align:left;color:#ccc;margin:5px;">${n}: ${glRaw}</div>`);
        }
        try {
            const s0 = getSettings();
            if (s0?.phone?.activeCall && typeof s0.phone.activeCall === "object") {
                if (!Array.isArray(s0.phone.activeCall.lines)) s0.phone.activeCall.lines = [];
                if (glRaw) s0.phone.activeCall.lines.push({ who: String(n || ""), isUser: false, text: glRaw.slice(0, 320), ts: Date.now() });
                s0.phone.activeCall.answered = true;
                saveSettings();
            }
        } catch (_) {}
        injectRpEvent(`(On phone) Connected with ${n}.`, { uie: { type: "phone_call", who: n } });
        if (arrivalTurns > 0) scheduleArrival(n, arrivalTurns, arrivalReason || "They agreed to come over.");
    };

    const endCall = () => {
        try {
            if (window.__uieCallMaxTimer) {
                clearTimeout(window.__uieCallMaxTimer);
                window.__uieCallMaxTimer = null;
            }
        } catch (_) {}
        clearInterval(callTimerInt);
        $("#uie-call-screen").fadeOut(200, () => goHome());
        try {
            const s0 = getSettings();
            if (s0?.phone) {
                if (!Array.isArray(s0.phone.callHistory)) s0.phone.callHistory = [];
                const ac = s0.phone.activeCall && typeof s0.phone.activeCall === "object" ? s0.phone.activeCall : null;
                const who = String(ac?.who || $("#call-name-disp").text() || "").trim() || "Unknown";
                const number = String(ac?.number || lookupNumberForName(s0, who) || "").trim();
                const lines = Array.isArray(ac?.lines) ? ac.lines : [];
                const tail = lines.slice(-12).map(x => ({ who: String(x?.who || who), isUser: !!x?.isUser, text: String(x?.text || "").slice(0, 320), ts: Number(x?.ts || 0) || Date.now() }));
                const startedAt = Number(ac?.startedAt || 0) || Date.now();
                const endedAt = Date.now();
                s0.phone.callHistory.push({ who, startedAt, endedAt, lines: tail });
                while (s0.phone.callHistory.length > 30) s0.phone.callHistory.shift();
                ensureNumbersState(s0);
                pushCallLog({ who, number, dir: String(ac?.dir || "out"), startedAt, endedAt, missed: ac?.answered !== true });
                s0.phone.activeCall = null;
                saveSettings();
            }
        } catch (_) {}
        syncToMainChat(`hung up the phone.`);
        callChatContext = "";
    };

    window.UIE_phone_incomingCall = (from) => {
        try {
            const s = getSettings();
            if (s?.phone && s.phone.allowCalls === false) return;
            if (deviceSkinForCurrentMode(s) === "scroll" || isCodiceMode(s)) return;
            activeContact = ensureInboundContact(s, cleanIncomingWho(from) || "Unknown");
            try {
                s.phone = s.phone || {};
                const key = String(activeContact || "")
                    .trim()
                    .toLowerCase();
                if (key) {
                    const now = Date.now();
                    const prev = s.phone._inboundRingByContact?.[key] || { n: 0, windowStart: now };
                    const winMs = 45 * 60 * 1000;
                    const ring = now - Number(prev.windowStart || 0) > winMs ? { n: 0, windowStart: now } : prev;
                    ring.n = Number(ring.n || 0) + 1;
                    ring.windowStart = ring.windowStart || now;
                    s.phone._inboundRingByContact = s.phone._inboundRingByContact || {};
                    s.phone._inboundRingByContact[key] = ring;
                    const aff = getAffinityForContactName(activeContact);
                    const maxRings = 2 + Math.min(5, Math.floor(aff / 18));
                    if (ring.n > maxRings) {
                        try {
                            notify("info", `${activeContact} sent a short voicemail instead (busy).`, "Phone", "phoneCalls");
                        } catch (_) {}
                        saveSettings();
                        return;
                    }
                }
            } catch (_) {}
            saveSettings();
            bumpUnread("call", activeContact, "");
            showInboundBanner("call", activeContact, "");
            if (typeof window.UIE_forceOpenWindow === "function") {
                window.UIE_forceOpenWindow("#uie-phone-window", "./phone.js", "initPhone");
            }
            {
                const $p = $("#uie-phone-window");
                const wasVisible = $p.is(":visible");
                $p.show().css("display", "flex");
                if (!wasVisible) {
                    try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
                }
            }
            if (window.toastr) toastr.info("Call incoming", "Phone");
            startCall(activeContact, { dir: "in" });
        } catch (e) { console.warn("[UIE] Incoming call handler failed:", e); }
    };

async function ensureNpcResidencePlaced(npcName) {
    if (!npcName) return;
    const cleanName = String(npcName).trim();
    if (cleanName.toLowerCase() === "unknown" || cleanName.toLowerCase() === "someone") return;
    const residenceName = `${cleanName}'s Residence`;
    
    let mapModule;
    try {
        mapModule = await import("./map.js");
    } catch (e) {
        console.warn("[Phone] Could not import map.js:", e);
        return;
    }
    
    const existing = mapModule.getNodeByName(residenceName);
    if (existing) return;
    
    const ping = {
        newLocation: residenceName,
        type: "interior",
        scope: "vicinity",
        relationship: "adjacent",
        direction: "unknown",
        faction: "Civilians",
        theme: "Residential Home",
        description: `Cozy private residence belonging to ${cleanName}. They invited you over.`
    };
    
    const node = await mapModule.addOrganicLocation(ping);
    if (node) {
        notify("success", `New address received: ${residenceName} placed on your map!`, "Map", "phoneMessages");
    }
}

    window.UIE_phone_incomingText = (from, body) => {
        try {
            const s = getSettings();
            if (s?.phone && s.phone.allowTexts === false) return;
            const name = ensureInboundContact(s, cleanIncomingWho(from) || "Unknown") || "Unknown";
            const msg = sanitizePhoneLine(String(body || ""), 1200);
            if (!msg) return;

            const lowerMsg = msg.toLowerCase();
            const hasInvite = /\b(come over|invite|my place|my home|my residence|my apartment|my house|meet at my)\b/.test(lowerMsg);
            if (hasInvite) {
                setTimeout(() => {
                    ensureNpcResidencePlaced(name).catch(e => console.warn("[Phone] Residence placement failed:", e));
                }, 100);
            }

            if (isCodiceMode(s)) {
                if (!s.relationships || typeof s.relationships !== "object") s.relationships = {};
                if (!Array.isArray(s.relationships.messages)) s.relationships.messages = [];
                const now = Date.now();
                s.relationships.messages.push({
                    id: `letter_in_${now}_${Math.random().toString(36).slice(2, 7)}`,
                    direction: "inbound",
                    from: name,
                    to: "player",
                    targetNpcId: name,
                    body: msg.slice(0, 1200),
                    sentAt: now,
                    deliveredAt: now,
                    transport: "courier",
                });
                saveSettings();
                bumpUnread("text", name, msg);
                showInboundBanner("letter", name, msg);
                if ($("#uie-phone-window").is(":visible")) {
                    activeContact = resolveContactName(s, name);
                    if ($("#uie-app-msg-view").is(":visible")) renderMessages();
                }
                notify("success", `A sealed letter from ${name} arrived.`, "Codice", "phoneMessages");
                const persona = getPersonaName();
                injectRpEvent(`(Letter) ${name} sends a sealed letter to ${persona}: "${msg.slice(0, 500)}"`, { uie: { type: "codice_letter", who: name } });
                try {
                    const sMem = getSettings();
                    pushPhoneMemory(sMem, { kind: "inbound_letter", text: `Letter from ${name}: ${msg.slice(0, 500)}` });
                    saveSettings(sMem);
                } catch (_) {}
                try { relayRelationship(name, msg, "letter"); } catch (_) {}
                return;
            }
            const th = getThread(name);
            th.list.push({ isUser: false, text: msg.slice(0, 1200), ts: Date.now() });
            saveSettings();
            bumpUnread("text", name, msg);
            showInboundBanner("text", name, msg);
            if ($("#uie-phone-window").is(":visible")) {
                activeContact = resolveContactName(s, name);
                if ($("#uie-app-msg-view").is(":visible")) renderMessages();
            }
            if (window.toastr) toastr.success("New message", "Phone");
            const persona = getPersonaName();
            injectRpEvent(`(Text) ${name} → ${persona}: "${msg.slice(0, 500)}"`, { uie: { type: "phone_text", who: name } });
            try {
                pushPhoneMemory(s, { kind: "inbound_text", text: `Text ← ${name}: ${msg.slice(0, 500)}` });
                saveSettings();
            } catch (_) {}
            try { relayRelationship(name, msg, "text"); } catch (_) {}
        } catch (e) { console.warn("[UIE] Incoming text handler failed:", e); }
    };

    $win.off("click.phoneCallAccept", "#call-accept-btn").on("click.phoneCallAccept", "#call-accept-btn", (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const who = String($("#call-name-disp").text() || "").trim() || "Unknown";
        connectCall("");
        try { handleCallReply("", who, true); } catch (_) {}
    });

    $win.off("click.phoneCallDecline", "#call-decline-btn").on("click.phoneCallDecline", "#call-decline-btn", (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        $(".call-status").text("Declined");
        setTimeout(endCall, 250);
    });

    $win.off("click.phoneCallTranscript", "#call-transcript-btn").on("click.phoneCallTranscript", "#call-transcript-btn", (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const $t = $("#call-transcript");
        if (!$t.length) return;
        $t.toggle();
    });

    $win.off("click.phoneCallNoop", "#call-mute-btn, #call-speaker-btn, #call-keypad-btn, #call-add-btn, #call-notes-btn")
        .on("click.phoneCallNoop", "#call-mute-btn, #call-speaker-btn, #call-keypad-btn, #call-add-btn, #call-notes-btn", (e) => {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            try { window.toastr?.info?.("Control not implemented yet.", "Phone"); } catch (_) {}
        });

    $win.off("click.phoneCallEnd", "#call-end-btn").on("click.phoneCallEnd", "#call-end-btn", endCall);
    $win.off("click.phoneCallSpeak", "#call-speak-btn").on("click.phoneCallSpeak", "#call-speak-btn", () => {
        const t = $("#call-input").val().trim();
        if(!t) return;
        $("#call-transcript").append(`<div style="text-align:right;color:white;margin:5px;">${t}</div>`);
        $("#call-input").val("");
        try {
            const s0 = getSettings();
            const who = String($("#call-name-disp").text() || "").trim() || "Unknown";
            if (s0?.phone) {
                if (!Array.isArray(s0.phone.callHistory)) s0.phone.callHistory = [];
                if (!s0.phone.activeCall || typeof s0.phone.activeCall !== "object") s0.phone.activeCall = { who, startedAt: Date.now(), lines: [] };
                if (!Array.isArray(s0.phone.activeCall.lines)) s0.phone.activeCall.lines = [];
                s0.phone.activeCall.lines.push({ who, isUser: true, text: String(t || "").slice(0, 320), ts: Date.now() });
                saveSettings();
            }
        } catch (_) {}
        injectRpEvent(`(On phone) You: "${t}"`, { uie: { type: "phone_call_line", who: $("#call-name-disp").text() } });
        try { relayRelationship($("#call-name-disp").text(), t, "phone_call"); } catch (_) {}
        handleCallReply(t, $("#call-name-disp").text());
    });

    const handleCallReply = async (t, n, greeting=false) => {
        const s = getSettings();
        if (s?.ai && s.ai.phoneCalls === false) return;
        const mainCtx = getMainChatContext(50);
        const chat = callChatContext || getChatSnippet(50);
        const lore = (() => { try { const ctx = getContext?.(); const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo; const keys=[]; if(Array.isArray(maybe)){ for(const it of maybe){ const k=it?.key||it?.name||it?.title; if(k) keys.push(String(k)); } } return Array.from(new Set(keys)).slice(0, 60).join(", "); } catch(_) { return ""; } })();
        const character = (() => { try { const ctx = getContext?.(); return JSON.stringify({ user: ctx?.name1, character: ctx?.name2, chatId: ctx?.chatId, characterId: ctx?.characterId, groupId: ctx?.groupId }); } catch(_) { return "{}"; } })();
        const card = getCharacterCardBlock(2600);
        const persona = getPersonaName();
        const mem = getSocialMemoryBlockForName(n, 8);
        const transcript = $("#call-transcript").text().slice(0, 1200);
        const rules = [
            `You are ${n} speaking on a phone call with ${persona}.`,
            "STRICT FORMAT RULES (follow exactly):",
            "- Output ONLY the words spoken (dialogue only).",
            "- ONE line, 1–2 sentences max.",
            "- No narration, no actions, no stage directions.",
            "- No quotes, no markdown.",
            `- Do NOT include speaker labels like "${n}:" or "${persona}:".`,
            "- Do NOT use asterisks, brackets, or parentheses.",
            "",
        ].join("\n");
        const p = greeting ?
             `${mainCtx ? `${mainCtx}\n\nThe user is calling you based on this recent context. React naturally.\n\n` : ""}${rules}You just answered. Say a natural greeting.\n\nRecent call transcript:\n${transcript}\n\nContext:\n${chat}`
            : `${mainCtx ? `${mainCtx}\n\nThe user is calling you based on this recent context. React naturally.\n\n` : ""}${rules}${persona} just said: ${t}\n\nRecent call transcript:\n${transcript}\n\n<character check>\n${character}\n</character check>\n<lore check>\n${lore}\n</lore check>\nContext:\n${chat}`;
        const p2 = `${p}\n\n<character_card>\n${card}\n</character_card>\n${mem}`.slice(0, 7000);
        const r = await generateContent(p2, "System Check");
        if(r) {
            const line = sanitizePhoneLine(cleanOutput(r, "chat"), 320);
            if (!line) return;
            $("#call-transcript").append(`<div style="text-align:left;color:#ccc;margin:5px;">${n}: ${line}</div>`);
            try {
                const s0 = getSettings();
                if (s0?.phone?.activeCall && typeof s0.phone.activeCall === "object") {
                    if (!Array.isArray(s0.phone.activeCall.lines)) s0.phone.activeCall.lines = [];
                    s0.phone.activeCall.lines.push({ who: String(n || ""), isUser: false, text: String(line || "").slice(0, 320), ts: Date.now() });
                    saveSettings();
                }
            } catch (_) {}
            injectRpEvent(`(On phone) ${n}: "${line}"`, { uie: { type: "phone_call_line", who: n } });
            try { relayRelationship(n, line, "phone_call"); } catch (_) {}
        }
    };

    // --- STANDARD BINDINGS ---
    $(document).off("click.phoneInbound", "#uie-phone-inbound-indicator").on("click.phoneInbound", "#uie-phone-inbound-indicator", function() {
        const s = getSettings();
        ensureUnreadState(s);
        const $p = $("#uie-phone-window");
        const wasVisible = $p.is(":visible");
        $p.show().css("display", "flex");
        if (!wasVisible) {
            try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
        }
        if (!isCodiceMode(s) && Number(s.phone.unreadCallCount || 0) > 0) openApp("#uie-app-dial-view");
        else openApp("#uie-app-msg-view");
    });
    $(document).off("click.phoneInbound", "#uie-phone-inbound-indicator").on("click.phoneInbound", "#uie-phone-inbound-indicator", () => {
        const s = getSettings();
        ensureUnreadState(s);
        const $p = $("#uie-phone-window");
        const wasVisible = $p.is(":visible");
        $p.show().css("display", "flex");
        if (!wasVisible) {
            try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
        }
        if (!isCodiceMode(s) && Number(s.phone.unreadCallCount || 0) > 0) openApp("#uie-app-dial-view");
        else openApp("#uie-app-msg-view");
    });
    $(document)
        .off("click.phoneInboundIndicator", "#uie-phone-inbound-indicator")
        .on("click.phoneInboundIndicator", "#uie-phone-inbound-indicator", function(e){
            e.preventDefault();
            e.stopPropagation();
            const s = getSettings();
            ensureUnreadState(s);
            const $p = $("#uie-phone-window");
            const wasVisible = $p.is(":visible");
            $p.show().css("display", "flex");
            if (!wasVisible) {
                try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
            }
            if (!isCodiceMode(s) && Number(s?.phone?.unreadCallCount || 0) > 0) openApp("#uie-app-dial-view");
            else openApp("#uie-app-msg-view");
        });

    $win.on("click.phone", "#app-store", () => openApp("#uie-app-store-view"));
    $win.on("click.phone", "#app-settings", () => openApp("#uie-app-settings-view"));
    $win.on("click.phone", "#app-contacts", () => openApp("#uie-app-contacts-view"));
    $win.on("click.phone", "#dock-btn-phone", () => { openApp("#uie-app-dial-view"); try { $("#dial-display").text(dialBuf || "—"); } catch (_) {} });
    $win.on("click.phone", "#app-msg, #dock-btn-msg", () => openApp("#uie-app-msg-view"));
    $win.on("click.phone", "#app-browser, #dock-btn-browser", () => openApp("#uie-app-browser-view"));
    $win.on("click.phone", "#app-calc", () => openApp("#uie-app-calc-view"));
    $win.on("click.phone", "#app-cookies", () => openApp("#uie-app-cookies-view"));
    $win.on("click.phone", "#app-travel", () => openApp("#uie-app-travel-view"));
    $win.on("click.phone", "#app-bank", () => openApp("#uie-app-bank-view"));
    $win.on("click.phone", "#app-bills", () => openApp("#uie-app-bills-view"));
    $win.on("click.phone", "#app-homestead", () => openApp("#uie-app-homestead-view"));
    $win.on("click.phone", "#app-cardforge", () => {
        openApp("#uie-app-cardforge-view");
        try { credentialForgeUI?.open(); } catch (_) {}
    });
    $win.on("click.phone", "#app-memories", () => {
        try { renderPhoneMemories(); } catch (_) {}
        openApp("#uie-app-memories-view");
    });
    $win.on("click.phone", "#app-social", () => {
        const skin = String(getSettings()?.phone?.deviceSkin || "");
        if (skin === "scroll" || isCodiceMode(getSettings())) return;
        openApp("#uie-app-social-view");
    });
    $win.off("click.instavibeEnable", "#instavibe-enable-btn").on("click.instavibeEnable", "#instavibe-enable-btn", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await syncInstavibeSetting(true);
        setInstavibeOnboardingStage(2);
        renderSocialApp();
    });
    $win.off("click.instavibeLater", "#instavibe-later-btn").on("click.instavibeLater", "#instavibe-later-btn", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await syncInstavibeSetting(false);
        $("#instavibe-onboarding").hide();
        renderSocialApp();
    });
    $win.off("click.instavibeOk", "#instavibe-ok-btn").on("click.instavibeOk", "#instavibe-ok-btn", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#instavibe-onboarding").hide();
    });
    $win.off("click.ivTab", ".iv-tab").on("click.ivTab", ".iv-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const tab = String($(this).data("iv-tab") || "home");
        _ivSwitchTab(tab);
    });
    $win.off("click.ivTagPill", "[data-iv-tag]").on("click.ivTagPill", "[data-iv-tag]", function(e) {
        e.preventDefault();
        e.stopPropagation();
        _ivComposerTag = String($(this).data("iv-tag"));
        _ivRenderComposerPills();
    });
    $win.off("click.ivTonePill", "[data-iv-tone]").on("click.ivTonePill", "[data-iv-tone]", function(e) {
        e.preventDefault();
        e.stopPropagation();
        _ivComposerTone = String($(this).data("iv-tone"));
        _ivRenderComposerPills();
    });
    $win.off("click.ivTrendPill", "[data-iv-trend]").on("click.ivTrendPill", "[data-iv-trend]", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const trend = String($(this).data("iv-trend"));
        _ivActiveTrend = _ivActiveTrend === trend ? "" : trend;
        _ivSwitchTab("home");
        _ivRenderFilteredFeed();
    });
    $win.off("input.ivSearch", "#iv-search-input").on("input.ivSearch", "#iv-search-input", function() {
        _ivSearchQuery = String($(this).val() || "");
        if (_ivActiveTab === "home") _ivRenderFilteredFeed();
    });
    $win.off("click.ivNpcBack", "#iv-npc-back").on("click.ivNpcBack", "#iv-npc-back", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#iv-npc-overlay").removeClass("is-open");
    });
    $win.off("change.instavibeSetting", "#p-instavibe-enabled").on("change.instavibeSetting", "#p-instavibe-enabled", async function() {
        await syncInstavibeSetting($(this).is(":checked"));
    });
    $win.off("submit.phoneSocial", "#social-post-form").on("submit.phoneSocial", "#social-post-form", async (e) => {
        e.preventDefault();
        const $input = $("#social-post-input");
        const val = $input.val();
        if (!val.trim()) return;
        const persona = String(_ivProfile().username || getPersonaName() || "Player").trim() || "Player";
        try {
            await window.UIE_BACKEND_BRIDGE.createSocialPost(persona, val, _ivComposerTag, _ivComposerTone, _ivExtractMentions(val));
            $input.val("");
            _ivComposerTag = "Cozy";
            _ivComposerTone = "Neutral";
            await _ivRenderHomeFeed();
            notify("success", "Status posted on Instavibe.", "Instavibe");
        } catch (_) {
            notify("error", "Could not publish post.");
        }
    });
    $win.off("click.ivImageHelp", "#iv-post-image-help").on("click.ivImageHelp", "#iv-post-image-help", () => {
        notify("info", "Post the caption first. Instavibe queues an image from its caption and current world context.", "Instavibe");
    });
    $win.off("click.phoneMemDb", "#phone-open-databank").on("click.phoneMemDb", "#phone-open-databank", async () => {
        try {
            const mod = await import("./databank.js");
            if (typeof mod.initDatabank === "function") await mod.initDatabank();
            $("#uie-databank-window").css("display", "flex");
        } catch (e) {
            try {
                notify("error", String(e?.message || e), "Databank");
            } catch (_) {}
        }
    });

    const setDialDisplay = () => {
        try { $("#dial-display").text(dialBuf ? dialBuf : "—"); } catch (_) {}
    };

    $win.off("click.phoneDialBtn", "#uie-app-dial-view .dial-btn").on("click.phoneDialBtn", "#uie-app-dial-view .dial-btn", function(e){
        e.preventDefault();
        e.stopPropagation();
        const d = String($(this).data("digit") ?? "");
        if (!d) return;
        if (dialBuf.length >= 24) return;
        dialBuf += d;
        setDialDisplay();
    });
    $win.off("click.phoneDialDel", "#dial-backspace").on("click.phoneDialDel", "#dial-backspace", function(e){
        e.preventDefault();
        e.stopPropagation();
        dialBuf = dialBuf.slice(0, -1);
        setDialDisplay();
    });
    $win.off("click.phoneDialCall", "#dial-call").on("click.phoneDialCall", "#dial-call", function(e){
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureContactNumbers(s);
        const digits = normalizeNumber(dialBuf);
        if (!digits) return;
        const people = getSocialPeople(s);
        const hit = people.find(p => normalizeNumber(p?.phone || p?.phoneNumber || "") === digits);
        const nb = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const hit2 = nb.find(x => normalizeNumber(x?.number || "") === digits);
        const target = String(hit?.name || hit2?.name || formatNumber(digits) || "Unknown");
        dialBuf = "";
        setDialDisplay();
        startCall(target, { dir: "out", number: formatNumber(digits) });
    });
    $win.off("click.phoneDialSave", "#dial-save").on("click.phoneDialSave", "#dial-save", function(e){
        e.preventDefault();
        e.stopPropagation();
        const digits = normalizeNumber(dialBuf);
        if (!digits) return;
        const name = (prompt("Save number as:") || "").trim();
        if (!name) return;
        const s = getSettings();
        ensureNumbersState(s);
        const formatted = formatNumber(digits);
        s.phone.numberBook = (s.phone.numberBook || []).filter(x => normalizeNumber(x?.number || "") !== digits);
        s.phone.numberBook.push({ name: name.slice(0, 60), number: formatted, ts: Date.now() });
        saveSettings();
        notify("success", `Saved ${name}`, "Cookies", "phoneMessages");
    });

    const smartBack = (srcEl) => {
        const isMsg = $("#uie-app-msg-view").is(":visible");
        if (isMsg && activeContact) {
            activeContact = null;
            $("#msg-contact-name").text("Messages");
            renderMessages();
            return;
        }
        goHome();
    };

    $win
        .off("click.phoneBack", ".phone-back-btn, #p-browser-home")
        .on("click.phoneBack", ".phone-back-btn, #p-browser-home", function(e){
            e.preventDefault();
            e.stopPropagation();
            smartBack(this);
        });

    $win.off("change.phoneTravelQuote", "#travel-mode, #travel-destination, #travel-rideshare-class")
        .on("change.phoneTravelQuote", "#travel-mode", function() {
            renderTravelApp(String($(this).val() || ""));
        })
        .on("change.phoneTravelQuote", "#travel-destination, #travel-rideshare-class", function() {
            updatePhoneTravelQuote(ensurePhoneEconomyState(getSettings()));
        });

    const bookSelectedPhoneRoute = async ({ rideshare = false } = {}) => {
        const s = ensurePhoneEconomyState(getSettings());
        const route = selectedPhoneTravelRoute();
        if (!route) {
            notify("warning", "Choose an available mapped route first.", "Transit");
            return false;
        }
        const travelModule = await import("./travelBridge.js");
        let multiplier = 1;
        let serviceClass = "";
        if (rideshare || route.mode === "rideshare") {
            const option = document.querySelector("#travel-rideshare-class option:checked");
            multiplier = Math.max(1, Number(option?.dataset?.multiplier || 1));
            serviceClass = String(option?.value || "standard");
        }
        let passResult = null;
        if (route.passApplies && route.passCredentialId) {
            passResult = useCredential(s, route.passCredentialId, {
                id: route.id,
                action: "transit_boarding",
                locationId: route.fromId || route.from,
                currentHolderId: "player",
                scannerStrength: 55,
            });
            if (!passResult.accepted) {
                notify("warning", `Transit credential ${String(passResult.reason || "rejected").replace(/_/g, " ")}; fare will be charged.`, "Transit");
            }
        }
        const fareOverride = route.passApplies && passResult?.accepted ? 0 : undefined;
        const ok = await travelModule.bookTransitRoute(route.mode, route.id, { fareOverride, fareMultiplier: multiplier, serviceClass });
        if (!ok) {
            renderTravelApp(route.mode);
            return false;
        }
        const fare = fareOverride === 0 ? 0 : Math.round(Number(route.fare || 0) * multiplier);
        const label = TRANSIT_MODES[route.mode]?.label || route.mode;
        pushPhoneMemory(s, { kind: "travel", text: `Booked ${serviceClass ? `${serviceClass} ` : ""}${label} from ${route.from} to ${route.to} for ${fare} ${s.currencySymbol || "G"}.` });
        s.phone.travel.history.unshift({ destination: route.to, mode: route.mode, fare, status: "departed", t: Date.now() });
        s.phone.travel.history = s.phone.travel.history.slice(0, 50);
        saveSettings();
        try { injectRpEvent(`(Travel) Boarded ${label} from ${route.from} to ${route.to}.`, { uie: { type: "travel_departure", destination: route.to, mode: route.mode } }); } catch (_) {}
        $("#uie-phone-window").hide();
        return true;
    };

    $win.off("click.phoneTravelPay", "#travel-pay-go").on("click.phoneTravelPay", "#travel-pay-go", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        await bookSelectedPhoneRoute();
    });

    $win.off("click.phoneRideshare", "#travel-rideshare-dispatch").on("click.phoneRideshare", "#travel-rideshare-dispatch", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const route = selectedPhoneTravelRoute();
        if (!route) return;
        const serviceClass = String($("#travel-rideshare-class").val() || "standard");
        const drivers = ["Mara", "Jules", "Ren", "Sora", "Avery", "Niko"];
        const driver = drivers[(parseInt(transitId(route.id).slice(-2), 36) || 0) % drivers.length];
        $("#travel-rideshare-status").text(`${driver} accepted your ${serviceClass} pickup. Confirming route…`);
        $(this).prop("disabled", true);
        setTimeout(() => void bookSelectedPhoneRoute({ rideshare: true }), 650);
    });

    $win.off("click.phoneTravelHub", "#travel-open-hub").on("click.phoneTravelHub", "#travel-open-hub", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const mod = await import("./travelBridge.js");
        await mod.openTransitHub();
    });

    $win.off("click.phoneBankLogin", "#bank-login").on("click.phoneBankLogin", "#bank-login", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = ensurePhoneEconomyState(getSettings());
        const name = String($("#bank-username").val() || "").trim() || getPersonaName();
        s.phone.bank.username = name;
        s.phone.bank.loggedIn = true;
        if (!s.phone.bank.createdAt) s.phone.bank.createdAt = Date.now();
        syncAutomaticCredentials(s);
        saveSettings();
        renderBankApp();
    });

    $win.off("click.phoneBankTransfer", "#bank-to-savings, #bank-to-checking").on("click.phoneBankTransfer", "#bank-to-savings, #bank-to-checking", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = ensurePhoneEconomyState(getSettings());
        const amount = Math.max(0, Math.round(Number($("#bank-amount").val() || 0)));
        if (!amount) return;
        const toSavings = this.id === "bank-to-savings";
        if (toSavings) {
            if (Number(s.currency || 0) < amount) {
                notify("warning", "Insufficient checking funds.", "Universal Bank", "currency");
                return;
            }
            s.currency = Math.max(0, Number(s.currency || 0) - amount);
            s.phone.bank.savings = Math.max(0, Number(s.phone.bank.savings || 0) + amount);
            s.phone.bank.history.unshift({ title: "Moved to savings", amount, t: Date.now() });
        } else {
            if (Number(s.phone.bank.savings || 0) < amount) {
                notify("warning", "Insufficient savings funds.", "Universal Bank", "currency");
                return;
            }
            s.phone.bank.savings = Math.max(0, Number(s.phone.bank.savings || 0) - amount);
            s.currency = Math.max(0, Number(s.currency || 0) + amount);
            s.phone.bank.history.unshift({ title: "Moved to checking", amount, t: Date.now() });
        }
        s.phone.bank.history = s.phone.bank.history.slice(0, 60);
        ensurePhoneEconomyState(s);
        saveSettings();
        renderBankApp();
        renderTravelApp();
    });

    $win.off("click.phoneBankSend", "#bank-send").on("click.phoneBankSend", "#bank-send", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = ensurePhoneEconomyState(getSettings());
        const amount = Math.max(0, Math.round(Number($("#bank-send-amount").val() || 0)));
        const name = String($("#bank-contact").val() || "").trim();
        if (!amount || !name) return;
        if (Number(s.currency || 0) < amount) {
            notify("warning", "Insufficient checking funds.", "Universal Bank", "currency");
            return;
        }
        const contact = getPhoneSocialContacts(s).find(c => c.name.toLowerCase() === name.toLowerCase());
        if (!contact) return;
        s.currency = Math.max(0, Number(s.currency || 0) - amount);
        contact.person.currency = Math.max(0, Number(contact.person.currency || 0) + amount);
        s.phone.bank.history.unshift({ title: `Sent to ${name}`, amount, t: Date.now() });
        s.phone.bank.history = s.phone.bank.history.slice(0, 60);
        pushPhoneMemory(s, { kind: "bank_transfer", text: `Sent ${amount} ${s.currencySymbol || "G"} to ${name}.` });
        ensurePhoneEconomyState(s);
        saveSettings();
        try { injectRpEvent(`(Universal Bank) Sent ${amount} ${s.currencySymbol || "G"} to ${name}.`, { uie: { type: "bank_transfer", who: name } }); } catch (_) {}
        notify("success", `Sent ${formatPhoneCurrency(amount, s)} to ${name}.`, "Universal Bank", "currency");
        renderBankApp();
        renderTravelApp();
    });

    $win.off("click.payBill", ".pay-bill-btn").on("click.payBill", ".pay-bill-btn", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const billId = $(this).data("bill-id");
        if (!billId) return;
        const { payBill } = await import("./taxJailManager.js");
        const res = payBill(billId);
        if (res && !res.ok) {
            notify("warning", res.reason, "Universal Bank", "currency");
        } else {
            renderBankApp();
        }
    });
    $win.on("click.phone", "#uie-phone-close", () => {
        const $p = $("#uie-phone-window");
        const wasVisible = $p.is(":visible");
        const closeNow = () => {
            $p.removeClass("is-rolling").hide();
            renderPhoneReceiveIndicators();
            if (wasVisible) {
                try { window.UIE_navPop?.(); } catch (_) {}
            }
        };
        if ($p.attr("data-codice") === "true" || $p.attr("data-device") === "scroll") {
            $p.addClass("is-rolling");
            window.setTimeout(closeNow, 260);
        } else {
            closeNow();
        }
    });

    $win.on("click.phone", "#uie-phone-lock-btn", () => {
        if (isCodiceMode(getSettings())) {
            goHome();
            return;
        }
        $(".phone-app-window").hide();
        $("#uie-phone-homescreen").hide();
        $("#uie-phone-lockscreen").css("display", "flex");
        $("#uie-phone-pin").val("");
    });

    $win.on("click.phone", "#uie-phone-unlock-btn", (e) => {
        e.preventDefault();
        const s = getSettings();
        const storedPin = s.phone ? s.phone.pin : "";
        const enteredPin = $("#uie-phone-pin").val();
        if (storedPin && storedPin !== "" && enteredPin !== storedPin) {
            $("#uie-lock-msg").text("Incorrect PIN");
            return;
        }
        $("#uie-lock-msg").text("");
        $("#uie-phone-lockscreen").fadeOut(200, () => goHome());
    });

    const browserRender = (key) => {
        const s = getSettings();
        if(!s || !s.phone || !s.phone.browser) return;
        const html0 = s.phone.browser.pages[key] || "";
        const html = enforceBrowserSchema(cleanOutput(html0, "web"), key, "Cached strict page");
        $("#p-browser-content").html(html || '<div style="text-align:center;margin-top:50px; opacity:0.7;">No cached page.</div>');
        $("#p-browser-url").val(key);
        try { applyI18n(document.getElementById("p-browser-content")); } catch (_) {}
    };

    let calcExpr = "0";
    const calcSet = (v) => {
        calcExpr = String(v || "0");
        if (!calcExpr.trim()) calcExpr = "0";
        $("#calc-display").text(calcExpr);
    };
    const calcAppend = (ch) => {
        const s = String(ch);
        if (calcExpr === "0" && /[0-9.]/.test(s)) calcExpr = "";
        calcExpr += s;
        $("#calc-display").text(calcExpr);
    };
    const calcBack = () => {
        calcExpr = calcExpr.slice(0, -1);
        if (!calcExpr) calcExpr = "0";
        $("#calc-display").text(calcExpr);
    };
    const calcPercent = () => {
        const m = calcExpr.match(/(-?\d+(\.\d+)?)\s*$/);
        if (!m) return;
        const n = Number(m[1]);
        if (!Number.isFinite(n)) return;
        calcExpr = calcExpr.slice(0, m.index) + String(n / 100);
        $("#calc-display").text(calcExpr);
    };
    const calcEval = () => {
        const expr = String(calcExpr || "").replace(/×/g, "*").replace(/÷/g, "/");
        if (!/^[0-9+\-*/().\s]+$/.test(expr)) return;
        try {
            const out = Function(`"use strict"; return (${expr});`)();
            if (Number.isFinite(out)) calcSet(String(out));
        } catch (_) {}
    };

    const buildStrictBrowserPrompt = (topic) => {
        const t = String(topic || "").trim() || "Homepage";
        return [
            `Create a mobile webpage about "${t}".`,
            "OUTPUT FORMAT (strict): return ONLY raw HTML fragment (no markdown, no code fences).",
            "HARD RULES:",
            "- NO roleplay prose, narration, stage directions, or action blocks (*smiles*, [sighs], etc.). Output ONLY UI content.",
            "- REQUIRED: Include a navigation section with links: Home (href='#home'), Sign In (href='#signin'), Shop (href='#shop'), Profile (href='#profile').",
            "- Use only inline CSS and semantic blocks (div, section, header, h1-h3, p, ul/li, a, button-looking divs).",
            "- Keep content concise and readable on a narrow phone screen.",
            "- Include exactly these structure IDs once each: browser-title, browser-summary, browser-content.",
            "- browser-title must be a heading, browser-summary a short paragraph, browser-content a container with at least 2 cards/sections.",
            "- Never output plain text only; always output valid HTML.",
        ].join("\n");
    };

    const stripRpProseFromHtml = (html) => {
        let s = String(html || "");
        s = s.replace(/\*[^*]{0,200}\*/g, " ");
        s = s.replace(/\([^)]*narrat[^)]*\)/gi, " ");
        s = s.replace(/\([^)]*stage\s*direction[^)]*\)/gi, " ");
        s = s.replace(/\s{2,}/g, " ");
        return s.trim();
    };

    const buildBrowserFallbackHtml = (topic, reason) => {
        const title = esc(String(topic || "Untitled Page").slice(0, 120));
        const why = esc(String(reason || "Generator unavailable").slice(0, 180));
        return `<div style="padding:14px; color:#222; font-family:Arial,sans-serif; line-height:1.4;">
            <div style="font-size:20px; font-weight:900; margin-bottom:10px;">${title}</div>
            <div style="padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:12px; background:#f8fafc; margin-bottom:10px;">
                <div style="font-weight:700; margin-bottom:6px;">Page Summary</div>
                <div style="opacity:0.85;">This page was generated in strict safe mode.</div>
            </div>
            <div style="padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:12px; background:#ffffff;">
                <div style="font-weight:700; margin-bottom:6px;">Status</div>
                <div style="opacity:0.85;">${why}</div>
            </div>
        </div>`;
    };

    const ensureBrowserHtml = (raw, topic, reason) => {
        let html = cleanOutput(raw, "web");
        html = stripRpProseFromHtml(html);
        const text = String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!text) return buildBrowserFallbackHtml(topic, reason || "Empty response");
        return enforceBrowserSchema(html, topic, reason);
    };

    const REQUIRED_NAV_LINKS = [
        { href: "#home", label: "Home" },
        { href: "#signin", label: "Sign In" },
        { href: "#shop", label: "Shop" },
        { href: "#profile", label: "Profile" }
    ];
    const hasRequiredNavLinks = (html) => {
        const lower = String(html || "").toLowerCase();
        return REQUIRED_NAV_LINKS.every(l => lower.includes(`href="${l.href}"`) || lower.includes(`href='${l.href}'`));
    };
    const injectNavLinks = () =>
        `<nav style="display:flex; gap:10px; flex-wrap:wrap; padding:10px 0; border-bottom:1px solid rgba(0,0,0,0.12); margin-bottom:10px;">
            ${REQUIRED_NAV_LINKS.map(l => `<a href="${l.href}" style="color:#007aff; text-decoration:none; font-size:13px;">${esc(l.label)}</a>`).join("")}
        </nav>`;

    const enforceBrowserSchema = (html, topic, reason) => {
        const source = String(html || "");
        if (/data-uie-browser-schema=["']1["']/i.test(source)) return source;
        const strip = (v) => String(v || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const topicText = String(topic || "Homepage").trim() || "Homepage";
        let title = "";
        let summary = "";
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(source, "text/html");
            const tEl = doc.querySelector("#browser-title, h1, h2, header h1, header h2");
            title = String(tEl?.textContent || "").trim();
            const sEl = doc.querySelector("#browser-summary, p");
            summary = String(sEl?.textContent || "").trim();
        } catch (_) {}
        if (!title) title = topicText;
        if (!summary) summary = strip(source).slice(0, 220) || String(reason || "Generated in strict mode.");
        const navHtml = hasRequiredNavLinks(source) ? "" : injectNavLinks();
        return `<div data-uie-browser-schema="1" style="padding:12px; font-family:Arial,sans-serif; color:#222; line-height:1.4;">
            ${navHtml}
            <section id="browser-title" style="margin-bottom:10px;">
                <h1 style="margin:0; font-size:20px; font-weight:900;">${esc(title.slice(0, 120))}</h1>
            </section>
            <section id="browser-summary" style="margin-bottom:10px; padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:12px; background:#f8fafc;">
                <p style="margin:0; font-size:13px; opacity:0.9;">${esc(summary.slice(0, 260))}</p>
            </section>
            <section id="browser-content" style="display:flex; flex-direction:column; gap:10px;">
                ${source}
            </section>
            <section style="margin-top:10px; font-size:11px; opacity:0.65; text-align:center;">${esc(String(reason || "Strict browser mode").slice(0, 180))}</section>
        </div>`;
    };

    $win.on("click.phone", ".calc-btn", function(e) {
        e.preventDefault(); e.stopPropagation();
        const act = $(this).data("act");
        const val = $(this).data("val");
        if (act === "clear") return calcSet("0");
        if (act === "back") return calcBack();
        if (act === "eq") return calcEval();
        if (String(val) === "%") return calcPercent();
        if (val !== undefined) return calcAppend(String(val));
    });

    const browserPush = (key, html) => {
        const s = getSettings();
        if(!s || !s.phone) return;
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        s.phone.browser.pages[key] = html;

        if (s.phone.browser.index < s.phone.browser.history.length - 1) {
            s.phone.browser.history = s.phone.browser.history.slice(0, s.phone.browser.index + 1);
        }
        s.phone.browser.history.push(key);
        s.phone.browser.index = s.phone.browser.history.length - 1;
        saveSettings();

        try {
            window.UIE_BACKEND_BRIDGE.saveBrowserPage(key, html).catch(() => {});
        } catch (_) {}
    };

    const browserNavigate = async (raw) => {
        const t = String(raw || "").trim();
        if(!t) return;

        const s = getSettings();
        if(!s || !s.phone) return;
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };

        // Synchronize from backend first
        try {
            const res = await window.UIE_BACKEND_BRIDGE.getBrowserPages();
            if (res && res.pages) {
                Object.assign(s.phone.browser.pages, res.pages);
                saveSettings();
            }
        } catch (_) {}

        if (s.phone.browser.pages[t]) {
            browserPush(t, s.phone.browser.pages[t]);
            browserRender(t);
            return;
        }

        if (s.ai && s.ai.phoneBrowser === false) {
            $("#p-browser-content").html('<div style="text-align:center;margin-top:50px; opacity:0.8;">Browser generation disabled in settings.</div>');
            return;
        }

        $("#p-browser-content").html('<div style="text-align:center;margin-top:50px; opacity:0.8;">Loading…</div>');
        let r = "";
        try {
            r = await generateContent(buildStrictBrowserPrompt(t), "Webpage");
        } catch (_) {
            r = "";
        }
        const html = ensureBrowserHtml(r, t, "Website generator returned an empty page.");
        browserPush(t, html);
        browserRender(t);
    };

    $win.off("click.phone", "#p-browser-go");
    $win.on("click.phone", "#p-browser-refresh", async () => {
        const t = String($("#p-browser-url").val() || "").trim();
        if(!t) return;
        const s0 = getSettings();
        if (s0?.ai && s0.ai.phoneBrowser === false) return;
        let r = "";
        try {
            r = await generateContent(buildStrictBrowserPrompt(t), "Webpage");
        } catch (_) {
            r = "";
        }
        const html = ensureBrowserHtml(r, t, "Refresh returned an empty page.");
        const s = getSettings();
        if(s?.phone?.browser) {
            s.phone.browser.pages[t] = html;
            saveSettings();
        }
        browserRender(t);
    });

    $win.on("click.phone", "#p-browser-go", async () => {
        const t = String($("#p-browser-url").val() || "").trim();
        if (!t) return;
        const s = getSettings();
        if (s?.phone?.browser?.pages && s.phone.browser.pages[t]) {
            await browserNavigate(t);
            return;
        }
        await browserNavigate(t);
    });
    $win.on("click.phone", "#p-browser-back", () => {
        const s = getSettings();
        if(!s?.phone?.browser) return;
        const b = s.phone.browser;
        if (b.index <= 0) return;
        b.index -= 1;
        saveSettings();
        browserRender(b.history[b.index]);
    });
    $win.on("click.phone", "#p-browser-fwd", () => {
        const s = getSettings();
        if(!s?.phone?.browser) return;
        const b = s.phone.browser;
        if (b.index >= b.history.length - 1) return;
        b.index += 1;
        saveSettings();
        browserRender(b.history[b.index]);
    });

    $win.on("keydown.phone", "#p-browser-url", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            $("#p-browser-go").click();
        }
    });


    $win
        .off("click.phoneWeb pointerup.phoneWeb", "#p-browser-content a")
        .on("click.phoneWeb pointerup.phoneWeb", "#p-browser-content a", function(e){
            if (e.type === "pointerup" && e.pointerType !== "touch") return;
            const href = String($(this).attr("href") || "").trim();
            if(!href || href.startsWith("#")) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            $("#p-browser-url").val(href);
            $("#p-browser-go").trigger("click");
        });

    function sanitizeWebHtml(input) {
        return String(input || "");
    }

    function ensureBrowser(s) {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.bookmarks)) s.phone.bookmarks = [];
        if (!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        if (!s.phone.browser.pages) s.phone.browser.pages = {};
        if (!Array.isArray(s.phone.browser.history)) s.phone.browser.history = [];
        if (typeof s.phone.browser.index !== "number") s.phone.browser.index = -1;
    }

    function renderBrowserHome() {
        const s = getSettings();
        ensureBrowser(s);
        const $c = $("#p-browser-content");
        if (!$c.length) return;
        const list = Array.isArray(s.phone.bookmarks) ? s.phone.bookmarks : [];
        if (!list.length) {
            $c.html(`<div style="padding:18px; opacity:0.8; text-align:center;">No saved pages yet.<div style="margin-top:8px; opacity:0.75; font-size:12px;">Open a page, then tap the bookmark button.</div></div>`);
            return;
        }
        const items = list.slice().reverse().slice(0, 40).map(b => {
            const url = String(b.url || "").slice(0, 160);
            const title = String(b.title || b.url || "Saved Page").slice(0, 80);
            return `<div class="p-bookmark" data-url="${esc(url)}" style="padding:12px; border-bottom:1px solid rgba(0,0,0,0.08); cursor:pointer;">
                <div style="font-weight:900; color:#222;">${esc(title)}</div>
                <div style="opacity:0.7; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(url)}</div>
            </div>`;
        }).join("");
        $c.html(`<div style="background:#fff; color:#222;">${items}</div>`);
    }

    $win.on("click.phone", "#p-browser-save", function(e){
        e.preventDefault(); e.stopPropagation();
        const key = String($("#p-browser-url").val() || "").trim();
        if (!key) return;
        const s = getSettings();
        ensureBrowser(s);
        const html = String(s.phone.browser.pages[key] || $("#p-browser-content").html() || "");
        const title = (prompt("Save as:", key) || "").trim() || key;
        const exists = s.phone.bookmarks.some(b => String(b.url || "") === key);
        if (!exists) s.phone.bookmarks.push({ url: key, title: title.slice(0, 80), ts: Date.now() });
        s.phone.browser.pages[key] = html;
        saveSettings();
        notify("success", "Saved.", "Phone", "phoneMessages");
    });

    $win.on("click.phone", "#p-browser-content .p-bookmark", function(e){
        e.preventDefault(); e.stopPropagation();
        const url = String($(this).data("url") || "").trim();
        if (!url) return;
        $("#p-browser-url").val(url);
        $("#p-browser-go").click();
    });


    $win.on("click.phone", "#p-save-btn", () => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        const power = ensurePhonePowerState(s);
        s.phone.pin = $("#p-set-pin").val();
        s.phone.deviceSkin = String($("#p-device-style").val() || "modern");
        s.phone.allowCalls = isCodiceMode(s) ? false : $("#p-allow-calls").is(":checked");
        s.phone.allowTexts = $("#p-allow-texts").is(":checked");
        s.phone.npcPhonePromptInjection = $("#p-npc-phone-prompt-injection").is(":checked");
        power.batterySimulationEnabled = $("#p-battery-sim").is(":checked");
        power.networkSimulationEnabled = $("#p-network-sim").is(":checked");
        power.monthlyPlanCost = Math.max(0, Number($("#p-phone-plan-cost").val() || 0));
        power.charger = String($("#p-charger-type").val() || power.charger || "wall");
        if (!power.batterySimulationEnabled) power.shutDown = false;
        s.phone.bubbleColors = {
            sent: String($("#p-bubble-sent").val() || "").trim() || (s.phone.bubbleColors?.sent || ""),
            received: String($("#p-bubble-recv").val() || "").trim() || (s.phone.bubbleColors?.received || "")
        };
        saveSettings();
        loadPhoneVisuals();
        alert("Settings Saved");
        goHome();
    });

    $win.on("click.phone", "#uie-phone-charge-toggle, #p-charge-now", () => {
        const s = getSettings();
        const power = ensurePhonePowerState(s);
        const charger = String($("#uie-phone-power-charger:visible, #p-charger-type:visible").first().val() || power.charger || "wall");
        setPhoneCharging(!power.charging, charger);
    });

    $win.on("change.phone", "#uie-phone-power-charger, #p-charger-type", function() {
        const s = getSettings();
        ensurePhonePowerState(s).charger = String($(this).val() || "wall");
        saveSettings();
        renderPhonePowerStatus();
    });

    $win.on("click.phone", ".phone-pay-bill", async function() {
        const id = String($(this).attr("data-bill-id") || "");
        if (!id) return;
        const mod = await import("./taxJailManager.js");
        const result = mod.payBill?.(id);
        if (!result?.ok) notify("warning", String(result?.reason || "Bill payment failed."), "Bills", "bills");
        await renderBillsApp();
        renderPhonePowerStatus();
    });

    $win.on("click.phone", "#p-wallpaper-pick", () => $("#p-wallpaper-file").trigger("click"));
    $win.on("change.phone", "#p-wallpaper-file", function() {
        const file = this.files && this.files[0];
        this.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const s = getSettings();
            if (!s.phone) s.phone = {};
            s.phone.wallpaper = String(reader.result || "");
            saveSettings();
            $("#p-wallpaper-name").text(file.name || "Custom wallpaper selected");
            loadPhoneVisuals();
        };
        reader.readAsDataURL(file);
    });
    $win.on("click.phone", "#p-wallpaper-clear", () => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        s.phone.wallpaper = "";
        saveSettings();
        $("#p-wallpaper-name").text("No custom wallpaper");
        loadPhoneVisuals();
    });

    const ensurePhoneState = () => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.customApps)) s.phone.customApps = [];
        if (!Array.isArray(s.phone.unlockedDevices)) s.phone.unlockedDevices = ["classic"];
        if (!Array.isArray(s.phone.featuredApps)) s.phone.featuredApps = [];
        if (!s.phone.shop) s.phone.shop = { tab: "skins" };
        return s;
    };

    const setDraftStatus = (txt) => {
        const el = $("#store-draft-status");
        if (el.length) el.text(String(txt || ""));
    };

    const generateAppDraft = async () => {
        const sAllow = getSettings();
        if (sAllow?.ai && sAllow.ai.appBuilder === false) return null;
        const name = String($("#store-app-name").val() || "").trim();
        const desc = String($("#store-app-desc").val() || "").trim();
        const template = String($("#store-app-template").val() || "tool");
        if (!name) return null;

        setDraftStatus("Generating functional app logic...");

        const uiPrompt = `
You are a software engineer building a functional mini-app for a simulated smartphone OS.
App name: "${name}"
Template: "${template}"
Description: "${desc}"

Return EXACTLY one JSON object with these keys and no markdown:
{
  "icon": "fa-solid fa-cube",
  "color": "#333333",
  "ui": "<div id='app-wrap'>Compact mobile HTML with unique IDs.</div>",
  "styles": "#app-wrap { padding: 10px; }",
  "logic": "Raw JavaScript string."
}

Rules for logic:
- You receive one object named app.
- app.dom is the root HTML element. Use app.dom.querySelector() to bind events.
- app.state is permanent memory for this one app. Store variables there.
- Call app.saveState() after updating app.state.
- Call app.notify(string) for phone notifications.
- Call app.rpAction(string) only when the app should create an in-world roleplay event.
- Avoid network calls, eval, document.body, global selectors, and position: fixed.
`;

        const resRaw = await generateContent(uiPrompt.slice(0, 5000), "System Check");
        let appObj = null;
        try {
            appObj = JSON.parse(cleanOutput(resRaw, "json"));
        } catch (_) {
            setDraftStatus("Generation failed: invalid app JSON.");
            return null;
        }

        const s = ensurePhoneState();
        s.phone.draftApp = {
            id: Date.now(),
            name,
            desc,
            template,
            icon: String(appObj?.icon || "fa-solid fa-cube"),
            color: String(appObj?.color || "#333"),
            ui: String(appObj?.ui || "<div style='padding:18px;text-align:center;'>App UI unavailable.</div>"),
            styles: String(appObj?.styles || ""),
            logic: String(appObj?.logic || ""),
            state: {},
            createdAt: Date.now()
        };
        saveSettings();
        setDraftStatus(`Draft ready: ${name}`);
        return s.phone.draftApp;
    };

    const previewDraft = () => {
        const s = ensurePhoneState();
        const d = s.phone.draftApp;
        if (!d || (!d.ui && !d.html)) return false;
        openApp("#uie-app-browser-view");
        $("#uie-app-browser-view").removeClass("browser-app-mode");
        $("#p-app-title").text(d.name || "Draft");
        $("#p-app-header").show();
        const style = d.styles ? `<style id="style-draft-${d.id}">${d.styles}</style>` : "";
        $("#p-browser-content").html(style + (d.ui || d.html || ""));
        return true;
    };

    // App Builder: Generate
    $(document).on("click.phone", "#store-gen-btn", async () => {
        const btn = $("#store-gen-btn");
        btn.text("...").prop("disabled", true);
        try {
            const d = await generateAppDraft();
            if (!d) setDraftStatus("Draft generation failed.");
        } catch (_) {
            setDraftStatus("Draft generation failed.");
        }
        btn.text("GENERATE").prop("disabled", false);
    });

    // App Builder: Preview
    $(document).on("click.phone", "#store-preview-btn", async () => {
        const s = ensurePhoneState();
        if (!s.phone.draftApp) {
            const btn = $("#store-preview-btn");
            btn.text("...").prop("disabled", true);
            try { await generateAppDraft(); } catch (_) {}
            btn.text("PREVIEW").prop("disabled", false);
        }
        if (!previewDraft()) {
            notify("warning", "No draft to preview.", "App Builder", "api");
        }
    });

    // App Builder: Install Draft
    $(document).on("click.phone", "#store-create-btn", async () => {
        const btn = $("#store-create-btn");
        btn.text("...").prop("disabled", true);
        try {
            const s = ensurePhoneState();
            if (!s.phone.draftApp) await generateAppDraft();
            const d = ensurePhoneState().phone.draftApp;
            if (!d) { setDraftStatus("No draft to install."); return; }

            if (!s.phone.customApps.find(a => String(a.name) === String(d.name))) {
                s.phone.customApps.push({
                    id: d.id || Date.now(),
                    name: d.name,
                    desc: d.desc,
                    icon: d.icon,
                    color: d.color,
                    ui: d.ui || d.html || "",
                    styles: d.styles || "",
                    logic: d.logic || "",
                    state: d.state || {}
                });
                s.phone.draftApp = null;
                saveSettings();
                notify("success", "App Installed!", "App Store", "phoneMessages");
            } else {
                notify("info", "App already installed.", "App Store", "phoneMessages");
            }
            loadPhoneVisuals();
            renderAppStore();
            setDraftStatus("No draft yet.");
        } finally {
            btn.text("INSTALL DRAFT").prop("disabled", false);
        }
    });

    const renderCookies = () => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        // Calculate sizes
        const getBytes = (obj) => new Blob([JSON.stringify(obj)]).size;
        const fmtSize = (bytes) => {
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
            return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        };

        const logsSize = 0; // Logs are handled externally or via RP logs if stored
        const browserSize = getBytes(s.phone.browser || {});
        const mapsSize = getBytes(s.map || {});
        const booksSize = getBytes(s.phone.books || []);
        const stateSize = getBytes(s.worldState || {});
        const numbersSize = getBytes(s.phone.numberBook || []);
        const total = logsSize + browserSize + mapsSize + booksSize + numbersSize + stateSize;

        $("#cookies-total-size").text(fmtSize(total) + " Used");
        $("#size-logs").text("N/A"); // Placeholder
        $("#size-browser").text(fmtSize(browserSize));
        $("#size-maps").text(fmtSize(mapsSize));
        $("#size-books").text(fmtSize(booksSize));
        $("#size-numbers").text(fmtSize(numbersSize));
        $("#size-state").text(fmtSize(stateSize));

        // Category Click Handlers
        $(".cookie-row").off("click.phone").on("click.phone", function() {
            const cat = $(this).data("cat");
            renderCookiesDetail(cat);
        });

        // Clear All
        $("#cookies-clear-all").off("click.phone").on("click.phone", async function() {
            if (await customConfirm("Permanently delete all generated data?")) {
                if (s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
                if (s.map) s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } };
                if (s.phone.books) s.phone.books = [];
                if (s.worldState) s.worldState = { location: "Unknown", threat: "None", status: "Normal", time: "Day", weather: "Clear", custom: {} };
                saveSettings();
                renderCookies();
                alert("All data cleared.");
            }
        });
    };

    const renderCookiesDetail = (cat) => {
        const s = getSettings();
        $("#cookies-detail-view").css("display", "flex").hide().fadeIn(150);
        $("#cookies-detail-title").text(cat === "browser" ? "Saved Web Data" : cat === "maps" ? "Maps" : cat === "books" ? "Books" : cat === "numbers" ? "Saved Numbers" : cat === "state" ? "World State" : "Logs");

        const $list = $("#cookies-detail-list").empty();
        let items = [];

        if (cat === "browser" && s.phone.browser?.pages) {
            items = Object.keys(s.phone.browser.pages).map(k => ({ id: k, title: k, type: "Page" }));
        } else if (cat === "maps" && s.map?.data) {
            items = [{ id: "current", title: s.map.prompt || "Current Map", type: "Map Data" }];
        } else if (cat === "books" && Array.isArray(s.phone.books)) {
            items = s.phone.books.map(b => ({ id: b.id, title: b.title, type: "Book" }));
        } else if (cat === "numbers" && Array.isArray(s.phone.numberBook)) {
            items = s.phone.numberBook.map((n, idx) => ({ id: String(idx), title: `${n.name || "Unknown"} — ${n.number || ""}`, type: "Number" }));
        } else if (cat === "state" && s.worldState) {
            items = Object.keys(s.worldState).map(k => ({ id: k, title: k, type: String(s.worldState[k]) }));
        }

        const renderItems = (list) => {
            $list.empty();
            if (!list.length) {
                $list.html('<div style="padding:20px; text-align:center; color:#aaa;">No data found.</div>');
                return;
            }
            list.forEach(i => {
                $list.append(`
                    <div class="cookie-item-row" data-id="${i.id}" style="padding:12px 16px; border-bottom:1px solid #e5e5e5; display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1; min-width:0; margin-right:10px;">
                            <div style="font-weight:600; color:#1d1d1f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(i.title)}</div>
                            <div style="font-size:12px; color:#86868b;">${esc(i.type)}</div>
                        </div>
                        <i class="fa-solid fa-trash cookie-del-btn" data-cat="${cat}" data-id="${i.id}" style="color:#ff3b30; cursor:pointer; padding:8px;"></i>
                    </div>
                `);
            });
        };
        renderItems(items);

        // Search Filter
        $("#cookies-search").off("input.phone").on("input.phone", function() {
            const q = $(this).val().toLowerCase();
            const filtered = items.filter(i => i.title.toLowerCase().includes(q) || i.type.toLowerCase().includes(q));
            renderItems(filtered);
        });

        // Delete Single
        $(document).off("click.phone", ".cookie-del-btn").on("click.phone", ".cookie-del-btn", function(e) {
            e.stopPropagation();
            const id = $(this).data("id");
            const c = $(this).data("cat");
            if (c === "browser") delete s.phone.browser.pages[id];
            else if (c === "maps") s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } };
            else if (c === "books") s.phone.books = s.phone.books.filter(b => b.id != id);
            else if (c === "numbers") s.phone.numberBook = (s.phone.numberBook || []).filter((_, i) => String(i) !== String(id));
            else if (c === "state") delete s.worldState[id];
            saveSettings();
            renderCookies(); // Update totals
            renderCookiesDetail(c); // Refresh list
        });

        // Delete Category
        $("#cookies-delete-cat").off("click.phone").on("click.phone", async function() {
            if (await customConfirm("Delete all items in this category?")) {
                if (cat === "browser") s.phone.browser.pages = {};
                else if (cat === "maps") s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } };
                else if (cat === "books") s.phone.books = [];
                else if (cat === "numbers") s.phone.numberBook = [];
                else if (cat === "state") s.worldState = { location: "Unknown", threat: "None", status: "Normal", time: "Day", weather: "Clear", custom: {} };
                saveSettings();
                renderCookies();
                $("#cookies-detail-back").click();
            }
        });

        $("#cookies-detail-back").off("click.phone").on("click.phone", function() {
            $("#cookies-detail-view").fadeOut(150);
        });
    };

    const renderAppStore = () => {
        const s = ensurePhoneState();
        const list = $("#store-installed-list");
        if(!list.length) return;
        list.empty();
        if (s.phone.draftApp && s.phone.draftApp.name) setDraftStatus(`Draft ready: ${s.phone.draftApp.name}`);
        else setDraftStatus("No draft yet.");
        (s.phone.customApps || []).forEach(app => {
            list.append(`
                <div style="display:flex; align-items:center; gap:10px; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); margin-bottom:8px;">
                    <div style="background:${app.color}; width:40px; height:40px; border-radius:14px; display:grid; place-items:center; border:1px solid rgba(255,255,255,0.10); font-size:1.1em;"><i class="${app.icon}"></i></div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(app.name)}</div>
                        <div style="opacity:0.7; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(app.desc || "")}</div>
                    </div>
                    <button class="btn-delete-app" data-id="${app.id}" style="height:34px; padding:0 10px; border-radius:12px; border:1px solid rgba(243,139,168,0.35); background:rgba(0,0,0,0.25); color:#f38ba8; font-weight:900;">Delete</button>
                </div>
            `);
        });
    };

    $win.on("click.phone", ".btn-delete-app", async function() {
        const id = $(this).data("id"); if(await customConfirm("Delete app?")) {
            const s = getSettings(); s.phone.customApps = s.phone.customApps.filter(a => a.id != id);
            saveSettings(); loadPhoneVisuals(); renderAppStore();
        }
    });

    $win.off("click.phone", ".custom-app-icon");
    $win.off("click.phoneAppIcon", ".custom-app-icon").on("click.phoneAppIcon", ".custom-app-icon", function(e) {
        if($(e.target).hasClass("custom-app-delete")) return;
        const id = $(this).data("id");
        const app = getSettings().phone.customApps.find(a => a.id == id);
        if(!app) return;
        openApp("#uie-app-browser-view");
        $("#uie-app-browser-view").addClass("browser-app-mode");
        $("#p-app-title").text(app.name);
        $("#p-app-header").show();
        const $content = $("#p-browser-content").empty();
        $("#uie-app-browser-view").data("active-app", id);

        const styleId = `style-custom-${String(id).replace(/[^a-z0-9_-]/gi, "_")}`;
        $(`#${styleId}`).remove();
        if (app.styles) $("head").append(`<style id="${styleId}">${String(app.styles)}</style>`);
        $content.html(app.ui || app.html || "<div style='padding:18px;text-align:center;'>App has no UI.</div>");

        const fugueAPI = {
            state: app.state && typeof app.state === "object" ? app.state : {},
            dom: $content.get(0),
            saveState: () => {
                app.state = fugueAPI.state;
                saveSettings();
            },
            notify: (msg) => {
                try { notify("info", String(msg || ""), app.name || "App", "api"); } catch (_) {}
            },
            rpAction: (msg) => {
                try { injectRpEvent(`[${app.name || "Custom App"}] ${String(msg || "")}`); } catch (_) {}
            },
            charge: (amount) => {
                try {
                    const s = getSettings();
                    return payTransitFare(s, { fare: Number(amount || 0) });
                } catch (_) {
                    return false;
                }
            }
        };

        if (app.logic) {
            try {
                const appLogic = new Function("app", `"use strict";\n${String(app.logic)}`);
                appLogic(fugueAPI);
            } catch (err) {
                console.error(`[Fugue App Builder] Logic Error in ${app.name}:`, err);
                $content.prepend(`<div style="background:#f38ba8;color:#111;padding:10px;font-weight:bold;">App Logic Error</div>`);
            }
        }
    });

    loadPhoneVisuals();
    ensurePhonePowerState(getSettings());
    renderPhonePowerStatus();
    if (phonePowerInt) clearInterval(phonePowerInt);
    phonePowerInt = setInterval(tickPhonePower, 15000);
    startArrivalWatcher();
    window.removeEventListener("uie:game_mode_changed", window.__uiePhoneModeRefresh || (() => {}));
    window.__uiePhoneModeRefresh = () => {
        try { loadPhoneVisuals(); } catch (_) {}
        try { renderMessages(); } catch (_) {}
        try { renderContacts(); } catch (_) {}
    };
    window.addEventListener("uie:game_mode_changed", window.__uiePhoneModeRefresh);

    $(window).off("uie:backend_asset_image_ready").on("uie:backend_asset_image_ready", function(e) {
        const asset = e.originalEvent?.detail || e.detail;
        if (asset && asset.asset_id) {
            const url = `/assets/image/file/${asset.asset_id}`;
            $(`img[src*="${asset.asset_id}"]`).each(function() {
                $(this).attr("src", url + "?t=" + Date.now());
                $(this).siblings(".iv-post-image-skeleton").hide();
                $(this).show();
            });
        }
    });

}

export function openBooksGuide(sectionId) {
    try {
        if (typeof window.UIE_openHelpManual === "function") {
            window.UIE_openHelpManual(sectionId);
            return;
        }
        if (typeof window.openHelpManualWindow === "function") {
            window.openHelpManualWindow(sectionId);
            return;
        }
        if (window.importUieModule) {
            window.importUieModule("helpManual.js")
                .then((mod) => {
                    mod.installHelpManualGlobals?.();
                    mod.openHelpManualWindow?.(sectionId);
                })
                .catch((err) => console.error("openBooksGuide failed", err));
        }
    } catch (e) {
        console.error("openBooksGuide failed", e);
    }
}
// Expose globally for HTML onclicks
try { window.UIE_openGuide = openBooksGuide; } catch (_) {}

const BOOK_DOCUMENT_TEMPLATES = {
    normal_book: {
        label: "Normal Book",
        samples: [
            `<article class="uie-book-doc uie-book-normal"><div class="book-cover"><div class="book-title">{{title}}</div><div class="book-rule"></div></div><section class="book-spread"><div class="book-page"><h2>Chapter I</h2><p>{{body}}</p></div><div class="book-page"><p>{{body2}}</p></div></section></article>`,
            `<article class="uie-book-doc uie-book-novel"><header class="book-title-page"><h1>{{title}}</h1><p class="subtitle">{{subtitle}}</p></header><section class="book-page"><p>{{body}}</p><p>{{body2}}</p></section></article>`
        ]
    },
    tome: {
        label: "Ancient Tome",
        samples: [
            `<article class="uie-book-doc uie-book-tome"><div class="tome-clasps"></div><h1>{{title}}</h1><section class="illuminated-page"><p><span class="dropcap">{{dropcap}}</span>{{body}}</p><aside>{{marginalia}}</aside></section></article>`,
            `<article class="uie-book-doc uie-book-tome dark"><header><h1>{{title}}</h1><div class="sigil">O</div></header><section><h2>{{section}}</h2><p>{{body}}</p><p>{{body2}}</p></section></article>`
        ]
    },
    grimoire: {
        label: "Grimoire",
        samples: [
            `<article class="uie-book-doc uie-book-grimoire"><h1>{{title}}</h1><div class="spell-circle"></div><section><h2>Rite</h2><p>{{body}}</p><h3>Cost</h3><p>{{body2}}</p></section></article>`,
            `<article class="uie-book-doc uie-book-grimoire violet"><header><h1>{{title}}</h1><p>Bound instructions, not casual prose.</p></header><ol><li>{{body}}</li><li>{{body2}}</li></ol></article>`
        ]
    },
    school_textbook: {
        label: "School Textbook",
        samples: [
            `<article class="uie-book-doc uie-book-textbook"><header><span class="unit">Unit 1</span><h1>{{title}}</h1></header><section class="lesson"><h2>Key Terms</h2><dl><dt>{{term}}</dt><dd>{{body}}</dd></dl><div class="check">Review: {{body2}}</div></section></article>`,
            `<article class="uie-book-doc uie-book-textbook"><h1>{{title}}</h1><div class="chapter-band">Chapter Notes</div><p>{{body}}</p><table><tr><th>Concept</th><th>Meaning</th></tr><tr><td>{{term}}</td><td>{{body2}}</td></tr></table></article>`
        ]
    },
    note: {
        label: "Note",
        samples: [
            `<article class="uie-book-doc uie-note"><div class="tape"></div><h1>{{title}}</h1><p>{{body}}</p><p class="signed">{{signature}}</p></article>`,
            `<article class="uie-book-doc uie-note lined"><h1>{{title}}</h1><ul><li>{{body}}</li><li>{{body2}}</li></ul><small>{{signature}}</small></article>`
        ]
    },
    scroll: {
        label: "Scroll",
        samples: [
            `<article class="uie-book-doc uie-scroll"><div class="rod top"></div><section><h1>{{title}}</h1><p>{{body}}</p><p>{{body2}}</p></section><div class="rod bottom"></div></article>`,
            `<article class="uie-book-doc uie-scroll decree"><section><h1>{{title}}</h1><p>Hear this: {{body}}</p><p>{{body2}}</p></section></article>`
        ]
    }
};

function inferBookDocumentCategory(prompt = "") {
    const p = String(prompt || "").toLowerCase();
    if (/\b(grimoire|spellbook|spell book|hex|ritual|arcane)\b/.test(p)) return "grimoire";
    if (/\b(tome|ancient book|codex|eldritch|old volume)\b/.test(p)) return "tome";
    if (/\b(textbook|school book|coursebook|lesson|chapter|unit|classroom)\b/.test(p)) return "school_textbook";
    if (/\b(scroll|decree|rolled parchment|proclamation)\b/.test(p)) return "scroll";
    if (/\b(note|letter|memo|sticky|journal page|loose page)\b/.test(p)) return "note";
    return "normal_book";
}

function bookTemplateStyles() {
    return `<style>
        .uie-book-doc{box-sizing:border-box;max-width:760px;margin:0 auto;color:#2f1d12;font-family:Georgia,'Times New Roman',serif;line-height:1.65;transform-origin:center left;animation:uiePhoneBookOpen .42s cubic-bezier(.2,.8,.2,1) both}
        .uie-book-doc *{box-sizing:border-box}.uie-book-doc h1,.uie-book-doc h2,.uie-book-doc h3{font-family:Georgia,'Times New Roman',serif;letter-spacing:0;margin:0 0 10px}
        .uie-book-normal,.uie-book-novel{padding:22px;background:#f7ecd0;border:10px solid #6b3f22;box-shadow:inset 0 0 30px rgba(83,48,24,.22)}
        .book-cover,.book-title-page{text-align:center;padding:28px 18px;border:2px solid rgba(80,45,20,.35);background:#efe0bd}.book-title{font-size:28px;font-weight:900}.book-rule{height:3px;background:#8a5a2b;margin:14px auto;width:50%}
        .book-spread{display:grid;grid-template-columns:1fr 1fr;gap:16px}.book-page{padding:18px;background:#fff7df;border:1px solid rgba(80,45,20,.18);min-height:220px}
        .uie-book-tome{padding:26px;background:#d8c09a;border:14px ridge #4b2d18;color:#27170d}.uie-book-tome.dark{background:#2b2118;color:#ead9b8;border-color:#7c5a31}.illuminated-page{padding:18px;background:rgba(255,248,225,.7);border:2px solid #7c5a31}.dropcap{float:left;font-size:44px;line-height:.9;margin-right:8px;color:#9d2f18}.sigil{font-size:42px;text-align:center;color:#b69045}
        .uie-book-grimoire{padding:24px;background:#211829;color:#f2e5ff;border:12px double #9a6cff;box-shadow:inset 0 0 35px rgba(154,108,255,.22)}.uie-book-grimoire.violet{background:#2f193d}.spell-circle{width:120px;height:120px;border:3px double #d8b4fe;border-radius:50%;margin:12px auto}
        .uie-book-textbook{padding:22px;background:#eef5ff;border:8px solid #2d5d8a;color:#17283a;font-family:Arial,system-ui,sans-serif}.uie-book-textbook h1,.uie-book-textbook h2{font-family:Arial,system-ui,sans-serif}.unit,.chapter-band{display:inline-block;background:#2d5d8a;color:#fff;padding:4px 10px;border-radius:4px;font-weight:900}.check{margin-top:12px;padding:10px;background:#d8e9fb;border-left:5px solid #2d5d8a}.uie-book-textbook table{width:100%;border-collapse:collapse}.uie-book-textbook th,.uie-book-textbook td{border:1px solid #8ab0d3;padding:8px;text-align:left}
        .uie-note{max-width:520px;padding:26px;background:#fff7b8;border:1px solid #d8bf62;box-shadow:0 10px 25px rgba(0,0,0,.25);font-family:'Comic Sans MS','Segoe Print',cursive;transform:rotate(-1deg)}.uie-note.lined{background:repeating-linear-gradient(#fffbd1 0 28px,#d9c879 29px 30px)}.uie-note .tape{width:90px;height:24px;background:rgba(240,220,160,.75);margin:-38px auto 12px}.signed{text-align:right}
        .uie-scroll{padding:18px 28px;background:#ead2a0;border-left:18px solid #8a5a2b;border-right:18px solid #8a5a2b;color:#3a2414;box-shadow:inset 0 0 28px rgba(82,45,18,.26);transform-origin:center;animation:uiePhoneScrollOpen .42s cubic-bezier(.2,.8,.2,1) both}.uie-scroll .rod{height:14px;background:#5d351b;border-radius:999px;margin:0 -38px 12px}.uie-scroll .rod.bottom{margin:12px -38px 0}.uie-scroll.decree{border-color:#5d351b;text-align:center}
        @keyframes uiePhoneBookOpen{from{opacity:.25;transform:perspective(1100px) rotateY(-70deg) scale(.95)}to{opacity:1;transform:perspective(1100px) rotateY(0) scale(1)}}
        @keyframes uiePhoneScrollOpen{from{opacity:.25;transform:scaleY(.06);clip-path:inset(47% 0)}to{opacity:1;transform:scaleY(1);clip-path:inset(0)}}
        @media not all{.book-spread{grid-template-columns:1fr}.uie-book-doc{max-width:100%}}
    </style>`;
}

function fallbackBookHtml(prompt = "", category = "normal_book") {
    const title = String(prompt || "Untitled").trim().slice(0, 90) || "Untitled";
    const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const base = {
        title: safeTitle,
        subtitle: "A generated fallback volume",
        section: "First Reading",
        term: "Core Idea",
        dropcap: safeTitle.charAt(0).toUpperCase() || "A",
        body: `This ${BOOK_DOCUMENT_TEMPLATES[category]?.label || "book"} was generated from the request: ${safeTitle}.`,
        body2: "The full AI writer was unavailable, so Reality Engine used the strict preset HTML fallback for this document category.",
        marginalia: "Margin note: preserve the category-specific structure.",
        signature: "- Reality Engine"
    };
    let html = BOOK_DOCUMENT_TEMPLATES[category]?.samples?.[0] || BOOK_DOCUMENT_TEMPLATES.normal_book.samples[0];
    Object.entries(base).forEach(([k, v]) => { html = html.replaceAll(`{{${k}}}`, v); });
    return `${bookTemplateStyles()}${html}`;
}

function renderBooks() {
    const s = getSettings();
    if(!s.phone) s.phone = {};
    if(!Array.isArray(s.phone.books)) s.phone.books = [];
    const $win = $("#uie-phone-window");

    $("#books-view-library").show();
    $("#books-tab-library").addClass("active");

    const $list = $("#books-list").empty();
    if (!s.phone.books.length) {
        $list.html(`<div style="opacity:0.75; padding:10px; border:1px dashed #ccc; border-radius:12px;">No books yet.</div>`);
    } else {
        s.phone.books.slice().reverse().forEach(b => {
            const category = b.category || b.type || "normal_book";
            $list.append(`
                <div class="book-row" data-id="${b.id}" style="padding:12px; border-radius:12px; border:1px solid rgba(0,0,0,0.10); background:#f7f2e8; cursor:pointer; color:#2c1e10;">
                    <div style="font-weight:900; color:#000;">${String(b.title || "Generated Document")}</div>
                    <div style="opacity:0.75; font-size:12px; color:#2c1e10;">${BOOK_DOCUMENT_TEMPLATES[category]?.label || "Book"} - ${new Date(b.createdAt || Date.now()).toLocaleString()}</div>
                </div>
            `);
        });
    }

    $win.off("click.phoneBooksTabs");
    $win.on("click.phoneBooksTabs", "#books-tab-library", () => {
        $("#books-view-library").show();
        $("#books-tab-library").addClass("active");
    });

    const doGen = async () => {
        const s2 = getSettings();
        if (s2?.ai && s2.ai.books === false) return;
        const prompt = String($("#books-prompt").val() || "").trim();
        if(!prompt) return;
        $("#books-prompt").val("");
        const category = inferBookDocumentCategory(prompt);
        const spec = BOOK_DOCUMENT_TEMPLATES[category] || BOOK_DOCUMENT_TEMPLATES.normal_book;
        const title = prompt.slice(0, 80);
        let html = "";
        try {
            html = await generateContent(`Write an immersive ${spec.label} as raw HTML.

STRICT DOCUMENT CATEGORY: ${category}
You must follow one of these two exact structural templates and adapt only text/content, not the category:
Template A:
${spec.samples[0]}

Template B:
${spec.samples[1]}

Global rules:
- Output a complete raw HTML fragment only. No scripts.
- Include category-specific CSS in a <style> tag or inline styles so it looks like a real physical ${spec.label}.
- Normal books must look like bound books/pages.
- Tomes and grimoires must look heavy, old, magical, and distinct from normal books.
- School textbooks must look academic with units, terms, lessons, tables, or review blocks.
- Notes must look like loose notes.
- Scrolls must look like scrolls.
- Do not use a generic parchment rectangle for every category.

User request: "${prompt}"`, "Webpage");
        } catch (_) {
            html = "";
        }
        const clean = html ? cleanOutput(html, "web") : fallbackBookHtml(prompt, category);
        const s3 = getSettings();
        if(!s3.phone) s3.phone = {};
        if(!Array.isArray(s3.phone.books)) s3.phone.books = [];
        s3.phone.books.push({ id: Date.now(), title, category, html: clean || fallbackBookHtml(prompt, category), createdAt: Date.now() });
        saveSettings();
        renderBooks();
        $("#books-view-library").show();
        $("#books-tab-library").addClass("active");
    };

    $win.off("click.phoneBooksGen").on("click.phoneBooksGen", "#books-go", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await doGen();
    });

    $win.off("keydown.phoneBooksPrompt").on("keydown.phoneBooksPrompt", "#books-prompt", async (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault(); e.stopPropagation();
        await doGen();
    });

    $win.off("click.phoneBooksOpen").on("click.phoneBooksOpen", "#books-list .book-row", function() {
        const id = Number($(this).data("id"));
        const s2 = getSettings();
        const b = (s2.phone.books || []).find(x => Number(x.id) === id);
        if(!b) return;
        $("#books-reader-body").html(String(b.html || ""));
        $("#books-reader").show();
    });

    $win.off("click.phoneBooksClose").on("click.phoneBooksClose", "#books-reader-close", () => {
        $("#books-reader").hide();
    });



    try {
        window.removeEventListener("uie:backend_asset_image_ready", window.__uieIvAssetReady);
        window.__uieIvAssetReady = () => { if ($("#uie-app-social-view").is(":visible")) renderSocialApp(); };
        window.addEventListener("uie:backend_asset_image_ready", window.__uieIvAssetReady);
    } catch (_) {}
    try {
        window.removeEventListener("uie:social_updated", window.__uieIvSocialUpdated);
        window.__uieIvSocialUpdated = () => { if ($("#uie-app-social-view").is(":visible")) _ivRenderHomeFeed(); };
        window.addEventListener("uie:social_updated", window.__uieIvSocialUpdated);
    } catch (_) {}
}

const togglePhone = () => {
    $("#uie-phone-window").fadeToggle(200);
};

export { togglePhone, openPhoneHome };
