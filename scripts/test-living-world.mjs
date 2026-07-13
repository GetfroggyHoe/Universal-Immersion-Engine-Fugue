const baseUrl = process.env.UIE_BACKEND_BASE_URL || "http://127.0.0.1:8101";

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${text}`);
  return data;
}

async function post(path, body) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

async function put(path, body) {
  return request(path, { method: "PUT", body: JSON.stringify(body) });
}

const health = await request("/health");
if (!health.ok) throw new Error("backend health failed");

await post("/map/sync", {
  current_location: "Town Square",
  places: [
    { id: "town_square", name: "Town Square", layer: "local", x: 0.5, y: 0.5, tags: ["public", "social"] },
    { id: "training_yard", name: "Training Yard", layer: "local", x: 0.7, y: 0.4, tags: ["battle", "practice"] },
    { id: "cafe", name: "Cafe", layer: "local", x: 0.4, y: 0.6, tags: ["food", "social"] },
  ],
});

await post("/npc/create", {
  name: "Smoke Mira",
  role: "wandering tactician",
  likes: ["maps", "clever plans"],
  dislikes: ["wasted motion"],
  location: "Town Square",
  party: "main",
  memory_profile: { reliability: 0.95, retention: 120 },
  stats: { tactics: 9, agility: 7 },
});

await post("/npc/create", {
  name: "Smoke Jun",
  role: "guard",
  likes: ["training", "honesty"],
  dislikes: ["ambushes"],
  location: "Town Square",
  memory_profile: { reliability: 0.45, distortion_chance: 0.5, forgets_names: true },
  stats: { strength: 8, resolve: 7 },
});

await post("/relationships/link", {
  a: "Smoke Mira",
  b: "Smoke Jun",
  affinity: 8,
  trust: 5,
  note: "They have trained together before.",
});

await post("/characters/Smoke%20Jun/memory", {
  kind: "warning",
  text: "Smoke Jun saw the User open with a stealth ambush near Town Square.",
  importance: 0.9,
  tags: ["battle", "user", "ambush"],
});

const recall = await post("/characters/Smoke%20Jun/recall", { query: "User ambush", limit: 5 });
if (!Array.isArray(recall.memories)) throw new Error("recall did not return memories");

const action = await post("/action/process", {
  actor: "User",
  action: "stealth ambush, guard, then ranged magic",
  location: "Town Square",
  tags: ["battle"],
  tactic: { opener: "stealth ambush", defense: "guard", finish: "ranged magic" },
});
if (!action.observed_by.includes("Smoke Mira") && !action.observed_by.includes("Smoke Jun")) {
  throw new Error("no NPC observed user tactic");
}

const plan = await post("/battle/plan", {
  character: "Smoke Mira",
  opponent: "User",
  context: { terrain: "open plaza" },
});
if (!plan.ok || !plan.plan.uses_seen_user_tactics) throw new Error("battle plan did not use observed tactics");

await post("/feed/send", {
  sender: "Smoke Mira",
  recipient: "",
  channel: "world",
  text: "Smoke test world feed entry.",
  location: "Town Square",
});

await post("/phone/text", {
  caller: "User",
  recipient: "Smoke Mira",
  text: "Can you send the plan?",
  location: "Town Square",
});

const tick = await post("/world/tick", {
  minutes: 60,
  current_location: "Town Square",
  active_party: "main",
  user_available: true,
});
if (!tick.ok || !Array.isArray(tick.characters)) throw new Error("world tick failed");

const placements = await request("/map/placements");
if (!placements.characters.some((item) => item.name === "Smoke Mira")) throw new Error("map placements missing Smoke Mira");

const feed = await post("/feed/recent", { channel: "world", limit: 10 });
if (!Array.isArray(feed.messages)) throw new Error("feed failed");

console.log("living-world smoke tests: ok");
