/**
 * Universal Immersion Engine - Interactive Hot Spots,
 * Early 2000s CRT Desktop Emulator, Custom Closet Split-Pane,
 * and AI Room Mutator Component layer.
 */
import { getSettings, saveSettings } from "./core.js";
import { advanceWorldTimeMinutes } from "./timeProgress.js";
import { injectRpEvent } from "./features/rp_log.js";
import { generateContent } from "./apiClient.js";

// Helper to safely parse JSON
function parseStrictJsonObject(text = "") {
    const raw = String(text || "").trim().replace(/```json/gi, "```").replace(/```/g, "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
        try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
    }
    return null;
}

// Global state trackers
let hasDrawnPlacedItems = false;
let currentCrtApp = "desktop";
let crtMailbox = [
    {
        id: "mail_1",
        from: "contact@local.net",
        subject: "New Opportunity",
        date: "May 18, 2006",
        body: "Hello Player,\n\nA new opportunity has opened nearby. Bring your best tools, review your notes, and decide how you want to approach it.\n\nBest,\nA Local Contact"
    },
    {
        id: "mail_2",
        from: "mom@dialup.net",
        subject: "Did you eat?",
        date: "May 17, 2006",
        body: "Hi sweetie,\n\nJust checking in. I sent you some pocket money, hope you received it. Make sure you get enough sleep and clean your closet! Your sister says hi.\n\nLove,\nMom"
    },
    {
        id: "mail_3",
        from: "retro_guy@geocities.com",
        subject: "Webring Invitation!",
        date: "May 15, 2006",
        body: "Greetings fellow creator!\n\nI stumbled across your page and love the aesthetic. We are forming a small local webring for people building unusual worlds. Let me know if you want to add our banner widget.\n\nKeep it vivid,\n~RetroGuy~"
    }
];

let crtForum = [
    {
        id: "forum_1",
        title: "Local Talent Rankings 2006 (Unofficial)",
        comments: [
            { author: "RankWatcher", text: "Jun is definitely S-Tier this year, his presence is impossible to ignore." },
            { author: "KaiFanboy", text: "Don't count Kai out, his technique is unmatched!" },
            { author: "LocalCritic", text: "The new player has potential but needs to practice." }
        ]
    },
    {
        id: "forum_2",
        title: "Best practice setups in small apartments",
        comments: [
            { author: "MuffledScreamer", text: "I practice inside my closet, the clothes act as natural soundproofing!" },
            { author: "DeskJockey", text: "Singing scales at 2 AM is a great way to get evicted." }
        ]
    }
];

export function init() {
    console.log("[HotSpots] Initializing subsystems...");
    injectSubsystemStyles();
    wireRoomHotspots();
    wireCrtComputer();
    wireClosetSplitPane();
    wireEditRoomSystem();
    wireElevatorPanels();
    
    // Draw any existing placed components
    setTimeout(() => {
        renderPlacedComponents();
    }, 500);

    // Expose globally for engine transition hooks
    window.renderRoomComponents = renderPlacedComponents;
    window.renderPlacedComponents = renderPlacedComponents;
    window.openEditRoomModal = openEditRoomModal;
}

function wireElevatorPanels() {
    $(document)
        .off("click.uieElevatorFloor", "[data-elevator-floor]")
        .on("click.uieElevatorFloor", "[data-elevator-floor]", function(e) {
            e.preventDefault();
            const floor = String($(this).attr("data-elevator-floor") || "").trim();
            if (!floor) return;
            const panel = $(this).closest(".uie-slot-elevator");
            panel.find("[data-elevator-readout]").text(`FLOOR ${floor}`);
            const s = getSettings();
            if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
            s.worldState.floor = floor;
            s.worldState.lastElevatorUse = { floor, at: Date.now() };
            saveSettings();
            injectRpEvent(`[System: Elevator selected floor ${floor}.]`);
        });
}

// Inject premium styling
function injectSubsystemStyles() {
    if (document.getElementById("uie-bedroom-styles")) return;
    const style = document.createElement("style");
    style.id = "uie-bedroom-styles";
    style.innerHTML = `
        /* Premium cyber overlay action cards */
        .bedroom-action-title {
            font-size: 18px;
            font-weight: 800;
            color: #6fd3ff;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            text-transform: uppercase;
            border-bottom: 2px solid rgba(111, 211, 255, 0.2);
            padding-bottom: 6px;
            font-family: 'Inter', sans-serif;
        }
        .bedroom-action-subtitle {
            font-size: 12px;
            opacity: 0.8;
            margin-bottom: 16px;
            line-height: 1.4;
        }
        .bedroom-options-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
            margin-bottom: 12px;
        }
        .bedroom-opt-card {
            background: rgba(10, 16, 24, 0.72);
            border: 1px solid rgba(111, 211, 255, 0.16);
            border-radius: 8px;
            padding: 12px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        .bedroom-opt-card:hover {
            border-color: rgba(111, 211, 255, 0.6);
            background: rgba(16, 26, 40, 0.88);
            box-shadow: 0 0 14px rgba(111, 211, 255, 0.22);
            transform: translateY(-1px);
        }
        .bedroom-opt-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(90deg, rgba(111,211,255,0.04) 0%, rgba(0,0,0,0) 100%);
            opacity: 0;
            transition: opacity 0.2s;
        }
        .bedroom-opt-card:hover::before {
            opacity: 1;
        }
        .bedroom-opt-name {
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .bedroom-opt-desc {
            font-size: 11px;
            opacity: 0.72;
            line-height: 1.4;
        }
        .bedroom-opt-effect {
            font-size: 10px;
            font-weight: 600;
            color: #ffd166;
            margin-top: 2px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
        .room-hotspot {
            animation: uie-hotspot-reveal 0.95s ease-in-out 4;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.42), 0 0 18px rgba(203,163,92,0.55) !important;
        }
        @keyframes uie-hotspot-reveal {
            0% { transform: scale(0.96); opacity: 0.68; }
            50% { transform: scale(1.05); opacity: 1; }
            100% { transform: scale(1); opacity: 0.9; }
        }

        /* Live decoration component placements style */
        .placed-room-item {
            position: absolute;
            transform: translate(-50%, -50%);
            z-index: 5;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: auto;
            border-radius: 8px;
            padding: 6px 12px;
            font-weight: 700;
            font-size: 11px;
            text-shadow: 0 1px 4px rgba(0,0,0,0.6);
            border: 1px solid rgba(111, 211, 255, 0.25);
            background: rgba(10, 16, 24, 0.75);
            color: #e6f4ff;
            backdrop-filter: blur(6px);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        }
        .placed-room-item:hover {
            transform: translate(-50%, -52%) scale(1.05);
            border-color: rgba(111, 211, 255, 0.75);
            box-shadow: 0 0 16px rgba(111, 211, 255, 0.55);
            color: #fff;
        }
        .placed-item-glow {
            position: absolute;
            inset: -4px;
            border-radius: 12px;
            border: 1px solid rgba(111, 211, 255, 0.1);
            animation: pulse-glow 2s infinite ease-in-out;
            pointer-events: none;
        }
        @keyframes pulse-glow {
            0% { opacity: 0.25; transform: scale(1.0); }
            50% { opacity: 0.65; transform: scale(1.05); }
            100% { opacity: 0.25; transform: scale(1.0); }
        }
        .edit-room-temp-marker {
            position: absolute;
            width: 24px;
            height: 24px;
            transform: translate(-50%, -50%);
            border: 2px dashed #00ffff;
            border-radius: 50%;
            box-shadow: 0 0 10px #00ffff, inset 0 0 10px #00ffff;
            z-index: 10000;
            pointer-events: none;
            animation: temp-marker-pulse 1.2s infinite ease-in-out;
        }
        .edit-room-temp-marker::after {
            content: '';
            position: absolute;
            left: 50%; top: 50%;
            width: 6px; height: 6px;
            transform: translate(-50%, -50%);
            background: #00ffff;
            border-radius: 50%;
            box-shadow: 0 0 6px #00ffff;
        }
        @keyframes temp-marker-pulse {
            0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.7; }
            50% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.7; }
        }
        .in-edit-mode, .in-edit-mode * {
            cursor: crosshair !important;
        }

        /* early 2000s desktop simulator */
        .crt-desktop {
            display: flex;
            flex-direction: column;
            height: 360px;
            background: #060f0a;
            font-family: 'Courier New', Courier, monospace;
            color: #8cffb3;
            border: 1px solid #1f4a30;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: inset 0 0 16px rgba(0,255,110,0.06);
            font-size: 12px;
        }
        .crt-header {
            background: #0d2116;
            padding: 6px 12px;
            font-weight: 800;
            font-size: 11px;
            border-bottom: 1px solid #1f4a30;
            display: flex;
            justify-content: space-between;
            align-items: center;
            letter-spacing: 0.08em;
            color: #aeffcb;
        }
        .crt-body {
            flex: 1;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            overflow-y: auto;
        }
        .crt-icon-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
            gap: 12px;
            padding: 10px;
        }
        .crt-icon {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            text-align: center;
            padding: 8px 4px;
            border-radius: 4px;
            border: 1px solid transparent;
            transition: all 0.18s;
        }
        .crt-icon:hover {
            background: rgba(31, 74, 48, 0.2);
            border-color: rgba(31, 74, 48, 0.45);
        }
        .crt-icon i {
            font-size: 24px;
            color: #afffcd;
        }
        .crt-icon-text {
            font-size: 10px;
            font-weight: 700;
        }
        .crt-mail-row {
            border: 1px solid rgba(31, 74, 48, 0.4);
            background: rgba(0, 0, 0, 0.15);
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            transition: background 0.18s;
        }
        .crt-mail-row:hover {
            background: rgba(31, 74, 48, 0.22);
            border-color: #388455;
        }
        .crt-mail-unread {
            font-weight: 800;
            color: #fff;
        }
        .crt-textarea {
            width: 100%;
            background: #040906;
            border: 1px solid #1f4a30;
            color: #8cffb3;
            font-family: inherit;
            padding: 6px;
            border-radius: 4px;
            box-sizing: border-box;
            resize: none;
        }
        .crt-textarea:focus {
            outline: none;
            border-color: #388455;
        }

        /* Split-Pane Costume Designer style overrides */
        .closet-designer-split {
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 16px;
        }
        @media(max-width: 768px) {
            .closet-designer-split {
                grid-template-columns: 1fr;
            }
        }
        .closet-preview-card {
            background: linear-gradient(135deg, rgba(10,16,24,0.85) 0%, rgba(20,30,45,0.92) 100%);
            border: 1px solid rgba(111,211,255,0.22);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 260px;
            position: relative;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }
        .closet-preview-frame {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: rgba(0,0,0,0.4);
            border: 2px solid rgba(111,211,255,0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 42px;
            color: #6fd3ff;
            margin-bottom: 12px;
            box-shadow: 0 0 20px rgba(111, 211, 255, 0.25);
            overflow: hidden;
        }
        .closet-preview-frame img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .closet-preview-name {
            font-size: 15px;
            font-weight: 800;
            color: #fff;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .closet-preview-desc {
            font-size: 11px;
            opacity: 0.75;
            text-align: center;
            line-height: 1.4;
            max-width: 240px;
            margin-bottom: 12px;
        }
        .closet-preview-badge {
            font-size: 9px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 12px;
            background: rgba(111, 211, 255, 0.15);
            color: #6fd3ff;
            border: 1px solid rgba(111, 211, 255, 0.35);
            text-transform: uppercase;
        }
    `;
    document.head.appendChild(style);
}

// Wire hotspot click events
function wireRoomHotspots() {
    const parent = document.getElementById("room-hotspot-layer");
    if (!parent) return;
    parent.innerHTML = "";
    parent.style.display = "none";
    return;

    const s = ensureUiSettings();
    const campaign = getActiveCampaign(s);
    const loc = getCurrentLocationName().toLowerCase();

    if (loc === "player room" || loc === "bedroom" || loc.includes("bedroom")) {
        if (!document.getElementById("hs-study")) {
            parent.innerHTML = `
                <button id="hs-study" class="room-hotspot" title="Study" style="left:12%; top:45%; width:16%; height:12%;">Study</button>
                <button id="hs-bed" class="room-hotspot" title="Rest" style="left:38%; top:60%; width:18%; height:14%;">Rest</button>
                <button id="hs-computer" class="room-hotspot" title="Computer" style="left:60%; top:48%; width:14%; height:12%;">Computer</button>
                <button id="hs-closet" class="room-hotspot" title="Closet" style="left:80%; top:25%; width:14%; height:40%;">Closet</button>
                <button id="hs-read" class="room-hotspot" title="Read" style="left:36%; top:30%; width:12%; height:12%;">Read</button>
                <button id="hs-practice" class="room-hotspot" title="Practice" style="left:57%; top:22%; width:16%; height:12%;">Practice</button>
            `;
        }

        // Bind clicks directly
        $("#hs-study").off("click").on("click", (e) => {
            e.preventDefault();
            showStudyMenu();
        });

        $("#hs-bed").off("click").on("click", (e) => {
            e.preventDefault();
            showBedMenu();
        });

        $("#hs-read").off("click").on("click", (e) => {
            e.preventDefault();
            showReadMenu();
        });

        $("#hs-practice").off("click").on("click", (e) => {
            e.preventDefault();
            showPracticeMenu();
        });

        $("#hs-computer").off("click").on("click", (e) => {
            e.preventDefault();
            $("#computer-modal").css("display", "flex");
            initCrtDesktopUI();
        });

        $("#hs-closet").off("click").on("click", (e) => {
            e.preventDefault();
            
            // Show modal overlay
            const modal = document.getElementById("outfit-create-modal");
            if (!modal) return;
            
            modal.style.display = "flex";
            
            // Transform the modal into an elegant split pane
            const card = modal.querySelector(".modal-card");
            if (card) {
                card.style.maxWidth = "960px";
                card.style.width = "95vw";
                card.style.height = "90vh";
                card.style.maxHeight = "800px";
                card.style.display = "grid";
                card.style.gridTemplateColumns = "320px 1fr";
                card.style.gridTemplateRows = "auto 1fr auto";
                card.style.gridTemplateAreas = `
                    "header header"
                    "sidebar pane"
                    "footer footer"
                `;
                card.style.gap = "14px";
                card.style.padding = "16px";
                card.style.background = "linear-gradient(135deg, #1b1612, #0d0a08)";
                card.style.border = "2px solid #e1c17a";
                card.style.boxShadow = "0 20px 60px rgba(0,0,0,0.85)";
            }
        });
    } else {
        parent.innerHTML = "";
    }
}

