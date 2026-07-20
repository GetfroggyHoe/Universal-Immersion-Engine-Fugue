
import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";
import { injectRpEvent } from "./rp_log.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";
import { mutateStatusEffects } from "../statusFx.js";

let timer = null;
let currentActivity = null; // { id, name, startTime, duration, type }
let activeTab = "user";

// Same reward knobs as room actions / item use: `needs`, `progress` (HUD playerProgress),
// optional `gameHours` (in-world time), `stats` (character stat/xp changes), and `rewards.skills`.
const STARTER_ACTIVITIES = [
    { id: "custom_train", name: "Train", duration: 60, stats: { str: 1, dex: 1, xp: 12 }, needs: { energy: -8, hunger: -3, hygiene: -2 }, progress: { practice: 2 } },
    { id: "custom_study", name: "Study", duration: 60, stats: { int: 1, wis: 1, xp: 12 }, needs: { energy: -5, hunger: -2, social: -1 }, progress: { theory: 2, reading: 1 } }
];

let selectedPartyMemberId = "";
let editingActivityId = "";

function cloneActivity(activity) {
    return JSON.parse(JSON.stringify(activity || {}));
}

function ensureActivities(s) {
    if (!s) return;
    if (!s.activities) s.activities = {};
    if (!Array.isArray(s.activities.custom)) s.activities.custom = [];
    if (s.activities.seedVersion !== 2) {
        const existingCustom = s.activities.custom
            .filter((activity) => activity && typeof activity === "object")
            .filter((activity) => !STARTER_ACTIVITIES.some((starter) => String(starter.id) === String(activity.id)));
        s.activities.custom = [...STARTER_ACTIVITIES.map(cloneActivity), ...existingCustom];
        s.activities.seedVersion = 2;
    }
    if (!s.activities.history) s.activities.history = [];
    if (!Array.isArray(s.activities.partyAssignments)) s.activities.partyAssignments = [];
}

function ensurePartyMember(m) {
    if (!m || typeof m !== "object") return;
    if (!m.identity) m.identity = { name: "Member" };
    if (!m.stats || typeof m.stats !== "object") m.stats = {};
    if (!m.vitals || typeof m.vitals !== "object") m.vitals = {};
    if (!m.progression || typeof m.progression !== "object") m.progression = { level: 1, xp: 0 };
    if (!Array.isArray(m.skills)) m.skills = [];
    if (!Array.isArray(m.statusEffects)) m.statusEffects = [];
    if (typeof m.vitals.maxHp !== "number") m.vitals.maxHp = typeof m.vitals.hp === "number" ? m.vitals.hp : 100;
    if (typeof m.vitals.maxMp !== "number") m.vitals.maxMp = typeof m.vitals.mp === "number" ? m.vitals.mp : 50;
    if (typeof m.vitals.hp !== "number") m.vitals.hp = m.vitals.maxHp;
    if (typeof m.vitals.mp !== "number") m.vitals.mp = m.vitals.maxMp;
}

function getPartyMembers() {
    const s = getSettings();
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    return members.filter(m => m && typeof m === "object");
}

function findPartyMemberById(id) {
    const members = getPartyMembers();
    const sid = String(id || "");
    return members.find(m => String(m.id || "") === sid) || null;
}

function setActiveTab(next) {
    activeTab = "user";

    const userBtn = document.getElementById("uie-activity-tab-user");
    const partyBtn = document.getElementById("uie-activity-tab-party");
    const userPane = document.getElementById("uie-activity-pane-user");
    const partyPane = document.getElementById("uie-activity-pane-party");

    if (userPane) userPane.style.display = "";
    if (partyPane) partyPane.style.display = "";

    if (userBtn) {
        userBtn.classList.add("active");
    }
    if (partyBtn) {
        partyBtn.classList.remove("active");
    }
}

