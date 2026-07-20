import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const devServer = fileURLToPath(new URL("../dev-server.mjs", import.meta.url));

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestGame(port) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/game.html`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.includes("<title>UIE: Fugue</title>")) request.destroy();
      });
      response.on("end", () => resolve(response.statusCode === 200 && body.includes("<title>UIE: Fugue</title>")));
      response.on("close", () => resolve(response.statusCode === 200 && body.includes("<title>UIE: Fugue</title>")));
    });
    request.once("error", () => resolve(false));
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForGame(port, child, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Primary dev server exited early with ${child.exitCode}.`);
    if (await requestGame(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the dev server on port ${port}.`);
}

function capture(child) {
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk; });
  child.stderr?.on("data", (chunk) => { output += chunk; });
  return () => output;
}

function waitForExit(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out waiting for the duplicate launcher to exit."));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

const port = await reservePort();
const commonArgs = [devServer, "--host", "127.0.0.1", "--port", String(port), "--no-backend", "--no-image-service"];
const childOptions = {
  cwd: rootDir,
  env: { ...process.env, UIE_AUTO_START_BACKEND: "0", UIE_AUTO_IMAGE_SERVICE: "0" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
};

const primary = spawn(process.execPath, commonArgs, childOptions);
const primaryOutput = capture(primary);

try {
  await waitForGame(port, primary);

  const duplicate = spawn(process.execPath, [...commonArgs, "--reuse-existing"], childOptions);
  const duplicateOutput = capture(duplicate);
  const code = await waitForExit(duplicate);

  assert.equal(code, 0, duplicateOutput());
  assert.match(duplicateOutput(), /UIE is already running/);
  assert.match(duplicateOutput(), new RegExp(`localhost:${port}/game\\.html`));
  console.log("startup behavior: cold start served UIE and duplicate launch exited cleanly");
} finally {
  if (primary.exitCode === null) primary.kill();
  await Promise.race([
    waitForExit(primary, 2_000).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 2_100)),
  ]);
  if (primary.exitCode && primary.exitCode !== 143) process.stderr.write(primaryOutput());
}
