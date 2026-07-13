/**
 * External prompt bundle import / export (JSON with a `prompts` array).
 * Maps into `settings.aiPromptProfiles` and optional preset strings under
 * `settings.generation.stSillyTavernStrings` (legacy settings key; unchanged for backward save compatibility).
 */

export const EXTERNAL_PRESET_STRING_KEYS = [
    "impersonation_prompt",
    "new_chat_prompt",
    "new_group_chat_prompt",
    "new_example_chat_prompt",
    "continue_nudge_prompt",
    "scenario_format",
    "personality_format",
    "group_nudge_prompt",
    "wi_format"
];

export function looksLikeExternalPromptBundle(obj) {
    return Boolean(obj && typeof obj === "object" && Array.isArray(obj.prompts));
}

function slugImportId(id) {
    const raw = String(id || "ext").trim() || "ext";
    return `st_${raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 72)}`;
}

function mapBundlePromptToUieType(p) {
    if (!p || typeof p !== "object") return "story";
    if (p.forbid_overrides === true) return "forbidden";
    if (p.system_prompt === true) return "ai";
    return "story";
}

function buildOrderMap(raw) {
    const map = new Map();
    const lists = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
    for (const block of lists) {
        const ord = Array.isArray(block?.order) ? block.order : [];
        ord.forEach((item, idx) => {
            if (!item || typeof item !== "object") return;
            const id = String(item.identifier || "").trim();
            if (!id) return;
            map.set(id, {
                idx,
                enabled: item.enabled !== false
            });
        });
    }
    return map;
}

/**
 * @param {object} settings - settings object (mutated)
 * @param {object} raw - parsed JSON bundle
 * @param {{ replace?: boolean }} opts - replace=true replaces aiPromptProfiles entirely
 */
export function applyExternalPromptImport(settings, raw, opts = {}) {
    const replace = opts.replace === true;
    if (!looksLikeExternalPromptBundle(raw)) {
        throw new Error("Not a valid prompt bundle: expected an object with a 'prompts' array.");
    }
    const s = settings;
    if (!s.generation || typeof s.generation !== "object") s.generation = {};

    const strings = { ...(s.generation.stSillyTavernStrings || {}) };
    for (const k of EXTERNAL_PRESET_STRING_KEYS) {
        if (typeof raw[k] === "string") strings[k] = raw[k];
    }
    s.generation.stSillyTavernStrings = strings;

    const orderMap = buildOrderMap(raw);
    const out = [];
    let fallback = 0;

    for (const p of raw.prompts) {
        if (!p || typeof p !== "object") continue;
        const identifier = String(p.identifier ?? "").trim() || `anon_${fallback}`;
        const content = String(p.content ?? "").trim();
        if (p.marker === true && !content) {
            fallback++;
            continue;
        }
        const type = mapBundlePromptToUieType(p);
        const om = orderMap.get(identifier);
        const order = om ? om.idx : 1000 + fallback;
        const enabled = om ? om.enabled : p.enabled !== false;

        out.push({
            id: slugImportId(identifier),
            stIdentifier: identifier,
            name: String(p.name || identifier).slice(0, 200),
            type,
            enabled,
            content: String(p.content ?? ""),
            order,
            stMeta: {
                role: String(p.role || "system").trim() || "system",
                system_prompt: p.system_prompt === true,
                marker: p.marker === true,
                injection_position: Number.isFinite(Number(p.injection_position)) ? Number(p.injection_position) : 0,
                injection_depth: Number.isFinite(Number(p.injection_depth)) ? Number(p.injection_depth) : 4,
                forbid_overrides: p.forbid_overrides === true
            }
        });
        fallback++;
    }

    out.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (replace) {
        s.aiPromptProfiles = out;
    } else {
        const cur = Array.isArray(s.aiPromptProfiles) ? s.aiPromptProfiles : [];
        s.aiPromptProfiles = [...cur, ...out];
    }

    return { importedProfiles: out.length, replaced: replace };
}


export function buildExternalPromptExport(settings) {
    const s = settings || {};
    const strIn = (s.generation && s.generation.stSillyTavernStrings) || {};
    const out = {};
    for (const k of EXTERNAL_PRESET_STRING_KEYS) {
        out[k] = typeof strIn[k] === "string" ? strIn[k] : "";
    }

    const profiles = Array.isArray(s.aiPromptProfiles) ? s.aiPromptProfiles : [];
    const sorted = [...profiles].sort((a, b) => (Number(a.order) || 1e6) - (Number(b.order) || 1e6));

    const prompts = sorted.map((p) => {
        const m = p.stMeta && typeof p.stMeta === "object" ? p.stMeta : {};
        const id = String(p.stIdentifier || "").trim() || String(p.id || "").replace(/^st_/, "") || `uie_${p.id || "prompt"}`;

        let system_prompt = m.system_prompt === true;
        let forbid_overrides = m.forbid_overrides === true || p.type === "forbidden";
        if (p.type === "forbidden") {
            forbid_overrides = true;
            system_prompt = false;
        } else if (p.type === "ai") {
            system_prompt = true;
        } else {
            system_prompt = m.system_prompt === true ? true : false;
        }

        return {
            identifier: id,
            name: String(p.name || id).slice(0, 200),
            system_prompt,
            marker: m.marker === true,
            content: String(p.content ?? ""),
            role: String(m.role || (p.type === "ai" ? "system" : "user")).trim() || "system",
            injection_position: Number.isFinite(Number(m.injection_position)) ? Number(m.injection_position) : 0,
            injection_depth: Number.isFinite(Number(m.injection_depth)) ? Number(m.injection_depth) : 4,
            forbid_overrides,
            enabled: p.enabled !== false
        };
    });

    const order = prompts.map((pr) => ({
        identifier: pr.identifier,
        enabled: pr.enabled !== false
    }));

    out.prompts = prompts;
    out.prompt_order = [{ character_id: 100001, order }];
    return out;
}

