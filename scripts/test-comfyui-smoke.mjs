import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const mockPort = 18188;
const appPort = 19091;
const mockBase = `http://127.0.0.1:${mockPort}`;
const appBase = `http://127.0.0.1:${appPort}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3nAAAAAASUVORK5CYII=", "base64");

const readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => resolve(body));
  req.on("error", reject);
});

let submittedPrompt = null;
const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", mockBase);
  if (url.pathname === "/system_stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ system: { os: "mock" } }));
  }
  if (url.pathname === "/object_info") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["smoke-model.safetensors"]] } } },
      KSampler: { input: { required: { sampler_name: [["euler", "dpmpp_2m"]], scheduler: [["normal", "karras"]] } } }
    }));
  }
  if (url.pathname === "/prompt" && req.method === "POST") {
    submittedPrompt = JSON.parse(await readBody(req));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ prompt_id: "smoke-prompt" }));
  }
  if (url.pathname === "/history/smoke-prompt") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      "smoke-prompt": { outputs: { "9": { images: [{ filename: "smoke.png", subfolder: "", type: "output" }] } } }
    }));
  }
  if (url.pathname === "/view") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(png);
  }
  res.writeHead(404);
  res.end("not found");
});

const listen = (server, port) => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const waitFor = async (url) => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
};
const forward = async (url, method = "GET", body = null) => {
  const res = await fetch(`${appBase}/api/forward`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, method, headers: body ? { "content-type": "application/json" } : {}, body })
  });
  return res;
};

await listen(mock, mockPort);
const app = spawn(process.execPath, [
  "dev-server.mjs",
  "--host", "127.0.0.1",
  "--port", String(appPort),
  "--no-backend",
  "--no-image-service",
], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, UIE_AUTO_START_BACKEND: "0", UIE_AUTO_IMAGE_SERVICE: "0" },
  stdio: "ignore"
});

try {
  await waitFor(`${appBase}/game.html`);
  const stats = await forward(`${mockBase}/system_stats`);
  assert.equal(stats.status, 200);
  const info = await (await forward(`${mockBase}/object_info`)).json();
  assert.deepEqual(info.CheckpointLoaderSimple.input.required.ckpt_name[0], ["smoke-model.safetensors"]);
  assert.deepEqual(info.KSampler.input.required.sampler_name[0], ["euler", "dpmpp_2m"]);

  const graph = {
    "3": { class_type: "KSampler", inputs: { sampler_name: "euler", scheduler: "normal", steps: 16 } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "smoke-model.safetensors" } },
    "9": { class_type: "SaveImage", inputs: {} }
  };
  const prompt = await forward(`${mockBase}/prompt`, "POST", JSON.stringify({ prompt: graph, client_id: "smoke-client" }));
  assert.equal(prompt.status, 200);
  assert.equal((await prompt.json()).prompt_id, "smoke-prompt");
  assert.equal(submittedPrompt.prompt["4"].inputs.ckpt_name, "smoke-model.safetensors");

  const history = await (await forward(`${mockBase}/history/smoke-prompt`)).json();
  assert.equal(history["smoke-prompt"].outputs["9"].images[0].filename, "smoke.png");
  const image = await forward(`${mockBase}/view?filename=smoke.png&subfolder=&type=output`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.ok((await image.arrayBuffer()).byteLength > 0);
  console.log("comfyui smoke test: ok");
} finally {
  app.kill();
  await new Promise((resolve) => mock.close(resolve));
}
