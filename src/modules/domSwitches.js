import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { generateContent } from "./apiClient.js";
import { isSystemLockedOut, enforceLockoutScreen } from "./safetyScanner.js";

// ============================================================================
// STYLESHEET INJECTION (Glassmorphic Modern Dark Fantasy / Cyberpunk Theme)
// ============================================================================
const INJECTED_CSS = `
/* DOM Switch Main Container */
.ds-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 200000;
    background: radial-gradient(circle at center, rgba(10, 16, 32, 0.96) 0%, rgba(3, 5, 12, 0.99) 100%);
    display: none;
    align-items: center;
    justify-content: center;
    font-family: 'Outfit', 'Inter', system-ui, sans-serif;
    color: #f8fafc;
    user-select: none;
    overflow-y: auto;
    backdrop-filter: blur(12px);
    transition: opacity 0.3s ease;
}

.ds-container {
    width: min(840px, 94vw);
    background: rgba(15, 23, 42, 0.45);
    border: 1px solid rgba(0, 243, 255, 0.15);
    border-radius: 20px;
    box-shadow: 0 0 40px rgba(0, 243, 255, 0.08), inset 0 0 20px rgba(0, 243, 255, 0.03);
    backdrop-filter: blur(20px) saturate(1.2);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    position: relative;
    overflow: hidden;
    animation: dsReveal 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes dsReveal {
    from { opacity: 0; transform: scale(0.96) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

.ds-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 12px;
}

.ds-title {
    font-family: 'Cinzel', 'Montserrat', serif;
    font-size: 1.45em;
    font-weight: 900;
    color: #00f3ff;
    text-shadow: 0 0 15px rgba(0, 243, 255, 0.4);
    letter-spacing: 1px;
}

.ds-subtitle {
    font-size: 0.85em;
    color: #94a3b8;
    margin-top: 4px;
}

.ds-close-btn {
    background: transparent;
    border: 1px solid rgba(244, 63, 94, 0.3);
    color: #f43f5e;
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.8em;
    transition: all 0.2s;
}
.ds-close-btn:hover {
    background: rgba(244, 63, 94, 0.1);
    box-shadow: 0 0 10px rgba(244, 63, 94, 0.2);
}

/* Button & UI Tokens */
.ds-btn {
    background: linear-gradient(135deg, rgba(0, 243, 255, 0.15) 0%, rgba(0, 110, 255, 0.15) 100%);
    border: 1px solid rgba(0, 243, 255, 0.35);
    color: #00f3ff;
    padding: 10px 20px;
    border-radius: 10px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
}
.ds-btn:hover {
    background: linear-gradient(135deg, rgba(0, 243, 255, 0.25) 0%, rgba(0, 110, 255, 0.25) 100%);
    border-color: #00f3ff;
    box-shadow: 0 0 15px rgba(0, 243, 255, 0.35);
    transform: translateY(-1px);
}
.ds-btn:active {
    transform: translateY(1px);
}

/* RUNE FORGE SPECIFIC */
.rf-grid-container {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    justify-content: center;
    align-items: center;
    padding: 16px 0;
}

.rf-svg-card {
    background: rgba(8, 12, 24, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px;
    position: relative;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.rf-controls {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 260px;
    flex: 1;
}

.rf-toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
}

/* CANVAS TRACING SPECIFIC */
.canvas-wrapper {
    position: relative;
    background: #020617;
    border: 2px solid rgba(0, 243, 255, 0.2);
    border-radius: 12px;
    box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
    overflow: hidden;
}

.canvas-overlay-text {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    font-family: monospace;
    font-size: 0.85em;
    color: rgba(0, 243, 255, 0.6);
    pointer-events: none;
    text-shadow: 0 0 5px rgba(0, 243, 255, 0.4);
}

.canvas-match-score {
    position: absolute;
    bottom: 12px;
    right: 12px;
    font-weight: bold;
    font-family: monospace;
    font-size: 1.1em;
    color: #10b981;
    pointer-events: none;
    text-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
}

/* RUNIC WARD LOCK SPECIFIC */
.rw-circle-container {
    width: 320px;
    height: 320px;
    position: relative;
    margin: 0 auto;
}

.rw-node {
    position: absolute;
    width: 24px;
    height: 24px;
    background: rgba(15, 23, 42, 0.85);
    border: 2px solid rgba(0, 243, 255, 0.4);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 0 8px rgba(0, 243, 255, 0.2);
    z-index: 10;
}
.rw-node.active {
    background: #00f3ff;
    border-color: #fff;
    box-shadow: 0 0 15px #00f3ff, 0 0 30px #00f3ff;
}
.rw-node.success {
    background: #10b981;
    border-color: #fff;
    box-shadow: 0 0 15px #10b981, 0 0 30px #10b981;
}

/* APT / WORK SIMULATOR SPECIFIC */
.apt-layout {
    display: grid;
    grid-template-columns: 1fr 1.25fr;
    gap: 20px;
}

@media not all {
    .apt-layout { grid-template-columns: 1fr; }
}

.apt-desk {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.apt-station {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(0, 243, 255, 0.1);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
}

.apt-customer-card {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(203, 163, 92, 0.3);
    border-radius: 10px;
    padding: 12px;
    box-shadow: inset 0 0 15px rgba(203, 163, 92, 0.05);
}

.apt-customer-title {
    color: #e2e8f0;
    font-weight: 800;
    margin-bottom: 4px;
}

.apt-customer-ailment {
    color: #f59e0b;
    font-size: 0.9em;
    font-style: italic;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.apt-cauldron-area {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 180px;
    position: relative;
}

/* Bubbling Potion Cauldron SVG Animation */
.cauldron-liquid {
    fill: #10b981;
    transition: fill 0.8s ease;
}
.cauldron-bubble {
    animation: cauldronBubble 2s infinite ease-in-out;
}
@keyframes cauldronBubble {
    0% { transform: translateY(0) scale(0.6); opacity: 0; }
    50% { opacity: 0.8; }
    100% { transform: translateY(-35px) scale(1.1); opacity: 0; }
}

.apt-shelf {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 8px;
    background: rgba(255,255,255,0.02);
    border-radius: 8px;
    padding: 8px;
}

.apt-ingredient {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 4px;
    text-align: center;
    cursor: grab;
    font-size: 0.75em;
    font-weight: bold;
    color: #cbd5e1;
    transition: all 0.2s;
}
.apt-ingredient:hover {
    border-color: #00f3ff;
    background: rgba(0, 243, 255, 0.08);
    transform: translateY(-1px);
}
.apt-ingredient:active {
    cursor: grabbing;
}

/* HACKING TERMINAL SPECIFIC */
.term-screen {
    background: #022c22;
    border: 3px solid #047857;
    border-radius: 10px;
    padding: 16px;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.9em;
    color: #10b981;
    box-shadow: 0 0 30px rgba(4, 120, 87, 0.25), inset 0 0 20px rgba(2, 44, 34, 0.9);
    position: relative;
    overflow: hidden;
}

/* Scanline and CRT flickering effects */
.term-screen::before {
    content: " ";
    display: block;
    position: absolute;
    top: 0; left: 0; bottom: 0; right: 0;
    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
    z-index: 2;
    background-size: 100% 4px, 6px 100%;
    pointer-events: none;
}
.term-scanline {
    width: 100%;
    height: 100px;
    background: linear-gradient(to bottom, rgba(16, 185, 129, 0), rgba(16, 185, 129, 0.08) 50%, rgba(16, 185, 129, 0));
    position: absolute;
    top: -100px; left: 0;
    animation: scanlineScroll 6s linear infinite;
    pointer-events: none;
    z-index: 3;
}
@keyframes scanlineScroll {
    0% { top: -100px; }
    100% { top: 100%; }
}

.term-history {
    height: 160px;
    overflow-y: auto;
    border-bottom: 1px dashed #047857;
    padding-bottom: 10px;
    margin-bottom: 10px;
}

.term-history-row {
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
}

.term-keyboard {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
    margin-top: 10px;
}

.term-key {
    background: rgba(4, 120, 87, 0.12);
    border: 1px solid #047857;
    color: #10b981;
    padding: 10px 4px;
    text-align: center;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 900;
    font-size: 1.25em;
    transition: all 0.2s;
}
.term-key:hover {
    background: #047857;
    color: #fff;
    box-shadow: 0 0 10px #10b981;
}

/* VIBRATION SHAKE FOR TRAUMA */
.ds-shake {
    animation: dsShake 0.4s forwards ease-in-out;
}
@keyframes dsShake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
    20%, 40%, 60%, 80% { transform: translateX(6px); }
}
`;

