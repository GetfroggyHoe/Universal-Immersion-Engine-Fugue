import { getSettings } from "./core.js";
import { generateContent } from "./apiClient.js";

const READ_ACTION_RE = /\b(read|open|study|inspect|examine|look\s+at|check|view|unroll|browse|flip\s+through|decode|translate)\b/i;
const READABLE_NOUN_RE = /\b(book|books|letter|letters|scroll|scrolls|board|notice\s+board|bulletin\s+board|sign|signs|document|documents|dpocument|dpocuments|paper|papers|note|notes|journal|journals|ledger|ledgers|codex|tome|tomes|manual|manuals|tablet|tablets|file|files|dossier|dossiers|page|pages)\b/i;

let mounted = false;
let activeReader = { title: "Readable", pages: [], index: 0 };
const askedKeys = new Set();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripCodeFences(value) {
  return String(value || "")
    .replace(/^```(?:html|json|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function hashText(value) {
  const text = String(value || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function isReadableHtmlEnabled() {
  try {
    const s = getSettings();
    return s?.rpgSettings?.readableHtmlEnabled !== false;
  } catch (_) {
    return true;
  }
}

function detectReadableKind(text) {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  const noun = raw.match(READABLE_NOUN_RE)?.[0] || "";
  if (!noun) return "";
  if (READ_ACTION_RE.test(raw)) return noun.toLowerCase();
  if (/\b(page\s+1|chapter\s+1|dear\s+\w+|posted\s+notice|notice:)\b/i.test(raw)) return noun.toLowerCase();
  return "";
}

function titleFromRequest(kind, seedText, fallback = "Readable") {
  const text = String(seedText || "");
  const quoted = text.match(/["']([^"']{3,80})["']/)?.[1];
  if (quoted) return quoted.trim();
  const titled = text.match(/\b(?:title|called|named)\s*[:\-]\s*([^\n.]{3,80})/i)?.[1];
  if (titled) return titled.trim();
  const label = String(kind || fallback || "Readable").replace(/\s+/g, " ").trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "Readable";
}

function splitTextToPages(text, chunkSize = 1800) {
  const clean = String(text || "").trim();
  if (!clean) return [{ title: "Page 1", text: "" }];
  const markerSplit = clean.split(/\n\s*(?:page|p\.)\s+\d+\s*[:.\-]\s*/i).map((x) => x.trim()).filter(Boolean);
  if (markerSplit.length > 1) {
    return markerSplit.map((chunk, index) => ({ title: `Page ${index + 1}`, text: chunk }));
  }
  const chunks = clean.match(new RegExp(`[\\s\\S]{1,${chunkSize}}(?=\\s|$)`, "g")) || [clean];
  return chunks.map((chunk, index) => ({ title: `Page ${index + 1}`, text: chunk.trim() }));
}

export function normalizeReadablePages(source, fallbackText = "") {
  const src = source && typeof source === "object" ? source : {};
  const book = src.book && typeof src.book === "object" ? src.book : src;
  const rawPages = Array.isArray(book.pages) ? book.pages : [];
  const pages = rawPages
    .map((page, index) => {
      if (typeof page === "string") return { title: `Page ${index + 1}`, text: page };
      if (page && typeof page === "object") {
        return {
          title: String(page.title || `Page ${index + 1}`).slice(0, 100),
          text: String(page.text || page.content || page.html || ""),
        };
      }
      return null;
    })
    .filter((page) => page && (String(page.text || "").trim() || String(page.title || "").trim()));
  if (pages.length) return pages;
  return splitTextToPages(book.text || book.content || fallbackText || src.description || src.desc || "");
}

function chatContextSnippet(seedText = "") {
  const parts = [];
  try {
    const rows = Array.from(document.querySelectorAll("#chat .mes")).slice(-14);
    for (const row of rows) {
      const name = String(row.querySelector(".mes_name")?.textContent || (row.dataset.isUser === "true" ? "You" : "Story")).trim() || "Story";
      const text = String(row.querySelector(".mes_text")?.textContent || "").trim();
      if (text) parts.push(`${name}: ${text}`);
    }
  } catch (_) {}
  const seed = String(seedText || "").trim();
  if (seed && !parts.some((line) => line.includes(seed.slice(0, 80)))) parts.push(`Initial message: ${seed}`);
  return parts.join("\n").slice(-5200);
}

function fallbackPageHtml(page, index, total, request = {}) {
  const kind = escapeHtml(request.kind || "readable");
  const title = escapeHtml(page.title || `Page ${index + 1}`);
  const body = escapeHtml(page.text || "")
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const contextNote = request.context
    ? `<aside class="uie-readable-html-context">Context-bound ${kind} reconstructed from the current scene.</aside>`
    : "";
  return `
    <section class="uie-readable-html-page" data-page="${index + 1}">
      <div class="uie-readable-sheet uie-readable-sheet-${kind.replace(/[^a-z0-9_-]/gi, "") || "item"}">
        <header>
          <div class="uie-readable-kicker">${escapeHtml(String(request.kind || "Readable").toUpperCase())}</div>
          <h1>${title}</h1>
          <div class="uie-readable-folio">Page ${index + 1} of ${total}</div>
        </header>
        <main>${body || "<p>The page is blank.</p>"}</main>
        ${contextNote}
      </div>
    </section>`;
}

function sanitizeGeneratedHtml(raw) {
  const html = stripCodeFences(raw);
  if (!html) return "";
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, iframe, object, embed, link[rel='import']").forEach((el) => el.remove());
  template.content.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || "").trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && value.startsWith("javascript:")) el.removeAttribute(attr.name);
    }
  });
  return template.innerHTML;
}

function extractHtmlPages(raw, pages, request) {
  const clean = sanitizeGeneratedHtml(raw);
  if (!clean || typeof document === "undefined") return [];
  const template = document.createElement("template");
  template.innerHTML = clean;
  const sections = Array.from(template.content.querySelectorAll(".uie-readable-html-page, [data-page]"));
  const htmlPages = sections.map((section) => section.outerHTML).filter(Boolean);
  if (htmlPages.length) {
    while (htmlPages.length < pages.length) {
      const i = htmlPages.length;
      htmlPages.push(fallbackPageHtml(pages[i], i, pages.length, request));
    }
    return htmlPages.slice(0, pages.length);
  }
  if (pages.length === 1) return [`<section class="uie-readable-html-page" data-page="1">${clean}</section>`];
  return [];
}

async function buildReadableHtmlForPages(request) {
  const pages = normalizeReadablePages({ pages: request.pages || [] }, request.seedText || "");
  const fallback = pages.map((page, index) => fallbackPageHtml(page, index, pages.length, request));
  const compactEnough = pages.length <= 30 && pages.map((p) => String(p.text || "")).join("\n").length <= 18000;
  if (!compactEnough) return fallback;

  const prompt = `Output ONLY raw HTML, no markdown, no code fences, no script tags.
Create exactly ${pages.length} sibling sections:
<section class="uie-readable-html-page" data-page="1">...</section>

Task:
- Build a polished readable in-world HTML popup for a ${request.kind || "readable item"}.
- Correlate the visual styling and wording to the chat context and the initial user or AI message.
- Preserve the meaning of each page. Do not skip pages.
- CSS is allowed inside the sections. JavaScript is not allowed.
- Keep text readable on mobile.

Title: ${request.title || "Readable"}
Initial message:
${String(request.seedText || "").slice(0, 1800)}

Chat context:
${String(request.context || "").slice(0, 4200)}

Pages JSON:
${JSON.stringify(pages).slice(0, 20000)}`;

  try {
    const html = await generateContent(prompt, "Webpage");
    const generated = extractHtmlPages(html, pages, request);
    if (generated.length) return generated;
  } catch (_) {}
  return fallback;
}

function installReadableHtmlStyle() {
  if (typeof document === "undefined" || document.getElementById("uie-readable-html-style")) return;
  const style = document.createElement("style");
  style.id = "uie-readable-html-style";
  style.textContent = `
#uie-readable-html-modal{position:fixed;inset:0;z-index:2147483638;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,23,.62);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);}
#uie-readable-html-modal .uie-readable-frame{width:min(980px,96vw);height:min(860px,92dvh);display:grid;grid-template-rows:auto minmax(0,1fr) auto;border:1px solid rgba(148,163,184,.28);border-radius:8px;background:rgba(6,10,18,.98);color:#f8fafc;box-shadow:0 24px 80px rgba(0,0,0,.58);overflow:hidden;}
#uie-readable-html-modal .uie-readable-head,#uie-readable-html-modal .uie-readable-foot{display:flex;align-items:center;gap:10px;padding:10px 12px;border-color:rgba(148,163,184,.18);background:rgba(15,23,42,.92);}
#uie-readable-html-modal .uie-readable-head{border-bottom:1px solid rgba(148,163,184,.18);}
#uie-readable-html-modal .uie-readable-foot{border-top:1px solid rgba(148,163,184,.18);justify-content:space-between;}
#uie-readable-html-title{font-weight:900;font-size:16px;line-height:1.2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#uie-readable-html-meta{font-size:12px;color:rgba(226,232,240,.72);margin-top:2px;}
#uie-readable-html-body{overflow:auto;padding:16px;background:rgba(10,14,23,.96);}
#uie-readable-html-body .uie-readable-html-page{min-height:100%;}
#uie-readable-html-body .uie-readable-sheet{max-width:760px;margin:0 auto;min-height:100%;padding:clamp(18px,4vw,42px);border:1px solid rgba(82,59,39,.28);border-radius:8px;background:#fffaf0;color:#2a1a12;box-shadow:0 16px 48px rgba(0,0,0,.28);}
#uie-readable-html-body .uie-readable-sheet header{border-bottom:1px solid rgba(82,59,39,.24);padding-bottom:12px;margin-bottom:18px;}
#uie-readable-html-body .uie-readable-kicker{font-size:11px;font-weight:900;letter-spacing:.08em;color:#83562b;text-transform:uppercase;}
#uie-readable-html-body h1{font-size:clamp(22px,4vw,36px);line-height:1.08;margin:6px 0;color:#24130b;letter-spacing:0;}
#uie-readable-html-body .uie-readable-folio{font-size:12px;color:#6f4b2c;}
#uie-readable-html-body p{font-size:16px;line-height:1.72;margin:0 0 1em;color:inherit;}
#uie-readable-html-body .uie-readable-html-context{margin-top:24px;padding-top:12px;border-top:1px dashed rgba(82,59,39,.28);font-size:12px;color:#6f4b2c;}
#uie-readable-html-modal button,#uie-readable-page-select{min-height:34px;border:1px solid rgba(148,163,184,.28);border-radius:8px;background:rgba(15,23,42,.88);color:#f8fafc;padding:0 11px;font:inherit;}
#uie-readable-html-modal button{cursor:pointer;}
#uie-readable-html-modal button:disabled{opacity:.45;cursor:not-allowed;}
#uie-readable-html-modal button:hover:not(:disabled){border-color:rgba(83,186,242,.68);background:rgba(30,41,59,.96);}
#uie-readable-page-select{max-width:min(260px,42vw);}
@media (max-width:640px){#uie-readable-html-modal{padding:8px;}#uie-readable-html-modal .uie-readable-frame{height:94dvh;width:98vw;}#uie-readable-html-body{padding:8px;}#uie-readable-html-modal .uie-readable-head{align-items:flex-start;}#uie-readable-page-select{max-width:38vw;}}
`;
  document.head.appendChild(style);
}

export function closeReadableHtmlPopup() {
  try {
    const modal = document.getElementById("uie-readable-html-modal");
    if (modal) modal.style.display = "none";
  } catch (_) {}
}

function ensureModal() {
  installReadableHtmlStyle();
  let modal = document.getElementById("uie-readable-html-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "uie-readable-html-modal";
  modal.innerHTML = `
    <div class="uie-readable-frame" role="dialog" aria-modal="true" aria-labelledby="uie-readable-html-title">
      <div class="uie-readable-head">
        <div style="min-width:0;flex:1;">
          <div id="uie-readable-html-title">Readable</div>
          <div id="uie-readable-html-meta">HTML reader</div>
        </div>
        <button id="uie-readable-html-close" type="button">Close</button>
      </div>
      <div id="uie-readable-html-body"></div>
      <div class="uie-readable-foot">
        <button id="uie-readable-html-prev" type="button">Prev</button>
        <select id="uie-readable-page-select" aria-label="Readable page"></select>
        <button id="uie-readable-html-next" type="button">Next</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#uie-readable-html-close")?.addEventListener("click", closeReadableHtmlPopup);
  modal.querySelector("#uie-readable-html-prev")?.addEventListener("click", () => setReadablePage(activeReader.index - 1));
  modal.querySelector("#uie-readable-html-next")?.addEventListener("click", () => setReadablePage(activeReader.index + 1));
  modal.querySelector("#uie-readable-page-select")?.addEventListener("change", (event) => setReadablePage(Number(event.target.value) || 0));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeReadableHtmlPopup();
  });
  return modal;
}

