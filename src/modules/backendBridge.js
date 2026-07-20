function getDefaultBackendUrl() {
    const base = typeof window !== "undefined" ? String(window.UIE_BASEURL || "./").trim() : "./";
    return `${base.replace(/\/?$/, "/")}api/backend`;
}

function getBackendInfoUrl() {
    const base = typeof window !== "undefined" ? String(window.UIE_BASEURL || "./").trim() : "./";
    return `${base.replace(/\/?$/, "/")}api/backend-info`;
}
const DEFAULT_SCAN_PORTS = [28101, 28102, 28000, 28001, 28002];
const DEFAULT_TIMEOUT_MS = 1200;
const REQUIRED_BACKEND_CAPABILITIES = [
    "assetImages",
    "mapLayout",
    "mapIntercept",
    "worldTick",
];
const REQUIRED_BACKEND_PATHS = [
    "/assets/image/request",
    "/map/layout",
    "/map/intercept",
    "/world/tick",
];

let backendConnection = null;
let handshakePromise = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToFrame() {
    return new Promise((resolve) => {
        try {
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(() => resolve());
                return;
            }
        } catch (_) {}
        setTimeout(resolve, 0);
    });
}

function isLocalBackendUrl(rawUrl) {
    try {
        const pageUrl = typeof window !== "undefined" && window.location ? window.location.href : "http://127.0.0.1/";
        const u = new URL(String(rawUrl || ""), pageUrl);
        const page = new URL(pageUrl);
        return (u.protocol === "http:" || u.protocol === "https:")
            && (u.origin === page.origin || ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname));
    } catch (_) {
        return false;
    }
}

function normalizeBaseUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw || !isLocalBackendUrl(raw)) return "";
    try {
        const pageUrl = typeof window !== "undefined" && window.location ? window.location.href : "http://127.0.0.1/";
        return new URL(raw, pageUrl).toString().replace(/\/+$/, "");
    } catch (_) {
        return "";
    }
}

function authHeaders(connection) {
    const headers = { "X-UIE-Client": "web-frontend" };
    if (connection?.token) headers["X-UIE-Token"] = String(connection.token);
    return headers;
}

function createAbortController(timeoutMs, externalSignal) {
    const controller = new AbortController();
    let timer = 0;
    if (timeoutMs > 0) timer = setTimeout(() => controller.abort(new Error("Backend request timed out")), timeoutMs);
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort(externalSignal.reason);
        else externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
    }
    return {
        signal: controller.signal,
        clear: () => {
            if (timer) clearTimeout(timer);
        },
    };
}