// Inject standard stylesheet
if (typeof document !== "undefined") {
    const style = document.createElement("style");
    style.id = "re-dom-switches-css";
    style.textContent = INJECTED_CSS;
    document.head.appendChild(style);
}

// Helper: Haptic Vibration Trigger
function vibrate(type = "success") {
    try {
        if (navigator.vibrate) {
            if (type === "success") navigator.vibrate([40, 30, 40]);
            else if (type === "error") navigator.vibrate([150, 50, 150]);
            else if (type === "click") navigator.vibrate(15);
        }
    } catch (_) {}
}

// Helper: submit outcome message back to AI narrative
function submitOutcomeToAi(minigameName, outcome, detailString) {
    const s = getSettings();
    const isSuccess = outcome === "success";
    const text = `[System: Player completed the "${minigameName}" DOM Switch minigame with status "${outcome}". Detail: ${detailString}. Proceed with the narrative based on this result.]`;
    
    // Type into the message forms
    const stInput = document.getElementById("send_textarea") || document.getElementById("re-input-bar");
    if (stInput) {
        stInput.value = text;
        stInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    
    // Click send
    const stSend = document.getElementById("send_but") || document.querySelector("[data-action='send']");
    if (stSend) {
        setTimeout(() => {
            stSend.click();
        }, 300);
    }
}


// ============================================================================
// 1. PROCEDURAL RUNE FORGE MINIGAME
// ============================================================================
export class RuneForge {
    constructor(parent) {
        this.parent = parent;
        this.gridSize = 3;
        this.nodes = []; // 3x3 coords
        this.pathIndices = [];
        this.symmetry = true;
        this.animated = true;
    }

    init(container, data = {}) {
        this.symmetry = data.symmetry !== false;
        container.innerHTML = `
            <div class="ds-title">PROCEDURAL RUNE FORGE</div>
            <div class="ds-subtitle">Connect nodes grid elements to synthesize a magical rune sequence.</div>
            
            <div class="rf-grid-container">
                <div class="rf-svg-card">
                    <svg id="rf-svg" width="220" height="220" viewBox="0 0 200 200" style="background:#030712; border-radius:10px; box-shadow:inset 0 0 15px rgba(0,0,0,0.85); overflow:visible;">
                        <defs>
                            <filter id="glow-forge" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="5" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <!-- Grid Node Shadows -->
                        <g id="rf-node-group"></g>
                        <!-- Main drawing paths -->
                        <path id="rf-rune-path" d="" fill="none" stroke="#00f3ff" stroke-width="5" stroke-linecap="round" filter="url(#glow-forge)" style="stroke-dasharray: 1000; stroke-dashoffset: 1000; transition: stroke-dashoffset 2s ease-in-out;" />
                        <g id="rf-mirrored-group" style="display:none;">
                            <use href="#rf-rune-path" transform="translate(200, 0) scale(-1, 1)" />
                        </g>
                    </svg>
                </div>
                
                <div class="rf-controls">
                    <label class="rf-toggle-row">
                        <input type="checkbox" id="rf-sym-toggle" ${this.symmetry ? "checked" : ""}>
                        <span>Enable Symmetry Reflections</span>
                    </label>
                    <div style="margin-top:10px; font-size:0.85em; color:#64748b; line-height:1.45;">
                        Continuous paths are generated algorithmically using a 3x3 coordinate map. Toggle symmetry to inject reflective transforms.
                    </div>
                    <button class="ds-btn" id="rf-generate-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Synthesize Rune</button>
                    <button class="ds-btn" id="rf-forge-btn" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%); border-color: #10b981; color: #10b981;"><i class="fa-solid fa-hammer"></i> Forge & Lock Rune</button>
                </div>
            </div>
        `;

        // Bind events
        container.querySelector("#rf-sym-toggle").addEventListener("change", (e) => {
            this.symmetry = e.target.checked;
            this.updateRuneDisplay();
        });

        container.querySelector("#rf-generate-btn").addEventListener("click", () => {
            vibrate("click");
            this.generateRandomPath();
            this.updateRuneDisplay();
        });

        container.querySelector("#rf-forge-btn").addEventListener("click", () => {
            vibrate("success");
            const seqStr = JSON.stringify(this.pathIndices);
            notify("success", "Rune forged successfully!", "Rune Forge");
            this.parent.close("success", `Rune forged with sequence index path ${seqStr} (Symmetry: ${this.symmetry})`);
        });

        // Initial Generation
        this.generateRandomPath();
        this.updateRuneDisplay();
    }

    generateRandomPath() {
        // Build 3x3 coordinates: node 0 at top-left, 8 at bottom-right
        this.pathIndices = [];
        let visited = new Set();
        
        // Pick random starting column: if symmetry, start in center or left
        let startCol = this.symmetry ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3);
        let startRow = Math.floor(Math.random() * 3);
        let current = startRow * 3 + startCol;

        this.pathIndices.push(current);
        visited.add(current);

        const length = 5 + Math.floor(Math.random() * 2); // 5-6 points
        for (let i = 0; i < length; i++) {
            let row = Math.floor(current / 3);
            let col = current % 3;

            // Neighbors
            let neighbors = [];
            let offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
            for (let [dr, dc] of offsets) {
                let nr = row + dr;
                let nc = col + dc;
                if (nr >= 0 && nr < 3 && nc >= 0 && nc < (this.symmetry ? 2 : 3)) {
                    let idx = nr * 3 + nc;
                    if (!visited.has(idx)) neighbors.push(idx);
                }
            }

            if (neighbors.length === 0) break; // Trapped
            let next = neighbors[Math.floor(Math.random() * neighbors.length)];
            this.pathIndices.push(next);
            visited.add(next);
            current = next;
        }
    }

    updateRuneDisplay() {
        const svg = document.getElementById("rf-svg");
        const path = document.getElementById("rf-rune-path");
        const nodeGroup = document.getElementById("rf-node-group");
        const mirrorG = document.getElementById("rf-mirrored-group");

        if (!svg || !path) return;

        // Render virtual 3x3 dots
        let nodesHtml = "";
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < (this.symmetry ? 2 : 3); c++) {
                let cx = c * 70 + 30;
                let cy = r * 70 + 30;
                nodesHtml += `<circle cx="${cx}" cy="${cy}" r="3" fill="rgba(255,255,255,0.15)" />`;
            }
        }
        nodeGroup.innerHTML = nodesHtml;

        // Form Path
        if (this.pathIndices.length < 2) return;
        
        let pathD = "";
        this.pathIndices.forEach((idx, i) => {
            let row = Math.floor(idx / 3);
            let col = idx % 3;
            let cx = col * 70 + 30;
            let cy = row * 70 + 30;
            if (i === 0) pathD += `M ${cx} ${cy}`;
            else pathD += ` L ${cx} ${cy}`;
        });

        // Set path content
        path.setAttribute("d", pathD);
        
        // Reset and trigger draw animation
        path.style.strokeDashoffset = "1000";
        void path.offsetWidth; // Force reflow
        path.style.strokeDashoffset = "0";

        // Mirror display
        if (this.symmetry) {
            mirrorG.style.display = "block";
            // Set centerline visual
            nodeGroup.innerHTML += `<line x1="100" y1="10" x2="100" y2="190" stroke="rgba(0, 243, 255, 0.08)" stroke-dasharray="4,4" />`;
            // Render third column (mirrored visuals)
            for (let r = 0; r < 3; r++) {
                nodeGroup.innerHTML += `<circle cx="170" cy="${r * 70 + 30}" r="3" fill="rgba(255,255,255,0.15)" />`;
            }
        } else {
            mirrorG.style.display = "none";
        }
    }
}


// ============================================================================
// 2. FREEHAND SPELL TRACING CANVAS MINIGAME
// ============================================================================
export class SpellCanvas {
    constructor(parent) {
        this.parent = parent;
        this.canvas = null;
        this.ctx = null;
        this.drawing = false;
        this.userPoints = [];
        this.targetPath = []; // 3x3 node template coordinates mapped to screen
        this.targetSequence = [];
        this.thresholdScore = 70;
    }

