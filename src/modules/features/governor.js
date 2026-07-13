import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";
import { getGlobalDOM } from "../domHierarchy.js";
import { getGlobalGovernor } from "../governor.js";

let mounted = false;

function ensureGovernorRulesModel(s) {
  if (!s.governorRules || typeof s.governorRules !== "object") {
    s.governorRules = {
      worldRules: [],
      regionalRules: {}, // regionId -> Array of rules
      localRules: {},    // localGridId -> Array of rules
      heatLevel: 0
    };
  }
  if (!Array.isArray(s.governorRules.worldRules)) s.governorRules.worldRules = [];
  if (!s.governorRules.regionalRules || typeof s.governorRules.regionalRules !== "object") s.governorRules.regionalRules = {};
  if (!s.governorRules.localRules || typeof s.governorRules.localRules !== "object") s.governorRules.localRules = {};
  
  // Make sure we keep settings in sync with Governor's heat level
  const gov = getGlobalGovernor();
  if (gov) {
    if (s.governorRules.heatLevel === undefined) {
      s.governorRules.heatLevel = gov.heatLevel || 0;
    } else {
      gov.heatLevel = s.governorRules.heatLevel;
    }
  }
}

export function init() {
  const $root = $("#uie-view-governor");
  if (!$root.length) return;
  
  if (mounted) {
    try { render(); } catch (_) {}
    return;
  }
  mounted = true;
  
  try { bind(); } catch (_) {}
  try { render(); } catch (_) {}
}

function getSeverityText(severity) {
  const s = Number(severity || 5);
  if (s <= 2) return `${s} - Minor (Social Frown)`;
  if (s <= 4) return `${s} - Suspicious`;
  if (s <= 6) return `${s} - Medium Crime (Fine)`;
  if (s <= 8) return `${s} - Major Crime (Lockup)`;
  return `${s} - Forbidden (Immediate Execution)`;
}

