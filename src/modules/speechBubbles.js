/**
 * SpeechBubbleSystem.js - Dynamic speech bubbles with character portraits and audio
 * Integrates with VoiceBridge for zero-shot voice synthesis
 * Floats over character heads using Unity WorldToScreenPoint coordinates
 */

export class SpeechBubbleSystem {
  constructor(voiceBridge, container) {
    this.voiceBridge = voiceBridge;
    this.container = container || document.body;
    this.activeBubbles = new Map(); // charId -> bubble element
    this.bubbleQueue = new Map(); // charId -> queue of pending speech
    this.isProcessing = new Map(); // charId -> boolean
    this.portraitCache = new Map(); // charId -> portrait image
    
    // Inject styles if not already present
    this.injectStyles();
  }

  /**
   * Inject CSS for speech bubbles
   */
  injectStyles() {
    if (document.getElementById('re-speech-bubble-styles')) return;

    const style = document.createElement('style');
    style.id = 're-speech-bubble-styles';
    style.textContent = `
      .re-speech-bubble-container {
        position: absolute;
        z-index: 9998;
        display: flex;
        gap: 12px;
        align-items: flex-end;
      }

      .re-speech-bubble-portrait {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        background-size: cover;
        background-position: center;
        border: 2px solid #fff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }

      .re-speech-bubble {
        background: rgba(20, 20, 20, 0.95);
        color: #e8e8e8;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 1.4;
        max-width: 400px;
        min-width: 150px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
        position: relative;
        word-wrap: break-word;
        white-space: pre-wrap;
        animation: re-bubble-fade-in 0.3s ease-out;
      }

      .re-speech-bubble::before {
        content: '';
        position: absolute;
        bottom: -8px;
        left: 12px;
        width: 0;
        height: 0;
        border: 8px solid transparent;
        border-top-color: rgba(20, 20, 20, 0.95);
        border-bottom: 0;
      }

      .re-speech-bubble.starship-comms {
        background: rgba(0, 50, 100, 0.9);
        border-color: #00ff88;
        color: #00ff88;
        font-family: 'Courier New', monospace;
        text-shadow: 0 0 8px rgba(0, 255, 136, 0.5);
      }

      .re-speech-bubble.starship-comms::before {
        border-top-color: rgba(0, 50, 100, 0.9);
      }

      .re-speech-bubble.royal-academy {
        background: rgba(80, 20, 20, 0.95);
        border-color: #d4af37;
        color: #f0e6d2;
      }

      .re-speech-bubble.royal-academy::before {
        border-top-color: rgba(80, 20, 20, 0.95);
      }

      .re-bubble-meta {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 6px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .re-bubble-speaker {
        font-weight: bold;
        color: inherit;
      }

      .re-bubble-duration {
        font-size: 11px;
      }

      .re-bubble-text {
        color: inherit;
      }

      .re-bubble-audio-indicator {
        display: inline-block;
        width: 4px;
        height: 4px;
        background: #00ff88;
        border-radius: 50%;
        animation: re-pulse 1s infinite;
        margin-right: 6px;
      }

      @keyframes re-bubble-fade-in {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes re-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* Glitch effect for dramatic moments */
      .re-speech-bubble.glitch {
        animation: re-glitch 0.15s ease-in-out;
      }

      @keyframes re-glitch {
        0%, 100% { transform: translate(0); }
        20% { transform: translate(-2px, 2px); }
        40% { transform: translate(-2px, -2px); }
        60% { transform: translate(2px, 2px); }
        80% { transform: translate(2px, -2px); }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Register a character portrait
   * @param {string} charId
   * @param {string} portraitImageUrl
   */
  registerPortrait(charId, portraitImageUrl) {
    this.portraitCache.set(charId, portraitImageUrl);
  }

  /**
   * Create and display a speech bubble
   * @param {string} charId - Character ID
   * @param {string} text - Dialogue text
   * @param {object} options - Display options
   *   - position: {x, y} screen coordinates
   *   - duration: milliseconds to show
   *   - genre: 'starship-comms' | 'royal-academy' | default
   *   - portrait: image URL (optional)
   *   - synthesis: { volatility, pitch } options for TTS
   *   - glitch: boolean, add glitch effect
   */
  async displaySpeech(charId, text, options = {}) {
    const {
      position = { x: 0, y: 0 },
      duration = 3000,
      genre = 'default',
      portrait = null,
      synthesis = { volatility: 0.5, pitch: 1.0 },
      glitch = false
    } = options;

    // Queue the speech if already processing
    if (this.isProcessing.get(charId)) {
      if (!this.bubbleQueue.has(charId)) {
        this.bubbleQueue.set(charId, []);
      }
      this.bubbleQueue.get(charId).push({ text, options });
      return;
    }

    this.isProcessing.set(charId, true);

    try {
      // Create container
      const bubbleContainer = document.createElement('div');
      bubbleContainer.className = 're-speech-bubble-container';
      bubbleContainer.style.cssText = `
        left: ${position.x}px;
        top: ${position.y}px;
      `;
      bubbleContainer.id = `re-bubble-${charId}-${Date.now()}`;

      // Add portrait if available
      const portraitUrl = portrait || this.portraitCache.get(charId);
      if (portraitUrl) {
        const portraitEl = document.createElement('div');
        portraitEl.className = 're-speech-bubble-portrait';
        portraitEl.style.backgroundImage = `url('${portraitUrl}')`;
        bubbleContainer.appendChild(portraitEl);
      }

      // Create bubble element
      const bubble = document.createElement('div');
      bubble.className = `re-speech-bubble ${genre}`;
      if (glitch) bubble.classList.add('glitch');

      // Meta information
      const meta = document.createElement('div');
      meta.className = 're-bubble-meta';
      meta.innerHTML = `
        <span class="re-bubble-speaker">${charId}</span>
      `;

      // Text content
      const textEl = document.createElement('div');
      textEl.className = 're-bubble-text';
      textEl.textContent = text;

      bubble.appendChild(meta);
      bubble.appendChild(textEl);
      bubbleContainer.appendChild(bubble);

      this.container.appendChild(bubbleContainer);
      this.activeBubbles.set(charId, bubbleContainer);

      // Synthesize and play voice
      let displayDuration = duration;
      try {
        const audioBuffer = await this.voiceBridge.synthesizeVoice(
          text,
          charId,
          synthesis
        );

        // Add audio indicator
        const indicator = document.createElement('span');
        indicator.className = 're-bubble-audio-indicator';
        meta.insertBefore(indicator, meta.firstChild);

        // Play audio with effects
        const effects = genre === 'starship-comms' ? { commsFilter: true } : {};
        const source = this.voiceBridge.playVoiceWithEffects(audioBuffer, effects);

        // Update duration to match audio
        displayDuration = Math.max(audioBuffer.duration * 1000 + 500, duration);

        // Remove indicator when done
        source.onended = () => {
          if (indicator.parentNode) {
            indicator.remove();
          }
        };
      } catch (error) {
        console.warn('[SpeechBubbleSystem] Voice synthesis failed, using text-only:', error);
        // Fallback to text-only display
      }

      // Auto-remove after duration
      setTimeout(() => {
        if (bubbleContainer.parentNode) {
          bubbleContainer.remove();
        }
        this.activeBubbles.delete(charId);
        this.isProcessing.set(charId, false);

        // Process queue
        this.processQueue(charId);
      }, displayDuration);

    } catch (error) {
      console.error('[SpeechBubbleSystem] Display failed:', error);
      this.isProcessing.set(charId, false);
      this.processQueue(charId);
    }
  }

  /**
   * Process queued speech for a character
   */
  async processQueue(charId) {
    const queue = this.bubbleQueue.get(charId);
    if (queue && queue.length > 0) {
      const { text, options } = queue.shift();
      await this.displaySpeech(charId, text, options);
    }
  }

  /**
   * Update bubble position (called when Unity updates character position)
   * @param {string} charId
   * @param {object} position - {x, y} screen coordinates
   */
  updateBubblePosition(charId, position) {
    const bubble = this.activeBubbles.get(charId);
    if (bubble) {
      bubble.style.left = `${position.x}px`;
      bubble.style.top = `${position.y}px`;
    }
  }

  /**
   * Create a cinematic overlay for major events
   * Full-width, dramatic presentation with character portrait
   */
  async displayCinematicSpeech(charId, text, options = {}) {
    const {
      portraitUrl = null,
      duration = 4000,
      glitch = true
    } = options;

    // Create cinematic container
    const cinematic = document.createElement('div');
    cinematic.className = 're-cinematic-overlay';
    cinematic.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      z-index: 9999;
      animation: re-fade-in 0.5s ease-out;
    `;

    // Content container
    const content = document.createElement('div');
    content.style.cssText = `
      display: flex;
      gap: 20px;
      padding: 30px;
      width: 100%;
      max-width: 1200px;
      margin-bottom: 40px;
    `;

    // Portrait (left side)
    if (portraitUrl) {
      const portrait = document.createElement('img');
      portrait.src = portraitUrl;
      portrait.style.cssText = `
        width: 300px;
        height: 400px;
        object-fit: cover;
        border-radius: 8px;
        box-shadow: 0 0 30px rgba(255, 255, 255, 0.3);
      `;
      content.appendChild(portrait);
    }

    // Text box (right side)
    const textBox = document.createElement('div');
    textBox.style.cssText = `
      flex: 1;
      background: rgba(20, 20, 20, 0.95);
      padding: 30px;
      border-radius: 8px;
      border: 2px solid #d4af37;
      display: flex;
      flex-direction: column;
      justify-content: center;
    `;

    const speaker = document.createElement('div');
    speaker.style.cssText = `
      font-size: 20px;
      font-weight: bold;
      color: #d4af37;
      margin-bottom: 15px;
    `;
    speaker.textContent = charId;

    const message = document.createElement('div');
    message.style.cssText = `
      font-size: 18px;
      color: #f0e6d2;
      line-height: 1.6;
      white-space: pre-wrap;
    `;
    message.textContent = text;
    if (glitch) message.classList.add('glitch');

    textBox.appendChild(speaker);
    textBox.appendChild(message);
    content.appendChild(textBox);
    cinematic.appendChild(content);

    document.body.appendChild(cinematic);

    // Synthesize voice with reverb for dramatic effect
    try {
      const audioBuffer = await this.voiceBridge.synthesizeVoice(text, charId, {
        volatility: 0.3,
        pitch: 0.95
      });

      // Play with deep reverb
      const source = this.voiceBridge.playVoiceWithEffects(audioBuffer, {
        reverb: 0.8,
        volume: 1.0
      });

      const actualDuration = Math.max(audioBuffer.duration * 1000 + 1000, duration);

      // Remove after duration
      setTimeout(() => {
        cinematic.style.animation = 're-fade-out 0.5s ease-in';
        setTimeout(() => cinematic.remove(), 500);
      }, actualDuration);
    } catch (error) {
      console.error('[SpeechBubbleSystem] Cinematic synthesis failed:', error);
      setTimeout(() => cinematic.remove(), duration);
    }
  }

  /**
   * Clear all active bubbles
   */
  clearAll() {
    this.activeBubbles.forEach(bubble => {
      if (bubble.parentNode) bubble.remove();
    });
    this.activeBubbles.clear();
    this.bubbleQueue.clear();
    this.isProcessing.clear();
  }

  /**
   * Get list of active bubble character IDs
   */
  getActiveSpeakers() {
    return Array.from(this.activeBubbles.keys());
  }
}

// Export factory function for integration with existing modules
export function createSpeechBubbleSystem(voiceBridge, container) {
  return new SpeechBubbleSystem(voiceBridge, container);
}