// 1. Study Hotspot Menu
function showStudyMenu() {
    const modal = document.getElementById("room-action-modal");
    if (!modal) return;
    
    document.getElementById("room-action-title").textContent = "Study Terminal";
    
    const content = document.getElementById("room-action-content");
    content.innerHTML = `
        <div class="bedroom-action-subtitle">Dedicate your focus to study, craft, training, or technical mastery. Advancing time builds core attributes.</div>
        <div class="bedroom-options-grid">
            <div class="bedroom-opt-card" data-study-topic="uie_control">
                <div class="bedroom-opt-name"><i class="fas fa-wave-square" style="color: #6fd3ff;"></i> Focus & Breath Training</div>
                <div class="bedroom-opt-desc">Practice steady breathing, posture, and attention drills. Strong execution starts with control.</div>
                <div class="bedroom-opt-effect">Effect: +1 Spirit (spi) · Cost: 1 hour (60m)</div>
            </div>
            <div class="bedroom-opt-card" data-study-topic="songwriting">
                <div class="bedroom-opt-name"><i class="fas fa-pen-nib" style="color: #ffd166;"></i> Planning & Composition</div>
                <div class="bedroom-opt-desc">Draft notes, tactics, formulas, or designs. Strong plans require analytical grit.</div>
                <div class="bedroom-opt-effect">Effect: +1 Intelligence (int) · Cost: 1 hour (60m)</div>
            </div>
            <div class="bedroom-opt-card" data-study-topic="choreography">
                <div class="bedroom-opt-name"><i class="fas fa-shoe-prints" style="color: #9a8cff;"></i> Movement & Spatial Practice</div>
                <div class="bedroom-opt-desc">Move through the room, test timing, and rehearse how you handle the space around you.</div>
                <div class="bedroom-opt-effect">Effect: +1 Dexterity (dex) · Cost: 1 hour (60m)</div>
            </div>
        </div>
    `;
    
    // Bind click events
    $(content).find(".bedroom-opt-card").off("click").on("click", function() {
        const topic = $(this).data("study-topic");
        applyStudyTopic(topic);
        modal.style.display = "none";
    });
    
    modal.style.display = "flex";
}

function applyStudyTopic(topic) {
    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};
    const stats = s.character.stats;
    
    let label = "";
    if (topic === "uie_control") {
        stats.spi = (Number(stats.spi || 10) + 1);
        label = "Focus and Breath Control";
        injectRpEvent(`[System: You spent 1 hour studying ${label}. Spirit (SPI) increased by +1!]`);
    } else if (topic === "songwriting") {
        stats.int = (Number(stats.int || 10) + 1);
        label = "Planning and Composition";
        injectRpEvent(`[System: You spent 1 hour studying ${label}. Intelligence (INT) increased by +1!]`);
    } else if (topic === "choreography") {
        stats.dex = (Number(stats.dex || 10) + 1);
        label = "Stage Choreography";
        injectRpEvent(`[System: You spent 1 hour studying ${label}. Dexterity (DEX) increased by +1!]`);
    }
    
    // Advance World Time by 1 hour (60 minutes)
    advanceWorldTimeMinutes(s, 60, { reason: `Studied ${label}` });
    saveSettings();
    
    
    const content = document.getElementById("room-action-content");
    content.innerHTML = `
        <div class="bedroom-action-subtitle">Resting allows your body to heal and replenishes vital energy pools required for performing.</div>
        <div class="bedroom-options-grid">
            <div class="bedroom-opt-card" data-sleep-type="nap">
                <div class="bedroom-opt-name"><i class="fas fa-hourglass-half" style="color: #6fd3ff;"></i> Take a Short Nap</div>
                <div class="bedroom-opt-desc">Rest your eyes briefly. Perfect for a quick reset between demanding actions.</div>
                <div class="bedroom-opt-effect">Effect: Restores 35% HP & Stamina (AP) · Cost: 1 hour (60m)</div>
            </div>
            <div class="bedroom-opt-card" data-sleep-type="sleep">
                <div class="bedroom-opt-name"><i class="fas fa-moon" style="color: #ffd166;"></i> Deep Restful Sleep</div>
                <div class="bedroom-opt-desc">Shut down fully for the night. Relieves major exhaustions and returns you to peak shape.</div>
                <div class="bedroom-opt-effect">Effect: Fully Restores HP, Mana (MP), and Stamina (AP) · Cost: 8 hours</div>
            </div>
        </div>
    `;
    
    // Bind click events
    $(content).find(".bedroom-opt-card").off("click").on("click", function() {
        const type = $(this).data("sleep-type");
        applySleep(type);
        modal.style.display = "none";
    });
    
    modal.style.display = "flex";
}

function applySleep(type) {
    const s = getSettings();
    if (!s.character) s.character = {};
    
    // Max stats check
    const maxHp = Number(s.maxHp || s.character.maxHp || 100);
    const maxAp = Number(s.maxAp || s.character.maxAp || 10);
    const maxMp = Number(s.maxMp || s.character.maxMp || 50);
    
    if (type === "nap") {
        s.hp = Math.min(maxHp, Math.round(Number(s.hp || 0) + maxHp * 0.35));
        s.ap = Math.min(maxAp, Math.round(Number(s.ap || 0) + maxAp * 0.35));
        s.character.hp = s.hp;
        s.character.ap = s.ap;
        
        injectRpEvent(`[System: You took a short nap. Restored HP and Stamina (AP) by +35%!]`);
        advanceWorldTimeMinutes(s, 60, { reason: "Took a Nap" });
    } else if (type === "sleep") {
        s.hp = maxHp;
        s.ap = maxAp;
        s.mp = maxMp;
        s.character.hp = s.hp;
        s.character.ap = s.ap;
        s.character.mp = s.mp;
        
        injectRpEvent(`[System: You slept deeply for 8 hours. All health and energy vitals are fully restored!]`);
        advanceWorldTimeMinutes(s, 480, { reason: "Deep Night Sleep" });
    }
    
    saveSettings();
    
    // Trigger updates
    if (typeof window.updateHudFromState === "function") window.updateHudFromState();
    if (typeof window.updateVitals === "function") window.updateVitals();
    try { $(document).trigger("uie:updateVitals"); } catch (_) {}
}

// 3. Read Hotspot Menu
function showReadMenu() {
    const modal = document.getElementById("room-action-modal");
    if (!modal) return;
    
    document.getElementById("room-action-title").textContent = "Bookshelf & Reading Corner";
    
    const content = document.getElementById("room-action-content");
    content.innerHTML = `
        <div class="bedroom-action-subtitle">Study industry manuals, guides, or cultural trends to expand your intellect.</div>
        <div class="bedroom-options-grid">
            <div class="bedroom-opt-card" data-read-book="uie_guide">
                <div class="bedroom-opt-name"><i class="fas fa-book-open" style="color: #6fd3ff;"></i> Practical Field Guide</div>
                <div class="bedroom-opt-desc">Read techniques, safety notes, maps, recipes, contracts, or procedures relevant to the current story.</div>
                <div class="bedroom-opt-effect">Effect: +1 Wisdom (wis) · Cost: 1 hour (60m)</div>
            </div>
            <div class="bedroom-opt-card" data-read-book="trends">
                <div class="bedroom-opt-name"><i class="fas fa-newspaper" style="color: #ffd166;"></i> Local News & Scene Notes</div>
                <div class="bedroom-opt-desc">Catch up on rumors, culture, prices, routes, and people shaping the current location.</div>
                <div class="bedroom-opt-effect">Effect: +1 Perception (per) · Cost: 1 hour (60m)</div>
            </div>
        </div>
    `;
    
    // Bind click events
    $(content).find(".bedroom-opt-card").off("click").on("click", function() {
        const book = $(this).data("read-book");
        applyRead(book);
        modal.style.display = "none";
    });
    
    modal.style.display = "flex";
}

function applyRead(book) {
    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};
    const stats = s.character.stats;
    
    let label = "";
    if (book === "uie_guide") {
        stats.wis = (Number(stats.wis || 10) + 1);
        label = "Practical Field Guide";
        injectRpEvent(`[System: You read ${label}. Wisdom (WIS) increased by +1!]`);
    } else if (book === "trends") {
        stats.per = (Number(stats.per || 10) + 1);
        label = "Fashion Scene Magazine";
        injectRpEvent(`[System: You read ${label}. Perception (PER) increased by +1!]`);
    }
    
    advanceWorldTimeMinutes(s, 60, { reason: `Read ${label}` });
    saveSettings();
    
    if (typeof window.updateHudFromState === "function") window.updateHudFromState();
    if (typeof window.renderStats === "function") window.renderStats();
}

// 4. Practice Hotspot Menu
function showPracticeMenu() {
    const modal = document.getElementById("room-action-modal");
    if (!modal) return;
    
    document.getElementById("room-action-title").textContent = "Practice Space";
    
    const content = document.getElementById("room-action-content");
    content.innerHTML = `
        <div class="bedroom-action-subtitle">Warm up, drill a technique, or rehearse a practical action for the current role.</div>
        <div class="bedroom-options-grid">
            <div class="bedroom-opt-card" data-practice="uie_scale">
                <div class="bedroom-opt-name"><i class="fas fa-music" style="color: #9a8cff;"></i> Intense Technique Drills</div>
                <div class="bedroom-opt-desc">Warm up and repeat a demanding technique until it feels reliable.</div>
                <div class="bedroom-opt-effect">Effect: +1 Spirit (spi) · Cost: 1 hour (60m)</div>
            </div>
            <div class="bedroom-opt-card" data-practice="mirror">
                <div class="bedroom-opt-name"><i class="fas fa-hand-fist" style="color: #ffd166;"></i> Presence & Confidence</div>
                <div class="bedroom-opt-desc">Practice calm delivery, posture, and decisive action in front of the mirror.</div>
                <div class="bedroom-opt-effect">Effect: +1 Charisma (cha) · Cost: 1 hour (60m)</div>
            </div>
        </div>
    `;
    
    // Bind click events
    $(content).find(".bedroom-opt-card").off("click").on("click", function() {
        const item = $(this).data("practice");
        applyPractice(item);
        modal.style.display = "none";
    });
    
    modal.style.display = "flex";
}

function applyPractice(item) {
    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};
    const stats = s.character.stats;
    
    let label = "";
    if (item === "uie_scale") {
        stats.spi = (Number(stats.spi || 10) + 1);
        label = "Technique Drills";
        injectRpEvent(`[System: You ran intensive technique drills. Spirit (SPI) increased by +1!]`);
    } else if (item === "mirror") {
        stats.cha = (Number(stats.cha || 10) + 1);
        label = "Stage Posing";
        injectRpEvent(`[System: You practiced microphone presence. Charisma (CHA) increased by +1!]`);
    }
    
    advanceWorldTimeMinutes(s, 60, { reason: `Practice: ${label}` });
    saveSettings();
    
    if (typeof window.updateHudFromState === "function") window.updateHudFromState();
    if (typeof window.renderStats === "function") window.renderStats();
}

// 5. Early 2000s CRT Desktop Emulator
function wireCrtComputer() {
    // Click hs-computer -> show computer-modal
    $("#hs-computer").off("click").on("click", (e) => {
        e.preventDefault();
        $("#computer-modal").css("display", "flex");
        initCrtDesktopUI();
    });

    // Wire Login
    $("#pc-login-btn").off("click").on("click", () => {
        const user = $("#pc-user").val();
        const pass = $("#pc-pass").val();
        
        if (user === "player" && pass === "player") {
            $("#pc-login-panel").hide();
            $("#pc-desktop-panel").show();
            currentCrtApp = "desktop";
            renderCrtDesktopContent();
            injectRpEvent("[System: You logged in successfully to your Bedroom Computer.]");
        } else {
            alert("INCORRECT CREDENTIALS (hint: player / player)");
        }
    });

    // Close pc
    $("#pc-close").off("click").on("click", () => {
        $("#computer-modal").hide();
    });

    // Wire early 2000s desktop actions
    $("#pc-open-mail").off("click").on("click", () => {
        openCrtApp("mail");
    });
    $("#pc-open-forum").off("click").on("click", () => {
        openCrtApp("forum");
    });
    $("#pc-open-web").off("click").on("click", () => {
        openCrtApp("browser");
    });
}

function initCrtDesktopUI() {
    // Reset state
    $("#pc-login-panel").show();
    $("#pc-desktop-panel").hide();
    $("#pc-user").val("player");
    $("#pc-pass").val("player");
    $("#pc-screen").html("SYSTEM READY // LOGIN REQUIRED");
}

function openCrtApp(app) {
    currentCrtApp = app;
    renderCrtDesktopContent();
}