function renderReadablePage() {
  const modal = ensureModal();
  const total = activeReader.pages.length || 1;
  activeReader.index = Math.max(0, Math.min(activeReader.index || 0, total - 1));
  const title = modal.querySelector("#uie-readable-html-title");
  const meta = modal.querySelector("#uie-readable-html-meta");
  const body = modal.querySelector("#uie-readable-html-body");
  const prev = modal.querySelector("#uie-readable-html-prev");
  const next = modal.querySelector("#uie-readable-html-next");
  const select = modal.querySelector("#uie-readable-page-select");
  if (title) title.textContent = activeReader.title || "Readable";
  if (meta) meta.textContent = `Page ${activeReader.index + 1} of ${total}`;
  if (body) {
    body.innerHTML = activeReader.pages[activeReader.index] || "<p>Loading...</p>";
    body.scrollTop = 0;
  }
  if (prev) prev.disabled = activeReader.index <= 0;
  if (next) next.disabled = activeReader.index >= total - 1;
  if (select) {
    const wanted = String(activeReader.index);
    if (select.options.length !== total) {
      select.innerHTML = "";
      for (let i = 0; i < total; i += 1) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `Page ${i + 1}`;
        select.appendChild(opt);
      }
    }
    select.value = wanted;
  }
  modal.style.display = "flex";
}

