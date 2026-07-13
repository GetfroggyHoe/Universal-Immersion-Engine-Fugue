/**
 * roster.js — Generational Roster System
 * Dynamic entity aging, age-bracketed visual macros, location-locking, tabbed UI.
 * Includes location-lock enforcement for travel/movement guards.
 */
import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

// ─── MODULE 1: AGING ENGINE ────────────────────────────────────────

function getAllSocialEntities(s) {
    const out = [];
    if (s.social && typeof s.social === "object") {
        for (const tab of ["friends", "associates", "romance", "family", "rivals"]) {
            const arr = Array.isArray(s.social[tab]) ? s.social[tab] : [];
            arr.forEach(p => { if (p && p.name) out.push(p); });
        }
    }
    if (s.relationships && typeof s.relationships === "object") {
        for (const key of Object.keys(s.relationships)) {
            if (key === "messages") continue;
            const p = s.relationships[key];
            if (p && p.name) out.push(p);
        }
    }
    return out;
}

function getEffectiveRpDate(s) {
    try {
        if (s.calendar?.rpEnabled && s.calendar?.rpDate) {
            const m = String(s.calendar.rpDate).match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})$/);
            if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
        }
    } catch (_) {}
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function parseBirthDate(raw) {
    if (!raw) return null;
    if (typeof raw === "object" && raw.year) return raw;
    const m = String(raw).match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    return null;
}

/**
 * Check all entities for birthdays. Increments currentAge by agingMultiplier when
 * the RP calendar year has advanced past their last checked year.
 */
export function checkBirthdays() {
    const s = getSettings();
    const rpDate = getEffectiveRpDate(s);
    const entities = getAllSocialEntities(s);
    let changed = false;

    for (const ent of entities) {
        const bd = parseBirthDate(ent.birthDate);
        if (!bd) continue;
        const mult = Number.isFinite(Number(ent.agingMultiplier)) ? Number(ent.agingMultiplier) : 1.0;
        if (mult <= 0) continue; // immortal

        // Track last checked year to avoid double-aging on repeated calls
        const lastChecked = Number(ent._lastAgeCheckYear) || bd.year;
        const expectedAge = rpDate.year - bd.year;
        const hasBirthdayPassed = rpDate.month > bd.month || (rpDate.month === bd.month && rpDate.day >= bd.day);
        const targetAge = hasBirthdayPassed ? expectedAge : Math.max(0, expectedAge - 1);
        const scaledAge = Math.max(0, Math.round(targetAge * mult));

        if (scaledAge !== Math.round(Number(ent.currentAge) || 0)) {
            const prevAge = Math.round(Number(ent.currentAge) || 0);
            ent.currentAge = scaledAge;
            ent._lastAgeCheckYear = rpDate.year;
            changed = true;

            if (scaledAge > prevAge) {
                try {
                    const msg = `${ent.name} has aged to ${scaledAge}`;
                    if (typeof window.toastr?.info === "function") window.toastr.info(msg, "Birthday");
                    else if (typeof window.showToast === "function") window.showToast(msg, 4000);
                    notify("info", msg, "Roster");
                } catch (_) {}
            }
        }
    }

    if (changed) saveSettings();
    return changed;
}

// ─── MODULE 2: VISUAL SPRITE SWAPPER ───────────────────────────────

/**
 * Evaluate entity's currentAge against sprite_macros and return the matching base64 string.
 * Falls back to entity.avatar if no macro matches.
 */
export function getActiveSprite(entity) {
    if (!entity) return "";
    const age = Number(entity.currentAge) || 0;
    const macros = Array.isArray(entity.sprite_macros) ? entity.sprite_macros : [];

    for (const macro of macros) {
        const min = Number(macro.min_age);
        const max = Number(macro.max_age);
        if (Number.isFinite(min) && Number.isFinite(max) && age >= min && age <= max) {
            if (macro.base64_string) return String(macro.base64_string);
        }
    }
    return String(entity.avatar || "");
}

