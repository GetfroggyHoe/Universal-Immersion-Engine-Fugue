function joinTextParts(parts = []) {
    return parts
        .map((part) => typeof part === "string" ? part : (part?.text ?? part?.content ?? ""))
        .filter((part) => typeof part === "string" && part.trim())
        .join("\n");
}

/** Remove output that the UI must never surface, including structured JSON fields. */
function sanitizeResponseText(value) {
    return String(value || "").replace(/\bnana\b/ig, "").replace(/\s{2,}/g, " ").trim();
}

export function extractApiResponseText(data) {
    try {
        const choice = data?.choices?.[0];
        const messageText = choice?.message?.content;
        if (typeof messageText === "string" && messageText.trim()) return sanitizeResponseText(messageText);
        if (Array.isArray(messageText)) {
            const joined = joinTextParts(messageText);
            if (joined.trim()) return sanitizeResponseText(joined);
        }

        const completionText = choice?.text;
        if (typeof completionText === "string" && completionText.trim()) return sanitizeResponseText(completionText);

        const outputText = data?.output_text;
        if (typeof outputText === "string" && outputText.trim()) return sanitizeResponseText(outputText);
        if (Array.isArray(data?.output)) {
            const joined = joinTextParts(data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []));
            if (joined.trim()) return sanitizeResponseText(joined);
        }

        if (Array.isArray(data?.content)) {
            const joined = joinTextParts(data.content);
            if (joined.trim()) return sanitizeResponseText(joined);
        }

        const geminiParts = data?.candidates?.[0]?.content?.parts;
        if (Array.isArray(geminiParts)) {
            const joined = joinTextParts(geminiParts);
            if (joined.trim()) return sanitizeResponseText(joined);
        }

        const generatedText = data?.generated_text;
        if (typeof generatedText === "string" && generatedText.trim()) return sanitizeResponseText(generatedText);
        const simpleText = data?.result || data?.response || data?.data;
        if (typeof simpleText === "string" && simpleText.trim()) return sanitizeResponseText(simpleText);
    } catch (_) {}
    return "";
}
