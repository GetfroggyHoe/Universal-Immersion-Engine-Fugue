import { getSettings, saveSettings } from "./core.js";

let idx = 0;
let stickerInit = false;
let stickerPacks = [];
let activePackId = "";
let importPendingName = "";
let diaryTurning = false;

const STICKERS_BASE = "./assets/stickers/";
const STICKER_DB = { name: "uie_stickers", store: "packs", version: 1 };
const DIARY_FONT_CHOICES = [
    "'Segoe Print', cursive", "'Segoe Script', cursive", "'Lucida Handwriting', cursive", "'Brush Script MT', cursive", "'Bradley Hand ITC', cursive",
    "'Comic Sans MS', cursive", "'Apple Chancery', cursive", "'Snell Roundhand', cursive", "'Papyrus', fantasy", "'Garamond', serif",
    "'Georgia', serif", "'Book Antiqua', serif", "'Palatino Linotype', serif", "'Baskerville', serif", "'Cambria', serif",
    "'Times New Roman', serif", "'Courier New', monospace", "'Lucida Console', monospace", "'Consolas', monospace", "'Trebuchet MS', sans-serif",
    "'Verdana', sans-serif", "'Tahoma', sans-serif", "'Arial', sans-serif", "'Helvetica', sans-serif", "'Century Gothic', sans-serif",
    "'Franklin Gothic Medium', sans-serif", "'Gill Sans', sans-serif", "'Optima', sans-serif", "'Candara', sans-serif", "'Corbel', sans-serif",
    "'Constantia', serif", "'Didot', serif", "'Rockwell', serif", "'Copperplate', fantasy", "'Perpetua', serif",
    "'Hoefler Text', serif", "'Monotype Corsiva', cursive", "'MV Boli', cursive", "'Ink Free', cursive", "'Kristen ITC', cursive",
    "'Pristina', cursive", "'Rage Italic', cursive", "'Viner Hand ITC', cursive", "'Vivaldi', cursive", "'Freestyle Script', cursive",
    "'Harrington', fantasy", "'Cinzel', serif", "'Cormorant Garamond', serif", "'Libre Baskerville', serif", "'Merriweather', serif"
];

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function emotionFromFilename(name) {
    const base = String(name || "").split("/").pop() || "";
    const m = base.match(/^([a-zA-Z]{2,16})_/);
    return m ? m[1].toLowerCase() : "";
}

function ensureDiaryModel(s) {
    if (!s.diary || !Array.isArray(s.diary)) s.diary = [{ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] }];
    if (s.diary.length === 0) s.diary.push({ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] });
    s.diary.forEach(e => {
        if (!e || typeof e !== "object") return;
        if (typeof e.title !== "string") e.title = String(e.title || "");
        if (!Array.isArray(e.stickers)) e.stickers = [];
        if (!e.style || typeof e.style !== "object") e.style = {};
        if (typeof e.style.font !== "string") e.style.font = DIARY_FONT_CHOICES[0];
        if (typeof e.style.color !== "string") e.style.color = "#241207";
        if (typeof e.style.paperColor !== "string") e.style.paperColor = "";
        if (typeof e.style.fontSize !== "number") e.style.fontSize = 16;
        e.style.bold = e.style.bold === true;
        e.style.italic = e.style.italic === true;
        e.style.underline = e.style.underline === true;
    });
}

