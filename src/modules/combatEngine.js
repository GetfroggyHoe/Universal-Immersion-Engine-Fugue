/**
 * combatEngine.js — Turn-Based Battle Engine (FF-Style)
 * 
 * Implements Pillar 1 (Attribute Roll), Pillar 2 (Thematic Advantage), 
 * Pillar 3 (Narrative Plausibility), and Plot Armor mechanics.
 * 
 * Integrates with stateMutator.js for action wheel generation.
 */

import { calculateAttributeRoll } from "./jobClass.js";

const COMBAT_CONFIG = {
  PLOT_ARMOR_MAX: 3,
  CRITICAL_SUCCESS_THRESHOLD: 18,
  CRITICAL_FAIL_THRESHOLD: 3,
  TRIVIAL_CHECK_DC: 5
};

/**
 * Combat session tracker
 */
export class CombatState {
  constructor(player, enemies = []) {
    this.player = player;
    this.enemies = enemies;
    this.turn = 0;
    this.playerTurn = true;
    this.actionHistory = [];
    this.inCombat = true;
  }

  endCombat() {
    this.inCombat = false;
    return this.actionHistory;
  }
}

/**
 * Initialize a combat encounter
 */
export function initiateCombat(player, enemyList) {
  const combat = new CombatState(player, enemyList);
  window.UIE_CombatState = combat;
  console.log(`[CombatEngine] Combat initiated: Player vs ${enemyList.length} enemy(ies)`);
  return combat;
}

/**
 * Evaluate action success using 3-Pillar Probability Engine
 * 
 * Pillar 1: Attribute Roll (D20 + mods)
 * Pillar 2: Thematic Advantage (name/description bias)
 * Pillar 3: Narrative Plausibility (AI determines)
 */
export function evaluateAction(player, action, target, enemyTheme = "") {
  // Pillar 1: Attribute Roll
  const roll = calculateAttributeRoll(player, action.type || "attack");

  // Pillar 2: Thematic Advantage
  const themeBonus = calculateThematicBonus(action.name, action.description, target, enemyTheme);

  // Calculate raw probability (0-100)
  const rollScore = roll.total + themeBonus;
  const baseDC = 10; // Base difficulty class
  let rawProbability = Math.min(100, Math.max(0, (rollScore - baseDC) * 5));

  // Pillar 3: Narrative Plausibility check
  // (This is where AI_PROMPT at Depth:0 will be injected)
  const result = {
    actionId: action.id,
    actionName: action.name,
    type: action.type,
    target: target.name || target,
    roll: roll,
    themeBonus: themeBonus,
    rawProbability: rawProbability,
    isTrivalCheck: false,
    isCriticalSuccess: roll.critical || rollScore >= 25,
    isCriticalFail: roll.fumble || rollScore <= 5,
    noSell: false,
    plotArmorConsumed: false,
    injectionPayload: {
      diceRoll: roll.total,
      themeBias: themeBonus,
      action: action.name,
      target: target.name || target,
      instruction: `Player rolled ${roll.d20} (d20) + ${roll.statMod} (stat) + ${roll.levelBonus} (level) = ${roll.total} vs DC ${baseDC}. Thematic bonus: ${themeBonus}. Total probability: ${rawProbability}%. Critical Success: ${roll.critical}. Narrative outcome:`
    }
  };

  return result;
}

/**
 * Pillar 2: Calculate thematic advantage/disadvantage
 * E.g., "Firebolt" vs "Wood Elemental" = major disadvantage
 */