function setReadablePage(index) {
  activeReader.index = Number(index) || 0;
  renderReadablePage();
}

function openLoading(title = "Readable") {
  activeReader = {
    title,
    index: 0,
    pages: ['<section class="uie-readable-html-page"><div class="uie-readable-sheet"><p>Building readable HTML...</p></div></section>'],
  };
  renderReadablePage();
}

export function openReadableHtmlPopup(request = {}) {
  const title = String(request.title || "Readable").trim() || "Readable";
  const pages = Array.isArray(request.htmlPages) && request.htmlPages.length
    ? request.htmlPages
    : normalizeReadablePages({ pages: request.pages || [] }, request.seedText || "").map((page, index, arr) => fallbackPageHtml(page, index, arr.length, request));
  activeReader = { title, pages, index: 0 };
  renderReadablePage();
}

async function askAndBuildReadableHtml(request = {}) {
  if (!isReadableHtmlEnabled()) return false;
  const seed = `${request.title || ""}|${request.kind || ""}|${request.seedText || ""}|${JSON.stringify(request.pages || []).slice(0, 1200)}`;
  const key = request.key || hashText(seed);
  if (askedKeys.has(key)) return false;
  askedKeys.add(key);
  const title = String(request.title || titleFromRequest(request.kind, request.seedText, "Readable")).trim() || "Readable";
  const ok = typeof window === "undefined" || typeof window.confirm !== "function"
    ? true
    : window.confirm(`Build an HTML readable popup for "${title}"?`);
  if (!ok) return false;
  const context = request.context || chatContextSnippet(request.seedText || "");
  openLoading(title);
  const pages = normalizeReadablePages({ pages: request.pages || [] }, request.seedText || "");
  const htmlPages = await buildReadableHtmlForPages({ ...request, title, pages, context });
  openReadableHtmlPopup({ ...request, title, pages, htmlPages, context });
  return true;
}

