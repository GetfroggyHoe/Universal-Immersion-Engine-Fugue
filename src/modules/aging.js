/**
 * aging.js — Generational Aging & Lineage System
 * 
 * Supports endlessly aging worlds with generational succession.
 * Implements sprite swapping on age brackets, lineage trees, and heir succession.
 */

export class AgeingEngine {
  constructor() {
    this.agingEnabled = false;
    this.yearsPassed = 0;
    this.generationCounter = 0;
    this.historicalRoster = []; // Deceased/retired characters
    this.lineageTree = {}; // { characterId: { parentId, childIds, generation } }
  }

  /**
   * Enable/disable aging for the world
   */
  setAgingEnabled(enabled) {
    this.agingEnabled = enabled;
    console.log(`[AgeingEngine] Aging ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Age a character by a certain number of years
   */
  ageCharacter(character, years = 1, agingMultiplier = 1.0) {
    if (!this.agingEnabled) return;

    const actualIncrease = years * agingMultiplier;
    character.currentAge = (character.currentAge || 0) + actualIncrease;

    // Check for age bracket crossing (sprite swap)
    this.checkSpriteSwap(character);

    console.log(`[AgeingEngine] ${character.name} aged ${actualIncrease} years (now ${character.currentAge})`);
  }

  /**
   * Check if character crossed an age bracket, swap sprite
   */
  checkSpriteSwap(character) {
    if (!character.sprite_macros || !Array.isArray(character.sprite_macros)) return;

    for (const macro of character.sprite_macros) {
      if (macro.ageBracketMin && macro.ageBracketMax) {
        if (character.currentAge >= macro.ageBracketMin && 
            character.currentAge < macro.ageBracketMax) {
          // This is the correct bracket
          if (character.currentSprite !== macro.spriteId) {
            character.currentSprite = macro.spriteId;
            character.spriteBase64 = macro.base64 || null;
            console.log(`[AgeingEngine] Sprite swapped for ${character.name}: ${macro.spriteId}`);
          }
          break;
        }
      }
    }
  }

  /**
   * Advance world time by years (annual rollover)
   */
  advanceYears(years = 1, roster = []) {
    this.yearsPassed += years;

    // Age all entities
    roster.forEach(entity => {
      if (entity.agingMultiplier !== undefined) {
        this.ageCharacter(entity, years, entity.agingMultiplier);
      } else {
        this.ageCharacter(entity, years, 1.0);
      }
    });

    console.log(`[AgeingEngine] ${years} year(s) passed. World age: ${this.yearsPassed}`);
  }

  /**
   * Register a lineage relationship
   */
  registerLineage(childId, parentId, generation = 0) {
    if (!this.lineageTree[childId]) {
      this.lineageTree[childId] = {
        parentId: parentId,
        childIds: [],
        generation: generation,
        spouseId: null
      };
    }

    if (parentId && this.lineageTree[parentId]) {
      this.lineageTree[parentId].childIds.push(childId);
    }
  }

  /**
   * Get family tree for a character
   */
  getFamilyTree(characterId, depth = 3) {
    const tree = {
      characterId: characterId,
      lineage: this.lineageTree[characterId] || {},
      ancestors: [],
      descendants: []
    };

    // Trace ancestors
    let current = characterId;
    for (let i = 0; i < depth; i++) {
      const parent = this.lineageTree[current]?.parentId;
      if (!parent) break;
      tree.ancestors.push(parent);
      current = parent;
    }

    // Trace descendants
    const queue = [characterId];
    const visited = new Set();
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const children = this.lineageTree[id]?.childIds || [];
      tree.descendants.push(...children);
      queue.push(...children);
    }

    return tree;
  }

  /**
   * Handle character death/retirement
   */
  retireCharacter(character) {
    this.historicalRoster.push({
      id: character.id,
      name: character.name,
      class: character.class,
      finalAge: character.currentAge,
      generation: this.lineageTree[character.id]?.generation || 0,
      retiredAt: Date.now(),
      legacy: character.legacy || {}
    });

    console.log(`[AgeingEngine] ${character.name} added to historical roster`);
  }

  /**
   * Select an heir and transfer legacy
   */
  selectHeir(character, heirId, roster = {}) {
    const heir = roster[heirId];
    if (!heir) {
      console.warn(`[AgeingEngine] Heir ${heirId} not found`);
      return false;
    }

    // Check if heir is tagged [Lineage: Child]
    if (!heir.tags || !heir.tags.includes("Lineage: Child")) {
      console.warn(`[AgeingEngine] ${heirId} is not a valid heir (missing Lineage: Child tag)`);
      return false;
    }

    // Transfer currency
    heir.currency = (heir.currency || 0) + (character.currency || 0);

    // Transfer DOM permissions
    if (character.domPermissions) {
      heir.domPermissions = { ...character.domPermissions };
    }

    // Transfer family name
    heir.familyName = character.familyName || character.name;

    // Register heir as child
    this.registerLineage(heirId, character.id, 
      (this.lineageTree[character.id]?.generation || 0) + 1);

    // Retire old character
    this.retireCharacter(character);

    console.log(`[AgeingEngine] ${heirId} selected as heir, inheriting from ${character.name}`);

    return {
      success: true,
      newPlayer: heir,
      legacy: character.legacy || {}
    };
  }

  /**
   * Display Sylvan Album (lineage UI with botanical theme)
   */
  renderSylvanAlbum(characterId, roster = {}) {
    const familyTree = this.getFamilyTree(characterId, 5);
    const character = roster[characterId];

    const album = {
      title: `${character?.familyName || "Family"} Album`,
      theme: "botanical",
      characters: []
    };

    // Add ancestors
    familyTree.ancestors.forEach((ancId, idx) => {
      const anc = roster[ancId];
      if (anc) {
        album.characters.push({
          id: ancId,
          name: anc.name,
          generation: -1 * (idx + 1),
          role: "ancestor",
          sentiment: anc.sentiment || 0,
          portraitUrl: anc.portraitUrl || null,
          cssClass: anc.sentiment > 50 ? "leafy-vines-high-loyalty" : "thorny-briars-rival"
        });
      }
    });

    // Add main character
    if (character) {
      album.characters.push({
        id: characterId,
        name: character.name,
        generation: 0,
        role: "current",
        sentiment: 0,
        portraitUrl: character.portraitUrl || null,
        cssClass: "main-character"
      });
    }

    // Add descendants
    familyTree.descendants.forEach((descId, idx) => {
      const desc = roster[descId];
      if (desc) {
        const gen = this.lineageTree[descId]?.generation || 0;
        album.characters.push({
          id: descId,
          name: desc.name,
          generation: gen,
          role: "descendant",
          sentiment: desc.sentiment || 0,
          portraitUrl: desc.portraitUrl || null,
          cssClass: desc.sentiment > 50 ? "leafy-vines-high-loyalty" : "thorny-briars-rival",
          tags: desc.tags || []
        });
      }
    });

    return album;
  }

  /**
   * Generate CSS for sylvan album (botanical theme)
   */
  generateSylvanCSS() {
    return `
      .sylvan-album {
        background: linear-gradient(135deg, #f4e8d4, #e8d4c0);
        font-family: 'Georgia', serif;
        border: 3px solid #8b6f47;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 8px 20px rgba(60,40,10,0.3);
      }

      .sylvan-title {
        color: #5a3a0a;
        font-size: 24px;
        text-align: center;
        margin-bottom: 20px;
        text-shadow: 1px 1px 2px rgba(255,255,255,0.5);
      }

      .leafy-vines-high-loyalty {
        border: 4px solid #4caf50;
        box-shadow: 
          0 0 15px rgba(76,175,80,0.4),
          inset 0 0 8px rgba(76,175,80,0.2);
        background-image: 
          radial-gradient(circle at 20% 80%, rgba(76,175,80,0.15), transparent 50%);
      }

      .thorny-briars-rival {
        border: 4px solid #c0392b;
        box-shadow: 
          0 0 15px rgba(192,57,43,0.4),
          inset 0 0 8px rgba(192,57,43,0.2);
        background-image: 
          radial-gradient(circle at 20% 80%, rgba(192,57,43,0.15), transparent 50%);
      }

      .main-character {
        border: 6px solid #d4a574;
        box-shadow: 0 0 20px rgba(212,165,116,0.6);
        transform: scale(1.1);
        z-index: 10;
      }

      .character-portrait {
        width: 120px;
        height: 140px;
        border-radius: 8px;
        background: #f0e6d2;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #8b6f47;
        font-size: 12px;
        overflow: hidden;
      }

      .character-name {
        text-align: center;
        margin-top: 8px;
        color: #5a3a0a;
        font-weight: bold;
      }

      .ancestor-line {
        border-top: 2px solid #8b6f47;
        margin: 15px 0;
      }
    `;
  }

  /**
   * Export aging state
   */
  exportState() {
    return {
      agingEnabled: this.agingEnabled,
      yearsPassed: this.yearsPassed,
      generationCounter: this.generationCounter,
      historicalRosterCount: this.historicalRoster.length,
      lineageTreeSize: Object.keys(this.lineageTree).length
    };
  }

  /**
   * Validate aging system
   */
  validate() {
    const errors = [];
    if (this.yearsPassed < 0) errors.push("Years passed cannot be negative");
    if (this.historicalRoster.some(r => !r.id)) errors.push("Historical record missing ID");
    return errors.length === 0 ? null : errors;
  }
}

/**
 * Initialize global aging engine
 */
let globalAgingEngine = null;

export function initAgeingEngine() {
  // Lazy-init: Don't create aging engine until needed
  window.UIE_Ageing = {
    AgeingEngine,
    initAgeingEngine,
    getGlobalAgeing: () => globalAgingEngine || (globalAgingEngine = new AgeingEngine(), globalAgingEngine)
  };

  console.log("[AgeingEngine] Initialized - Generational aging system ready (lazy-loaded)");
}

export function getGlobalAgeing() {
  if (!globalAgingEngine) {
    initAgeingEngine();
    globalAgingEngine = new AgeingEngine();
  }
  return globalAgingEngine;
}