function applyActivityStatusEffects(target, activity, messages = []) {
    const rewards = activity?.rewards && typeof activity.rewards === "object" ? activity.rewards : {};
    const add = [
        ...(Array.isArray(activity?.statusEffects) ? activity.statusEffects : []),
        ...(Array.isArray(rewards.statusEffects) ? rewards.statusEffects : [])
    ];
    const remove = [
        ...(Array.isArray(activity?.removeStatusEffects) ? activity.removeStatusEffects : []),
        ...(Array.isArray(activity?.curesStatusEffects) ? activity.curesStatusEffects : []),
        ...(Array.isArray(rewards.removeStatusEffects) ? rewards.removeStatusEffects : []),
        ...(Array.isArray(rewards.curesStatusEffects) ? rewards.curesStatusEffects : [])
    ];
    const result = mutateStatusEffects(target, { add, remove });
    result.added.forEach((effect) => messages.push(`Status: ${effect.name}`));
    result.removed.forEach((effect) => messages.push(`Cured: ${effect.name}`));
    return result.changed;
}

function setSelectedPartyMember(id) {
    selectedPartyMemberId = String(id || "");
    renderPartyPane();
    render();
}

function partyAssignments(s = getSettings()) {
    ensureActivities(s);
    return s.activities.partyAssignments;
}

function formatPercent(elapsed, duration) {
    const total = Math.max(1, Number(duration || 1));
    return Math.max(0, Math.min(100, (Number(elapsed || 0) / total) * 100));
}

function renderPartyPane() {
    const $win = $("#uie-activities-window");
    if (!$win.is(":visible")) return;

    const members = getPartyMembers();
    const s = getSettings();
    completeFinishedPartyAssignments(s);

    if (!members.find(m => String(m.id || "") === selectedPartyMemberId)) {
        selectedPartyMemberId = members[0] ? String(members[0].id || "") : "";
    }

    const memberList = document.getElementById("uie-activity-party-members");
    if (memberList) {
        memberList.innerHTML = members.length ? members.map((m) => {
            const id = String(m.id || "");
            const name = String(m?.identity?.name || "Member");
            const busy = partyAssignments(s).find((entry) => String(entry.memberId) === id);
            return `
                <button type="button" class="uie-act-member-card ${id === selectedPartyMemberId ? "active" : ""}" data-member-id="${escapeHtml(id)}">
                    <strong>${escapeHtml(name)}</strong>
                    <span>${busy ? `Doing ${escapeHtml(String(busy.activityName || "Activity"))}` : "Available"}</span>
                </button>
            `;
        }).join("") : `<div class="uie-party-activity-row"><strong>No party members</strong><span>Add party members first.</span></div>`;
    }

    renderPartyActiveList(s);
}

function updatePartyPreview() {
    const box = document.getElementById("uie-activity-party-preview");
    if (!box) return;

    const memberId = selectedPartyMemberId;
    const actId = String(document.getElementById("uie-activity-party-actions")?.dataset?.previewActivityId || "");
    const m = memberId ? findPartyMemberById(memberId) : null;
    const act = actId ? getActivitiesList().find(a => String(a.id) === actId) : null;

    if (!m) {
        box.textContent = "Select a party member.";
        return;
    }
    if (!act) {
        box.textContent = "Choose Train, Study, or a custom activity below.";
        return;
    }

    const parts = [];
    const stats = act.stats && typeof act.stats === "object" ? act.stats : {};
    const keys = Object.keys(stats);
    for (const k of keys) {
        const v = Number(stats[k]);
        if (!Number.isFinite(v) || v === 0) continue;
        parts.push(`${String(k).toUpperCase()} +${v}`);
    }
    box.textContent = `${String(m?.identity?.name || "Member")}: ${String(act.name || "Activity")} (${formatTime(Number(act.duration || 0))})${parts.length ? `\nRewards: ${parts.join(", ")}` : ""}`;
}