function calculateThematicBonus(actionName, actionDesc, target, targetTheme) {
  let bonus = 0;

  // Normalize strings for matching
  const action = `${actionName} ${actionDesc}`.toLowerCase();
  const theme = `${target.name} ${targetTheme}`.toLowerCase();

  // Strength matches (synergy)
  const strengthMatches = [
    { action: /fire|flame|heat/, theme: /wood|leaf|plant|organic/ },
    { action: /water|ice|frost/, theme: /fire|flame|heat|lava/ },
    { action: /lightning|electric/, theme: /water|metal|conductive/ },
    { action: /holy|light/, theme: /undead|demon|dark|evil/ },
    { action: /poison|toxic/, theme: /organic|flesh|living/ }
  ];

  // Weakness matches (disadvantage)
  const weaknessMatches = [
    { action: /fire|flame/, theme: /water|ice|frost/ },
    { action: /physical|melee/, theme: /incorporeal|ghost|spirit|ethereal/ },
    { action: /raw.*salmon|silly|absurd/, theme: /tank|armored|protected/ }
  ];

  for (const match of strengthMatches) {
    if (match.action.test(action) && match.theme.test(theme)) {
      bonus += 8; // Major advantage
    }
  }

  for (const match of weaknessMatches) {
    if (match.action.test(action) && match.theme.test(theme)) {
      bonus -= 8; // Major disadvantage
    }
  }

  return bonus;
}

/**
 * Safe mathematical expression evaluator to avoid eval() CSP warnings.
 * Supports numbers, basic operators (+, -, *, /) and parentheses.
 */
export function safeEvalMath(expr) {
  const clean = String(expr || "").replace(/\s+/g, "");
  if (!clean) return 0;
  if (!/^[0-9+\-*/().]+$/.test(clean)) {
    console.warn("[CombatEngine] Unsafe math expression rejected:", expr);
    return 0;
  }

  let pos = 0;
  
  function parseExpression() {
    let value = parseTerm();
    while (pos < clean.length) {
      const op = clean[pos];
      if (op === "+" || op === "-") {
        pos++;
        const nextVal = parseTerm();
        if (op === "+") value += nextVal;
        else value -= nextVal;
      } else {
        break;
      }
    }
    return value;
  }
  
  function parseTerm() {
    let value = parseFactor();
    while (pos < clean.length) {
      const op = clean[pos];
      if (op === "*" || op === "/") {
        pos++;
        const nextVal = parseFactor();
        if (op === "*") value *= nextVal;
        else {
          if (nextVal === 0) throw new Error("Division by zero");
          value /= nextVal;
        }
      } else {
        break;
      }
    }
    return value;
  }
  
  function parseFactor() {
    if (pos >= clean.length) return 0;
    if (clean[pos] === "(") {
      pos++; // consume '('
      const val = parseExpression();
      if (clean[pos] === ")") {
        pos++; // consume ')'
      }
      return val;
    }
    
    // Match a number
    const start = pos;
    if (clean[pos] === "-") {
      pos++;
    }
    while (pos < clean.length && /[0-9.]/.test(clean[pos])) {
      pos++;
    }
    const numStr = clean.slice(start, pos);
    const val = parseFloat(numStr);
    if (isNaN(val)) return 0;
    return val;
  }

  try {
    return parseExpression();
  } catch (e) {
    console.error("[CombatEngine] Error evaluating math expression:", expr, e);
    return 0;
  }
}

/**
 * Execute action and apply damage/effects
 */
export function executeAction(player, actionResult, target, damageFormula = null) {
  const damage = damageFormula ? 
     safeEvalMath(damageFormula.replace(/\{roll\}/g, actionResult.roll.total))
    : Math.max(1, actionResult.roll.total - 5);

  let actualDamage = damage;
  let plotArmorConsumed = false;

  // Handle lethal blows with Plot Armor
  if (actionResult.isCriticalSuccess && damage >= target.hp) {
    if ((player.plotArmor || 0) > 0) {
      player.plotArmor--;
      actualDamage = Math.min(target.hp - 1, damage);
      plotArmorConsumed = true;
      console.log(`[CombatEngine] Plot Armor consumed! Lethal damage mitigated. Remaining: ${player.plotArmor}`);
    } else if (player.difficulty === "insane") {
      console.log(`[CombatEngine] INSANE MODE: Character killed. Game Over.`);
      return {
        success: true,
        damage: actualDamage,
        playerDead: true,
        message: "You have been defeated. Game Over."
      };
    }
  }

  target.hp = Math.max(0, target.hp - actualDamage);

  return {
    success: !actionResult.noSell,
    damage: actualDamage,
    target: target.name,
    targetHpRemaining: target.hp,
    targetDefeated: target.hp <= 0,
    plotArmorConsumed: plotArmorConsumed,
    criticalSuccess: actionResult.isCriticalSuccess,
    isFumble: actionResult.isCriticalFail
  };
}