    init(container, data = {}) {
        // Pre-generate a target sequence
        this.targetSequence = data.sequence || [0, 4, 8, 7, 3, 1]; // Def star-like shape
        this.thresholdScore = data.threshold || 70;

        container.innerHTML = `
            <div class="ds-title">FREEHAND SPELL CANVAS</div>
            <div class="ds-subtitle">Trace the glowing rune outline with absolute accuracy to cast the spell.</div>
            
            <div style="display:flex; justify-content:center; margin:15px 0;">
                <div class="canvas-wrapper">
                    <div class="canvas-overlay-text">TRACE THE PATTERN</div>
                    <div class="canvas-match-score" id="sc-score-box">0% MATCH</div>
                    <canvas id="sc-canvas" width="300" height="300" style="touch-action:none; display:block; cursor:crosshair;"></canvas>
                </div>
            </div>
            
            <div style="display:flex; justify-content:center; gap:16px;">
                <button class="ds-btn" id="sc-clear-btn" style="border-color:rgba(255,255,255,0.2); color:#cbd5e1; background:transparent;"><i class="fa-solid fa-eraser"></i> Clear Canvas</button>
                <button class="ds-btn" id="sc-cast-btn" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%); border-color: #10b981; color: #10b981;"><i class="fa-solid fa-fire-sparkles"></i> Cast Spell</button>
            </div>
        `;

        this.canvas = container.querySelector("#sc-canvas");
        this.ctx = this.canvas.getContext("2d");

        // Map sequence to pixel coordinates
        this.targetPath = this.targetSequence.map(idx => {
            let row = Math.floor(idx / 3);
            let col = idx % 3;
            return {
                x: col * 90 + 60,
                y: row * 90 + 60
            };
        });

        // Set up pointer event bindings
        this.canvas.addEventListener("pointerdown", (e) => this.startDrawing(e));
        this.canvas.addEventListener("pointermove", (e) => this.draw(e));
        this.canvas.addEventListener("pointerup", (e) => this.stopDrawing(e));
        this.canvas.addEventListener("pointerleave", (e) => this.stopDrawing(e));

        container.querySelector("#sc-clear-btn").addEventListener("click", () => {
            vibrate("click");
            this.clear();
        });

        container.querySelector("#sc-cast-btn").addEventListener("click", () => {
            this.submitCast();
        });

        this.clear();
    }

    clear() {
        this.userPoints = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        document.getElementById("sc-score-box").textContent = "0% MATCH";
        document.getElementById("sc-score-box").style.color = "#94a3b8";

        // Draw ghost outline of the target rune
        this.ctx.lineWidth = 14;
        this.ctx.strokeStyle = "rgba(0, 243, 255, 0.08)";
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.beginPath();
        this.targetPath.forEach((pt, i) => {
            if (i === 0) this.ctx.moveTo(pt.x, pt.y);
            else this.ctx.lineTo(pt.x, pt.y);
        });
        this.ctx.stroke();

        // Target dots
        this.ctx.fillStyle = "rgba(0, 243, 255, 0.2)";
        this.targetPath.forEach(pt => {
            this.ctx.beginPath();
            this.ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    startDrawing(e) {
        e.preventDefault();
        e.stopPropagation();
        this.drawing = true;
        this.userPoints = [];
        const rect = this.canvas.getBoundingClientRect();
        const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.userPoints.push(pt);
        vibrate("click");
    }

    draw(e) {
        if (!this.drawing) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Distance Optimization: avoid saving thousands of redundant dots
        const last = this.userPoints[this.userPoints.length - 1];
        if (last && Math.hypot(x - last.x, y - last.y) < 5) return;

        this.userPoints.push({ x, y });

        // Redraw user drawing in real-time
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.clear(); // Redraw ghost in background

        this.ctx.lineWidth = 6;
        this.ctx.strokeStyle = "#00f3ff";
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = "#00f3ff";
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";

        this.ctx.beginPath();
        this.userPoints.forEach((pt, i) => {
            if (i === 0) this.ctx.moveTo(pt.x, pt.y);
            else this.ctx.lineTo(pt.x, pt.y);
        });
        this.ctx.stroke();

        // Clear shadow settings for subsequent operations
        this.ctx.shadowBlur = 0;

        // Perform fast preview matcher
        if (this.userPoints.length > 5) {
            const score = this.calculateMatchingScore();
            const box = document.getElementById("sc-score-box");
            if (box) {
                box.textContent = `${score}% MATCH`;
                if (score >= this.thresholdScore) box.style.color = "#10b981";
                else box.style.color = "#f59e0b";
            }
        }
    }

    stopDrawing(e) {
        if (!this.drawing) return;
        this.drawing = false;
    }

    // $1 Shape Matcher (Resampler & Distance Engine)
    calculateMatchingScore() {
        if (this.userPoints.length < 5 || this.targetPath.length < 2) return 0;

        // 1. Linearly resample both path arrays to exactly 32 points
        const uResampled = this.resample(this.userPoints, 32);
        const tResampled = this.resample(this.targetPath, 32);

        // 2. Scale both structures to fit inside 100x100 box
        const uScaled = this.scaleToBoundingBox(uResampled, 100);
        const tScaled = this.scaleToBoundingBox(tResampled, 100);

        // 3. Center both sets so center of mass is at (0,0)
        const uCentered = this.centerOfMass(uScaled);
        const tCentered = this.centerOfMass(tScaled);

        // 4. Calculate average distance (supports drawing forward and backward)
        let totalDistNormal = 0;
        let totalDistReverse = 0;
        for (let i = 0; i < 32; i++) {
            const pU = uCentered[i];
            const pT = tCentered[i];
            const pTRev = tCentered[31 - i];

            totalDistNormal += Math.hypot(pU.x - pT.x, pU.y - pT.y);
            totalDistReverse += Math.hypot(pU.x - pTRev.x, pU.y - pTRev.y);
        }

        const avgDist = Math.min(totalDistNormal, totalDistReverse) / 32;

        // 5. Score translation
        const score = Math.max(0, Math.min(100, Math.round(100 - avgDist * 1.8)));
        return score;
    }

    resample(points, targetCount) {
        if (points.length === 0) return [];
        let totalLength = 0;
        for (let i = 1; i < points.length; i++) {
            totalLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        }

        const interval = totalLength / (targetCount - 1);
        let D = 0;
        const resampled = [Object.assign({}, points[0])];

        let i = 1;
        while (i < points.length) {
            const p1 = points[i - 1];
            const p2 = points[i];
            const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);

            if (D + d >= interval) {
                const t = (interval - D) / d;
                const qx = p1.x + t * (p2.x - p1.x);
                const qy = p1.y + t * (p2.y - p1.y);
                const q = { x: qx, y: qy };
                resampled.push(q);
                points.splice(i, 0, q); // Insert dynamic interpolation point
                D = 0;
            } else {
                D += d;
            }
            i++;
        }

        while (resampled.length < targetCount) {
            resampled.push(Object.assign({}, points[points.length - 1]));
        }
        return resampled;
    }

    scaleToBoundingBox(points, size) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        points.forEach(pt => {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
        });

        const width = maxX - minX || 1;
        const height = maxY - minY || 1;

        return points.map(pt => ({
            x: ((pt.x - minX) / width) * size,
            y: ((pt.y - minY) / height) * size
        }));
    }

    centerOfMass(points) {
        let sumX = 0, sumY = 0;
        points.forEach(pt => { sumX += pt.x; sumY += pt.y; });
        const cx = sumX / points.length;
        const cy = sumY / points.length;

        return points.map(pt => ({
            x: pt.x - cx,
            y: pt.y - cy
        }));
    }

    submitCast() {
        const score = this.calculateMatchingScore();
        if (score >= this.thresholdScore) {
            vibrate("success");
            notify("success", "Spell drawing matched!", "Spell Tracing");
            this.parent.close("success", `Spell successfully casted with a tracing matching score of ${score}%`);
        } else {
            vibrate("error");
            notify("error", `Tracing score of ${score}% too low. Clear and retry!`, "Spell Tracing");
            this.parent.shake();
        }
    }
}


// ============================================================================
// 3. RUNIC WARD CIRCULAR PATTERN LOCK MINIGAME
// ============================================================================
export class RunicWardLock {
    constructor(parent) {
        this.parent = parent;
        this.nodes = [];
        this.secretSequence = [];
        this.currentSequence = [];
        this.dragging = false;
        this.canvas = null;
        this.ctx = null;
        this.lastX = 0;
        this.lastY = 0;
    }