function bind() {
  const doc = $(document);
  
  // Severity slider value label sync
  doc.off("input.uieGovSeverity", "#uie-gov-input-severity")
     .on("input.uieGovSeverity", "#uie-gov-input-severity", function() {
       const val = $(this).val();
       $("#uie-gov-severity-label").text(getSeverityText(val));
     });
     
  // Declare Rule button submission
  doc.off("click.uieGovSubmit", "#uie-gov-btn-submit")
     .on("click.uieGovSubmit", "#uie-gov-btn-submit", function(e) {
       e.preventDefault();
       e.stopPropagation();
       
       const targetVal = String($("#uie-gov-input-target").val() || "").trim();
       if (!targetVal) {
         notify("warning", "Please specify a banned item or action.", "Social Physics");
         return;
       }
       
       const scope = $("#uie-gov-input-hierarchy").val();
       const severity = parseInt($("#uie-gov-input-severity").val()) || 5;
       const excRaw = String($("#uie-gov-input-exceptions").val() || "").trim();
       
       // Parse immune exceptions (NPCs, Factions, Titles)
       const exceptions = excRaw ? 
          excRaw.split(",").map(x => String(x || "").trim()).filter(Boolean)
         : [];
         
       const s = getSettings();
       ensureGovernorRulesModel(s);
       
       const newRule = {
         id: `rule_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
         target: targetVal,
         description: `Banned: ${targetVal}`,
         severity: severity,
         exceptions: exceptions,
         scope: scope,
         timestamp: Date.now()
       };
       
       const dom = getGlobalDOM();
       const loc = dom?.playerLocation || { worldId: "default", regionId: "hub", localGridId: "main" };
       
       if (scope === "world") {
         s.governorRules.worldRules.push(newRule);
       } else if (scope === "regional") {
         const regionId = loc.regionId || "hub";
         if (!s.governorRules.regionalRules[regionId]) {
           s.governorRules.regionalRules[regionId] = [];
         }
         s.governorRules.regionalRules[regionId].push(newRule);
       } else {
         const localGridId = loc.localGridId || "main";
         if (!s.governorRules.localRules[localGridId]) {
           s.governorRules.localRules[localGridId] = [];
         }
         s.governorRules.localRules[localGridId].push(newRule);
       }
       
       // Declare the rule in the core Governor registry as well
       const gov = getGlobalGovernor();
       if (gov) {
         const regionKey = scope === "world" ? "world" : (scope === "regional" ? loc.regionId : loc.localGridId);
         gov.declareRule(regionKey, newRule.id, {
           description: newRule.description,
           severity: newRule.severity,
           exceptions: newRule.exceptions
         });
       }
       
       saveSettings();
       
       // Reset form fields
       $("#uie-gov-input-target").val("");
       $("#uie-gov-input-exceptions").val("");
       $("#uie-gov-input-severity").val(5);
       $("#uie-gov-severity-label").text(getSeverityText(5));
       
       notify("success", `Declared new rule: "${targetVal}"`, "Social Physics");
       render();
     });
     
  // Delete rule handler
  doc.off("click.uieGovDeleteRule", ".uie-gov-delete-rule")
     .on("click.uieGovDeleteRule", ".uie-gov-delete-rule", function(e) {
       e.preventDefault();
       e.stopPropagation();
       
       const ruleId = $(this).data("id");
       const scope = $(this).data("scope");
       const key = $(this).data("key"); // regionId or localGridId for regional/local
       
       if (!confirm("Are you sure you want to abolish this law?")) return;
       
       const s = getSettings();
       ensureGovernorRulesModel(s);
       
       if (scope === "world") {
         s.governorRules.worldRules = s.governorRules.worldRules.filter(r => r.id !== ruleId);
       } else if (scope === "regional") {
         if (s.governorRules.regionalRules[key]) {
           s.governorRules.regionalRules[key] = s.governorRules.regionalRules[key].filter(r => r.id !== ruleId);
         }
       } else if (scope === "local") {
         if (s.governorRules.localRules[key]) {
           s.governorRules.localRules[key] = s.governorRules.localRules[key].filter(r => r.id !== ruleId);
         }
       }
       
       saveSettings();
       notify("info", "Law abolished and registry updated.", "Social Physics");
       render();
     });
}

const HEAT_LEVEL_INFO = [
  { name: "Clean", color: "#2ecc71", desc: "Unknown identity. Gates open. Perfect compliance." },
  { name: "Watched", color: "#3498db", desc: "Minor suspicion. Local guards keeping an eye out." },
  { name: "Suspected", color: "#cba35c", desc: "Wanted status looming. Guards will question you on sight." },
  { name: "Wanted", color: "#e67e22", desc: "Bounty Hunters spawned. City gates locked. Aggressive guards." },
  { name: "Hunted", color: "#e74c3c", desc: "Elite Inquisitors & SWAT teams deployed. Severe force authorized." },
  { name: "Condemned", color: "#9b59b6", desc: "KILL-ON-SIGHT. Exits physically locked. immediate confrontation." }
];

export function render() {
  const s = getSettings();
  ensureGovernorRulesModel(s);
  
  const dom = getGlobalDOM();
  const loc = dom?.playerLocation || { worldId: "default", regionId: "hub", localGridId: "main" };
  
  // 1. Update Geography Label
  $("#uie-gov-geography").text(`Location: [World: ${loc.worldId}, Region: ${loc.regionId}, Room: ${loc.localGridId}]`);
  
  // 2. Heat and Wanted Status
  const gov = getGlobalGovernor();
  const rawHeat = gov ? gov.heatLevel : (s.governorRules.heatLevel || 0);
  const heatIdx = Math.max(0, Math.min(5, Math.floor(rawHeat)));
  const info = HEAT_LEVEL_INFO[heatIdx];
  
  const $badge = $("#uie-gov-heat-badge");
  if ($badge.length) {
    $badge.text(`${info.name} (Level ${heatIdx})`)
          .css({
            background: info.color,
            boxShadow: `0 0 12px ${info.color}50`
          });
  }
  
  const $bar = $("#uie-gov-heat-bar");
  if ($bar.length) {
    const pct = Math.min(100, (rawHeat / 5) * 100);
    $bar.css("width", `${pct}%`);
  }
  
  $("#uie-gov-wanted-desc").text(info.desc);
  
  // 3. Compile and Render Rules
  const $list = $("#uie-gov-rules-list");
  if (!$list.length) return;
  
  $list.empty();
  
  const worldRules = s.governorRules.worldRules || [];
  const curRegionRules = s.governorRules.regionalRules[loc.regionId] || [];
  const curLocalRules = s.governorRules.localRules[loc.localGridId] || [];
  
  const totalRulesCount = worldRules.length + curRegionRules.length + curLocalRules.length;
  $("#uie-gov-rules-count").text(`${totalRulesCount} active`);
  
  if (totalRulesCount === 0) {
    $list.append(`
      <div style="opacity:0.6; font-size:12px; text-align:center; padding:30px 10px;">
        No active laws declared. Establish the Social Physics of this world by declaring a rule on the left.
      </div>
    `);
    return;
  }
  
  const renderRuleCard = (rule, scopeType, scopeKey = "") => {
    const exceptionsText = rule.exceptions && rule.exceptions.length ?
       `<div style="font-size:9.5px; opacity:0.75; margin-top:4px;"><i class="fa-solid fa-ban" style="color:#ff7b72; margin-right:4px;"></i>Exceptions: ${rule.exceptions.join(", ")}</div>`
      : "";
      
    const scopeBadgeColor = scopeType === "world" ? "#9b59b6" : (scopeType === "regional" ? "#3498db" : "#e67e22");
    
    return `
      <div class="uie-gov-rule-card" style="padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background:rgba(0,0,0,0.22); display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div style="min-width:0; flex:1;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
            <span style="font-size:9px; font-weight:900; text-transform:uppercase; background:${scopeBadgeColor}30; border:1px solid ${scopeBadgeColor}50; color:${scopeBadgeColor}; padding:1px 6px; border-radius:4px;">${scopeType}</span>
            <span style="font-size:9px; font-weight:900; text-transform:uppercase; background:rgba(255,123,114,0.12); border:1px solid rgba(255,123,114,0.25); color:#ff7b72; padding:1px 6px; border-radius:4px;">Sev ${rule.severity}</span>
          </div>
          <div style="font-weight:800; color:#fff; font-size:12.5px; line-height:1.2;">${rule.target}</div>
          ${exceptionsText}
        </div>
        <button class="uie-gov-delete-rule" data-id="${rule.id}" data-scope="${scopeType}" data-key="${scopeKey}" style="flex:0 0 auto; width:28px; height:28px; border-radius:8px; border:1px solid rgba(231,76,60,0.4); background:rgba(231,76,60,0.1); color:#e74c3c; font-size:12px; cursor:pointer; display:grid; place-items:center; transition:all 0.15s ease;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
  };
  
  // Render World Rules
  if (worldRules.length > 0) {
    $list.append(`<div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#cba35c; letter-spacing:0.5px; margin-top:4px;">World Scope</div>`);
    worldRules.forEach(r => {
      $list.append(renderRuleCard(r, "world"));
    });
  }
  
  // Render Regional Rules
  if (curRegionRules.length > 0) {
    $list.append(`<div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#cbd5e0; letter-spacing:0.5px; margin-top:4px;">Regional Scope (City)</div>`);
    curRegionRules.forEach(r => {
      $list.append(renderRuleCard(r, "regional", loc.regionId));
    });
  }
  
  // Render Local Rules
  if (curLocalRules.length > 0) {
    $list.append(`<div style="font-size:10px; font-weight:800; text-transform:uppercase; color:#ffd56a; letter-spacing:0.5px; margin-top:4px;">Local Scope (Room)</div>`);
    curLocalRules.forEach(r => {
      $list.append(renderRuleCard(r, "local", loc.localGridId));
    });
  }
}
