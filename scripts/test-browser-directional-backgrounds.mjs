import assert from "node:assert/strict";

const tabs = await fetch("http://127.0.0.1:9222/json").then((response) => response.json());
const target = tabs.find((tab) => String(tab.url || "").includes("/game.html"));
if (!target) throw new Error("game tab not found");

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(msg.error.message));
  else resolve(msg.result);
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result?.value;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
for (let attempt = 0; attempt < 40; attempt++) {
  if (await evaluate(`Boolean(window.UIE?.getSettings && document.getElementById("nav-north"))`)) break;
  await wait(250);
}
assert.equal(await evaluate(`Boolean(window.UIE?.getSettings && document.getElementById("nav-north"))`), true, "navigation UI should initialize");
await evaluate(`(async () => {
  window.UIE_enterGameplay?.();
  await new Promise(r => setTimeout(r, 500));
  const s = window.UIE?.getSettings?.();
  s.image = s.image || {};
  s.image.enabled = false;
  s.realityEngine = s.realityEngine || {};
  s.realityEngine.backgrounds = {};
  if (s.realityEngine.worldData?.locationRegistry) s.realityEngine.worldData.locationRegistry.backgrounds = {};
  window.UIE?.saveSettings?.();
})()`);

const results = [];
for (const direction of ["north", "south", "east", "west"]) {
  const result = await evaluate(`(async () => {
    document.getElementById(${JSON.stringify(`nav-${direction}`)})?.click();
    await new Promise(r => setTimeout(r, 100));
    document.getElementById(${JSON.stringify(`nav-${direction}`)})?.click();
    await new Promise(r => setTimeout(r, 900));
    const s = window.UIE?.getSettings?.();
    const location = String(s?.worldState?.location || "");
    const id = location.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    const registry = String(s?.realityEngine?.worldData?.locationRegistry?.backgrounds?.[id] || "");
    const legacy = String(s?.realityEngine?.backgrounds?.[id] || "");
    const reStage = String(document.getElementById("re-bg")?.style?.backgroundImage || "");
    const mainStage = String(document.getElementById("bg1")?.style?.backgroundImage || "");
    const rootStage = String(document.getElementById("game-root")?.style?.backgroundImage || "");
    return { direction: ${JSON.stringify(direction)}, ok: Boolean(location), location, registry, legacy, reStage, mainStage, rootStage };
  })()`);
  results.push(result);
  await wait(100);
}

console.log(JSON.stringify(results, null, 2));
for (const result of results) {
  assert.equal(result.ok, true, `${result.direction} movement should succeed`);
  const bound = result.registry || result.legacy || result.rootStage || result.mainStage || result.reStage;
  const visible = result.rootStage || result.mainStage || result.reStage;
  assert.match(bound, /assets\/backgrounds\//, `${result.direction} should bind a preset background`);
  assert.doesNotMatch(bound, /404|not[-_ ]found|data:image\/svg/i);
  assert.match(visible, /assets\/backgrounds\//, `${result.direction} should update the visible stage`);
}

console.log("browser directional background tests: ok");
ws.close();