    init(container, data = {}) {
        this.secretSequence = data.sequence || [0, 2, 4, 1, 3]; // Default: 5-point star
        this.currentSequence = [];
        this.dragging = false;

        container.innerHTML = `
            <div class="ds-title">RUNIC WARD LOCK</div>
            <div class="ds-subtitle">Connect the glowing nodes in the correct pattern sequence to override the security seal.</div>
            <div id="rw-pattern-hint" style="text-align:center; font-family:monospace; color:#00f3ff; margin-bottom:12px; font-weight:bold; letter-spacing:1.5px;">SECRET PATTERN WARD</div>
            
            <div style="position:relative; width:340px; height:340px; margin:0 auto;">
                <canvas id="rw-canvas" width="340" height="340" style="position:absolute; inset:0; pointer-events:none; z-index:5;"></canvas>
                <div class="rw-circle-container" id="rw-nodes-container"></div>
            </div>
            
            <div style="text-align:center; color:#64748b; font-size:0.82em; margin-top:10px;">
                Pointer down on the first node and drag across elements in order without premature release.
            </div>
        `;

        this.canvas = container.querySelector("#rw-canvas");
        this.ctx = this.canvas.getContext("2d");
        const nodesContainer = container.querySelector("#rw-nodes-container");

        // Trigonometric Circle Arrangement
        const count = 8; // 8 circular nodes
        this.nodes = [];
        const radius = 120; // radial size
        const cx = 160;
        const cy = 160;

        for (let i = 0; i < count; i++) {
            const angle = (i * 2 * Math.PI) / count - Math.PI / 2; // offset to top
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);

            const div = document.createElement("div");
            div.className = "rw-node";
            div.style.left = `${x}px`;
            div.style.top = `${y}px`;
            div.dataset.nodeIndex = String(i);
            nodesContainer.appendChild(div);

            this.nodes.push({ x, y, el: div, index: i });
        }

        // Display pattern hint in the UI
        const hintText = this.secretSequence.join(" ➔ ");
        container.querySelector("#rw-pattern-hint").textContent = `KEY: ${hintText}`;

        // Pointer event mapping on NODES
        nodesContainer.addEventListener("pointerdown", (e) => {
            const nodeEl = e.target.closest(".rw-node");
            if (!nodeEl) return;
            e.preventDefault();
            
            const idx = parseInt(nodeEl.dataset.nodeIndex, 10);
            this.startConnection(idx, e);
        });

        document.addEventListener("pointermove", this.handlePointerMove = (e) => {
            if (!this.dragging) return;
            const rect = this.canvas.getBoundingClientRect();
            this.lastX = e.clientX - rect.left;
            this.lastY = e.clientY - rect.top;
            
            this.checkSweepCollisions();
            this.drawPattern();
        });

        document.addEventListener("pointerup", this.handlePointerUp = (e) => {
            if (!this.dragging) return;
            this.dragging = false;
            this.finishConnection();
        });
    }

    startConnection(idx, e) {
        // Must start with the first node in sequence
        if (idx !== this.secretSequence[0]) {
            vibrate("error");
            this.flashError();
            return;
        }

        this.dragging = true;
        this.currentSequence = [idx];
        vibrate("click");

        const node = this.nodes[idx];
        node.el.classList.add("active");

        const rect = this.canvas.getBoundingClientRect();
        this.lastX = e.clientX - rect.left;
        this.lastY = e.clientY - rect.top;

        this.drawPattern();
    }

    checkSweepCollisions() {
        const sweepRadius = 25; // collision detection box
        for (let node of this.nodes) {
            const dist = Math.hypot(this.lastX - node.x, this.lastY - node.y);
            if (dist < sweepRadius) {
                const idx = node.index;
                
                // If already in sequence, check if we're backing up or just holding
                if (this.currentSequence.includes(idx)) {
                    continue;
                }

                // Verify order rule
                const nextTargetIdx = this.secretSequence[this.currentSequence.length];
                if (idx === nextTargetIdx) {
                    // Correct step
                    this.currentSequence.push(idx);
                    node.el.classList.add("active");
                    vibrate("click");
                    
                    // Simple synth audio vibe or chimes
                    try {
                        const a = new Audio();
                        a.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA=="; // clean stub
                        a.play().catch(() => {});
                    } catch (_) {}

                    if (this.currentSequence.length === this.secretSequence.length) {
                        this.dragging = false;
                        this.finishConnection();
                    }
                } else {
                    // Incorrect node crossed
                    this.dragging = false;
                    vibrate("error");
                    this.flashError();
                }
                break;
            }
        }
    }

    drawPattern() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.currentSequence.length === 0) return;

        // Configure glowing cyan brush
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = "#00f3ff";
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = "#00f3ff";
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";

        this.ctx.beginPath();
        this.currentSequence.forEach((nodeIdx, i) => {
            const node = this.nodes[nodeIdx];
            if (i === 0) this.ctx.moveTo(node.x, node.y);
            else this.ctx.lineTo(node.x, node.y);
        });

        // Line to cursor
        if (this.dragging) {
            this.ctx.lineTo(this.lastX, this.lastY);
        }
        this.ctx.stroke();

        this.ctx.shadowBlur = 0;
    }

    finishConnection() {
        if (this.currentSequence.length === this.secretSequence.length) {
            vibrate("success");
            this.nodes.forEach(n => {
                if (this.currentSequence.includes(n.index)) {
                    n.el.classList.remove("active");
                    n.el.classList.add("success");
                }
            });

            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.lineWidth = 5;
            this.ctx.strokeStyle = "#10b981";
            this.ctx.beginPath();
            this.currentSequence.forEach((nodeIdx, i) => {
                const node = this.nodes[nodeIdx];
                if (i === 0) this.ctx.moveTo(node.x, node.y);
                else this.ctx.lineTo(node.x, node.y);
            });
            this.ctx.stroke();

            setTimeout(() => {
                notify("success", "Ward Lock disengaged!", "Runic Ward");
                this.parent.close("success", `Door bypassed: successfully solved lock pattern ${JSON.stringify(this.currentSequence)}`);
            }, 500);
        } else {
            this.flashError();
        }
    }

    flashError() {
        this.parent.shake();
        this.currentSequence = [];
        this.nodes.forEach(n => {
            n.el.classList.remove("active", "success");
            n.el.style.borderColor = "#f43f5e";
            n.el.style.boxShadow = "0 0 15px #f43f5e";
        });
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        setTimeout(() => {
            this.nodes.forEach(n => {
                n.el.style.borderColor = "";
                n.el.style.boxShadow = "";
            });
        }, 600);
    }

    destroy() {
        document.removeEventListener("pointermove", this.handlePointerMove);
        document.removeEventListener("pointerup", this.handlePointerUp);
    }
}


// ============================================================================
// 4. DYNAMIC CONTEXTUAL SHIFT/WORK/SCHOOL SIMULATOR
// ============================================================================
export class ContextualShiftSimulator {
    constructor(parent) {
        this.parent = parent;
        this.selectedIngredients = [];
        this.customerData = null;
        this.themeData = null;
        this.shelfItems = [];
        this.activeTheme = "fantasy_alchemy"; // fallbacks
    }