function renderCrtDesktopContent() {
    const screen = document.getElementById("pc-screen");
    if (!screen) return;

    if (currentCrtApp === "desktop") {
        screen.innerHTML = `
            <div class="crt-desktop">
                <div class="crt-header">
                    <span>DESKTOP OS v2.06</span>
                    <span>12:00 PM</span>
                </div>
                <div class="crt-body">
                    <div style="font-weight:700; margin-bottom:10px;">WELCOME TO MUSE OS. CHOOSE AN INTERFACE:</div>
                    <div class="crt-icon-grid">
                        <div class="crt-icon" onclick="document.getElementById('pc-open-mail').click()">
                            <i class="fas fa-envelope"></i>
                            <div class="crt-icon-text">MAILBOX</div>
                        </div>
                        <div class="crt-icon" onclick="document.getElementById('pc-open-forum').click()">
                            <i class="fas fa-users"></i>
                            <div class="crt-icon-text">FORUM</div>
                        </div>
                        <div class="crt-icon" onclick="document.getElementById('pc-open-web').click()">
                            <i class="fas fa-globe"></i>
                            <div class="crt-icon-text">BROWSER</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (currentCrtApp === "mail") {
        let mailListHtml = crtMailbox.map(m => `
            <div class="crt-mail-row" data-mail-id="${m.id}">
                <div>
                    <span class="crt-mail-unread">■</span>
                    <span style="font-weight:700;">${m.from}</span>
                </div>
                <div class="crt-mail-subject">${m.subject}</div>
                <div style="opacity:0.7;">${m.date}</div>
            </div>
        `).join("");

        screen.innerHTML = `
            <div class="crt-desktop">
                <div class="crt-header">
                    <span>MUSE-MAIL CLIENT</span>
                    <button class="crt-btn" id="crt-back-to-desktop">Desktop</button>
                </div>
                <div class="crt-body">
                    <div style="font-weight:700; margin-bottom:8px; border-bottom:1px solid #1f4a30; padding-bottom:4px;">INBOX (3 messages)</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${mailListHtml}
                    </div>
                </div>
            </div>
        `;

        // Bind events
        $("#crt-back-to-desktop").on("click", () => openCrtApp("desktop"));
        $(".crt-mail-row").on("click", function() {
            const id = $(this).data("mail-id");
            showCrtEmail(id);
        });
    } else if (currentCrtApp === "forum") {
        let threadsHtml = crtForum.map(f => `
            <div class="crt-mail-row" data-forum-id="${f.id}" style="justify-content: flex-start; gap: 20px;">
                <span style="font-weight:700;">${f.title}</span>
                <span style="opacity:0.6; margin-left:auto;">${f.comments.length} replies</span>
            </div>
        `).join("");

        screen.innerHTML = `
            <div class="crt-desktop">
                <div class="crt-header">
                    <span>UIE FUGUE INDIE BOARD v0.9b</span>
                    <button class="crt-btn" id="crt-back-to-desktop">Desktop</button>
                </div>
                <div class="crt-body">
                    <div style="font-weight:700; margin-bottom:8px; border-bottom:1px solid #1f4a30; padding-bottom:4px;">POPULAR DISCUSSIONS</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${threadsHtml}
                    </div>
                </div>
            </div>
        `;

        $("#crt-back-to-desktop").on("click", () => openCrtApp("desktop"));
        $(".crt-mail-row").on("click", function() {
            const id = $(this).data("forum-id");
            showCrtForumThread(id);
        });
    } else if (currentCrtApp === "browser") {
        screen.innerHTML = `
            <div class="crt-desktop">
                <div class="crt-header">
                    <span>MUSE-NET GRAPHIC WEB BROWSER v1.00</span>
                    <button class="crt-btn" id="crt-back-to-desktop">Desktop</button>
                </div>
                <div class="crt-body" style="padding:0;">
                    <div style="background:#0d2116; border-bottom:1px solid #1f4a30; padding:6px 12px; display:flex; gap:8px;">
                        <input id="browser-address" class="crt-textarea" style="height:26px; line-height:26px; padding:0 8px; flex:1;" value="http://www.geocities.com/music_circle">
                        <button class="crt-btn" id="browser-go">GO</button>
                    </div>
                    <div id="browser-content" style="padding:12px; overflow-y:auto; flex:1;">
                        <div style="text-align:center; font-weight:800; font-size:16px; margin-bottom:12px; color:#fff; text-shadow:0 0 8px rgba(255,255,255,0.2);">
                            ★★★ ~ WELCOME TO GEOCITIES MUSIC CIRCLE ~ ★★★
                        </div>
                        <div style="border:1px dashed #1f4a30; padding:10px; margin-bottom:12px; background:rgba(0,0,0,0.2); line-height:1.4;">
                            Hello, welcome to my personal worldbuilding page. I collect field notes, room sketches, weird maps, and local rumors. Please sign my guestbook below!
                        </div>
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            <label>Sign Guestbook:</label>
                            <textarea id="guestbook-msg" class="crt-textarea" rows="2" placeholder="Great website..."></textarea>
                            <button class="crt-btn" id="guestbook-submit" style="align-self:flex-start;">Submit Sign</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $("#crt-back-to-desktop").on("click", () => openCrtApp("desktop"));
        $("#guestbook-submit").on("click", () => {
            const val = $("#guestbook-msg").val().trim();
            if (val) {
                alert("GUESTBOOK SIGNED! Your message has been saved to Geocities music ring database.");
                injectRpEvent(`[System: You signed Geocities guestbook: "${val}"]`);
                $("#guestbook-msg").val("");
            }
        });
    }
}

function showCrtEmail(id) {
    const screen = document.getElementById("pc-screen");
    if (!screen) return;

    const mail = crtMailbox.find(m => m.id === id);
    if (!mail) return;

    screen.innerHTML = `
        <div class="crt-desktop">
            <div class="crt-header">
                <span>VIEWING MAIL</span>
                <button class="crt-btn" id="crt-back-to-mail">Back to Inbox</button>
            </div>
            <div class="crt-body">
                <div style="border-bottom:1px solid #1f4a30; padding-bottom:6px; margin-bottom:10px;">
                    <div><span style="font-weight:700; color:#fff;">From:</span> ${mail.from}</div>
                    <div><span style="font-weight:700; color:#fff;">Subject:</span> ${mail.subject}</div>
                    <div><span style="font-weight:700; color:#fff;">Date:</span> ${mail.date}</div>
                </div>
                <div style="line-height:1.45; white-space:pre-wrap; flex:1; overflow-y:auto; background:rgba(0,0,0,0.15); padding:8px; border-radius:4px; border:1px solid rgba(31, 74, 48, 0.25);">
                    ${mail.body}
                </div>
                <div style="margin-top:10px; display:flex; gap:8px;">
                    <textarea id="crt-mail-reply-text" class="crt-textarea" rows="2" placeholder="Type quick reply..."></textarea>
                    <button class="crt-btn" id="crt-mail-reply-btn">Reply</button>
                </div>
            </div>
        </div>
    `;

    $("#crt-back-to-mail").on("click", () => openCrtApp("mail"));
    $("#crt-mail-reply-btn").on("click", () => {
        const txt = $("#crt-mail-reply-text").val().trim();
        if (txt) {
            alert("REPLY TRANSMITTED VIA DIAL-UP SUCCESSFUL!");
            injectRpEvent(`[System: You replied to email from ${mail.from}: "${txt}"]`);
            advanceWorldTimeMinutes(getSettings(), 10, { reason: "Replying to email" });
            openCrtApp("mail");
        }
    });
}

function showCrtForumThread(id) {
    const screen = document.getElementById("pc-screen");
    if (!screen) return;

    const thread = crtForum.find(f => f.id === id);
    if (!thread) return;

    let commentsHtml = thread.comments.map(c => `
        <div style="border-bottom:1px dashed rgba(31, 74, 48, 0.4); padding-bottom:6px; margin-bottom:8px;">
            <div style="font-weight:800; color:#fff; font-size:10px; margin-bottom:2px;">@${c.author}</div>
            <div style="line-height:1.4;">${c.text}</div>
        </div>
    `).join("");

    screen.innerHTML = `
        <div class="crt-desktop">
            <div class="crt-header">
                <span>VIEWING THREAD</span>
                <button class="crt-btn" id="crt-back-to-board">Back to Board</button>
            </div>
            <div class="crt-body">
                <div style="font-weight:800; font-size:13px; color:#fff; margin-bottom:10px; border-bottom:1px solid #1f4a30; padding-bottom:6px;">
                    Thread: ${thread.title}
                </div>
                <div style="flex:1; overflow-y:auto; padding-right:6px;">
                    ${commentsHtml}
                </div>
                <div style="margin-top:10px; display:flex; gap:8px; align-items:end;">
                    <textarea id="crt-comment-text" class="crt-textarea" rows="2" placeholder="Write reply to board..."></textarea>
                    <button class="crt-btn" id="crt-comment-submit">Post</button>
                </div>
            </div>
        </div>
    `;

    $("#crt-back-to-board").on("click", () => openCrtApp("forum"));
    $("#crt-comment-submit").on("click", () => {
        const val = $("#crt-comment-text").val().trim();
        if (val) {
            thread.comments.push({ author: "RookiePlayer", text: val });
            injectRpEvent(`[System: You posted a reply in the Music Forum: "${val}"]`);
            advanceWorldTimeMinutes(getSettings(), 15, { reason: "Indie Board Posting" });
            showCrtForumThread(id);
        }
    });
}

// 6. Closet Split-Pane Costume Designer Modal
function wireClosetSplitPane() {
    // Click hs-closet -> show outfit-create-modal and convert it into a split pane popup
    $("#hs-closet").off("click").on("click", (e) => {
        e.preventDefault();
        
        // Show modal overlay
        const modal = document.getElementById("outfit-create-modal");
        if (!modal) return;
        
        modal.style.display = "flex";
        
        // Transform the modal into an elegant split pane
        const card = modal.querySelector(".modal-card");
        if (card) {
            // Apply high-end wide dimensions
            card.style.maxWidth = "960px";
            card.style.width = "95vw";
            
            // Check if split wrapper is already constructed, if not, construct it!
            if (!card.querySelector(".closet-designer-split")) {
                const titleBlock = card.firstElementChild;
                const actionsRow = card.lastElementChild;
                
                // Collect all intermediate content (the forms)
                const intermediateElements = Array.from(card.children).slice(1, -1);
                
                // Create split container
                const splitWrapper = document.createElement("div");
                splitWrapper.className = "closet-designer-split";
                
                // Left pane container
                const leftPane = document.createElement("div");
                leftPane.className = "closet-left-form-pane";
                intermediateElements.forEach(el => leftPane.appendChild(el));
                
                // Right pane container (live costume preview card + custom css code editor)
                const rightPane = document.createElement("div");
                rightPane.className = "closet-right-preview-pane";
                rightPane.innerHTML = `
                    <div style="font-weight:800; font-size:12px; color:#6fd3ff; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;">Live Costume Card</div>
                    <div class="closet-preview-card" id="outfit-live-preview-card">
                        <div class="closet-preview-glow"></div>
                        <div class="closet-preview-frame">
                            <i class="fas fa-user-tie" id="outfit-preview-icon"></i>
                        </div>
                        <div class="closet-preview-name" id="outfit-preview-name-label">STREET STAGE FIT</div>
                        <div class="closet-preview-badge" id="outfit-preview-cat-badge">EVERYDAY</div>
                        <div class="closet-preview-desc" id="outfit-preview-desc-label">A sleek cyber jacket with neon blue linings, dark skinny jeans, combat boots, and steel necklaces.</div>
                        <div style="font-size:9px; opacity:0.6; text-transform:uppercase; letter-spacing:0.04em;">Equipment Slot ID: <span id="outfit-preview-slot-label" style="color:#6fd3ff;">outfit</span></div>
                    </div>
                    
                    <div style="margin-top:16px;">
                        <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span>Costume Custom CSS (applied to card)</span>
                            <span style="font-size:9px; opacity:0.6;">Selector: .closet-preview-card</span>
                        </label>
                        <textarea id="outfit-custom-css-editor" class="modal-textarea" rows="3" placeholder="box-shadow: 0 0 20px rgba(255, 209, 102, 0.4); border-color: #ffd166;" style="font-family:'Courier New', monospace; font-size:11px;"></textarea>
                    </div>
                `;
                
                splitWrapper.appendChild(leftPane);
                splitWrapper.appendChild(rightPane);
                
                // Insert split wrapper between title and bottom buttons
                card.insertBefore(splitWrapper, actionsRow);
            }
        }
        
        // Populates slot options from UIE engine layers
        populateClosetSlots();
        
        // Bind real-time preview listeners
        bindClosetPreviewSync();
    });

    // Wire Outfit Create Cancel button
    $("#outfit-create-cancel").off("click").on("click", () => {
        $("#outfit-create-modal").hide();
    });

    // Wire Outfit Create Save & Equip button
    $("#outfit-create-save").off("click").on("click", () => {
        saveAndEquipCustomOutfit();
    });

    // Wire AI assist tab toggle
    $(".outfit-tab-btn").off("click").on("click", function() {
        const tab = $(this).data("outfit-tab");
        $(".outfit-tab-btn").removeClass("active");
        $(this).addClass("active");
        
        if (tab === "manual") {
            $("#outfit-tab-manual").show();
            $("#outfit-tab-ai").hide();
        } else {
            $("#outfit-tab-manual").hide();
            $("#outfit-tab-ai").show();
        }
    });

    // Wire Outfit Create AI assist Generate button
    $("#outfit-create-generate").off("click").on("click", async () => {
        const genBtn = document.getElementById("outfit-create-generate");
        genBtn.textContent = "GENERATING COSTUME...";
        genBtn.disabled = true;

        try {
            const s = getSettings();
            const location = s?.worldState?.location || "Cosy bedroom";
            const prompt = `
                [OUTFIT GENERATION ENGINE]
                The player is currently in: ${location}.
                Generate a beautiful, descriptive, premium outfit themed around this scene and the player's current role.
                Return ONLY a valid JSON object matching this schema:
                {
                  "name": "Cozy Bedroom Lounge",
                  "description": "Comfy oversized grey knit sweater, neon purple headband, matching sleep shorts, and soft wool slippers. Perfect for midnight composition.",
                  "css": "background: linear-gradient(135deg, rgba(26,20,35,0.85) 0%, rgba(40,30,55,0.92) 100%); border-color: #9a8cff; box-shadow: 0 0 16px rgba(154, 140, 255, 0.3);"
                }
            `.trim();

            const response = await generateContent(prompt, "Create Outfit AI");
            const parsed = parseStrictJsonObject(response);
            
            if (parsed && typeof parsed === "object") {
                $("#outfit-create-name").val(parsed.name || "Cozy Bedroom Fit");
                $("#outfit-create-desc").val(parsed.description || "");
                if (parsed.css) {
                    $("#outfit-custom-css-editor").val(parsed.css);
                }
                
                // Switch back to manual so they can see and edit it
                $("[data-outfit-tab='manual']").click();
                
                // Trigger preview refresh
                syncOutfitLivePreview();
                
                injectRpEvent(`[System: AI generated custom outfit recommendation: "${parsed.name || "Fit"}"]`);
            }
        } catch (e) {
            console.error(e);
            alert("FAILED TO RUN AI ASSIST GENERATION. SWITCH TO MANUAL INSTEAD.");
        } finally {
            genBtn.textContent = "Generate from scene";
            genBtn.disabled = false;
        }
    });
}

function populateClosetSlots() {
    const select = document.getElementById("outfit-equip-slot");
    if (!select) return;

    select.innerHTML = `
        <option value="outfit">Body Outfit (Primary)</option>
        <option value="head">Head Accessories</option>
        <option value="chest">Chest Outerwear</option>
        <option value="hands">Gloves / Rings</option>
        <option value="feet">Boots / Footwear</option>
        <option value="accessory">General Accessories</option>
    `;
}

function bindClosetPreviewSync() {
    $("#outfit-create-name, #outfit-create-desc, #outfit-equip-slot, #outfit-category, #outfit-custom-css-editor").off("input change").on("input change", () => {
        syncOutfitLivePreview();
    });
}

function syncOutfitLivePreview() {
    const name = $("#outfit-create-name").val().trim() || "NEW OUTFIT FIT";
    const desc = $("#outfit-create-desc").val().trim() || "Type some flavor text to describe the vibe, materials, and colors of your clothing piece...";
    const slot = $("#outfit-equip-slot").val() || "outfit";
    const cat = $("#outfit-category").val() || "Everyday";
    const customCss = $("#outfit-custom-css-editor").val().trim();

    // Update textual nodes in right-pane Costume Card
    $("#outfit-preview-name-label").text(name);
    $("#outfit-preview-desc-label").text(desc);
    $("#outfit-preview-cat-badge").text(cat);
    $("#outfit-preview-slot-label").text(slot);

    // Apply live CSS style block to card selector
    const cardEl = document.getElementById("outfit-live-preview-card");
    if (cardEl) {
        // Clear previous style overrides
        cardEl.style.cssText = "";
        
        // Reapply default background + custom styling
        if (customCss) {
            try {
                cardEl.style.cssText = customCss;
            } catch (_) {}
        }
    }
}

