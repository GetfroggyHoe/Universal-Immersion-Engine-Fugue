import { spawn } from "node:child_process";

const backendHost = process.env.UIE_BACKEND_HOST || "127.0.0.1";
const backendPort = process.env.UIE_BACKEND_PORT || "28101";
const frontendHost = process.env.UIE_FRONTEND_HOST || "127.0.0.1";
const frontendPort = process.env.UIE_FRONTEND_PORT || "8093";
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) console.log(`[${name}] stopped by ${signal}`);
    else if (code) console.log(`[${name}] exited with ${code}`);
  });
  return child;
}

function shutdown() {
  for (const child of children) {
    try {
      if (!child.killed) child.kill();
    } catch (_) {}
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
process.on("exit", shutdown);

console.log(`Living world backend: http://${backendHost}:${backendPort}`);
console.log(`Game frontend: http://${frontendHost}:${frontendPort}/game.html`);

run("backend", python, ["-m", "uvicorn", "python.uie_backend:app", "--host", backendHost, "--port", backendPort]);
run("frontend", "node", ["dev-server.mjs", "--host", frontendHost, "--port", frontendPort, "--backend-host", backendHost, "--backend-port", backendPort, "--no-backend"]);
