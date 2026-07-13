/**
 * governor.js — The Governor (Crime, Rumors & Reputation)
 * 
 * Tracks crime, heat level, reputation, rumors, and social bias.
 * Implements Global/Regional/Local hierarchy for reputation and rules.
 */

import { getGlobalDOM } from "./domHierarchy.js";
import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";

const HEAT_LEVELS = {
  0: { name: "Clean", effect: "none" },
  1: { name: "Watched", effect: "npc_suspicion" },
  2: { name: "Suspected", effect: "npc_question" },
  3: { name: "Wanted", effect: "bounty_hunters" },
  4: { name: "Hunted", effect: "faction_hostile" },
  5: { name: "Condemned", effect: "portal_lock" }
};

const WEALTH_STATUS = {
  "Rich": { priceMultiplier: 1.25, detectionMod: -2, reputationGain: 1.5 },
  "Modest": { priceMultiplier: 1.0, detectionMod: 0, reputationGain: 1.0 },
  "Poor": { priceMultiplier: 0.75, detectionMod: 1, reputationGain: 0.8 },
  "None": { priceMultiplier: 0.5, detectionMod: 3, reputationGain: 0.5 }
};

export class Governor {
  constructor() {
    // Global reputation tracker
    this.globalReputation = {
      byRegion: {},      // { regionId: { byFaction: { factionId: score } } }
      byFaction: {},     // { factionId: score }
      byClass: {}        // { socialClass: score }
    };

    // Crime & Heat system
    this.heatLevel = 0;  // 0-5
    this.heatMeters = {}; // { regionId: heat }
    this.rulesRegistry = {}; // { regionId: { ruleId: { severity, description, exceptions } } }

    // Rumors system
    this.globalLedger = [];  // Array of rumors
    this.rumorCache = {};    // { regionId: [] }

    // NPC sentiment tracking
    this.npcSentiment = {}; // { npcId: sentimentScore }
  }

  /**
   * Declare rules for a region (DOM-specific laws)
   */
  declareRule(regionId, ruleId, ruleData) {
    if (!this.rulesRegistry[regionId]) {
      this.rulesRegistry[regionId] = {};
    }

    this.rulesRegistry[regionId][ruleId] = {
      id: ruleId,
      description: ruleData.description || "",
      severity: ruleData.severity || 5, // 1-10 scale
      exceptions: ruleData.exceptions || [], // [npcId, faction, etc.]
      broken: false
    };

    console.log(`[Governor] Rule declared in ${regionId}: ${ruleData.description}`);
  }

  /**
   * Check if breaking a rule has witnesses, player is disguised, or has high authority
   * Returns { witnessed: boolean, reason: string }
   */
  checkWitnessAndExceptions(severity) {
    const dom = getGlobalDOM();
    const npcs = dom ? dom.getActiveEntities() : [];
    
    // 1. Witness check: Are there any active NPCs in the scene?
    if (npcs.length === 0) {
      return { witnessed: false, reason: "no_witnesses" };
    }
    
    // 2. Disguise check: Check if player has equipped or starred items containing "disguise"
    const s = getSettings();
    const equipped = s.inventory?.equipped || [];
    const items = s.inventory?.items || [];
    const hasDisguise = equipped.some(it => String(it.name || "").toLowerCase().includes("disguise") || String(it.type || "").toLowerCase().includes("disguise")) ||
                        items.some(it => it.starred && (String(it.name || "").toLowerCase().includes("disguise") || String(it.type || "").toLowerCase().includes("disguise")));
    if (hasDisguise) {
      console.log("[Governor] Player is utilizing a disguise. Crime remains Unknown.");
      return { witnessed: false, reason: "disguised" };
    }

    // 3. Authority vs Fear: High Authority / Intimidation overrides witness instincts
    const stats = s.character?.stats || {};
    const authority = Math.max(Number(stats.cha || 0), Number(stats.int || 0), Number(stats.str || 0));
    const threshold = severity * 8; // Severity 5 requires a stat of 40
    if (authority >= threshold) {
      console.log("[Governor] Intimidation and Authority overrides witness report. Witness remains silent.");
      return { witnessed: false, reason: "fear" };
    }

    return { witnessed: true, reason: "reported" };
  }