// ─── MODULE 3: LOCATION LOCK ───────────────────────────────────────

export function isEntityLocationLocked(entity) {
    return entity?.lockedLocation !== null && entity?.lockedLocation !== undefined;
}

/**
 * Returns the current player location as an {x,y,z,locId} object for coordinate-based locking.
 */
function getCurrentPlayerCoord() {
    const s = getSettings();
    const coord = s?.worldState?.playerCoord || {};
    return {
        x: Number(coord.x || s?.worldState?.x || 0),
        y: Number(coord.y || s?.worldState?.y || 0),
        z: Number(coord.z || 0),
        locId: String(s?.worldState?.currentLocation || s?.worldState?.location || "Unknown")
    };
}

export function setEntityLocationLock(entity, lock) {
    if (!entity) return;
    if (lock) {
        const coord = getCurrentPlayerCoord();
        const lockObj = { x: coord.x, y: coord.y, z: coord.z };
        entity.lockedLocation = lockObj;
        entity._lockedCoord = lockObj;
    } else {
        entity.lockedLocation = null;
        entity._lockedCoord = null;
    }
    saveSettings();
}

/**
 * Guard: checks whether a given entity CAN be moved.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 * This MUST be called before the travel engine or AI moves any entity.
 */
export function canMoveEntity(entity) {
    if (!entity) return { allowed: true };
    if (entity.lockedLocation !== null && entity.lockedLocation !== undefined) {
        const locStr = typeof entity.lockedLocation === "object" ? `${entity.lockedLocation.x},${entity.lockedLocation.y},${entity.lockedLocation.z}` : String(entity.lockedLocation);
        return {
            allowed: false,
            reason: `${String(entity.name || "Entity")} is location-locked to ${locStr}. Unlock before moving.`
        };
    }
    return { allowed: true };
}

/**
 * Convenience: find entity by name across all social tabs and check lock.
 * Returns { allowed, reason, entity }.
 */
export function canMoveEntityByName(name) {
    const s = getSettings();
    const key = String(name || "").trim().toLowerCase();
    if (!key) return { allowed: true, entity: null };
    for (const tab of ["friends", "associates", "romance", "family", "rivals"]) {
        const arr = Array.isArray(s?.social?.[tab]) ? s.social[tab] : [];
        for (const ent of arr) {
            if (String(ent?.name || "").trim().toLowerCase() === key) {
                const result = canMoveEntity(ent);
                return { ...result, entity: ent };
            }
        }
    }
    return { allowed: true, entity: null };
}

// ─── MODULE 4: ROSTER UI ───────────────────────────────────────────

let rosterTab = "main";

