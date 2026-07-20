import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForJson(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "no response"}`);
}

const uiPort = await freePort();
const backendPort = await freePort();
const baseUrl = `http://127.0.0.1:${uiPort}`;
const output = [];
const child = spawn(process.execPath, [
  "dev-server.mjs",
  "--host", "127.0.0.1",
  "--port", String(uiPort),
  "--backend-host", "127.0.0.1",
  "--backend-port", String(backendPort),
  "--no-image-service",
], {
  cwd: process.cwd(),
  env: { ...process.env, UIE_VENV_SETUP: "0", UIE_BACKEND_START_TIMEOUT_MS: "45000" },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  const info = await waitForJson(`${baseUrl}/api/backend-info`);
  assert.equal(info.enabled, true);
  assert.equal(info.status, "ready");
  assert.equal(info.isRunning, true);

  const health = await waitForJson(`${baseUrl}/api/backend/health`);
  assert.equal(health.ok, true);
  assert.equal(health.voice_bridge?.ok, true, JSON.stringify(health.voice_bridge));
  assert.equal(health.voice_bridge?.pocket?.ready, true);
  assert.equal(health.voice_bridge?.kokoro?.ready, true);

  const saved = await waitForJson(`${baseUrl}/api/backend/audio/saved-voices`);
  assert.ok(Array.isArray(saved.voices));

  const voices = await waitForJson(`${baseUrl}/api/backend/audio/voices`);
  assert.ok(Array.isArray(voices.engines));
  assert.ok(voices.engines.some((engine) => engine.id === "pocket"));
  assert.ok(voices.engines.some((engine) => engine.id === "kokoro" && engine.available !== false));
  assert.ok(Array.isArray(voices.preset_voices) && voices.preset_voices.length > 0);

  const audioResponse = await fetch(`${baseUrl}/api/backend/audio/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Voice bridge test.", engine_preference: "pocket", voice: voices.default_voice }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!audioResponse.ok) {
    throw new Error(`Voice synthesis failed (${audioResponse.status}): ${await audioResponse.text()}`);
  }
  assert.match(audioResponse.headers.get("content-type") || "", /^audio\/wav/);
  assert.equal(audioResponse.headers.get("x-uie-tts-engine"), "pocket");
  const wav = Buffer.from(await audioResponse.arrayBuffer());
  assert.ok(wav.length > 44, "synthesized WAV must contain audio data");
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");

  console.log(`backend startup/VoiceBridge smoke: ok (${voices.preset_voices.length} Pocket voices, ${wav.length} byte WAV)`);
} catch (error) {
  console.error(output.join(""));
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