    async init(container, data = {}) {
        container.innerHTML = `
            <div class="ds-title" id="apt-title-box">WORK SHIFT SIMULATOR</div>
            <div class="ds-subtitle" id="apt-subtitle-box">Evaluating environment chat logs and lore data to prepare your shift...</div>
            <div id="apt-loading" style="text-align:center; padding: 40px; color:#00f3ff; font-weight:bold; letter-spacing:1px; animation: pulse 1.5s infinite;">
                <i class="fa-solid fa-arrows-spin fa-spin"></i> QUERYING LORE & WORLD STATS...
            </div>
            <div class="apt-layout" id="apt-grid-layout" style="display:none;">
                <!-- Left Desk: Customer Card -->
                <div class="apt-desk">
                    <div style="font-size:0.95em; font-weight:800; color:#cba35c; text-shadow:0 0 10px rgba(203,163,92,0.35);">CLIENT ENTRANCE</div>
                    <div class="apt-customer-card">
                        <div class="apt-customer-title" id="apt-c-name">Loading...</div>
                        <div style="font-size:0.75em; opacity:0.6; margin-top:2px;" id="apt-c-role">Species / Role</div>
                        <div style="margin-top:10px; font-size:0.88em; line-height:1.4; color:#cbd5e1;" id="apt-c-desc">Description of client details...</div>
                        <div class="apt-customer-ailment" id="apt-c-task"><strong>Request:</strong> Ailment task</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.05); padding:10px; border-radius:8px; font-size:0.8em; line-height:1.45; color:#64748b;">
                        Drag and drop exactly two materials into the processor core on the right, then serve to process.
                    </div>
                </div>

                <!-- Right Station: Cauldron Core & Shelf -->
                <div class="apt-station">
                    <div style="font-size:0.95em; font-weight:800; color:#00f3ff; text-shadow:0 0 10px rgba(0,243,255,0.35);" id="apt-station-title">CRAFTING PROCESSOR</div>
                    
                    <div class="apt-cauldron-area" id="apt-drop-zone">
                        <svg width="140" height="140" viewBox="0 0 100 100" style="overflow:visible;">
                            <!-- Bubbles -->
                            <circle class="cauldron-bubble" cx="40" cy="50" r="4" fill="#00f3ff" style="animation-delay:0.2s;" />
                            <circle class="cauldron-bubble" cx="60" cy="50" r="5" fill="#00f3ff" style="animation-delay:0.8s;" />
                            <circle class="cauldron-bubble" cx="50" cy="55" r="3" fill="#00f3ff" style="animation-delay:1.4s;" />
                            
                            <!-- Bubbling Central Cauldron Base -->
                            <ellipse cx="50" cy="30" rx="32" ry="8" class="cauldron-liquid" id="cauldron-top-liquid" />
                            <path d="M 18 30 C 18 55 24 75 50 75 C 76 75 82 55 82 30" fill="#1e293b" stroke="#334155" stroke-width="4" />
                            <path d="M 15 30 L 85 30 C 88 30 88 24 85 24 L 15 24 C 12 24 12 30 15 30" fill="#334155" />
                        </svg>
                        <div style="position:absolute; bottom:12px; font-family:monospace; font-size:0.78em; color:rgba(255,255,255,0.4);" id="apt-status-liquid">CORE: EMPTY</div>
                    </div>

                    <div style="font-size:0.85em; font-weight:bold; color:#cbd5e1;">INVENTORY REAGENTS Shelf</div>
                    <div class="apt-shelf" id="apt-shelf-items"></div>
                    
                    <button class="ds-btn" id="apt-serve-btn" style="width:100%; display:none; background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6) 100%); border-color: #f59e0b; color: #fff;"></button>
                </div>
            </div>
        `;

        await this.queryContextualSettings();
    }

    async queryContextualSettings() {
        const s = getSettings();
        const loc = s.worldState?.location || "Unknown location";
        const charStats = JSON.stringify(s.character?.stats || {});
        
        // Grab recent messages for rich prompt compilation
        let recentChat = "";
        try {
            const chatNodes = Array.from(document.querySelectorAll("#chat .mes")).slice(-12);
            recentChat = chatNodes.map(m => {
                const name = m.querySelector(".mes_name")?.textContent || "Story";
                const txt = m.querySelector(".mes_text")?.textContent || "";
                return `${name}: ${txt}`;
            }).join("\n");
        } catch (_) {}

        const promptText = `
We are building a highly context-aware Work/School/Shift simulator minigame inside an RPG.
Read the following current game context carefully:
- Location: "${loc}"
- Character Stats: ${charStats}
- Recent Narrative Chat Log Context:
${recentChat}

Generate a matching, setting-appropriate work, school, or craft shift scenario in raw JSON format.
Rules based on time period and setting:
1. If the setting is modern slice-of-life/school, make the customer a teacher, classmate, or cafe boss, and make the items related (e.g. test tubes, chemicals, coffee grind, papers).
2. If the setting is sci-fi/starship, make it engine core repairs, using tools (hydrospanner, solder, wire, copper).
3. If it's classic fantasy, make it magical potion shop brewing (Dragon Scale, Nightshade, Cauldron).
4. Adapt seamlessly to ANY other context shown in the chat logs!

Return ONLY a valid JSON object matching this structure:
{
  "theme_id": "fantasy_alchemy" or "modern_school" or "sci_fi" or "modern_cafe" or "generic_office",
  "workstation_title": "Espresso Machine Core" or "Bunsen Burner Area" or "Bubbling Cauldron",
  "liquid_color": "hex color code representing the central workstation liquid/energy (e.g. #7c3aed, #f59e0b, #06b6d4)",
  "customer_name": "Lord Grimbald" or "Teacher Tanaka" or "Chief Briggs",
  "customer_role": "Fussy Gargoyle Noble" or "Strict Chemistry Professor" or "Starship Chief Engineer",
  "customer_description": "A brief description of their mood, details, or dialogue.",
  "request_task": "Their specific order or problem they need solved (e.g., 'Requires an energy latte with vanilla', 'Needs a Potion of Squeak Cure', 'Needs to repair the coolant system').",
  "shelf_items": ["Array of exactly 5 appropriate materials or ingredients"],
  "action_button_label": "Serve potion" or "Deliver latte" or "Execute repair"
}
`;

        try {
            const rawRes = await generateContent(promptText, { max_tokens: 800 });
            // Clean markdown blocks
            const cleaned = String(rawRes || "").replace(/```json|```/gi, "").trim();
            const dataObj = JSON.parse(cleaned);

            this.customerData = dataObj;
            this.shelfItems = dataObj.shelf_items || ["Material A", "Material B", "Material C", "Material D", "Material E"];
            this.activeTheme = dataObj.theme_id || "fantasy_alchemy";
            
            this.renderDynamicUi();
        } catch (e) {
            console.warn("[UIE] LLM setup query failed. Falling back to local procedural apothecary.", e);
            // Graceful fallback
            this.customerData = {
                theme_id: "fantasy_alchemy",
                workstation_title: "BUBBLING ALCHEMY CAULDRON",
                liquid_color: "#10b981",
                customer_name: "Gimli Broadaxe",
                customer_role: "Dwarven Miner",
                customer_description: "Exhausted from working 14 hours straight in the mithril mines. His back is aching horribly.",
                request_task: "Needs a high-end stamina healing potion that does not taste like mud.",
                shelf_items: ["Dragon Scale", "Phoenix Feather", "Nightshade", "Mermaid Tears", "Glowshroom"],
                action_button_label: "Serve Healing Brew"
            };
            this.shelfItems = this.customerData.shelf_items;
            this.activeTheme = "fantasy_alchemy";
            
            this.renderDynamicUi();
        }
    }

