export function repairJson(str) {
    if (typeof str !== "string") return str;
    let s = str.trim();
    if (!s) return s;

    const tryParse = (val) => {
        try {
            JSON.parse(val);
            return true;
        } catch (_) {
            return false;
        }
    };

    if (tryParse(s)) return s;

    // 1. Strip trailing commas before closing braces/brackets
    s = s.replace(/,\s*([\]}])/g, "$1");
    if (tryParse(s)) return s;

    // 2. Fix unquoted keys
    s = s.replace(/(^|[{,])\s*([a-zA-Z0-9_$]+)\s*:/g, (match, p1, p2) => {
        return p1 + '"' + p2 + '":';
    });
    if (tryParse(s)) return s;

    // We can try applying step 3 and/or step 4
    const s_before_3_4 = s;

    // Try Step 3 (Fixed single quote delimiters regex) then Step 4
    let s3 = s.replace(/(^|[{,:\[]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*[:,\}\]])/g, (match, p1, p2, p3) => {
        return p1 + '"' + p2.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"' + p3;
    });
    if (tryParse(s3)) return s3;

    let s3_4 = s3.replace(/:\s*([^"'{}\[\]\s,][^,}{\[\]\n]*?)\s*(?=,|\}|\])/g, (match, p1) => {
        const val = p1.trim();
        const lower = val.toLowerCase();
        if (lower === "true" || lower === "false" || lower === "null") {
            return ":" + val;
        }
        if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) {
            return ":" + val;
        }
        return ':"' + val.replace(/"/g, '\\"') + '"';
    });
    if (tryParse(s3_4)) return s3_4;

    // If that didn't parse, try only Step 4 (without Step 3) to avoid single-quote corruption
    let s4 = s_before_3_4.replace(/:\s*([^"'{}\[\]\s,][^,}{\[\]\n]*?)\s*(?=,|\}|\])/g, (match, p1) => {
        const val = p1.trim();
        const lower = val.toLowerCase();
        if (lower === "true" || lower === "false" || lower === "null") {
            return ":" + val;
        }
        if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) {
            return ":" + val;
        }
        return ':"' + val.replace(/"/g, '\\"') + '"';
    });
    if (tryParse(s4)) return s4;

    // Default to the version with both, or whatever we have
    return s3_4;
}

export function tryParseJson(text) {
    try {
        return JSON.parse(String(text || "").trim());
    } catch (_) {
        try {
            const repaired = repairJson(String(text || ""));
            return JSON.parse(repaired);
        } catch (__) {
            return null;
        }
    }
}

function stripOuterCodeFence(text) {
    let str = String(text || "").trim();
    if (!str) return "";
    if (str.startsWith("```") && str.endsWith("```")) {
        str = str.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    }
    return str;
}

function extractFencedCandidates(text) {
    const out = [];
    const src = String(text || "");
    const re = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        const candidate = String(m?.[1] || "").trim();
        if (candidate) out.push(candidate);
    }
    return out;
}

function extractBalancedJson(text) {
    const src = String(text || "");
    const start = src.search(/[\[{]/);
    if (start < 0) return "";

    const stack = [src[start]];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < src.length; i++) {
        const ch = src[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === "{" || ch === "[") {
            stack.push(ch);
            continue;
        }

        if (ch === "}" || ch === "]") {
            const top = stack[stack.length - 1];
            const okPair = (top === "{" && ch === "}") || (top === "[" && ch === "]");
            if (!okPair) return "";
            stack.pop();
            if (!stack.length) return src.slice(start, i + 1).trim();
        }
    }

    return "";
}

function parse(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;

    const candidates = [];
    const seen = new Set();
    const push = (candidate) => {
        const c = String(candidate || "").trim();
        if (!c || seen.has(c)) return;
        seen.add(c);
        candidates.push(c);
    };

    push(raw);
    const stripped = stripOuterCodeFence(raw);
    push(stripped);
    for (const c of extractFencedCandidates(raw)) push(c);
    push(extractBalancedJson(raw));
    push(extractBalancedJson(stripped));
    // Some providers return an otherwise valid JSON object as a JSON-encoded
    // string. Unwrap that transport layer and feed it through the same repair
    // and balanced-object extraction paths.
    const encoded = tryParseJson(stripped);
    if (typeof encoded === "string") {
        push(encoded);
        push(extractBalancedJson(encoded));
    }

    for (const c of candidates) {
        const parsed = tryParseJson(c);
        if (typeof parsed === "string") {
            const unwrapped = tryParseJson(parsed);
            if (unwrapped !== null) return unwrapped;
        }
        if (parsed !== null) return parsed;
    }

    return null;
}

/**
 * Parses JSON and ensures it is a non-null object (not array).
 * @param {string} text 
 * @returns {object|null}
 */
export function safeJsonParseObject(text) {
    const res = parse(text);
    return (res && typeof res === "object" && !Array.isArray(res)) ? res : null;
}

/**
 * Parses JSON and ensures it is an array.
 * @param {string} text 
 * @returns {Array|null}
 */
export function safeJsonParseArray(text) {
    const res = parse(text);
    return Array.isArray(res) ? res : null;
}
