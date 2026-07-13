const STOPWORDS = new Set([
    "the", "and", "that", "this", "with", "from", "have", "your", "you", "for", "are", "was",
    "were", "will", "would", "could", "should", "into", "about", "their", "there", "they", "them",
    "then", "than", "when", "what", "where", "which", "while", "just", "like", "been", "being",
]);

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function tokens(value) {
    return Array.from(new Set(
        cleanText(value)
            .toLowerCase()
            .split(/[^a-z0-9']+/g)
            .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    ));
}

function overlapScore(queryTokens, text) {
    if (!queryTokens.length) return 0;
    const haystack = new Set(tokens(text));
    let score = 0;
    for (const token of queryTokens) {
        if (haystack.has(token)) score += token.length >= 7 ? 2 : 1;
    }
    return score;
}

function memoryCandidates(settings) {
    const out = [];
    const chunks = Array.isArray(settings?.memories?.chunks) ? settings.memories.chunks : [];
    for (const chunk of chunks) {
        const facts = Array.isArray(chunk?.facts) ? chunk.facts.map(cleanText).filter(Boolean) : [];
        if (!facts.length) continue;
        out.push({
            id: `chunk:${chunk?.start ?? ""}:${chunk?.end ?? ""}`,
            title: cleanText(chunk?.title || "Episode"),
            text: facts.join("; "),
            entities: Array.isArray(chunk?.entities) ? chunk.entities.map(cleanText).filter(Boolean) : [],
            tags: Array.isArray(chunk?.tags) ? chunk.tags.map(cleanText).filter(Boolean) : [],
            timestamp: Number(chunk?.ts || 0),
            source: "episode",
        });
    }

    const vectorLite = Array.isArray(settings?.realityEngine?.memory) ? settings.realityEngine.memory : [];
    for (const item of vectorLite) {
        const text = cleanText(item?.text);
        if (!text) continue;
        out.push({
            id: `memory:${item?.id || out.length}`,
            title: cleanText(item?.type || "Memory"),
            text,
            entities: [],
            tags: [],
            timestamp: Number(item?.timestamp || 0),
            source: "memory",
        });
    }

    const databank = Array.isArray(settings?.databank) ? settings.databank : [];
    for (const item of databank) {
        const title = cleanText(item?.title || item?.key || "Databank");
        const text = cleanText(item?.summary || item?.content || item?.entry);
        if (!text || /\b(character card|system prompt|author note|metadata|tool card)\b/i.test(`${title} ${text}`)) continue;
        out.push({
            id: `databank:${item?.id || title}`,
            title,
            text,
            entities: [],
            tags: Array.isArray(item?.tags) ? item.tags.map(cleanText).filter(Boolean) : [],
            timestamp: Number(item?.created || item?.ts || 0),
            source: "databank",
        });
    }
    return out;
}

export function retrieveTieredMemoryContext(settings, query, options = {}) {
    const maxItems = Math.max(1, Math.min(8, Number(options.maxItems) || 3));
    const maxChars = Math.max(240, Math.min(6000, Number(options.maxChars) || 1200));
    const queryTokens = tokens(query).slice(0, 80);
    if (!queryTokens.length) return "";

    const now = Date.now();
    const ranked = memoryCandidates(settings)
        .map((item) => {
            const entityText = item.entities.join(" ");
            const tagText = item.tags.join(" ");
            let score = overlapScore(queryTokens, `${item.title} ${item.text}`);
            score += overlapScore(queryTokens, entityText) * 3;
            score += overlapScore(queryTokens, tagText);
            if (item.timestamp > 0 && now - item.timestamp < 1000 * 60 * 60 * 24 * 14) score += 1;
            return { ...item, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

    const lines = [];
    const seen = new Set();
    let used = 0;
    for (const item of ranked) {
        const signature = cleanText(item.text).toLowerCase().slice(0, 160);
        if (!signature || seen.has(signature)) continue;
        seen.add(signature);
        const line = `- [${item.source}] ${item.title}: ${item.text}`.slice(0, 520);
        if (used + line.length + 1 > maxChars && lines.length) break;
        lines.push(line.slice(0, Math.max(0, maxChars - used)));
        used += line.length + 1;
        if (lines.length >= maxItems || used >= maxChars) break;
    }
    return lines.join("\n").trim();
}

export function compactTranscriptTail(transcript, maxChars = 2400) {
    const budget = Math.max(400, Number(maxChars) || 2400);
    const lines = String(transcript || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
    const kept = [];
    let used = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (kept.length && used + line.length + 1 > budget) break;
        kept.unshift(line.slice(-budget));
        used += line.length + 1;
        if (used >= budget) break;
    }
    return kept.join("\n").slice(-budget);
}