    renderDynamicUi() {
        const container = this.parent.modalOverlay;
        const grid = container.querySelector("#apt-grid-layout");
        const loading = container.querySelector("#apt-loading");

        if (!grid || !loading) return;

        loading.style.display = "none";
        grid.style.display = "grid";

        // Update fields
        container.querySelector("#apt-title-box").textContent = `SHIFT: ${this.customerData.workstation_title.toUpperCase()}`;
        container.querySelector("#apt-subtitle-box").textContent = `Location Context: ${getSettings().worldState?.location || "RPG Stage"}`;
        
        container.querySelector("#apt-c-name").textContent = this.customerData.customer_name;
        container.querySelector("#apt-c-role").textContent = this.customerData.customer_role;
        container.querySelector("#apt-c-desc").textContent = this.customerData.customer_description;
        container.querySelector("#apt-c-task").innerHTML = `<strong>Request Task:</strong> ${this.customerData.request_task}`;
        container.querySelector("#apt-station-title").textContent = this.customerData.workstation_title;

        // Colors
        const liquid = container.querySelector("#cauldron-top-liquid");
        const bubble = container.querySelectorAll(".cauldron-bubble");
        if (liquid) {
            liquid.style.fill = this.customerData.liquid_color || "#10b981";
        }
        bubble.forEach(b => {
            b.style.fill = this.customerData.liquid_color || "#10b981";
        });

        // Servings button
        const serveBtn = container.querySelector("#apt-serve-btn");
        serveBtn.textContent = this.customerData.action_button_label;
        serveBtn.addEventListener("click", () => this.submitServe());

        // Ingredients
        const shelf = container.querySelector("#apt-shelf-items");
        shelf.innerHTML = "";
        this.shelfItems.forEach((item, idx) => {
            const div = document.createElement("div");
            div.className = "apt-ingredient";
            div.draggable = true;
            div.textContent = item;
            div.dataset.index = String(idx);
            
            // Drag listeners
            div.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", item);
                vibrate("click");
            });

            // Mobile compatibility: fallback pointer down trigger for tapping elements to select
            div.addEventListener("pointerdown", () => {
                this.handleTapSelect(item, div);
            });

            shelf.appendChild(div);
        });

        // Drop zone
        const dropZone = container.querySelector("#apt-drop-zone");
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
        });
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            const item = e.dataTransfer.getData("text/plain");
            this.addIngredient(item);
        });
    }

    handleTapSelect(item, el) {
        // Tapping elements as a fallback for drag/drop on mobile devices
        if (this.selectedIngredients.includes(item)) return;
        el.style.borderColor = "#00f3ff";
        el.style.background = "rgba(0, 243, 255, 0.12)";
        this.addIngredient(item);
    }

    addIngredient(item) {
        if (!item) return;
        if (this.selectedIngredients.length >= 2) {
            notify("error", "The workstation core is already full!", "Simulator");
            return;
        }

        this.selectedIngredients.push(item);
        vibrate("click");

        const status = document.getElementById("apt-status-liquid");
        if (status) {
            status.textContent = `CORE: ${this.selectedIngredients.join(" + ")}`;
            status.style.color = "#00f3ff";
        }

        if (this.selectedIngredients.length === 2) {
            const serveBtn = document.getElementById("apt-serve-btn");
            if (serveBtn) serveBtn.style.display = "block";
        }
    }

    async submitServe() {
        const overlay = this.parent.modalOverlay;
        const grid = overlay.querySelector("#apt-grid-layout");
        const loading = overlay.querySelector("#apt-loading");

        grid.style.display = "none";
        loading.style.display = "block";
        loading.innerHTML = `<i class="fa-solid fa-gears fa-spin"></i> EVALUATING CHOICES WITH AI NARRATIVE...`;

        const ingredientsStr = this.selectedIngredients.join(" and ");
        const stats = JSON.stringify(getSettings().character?.stats || {});

        const evalPrompt = `
We are playing a highly context-aware Work/School/Shift simulator minigame in an RPG.
- Customer: "${this.customerData.customer_name}" (${this.customerData.customer_role})
- Ailment/Task: "${this.customerData.request_task}"
- Chosen Reagents/Ingredients Used: "${ingredientsStr}"
- Player Stats: ${stats}

Determine the outcome of this combination. Did it make sense or creatively resolve their order/task?
Write a short, immersive, creative 2-3 sentence narrative describing the customer's reaction to receiving/consuming this blend.
Then, allocate a gold/currency reward (integer, 0 to 100) based on quality.
Return ONLY a valid JSON object matching this structure:
{
  "reaction": "The detailed reaction narrative...",
  "gold_earned": 80,
  "success": true
}
`;

        try {
            const rawRes = await generateContent(evalPrompt, { max_tokens: 500 });
            const cleaned = String(rawRes || "").replace(/```json|```/gi, "").trim();
            const resObj = JSON.parse(cleaned);

            // Update stats/gold
            const s = getSettings();
            s.gold = Math.max(0, (Number(s.gold || 0) + Number(resObj.gold_earned || 0)));
            saveSettings();

            vibrate("success");
            notify("success", `Completed shift! Earned ${resObj.gold_earned} gold.`, "Simulator");

            this.parent.close("success", `Shift successfully completed serving "${ingredientsStr}". Customer reaction: "${resObj.reaction}". Earned ${resObj.gold_earned} Gold!`);
        } catch (e) {
            console.warn("[UIE] LLM evaluation failed. Falling back.", e);
            // Fallback
            const s = getSettings();
            s.gold = Math.max(0, (Number(s.gold || 0) + 50));
            saveSettings();
            
            vibrate("success");
            this.parent.close("success", `Served "${ingredientsStr}" successfully! The customer smiled, thanked you, and paid you 50 gold.`);
        }
    }
}


// ============================================================================
// 5. RETRO CYBERPUNK HACKING TERMINAL MINIGAME
// ============================================================================
export class HackingTerminal {
    constructor(parent) {
        this.parent = parent;
        this.secret = [];
        this.symbols = ["Ω", "Ψ", "Φ", "Ξ", "Λ", "Σ"];
        this.attempts = 5;
        this.currentGuess = [];
        this.history = [];
    }

    init(container, data = {}) {
        this.attempts = data.attempts || 5;
        this.currentGuess = [];
        this.history = [];
        
        // Generate random secret combination of 4 symbols
        this.secret = [];
        for (let i = 0; i < 4; i++) {
            this.secret.push(this.symbols[Math.floor(Math.random() * this.symbols.length)]);
        }

        container.innerHTML = `
            <div class="ds-title">HACKING TERMINAL v2.82</div>
            <div class="ds-subtitle">retro-cyberpunk subgrid decryption terminal. bypass security blocks.</div>
            
            <div class="term-screen">
                <div class="term-scanline"></div>
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #047857; padding-bottom:6px; margin-bottom:8px; font-weight:bold;">
                    <span>SYS OVERRIDE INTERFACE</span>
                    <span>ATTEMPTS REMAINING: <span id="term-rem-count">${this.attempts}</span></span>
                </div>
                
                <div class="term-history" id="term-history-log">
                    <!-- History rows loaded here -->
                    <div style="opacity:0.6;">&gt; INITIALIZING ENCRYPTED INTERFACE...</div>
                    <div style="opacity:0.6;">&gt; CHOOSE 4 KEYS TO FORCE DECRYPTION CYCLE...</div>
                </div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; min-height:30px;">
                    <div>&gt; CURRENT KEY DRAFT: <span id="term-guess-draft" style="font-weight:bold; letter-spacing:4px; font-size:1.2em; color:#fff;"></span></div>
                    <button class="ds-btn" id="term-submit-btn" style="display:none; background:#065f46; border-color:#047857; color:#10b981; padding:4px 10px; font-size:0.8em;"><i class="fa-solid fa-code-merge"></i> SUBMIT KEY</button>
                </div>
            </div>

            <div class="term-keyboard" id="term-keys"></div>
        `;

        // Render keyboard keys
        const keysContainer = container.querySelector("#term-keys");
        this.symbols.forEach(sym => {
            const btn = document.createElement("div");
            btn.className = "term-key";
            btn.textContent = sym;
            btn.addEventListener("click", () => this.pressKey(sym));
            keysContainer.appendChild(btn);
        });

        container.querySelector("#term-submit-btn").addEventListener("click", () => this.submitGuess());
    }

    pressKey(sym) {
        if (this.currentGuess.length >= 4) {
            vibrate("error");
            return;
        }

        vibrate("click");
        this.currentGuess.push(sym);
        
        // Update display draft
        const draft = document.getElementById("term-guess-draft");
        if (draft) {
            draft.textContent = this.currentGuess.join(" ");
        }

        if (this.currentGuess.length === 4) {
            const btn = document.getElementById("term-submit-btn");
            if (btn) btn.style.display = "block";
        }
    }

    submitGuess() {
        if (this.currentGuess.length < 4) return;

        // Evaluate Mastermind rules
        let exact = 0;
        let shifted = 0;

        const secretCopy = [...this.secret];
        const guessCopy = [...this.currentGuess];

        // 1. Check exact matches
        for (let i = 0; i < 4; i++) {
            if (guessCopy[i] === secretCopy[i]) {
                exact++;
                secretCopy[i] = null;
                guessCopy[i] = null;
            }
        }

        // 2. Check shifted matches
        for (let i = 0; i < 4; i++) {
            if (guessCopy[i] === null) continue;
            const idx = secretCopy.indexOf(guessCopy[i]);
            if (idx >= 0) {
                shifted++;
                secretCopy[idx] = null;
            }
        }

        this.attempts--;
        document.getElementById("term-rem-count").textContent = String(this.attempts);

        // Feedback String LEDs
        let leds = "";
        for (let i = 0; i < exact; i++) leds += "🟢 ";
        for (let i = 0; i < shifted; i++) leds += "🟡 ";
        while (leds.split(" ").length - 1 < 4) leds += "⚪ ";

        // Log history row
        const row = document.createElement("div");
        row.className = "term-history-row";
        row.innerHTML = `
            <span>&gt; TRYING [ ${this.currentGuess.join(" ")} ]</span>
            <span style="letter-spacing:1px;">${leds}</span>
        `;

        const log = document.getElementById("term-history-log");
        if (log) {
            log.appendChild(row);
            log.scrollTop = log.scrollHeight;
        }

        // Handle Wins / Losses
        if (exact === 4) {
            vibrate("success");
            notify("success", "Decryption override successful!", "Hacking Terminal");
            
            const winRow = document.createElement("div");
            winRow.style.color = "#10b981";
            winRow.style.fontWeight = "bold";
            winRow.textContent = ">>> ACCESS GRANTED. DECRYPTION SYSTEM BYPASS ENGAGED.";
            log.appendChild(winRow);

            setTimeout(() => {
                this.parent.close("success", `Terminal bypassed successfully! Solved secret code ${JSON.stringify(this.currentGuess)}`);
            }, 1000);
        } else if (this.attempts <= 0) {
            vibrate("error");
            this.parent.shake();
            notify("error", "Lockout engaged. Intruder alert triggered!", "Hacking Terminal");
            
            const failRow = document.createElement("div");
            failRow.style.color = "#f43f5e";
            failRow.style.fontWeight = "bold";
            failRow.textContent = ">>> DECRYPTION CYCLES DEPLETED. LOCKOUT ACTIVE.";
            log.appendChild(failRow);

            setTimeout(() => {
                this.parent.close("failure", `Decryption terminal override failed. Security lockout engaged after 5 failed attempts.`);
            }, 1000);
        } else {
            vibrate("click");
            // Clear current draft
            this.currentGuess = [];
            const draft = document.getElementById("term-guess-draft");
            if (draft) draft.textContent = "";
            const btn = document.getElementById("term-submit-btn");
            if (btn) btn.style.display = "none";
        }
    }
}