  /**
   * Lock exit portals and inject enforcer prompt
   */
  triggerEnforcers() {
    this.heatLevel = 5;
    window.UIE_exitsLocked = true;
    
    console.log("[Governor] CONDEMNED: EXITS LOCKED! spawning world enforcers.");
    notify("error", "EXITS LOCKED! Enforcers have arrived at your location.", "CRITICAL HEAT");

    // We return the custom prompt injected to the main AI
    return "[System Event: Player Heat is CRITICAL. Enforcers have arrived at the location. Exit portals are locked. Force an immediate confrontation.]";
  }

  /**
   * Increment heat when player breaks a rule
   */
  breakRule(regionId, ruleId, witness = null) {
    const rule = this.rulesRegistry[regionId]?.[ruleId];
    if (!rule) return;

    // Check witness, disguise and authority limits
    const check = this.checkWitnessAndExceptions(rule.severity);
    if (!check.witnessed) {
      console.log(`[Governor] Rule broken but un-witnessed/bypassed: ${rule.description} (Reason: ${check.reason})`);
      rule.broken = true;
      return;
    }

    const severityMultiplier = rule.severity / 5; // Normalize to 0.2-2.0
    this.addHeat(severityMultiplier, regionId, witness);

    rule.broken = true;
    console.log(`[Governor] Rule broken and witnessed in ${regionId}: "${rule.description}" (+${severityMultiplier} heat)`);
  }

  /**
   * Add heat to the system
   */
  addHeat(amount, regionId = null, witness = null) {
    const prevHeat = this.heatLevel;
    this.heatLevel = Math.min(5, this.heatLevel + amount);

    if (regionId) {
      this.heatMeters[regionId] = Math.min(5, (this.heatMeters[regionId] || 0) + amount);
    }

    console.log(`[Governor] Heat level: ${this.heatLevel} (${HEAT_LEVELS[Math.floor(this.heatLevel)].name})`);

    try {
      const currentName = HEAT_LEVELS[Math.floor(this.heatLevel)]?.name || "Clean";
      let logMsg = `[System: Heat increased by +${amount.toFixed(2)}. Current Heat: ${this.heatLevel.toFixed(2)} (${currentName})`;
      if (regionId) logMsg += ` in ${regionId}`;
      if (witness) logMsg += `, witnessed by ${witness}`;
      logMsg += ".]";
      injectRpEvent(logMsg);
    } catch (_) {}

    // Sync heat into settings so it persists
    const s = getSettings();
    if (s.governorRules) {
      s.governorRules.heatLevel = this.heatLevel;
      saveSettings();
    }

    // Trigger enforcers at maximum heat
    if (Math.floor(this.heatLevel) >= 5) {
      const promptOverride = this.triggerEnforcers();
      
      // Attempt to silently inject override into AI context
      try {
        if (typeof window.UIE_injectPromptOverride === "function") {
          window.UIE_injectPromptOverride(promptOverride);
        }
      } catch (_) {}
    } else {
      // Trigger effects based on heat level
      this.applyHeatEffects();
    }
  }

  /**
   * Decrease heat over time
   */
  decreaseHeat(amount = 0.25) {
    this.heatLevel = Math.max(0, this.heatLevel - amount);
    Object.keys(this.heatMeters).forEach(rid => {
      this.heatMeters[rid] = Math.max(0, this.heatMeters[rid] - amount);
    });
    
    try {
      const currentName = HEAT_LEVELS[Math.floor(this.heatLevel)]?.name || "Clean";
      injectRpEvent(`[System: Heat decreased by -${amount.toFixed(2)}. Current Heat: ${this.heatLevel.toFixed(2)} (${currentName}).]`);
    } catch (_) {}

    // Unlock exits if heat goes below maximum
    if (this.heatLevel < 5) {
      window.UIE_exitsLocked = false;
    }
    
    const s = getSettings();
    if (s.governorRules) {
      s.governorRules.heatLevel = this.heatLevel;
      saveSettings();
    }
  }

