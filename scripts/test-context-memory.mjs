import assert from "node:assert/strict";
import { compactTranscriptTail, retrieveTieredMemoryContext } from "../src/modules/contextMemory.js";

const settings = {
    memories: {
        chunks: [
            {
                start: 0,
                end: 50,
                ts: Date.now() - 1000,
                title: "Rooftop promise",
                facts: ["Alyx promised Ren she would perform Moon on the Water at the rooftop concert."],
                entities: ["Alyx", "Ren"],
                tags: ["concert"],
            },
            {
                start: 50,
                end: 100,
                ts: Date.now() - 2000,
                title: "Unrelated shopping",
                facts: ["The party bought bread at the market."],
                entities: ["market"],
                tags: ["shopping"],
            },
        ],
    },
    databank: [
        { id: "db1", title: "Alyx", summary: "Alyx is the lead UIE.", created: Date.now() },
    ],
    realityEngine: {
        memory: [
            { id: "m1", text: "Ren keeps a spare guitar pick from Alyx.", type: "fact", timestamp: Date.now() },
        ],
    },
};

const recalled = retrieveTieredMemoryContext(settings, "Ren asks Alyx about the rooftop concert", {
    maxItems: 2,
    maxChars: 800,
});
assert.match(recalled, /Rooftop promise/);
assert.doesNotMatch(recalled, /Unrelated shopping/);
assert.ok(recalled.length <= 800);

const transcript = [
    `Story: old scene detail that should be discarded ${"old ".repeat(120)}`,
    `You: another old line ${"earlier ".repeat(80)}`,
    `Story: newest important line ${"recent ".repeat(35)}`,
    "You: final action at the rooftop concert",
].join("\n");
const compacted = compactTranscriptTail(transcript, 400);
assert.match(compacted, /final action/);
assert.doesNotMatch(compacted, /old scene detail/);
assert.ok(compacted.length <= 400);

console.log("context-memory tests passed");