// ============================================================================
// 6. DYNAMIC AI-DRIVEN HTML/CSS MINIGAME
// ============================================================================
export class DynamicAiMinigame {
    constructor(parent) {
        this.parent = parent;
        this.timerInterval = null;
        this.timeLeft = 0;
        this.hasResolved = false;
    }

    async init(container, data = {}) {
        container.innerHTML = `
            <div class="ds-title" id="dyn-title-box">AI MINIGAME: GENERATING...</div>
            <div class="ds-subtitle" id="dyn-subtitle-box">Weaving dynamic HTML, CSS, and interaction logic matching the active scenario...</div>
            <div id="dyn-loading" style="text-align:center; padding: 40px; color:#00f3ff; font-weight:bold; letter-spacing:1px; animation: pulse 1.5s infinite;">
                <i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> CREATING COMPONENT...
            </div>
            <div id="dyn-game-host" style="display:none; position:relative; min-height: 250px;"></div>
        `;

        await this.generateGame(container, data);
    }

    async generateGame(container, data) {
        const s = getSettings();
        const loc = s.worldState?.location || "Unknown location";
        const charStats = JSON.stringify(s.character?.stats || {});
        const requestedConcept = data.concept || data.task || data.game_type || "interactive puzzle matching context";
        const requestedTime = data.time || data.seconds || data.time_limit || 0; // 0 means no time limit

        // Grab recent messages for rich prompt compilation
        let recentChat = "";
        try {
            const chatNodes = Array.from(document.querySelectorAll("#chat .mes")).slice(-10);
            recentChat = chatNodes.map(m => {
                const name = m.querySelector(".mes_name")?.textContent || "Story";
                const txt = m.querySelector(".mes_text")?.textContent || "";
                return `${name}: ${txt}`;
            }).join("\n");
        } catch (_) {}

        const promptText = `
We are building a highly context-aware, dynamically built AI Minigame.
Read the game state:
- Location: "${loc}"
- Character Stats: ${charStats}
- Recent Chat Context:
${recentChat}

We need an interactive HTML/CSS/JS minigame.
Requested minigame concept: "${requestedConcept}"
Time limit requested: ${requestedTime ? requestedTime + ' seconds' : 'None'}

Generate a fully functional, self-contained mini-application (minigame) to embed.
Guidelines:
1. The markup must be beautiful and feel premium. Use curated color palettes, elegant layout (grid/flexbox), smooth CSS transitions, hover effects. Feel free to use glassmorphism style.
2. In addition to any custom styling you define, you can target and use standard font classes or standard elements.
3. The JavaScript must be raw, inline, and self-contained. It must hook up any clicks, inputs, timers, canvas drawing, or dragging, and update the UI elements.
4. IMPORTANT: To complete the minigame, your JavaScript MUST call:
   window.resolveDynamicAiMinigame("success", "detailed string explanation of what happened")
   or
   window.resolveDynamicAiMinigame("failure", "detailed string explanation of why they failed")
5. Provide a clear goal and description to the player within the UI.
6. If a time limit is specified (${requestedTime || 'none'}), implement a visual timer or bar, and call window.resolveDynamicAiMinigame("failure", "Time ran out!") if time expires.
7. Return ONLY valid HTML (including any <style> and <script> tags). Do NOT wrap it in markdown code blocks like \`\`\`html. Start directly with the HTML tags.
`;

        try {
            if (typeof window.skipNextAiConfirmOnce === "function") window.skipNextAiConfirmOnce();
            else window.__uieSkipAiConfirmOnce = true;
            
            const rawRes = await generateContent(promptText, "Webpage");
            
            // Clean markdown code blocks if any got through
            let cleaned = String(rawRes || "").trim();
            if (cleaned.startsWith("```html")) {
                cleaned = cleaned.slice(7);
            }
            if (cleaned.endsWith("```")) {
                cleaned = cleaned.slice(0, -3);
            }
            cleaned = cleaned.trim();

            const host = container.querySelector("#dyn-game-host");
            const loading = container.querySelector("#dyn-loading");
            const titleBox = container.querySelector("#dyn-title-box");
            const subtitleBox = container.querySelector("#dyn-subtitle-box");

            if (!host || !loading) return;

            loading.style.display = "none";
            titleBox.textContent = `MINIGAME: ${requestedConcept.toUpperCase()}`;
            subtitleBox.textContent = `Context: ${loc}`;
            host.style.display = "block";

            host.innerHTML = cleaned;

            // Define resolution callback
            window.resolveDynamicAiMinigame = (outcome, detail) => {
                if (this.hasResolved) return;
                this.hasResolved = true;
                vibrate(outcome === "success" ? "success" : "error");
                notify(outcome === "success" ? "success" : "error", `Minigame: ${outcome.toUpperCase()}`, "AI Engine");
                this.parent.close(outcome, detail);
                delete window.resolveDynamicAiMinigame;
            };

            // Execute scripts inside host
            const scripts = host.querySelectorAll("script");
            scripts.forEach(oldScript => {
                const newScript = document.createElement("script");
                Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });

        } catch (e) {
            console.error("[UIE] Dynamic AI Minigame failed to compile:", e);
            this.renderFallbackGame(container, requestedConcept, requestedTime);
        }
    }

    renderFallbackGame(container, concept, timeLimit) {
        const host = container.querySelector("#dyn-game-host");
        const loading = container.querySelector("#dyn-loading");
        const titleBox = container.querySelector("#dyn-title-box");
        const subtitleBox = container.querySelector("#dyn-subtitle-box");

        if (!host || !loading) return;
        loading.style.display = "none";
        titleBox.textContent = "MINIGAME (FALLBACK)";
        subtitleBox.textContent = "AI Weave failed. Initializing standard override interface.";
        host.style.display = "block";

        const seconds = timeLimit || 30;
        this.timeLeft = seconds;

        host.innerHTML = `
            <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); padding:20px; border-radius:12px; display:flex; flex-direction:column; gap:16px;">
                <div style="font-size:1.1em; font-weight:bold; color:#ffe3a3; text-align:center;">
                    Override Task: ${concept}
                </div>
                <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                    <div id="dyn-fallback-timer-bar" style="height:100%; width:100%; background:#ef4444; transition: width 1s linear;"></div>
                </div>
                <div style="text-align:center; font-size:0.9em; color:#94a3b8;" id="dyn-fallback-timer-lbl">
                    Time remaining: ${seconds} seconds
                </div>
                
                <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    <div style="font-size:0.9em; text-align:center; color:#cbd5e1;">Tap the correct bypass nodes sequence:</div>
                    <div style="display:flex; justify-content:center; gap:12px;" id="dyn-fallback-nodes">
                        <button class="ds-btn" style="border-radius:50%; width:48px; height:48px;" data-node="1">1</button>
                        <button class="ds-btn" style="border-radius:50%; width:48px; height:48px;" data-node="2">2</button>
                        <button class="ds-btn" style="border-radius:50%; width:48px; height:48px;" data-node="3">3</button>
                        <button class="ds-btn" style="border-radius:50%; width:48px; height:48px;" data-node="4">4</button>
                    </div>
                    <div style="text-align:center; font-family:monospace; font-size:0.8em; color:#00f3ff;" id="dyn-fallback-status">SEQUENCE: []</div>
                </div>
            </div>
        `;

        const correctSequence = [
            Math.floor(Math.random() * 4) + 1,
            Math.floor(Math.random() * 4) + 1,
            Math.floor(Math.random() * 4) + 1
        ];
        
        let playerSequence = [];

        window.resolveDynamicAiMinigame = (outcome, detail) => {
            if (this.hasResolved) return;
            this.hasResolved = true;
            if (this.timerInterval) clearInterval(this.timerInterval);
            vibrate(outcome === "success" ? "success" : "error");
            notify(outcome === "success" ? "success" : "error", `Bypass: ${outcome.toUpperCase()}`, "AI Engine");
            this.parent.close(outcome, detail);
            delete window.resolveDynamicAiMinigame;
        };

        // Timer interval
        const timerBar = host.querySelector("#dyn-fallback-timer-bar");
        const timerLbl = host.querySelector("#dyn-fallback-timer-lbl");
        
        this.timerInterval = setInterval(() => {
            this.timeLeft--;
            const pct = (this.timeLeft / seconds) * 100;
            if (timerBar) timerBar.style.width = `${pct}%`;
            if (timerLbl) timerLbl.textContent = `Time remaining: ${this.timeLeft} seconds`;

            if (this.timeLeft <= 0) {
                clearInterval(this.timerInterval);
                window.resolveDynamicAiMinigame("failure", "Time limit expired before player entered sequence.");
            }
        }, 1000);

        // Nodes logic
        const buttons = host.querySelectorAll("[data-node]");
        buttons.forEach(btn => {
            btn.addEventListener("click", () => {
                const node = parseInt(btn.getAttribute("data-node"));
                playerSequence.push(node);
                vibrate("click");
                
                const status = host.querySelector("#dyn-fallback-status");
                if (status) status.textContent = `SEQUENCE: [${playerSequence.join(", ")}]`;

                // Check sequence
                for (let i = 0; i < playerSequence.length; i++) {
                    if (playerSequence[i] !== correctSequence[i]) {
                        playerSequence = [];
                        vibrate("error");
                        if (status) status.textContent = "SEQUENCE: WRONG! RESET.";
                        setTimeout(() => {
                            if (status && playerSequence.length === 0) status.textContent = "SEQUENCE: []";
                        }, 1000);
                        return;
                    }
                }

                if (playerSequence.length === correctSequence.length) {
                    window.resolveDynamicAiMinigame("success", "Correct node sequence inputted successfully.");
                }
            });
        });
    }

