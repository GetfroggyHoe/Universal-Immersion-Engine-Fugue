import assert from "node:assert/strict";
import { extractApiResponseText } from "../src/modules/apiResponse.js";

assert.equal(extractApiResponseText({
  choices: [{ message: { content: "chat text" } }],
}), "chat text");

assert.equal(extractApiResponseText({
  choices: [{ message: { content: [{ type: "text", text: "array chat text" }] } }],
}), "array chat text");

assert.equal(extractApiResponseText({
  output: [
    { type: "reasoning", summary: [] },
    { type: "message", content: [{ type: "output_text", text: "responses text" }] },
  ],
}), "responses text");

assert.equal(extractApiResponseText({
  candidates: [{ content: { parts: [{ text: "gemini text" }] } }],
}), "gemini text");

console.log("api-response-extraction tests: ok");
