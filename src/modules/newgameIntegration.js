/**
 * New Game Setup - Integration & Helper Module
 * Provides utilities for triggering new game setup from various UI points
 */

export function getNewGameSetupState() {
  try {
    const settings = window.getSettings?.();
    if (!settings) return null;
    
    return {
      character: settings.character || {},
      appearance: settings.appearance || {},
      lorebook: settings.lorebook || {},
      currency: settings.currency || {},
      factions: settings.factions || [],
      lifeTrackers: settings.life?.trackers || [],
      inventory: settings.inventory || {},
      quests: settings.journal?.quests || [],
      location: settings.world?.startingLocation || {}
    };
  } catch (err) {
    console.warn("Failed to get new game state:", err);
    return null;
  }
}

export function showNewGameSetup() {
  try {
    if (window.UIE_showNewGamePopup) {
      window.UIE_showNewGamePopup();
    } else {
      const overlay = document.getElementById("uie-newgame-overlay");
      if (overlay) {
        overlay.classList.add("active");
      } else {
        console.warn("New Game popup not found in DOM");
      }
    }
  } catch (err) {
    console.error("Failed to show new game setup:", err);
  }
}

export function hideNewGameSetup() {
  try {
    if (window.UIE_hideNewGamePopup) {
      window.UIE_hideNewGamePopup();
    } else {
      const overlay = document.getElementById("uie-newgame-overlay");
      if (overlay) {
        overlay.classList.remove("active");
      }
    }
  } catch (err) {
    console.error("Failed to hide new game setup:", err);
  }
}

// Make globally accessible
window.NewGameSetup = {
  show: showNewGameSetup,
  hide: hideNewGameSetup,
  getState: getNewGameSetupState
};

export default {
  show: showNewGameSetup,
  hide: hideNewGameSetup,
  getState: getNewGameSetupState
};
