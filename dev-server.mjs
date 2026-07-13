import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

const args = process.argv.slice(2);
const getArgValue = (key, fallback) => {
  const idx = args.indexOf(key);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
};

const host = getArgValue("--host", "localhost");
const port = Number.parseInt(getArgValue("--port", "8093"), 10) || 8093;
const backendHost = getArgValue("--backend-host", process.env.UIE_BACKEND_HOST || "127.0.0.1");
const configuredBackendPort = Number.parseInt(getArgValue("--backend-port", process.env.UIE_BACKEND_PORT || "28101"), 10) || 28101;
let activeBackendPort = configuredBackendPort;
const shouldAutoStartBackend = !args.includes("--no-backend") && process.env.UIE_AUTO_START_BACKEND !== "0";
const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
let backendProcess = null;

// ---- SDXS Image Service sidecar ----
const IMAGE_SERVICE_PORT = Number.parseInt(process.env.UIE_IMAGE_SERVICE_PORT || "28094", 10) || 28094;
const shouldAutoStartImageService = !args.includes("--no-image-service") && process.env.UIE_AUTO_IMAGE_SERVICE !== "0";
let imageServiceProcess = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const rewriteLegacyPrefix = (urlPath) => {
  const src = String(urlPath || "/");
  if (src.startsWith("/UIEGame/")) return src.replace("/UIEGame/", "/");
  if (src === "/UIEGame") return "/";
  return src;
};