function populateDiaryFonts() {
    const sel = document.getElementById("uie-diary-font");
    if (!sel || sel.options.length) return;
    for (const font of DIARY_FONT_CHOICES) {
        const clean = font.split(",")[0].replace(/['"]/g, "");
        sel.appendChild(new Option(clean, font));
    }
}

function applyDiaryStyle(entry) {
    const style = entry?.style || {};
    const text = document.getElementById("uie-diary-text");
    const font = document.getElementById("uie-diary-font");
    const color = document.getElementById("uie-diary-text-color");
    const paper = document.getElementById("uie-diary-paper-color");
    const bold = document.getElementById("uie-diary-bold");
    const italic = document.getElementById("uie-diary-italic");
    const underline = document.getElementById("uie-diary-underline");
    if (font) font.value = style.font || DIARY_FONT_CHOICES[0];
    if (color) color.value = /^#[0-9a-f]{6}$/i.test(style.color || "") ? style.color : "#241207";
    if (paper) paper.value = /^#[0-9a-f]{6}$/i.test(style.paperColor || "") ? style.paperColor : "#f1d99e";
    if (bold) bold.classList.toggle("active", style.bold === true);
    if (italic) italic.classList.toggle("active", style.italic === true);
    if (underline) underline.classList.toggle("active", style.underline === true);
    const fontSizeVal = document.getElementById("uie-diary-text-size-val");
    if (fontSizeVal) fontSizeVal.textContent = style.fontSize || 16;
    if (text) {
        text.style.fontFamily = style.font || DIARY_FONT_CHOICES[0];
        text.style.fontSize = (style.fontSize || 16) + "px";
        text.style.color = style.color || "#241207";
        text.style.setProperty("--diary-text-color", style.color || "#241207");
        text.style.fontWeight = style.bold ? "900" : "500";
        text.style.fontStyle = style.italic ? "italic" : "normal";
        text.style.textDecoration = style.underline ? "underline" : "none";
    }
    const rightPage = document.querySelector("#uie-diary-window .uie-diary-page-right");
    if (rightPage) {
        if (style.paperColor) rightPage.style.setProperty("--diary-paper-tint", style.paperColor);
        rightPage.style.backgroundColor = style.paperColor || "";
    }
}

function updateCurrentDiaryStyle(mutator) {
    const s = getSettings();
    ensureDiaryModel(s);
    const entry = s.diary[idx];
    if (!entry.style || typeof entry.style !== "object") entry.style = {};
    mutator(entry.style);
    saveSettings();
    applyDiaryStyle(entry);
}

function openStickerDb() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) return resolve(null);
        const req = indexedDB.open(STICKER_DB.name, STICKER_DB.version);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STICKER_DB.store)) db.createObjectStore(STICKER_DB.store, { keyPath: "name" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function dbGetAllPacks() {
    const db = await openStickerDb();
    if (!db) return [];
    return new Promise((resolve) => {
        const tx = db.transaction(STICKER_DB.store, "readonly");
        const store = tx.objectStore(STICKER_DB.store);
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
    });
}

async function dbPutPack(pack) {
    const db = await openStickerDb();
    if (!db) return false;
    return new Promise((resolve) => {
        const tx = db.transaction(STICKER_DB.store, "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.objectStore(STICKER_DB.store).put(pack);
    });
}

function parseDirectoryListing(html) {
    try {
        const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
        const links = Array.from(doc.querySelectorAll("a[href]")).map(a => String(a.getAttribute("href") || ""));
        return links;
    } catch (_) {
        return [];
    }
}

async function fetchJson(url) {
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
    } catch (_) {
        return null;
    }
}

async function fetchText(url) {
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return "";
        return await r.text();
    } catch (_) {
        return "";
    }
}

function isImageFile(name) {
    const n = String(name || "").toLowerCase();
    return n.endsWith(".png") || n.endsWith(".gif") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg");
}

function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl || "");
    const m = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return null;
    const mime = m[1] || "application/octet-stream";
    const b64 = m[2] || "";
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    } catch (_) {
        return null;
    }
}

function getDiaryPhotoFitMode() {
    const selected = String($("#uie-diary-photo-fit-mode").val() || "").trim();
    if (selected === "stretch" || selected === "contain") return selected;
    const s = getSettings();
    ensureDiaryModel(s);
    return String(s.diary?.[idx]?.photoFitMode || "contain") === "stretch" ? "stretch" : "contain";
}

function getDiaryPhotoBoxPlacement() {
    try {
        const layer = document.getElementById("uie-diary-global-layer");
        const box = document.getElementById("uie-diary-photo-box");
        if (!layer || !box) throw new Error("missing box");
        const layerRect = layer.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        const pad = 12;
        return {
            x: Math.max(0, boxRect.left - layerRect.left + pad),
            y: Math.max(0, boxRect.top - layerRect.top + pad),
            width: Math.max(80, boxRect.width - pad * 2),
            height: Math.max(80, boxRect.height - pad * 2)
        };
    } catch (_) {
        return { x: 60, y: 130, width: 220, height: 180 };
    }
}

function addDiaryPhotoDataUrl(dataUrl) {
    const src = String(dataUrl || "").trim();
    if (!src) return false;
    const s = getSettings();
    ensureDiaryModel(s);
    if (!s.diary[idx]) s.diary[idx] = { title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [], photos: [] };
    if (!Array.isArray(s.diary[idx].photos)) s.diary[idx].photos = [];
    const placement = getDiaryPhotoBoxPlacement();
    const fitMode = getDiaryPhotoFitMode();
    s.diary[idx].photoFitMode = fitMode;
    s.diary[idx].photos.push({
        id: createUUID(),
        src,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotation: 0,
        zoom: 1,
        cropX: 0,
        cropY: 0,
        fitMode
    });
    saveSettings();
    renderDiary();
    return true;
}