function candidateConnections(seedConnection = null) {
    const out = [];
    if (seedConnection?.baseUrl) out.push(seedConnection);
    try {
        if (window.UIE_BACKEND?.baseUrl) out.push(window.UIE_BACKEND);
    } catch (_) {}

    const configured = normalizeBaseUrl(window.UIE_BACKEND_BASE_URL || "");
    if (configured) {
        out.push({
            baseUrl: configured,
            token: String(window.UIE_BACKEND_TOKEN || ""),
            source: "window",
        });
    }

    out.push({ baseUrl: getDefaultBackendUrl(), token: "", source: "same-origin-proxy" });
    let mayScanLoopback = false;
    try {
        const host = String(window.location?.hostname || "").toLowerCase();
        mayScanLoopback = window.location?.protocol === "file:"
            || ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host);
    } catch (_) {}
    // A browser opened through LAN/HTTPS/reverse proxy must never be redirected
    // to its own 127.0.0.1. The stable same-origin /api/backend route above is
    // the correct route for those deployments.
    if (mayScanLoopback) {
        for (const port of DEFAULT_SCAN_PORTS) out.push({ baseUrl: `http://127.0.0.1:${port}`, token: "", port, source: "scan" });
    }

    const seen = new Set();
    return out.filter((candidate) => {
        const key = `${candidate.baseUrl}|${candidate.token || ""}`;
        if (!candidate.baseUrl || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function missingCapabilitiesFromHealth(health = {}) {
    const caps = health?.capabilities && typeof health.capabilities === "object" ? health.capabilities : null;
    if (!caps) return null;
    return REQUIRED_BACKEND_CAPABILITIES.filter((key) => caps[key] !== true);
}

function missingPathsFromOpenApi(openapi = {}) {
    const paths = openapi?.paths && typeof openapi.paths === "object" ? openapi.paths : {};
    return REQUIRED_BACKEND_PATHS.filter((path) => !Object.prototype.hasOwnProperty.call(paths, path));
}

export async function pingBackend(connection, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const baseUrl = normalizeBaseUrl(connection?.baseUrl);
    if (!baseUrl) return null;

    if (typeof window !== "undefined" && baseUrl.endsWith("/api/backend")) {
        try {
            const now = Date.now();
            let isRunning = false;
            if (window.__uieCachedBackendInfo && (now - (window.__uieCachedBackendInfoTime || 0) < 5000)) {
                isRunning = window.__uieCachedBackendInfo.isRunning;
            } else {
                const infoRes = await fetch(getBackendInfoUrl(), {
                    method: "GET",
                    cache: "no-store",
                    signal: createAbortController(timeoutMs).signal
                });
                if (infoRes.ok) {
                    const info = await infoRes.json().catch(() => ({}));
                    window.__uieCachedBackendInfo = info;
                    window.__uieCachedBackendInfoTime = now;
                    isRunning = info?.isRunning;
                }
            }
            if (!isRunning) {
                return null;
            }
        } catch (_) {
            return null;
        }
    }

    const abort = createAbortController(timeoutMs);
    try {
        const res = await fetch(`${baseUrl}/health`, {
            method: "GET",
            cache: "no-store",
            headers: authHeaders(connection),
            signal: abort.signal,
        });
        if (!res.ok) return null;
        const health = await res.json().catch(() => ({}));
        return { ...connection, baseUrl, health, lastHandshakeAt: Date.now() };
    } catch (_) {
        return null;
    } finally {
        abort.clear();
    }
}

export async function verifyBackendCapabilities(connection, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const baseUrl = normalizeBaseUrl(connection?.baseUrl);
    if (!baseUrl) return null;

    const missingFromHealth = missingCapabilitiesFromHealth(connection?.health || {});
    if (Array.isArray(missingFromHealth) && missingFromHealth.length === 0) {
        return { ...connection, capabilitiesReady: true, missingCapabilities: [] };
    }

    const abort = createAbortController(timeoutMs);
    try {
        const res = await fetch(`${baseUrl}/openapi.json`, {
            method: "GET",
            cache: "no-store",
            headers: authHeaders(connection),
            signal: abort.signal,
        });
        if (!res.ok) return null;
        const openapi = await res.json().catch(() => ({}));
        const missingPaths = missingPathsFromOpenApi(openapi);
        const missing = Array.isArray(missingFromHealth) && missingFromHealth.length
            ? missingFromHealth
            : missingPaths;
        if (missing.length) {
            try {
                window.UIE_BACKEND_MISMATCH = { baseUrl, missingCapabilities: missing, missingPaths };
            } catch (_) {}
            return null;
        }
        return { ...connection, capabilitiesReady: true, missingCapabilities: [], openapiCheckedAt: Date.now() };
    } catch (_) {
        return null;
    } finally {
        abort.clear();
    }
}

export async function discoverBackend({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    try {
        const infoRes = await fetch(getBackendInfoUrl(), {
            method: "GET",
            cache: "no-store",
            signal: createAbortController(timeoutMs).signal
        });
        if (infoRes.ok) {
            const info = await infoRes.json();
            if (info?.url && info?.isRunning) {
                const candidate = { baseUrl: info.url, token: "", source: "dev-server-info" };
                const ready = await pingBackend(candidate, { timeoutMs });
                const verified = ready ? await verifyBackendCapabilities(ready, { timeoutMs }) : null;
                if (verified) {
                    backendConnection = verified;
                    try {
                        window.UIE_BACKEND = verified;
                        window.UIE_BACKEND_MISMATCH = null;
                        window.dispatchEvent(new CustomEvent("uie:backend-ready", { detail: verified }));
                    } catch (_) {}
                    return verified;
                }
            }
        }
    } catch (_) {}

    for (const candidate of candidateConnections()) {
        const ready = await pingBackend(candidate, { timeoutMs });
        const verified = ready ? await verifyBackendCapabilities(ready, { timeoutMs }) : null;
        if (verified) {
            backendConnection = verified;
            try {
                window.UIE_BACKEND = verified;
                window.UIE_BACKEND_MISMATCH = null;
                window.dispatchEvent(new CustomEvent("uie:backend-ready", { detail: verified }));
            } catch (_) {}
            return verified;
        }
        await yieldToFrame();
    }
    return null;
}

export async function waitForBackendHandshake(options = {}) {
    if (backendConnection) return backendConnection;
    if (handshakePromise) return handshakePromise;

    const required = options.required === true;
    const timeoutMs = Number(options.timeoutMs ?? (required ? 30000 : 1800));
    const pollMs = Number(options.pollMs ?? 450);
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : null;

    handshakePromise = (async () => {
        const started = Date.now();
        let attempt = 0;
        while (true) {
            attempt += 1;
            onStatus?.({ attempt, message: attempt === 1 ? "Checking local backend..." : `Checking local backend (${attempt})...` });
            const ready = await discoverBackend({ timeoutMs: Math.min(1500, Math.max(500, pollMs * 2)) });
            if (ready) {
                onStatus?.({ attempt, ready: true, message: "Local backend connected." });
                return ready;
            }
            let mismatch = null;
            try { mismatch = window.UIE_BACKEND_MISMATCH; } catch (_) {}
            if (mismatch?.baseUrl) {
                onStatus?.({
                    attempt,
                    ready: false,
                    message: "Local backend needs restart for newer routes.",
                    mismatch,
                });
            }
            if (!required && Date.now() - started >= timeoutMs) {
                let finalMismatch = null;
                try { finalMismatch = window.UIE_BACKEND_MISMATCH; } catch (_) {}
                onStatus?.({
                    attempt,
                    ready: false,
                    message: finalMismatch?.baseUrl
                        ? "Local backend needs restart for newer routes."
                        : "Local backend offline.",
                    mismatch: finalMismatch || null,
                });
                return null;
            }
            if (Date.now() - started >= timeoutMs) {
                throw new Error("Living world FastAPI backend did not pass /health before startup timed out.");
            }
            await sleep(Math.min(1800, pollMs + attempt * 25));
        }
    })();

    try {
        return await handshakePromise;
    } finally {
        handshakePromise = null;
    }
}

async function getBackendConnection(options = {}) {
    if (backendConnection) return backendConnection;
    return waitForBackendHandshake({ required: options.required === true, timeoutMs: options.timeoutMs });
}

export async function backendFetch(path, options = {}) {
    const connection = await getBackendConnection(options);
    if (!connection) {
        if (options.required === false) return null;
        throw new Error("Living world backend is not connected.");
    }
    const target = String(path || "").startsWith("http")
        ? String(path)
        : `${connection.baseUrl}${String(path || "").startsWith("/") ? "" : "/"}${path || ""}`;
    if (!isLocalBackendUrl(target)) throw new Error("Refusing non-local backend request.");

    const headers = { ...authHeaders(connection), ...(options.headers || {}) };
    let body = options.body;
    if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
    }
    const abort = createAbortController(Number(options.timeoutMs ?? 30000), options.signal);
    try {
        return await fetch(target, {
            method: options.method || (body ? "POST" : "GET"),
            cache: options.cache || "no-store",
            credentials: "omit",
            headers,
            body,
            signal: abort.signal,
        });
    } finally {
        abort.clear();
    }
}

export async function backendJson(path, options = {}) {
    const res = await backendFetch(path, options);
    if (!res) return null;
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (_) {
        data = text;
    }
    if (!res.ok) {
        const detail = typeof data === "object" ? (data?.detail || data?.error) : data;
        throw new Error(`Living world backend ${res.status}: ${detail || res.statusText}`);
    }
    return data;
}

export async function buildBackendUrl(path, options = {}) {
    const connection = await getBackendConnection(options);
    if (!connection) return "";
    const raw = String(path || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${connection.baseUrl}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

async function withAssetAbsoluteUrls(data, options = {}) {
    const asset = data?.asset || data;
    if (asset && typeof asset === "object" && asset.url) {
        asset.urlAbsolute = await buildBackendUrl(asset.url, options).catch(() => "");
    }
    return data;
}

export async function requestServerAssetImage(payload = {}, options = {}) {
    try {
        const data = await backendJson("/assets/image/request", {
            method: "POST",
            json: payload,
            timeoutMs: options.timeoutMs ?? 1600,
            ...options,
        });
        return withAssetAbsoluteUrls(data, options);
    } catch (error) {
        if (options.required === false) return null;
        throw error;
    }
}

export async function getServerAssetImageStatus(assetId, options = {}) {
    const id = encodeURIComponent(String(assetId || ""));
    if (!id) return null;
    try {
        const data = await backendJson(`/assets/image/status/${id}`, {
            timeoutMs: options.timeoutMs ?? 1200,
            ...options,
        });
        return withAssetAbsoluteUrls(data, options);
    } catch (error) {
        if (options.required === false) return null;
        throw error;
    }
}

export function buildCharacterPsychology(input = {}) {
    return {
        name: String(input.name || "Unknown").trim() || "Unknown",
        current_location: String(input.current_location || input.currentLocation || "Starting Location").trim() || "Starting Location",
        daily_routines: input.daily_routines || input.dailyRoutines || {},
        preferences: Array.isArray(input.preferences) ? input.preferences : [],
        relationship_tier: Number.isFinite(Number(input.relationship_tier ?? input.relationshipTier))
            ? Number(input.relationship_tier ?? input.relationshipTier)
            : 0,
        suspicion_quotient: Number.isFinite(Number(input.suspicion_quotient ?? input.suspicionQuotient))
            ? Number(input.suspicion_quotient ?? input.suspicionQuotient)
            : 0,
        current_mood: String(input.current_mood || input.currentMood || "neutral").trim() || "neutral",
        mood_tags: Array.isArray(input.mood_tags || input.moodTags) ? (input.mood_tags || input.moodTags) : [],
        keyword_flags: input.keyword_flags || input.keywordFlags || {},
    };
}

export async function upsertCharacter(character, options = {}) {
    const payload = buildCharacterPsychology(character);
    return backendJson(`/characters/${encodeURIComponent(payload.name)}`, {
        method: "PUT",
        json: payload,
        ...options,
    });
}

export async function createNpc(payload, options = {}) {
    return backendJson("/npc/create", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function requestOrganizationAssets(payload, options = {}) {
    try {
        return await backendJson("/organizations/assets/generate", {
            method: "POST",
            json: payload,
            timeoutMs: options.timeoutMs ?? 1600,
            ...options,
        });
    } catch (error) {
        if (options.required === false) return null;
        throw error;
    }
}

export async function processPlayerAction(payload, options = {}) {
    return backendJson("/action/process", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function runWorldTick(payload = {}, options = {}) {
    return backendJson("/world/tick", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function syncMap(payload = {}, options = {}) {
    return backendJson("/map/sync", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function generateMapLocation(payload = {}, options = {}) {
    logMapPayload("generate-location", payload);
    return backendJson("/map/generate-location", { method: "POST", json: payload, timeoutMs: 22000, ...options });
}

export async function generateMapWorld(payload = {}, options = {}) {
    logMapPayload("generate-world", payload);
    return backendJson("/map/generate-world", { method: "POST", json: payload, timeoutMs: 30000, ...options });
}

export async function scanMapLocations(payload = {}, options = {}) {
    logMapPayload("scan-locations", payload);
    return backendJson("/map/scan-locations", { method: "POST", json: payload, timeoutMs: 22000, ...options });
}

function logMapPayload(operation, payload) {
    try {
        const text = JSON.stringify(payload || {});
        const context = payload?.context || {};
        console.debug("[map-diagnostic]", {
            operation, route: `/map/${operation}`, topLevelFields: Object.keys(payload || {}),
            inboundBytes: new TextEncoder().encode(text).byteLength,
            contextBytes: new TextEncoder().encode(JSON.stringify(context)).byteLength,
            loreCount: Array.isArray(context.lore) ? context.lore.length : 0,
        });
    } catch (_) {}
}

export async function getMapPlacements(location = "", options = {}) {
    const suffix = location ? `?location=${encodeURIComponent(location)}` : "";
    return backendJson(`/map/placements${suffix}`, options);
}

export async function moveCharacter(name, payload = {}, options = {}) {
    return backendJson(`/characters/${encodeURIComponent(name)}/move`, {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function getCharacterSchedule(name, options = {}) {
    return backendJson(`/characters/${encodeURIComponent(name)}/schedule`, options);
}

export async function setCharacterSchedule(name, schedule = [], options = {}) {
    return backendJson(`/characters/${encodeURIComponent(name)}/schedule`, {
        method: "PUT",
        json: { schedule },
        ...options,
    });
}

export async function addCharacterMemory(name, payload = {}, options = {}) {
    return backendJson(`/characters/${encodeURIComponent(name)}/memory`, {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function recallCharacter(name, payload = {}, options = {}) {
    return backendJson(`/characters/${encodeURIComponent(name)}/recall`, {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function getRelationships(name, options = {}) {
    return backendJson(`/characters/${encodeURIComponent(name)}/relationships`, options);
}

export async function linkRelationship(payload = {}, options = {}) {
    return backendJson("/relationships/link", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function planBattle(payload = {}, options = {}) {
    return backendJson("/battle/plan", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function generateEnemy(payload = {}, options = {}) {
    return backendJson("/battle/enemy/generate", {
        method: "POST",
        json: payload,
        timeoutMs: options.timeoutMs ?? 1600,
        ...options,
    });
}

export async function getRecentWorldEvents(limit = 50, options = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return backendJson(`/events/recent?limit=${safeLimit}`, options);
}

export async function getRecentMessages(limit = 50, channel = "", options = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const suffix = channel ? `&channel=${encodeURIComponent(channel)}` : "";
    return backendJson(`/messages/recent?limit=${safeLimit}${suffix}`, options);
}

export async function sendMessage(payload, options = {}) {
    return backendJson("/messages/send", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function sendFeedMessage(payload, options = {}) {
    return backendJson("/feed/send", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function getFeed(payload = {}, options = {}) {
    return backendJson("/feed/recent", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function contactPhone(payload, options = {}) {
    return backendJson("/phone/contact", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export async function textPhone(payload, options = {}) {
    return backendJson("/phone/text", {
        method: "POST",
        json: payload,
        ...options,
    });
}

export function toWebSocketUrl(connection, path = "/ws/stream") {
    const base = new URL(connection.baseUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    const basePath = base.pathname.replace(/\/+$/, "");
    const socketPath = String(path || "/ws/stream").replace(/^\/+/, "");
    base.pathname = `${basePath}/${socketPath}`.replace(/\/{2,}/g, "/");
    base.search = "";
    if (connection.token) base.searchParams.set("token", connection.token);
    return base.toString();
}

export async function createBackendWebSocket(options = {}) {
    const connection = await getBackendConnection(options);
    if (!connection) throw new Error("Living world backend is not connected.");
    const socket = new WebSocket(toWebSocketUrl(connection, options.path || "/ws/stream"), options.protocols);
    socket.addEventListener("open", () => options.onOpen?.());
    socket.addEventListener("message", (event) => {
        let data = event.data;
        try { data = JSON.parse(event.data); } catch (_) {}
        options.onMessage?.(data, event);
    });
    socket.addEventListener("close", (event) => options.onClose?.(event));
    socket.addEventListener("error", (event) => options.onError?.(event));
    return {
        socket,
        connection,
        send: (message) => socket.send(typeof message === "string" ? message : JSON.stringify(message)),
        close: (code = 1000, reason = "client closing") => {
            try { socket.close(code, reason); } catch (_) {}
        },
    };
}

export async function getGameUIState(location = "", character = "") {
    const q = new URLSearchParams();
    if (location) q.set("location", location);
    if (character) q.set("character", character);
    return backendJson(`/state/get-state?${q.toString()}`);
}

export async function updateGameUIState(state) {
    return backendJson("/state/update-state", {
        method: "POST",
        body: JSON.stringify({ state })
    });
}

export async function getBrowserPages() {
    return backendJson("/browser/pages");
}

export async function saveBrowserPage(url, html) {
    return backendJson("/browser/pages", {
        method: "POST",
        body: JSON.stringify({ url, html })
    });
}

export async function getSocialPosts() {
    return backendJson("/social/posts");
}

export async function getInstavibeFeed(sort = "") {
    const qs = sort ? `?sort=${encodeURIComponent(sort)}` : "";
    return backendJson(`/instavibe/feed${qs}`);
}

export async function getInstavibeSettings() {
    return backendJson("/instavibe/settings");
}

export async function saveInstavibeSettings(enabled, sortMode = "for_you") {
    return backendJson("/instavibe/settings", {
        method: "POST",
        body: JSON.stringify({ enabled: !!enabled, sort_mode: sortMode })
    });
}

export async function sendInstavibeEvent(capsule = {}) {
    return backendJson("/instavibe/event", {
        method: "POST",
        body: JSON.stringify(capsule || {})
    });
}

export async function createSocialPost(author, content, tag = "Cozy", tone = "Neutral", mentions = []) {
    return backendJson("/social/posts", {
        method: "POST",
        body: JSON.stringify({ author, content, tag, tone, mentions: Array.isArray(mentions) ? mentions : [] })
    });
}

export async function toggleSocialLike(postId, username) {
    return backendJson("/social/like", {
        method: "POST",
        body: JSON.stringify({ post_id: postId, username })
    });
}

export async function createSocialComment(postId, author, content) {
    return backendJson("/social/comment", {
        method: "POST",
        body: JSON.stringify({ post_id: postId, author, content })
    });
}

export async function extractOrganizationIntel(payload, options = {}) {
    return backendJson("/organizations/extract-intel", {
        method: "POST",
        body: JSON.stringify(payload || {}),
        timeoutMs: options.timeoutMs || 8000,
        signal: options.signal
    });
}

export async function deleteKojiModel(options = {}) {
    return backendJson("/visuals/models/koji/delete", {
        method: "POST",
        timeoutMs: options.timeoutMs ?? 30000,
        ...options,
    });
}

async function uieDeleteKojiModelFlow() {
    const statusEl = document.getElementById("cfg-image-koji-status");
    const confirmMsg =
        "Delete the Koji model? This frees the local image model (~2.4 GB) and removes all leftover files. " +
        "You will need to re-download it to generate images locally.";
    if (typeof window.confirm === "function" && !window.confirm(confirmMsg)) return;
    if (statusEl) statusEl.textContent = "Deleting...";
    try {
        const result = await deleteKojiModel();
        if (result?.ok) {
            if (statusEl) statusEl.textContent = "Deleted.";
            try { window.notify?.("success", "Koji model deleted", "Visual Gen"); } catch (_) {}
        } else {
            const err = result?.error || "unknown error";
            if (statusEl) statusEl.textContent = `Delete failed: ${err}`;
            try { window.notify?.("error", `Koji delete failed: ${err}`, "Visual Gen"); } catch (_) {}
        }
    } catch (error) {
        if (statusEl) statusEl.textContent = `Delete failed: ${error?.message || error}`;
        try { window.notify?.("error", `Koji delete failed: ${error?.message || error}`, "Visual Gen"); } catch (_) {}
    }
}

try {
    window.UIE_BACKEND_BRIDGE = {
        waitForBackendHandshake,
        discoverBackend,
        pingBackend,
        verifyBackendCapabilities,
        backendFetch,
        backendJson,
        buildBackendUrl,
        requestServerAssetImage,
        getServerAssetImageStatus,
        createNpc,
        requestOrganizationAssets,
        extractOrganizationIntel,
        processPlayerAction,
        runWorldTick,
        syncMap,
        getMapPlacements,
        moveCharacter,
        getCharacterSchedule,
        setCharacterSchedule,
        addCharacterMemory,
        recallCharacter,
        getRelationships,
        linkRelationship,
        planBattle,
        upsertCharacter,
        getRecentWorldEvents,
        getRecentMessages,
        sendMessage,
        sendFeedMessage,
        getFeed,
        contactPhone,
        textPhone,
        createBackendWebSocket,
        buildCharacterPsychology,
        getGameUIState,
        updateGameUIState,
        getBrowserPages,
        saveBrowserPage,
        getSocialPosts,
        getInstavibeFeed,
        getInstavibeSettings,
        saveInstavibeSettings,
        sendInstavibeEvent,
        createSocialPost,
        createSocialComment,
        toggleSocialLike,
        deleteKojiModel,
    };
    window.UIE_deleteKojiModel = uieDeleteKojiModelFlow;
} catch (_) {}
