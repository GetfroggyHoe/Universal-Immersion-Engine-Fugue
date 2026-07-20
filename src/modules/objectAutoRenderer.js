import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

const AUTO_RENDERER_VERSION = "1.1.0";

function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clamp(v, lo, hi) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

function normKey(v) {
    return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function nowMs() {
    return Date.now();
}

function slug(v, fallback = "object") {
    return String(v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72) || fallback;
}

const OBJECT_TYPES = Object.freeze({
    BOOK: "book",
    MINIGAME: "minigame",
    PUZZLE: "puzzle",
    COMPUTER: "computer",
    CONTAINER: "container",
    WORKSTATION: "workstation",
    VENDING: "vending",
    NOTE: "note",
    MAP_OBJECT: "map_object",
    MUSIC_PLAYER: "music_player",
    SAFE: "safe",
    DICE: "dice",
    CARD_GAME: "card_game",
    SLOT_MACHINE: "slot_machine",
    MAGIC_ORB: "magic_orb",
    TELEPORTER: "teleporter",
    ALTAR: "altar",
    FOUNTAIN: "fountain",
    STATUE: "statue",
    MIRROR: "mirror",
    CLOCK: "clock",
    RADIO: "radio",
    TV: "tv",
    PHONE_OBJECT: "phone_object",
    TERMINAL: "terminal",
    ARCADE: "arcade",
    CHESS_BOARD: "chess_board",
    PIANO: "piano",
    PAINTING: "painting",
    SCROLL: "scroll",
    CRYSTAL_BALL: "crystal_ball",
    TREASURE_CHEST: "treasure_chest",
    LOCKED_DOOR: "locked_door",
    TRAP: "trap",
    LEVER: "lever",
    BUTTON: "button",
    GENERIC: "generic",
});

const OBJECT_TYPE_ALIASES = {
    "journal": OBJECT_TYPES.BOOK,
    "diary": OBJECT_TYPES.BOOK,
    "tome": OBJECT_TYPES.BOOK,
    "grimoire": OBJECT_TYPES.BOOK,
    "manual": OBJECT_TYPES.BOOK,
    "textbook": OBJECT_TYPES.BOOK,
    "novel": OBJECT_TYPES.BOOK,
    "game": OBJECT_TYPES.MINIGAME,
    "puzzle_box": OBJECT_TYPES.PUZZLE,
    "combination_lock": OBJECT_TYPES.PUZZLE,
    "riddle": OBJECT_TYPES.PUZZLE,
    "pc": OBJECT_TYPES.COMPUTER,
    "laptop": OBJECT_TYPES.COMPUTER,
    "desktop": OBJECT_TYPES.COMPUTER,
    "chest": OBJECT_TYPES.CONTAINER,
    "box": OBJECT_TYPES.CONTAINER,
    "bag": OBJECT_TYPES.CONTAINER,
    "crate": OBJECT_TYPES.CONTAINER,
    "barrel": OBJECT_TYPES.CONTAINER,
    "crafting_table": OBJECT_TYPES.WORKSTATION,
    "forge": OBJECT_TYPES.WORKSTATION,
    "anvil": OBJECT_TYPES.WORKSTATION,
    "alchemy_table": OBJECT_TYPES.WORKSTATION,
    "enchanting_table": OBJECT_TYPES.WORKSTATION,
    "kitchen": OBJECT_TYPES.WORKSTATION,
    "oven": OBJECT_TYPES.WORKSTATION,
    "stove": OBJECT_TYPES.WORKSTATION,
    "letter": OBJECT_TYPES.NOTE,
    "scroll": OBJECT_TYPES.SCROLL,
    "message": OBJECT_TYPES.NOTE,
    "document": OBJECT_TYPES.NOTE,
    "map": OBJECT_TYPES.MAP_OBJECT,
    "jukebox": OBJECT_TYPES.MUSIC_PLAYER,
    "stereo": OBJECT_TYPES.MUSIC_PLAYER,
    "gramophone": OBJECT_TYPES.MUSIC_PLAYER,
    "lockbox": OBJECT_TYPES.SAFE,
    "vault": OBJECT_TYPES.SAFE,
    "d20": OBJECT_TYPES.DICE,
    "dice_roller": OBJECT_TYPES.DICE,
    "cards": OBJECT_TYPES.CARD_GAME,
    "deck": OBJECT_TYPES.CARD_GAME,
    "one_armed_bandit": OBJECT_TYPES.SLOT_MACHINE,
    "palantir": OBJECT_TYPES.CRYSTAL_BALL,
    "portal": OBJECT_TYPES.TELEPORTER,
    "shrine": OBJECT_TYPES.ALTAR,
    "well": OBJECT_TYPES.FOUNTAIN,
    "wishing_well": OBJECT_TYPES.FOUNTAIN,
    "gargoyle": OBJECT_TYPES.STATUE,
    "reflection": OBJECT_TYPES.MIRROR,
    "pendulum": OBJECT_TYPES.CLOCK,
    "hourglass": OBJECT_TYPES.CLOCK,
    "walkie_talkie": OBJECT_TYPES.RADIO,
    "screen": OBJECT_TYPES.TV,
    "monitor": OBJECT_TYPES.TV,
    "payphone": OBJECT_TYPES.PHONE_OBJECT,
    "console": OBJECT_TYPES.TERMINAL,
    "pinball": OBJECT_TYPES.ARCADE,
    "checkerboard": OBJECT_TYPES.CHESS_BOARD,
    "keyboard": OBJECT_TYPES.PIANO,
    "canvas": OBJECT_TYPES.PAINTING,
    "portrait": OBJECT_TYPES.PAINTING,
};

function detectObjectType(obj) {
    if (!obj || typeof obj !== "object") return OBJECT_TYPES.GENERIC;
    const explicit = String(obj.objectType || obj.type || obj.kind || "").trim().toLowerCase();
    if (explicit && OBJECT_TYPES[explicit.toUpperCase()]) return explicit;
    if (OBJECT_TYPE_ALIASES[explicit]) return OBJECT_TYPE_ALIASES[explicit];
    const name = normKey(obj.name || obj.label || "");
    for (const [keyword, type] of Object.entries(OBJECT_TYPE_ALIASES)) {
        if (name.includes(keyword)) return type;
    }
    const desc = normKey(obj.description || "");
    for (const [keyword, type] of Object.entries(OBJECT_TYPE_ALIASES)) {
        if (desc.includes(keyword)) return type;
    }
    if (Array.isArray(obj.pages) || obj.content || obj.text) return OBJECT_TYPES.BOOK;
    if (Array.isArray(obj.recipes) || Array.isArray(obj.crafting)) return OBJECT_TYPES.WORKSTATION;
    if (obj.locked || obj.combination || obj.password) return OBJECT_TYPES.SAFE;
    if (Array.isArray(obj.options) && obj.options.length) return OBJECT_TYPES.GENERIC;
    return OBJECT_TYPES.GENERIC;
}

function generateBookHtml(obj) {
    const title = esc(obj.name || obj.title || "Book");
    const pages = Array.isArray(obj.pages) ? obj.pages : [];
    const content = esc(obj.content || obj.text || "");
    const currentPage = clamp(obj.currentPage || 0, 0, Math.max(0, pages.length - 1));
    const pageContent = pages[currentPage] ? esc(pages[currentPage]) : content;
    const totalPages = pages.length || 1;
    return `
        <div class="uie-obj-book" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-book-cover">
                <div class="uie-obj-book-title">${title}</div>
                <div class="uie-obj-book-page">
                    <div class="uie-obj-book-text">${pageContent.replace(/\n/g, "<br>")}</div>
                </div>
                <div class="uie-obj-book-controls">
                    <button class="uie-obj-btn uie-obj-book-prev" data-action="page-prev" ${currentPage <= 0 ? "disabled" : ""}>◀ Prev</button>
                    <span class="uie-obj-book-page-num">Page ${currentPage + 1} / ${totalPages}</span>
                    <button class="uie-obj-btn uie-obj-book-next" data-action="page-next" ${currentPage >= totalPages - 1 ? "disabled" : ""}>Next ▶</button>
                </div>
            </div>
        </div>
    `;
}

function generateMinigameHtml(obj) {
    const title = esc(obj.name || "Minigame");
    const gameType = String(obj.gameType || obj.minigameType || "clicker").toLowerCase();
    const highScore = obj.highScore || 0;
    let gameArea = "";
    if (gameType === "clicker" || gameType === "click") {
        gameArea = `
            <div class="uie-obj-minigame-area">
                <div class="uie-obj-minigame-score">Score: <span class="uie-obj-score-value">0</span></div>
                <div class="uie-obj-minigame-timer">Time: <span class="uie-obj-timer-value">30</span>s</div>
                <button class="uie-obj-minigame-target" data-action="click-target">CLICK!</button>
                <button class="uie-obj-btn uie-obj-minigame-start" data-action="start-game">Start Game</button>
            </div>
        `;
    } else if (gameType === "memory" || gameType === "match") {
        const gridSize = clamp(obj.gridSize || 4, 2, 8);
        gameArea = `
            <div class="uie-obj-minigame-area">
                <div class="uie-obj-minigame-score">Moves: <span class="uie-obj-score-value">0</span></div>
                <div class="uie-obj-memory-grid" data-grid-size="${gridSize}"></div>
                <button class="uie-obj-btn uie-obj-minigame-start" data-action="start-game">Start Game</button>
            </div>
        `;
    } else if (gameType === "reaction" || gameType === "reflex") {
        gameArea = `
            <div class="uie-obj-minigame-area">
                <div class="uie-obj-minigame-score">Best: <span class="uie-obj-score-value">${highScore}ms</span></div>
                <div class="uie-obj-reaction-zone" data-action="reaction-click">Wait for green...</div>
                <button class="uie-obj-btn uie-obj-minigame-start" data-action="start-game">Start Game</button>
            </div>
        `;
    } else {
        gameArea = `
            <div class="uie-obj-minigame-area">
                <div class="uie-obj-minigame-info">${esc(obj.description || "A fun minigame awaits!")}</div>
                <button class="uie-obj-btn uie-obj-minigame-start" data-action="start-game">Play</button>
            </div>
        `;
    }
    return `
        <div class="uie-obj-minigame" data-object-id="${esc(obj.id || "")}" data-game-type="${gameType}">
            <div class="uie-obj-minigame-header">${title}</div>
            ${gameArea}
        </div>
    `;
}

function generatePuzzleHtml(obj) {
    const title = esc(obj.name || "Puzzle");
    const puzzleType = String(obj.puzzleType || "combination").toLowerCase();
    let puzzleArea = "";
    if (puzzleType === "combination" || puzzleType === "lock") {
        const digits = clamp(obj.digits || 4, 1, 8);
        puzzleArea = `
            <div class="uie-obj-puzzle-area">
                <div class="uie-obj-combination-display">
                    ${Array.from({ length: digits }, (_, i) => `<input type="number" class="uie-obj-combo-digit" data-digit="${i}" min="0" max="9" value="0">`).join("")}
                </div>
                <button class="uie-obj-btn uie-obj-puzzle-submit" data-action="submit-combination">Submit</button>
                <div class="uie-obj-puzzle-hint">${esc(obj.hint || "")}</div>
            </div>
        `;
    } else if (puzzleType === "sliding" || puzzleType === "slider") {
        const size = clamp(obj.size || 3, 2, 5);
        puzzleArea = `
            <div class="uie-obj-puzzle-area">
                <div class="uie-obj-sliding-puzzle" data-size="${size}"></div>
                <button class="uie-obj-btn uie-obj-puzzle-reset" data-action="reset-puzzle">Shuffle</button>
            </div>
        `;
    } else if (puzzleType === "riddle") {
        puzzleArea = `
            <div class="uie-obj-puzzle-area">
                <div class="uie-obj-riddle-text">${esc(obj.riddle || obj.question || "What am I?")}</div>
                <input type="text" class="uie-obj-riddle-input" placeholder="Your answer...">
                <button class="uie-obj-btn uie-obj-puzzle-submit" data-action="submit-riddle">Submit Answer</button>
            </div>
        `;
    } else {
        puzzleArea = `
            <div class="uie-obj-puzzle-area">
                <div class="uie-obj-puzzle-info">${esc(obj.description || "Solve this puzzle.")}</div>
                <button class="uie-obj-btn uie-obj-puzzle-interact" data-action="interact">Interact</button>
            </div>
        `;
    }
    return `
        <div class="uie-obj-puzzle" data-object-id="${esc(obj.id || "")}" data-puzzle-type="${puzzleType}">
            <div class="uie-obj-puzzle-header">${title}</div>
            ${puzzleArea}
        </div>
    `;
}

function generateComputerHtml(obj) {
    const title = esc(obj.name || "Computer");
    return `
        <div class="uie-obj-computer" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-computer-frame">
                <div class="uie-obj-computer-screen">
                    <div class="uie-obj-computer-header">${title}</div>
                    <div class="uie-obj-computer-content">
                        <div class="uie-obj-computer-icons">
                            <div class="uie-obj-computer-icon" data-action="open-files"><i>📁</i><span>Files</span></div>
                            <div class="uie-obj-computer-icon" data-action="open-mail"><i>✉️</i><span>Mail</span></div>
                            <div class="uie-obj-computer-icon" data-action="open-browser"><i>🌐</i><span>Browser</span></div>
                            <div class="uie-obj-computer-icon" data-action="open-terminal"><i>⌨️</i><span>Terminal</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateNoteHtml(obj) {
    const title = esc(obj.name || "Note");
    const content = esc(obj.content || obj.text || obj.message || "");
    const author = esc(obj.author || obj.from || "");
    return `
        <div class="uie-obj-note" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-note-paper">
                <div class="uie-obj-note-title">${title}</div>
                <div class="uie-obj-note-content">${content.replace(/\n/g, "<br>")}</div>
                ${author ? `<div class="uie-obj-note-author">— ${author}</div>` : ""}
            </div>
        </div>
    `;
}

function generateSafeHtml(obj) {
    const title = esc(obj.name || "Safe");
    const isLocked = obj.locked !== false;
    const combination = obj.combination || obj.password || "";
    return `
        <div class="uie-obj-safe" data-object-id="${esc(obj.id || "")}" data-locked="${isLocked}">
            <div class="uie-obj-safe-body">
                <div class="uie-obj-safe-title">${title}</div>
                ${isLocked ? `
                    <div class="uie-obj-safe-lock">
                        <div class="uie-obj-safe-dial">🔒</div>
                        <input type="text" class="uie-obj-safe-input" placeholder="Enter combination...">
                        <button class="uie-obj-btn uie-obj-safe-unlock" data-action="unlock">Unlock</button>
                    </div>
                ` : `
                    <div class="uie-obj-safe-open">
                        <div class="uie-obj-safe-dial">🔓</div>
                        <button class="uie-obj-btn uie-obj-safe-open-btn" data-action="open-safe">Open</button>
                    </div>
                `}
            </div>
        </div>
    `;
}

function generateDiceHtml(obj) {
    const title = esc(obj.name || "Dice Roller");
    const sides = clamp(obj.sides || 20, 2, 100);
    return `
        <div class="uie-obj-dice" data-object-id="${esc(obj.id || "")}" data-sides="${sides}">
            <div class="uie-obj-dice-body">
                <div class="uie-obj-dice-title">${title}</div>
                <div class="uie-obj-dice-display">
                    <div class="uie-obj-dice-face">🎲</div>
                    <div class="uie-obj-dice-result">—</div>
                </div>
                <div class="uie-obj-dice-controls">
                    <label>Sides: <input type="number" class="uie-obj-dice-sides" value="${sides}" min="2" max="100"></label>
                    <label>Count: <input type="number" class="uie-obj-dice-count" value="1" min="1" max="10"></label>
                    <button class="uie-obj-btn uie-obj-dice-roll" data-action="roll">Roll!</button>
                </div>
                <div class="uie-obj-dice-history"></div>
            </div>
        </div>
    `;
}

function generateMusicPlayerHtml(obj) {
    const title = esc(obj.name || "Music Player");
    const tracks = Array.isArray(obj.tracks) ? obj.tracks : [];
    return `
        <div class="uie-obj-music-player" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-music-body">
                <div class="uie-obj-music-title">${title}</div>
                <div class="uie-obj-music-display">
                    <div class="uie-obj-music-art">🎵</div>
                    <div class="uie-obj-music-track-name">No track selected</div>
                </div>
                <div class="uie-obj-music-controls">
                    <button class="uie-obj-btn" data-action="prev-track">⏮</button>
                    <button class="uie-obj-btn uie-obj-music-play" data-action="play-pause">▶</button>
                    <button class="uie-obj-btn" data-action="next-track">⏭</button>
                </div>
                <div class="uie-obj-music-playlist">
                    ${tracks.map((t, i) => `<div class="uie-obj-music-track" data-track-idx="${i}">${esc(t.name || `Track ${i + 1}`)}</div>`).join("")}
                </div>
            </div>
        </div>
    `;
}

function generateLeverHtml(obj) {
    const title = esc(obj.name || "Lever");
    const isPulled = obj.pulled || false;
    return `
        <div class="uie-obj-lever" data-object-id="${esc(obj.id || "")}" data-pulled="${isPulled}">
            <div class="uie-obj-lever-body">
                <div class="uie-obj-lever-title">${title}</div>
                <div class="uie-obj-lever-visual ${isPulled ? "pulled" : ""}">
                    <div class="uie-obj-lever-handle">${isPulled ? "⬇" : "⬆"}</div>
                </div>
                <button class="uie-obj-btn uie-obj-lever-pull" data-action="pull-lever">${isPulled ? "Push Up" : "Pull Down"}</button>
                <div class="uie-obj-lever-label">${esc(obj.label || (isPulled ? "Activated" : "Inactive"))}</div>
            </div>
        </div>
    `;
}

function generateButtonHtml(obj) {
    const title = esc(obj.name || "Button");
    const color = obj.color || "#ff4444";
    return `
        <div class="uie-obj-button" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-button-body">
                <div class="uie-obj-button-title">${title}</div>
                <button class="uie-obj-big-button" data-action="press-button" style="background: ${color}; box-shadow: 0 4px 0 ${color}88;">
                    ${esc(obj.label || "PRESS")}
                </button>
                <div class="uie-obj-button-desc">${esc(obj.description || "")}</div>
            </div>
        </div>
    `;
}

function generateTeleporterHtml(obj) {
    const title = esc(obj.name || "Teleporter");
    const destinations = Array.isArray(obj.destinations) ? obj.destinations : [];
    return `
        <div class="uie-obj-teleporter" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-teleporter-body">
                <div class="uie-obj-teleporter-title">${title}</div>
                <div class="uie-obj-teleporter-visual">🌀</div>
                <div class="uie-obj-teleporter-destinations">
                    ${destinations.length ? destinations.map((d, i) => `
                        <button class="uie-obj-btn uie-obj-teleport-dest" data-dest-idx="${i}" data-dest="${esc(d.location || d.name || "")}">
                            ${esc(d.name || d.location || `Destination ${i + 1}`)}
                        </button>
                    `).join("") : `<div class="uie-obj-teleporter-empty">No destinations configured</div>`}
                </div>
            </div>
        </div>
    `;
}

function generateAltarHtml(obj) {
    const title = esc(obj.name || "Altar");
    const offerings = Array.isArray(obj.acceptedOfferings) ? obj.acceptedOfferings : [];
    return `
        <div class="uie-obj-altar" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-altar-body">
                <div class="uie-obj-altar-title">${title}</div>
                <div class="uie-obj-altar-visual">⛩️</div>
                <div class="uie-obj-altar-desc">${esc(obj.description || "An ancient altar. What will you offer?")}</div>
                <div class="uie-obj-altar-offerings">
                    ${offerings.map((o, i) => `
                        <button class="uie-obj-btn uie-obj-offer-btn" data-offer-idx="${i}">
                            Offer: ${esc(o.name || o.item || `Offering ${i + 1}`)}
                        </button>
                    `).join("")}
                </div>
            </div>
        </div>
    `;
}

function generateMirrorHtml(obj) {
    const title = esc(obj.name || "Mirror");
    return `
        <div class="uie-obj-mirror" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-mirror-body">
                <div class="uie-obj-mirror-title">${title}</div>
                <div class="uie-obj-mirror-visual">🪞</div>
                <div class="uie-obj-mirror-reflection">${esc(obj.reflection || obj.message || "You see your reflection...")}</div>
                <button class="uie-obj-btn uie-obj-mirror-look" data-action="look-deeper">Look Deeper</button>
            </div>
        </div>
    `;
}

function generateGenericHtml(obj) {
    const title = esc(obj.name || "Object");
    const desc = esc(obj.description || "");
    const options = Array.isArray(obj.options) ? obj.options : [];
    return `
        <div class="uie-obj-generic" data-object-id="${esc(obj.id || "")}">
            <div class="uie-obj-generic-body">
                <div class="uie-obj-generic-title">${title}</div>
                ${desc ? `<div class="uie-obj-generic-desc">${desc}</div>` : ""}
                ${options.length ? `
                    <div class="uie-obj-generic-options">
                        ${options.map((o, i) => `
                            <button class="uie-obj-btn uie-obj-option-btn" data-option-idx="${i}">
                                ${esc(o.label || o.text || o.name || `Option ${i + 1}`)}
                            </button>
                        `).join("")}
                    </div>
                ` : `
                    <button class="uie-obj-btn uie-obj-interact-btn" data-action="interact">Interact</button>
                `}
            </div>
        </div>
    `;
}

function generateObjectHtml(obj) {
    if (!obj || typeof obj !== "object") return generateGenericHtml({ name: "Unknown Object" });
    const type = detectObjectType(obj);
    obj._detectedType = type;
    switch (type) {
        case OBJECT_TYPES.BOOK:
        case OBJECT_TYPES.SCROLL:
            return generateBookHtml(obj);
        case OBJECT_TYPES.MINIGAME:
        case OBJECT_TYPES.CARD_GAME:
        case OBJECT_TYPES.CHESS_BOARD:
        case OBJECT_TYPES.ARCADE:
        case OBJECT_TYPES.SLOT_MACHINE:
            return generateMinigameHtml(obj);
        case OBJECT_TYPES.PUZZLE:
            return generatePuzzleHtml(obj);
        case OBJECT_TYPES.COMPUTER:
        case OBJECT_TYPES.TERMINAL:
            return generateComputerHtml(obj);
        case OBJECT_TYPES.NOTE:
            return generateNoteHtml(obj);
        case OBJECT_TYPES.SAFE:
        case OBJECT_TYPES.LOCKED_DOOR:
            return generateSafeHtml(obj);
        case OBJECT_TYPES.DICE:
            return generateDiceHtml(obj);
        case OBJECT_TYPES.MUSIC_PLAYER:
        case OBJECT_TYPES.RADIO:
            return generateMusicPlayerHtml(obj);
        case OBJECT_TYPES.LEVER:
            return generateLeverHtml(obj);
        case OBJECT_TYPES.BUTTON:
            return generateButtonHtml(obj);
        case OBJECT_TYPES.TELEPORTER:
            return generateTeleporterHtml(obj);
        case OBJECT_TYPES.ALTAR:
        case OBJECT_TYPES.FOUNTAIN:
            return generateAltarHtml(obj);
        case OBJECT_TYPES.MIRROR:
        case OBJECT_TYPES.CRYSTAL_BALL:
            return generateMirrorHtml(obj);
        case OBJECT_TYPES.CONTAINER:
        case OBJECT_TYPES.TREASURE_CHEST:
            return generateGenericHtml({ ...obj, description: obj.description || "A container. Click to open." });
        case OBJECT_TYPES.WORKSTATION:
            return generateGenericHtml({ ...obj, description: obj.description || "A workstation. Click to use." });
        default:
            return generateGenericHtml(obj);
    }
}

function generateObjectCss(obj) {
    const type = obj?._detectedType || detectObjectType(obj);
    const baseCss = `
        .uie-obj-btn {
            padding: 6px 14px;
            border-radius: 6px;
            border: 1px solid rgba(111, 211, 255, 0.35);
            background: rgba(111, 211, 255, 0.12);
            color: #bae6fd;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: all 0.2s;
        }
        .uie-obj-btn:hover:not(:disabled) {
            background: rgba(111, 211, 255, 0.25);
            border-color: rgba(111, 211, 255, 0.6);
            box-shadow: 0 0 8px rgba(111, 211, 255, 0.3);
        }
        .uie-obj-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
    `;
    const typeCss = {
        [OBJECT_TYPES.BOOK]: `
            .uie-obj-book { text-align: center; }
            .uie-obj-book-cover { background: linear-gradient(135deg, #2d1b0e 0%, #1a0f06 100%); border: 2px solid #8b4513; border-radius: 8px; padding: 16px; }
            .uie-obj-book-title { font-size: 16px; font-weight: 800; color: #ffd700; margin-bottom: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
            .uie-obj-book-page { background: #f5f0e0; border-radius: 4px; padding: 16px; min-height: 120px; color: #2d1b0e; font-family: 'Georgia', serif; font-size: 13px; line-height: 1.6; text-align: left; }
            .uie-obj-book-controls { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 12px; }
            .uie-obj-book-page-num { color: #cba35c; font-size: 11px; }
        `,
        [OBJECT_TYPES.MINIGAME]: `
            .uie-obj-minigame { text-align: center; }
            .uie-obj-minigame-header { font-size: 16px; font-weight: 800; color: #7dd3fc; margin-bottom: 12px; }
            .uie-obj-minigame-area { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-minigame-score, .uie-obj-minigame-timer { font-size: 14px; color: #ffd166; margin-bottom: 8px; }
            .uie-obj-minigame-target { width: 80px; height: 80px; border-radius: 50%; background: #ef4444; border: 3px solid #fff; color: #fff; font-weight: 800; font-size: 14px; cursor: pointer; margin: 12px auto; display: block; transition: transform 0.1s; }
            .uie-obj-minigame-target:active { transform: scale(0.9); }
            .uie-obj-reaction-zone { width: 120px; height: 120px; margin: 12px auto; border-radius: 8px; background: #666; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; cursor: pointer; transition: background 0.2s; }
            .uie-obj-reaction-zone.ready { background: #22c55e; }
        `,
        [OBJECT_TYPES.PUZZLE]: `
            .uie-obj-puzzle { text-align: center; }
            .uie-obj-puzzle-header { font-size: 16px; font-weight: 800; color: #a78bfa; margin-bottom: 12px; }
            .uie-obj-puzzle-area { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-combination-display { display: flex; justify-content: center; gap: 8px; margin-bottom: 12px; }
            .uie-obj-combo-digit { width: 36px; height: 44px; text-align: center; font-size: 20px; font-weight: 800; background: #1a1a2e; border: 2px solid #a78bfa; border-radius: 4px; color: #fff; }
            .uie-obj-riddle-text { font-style: italic; color: #e0e0e0; margin-bottom: 12px; line-height: 1.5; }
            .uie-obj-riddle-input { width: 100%; padding: 8px; background: #1a1a2e; border: 1px solid #a78bfa; border-radius: 4px; color: #fff; margin-bottom: 8px; }
            .uie-obj-puzzle-hint { font-size: 11px; color: #888; margin-top: 8px; }
        `,
        [OBJECT_TYPES.COMPUTER]: `
            .uie-obj-computer { text-align: center; }
            .uie-obj-computer-frame { background: #333; border-radius: 8px; padding: 8px; }
            .uie-obj-computer-screen { background: #0a1628; border: 2px solid #444; border-radius: 4px; min-height: 180px; }
            .uie-obj-computer-header { background: #1a3a5c; padding: 6px 12px; font-size: 12px; color: #7dd3fc; font-weight: 700; }
            .uie-obj-computer-icons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px; }
            .uie-obj-computer-icon { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; padding: 8px; border-radius: 4px; transition: background 0.2s; }
            .uie-obj-computer-icon:hover { background: rgba(111, 211, 255, 0.1); }
            .uie-obj-computer-icon i { font-size: 28px; }
            .uie-obj-computer-icon span { font-size: 10px; color: #bae6fd; }
        `,
        [OBJECT_TYPES.NOTE]: `
            .uie-obj-note { text-align: center; }
            .uie-obj-note-paper { background: linear-gradient(135deg, #f5f0e0 0%, #e8dcc0 100%); border-radius: 4px; padding: 20px; box-shadow: 2px 2px 8px rgba(0,0,0,0.3); transform: rotate(-1deg); }
            .uie-obj-note-title { font-size: 14px; font-weight: 800; color: #2d1b0e; margin-bottom: 12px; border-bottom: 1px solid #8b4513; padding-bottom: 6px; }
            .uie-obj-note-content { font-family: 'Georgia', serif; font-size: 13px; color: #2d1b0e; line-height: 1.6; text-align: left; }
            .uie-obj-note-author { font-style: italic; color: #666; margin-top: 12px; text-align: right; }
        `,
        [OBJECT_TYPES.SAFE]: `
            .uie-obj-safe { text-align: center; }
            .uie-obj-safe-body { background: linear-gradient(135deg, #333 0%, #1a1a1a 100%); border: 3px solid #555; border-radius: 8px; padding: 16px; }
            .uie-obj-safe-title { font-size: 14px; font-weight: 800; color: #ffd700; margin-bottom: 12px; }
            .uie-obj-safe-dial { font-size: 32px; margin-bottom: 8px; }
            .uie-obj-safe-input { width: 100%; padding: 8px; background: #000; border: 1px solid #ffd700; border-radius: 4px; color: #ffd700; text-align: center; font-family: monospace; margin-bottom: 8px; }
        `,
        [OBJECT_TYPES.DICE]: `
            .uie-obj-dice { text-align: center; }
            .uie-obj-dice-body { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-dice-title { font-size: 14px; font-weight: 800; color: #ffd166; margin-bottom: 12px; }
            .uie-obj-dice-display { margin: 12px 0; }
            .uie-obj-dice-face { font-size: 48px; }
            .uie-obj-dice-result { font-size: 24px; font-weight: 800; color: #fff; margin-top: 8px; }
            .uie-obj-dice-controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; align-items: center; margin-top: 12px; }
            .uie-obj-dice-controls label { font-size: 11px; color: #bae6fd; }
            .uie-obj-dice-controls input { width: 50px; padding: 4px; background: #1a1a2e; border: 1px solid #ffd166; border-radius: 4px; color: #fff; text-align: center; }
            .uie-obj-dice-history { margin-top: 12px; font-size: 11px; color: #888; max-height: 60px; overflow-y: auto; }
        `,
        [OBJECT_TYPES.MUSIC_PLAYER]: `
            .uie-obj-music-player { text-align: center; }
            .uie-obj-music-body { background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%); border-radius: 8px; padding: 16px; }
            .uie-obj-music-title { font-size: 14px; font-weight: 800; color: #a78bfa; margin-bottom: 12px; }
            .uie-obj-music-display { margin: 12px 0; }
            .uie-obj-music-art { font-size: 48px; }
            .uie-obj-music-track-name { font-size: 12px; color: #e0e0e0; margin-top: 8px; }
            .uie-obj-music-controls { display: flex; justify-content: center; gap: 12px; margin: 12px 0; }
            .uie-obj-music-playlist { max-height: 80px; overflow-y: auto; }
            .uie-obj-music-track { padding: 4px 8px; font-size: 11px; color: #bae6fd; cursor: pointer; border-radius: 4px; transition: background 0.2s; }
            .uie-obj-music-track:hover { background: rgba(167, 139, 250, 0.2); }
        `,
        [OBJECT_TYPES.LEVER]: `
            .uie-obj-lever { text-align: center; }
            .uie-obj-lever-body { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-lever-title { font-size: 14px; font-weight: 800; color: #f97316; margin-bottom: 12px; }
            .uie-obj-lever-visual { font-size: 48px; margin: 12px 0; transition: transform 0.3s; }
            .uie-obj-lever-visual.pulled { transform: rotate(180deg); }
            .uie-obj-lever-label { font-size: 11px; color: #888; margin-top: 8px; }
        `,
        [OBJECT_TYPES.BUTTON]: `
            .uie-obj-button { text-align: center; }
            .uie-obj-button-body { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; }
            .uie-obj-button-title { font-size: 14px; font-weight: 800; color: #ef4444; margin-bottom: 12px; }
            .uie-obj-big-button { padding: 16px 32px; font-size: 16px; font-weight: 800; color: #fff; border: none; border-radius: 8px; cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; }
            .uie-obj-big-button:active { transform: translateY(4px); box-shadow: none !important; }
            .uie-obj-button-desc { font-size: 11px; color: #888; margin-top: 8px; }
        `,
        [OBJECT_TYPES.TELEPORTER]: `
            .uie-obj-teleporter { text-align: center; }
            .uie-obj-teleporter-body { background: linear-gradient(135deg, #1a0033 0%, #0a001a 100%); border-radius: 8px; padding: 16px; }
            .uie-obj-teleporter-title { font-size: 14px; font-weight: 800; color: #c084fc; margin-bottom: 12px; }
            .uie-obj-teleporter-visual { font-size: 48px; animation: uie-spin 4s linear infinite; }
            @keyframes uie-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .uie-obj-teleporter-destinations { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
            .uie-obj-teleporter-empty { font-size: 11px; color: #888; }
        `,
        [OBJECT_TYPES.ALTAR]: `
            .uie-obj-altar { text-align: center; }
            .uie-obj-altar-body { background: linear-gradient(135deg, #2d1b0e 0%, #1a0f06 100%); border: 2px solid #8b4513; border-radius: 8px; padding: 16px; }
            .uie-obj-altar-title { font-size: 14px; font-weight: 800; color: #ffd700; margin-bottom: 12px; }
            .uie-obj-altar-visual { font-size: 48px; margin: 12px 0; }
            .uie-obj-altar-desc { font-size: 12px; color: #cba35c; margin-bottom: 12px; }
            .uie-obj-altar-offerings { display: flex; flex-direction: column; gap: 6px; }
        `,
        [OBJECT_TYPES.MIRROR]: `
            .uie-obj-mirror { text-align: center; }
            .uie-obj-mirror-body { background: linear-gradient(135deg, #e0e0e0 0%, #a0a0a0 100%); border: 4px solid #8b4513; border-radius: 50% 50% 45% 45%; padding: 24px; }
            .uie-obj-mirror-title { font-size: 14px; font-weight: 800; color: #333; margin-bottom: 12px; }
            .uie-obj-mirror-visual { font-size: 48px; }
            .uie-obj-mirror-reflection { font-style: italic; color: #555; margin: 12px 0; font-size: 12px; }
        `,
    };
    return baseCss + (typeCss[type] || "");
}

function renderObjectToRoom(obj, coordinates) {
    const s = getSettings();
    if (!s.roomEditor || typeof s.roomEditor !== "object") s.roomEditor = {};
    if (!Array.isArray(s.roomEditor.placements)) s.roomEditor.placements = [];
    const type = detectObjectType(obj);
    const id = obj.id || `obj_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`;
    const html = generateObjectHtml(obj);
    const css = generateObjectCss({ ...obj, _detectedType: type });
    const placement = {
        id,
        location: s.worldState?.location || "Unknown",
        slotId: obj.slotId || `auto_${type}`,
        slotType: obj.slotType || "utility",
        assetId: obj.assetId || type,
        objectType: type,
        objectData: obj,
        customHtml: html,
        coordinates: coordinates || { x: 0.5, y: 0.5 },
        overrides: {
            css,
            addition: "",
            user_custom_css: "",
        },
        autoRendered: true,
        createdAt: nowMs(),
    };
    const existingIdx = s.roomEditor.placements.findIndex((p) => String(p?.id || "") === String(id));
    if (existingIdx >= 0) {
        s.roomEditor.placements[existingIdx] = { ...s.roomEditor.placements[existingIdx], ...placement };
    } else {
        s.roomEditor.placements.push(placement);
    }
    saveSettings();
    try {
        if (typeof window.renderPlacedComponents === "function") {
            window.renderPlacedComponents();
        }
    } catch (_) {}
    return placement;
}

function environmentObjects(environmentState) {
    if (!environmentState || typeof environmentState !== "object") return [];
    return [
        environmentState.objects,
        environmentState.interactables,
        environmentState.fixtures,
        environmentState.props,
        environmentState.contents,
        environmentState?.layout?.objects,
        environmentState?.layout?.fixtures,
    ].flatMap((value) => Array.isArray(value) ? value : []).slice(0, 12);
}

function contextualBlueprints(location, context = {}) {
    const text = [location, context.type, context.theme, context.description, context.desc, context.district, context.weather]
        .map((value) => String(value || "")).join(" ").toLowerCase();
    const profiles = [
        [/library|archive|school|academy|classroom|study|university|book/, [
            { name: "Local Reference Volume", type: "book", pages: [`Notes and local knowledge about ${location}.`] },
            { name: "Study Terminal", type: "computer", description: `A catalog terminal configured for ${location}.` },
            { name: "Notice Board", type: "note", content: `Current notices and schedules for ${location}.` },
        ]],
        [/temple|shrine|chapel|sanctuary|magic|arcane|occult|ritual|mystic/, [
            { name: "Local Altar", type: "altar", description: `An altar shaped by the beliefs of ${location}.` },
            { name: "Inscribed Scroll", type: "scroll", pages: [`Symbols record a fragment of ${location}'s history.`] },
            { name: "Scrying Mirror", type: "mirror", reflection: `The light of ${location} gathers in the glass.` },
        ]],
        [/workshop|factory|forge|industrial|laboratory|lab|garage|engine|machine/, [
            { name: "Work Station", type: "workstation", description: `Tools and materials suited to ${location}.` },
            { name: "Control Terminal", type: "terminal", description: `A local systems terminal for ${location}.` },
            { name: "Safety Lever", type: "lever", label: "Standby" },
        ]],
        [/station|airport|harbor|harbour|dock|port|terminal|transit|subway|metro|train/, [
            { name: "Route Map", type: "map_object", description: `Routes and exits around ${location}.` },
            { name: "Travel Kiosk", type: "terminal", description: `A public information terminal for ${location}.` },
            { name: "Cargo Crate", type: "container", description: "A marked container waiting near the travel lanes." },
        ]],
        [/tavern|inn|bar|cafe|restaurant|club|casino|lounge|venue/, [
            { name: "House Menu", type: "note", content: `Food, drink, services, and local prices at ${location}.` },
            { name: "Music Player", type: "music_player", tracks: [{ name: `${location} ambience` }] },
            { name: "Game Table", type: "dice", sides: 20 },
        ]],
        [/forest|woods|jungle|swamp|marsh|mountain|cave|desert|wilderness|trail|field|river|coast|ruins/, [
            { name: "Trail Marker", type: "map_object", description: `A weathered marker for paths around ${location}.` },
            { name: "Weathered Cache", type: "container", description: "A sheltered container for local supplies." },
            { name: "Field Notes", type: "note", content: `Observations about terrain and hazards around ${location}.` },
        ]],
        [/ship|space|orbital|star|cyber|futur|neon|android|holog|reactor/, [
            { name: "Systems Console", type: "computer", description: `A networked console keyed to ${location}.` },
            { name: "Access Panel", type: "button", label: "ACCESS", color: "#38bdf8" },
            { name: "Equipment Locker", type: "safe", locked: true },
        ]],
        [/home|house|apartment|bedroom|room|suite|hotel|office/, [
            { name: "Room Mirror", type: "mirror", reflection: `The current light of ${location} rests in the glass.` },
            { name: "Local Desk", type: "workstation", description: `A practical surface arranged for ${location}.` },
            { name: "Storage Chest", type: "container", description: "A container sized for this room." },
        ]],
        [/market|shop|store|mall|street|city|town|village|plaza|district/, [
            { name: "Local Notice Board", type: "note", content: `Public notices, prices, and rumors from ${location}.` },
            { name: "Information Kiosk", type: "terminal", description: `A public terminal for ${location}.` },
            { name: "Supply Crate", type: "container", description: "A sturdy crate marked for local delivery." },
        ]],
    ];
    return profiles.find(([pattern]) => pattern.test(text))?.[1] || [
        { name: "Location Marker", type: "map_object", description: `A physical marker tied to ${location}.` },
        { name: "Local Container", type: "container", description: `A useful container that fits ${location}.` },
        { name: "Context Note", type: "note", content: `A small piece of readable context from ${location}.` },
    ];
}

function normalizeQueuedObject(raw, location, index) {
    const source = typeof raw === "string" ? { name: raw } : raw;
    if (!source || typeof source !== "object") return null;
    const name = String(source.name || source.label || source.title || "").trim().slice(0, 100);
    if (!name) return null;
    const type = detectObjectType(source);
    const objectData = {
        ...source,
        id: String(source.id || `ctx_${slug(location, "location")}_${slug(name)}_${index}`),
        name,
        type,
        objectType: type,
        description: String(source.description || source.desc || `A ${name.toLowerCase()} that belongs in ${location}.`).slice(0, 500),
        location,
        contextGenerated: true,
    };
    return {
        id: objectData.id,
        name,
        type,
        objectType: type,
        description: objectData.description,
        location,
        status: "unplaced",
        source: "location_context",
        objectData,
        html: generateObjectHtml(objectData),
        css: generateObjectCss({ ...objectData, _detectedType: type }),
        contextGenerated: true,
        _key: `${slug(location, "location")}::${slug(name)}`,
        updatedAt: nowMs(),
    };
}

/** Prepare contextual HTML/CSS objects, but let the player choose placement. */
function queueContextualObjectsForLocation(locationName, context = {}) {
    const location = String(locationName || context.name || "").trim();
    if (!location) return [];
    const s = getSettings();
    if (!s.roomEditor || typeof s.roomEditor !== "object") s.roomEditor = {};
    if (!Array.isArray(s.roomEditor.unplacedItems)) s.roomEditor.unplacedItems = [];
    const candidates = [...environmentObjects(context.environmentState || context), ...contextualBlueprints(location, context)].slice(0, 8);
    const added = [];
    candidates.forEach((raw, index) => {
        const entry = normalizeQueuedObject(raw, location, index);
        if (!entry) return;
        const existing = s.roomEditor.unplacedItems.find((item) => String(item?._key || "") === entry._key);
        if (existing) Object.assign(existing, entry, { id: existing.id });
        else {
            s.roomEditor.unplacedItems.push(entry);
            added.push(entry);
        }
    });
    s.roomEditor.unplacedItems = s.roomEditor.unplacedItems.slice(-120);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:objects_updated", { detail: { location, added } })); } catch (_) {}
    if (added.length && context.notify !== false) notify("info", `${added.length} contextual objects are ready to place.`, "Objects");
    return added;
}

function placeQueuedObjectInRoom(objectId, coordinates) {
    const s = getSettings();
    const items = Array.isArray(s?.roomEditor?.unplacedItems) ? s.roomEditor.unplacedItems : [];
    const index = items.findIndex((item) => String(item?.id || "") === String(objectId || ""));
    if (index < 0) return null;
    const queued = items[index];
    const currentLocation = String(s?.worldState?.location || s?.worldState?.currentLocation || "").trim();
    if (queued.location && currentLocation && String(queued.location).toLowerCase() !== currentLocation.toLowerCase()) return null;
    const placement = renderObjectToRoom(queued.objectData || queued, coordinates);
    items.splice(index, 1);
    saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:objects_updated", { detail: { location: currentLocation, placed: placement } })); } catch (_) {}
    return placement;
}

function initObjectAutoRenderer() {
    try {
        window.UIE = window.UIE || {};
        window.UIE.objectRenderer = {
            render: generateObjectHtml,
            renderCss: generateObjectCss,
            placeInRoom: renderObjectToRoom,
            queueForLocation: queueContextualObjectsForLocation,
            placeQueued: placeQueuedObjectInRoom,
            detectType: detectObjectType,
            OBJECT_TYPES,
            version: AUTO_RENDERER_VERSION,
        };
    } catch (_) {}
}

export {
    AUTO_RENDERER_VERSION,
    OBJECT_TYPES,
    OBJECT_TYPE_ALIASES,
    detectObjectType,
    generateObjectHtml,
    generateObjectCss,
    renderObjectToRoom,
    queueContextualObjectsForLocation,
    placeQueuedObjectInRoom,
    initObjectAutoRenderer,
};