/**
 * Trivial Check: Bypass critical fail for mundane actions
 */
export function isTrivialAction(actionName) {
  const trivialPatterns = /pick.*up|open.*door|read|examine|listen|look/i;
  return trivialPatterns.test(actionName);
}

/**
 * No-Sell: AI determines if action is impossible (0% probability)
 * This must be injected into AI prompt at Depth:0
 */
export function markAsNoSell(actionResult, reason) {
  actionResult.noSell = true;
  actionResult.noSellReason = reason;
  actionResult.rawProbability = 0;
  return actionResult;
}

/**
 * Check if an action is a repeated ineffective attempt
 */
export function isRepeatedNoSell(actionName, actionHistory) {
  const recentNoSells = actionHistory
    .filter(h => h.noSell && !h.success)
    .slice(-5); // Check last 5 actions

  return recentNoSells.some(h => h.actionName === actionName);
}

/**
 * Grant Plot Armor (restore on healing)
 */
export function restorePlotArmor(player) {
  player.plotArmor = Math.min(
    COMBAT_CONFIG.PLOT_ARMOR_MAX,
    (player.plotArmor || 0) + 1
  );
  console.log(`[CombatEngine] Plot Armor restored: ${player.plotArmor}/${COMBAT_CONFIG.PLOT_ARMOR_MAX}`);
}

/**
 * Initialize Plot Armor on player
 */
export function initializePlotArmor(player) {
  player.plotArmor = COMBAT_CONFIG.PLOT_ARMOR_MAX;
}

/**
 * Generate AI prompt injection for combat action
 * This goes at Depth: 0 in the LLM context
 */
export function generateCombatPromptInjection(actionResult) {
  return `
=== COMBAT MECHANICS INJECTION (Depth: 0) ===
Action: ${actionResult.actionName}
Target: ${actionResult.target}
Dice Roll: ${actionResult.roll.d20} (d20) + ${actionResult.roll.statMod} (stat) + ${actionResult.roll.levelBonus} (level) = ${actionResult.roll.total}
Thematic Bias: ${actionResult.themeBonus > 0 ? '+' : ''}${actionResult.themeBonus}
Total Probability: ${actionResult.rawProbability}%
Critical Success: ${actionResult.isCriticalSuccess}
Critical Failure: ${actionResult.isCriticalFail}
Trivial Check (auto-success): ${actionResult.isTrivalCheck}
No-Sell (0% probability): ${actionResult.noSell}

Your narrative response MUST respect this mechanical outcome exactly. Do not hallucinate an unfair result.
If this is a No-Sell, the action fails completely and the player cannot alter state.
If this is Critical Success, describe an extraordinary triumph.
If this is Critical Failure, describe a mishap (but not game-ending without Plot Armor consumption).
===
`;
}

/**
 * Initialize combat engine
 */
export function initCombatEngine() {
  window.UIE_Combat = {
    CombatState,
    initiateCombat,
    evaluateAction,
    executeAction,
    isTrivialAction,
    markAsNoSell,
    isRepeatedNoSell,
    restorePlotArmor,
    initializePlotArmor,
    generateCombatPromptInjection,
    safeEvalMath,
    COMBAT_CONFIG
  };
  console.log("[CombatEngine] Initialized - FF-style turn-based system ready");
}
