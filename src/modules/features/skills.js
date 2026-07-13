import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { notify } from "../notifications.js";

function ensureSkillsModel(s) {
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
}

function isInventoryEditMode() {
  try {
    if (typeof window.UIE_isInventoryEditMode === "function" && !!window.UIE_isInventoryEditMode()) return true;
  } catch (_) {}
  try {
    const root = document.getElementById("uie-inventory-window");
    if (root?.dataset?.editMode === "1") return true;
    return !!document.getElementById("uie-inv-pencil")?.classList?.contains("active");
  } catch (_) {
    return false;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function pickLocalImage() {
  const input = document.getElementById("uie-inv-file");
  if (!input) return null;
  input.value = "";
  return await new Promise((resolve) => {
    const onChange = async () => {
      input.removeEventListener("change", onChange);
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        resolve(dataUrl);
      } catch (_) {
        resolve(null);
      }
    };
    input.addEventListener("change", onChange, { once: true });
    input.click();
  });
}

function normalizeSkillType(v) {
  return String(v || "active").trim().toLowerCase() === "passive" ? "passive" : "active";
}

function normalizeLevel(value) {
  const digits = String(value ?? "").replace(/\D+/g, "").replace(/^0+(?=\d)/, "");
  return digits || "1";
}

function compareDecimal(a, b) {
  const aa = normalizeLevel(a);
  const bb = normalizeLevel(b);
  if (aa.length !== bb.length) return aa.length > bb.length ? 1 : -1;
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

function addDecimal(a, b) {
  const x = normalizeLevel(a);
  const y = normalizeLevel(b);
  let i = x.length - 1;
  let j = y.length - 1;
  let carry = 0;
  let out = "";
  while (i >= 0 || j >= 0 || carry) {
    const da = i >= 0 ? Number(x[i]) : 0;
    const db = j >= 0 ? Number(y[j]) : 0;
    const sum = da + db + carry;
    out = String(sum % 10) + out;
    carry = Math.floor(sum / 10);
    i -= 1;
    j -= 1;
  }
  return normalizeLevel(out);
}

function subDecimal(a, b) {
  const x = normalizeLevel(a);
  const y = normalizeLevel(b);
  if (compareDecimal(x, y) <= 0) return "1";
  let i = x.length - 1;
  let j = y.length - 1;
  let borrow = 0;
  let out = "";
  while (i >= 0) {
    let da = Number(x[i]) - borrow;
    const db = j >= 0 ? Number(y[j]) : 0;
    if (da < db) {
      da += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    out = String(da - db) + out;
    i -= 1;
    j -= 1;
  }
  return normalizeLevel(out);
}

function smartStep(level) {
  const lv = normalizeLevel(level);
  const zeros = Math.max(0, lv.length - 2);
  return `1${"0".repeat(zeros)}`;
}

function normalizeSkillIcon(value) {
  return String(value || "").trim().slice(0, 12);
}

function normalizeSkillBranch(value, fallbackType = "active") {
  const raw = String(value || "").trim();
  if (raw) return raw.slice(0, 42);
  return normalizeSkillType(fallbackType) === "passive" ? "Foundation" : "Technique";
}

function normalizeSkillPrerequisites(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,>\n|]+/);
  return list.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6);
}

function normalizePercent(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(/[^\d.-]+/g, ""));
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, fallback));
  return Math.max(0, Math.min(100, Math.round(n)));
}

function skillSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function branchPalette(branch) {
  const palettes = [
    { accent: "#4ecdc4", glow: "rgba(78,205,196,.22)", bg: "rgba(78,205,196,.10)" },
    { accent: "#ff6b6b", glow: "rgba(255,107,107,.22)", bg: "rgba(255,107,107,.10)" },
    { accent: "#cba35c", glow: "rgba(203,163,92,.24)", bg: "rgba(203,163,92,.11)" },
    { accent: "#a78bfa", glow: "rgba(167,139,250,.24)", bg: "rgba(167,139,250,.12)" },
    { accent: "#2ecc71", glow: "rgba(46,204,113,.20)", bg: "rgba(46,204,113,.10)" },
    { accent: "#60a5fa", glow: "rgba(96,165,250,.22)", bg: "rgba(96,165,250,.10)" },
  ];
  const text = String(branch || "Technique");
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i) * (i + 3)) % 997;
  return palettes[sum % palettes.length];
}

function isSkillUnlocked(skill, allSkills = []) {
  const prereqs = normalizeSkillPrerequisites(skill?.prerequisites || skill?.requires);
  if (!prereqs.length) return true;
  const owned = new Set(allSkills.map((x) => skillSlug(x?.name)));
  return prereqs.every((x) => owned.has(skillSlug(x)));
}

function normalizeSkillImage(raw) {
  const image = String(raw?.img || raw?.image || raw?.photo || raw?.avatar || "").trim();
  const iconCandidate = String(raw?.icon || raw?.glyph || "").trim();
  const iconLooksLikeImage = /^data:image\//i.test(iconCandidate)
    || /^https?:\/\//i.test(iconCandidate)
    || /\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.test(iconCandidate);
  if (image) return image;
  if (iconLooksLikeImage) return iconCandidate;
  return "";
}

function parseReqStats(val) {
  if (!val) return {};
  if (typeof val === "object") return val;
  const res = {};
  const parts = String(val).split(/[,;]+/);
  for (const p of parts) {
    const [k, v] = p.split(":");
    if (k && v) {
      const key = k.trim().toLowerCase();
      const num = parseInt(v.trim(), 10);
      if (key && !isNaN(num)) {
        res[key] = num;
      }
    }
  }
  return res;
}