function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ensureRosterDom() {
    if (document.getElementById("uie-roster-modal")) return;
    const modal = document.createElement("div");
    modal.id = "uie-roster-modal";
    modal.style.cssText = `
        display:none; position:fixed; inset:0; z-index:99999;
        background:rgba(0,0,0,0.85); backdrop-filter:blur(8px);
        align-items:center; justify-content:center; font-family:'Inter','Segoe UI',sans-serif;
    `;
    modal.innerHTML = `
    <div id="roster-inner" style="
        width:min(94vw,720px); max-height:88vh; border-radius:16px; overflow:hidden;
        background:linear-gradient(145deg,#0d0d1a 0%,#1a1a2e 50%,#16213e 100%);
        border:1px solid rgba(0,255,255,0.15); box-shadow:0 0 40px rgba(0,255,255,0.08);
        display:flex; flex-direction:column;
    ">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:18px; font-weight:700; color:#e0e0ff; letter-spacing:0.5px;">
                <i class="fa-solid fa-dna" style="color:#0ff; margin-right:8px;"></i>Generational Roster
            </div>
            <button id="roster-close-btn" style="background:none; border:none; color:#888; font-size:22px; cursor:pointer; padding:4px 8px;">&times;</button>
        </div>

        <div id="roster-tabs" style="display:flex; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.25);">
            <button class="roster-tab active" data-tab="main" style="flex:1; padding:10px; background:none; border:none; border-bottom:2px solid #0ff; color:#0ff; font-weight:600; font-size:13px; cursor:pointer; transition:all 0.2s;">Main Cast</button>
            <button class="roster-tab" data-tab="known" style="flex:1; padding:10px; background:none; border:none; border-bottom:2px solid transparent; color:#666; font-weight:600; font-size:13px; cursor:pointer; transition:all 0.2s;">Known Souls</button>
            <button class="roster-tab" data-tab="lineage" style="flex:1; padding:10px; background:none; border:none; border-bottom:2px solid transparent; color:#666; font-weight:600; font-size:13px; cursor:pointer; transition:all 0.2s;">Custom Lineage</button>
        </div>

        <div id="roster-body" style="flex:1; overflow-y:auto; padding:16px; min-height:200px;"></div>
    </div>`;
    document.body.appendChild(modal);

    modal.querySelector("#roster-close-btn").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

    modal.querySelectorAll(".roster-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            rosterTab = btn.dataset.tab;
            modal.querySelectorAll(".roster-tab").forEach(b => {
                b.style.borderBottomColor = b === btn ? "#0ff" : "transparent";
                b.style.color = b === btn ? "#0ff" : "#666";
                b.classList.toggle("active", b === btn);
            });
            renderRosterBody();
        });
    });

    $(document).off("click.rosterCard").on("click.rosterCard", "#uie-roster-modal .roster-card", function(e) {
        if ($(e.target).closest(".roster-lock-cb, label").length) return;
        const name = $(this).data("name");
        if (name) {
            $("#uie-roster-modal").css("display", "none");
            if (typeof window.openProfileByName === "function") {
                window.openProfileByName(name);
            }
        }
    });
}

function renderEntityCard(ent) {
    const age = Math.round(Number(ent.currentAge) || 0);
    const bd = parseBirthDate(ent.birthDate);
    const bdStr = bd ? `${bd.year}-${String(bd.month).padStart(2,"0")}-${String(bd.day).padStart(2,"0")}` : "—";
    const mult = Number(ent.agingMultiplier ?? 1);
    const locked = isEntityLocationLocked(ent);
    const sprite = getActiveSprite(ent);
    const macroCount = (ent.sprite_macros || []).length;

    return `<div class="roster-card" data-name="${esc(ent.name)}" style="
        display:flex; gap:12px; padding:12px; margin-bottom:8px; border-radius:10px;
        background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);
        transition:background 0.2s; cursor:pointer;
    " onmouseenter="this.style.background='rgba(0,255,255,0.04)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)'">
        <div style="width:48px; height:48px; border-radius:50%; overflow:hidden; flex-shrink:0; background:#1a1a2e; border:2px solid rgba(0,255,255,0.2); display:flex; align-items:center; justify-content:center;">
            ${sprite ? `<img src="${esc(sprite)}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-user" style="color:#555; font-size:20px;"></i>`}
        </div>
        <div style="flex:1; min-width:0;">
            <div style="font-weight:700; color:#e0e0ff; font-size:14px;">${esc(ent.name)}</div>
            <div style="font-size:11px; color:#888; margin-top:2px;">
                Age: <span style="color:#0ff;">${age}</span> · Born: ${esc(bdStr)} · Mult: ×${mult} · Sprites: ${macroCount}
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
                <label style="font-size:11px; color:${locked ? '#ff6' : '#666'}; cursor:pointer; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" class="roster-lock-cb" data-name="${esc(ent.name)}" ${locked ? "checked" : ""} style="accent-color:#0ff;">
                    [ 🔒 Lock to Current Room ]
                </label>
            </div>
        </div>
    </div>`;
}