function saveAndEquipCustomOutfit() {
    const name = $("#outfit-create-name").val().trim();
    const desc = $("#outfit-create-desc").val().trim();
    const slot = $("#outfit-equip-slot").val() || "outfit";
    const category = $("#outfit-category").val() || "Everyday";
    const customCss = $("#outfit-custom-css-editor").val().trim();
    const spriteRef = $("#outfit-sprite-ref").val().trim();
    const imgUrl = $("#outfit-image-url").val().trim();

    if (!name) {
        alert("OUTFIT NAME IS REQUIRED!");
        return;
    }

    const s = getSettings();
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.outfits)) s.inventory.outfits = [];

    const newOutfit = {
        name,
        description: desc,
        slotId: slot,
        category,
        css: customCss,
        spriteRef: spriteRef || null,
        imageUrl: imgUrl || null,
        equipped: true,
        ts: Date.now()
    };

    // Auto-unequip others in same slot
    s.inventory.outfits.forEach(o => {
        if (o.slotId === slot) o.equipped = false;
    });

    s.inventory.outfits.push(newOutfit);

    // Sync with playerRoom outfit key
    if (slot === "outfit") {
        if (!s.playerRoom) s.playerRoom = {};
        s.playerRoom.outfit = name;
    }

    saveSettings();

    // Fire events & alerts
    injectRpEvent(`[System: You created and equipped new costume: "${name}" in slot ${slot}!]`);
    $("#outfit-create-modal").hide();
    
    // Refresh stats if displayed
    if (typeof window.updateHudFromState === "function") window.updateHudFromState();
}

// 7. Advanced Location-Aware Room Editor Subsystem
// Ported from the sibling directory's advanced room editor with full
// compatibility layer for this workspace's module system.

// ─── Compatibility Helpers ────────────────────────────────────────────────

function ensureUiSettings() {
    const s = getSettings();
    if (!s.roomEditor || typeof s.roomEditor !== "object") s.roomEditor = {};
    if (!Array.isArray(s.roomEditor.placements)) s.roomEditor.placements = [];
    if (!s.roomEditor.slotBindings || typeof s.roomEditor.slotBindings !== "object") s.roomEditor.slotBindings = {};
    if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
    if (!s.playerProgress || typeof s.playerProgress !== "object") s.playerProgress = { hp: 100, maxHp: 100, uie: 0, skillPoints: 0, abilityPoints: 0, skills: {} };
    if (!s.playerProgress.skills || typeof s.playerProgress.skills !== "object") s.playerProgress.skills = {};
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    return s;
}

// Core module bridge — maps sibling's Core.saveSettings() to this module's saveSettings()
const Core = { saveSettings: () => saveSettings() };

// Api bridge — maps sibling's Api.generateContent to this module's imported generateContent
const Api = { generateContent: (prompt, mode) => generateContent(prompt, mode) };

function getActiveCampaign(s) {
    const st = s || ensureUiSettings();
    return String(st?.worldState?.campaign || st?.campaign?.id || st?.worldState?.campaignId || "default").trim();
}

function getDefaultStartLocation(campaign) {
    return "room_0_0_0";
}

function getCurrentLocationName() {
    const s = ensureUiSettings();
    return String(s?.worldState?.location || s?.worldState?.currentLocation || getDefaultStartLocation(getActiveCampaign(s))).trim();
}

function expandAssetCandidatePath(p) {
    const clean = String(p || "").trim();
    if (!clean) return [];
    return [clean, `./${clean}`, `../${clean}`, `/${clean}`];
}

function normalizeToken(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function importUieModule(path) {
    return import(`./${path}`);
}

function bumpTime(hours) {
    const s = ensureUiSettings();
    advanceWorldTimeMinutes(s, Math.max(1, Number(hours || 1)) * 60, { reason: "Room action" });
    saveSettings();
}

function showToast(msg, dur) {
    if (typeof window.showToast === "function") window.showToast(msg, dur || 3200);
}

function notify(level, msg, source) {
    if (typeof window.showToast === "function") {
        window.showToast(msg, 3200);
    } else {
        console.log(`[${source || "RoomEditor"}] ${level}: ${msg}`);
    }
}

// Stub for AI context cache — these are not implemented in this workspace
function getPlacementSignatureForAiCache(s) {
    const list = Array.isArray(s?.roomEditor?.placements) ? s.roomEditor.placements : [];
    return list.map(p => `${p?.slotId || ""}_${p?.assetId || ""}`).join("|");
}

function rebuildAiRoomContextCache(s) {
    const loc = getCurrentLocationName();
    const sig = getPlacementSignatureForAiCache(s);
    if (!s.worldState) s.worldState = {};
    s.worldState.aiRoomContext = { location: loc, sig, ts: Date.now() };
}

function renderCustomHudTrackers() {
    // Delegate to global if available
    if (typeof window.renderCustomHudTrackers === "function") window.renderCustomHudTrackers();
}

function updateHudFromState() {
    if (typeof window.updateHudFromState === "function") window.updateHudFromState();
}

// ─── Room Editor Constants & State ────────────────────────────────────────

const ROOM_ASSET_LIBRARY = {
    loft_v1: { title: "Loft", interactive: false, initScripts: [] },
    kitchen_v1: { title: "Kitchen", interactive: false, initScripts: [] },
    workbench_v1: { title: "Workbench", interactive: false, initScripts: [] },
    classroom_v1: { title: "Classroom", interactive: false, initScripts: [] },
    elevator_v1: { title: "Elevator Panel", interactive: true, initScripts: ["uieInitElevatorPanel"] },
    bed_v1: { title: "Bed", interactive: false, initScripts: [] },
    computer_v1: { title: "Computer Terminal", interactive: true, initScripts: ["openComputerModal"] },
    books_v1: { title: "Bookshelf", interactive: true, initScripts: ["openBooksModal"] },
    plant_overlay_04: { title: "Plant Overlay", interactive: false, initScripts: [] }
};

const ROOM_SLOT_TYPE_DEFINITIONS = {
    foundation: { size: "large", label: "Foundation Slots (Large)", description: "Walls, floors, ceilings, and large architectural windows." },
    utility: { size: "medium", label: "Utility Slots (Medium)", description: "Functional furniture like beds, desks, kitchen counters, or workbenches." },
    atmospheric: { size: "small", label: "Atmospheric Slots (Small)", description: "Interactive props like books, computers, plants, or clutter that sit on Utility slots." }
};

const ROOM_INTERACTION_SLOT_IDS = [
    "slot_bed", "slot_closet", "slot_book", "slot_journal", "slot_newspaper", "slot_magazine",
    "slot_computer_modern", "slot_computer_futuristic", "slot_laptop", "slot_tablet", "slot_terminal",
    "slot_monitor", "slot_projector", "slot_television", "slot_gaming_console", "slot_arcade_cabinet",
    "slot_microphone", "slot_speaker", "slot_headphones", "slot_radio", "slot_record_player",
    "slot_desk", "slot_table", "slot_chair", "slot_stool", "slot_sofa", "slot_bench", "slot_shelf",
    "slot_drawer", "slot_cabinet", "slot_safe", "slot_lockbox", "slot_box", "slot_backpack",
    "slot_fridge", "slot_stove", "slot_oven", "slot_microwave", "slot_sink", "slot_dishwasher",
    "slot_coffee_maker", "slot_toaster", "slot_blender", "slot_lamp", "slot_ceiling_light",
    "slot_fireplace", "slot_candle", "slot_flashlight", "slot_light_switch", "slot_thermostat",
    "slot_fan", "slot_heater", "slot_door", "slot_window", "slot_mirror", "slot_medicine_cabinet",
    "slot_toilet", "slot_bathtub", "slot_shower", "slot_computer", "slot_phone", "slot_camera",
    "slot_workbench", "slot_tool_box", "slot_printer", "slot_whiteboard", "slot_chalkboard",
    "slot_corkboard", "slot_poster", "slot_painting", "slot_plant", "slot_music_instrument",
    "slot_map", "slot_document", "slot_scroll", "slot_calendar", "slot_keys", "slot_keypad",
    "slot_spellbook", "slot_cauldron", "slot_forge", "slot_anvil", "slot_target_dummy",
    "slot_throne", "slot_altar", "slot_crystal_ball", "slot_wand", "slot_sword", "slot_shield",
    "slot_bow", "slot_armor_stand", "slot_weapon_rack", "slot_hologram_emitter", "slot_stasis_pod",
    "slot_teleporter", "slot_control_panel", "slot_server_rack", "slot_drone", "slot_scanner",
    "slot_generator", "slot_fuse_box", "slot_lever", "slot_button", "slot_switch", "slot_crank",
    "slot_elevator", "slot_ladder", "slot_stairs", "slot_trapdoor", "slot_mailbox", "slot_package",
    "slot_fire_extinguisher", "slot_fire_alarm", "slot_washing_machine", "slot_dryer",
    "slot_laundry_basket", "slot_vacuum", "slot_mop", "slot_broom", "slot_towel", "slot_soap_dispenser",
    "slot_barbell", "slot_dumbbell", "slot_treadmill", "slot_yoga_mat", "slot_punching_bag",
    "slot_first_aid_kit", "slot_med_pod", "slot_iv_stand", "slot_stethoscope", "slot_scalpel",
    "slot_handcuffs", "slot_baton", "slot_crowbar", "slot_chainsaw", "slot_tripwire"
];
const ROOM_INTERACTION_SLOT_SET = new Set(ROOM_INTERACTION_SLOT_IDS);

const ROOM_GENRE_PRESETS = {
    modern: [
        { id: "workspace", slotName: "The Workspace", assetId: "computer_v1", htmlPath: "assets/modern/workspace.html", slotType: "utility", purpose: "Interactive computer/journaling", content: "Desk + High-end PC + Coffee Mug" },
        { id: "sanctuary", slotName: "The Sanctuary", assetId: "bed_v1", htmlPath: "assets/modern/sanctuary.html", slotType: "utility", purpose: "Rest mechanics / Time skip", content: "Queen Bed + Nightstand + Reading Lamp" },
        { id: "social_hub", slotName: "The Social Hub", assetId: "kitchen_v1", htmlPath: "assets/modern/social_hub.html", slotType: "utility", purpose: "Cooking / Dialogue scenes", content: "Kitchen Island + Stools + Fridge" }
    ],
    cyberpunk: [
        { id: "rig", slotName: "The Rig", assetId: "computer_v1", htmlPath: "assets/cyber/rig.html", slotType: "utility", purpose: "Hacking / Data retrieval", content: "Holographic Displays + Wired Chair" },
        { id: "capsule", slotName: "The Capsule", assetId: "bed_v1", htmlPath: "assets/cyber/capsule.html", slotType: "utility", purpose: "Small living quarters", content: "Wall-mounted bunk + Neon LED strips" },
        { id: "med_bay", slotName: "The Med-Bay", assetId: "bed_v1", htmlPath: "assets/cyber/med_bay.html", slotType: "utility", purpose: "Healing / Augmentation", content: "Surgical Bed + Monitor + IV Stand" }
    ],
    fantasy: [
        { id: "hearth", slotName: "The Hearth", assetId: "kitchen_v1", htmlPath: "assets/fantasy/hearth.html", slotType: "foundation", purpose: "Crafting / Warmth", content: "Stone Fireplace + Cauldron + Rug" },
        { id: "alchemist", slotName: "The Alchemist", assetId: "kitchen_v1", htmlPath: "assets/fantasy/alchemist.html", slotType: "utility", purpose: "Potion making / Research", content: "Workbench + Vials + Mortar/Pestle" },
        { id: "armory", slotName: "The Armory", assetId: "workbench_v1", htmlPath: "assets/fantasy/armory.html", slotType: "utility", purpose: "Gear management", content: "Weapon Rack + Anvil + Shield Mount" }
    ],
    academic_horror: [
        { id: "archive", slotName: "The Archive", assetId: "books_v1", htmlPath: "assets/academic/archive.html", slotType: "foundation", purpose: "Lore discovery", content: "Ceiling-high Bookshelves + Ladder" },
        { id: "lecture", slotName: "The Lecture", assetId: "classroom_v1", htmlPath: "assets/academic/lecture.html", slotType: "utility", purpose: "Skill leveling / Classes", content: "Row of Desks + Chalkboard" },
        { id: "elevator", slotName: "The Elevator", assetId: "elevator_v1", htmlPath: "assets/slots/slot_elevator.html", slotType: "utility", purpose: "Floor selection / Vertical travel", content: "Call buttons + Floor panel" },
        { id: "infirmary", slotName: "The Infirmary", assetId: "bed_v1", htmlPath: "assets/academic/infirmary.html", slotType: "utility", purpose: "Healing / Psychological recovery", content: "Gurney + Privacy Curtain + Medical Tray" }
    ]
};

let roomEditArmed = false;
let roomDragState = null;

// ─── Room Editor Utility Functions ────────────────────────────────────────

function roomAssetCategories() {
    return {
        domestic: ["kitchen_v1", "bed_v1", "loft_v1", "books_v1", "computer_v1"],
        education: ["classroom_v1", "books_v1", "computer_v1"],
        commercial: ["workbench_v1", "computer_v1"],
        decor: ["plant_overlay_04"]
    };
}

function setRoomHotspotsVisibility() {
    const s = ensureUiSettings();
    const campaign = getActiveCampaign(s);
    const loc = String(s?.worldState?.location || "").toLowerCase();

    // Dynamically inject/empty hotspots and bind event handlers
    const hotspotLayer = document.getElementById("room-hotspot-layer");
    if (hotspotLayer) {
        hotspotLayer.innerHTML = "";
        hotspotLayer.style.display = "none";
    }

    const hasRoomComponents = getRoomPlacementsForLocation(s).length > 0;

    console.log(`[UIE] setRoomHotspotsVisibility campaign='${campaign}' loc='${loc}' hotspots=false components=${hasRoomComponents}`);
    $("#room-hotspot-layer").hide().empty();
    $("#room-components-layer").toggle(hasRoomComponents);
}
window.setRoomHotspotsVisibility = setRoomHotspotsVisibility;

function getRoomSlots() {
    const slotTypeMap = {
        "hs-study": "utility",
        "hs-bed": "utility",
        "hs-computer": "atmospheric",
        "hs-closet": "utility",
        "hs-read": "atmospheric",
        "hs-practice": "utility"
    };
    const slots = Array.from(document.querySelectorAll(".room-hotspot")).map((el) => {
        const slotId = String(el.id || "").trim();
        const label = String(el.title || slotId || "slot").trim();
        const st = String(el.getAttribute("style") || "");
        const left = Number((st.match(/left:\s*([0-9.]+)%/i) || [])[1] || 50) / 100;
        const top = Number((st.match(/top:\s*([0-9.]+)%/i) || [])[1] || 50) / 100;
        const slotType = slotTypeMap[slotId] || "utility";
        return { slotId, label, slotType, coordinates: { x: left, y: top } };
    }).filter((x) => x.slotId);
    return slots;
}

function makeFreeRoomSlotId() {
    const s = ensureUiSettings();
    const loc = String(s?.worldState?.location || "location").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return `free_${loc}_${Date.now()}`;
}

function ensureFreeRoomPreviewEl() {
    let el = document.getElementById("room-free-preview");
    if (el) return el;
    const host = document.getElementById("game-root");
    if (!host) return null;
    el = document.createElement("div");
    el.id = "room-free-preview";
    el.style.cssText = "position:absolute;width:24px;height:24px;transform:translate(-50%,-50%);border:2px dashed #00ffff;border-radius:50%;box-shadow:0 0 10px #00ffff,inset 0 0 10px #00ffff;z-index:10000;pointer-events:none;display:none;";
    host.appendChild(el);
    return el;
}

function setFreeRoomPreview(coords, visible = true) {
    const el = ensureFreeRoomPreviewEl();
    if (!el) return;
    if (!visible) {
        el.style.display = "none";
        return;
    }
    const n = normalizeRoomCoordinates(coords || {});
    el.style.left = `${Math.round(n.x * 100)}%`;
    el.style.top = `${Math.round(n.y * 100)}%`;
    el.style.display = "block";
}

function hideFreeRoomPreview() {
    setFreeRoomPreview(null, false);
}

function normalizeRoomCoordinates(raw, fallback = { x: 0.5, y: 0.5 }) {
    const x0 = Number(raw?.x);
    const y0 = Number(raw?.y);
    const x = Number.isFinite(x0) ? Math.max(0, Math.min(1, x0)) : Number(fallback?.x || 0.5);
    const y = Number.isFinite(y0) ? Math.max(0, Math.min(1, y0)) : Number(fallback?.y || 0.5);
    return { x, y };
}

function syncEditRoomCoordInputs(coordsRaw = null) {
    let c = coordsRaw;
    if (!c) {
        try { c = JSON.parse(String($("#edit-room-coords").val() || "{}")); } catch (_) { c = null; }
    }
    const n = normalizeRoomCoordinates(c || {});
    $("#edit-room-x").val(n.x);
    $("#edit-room-y").val(n.y);
    $("#edit-room-coords").val(JSON.stringify(n));
    return n;
}

function normalizeInteractionSlotId(raw = "") {
    const txt = String(raw || "").trim().toLowerCase();
    if (!txt) return "";
    const norm = txt.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!norm) return "";
    return norm.startsWith("slot_") ? norm : `slot_${norm}`;
}

