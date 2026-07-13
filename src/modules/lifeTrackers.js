/**
 * LifeTrackersSystem.js - Floating HP/MP bars and status effect indicators
 * Updates based on WorldToScreenPoint coordinates from Unity
 */

export class LifeTrackersSystem {
  constructor(container) {
    this.container = container || document.body;
    this.trackers = new Map(); // charId -> tracker element
    this.characterData = new Map(); // charId -> {hp, maxHp, mp, maxMp, statusEffects}
    this.updateCallbacks = [];

    this.injectStyles();
  }

  /**
   * Inject CSS for life trackers
   */
  injectStyles() {
    if (document.getElementById('re-life-tracker-styles')) return;

    const style = document.createElement('style');
    style.id = 're-life-tracker-styles';
    style.textContent = `
      .re-life-tracker {
        position: absolute;
        z-index: 9997;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 96px;
        pointer-events: none;
        padding: 8px 10px;
        border-radius: 8px;
        background: linear-gradient(180deg, rgba(77,45,22,.94), rgba(36,25,21,.96));
        border: 1px solid rgba(241, 192, 106, 0.34);
        box-shadow: 0 10px 24px rgba(0,0,0,.3), inset 0 1px rgba(255,255,255,.08);
        backdrop-filter: blur(10px);
        font-family: Georgia, "Times New Roman", serif;
      }

      .re-life-tracker-label {
        font-size: 11px;
        font-weight: 900;
        color: #fff4df;
        text-shadow: 0 1px 2px rgba(0,0,0,.75);
        text-align: center;
      }

      .re-life-tracker-bar-container {
        height: 8px;
        background: rgba(255,244,210,.18);
        border: 1px solid rgba(241, 192, 106, 0.18);
        border-radius: 999px;
        overflow: hidden;
        position: relative;
        box-shadow: inset 0 1px 3px rgba(0,0,0,.28);
      }

      .re-life-tracker-bar {
        height: 100%;
        background: linear-gradient(90deg, #b45b38, #f1c06a);
        transition: width 0.3s ease-out;
        border-radius: 999px;
        box-shadow: 0 0 14px rgba(255, 107, 131, 0.42);
      }

      /* HP Specific */
      .re-hp-bar {
        background: linear-gradient(90deg, #b45b38, #f1c06a);
      }

      /* MP Specific */
      .re-mp-bar {
        background: linear-gradient(90deg, #6f6bb8, #d0b4ff);
      }

      /* Status effects container */
      .re-status-effects {
        display: flex;
        gap: 2px;
        flex-wrap: wrap;
        justify-content: center;
        min-height: 16px;
        margin-top: 2px;
      }

      .re-status-icon {
        width: 14px;
        height: 14px;
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        position: relative;
        title: attr(data-effect);
      }

      /* Status effect colors */
      .re-status-burn {
        background: rgba(255, 100, 0, 0.8);
        color: #fff;
      }

      .re-status-freeze {
        background: rgba(100, 200, 255, 0.8);
        color: #fff;
      }

      .re-status-poison {
        background: rgba(200, 100, 200, 0.8);
        color: #fff;
      }

      .re-status-stun {
        background: rgba(255, 255, 100, 0.8);
        color: #000;
      }

      .re-status-buff {
        background: rgba(100, 255, 100, 0.8);
        color: #000;
      }

      /* Cast bar (for spells) */
      .re-cast-bar-container {
        height: 6px;
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid #d4af37;
        border-radius: 2px;
        overflow: hidden;
        margin-top: 4px;
      }

      .re-cast-bar {
        height: 100%;
        background: linear-gradient(90deg, #d4af37, #f0e6d2);
        transition: width linear;
        width: 0%;
      }

      .re-cast-label {
        font-size: 9px;
        color: #d4af37;
        text-align: center;
        margin-top: 2px;
      }

      /* Animations */
      @keyframes re-damage-popup {
        0% {
          opacity: 1;
          transform: translateY(0);
        }
        100% {
          opacity: 0;
          transform: translateY(-30px);
        }
      }

      .re-damage-text {
        position: absolute;
        font-weight: bold;
        font-size: 16px;
        pointer-events: none;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        animation: re-damage-popup 1.5s ease-out forwards;
      }

      .re-damage-text.critical {
        color: #ffff00;
        font-size: 20px;
      }

      .re-damage-text.normal {
        color: #ff6666;
      }

      .re-damage-text.heal {
        color: #66ff66;
      }

      /* Starship variant */
      .re-life-tracker.starship .re-life-tracker-bar-container {
        border-color: rgba(83, 186, 242, 0.56);
        background: rgba(255, 255, 255, 0.46);
      }

      .re-life-tracker.starship .re-hp-bar {
        background: linear-gradient(90deg, #ff6b83, #53baf2);
      }

      .re-life-tracker.starship .re-mp-bar {
        background: linear-gradient(90deg, #0088ff, #00ffff);
      }

      /* Academy variant */
      .re-life-tracker.academy .re-life-tracker-bar-container {
        border-color: #d4af37;
        background: rgba(80, 20, 20, 0.5);
      }

      .re-life-tracker.academy .re-hp-bar {
        background: linear-gradient(90deg, #ff4444, #dd0000);
      }

      .re-life-tracker.academy .re-mp-bar {
        background: linear-gradient(90deg, #d4af37, #f0e6d2);
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create or update a character's life tracker
   * @param {string} charId - Character identifier
   * @param {object} stats - { hp, maxHp, mp, maxMp, genre }
   * @param {object} position - { x, y } screen coordinates
   */
  updateTracker(charId, stats, position) {
    // Update character data
    this.characterData.set(charId, stats);

    let tracker = this.trackers.get(charId);

    // Create tracker if it doesn't exist
    if (!tracker) {
      tracker = this.createTracker(charId, stats);
      this.trackers.set(charId, tracker);
      this.container.appendChild(tracker);
    }

    // Update position
    tracker.style.left = `${position.x}px`;
    tracker.style.top = `${position.y}px`;

    // Update bars
    this.updateBars(charId, stats);

    // Call any registered callbacks
    this.updateCallbacks.forEach(cb => cb(charId, stats));
  }

  /**
   * Create tracker DOM element
   */
  createTracker(charId, stats) {
    const tracker = document.createElement('div');
    tracker.id = `re-tracker-${charId}`;
    tracker.className = `re-life-tracker ${stats.genre || 'default'}`;

    // Character name label
    const label = document.createElement('div');
    label.className = 're-life-tracker-label';
    label.textContent = charId;
    tracker.appendChild(label);

    // HP Bar
    const hpContainer = document.createElement('div');
    hpContainer.className = 're-life-tracker-bar-container';
    const hpBar = document.createElement('div');
    hpBar.className = 're-life-tracker-bar re-hp-bar';
    hpBar.id = `re-hp-${charId}`;
    hpContainer.appendChild(hpBar);
    tracker.appendChild(hpContainer);

    // HP Text
    const hpText = document.createElement('div');
    hpText.className = 're-life-tracker-label';
    hpText.id = `re-hp-text-${charId}`;
    hpText.style.fontSize = '10px';
    tracker.appendChild(hpText);

    // MP Bar (if applicable)
    const mpContainer = document.createElement('div');
    mpContainer.className = 're-life-tracker-bar-container';
    const mpBar = document.createElement('div');
    mpBar.className = 're-life-tracker-bar re-mp-bar';
    mpBar.id = `re-mp-${charId}`;
    mpContainer.appendChild(mpBar);
    tracker.appendChild(mpContainer);

    // Status Effects
    const statusContainer = document.createElement('div');
    statusContainer.className = 're-status-effects';
    statusContainer.id = `re-status-${charId}`;
    tracker.appendChild(statusContainer);

    // Cast Bar (hidden by default)
    const castContainer = document.createElement('div');
    castContainer.className = 're-cast-bar-container';
    castContainer.id = `re-cast-container-${charId}`;
    castContainer.style.display = 'none';
    const castBar = document.createElement('div');
    castBar.className = 're-cast-bar';
    castBar.id = `re-cast-${charId}`;
    castContainer.appendChild(castBar);
    tracker.appendChild(castContainer);

    const castLabel = document.createElement('div');
    castLabel.className = 're-cast-label';
    castLabel.id = `re-cast-label-${charId}`;
    castLabel.textContent = 'Casting...';
    tracker.appendChild(castLabel);

    return tracker;
  }

  /**
   * Update HP/MP bar visuals
   */
  updateBars(charId, stats) {
    const hpPercent = (stats.hp / stats.maxHp) * 100;
    const mpPercent = (stats.mp / stats.maxMp) * 100;

    const hpBar = document.getElementById(`re-hp-${charId}`);
    if (hpBar) {
      hpBar.style.width = `${hpPercent}%`;
    }

    const hpText = document.getElementById(`re-hp-text-${charId}`);
    if (hpText) {
      hpText.textContent = `${stats.hp}/${stats.maxHp}`;
    }

    const mpBar = document.getElementById(`re-mp-${charId}`);
    if (mpBar) {
      mpBar.style.width = `${mpPercent}%`;
    }
  }

  /**
   * Add a status effect icon to the tracker
   * @param {string} charId
   * @param {string} effectType - 'burn', 'freeze', 'poison', 'stun', 'buff'
   * @param {number} duration - milliseconds
   */
  addStatusEffect(charId, effectType, duration = 5000) {
    const statusContainer = document.getElementById(`re-status-${charId}`);
    if (!statusContainer) return;

    const icon = document.createElement('div');
    icon.className = `re-status-icon re-status-${effectType}`;
    icon.textContent = effectType.charAt(0).toUpperCase();
    icon.title = effectType;

    statusContainer.appendChild(icon);

    // Auto-remove after duration
    setTimeout(() => {
      if (icon.parentNode) icon.remove();
    }, duration);
  }

  /**
   * Start casting bar animation
   * @param {string} charId
   * @param {number} castTime - milliseconds
   * @param {string} spellName - optional spell name
   */
  startCastBar(charId, castTime, spellName = 'Casting') {
    const castContainer = document.getElementById(`re-cast-container-${charId}`);
    const castBar = document.getElementById(`re-cast-${charId}`);
    const castLabel = document.getElementById(`re-cast-label-${charId}`);

    if (!castContainer || !castBar) return;

    castContainer.style.display = 'block';
    castLabel.textContent = spellName;
    castBar.style.width = '0%';
    castBar.style.transition = `width ${castTime}ms linear`;

    // Animate bar
    requestAnimationFrame(() => {
      castBar.style.width = '100%';
    });

    // Hide after cast completes
    setTimeout(() => {
      castContainer.style.display = 'none';
      castBar.style.transition = 'width 0.3s ease-out';
    }, castTime);
  }

  /**
   * Show floating damage/heal text
   * @param {string} charId
   * @param {number} amount
   * @param {string} type - 'damage', 'critical', 'heal'
   * @param {object} position - {x, y} screen coordinates
   */
  showDamageText(charId, amount, type = 'normal', position = null) {
    const tracker = this.trackers.get(charId);
    if (!tracker && !position) return;

    const pos = position || {
      x: parseFloat(tracker.style.left),
      y: parseFloat(tracker.style.top)
    };

    const text = document.createElement('div');
    text.className = `re-damage-text ${type}`;
    text.textContent = type === 'heal' ? `+${amount}` : `-${amount}`;
    text.style.left = `${pos.x}px`;
    text.style.top = `${pos.y}px`;

    this.container.appendChild(text);

    // Remove after animation
    setTimeout(() => {
      if (text.parentNode) text.remove();
    }, 1500);
  }

  /**
   * Register a callback to be called whenever any tracker updates
   */
  onUpdate(callback) {
    this.updateCallbacks.push(callback);
  }

  /**
   * Clear all trackers
   */
  clearAll() {
    this.trackers.forEach(tracker => {
      if (tracker.parentNode) tracker.remove();
    });
    this.trackers.clear();
    this.characterData.clear();
  }

  /**
   * Remove a specific character's tracker
   */
  removeTracker(charId) {
    const tracker = this.trackers.get(charId);
    if (tracker && tracker.parentNode) {
      tracker.remove();
    }
    this.trackers.delete(charId);
    this.characterData.delete(charId);
  }

  /**
   * Get all active tracker character IDs
   */
  getActiveTrackers() {
    return Array.from(this.trackers.keys());
  }
}

// Export factory function
export function createLifeTrackersSystem(container) {
  return new LifeTrackersSystem(container);
}