function renderRosterBody() {
    const body = document.getElementById("roster-body");
    if (!body) return;
    const s = getSettings();

    if (rosterTab === "main") {
        const cast = [];
        for (const tab of ["friends", "romance", "family"]) {
            (s.social?.[tab] || []).forEach(p => { if (p?.met_physically === true) cast.push(p); });
        }
        if (!cast.length) {
            body.innerHTML = `<div style="text-align:center; padding:40px; color:#555; font-size:14px;">No Main Cast members yet.<br><span style="font-size:12px; opacity:0.7;">Physically met friends, romance, and family appear here.</span></div>`;
        } else {
            body.innerHTML = cast.map(renderEntityCard).join("");
        }
    } else if (rosterTab === "known") {
        const known = [];
        for (const tab of ["associates", "rivals"]) {
            (s.social?.[tab] || []).forEach(p => { if (p?.name) known.push(p); });
        }
        for (const tab of ["friends", "romance", "family"]) {
            (s.social?.[tab] || []).forEach(p => { if (p?.name && !p.met_physically) known.push(p); });
        }
        if (!known.length) {
            body.innerHTML = `<div style="text-align:center; padding:40px; color:#555; font-size:14px;">No Known Souls yet.<br><span style="font-size:12px; opacity:0.7;">Associates, rivals, and unmet contacts appear here.</span></div>`;
        } else {
            body.innerHTML = known.map(renderEntityCard).join("");
        }
    } else if (rosterTab === "lineage") {
        renderLineageTab(body, s);
    }

    // Bind lock checkboxes
    body.querySelectorAll(".roster-lock-cb").forEach(cb => {
        cb.addEventListener("change", () => {
            const name = cb.dataset.name;
            const ent = getAllSocialEntities(getSettings()).find(e => e.name === name);
            if (ent) {
                setEntityLocationLock(ent, cb.checked);
                renderRosterBody();
            }
        });
    });
}

/** Pending sprite macros for the lineage creation form (populated via file upload). */
let _pendingSpriteSlots = [];

function readFileAsBase64(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e?.target?.result || ""));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

function renderSpriteSlots(container) {
    if (!container) return;
    container.innerHTML = "";
    if (!_pendingSpriteSlots.length) {
        container.innerHTML = `<div style="text-align:center; padding:12px; color:#555; font-size:11px; border:1px dashed rgba(255,255,255,0.1); border-radius:8px;">No sprite macros added yet. Upload images below.</div>`;
        return;
    }
    _pendingSpriteSlots.forEach((slot, i) => {
        const thumb = String(slot.base64_string || "").slice(0, 120);
        const el = document.createElement("div");
        el.style.cssText = `display:flex; gap:8px; align-items:center; padding:8px; border:1px solid rgba(0,255,255,0.12); border-radius:8px; background:rgba(0,0,0,0.2);`;
        el.innerHTML = `
            <div style="width:40px; height:40px; border-radius:6px; overflow:hidden; flex-shrink:0; background:#111; border:1px solid rgba(255,255,255,0.1);">
                ${slot.base64_string ? `<img src="${esc(slot.base64_string)}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-image" style="color:#555; font-size:16px; display:flex; align-items:center; justify-content:center; width:100%; height:100%;"></i>`}
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex:1;">
                <input type="number" class="sprite-min-age" data-idx="${i}" value="${slot.min_age}" min="0" max="999" placeholder="Min" title="Min Age" style="width:52px; padding:4px 6px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:11px; text-align:center;">
                <span style="color:#555; font-size:10px;">→</span>
                <input type="number" class="sprite-max-age" data-idx="${i}" value="${slot.max_age}" min="0" max="999" placeholder="Max" title="Max Age" style="width:52px; padding:4px 6px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:11px; text-align:center;">
                <span style="color:#666; font-size:10px; margin-left:2px;">yrs</span>
            </div>
            <button class="sprite-del-btn" data-idx="${i}" title="Remove" style="background:none; border:none; color:#f44; cursor:pointer; font-size:14px; padding:4px;"><i class="fa-solid fa-trash-can"></i></button>
        `;
        container.appendChild(el);
    });

    // Bind age-range inputs
    container.querySelectorAll(".sprite-min-age").forEach(inp => {
        inp.addEventListener("change", () => {
            const idx = Number(inp.dataset.idx);
            if (_pendingSpriteSlots[idx]) _pendingSpriteSlots[idx].min_age = Number(inp.value) || 0;
        });
    });
    container.querySelectorAll(".sprite-max-age").forEach(inp => {
        inp.addEventListener("change", () => {
            const idx = Number(inp.dataset.idx);
            if (_pendingSpriteSlots[idx]) _pendingSpriteSlots[idx].max_age = Number(inp.value) || 99;
        });
    });
    container.querySelectorAll(".sprite-del-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.idx);
            _pendingSpriteSlots.splice(idx, 1);
            renderSpriteSlots(container);
        });
    });
}