  /**
   * Apply effects based on heat level
   */
  applyHeatEffects() {
    const level = Math.floor(this.heatLevel);
    const heatEffect = HEAT_LEVELS[level];

    switch (heatEffect.effect) {
      case "none":
        break;
      case "npc_suspicion":
        console.log("[Governor] NPCs are now suspicious of the player");
        break;
      case "npc_question":
        console.log("[Governor] Guards are seeking to question the player");
        break;
      case "bounty_hunters":
        console.log("[Governor] WANTED: Bounty hunters spawning");
        break;
      case "faction_hostile":
        console.log("[Governor] HUNTED: Faction-aligned NPCs become hostile");
        break;
      case "portal_lock":
        console.log("[Governor] CONDEMNED: Portals locked, exits physically blocked");
        break;
    }

    // Inject into AI prompt at Depth: 0
    return heatEffect;
  }

  /**
   * Calculate social bias multiplier based on wealth
   */
  calculateSocialBiasMultiplier(wealthStatus) {
    return WEALTH_STATUS[wealthStatus] || WEALTH_STATUS["Modest"];
  }

  /**
   * Modify shop prices based on wealth
   */
  modifyShopPrice(basePrice, wealthStatus) {
    const bias = this.calculateSocialBiasMultiplier(wealthStatus);
    return Math.ceil(basePrice * bias.priceMultiplier);
  }

  /**
   * Modify detection probability based on wealth
   */
  modifyDetectionProbability(baseProb, wealthStatus) {
    const bias = this.calculateSocialBiasMultiplier(wealthStatus);
    return Math.max(0, baseProb + bias.detectionMod * 5); // 5% per point
  }

  /**
   * Track NPC sentiment (affects action wheel options)
   */
  setNPCSentiment(npcId, sentiment) {
    this.npcSentiment[npcId] = Math.max(-100, Math.min(100, sentiment));
  }

  /**
   * Modify sentiment by amount
   */
  modifyNPCSentiment(npcId, delta) {
    this.npcSentiment[npcId] = (this.npcSentiment[npcId] || 0) + delta;
    return this.npcSentiment[npcId];
  }

  /**
   * Update global reputation by faction
   */
  updateReputation(factionId, delta) {
    this.globalReputation.byFaction[factionId] = 
      (this.globalReputation.byFaction[factionId] || 0) + delta;
    console.log(`[Governor] Reputation: ${factionId} ${delta > 0 ? '+' : ''}${delta}`);
    try {
      injectRpEvent(`[System: Reputation with faction/group '${factionId}' changed by ${delta > 0 ? '+' : ''}${delta}. New reputation score: ${this.globalReputation.byFaction[factionId]}.]`);
    } catch (_) {}
  }

  /**
   * Get reputation score for a faction
   */
  getReputation(factionId) {
    return this.globalReputation.byFaction[factionId] || 0;
  }

  /**
   * Rumor mutation: Generate rumors from chat events
   * Runs asynchronously in background
   */
  async generateRumorFromEvent(event, charisma = 10) {
    const rumor = {
      id: `rumor_${Date.now()}`,
      originalEvent: event,
      source: event.source || "unknown",
      timestamp: Date.now(),
      truthScore: 100,
      exaggeration: 0,
      spreaders: [],
      lastSpreadAt: null
    };

    // Apply mutation based on charisma (lower charisma = more exaggeration)
    const charismaFactor = (charisma - 10) / 2;
    rumor.exaggeration = Math.max(0, 20 - charismaFactor * 2);
    rumor.truthScore = Math.max(40, 100 - rumor.exaggeration);

    this.globalLedger.push(rumor);
    console.log(`[Governor] Rumor generated: "${event.summary}" (Truth: ${rumor.truthScore}%)`);
    try {
      injectRpEvent(`[System: New rumor generated: "${event.summary || event.description || "Unknown rumor"}" (Truth: ${rumor.truthScore.toFixed(0)}%, Exaggeration: ${rumor.exaggeration.toFixed(0)}%).]`);
    } catch (_) {}

    return rumor;
  }