    destroy() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        delete window.resolveDynamicAiMinigame;
    }
}


// ============================================================================
// CENTRAL DOM SWITCH MANAGER (Orchestrator)
// ============================================================================
export class DomSwitchManager {
    constructor() {
        this.active = false;
        this.modalOverlay = null;
        this.currentGame = null;
        this.currentSwitchName = "";
    }

    init() {
        if (isSystemLockedOut()) {
            enforceLockoutScreen();
            throw new Error("System lockout active");
        }
        if (typeof document === "undefined") return;

        // Inject overlay modal if missing
        if (!document.getElementById("re-ds-modal")) {
            const overlay = document.createElement("div");
            overlay.id = "re-ds-modal";
            overlay.className = "ds-modal-overlay";
            overlay.innerHTML = `
                <div class="ds-container" id="re-ds-container">
                    <div class="ds-header">
                        <div style="display:flex; flex-direction:column;">
                            <span class="ds-title" id="re-ds-title-lbl">DOM SWITCH ENGAGED</span>
                        </div>
                        <button class="ds-close-btn" id="re-ds-abort-btn">ABORT STATE</button>
                    </div>
                    <div id="re-ds-body" style="min-height: 280px; display:flex; flex-direction:column; justify-content:center;">
                        <!-- Minigame content goes here -->
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            // Bind abort trigger
            overlay.querySelector("#re-ds-abort-btn").addEventListener("click", () => {
                vibrate("error");
                this.close("failure", "Player aborted the DOM Switch override.");
            });

            this.modalOverlay = overlay;
        }

        console.log("[UIE] Contextual DOM Switch Manager Initialized");
    }

    checkAndTrigger(rawText) {
        if (this.active) return;
        const text = String(rawText || "").trim();
        if (!text) return;

        // Try extracting JSON switch blocks
        let matchObj = null;

        // Pattern 1: Raw JSON code block
        const blockMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/i);
        if (blockMatch && blockMatch[1]) {
            try {
                const parsed = JSON.parse(blockMatch[1]);
                if (parsed && parsed.dom_switch) matchObj = parsed;
            } catch (_) {}
        }

        // Pattern 2: Inline naked curly braces
        if (!matchObj) {
            const firstBrace = text.indexOf("{");
            const lastBrace = text.lastIndexOf("}");
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                try {
                    const subStr = text.substring(firstBrace, lastBrace + 1);
                    const parsed = JSON.parse(subStr);
                    if (parsed && parsed.dom_switch) matchObj = parsed;
                } catch (_) {}
            }
        }

        if (matchObj) {
            const switchName = String(matchObj.dom_switch).toLowerCase().replace(/[^a-z0-9_]+/g, "");
            const switchData = matchObj.data || {};
            this.trigger(switchName, switchData);
        }
    }

    trigger(switchName, data = {}) {
        if (isSystemLockedOut()) {
            enforceLockoutScreen();
            throw new Error("System lockout active");
        }
        if (this.active) return;
        this.active = true;
        this.currentSwitchName = switchName;
        this.modalOverlay.style.display = "flex";
        
        // Hide VN boxes and standard chat inputs for full absorption immersion
        const vnBox = document.getElementById("re-vn-box");
        if (vnBox) vnBox.style.display = "none";
        const stComposer = document.getElementById("re-composer-wrap");
        if (stComposer) stComposer.style.display = "none";
        
        const body = this.modalOverlay.querySelector("#re-ds-body");
        body.innerHTML = "";

        // Route to the appropriate minigame engine
        switch (switchName) {
            case "procedural_rune_forge":
            case "rune_forge":
                this.currentGame = new RuneForge(this);
                break;
            case "freehand_spell_tracing":
            case "spell_tracing":
            case "spell_canvas":
                this.currentGame = new SpellCanvas(this);
                break;
            case "runic_ward_lock":
            case "runic_lock":
            case "pattern_lock":
                this.currentGame = new RunicWardLock(this);
                break;
            case "apothecary_job":
            case "apothecary":
            case "shift_simulator":
            case "work_shift":
                this.currentGame = new ContextualShiftSimulator(this);
                break;
            case "hacking_terminal":
            case "cyberpunk_hacking":
                this.currentGame = new HackingTerminal(this);
                break;
            case "ai_dynamic":
            case "dynamic_ai":
            case "ai_minigame":
            case "dynamic_minigame":
                this.currentGame = new DynamicAiMinigame(this);
                break;
            default:
                // Fallback / Unknown switch triggers a clean abort
                notify("error", `Unsupported DOM Switch requested: ${switchName}`, "Immersion Engine");
                this.close("failure", `Unsupported DOM Switch: ${switchName}`);
                return;
            }

            try {
                this.currentGame.init(body, data);
                notify("info", `DOM Switch Triggered: ${switchName}`, "Immersion Engine", "magic");
            } catch (e) {
                console.error("[UIE] Failed to initialize minigame:", switchName, e);
                this.close("failure", `Minigame initialization exception: ${e.message}`);
            }
    }

    shake() {
        const container = document.getElementById("re-ds-container");
        if (!container) return;
        container.classList.remove("ds-shake");
        void container.offsetWidth; // Force reflow
        container.classList.add("ds-shake");
        setTimeout(() => {
            if (container) container.classList.remove("ds-shake");
        }, 500);
    }

    close(outcome = "success", outcomeDetail = "") {
        if (!this.active) return;
        this.active = false;
        this.modalOverlay.style.display = "none";

        // Restore UI components
        const vnBox = document.getElementById("re-vn-box");
        if (vnBox) vnBox.style.display = "flex";
        const stComposer = document.getElementById("re-composer-wrap");
        if (stComposer) stComposer.style.display = "flex";

        // Clean up handlers
        if (this.currentGame && typeof this.currentGame.destroy === "function") {
            try { this.currentGame.destroy(); } catch (_) {}
        }

        // Post completion state back to AI narrative
        submitOutcomeToAi(this.currentSwitchName, outcome, outcomeDetail);

        this.currentGame = null;
        this.currentSwitchName = "";
    }
}

export const domSwitchManager = new DomSwitchManager();

export function initDomSwitches() {
    domSwitchManager.init();
    
    // Add simple console bypass triggers for rapid testing
    window.startRuneForge = (data = {}) => domSwitchManager.trigger("rune_forge", data);
    window.startSpellCanvas = (data = {}) => domSwitchManager.trigger("spell_canvas", data);
    window.startRunicWard = (data = {}) => domSwitchManager.trigger("runic_lock", data);
    window.startApothecary = (data = {}) => domSwitchManager.trigger("apothecary", data);
    window.startHackingTerminal = (data = {}) => domSwitchManager.trigger("hacking_terminal", data);
    window.startAiMinigame = (data = {}) => domSwitchManager.trigger("ai_minigame", data);
}