function renderLineageTab(body, s) {
    const lineage = getAllSocialEntities(s).filter(e => e.lineage === true);
    _pendingSpriteSlots = [];

    body.innerHTML = `
    <div style="margin-bottom:16px; padding:14px; border-radius:10px; background:rgba(0,255,255,0.03); border:1px solid rgba(0,255,255,0.1);">
        <div style="font-weight:700; color:#0ff; font-size:13px; margin-bottom:10px;"><i class="fa-solid fa-plus" style="margin-right:6px;"></i>Create New Lineage Entity</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <input id="lineage-name" placeholder="Entity Name" style="padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:12px;">
            <input id="lineage-age" type="number" placeholder="Starting Age" value="25" min="0" style="padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:12px;">
            <input id="lineage-birthdate" placeholder="Birth Date (YYYY-MM-DD)" style="padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:12px;">
            <input id="lineage-mult" type="number" placeholder="Aging ×" value="1.0" min="0" step="0.1" style="padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:12px;">
        </div>

        <div style="margin-top:12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                <label style="font-size:12px; color:#0ff; font-weight:700;">
                    <i class="fa-solid fa-image" style="margin-right:4px;"></i>Sprite Macros (Age-Bracketed Visuals)
                </label>
                <div style="display:flex; gap:6px;">
                    <label id="lineage-sprite-upload-btn" style="padding:4px 10px; border-radius:6px; border:1px solid rgba(0,255,255,0.2); background:rgba(0,255,255,0.06); color:#0ff; font-size:11px; font-weight:600; cursor:pointer; transition:background 0.2s;" onmouseenter="this.style.background='rgba(0,255,255,0.12)'" onmouseleave="this.style.background='rgba(0,255,255,0.06)'">
                        <i class="fa-solid fa-upload" style="margin-right:4px;"></i>Upload Image
                        <input type="file" id="lineage-sprite-file" accept="image/*" multiple style="display:none;">
                    </label>
                </div>
            </div>
            <div id="lineage-sprite-slots" style="display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto;"></div>
            <details style="margin-top:8px;">
                <summary style="cursor:pointer; font-size:10px; color:#555;">
                    Or paste raw JSON sprite array…
                </summary>
                <textarea id="lineage-sprites" placeholder='[{"min_age":0,"max_age":17,"base64_string":"..."},{"min_age":18,"max_age":99,"base64_string":"..."}]' style="width:100%; margin-top:4px; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:#e0e0ff; font-size:11px; min-height:50px; resize:vertical; box-sizing:border-box;"></textarea>
            </details>
        </div>

        <button id="lineage-create-btn" style="margin-top:12px; width:100%; padding:10px 20px; border-radius:8px; border:none; background:linear-gradient(135deg,#0ff,#06f); color:#000; font-weight:700; font-size:13px; cursor:pointer; transition:opacity 0.2s; letter-spacing:0.5px;" onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">
            <i class="fa-solid fa-dna" style="margin-right:6px;"></i>Create Entity
        </button>
    </div>
    ${lineage.length ? lineage.map(renderEntityCard).join("") : `<div style="text-align:center; padding:20px; color:#555; font-size:13px;">No custom lineage entities created yet.</div>`}`;

    // Render initial empty sprite slots
    const slotsContainer = body.querySelector("#lineage-sprite-slots");
    renderSpriteSlots(slotsContainer);

    // Sprite file upload handler
    body.querySelector("#lineage-sprite-file")?.addEventListener("change", async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;
        for (const file of files) {
            const b64 = await readFileAsBase64(file);
            if (!b64) continue;
            const lastMax = _pendingSpriteSlots.length ? (_pendingSpriteSlots[_pendingSpriteSlots.length - 1].max_age + 1) : 0;
            _pendingSpriteSlots.push({
                min_age: lastMax,
                max_age: lastMax + 17,
                base64_string: b64
            });
        }
        e.target.value = "";
        renderSpriteSlots(slotsContainer);
    });

    // Create button
    body.querySelector("#lineage-create-btn")?.addEventListener("click", () => {
        const name = String(document.getElementById("lineage-name")?.value || "").trim();
        if (!name) { try { window.toastr?.error?.("Name is required."); } catch(_){} return; }
        const age = Number(document.getElementById("lineage-age")?.value) || 0;
        const bdRaw = String(document.getElementById("lineage-birthdate")?.value || "").trim();
        const mult = Number(document.getElementById("lineage-mult")?.value) || 1.0;

        // Merge uploaded sprite slots + JSON textarea
        let macros = [..._pendingSpriteSlots];
        try {
            const raw = document.getElementById("lineage-sprites")?.value || "";
            if (raw.trim()) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) macros = macros.concat(parsed);
            }
        } catch(_) {}

        const st = getSettings();
        if (!st.relationships || typeof st.relationships !== "object") st.relationships = {};

        const newEnt = {
            id: `lineage_${Date.now().toString(16)}_${Math.floor(Math.random()*1e9).toString(16)}`,
            name,
            currentAge: age,
            birthDate: bdRaw || null,
            agingMultiplier: mult,
            lockedLocation: null,
            _lockedCoord: null,
            sprite_macros: macros,
            lineage: true,
            affinity: 50,
            met_physically: false,
            known_from_past: false,
            liveSync: false,
            memories: [],
            thoughts: "", likes: "", dislikes: "", birthday: bdRaw,
            location: "", age: String(age), knownFamily: "", familyRole: "",
            relationshipStatus: "", url: "", avatar: ""
        };

        st.relationships[newEnt.id] = newEnt;
        saveSettings();
        _pendingSpriteSlots = [];
        try { window.toastr?.success?.(`${name} added to Custom Lineage.`); } catch(_){}
        notify("success", `${name} created in Custom Lineage (age ${age}, ${macros.length} sprites).`, "Roster");
        renderRosterBody();
    });
}

// ─── INIT & EXPORTS ────────────────────────────────────────────────

export function render() { openRoster(); }

export function openRoster() {
    ensureRosterDom();
    const modal = document.getElementById("uie-roster-modal");
    if (modal) {
        modal.style.display = "flex";
        renderRosterBody();
    }
}

export function initRoster() {
    ensureRosterDom();
    // Listen for time advancement events to trigger birthday checks
    try {
        window.addEventListener("uie:time_advanced", () => { checkBirthdays(); });
    } catch (_) {}
    // Initial birthday check
    try { checkBirthdays(); } catch (_) {}
    try { window.UIE = window.UIE || {}; window.UIE.roster = { openRoster, checkBirthdays, getActiveSprite, isEntityLocationLocked, canMoveEntity, canMoveEntityByName }; } catch (_) {}
}
