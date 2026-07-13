import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { ensureGameModeState, getGameMode } from "./gameModeManager.js";
import { publishOrganizationIntel, detectOrganizationNamesInText } from "./organizationIntelBus.js";

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function id(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowMs(s) {
    return Number(s?.world?.currentTime || Date.now()) || Date.now();
}

export function ensureCommunicationsState(settings = getSettings()) {
    const s = ensureGameModeState(settings);
    if (!s.relationships || typeof s.relationships !== "object") s.relationships = {};
    if (!Array.isArray(s.relationships.messages)) s.relationships.messages = [];
    if (!Array.isArray(s.world.inTransitQueue)) s.world.inTransitQueue = [];
    if (!Number.isFinite(Number(s.world.missiveTravelTime)) || Number(s.world.missiveTravelTime) <= 0) s.world.missiveTravelTime = 4;
    if (!s.phone || typeof s.phone !== "object") s.phone = {};
    if (!s.phone.email || typeof s.phone.email !== "object") s.phone.email = {};
    if (!Array.isArray(s.phone.email.inbox)) s.phone.email.inbox = [];
    if (!Array.isArray(s.phone.email.sent)) s.phone.email.sent = [];
    if (!Array.isArray(s.phone.email.drafts)) s.phone.email.drafts = [];
    if (!Array.isArray(s.phone.applications)) s.phone.applications = [];
    return s;
}

function getSocialContacts(s) {
    const out = [];
    const seen = new Set();
    const groups = ["friends", "associates", "associate", "romance", "family", "rivals", "npc"];
    for (const group of groups) {
        const list = Array.isArray(s?.social?.[group]) ? s.social[group] : [];
        for (const person of list) {
            const name = String(person?.name || person?.id || "").trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                id: String(person?.id || name),
                name,
                phone: String(person?.phone || person?.number || "Unknown"),
                homeLocation: String(person?.homeLocation || person?.home || person?.location || person?.locId || "Unknown"),
                raw: person,
            });
        }
    }
    return out;
}

export function getContacts() {
    return getSocialContacts(ensureCommunicationsState(getSettings()));
}

function locFromAny(location) {
    if (!location) return null;
    if (typeof location === "object") return location;
    return { id: String(location || "") };
}

function coordOfLocation(s, location) {
    const loc = locFromAny(location);
    if (!loc) return null;
    const direct = loc.coord || loc.coords || loc.position;
    if (direct && typeof direct === "object") return direct;
    if ([loc.x, loc.y, loc.z].some((v) => Number.isFinite(Number(v)))) return { x: loc.x, y: loc.y, z: loc.z };
    const locId = String(loc.id || loc.locId || loc.name || location || "").trim();
    if (!locId) return null;
    const rooms = Array.isArray(s?.worldState?.rooms) ? s.worldState.rooms : Array.isArray(s?.mapData?.rooms) ? s.mapData.rooms : [];
    const room = rooms.find((r) => String(r?.locId || r?.id || r?.name || "") === locId);
    if (room) return room.coord || { x: room.gridX ?? room.x, y: room.gridY ?? room.y, z: room.gridZ ?? room.z };
    return null;
}

export function calculateSpatialDistance(targetLocation, originLocation = null) {
    const s = ensureCommunicationsState(getSettings());
    const origin = originLocation || s.worldState?.currentLocation || s.worldState?.location || s.currentLocation || s.playerCoord || { x: 0, y: 0, z: 0 };
    const a = coordOfLocation(s, origin) || origin;
    const b = coordOfLocation(s, targetLocation) || targetLocation || {};
    const ax = Number(a?.x ?? a?.gridX ?? 0) || 0;
    const ay = Number(a?.y ?? a?.gridY ?? 0) || 0;
    const az = Number(a?.z ?? a?.gridZ ?? 0) || 0;
    const bx = Number(b?.x ?? b?.gridX ?? 0) || 0;
    const by = Number(b?.y ?? b?.gridY ?? 0) || 0;
    const bz = Number(b?.z ?? b?.gridZ ?? 0) || 0;
    return Math.max(1, Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz));
}

function appendMessage(s, msg) {
    s.relationships.messages.push(msg);
    s.relationships.messages = s.relationships.messages.slice(-600);
}

function notifyArrival(text, title = "Communications") {
    try { window.toastr?.info?.(text, title); } catch (_) {
        try { window.showToast?.(text, 4200); } catch (_) {}
    }
}

function _publishOrgIntelFromText(text, source, sourceId, confidence = 0.6) {
    try {
        if (!text || typeof text !== "string" || text.length < 20) return;
        const names = detectOrganizationNamesInText(text);
        for (const name of names) {
            publishOrganizationIntel({
                source,
                sourceId: sourceId || name,
                confidence,
                organizationName: name,
                text: text.slice(0, 400),
                proposedPatch: {
                    runIns: [`${source}: ${text.slice(0, 200)}`],
                    activeHooks: [`Communication received regarding ${name}.`]
                },
                reason: `Organization "${name}" detected in ${source} text.`
            });
        }
    } catch (_) {}
}

