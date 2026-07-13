const tabs = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const target = tabs.find((tab) => String(tab.url || "").includes("/game.html"));
if (!target) throw new Error("game tab not found");

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const browserEvents = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.exceptionThrown" || msg.method === "Runtime.consoleAPICalled") {
    browserEvents.push(msg);
  }
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
  return result.result?.value;
};

await evaluate(`window.UIE_enterGameplay?.(); new Promise(r => setTimeout(r, 800))`);
await send("Runtime.enable");
const report = await evaluate(`(() => {
  const ids = ["nav-north","nav-south","nav-east","nav-west","nav-map","q-menu-hamburger"];
  return ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, missing: true };
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      id,
      display: getComputedStyle(el).display,
      pointer: getComputedStyle(el).pointerEvents,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      hit: hit ? { id: hit.id, className: String(hit.className || ""), tag: hit.tagName } : null,
      stage: document.getElementById("reality-stage") ? {
        display: getComputedStyle(document.getElementById("reality-stage")).display,
        pointer: getComputedStyle(document.getElementById("reality-stage")).pointerEvents,
        bodyFlag: document.body.getAttribute("data-reality-stage")
      } : null
    };
  });
})()`);
console.log(JSON.stringify(report, null, 2));
const clickId = async (id, waitMs = 500) => {
  const point = await evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) return;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
};
const state = () => evaluate(`(() => ({
  location: String(window.UIE?.getSettings?.()?.worldState?.location || ""),
  menu: getComputedStyle(document.getElementById("uie-main-menu")).display,
  map: document.getElementById("uie-map-window") ? getComputedStyle(document.getElementById("uie-map-window")).display : "missing",
  settings: document.getElementById("uie-settings-window") ? getComputedStyle(document.getElementById("uie-settings-window")).display : "missing",
  blockers: Array.from(document.elementsFromPoint(innerWidth / 2, innerHeight / 2)).slice(0, 8).map(el => ({ id: el.id, cls: String(el.className || ""), tag: el.tagName, display: getComputedStyle(el).display, pointer: getComputedStyle(el).pointerEvents }))
}))()`);
const before = await state();
await clickId("nav-north", 1800);
const afterNorth = await state();
await clickId("nav-map", 1200);
const afterMap = await state();
await clickId("uie-map-close", 300);
await clickId("q-menu-hamburger", 500);
const afterMenu = await state();
const systemTab = await evaluate(`(() => {
  const el = document.querySelector('.uie-menu-tab[data-tab="system"]');
  if (!el) return "missing";
  const r = el.getBoundingClientRect();
  return { display: getComputedStyle(el).display, x: r.x, y: r.y, width: r.width, height: r.height };
})()`);
await evaluate(`document.querySelector('.uie-menu-tab[data-tab="system"]')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 300));
await clickId("uie-btn-open-settings", 1200);
const afterSettings = await state();
await clickId("uie-settings-close", 300);
await clickId("nav-south", 1200);
const afterSouth = await state();
await clickId("nav-east", 1200);
const afterEast = await state();
await clickId("nav-west", 1200);
const afterWest = await state();
await clickId("q-menu-hamburger", 300);
await clickId("uie-menu-close", 300);
const afterMenuClose = await state();
console.log(JSON.stringify({ before, afterNorth, afterMap, afterMenu, systemTab, afterSettings, afterSouth, afterEast, afterWest, afterMenuClose }, null, 2));
console.log(JSON.stringify(browserEvents.map((event) => ({
  method: event.method,
  text: event.params?.exceptionDetails?.text || event.params?.args?.map((arg) => arg.value || arg.description).join(" ") || ""
})).filter((event) => /error|exception|reference|navigation|menu|failed/i.test(event.text)), null, 2));
ws.close();