function formatReqStats(obj) {
  if (!obj || typeof obj !== "object") return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function calculateDepths(branchSkills) {
  const depths = new Map();
  const slugToSkill = new Map(branchSkills.map(s => [skillSlug(s.name), s]));
  
  function getDepth(skill) {
    const slug = skillSlug(skill.name);
    if (depths.has(slug)) return depths.get(slug);
    
    const prereqs = normalizeSkillPrerequisites(skill.prerequisites || skill.requires);
    if (!prereqs.length) {
      depths.set(slug, 0);
      return 0;
    }
    
    let maxPrereqDepth = -1;
    for (const p of prereqs) {
      const parent = slugToSkill.get(skillSlug(p));
      if (parent) {
        maxPrereqDepth = Math.max(maxPrereqDepth, getDepth(parent));
      } else {
        maxPrereqDepth = Math.max(maxPrereqDepth, 0);
      }
    }
    
    const depth = maxPrereqDepth + 1;
    depths.set(slug, depth);
    return depth;
  }
  
  branchSkills.forEach(s => getDepth(s));
  return depths;
}

function computeConstellationPositions(skills) {
  const normalized = skills.map(s => normalizeSkill(s)).filter(Boolean);
  
  const byBranch = {};
  normalized.forEach(s => {
    if (!byBranch[s.branch]) byBranch[s.branch] = [];
    byBranch[s.branch].push(s);
  });
  
  const branches = Object.keys(byBranch);
  const N = branches.length;
  
  const positionedSkills = [];
  
  branches.forEach((branch, bIdx) => {
    const branchSkills = byBranch[branch];
    const centerX = N > 0 ? (bIdx + 1) * (1800 / (N + 1)) : 900;
    
    const depths = calculateDepths(branchSkills);
    
    const byDepth = {};
    branchSkills.forEach(s => {
      const d = depths.get(skillSlug(s.name)) || 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(s);
    });
    
    Object.keys(byDepth).forEach(d => {
      byDepth[d].sort((a, b) => a.name.localeCompare(b.name));
    });
    
    branchSkills.forEach(s => {
      let finalX = s.x;
      let finalY = s.y;
      
      if (finalX === null || finalY === null) {
        const d = depths.get(skillSlug(s.name)) || 0;
        const skillsAtDepth = byDepth[d] || [];
        const idx = skillsAtDepth.findIndex(x => skillSlug(x.name) === skillSlug(s.name));
        const M = skillsAtDepth.length;
        
        const spread = Math.min(220, 1000 / Math.max(1, M));
        const offset = M > 1 ? (idx - (M - 1) / 2) * spread : 0;
        
        finalX = centerX + offset;
        finalY = 1000 - d * 200;
        
        finalX = Math.max(100, Math.min(1700, finalX));
        finalY = Math.max(150, Math.min(1100, finalY));
      }
      
      positionedSkills.push({
        ...s,
        displayX: finalX,
        displayY: finalY,
        depth: depths.get(skillSlug(s.name)) || 0
      });
    });
  });
  
  return positionedSkills;
}

function normalizeSkill(raw) {
  if (!raw) return null;
  const name = String(raw.name || raw.title || raw.skill || "Skill").trim().slice(0, 80) || "Skill";
  const description = String(raw.description || raw.desc || "").trim().slice(0, 1200);
  const skillType = normalizeSkillType(raw.skillType || raw.type);
  const level = normalizeLevel(raw.level ?? raw.rank ?? raw.tier ?? "1");
  const img = normalizeSkillImage(raw);
  let icon = normalizeSkillIcon(raw.icon || raw.glyph);
  if (icon && img && icon === img) icon = "";
  const branch = normalizeSkillBranch(raw.branch || raw.path || raw.school || raw.tree, skillType);
  const prerequisites = normalizeSkillPrerequisites(raw.prerequisites || raw.requires || raw.unlocksFrom || raw.parent);
  const mastery = normalizePercent(raw.mastery ?? raw.progress ?? raw.masteryPercent, Number(level) > 1 ? Math.min(100, Number(level) * 12) : 0);
  const affinity = normalizeSkillBranch(raw.affinity || raw.element || raw.aspect || branch, skillType);
  const unlockRule = String(raw.unlockRule || raw.unlock || raw.logic || (prerequisites.length ? `Requires ${prerequisites.join(", ")}` : "Root node")).trim().slice(0, 220);

  const reqLevel = raw.reqLevel !== undefined ? Math.max(0, parseInt(raw.reqLevel, 10) || 0) : 0;
  const reqStats = parseReqStats(raw.reqStats || raw.requiredStats);
  const learnedViaOthers = !!(raw.learnedViaOthers || raw.learnedViaTeacher);
  const x = raw.x !== undefined && raw.x !== null && raw.x !== "" ? parseFloat(raw.x) : null;
  const y = raw.y !== undefined && raw.y !== null && raw.y !== "" ? parseFloat(raw.y) : null;

  return {
    ...raw,
    kind: "skill",
    name,
    description,
    desc: description,
    type: skillType,
    skillType,
    level,
    img,
    image: img,
    icon,
    branch,
    path: branch,
    prerequisites,
    requires: prerequisites,
    mastery,
    masteryPercent: mastery,
    affinity,
    unlockRule,
    reqLevel,
    reqStats,
    learnedViaOthers,
    x,
    y,
  };
}

function ensureSkillModal() {
  let modal = document.getElementById("uie-skill-editor-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "uie-skill-editor-modal";
  modal.innerHTML = `
    <div class="uie-skill-editor-card" role="dialog" aria-modal="true" aria-labelledby="uie-skill-editor-title">
      <div class="uie-skill-editor-head">
        <div>
          <div class="uie-skill-editor-kicker">Skill Forge</div>
          <h3 id="uie-skill-editor-title">Create Skill</h3>
        </div>
        <button type="button" id="uie-skill-editor-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="uie-skill-editor-grid">
        <label>Name<input id="uie-skill-editor-name" type="text" placeholder="Firebrand Waltz"></label>
        <label>Type<select id="uie-skill-editor-type"><option value="active">Active</option><option value="passive">Passive</option></select></label>
        <label>Level<input id="uie-skill-editor-level" type="number" min="1" step="1" value="1"></label>
        <label>Icon Text<input id="uie-skill-editor-icon" type="text" maxlength="12" placeholder="ACT"></label>
        <label>Branch<input id="uie-skill-editor-branch" type="text" placeholder="Technique"></label>
        <label>Mastery %<input id="uie-skill-editor-mastery" type="number" min="0" max="100" step="1" value="0"></label>
        <label>Affinity<input id="uie-skill-editor-affinity" type="text" placeholder="Fire / Voice / Steel"></label>
        <label>Requires<input id="uie-skill-editor-prereq" type="text" placeholder="Comma-separated skill names"></label>
        
        <label>Req Level<input id="uie-skill-editor-req-level" type="number" min="0" value="0"></label>
        <label>Req Stats<input id="uie-skill-editor-req-stats" type="text" placeholder="str: 10, dex: 12"></label>
        <label>Constellation X<input id="uie-skill-editor-x" type="number" min="0" max="1800" placeholder="Auto (0-1800)"></label>
        <label>Constellation Y<input id="uie-skill-editor-y" type="number" min="0" max="1200" placeholder="Auto (0-1200)"></label>
        
        <label class="wide" style="display:flex; flex-direction:row; align-items:center; gap:10px; cursor:pointer;">
          <input id="uie-skill-editor-learned-others" type="checkbox" style="width:20px; height:20px; cursor:pointer;">
          <span style="font-size:12px; font-weight:900; letter-spacing:.04em; text-transform:uppercase;">Learned via Others (Bypass Level & Stat Requirements)</span>
        </label>
        
        <label class="wide">Image URL or data image<input id="uie-skill-editor-img" type="text" placeholder="Optional image URL"></label>
        <label class="wide">Unlock Logic<input id="uie-skill-editor-unlock" type="text" placeholder="How this node grows or unlocks from play."></label>
        <label class="wide">Concept Notes<textarea id="uie-skill-editor-prompt" placeholder="Optional notes describing this skill. Example: a defensive singer skill that turns rhythm into a shield."></textarea></label>
        <label class="wide">Description<textarea id="uie-skill-editor-desc" placeholder="What this skill does, its limits, costs, and flavor."></textarea></label>
      </div>
      <div class="uie-skill-editor-actions">
        <button type="button" id="uie-skill-editor-save"><i class="fa-solid fa-check"></i> Add Skill</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function injectSkillStyles() {
  if (document.getElementById("uie-skill-editor-style")) return;
  const style = document.createElement("style");
  style.id = "uie-skill-editor-style";
  style.textContent = `
    #uie-skill-editor-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483642;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 22px;
      background: rgba(6, 8, 13, 0.56);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    #uie-skill-editor-modal.open { display: flex; }
    .uie-skill-editor-card {
      width: 760px;
      max-height: 820px;
      display: flex;
      flex-direction: column;
      overflow: auto;
      border-radius: 8px;
      border: 1px solid rgba(203, 163, 92, 0.42);
      background: linear-gradient(145deg, rgba(26, 20, 24, 0.98), rgba(10, 13, 20, 0.98));
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.78);
      color: #f8efe1;
    }
    .uie-skill-editor-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 20px;
      border-bottom: 1px solid rgba(203, 163, 92, 0.24);
    }
    .uie-skill-editor-kicker { color: #cba35c; font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .uie-skill-editor-head h3 { margin: 3px 0 0; font-size: 22px; }
    #uie-skill-editor-close {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06);
      color: #ffd1d1;
      cursor: pointer;
    }
    .uie-skill-editor-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(110px, .7fr) minmax(90px, .5fr) minmax(110px, .7fr);
      gap: 12px;
      padding: 18px 20px;
    }
    .uie-skill-editor-grid label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      color: rgba(248, 239, 225, 0.76);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .uie-skill-editor-grid label.wide { grid-column: 1 / -1; }
    .uie-skill-editor-grid input,
    .uie-skill-editor-grid select,
    .uie-skill-editor-grid textarea {
      width: 100%;
      border-radius: 8px;
      border: 1px solid rgba(203, 163, 92, 0.26);
      background: rgba(5, 8, 13, 0.72);
      color: #fff;
      padding: 10px 12px;
      outline: none;
      text-transform: none;
      letter-spacing: 0;
    }
    .uie-skill-editor-grid textarea { min-height: 96px; resize: vertical; line-height: 1.45; }
    .uie-skill-editor-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 0 20px 20px;
    }
    .uie-skill-editor-actions button {
      min-height: 38px;
      padding: 0 14px;
      border-radius: 8px;
      border: 1px solid rgba(203, 163, 92, 0.38);
      background: rgba(203, 163, 92, 0.14);
      color: #f8efe1;
      font-weight: 900;
      cursor: pointer;
    }
    .uie-skill-editor-actions #uie-skill-editor-save { background: rgba(46,204,113,.18); border-color: rgba(46,204,113,.42); color: #a7f3bf; }
    @media (min-width: 99999px) {
      .uie-skill-editor-grid { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function getSkillModalDraft() {
  return normalizeSkill({
    name: $("#uie-skill-editor-name").val(),
    description: $("#uie-skill-editor-desc").val(),
    skillType: $("#uie-skill-editor-type").val(),
    level: $("#uie-skill-editor-level").val(),
    icon: $("#uie-skill-editor-icon").val(),
    img: $("#uie-skill-editor-img").val(),
    branch: $("#uie-skill-editor-branch").val(),
    mastery: $("#uie-skill-editor-mastery").val(),
    affinity: $("#uie-skill-editor-affinity").val(),
    prerequisites: $("#uie-skill-editor-prereq").val(),
    unlockRule: $("#uie-skill-editor-unlock").val(),
    reqLevel: $("#uie-skill-editor-req-level").val(),
    reqStats: $("#uie-skill-editor-req-stats").val(),
    learnedViaOthers: $("#uie-skill-editor-learned-others").is(":checked"),
    x: $("#uie-skill-editor-x").val(),
    y: $("#uie-skill-editor-y").val(),
  });
}

function setSkillModalDraft(skill = {}) {
  const normalized = normalizeSkill(skill) || normalizeSkill({ name: "New Skill" });
  $("#uie-skill-editor-name").val(normalized.name || "");
  $("#uie-skill-editor-desc").val(normalized.description || normalized.desc || "");
  $("#uie-skill-editor-type").val(normalizeSkillType(normalized.skillType || normalized.type));
  $("#uie-skill-editor-level").val(normalizeLevel(normalized.level || "1"));
  $("#uie-skill-editor-icon").val(normalized.icon || "");
  $("#uie-skill-editor-img").val(normalized.img || normalized.image || "");
  $("#uie-skill-editor-branch").val(normalized.branch || "");
  $("#uie-skill-editor-mastery").val(normalizePercent(normalized.mastery || 0));
  $("#uie-skill-editor-affinity").val(normalized.affinity || "");
  $("#uie-skill-editor-prereq").val(normalizeSkillPrerequisites(normalized.prerequisites || []).join(", "));
  $("#uie-skill-editor-unlock").val(normalized.unlockRule || "");
  $("#uie-skill-editor-req-level").val(normalized.reqLevel || 0);
  $("#uie-skill-editor-req-stats").val(formatReqStats(normalized.reqStats || {}));
  $("#uie-skill-editor-learned-others").prop("checked", !!normalized.learnedViaOthers);
  $("#uie-skill-editor-x").val(normalized.x !== null ? normalized.x : "");
  $("#uie-skill-editor-y").val(normalized.y !== null ? normalized.y : "");
}

function openSkillEditor(index = -1) {
  injectSkillStyles();
  const modal = ensureSkillModal();
  const s = getSettings();
  ensureSkillsModel(s);
  const skill = index >= 0 ? s.inventory.skills[index] : { name: "", description: "", skillType: "active", level: "1", icon: "", img: "", branch: "", prerequisites: [], mastery: 0, affinity: "", unlockRule: "" };
  modal.dataset.index = String(index);
  $("#uie-skill-editor-title").text(index >= 0 ? "Edit Skill" : "Create Skill");
  $("#uie-skill-editor-prompt").val("");
  setSkillModalDraft(skill);
  modal.classList.add("open");
}

function closeSkillEditor() {
  const modal = document.getElementById("uie-skill-editor-modal");
  if (modal) modal.classList.remove("open");
}

async function fillSkillWithAi() {
  const prompt = String($("#uie-skill-editor-prompt").val() || "").trim()
    || `Create a useful RPG skill named ${String($("#uie-skill-editor-name").val() || "New Skill").trim() || "New Skill"}.`;
  const current = getSkillModalDraft() || {};
  const button = $("#uie-skill-editor-ai");
  button.prop("disabled", true).text("Generating...");
  try {
    const s = getSettings();
    ensureSkillsModel(s);
    const classContext = {
      className: s?.character?.className || "Adventurer",
      level: s?.character?.level || 1,
      existingSkills: s.inventory.skills.slice(0, 40).map((x) => ({
        name: x?.name,
        branch: x?.branch || x?.path,
        level: x?.level,
        mastery: x?.mastery,
        affinity: x?.affinity,
      })),
    };
    const raw = await generateContent(`Return only JSON for one RPG skill-tree skill with keys: name, description, skillType ("active" or "passive"), level, icon, branch, prerequisites (array of skill names), mastery (0-100), affinity, unlockRule. Make it logically grow from the class context and existing skills; if it is advanced, name the prerequisite skill it grows from.\n\nClass context:\n${JSON.stringify(classContext)}\n\nCurrent draft:\n${JSON.stringify(current)}\n\nUser request:\n${prompt}`, "Skill Tree Creation");
    const text = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text);
    setSkillModalDraft({ ...current, ...parsed });
    notify("success", "AI filled the skill form. Review it, then press OK.", "Skills");
  } catch (error) {
    notify("error", `Skill AI generation failed: ${String(error?.message || error || "Unknown error")}`, "Skills");
  } finally {
    button.prop("disabled", false).html(`<i class="fa-solid fa-wand-magic-sparkles"></i> Fill With AI`);
  }
}

function saveSkillEditor() {
  const modal = document.getElementById("uie-skill-editor-modal");
  const index = Number(modal?.dataset?.index ?? -1);
  const draft = getSkillModalDraft();
  if (!draft || !String(draft.name || "").trim()) {
    notify("warning", "Name the skill before saving.", "Skills");
    return;
  }
  const s = getSettings();
  ensureSkillsModel(s);
  if (Number.isFinite(index) && index >= 0 && s.inventory.skills[index]) {
    s.inventory.skills[index] = { ...s.inventory.skills[index], ...draft, kind: "skill" };
  } else {
    s.inventory.skills.push({ ...draft, kind: "skill" });
  }
  saveSettings(s);
  closeSkillEditor();
  init();
  notify("success", "Skill saved.", "Skills");
}

function sendSkillToChat(idx) {
  const s = getSettings();
  ensureSkillsModel(s);
  const skill = s.inventory.skills[idx];
  if (!skill) return;
  const name = String(skill.name || "Skill").trim() || "Skill";
  const level = normalizeLevel(skill.level || "1");
  const msg = `I use ${name} (level ${level}).`;
  const targets = [
    document.getElementById("user-input"),
    document.getElementById("re-user-input"),
    document.querySelector("textarea#send_textarea"),
    document.querySelector("textarea#send_text"),
    document.querySelector("textarea")
  ];
  for (const target of targets) {
    if (!target) continue;
    target.value = msg;
    try { target.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
    try { target.focus(); } catch (_) {}
    const sendBtn = document.getElementById("send-btn") || document.getElementById("send_but") || document.querySelector("[id*='send']");
    if (sendBtn) setTimeout(() => sendBtn.click(), 80);
    break;
  }
  notify("info", `Using ${name}.`, "Skills");
}

function upgradeSkill(idx) {
  const s = getSettings();
  ensureSkillsModel(s);
  const skill = s.inventory.skills[idx];
  if (!skill) return;
  const current = normalizeLevel(skill.level || "1");
  const next = addDecimal(current, "1");
  s.inventory.skills[idx] = normalizeSkill({ ...skill, level: next });
  saveSettings(s);
  init();
  notify("success", `${skill.name || "Skill"} upgraded to level ${next}.`, "Skills");
}

async function sendSkillToQuickBag(idx) {
  try {
    const mod = await import("./quickBag.js");
    mod.addQuickBagEntry?.("skill", idx);
  } catch (err) {
    console.error("[Skills] Failed to add skill to Quick Bag:", err);
    notify("error", "Could not add skill to Quick Bag.", "Skills");
  }
}

function persistCard($card, mutate = null) {
  const idx = Number($card?.data("index"));
  if (!Number.isFinite(idx)) return;
  const s = getSettings();
  if (!s) return;
  ensureSkillsModel(s);
  if (!s.inventory.skills[idx]) return;

  const base = normalizeSkill(s.inventory.skills[idx]);
  if (!base) return;

  const readInput = (selector, fallback = "") => {
    const $el = $card.find(selector);
    if (!$el.length) return String(fallback ?? "");
    return String($el.val() ?? fallback ?? "");
  };

  const draft = normalizeSkill({
    ...base,
    name: readInput(".uie-skill-name", base.name),
    description: readInput(".uie-skill-desc", base.description || ""),
    skillType: readInput(".uie-skill-type", base.skillType),
    level: readInput(".uie-skill-level", base.level),
    icon: readInput(".uie-skill-icon", base.icon || ""),
    branch: readInput(".uie-skill-branch", base.branch || ""),
    mastery: readInput(".uie-skill-mastery", base.mastery || 0),
    affinity: readInput(".uie-skill-affinity", base.affinity || ""),
    prerequisites: readInput(".uie-skill-prereq", normalizeSkillPrerequisites(base.prerequisites || []).join(", ")),
    unlockRule: readInput(".uie-skill-unlock", base.unlockRule || ""),
    img: base.img,
  });
  if (!draft) return;

  const next = normalizeSkill(typeof mutate === "function" ? mutate(draft) : draft);
  if (!next) return;

  s.inventory.skills[idx] = { ...s.inventory.skills[idx], ...next, kind: "skill" };
  saveSettings(s);
  init();
}

let panX = 0;
let panY = 0;
let zoom = 1.0;
let isPanning = false;
let startX = 0;
let startY = 0;
let activeDragNode = null;
let selectedSkillIndex = -1;
let positionedList = [];

function centerPan() {
  const vp = document.getElementById("uie-skills-viewport");
  if (!vp) return;
  const vpWidth = vp.clientWidth || 600;
  const vpHeight = vp.clientHeight || 500;
  panX = vpWidth / 2 - 900 * zoom;
  panY = vpHeight / 2 - 600 * zoom;
  const canvas = document.getElementById("uie-skills-canvas");
  if (canvas) {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }
}

function getSkillStatus(sk, list, character) {
  const unlocked = isSkillUnlocked(sk, list);
  const prereqMet = unlocked;
  const levelMet = Number(character.level || 1) >= (sk.reqLevel || 0);
  
  let statsMet = true;
  const unmetStats = [];
  const reqStats = sk.reqStats || {};
  const charStats = character.stats || {};
  
  for (const [statName, reqVal] of Object.entries(reqStats)) {
    const curVal = Number(charStats[statName] || 0);
    if (curVal < reqVal) {
      statsMet = false;
      unmetStats.push(`${statName.toUpperCase()} (${curVal}/${reqVal})`);
    }
  }
  
  const reqsMet = prereqMet && (sk.learnedViaOthers || (levelMet && statsMet));
  
  return {
    prereqMet,
    levelMet,
    statsMet,
    unmetStats,
    reqsMet,
    isUnlocked: unlocked
  };
}

function getNodeStyleClass(sk, status, level) {
  const lvl = Number(level || 0);
  if (lvl >= (sk.maxLevel || 5)) return "maxed";
  if (lvl > 0) return "learned";
  if (status.prereqMet) return "unlocked";
  return "locked";
}

function drawConstellationLines(positionedSkills) {
  const svg = document.getElementById("uie-skills-svg");
  if (!svg) return;
  
  // Clear but keep definitions
  const defs = svg.querySelector("defs");
  svg.innerHTML = "";
  if (defs) svg.appendChild(defs);
  
  positionedSkills.forEach(sk => {
    const prereqs = sk.prerequisites || [];
    prereqs.forEach(pName => {
      const parent = positionedSkills.find(x => skillSlug(x.name) === skillSlug(pName));
      if (parent) {
        const parentActive = Number(parent.level || 0) > 0;
        const childActive = Number(sk.level || 0) > 0;
        const pathActive = parentActive && childActive;
        
        const palette = branchPalette(sk.branch);
        
        const color = pathActive ? "#cba35c" : "rgba(148, 163, 184, 0.22)";
        const filter = pathActive ? "url(#glow-gold)" : "none";
        const strokeWidth = pathActive ? "2.5" : "1.2";
        
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", parent.displayX);
        line.setAttribute("y1", parent.displayY);
        line.setAttribute("x2", sk.displayX);
        line.setAttribute("y2", sk.displayY);
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", strokeWidth);
        line.setAttribute("filter", filter);
        if (!pathActive) {
          line.setAttribute("stroke-dasharray", "3 3");
        }
        
        svg.appendChild(line);
      }
    });
  });
}

function upgradeSkillAndSpendPoints(idx) {
  const s = getSettings();
  ensureSkillsModel(s);
  const skill = s.inventory.skills[idx];
  if (!skill) return;
  
  const list = s.inventory.skills;
  const status = getSkillStatus(skill, list, s.character || {});
  if (!status.reqsMet && !isInventoryEditMode()) {
    notify("warning", "Requirements not met to learn/upgrade this skill.", "Skills");
    return;
  }
  
  if (!isInventoryEditMode()) {
    let skillPts = Number(s.character.skillPoints || s.character.progression?.skillPoints || 0);
    if (skillPts <= 0) {
      notify("warning", "No Skill Points (SP) available.", "Skills");
      return;
    }
    skillPts -= 1;
    s.character.skillPoints = skillPts;
    if (!s.character.progression) s.character.progression = {};
    s.character.progression.skillPoints = skillPts;
  }
  
  const current = normalizeLevel(skill.level || "0");
  const next = addDecimal(current, "1");
  s.inventory.skills[idx] = normalizeSkill({ ...skill, level: next });
  
  saveSettings(s);
  init();
  showSkillDetails(idx);
  notify("success", `${skill.name || "Skill"} upgraded to level ${next}.`, "Skills");
}

function toggleTeacherBypass(idx) {
  const s = getSettings();
  ensureSkillsModel(s);
  const skill = s.inventory.skills[idx];
  if (!skill) return;
  
  const nextVal = !skill.learnedViaOthers;
  s.inventory.skills[idx] = normalizeSkill({ ...skill, learnedViaOthers: nextVal });
  
  saveSettings(s);
  init();
  showSkillDetails(idx);
  
  if (nextVal) {
    notify("success", `${skill.name} can now be learned bypassing stats/level requirements.`, "Skills");
  } else {
    notify("info", `Reverted ${skill.name} to normal level/stat checks.`, "Skills");
  }
}

function showSkillDetails(originalIdx) {
  const s = getSettings();
  ensureSkillsModel(s);
  const list = s.inventory.skills;
  const sk = normalizeSkill(list[originalIdx]);
  if (!sk) return;
  
  selectedSkillIndex = originalIdx;
  
  $(".uie-skill-star").removeClass("selected");
  $(`.uie-skill-star[data-index="${originalIdx}"]`).addClass("selected");
  
  const status = getSkillStatus(sk, list, s.character || {});
  const palette = branchPalette(sk.branch);
  
  const panel = document.getElementById("uie-skill-details-panel");
  if (!panel) return;
  
  const skillPts = Number(s.character.skillPoints || s.character.progression?.skillPoints || 0);
  const prereqs = sk.prerequisites || [];
  const reqStats = sk.reqStats || {};
  
  let reqHtml = "";
  
  if (sk.reqLevel > 0) {
    const isMet = Number(s.character.level || 1) >= sk.reqLevel;
    reqHtml += `
      <div class="req-row">
        <span>Required Level: ${sk.reqLevel}</span>
        <span class="${isMet ? 'req-met' : 'req-unmet'}">
          <i class="fa-solid ${isMet ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        </span>
      </div>
    `;
  }
  
  for (const [statName, val] of Object.entries(reqStats)) {
    const curVal = Number(s.character.stats?.[statName] || 0);
    const isMet = curVal >= val;
    reqHtml += `
      <div class="req-row">
        <span>Required ${statName.toUpperCase()}: ${val} (Have: ${curVal})</span>
        <span class="${isMet ? 'req-met' : 'req-unmet'}">
          <i class="fa-solid ${isMet ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        </span>
      </div>
    `;
  }
  
  if (prereqs.length > 0) {
    prereqs.forEach(pName => {
      const parent = list.find(x => skillSlug(x.name) === skillSlug(pName));
      const isMet = parent && Number(parent.level || 0) > 0;
      reqHtml += `
        <div class="req-row">
          <span>Prerequisite: ${pName}</span>
          <span class="${isMet ? 'req-met' : 'req-unmet'}">
            <i class="fa-solid ${isMet ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
          </span>
        </div>
      `;
    });
  }
  
  if (!reqHtml) {
    reqHtml = `<div class="req-row"><span style="opacity:0.75;">None (Root node)</span></div>`;
  }
  
  const currentLevel = Number(sk.level || 0);
  const canUpgrade = status.reqsMet && (skillPts > 0 || isInventoryEditMode());
  const typeColor = sk.type === "active" ? "#ff6b6b" : "#4ecdc4";
  
  panel.innerHTML = `
    <div class="details-head">
      <div style="min-width:0; flex:1;">
        <h4 class="details-title">${escapeHtml(sk.name)}</h4>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; align-items:center;">
          <span class="details-branch-badge" style="background:${palette.bg}; color:${palette.accent}; border:1px solid ${palette.accent}55;">${escapeHtml(sk.branch)}</span>
          <span style="font-size:10px; font-weight:bold; color:${typeColor}; border:1px solid ${typeColor}44; padding:2px 6px; border-radius:4px;">${sk.type === "active" ? "Active" : "Passive"}</span>
          <span style="font-size:10px; font-weight:bold; color:#fff; background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px;">Lv ${sk.level}</span>
        </div>
      </div>
      <button id="uie-details-close" style="background:transparent; border:none; color:#aaa; font-size:16px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    
    <div class="details-desc">${escapeHtml(sk.description || "No description.")}</div>
    
    <div class="details-section">
      <div class="details-section-title">Requirements to Unlock / Upgrade</div>
      ${reqHtml}
      ${sk.learnedViaOthers ? `
        <div style="margin-top:6px; font-size:10px; color:#2ecc71; font-weight:bold; display:flex; align-items:center; gap:4px;">
          <i class="fa-solid fa-graduation-cap"></i> Learned via Teacher (Requirements Bypassed!)
        </div>
      ` : ""}
    </div>
    
    <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:12px; opacity:0.85;">
      <span>Affinity: ${escapeHtml(sk.affinity)}</span>
      <span>Mastery: ${sk.mastery}%</span>
    </div>
    
    <div class="details-actions">
      <button class="details-btn details-btn-primary" id="uie-details-btn-upgrade" ${canUpgrade ? "" : "disabled"}>
        <i class="fa-solid fa-circle-arrow-up"></i> 
        ${currentLevel === 0 ? "Unlock Skill (-1 SP)" : "Upgrade Skill (-1 SP)"}
      </button>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
        <button class="details-btn" id="uie-details-btn-teacher" style="background:${sk.learnedViaOthers ? 'rgba(46,204,113,0.12)' : 'rgba(255,255,255,0.03)'}; border-color:${sk.learnedViaOthers ? 'rgba(46,204,113,0.35)' : 'rgba(255,255,255,0.1)'}; color:${sk.learnedViaOthers ? '#a0f7bf' : '#fff'};" title="Toggle Teacher Bypass">
          <i class="fa-solid fa-graduation-cap"></i> Teach
        </button>
        <button class="details-btn" id="uie-details-btn-quickbag"><i class="fa-solid fa-bag-shopping"></i> QuickBag</button>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
        <button class="details-btn" id="uie-details-btn-use"><i class="fa-solid fa-play"></i> Use</button>
        <button class="details-btn" id="uie-details-btn-edit"><i class="fa-solid fa-pen"></i> Edit</button>
      </div>
      
      <button class="details-btn details-btn-danger" id="uie-details-btn-delete"><i class="fa-solid fa-trash"></i> Delete Node</button>
    </div>
  `;
  
  panel.classList.remove("closed");
  
  // Bind actions
  $("#uie-details-close").off("click").on("click", () => {
    panel.classList.add("closed");
    $(".uie-skill-star").removeClass("selected");
    selectedSkillIndex = -1;
  });
  
  $("#uie-details-btn-upgrade").off("click").on("click", () => {
    upgradeSkillAndSpendPoints(originalIdx);
  });
  
  $("#uie-details-btn-teacher").off("click").on("click", () => {
    toggleTeacherBypass(originalIdx);
  });
  
  $("#uie-details-btn-quickbag").off("click").on("click", () => {
    void sendSkillToQuickBag(originalIdx);
  });
  
  $("#uie-details-btn-use").off("click").on("click", () => {
    sendSkillToChat(originalIdx);
  });
  
  $("#uie-details-btn-edit").off("click").on("click", () => {
    openSkillEditor(originalIdx);
  });
  
  $("#uie-details-btn-delete").off("click").on("click", () => {
    deleteSkill(originalIdx);
    panel.classList.add("closed");
  });
}

export async function init(){
  const s = getSettings(); if(!s) return;
  ensureSkillsModel(s);
  const normalized = s.inventory.skills.map((x) => normalizeSkill(x)).filter(Boolean);
  if (JSON.stringify(normalized) !== JSON.stringify(s.inventory.skills)) {
    s.inventory.skills = normalized;
    saveSettings(s);
  }

  const list = s.inventory.skills;
  const canEdit = isInventoryEditMode();
  
  const $starsContainer = $("#uie-skills-stars-container");
  if (!$starsContainer.length) return;
  
  positionedList = computeConstellationPositions(list);
  
  const nebulaeLayer = document.getElementById("nebulae-layer");
  if (nebulaeLayer) {
    nebulaeLayer.innerHTML = "";
    const uniqueBranches = [...new Set(positionedList.map(x => x.branch))];
    const N = uniqueBranches.length;
    uniqueBranches.forEach((br, idx) => {
      const centerX = N > 0 ? (idx + 1) * (1800 / (N + 1)) : 900;
      const palette = branchPalette(br);
      
      const glowDiv = document.createElement("div");
      glowDiv.style.position = "absolute";
      glowDiv.style.left = `${centerX - 300}px`;
      glowDiv.style.top = `300px`;
      glowDiv.style.width = "600px";
      glowDiv.style.height = "600px";
      glowDiv.style.borderRadius = "50%";
      glowDiv.style.background = `radial-gradient(circle, ${palette.accent}22 0%, ${palette.accent}04 70%, transparent 100%)`;
      nebulaeLayer.appendChild(glowDiv);
    });
  }
  
  drawConstellationLines(positionedList);
  
  $starsContainer.empty();
  positionedList.forEach((sk) => {
    const originalIdx = s.inventory.skills.findIndex(x => skillSlug(x.name) === skillSlug(sk.name));
    const status = getSkillStatus(sk, list, s.character || {});
    const styleClass = getNodeStyleClass(sk, status, sk.level);
    
    const star = document.createElement("div");
    star.className = `uie-skill-star ${styleClass}`;
    if (selectedSkillIndex === originalIdx) star.className += " selected";
    star.dataset.index = originalIdx;
    star.dataset.slug = skillSlug(sk.name);
    star.style.left = `${sk.displayX}px`;
    star.style.top = `${sk.displayY}px`;
    
    const palette = branchPalette(sk.branch);
    
    star.innerHTML = `
      <div class="star-ring" style="border-color:${styleClass === 'locked' ? 'rgba(71,85,105,0.3)' : palette.accent + '60'}"></div>
      <div class="star-core" style="background:${styleClass === 'locked' ? '#475569' : palette.accent}; box-shadow: 0 0 10px ${styleClass === 'locked' ? 'transparent' : palette.accent}"></div>
      <div class="star-label">${escapeHtml(sk.name)} (Lv ${sk.level})</div>
    `;
    
    $starsContainer.append(star);
  });
  
  const $viewport = $("#uie-skills-viewport");
  const $canvas = $("#uie-skills-canvas");
  
  centerPan();
  
  $viewport.off("mousedown.uiePan touchstart.uiePan").on("mousedown.uiePan touchstart.uiePan", function(e) {
    if ($(e.target).closest(".uie-skill-star, .uie-viewport-controls, .uie-viewport-search").length) return;
    
    isPanning = true;
    const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
    startX = clientX - panX;
    startY = clientY - panY;
    $viewport.css("cursor", "grabbing");
  });
  
  $(window).off("mousemove.uiePan touchmove.uiePan").on("mousemove.uiePan touchmove.uiePan", function(e) {
    const clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
    
    if (isPanning) {
      panX = clientX - startX;
      panY = clientY - startY;
      $canvas.css("transform", `translate(${panX}px, ${panY}px) scale(${zoom})`);
    }
    
    if (activeDragNode) {
      const canvasRect = $canvas[0].getBoundingClientRect();
      let nodeX = (clientX - canvasRect.left) / zoom;
      let nodeY = (clientY - canvasRect.top) / zoom;
      
      nodeX = Math.round(Math.max(50, Math.min(1750, nodeX)));
      nodeY = Math.round(Math.max(50, Math.min(1150, nodeY)));
      
      $(activeDragNode).css({ left: `${nodeX}px`, top: `${nodeY}px` });
      
      const dragIdx = Number(activeDragNode.dataset.index);
      positionedList.forEach(item => {
        if (skillSlug(item.name) === skillSlug(s.inventory.skills[dragIdx].name)) {
          item.displayX = nodeX;
          item.displayY = nodeY;
        }
      });
      
      drawConstellationLines(positionedList);
    }
  });
  
  $(window).off("mouseup.uiePan touchend.uiePan").on("mouseup.uiePan touchend.uiePan", function() {
    if (isPanning) {
      isPanning = false;
      $viewport.css("cursor", "grab");
    }
    
    if (activeDragNode) {
      const dragIdx = Number(activeDragNode.dataset.index);
      const nodeX = parseInt($(activeDragNode).css("left"), 10);
      const nodeY = parseInt($(activeDragNode).css("top"), 10);
      
      s.inventory.skills[dragIdx].x = nodeX;
      s.inventory.skills[dragIdx].y = nodeY;
      saveSettings(s);
      
      $(activeDragNode).removeClass("active-drag");
      activeDragNode = null;
      
      notify("success", "Node position saved.", "Skills Map");
      init();
    }
  });
  
  $viewport.off("wheel.uieZoom").on("wheel.uieZoom", function(e) {
    e.preventDefault();
    const delta = e.originalEvent.deltaY < 0 ? 1 : -1;
    zoom = Math.min(2.0, Math.max(0.3, zoom + delta * 0.08));
    $canvas.css("transform", `translate(${panX}px, ${panY}px) scale(${zoom})`);
  });
  
  $("#uie-zoom-in").off("click").on("click", function() {
    zoom = Math.min(2.0, zoom + 0.15);
    $canvas.css("transform", `translate(${panX}px, ${panY}px) scale(${zoom})`);
  });
  $("#uie-zoom-out").off("click").on("click", function() {
    zoom = Math.max(0.3, zoom - 0.15);
    $canvas.css("transform", `translate(${panX}px, ${panY}px) scale(${zoom})`);
  });
  $("#uie-zoom-reset").off("click").on("click", function() {
    zoom = 1.0;
    centerPan();
  });
  
  $canvas.off("click.uieStar", ".uie-skill-star").on("click.uieStar", ".uie-skill-star", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const originalIdx = Number(this.dataset.index);
    showSkillDetails(originalIdx);
  });
  
  if (canEdit) {
    $canvas.off("mousedown.uieNodeDrag touchstart.uieNodeDrag", ".uie-skill-star").on("mousedown.uieNodeDrag touchstart.uieNodeDrag", ".uie-skill-star", function(e) {
      e.preventDefault();
      e.stopPropagation();
      activeDragNode = this;
      $(this).addClass("active-drag");
    });
  }
  
  const $search = $("#uie-skills-search");
  const $searchClear = $("#uie-skills-search-clear");
  
  $search.off("input.uieSearch").on("input.uieSearch", function() {
    const val = String($(this).val() || "").trim().toLowerCase();
    if (val) {
      $searchClear.show();
      $(".uie-skill-star").each(function() {
        const slug = this.dataset.slug;
        const skill = positionedList.find(x => skillSlug(x.name) === slug);
        const name = String(skill?.name || "").toLowerCase();
        const desc = String(skill?.description || "").toLowerCase();
        if (name.includes(val) || desc.includes(val)) {
          $(this).css("opacity", "1");
          $(this).find(".star-core").css("box-shadow", "0 0 15px #fff");
        } else {
          $(this).css("opacity", "0.22");
        }
      });
    } else {
      $searchClear.hide();
      $(".uie-skill-star").css("opacity", "");
      init();
    }
  });
  
  $searchClear.off("click").on("click", function() {
    $search.val("");
    $(this).hide();
    $(".uie-skill-star").css("opacity", "");
    init();
  });

  $(document)
    .off("click.uieSkillsPencilSync", "#uie-inv-pencil")
    .on("click.uieSkillsPencilSync", "#uie-inv-pencil", function () {
      setTimeout(() => {
        try { init(); } catch (_) {}
      }, 0);
    });

  const $addBtn = $("#uie-skills-add");
  if ($addBtn.length) {
    $addBtn.prop("disabled", false).css({ opacity: "1", cursor: "pointer", filter: "none" });
  }

  $(document)
    .off("click.uieSkillsAdd", "#uie-skills-add")
    .on("click.uieSkillsAdd", "#uie-skills-add", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openSkillEditor(-1);
    });

  $(document)
    .off("click.uieSkillsGenerate", "#uie-skills-generate")
    .on("click.uieSkillsGenerate", "#uie-skills-generate", async function (e) {
      e.preventDefault();
      e.stopPropagation();
      const prompt = String($("#uie-skills-generate-prompt").val() || "").trim();
      openSkillEditor(-1);
      $("#uie-skill-editor-prompt").val(prompt);
      await fillSkillWithAi();
    });

  $(document)
    .off("click.uieSkillModal")
    .on("click.uieSkillModal", "#uie-skill-editor-close", function(e) {
      e.preventDefault();
      closeSkillEditor();
    })
    .on("click.uieSkillModal", "#uie-skill-editor-modal", function(e) {
      if (e.target === this) closeSkillEditor();
    })
    .on("click.uieSkillModal", "#uie-skill-editor-save", function(e) {
      e.preventDefault();
      saveSkillEditor();
    });
  
  const $st = $("#uie-skills-stats");
  if ($st.length) {
      const cls = s.character?.className || "Adventurer";
      const lvl = s.character?.level || 1;
      const modeLabel = canEdit ? "Inline Edit Mode" : "Normal Play Mode";
      const modeColor = canEdit ? "#2ecc71" : "#cba35c";
      const modeHint = canEdit ?
         "In Edit Mode, you can DRAG stars on the map to arrange your custom constellations. Click a star to edit details or delete."
        : "Click a star node to view stats/level requirements and unlock or upgrade. Turn on Edit Mode to modify.";
      $st.html(`<div style="opacity:0.9;font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><span>Class: <span style="color:#cba35c;font-weight:bold;">${escapeHtml(cls)}</span></span><span style="opacity:0.5;">|</span><span>Level: <span style="color:#fff;font-weight:bold;">${lvl}</span></span><span style="opacity:0.5;">|</span><span style="color:${modeColor};font-weight:900;">${modeLabel}</span></div><div style="margin-top:4px;opacity:0.75;font-size:11px;">${escapeHtml(modeHint)}</div>`);
  }
  
  const skillPts = Number(s.character.skillPoints || s.character.progression?.skillPoints || 0);
  $("#uie-skills-stats-badge").text(`${skillPts} SP`);
  
  if (selectedSkillIndex >= 0 && list[selectedSkillIndex]) {
    showSkillDetails(selectedSkillIndex);
  }
}

function deleteSkill(idx) {
    if (!confirm("Delete this skill?")) return;
    const s = getSettings();
    if (!s) return;
    ensureSkillsModel(s);
    s.inventory.skills.splice(idx, 1);
    saveSettings(s);
    selectedSkillIndex = -1;
    init();
}

function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