const resolveSafePath = (urlPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(rewriteLegacyPrefix(urlPath).split("?")[0] || "/");
  } catch {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(rootDir, normalized);
  const absolute = path.resolve(candidate);
  const absoluteRoot = path.resolve(rootDir);
  const relative = path.relative(absoluteRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
};

const sendFile = async (req, res, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      try {
        await fs.access(indexPath);
        return sendFile(req, res, indexPath);
      } catch {
        const entries = await fs.readdir(filePath, { withFileTypes: true });
        const relDir = path.relative(rootDir, filePath).replace(/\\/g, "/");
        const baseHref = relDir ? `/${relDir}/` : "/";
        const list = entries
          .map((entry) => {
            const suffix = entry.isDirectory() ? "/" : "";
            const name = `${entry.name}${suffix}`;
            const encoded = encodeURIComponent(entry.name).replace(/%2F/g, "/") + suffix;
            return `<li><a href="${baseHref}${encoded}">${name}</a></li>`;
          })
          .join("");
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Index of ${baseHref}</title></head><body><h1>Index of ${baseHref}</h1><ul>${list}</ul></body></html>`;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
          "Access-Control-Allow-Headers": "*"
        });
        res.end(html);
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || "application/octet-stream";
    
    // Smart Caching: Cache large assets like images & fonts for 1 day to make local loading instant,
    // while keeping HTML, JS, CSS, and manifest files uncached for instant development updates.
    let cacheControl = "no-store, no-cache, must-revalidate, proxy-revalidate";
    let pragma = "no-cache";
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"].includes(ext)) {
      cacheControl = "public, max-age=86400";
      pragma = "public";
    }
    
    const headers = {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      "Pragma": pragma,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*"
    };
    if (cacheControl.includes("no-cache")) {
      headers["Expires"] = "0";
    }
    
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const data = await fs.readFile(filePath);
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    // If base file not found, try common image extensions (for extension-less asset requests)
    const ext = path.extname(filePath);
    if (!ext) {
      const candidates = [".png", ".jpg", ".jpeg", ".webp"];
      for (const candidateExt of candidates) {
        const altPath = filePath + candidateExt;
        try {
          const altStat = await fs.stat(altPath);
          if (altStat.isFile()) {
            return sendFile(req, res, altPath);
          }
        } catch (_) {}
      }
    }
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*"
    });
    res.end("Not found");
  }
};

const getLanIps = () => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const item of iface || []) {
      if (item.family === "IPv4" && !item.internal) ips.push(item.address);
    }
  }
  return [...new Set(ips)];
};

const readBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
};

function requestUrl(url, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function tcpPortOpen(hostname, portNumber, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port: portNumber });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

async function isBackendRunning(portNumber = activeBackendPort) {
  return requestUrl(`http://${backendHost}:${portNumber}/health`);
}

async function selectBackendPort() {
  const candidates = [configuredBackendPort, 28102, 28000, 28001, 28002]
    .filter((value, index, arr) => Number.isFinite(value) && value > 0 && arr.indexOf(value) === index);
  for (const candidate of candidates) {
    if (await isBackendRunning(candidate)) return { port: candidate, alreadyRunning: true };
  }
  for (const candidate of candidates) {
    if (!(await tcpPortOpen(backendHost, candidate))) return { port: candidate, alreadyRunning: false };
    console.warn(`FastAPI backend port ${candidate} is occupied but did not answer /health; trying next port.`);
  }
  return { port: candidates[0] || configuredBackendPort, alreadyRunning: false };
}

async function startBackendIfNeeded() {
  if (!shouldAutoStartBackend) return;
  const selected = await selectBackendPort();
  activeBackendPort = selected.port;
  process.env.UIE_BACKEND_PORT = String(activeBackendPort);
  if (selected.alreadyRunning) {
    console.log(`FastAPI audio/living backend already running: http://${backendHost}:${activeBackendPort}`);
    return;
  }
  backendProcess = spawn(pythonCmd, ["-m", "uvicorn", "python.uie_backend:app", "--host", backendHost, "--port", String(activeBackendPort)], {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  backendProcess.on("error", (err) => {
    console.warn(`[backend] failed to start: ${err.message}`);
    backendProcess = null;
  });
  backendProcess.on("exit", (code, signal) => {
    if (signal) console.log(`[backend] stopped by ${signal}`);
    else if (code) console.log(`[backend] exited with ${code}`);
    backendProcess = null;
  });
  console.log(`Starting FastAPI audio/living backend: http://${backendHost}:${activeBackendPort}`);
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  try { backendProcess.kill(); } catch (_) {}
}

async function isImageServiceRunning(p) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: p, path: "/health", method: "GET", timeout: 1000 },
      (res) => { resolve(res.statusCode === 200); }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function startImageServiceIfNeeded() {
  if (!shouldAutoStartImageService) return;
  const alreadyUp = await isImageServiceRunning(IMAGE_SERVICE_PORT);
  if (alreadyUp) {
    console.log(`[image-service] Already running: http://127.0.0.1:${IMAGE_SERVICE_PORT}`);
    return;
  }
  console.log(`[image-service] Starting SDXS image service on port ${IMAGE_SERVICE_PORT}...`);
  imageServiceProcess = spawn(
    pythonCmd,
    ["-m", "uvicorn", "python.image_service:app", "--host", "127.0.0.1", "--port", String(IMAGE_SERVICE_PORT)],
    {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    }
  );
  imageServiceProcess.on("error", (err) => {
    console.warn(`[image-service] failed to start: ${err.message}`);
    imageServiceProcess = null;
  });
  imageServiceProcess.on("exit", (code, signal) => {
    if (signal) console.log(`[image-service] stopped by ${signal}`);
    else if (code) console.log(`[image-service] exited with code ${code}`);
    imageServiceProcess = null;
  });
}

function stopImageService() {
  if (!imageServiceProcess || imageServiceProcess.killed) return;
  try { imageServiceProcess.kill(); } catch (_) {}
}

const listCharacterSprites = async (characterName) => {
  const requestedName = String(characterName || "").trim();
  if (!requestedName) return [];

  const spriteRoots = [
    path.join(rootDir, "assets", "Sprites"),
    path.join(rootDir, "assets", "characters")
  ];
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const sprites = [];

  for (const spriteRoot of spriteRoots) {
    let entries = [];
    try {
      entries = await fs.readdir(spriteRoot, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    const characterDir = entries.find((entry) =>
      entry.isDirectory() && entry.name.localeCompare(requestedName, undefined, { sensitivity: "base" }) === 0
    );
    if (!characterDir) continue;

    const absoluteDir = path.join(spriteRoot, characterDir.name);
    let files = [];
    try {
      files = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const file of files) {
      if (!file.isFile() || !imageExtensions.has(path.extname(file.name).toLowerCase())) continue;
      const label = path.basename(file.name, path.extname(file.name)).replace(/-\d+$/, "");
      const relativePath = path.relative(rootDir, path.join(absoluteDir, file.name)).replace(/\\/g, "/");
      sprites.push({ label, path: `/${relativePath}` });
    }
  }

  return sprites;
};

const handleProxyRequest = async (req, res, targetUrl, method, headers, body) => {
  try {
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end("Missing target URL");
      return;
    }
    
    // Safety check: avoid looping proxy requests on the same port of local host
    try {
      const u = new URL(targetUrl);
      const isLoop = (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0") && Number(u.port || 80) === port;
      if (isLoop) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Proxy loop detected");
        return;
      }
    } catch (_) {
      if (targetUrl.includes(`127.0.0.1:${port}`) || targetUrl.includes(`localhost:${port}`)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Proxy loop detected");
        return;
      }
    }

    console.log(`[Proxy] ${method} ${targetUrl}`);

    const fetchHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (["host", "connection", "content-length", "origin", "referer", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest", "transfer-encoding", "te"].includes(lower)) {
        continue;
      }
      fetchHeaders[k] = v;
    }

    const fetchOptions = {
      method: method,
      headers: fetchHeaders
    };

    if (body && method !== "GET" && method !== "HEAD") {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    const resHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*",
      "x-uie-proxy": "true"
    };

    for (const [k, v] of response.headers.entries()) {
      const lower = k.toLowerCase();
      if (["content-encoding", "transfer-encoding", "connection", "access-control-allow-origin", "x-uie-proxy"].includes(lower)) {
        continue;
      }
      resHeaders[k] = v;
    }

    res.writeHead(response.status, resHeaders);
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(`[Proxy Error] Failed to proxy to ${targetUrl}:`, err);
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(`Proxy error: ${err.message}`);
  }
};

const scanAudioFiles = async (dirPath, baseDirName) => {
  const list = [];
  const genres = new Set();
  
  const scan = async (currentDir, relSubDir = "") => {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subGenre = entry.name;
        genres.add(subGenre);
        await scan(path.join(currentDir, entry.name), path.join(relSubDir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a", ".webm"].includes(ext)) {
          const genre = relSubDir ? path.basename(relSubDir) : "General";
          const normPath = path.join(baseDirName, relSubDir, entry.name).replace(/\\/g, "/");
          list.push({
            name: entry.name,
            path: `/${normPath}`,
            genre: genre
          });
        }
      }
    }
  };
  
  await scan(dirPath);
  return { list, genres: Array.from(genres) };
};

const server = http.createServer(async (req, res) => {
  // CORS Preflight handling
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400"
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || "/", "http://localhost");
  let reqUrl = rewriteLegacyPrefix(parsedUrl.pathname);

  // CSRF token route fallback
  if (reqUrl === "/csrf-token") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ csrfToken: "dev-token-for-local-development" }));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/sprites/get") {
    const sprites = await listCharacterSprites(parsedUrl.searchParams.get("name"));
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(sprites));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/backend-info") {
    const backendUrl = `http://${backendHost}:${activeBackendPort}`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({
      port: activeBackendPort,
      url: backendUrl,
      host: backendHost,
      isRunning: await isBackendRunning(activeBackendPort)
    }));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/character-cards/list") {
    const cardsDir = path.join(rootDir, "assets", "Character Cards");
    const cards = [];
    try {
      const entries = await fs.readdir(cardsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
          cards.push({
            name: entry.name,
            path: `assets/Character Cards/${entry.name}`
          });
        }
      }
    } catch (_) {}
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(cards));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/lorebooks/list") {
    const loreDir = path.join(rootDir, "assets", "Lorebooks");
    const lorebooks = [];
    try {
      const entries = await fs.readdir(loreDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
          lorebooks.push({
            name: entry.name,
            path: `assets/Lorebooks/${entry.name}`
          });
        }
      }
    } catch (_) {}
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(lorebooks));
    return;
  }

  if (req.method === "GET" && reqUrl === "/api/music/list") {
    const allTracks = [];
    const allGenres = new Set(["General", "Chill", "Battle", "Boss"]);
    
    const primaryMusicPath = path.join(rootDir, "assets", "audio", "Music");
    try {
      await fs.mkdir(primaryMusicPath, { recursive: true });
    } catch (_) {}
    const primaryScan = await scanAudioFiles(primaryMusicPath, "assets/audio/Music");
    allTracks.push(...primaryScan.list);
    primaryScan.genres.forEach(g => allGenres.add(g));
    
    try {
      const p = path.join(rootDir, "Music");
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        const rootScan = await scanAudioFiles(p, "Music");
        allTracks.push(...rootScan.list);
        rootScan.genres.forEach(g => allGenres.add(g));
      }
    } catch (_) {}

    try {
      const p = path.join(rootDir, "music");
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        const rootScanLower = await scanAudioFiles(p, "music");
        allTracks.push(...rootScanLower.list);
        rootScanLower.genres.forEach(g => allGenres.add(g));
      }
    } catch (_) {}

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ tracks: allTracks, genres: Array.from(allGenres) }));
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/music/add-genre") {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const genre = String(payload.genre || "").trim();
      if (!genre) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Missing genre");
        return;
      }
      
      const primaryMusicPath = path.join(rootDir, "assets", "audio", "Music");
      await fs.mkdir(path.join(primaryMusicPath, genre), { recursive: true });
      
      try {
        const p = path.join(rootDir, "Music");
        const stat = await fs.stat(p);
        if (stat.isDirectory()) await fs.mkdir(path.join(p, genre), { recursive: true });
      } catch (_) {}
      
      try {
        const p = path.join(rootDir, "music");
        const stat = await fs.stat(p);
        if (stat.isDirectory()) await fs.mkdir(path.join(p, genre), { recursive: true });
      } catch (_) {}
      
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(err.message);
    }
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/music/set-genre") {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const relativeFilePath = String(payload.filePath || "").trim();
      const genre = String(payload.genre || "").trim();
      
      if (!relativeFilePath || !genre) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Missing filePath or genre");
        return;
      }
      
      const sourceAbsPath = resolveSafePath(relativeFilePath);
      if (!sourceAbsPath) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Invalid file path");
        return;
      }
      
      let baseDir = "";
      if (sourceAbsPath.includes(path.join("assets", "audio", "Music"))) {
        baseDir = path.join(rootDir, "assets", "audio", "Music");
      } else if (sourceAbsPath.includes(path.join(rootDir, "Music"))) {
        baseDir = path.join(rootDir, "Music");
      } else if (sourceAbsPath.includes(path.join(rootDir, "music"))) {
        baseDir = path.join(rootDir, "music");
      } else {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("File is not inside a recognized music folder");
        return;
      }
      
      const filename = path.basename(sourceAbsPath);
      let destDir = baseDir;
      if (genre !== "General") {
        destDir = path.join(baseDir, genre);
      }
      
      await fs.mkdir(destDir, { recursive: true });
      const destAbsPath = path.join(destDir, filename);
      
      await fs.rename(sourceAbsPath, destAbsPath);
      
      const newRelativePath = "/" + path.relative(rootDir, destAbsPath).replace(/\\/g, "/");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ success: true, newPath: newRelativePath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(err.message);
    }
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/music/upload") {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const filename = String(payload.filename || "").trim();
      const dataUrl = String(payload.dataUrl || "").trim();
      
      if (!filename || !dataUrl) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end("Missing filename or dataUrl");
        return;
      }
      
      const base64Data = dataUrl.split(";base64,").pop();
      const buffer = Buffer.from(base64Data, "base64");
      
      const primaryMusicPath = path.join(rootDir, "assets", "audio", "Music");
      await fs.mkdir(primaryMusicPath, { recursive: true });
      const targetPath = path.join(primaryMusicPath, filename);
      
      await fs.writeFile(targetPath, buffer);
      
      const newRelativePath = "/assets/audio/Music/" + filename;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify({ success: true, path: newRelativePath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(err.message);
    }
    return;
  }

  // Local CORS proxy logic
  let targetUrl = "";
  let isJsonProxy = false;

  const jsonProxyPaths = ["/api/forward", "/api/proxy", "/api/cors-proxy", "/api/corsProxy"];
  const hasUrlParam = parsedUrl.searchParams.has("url");
  const isJsonRequest = req.method === "POST" && jsonProxyPaths.includes(reqUrl) && !hasUrlParam;

  if (isJsonRequest) {
    isJsonProxy = true;
  } else {
    // Check if target URL is in query params
    targetUrl = parsedUrl.searchParams.get("url") || "";

    // If not, check path-based encoded URL parameter
    if (!targetUrl) {
      const pathPrefixes = [
        "/api/proxy/", "/proxy/",
        "/api/cors-proxy/", "/cors-proxy/",
        "/api/corsProxy/", "/corsProxy/",
        "/api/openrouter/v1/chat/completions/",
        "/api/openrouter/v1/models/"
      ];
      for (const prefix of pathPrefixes) {
        if (reqUrl.startsWith(prefix)) {
          const rest = reqUrl.substring(prefix.length);
          try {
            targetUrl = decodeURIComponent(rest);
          } catch (_) {}
          if (targetUrl) break;
        }
      }
    }
  }

  if (isJsonProxy) {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || "{}");
      const url = payload.url;
      const method = payload.method || "POST";
      const headers = payload.headers || {};
      const body = payload.body;
      await handleProxyRequest(req, res, url, method, headers, body);
      return;
    } catch (err) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(`Bad proxy payload: ${err.message}`);
      return;
    }
  }

  if (targetUrl) {
    const rawBody = await readBody(req);
    await handleProxyRequest(req, res, targetUrl, req.method, req.headers, rawBody);
    return;
  }

  const safePath = resolveSafePath(reqUrl);
  if (!safePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (reqUrl === "/" || reqUrl === "") {
    await sendFile(req, res, path.join(rootDir, "game.html"));
    return;
  }

  await sendFile(req, res, safePath);
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    void (async () => {
      const existingUi = await requestUrl(`http://127.0.0.1:${port}/game.html`, 700)
        || await requestUrl(`http://localhost:${port}/game.html`, 700);
      if (existingUi) {
        console.log(`UIE is already running on port ${port}.`);
        console.log(`Open: http://localhost:${port}/game.html`);
        process.exit(0);
        return;
      }
      console.error(`UIE server cannot start: ${host}:${port} is already in use by another app.`);
      console.error(`Close the app using port ${port}, then run npm run start:mobile again.`);
      stopBackend();
      stopImageService();
      process.exit(1);
    })();
    return;
  } else {
    console.error(`UIE server failed to start: ${err?.message || err}`);
  }
  stopBackend();
  stopImageService();
  process.exit(1);
});

server.listen(port, host, () => {
  const localUrl = `http://localhost:${port}/game.html`;
  console.log("UIE local server is running.");
  console.log(`Open on this device: ${localUrl}`);
  if (process.env.TERMUX_VERSION) {
    console.log("Termux: open in browser → termux-open-url " + localUrl);
  }
  const lanIps = getLanIps();
  if (host === "0.0.0.0" && lanIps.length) {
    for (const ip of lanIps) {
      console.log(`Other devices on LAN: http://${ip}:${port}/game.html`);
    }
  } else if (host === "0.0.0.0") {
    console.log("LAN: no non-loopback IPv4 found; other devices may still reach this host via its IP.");
  }
  console.log("Press Ctrl+C to stop.");
  void startBackendIfNeeded();
  void startImageServiceIfNeeded();
});

process.on("SIGINT", () => {
  stopBackend();
  stopImageService();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopBackend();
  stopImageService();
  process.exit(143);
});
process.on("exit", () => { stopBackend(); stopImageService(); });