export async function maybeBuildReadableHtmlForBook(title, text, item = null) {
  const pages = normalizeReadablePages(item || { book: { title, text } }, text);
  const seedText = String(text || pages.map((page) => page.text).join("\n\n")).slice(0, 2400);
  const kind = String(item?.readableType || item?.visualTemplate || item?.type || "book");
  return askAndBuildReadableHtml({
    title: String(item?.book?.title || title || item?.name || "Readable").trim() || "Readable",
    kind,
    seedText,
    pages,
    source: "inventory",
  });
}

function handleChatReadable(detail = {}) {
  const text = String(detail.text || "").trim();
  const kind = detectReadableKind(text);
  if (!kind) return;
  const title = titleFromRequest(kind, text, "Readable");
  const pages = splitTextToPages(text, 1600);
  setTimeout(() => {
    void askAndBuildReadableHtml({
      title,
      kind,
      seedText: text,
      pages,
      source: detail.isUser ? "user_message" : "ai_message",
      key: hashText(`${detail.isUser ? "u" : "a"}|${text}`),
    });
  }, 80);
}

export function initReadableHtml() {
  if (mounted || typeof window === "undefined") return;
  mounted = true;
  installReadableHtmlStyle();
  window.addEventListener("uie:chat_appended", (event) => {
    try { handleChatReadable(event.detail || {}); } catch (_) {}
  });
  window.UIE_readableHtml = {
    maybeBuildReadableHtmlForBook,
    openReadableHtmlPopup,
    normalizeReadablePages,
  };
}

export function init() {
  initReadableHtml();
}