async function applyDiaryImageFromFile(file) {
    const f = file;
    if (!f) return false;
    if (!String(f.type || "").startsWith("image/")) return false;
    const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(f);
    });
    if (!dataUrl) return false;
    return addDiaryPhotoDataUrl(dataUrl);
}

async function loadFolderPacks() {
    const packs = [];
    const manifest = await fetchJson(`${STICKERS_BASE}manifest.json`);
    const fromManifest = Array.isArray(manifest?.packs) ? manifest.packs : [];
    fromManifest.forEach(p => {
        const name = String(p?.name || "").trim();
        const folder = String(p?.folder || name).trim();
        if (!name || !folder) return;
        packs.push({ id: `folder:${folder}`, name, source: "folder", folder, files: Array.isArray(p?.files) ? p.files.slice(0, 500) : null });
    });

    const listing = await fetchText(STICKERS_BASE);
    const links = parseDirectoryListing(listing);
    links.forEach(href => {
        const clean = href.replace(/^\.\//, "");
        if (!clean || clean === "../" || clean.startsWith("?") || clean.startsWith("#")) return;
        if (!clean.endsWith("/")) return;
        const folder = decodeURIComponent(clean.replace(/\/$/, ""));
        if (!folder) return;
        if (folder.toLowerCase() === "default") return;
        if (folder.toLowerCase() === "assets" || folder.toLowerCase() === "stickers") return;
        if (packs.some(x => x.folder === folder)) return;
        packs.push({ id: `folder:${folder}`, name: folder, source: "folder", folder, files: null });
    });

    return packs;
}

async function loadImportedPacks() {
    const all = await dbGetAllPacks();
    return all
        .map(p => ({
            id: `import:${String(p?.name || "")}`,
            name: String(p?.name || ""),
            source: "import",
            images: Array.isArray(p?.images) ? p.images : []
        }))
        .filter(p => p.name);
}

async function refreshStickerPacks() {
    const imported = await loadImportedPacks();
    stickerPacks = [...imported];

    if (!activePackId || !stickerPacks.some(p => p.id === activePackId)) activePackId = stickerPacks[0]?.id || "";
    renderStickerTabs();
    await renderActivePack();
}

function renderStickerTabs() {
    const $tabs = $("#uie-diary-sticker-tabs");
    if (!$tabs.length) return;
    $tabs.empty();
    stickerPacks.forEach(p => {
        const cls = p.id === activePackId ? "uie-sticker-tab active" : "uie-sticker-tab";
        $tabs.append(`<button class="${cls}" data-pack="${esc(p.id)}">${esc(p.name)}</button>`);
    });
}

async function listFolderFiles(folder) {
    const html = await fetchText(`${STICKERS_BASE}${encodeURIComponent(folder)}/`);
    const links = parseDirectoryListing(html);
    const files = [];
    links.forEach(href => {
        const clean = href.replace(/^\.\//, "");
        if (!clean || clean === "../") return;
        if (clean.endsWith("/")) return;
        const f = decodeURIComponent(clean.split("?")[0].split("#")[0]);
        if (!isImageFile(f)) return;
        files.push(f);
    });
    return files.slice(0, 800);
}

async function renderActivePack() {
    const pack = stickerPacks.find(p => p.id === activePackId);
    const grid = document.getElementById("uie-sticker-grid");
    const empty = document.getElementById("uie-sticker-empty");
    if (!grid || !empty) return;

    grid.innerHTML = "";

    if (!pack) {
        empty.textContent = "No packs found.";
        empty.style.display = "block";
        return;
    }

    let imgs = [];
    if (pack.source === "import") {
        imgs = (pack.images || []).map(im => ({
            name: String(im?.name || ""),
            src: String(im?.dataUrl || ""),
            emotion: String(im?.emotion || emotionFromFilename(im?.name || ""))
        })).filter(x => x.name && x.src);
    } else {
        let files = Array.isArray(pack.files) ? pack.files : null;
        if (!files) files = await listFolderFiles(pack.folder);
        pack.files = files;
        imgs = (files || []).filter(isImageFile).map(f => ({
            name: f,
            src: `${STICKERS_BASE}${pack.folder}/${f}`,
            emotion: emotionFromFilename(f)
        }));
    }

    if (!imgs.length) {
        empty.innerHTML = `No stickers in <b>${esc(pack.name)}</b>.`;
        empty.style.display = "block";
        return;
    }

    empty.style.display = "none";

    const tmpl = document.getElementById("uie-template-diary-sticker-tile");
    if (!tmpl) return;

    const frag = document.createDocumentFragment();
    imgs.slice(0, 800).forEach(im => {
        const clone = tmpl.content.cloneNode(true);
        const tile = clone.querySelector(".uie-sticker-tile");
        const img = clone.querySelector("img");

        tile.dataset.pack = esc(pack.id);
        tile.dataset.name = esc(im.name);
        tile.dataset.src = esc(im.src);
        tile.dataset.emotion = esc(im.emotion);
        tile.title = esc(im.name);

        img.src = esc(im.src);
        img.alt = esc(im.name);

        frag.appendChild(clone);
    });
    grid.appendChild(frag);
}

function createUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function animateDiaryTurn(kind, commit, afterRender) {
    const run = typeof commit === "function" ? commit : () => {};
    const after = typeof afterRender === "function" ? afterRender : () => {};
    const $win = $("#uie-diary-window");
    const reduceMotion = (() => {
        try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; }
    })();
    if (!$win.length || reduceMotion) {
        run();
        renderDiary();
        after();
        return;
    }
    if (diaryTurning) return;
    diaryTurning = true;
    const classes = "uie-diary-turn-next uie-diary-turn-prev uie-diary-turn-new uie-diary-turn-delete";
    $win.removeClass(classes).addClass(`uie-diary-turn-${kind}`);
    window.setTimeout(() => {
        run();
        renderDiary();
        after();
    }, kind === "delete" ? 120 : 155);
    window.setTimeout(() => {
        $win.removeClass(classes);
        diaryTurning = false;
    }, 390);
}

function renderGlobalItems() {
    const s = getSettings();
    ensureDiaryModel(s);
    const entry = s.diary[idx] || {};
    const $layer = $("#uie-diary-global-layer");
    if (!$layer.length) return;
    $layer.empty();
    
    // Ensure photos and stickers arrays exist
    if (!Array.isArray(entry.photos)) entry.photos = [];
    if (!Array.isArray(entry.stickers)) entry.stickers = [];
    
    // Render Photos
    entry.photos.forEach((p, i) => {
        const x = p.x ?? 60;
        const y = p.y ?? 130;
        const w = p.width ?? 160;
        const h = p.height ?? 160;
        const rot = p.rotation ?? 0;
        const cropX = p.cropX ?? 0;
        const cropY = p.cropY ?? 0;
        const zoom = p.zoom ?? 1;
        const fit = String(p.fitMode || "contain") === "stretch" ? "fill" : "contain";
        
        $layer.append(`
            <div class="uie-diary-item uie-diary-photo-item" data-type="photo" data-i="${i}" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px; transform: rotate(${rot}deg);">
                <div class="uie-diary-photo-inner" style="width:100%; height:100%; overflow:hidden; position:relative; border: 4px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.25); box-sizing: border-box; background: #fbf2e3;">
                    <img src="${esc(p.src)}" draggable="false" alt="" style="width: 100%; height: 100%; object-fit: ${fit}; transform: translate(${cropX}px, ${cropY}px) scale(${zoom}); transform-origin: 50% 50%; pointer-events: none; position: absolute; top:0; left:0;">
                </div>
                <div class="uie-diary-item-ctrl uie-diary-photo-x" data-i="${i}">×</div>
                <div class="uie-diary-item-ctrl uie-diary-handle-rotate" data-i="${i}"><i class="fa-solid fa-rotate"></i></div>
                <div class="uie-diary-item-ctrl uie-diary-handle-resize" data-i="${i}"></div>
            </div>
        `);
    });
    
    // Render Stickers
    entry.stickers.forEach((st, i) => {
        const x = st.x ?? 100;
        const y = st.y ?? 100;
        const w = st.width ?? 80;
        const h = st.height ?? 80;
        const rot = st.rotation ?? 0;
        
        $layer.append(`
            <div class="uie-diary-item uie-diary-sticker-item" data-type="sticker" data-i="${i}" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px; transform: rotate(${rot}deg);">
                <img src="${esc(st.src)}" draggable="false" alt="" style="width:100%; height:100%; object-fit:contain; pointer-events:none;">
                <div class="uie-diary-item-ctrl uie-diary-sticker-x" data-i="${i}">×</div>
                <div class="uie-diary-item-ctrl uie-diary-handle-rotate" data-i="${i}"><i class="fa-solid fa-rotate"></i></div>
                <div class="uie-diary-item-ctrl uie-diary-handle-resize" data-i="${i}"></div>
            </div>
        `);
    });
}

export function renderDiary() {
    const s = getSettings();
    ensureDiaryModel(s);
    populateDiaryFonts();

    // Bounds Safety
    if (idx >= s.diary.length) idx = s.diary.length - 1;
    if (idx < 0) idx = 0;

    $("#uie-diary-num").text(idx + 1);
    $("#uie-diary-title").val(String(s.diary[idx].title || ""));
    $("#uie-diary-text").val(s.diary[idx].text || "");
    $("#uie-diary-date").text(s.diary[idx].date || "Unknown Date");
    applyDiaryStyle(s.diary[idx]);

    // Migrate legacy single photo to photos array
    const entry = s.diary[idx];
    if (!Array.isArray(entry.photos)) entry.photos = [];
    if (entry.img && !entry.photos.some(p => p.src === entry.img)) {
        entry.photos.push({
            id: createUUID(),
            src: entry.img,
            x: 60,
            y: 130,
            width: 160,
            height: 160,
            rotation: 0,
            zoom: 1,
            cropX: 0,
            cropY: 0,
            fitMode: String(entry.photoFitMode || "contain") === "stretch" ? "stretch" : "contain"
        });
        entry.img = ""; // Clear so we don't migrate again
        saveSettings();
    }
    const pageFitMode = String(entry.photoFitMode || "contain") === "stretch" ? "stretch" : "contain";
    entry.photos.forEach((photo) => {
        if (photo && typeof photo === "object" && !["contain", "stretch"].includes(String(photo.fitMode || ""))) {
            photo.fitMode = pageFitMode;
        }
    });
    $("#uie-diary-photo-fit-mode").val(pageFitMode);

    renderGlobalItems();
}

export function render() {
    return renderDiary();
}

export function initDiary() {
    const $win = $("#uie-diary-window");
    if (!$win.length) {
        stickerInit = false;
        return;
    }
    if (!stickerInit) {
        stickerInit = true;
        
        $win.off("click.uieDiaryStickers click.uieDiaryClose");
        $(document).off("click.uieDiaryStickers click.uieDiaryClose"); // Clean up old globals

        $win.on("click.uieDiaryClose", "#uie-diary-close", function (e) {
            if (e.cancelable !== false && e.originalEvent?.cancelable !== false) e.preventDefault();
            e.stopPropagation();
            try { $("#uie-diary-sticker-drawer").hide(); } catch (_) {}
            $win.hide();
        });
        $win.on("click.uieDiaryStickers", "#uie-diary-stickers", async function(e) {
            if (e.cancelable !== false && e.originalEvent?.cancelable !== false) e.preventDefault();
            e.stopPropagation();
            $("#uie-diary-sticker-drawer").css("display", "flex");
            await refreshStickerPacks();
        });
        $win.on("click.uieDiaryStickers", "#uie-sticker-close", function(e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-diary-sticker-drawer").hide();
        });
        $win.on("click.uieDiaryStickers", "#uie-diary-sticker-drawer", function(e) {
            if (e.target && e.target.id === "uie-diary-sticker-drawer") $("#uie-diary-sticker-drawer").hide();
        });
        $win.on("click.uieDiaryStickers", ".uie-sticker-tab", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            activePackId = String($(this).data("pack") || "");
            renderStickerTabs();
            await renderActivePack();
        });
        $win.on("click.uieDiaryStickers", ".uie-sticker-tile", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const src = String($(this).data("src") || "");
            const name = String($(this).data("name") || "");
            const emotion = String($(this).data("emotion") || "");
            const packId = String($(this).data("pack") || "");
            const pack = stickerPacks.find(p => p.id === packId);
            if (!src || !name || !pack) return;
            const s = getSettings();
            ensureDiaryModel(s);
            if (!s.diary[idx]) s.diary[idx] = { date: new Date().toLocaleString(), text: "", img: "", stickers: [], photos: [] };
            if (!Array.isArray(s.diary[idx].stickers)) s.diary[idx].stickers = [];

            // Center placement for new stickers
            const layer = document.getElementById("uie-diary-global-layer");
            const rect = layer ? layer.getBoundingClientRect() : { width: 600, height: 400 };
            const x = (rect.width / 2) - 40 + (Math.random() * 40 - 20);
            const y = (rect.height / 2) - 40 + (Math.random() * 40 - 20);

            s.diary[idx].stickers.push({
                pack: pack.name,
                name,
                src,
                source: pack.source,
                emotion: emotion || emotionFromFilename(name),
                x, y, rotation: (Math.random() * 30 - 15), scale: 1,
                width: 80, height: 80
            });
            saveSettings();
            renderDiary();
            $("#uie-diary-sticker-drawer").hide();
        });

        // Global layer interaction drag/rotate/resize/crop variables
        let activeAction = null; // 'drag', 'crop', 'rotate', 'resize'
        let actionItemType = null; // 'photo', 'sticker'
        let actionItemIndex = null;
        let actionTarget = null;
        
        let startPointer = { x: 0, y: 0 };
        let startItemPos = { x: 0, y: 0, w: 0, h: 0, rot: 0 };
        let startCrop = { x: 0, y: 0 };
        let startDist = 0;
        
        const onGlobalItemMove = (e) => {
            if (!actionTarget) return;
            if (e.cancelable) e.preventDefault();
            const p = (e.touches) ? e.touches[0] : e;
            const dx = p.clientX - startPointer.x;
            const dy = p.clientY - startPointer.y;
            
            const s = getSettings();
            const entry = s.diary[idx];
            const data = actionItemType === "photo" ? entry.photos[actionItemIndex] : entry.stickers[actionItemIndex];
            if (!data) return;
            
            if (activeAction === 'drag') {
                const nx = startItemPos.x + dx;
                const ny = startItemPos.y + dy;
                actionTarget.css({ left: nx, top: ny });
                data.x = nx;
                data.y = ny;
            } else if (activeAction === 'crop' && actionItemType === "photo") {
                const ncx = startCrop.x + dx;
                const ncy = startCrop.y + dy;
                data.cropX = ncx;
                data.cropY = ncy;
                actionTarget.find("img").css("transform", `translate(${ncx}px, ${ncy}px) scale(${data.zoom || 1})`);
            } else if (activeAction === 'rotate') {
                const rect = actionTarget[0].getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const currentAngle = Math.atan2(p.clientY - cy, p.clientX - cx) * (180 / Math.PI);
                const angleDiff = currentAngle - startItemPos.startPointerAngle;
                const newRot = (startItemPos.rot + angleDiff) % 360;
                actionTarget.css("transform", `rotate(${newRot}deg)`);
                data.rotation = newRot;
            } else if (activeAction === 'resize') {
                const nw = Math.max(40, startItemPos.w + dx);
                const nh = Math.max(40, startItemPos.h + dy);
                actionTarget.css({ width: nw, height: nh });
                data.width = nw;
                data.height = nh;
            }
        };
        
        const onGlobalItemEnd = (e) => {
            window.removeEventListener("mousemove", onGlobalItemMove);
            window.removeEventListener("touchmove", onGlobalItemMove);
            window.removeEventListener("mouseup", onGlobalItemEnd);
            window.removeEventListener("touchend", onGlobalItemEnd);
            
            if (actionTarget) {
                actionTarget.removeClass("active");
                saveSettings();
                actionTarget = null;
                activeAction = null;
            }
        };

        // Attach global layer mousedown/touchstart listeners
        $win.on("mousedown touchstart", "#uie-diary-global-layer .uie-diary-item", function(e) {
            const $item = $(this);
            const type = $item.data("type");
            const i = Number($item.data("i"));
            const s = getSettings();
            ensureDiaryModel(s);
            const entry = s.diary[idx];
            const data = type === "photo" ? entry.photos[i] : entry.stickers[i];
            if (!data) return;
            
            const p = (e.touches || e.originalEvent?.touches) ? (e.touches || e.originalEvent.touches)[0] : e;
            const $target = $(e.target);
            
            // Delete button handles
            if ($target.closest(".uie-diary-sticker-x, .uie-diary-photo-x").length) {
                return;
            }
            
            if (e.cancelable !== false && e.originalEvent?.cancelable !== false) e.preventDefault();
            e.stopPropagation();
            
            $item.addClass("active").siblings().removeClass("active");
            $item.appendTo($item.parent()); // Bring to front
            
            actionTarget = $item;
            actionItemType = type;
            actionItemIndex = i;
            
            startPointer = { x: p.clientX, y: p.clientY };
            startItemPos = {
                x: parseFloat($item.css("left")) || 0,
                y: parseFloat($item.css("top")) || 0,
                w: $item.width(),
                h: $item.height(),
                rot: data.rotation || 0
            };
            
            if ($target.closest(".uie-diary-handle-rotate").length) {
                activeAction = 'rotate';
                const rect = $item[0].getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                startItemPos.startPointerAngle = Math.atan2(p.clientY - cy, p.clientX - cx) * (180 / Math.PI);
            } else if ($target.closest(".uie-diary-handle-resize").length) {
                activeAction = 'resize';
                const rect = $item[0].getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                startDist = Math.hypot(p.clientX - cx, p.clientY - cy);
            } else if (e.altKey && type === "photo") {
                activeAction = 'crop';
                startCrop = { x: data.cropX || 0, y: data.cropY || 0 };
            } else {
                activeAction = 'drag';
            }
            
            window.addEventListener("mousemove", onGlobalItemMove);
            window.addEventListener("touchmove", onGlobalItemMove, { passive: false });
            window.addEventListener("mouseup", onGlobalItemEnd);
            window.addEventListener("touchend", onGlobalItemEnd);
        });

        // Mouse wheel zoom on photos
        $win.on("wheel", ".uie-diary-photo-item", function(e) {
            e.preventDefault();
            const i = Number($(this).data("i"));
            const s = getSettings();
            const entry = s.diary[idx];
            const p = entry.photos[i];
            if (!p) return;
            
            const delta = e.originalEvent.deltaY < 0 ? 0.08 : -0.08;
            p.zoom = Math.max(0.2, Math.min(8, (p.zoom || 1) + delta));
            
            $(this).find("img").css("transform", `translate(${p.cropX || 0}px, ${p.cropY || 0}px) scale(${p.zoom})`);
            saveSettings();
        });

        // Delete button clicks
        $win.on("click", ".uie-diary-photo-x", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const i = Number($(this).data("i"));
            const s = getSettings();
            ensureDiaryModel(s);
            if (s.diary[idx] && s.diary[idx].photos) {
                s.diary[idx].photos.splice(i, 1);
                saveSettings();
                renderDiary();
            }
        });
        $win.on("click", ".uie-diary-sticker-x", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const i = Number($(this).data("i"));
            const s = getSettings();
            ensureDiaryModel(s);
            if (s.diary[idx] && s.diary[idx].stickers) {
                s.diary[idx].stickers.splice(i, 1);
                saveSettings();
                renderDiary();
            }
        });

        $win.on("click.uieDiaryStickers", "#uie-sticker-import", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const name = (prompt("Pack name:", "MyPack") || "").trim();
            if (!name) return;
            importPendingName = name.slice(0, 50);
            $("#uie-sticker-import-files").trigger("click");
        });
        
        $win.on("change.uieDiaryStickers", "#uie-sticker-import-files", async function() {
            const files = Array.from(this.files || []);
            $(this).val("");
            const name = String(importPendingName || "").trim();
            importPendingName = "";
            if (!name || !files.length) return;
            const imgs = [];
            for (const f of files.slice(0, 120)) {
                const fname = String(f?.name || "");
                if (!isImageFile(fname)) continue;
                const dataUrl = await new Promise((resolve) => {
                    const r = new FileReader();
                    r.onload = (ev) => resolve(String(ev?.target?.result || ""));
                    r.onerror = () => resolve("");
                    r.readAsDataURL(f);
                });
                if (!dataUrl) continue;
                imgs.push({ name: fname, dataUrl, emotion: emotionFromFilename(fname) });
            }
            await dbPutPack({ name, createdAt: Date.now(), images: imgs });
            await refreshStickerPacks();
            activePackId = `import:${name}`;
            renderStickerTabs();
            await renderActivePack();
        });
    
        // Auto-save input
        $win.on("input", "#uie-diary-title", function() {
            const s = getSettings();
            ensureDiaryModel(s);
            if(!s.diary[idx]) s.diary[idx] = { title: "", date: new Date().toLocaleString(), text: "", img: "", stickers: [], photos: [] };
            s.diary[idx].title = String($(this).val() || "").slice(0, 80);
            saveSettings();
        });
        $win.on("input", "#uie-diary-text", function() {
            const s = getSettings();
            ensureDiaryModel(s);
            if(!s.diary[idx]) s.diary[idx] = { title: "", date: new Date().toLocaleString(), text: "", img: "", stickers: [], photos: [] };
            s.diary[idx].text = $(this).val();
            saveSettings();
        });

        $win.on("change", "#uie-diary-font", function(e) {
            e.preventDefault();
            updateCurrentDiaryStyle((style) => { style.font = String($(this).val() || DIARY_FONT_CHOICES[0]); });
        });
        $win.on("input change", "#uie-diary-text-color", function(e) {
            e.preventDefault();
            updateCurrentDiaryStyle((style) => { style.color = String($(this).val() || "#241207"); });
        });
        $win.on("input change", "#uie-diary-paper-color", function(e) {
            e.preventDefault();
            updateCurrentDiaryStyle((style) => { style.paperColor = String($(this).val() || ""); });
        });
        $win.on("change", "#uie-diary-photo-fit-mode", function(e) {
            e.preventDefault();
            const s = getSettings();
            ensureDiaryModel(s);
            const mode = String($(this).val() || "contain") === "stretch" ? "stretch" : "contain";
            if (!s.diary[idx]) s.diary[idx] = { title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [], photos: [] };
            s.diary[idx].photoFitMode = mode;
            const photos = Array.isArray(s.diary[idx].photos) ? s.diary[idx].photos : [];
            photos.forEach((photo) => {
                if (photo && typeof photo === "object") photo.fitMode = mode;
            });
            saveSettings();
            renderGlobalItems();
        });
        $win.on("click", "#uie-diary-bold, #uie-diary-italic, #uie-diary-underline", function(e) {
            e.preventDefault();
            const id = String(this.id || "");
            updateCurrentDiaryStyle((style) => {
                if (id === "uie-diary-bold") style.bold = style.bold !== true;
                if (id === "uie-diary-italic") style.italic = style.italic !== true;
                if (id === "uie-diary-underline") style.underline = style.underline !== true;
            });
        });
        $win.on("click", "#uie-diary-text-dec, #uie-diary-text-inc", function(e) {
            e.preventDefault();
            const id = String(this.id || "");
            updateCurrentDiaryStyle((style) => {
                let size = typeof style.fontSize === "number" ? style.fontSize : 16;
                if (id === "uie-diary-text-dec") {
                    size = Math.max(10, size - 2);
                } else if (id === "uie-diary-text-inc") {
                    size = Math.min(48, size + 2);
                }
                style.fontSize = size;
            });
        });

        // Add Photo button click triggers file input
        $win.on("click", "#uie-diary-add-photo-btn", function(e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-diary-photo-file").trigger("click");
        });

        $win.on("change", "#uie-diary-photo-file", function() {
            const file = this.files && this.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                addDiaryPhotoDataUrl(String(ev.target.result || ""));
            };
            reader.readAsDataURL(file);
            $(this).val("");
        });

        $win.on("click", "#uie-diary-photo-clear", function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!confirm("Clear all photos from this page?")) return;
            const s = getSettings();
            ensureDiaryModel(s);
            s.diary[idx].photos = [];
            saveSettings();
            renderDiary();
        });

        $win.on("click", "#uie-diary-photo-copy", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const s = getSettings();
            ensureDiaryModel(s);
            const firstPhoto = s.diary?.[idx]?.photos?.[0];
            const img = String(firstPhoto?.src || "");
            if (!img) { try { if (window.toastr) window.toastr.info("No photo to copy."); } catch (_) {} return; }
            const blob = dataUrlToBlob(img);
            if (!blob) { try { if (window.toastr) window.toastr.error("Copy failed."); } catch (_) {} return; }
            try {
                if (!navigator.clipboard?.write) throw new Error("no clipboard.write");
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                try { if (window.toastr) window.toastr.success("First photo copied."); } catch (_) {}
            } catch (_) {
                try { if (window.toastr) window.toastr.info("Copy not available on this device."); } catch (_) {}
            }
        });

        // Paste on window (for images)
        $win.on("paste", function(e) {
            try {
                const items = e?.originalEvent?.clipboardData?.items || e?.clipboardData?.items || [];
                if (!items || !items.length) return;
                for (const it of items) {
                    const type = String(it?.type || "");
                    if (!type.startsWith("image/")) continue;
                    const f = it.getAsFile?.();
                    if (!f) continue;
                    e.preventDefault();
                    e.stopPropagation();
                    applyDiaryImageFromFile(f);
                    try { if (window.toastr) window.toastr.success("Pasted image."); } catch (_) {}
                    return;
                }
            } catch (_) {}
        });

        // DELETE PAGE
        $win.on("click", "#uie-diary-delete", () => {
            if (!confirm("Delete this page? This cannot be undone.")) return;
            animateDiaryTurn("delete", () => {
                const s = getSettings();
                ensureDiaryModel(s);
                if (s.diary.length <= 1) {
                    s.diary = [{ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [], photos: [] }];
                    idx = 0;
                    saveSettings();
                    if(window.toastr) toastr.info("Cleared diary (cannot delete last page).");
                    return;
                }
                s.diary.splice(idx, 1);
                if (idx >= s.diary.length) idx = s.diary.length - 1;
                saveSettings();
                if(window.toastr) toastr.success("Page Deleted");
            });
        });

        // NEW PAGE
        $win.on("click", "#uie-diary-new", () => {
            animateDiaryTurn("new", () => {
                const s = getSettings();
                ensureDiaryModel(s);
                s.diary.push({title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [], photos: []});
                idx = s.diary.length - 1; // Jump to end
                saveSettings();
                if(window.toastr) toastr.success("New Page Created");
            }, () => $("#uie-diary-title").focus());
        });

        $win.on("click", "#uie-diary-prev", () => {
            if (idx > 0) {
                animateDiaryTurn("prev", () => { idx--; });
            }
        });

        $win.on("click", "#uie-diary-next", () => {
            const s = getSettings();
            if (idx < s.diary.length - 1) {
                animateDiaryTurn("next", () => { idx++; });
            }
            else {
                if(window.toastr) toastr.info("End of Diary. Click 'New Page' to add more.");
            }
        });
    }

    renderDiary();
}