function inferInteractionSlotId({ slotId = "", assetId = "", description = "" } = {}) {
    const src = `${slotId} ${assetId} ${description}`.toLowerCase();
    if (/bed|sleep|nap|rest/.test(src)) return "slot_bed";
    if (/closet|wardrobe|outfit|wear/.test(src)) return "slot_closet";
    if (/book|read|manga|journal|library/.test(src)) return "slot_book";
    if (/computer|pc|terminal|laptop|monitor/.test(src)) return "slot_computer_modern";
    if (/elevator|lift|floor panel|call button/.test(src)) return "slot_elevator";
    if (/stove|fridge|kitchen|cook|oven|sink/.test(src)) return "slot_stove";
    if (/instrument|practice|music|drum|guitar|mic/.test(src)) return "slot_music_instrument";
    if (/desk|study/.test(src)) return "slot_desk";
    return "";
}

function getDefaultRoomSlotBindings() {
    return {
        "hs-study": "slot_desk",
        "hs-bed": "slot_bed",
        "hs-computer": "slot_computer_modern",
        "hs-closet": "slot_closet",
        "hs-read": "slot_book",
        "hs-practice": "slot_music_instrument"
    };
}

function normalizeLocationToken(raw = "") {
    return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferPlacementLocationToken(placement, s) {
    const src = placement && typeof placement === "object" ? placement : {};
    const direct = normalizeLocationToken(src.location || "");
    if (direct) return direct;
    const slotId = String(src.slotId || "").trim().toLowerCase();
    const freeMatch = slotId.match(/^free_(.+)_\d+$/);
    if (freeMatch && freeMatch[1]) return normalizeLocationToken(freeMatch[1]);
    const locMatch = slotId.match(/^loc_(.+)_(center|utility|atmo)$/);
    if (locMatch && locMatch[1]) return normalizeLocationToken(locMatch[1]);
    if (/^hs-/.test(slotId)) return "";
    return "";
}

function getRoomPlacementsForLocation(s, locationName = "") {
    const state = s || ensureUiSettings();
    const locToken = normalizeLocationToken(locationName || state?.worldState?.location || "");
    const list = Array.isArray(state?.roomEditor?.placements) ? state.roomEditor.placements : [];
    if (!locToken) return [];
    return list.filter((p) => inferPlacementLocationToken(p, state) === locToken);
}

function getPlacementBySlotId(slotId = "") {
    const s = ensureUiSettings();
    const sid = String(slotId || "");
    const list = getRoomPlacementsForLocation(s);
    return list.find((x) => String(x?.slotId || "") === sid) || null;
}

function parseRoomActionOverrides(raw = "") {
    const txt = String(raw || "").trim();
    if (!txt) return [];
    try {
        const arr = JSON.parse(txt);
        if (!Array.isArray(arr)) return [];
        return arr
            .map((x) => (x && typeof x === "object" ? x : null))
            .filter(Boolean)
            .map((x) => ({
                label: String(x.label || "").trim(),
                desc: String(x.desc || "").trim(),
                message: String(x.message || "").trim(),
                chat: String(x.chat || "").trim(),
                prompt: String(x.prompt || "").trim(),
                setOutfit: String(x.setOutfit || "").trim(),
                addItem: String(x.addItem || "").trim(),
                openComputer: x.openComputer === true,
                openMusic: x.openMusic === true,
                openKitchen: x.openKitchen === true,
                hp: Number(x.hp || 0),
                uie: Number(x.uie || 0),
                skillPoints: Number(x.skillPoints || 0),
                abilityPoints: Number(x.abilityPoints || 0),
                theory: Number(x.theory || 0),
                reading: Number(x.reading || 0),
                practice: Number(x.practice || 0),
                hours: Number(x.hours || 0)
            }))
            .filter((x) => x.label);
    } catch (_) {
        return [];
    }
}

function inferAssetFromDescription(desc = "", selectedGenre = "") {
    const d = String(desc || "").toLowerCase();
    const g = String(selectedGenre || "").toLowerCase();
    if (/kitchen|cook|stove|pantry|oven/.test(d)) return "kitchen_v1";
    if (/shop|store|merchant|counter|cashier/.test(d)) return "workbench_v1";
    if (/class|school|lecture|desk row/.test(d)) return "classroom_v1";
    if (/book|library|shelf/.test(d)) return "books_v1";
    if (/computer|pc|terminal|desktop|laptop/.test(d)) return "computer_v1";
    if (/bed|sleep|rest/.test(d)) return "bed_v1";
    if (/plant|green|leaf/.test(d)) return "plant_overlay_04";
    if (g === "cyberpunk") return "computer_v1";
    if (g === "fantasy") return "kitchen_v1";
    if (g === "academic_horror") return "books_v1";
    return "loft_v1";
}

function getGenrePresetList(selectedGenre = "modern") {
    return Array.isArray(ROOM_GENRE_PRESETS[selectedGenre]) ? ROOM_GENRE_PRESETS[selectedGenre] : [];
}
async function loadLocalAsset(htmlPath = "") {
    const p = String(htmlPath || "").trim();
    if (!p) return "";
    const variants = expandAssetCandidatePath(p);
    for (const candidate of variants) {
        try {
            const res = await fetch(candidate, { cache: "no-store" });
            if (!res.ok) continue;
            return await res.text();
        } catch (_) {}
    }
    return "";
}

// ─── Preset Application ──────────────────────────────────────────────────

async function applyPresetToSlot({ slotId, selectedGenre, presetId, userCustomCss = "", coordinates = null, interactionSlot = "", actions = [] } = {}) {
    const slot = getRoomSlots().find((x) => String(x.slotId) === String(slotId))
        || (slotId ? { slotId: String(slotId), label: "Free Placement Anchor", slotType: "utility", coordinates: normalizeRoomCoordinates(coordinates || {}) } : null);
    const list = getGenrePresetList(selectedGenre);
    const preset = list.find((x) => String(x.id || "") === String(presetId || "")) || null;
    if (!slot || !preset) return null;
    const html = await loadLocalAsset(preset.htmlPath);
    const plan = {
        action: "ADD_COMPONENT",
        target_asset: String(preset.assetId || "loft_v1"),
        slot_id: slot.slotId,
        slot_type: preset.slotType || slot.slotType || "utility",
        coordinates: normalizeRoomCoordinates(coordinates || slot.coordinates, slot.coordinates),
        custom_html: html || "",
        source_html_path: String(preset.htmlPath || ""),
        interaction_slot: normalizeInteractionSlotId(interactionSlot || inferInteractionSlotId({ slotId: slot.slotId, assetId: preset.assetId, description: preset.slotName || "" })),
        actions_json: Array.isArray(actions) ? actions : [],
        overrides: {
            css: "",
            addition: "",
            user_custom_css: String(userCustomCss || "")
        },
        init_scripts: Array.isArray(ROOM_ASSET_LIBRARY[preset.assetId]?.initScripts) ? ROOM_ASSET_LIBRARY[preset.assetId].initScripts : [],
        message: `Preset applied: ${preset.slotName}`
    };
    return applyRoomPlan(plan);
}
// ─── Interaction Slot Management ──────────────────────────────────────────

function getKnownRoomInteractionSlotIds() {
    const s = ensureUiSettings();
    const fromPlacements = getRoomPlacementsForLocation(s)
        .map((p) => normalizeInteractionSlotId(p?.interactionSlot || ""))
        .filter(Boolean);
    const fromBindings = Object.values(s.roomEditor?.slotBindings || {})
        .map((v) => normalizeInteractionSlotId(v || ""))
        .filter(Boolean);
    const merged = Array.from(new Set([...ROOM_INTERACTION_SLOT_IDS, ...fromPlacements, ...fromBindings]));
    return merged.sort((a, b) => a.localeCompare(b));
}

function prettifyInteractionSlotId(slotId = "") {
    return String(slotId || "")
        .replace(/^slot_/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function populateInteractionSlotOptions(selected = "") {
    const sel = $("#edit-room-interaction-slot");
    if (!sel.length) return;
    const normalized = normalizeInteractionSlotId(selected);
    sel.empty();
    sel.append(`<option value="">(Auto infer)</option>`);
    getKnownRoomInteractionSlotIds().forEach((slotId) => {
        const label = prettifyInteractionSlotId(slotId);
        sel.append(`<option value="${slotId.replace(/"/g, "&quot;")}">${label}</option>`);
    });
    if (normalized) {
        if (!ROOM_INTERACTION_SLOT_SET.has(normalized)) {
            sel.append(`<option value="${normalized.replace(/"/g, "&quot;")}">${prettifyInteractionSlotId(normalized)} (custom)</option>`);
        }
        sel.val(normalized);
    }
}

// ─── Handle Hot Spots editor (main handler) ───────────────────────────────

async function handleEditRoom(userInput, selectedGenre, opts = {}) {
    const slotId = String(opts.slotId || $("#edit-room-slot").val() || "").trim();
    const selectedSlotType = String(opts.selectedSlotType || $("#edit-room-slot-type").val() || "utility").trim();
    const interactionCustom = String(opts.interactionCustom || $("#edit-room-interaction-custom").val() || "").trim();
    const interactionSlot = normalizeInteractionSlotId(interactionCustom || opts.interactionSlot || $("#edit-room-interaction-slot").val() || "");
    const customActions = Array.isArray(opts.actions) ? opts.actions : parseRoomActionOverrides($("#edit-room-actions-json").val());
    const userCustomCss = String(opts.userCustomCss || $("#edit-room-user-css").val() || "").trim();
    const coordsRaw = opts.coordinates || (() => { try { return JSON.parse(String($("#edit-room-coords").val() || "{}")); } catch (_) { return null; } })();
    const plan = await planRoomComponent({
        slotId,
        description: userInput,
        selectedGenre,
        selectedSlotType,
        interactionSlot,
        actions: customActions,
        userCustomCss,
        coordinates: coordsRaw,
        forceCreateNew: opts.forceCreateNew === true
    });
    return applyRoomPlan(plan);
}

// ─── AI Room Architect ────────────────────────────────────────────────────

function roomArchitectSystemPrompt() {
    const s = ensureUiSettings();
    const custom = String(s.roomEditor?.systemPrompt || "").trim();
    if (custom) return custom;
    return [
        "Role: You are the Spatial Architect Engine for an immersive, interactive visual novel frontend.",
        "Use pre-stored assets whenever possible; generate custom only when required.",
        "Protocol: Match intent -> Modify CSS overrides -> Include init scripts for interactive assets -> Return JSON only.",
        "Slot types: Foundation (large), Utility (medium), Atmospheric (small).",
        "If user request is a variation of a known preset, return a base asset + css override instead of full HTML.",
        "If request is entirely unique, return custom_html and include class=\"interactable\" on interactive elements.",
        "Output JSON keys: action, target_asset, slot_id, slot_type, interaction_slot, actions_json, coordinates, overrides{css,addition,user_custom_css}, init_scripts, custom_html, source_html_path, message.",
        "Constraints: Do not rewrite full HTML of existing assets. user_custom_css has highest priority in cascade.",
        "Asset categories available: Domestic, Education, Commercial, Decor. Assume logical asset exists and name it logically if needed.",
        "If user is vague, pick the most visual-novel-appropriate option.",
        "Honor world_gen_scope from the task payload: local = one site/interior focus; world = broader travel hubs, varied districts, landmark scale."
    ].join("\n");
}

function extractJsonObject(text = "") {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
        try { return JSON.parse(m[0]); } catch (_) {}
    }
    return null;
}

async function planRoomComponent({ slotId, description, selectedGenre = "modern", selectedSlotType = "utility", interactionSlot = "", actions = [], userCustomCss = "", coordinates = null, forceCreateNew = false } = {}) {
    const slots = getRoomSlots();
    const slot = slots.find((x) => String(x.slotId) === String(slotId))
        || (slotId ? { slotId: String(slotId), coordinates: normalizeRoomCoordinates(coordinates || {}) } : null)
        || slots[0]
        || { slotId: makeFreeRoomSlotId(), coordinates: { x: 0.5, y: 0.5 }, slotType: "utility" };
    const fallbackAsset = inferAssetFromDescription(description, selectedGenre);
    const fallbackInteraction = normalizeInteractionSlotId(interactionSlot || inferInteractionSlotId({ slotId: slot.slotId, assetId: fallbackAsset, description }));
    const sPlan = ensureUiSettings();
    const worldGenScope = String(sPlan.roomEditor?.worldGenScope || sPlan.map?.scope || "local").trim() || "local";
    const storyLocation = String(
        sPlan.roomEditor?.storyLocationLabel
        || sPlan.worldState?.location
        || sPlan.map?.location
        || ""
    ).trim() || "(unknown)";

    if (!Api?.generateContent) {
        return {
            action: "ADD_COMPONENT",
            target_asset: fallbackAsset,
            slot_id: slot.slotId,
            slot_type: String(selectedSlotType || slot.slotType || "utility"),
            interaction_slot: fallbackInteraction,
            actions_json: Array.isArray(actions) ? actions : [],
            coordinates: normalizeRoomCoordinates(coordinates || slot.coordinates, slot.coordinates),
            overrides: { css: "", addition: "", user_custom_css: String(userCustomCss || "") },
            init_scripts: Array.isArray(ROOM_ASSET_LIBRARY[fallbackAsset]?.initScripts) ? ROOM_ASSET_LIBRARY[fallbackAsset].initScripts : [],
            message: `Applied fallback asset: ${fallbackAsset}`
        };
    }
    const payload = [
        "[SPATIAL ARCHITECT TASK]",
        `world_gen_scope: ${worldGenScope}`,
        `story_location_label: ${storyLocation}`,
        `slot_id: ${slot.slotId}`,
        `target_slot_type: ${String(selectedSlotType || slot.slotType || "utility")}`,
        `interaction_slot: ${fallbackInteraction || "(auto)"}`,
        `selected_genre: ${String(selectedGenre || "modern")}`,
        `slot_coordinates: ${JSON.stringify(normalizeRoomCoordinates(coordinates || slot.coordinates, slot.coordinates))}`,
        `user_description: ${String(description || "").trim()}`,
        `user_custom_css: ${String(userCustomCss || "").trim()}`,
        `existing_actions_json: ${JSON.stringify(Array.isArray(actions) ? actions : [])}`,
        `force_create_new: ${forceCreateNew ? "true" : "false"}`,
        `asset_manifest_categories: ${JSON.stringify(roomAssetCategories())}`,
        `genre_presets: ${JSON.stringify(getGenrePresetList(selectedGenre).map((p) => ({ id: p.id, slotName: p.slotName, assetId: p.assetId, slotType: p.slotType, purpose: p.purpose, content: p.content })))}`,
        "Return JSON only."
    ].join("\n");
    try {
        const system = roomArchitectSystemPrompt();
        const out = await Api.generateContent(`${system}\n\n${payload}`, "JSON");
        const parsed = extractJsonObject(out) || {};
        return {
            action: String(parsed.action || "ADD_COMPONENT"),
            target_asset: String(parsed.target_asset || fallbackAsset),
            slot_id: String(parsed.slot_id || slot.slotId),
            slot_type: String(parsed.slot_type || selectedSlotType || slot.slotType || "utility"),
            interaction_slot: normalizeInteractionSlotId(parsed.interaction_slot || fallbackInteraction),
            actions_json: Array.isArray(parsed.actions_json) ? parsed.actions_json : (Array.isArray(actions) ? actions : []),
            coordinates: normalizeRoomCoordinates(parsed.coordinates || coordinates || slot.coordinates, slot.coordinates),
            source_html_path: String(parsed.source_html_path || ""),
            custom_html: String(parsed.custom_html || ""),
            overrides: {
                css: String(parsed?.overrides?.css || ""),
                addition: String(parsed?.overrides?.addition || ""),
                user_custom_css: String(userCustomCss || parsed?.overrides?.user_custom_css || "")
            },
            init_scripts: Array.isArray(parsed.init_scripts) ? parsed.init_scripts.map((x) => String(x || "").trim()).filter(Boolean) : [],
            message: String(parsed.message || "Room updated.")
        };
    } catch (_) {
        return {
            action: "ADD_COMPONENT",
            target_asset: fallbackAsset,
            slot_id: slot.slotId,
            slot_type: String(selectedSlotType || slot.slotType || "utility"),
            interaction_slot: fallbackInteraction,
            actions_json: Array.isArray(actions) ? actions : [],
            coordinates: normalizeRoomCoordinates(coordinates || slot.coordinates, slot.coordinates),
            overrides: { css: "", addition: "", user_custom_css: String(userCustomCss || "") },
            init_scripts: Array.isArray(ROOM_ASSET_LIBRARY[fallbackAsset]?.initScripts) ? ROOM_ASSET_LIBRARY[fallbackAsset].initScripts : [],
            message: `Applied fallback asset: ${fallbackAsset}`
        };
    }
}

// ─── Room Style & Rendering ───────────────────────────────────────────────

function ensureRoomStyleTag(id, cssText) {
    if (!id) return;
    let st = document.getElementById(id);
    if (!st) {
        st = document.createElement("style");
        st.id = id;
        document.head.appendChild(st);
    }
    st.textContent = String(cssText || "");
}

function removeRoomStyleTag(id) {
    const st = document.getElementById(id);
    if (st && st.parentNode) st.parentNode.removeChild(st);
}

function getRoomAssetCard(assetId, placement) {
    const asset = ROOM_ASSET_LIBRARY[assetId] || { title: assetId || "Custom Asset", interactive: false, initScripts: [] };
    const safeTitle = String(asset.title || assetId || "Asset");
    const isInteractive = asset.interactive === true;
    const customHtml = String(placement?.customHtml || "").trim();
    if (customHtml) return customHtml;
    if (assetId === "kitchen_v1") {
        return `
            <div class="vn-comp-header">${safeTitle}</div>
            <div class="vn-comp-body">
                <div style="opacity:0.92;">Immersive kitchen space with prep, cook, and serve flow.</div>
                <button class="reply-tool-btn vn-comp-open-kitchen" style="width:auto; padding:0 10px; margin-top:6px;">Open Kitchen</button>
            </div>
        `;
    }
    if (assetId === "computer_v1") {
        return `
            <div class="vn-comp-header">${safeTitle}</div>
            <div class="vn-comp-body">Terminal ready.<br><button class="reply-tool-btn vn-comp-open-computer" style="width:auto; padding:0 10px; margin-top:6px;">Open</button></div>
        `;
    }
    if (assetId === "books_v1") {
        return `
            <div class="vn-comp-header">${safeTitle}</div>
            <div class="vn-comp-body">Reading shelf.<br><button class="reply-tool-btn vn-comp-open-books" style="width:auto; padding:0 10px; margin-top:6px;">Browse</button></div>
        `;
    }
    return `
        <div class="vn-comp-header">${safeTitle}</div>
        <div class="vn-comp-body">${isInteractive ? "Interactive room object." : "Room decoration installed."}</div>
    `;
}

export function renderPlacedComponents() {
    const s = ensureUiSettings();
    const layer = document.getElementById("room-components-layer");
    if (!layer) return;
    layer.innerHTML = "";
    document.querySelectorAll('style[id^="room-place-style-"]').forEach((n) => n.remove());
    const placements = getRoomPlacementsForLocation(s);
    placements.forEach((p, idx) => {
        const placeId = String(p?.id || `place_${idx}`);
        const assetId = String(p?.assetId || inferAssetFromDescription(""));
        const coords = normalizeRoomCoordinates(p?.coordinates || {});
        const slotId = String(p?.slotId || "");
        const interactionSlot = normalizeInteractionSlotId(
            p?.interactionSlot
            || s.roomEditor?.slotBindings?.[slotId]
            || inferInteractionSlotId({ slotId, assetId, description: "" })
        );
        const card = document.createElement("div");
        card.className = "vn-room-component vn-room-floor vn-room-accent placed-room-item";
        card.dataset.placementId = placeId;
        card.dataset.slotId = slotId;
        card.dataset.slotType = String(p?.slotType || "");
        card.dataset.interactionSlot = interactionSlot;
        card.style.left = `${Math.round(coords.x * 100)}%`;
        card.style.top = `${Math.round(coords.y * 100)}%`;
        card.style.transform = "translate(-50%, -50%)";
        card.style.cursor = "grab";
        const slotType = String(p?.slotType || "utility");
        if (slotType === "foundation") {
            card.style.width = "clamp(260px, 36vw, 620px)";
            card.style.minHeight = "180px";
        } else if (slotType === "atmospheric") {
            card.style.width = "clamp(120px, 12vw, 200px)";
            card.style.minHeight = "70px";
        } else {
            card.style.width = "clamp(140px, 18vw, 260px)";
            card.style.minHeight = "92px";
        }
        if (p.autoRendered && p.objectData && window.UIE?.objectRenderer) {
            try {
                const autoHtml = window.UIE.objectRenderer.render(p.objectData);
                const autoCss = window.UIE.objectRenderer.renderCss(p.objectData);
                card.innerHTML = autoHtml;
                const existingCss = String(p?.overrides?.css || "");
                p.overrides = p.overrides || {};
                p.overrides.css = [existingCss, autoCss].filter(Boolean).join("\n");
            } catch (e) {
                card.innerHTML = getRoomAssetCard(assetId, p);
            }
        } else {
            card.innerHTML = getRoomAssetCard(assetId, p);
        }
        const additionHtml = String(p?.overrides?.addition || "").trim();
        if (additionHtml) {
            const ext = document.createElement("div");
            ext.className = "vn-comp-addition";
            ext.innerHTML = additionHtml;
            card.appendChild(ext);
        }
        const controls = document.createElement("div");
        controls.style.display = "flex";
        controls.style.gap = "6px";
        controls.style.flexWrap = "wrap";
        controls.style.padding = "0 8px 8px";
        controls.innerHTML = `
            <button class="reply-tool-btn vn-comp-interact" style="width:auto; padding:0 8px;">Interact</button>
            <button class="reply-tool-btn vn-comp-edit" style="width:auto; padding:0 8px;">Edit</button>
            <button class="reply-tool-btn vn-comp-remove" style="width:auto; padding:0 8px;">Remove</button>
        `;
        card.appendChild(controls);
        layer.appendChild(card);
        const aiCss = String(p?.overrides?.css || "");
        const userCss = String(p?.overrides?.user_custom_css || "");
        ensureRoomStyleTag(`room-place-style-${placeId}`, [aiCss, userCss].filter(Boolean).join("\n"));
    });
    try {
        const s2 = ensureUiSettings();
        const loc = getCurrentLocationName();
        const sig = getPlacementSignatureForAiCache(s2);
        const prev = s2.worldState?.aiRoomContext;
        if (!prev || prev.location !== loc || prev.sig !== sig) {
            rebuildAiRoomContextCache(s2);
            Core.saveSettings();
        }
    } catch (_) {}
}

// ─── Placement Coordinate Updates & Drag ──────────────────────────────────

function updateRoomPlacementCoords(placementId, coords) {
    const s = ensureUiSettings();
    const list = Array.isArray(s.roomEditor?.placements) ? s.roomEditor.placements : [];
    const idx = list.findIndex((p) => String(p?.id || "") === String(placementId || ""));
    if (idx < 0) return false;
    list[idx].coordinates = normalizeRoomCoordinates(coords, list[idx].coordinates || { x: 0.5, y: 0.5 });
    Core.saveSettings();
    return true;
}

function roomCoordsFromPointerEvent(ev, hostEl) {
    const host = hostEl || document.getElementById("game-root") || document.body;
    const rect = host.getBoundingClientRect();
    const oe = ev?.originalEvent || ev;
    const p = (oe?.touches && oe.touches[0]) || (oe?.changedTouches && oe.changedTouches[0]) || oe;
    const x = rect.width > 0 ? (Number(p?.clientX || 0) - rect.left) / rect.width : 0.5;
    const y = rect.height > 0 ? (Number(p?.clientY || 0) - rect.top) / rect.height : 0.5;
    return normalizeRoomCoordinates({ x, y }, { x: 0.5, y: 0.5 });
}

// ─── Kitchen Experience ───────────────────────────────────────────────────

async function openKitchenExperience() {
    try {
        if (typeof window.UIE_init === "function") {
            window.UIE_init();
        }
        const mod = await importUieModule("features/kitchen.js");
        if (typeof mod.init === "function") mod.init();
        if (typeof mod.open === "function") mod.open({ mode: "body" });
    } catch (e) {
        alert(`Kitchen module failed: ${String(e?.message || e || "Unknown error")}`);
    }
}

// ─── Placement Removal ───────────────────────────────────────────────────

function removeRoomPlacement(placeId) {
    const s = ensureUiSettings();
    s.roomEditor.placements = (Array.isArray(s.roomEditor.placements) ? s.roomEditor.placements : []).filter((x) => String(x?.id || "") !== String(placeId || ""));
    removeRoomStyleTag(`room-place-style-${String(placeId || "")}`);
    Core.saveSettings();
    renderPlacedComponents();
}

// ─── Apply Room Plan ──────────────────────────────────────────────────────

async function applyRoomPlan(plan) {
    if (!plan || typeof plan !== "object") {
        try {
            showToast("Room editor: no valid plan returned (check Turbo API or try Apply Preset).");
        } catch (_) {}
        return null;
    }
    const s = ensureUiSettings();
    s.roomEditor.placements = Array.isArray(s.roomEditor.placements) ? s.roomEditor.placements : [];
    const currentLocation = String(s?.worldState?.location || getCurrentLocationName() || getDefaultStartLocation(getActiveCampaign(s))).trim();
    const currentLocationToken = normalizeLocationToken(currentLocation);
    const slotId = String(plan?.slot_id || "hs-study");
    const assetId = String(plan?.target_asset || inferAssetFromDescription(""));
    const coords = normalizeRoomCoordinates(plan?.coordinates || {});
    const sourceHtmlPath = String(plan?.source_html_path || "");
    const resolvedInteraction = normalizeInteractionSlotId(
        plan?.interaction_slot
        || inferInteractionSlotId({ slotId, assetId, description: String(plan?.message || "") })
        || s.roomEditor?.slotBindings?.[slotId]
    );
    let customHtml = String(plan?.custom_html || "");
    if (!customHtml && sourceHtmlPath) {
        customHtml = await loadLocalAsset(sourceHtmlPath);
    }
    if (!customHtml && resolvedInteraction) {
        customHtml = await loadLocalAsset(`assets/slots/${resolvedInteraction}.html`);
    }
    const parsedActions = Array.isArray(plan?.actions_json) ?
         plan.actions_json
        : parseRoomActionOverrides(plan?.actions_json || "");
    const existingIdx = s.roomEditor.placements.findIndex((x) => String(x?.slotId || "") === slotId && inferPlacementLocationToken(x, s) === currentLocationToken);
    const placed = {
        id: existingIdx >= 0 ? String(s.roomEditor.placements[existingIdx]?.id || `place_${Date.now()}`) : `place_${Date.now()}`,
        location: currentLocation,
        slotId,
        slotType: String(plan?.slot_type || "utility"),
        assetId,
        sourceHtmlPath,
        customHtml: String(customHtml || ""),
        interactionSlot: resolvedInteraction,
        actions: parsedActions,
        coordinates: coords,
        overrides: {
            css: String(plan?.overrides?.css || ""),
            addition: String(plan?.overrides?.addition || ""),
            user_custom_css: String(plan?.overrides?.user_custom_css || "")
        },
        initScripts: Array.isArray(plan?.init_scripts) ? plan.init_scripts : []
    };
    if (existingIdx >= 0) s.roomEditor.placements[existingIdx] = placed;
    else s.roomEditor.placements.push(placed);
    if (!s.roomEditor.slotBindings || typeof s.roomEditor.slotBindings !== "object") s.roomEditor.slotBindings = {};
    if (resolvedInteraction) s.roomEditor.slotBindings[slotId] = resolvedInteraction;
    Core.saveSettings();
    renderPlacedComponents();
    return placed;
}

// ─── Open Hot Spots editor modal ──────────────────────────────────────────

function openEditRoomModal(slotId = "", opts = {}) {
    roomEditArmed = false;
    $("body").removeClass("in-edit-mode uie-editing-room");
    $("#game-root").removeClass("in-edit-mode");
    $(".room-hotspot").removeClass("room-edit-candidate");
    hideFreeRoomPreview();
    const slots = getRoomSlots();
    const incomingCoords = normalizeRoomCoordinates(opts?.coordinates || {});
    const existingSlot = slots.find((x) => String(x.slotId) === String(slotId));
    const freeSlot = slotId && !existingSlot ? {
        slotId: String(slotId),
        label: "Free Placement Anchor",
        slotType: String(opts?.slotType || "utility"),
        coordinates: incomingCoords
    } : null;
    const workingSlots = freeSlot ? [freeSlot, ...slots] : slots;
    const target = workingSlots.find((x) => String(x.slotId) === String(slotId)) || workingSlots[0] || { slotId: "hs-study", coordinates: { x: 0.5, y: 0.5 } };
    const sel = $("#edit-room-slot");
    sel.empty();
    workingSlots.forEach((slt) => {
        sel.append(`<option value="${String(slt.slotId || "").replace(/"/g, "&quot;")}">${String(slt.label || slt.slotId || "slot")}</option>`);
    });
    sel.val(target.slotId);
    syncEditRoomCoordInputs(opts?.coordinates || target.coordinates);
    const s = ensureUiSettings();
    if (!String(s.roomEditor?.worldGenScope || "").trim() && String(s.map?.scope || "").trim()) {
        s.roomEditor.worldGenScope = String(s.map.scope);
        Core.saveSettings();
    }
    const existing = getRoomPlacementsForLocation(s).find((p) => String(p?.slotId || "") === String(target.slotId || ""));
    $("#edit-room-desc").val("");
    $("#edit-room-genre").val("modern");
    $("#edit-room-slot-type").val(String(target.slotType || "utility"));
    const defaultInteraction = normalizeInteractionSlotId(
        existing?.interactionSlot
        || s.roomEditor?.slotBindings?.[target.slotId]
        || inferInteractionSlotId({ slotId: target.slotId, assetId: existing?.assetId, description: "" })
    );
    populateInteractionSlotOptions(defaultInteraction);
    $("#edit-room-interaction-custom").val("");
    $("#edit-room-actions-json").val(Array.isArray(existing?.actions) && existing.actions.length ? JSON.stringify(existing.actions, null, 2) : "");
    $("#edit-room-user-css").val(String(existing?.overrides?.user_custom_css || ""));
    $("#edit-room-preview").text(existing ? JSON.stringify(existing, null, 2) : "");
    $("#edit-room-system-prompt").val(String(s.roomEditor?.systemPrompt || ""));
    $("#edit-room-modal").css("display", "flex");
}

// ─── Progress & Needs Helpers ─────────────────────────────────────────────

function applyProgressDelta({ hp = 0, uie = 0, skillPoints = 0, abilityPoints = 0, theory = 0, reading = 0, practice = 0 }) {
    const s = ensureUiSettings();
    const p = s.playerProgress;
    p.hp = Math.max(0, Math.min(Number(p.maxHp || 100), Number(p.hp || 0) + Number(hp || 0)));
    p.uie = Math.max(0, Math.min(999, Number(p.uie || 0) + Number(uie || 0)));
    p.skillPoints = Math.max(0, Number(p.skillPoints || 0) + Number(skillPoints || 0));
    p.abilityPoints = Math.max(0, Number(p.abilityPoints || 0) + Number(abilityPoints || 0));
    p.skills.theory = Math.max(0, Number(p.skills.theory || 0) + Number(theory || 0));
    p.skills.reading = Math.max(0, Number(p.skills.reading || 0) + Number(reading || 0));
    p.skills.practice = Math.max(0, Number(p.skills.practice || 0) + Number(practice || 0));
    Core.saveSettings();
    updateHudFromState();
}

function applyNeedsDelta(partials = {}) {
    const s = ensureUiSettings();
    if (!s.playerProgress || typeof s.playerProgress !== "object") s.playerProgress = {};
    if (!s.playerProgress.needs || typeof s.playerProgress.needs !== "object") {
        s.playerProgress.needs = { hunger: 78, energy: 82, hygiene: 74, social: 70 };
    }
    const n = s.playerProgress.needs;
    ["hunger", "energy", "hygiene", "social"].forEach((k) => {
        const d = Number(partials[k] ?? 0);
        if (!Number.isFinite(d) || d === 0) return;
        const cur = Number(n[k]);
        const base = Number.isFinite(cur) ? cur : 70;
        n[k] = Math.max(0, Math.min(100, base + d));
        
        // Keep life.js trackers in sync!
        if (s.life && Array.isArray(s.life.trackers)) {
            const t = s.life.trackers.find(tr => String(tr.name).toLowerCase() === k);
            if (t) {
                t.current = Math.max(0, Math.min(t.max || 100, Number(t.current || 0) + d));
            }
        }
    });
    Core.saveSettings();
    renderCustomHudTrackers();
    $(document).trigger("uie:updateVitals");
}

// ─── Room Action Modal ────────────────────────────────────────────────────

function openRoomAction(title, actions = [], context = {}) {
    $("#room-action-title").text(title);
    const box = $("#room-action-content");
    box.empty();

    $("#room-action-modal .dynamic-header-btn").remove();
    if (context && Array.isArray(context.headerButtons)) {
        const headerDiv = $(`<div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;"></div>`);
        context.headerButtons.forEach(btn => {
            const b = $(`<button type="button" class="reply-tool-btn dynamic-header-btn" style="width:auto; padding:0 10px; font-size:12px; font-weight:800; gap:4px; display:inline-flex; align-items:center;"></button>`);
            b.html(btn.label);
            b.on("click", () => {
                $("#room-action-modal").hide();
                if (typeof btn.run === "function") btn.run();
            });
            headerDiv.append(b);
        });
        box.append(headerDiv);
    }

    actions.forEach((a) => {
        const row = $(`
            <div style="border:1px solid rgba(255,255,255,0.16); border-radius:10px; padding:10px; margin-bottom:8px;">
                <div style="font-weight:700;">${String(a.label || "Action")}</div>
                <div style="opacity:0.8; font-size:12px; margin:4px 0 8px;">${String(a.desc || "")}</div>
                <button class="reply-tool-btn room-do-btn" style="width:auto; padding:0 12px;">Do</button>
            </div>
        `);
        row.find(".room-do-btn").on("click", () => {
            try { a.run?.(); } catch (_) {}
            $("#room-action-modal").hide();
        });
        box.append(row);
    });
    $("#room-action-modal").css("display", "flex");
}

// ─── Computer & Books Modals ──────────────────────────────────────────────

async function openComputerModal() {
    $("#computer-modal").css("display", "flex");
    $("#pc-login-panel").show();
    $("#pc-desktop-panel").hide();
    $("#pc-screen").text("SYSTEM READY // LOGIN REQUIRED");
}

function openBooksModal() {
    openRoomAction("Bookshelf", [
        {
            label: "Read Music Textbook",
            desc: "+reading, +theory, +1 hour",
            run: () => {
                applyProgressDelta({ reading: 2, theory: 1, skillPoints: 1 });
                applyNeedsDelta({ energy: -3, hunger: -2 });
                bumpTime(1);
                showToast("You review notation and arrangement from the shelf.", 3200);
            }
        },
        {
            label: "Manage Shelf",
            desc: "Add/edit shelf books and item data.",
            run: () => openBookshelfManager()
        }
    ]);
}

function getShelfBooks() {
    const s = ensureUiSettings();
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    return items.filter((i) => {
        const t = normalizeToken(String(i?.type || ""));
        const c = normalizeToken(String(i?.category || ""));
        const tags = Array.isArray(i?.tags) ? i.tags.map((x) => normalizeToken(String(x || ""))) : [];
        return t === "book" || t === "journal" || c === "bookshelf" || tags.includes("book");
    });
}

function openBookshelfManager() {
    const books = getShelfBooks();
    const list = books.map((b, idx) => `<option value="${idx}">${String(b?.name || "Book")} (${String(b?.type || "book")})</option>`).join("");
    showToast("Bookshelf manager opened.", 2000);
}

// ─── Wire Hot Spots editor system (the main wiring function) ──────────────

function wireEditRoomSystem() {
    const s = ensureUiSettings();

    // ── Legacy placement migration ──
    // Migrate from s.playerRoom.placements (dictionary) to s.roomEditor.placements (array)
    if (s.playerRoom && s.playerRoom.placements && typeof s.playerRoom.placements === "object" && !Array.isArray(s.playerRoom.placements)) {
        const currentLoc = getCurrentLocationName();
        const defaultLoc = /(^|\b)(player room|bedroom)(\b|$)/i.test(currentLoc) ? currentLoc : "Player Room";
        const locToken = normalizeLocationToken(defaultLoc);
        Object.entries(s.playerRoom.placements).forEach(([slotId, placement]) => {
            if (!placement || typeof placement !== "object") return;
            // Check if already migrated
            const alreadyExists = s.roomEditor.placements.some(p =>
                String(p?.slotId || "") === slotId && inferPlacementLocationToken(p, s) === locToken
            );
            if (alreadyExists) return;
            s.roomEditor.placements.push({
                id: `migrated_${slotId}_${Date.now()}`,
                location: defaultLoc,
                slotId: slotId,
                slotType: "utility",
                assetId: inferAssetFromDescription(String(placement.description || placement.name || ""), "modern"),
                sourceHtmlPath: "",
                customHtml: "",
                interactionSlot: normalizeInteractionSlotId(placement.interactionSlot || ""),
                actions: Array.isArray(placement.actions) ? placement.actions : [],
                coordinates: normalizeRoomCoordinates(placement.coords || placement.coordinates || {}),
                overrides: {
                    css: String(placement.css || ""),
                    addition: "",
                    user_custom_css: ""
                },
                initScripts: []
            });
        });
        // Remove legacy dictionary after successful migration
        delete s.playerRoom.placements;
        saveSettings();
        console.log("[UIE] Legacy placements migrated to roomEditor.placements array.");
    }

    // ── Point-and-Click Crosshair Cursor Mechanism ──
    // Arm/disarm edit mode: clicking on game-root with crosshair captures coords
    // then opens the edit-room-modal with those coordinates pre-filled

    // Helper to exit room editing mode cleanly
    function exitRoomEditingMode() {
        roomEditArmed = false;
        $("body").removeClass("in-edit-mode uie-editing-room");
        $("#game-root").removeClass("in-edit-mode");
        $(".room-hotspot").removeClass("room-edit-candidate");
        hideFreeRoomPreview();
        $("#reply-menu-panel").show();
        $("#uie-presets-modal").hide();
        $("#edit-room-modal").hide();
    }

    // Helper to apply theme presets dynamically to current slots
    async function applyThemePreset(themeKey) {
        const s = ensureUiSettings();
        if (!s.roomEditor) s.roomEditor = {};
        if (!Array.isArray(s.roomEditor.placements)) s.roomEditor.placements = [];

        const currentLocation = String(s?.worldState?.location || getCurrentLocationName() || "bedroom").trim();
        const locToken = normalizeLocationToken(currentLocation);

        // Clear existing placements for this location
        s.roomEditor.placements = s.roomEditor.placements.filter(p => inferPlacementLocationToken(p, s) !== locToken);

        const actualTheme = themeKey === "horror" ? "academic_horror" : themeKey;
        const presets = ROOM_GENRE_PRESETS[actualTheme] || [];
        const slots = getRoomSlots();

        if (presets.length === 0 || slots.length === 0) {
            showToast("No slots or presets found for this room.", 3000);
            exitRoomEditingMode();
            return;
        }

        for (let i = 0; i < Math.min(presets.length, slots.length); i++) {
            const preset = presets[i];
            const slot = slots[i];
            
            const interactionSlot = slot.slotId.includes("bed") ? "bed"
                                  : slot.slotId.includes("study") ? "desk"
                                  : slot.slotId.includes("computer") ? "computer"
                                  : slot.slotId.includes("closet") ? "closet"
                                  : slot.slotId.includes("read") ? "book"
                                  : slot.slotId.includes("practice") ? "practice"
                                  : "";

            const html = await loadLocalAsset(preset.htmlPath);

            const placed = {
                id: `place_${Date.now()}_${i}`,
                location: currentLocation,
                slotId: slot.slotId,
                slotType: preset.slotType || slot.slotType || "utility",
                assetId: preset.assetId,
                sourceHtmlPath: preset.htmlPath,
                customHtml: html || "",
                interactionSlot: interactionSlot,
                actions: [],
                coordinates: slot.coordinates,
                overrides: {
                    css: "",
                    addition: "",
                    user_custom_css: ""
                },
                initScripts: []
            };
            s.roomEditor.placements.push(placed);
        }

        Core.saveSettings();
        renderPlacedComponents();
        showToast(`Successfully placed ${actualTheme} preset components!`, 3000);
        exitRoomEditingMode();
    }

    function esc(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function applyCustomPreset(preset) {
        const s = ensureUiSettings();
        if (!s.roomEditor) s.roomEditor = {};
        if (!Array.isArray(s.roomEditor.placements)) s.roomEditor.placements = [];

        const currentLocation = String(s?.worldState?.location || getCurrentLocationName() || "bedroom").trim();
        const locToken = normalizeLocationToken(currentLocation);

        // Clear existing placements for this location
        s.roomEditor.placements = s.roomEditor.placements.filter(p => inferPlacementLocationToken(p, s) !== locToken);

        const slots = getRoomSlots();
        if (slots.length === 0) {
            showToast("No slots found for this room.", 3000);
            exitRoomEditingMode();
            return;
        }

        const presetItems = Array.isArray(preset) ? preset : [preset];
        let usedSlots = new Set();
        presetItems.forEach((item, idx) => {
            let slot = slots.find(sl => !usedSlots.has(sl.slotId) && sl.slotType === item.slotType);
            if (!slot) {
                slot = slots.find(sl => !usedSlots.has(sl.slotId));
            }
            if (!slot) return;
            usedSlots.add(slot.slotId);

            const interactionSlot = slot.slotId.includes("bed") ? "bed"
                                  : slot.slotId.includes("study") ? "desk"
                                  : slot.slotId.includes("computer") ? "computer"
                                  : slot.slotId.includes("closet") ? "closet"
                                  : slot.slotId.includes("read") ? "book"
                                  : slot.slotId.includes("practice") ? "practice"
                                  : "";

            const placed = {
                id: `place_${Date.now()}_${idx}`,
                location: currentLocation,
                slotId: slot.slotId,
                slotType: item.slotType || slot.slotType || "utility",
                assetId: item.assetId || `custom_${idx}`,
                sourceHtmlPath: "",
                customHtml: item.html || item.customHtml || "",
                interactionSlot: interactionSlot,
                actions: [],
                coordinates: slot.coordinates,
                overrides: {
                    css: "",
                    addition: "",
                    user_custom_css: ""
                },
                initScripts: []
            };
            s.roomEditor.placements.push(placed);
        });

        Core.saveSettings();
        renderPlacedComponents();
        showToast("Successfully placed dynamic AI preset components!", 3000);
        exitRoomEditingMode();
    }

    // Toggle edit mode button (opens Presets modal first)
    $(document).off("click.roomEditToggle", "#nav-room-edit, #btn-edit-room, .room-edit-toggle-btn").on("click.roomEditToggle", "#nav-room-edit, #btn-edit-room, .room-edit-toggle-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();

        // Dynamically check and render customRoomPresets
        const s = ensureUiSettings();
        const currentLocation = String(s?.worldState?.location || getCurrentLocationName() || "bedroom").trim();
        const roomObj = s.worldState?.rooms?.[currentLocation] || 
                        (s.worldState?.mapData?.rooms || []).find(r => r.id === currentLocation);

        const container = $("#uie-custom-presets-container");
        if (container.length) {
            container.empty().hide();
            if (roomObj && Array.isArray(roomObj.customRoomPresets) && roomObj.customRoomPresets.length > 0) {
                container.show();
                container.append(`<div style="font-size:12px; font-weight:bold; color:#ffd166; margin-bottom:8px;"><i class="fas fa-magic"></i> AI Room Presets</div>`);
                roomObj.customRoomPresets.forEach((p, idx) => {
                    const btn = $(`
                        <button class="reply-tool-btn uie-custom-preset-option" data-idx="${idx}" style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%); border: 1px solid rgba(255,209,102,0.3); text-align: left; padding: 10px 14px; width: 100%; border-radius: 8px; cursor: pointer; color: #fff; display: block; margin-bottom: 8px;">
                            <strong style="color: #6fd3ff;">${esc(p.name || 'AI Preset')}</strong><br>
                            <span style="font-size: 11px; opacity: 0.8;">Slot: ${esc(p.slotType || 'utility')} — ${esc(p.purpose || 'Custom thematic layout')}</span>
                        </button>
                    `);
                    container.append(btn);
                });
            }
        }

        $("#uie-presets-modal").show();
    });

    // Wire Presets modal buttons
    $(document).off("click.presetOption", ".uie-preset-option").on("click.presetOption", ".uie-preset-option", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const theme = $(this).data("theme");
        applyThemePreset(theme);
    });

    $(document).off("click.presetCustomPreset", ".uie-custom-preset-option").on("click.presetCustomPreset", ".uie-custom-preset-option", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("idx"));
        const s = ensureUiSettings();
        const currentLocation = String(s?.worldState?.location || getCurrentLocationName() || "bedroom").trim();
        const roomObj = s.worldState?.rooms?.[currentLocation] || 
                        (s.worldState?.mapData?.rooms || []).find(r => r.id === currentLocation);
        if (roomObj && Array.isArray(roomObj.customRoomPresets) && roomObj.customRoomPresets[idx]) {
            applyCustomPreset(roomObj.customRoomPresets[idx]);
        }
    });

    $(document).off("click.presetCustom", "#uie-preset-custom").on("click.presetCustom", "#uie-preset-custom", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-presets-modal").hide();
        roomEditArmed = true;
        $("body").addClass("in-edit-mode uie-editing-room");
        $("#game-root").addClass("in-edit-mode");
        $(".room-hotspot").addClass("room-edit-candidate");
        showToast("🎯 Edit Mode ON — Click anywhere on the stage to place a component.", 4000);

        // Make the edit room button pulse twice
        $("#btn-edit-room").addClass("pulse-twice");
        setTimeout(() => {
            $("#btn-edit-room").removeClass("pulse-twice");
        }, 2200);
    });

    $(document).off("click.presetCancel", "#uie-preset-cancel").on("click.presetCancel", "#uie-preset-cancel", function(e) {
        e.preventDefault();
        e.stopPropagation();
        exitRoomEditingMode();
    });

    // Point-and-click handler: clicking on the game-root stage area while armed
    $("#game-root").off("click.roomEditCapture").on("click.roomEditCapture", function(e) {
        if (!roomEditArmed) return;

        // Don't intercept clicks on existing placed items, buttons, or modals
        const target = e.target;
        if ($(target).closest(".placed-room-item, .vn-room-component, .modal-overlay, .reply-tool-btn, button, a, select, input, textarea").length) return;

        e.preventDefault();
        e.stopPropagation();

        const coords = roomCoordsFromPointerEvent(e, this);
        const freeSlotId = makeFreeRoomSlotId();

        // Show preview marker at click point
        setFreeRoomPreview(coords, true);

        // Disarm after capture
        roomEditArmed = false;
        $("body").removeClass("in-edit-mode");
        $("#game-root").removeClass("in-edit-mode");
        $(".room-hotspot").removeClass("room-edit-candidate");

        showToast(`📍 Coordinates captured: X=${coords.x.toFixed(2)}, Y=${coords.y.toFixed(2)}. Opening editor...`, 3000);

        // Open the edit room modal with the captured coordinates and free slot ID
        openEditRoomModal(freeSlotId, {
            coordinates: coords,
            slotType: "utility"
        });
    });

    // Mouse move preview while armed (show crosshair preview dot following cursor)
    $("#game-root").off("mousemove.roomEditPreview").on("mousemove.roomEditPreview", function(e) {
        if (!roomEditArmed) return;
        const coords = roomCoordsFromPointerEvent(e, this);
        setFreeRoomPreview(coords, true);
    });

    // Wire sliders
    $("#edit-room-x, #edit-room-y").off("input").on("input", function() {
        const x = parseFloat($("#edit-room-x").val());
        const y = parseFloat($("#edit-room-y").val());
        $("#edit-room-coords").val(JSON.stringify({ x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)) }));
    });
    // Clear buttons
    $("#edit-room-clear-actions").off("click").on("click", () => $("#edit-room-actions-json").val(""));
    $("#edit-room-clear-css").off("click").on("click", () => $("#edit-room-user-css").val(""));
    $("#edit-room-clear-system").off("click").on("click", () => $("#edit-room-system-prompt").val(""));

    // Cancel modal
    $("#edit-room-cancel").off("click").on("click", () => {
        exitRoomEditingMode();
    });

    // Delete placement for selected slot
    $("#edit-room-delete-placement").off("click").on("click", () => {
        const slot = $("#edit-room-slot").val();
        if (!slot) return;

        const s = ensureUiSettings();
        const locToken = normalizeLocationToken(getCurrentLocationName());
        const idx = s.roomEditor.placements.findIndex(p =>
            String(p?.slotId || "") === slot && inferPlacementLocationToken(p, s) === locToken
        );
        if (idx >= 0) {
            if (confirm(`Remove custom placement for slot: ${slot}?`)) {
                const placeId = String(s.roomEditor.placements[idx]?.id || "");
                s.roomEditor.placements.splice(idx, 1);
                removeRoomStyleTag(`room-place-style-${placeId}`);
                Core.saveSettings();
                renderPlacedComponents();
                injectRpEvent(`[System: Placed item in slot ${slot} has been deleted.]`);
                exitRoomEditingMode();
            }
        } else {
            alert("No custom placement exists in this slot to delete.");
        }
    });

    // Apply via AI Button click
    $("#edit-room-apply").off("click").on("click", async () => {
        const description = $("#edit-room-desc").val().trim();
        const genre = $("#edit-room-genre").val();

        if (!description) {
            alert("PLEASE ENTER A DESCRIPTION TO DEFINE WHAT YOU WANT IN THIS SLOT!");
            return;
        }

        const previewEl = document.getElementById("edit-room-preview");
        if (previewEl) previewEl.innerHTML = `[UIE ARCHITECT] Processing request...\nStabilizing spatial components...`;

        try {
            const result = await handleEditRoom(description, genre);
            if (result && previewEl) {
                previewEl.textContent = `[SUCCESS] Component placed:\n${JSON.stringify(result, null, 2)}`;
            }
            injectRpEvent(`[System: Room component applied via AI Architect.]`);
            showToast("✅ Room component placed successfully.", 3000);
            $("#edit-room-desc").val("");
            exitRoomEditingMode();
        } catch (e) {
            console.error("[RoomEditor] AI error:", e);
            if (previewEl) previewEl.innerHTML = `[ERROR] ${e.message || e}`;
        }
    });

    // Save system prompt override
    $("#edit-room-system-prompt").off("change").on("change", function() {
        const s = ensureUiSettings();
        s.roomEditor.systemPrompt = String($(this).val() || "").trim();
        Core.saveSettings();
    });

    // ── Component interaction delegation ──
    // Delegate clicks on rendered room component buttons
    $(document).off("click.roomCompInteract", ".vn-comp-interact").on("click.roomCompInteract", ".vn-comp-interact", function(e) {
        e.stopPropagation();
        const card = $(this).closest("[data-placement-id]");
        const placeId = card.data("placementId");
        const interactionSlot = card.data("interactionSlot");
        const placement = (ensureUiSettings().roomEditor?.placements || []).find(p => String(p?.id || "") === String(placeId));

        if (interactionSlot) {
            // Route to existing hotspot subsystems
            if (/bed|sleep/.test(interactionSlot)) { showBedMenu(); return; }
            if (/desk|study/.test(interactionSlot)) { showStudyMenu(); return; }
            if (/computer/.test(interactionSlot)) { $("#hs-computer").click(); return; }
            if (/closet|wardrobe/.test(interactionSlot)) { $("#hs-closet").click(); return; }
            if (/book|read/.test(interactionSlot)) { showReadMenu(); return; }
            if (/music|practice/.test(interactionSlot)) { showPracticeMenu(); return; }
            if (/kitchen|cook|stove/.test(interactionSlot)) { openKitchenExperience(); return; }
        }

        // Custom actions fallback
        if (placement && Array.isArray(placement.actions) && placement.actions.length > 0) {
            const runtimeActions = placement.actions.map(a => ({
                label: a.label || "Action",
                desc: a.desc || "",
                run: () => {
                    if (a.message) injectRpEvent(`[System: ${a.message}]`);
                    if (a.hp || a.uie || a.skillPoints || a.theory || a.reading || a.practice) {
                        applyProgressDelta(a);
                    }
                    if (a.hours) bumpTime(a.hours);
                    if (a.openComputer) openComputerModal();
                    if (a.openKitchen) openKitchenExperience();
                }
            }));
            openRoomAction(String(placement.assetId || "Room Component"), runtimeActions);
        } else {
            showToast("No actions defined for this component.", 2000);
        }
    });

    // Edit button on room component
    $(document).off("click.roomCompEdit", ".vn-comp-edit").on("click.roomCompEdit", ".vn-comp-edit", function(e) {
        e.stopPropagation();
        const card = $(this).closest("[data-placement-id]");
        const slotId = card.data("slotId");
        const placeId = card.data("placementId");
        const placement = (ensureUiSettings().roomEditor?.placements || []).find(p => String(p?.id || "") === String(placeId));
        openEditRoomModal(slotId || "", {
            coordinates: placement?.coordinates
        });
    });

    // Remove button on room component
    $(document).off("click.roomCompRemove", ".vn-comp-remove").on("click.roomCompRemove", ".vn-comp-remove", function(e) {
        e.stopPropagation();
        const card = $(this).closest("[data-placement-id]");
        const placeId = card.data("placementId");
        if (placeId && confirm("Remove this placed component?")) {
            removeRoomPlacement(placeId);
            injectRpEvent("[System: Room component removed.]");
            showToast("Component removed.", 2000);
        }
    });

    // ── Drag-to-reposition room component cards ──
    $(document).off("mousedown.roomDrag", ".vn-room-component, .placed-room-item").on("mousedown.roomDrag", ".vn-room-component, .placed-room-item", function(e) {
        if ($(e.target).closest("button, a, select, input, textarea").length) return;
        const card = $(this);
        const placeId = card.data("placementId");
        if (!placeId) return;
        roomDragState = {
            placeId,
            el: card[0],
            startX: e.clientX,
            startY: e.clientY,
            moved: false
        };
        card.css("cursor", "grabbing");
        e.preventDefault();
    });

    $(document).off("mousemove.roomDrag").on("mousemove.roomDrag", function(e) {
        if (!roomDragState) return;
        const dx = e.clientX - roomDragState.startX;
        const dy = e.clientY - roomDragState.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) roomDragState.moved = true;
        if (!roomDragState.moved) return;
        const host = document.getElementById("game-root") || document.body;
        const coords = roomCoordsFromPointerEvent(e, host);
        roomDragState.el.style.left = `${Math.round(coords.x * 100)}%`;
        roomDragState.el.style.top = `${Math.round(coords.y * 100)}%`;
    });

    $(document).off("mouseup.roomDrag").on("mouseup.roomDrag", function(e) {
        if (!roomDragState) return;
        const ds = roomDragState;
        roomDragState = null;
        $(ds.el).css("cursor", "grab");
        if (!ds.moved) return;
        const host = document.getElementById("game-root") || document.body;
        const coords = roomCoordsFromPointerEvent(e, host);
        updateRoomPlacementCoords(ds.placeId, coords);
    });

    console.log("[UIE] Advanced Room Editor wired successfully.");
}