async function generateNpcReply(targetNpcId, messageBody, mode) {
    const written = mode === "rpg" || mode === "high-fantasy";
    const prompt = `Generate a concise in-character ${written ? "written missive" : "text message"} reply from ${targetNpcId}. Reply only with the message body. Incoming message: ${messageBody}`;
    try {
        const out = await generateContent(prompt, "communications");
        const text = String(out || "").trim();
        return text || "I received your message.";
    } catch (_) {
        return "I received your message.";
    }
}

export async function sendMessage(targetNpcId, messageBody, targetLocation = null) {
    const s = ensureCommunicationsState(getSettings());
    const mode = getGameMode(s);
    const target = String(targetNpcId || "Unknown").trim() || "Unknown";
    const body = String(messageBody || "").trim();
    if (!body) return null;
    const sentAt = nowMs(s);
    const base = {
        id: id("msg"),
        targetNpcId: target,
        body,
        targetLocation,
        from: "player",
        to: target,
        mode,
        sentAt,
        deliveredAt: mode === "lifesim" ? sentAt : null,
        direction: "outbound",
    };
    appendMessage(s, base);
    if (mode === "lifesim") {
        saveSettings();
        renderCommunicationThreads(target);
        const replyBody = await generateNpcReply(target, body, mode);
        const reply = {
            id: id("msg"),
            targetNpcId: target,
            body: replyBody,
            targetLocation,
            from: target,
            to: "player",
            mode,
            sentAt: nowMs(s),
            deliveredAt: nowMs(s),
            direction: "inbound",
            replyTo: base.id,
        };
        appendMessage(s, reply);
        saveSettings();
        renderCommunicationThreads(target);
        notifyArrival(`New message from ${target}`, "Phone");
        return base;
    }
    const distance = calculateSpatialDistance(targetLocation);
    const travelHours = Math.max(1, distance * Number(s.world.missiveTravelTime || 4));
    s.world.inTransitQueue.push({
        id: id("courier"),
        kind: "outbound",
        messageId: base.id,
        targetNpcId: target,
        body,
        targetLocation,
        originLocation: s.worldState?.currentLocation || s.worldState?.location || s.currentLocation || null,
        deliveryTimestamp: sentAt + travelHours * 3600000,
        travelHours,
    });
    saveSettings();
    renderCommunicationThreads(target);
    notifyArrival(`Missive dispatched to ${target}.`, "Codice");
    _publishOrgIntelFromText(body, "message_sent", base.id, 0.55);
    return base;
}

export function receiveEmail(from = "system@fugue", subject = "Message", body = "", meta = {}) {
    const s = ensureCommunicationsState(getSettings());
    const email = {
        id: id("email"),
        from: String(from || "system@fugue"),
        to: "player",
        subject: String(subject || "Message"),
        body: String(body || ""),
        links: Array.isArray(meta?.links) ? meta.links.slice(0, 8) : [],
        applicationId: meta?.applicationId || "",
        unread: true,
        receivedAt: nowMs(s),
        source: meta?.source || "system"
    };
    s.phone.email.inbox.unshift(email);
    s.phone.email.inbox = s.phone.email.inbox.slice(0, 300);
    saveSettings();
    notifyArrival(`New email: ${email.subject}`, "Email");
    _publishOrgIntelFromText(`${email.from}\n${email.subject}\n${email.body}`, "email", email.id, 0.65);
    return email;
}

export function sendEmail(to = "", subject = "", body = "", links = []) {
    const s = ensureCommunicationsState(getSettings());
    const target = String(to || "").trim() || "contact@fugue";
    const email = {
        id: id("email"),
        from: "player",
        to: target,
        subject: String(subject || "Message"),
        body: String(body || ""),
        links: Array.isArray(links) ? links.slice(0, 8) : [],
        sentAt: nowMs(s),
        deliveredAt: nowMs(s)
    };
    s.phone.email.sent.unshift(email);
    s.phone.email.sent = s.phone.email.sent.slice(0, 300);
    saveSettings();
    _publishOrgIntelFromText(`${email.to}\n${email.subject}\n${email.body}`, "email_sent", email.id, 0.55);
    return email;
}

export function registerApplication(kind = "job", listing = "Application", source = "browser", meta = {}) {
    const s = ensureCommunicationsState(getSettings());
    const type = String(kind || "job").toLowerCase().match(/school|education|academy/) ? "school" : String(kind || "job").toLowerCase().match(/gig|contract|quest/) ? "gig" : "job";
    const title = String(listing || `${type} application`).trim() || `${type} application`;
    const current = nowMs(s);
    const app = {
        id: id("app"),
        type,
        title,
        source: String(source || "browser"),
        url: String(meta?.url || ""),
        status: "submitted",
        submittedAt: current,
        responseDueAt: current + (type === "gig" ? 6 : type === "school" ? 72 : 24) * 3600000
    };
    s.phone.applications.unshift(app);
    s.phone.applications = s.phone.applications.slice(0, 200);
    s.world.inTransitQueue.push({
        id: id("appmail"),
        kind: "application_response",
        channel: "email",
        applicationId: app.id,
        applicationType: type,
        title,
        deliveryTimestamp: app.responseDueAt
    });
    receiveEmail(`${type}s@fugue.local`, `${title} received`, `Your ${type} application for ${title} was registered. Watch for a response after the in-world processing delay.`, { applicationId: app.id, source });
    saveSettings();
    return app;
}