function applyPartyActivity(activityId = "") {
    const memberId = selectedPartyMemberId;
    const actId = String(activityId || document.getElementById("uie-activity-party-actions")?.dataset?.previewActivityId || "");
    if (!memberId || !actId) {
        notify("warning", "Select a party member and an activity first.", "Activities");
        return;
    }

    const s = getSettings();
    ensureActivities(s);
    const m = findPartyMemberById(memberId);
    const act = getActivitiesList().find(a => String(a.id) === actId) || null;
    if (!m || !act) {
        notify("warning", "Selection not found.", "Activities");
        return;
    }

    const assignments = partyAssignments(s);
    const existing = assignments.find((entry) => String(entry.memberId) === memberId);
    if (existing) {
        notify("warning", `${String(m.identity?.name || "Member")} is already doing ${String(existing.activityName || "an activity")}.`, "Activities");
        return;
    }
    assignments.push({
        id: `party_act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        memberId,
        memberName: String(m.identity?.name || "Member"),
        activityId: String(act.id || ""),
        activityName: String(act.name || "Activity"),
        startTime: Date.now(),
        duration: Math.max(1, Number(act.duration || 60)),
    });
    saveSettings();
    notify("info", `${String(m.identity?.name || "Member")} started ${String(act.name || "Activity")}.`, "Activities");
    injectRpEvent(`[System: Party member ${String(m.identity?.name || "Member")} started ${String(act.name || "Activity")}.]`);
    if (timer) clearInterval(timer);
    timer = setInterval(updateCurrentUI, 1000);
    renderPartyPane();
}

function completePartyActivityAssignment(s, assignment) {
    const m = findPartyMemberById(assignment.memberId);
    const act = getActivitiesList().find(a => String(a.id) === String(assignment.activityId)) || null;
    if (!m || !act) return false;
    ensurePartyMember(m);
    const msg = [];
    const stats = act.stats && typeof act.stats === "object" ? act.stats : {};
    for (const [k, raw] of Object.entries(stats)) {
        const v = Number(raw);
        if (!Number.isFinite(v) || v === 0) continue;
        const key = String(k || "").toLowerCase();
        if (key === "xp") {
            m.progression.xp = Number(m.progression.xp || 0) + v;
            msg.push(`${v} XP`);
        } else if (key === "hp") {
            m.vitals.hp = Math.min(Number(m.vitals.maxHp || 100), Number(m.vitals.hp || 0) + v);
            msg.push(`HP +${v}`);
        } else if (key === "mp") {
            m.vitals.mp = Math.min(Number(m.vitals.maxMp || 50), Number(m.vitals.mp || 0) + v);
            msg.push(`MP +${v}`);
        } else {
            const cur = Number(m.stats[key]);
            const base = Number.isFinite(cur) ? cur : 10;
            m.stats[key] = base + v;
            msg.push(`${key.toUpperCase()} +${v}`);
        }
    }

    if (act.rewards) {
        if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
        if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
        if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
        if (Array.isArray(act.rewards.items)) {
            act.rewards.items.forEach(it => {
                addInventoryItemWithStack(s.inventory.items, { ...it, qty: it.qty || 1 }, { source: "activity_reward" });
                msg.push(`Item: ${it.name}`);
            });
        }
        if (Array.isArray(act.rewards.skills)) {
            act.rewards.skills.forEach(sk => {
                const nm = String(sk?.name || "").trim();
                if (!nm) return;
                if (!m.skills.find(x => String(x?.name || "").trim() === nm)) {
                    m.skills.push(sk);
                    msg.push(`Skill: ${nm}`);
                }
            });
        }
    }

    notify("success", `${String(m.identity?.name || "Member")} completed ${String(act.name || "Activity")}. Gained: ${msg.join(", ") || "(no changes)"}`, "Activities");
    injectRpEvent(`[System: Party member ${String(m.identity?.name || "Member")} completed ${String(act.name || "Activity")}. Gained: ${msg.join(", ") || "(no changes)"}.]`);
    return true;
}

function completeFinishedPartyAssignments(s = getSettings()) {
    const assignments = partyAssignments(s);
    if (!assignments.length) return false;
    const now = Date.now();
    let changed = false;
    const remaining = [];
    for (const assignment of assignments) {
        const elapsed = (now - Number(assignment.startTime || now)) / 1000;
        if (elapsed >= Number(assignment.duration || 1)) {
            completePartyActivityAssignment(s, assignment);
            changed = true;
        } else {
            remaining.push(assignment);
        }
    }
    applyActivityStatusEffects(m, act, msg);
    if (changed) {
        s.activities.partyAssignments = remaining;
        saveSettings();
    }
    return changed;
}

function renderPartyActiveList(s = getSettings()) {
    const box = document.getElementById("uie-activity-party-active-list");
    if (!box) return;
    const assignments = partyAssignments(s);
    if (!assignments.length) {
        box.innerHTML = `<div class="uie-party-activity-row"><strong>No party activities running</strong><span>Assign a member above.</span></div>`;
        return;
    }
    const now = Date.now();
    box.innerHTML = assignments.map((assignment) => {
        const elapsed = (now - Number(assignment.startTime || now)) / 1000;
        const duration = Math.max(1, Number(assignment.duration || 1));
        const pct = formatPercent(elapsed, duration);
        const remain = Math.max(0, duration - elapsed);
        return `
            <div class="uie-party-activity-row">
                <strong>${escapeHtml(String(assignment.memberName || "Member"))}</strong>
                <span title="${escapeHtml(String(assignment.activityName || "Activity"))}">${escapeHtml(String(assignment.activityName || "Activity"))} - ${formatTime(Math.ceil(remain))}</span>
                <div class="uie-act-progress-track" style="margin-top:8px;"><div class="uie-act-progress-fill" style="width:${pct}%;"></div></div>
            </div>
        `;
    }).join("");
}

function getActivitiesList() {
    const s = getSettings();
    ensureActivities(s);
    return s.activities.custom;
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getActivityIcon(name) {
    const n = String(name || "").toLowerCase();
    if (n.includes("uie") || n.includes("stage") || n.includes("rehears")) return "fa-microphone-lines";
    if (n.includes("gift") || n.includes("likes") || n.includes("social") || n.includes("shared")) return "fa-heart";
    if (n.includes("train") || n.includes("str") || n.includes("lift")) return "fa-dumbbell";
    if (n.includes("run") || n.includes("dex") || n.includes("agi") || n.includes("speed")) return "fa-person-running";
    if (n.includes("medit") || n.includes("spi") || n.includes("mana") || n.includes("magic")) return "fa-om";
    if (n.includes("study") || n.includes("read") || n.includes("int") || n.includes("learn")) return "fa-book-open";
    if (n.includes("rest") || n.includes("sleep") || n.includes("nap")) return "fa-bed";
    if (n.includes("eat") || n.includes("meal") || n.includes("cook") || n.includes("snack") || n.includes("food")) return "fa-utensils";
    if (n.includes("work") || n.includes("job") || n.includes("craft")) return "fa-briefcase";
    if (n.includes("tidy") || n.includes("clean") || n.includes("reset")) return "fa-broom";
    if (n.includes("swim")) return "fa-person-swimming";
    if (n.includes("climb")) return "fa-mountain";
    return "fa-person-walking";
}

export function render() {
    const $win = $("#uie-activities-window");
    if (!$win.is(":visible")) return;

    const s = getSettings();
    const list = getActivitiesList();
    const $list = $("#uie-activities-list");
    $list.empty();

    // Clear inline styles if any (from previous version)
    $list.removeAttr("style");

    const template = document.getElementById("uie-activity-card-template");

    list.forEach(act => {
        const icon = getActivityIcon(act.name);
        const isActive = currentActivity && currentActivity.id === act.id;

        const clone = template.content.cloneNode(true);
        const $el = $(clone).find(".uie-activity-card");

        if (isActive) $el.addClass("active");

        const $icon = $el.find(".uie-activity-icon");
        if (act.img) {
            const img = document.createElement("img");
            img.src = act.img;
            Object.assign(img.style, {width:"100%", height:"100%", objectFit:"cover", borderRadius:"8px"});
            $icon.append(img);
        } else {
            const i = document.createElement("i");
            i.className = `fa-solid ${icon}`;
            $icon.append(i);
        }

        $el.find(".uie-activity-name").text(act.name);
        $el.find(".duration-text").text(formatTime(act.duration));

        const rewardsContainer = $el.find(".uie-activity-rewards");
        const tmplStat = document.getElementById("uie-template-activity-stat");
        if (tmplStat) {
            const stats = Object.entries(act.stats || {});
            const progress = Object.entries(act.progress || {});
            let sep = false;
            const appendEntry = (k, v) => {
                const n = Number(v);
                if (!Number.isFinite(n) || n === 0) return;
                if (sep) rewardsContainer.append(document.createTextNode(" • "));
                sep = true;
                const sClone = tmplStat.content.cloneNode(true);
                const label = sClone.querySelector(".uie-stat-label");
                const val = sClone.querySelector(".uie-stat-val");
                if (label) label.textContent = k.toUpperCase();
                if (val) val.textContent = `${n >= 0 ? "+" : ""}${n}`;
                rewardsContainer.append(sClone);
            };
            stats.forEach(([k, v]) => appendEntry(k, v));
            progress.forEach(([k, v]) => appendEntry(k, v));
            const gh = Number(act.gameHours ?? act.hours ?? 0);
            if (gh > 0) {
                if (sep) rewardsContainer.append(document.createTextNode(" • "));
                const sClone = tmplStat.content.cloneNode(true);
                const label = sClone.querySelector(".uie-stat-label");
                const val = sClone.querySelector(".uie-stat-val");
                if (label) label.textContent = "TIME";
                if (val) val.textContent = `+${gh}h`;
                rewardsContainer.append(sClone);
            }
            const skills = Array.isArray(act.rewards?.skills) ? act.rewards.skills : [];
            skills.slice(0, 2).forEach((sk) => appendEntry(String(sk?.name || "Skill"), 1));
        }

        const $action = $el.find(".uie-activity-action");
        if (isActive) {
            const tmplActive = document.getElementById("uie-template-activity-active-label");
            if (tmplActive) {
                $action.empty().append(tmplActive.content.cloneNode(true));
            }
        } else {
            // Keep default icon
        }

        const $edit = $el.find(".uie-activity-edit");
        $edit.attr("data-id", act.id).show();
        if (!isActive) {
            $edit.on("click", (e) => {
                e.stopPropagation();
                editActivity(act.id);
            });
        }

        const $del = $el.find(".uie-activity-del");
        $del.attr("data-id", act.id).show();
        if (!isActive) {
            $del.on("click", (e) => {
                e.stopPropagation();
                deleteActivity(act.id);
            });
        }

        const $assign = $el.find(".uie-activity-assign");
        const selectedMember = selectedPartyMemberId ? findPartyMemberById(selectedPartyMemberId) : null;
        if (selectedMember && !isActive) {
            $assign.attr("data-id", act.id).show();
            $assign.on("click", (e) => {
                e.stopPropagation();
                applyPartyActivity(act.id);
            });
        }

        if (!isActive) {
            $el.find(".uie-activity-action, .uie-activity-info, .uie-activity-icon").on("click", () => startActivity(act));
        }

        $list.append($el);
    });

    updateCurrentUI();

    try { renderPartyPane(); } catch (_) {}
}

function deleteActivity(id) {
    if (!confirm("Delete this activity?")) return;
    const s = getSettings();
    if (s.activities && Array.isArray(s.activities.custom)) {
        s.activities.custom = s.activities.custom.filter(x => x.id !== id);
        saveSettings();
        render();
        notify("success", "Activity deleted", "Activities");
    }
}

function editActivity(id) {
    const act = getActivitiesList().find((entry) => String(entry.id || "") === String(id || ""));
    if (!act) return;
    editingActivityId = String(act.id || "");
    $("#uie-activity-new-name").val(act.name || "");
    $("#uie-activity-new-duration").val(Math.max(1, Math.round(Number(act.duration || 60) / 60)));
    $("#uie-activity-new-name").focus();
    $("#uie-activity-create").text("Save");
}

function updateCurrentUI() {
    const s = getSettings();
    const partyChanged = completeFinishedPartyAssignments(s);
    renderPartyActiveList(s);
    const $display = $("#uie-activity-current-display");
    const $prog = $("#uie-activity-progress");
    const $timer = $("#uie-activity-timer");
    const $stop = $("#uie-activity-stop");

    if (!currentActivity) {
        $display.text("Free Time");
        $prog.css("width", "0%");
        $timer.text("--:--");
        $stop.hide();
        if (partyChanged) renderPartyPane();
        if (!partyAssignments(s).length && timer) {
            clearInterval(timer);
            timer = null;
        }
        return;
    }

    $display.text(currentActivity.name);
    $stop.show();

    const elapsed = (Date.now() - currentActivity.startTime) / 1000;
    const total = currentActivity.duration;
    const pct = Math.min(100, (elapsed / total) * 100);
    const remain = Math.max(0, total - elapsed);

    $prog.css("width", `${pct}%`);
    $timer.text(formatTime(Math.ceil(remain)));

    if (elapsed >= total) {
        completeActivity();
    }
}

function startActivity(act) {
    if (currentActivity) {
        notify("warning", "Finish your current activity first!", "Activities");
        return;
    }

    currentActivity = {
        ...act,
        startTime: Date.now()
    };

    notify("info", `Started: ${act.name}`, "Activities");
    injectRpEvent(`[System: User started activity: ${act.name}.]`);

    if (timer) clearInterval(timer);
    timer = setInterval(updateCurrentUI, 1000);
    render(); // Re-render to show active state on card
}

function stopActivity() {
    if (!currentActivity) return;
    notify("info", `Stopped: ${currentActivity.name}`, "Activities");
    currentActivity = null;
    if (timer) clearInterval(timer);
    render();
}

function applySleepLikeVfx(act) {
    const id = String(act?.id || "");
    const nm = String(act?.name || "").toLowerCase();
    const sleepLike =
        id === "sleep_night" ||
        id === "nap_break" ||
        id === "rest" ||
        /\bsleep\b|\bnap\b|\brest\b/i.test(nm);
    if (!sleepLike) return;
    const root = document.getElementById("game-root");
    if (!root) return;
    const heavy = id === "sleep_night" || /\b8\b.*hour|sleep\s*\(/.test(nm);
    root.style.filter = heavy ? "blur(4px) brightness(0.75)" : "blur(2px) brightness(0.9)";
    setTimeout(() => {
      try {
        root.style.filter = "";
      } catch (_) {}
    }, heavy ? 650 : 500);
}

export function startActivityById(idRaw) {
    const id = String(idRaw || "").trim();
    if (!id) return false;
    const act = getActivitiesList().find((a) => String(a?.id || "") === id);
    if (!act) return false;
    startActivity(act);
    return true;
}

function completeActivity() {
    if (!currentActivity) return;
    const act = currentActivity;
    currentActivity = null;
    if (timer) clearInterval(timer);
    render();

    applySleepLikeVfx(act);

    const s = getSettings();
    const msg = [];

    if (act.stats && typeof act.stats === "object") {
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};
        if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
        if (!s.inventory.vitals || typeof s.inventory.vitals !== "object") s.inventory.vitals = {};

        if (act.stats.xp) {
            s.xp = (s.xp || 0) + act.stats.xp;
            s.inventory.vitals.xp = s.xp;
            msg.push(`${act.stats.xp} XP`);
        }
        if (act.stats.hp) {
            s.hp = Math.min(s.maxHp || 100, (s.hp || 0) + act.stats.hp);
            s.inventory.vitals.hp = s.hp;
            msg.push(`HP +${act.stats.hp}`);
        }
        if (act.stats.mp) {
            s.mp = Math.min(s.maxMp || 100, (s.mp || 0) + act.stats.mp);
            s.inventory.vitals.mp = s.mp;
            msg.push(`MP +${act.stats.mp}`);
        }

        ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"].forEach((stat) => {
            if (act.stats[stat]) {
                s.character.stats[stat] = (s.character.stats[stat] || 10) + act.stats[stat];
                msg.push(`${stat.toUpperCase()} +${act.stats[stat]}`);
            }
        });
    }

    if (act.rewards) {
        if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
        if (Array.isArray(act.rewards.items)) {
            if (!s.inventory.items) s.inventory.items = [];
            act.rewards.items.forEach((it) => {
                addInventoryItemWithStack(s.inventory.items, { ...it, qty: it.qty || 1 }, { source: "activity_reward" });
                msg.push(`Item: ${it.name}`);
            });
        }
        if (Array.isArray(act.rewards.skills)) {
            if (!s.inventory.skills) s.inventory.skills = [];
            act.rewards.skills.forEach((sk) => {
                const nm = String(sk?.name || "").trim();
                if (nm && !s.inventory.skills.find((x) => String(x?.name || "").trim() === nm)) {
                    s.inventory.skills.push(sk);
                    msg.push(`Skill: ${nm}`);
                }
            });
        }
    }
    if (!s.character || typeof s.character !== "object") s.character = {};
    applyActivityStatusEffects(s.character, act, msg);

    if (act.progress && typeof act.progress === "object" && typeof window.__UIE_applyProgressDelta === "function") {
        try {
            window.__UIE_applyProgressDelta(act.progress);
            for (const [k, raw] of Object.entries(act.progress)) {
                const n = Number(raw);
                if (!Number.isFinite(n) || n === 0) continue;
                msg.push(`${k} ${n >= 0 ? "+" : ""}${n}`);
            }
        } catch (_) {}
    }

    const gh = Number(act.gameHours ?? act.hours ?? 0);
    if (gh > 0 && typeof window.__UIE_bumpTime === "function") {
        try {
            window.__UIE_bumpTime(gh);
            msg.push(`time +${gh}h`);
        } catch (_) {}
    }

    if (act.needs && typeof act.needs === "object" && typeof window.__UIE_applyNeedsDelta === "function") {
        try {
            window.__UIE_applyNeedsDelta(act.needs);
        } catch (_) {}
    }

    if (msg.length) {
        notify("success", `Completed ${act.name}! ${msg.join(", ")}`, "Activities");
        injectRpEvent(`[System: User completed ${act.name}. ${msg.join(", ")}.]`);
    } else {
        notify("success", `Completed ${act.name}!`, "Activities");
        injectRpEvent(`[System: User completed ${act.name}.]`);
    }

    if (act.stats && typeof act.stats === "object") {
        import("../inventory.js").then((mod) => {
            if (mod.applyLevelingProgress) mod.applyLevelingProgress(s);
            mod.updateVitals();
        });
    }

    saveSettings();
}

function createCustomActivity() {
    const name = String($("#uie-activity-new-name").val() || "").trim();
    if (!name) return;

    const s = getSettings();
    ensureActivities(s);
    const durationMinutes = Math.max(1, Number($("#uie-activity-new-duration").val() || 1));

    const existing = editingActivityId
        ? s.activities.custom.find((entry) => String(entry.id || "") === editingActivityId)
        : null;
    const newAct = existing || {
        id: "custom_" + Date.now(),
        name: name,
        duration: durationMinutes * 60,
        stats: { xp: 8 },
        needs: { energy: -5 },
        progress: { practice: 1 }
    };
    newAct.name = name;
    newAct.duration = durationMinutes * 60;

    if (!existing) s.activities.custom.push(newAct);
    saveSettings();

    $("#uie-activity-new-name").val("");
    $("#uie-activity-new-duration").val("1");
    $("#uie-activity-create").text("Add");
    editingActivityId = "";
    render();
    notify("success", `${existing ? "Updated" : "Created"} activity: ${name}`, "Activities");
}

export function initActivities() {
    const $win = $("#uie-activities-window");
    // Do not force-hide here; this function is called when opening the window.

    // 1. Navigation
    $("body").off("click", ".uie-nav-item").on("click", ".uie-nav-item", function() {
        $(".uie-nav-item").removeClass("active");
        $(this).addClass("active");
        activeTab = $(this).data("tab");
        setActiveTab(activeTab);
    });

    // Close Button
    $("body").off("click", "#uie-activities-close-btn").on("click", "#uie-activities-close-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $win.hide();
    });

    $win.off("click.uieActTabs").on("click.uieActTabs", "#uie-activity-tab-user, #uie-activity-tab-party", (e) => {
        try { e?.preventDefault?.(); } catch (_) {}
        try { e?.stopPropagation?.(); } catch (_) {}
        const id = String(e?.currentTarget?.id || "");
        setActiveTab(id === "uie-activity-tab-party" ? "party" : "user");
        try { renderPartyPane(); } catch (_) {}
    });

    $win.off("click.uieActPartyMember").on("click.uieActPartyMember", ".uie-act-member-card", (e) => {
        try { e?.preventDefault?.(); } catch (_) {}
        try { e?.stopPropagation?.(); } catch (_) {}
        setSelectedPartyMember(e.currentTarget?.dataset?.memberId || "");
    });

    $win.off("pointerenter.uieActPartyAction focusin.uieActPartyAction")
        .on("pointerenter.uieActPartyAction focusin.uieActPartyAction", ".uie-act-party-action", (e) => {
            const host = document.getElementById("uie-activity-party-actions");
            if (host) host.dataset.previewActivityId = String(e.currentTarget?.dataset?.activityId || "");
            updatePartyPreview();
        });

    $win.off("click.uieActPartyAction").on("click.uieActPartyAction", ".uie-act-party-action", (e) => {
        try { e?.preventDefault?.(); } catch (_) {}
        try { e?.stopPropagation?.(); } catch (_) {}
        applyPartyActivity(e.currentTarget?.dataset?.activityId || "");
    });

    $win.off("click.uieAct", "#uie-activity-stop").on("click.uieAct", "#uie-activity-stop", stopActivity);
    $win.off("click.uieAct", "#uie-activity-create").on("click.uieAct", "#uie-activity-create", createCustomActivity);

    $win.off("click.uieAct", "#uie-activity-sparkle").on("click.uieAct", "#uie-activity-sparkle", (e) => {
        try { e?.preventDefault?.(); } catch (_) {}
        try { e?.stopPropagation?.(); } catch (_) {}
        try { e?.stopImmediatePropagation?.(); } catch (_) {}

        const menu = document.getElementById("uie-activity-menu");
        if (menu) {
            const open = String(menu.style.display || "").toLowerCase() === "block";
            menu.style.display = open ? "none" : "block";
            return;
        }
        // Fallback: focus the add routine input
        try {
            const inp = document.getElementById("uie-activity-new-name");
            if (inp) { inp.scrollIntoView?.({ block: "center" }); inp.focus?.(); }
        } catch (_) {}
    });

    // Close activity menu if clicking elsewhere
    $win.off("click.uieActMenuClose").on("click.uieActMenuClose", function(e){
        const $t = $(e.target);
        if ($t.closest("#uie-activity-sparkle, #uie-activity-menu").length) return;
        const menu = document.getElementById("uie-activity-menu");
        if (menu) menu.style.display = "none";
    });

    $win.off("click.uieAct", "#uie-activity-act-add").on("click.uieAct", "#uie-activity-act-add", (e) => {
        try { e?.preventDefault?.(); } catch (_) {}
        try { e?.stopPropagation?.(); } catch (_) {}
        try { e?.stopImmediatePropagation?.(); } catch (_) {}
        try {
            const menu = document.getElementById("uie-activity-menu");
            if (menu) menu.style.display = "none";
        } catch (_) {}
        try {
            const inp = document.getElementById("uie-activity-new-name");
            if (inp) { inp.scrollIntoView?.({ block: "center" }); inp.focus?.(); }
        } catch (_) {}
    });

    $win.off("click.uieAct", "#uie-activity-act-station").on("click.uieAct", "#uie-activity-act-station", (e) => {
        try { e?.preventDefault?.(); } catch (_) {}
        try { e?.stopPropagation?.(); } catch (_) {}
        try { e?.stopImmediatePropagation?.(); } catch (_) {}
        try {
            const menu = document.getElementById("uie-activity-menu");
            if (menu) menu.style.display = "none";
        } catch (_) {}
        if (window.UIE_openCreateStation) {
            window.UIE_openCreateStation();
        }
    });

    // Open/Close handlers are in HTML onclick or managed globally,
    // but let's ensure we render when opened.
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.id === "uie-activities-window" &&
                mutation.target.style.display !== "none") {
                render();
            }
        });
    });

    const win = document.getElementById("uie-activities-window");
    if (win) {
        observer.observe(win, { attributes: true, attributeFilter: ["style"] });
        // Initial render if visible or to populate defaults
        setActiveTab(activeTab);
        render();
    }

    // Hook into Gear Menu to open Activities
    // Scope to body as this might be in various places
    $("body").off("click.uieOpenAct").on("click.uieOpenAct", "#uie-open-activities", () => {
        $("#uie-activities-window").show();
        render();
    });
}