  /**
   * Spread a rumor: Mutate it based on spreader NPC's impulse/bias
   */
  spreadRumor(rumorId, spreaderNpcId, spreaderBias = 0.5, spreaderImpulse = 0.5) {
    const rumor = this.globalLedger.find(r => r.id === rumorId);
    if (!rumor) return null;

    // Mutation: Lower truth score, increase exaggeration
    const mutationAmount = (1 - spreaderBias) * spreaderImpulse * 15;
    const oldScore = rumor.truthScore;
    rumor.truthScore = Math.max(0, rumor.truthScore - mutationAmount);
    rumor.exaggeration += mutationAmount;

    rumor.spreaders.push(spreaderNpcId);
    rumor.lastSpreadAt = Date.now();

    console.log(`[Governor] Rumor spread by ${spreaderNpcId} (new truth: ${rumor.truthScore}%)`);
    try {
      injectRpEvent(`[System: Rumor spread by ${spreaderNpcId} (Confidence degraded from ${oldScore.toFixed(0)}% to ${rumor.truthScore.toFixed(0)}%).]`);
    } catch (_) {}
    return rumor;
  }

  /**
   * Get rumor log for UI display (with glitchy CSS for low-truth rumors)
   */
  getRumorLog() {
    return this.globalLedger.map(r => ({
      ...r,
      cssClass: r.truthScore < 50 ? "rumor-glitchy" : "rumor-normal"
    }));
  }

  /**
   * Memory retrieval: Get NPC sentiment for memory sync
   */
  getNPCMemory(npcId) {
    return {
      npcId: npcId,
      sentimentScore: this.npcSentiment[npcId] || 0,
      reputation: this.globalReputation.byFaction,
      heatLevel: this.heatLevel
    };
  }

  /**
   * Generate governor state injection for AI prompt (Depth: 0)
   */
  generateStateInjection(player) {
    const level = Math.floor(this.heatLevel);
    return {
      heatLevel: level,
      heatEffect: HEAT_LEVELS[level].name,
      socialBias: this.calculateSocialBiasMultiplier(player.wealthStatus),
      detectionMod: this.calculateSocialBiasMultiplier(player.wealthStatus).detectionMod,
      activeReputation: this.globalReputation.byFaction,
      rumorCount: this.globalLedger.length,
      instruction: `Crime/Heat Level: ${level}/5 (${HEAT_LEVELS[level].name}). Social Bias for ${player.wealthStatus}: prices ${this.calculateSocialBiasMultiplier(player.wealthStatus).priceMultiplier}x. NPCs use this context.`
    };
  }

  /**
   * Validate governor state
   */
  validate() {
    const errors = [];
    if (this.heatLevel < 0 || this.heatLevel > 5) errors.push("Invalid heat level");
    if (this.globalLedger.some(r => !r.id)) errors.push("Rumor missing ID");
    return errors.length === 0 ? null : errors;
  }
}

/**
 * Initialize global governor
 */
let globalGovernor = null;

export function initGovernor() {
  // Lazy-init: Don't create governor until needed
  window.UIE_Governor = {
    Governor,
    initGovernor,
    getGlobalGovernor: () => globalGovernor || (globalGovernor = new Governor(), globalGovernor)
  };

  console.log("[Governor] Initialized - Crime/Heat/Reputation system ready (lazy-loaded)");
}

export function getGlobalGovernor() {
  return globalGovernor || (initGovernor(), globalGovernor);
}