export function receiveMessage(fromNpcId, messageBody, sourceLocation = null, modeHint = "rpg") {
    const s = ensureCommunicationsState(getSettings());
    const from = String(fromNpcId || "Unknown").trim() || "Unknown";
    const body = String(messageBody || "").trim();
    if (!body) return null;
    const current = nowMs(s);
    const msg = {
        id: id("msg"),
        targetNpcId: from,
        body,
        targetLocation: sourceLocation,
        from,
        to: "player",
        mode: modeHint || getGameMode(s),
        sentAt: current,
        deliveredAt: current,
        direction: "inbound",
        source: "ambient",
    };
    appendMessage(s, msg);
    saveSettings();
    renderCommunicationThreads(from);
    notifyArrival(`New letter from ${from}`, "Codice");
    return msg;
}

export async function processTransitQueue() {
    const s = ensureCommunicationsState(getSettings());
    const current = nowMs(s);
    const due = [];
    const pending = [];
    for (const item of s.world.inTransitQueue) {
        if (Number(item?.deliveryTimestamp || 0) <= current) due.push(item);
        else pending.push(item);
    }
    if (!due.length) return [];
    s.world.inTransitQueue = pending;
    const delivered = [];
    for (const item of due) {
        const target = String(item?.targetNpcId || "Unknown");
        if (item.kind === "application_response") {
            const app = s.phone.applications.find((a) => String(a.id) === String(item.applicationId));
            if (app) app.status = "responded";
            receiveEmail(`${item.applicationType || "application"}s@fugue.local`, `${item.title || "Application"} response`, `A response arrived for ${item.title || "your application"}. Check the listing, interview details, school office, or gig board to continue.`, { applicationId: item.applicationId, source: "delayed_application" });
            delivered.push(item);
            continue;
        }
        if (item.kind === "outbound") {
            const original = s.relationships.messages.find((m) => m.id === item.messageId);
            if (original) original.deliveredAt = current;
            const replyBody = await generateNpcReply(target, item.body, "rpg");
            const distance = calculateSpatialDistance(item.originLocation, item.targetLocation);
            const travelHours = Math.max(1, distance * Number(s.world.missiveTravelTime || 4));
            s.world.inTransitQueue.push({
                id: id("courier"),
                kind: "return",
                targetNpcId: target,
                body: replyBody,
                targetLocation: item.originLocation,
                originLocation: item.targetLocation,
                deliveryTimestamp: current + travelHours * 3600000,
                travelHours,
                replyTo: item.messageId,
            });
            delivered.push(item);
        } else {
            const reply = {
                id: id("msg"),
                targetNpcId: target,
                body: String(item.body || ""),
                targetLocation: item.originLocation,
                from: target,
                to: "player",
                mode: "rpg",
                sentAt: Number(item.deliveryTimestamp || current),
                deliveredAt: current,
                direction: "inbound",
                replyTo: item.replyTo,
            };
            appendMessage(s, reply);
            delivered.push(item);
            notifyArrival("A courier has arrived.", "Codice");
            renderCommunicationThreads(target);
        }
    }
    saveSettings();
    return delivered;
}

export function renderCommunicationThreads(activeTarget = "") {
    try {
        const s = ensureCommunicationsState(getSettings());
        const contacts = getSocialContacts(s);
        const list = document.getElementById("uie-device-contact-list");
        if (list) {
            const written = getGameMode(s) === "rpg" || getGameMode(s) === "high-fantasy";
            list.innerHTML = contacts.length ? contacts.map((c) => `<button class="uie-device-contact" data-contact-id="${esc(c.id)}"><strong>${esc(c.name)}</strong><span>${written ? esc(c.homeLocation) : esc(c.phone)}</span></button>`).join("") : `<div class="uie-device-empty">No known contacts.</div>`;
        }
        const target = activeTarget || contacts[0]?.id || contacts[0]?.name || "";
        const thread = document.getElementById("uie-device-thread");
        if (thread) {
            const messages = s.relationships.messages.filter((m) => String(m.targetNpcId || "") === String(target || "") || String(m.from || "") === String(target || "") || String(m.to || "") === String(target || ""));
            thread.innerHTML = messages.length ? messages.slice(-60).map((m) => `<div class="uie-device-msg ${m.direction === "outbound" ? "out" : "in"}">${esc(m.body)}${m.deliveredAt ? "" : `<small>In transit</small>`}</div>`).join("") : `<div class="uie-device-empty">No messages yet.</div>`;
        }
    } catch (_) {}
}

export function initCommunicationsManager() {
    ensureCommunicationsState(getSettings());
    try { window.UIE = window.UIE || {}; window.UIE.communications = { sendMessage, receiveMessage, receiveEmail, sendEmail, registerApplication, processTransitQueue, calculateSpatialDistance, getContacts, renderCommunicationThreads }; } catch (_) {}
}
