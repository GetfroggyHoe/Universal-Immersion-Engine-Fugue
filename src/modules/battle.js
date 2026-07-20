/**
 * battle.js — Tactical JRPG Battle Arena
 * 
 * Full tactical battle system with phase machine (start → player_select →
 * target_select → resolving → enemy_turn → victory/defeat), speed-based
 * turn queue, enemy intent display, dynamic vitals, status effects,
 * break/stagger, guard, and action previews.
 */

import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { haptics } from "./reality.js";
import { initiateCombat, evaluateAction, executeAction } from "./combatEngine.js";
import { generateContent } from "./apiClient.js";
import { applyCombatantVitalsToSettings, buildCombatProjection } from "./combatStateAdapter.js";
import { injectRpEvent } from "./features/rp_log.js";
import { planBattle, processPlayerAction, generateEnemy } from "./backendBridge.js";

let battleActive = false;
let battleState = null;
let snapshotCanvas = null;
let battleLog = [];
let selectedTarget = null;
let pendingAction = null;
let activeSubTab = "main";

function permadeathEnabled(settings = getSettings()) {
    return settings?.rpgSettings?.permadeath === true || settings?.world?.permadeath === true || settings?.permadeath === true;
}

function currentLocationBackgroundCss() {
    const candidates = [
        document.getElementById("re-bg"),
        document.getElementById("game-root"),
        document.getElementById("vn-screen")
    ].filter(Boolean);
    for (const el of candidates) {
        const inline = String(el.style?.backgroundImage || "").trim();
        const computed = String(window.getComputedStyle?.(el)?.backgroundImage || "").trim();
        const value = inline && inline !== "none" ? inline : computed;
        if (value && value !== "none") return value;
    }
    return "";
}

function applyBattleLocationBackground() {
    const screen = document.getElementById("battle-screen");
    if (!screen) return;
    const bg = currentLocationBackgroundCss();
    if (bg) screen.style.setProperty("--uie-battle-bg", bg);
}

function refreshActiveBattleProjection() {
    if (!battleActive || !battleState) return;
    const s = getSettings();
    const screen = document.getElementById("battle-screen");
    if (screen) screen.classList.add("uie-battle-tactical");
    applyBattleLocationBackground();
    const projection = buildCombatProjection(s, {
        enemies: battleState.enemies || [],
        scale: battleState.projection?.scale || s?.battle?.state?.scale || "skirmish",
        source: "live_party_sync"
    });
    
    // Sync projection state back
    const controlled = projection.allies.find(member => String(member.id) === String(projection.controlledCombatantId)) || projection.allies[0];
    battleState.allies = projection.allies;
    battleState.player = controlled;
    battleState.enemies = projection.enemies;
    battleState.projection = projection;

    renderBattleStage();
    renderBottomDock();
}

function ensureBattleCss() {
    let st = document.getElementById("uie-battle-dom-css");
    if (!st) {
        st = document.createElement("style");
        st.id = "uie-battle-dom-css";
        document.head.appendChild(st);
    }
    st.textContent = `#battle-screen.uie-battle-tactical{
    --gold-trim: var(--party-gold, #cba35c);
    position:fixed!important;
    inset:0!important;
    z-index:2147483638!important;
    overflow:hidden!important;
    background-image: var(--uie-battle-bg, var(--user-current-bg))!important;
    background-size: cover!important;
    background-position: center!important;
    color:#e5f4ff!important;
    font-family:Inter,system-ui,sans-serif!important;
}
#battle-screen.uie-battle-tactical,
#battle-screen.uie-battle-tactical * {
    box-sizing:border-box!important;
}
#battle-screen.uie-battle-tactical::before{
    content:none!important;
}
#battle-screen.uie-battle-tactical #battle-bg-blur{
    display:none!important;
    opacity:0!important;
}
#battle-screen.uie-battle-tactical #battle-turn-timeline{
    top:18px!important;
    left:50%!important;
    transform:translateX(-50%)!important;
    padding:9px 16px!important;
    background:rgba(6,16,22,.82)!important;
    border:1px solid rgba(125,211,252,.32)!important;
    border-radius:8px!important;
    box-shadow:0 12px 40px rgba(0,0,0,.36)!important;
    backdrop-filter:blur(14px)!important;
}
#battle-screen.uie-battle-tactical #battle-log{
    bottom:210px!important;
}

/* Sprite Stage */
.battle-stage {
    position: absolute;
    left: 0;
    right: 0;
    top: 68px;
    bottom: 190px;
    z-index: 5;
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    padding: 0 60px;
}
.sprite-stage-col {
    display: flex;
    gap: 32px;
    justify-content: center;
    align-items: flex-end;
    height: 100%;
    padding-bottom: 40px;
}
.battle-sprite-container {
    position: relative;
    width: 140px;
    height: 240px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    cursor: pointer;
    transition: transform 0.2s, filter 0.2s;
}
.battle-sprite-container:hover {
    transform: scale(1.05);
}
.sprite-base {
    position: absolute;
    bottom: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 1;
}
.sprite-name-lbl {
    position: absolute;
    bottom: -32px;
    color: #e0f2fe;
    font-size: 11px;
    font-weight: 900;
    background: rgba(15,23,42,0.85);
    border: 1px solid rgba(125,211,252,0.22);
    padding: 4px 8px;
    border-radius: 6px;
    white-space: nowrap;
    text-transform: uppercase;
    z-index: 5;
    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
}
.sprite-hp-bar {
    position: absolute;
    bottom: -46px;
    width: 80px;
    height: 5px;
    background: rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    overflow: hidden;
    z-index: 5;
}
.sprite-hp-fill {
    height: 100%;
    width: 100%;
    background: linear-gradient(90deg, #ef4444, #ff6b81);
}
.battle-sprite-container.is-ally .sprite-hp-fill {
    background: linear-gradient(90deg, #10b981, #34d399);
}
.battle-sprite-container.is-targetable {
    animation: targetGlow 1.2s infinite alternate;
}
.battle-sprite-container.is-dead {
    filter: grayscale(1) brightness(0.4);
    opacity: 0.6;
    pointer-events: none;
}

@keyframes targetGlow {
    0% { filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.4)); transform: scale(1); }
    100% { filter: drop-shadow(0 0 16px rgba(239, 68, 68, 0.9)); transform: scale(1.04); }
}

/* Bottom Control Dock */
#battle-bottom-dock {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: min(920px, 94vw);
    z-index: 15;
    background: rgba(8, 12, 20, 0.97)!important;
    border: 1px solid var(--gold-trim)!important;
    border-radius: 10px!important;
    box-shadow: 0 8px 32px rgba(0,0,0,.6), inset 0 1px rgba(255,255,255,.04)!important;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    overflow: hidden;
    backdrop-filter: blur(8px);
}

/* Character Box Styles */
.character-box {
    transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    display: flex;
    align-items: center;
    border: 1px solid rgba(125,211,252,0.18);
    border-radius: 12px;
    background: #0f1524;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
}
.character-box.active-turn {
    border-color: rgba(14,165,233,0.56);
}
.character-box.inactive-turn {
    border-color: rgba(125,211,252,0.18);
}

/* Inactive Compact Circular Avatar Box */
.character-box.is-inactive {
    flex: 0 0 116px;
    height: 100%;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    cursor: pointer;
}
.character-box.is-inactive:hover {
    border-color: rgba(125,211,252,0.48);
    background: rgba(15,23,42,0.85);
}
.character-box.is-inactive .cb-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid rgba(125,211,252,0.4);
    background-size: cover;
    background-position: center;
    background-color: #1e293b;
}
.character-box.is-inactive .cb-compact-copy {
    display:block;
    min-width:0;
    width:100%;
    text-align:center;
}
.character-box.is-inactive .cb-compact-name {
    display:block;
    color:#e2e8f0;
    font-size:10px;
    font-weight:900;
    line-height:1.1;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    text-transform:uppercase;
}
.character-box.is-inactive .cb-compact-role {
    display:block;
    margin-top:2px;
    color:#7dd3fc;
    font-size:9px;
    font-weight:800;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
}
.character-box.is-inactive .cb-bars {
    width: 100%;
    margin-top: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.character-box.is-inactive .cb-bar {
    height: 4px;
    border-radius: 2px;
    background: rgba(0,0,0,0.5);
    overflow: hidden;
}
.character-box.is-inactive .cb-bar-fill {
    height: 100%;
    width: 100%;
}

/* Permadeath overlay */
.permadeath-overlay {
    position: absolute;
    inset: 0;
    background: rgba(239, 68, 68, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fca5a5;
    font-size: 20px;
    font-weight: bold;
    z-index: 10;
}

/* Active Expanded 2-Column Box */
.character-box.is-active {
    order:-1;
    flex: 1 0 min(720px, calc(100vw - 430px));
    min-width: min(720px, calc(100vw - 430px));
    height: 100%;
    display: grid;
    grid-template-columns: minmax(190px, 240px) minmax(360px, 1fr);
    gap: 12px;
    padding: 12px;
    background: rgba(10, 15, 25, 0.96);
    border-color: rgba(14,165,233,0.62);
    box-shadow: 0 0 28px rgba(14,165,233,0.18), inset 0 1px rgba(255,255,255,.05);
}

.cb-col-profile {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-right: 1px solid rgba(255,255,255,0.08);
    padding-right: 12px;
    min-width: 0;
}
.cb-profile-header {
    display: flex;
    gap: 12px;
    align-items: center;
    width: 100%;
}
.cb-active-avatar {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    border: 2px solid #0ea5e9;
    background-size: cover;
    background-position: center;
    background-color: #1e293b;
    flex-shrink: 0;
}
.cb-stats-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
}
.cb-profile-info {
    min-width: 0;
}
.cb-profile-info strong {
    font-size: 13px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
}
.cb-profile-info span {
    font-size: 10px;
    color: #0ea5e9;
}
.cb-stats-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
}
.cb-stat-progress {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 14px;
}
.cb-stat-label {
    font-size: 9px;
    font-weight: 800;
    width: 18px;
    color: #94a3b8;
}
.cb-stat-bar-container {
    flex: 1;
    height: 6px;
    background: rgba(0,0,0,0.5);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
}
.cb-stat-bar-fill {
    height: 100%;
    border-radius: 3px;
}
.cb-stat-value {
    font-size: 9px;
    font-weight: bold;
    color: #fff;
    white-space: nowrap;
    text-align: right;
    min-width: 32px;
}
.action-menu-container {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 12px;
    height: 100%;
    min-height: 0;
    flex: 1;
}
.action-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    align-content: start;
}
.btn-action, .cb-menu-btn {
    background: #1e293b!important;
    color: #cba35c!important;
    border: 1px solid rgba(203, 163, 92, 0.4)!important;
    border-radius: 6px!important;
    padding: 10px!important;
    margin: 0!important;
    box-sizing: border-box!important;
    font-family: 'Orbitron', monospace!important;
    font-weight: 700!important;
    font-size: 11px!important;
    text-transform: uppercase!important;
    text-align: center!important;
    cursor: pointer!important;
    z-index: 2!important;
    position: relative!important;
    display: flex!important;
    align-items: center!important;
    justify-content: center!important;
    gap: 6px!important;
    transition: all 0.2s!important;
}
.btn-action:hover, .cb-menu-btn:hover {
    background: rgba(220, 20, 60, 0.3)!important;
    border-color: rgba(203, 163, 92, 0.8)!important;
    color: #fff!important;
}
.btn-action.active, .cb-menu-btn.active {
    background: linear-gradient(135deg, var(--party-gold, #f2c86b), #10b981)!important;
    color: #07111f!important;
    border-color: var(--party-gold, #f2c86b)!important;
}
.btn-action.full-width {
    grid-column: span 2!important;
}
.sub-action-pane {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow: hidden;
    height: 100%;
}
.pane-title, .subpanel-header {
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    color: #cba35c;
    margin-bottom: 6px;
}
.sub-button-row, .subpanel-list {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 6px;
    align-content: start;
}
.btn-sub, .subpanel-item {
    position: relative;
    padding: 8px 12px!important;
    background: #1e293b!important;
    border: 1px solid rgba(255, 255, 255, 0.1)!important;
    border-radius: 6px!important;
    cursor: pointer!important;
    font-size: 11px!important;
    font-family: 'Share Tech Mono', monospace!important;
    font-weight: 700!important;
    text-align: center!important;
    transition: all 0.2s!important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    z-index: 2!important;
    display: flex!important;
    align-items: center!important;
    justify-content: center!important;
    min-height: 40px!important;
    color: #e2e8f0!important;
}
.btn-sub:hover, .subpanel-item:hover {
    background: rgba(14, 165, 233, 0.14)!important;
    border-color: rgba(14, 165, 233, 0.4)!important;
    color: #7dd3fc!important;
}
.subpanel-badge {
    display:inline-flex;
    align-items:center;
    min-height:18px;
    margin-left:4px;
    padding:0 5px;
    border-radius:999px;
    background:rgba(203,163,92,0.22);
    color:#facc15;
    font-size:9px;
    font-weight:900;
    text-transform:uppercase;
}
.subpanel-item-tooltip {
    display: none;
    position: absolute;
    bottom: 110%;
    left: 50%;
    transform: translateX(-50%);
    width: 180px;
    background: rgba(15,23,42,0.96);
    border: 1px solid #0ea5e9;
    border-radius: 6px;
    padding: 8px;
    color: #e2e8f0;
    font-size: 10px;
    text-align: left;
    white-space: normal;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    pointer-events: none;
}
.subpanel-item:hover .subpanel-item-tooltip {
    display: block;
}

@media not all {
    .battle-stage {
        bottom: 190px!important;
    }
    #battle-bottom-dock {
        width: min(720px, 94vw)!important;
        max-height: 160px!important;
    }
    .character-box.is-active {
        flex-basis: min(620px, calc(100vw - 350px))!important;
        min-width: min(620px, calc(100vw - 350px))!important;
        grid-template-columns: minmax(170px, 210px) minmax(320px, 1fr)!important;
    }
    .character-box.is-inactive {
        flex-basis: 96px!important;
        padding:8px!important;
    }
    .character-box.is-inactive .cb-avatar {
        width:42px!important;
        height:42px!important;
    }
    .character-box.is-inactive .cb-compact-copy {
        display:block!important;
    }
}

/* Landscape vs Portrait stacking rules */
@media not all {
    .battle-stage {
        grid-template-columns: 1fr!important;
        top: 58px!important;
        bottom: 170px!important;
    }
    #battle-party-stage {
        display: none!important; /* Hide inactive sprites in portrait */
    }
    #battle-bottom-dock {
        width: min(600px, 94vw)!important;
        max-height: 150px!important;
    }
    .character-box.is-inactive {
        flex: 0 0 54px!important;
        width: 100%!important;
        flex-direction: row!important;
        justify-content: flex-start!important;
        align-items:center!important;
        padding: 6px 12px!important;
    }
    .character-box.is-inactive .cb-avatar {
        width:38px!important;
        height:38px!important;
        flex:0 0 38px!important;
    }
    .character-box.is-inactive .cb-compact-copy {
        display:block!important;
        flex:0 1 104px!important;
        margin-left:10px!important;
    }
    .character-box.is-inactive .cb-bars {
        width: auto!important;
        flex: 1!important;
        margin-top: 0!important;
        margin-left: 10px!important;
    }
}
@media not all {
    #battle-screen.uie-battle-tactical {
        display:grid!important;
        grid-template-rows:auto minmax(120px, 1fr) minmax(360px, 58dvh)!important;
        grid-template-areas:"turn" "stage" "dock"!important;
        padding: max(8px, env(safe-area-inset-top)) 8px max(8px, env(safe-area-inset-bottom))!important;
        gap:8px!important;
    }
    #battle-screen.uie-battle-tactical #battle-turn-timeline {
        grid-area:turn!important;
        position:relative!important;
        top:auto!important;
        left:auto!important;
        transform:none!important;
        width:100%!important;
        max-width:100%!important;
        min-height:46px!important;
        padding:7px 9px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
        justify-content:flex-start!important;
        z-index:12!important;
    }
    #battle-screen.uie-battle-tactical #battle-turn-queue {
        flex:0 0 auto!important;
        min-width:max-content!important;
    }
    #battle-screen.uie-battle-tactical [style*="top: 20px"][style*="right: 20px"] {
        position:fixed!important;
        top:max(8px, env(safe-area-inset-top))!important;
        right:8px!important;
        gap:6px!important;
        z-index:30!important;
    }
    #battle-screen.uie-battle-tactical [style*="top: 20px"][style*="right: 20px"] button {
        min-height:38px!important;
        padding:6px 9px!important;
        font-size:11px!important;
    }
    .battle-stage {
        grid-area:stage!important;
        position:relative!important;
        top:auto!important;
        bottom:auto!important;
        left:auto!important;
        right:auto!important;
        min-height:0!important;
        height:100%!important;
        display:grid!important;
        grid-template-columns:1fr!important;
        overflow:hidden!important;
        padding:6px 0!important;
    }
    #battle-enemy-stage {
        min-height:0!important;
        overflow:auto!important;
        align-content:center!important;
    }
    #battle-party-stage {
        display:none!important;
    }
    #battle-log {
        display:none!important;
        position:absolute!important;
        left:auto!important;
        right:auto!important;
        bottom:auto!important;
        width:0!important;
        height:0!important;
        max-height:0!important;
        font-size:10px!important;
        z-index:0!important;
        opacity:0!important;
    }
    #battle-bottom-dock {
        grid-area:dock!important;
        position:relative!important;
        left:50%!important;
        right:auto!important;
        bottom:auto!important;
        transform:translateX(-50%)!important;
        width:min(600px,94vw)!important;
        height:auto!important;
        min-height:0!important;
        max-height:160px!important;
        display:flex!important;
        flex-direction:column!important;
        gap:0!important;
        padding:0!important;
        background:rgba(8,12,20,.97)!important;
        border:1px solid rgba(203,163,92,.42)!important;
        border-radius:10px!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        z-index:18!important;
    }
    .character-box.is-active {
        display:flex!important;
        flex-direction:column!important;
        height:auto!important;
        min-height:0!important;
        flex:0 0 auto!important;
        gap:8px!important;
        padding:10px!important;
        border-radius:8px!important;
        background:rgba(10,15,25,.95)!important;
        box-shadow:0 0 20px rgba(14,165,233,.16)!important;
        order:-1!important;
    }
    .cb-col-profile {
        width:100%!important;
        border-right:none!important;
        border-bottom:1px solid rgba(255,255,255,0.08)!important;
        padding:0 0 8px 0!important;
        margin-bottom:0!important;
        gap:7px!important;
    }
    .cb-profile-header {
        gap:9px!important;
        align-items:flex-start!important;
    }
    .cb-active-avatar {
        width:42px!important;
        height:42px!important;
        flex:0 0 42px!important;
    }
    .cb-stats-stack {
        gap:5px!important;
    }
    .cb-profile-info strong {
        font-size:12px!important;
    }
    .cb-profile-info span {
        font-size:9px!important;
    }
    .cb-stats-row {
        gap:3px!important;
    }
    .cb-stat-progress {
        height:13px!important;
        gap:5px!important;
    }
    .cb-stat-label {
        width:17px!important;
    }
    .cb-stat-value {
        min-width:42px!important;
        font-size:9px!important;
    }
    .action-menu-container {
        display:flex!important;
        flex-direction:column!important;
        gap:8px!important;
        width:100%!important;
        height:auto!important;
        min-height:0!important;
    }
    .action-grid {
        grid-template-columns:repeat(2, 1fr)!important;
        gap:6px!important;
        width:100%!important;
    }
    .btn-action, .cb-menu-btn {
        min-width:0!important;
        min-height:40px!important;
        padding:8px 6px!important;
        font-size:10px!important;
        line-height:1.1!important;
        white-space:normal!important;
        word-break:normal!important;
        border-radius:6px!important;
    }
    .btn-action i, .cb-menu-btn i {
        flex:0 0 auto!important;
    }
    .btn-action.full-width {
        grid-column:span 2!important;
    }
    .sub-action-pane {
        width:100%!important;
        height:auto!important;
        max-height:156px!important;
        min-height:74px!important;
        overflow:hidden!important;
        border-top:1px solid rgba(255,255,255,.08)!important;
        padding-top:7px!important;
    }
    .pane-title, .subpanel-header {
        margin-bottom:5px!important;
        font-size:10px!important;
    }
    .sub-button-row {
        grid-template-columns:repeat(2, minmax(0, 1fr))!important;
        gap:6px!important;
        max-height:126px!important;
        overflow-y:auto!important;
        padding-right:1px!important;
    }
    .btn-sub, .subpanel-item {
        min-width:0!important;
        min-height:36px!important;
        padding:7px 8px!important;
        white-space:normal!important;
        overflow:hidden!important;
        text-overflow:clip!important;
        line-height:1.15!important;
        border-radius:6px!important;
    }
    .subpanel-item-tooltip {
        display:none!important;
    }
    .character-box.is-inactive {
        flex:0 0 50px!important;
        min-height:50px!important;
        border-radius:8px!important;
        background:rgba(15,21,36,.92)!important;
        padding:6px 8px!important;
    }
    .character-box.is-inactive .cb-compact-copy {
        flex-basis:92px!important;
    }
    .character-box.is-inactive .cb-bars {
        gap:4px!important;
    }
    .character-box.is-inactive .cb-bar {
        height:5px!important;
    }
}
@media not all {
    #battle-screen.uie-battle-tactical {
        grid-template-rows:auto minmax(96px, 1fr) minmax(390px, 64dvh)!important;
        padding-left:6px!important;
        padding-right:6px!important;
    }
    #battle-bottom-dock {
        width: min(400px, 94vw)!important;
        max-height: 170px!important;
    }
    .action-grid {
        grid-template-columns:repeat(2, minmax(0, 1fr))!important;
    }
    .sub-action-pane {
        max-height:170px!important;
    }
    .sub-button-row {
        max-height:140px!important;
    }
    .character-box.is-inactive .cb-compact-copy {
        flex-basis:78px!important;
    }
}
.battle-party-token.combat-dash{animation:uieCombatDash .46s ease-in-out;}
.battle-enemy-token.combat-hit,.battle-party-token.combat-hit{animation:uieCombatHit .34s ease-in-out;}
.uie-damage-number{position:fixed;z-index:2147483652;font-weight:900;font-size:24px;pointer-events:none;text-shadow:0 2px 8px #000;animation:uieDamageFloat .9s ease-out forwards;}
.uie-battle-vfx{position:fixed;z-index:2147483651;width:86px;height:86px;pointer-events:none;border:3px solid rgba(255,255,255,.8);border-radius:50%;box-shadow:0 0 28px rgba(255,80,80,.9);animation:uieBattleVfx .45s ease-out forwards;}
.turn-token {
    display: flex!important;
    align-items: center!important;
    gap: 6px!important;
    padding: 4px 8px!important;
    border-radius: 6px!important;
    background: rgba(30, 41, 59, 0.75)!important;
    border: 1px solid rgba(255, 255, 255, 0.15)!important;
    font-size: 10px!important;
    font-weight: bold!important;
    color: #e2e8f0!important;
    transition: all 0.2s!important;
    height: 32px!important;
    box-sizing: border-box!important;
    flex-shrink: 0!important;
}
.turn-token.is-ally {
    border-left: 3px solid #10b981!important;
}
.turn-token.is-enemy {
    border-left: 3px solid #ef4444!important;
}
.turn-token.active {
    background: rgba(14, 165, 233, 0.25)!important;
    border: 1.5px solid #0ea5e9!important;
    box-shadow: 0 0 10px rgba(14, 165, 233, 0.6)!important;
    transform: scale(1.05)!important;
}
.turn-token-avatar {
    width: 20px!important;
    height: 20px!important;
    border-radius: 50%!important;
    background-size: cover!important;
    background-position: center!important;
    background-color: #1e293b!important;
    flex-shrink: 0!important;
}
.turn-token-name {
    max-width: 70px!important;
    white-space: nowrap!important;
    overflow: hidden!important;
    text-overflow: ellipsis!important;
}

@keyframes uieCombatDash{0%,100%{transform:translateX(0)}48%{transform:translateX(-14vw) scale(1.08)}}
@keyframes uieCombatHit{0%,100%{filter:none;transform:translateX(0)}35%{filter:brightness(2) saturate(1.8);transform:translateX(-8px)}65%{transform:translateX(8px)}}
@keyframes uieDamageFloat{0%{opacity:0;transform:translateY(8px) scale(.8)}20%{opacity:1}100%{opacity:0;transform:translateY(-54px) scale(1.05)}}
@keyframes uieBattleVfx{0%{opacity:0;transform:scale(.35) rotate(0)}50%{opacity:1}100%{opacity:0;transform:scale(1.45) rotate(22deg)}}
@keyframes activeRingPulse{0%{opacity:.6;transform:translateX(-50%) scale(.9)}100%{opacity:1;transform:translateX(-50%) scale(1.1)}}
@keyframes targetReticle{0%{transform:translateX(-50%) rotate(0)}100%{transform:translateX(-50%) rotate(360deg)}}
@keyframes lowHpPulse{0%{filter:brightness(1)}100%{filter:brightness(.7) saturate(1.4)}}
@keyframes breakFlash{0%{opacity:.5;transform:translate(-50%,-50%) scale(.9)}100%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}}
.battle-sprite-container.is-active-actor::after{content:"";position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);width:100px;height:16px;border-radius:50%;background:radial-gradient(ellipse,rgba(14,165,233,.7) 0%,rgba(14,165,233,0) 70%);box-shadow:0 0 24px 6px rgba(14,165,233,.45);z-index:0;animation:activeRingPulse 1.4s ease-in-out infinite alternate}
.battle-sprite-container.is-target-selected::before{content:"";position:absolute;bottom:10%;left:50%;transform:translateX(-50%);width:90px;height:90px;border:2px solid rgba(239,68,68,.8);border-radius:50%;box-shadow:0 0 18px rgba(239,68,68,.5),inset 0 0 12px rgba(239,68,68,.2);z-index:6;pointer-events:none;animation:targetReticle 1s linear infinite}
.battle-sprite-container.is-low-hp .sprite-base{animation:lowHpPulse 1.6s ease-in-out infinite alternate}
.enemy-intent-chip{position:absolute;top:-8px;left:50%;transform:translateX(-50%);padding:3px 10px;border-radius:999px;background:rgba(239,68,68,.18);border:1px solid rgba(239,68,68,.55);color:#fecaca;font-size:9px;font-weight:900;text-transform:uppercase;z-index:8;box-shadow:0 0 14px rgba(239,68,68,.2);white-space:nowrap;letter-spacing:.5px}
.enemy-intent-chip.intent-danger{background:rgba(239,68,68,.32);border-color:rgba(239,68,68,.8);color:#fff;box-shadow:0 0 20px rgba(239,68,68,.4)}
.enemy-intent-chip.intent-heal{background:rgba(16,185,129,.18);border-color:rgba(16,185,129,.55);color:#a7f3d0}
.enemy-intent-chip.intent-guard{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.55);color:#bfdbfe}
.status-badge-row{position:absolute;top:-22px;left:50%;transform:translateX(-50%);display:flex;gap:3px;z-index:9}
.status-badge{padding:1px 5px;border-radius:4px;font-size:8px;font-weight:900;text-transform:uppercase;white-space:nowrap}
.status-badge.status-guarded{background:rgba(59,130,246,.25);color:#93c5fd;border:1px solid rgba(59,130,246,.5)}
.status-badge.status-stunned{background:rgba(234,179,8,.25);color:#fde047;border:1px solid rgba(234,179,8,.5)}
.status-badge.status-bleeding{background:rgba(239,68,68,.25);color:#fca5a5;border:1px solid rgba(239,68,68,.5)}
.status-badge.status-burning{background:rgba(249,115,22,.25);color:#fdba74;border:1px solid rgba(249,115,22,.5)}
.status-badge.status-poisoned{background:rgba(139,92,246,.25);color:#c4b5fd;border:1px solid rgba(139,92,246,.5)}
.status-badge.status-broken{background:rgba(236,72,153,.25);color:#f9a8d4;border:1px solid rgba(236,72,153,.5)}
.break-indicator{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:16px;font-weight:900;color:#f9a8d4;text-shadow:0 0 12px rgba(236,72,153,.8);z-index:10;pointer-events:none;animation:breakFlash .6s ease-in-out infinite alternate}
.target-inspector{display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(15,23,42,.6);border:1px solid rgba(255,255,255,.08);border-radius:8px;min-width:140px;max-width:200px}
.target-inspector-title{font-size:10px;font-weight:900;text-transform:uppercase;color:#f87171;letter-spacing:.5px}
.target-inspector-name{font-size:12px;font-weight:700;color:#fff}
.target-inspector-row{display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#94a3b8}
.target-inspector-row span:last-child{color:#e2e8f0;font-weight:700}
.action-preview{padding:5px 8px;background:rgba(203,163,92,.08);border:1px solid rgba(203,163,92,.2);border-radius:6px;font-size:10px;color:#fbbf24;margin-top:4px}
.dock-party-strip{display:flex;gap:4px;padding:5px 8px;overflow-x:auto;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}
.dock-party-token{display:flex;align-items:center;gap:5px;padding:3px 6px;border-radius:5px;background:rgba(30,41,59,.6);border:1px solid rgba(255,255,255,.1);flex-shrink:0;transition:all .2s}
.dock-party-token.is-active{border-color:rgba(14,165,233,.6);background:rgba(14,165,233,.12)}
.dock-party-token.is-dead{opacity:.4;pointer-events:none}
.dock-party-token-avatar{width:20px;height:20px;border-radius:50%;background-size:cover;background-position:center;background-color:#1e293b;flex-shrink:0}
.dock-party-token-info{display:flex;flex-direction:column;min-width:0}
.dock-party-token-name{font-size:8px;font-weight:900;color:#e2e8f0;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dock-party-token-hp{width:40px;height:2px;background:rgba(0,0,0,.5);border-radius:2px;overflow:hidden}
.dock-party-token-hp-fill{height:100%;background:linear-gradient(90deg,#10b981,#34d399)}
.dock-main-row{display:flex;align-items:stretch;gap:0;min-height:0}
.dock-left-profile{flex:0 0 160px;display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-right:1px solid rgba(255,255,255,.06);overflow-y:auto}
.dock-center-actions{flex:1;display:flex;flex-direction:column;gap:4px;padding:6px 8px;min-width:0;overflow-y:auto}
.dock-right-inspector{flex:0 0 150px;padding:6px 8px;border-left:1px solid rgba(255,255,255,.06);overflow-y:auto}
.vital-hp{background:#2a9d8f!important}
.vital-mp{background:#00b4d8!important}
.vital-ap{background:#e76f51!important}
.vital-sp{background:#8b5cf6!important}
.vital-stamina{background:#f59e0b!important}
.vital-focus{background:#06b6d4!important}
.vital-sanity{background:#a855f7!important}
.vital-shield{background:#64748b!important}

/* Fugue 16:9 landscape battle viewport restoration */
#battle-screen.uie-battle-tactical.landscape-gameplay {
    --color-panel-bg: rgba(12, 16, 22, 0.85);
    --color-gold-accent: #c99c4e;
    --color-gold-dim: rgba(201, 156, 78, 0.25);
    --color-text-light: #ffffff;
    --color-text-gold: #c99c4e;
    --gold-trim: #c99c4e;
    display:block!important;
    width:100vw!important;
    height:100dvh!important;
    aspect-ratio:auto!important;
    background-color:#000!important;
    background-image:var(--uie-battle-bg, var(--user-current-bg))!important;
    color:var(--color-text-light)!important;
    font-family:Inter, "Segoe UI", system-ui, sans-serif!important;
    font-weight:400!important;
}
#battle-screen.uie-battle-tactical.landscape-gameplay #battle-bg-blur {
    display:none!important;
    opacity:0!important;
}
.battle-header-hud {
    position:absolute!important;
    top:16px!important;
    left:16px!important;
    right:16px!important;
    height:44px!important;
    z-index:40!important;
    display:flex!important;
    align-items:center!important;
    justify-content:space-between!important;
    gap:16px!important;
    pointer-events:none!important;
}
.battle-header-hud .hud-left,
#battle-turn-timeline {
    position:relative!important;
    inset:auto!important;
    left:auto!important;
    top:auto!important;
    transform:none!important;
    height:44px!important;
    max-width:56vw!important;
    display:flex!important;
    align-items:center!important;
    gap:10px!important;
    padding:0 14px!important;
    background:var(--color-panel-bg)!important;
    border:1px solid var(--color-gold-accent)!important;
    border-radius:6px!important;
    box-shadow:0 12px 32px rgba(0,0,0,.42)!important;
    backdrop-filter:blur(12px)!important;
    -webkit-backdrop-filter:blur(12px)!important;
    pointer-events:auto!important;
}
.battle-header-hud .hud-right {
    display:flex!important;
    gap:8px!important;
    pointer-events:auto!important;
}
.hud-btn,
#battle-auto-btn,
#battle-close-btn {
    height:36px!important;
    min-width:92px!important;
    padding:0 12px!important;
    background:var(--color-panel-bg)!important;
    border:1px solid var(--color-gold-accent)!important;
    border-radius:4px!important;
    color:var(--color-text-gold)!important;
    font:500 12px/1 Inter, "Segoe UI", system-ui, sans-serif!important;
    letter-spacing:0!important;
    text-transform:uppercase!important;
    cursor:pointer!important;
    backdrop-filter:blur(12px)!important;
    -webkit-backdrop-filter:blur(12px)!important;
}
#battle-close-btn,
.hud-btn.flee-action { color:#ffffff!important; }
.turn-token {
    height:28px!important;
    border:1px solid var(--color-gold-dim)!important;
    border-radius:4px!important;
    background:rgba(255,255,255,.04)!important;
    color:#fff!important;
    font-weight:500!important;
}
.turn-token.is-ally,
.turn-token.is-enemy { border-left:1px solid var(--color-gold-dim)!important; }
.turn-token.active {
    border:1px solid var(--color-gold-accent)!important;
    background:rgba(201,156,78,.15)!important;
    box-shadow:none!important;
    transform:none!important;
}
.battle-stage {
    position:absolute!important;
    top:68px!important;
    left:0!important;
    right:0!important;
    bottom:200px!important;
    z-index:5!important;
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    align-items:end!important;
    justify-items:center!important;
    gap:32px!important;
    padding:0 7vw 10px!important;
    overflow:hidden!important;
    background-image:var(--uie-battle-bg, var(--user-current-bg))!important;
    background-size:cover!important;
    background-position:center!important;
}
.sprite-stage-col {
    height:100%!important;
    width:100%!important;
    display:flex!important;
    align-items:flex-end!important;
    justify-content:center!important;
    gap:clamp(18px, 4vw, 54px)!important;
    padding-bottom:34px!important;
}
.battle-sprite-container {
    width:clamp(118px, 14vw, 196px)!important;
    height:clamp(210px, 42vh, 430px)!important;
}
.sprite-base {
    object-fit:contain!important;
    object-position:center bottom!important;
}
.sprite-name-lbl,
.sprite-hp-bar {
    position:absolute!important;
    border:1px solid var(--color-gold-dim)!important;
    background:var(--color-panel-bg)!important;
    color:#fff!important;
    font-weight:500!important;
    letter-spacing:0!important;
    text-transform:none!important;
}
.battle-console-dock,
#battle-bottom-dock {
    position:absolute!important;
    left:50%!important;
    right:auto!important;
    bottom:12px!important;
    transform:translateX(-50%)!important;
    width:min(920px,94vw)!important;
    height:auto!important;
    min-height:0!important;
    max-height:180px!important;
    z-index:50!important;
    display:flex!important;
    flex-direction:column!important;
    padding:0!important;
    overflow:hidden!important;
    background:rgba(8,12,20,.97)!important;
    border:1px solid var(--color-gold-accent)!important;
    border-radius:10px!important;
    box-shadow:0 8px 32px rgba(0,0,0,.6)!important;
    backdrop-filter:blur(8px)!important;
}
.char-battle-card,
.character-box.is-active {
    width:100%!important;
    height:100%!important;
    min-width:0!important;
    flex:0 1 auto!important;
    display:grid!important;
    grid-template-columns:minmax(270px, .9fr) minmax(520px, 1.4fr)!important;
    gap:24px!important;
    padding:16px!important;
    background:var(--color-panel-bg)!important;
    border:1px solid var(--color-gold-accent)!important;
    border-radius:6px!important;
    box-shadow:0 -14px 44px rgba(0,0,0,.45)!important;
    backdrop-filter:blur(12px)!important;
    -webkit-backdrop-filter:blur(12px)!important;
    overflow:hidden!important;
}
.character-box.is-inactive { display:none!important; }
.console-left-vitals,
.cb-col-profile {
    display:flex!important;
    flex-direction:column!important;
    min-width:0!important;
    gap:12px!important;
    padding:0!important;
    border:0!important;
}
.char-identity-row,
.cb-profile-header {
    display:flex!important;
    align-items:center!important;
    gap:12px!important;
}
.avatar-frame-glow,
.cb-active-avatar {
    width:54px!important;
    height:54px!important;
    flex:0 0 54px!important;
    border-radius:50%!important;
    border:1px solid var(--color-gold-accent)!important;
    background-color:rgba(255,255,255,.05)!important;
    background-size:cover!important;
    background-position:center!important;
    box-shadow:0 0 16px rgba(201,156,78,.28)!important;
}
.name-block,
.cb-stats-stack {
    min-width:0!important;
    flex:1!important;
}
.lbl-name,
.cb-profile-info strong {
    color:#fff!important;
    font-size:15px!important;
    font-weight:500!important;
    line-height:1.2!important;
    overflow:hidden!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important;
}
.lbl-title,
.cb-profile-info span {
    color:var(--color-text-gold)!important;
    font-size:11px!important;
    font-weight:400!important;
}
.expr-tag,
.gauge-id,
.cb-stat-label,
.pane-title {
    color:var(--color-text-gold)!important;
    font-weight:500!important;
    letter-spacing:0!important;
    text-transform:uppercase!important;
}
.vn-select-element {
    min-width:0!important;
    height:30px!important;
    flex:1!important;
    border:1px solid var(--color-gold-dim)!important;
    border-radius:4px!important;
    background:rgba(255,255,255,.04)!important;
    color:#fff!important;
    font:400 12px/1 Inter, "Segoe UI", system-ui, sans-serif!important;
}
.vitals-matrix,
.cb-stats-row {
    display:flex!important;
    flex-direction:column!important;
    gap:8px!important;
    margin-top:0!important;
}
.gauge-row,
.cb-stat-progress {
    display:grid!important;
    grid-template-columns:32px 1fr 64px!important;
    align-items:center!important;
    gap:8px!important;
    height:auto!important;
}
.gauge-track,
.cb-stat-bar-container {
    height:6px!important;
    background:rgba(255,255,255,.08)!important;
    border-radius:3px!important;
    overflow:hidden!important;
}
.gauge-bar,
.cb-stat-bar-fill { height:100%!important; border-radius:3px!important; }
.hp-fill { background:#2a9d8f!important; }
.mp-fill { background:#00b4d8!important; }
.ap-fill { background:#e76f51!important; }
.gauge-fraction,
.cb-stat-value {
    color:#fff!important;
    min-width:64px!important;
    text-align:right!important;
    font-size:12px!important;
    font-weight:500!important;
}
.console-right-commands,
.action-menu-container {
    display:flex!important;
    flex-direction:column!important;
    gap:12px!important;
    height:100%!important;
    min-width:0!important;
    min-height:0!important;
}
.primary-command-row,
.action-grid {
    display:flex!important;
    gap:6px!important;
    width:100%!important;
    min-height:48px!important;
}
.action-trigger-btn,
.btn-action,
.cb-menu-btn {
    flex:1 1 0!important;
    min-width:0!important;
    height:48px!important;
    padding:0 6px!important;
    background:rgba(255,255,255,.02)!important;
    border:1px solid var(--color-gold-dim)!important;
    border-radius:4px!important;
    color:var(--color-text-gold)!important;
    font:500 12px/1.15 Inter, "Segoe UI", system-ui, sans-serif!important;
    letter-spacing:0!important;
    text-transform:uppercase!important;
    white-space:normal!important;
    box-shadow:none!important;
}
.action-trigger-btn.selected,
.btn-action.active,
.cb-menu-btn.active,
.action-trigger-btn:active {
    border-color:var(--color-gold-accent)!important;
    background:rgba(201,156,78,.15)!important;
    color:#fff!important;
}
.internal-sub-menu-view,
.sub-action-pane {
    flex:1!important;
    min-height:0!important;
    margin-top:0!important;
    padding-top:12px!important;
    border-top:1px solid var(--color-gold-dim)!important;
    overflow:hidden!important;
}
.sub-view-title,
.pane-title {
    display:block!important;
    margin-bottom:8px!important;
    font-size:11px!important;
}
.sub-options-flex-wrapper,
.sub-button-row,
.subpanel-list {
    display:flex!important;
    flex-wrap:wrap!important;
    gap:8px!important;
    max-height:84px!important;
    overflow:auto!important;
}
.sub-action-node,
.btn-sub,
.subpanel-item {
    min-width:124px!important;
    min-height:38px!important;
    padding:8px 14px!important;
    background:rgba(255,255,255,.04)!important;
    border:1px solid var(--color-gold-dim)!important;
    border-radius:4px!important;
    color:#fff!important;
    font:400 12px/1.15 Inter, "Segoe UI", system-ui, sans-serif!important;
    white-space:normal!important;
    text-align:center!important;
}
.subpanel-badge {
    border-radius:4px!important;
    background:rgba(201,156,78,.16)!important;
    color:var(--color-text-gold)!important;
    font-weight:500!important;
}
#battle-log {
    left:16px!important;
    bottom:210px!important;
    width:min(520px, 40vw)!important;
    height:280px!important;
    background:var(--color-panel-bg)!important;
    border:1px solid var(--color-gold-dim)!important;
    border-radius:6px!important;
    color:#fff!important;
    font-family:Inter, "Segoe UI", system-ui, sans-serif!important;
    font-weight:400!important;
    backdrop-filter:blur(12px)!important;
    -webkit-backdrop-filter:blur(12px)!important;
}
#battle-status-message {
    border:1px solid var(--color-gold-accent)!important;
    border-radius:6px!important;
    background:var(--color-panel-bg)!important;
    color:var(--color-text-gold)!important;
    font-family:Inter, "Segoe UI", system-ui, sans-serif!important;
    font-weight:500!important;
    letter-spacing:0!important;
    backdrop-filter:blur(12px)!important;
    -webkit-backdrop-filter:blur(12px)!important;
}
@media not all {
    #battle-screen.uie-battle-tactical.landscape-gameplay {
        display:block!important;
        padding:0!important;
    }
    .battle-header-hud { top:10px!important; left:10px!important; right:10px!important; }
    .battle-stage {
        position:absolute!important;
        top:60px!important;
        bottom:180px!important;
        grid-template-columns:1fr 1fr!important;
        padding:0 3vw 8px!important;
    }
    #battle-party-stage { display:flex!important; }
    #battle-bottom-dock {
        position:absolute!important;
        left:50%!important;
        right:auto!important;
        bottom:10px!important;
        transform:translateX(-50%)!important;
        width:min(700px,94vw)!important;
        height:auto!important;
        min-height:0!important;
        max-height:160px!important;
        overflow:hidden!important;
        padding:0!important;
    }
    .character-box.is-active {
        display:grid!important;
        grid-template-columns:minmax(220px, .9fr) minmax(380px, 1.4fr)!important;
        height:100%!important;
        min-height:0!important;
    }
    .action-menu-container { display:flex!important; flex-direction:column!important; }
    .action-grid { display:flex!important; grid-template-columns:none!important; }
    .sub-action-pane {
        width:100%!important;
        max-height:none!important;
        min-height:0!important;
    }
}

/* Compact command deck with a separate square battle log beside it. */
#battle-screen.uie-battle-tactical .battle-stage {
    bottom:300px!important;
}
#battle-screen.uie-battle-tactical #battle-bottom-dock {
    left:20px!important;
    right:250px!important;
    width:auto!important;
    transform:none!important;
    max-height:250px!important;
}
#battle-screen.uie-battle-tactical .dock-main-row {
    display:grid!important;
    grid-template-columns:220px minmax(0,1fr)!important;
    align-items:stretch!important;
    min-height:220px!important;
    max-height:220px!important;
}
#battle-screen.uie-battle-tactical .dock-left-profile {
    flex:0 0 220px!important;
    justify-content:center!important;
    padding:10px 12px!important;
}
#battle-screen.uie-battle-tactical .dock-center-actions {
    padding:9px 12px!important;
}
#battle-screen.uie-battle-tactical #battle-log-panel {
    position:absolute!important;
    right:20px!important;
    bottom:12px!important;
    width:220px!important;
    height:220px!important;
    box-sizing:border-box!important;
    z-index:51!important;
    padding:10px!important;
    border:1px solid var(--color-gold-dim)!important;
    border-radius:10px!important;
    background:rgba(4,8,14,.66)!important;
    display:flex!important;
    flex-direction:column!important;
    overflow:hidden!important;
    box-shadow:0 8px 32px rgba(0,0,0,.6), inset 0 1px rgba(255,255,255,.04)!important;
}
#battle-screen.uie-battle-tactical .dock-battle-log-title {
    flex:0 0 auto!important;
    margin-bottom:8px!important;
    color:var(--color-text-gold)!important;
    font:700 11px/1 Inter,system-ui,sans-serif!important;
    letter-spacing:.08em!important;
    text-transform:uppercase!important;
}
#battle-screen.uie-battle-tactical .primary-command-row {
    min-height:44px!important;
}
#battle-screen.uie-battle-tactical .sub-action-pane {
    min-height:64px!important;
}
#battle-screen.uie-battle-tactical .battle-player-statuses {
    display:flex;
    flex-wrap:wrap;
    gap:4px;
    margin-top:7px;
}
#battle-screen.uie-battle-tactical .battle-player-statuses span {
    padding:3px 7px;
    border:1px solid rgba(125,211,252,.24);
    border-radius:999px;
    background:rgba(125,211,252,.08);
    color:#dff6ff;
    font-size:9px;
    font-weight:800;
}
#battle-screen.uie-battle-tactical .battle-player-statuses .is-clear {
    border-color:rgba(255,255,255,.1);
    background:rgba(255,255,255,.04);
    color:#94a3b8;
}
#battle-screen.uie-battle-tactical #battle-log {
    position:relative!important;
    inset:auto!important;
    transform:none!important;
    flex:1 1 auto!important;
    width:100%!important;
    min-width:0!important;
    height:auto!important;
    min-height:0!important;
    padding:10px!important;
    overflow-y:auto!important;
    border-radius:6px!important;
    background:rgba(8,14,22,.92)!important;
    box-shadow:inset 0 0 0 1px rgba(125,211,252,.08)!important;
    font-size:11px!important;
}
#battle-screen.uie-battle-tactical #battle-log .battle-log-entry {
    display:block!important;
    margin:0 0 6px!important;
    line-height:1.35!important;
}
@media not all {
    #battle-screen.uie-battle-tactical .battle-stage { bottom:250px!important; }
    #battle-screen.uie-battle-tactical #battle-bottom-dock {
        right:200px!important;
        max-height:205px!important;
    }
    #battle-screen.uie-battle-tactical .dock-main-row {
        grid-template-columns:170px minmax(0,1fr)!important;
        min-height:170px!important;
        max-height:170px!important;
    }
    #battle-screen.uie-battle-tactical .dock-left-profile { flex-basis:auto!important; }
    #battle-screen.uie-battle-tactical #battle-log-panel {
        right:20px!important;
        width:170px!important;
        height:170px!important;
    }
}

/* Viewport contract: this final block is the single authority for the outer
   battle geometry. Component rules above may style their contents, but cannot
   shrink or offset the tactical surface. */
#battle-screen.uie-battle-tactical {
    inset:0!important;
    width:100dvw!important;
    height:100dvh!important;
    min-width:0!important;
    min-height:0!important;
    max-width:none!important;
    max-height:none!important;
    padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)!important;
    contain:layout paint!important;
}
#battle-screen.uie-battle-tactical .battle-stage {
    top:max(64px,calc(env(safe-area-inset-top) + 54px))!important;
    right:max(12px,env(safe-area-inset-right))!important;
    bottom:max(196px,calc(env(safe-area-inset-bottom) + 184px))!important;
    left:max(12px,env(safe-area-inset-left))!important;
    width:auto!important;
    height:auto!important;
    min-height:0!important;
    padding:clamp(8px,2vw,28px)!important;
    overflow:hidden!important;
}
#battle-screen.uie-battle-tactical #battle-bottom-dock {
    position:absolute!important;
    left:max(12px,env(safe-area-inset-left))!important;
    right:max(250px,calc(env(safe-area-inset-right) + 238px))!important;
    bottom:max(12px,env(safe-area-inset-bottom))!important;
    width:auto!important;
    height:clamp(160px,24dvh,230px)!important;
    min-height:0!important;
    max-height:none!important;
    overflow:hidden!important;
}
#battle-screen.uie-battle-tactical #battle-log-panel {
    position:absolute!important;
    right:max(12px,env(safe-area-inset-right))!important;
    bottom:max(12px,env(safe-area-inset-bottom))!important;
    width:220px!important;
    height:clamp(160px,24dvh,230px)!important;
    min-width:0!important;
    min-height:0!important;
    max-height:none!important;
    overflow:hidden!important;
}
#battle-screen.uie-battle-tactical .dock-main-row {
    min-height:0!important;
    max-height:none!important;
    height:100%!important;
}
@media not all {
    #battle-screen.uie-battle-tactical .battle-stage {
        top:max(56px,calc(env(safe-area-inset-top) + 48px))!important;
        bottom:max(248px,calc(env(safe-area-inset-bottom) + 240px))!important;
        grid-template-columns:1fr 1fr!important;
        gap:6px!important;
    }
    #battle-screen.uie-battle-tactical #battle-bottom-dock {
        left:max(8px,env(safe-area-inset-left))!important;
        right:max(8px,env(safe-area-inset-right))!important;
        bottom:max(8px,env(safe-area-inset-bottom))!important;
        height:228px!important;
    }
    #battle-screen.uie-battle-tactical #battle-log-panel {
        top:max(58px,calc(env(safe-area-inset-top) + 50px))!important;
        right:max(8px,env(safe-area-inset-right))!important;
        bottom:auto!important;
        width:min(42vw,190px)!important;
        height:min(25dvh,180px)!important;
    }
    #battle-screen.uie-battle-tactical .dock-main-row {
        grid-template-columns:minmax(116px,34%) minmax(0,1fr)!important;
        height:100%!important;
    }
}

/* UIE_BATTLE_SOURCE_MOBILE
 * One source-owned mobile landscape layout. No runtime observer scripts.
 *
 * The sprite stage is the primary battle visual. Commands and history use a
 * compact bottom strip. Desktop rules above remain unchanged.
 */

/* Keep only one visible Battle Log surface on every viewport. */
#battle-screen.uie-battle-tactical #battle-log-panel {
    background:transparent!important;
    border:0!important;
    box-shadow:none!important;
    backdrop-filter:none!important;
    -webkit-backdrop-filter:none!important;
    padding:0!important;
}
#battle-screen.uie-battle-tactical .dock-battle-log-title {
    display:none!important;
}
#battle-screen.uie-battle-tactical #battle-log {
    background:rgba(7,12,19,.97)!important;
    border:1px solid rgba(203,163,92,.48)!important;
    box-shadow:0 8px 24px rgba(0,0,0,.42)!important;
    backdrop-filter:none!important;
    -webkit-backdrop-filter:none!important;
}

/* Player and enemy cards share the same footer treatment. */
#battle-screen.uie-battle-tactical .sprite-hp-text {
    position:absolute;
    inset:0;
    display:grid;
    place-items:center;
    color:#fff;
    font-size:7px;
    font-weight:900;
    line-height:8px;
    text-shadow:0 1px 2px #000;
    pointer-events:none;
}
#battle-screen.uie-battle-tactical .battle-sprite-placeholder {
    display:grid!important;
    place-items:center!important;
    background:linear-gradient(135deg,rgba(14,165,233,.22),rgba(139,92,246,.26))!important;
    color:rgba(255,255,255,.56)!important;
    font-size:42px!important;
}

@media (pointer:coarse) and (orientation:landscape) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-dock-left:11vw;
        --uie-battle-dock-width:56vw;
        --uie-battle-log-right:11vw;
        --uie-battle-log-width:20vw;
        --uie-battle-bottom-height:80px;
        display:block!important;
        width:100vw!important;
        height:100dvh!important;
        padding:0!important;
        overflow:hidden!important;
    }

    #battle-screen.uie-battle-tactical #battle-turn-timeline {
        position:absolute!important;
        top:5px!important;
        left:6px!important;
        right:auto!important;
        width:min(58vw,540px)!important;
        max-width:58vw!important;
        height:38px!important;
        min-height:38px!important;
        padding:0 8px!important;
        gap:5px!important;
        transform:none!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
    }
    #battle-screen.uie-battle-tactical #battle-turn-queue {
        min-width:max-content!important;
        gap:4px!important;
    }
    #battle-screen.uie-battle-tactical .turn-token {
        height:25px!important;
        padding:2px 6px!important;
        gap:4px!important;
        font-size:9px!important;
        transform:none!important;
    }
    #battle-screen.uie-battle-tactical .turn-token-avatar {
        width:16px!important;
        height:16px!important;
    }

    #battle-screen.uie-battle-tactical .battle-header-actions {
        top:5px!important;
        right:6px!important;
        gap:5px!important;
    }
    #battle-screen.uie-battle-tactical :is(#battle-auto-btn,#battle-close-btn) {
        height:32px!important;
        min-width:78px!important;
        padding:0 9px!important;
        font-size:9px!important;
        border-width:1px!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
    }

    #battle-screen.uie-battle-tactical .battle-stage {
        position:absolute!important;
        top:47px!important;
        right:0!important;
        bottom:92px!important;
        left:0!important;
        width:auto!important;
        height:auto!important;
        min-height:0!important;
        grid-template-columns:1fr 1fr!important;
        align-items:end!important;
        gap:12px!important;
        padding:0 clamp(10px,2vw,24px) 4px!important;
        overflow:hidden!important;
    }
    #battle-screen.uie-battle-tactical .sprite-stage-col {
        width:100%!important;
        height:100%!important;
        min-width:0!important;
        display:flex!important;
        align-items:flex-end!important;
        justify-content:center!important;
        gap:clamp(10px,1.6vw,22px)!important;
        padding:0 0 7px!important;
        overflow:visible!important;
    }
    #battle-screen.uie-battle-tactical .battle-sprite-container {
        position:relative!important;
        width:clamp(104px,10.5vw,142px)!important;
        min-width:clamp(104px,10.5vw,142px)!important;
        max-width:clamp(104px,10.5vw,142px)!important;
        height:clamp(178px,46dvh,230px)!important;
        min-height:clamp(178px,46dvh,230px)!important;
        max-height:calc(100% - 4px)!important;
        margin:0!important;
        padding:0 0 25px!important;
        overflow:visible!important;
        box-sizing:border-box!important;
    }
    #battle-screen.uie-battle-tactical .sprite-base {
        position:absolute!important;
        top:0!important;
        right:0!important;
        bottom:25px!important;
        left:0!important;
        width:100%!important;
        height:auto!important;
        max-width:100%!important;
        max-height:none!important;
        object-fit:contain!important;
        object-position:center bottom!important;
    }
    #battle-screen.uie-battle-tactical .sprite-name-lbl {
        position:absolute!important;
        right:3px!important;
        bottom:10px!important;
        left:3px!important;
        width:auto!important;
        max-width:none!important;
        margin:0!important;
        padding:2px 4px!important;
        overflow:hidden!important;
        white-space:nowrap!important;
        text-overflow:ellipsis!important;
        text-align:center!important;
        font-size:7.5px!important;
        line-height:1.05!important;
        text-transform:none!important;
        border-radius:4px!important;
        background:rgba(5,9,15,.92)!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
    }
    #battle-screen.uie-battle-tactical .sprite-hp-bar {
        position:absolute!important;
        right:8px!important;
        bottom:2px!important;
        left:8px!important;
        width:auto!important;
        height:7px!important;
        margin:0!important;
        border-radius:4px!important;
        overflow:hidden!important;
    }

    #battle-screen.uie-battle-tactical #battle-bottom-dock {
        position:fixed!important;
        top:auto!important;
        right:auto!important;
        bottom:5px!important;
        left:var(--uie-battle-dock-left)!important;
        width:var(--uie-battle-dock-width)!important;
        max-width:var(--uie-battle-dock-width)!important;
        height:var(--uie-battle-bottom-height)!important;
        min-height:var(--uie-battle-bottom-height)!important;
        max-height:var(--uie-battle-bottom-height)!important;
        margin:0!important;
        padding:0!important;
        transform:none!important;
        display:flex!important;
        flex-direction:column!important;
        gap:0!important;
        overflow:hidden!important;
        border-radius:7px!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
    }
    #battle-screen.uie-battle-tactical .dock-party-strip {
        flex:0 0 27px!important;
        height:27px!important;
        min-height:27px!important;
        padding:2px 4px!important;
        gap:3px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
    }
    #battle-screen.uie-battle-tactical .dock-party-token {
        height:22px!important;
        min-height:22px!important;
        padding:1px 4px!important;
        gap:3px!important;
        border-radius:4px!important;
    }
    #battle-screen.uie-battle-tactical .dock-party-token-avatar {
        width:17px!important;
        height:17px!important;
    }
    #battle-screen.uie-battle-tactical .dock-party-token-name {
        max-width:46px!important;
        font-size:6.5px!important;
    }
    #battle-screen.uie-battle-tactical .dock-party-token-hp {
        width:34px!important;
    }

    #battle-screen.uie-battle-tactical .dock-main-row {
        flex:1 1 auto!important;
        min-height:0!important;
        height:53px!important;
        display:grid!important;
        grid-template-columns:minmax(0,1fr) 150px!important;
        align-items:stretch!important;
        overflow:hidden!important;
    }
    #battle-screen.uie-battle-tactical .dock-left-profile {
        min-width:0!important;
        height:53px!important;
        padding:3px 6px!important;
        border-right:1px solid rgba(255,255,255,.08)!important;
        overflow:hidden!important;
    }
    #battle-screen.uie-battle-tactical .vitals-matrix {
        display:grid!important;
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:2px 7px!important;
        margin:0!important;
    }
    #battle-screen.uie-battle-tactical .cb-stat-progress {
        display:grid!important;
        grid-template-columns:18px minmax(0,1fr) 33px!important;
        align-items:center!important;
        height:13px!important;
        min-height:13px!important;
        gap:3px!important;
        margin:0!important;
    }
    #battle-screen.uie-battle-tactical .cb-stat-label,
    #battle-screen.uie-battle-tactical .cb-stat-value {
        min-width:0!important;
        font-size:6.5px!important;
        line-height:1!important;
    }
    #battle-screen.uie-battle-tactical .cb-stat-bar-container {
        height:4px!important;
    }
    #battle-screen.uie-battle-tactical .battle-player-statuses {
        display:none!important;
    }

    #battle-screen.uie-battle-tactical .dock-center-actions {
        position:relative!important;
        width:150px!important;
        min-width:150px!important;
        max-width:150px!important;
        height:53px!important;
        min-height:53px!important;
        padding:3px 4px!important;
        gap:2px!important;
        overflow:hidden!important;
    }
    #battle-screen.uie-battle-tactical .primary-command-row,
    #battle-screen.uie-battle-tactical .action-grid {
        display:grid!important;
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
        grid-auto-rows:21px!important;
        width:100%!important;
        min-height:0!important;
        height:47px!important;
        gap:3px!important;
        margin:0!important;
        padding:0!important;
        align-content:start!important;
    }
    #battle-screen.uie-battle-tactical :is(.btn-action,.cb-menu-btn) {
        width:auto!important;
        min-width:0!important;
        max-width:none!important;
        height:21px!important;
        min-height:21px!important;
        max-height:21px!important;
        padding:1px 2px!important;
        gap:2px!important;
        font-size:6.5px!important;
        line-height:1!important;
        white-space:nowrap!important;
        overflow:hidden!important;
    }
    #battle-screen.uie-battle-tactical .sub-action-pane {
        position:absolute!important;
        inset:3px 4px!important;
        width:auto!important;
        height:auto!important;
        min-width:0!important;
        min-height:0!important;
        max-width:none!important;
        max-height:none!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        background:rgba(7,12,19,.98)!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
    }
    #battle-screen.uie-battle-tactical .battle-sub-back {
        position:sticky!important;
        top:0!important;
        z-index:3!important;
        width:100%!important;
        min-height:17px!important;
        margin:0 0 2px!important;
        padding:2px 4px!important;
        border:1px solid rgba(203,163,92,.46)!important;
        border-radius:4px!important;
        background:rgba(10,15,23,.98)!important;
        color:#f0c56f!important;
        font-size:6.5px!important;
        font-weight:900!important;
        line-height:1!important;
    }
    #battle-screen.uie-battle-tactical .pane-title {
        display:block!important;
        margin:0 0 2px!important;
        font-size:6px!important;
        line-height:1!important;
    }
    #battle-screen.uie-battle-tactical .sub-button-row {
        display:grid!important;
        grid-template-columns:1fr!important;
        gap:2px!important;
        max-height:none!important;
        overflow:visible!important;
    }
    #battle-screen.uie-battle-tactical :is(.btn-sub,.subpanel-item) {
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        min-height:17px!important;
        padding:2px 3px!important;
        font-size:6.5px!important;
        line-height:1!important;
    }

    #battle-screen.uie-battle-tactical #battle-log-panel {
        position:fixed!important;
        top:auto!important;
        right:var(--uie-battle-log-right)!important;
        bottom:5px!important;
        left:auto!important;
        width:var(--uie-battle-log-width)!important;
        max-width:var(--uie-battle-log-width)!important;
        height:var(--uie-battle-bottom-height)!important;
        min-height:var(--uie-battle-bottom-height)!important;
        max-height:var(--uie-battle-bottom-height)!important;
        margin:0!important;
        padding:0!important;
        overflow:hidden!important;
        border-radius:7px!important;
    }
    #battle-screen.uie-battle-tactical #battle-log {
        position:relative!important;
        inset:auto!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        height:100%!important;
        min-height:0!important;
        max-height:100%!important;
        margin:0!important;
        padding:5px 7px!important;
        overflow-y:auto!important;
        font-size:8px!important;
        line-height:1.2!important;
        border-radius:7px!important;
    }
    #battle-screen.uie-battle-tactical #battle-log .battle-log-entry {
        margin:0 0 4px!important;
        padding:0!important;
        font-size:inherit!important;
        line-height:inherit!important;
        text-align:left!important;
    }

    #uie-battle-target-modal {
        padding:8px!important;
    }
    #uie-battle-target-modal .uie-battle-target-card {
        width:min(620px,88vw)!important;
        max-height:88dvh!important;
        padding:10px!important;
    }
    #uie-battle-target-modal #uie-battle-target-list {
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:5px!important;
    }
    #uie-battle-target-modal .uie-battle-target-row {
        min-height:48px!important;
        padding:6px!important;
        gap:6px!important;
    }
}

@media (pointer:coarse) and (orientation:landscape) and (max-height:430px) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-bottom-height:74px;
    }
    #battle-screen.uie-battle-tactical .battle-stage {
        bottom:84px!important;
    }
    #battle-screen.uie-battle-tactical .battle-sprite-container {
        height:clamp(160px,46dvh,212px)!important;
    }
    #battle-screen.uie-battle-tactical .dock-party-strip {
        flex-basis:24px!important;
        height:24px!important;
        min-height:24px!important;
    }
    #battle-screen.uie-battle-tactical .dock-main-row,
    #battle-screen.uie-battle-tactical .dock-left-profile,
    #battle-screen.uie-battle-tactical .dock-center-actions {
        height:50px!important;
        min-height:50px!important;
    }
}

/* UIE_BATTLE_ACTION_DRAWER
 * The permanent 80px command strip remains compact. Skills, Magic, and Items
 * receive their own temporary scrollable drawer above it.
 */
@media (pointer:coarse) and (orientation:landscape) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-action-drawer-height:132px;
        --uie-battle-action-drawer-gap:7px;
    }

    #battle-screen.uie-battle-tactical.has-action-drawer .battle-stage {
        bottom:calc(
            var(--uie-battle-bottom-height) +
            var(--uie-battle-action-drawer-height) +
            var(--uie-battle-action-drawer-gap) +
            14px
        )!important;
    }

    #battle-screen.uie-battle-tactical #battle-action-drawer {
        position:fixed!important;
        left:var(--uie-battle-dock-left)!important;
        right:auto!important;
        bottom:calc(
            var(--uie-battle-bottom-height) +
            var(--uie-battle-action-drawer-gap) +
            5px
        )!important;
        z-index:28!important;
        width:var(--uie-battle-dock-width)!important;
        min-width:0!important;
        max-width:var(--uie-battle-dock-width)!important;
        height:var(--uie-battle-action-drawer-height)!important;
        min-height:var(--uie-battle-action-drawer-height)!important;
        max-height:var(--uie-battle-action-drawer-height)!important;
        display:grid!important;
        grid-template-rows:27px minmax(0,1fr)!important;
        margin:0!important;
        padding:0!important;
        overflow:hidden!important;
        border:1px solid rgba(203,163,92,.58)!important;
        border-radius:7px!important;
        background:rgba(7,12,19,.985)!important;
        box-shadow:0 10px 28px rgba(0,0,0,.56)!important;
        color:#e5f4ff!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
        box-sizing:border-box!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-head {
        display:grid!important;
        grid-template-columns:62px minmax(0,1fr) 24px!important;
        align-items:center!important;
        gap:5px!important;
        min-width:0!important;
        height:27px!important;
        padding:3px 5px!important;
        border-bottom:1px solid rgba(203,163,92,.26)!important;
        background:rgba(14,20,30,.98)!important;
        box-sizing:border-box!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-head strong {
        min-width:0!important;
        overflow:hidden!important;
        white-space:nowrap!important;
        text-overflow:ellipsis!important;
        color:#f0c56f!important;
        font-size:8px!important;
        line-height:1!important;
        letter-spacing:.08em!important;
        text-align:center!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-head > span {
        display:grid!important;
        place-items:center!important;
        width:20px!important;
        height:18px!important;
        border-radius:999px!important;
        background:rgba(203,163,92,.16)!important;
        color:#fde68a!important;
        font-size:7px!important;
        font-weight:900!important;
    }

    #battle-screen.uie-battle-tactical .battle-drawer-back {
        width:62px!important;
        min-width:62px!important;
        height:19px!important;
        min-height:19px!important;
        margin:0!important;
        padding:1px 5px!important;
        border:1px solid rgba(203,163,92,.46)!important;
        border-radius:4px!important;
        background:rgba(22,27,36,.98)!important;
        color:#f0c56f!important;
        font-size:7px!important;
        font-weight:900!important;
        line-height:1!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list {
        display:grid!important;
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
        grid-auto-rows:minmax(31px,auto)!important;
        align-content:start!important;
        gap:5px!important;
        width:100%!important;
        min-width:0!important;
        height:100%!important;
        min-height:0!important;
        margin:0!important;
        padding:6px!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        scrollbar-width:thin!important;
        box-sizing:border-box!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .btn-sub {
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        min-height:31px!important;
        height:auto!important;
        margin:0!important;
        padding:4px 6px!important;
        font-size:7.5px!important;
        line-height:1.08!important;
        white-space:normal!important;
        overflow:hidden!important;
        text-overflow:ellipsis!important;
        word-break:normal!important;
        border-radius:5px!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .subpanel-badge {
        min-height:13px!important;
        padding:0 3px!important;
        font-size:6px!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .subpanel-item-tooltip {
        display:none!important;
    }

    /* Main commands stay visible beneath the open drawer so the user may jump
       directly from Skills to Magic or Items without closing first. */
    #battle-screen.uie-battle-tactical .dock-center-actions .primary-command-row {
        display:grid!important;
    }
}

@media (pointer:coarse) and (orientation:landscape) and (max-height:430px) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-action-drawer-height:116px;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list {
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        grid-auto-rows:minmax(29px,auto)!important;
        gap:4px!important;
        padding:5px!important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .btn-sub {
        min-height:29px!important;
        padding:3px 5px!important;
        font-size:7px!important;
    }
}



/* UIE_BATTLE_COMPACT_TABS_V4
 * Mobile landscape:
 * - one short permanent command bar
 * - stacked life trackers
 * - Skills / Magic / Items open a separate screen even when empty
 */
@media (pointer: coarse) and (orientation: landscape) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-bottom-height: 68px;
        --uie-battle-bottom-gap: 5px;
        --uie-battle-dock-left: 11vw;
        --uie-battle-dock-width: 56vw;
        --uie-battle-log-right: 11vw;
        --uie-battle-log-width: 20vw;
        --uie-battle-action-drawer-height: 96px;
    }

    #battle-screen.uie-battle-tactical .battle-stage {
        bottom: calc(
            var(--uie-battle-bottom-height) +
            var(--uie-battle-bottom-gap) +
            8px
        ) !important;
    }

    #battle-screen.uie-battle-tactical.has-action-drawer .battle-stage {
        bottom: calc(
            var(--uie-battle-bottom-height) +
            var(--uie-battle-action-drawer-height) +
            16px
        ) !important;
    }

    #battle-screen.uie-battle-tactical #battle-bottom-dock {
        position: fixed !important;
        left: var(--uie-battle-dock-left) !important;
        right: auto !important;
        bottom: var(--uie-battle-bottom-gap) !important;
        width: var(--uie-battle-dock-width) !important;
        min-width: 0 !important;
        max-width: var(--uie-battle-dock-width) !important;
        height: var(--uie-battle-bottom-height) !important;
        min-height: var(--uie-battle-bottom-height) !important;
        max-height: var(--uie-battle-bottom-height) !important;
        margin: 0 !important;
        padding: 3px !important;
        overflow: hidden !important;
        transform: none !important;
        box-sizing: border-box !important;
    }

    #battle-screen.uie-battle-tactical #battle-log-panel {
        position: fixed !important;
        right: var(--uie-battle-log-right) !important;
        left: auto !important;
        bottom: var(--uie-battle-bottom-gap) !important;
        width: var(--uie-battle-log-width) !important;
        min-width: 0 !important;
        max-width: var(--uie-battle-log-width) !important;
        height: var(--uie-battle-bottom-height) !important;
        min-height: var(--uie-battle-bottom-height) !important;
        max-height: var(--uie-battle-bottom-height) !important;
        margin: 0 !important;
        padding: 4px 6px !important;
        overflow: hidden !important;
        transform: none !important;
        box-sizing: border-box !important;
    }

    #battle-screen.uie-battle-tactical #battle-log {
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        max-height: 100% !important;
        padding: 0 !important;
        overflow-y: auto !important;
        font-size: 8px !important;
        line-height: 1.16 !important;
    }

    #battle-screen.uie-battle-tactical .dock-battle-log-title {
        display: none !important;
    }

    #battle-screen.uie-battle-tactical .dock-main-row {
        display: grid !important;
        grid-template-columns:
            132px
            minmax(150px, 1fr)
            150px !important;
        align-items: stretch !important;
        gap: 4px !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        max-height: 100% !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .dock-party-strip {
        display: flex !important;
        align-items: stretch !important;
        gap: 3px !important;
        min-width: 0 !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
    }

    #battle-screen.uie-battle-tactical .dock-party-token {
        flex: 0 0 62px !important;
        width: 62px !important;
        min-width: 62px !important;
        max-width: 62px !important;
        height: 100% !important;
        min-height: 0 !important;
        padding: 3px !important;
        display: grid !important;
        grid-template-rows: 27px minmax(0, 1fr) !important;
        justify-items: center !important;
        align-items: center !important;
        gap: 1px !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .dock-party-token-avatar {
        width: 25px !important;
        height: 25px !important;
    }

    #battle-screen.uie-battle-tactical .dock-party-token-info {
        width: 100% !important;
        min-width: 0 !important;
        align-items: center !important;
    }

    #battle-screen.uie-battle-tactical .dock-party-token-name {
        width: 100% !important;
        font-size: 6.5px !important;
        text-align: center !important;
    }

    #battle-screen.uie-battle-tactical .dock-party-token-hp {
        width: 48px !important;
        height: 3px !important;
    }

    #battle-screen.uie-battle-tactical .dock-left-profile {
        min-width: 0 !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 2px 4px !important;
        border: 0 !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
    }

    #battle-screen.uie-battle-tactical .vitals-matrix,
    #battle-screen.uie-battle-tactical .cb-stats-row {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        grid-auto-flow: row !important;
        align-content: start !important;
        gap: 2px !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
    }

    #battle-screen.uie-battle-tactical .gauge-row,
    #battle-screen.uie-battle-tactical .cb-stat-progress {
        display: grid !important;
        grid-template-columns: 20px minmax(0, 1fr) 46px !important;
        align-items: center !important;
        gap: 4px !important;
        width: 100% !important;
        height: 15px !important;
        min-height: 15px !important;
        margin: 0 !important;
    }

    #battle-screen.uie-battle-tactical .cb-stat-label {
        width: auto !important;
        min-width: 0 !important;
        font-size: 7px !important;
    }

    #battle-screen.uie-battle-tactical .cb-stat-bar-container {
        height: 5px !important;
    }

    #battle-screen.uie-battle-tactical .cb-stat-value {
        width: auto !important;
        min-width: 0 !important;
        font-size: 7px !important;
    }

    #battle-screen.uie-battle-tactical .dock-center-actions {
        min-width: 0 !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 1px !important;
        border: 0 !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .primary-command-row,
    #battle-screen.uie-battle-tactical .action-grid {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        grid-template-rows: repeat(2, minmax(0, 1fr)) !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        gap: 3px !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .btn-action,
    #battle-screen.uie-battle-tactical .cb-menu-btn {
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 2px !important;
        gap: 2px !important;
        font-size: 6.5px !important;
        line-height: 1 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .btn-action i,
    #battle-screen.uie-battle-tactical .cb-menu-btn i {
        font-size: 7px !important;
    }

    #battle-screen.uie-battle-tactical #battle-action-drawer {
        position: fixed !important;
        left: var(--uie-battle-dock-left) !important;
        right: auto !important;
        bottom: calc(
            var(--uie-battle-bottom-height) +
            var(--uie-battle-bottom-gap) +
            5px
        ) !important;
        z-index: 80 !important;
        width: var(--uie-battle-dock-width) !important;
        min-width: 0 !important;
        max-width: var(--uie-battle-dock-width) !important;
        height: var(--uie-battle-action-drawer-height) !important;
        min-height: var(--uie-battle-action-drawer-height) !important;
        max-height: var(--uie-battle-action-drawer-height) !important;
        display: grid !important;
        grid-template-rows: 24px minmax(0, 1fr) !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        border: 1px solid rgba(203, 163, 92, .62) !important;
        border-radius: 7px !important;
        background: rgba(7, 12, 19, .985) !important;
        box-shadow: 0 10px 28px rgba(0, 0, 0, .56) !important;
        color: #e5f4ff !important;
        box-sizing: border-box !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-head {
        display: grid !important;
        grid-template-columns: 54px minmax(0, 1fr) 22px !important;
        align-items: center !important;
        gap: 4px !important;
        height: 24px !important;
        padding: 2px 4px !important;
        border-bottom: 1px solid rgba(203, 163, 92, .25) !important;
        background: rgba(14, 20, 30, .98) !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-head strong {
        min-width: 0 !important;
        overflow: hidden !important;
        white-space: nowrap !important;
        text-overflow: ellipsis !important;
        text-align: center !important;
        color: #f0c56f !important;
        font-size: 8px !important;
        text-transform: uppercase !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-head > span {
        display: grid !important;
        place-items: center !important;
        width: 20px !important;
        height: 17px !important;
        border-radius: 999px !important;
        background: rgba(203, 163, 92, .17) !important;
        color: #fde68a !important;
        font-size: 7px !important;
    }

    #battle-screen.uie-battle-tactical .battle-drawer-back {
        width: 54px !important;
        min-width: 54px !important;
        height: 18px !important;
        min-height: 18px !important;
        margin: 0 !important;
        padding: 1px 3px !important;
        border: 1px solid rgba(203, 163, 92, .48) !important;
        border-radius: 4px !important;
        background: rgba(22, 27, 36, .98) !important;
        color: #f0c56f !important;
        font-size: 6.5px !important;
        font-weight: 900 !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        grid-auto-rows: minmax(27px, auto) !important;
        align-content: start !important;
        gap: 4px !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 5px !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .btn-sub {
        width: 100% !important;
        min-width: 0 !important;
        min-height: 27px !important;
        max-height: none !important;
        padding: 3px 5px !important;
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto !important;
        align-items: center !important;
        gap: 4px !important;
        font-size: 7px !important;
        line-height: 1.05 !important;
        white-space: normal !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .btn-sub > span {
        min-width: 0 !important;
        overflow: hidden !important;
        white-space: nowrap !important;
        text-overflow: ellipsis !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-drawer-list .btn-sub small {
        color: #f0c56f !important;
        font-size: 6px !important;
        white-space: nowrap !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-empty {
        grid-column: 1 / -1 !important;
        min-height: 58px !important;
        display: grid !important;
        grid-template-columns: 22px minmax(0, 1fr) !important;
        grid-template-rows: auto auto !important;
        align-content: center !important;
        column-gap: 7px !important;
        padding: 7px 10px !important;
        border: 1px dashed rgba(203, 163, 92, .32) !important;
        border-radius: 6px !important;
        background: rgba(255, 255, 255, .025) !important;
        color: #d1d5db !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-empty i {
        grid-row: 1 / 3 !important;
        align-self: center !important;
        color: #f0c56f !important;
        font-size: 15px !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-empty strong {
        font-size: 8px !important;
        color: #fff !important;
    }

    #battle-screen.uie-battle-tactical .battle-action-empty span {
        font-size: 7px !important;
        opacity: .68 !important;
    }
}

@media (pointer: coarse) and (orientation: landscape) and (max-height: 430px) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-bottom-height: 62px;
        --uie-battle-action-drawer-height: 86px;
    }

    #battle-screen.uie-battle-tactical .dock-main-row {
        grid-template-columns:
            122px
            minmax(142px, 1fr)
            144px !important;
    }

    #battle-screen.uie-battle-tactical .gauge-row,
    #battle-screen.uie-battle-tactical .cb-stat-progress {
        height: 14px !important;
        min-height: 14px !important;
    }
}





/* UIE_BATTLE_LEAN_DOCK_V2_START
 * The battlefield sprites are the character cards.
 * No duplicate portrait strip in the command dock.
 * The mobile option drawer is narrow and the log is cut to a compact height.
 */
#battle-screen.uie-battle-tactical .dock-party-strip,
#battle-screen.uie-battle-tactical .dock-party-token {
    display: none !important;
}

/* Shared desktop/mobile fallback after removing the duplicate portrait strip. */
#battle-screen.uie-battle-tactical .dock-main-row {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 220px !important;
    align-items: stretch !important;
}

@media (pointer: coarse) and (orientation: landscape) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-bottom-edge: max(3px, env(safe-area-inset-bottom, 0px));
        --uie-battle-command-height: 68px;
        --uie-battle-dock-left: 14vw;
        --uie-battle-dock-width: 46vw;
        --uie-battle-drawer-width: clamp(340px, 34vw, 520px);
        --uie-battle-log-width: clamp(300px, 29vw, 430px);
        --uie-battle-log-height: 86px;
        --uie-battle-log-right: max(8px, 2vw);
    }

    #battle-screen.uie-battle-tactical #battle-bottom-dock {
        position: fixed !important;
        top: auto !important;
        right: auto !important;
        bottom: var(--uie-battle-bottom-edge) !important;
        left: var(--uie-battle-dock-left) !important;
        width: var(--uie-battle-dock-width) !important;
        min-width: 0 !important;
        max-width: var(--uie-battle-dock-width) !important;
        height: var(--uie-battle-command-height) !important;
        min-height: var(--uie-battle-command-height) !important;
        max-height: var(--uie-battle-command-height) !important;
        margin: 0 !important;
        padding: 3px !important;
        transform: none !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .dock-main-row {
        grid-template-columns: minmax(170px, 1fr) 150px !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        gap: 4px !important;
        overflow: hidden !important;
    }

    #battle-screen.uie-battle-tactical .dock-left-profile,
    #battle-screen.uie-battle-tactical .dock-center-actions {
        height: 100% !important;
        min-height: 0 !important;
        max-height: 100% !important;
    }

    /* Drawer sits above the commands only, not across the trackers. */
    #battle-screen.uie-battle-tactical #battle-action-drawer {
        left: calc(
            var(--uie-battle-dock-left) +
            var(--uie-battle-dock-width) -
            var(--uie-battle-drawer-width)
        ) !important;
        right: auto !important;
        width: var(--uie-battle-drawer-width) !important;
        min-width: var(--uie-battle-drawer-width) !important;
        max-width: var(--uie-battle-drawer-width) !important;
    }

    #battle-screen.uie-battle-tactical #battle-log-panel {
        position: fixed !important;
        top: auto !important;
        right: var(--uie-battle-log-right) !important;
        bottom: var(--uie-battle-bottom-edge) !important;
        left: auto !important;
        width: var(--uie-battle-log-width) !important;
        min-width: var(--uie-battle-log-width) !important;
        max-width: var(--uie-battle-log-width) !important;
        height: var(--uie-battle-log-height) !important;
        min-height: var(--uie-battle-log-height) !important;
        max-height: var(--uie-battle-log-height) !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        transform: none !important;
        overflow: visible !important;
    }

    #battle-screen.uie-battle-tactical .dock-battle-log-title {
        display: none !important;
    }

    #battle-screen.uie-battle-tactical #battle-log {
        position: relative !important;
        inset: auto !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        max-height: 100% !important;
        margin: 0 !important;
        padding: 7px 9px !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        background: rgba(7, 12, 19, .97) !important;
        border: 1px solid rgba(203, 163, 92, .52) !important;
        border-radius: 8px !important;
        box-shadow: 0 8px 22px rgba(0, 0, 0, .44) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        font-size: 8.5px !important;
        line-height: 1.2 !important;
        box-sizing: border-box !important;
    }

    #battle-screen.uie-battle-tactical .battle-stage {
        bottom: calc(
            var(--uie-battle-log-height) +
            var(--uie-battle-bottom-edge) +
            7px
        ) !important;
    }

    #battle-screen.uie-battle-tactical.has-action-drawer .battle-stage {
        bottom: max(
            calc(
                var(--uie-battle-log-height) +
                var(--uie-battle-bottom-edge) +
                7px
            ),
            calc(
                var(--uie-battle-command-height) +
                var(--uie-battle-action-drawer-height, 96px) +
                var(--uie-battle-bottom-edge) +
                12px
            )
        ) !important;
    }
}

@media (pointer: coarse) and (orientation: landscape) and (max-height: 430px) {
    #battle-screen.uie-battle-tactical {
        --uie-battle-command-height: 62px;
        --uie-battle-log-height: 80px;
        --uie-battle-drawer-width: clamp(320px, 33vw, 480px);
    }
}
/* UIE_BATTLE_LEAN_DOCK_V2_END */
`;
}

function escHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function esc(value) {
    return escHtml(value);
}

function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function nameKey(value) {
    return normalizeName(value).toLowerCase();
}

function currentUserName(s) {
    return normalizeName(s?.character?.name || s?.name || s?.persona?.name || "You") || "You";
}

function addTarget(map, rawName, source = "Scene", extra = {}) {
    const name = normalizeName(rawName);
    if (!name) return;
    if (/^(you|user|player|story|system|narrator|game|assistant)$/i.test(name)) return;
    const key = nameKey(name);
    if (!key) return;
    const existing = map.get(key) || {};
    const hp = Number.isFinite(Number(extra.hp)) ? Number(extra.hp) : Number(existing.hp ?? 100);
    const maxHp = Number.isFinite(Number(extra.maxHp)) ? Number(extra.maxHp) : Number(existing.maxHp ?? Math.max(100, hp));
    map.set(key, {
        id: existing.id || extra.id || `scene_${key.replace(/[^a-z0-9]+/g, "_")}`,
        name,
        source: existing.source ? `${existing.source}, ${source}` : source,
        hp: Math.max(1, Math.round(hp || 100)),
        maxHp: Math.max(1, Math.round(maxHp || 100)),
        mp: Number.isFinite(Number(extra.mp)) ? Math.max(0, Math.round(Number(extra.mp))) : existing.mp,
        maxMp: Number.isFinite(Number(extra.maxMp)) ? Math.max(1, Math.round(Number(extra.maxMp))) : existing.maxMp,
        ap: Number.isFinite(Number(extra.ap)) ? Math.max(0, Math.round(Number(extra.ap))) : existing.ap,
        maxAp: Number.isFinite(Number(extra.maxAp)) ? Math.max(1, Math.round(Number(extra.maxAp))) : existing.maxAp,
        level: Number.isFinite(Number(extra.level)) ? Math.max(0, Math.round(Number(extra.level))) : existing.level,
        className: normalizeName(extra.className || existing.className || ""),
        type: normalizeName(extra.type || existing.type || ""),
        threat: normalizeName(extra.threat || existing.threat || ""),
        imageUrl: extra.imageUrl || existing.imageUrl || "",
        attacks: Array.isArray(extra.attacks) ? extra.attacks : (existing.attacks || []),
        loot: Array.isArray(extra.loot) ? extra.loot : (existing.loot || []),
        xp: Number.isFinite(Number(extra.xp)) ? Math.max(0, Math.round(Number(extra.xp))) : (existing.xp ?? 50),
        gold: Number.isFinite(Number(extra.gold)) ? Math.max(0, Math.round(Number(extra.gold))) : (existing.gold ?? 25)
    });
}

function collectDomSceneTargets(map) {
    const selectors = [
        "[data-npc-name]",
        "[data-character-name]",
        "[data-char-name]",
        "[data-name]",
        "#vn-sprite-layer .manual-stage-sprite",
        "#vn-sprite-layer .re-sprite",
        "#vn-sprite-layer .vn-scene-sprite",
        ".re-sprite"
    ].join(",");
    try {
        document.querySelectorAll(selectors).forEach((el) => {
            const name =
                el.getAttribute("data-npc-name") ||
                el.getAttribute("data-character-name") ||
                el.getAttribute("data-char-name") ||
                el.getAttribute("data-name") ||
                el.getAttribute("alt") ||
                "";
            const img = el.tagName === "IMG" ? el.getAttribute("src") : "";
            addTarget(map, name, "Stage", { imageUrl: img || "" });
        });
    } catch (_) {}
}

function collectSettingsTargets(map, s) {
    const battleEnemies = Array.isArray(s?.battle?.state?.enemies) ? s.battle.state.enemies : [];
    for (const e of battleEnemies) addTarget(map, e?.name, "Battle Tracker", e || {});

    const sceneChars = Array.isArray(s?.sceneCharacters) ? s.sceneCharacters : [];
    for (const c of sceneChars) addTarget(map, c?.name || c?.title, "Scene Characters", { ...c, imageUrl: c?.avatar || c?.portrait || c?.imageUrl || c?.src || "" });

    const socialGroups = s?.social && typeof s.social === "object" ? ["rivals", "associates", "friends", "romance", "family"] : [];
    for (const group of socialGroups) {
        const list = Array.isArray(s.social[group]) ? s.social[group] : [];
        for (const p of list) {
            const present = p?.presence === "present" || p?.met === true || p?.liveSync === true || p?.active === true;
            if (present) addTarget(map, p?.name, `Social/${group}`, { ...p, imageUrl: p?.sprite || p?.imageUrl || p?.avatar || "" });
        }
    }
}

async function collectChatSpeakerTargets(map, s) {
    try {
        const { getChatMessages } = await import("./chatLog.js");
        const messages = await getChatMessages(40);
        const user = nameKey(currentUserName(s));
        for (const msg of messages) {
            if (msg?.isUser) continue;
            const speaker = normalizeName(msg?.name);
            if (speaker && nameKey(speaker) !== user) addTarget(map, speaker, "Chat Speaker");

            const text = String(msg?.text || "");
            const macroNames = Array.from(text.matchAll(/(?:^|\n)\s*([A-Z][A-Za-z0-9\' ._-]{1,58})\s*:/g))

                .map((m) => normalizeName(m?.[1]))
                .filter(Boolean);
            for (const nm of macroNames) {
                if (nameKey(nm) !== user) addTarget(map, nm, "Macro Speaker");
            }
        }
    } catch (_) {}
}

function isSyntheticBattleTarget(target) {
    const name = normalizeName(target?.name).toLowerCase();
    const source = String(target?.source || "").toLowerCase();

    // These are UI trackers/stage controls, not people or combatants.
    if (!/^(custom|first aid|focus)$/.test(name)) return false;

    // A genuine character with one of these names may still be selected when
    // it came from character/social/chat data rather than only UI trackers.
    const genuineCharacterSource =
        /social\/|scene characters|chat speaker|macro speaker|manual\/macro/.test(source);

    return !genuineCharacterSource;
}

async function getSceneBattleTargets() {
    const s = getSettings();
    const targets = new Map();
    collectSettingsTargets(targets, s);
    collectDomSceneTargets(targets);
    await collectChatSpeakerTargets(targets, s);
    return Array.from(targets.values())
        .filter((target) => !isSyntheticBattleTarget(target))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const ENEMY_ARCHETYPES = {
    beast: {
        stats: { str: 9, dex: 8, con: 7, int: 2, wis: 3, cha: 3, per: 6, luk: 5 },
        skills: [["Savage Bite", "skill", "ap", 1], ["Pounce", "skill", "ap", 1], ["Howl", "skill", "ap", 2], ["Maul", "skill", "ap", 1]],
        trackers: { hp: 1.5, mp: 0, ap: 0.8 },
        threat: 2,
    },
    undead: {
        stats: { str: 5, dex: 4, con: 6, int: 8, wis: 7, cha: 2, per: 5, luk: 4 },
        skills: [["Life Drain", "magic", "mp", 8], ["Curse", "magic", "mp", 6], ["Spectral Wail", "skill", "ap", 2], ["Bone Spike", "skill", "ap", 1]],
        trackers: { hp: 1.1, mp: 1.0, ap: 0.6 },
        threat: 3,
    },
    mage: {
        stats: { str: 3, dex: 5, con: 4, int: 10, wis: 7, cha: 5, per: 6, luk: 5 },
        skills: [["Fireball", "magic", "mp", 10], ["Frost Lance", "magic", "mp", 8], ["Arcane Bolt", "magic", "mp", 6], ["Ward", "skill", "ap", 1]],
        trackers: { hp: 0.9, mp: 1.6, ap: 0.7 },
        threat: 3,
    },
    brute: {
        stats: { str: 11, dex: 4, con: 9, int: 2, wis: 4, cha: 3, per: 4, luk: 4 },
        skills: [["Crushing Blow", "skill", "ap", 1], ["Ground Slam", "skill", "ap", 2], ["Roar", "skill", "ap", 1], ["Shield Wall", "skill", "ap", 1]],
        trackers: { hp: 1.7, mp: 0.2, ap: 0.7 },
        threat: 2,
    },
    assassin: {
        stats: { str: 6, dex: 11, con: 5, int: 5, wis: 6, cha: 5, per: 9, luk: 7 },
        skills: [["Backstab", "skill", "ap", 1], ["Poison Dagger", "skill", "ap", 1], ["Smoke Step", "skill", "ap", 2], ["Venom Bolt", "magic", "mp", 6]],
        trackers: { hp: 1.0, mp: 0.7, ap: 1.2 },
        threat: 3,
    },
    machine: {
        stats: { str: 8, dex: 6, con: 9, int: 7, wis: 6, cha: 1, per: 7, luk: 3 },
        skills: [["Rail Shot", "skill", "ap", 1], ["Plasma Burst", "magic", "mp", 10], ["System Scan", "skill", "ap", 1], ["Overload", "magic", "mp", 12]],
        trackers: { hp: 1.3, mp: 1.1, ap: 1.0 },
        threat: 3,
    },
    fiend: {
        stats: { str: 9, dex: 7, con: 8, int: 9, wis: 7, cha: 6, per: 6, luk: 5 },
        skills: [["Hellfire", "magic", "mp", 12], ["Ravage", "skill", "ap", 2], ["Terrify", "skill", "ap", 1], ["Shadow Lash", "magic", "mp", 8]],
        trackers: { hp: 1.2, mp: 1.3, ap: 0.9 },
        threat: 4,
    },
    humanoid: {
        stats: { str: 6, dex: 6, con: 6, int: 5, wis: 6, cha: 5, per: 6, luk: 5 },
        skills: [["Strike", "skill", "ap", 1], ["Quick Jab", "skill", "ap", 1], ["Focus", "skill", "ap", 1], ["Spark", "magic", "mp", 6]],
        trackers: { hp: 1.0, mp: 0.8, ap: 0.8 },
        threat: 2,
    },
};

const ENEMY_LOADOUTS = {
    beast: { equipment: [{ name: "Natural Hide", slotId: "body", defense: 2, con: 1 }], items: [], disposition: "territorial", objectives: ["drive intruders away", "protect its territory"] },
    undead: { equipment: [{ name: "Grave Robes", slotId: "body", magicalDefense: 3, wis: 1 }], items: [], disposition: "mindless", objectives: ["guard the haunted ground", "drain the living"] },
    mage: { equipment: [{ name: "Channeling Focus", slotId: "weapon", int: 2, magicalDefense: 1 }], items: [{ name: "Restoration Draught", heal: 24 }], disposition: "calculating", objectives: ["disable the opposition", "protect forbidden knowledge"] },
    brute: { equipment: [{ name: "Heavy Maul", slotId: "weapon", str: 2 }, { name: "Scrap Plate", slotId: "body", defense: 4, speed: -1 }], items: [{ name: "Field Tonic", heal: 18 }], disposition: "aggressive", objectives: ["break the enemy line", "force a surrender"] },
    assassin: { equipment: [{ name: "Balanced Daggers", slotId: "weapon", dex: 2, criticalChance: 2 }, { name: "Shadow Leathers", slotId: "body", evasion: 2 }], items: [{ name: "Quick Mend", heal: 14 }], disposition: "self-preserving", objectives: ["complete the contract", "escape after gaining leverage"] },
    machine: { equipment: [{ name: "Armored Chassis", slotId: "body", defense: 4, con: 2 }, { name: "Targeting Array", slotId: "head", accuracy: 3 }], items: [{ name: "Repair Capsule", heal: 20 }], disposition: "construct", objectives: ["enforce its directive", "secure the area"] },
    fiend: { equipment: [{ name: "Infernal Carapace", slotId: "body", defense: 2, magicalDefense: 2 }], items: [], disposition: "fanatic", objectives: ["terrorize its victims", "claim a captive"] },
    humanoid: { equipment: [{ name: "Serviceable Weapon", slotId: "weapon", str: 1 }, { name: "Travel-Worn Armor", slotId: "body", defense: 2 }], items: [{ name: "Minor Healing Potion", heal: 16 }], disposition: "wary", objectives: ["defend its position", "take valuables and withdraw", "force the opposition to yield"] },
};

function detectEnemyArchetype(name, context, type) {
    const text = `${type || ""} ${name || ""} ${context || ""}`.toLowerCase();
    const rules = [
        ["machine", ["robot", "drone", "automaton", "mech", "android", "construct", "turret", "sentinel", "droid"]],
        ["beast", ["wolf", "bear", "beast", "drake", "fang", "lion", "tiger", "serpent", "snake", "spider", "hound", "raptor", "wyrm", "creature"]],
        ["undead", ["ghost", "wraith", "skeleton", "zombie", "lich", "spirit", "phantom", "specter", "spectre", "ghoul", "undead"]],
        ["mage", ["mage", "wizard", "sorcerer", "witch", "warlock", "cultist", "necromancer", "shaman", "elemental", "arcane"]],
        ["brute", ["ogre", "troll", "giant", "golem", "brute", "berserker", "knight", "soldier", "marauder", "raider", "guard", "warrior"]],
        ["assassin", ["assassin", "rogue", "thief", "stalker", "ninja", "spy", "sniper"]],
        ["fiend", ["demon", "devil", "fiend", "imp", "incubus", "succubus", "horror", "abyss"]],
    ];
    for (const [arch, kws] of rules) {
        if (kws.some((kw) => text.includes(kw))) return arch;
    }
    return "humanoid";
}

function makeEnemyRng(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    let state = h >>> 0;
    return {
        next() {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        },
        int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; },
        pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
        shuffle(arr) {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(this.next() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        },
    };
}

function slugifyEnemyName(str) {
    return (String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "enemy");
}

function generateEnemyAttacks(archetype, rng, name) {
    const arch = ENEMY_ARCHETYPES[archetype] || ENEMY_ARCHETYPES.humanoid;
    const pool = rng.shuffle(arch.skills);
    const count = Math.min(pool.length, rng.int(2, 4));
    return pool.slice(0, count).map(([sname, stype, costKey, costVal]) => {
        const cost = Math.max(1, Math.round(costVal * (0.85 + rng.next() * 0.3)));
        return {
            name: sname,
            label: sname,
            skillType: stype,
            type: stype,
            source: "Generated",
            costs: { [costKey]: cost },
            description: `${stype === "magic" ? "A magical attack" : "A physical technique"} wielded by ${name}.`,
            tags: [stype === "magic" ? "magic" : "physical"],
        };
    });
}

function makeEnemyFromTarget(target) {
    const name = normalizeName(target?.name) || "Enemy";
    const s = getSettings();
    const playerLevel = Number(s?.character?.level || s?.jobClass?.level || 1) || 1;
    const context = String(target?.type || target?.className || target?.source || "");
    const archetype = detectEnemyArchetype(name, context, target?.type || target?.className);
    const arch = ENEMY_ARCHETYPES[archetype] || ENEMY_ARCHETYPES.humanoid;
    const seedNonce = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
    const rng = makeEnemyRng(`${name}|${context}|${seedNonce}`);
    const tier = Number(target?.threatTier || target?.tier || arch.threat) || arch.threat;
    const level = Math.max(1, Math.min(60, playerLevel + rng.int(-1, 2)));
    const statScale = 1 + (level - 1) * 0.14;
    const stats = {};
    for (const [k, base] of Object.entries(arch.stats)) {
        stats[k] = Math.max(1, Math.round(base * statScale * (0.9 + rng.next() * 0.25)));
    }
    const hp = Math.max(20, Math.round((45 + level * 16) * arch.trackers.hp * (0.92 + rng.next() * 0.18)));
    const mpScale = arch.trackers.mp;
    const apScale = arch.trackers.ap;
    const mp = mpScale > 0 ? Math.max(0, Math.round((20 + level * 6) * mpScale * (0.9 + rng.next() * 0.2))) : 0;
    const ap = apScale > 0 ? Math.max(0, Math.round((4 + level * 1.5) * apScale * (0.9 + rng.next() * 0.2))) : 0;
    const attacks = generateEnemyAttacks(archetype, rng, name);
    const xp = Math.round((30 + level * 18) * (0.9 + rng.next() * 0.25));
    const gold = Math.round((10 + level * 8) * (0.8 + rng.next() * 0.5));
    const loot = rng.next() < 0.5 ? [`${name.split(/\s+/)[0]} Essence`] : [];
    const loadout = ENEMY_LOADOUTS[archetype] || ENEMY_LOADOUTS.humanoid;
    const equipment = Array.isArray(target?.equipment)
        ? target.equipment.map((item) => ({ ...item }))
        : loadout.equipment.filter(() => rng.next() < 0.82).map((item) => ({ ...item }));
    if (!equipment.length && loadout.equipment.length) equipment.push({ ...rng.pick(loadout.equipment) });
    const items = Array.isArray(target?.items)
        ? target.items.map((item) => typeof item === "string" ? { name: item } : { ...item })
        : loadout.items.filter(() => rng.next() < 0.45).map((item) => ({ ...item }));
    return {
        id: `enemy_${slugifyEnemyName(name)}_${seedNonce}`,
        name,
        hp,
        maxHp: hp,
        mp,
        maxMp: mp,
        ap,
        maxAp: ap,
        level,
        threatTier: tier,
        tier,
        className: target?.className || (archetype.charAt(0).toUpperCase() + archetype.slice(1)),
        stats,
        type: "enemy",
        attacks,
        equipment,
        items,
        disposition: target?.disposition || loadout.disposition,
        objective: target?.objective || rng.pick(loadout.objectives),
        morale: Number.isFinite(Number(target?.morale)) ? Number(target.morale) : Number((0.14 + rng.next() * 0.22).toFixed(2)),
        loot,
        xp,
        gold,
        imageUrl: target?.imageUrl || "",
    };
}

async function generateEnemyDefinition(target) {
    const s = getSettings();
    const playerLevel = Number(s?.character?.level || s?.jobClass?.level || 1) || 1;
    const fallback = makeEnemyFromTarget(target);
    try {
        const location = String(s?.currentLocation || s?.location || target?.source || "");
        const context = `${location} ${target?.type || target?.className || ""}`.trim();
        const res = await generateEnemy({
            name: fallback.name,
            context,
            player_level: playerLevel,
            player_stats: s?.character?.stats || {},
            tier: fallback.threatTier,
            seed_nonce: `${Date.now()}_${Math.floor(Math.random() * 1e9)}`,
        }, { required: false, timeoutMs: 1200 });
        if (res && res.ok && res.enemy) {
            const e = res.enemy;
            return {
                ...fallback,
                ...e,
                id: e.id || fallback.id,
                name: e.name || fallback.name,
                attacks: (Array.isArray(e.attacks) && e.attacks.length) ? e.attacks : fallback.attacks,
                hp: Number(e.hp || fallback.hp),
                maxHp: Number(e.maxHp || e.hp || fallback.maxHp),
                mp: Number(e.mp || 0),
                maxMp: Number(e.maxMp || 0),
                ap: Number(e.ap || 0),
                maxAp: Number(e.maxAp || 0),
                level: Number(e.level || fallback.level),
                stats: (e.stats && Object.keys(e.stats).length) ? e.stats : fallback.stats,
                imageUrl: target?.imageUrl || e.imageUrl || "",
            };
        }
    } catch (_) {}
    return fallback;
}


export async function openBattleTargetPicker() {
    initBattle();
    document.getElementById("uie-battle-target-modal")?.remove();

    const targets = await getSceneBattleTargets();
    const modal = document.createElement("div");
    modal.id = "uie-battle-target-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483651;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:16px;box-sizing:border-box;";

    const targetRows = targets.length ? targets.map((t, i) => `
        <button class="uie-battle-target uie-battle-target-row" data-index="${i}" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid rgba(203, 163, 92,.24);border-radius:8px;background:rgba(255,255,255,.055);color:#f8fafc;cursor:pointer;text-align:left;">
            <span style="width:34px;height:34px;border-radius:6px;background:${t.imageUrl ? `url('${escHtml(t.imageUrl)}') center/cover` : "rgba(220,20,60,.28)"};border:1px solid rgba(255,255,255,.18);display:inline-block;flex:0 0 auto;"></span>
            <span style="display:flex;flex-direction:column;min-width:0;">
                <strong style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.name)}</strong>
                <small style="color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.source || "Scene")} - HP ${escHtml(t.hp || 100)}/${escHtml(t.maxHp || 100)}</small>
            </span>
        </button>
    `).join("") : `<div style="padding:12px;color:#cbd5e1;border:1px solid rgba(255,255,255,.12);border-radius:8px;">No scene names were found yet. Enter a name below to start a battle from a macro speaker or unnamed card.</div>`;

    modal.innerHTML = `
        <div class="uie-battle-target-card" style="width:min(672px,96vw);max-height:90vh;overflow:auto;border:1px solid rgba(203, 163, 92,.42);border-radius:10px;background:linear-gradient(135deg,rgba(15,10,18,.98),rgba(27,13,24,.97));box-shadow:0 24px 80px rgba(0,0,0,.7);padding:19px;color:#f8fafc;font-family:system-ui,sans-serif;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <div style="font-weight:900;color:#cba35c;letter-spacing:.08em;text-transform:uppercase;">Battle Target</div>
                <button id="uie-battle-target-close" title="Close" style="margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;">x</button>
            </div>
            <div id="uie-battle-target-list" style="display:grid;gap:8px;margin-bottom:12px;">${targetRows}</div>
            <div style="display:flex;gap:8px;align-items:center;">
                <input id="uie-battle-manual-name" placeholder="Fight by exact scene name..." style="flex:1;min-width:0;height:36px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,0.35);color:#fff;padding:0 10px;">
                <button id="uie-battle-manual-start" style="height:36px;border-radius:8px;border:1px solid rgba(203, 163, 92,.45);background:rgba(203, 163, 92,.13);color:#cba35c;font-weight:800;cursor:pointer;">Start</button>
            </div>
        </div>
    `;

    const startBattleFor = async (target) => {
        modal.remove();
        const enemy = await generateEnemyDefinition(target).catch(() => makeEnemyFromTarget(target));
        ensureBattle([enemy], { source: "target_picker" });
    };

    modal.querySelector("#uie-battle-target-close")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.remove();
    });
    modal.querySelectorAll(".uie-battle-target").forEach((btn) => {
        btn.addEventListener("click", () => {
            const idx = Number(btn.getAttribute("data-index"));
            const target = targets[idx];
            if (target) startBattleFor(target);
        });
    });
    modal.querySelector("#uie-battle-manual-start")?.addEventListener("click", () => {
        const name = normalizeName(modal.querySelector("#uie-battle-manual-name")?.value || "");
        if (!name) return;
        startBattleFor({ name, source: "Manual/Macro", hp: 100, maxHp: 100 });
    });
    modal.querySelector("#uie-battle-manual-name")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") modal.querySelector("#uie-battle-manual-start")?.click();
    });

    document.body.appendChild(modal);
    setTimeout(() => modal.querySelector("#uie-battle-manual-name")?.focus(), 0);
}

function captureVnSnapshot() {
    const vnScreen = document.getElementById("re-bg") || document.getElementById("vn-screen");
    if (!vnScreen) return null;

    const canvas = document.createElement("canvas");
    const rect = vnScreen.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");

    const bgImage = window.getComputedStyle(vnScreen).backgroundImage;
    if (bgImage && bgImage !== "none") {
        const url = bgImage.match(/url\(["']?([^"']*)["']?\)/)?.[1];
        if (url) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
    } else {
        ctx.fillStyle = "#0a0e1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas;
}

function animateGlassShatter(canvas, onComplete) {
    if (!canvas) {
        if (typeof onComplete === "function") onComplete();
        return;
    }

    const overlay = document.createElement("div");
    overlay.id = "battle-shatter-overlay";
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483640;
        background: url(${canvas.toDataURL()}) center/cover no-repeat;
        pointer-events: none;
    `;
    document.body.appendChild(overlay);

    setTimeout(() => {
        overlay.style.transition = "all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        overlay.style.clipPath = "polygon(0% 0%, 20% 10%, 40% 5%, 60% 15%, 80% 8%, 100% 0%, 85% 30%, 95% 50%, 100% 100%, 75% 85%, 50% 95%, 25% 88%, 0% 100%, 10% 60%, 5% 30%)";
        overlay.style.opacity = "0";
        overlay.style.transform = "scale(1.1) translateY(20px)";
    }, 50);

    setTimeout(() => {
        overlay.remove();
        if (typeof onComplete === "function") onComplete();
    }, 700);
}

function buildBattleScreenHtml(enemies = [], party = []) {
    return `
        <div id="battle-screen" class="uie-battle-tactical" style="
            display: none; position: fixed; inset: 0; z-index: 2147483638;
            background-image: var(--uie-battle-bg, var(--user-current-bg));
            background-size: cover; background-position: center;
            overflow: hidden;
        ">
            <!-- Backdrop Blur -->
            <div id="battle-bg-blur" style="
                position: absolute; inset: 0; z-index: 1;
                background-size: cover; background-position: center;
                filter: blur(12px) brightness(0.4);
            "></div>

            <!-- Turn Order Timeline (Top) -->
            <div id="battle-turn-timeline" style="
                position: absolute; top: 20px; left: 50%; transform: translateX(-50%);
                z-index: 10; display: flex; gap: 8px; padding: 12px 20px;
                background: rgba(0,0,0,0.7); border: 2px solid rgba(14,165,233,0.5);
                border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);
            ">
                <div style="color: #cba35c; font-family: 'Orbitron', monospace; font-weight: 700; font-size: 0.9em; letter-spacing: 1px;">
                    ⚔ TURN ORDER
                </div>
                <div id="battle-turn-queue" style="display: flex; gap: 6px;"></div>
            </div>

            <!-- Battle Target Header Buttons (Top Right) -->
            <div class="battle-header-actions" style="position: absolute; top: 20px; right: 20px; z-index: 20; display: flex; gap: 8px;">
                <button type="button" id="battle-auto-btn" style="
                    background: rgba(0,0,0,0.75); border: 2px solid rgba(14,165,233,0.6);
                    color: #0ea5e9; padding: 10px 16px;
                    font-weight: 800; cursor: pointer; text-transform: uppercase;
                    border-radius: 6px;
                ">Auto: OFF</button>
                <button type="button" id="battle-close-btn" style="
                    background: rgba(0,0,0,0.75); border: 2px solid rgba(220,20,60,0.6);
                    color: rgba(220,20,60,0.9); padding: 10px 16px;
                    font-weight: 800; cursor: pointer; text-transform: uppercase;
                    border-radius: 6px;
                ">✖ FLEE</button>
            </div>

            <!-- Sprite Stage (Center) -->
            <div class="battle-stage">
                <!-- Enemy Column (Left) -->
                <div id="battle-enemy-stage" class="sprite-stage-col"></div>
                <!-- Party Column (Right) -->
                <div id="battle-party-stage" class="sprite-stage-col"></div>
            </div>

            <!-- Bottom Dock -->
            <div id="battle-bottom-dock"></div>
            <aside id="battle-log-panel" aria-label="Battle log">
                <div id="battle-log" role="log" aria-live="polite"></div>
            </aside>

            <!-- Status Message -->
            <div id="battle-status-message" style="
                position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%);
                z-index: 20; padding: 20px 40px;
                background: rgba(0,0,0,0.92); border: 2px solid rgba(203, 163, 92,0.6);
                border-radius: 8px; color: #cba35c; font-family: 'Orbitron', monospace;
                font-size: 1.4em; font-weight: 900; letter-spacing: 2px;
                display: none; text-align: center;
            "></div>
        </div>
        
        <!-- Victory Defeat Windows -->
        <div id="battle-victory-window" class="battle-result-window" style="display:none;position:fixed;inset:0;z-index:2147483642;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:16px;">
            <div class="battle-result-card" style="width:min(520px,94vw);max-height:86vh;overflow:auto;background:linear-gradient(135deg,rgba(20,16,8,.98),rgba(42,28,12,.96));border:2px solid rgba(203, 163, 92,.62);border-radius:10px;padding:18px;color:#fff;box-shadow:0 24px 80px rgba(0,0,0,.72);">
                <h2 style="margin:0 0 10px;color:#cba35c;">Victory</h2>
                <div id="victory-level-up" style="display:none;margin:8px 0;padding:10px;border:1px solid rgba(203, 163, 92,.36);border-radius:8px;background:rgba(203, 163, 92,.08);">
                    <div id="victory-level-text" style="font-weight:900;color:#cba35c;"></div>
                    <div id="victory-level-sub" style="font-size:13px;color:#fef3c7;"></div>
                </div>
                <div id="victory-rewards-list" style="display:grid;gap:8px;margin:10px 0;"></div>
                <div id="victory-skills-section" style="display:none;margin-top:10px;">
                    <h3 style="margin:0 0 8px;color:#bae6fd;">Skills</h3>
                    <div id="victory-skills-list" style="display:grid;gap:8px;"></div>
                </div>
                <div id="victory-effects-section" style="display:none;margin-top:10px;">
                    <h3 style="margin:0 0 8px;color:#c4b5fd;">Effects</h3>
                    <div id="victory-effects-list" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                </div>
                <button id="victory-continue" class="result-btn" style="margin-top:14px;width:100%;height:40px;border-radius:8px;border:1px solid rgba(203, 163, 92,.55);background:rgba(203, 163, 92,.13);color:#cba35c;font-weight:900;cursor:pointer;">Continue</button>
            </div>
        </div>
        <div id="battle-defeat-window" class="battle-result-window" style="display:none;position:fixed;inset:0;z-index:2147483642;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:16px;">
            <div class="battle-result-card" style="width:min(520px,94vw);max-height:86vh;overflow:auto;background:linear-gradient(135deg,rgba(28,8,12,.98),rgba(42,12,18,.96));border:2px solid rgba(220,20,60,.62);border-radius:10px;padding:18px;color:#fff;box-shadow:0 24px 80px rgba(0,0,0,.72);">
                <h2 style="margin:0 0 10px;color:#ff6b81;">Defeat</h2>
                <div id="defeat-narration" style="margin:8px 0 12px;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(0,0,0,.22);color:#ffe4e9;line-height:1.5;">Resolving the aftermath...</div>
                <div id="defeat-penalties-list" style="display:grid;gap:8px;margin:10px 0;"></div>
                <div id="defeat-effects-section" style="display:none;margin-top:10px;">
                    <h3 style="margin:0 0 8px;color:#fecdd3;">Effects</h3>
                    <div id="defeat-effects-list" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                </div>
                <div style="display:flex;gap:8px;margin-top:14px;">
                    <button id="defeat-continue" class="result-btn" style="flex:1;height:40px;border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font-weight:900;cursor:pointer;">Continue</button>
                    <button id="defeat-retry" class="result-btn" style="display:none;flex:1;height:40px;border-radius:8px;border:1px solid rgba(220,20,60,.55);background:rgba(220,20,60,.13);color:#ff9aa8;font-weight:900;cursor:pointer;">Retry</button>
                </div>
            </div>
        </div>
    `;
}

function getCombatantSpeed(c) {
    const stats = c?.stats || {};
    return Number(stats.dex || stats.speed || stats.agi || c?.dex || c?.speed || c?.agi || 10);
}

function buildTurnQueue() {
    const allies = (battleState?.allies || []).map(c => ({ ...c, side: "ally" }));
    const enemies = (battleState?.enemies || []).map(c => ({ ...c, side: "enemy" }));
    const queue = [...allies, ...enemies]
        .filter(c => Number(c.hp || c.vitals?.hp || 0) > 0)
        .sort((a, b) => getCombatantSpeed(b) - getCombatantSpeed(a))
        .map(c => ({ id: c.id, name: c.name, side: c.side, speed: getCombatantSpeed(c) }));
    if (Number(battleState?.round || 0) <= 1 && battleState?.surprised !== true) {
        const controlledId = String(battleState?.projection?.controlledCombatantId || battleState?.player?.id || "");
        const playerIndex = queue.findIndex((token) => token.side === "ally" && (!controlledId || String(token.id) === controlledId));
        if (playerIndex > 0) queue.unshift(queue.splice(playerIndex, 1)[0]);
    }
    return queue;
}

function getCombatantByTurnToken(token) {
    if (!token) return null;
    const list = token.side === "ally" ? (battleState?.allies || []) : (battleState?.enemies || []);
    return list.find(c => String(c.id) === String(token.id));
}

function getActiveActor() {
    if (!battleState?.turnQueue?.length) return null;
    const token = battleState.turnQueue[battleState.turnIndex || 0];
    return getCombatantByTurnToken(token);
}

function livingAllies() {
    return (battleState?.allies || []).filter(a => Number(a.hp || a.vitals?.hp || 0) > 0);
}

function chooseEnemyTarget(enemy) {
    const allies = livingAllies();
    if (!allies.length) return null;
    const hpRatio = (a) => Number(a.hp || 0) / Math.max(1, Number(a.maxHp || a.vitals?.maxHp || 100));
    const wounded = allies.slice().sort((a, b) => hpRatio(a) - hpRatio(b))[0];
    const tank = allies.find(a => /tank|guard|knight|defender|shield|paladin/i.test(`${a.className || ""} ${a.role || ""}`));
    const personality = String(enemy?.personality || enemy?.archetype || "").toLowerCase();
    if (/cruel|sadistic|predator/i.test(personality) && wounded) return wounded;
    if (/brute|aggressive/i.test(personality) && tank) return tank;
    if (Number(enemy?.threatTier || 0) >= 4 && wounded) return wounded;
    return wounded || allies[0];
}

function setEnemyIntent(enemy, intent) {
    if (!battleState.enemyIntents) battleState.enemyIntents = {};
    const label = intent?.label || intent?.opener || "Attack";
    const danger = /heavy|strike|crush|hellfire|overload|drain/i.test(label) ? "high"
        : /heal|ward|guard|focus/i.test(label) ? "low" : "normal";
    battleState.enemyIntents[enemy.id] = { label, targetId: intent?.targetId || null, danger };
}

function rollEnemyIntent(enemy) {
    const intel = getEnemyIntelligence(enemy);
    const attacks = Array.isArray(enemy?.attacks) ? enemy.attacks : [];
    if (!attacks.length) { setEnemyIntent(enemy, { label: "Attack" }); return; }
    const attackScores = attacks.map(a => {
        let score = 10;
        const cost = Number(a.costs?.mp || a.costs?.ap || 0);
        const type = String(a.type || "").toLowerCase();
        if (intel.usesBestAttacks) {
            score += (type === "magic" ? 5 : 2);
            score += cost * 0.8;
        }
        const intWeight = Math.max(1, intel.int / 5);
        score *= intWeight;
        score += Math.random() * 20;
        return { attack: a, score: Math.max(1, score) };
    });
    const totalScore = attackScores.reduce((sum, x) => sum + x.score, 0);
    let roll = Math.random() * totalScore;
    let pick = attacks[0];
    for (const entry of attackScores) {
        roll -= entry.score;
        if (roll <= 0) {
            pick = entry.attack;
            break;
        }
    }
    setEnemyIntent(enemy, { label: pick?.label || pick?.name || "Attack" });
}

function applyStatusEffect(combatant, status) {
    if (!combatant) return;
    if (!Array.isArray(combatant.statuses)) combatant.statuses = [];
    const sName = String(status?.name || status).toLowerCase();
    const existing = combatant.statuses.find(s => String(s?.name || "").toLowerCase() === sName);
    if (existing) {
        existing.turns = Math.max(Number(existing.turns || 0), Number(status?.turns || 3));
    } else {
        combatant.statuses.push({ name: sName, turns: Number(status?.turns || 3), value: Number(status?.value || 0) });
    }
}

function tickStatusEffects(combatant) {
    if (!combatant || !Array.isArray(combatant.statuses)) return;
    const s = getSettings();
    for (const st of combatant.statuses) {
        const name = String(st.name || "").toLowerCase();
        if (name === "bleeding" || name === "burning" || name === "poisoned") {
            const dot = Math.max(1, Number(st.value || Math.floor(Math.random() * 5) + 2));
            combatant.hp = Math.max(0, Number(combatant.hp || 0) - dot);
            if (!combatant.vitals || typeof combatant.vitals !== "object") combatant.vitals = {};
            combatant.vitals.hp = combatant.hp;
            applyCombatantVitalsToSettings(s, combatant);
            addBattleLog(`${combatant.name} takes ${dot} ${name} damage.`, "enemy-action");
            const el = document.querySelector(`.battle-sprite-container[data-combatant-id="${combatant.id}"]`);
            showFloatingNumber(el, `-${dot}`, name === "bleeding" ? "#ef4444" : name === "burning" ? "#f97316" : "#a855f7");
        }
        st.turns = Math.max(0, Number(st.turns || 0) - 1);
    }
    combatant.statuses = combatant.statuses.filter(st => Number(st.turns || 0) > 0);
    saveSettings();
}

function hasStatus(combatant, status) {
    if (!combatant || !Array.isArray(combatant.statuses)) return false;
    return combatant.statuses.some(s => String(s?.name || "").toLowerCase() === String(status).toLowerCase());
}

function removeStatus(combatant, status) {
    if (!combatant || !Array.isArray(combatant.statuses)) return;
    const statusName = String(status).toLowerCase();
    combatant.statuses = combatant.statuses.filter(s => String(s?.name || "").toLowerCase() !== statusName);
}

function getCombatVitals(c) {
    const vitals = c?.vitals && typeof c.vitals === "object" ? c.vitals : c;
    const reserved = new Set([
        "id", "name", "level", "className", "actions", "stats", "presentation",
        "imageUrl", "sprite", "type", "side", "statuses", "source", "threat",
        "threatTier", "tier", "attacks", "loot", "xp", "gold", "role",
        "personality", "archetype", "breakStacks", "guarded"
    ]);
    const pairs = [];
    for (const [key, value] of Object.entries(vitals || {})) {
        if (reserved.has(key)) continue;
        if (key.startsWith("max")) continue;
        const maxKey = `max${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        const max = vitals[maxKey] ?? c?.[maxKey];
        if (Number.isFinite(Number(value)) && Number.isFinite(Number(max)) && Number(max) > 0) {
            pairs.push({
                key, label: key.toUpperCase(),
                value: Number(value), max: Number(max),
                ratio: Math.max(0, Math.min(100, Number(value) / Number(max) * 100))
            });
        }
    }
    if (!pairs.length) {
        pairs.push({
            key: "hp", label: "HP",
            value: Number(c?.hp || 100), max: Number(c?.maxHp || 100),
            ratio: Math.max(0, Math.min(100, Number(c?.hp || 100) / Number(c?.maxHp || 100) * 100))
        });
    }
    return pairs;
}

function getThreatTierLabel(tier) {
    const t = Number(tier || 1);
    if (t >= 5) return "Calamity";
    if (t >= 4) return "Elite";
    if (t >= 3) return "Veteran";
    if (t >= 2) return "Standard";
    return "Weak";
}

function getActionPreview(action, actor, target) {
    if (!action || !actor) return null;
    const costs = action?.costs && typeof action.costs === "object" ? action.costs
        : (action?.cost && typeof action.cost === "object" ? action.cost : {});
    const costParts = [];
    for (const [k, v] of Object.entries(costs)) {
        if (Number(v) > 0) costParts.push(`${v} ${k.toUpperCase()}`);
    }
    let estimate = null;
    if (target && (action.type === "attack" || action.type === "skill" || action.type === "magic")) {
        try {
            const result = evaluateAction(actor, action, target);
            const dmg = Math.max(1, Number(result?.roll?.total || 10) - 5 + Math.max(0, Number(result?.themeBonus || 0)));
            estimate = isHealingAction(action) ? `~${dmg} heal` : `~${dmg} dmg`;
        } catch (_) {}
    }
    return { costs: costParts.join(", ") || "Free", estimate };
}

function addBreakStack(enemy) {
    if (!enemy) return;
    enemy.breakStacks = Number(enemy.breakStacks || 0) + 1;
    if (enemy.breakStacks >= 3) {
        enemy.breakStacks = 0;
        applyStatusEffect(enemy, { name: "broken", turns: 2, value: 0 });
        addBattleLog(`${enemy.name} is BROKEN! Takes increased damage!`, "critical");
    }
}

function recordPlayerTactic(action, target) {
    const s = getSettings();
    if (!s.battle) s.battle = {};
    if (!s.battle.tacticHistory) s.battle.tacticHistory = [];
    const entry = {
        action: String(action?.label || action?.name || action?.id || "unknown"),
        type: String(action?.type || "attack").toLowerCase(),
        target: String(target?.name || ""),
        timestamp: Date.now(),
        damage: 0
    };
    s.battle.tacticHistory.push(entry);
    if (s.battle.tacticHistory.length > 100) {
        s.battle.tacticHistory = s.battle.tacticHistory.slice(-100);
    }
    saveSettings();
}

function updateLastPlayerTacticDamage(damage) {
    const s = getSettings();
    const history = s?.battle?.tacticHistory;
    if (!Array.isArray(history) || !history.length) return;
    history[history.length - 1].damage = Number(damage || 0);
    saveSettings();
}

function getPlayerTacticHistory(limit = 20) {
    const s = getSettings();
    const history = Array.isArray(s?.battle?.tacticHistory) ? s.battle.tacticHistory : [];
    return history.slice(-limit);
}

function getEnemyIntelligence(enemy) {
    const stats = enemy?.stats || {};
    const int = Number(stats.int || 5);
    const wis = Number(stats.wis || 5);
    const per = Number(stats.per || 5);
    const tier = Number(enemy?.threatTier || 1);
    const tierBonus = Math.max(0, (tier - 1) * 2);
    return {
        int: int + tierBonus,
        wis: wis + tierBonus,
        per: per + tierBonus,
        learnsPatterns: wis >= 8 || tier >= 3,
        exploitsWeaknesses: int >= 10 || tier >= 4,
        seesThroughFeints: per >= 9 || tier >= 4,
        usesBestAttacks: int >= 7,
        guardsAgainstRepeated: wis >= 10 || tier >= 3,
        targetsLowStats: per >= 7,
        personality: String(enemy?.personality || enemy?.archetype || "").toLowerCase()
    };
}

function chooseSmartEnemyAction(enemy, target) {
    const attacks = Array.isArray(enemy?.attacks) ? enemy.attacks : [];
    if (!attacks.length) return null;
    const intel = getEnemyIntelligence(enemy);
    const history = getPlayerTacticHistory(15);
    const recentPlayerActions = history.filter(h => h.target === enemy.name || h.target === "").slice(-8);
    const repeatedAction = recentPlayerActions.length >= 3
        ? recentPlayerActions.reduce((acc, curr) => {
            acc[curr.action] = (acc[curr.action] || 0) + 1;
            return acc;
        }, {})
        : {};
    const mostRepeated = Object.entries(repeatedAction).sort((a, b) => b[1] - a[1])[0];
    const smartRoll = Math.random();
    if (intel.guardsAgainstRepeated && mostRepeated && mostRepeated[1] >= 3 && smartRoll < 0.4) {
        const defensiveAttack = attacks.find(a => /guard|ward|shield|focus|defend/i.test(a.label || a.name || ""));
        if (defensiveAttack) {
            addBattleLog(`${enemy.name} anticipates your pattern and guards!`, "enemy-action");
            return { attack: defensiveAttack, guarded: true };
        }
    }
    const attackScores = attacks.map(a => {
        let score = 10;
        const cost = Number(a.costs?.mp || a.costs?.ap || 0);
        const type = String(a.type || "").toLowerCase();
        const label = String(a.label || a.name || "").toLowerCase();
        if (intel.exploitsWeaknesses && target) {
            const targetStats = target?.stats || {};
            const weakStat = Object.entries(targetStats).sort((a, b) => Number(a[1]) - Number(b[1]))[0];
            if (weakStat) {
                const statName = weakStat[0].toLowerCase();
                if ((statName === "str" || statName === "con") && /crush|heavy|force|break/i.test(label)) score += 15;
                if ((statName === "dex" || statName === "agi") && /speed|quick|feint|strike/i.test(label)) score += 15;
                if ((statName === "int" || statName === "wis") && /magic|spell|arcane|mind/i.test(label)) score += 15;
                if (statName === "cha" && /terrify|fear|intimidate/i.test(label)) score += 15;
            }
        }
        if (intel.usesBestAttacks) {
            score += (type === "magic" ? 5 : 2);
            score += cost * 0.8;
        }
        const intWeight = Math.max(1, intel.int / 5);
        score *= intWeight;
        score += Math.random() * 20;
        return { attack: a, score: Math.max(1, score) };
    });
    const totalScore = attackScores.reduce((sum, x) => sum + x.score, 0);
    let roll = Math.random() * totalScore;
    let chosenAttack = attacks[0];
    for (const entry of attackScores) {
        roll -= entry.score;
        if (roll <= 0) {
            chosenAttack = entry.attack;
            break;
        }
    }
    return { attack: chosenAttack, guarded: false };
}

function beginCurrentTurn() {
    if (!battleState) return;
    if (!battleState.turnQueue?.length) {
        battleState.turnQueue = buildTurnQueue();
        battleState.turnIndex = 0;
        battleState.round = Number(battleState.round || 1) + 1;
    }
    if (battleState.turnIndex >= battleState.turnQueue.length) {
        battleState.turnQueue = buildTurnQueue();
        battleState.turnIndex = 0;
        battleState.round = Number(battleState.round || 1) + 1;
    }
    if (!battleState.turnQueue.length) {
        if (liveEnemies().length === 0) endBattle(true);
        else if (livingAllies().length === 0) endBattle(false);
        return;
    }
    const token = battleState.turnQueue[battleState.turnIndex];
    const actor = getCombatantByTurnToken(token);
    if (!actor || Number(actor.hp || actor.vitals?.hp || 0) <= 0) {
        advanceTurn();
        return;
    }
    battleState.activeActorId = actor.id;
    battleState.activeSide = token.side;
    battleState.selectedAction = null;
    battleState.selectedTargetId = null;
        if (Number(actor.hp || actor.vitals?.hp || 0) <= 0) {
        advanceTurn();
        return;
    }
    battleState.activeActorId = actor.id;
    battleState.activeSide = token.side;
    battleState.selectedAction = null;
    battleState.selectedTargetId = null;
    selectedTarget = null;
    pendingAction = null;
    tickStatusEffects(actor);
    if (Number(actor.hp || actor.vitals?.hp || 0) <= 0) {
        advanceTurn();
        return;
    }
    if (token.side === "ally") {
        battleState.player = actor;
        
        // Helper Pet Emergency Heal Support
        const sPet = getSettings();
        if (sPet.helperPet && battleActive) {
            const playerHp = Number(actor.hp || actor.vitals?.hp || 0);
            const playerMaxHp = Number(actor.maxHp || actor.vitals?.maxHp || 100);
            const petLevel = Number(sPet.helperPet.level || 1);
            if (playerHp > 0 && (playerHp / playerMaxHp) < 0.35 && Math.random() < 0.40) {
                const healAmt = Math.round(playerMaxHp * (0.10 + petLevel * 0.01));
                actor.hp = Math.min(playerMaxHp, playerHp + healAmt);
                if (actor.vitals) actor.vitals.hp = actor.hp;
                addBattleLog(`🐾 Emergency Heal! ${sPet.helperPet.name} heals you for ${healAmt} HP!`, "critical");
                saveSettings();
            }
        }

        if (hasStatus(actor, "stunned")) {
            battleState.phase = "resolving";
            addBattleLog(`${actor.name} is stunned and cannot act!`, "critical");
            removeStatus(actor, "stunned");
            renderBattleStage();
            renderBottomDock();
            renderTurnTimeline();
            setTimeout(advanceTurn, 800);
            return;
        }
        if (hasStatus(actor, "guarded")) {
            removeStatus(actor, "guarded");
        }
        battleState.phase = "player_select";
        activeSubTab = "main";
        addBattleLog(`${actor.name}'s turn.`, "player-action");
        renderBattleStage();
        renderBottomDock();
        renderTurnTimeline();
        
        // Auto battle continuation
        const s = getSettings();
        if (s.rpgSettings?.autoBattleEnabled && battleActive) {
            setTimeout(() => {
                if (battleActive && battleState && battleState.phase === "player_select") {
                    runAutoBattleTurn();
                }
            }, 500);
        }
    } else {
        battleState.phase = "enemy_turn";
        rollEnemyIntent(actor);
        renderBattleStage();
        renderTurnTimeline();
        renderBottomDock();
        setTimeout(() => executeEnemyTurn({ enemy: actor }), 650);
    }
}

function advanceTurn() {
    if (!battleActive || !battleState) return;
    battleState.selectedAction = null;
    battleState.selectedTargetId = null;
    selectedTarget = null;
    pendingAction = null;
    activeSubTab = "main";
    document.getElementById("battle-action-drawer")?.remove();
    document.getElementById("battle-screen")?.classList.remove("has-action-drawer");
    if (liveEnemies().length === 0) { endBattle(true); return; }
    if (livingAllies().length === 0) { endBattle(false); return; }
    battleState.turnIndex = Number(battleState.turnIndex || 0) + 1;
    if (battleState.turnIndex >= (battleState.turnQueue?.length || 0)) {
        battleState.turnQueue = buildTurnQueue();
        battleState.turnIndex = 0;
        battleState.round = Number(battleState.round || 1) + 1;
    }
    beginCurrentTurn();
}

async function generateEnemyPortrait(enemy) {
    try {
        const { generateImageAPI } = await import("./imageGen.js");
        const archetype = enemy.className || enemy.type || "creature";
        const prompt = `[UIE_LOCKED] Battle enemy portrait of ${enemy.name}, a ${archetype}. Dark fantasy RPG monster illustration, dramatic lighting, detailed creature design, no humans, no text, no watermark, transparent or dark background.`;
        const url = await generateImageAPI(prompt, { mode: "character" });
        return url;
    } catch (err) {
        console.warn("[Battle] Failed to generate enemy portrait:", err);
        return null;
    }
}

function updateBattlePetAdvisor(hoveredEnemy = null, hoveredEl = null) {
    const adviceEl = document.getElementById("uie-battle-pet-advice");
    if (!battleActive || !battleState) {
        if (adviceEl) adviceEl.remove();
        return;
    }
    
    // Check if helper pet is enabled
    const s = getSettings();
    if (!s.helperPet || s.helperPet.enabled === false) {
        if (adviceEl) adviceEl.remove();
        return;
    }

    const enemy = hoveredEnemy || battleState.enemies.find(e => String(e.id) === String(selectedTarget));
    if (!enemy || Number(enemy.hp || 0) <= 0) {
        if (adviceEl) adviceEl.remove();
        return;
    }

    const targetEl = hoveredEl || document.querySelector(`.battle-sprite-container[data-enemy-id="${enemy.id}"]`);
    if (!targetEl) {
        if (adviceEl) adviceEl.remove();
        return;
    }

    const petName = s.helperPet?.name || "Helper Pet";
    const petType = s.helperPet?.type || "fox";
    const petPersonality = s.helperPet?.personality || "neutral";

    const CHIBI_ASSETS = {
        cat_boy: "./assets/Helper Pet/Chibi_Cat_Boy.png",
        chibi_woman: "./assets/Helper Pet/Chibi_Woman.png",
        phoenix: "./assets/Helper Pet/Chimera_Pheonix_.png",
        crow: "./assets/Helper Pet/Dark_Crow.png",
        fox: "./assets/Helper Pet/Mystical_Fox.png"
    };
    const chibiUrl = CHIBI_ASSETS[petType] || CHIBI_ASSETS.fox;

    const isUnknown = String(enemy.name).toLowerCase().includes("unknown") || enemy.isUnknown || enemy.unknown === true;

    const hpText = isUnknown ? "??? / ???" : `${enemy.hp} / ${enemy.maxHp}`;
    const levelText = isUnknown ? "??" : `${enemy.level}`;

    const playerLevel = Number(s.character?.level || s.jobClass?.level || 1) || 1;
    let threatWarningHtml = "";
    if (!isUnknown) {
        if (enemy.level >= playerLevel + 5) {
            threatWarningHtml = `<div style="color:#f43f5e; font-weight:bold; margin-top:4px; font-size:10px;"><i class="fa-solid fa-triangle-exclamation"></i> DEADLY THREAT LEVEL!</div>`;
        } else if (enemy.level >= playerLevel + 3) {
            threatWarningHtml = `<div style="color:#fb923c; font-weight:bold; margin-top:4px; font-size:10px;"><i class="fa-solid fa-triangle-exclamation"></i> HIGH THREAT LEVEL!</div>`;
        } else {
            threatWarningHtml = `<div style="color:#34d399; font-size:10px;">Threat Level: Normal</div>`;
        }
    }

    let dialogue = "Scanning target parameters...";
    if (isUnknown) {
        dialogue = "Data unavailable. Engage in combat to scan this unknown entity.";
    } else {
        const dialogs = {
            neutral: "Target analysis completed. Recommend staggered attacks to deplete break bars.",
            sarcastic: `Oh great, a Level ${enemy.level} ${enemy.className || 'foe'}. Try not to get knocked out this time.`,
            clinical: `Target: ${enemy.name}. Level: ${enemy.level}. Probability of success is ${enemy.level >= playerLevel + 5 ? "24%" : "88%"}. Coordinate skills.`,
            whimsical: `Whoa! Look at this Level ${enemy.level} creature! Let's blast them with sparklers!`,
            ominous: "Their shadow falls long. Cast them into the abyss, Master...",
            loyal: `I have scanned this foe for you, Master. Level is ${enemy.level}. I stand ready.`
        };
        dialogue = dialogs[petPersonality] || dialogs.neutral;
    }

    let el = document.getElementById("uie-battle-pet-advice");
    if (!el) {
        el = document.createElement("div");
        el.id = "uie-battle-pet-advice";
        el.style.cssText = `
            position: absolute;
            z-index: 1000;
            width: 270px;
            background: linear-gradient(135deg, rgba(8, 12, 20, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
            border: 1.5px solid #cba35c;
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6), 0 0 14px rgba(203, 163, 92, 0.25);
            padding: 10px;
            font-family: 'Inter', sans-serif;
            color: #f1f5f9;
            display: flex;
            gap: 10px;
            pointer-events: none;
            box-sizing: border-box;
        `;
        const battleScreen = document.getElementById("battle-screen");
        if (battleScreen) battleScreen.appendChild(el);
    }

    el.innerHTML = `
        <div style="flex:0 0 46px; height:46px; border-radius:50%; border:1px solid #cba35c; background:url('${chibiUrl}') center/contain no-repeat, rgba(255,255,255,0.05); background-size:82%;"></div>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;">
            <div style="font-family:'Orbitron', monospace; font-size:9px; color:#cba35c; font-weight:bold; letter-spacing:0.5px; text-transform:uppercase;">
                🤖 ${esc(petName)} ADV-01
            </div>
            <div style="font-weight:bold; font-size:12px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${esc(enemy.name)}
            </div>
            <div style="font-size:10px; color:#cbd5e1; display:flex; gap:10px;">
                <span>HP: ${hpText}</span>
                <span>Lv. ${levelText}</span>
            </div>
            ${threatWarningHtml}
            <div style="font-style:italic; font-size:10px; margin-top:4px; color:#94a3b8; line-height:1.3; border-top:1px solid rgba(255,255,255,0.08); padding-top:4px;">
                "${esc(dialogue)}"
            </div>
        </div>
    `;

    const battleScreen = document.getElementById("battle-screen");
    const targetRect = targetEl.getBoundingClientRect();
    const battleRect = battleScreen.getBoundingClientRect();

    const left = targetRect.left - battleRect.left + (targetRect.width / 2) - 135;
    const top = targetRect.top - battleRect.top - 120;

    const maxLeft = battleRect.width - 280;
    const maxTop = battleRect.height - 150;
    el.style.left = `${Math.max(10, Math.min(maxLeft, left))}px`;
    el.style.top = `${Math.max(10, Math.min(maxTop, top))}px`;
    el.style.display = "flex";
}

function renderBattleStage() {
    if (!battleState) return;
    const enemyStage = document.getElementById("battle-enemy-stage");
    if (enemyStage) {
        enemyStage.innerHTML = "";
        const activeId = battleState?.activeActorId;
        const selectedId = battleState?.selectedTargetId || selectedTarget;
        (battleState?.enemies || []).forEach((enemy) => {
            const el = document.createElement("div");
            el.className = "battle-sprite-container is-enemy";
            const hpVal = Number(enemy.hp || enemy.vitals?.hp || 0);
            const hpMax = Number(enemy.maxHp || enemy.vitals?.maxHp || 100);
            const hpRatio = hpMax > 0 ? hpVal / hpMax : 0;
            if (hpVal <= 0) el.classList.add("is-dead");
            if (String(enemy.id) === String(activeId)) el.classList.add("is-active-actor");
            if (String(enemy.id) === String(selectedId) && pendingAction) el.classList.add("is-target-selected");
            if (hpRatio > 0 && hpRatio <= 0.25) el.classList.add("is-low-hp");
            el.dataset.enemyId = enemy.id;
            el.dataset.combatantId = enemy.id;

            let portrait = enemy.presentation?.portrait || enemy.imageUrl || enemy.sprite || "";
            
            // Auto-generate portrait if missing
            if (!portrait && enemy.name) {
                const portraitKey = `enemy_portrait_${enemy.id}`;
                if (!window[portraitKey]) {
                    window[portraitKey] = true;
                    generateEnemyPortrait(enemy).then(url => {
                        if (url) {
                            enemy.imageUrl = url;
                            const imgEl = el.querySelector(".sprite-base");
                            if (imgEl) {
                                imgEl.src = url;
                            } else {
                                const img = document.createElement("img");
                                img.className = "sprite-base";
                                img.src = url;
                                el.insertBefore(img, el.querySelector(".sprite-name-lbl"));
                            }
                        }
                    });
                }
            }
            
            const intent = battleState?.enemyIntents?.[enemy.id];
            const intentClass = intent?.danger === "high" ? "intent-danger"
                : /guard|ward|focus/i.test(intent?.label || "") ? "intent-guard"
                : /heal/i.test(intent?.label || "") ? "intent-heal" : "";
            const statuses = Array.isArray(enemy.statuses) ? enemy.statuses : [];
            const statusBadges = statuses.map(st =>
                `<span class="status-badge status-${esc(String(st.name || "").toLowerCase())}">${esc(st.name)}</span>`
            ).join("");
            const breakIndicator = Number(enemy.breakStacks || 0) >= 2
                ? `<div class="break-indicator">BREAK x${enemy.breakStacks}</div>` : "";

            const isUnknownEnemy = String(enemy.name).toLowerCase().includes("unknown") || enemy.isUnknown || enemy.unknown === true;
            const enemyHpText = isUnknownEnemy ? "??? / ???" : `${enemy.hp} / ${enemy.maxHp}`;

            el.innerHTML = `
                ${intent ? `<div class="enemy-intent-chip ${intentClass}">${esc(intent.label)}</div>` : ""}
                ${statusBadges ? `<div class="status-badge-row">${statusBadges}</div>` : ""}
                ${breakIndicator}
                ${portrait ? `<img class="sprite-base" src="${portrait}">` : '<div class="sprite-base" style="background:linear-gradient(135deg, rgba(239,68,68,0.3), rgba(139,92,246,0.3)); display:flex; align-items:center; justify-content:center; font-size:48px; color:rgba(255,255,255,0.5);">⚔</div>'}
                <span class="sprite-name-lbl">${isUnknownEnemy ? esc(enemy.name) : `[Lv. ${enemy.level}] ${esc(enemy.name)}`}</span>
                <div class="sprite-hp-bar" style="height:8px; display:flex; align-items:center; justify-content:center; position:relative; overflow:visible;">
                    <div class="sprite-hp-fill" style="width:${Math.max(0, Math.min(100, hpRatio * 100))}%; height:100%; position:absolute; left:0; top:0;"></div>
                    <span style="position:absolute; width:100%; text-align:center; font-size:7.5px; color:#fff; font-weight:900; text-shadow:0 0 2px #000; line-height:8px; pointer-events:none;">
                        ${enemyHpText}
                    </span>
                </div>
            `;

            // Target selection must not summon the Helper Pet advisor.
            // Keep the main Helper Pet available, but remove Battle's
            // automatic hover/tap analysis card.
            $(el).off("mouseenter.petAdvice mouseleave.petAdvice");
            const stalePetAdvice = document.getElementById("uie-battle-pet-advice");
            if (stalePetAdvice) stalePetAdvice.remove();

            if ((pendingAction || battleState?.phase === "target_select") && hpVal > 0) {
                el.classList.add("is-targetable");
                el.onclick = () => {
                    battleState.selectedTargetId = String(enemy.id);
                    selectedTarget = String(enemy.id);
                    const action = pendingAction || battleState?.selectedAction;
                    if (action) {
                        executePlayerAction(action, enemy.id);
                    } else {
                        renderBottomDock();
                        renderBattleStage();
                    }
                };
            } else if (hpVal > 0) {
                el.onclick = () => {
                    selectedTarget = String(enemy.id);
                    battleState.selectedTargetId = String(enemy.id);
                    renderBottomDock();
                    renderBattleStage();
                };
            }

            enemyStage.appendChild(el);
        });
    }

    const partyStage = document.getElementById("battle-party-stage");
    if (partyStage) {
        partyStage.innerHTML = "";
        const activeId = battleState?.activeActorId;
        (battleState?.allies || []).forEach((member) => {
            const el = document.createElement("div");
            el.className = "battle-sprite-container is-ally";
            const hpVal = Number(member.hp || member.vitals?.hp || 0);
            const hpMax = Number(member.maxHp || member.vitals?.maxHp || 100);
            const hpRatio = hpMax > 0 ? hpVal / hpMax : 0;
            if (hpVal <= 0) el.classList.add("is-dead");
            if (String(member.id) === String(activeId)) el.classList.add("is-active-actor");
            if (hpRatio > 0 && hpRatio <= 0.25) el.classList.add("is-low-hp");
            el.dataset.combatantId = member.id;

            const portrait = member.presentation?.portrait || member.imageUrl || member.sprite || "";
            const statuses = Array.isArray(member.statuses) ? member.statuses : [];
            const statusBadges = statuses.map(st =>
                `<span class="status-badge status-${esc(String(st.name || "").toLowerCase())}">${esc(st.name)}</span>`
            ).join("");

            const allyHpText = `${Math.max(0, Math.round(hpVal))} / ${Math.max(1, Math.round(hpMax))}`;
            const allyLevel = Number(member.level || member.jobLevel || 0);
            el.innerHTML = `
                ${statusBadges ? `<div class="status-badge-row">${statusBadges}</div>` : ""}
                ${portrait ? `<img class="sprite-base" src="${portrait}">` : '<div class="sprite-base battle-sprite-placeholder">◆</div>'}
                <span class="sprite-name-lbl">${allyLevel > 0 ? `[Lv. ${allyLevel}] ` : ""}${esc(member.name)}</span>
                <div class="sprite-hp-bar" style="height:8px;display:flex;align-items:center;justify-content:center;position:relative;overflow:visible;">
                    <div class="sprite-hp-fill" style="width:${Math.max(0, Math.min(100, hpRatio * 100))}%;height:100%;position:absolute;left:0;top:0;"></div>
                    <span class="sprite-hp-text">${allyHpText}</span>
                </div>
            `;

            // UIE_BATTLE_ALLY_SPRITE_SWITCH_V1
            // The battlefield portrait is the ally selector. Switching here
            // updates the controlled actor without needing duplicate dock cards.
            if (hpVal > 0) {
                el.onclick = () => {
                    if (!battleActive || !battleState) return;
                    if (!["player_select", "target_select"].includes(String(battleState.phase || ""))) return;

                    const queue = Array.isArray(battleState.turnQueue)
                        ? battleState.turnQueue
                        : [];
                    const queueIndex = queue.findIndex((token) => {
                        if (String(token?.side || "") !== "ally") return false;
                        const tokenId =
                            token?.id ??
                            token?.actorId ??
                            token?.combatantId ??
                            token?.entityId ??
                            token?.memberId ??
                            "";
                        return String(tokenId) === String(member.id);
                    });

                    if (queueIndex >= 0) battleState.turnIndex = queueIndex;
                    battleState.activeActorId = member.id;
                    battleState.activeSide = "ally";
                    battleState.player = member;
                    battleState.selectedAction = null;
                    pendingAction = null;
                    activeSubTab = "main";

                    renderBattleStage();
                    renderBottomDock();
                    renderTurnTimeline();
                };
            }

            partyStage.appendChild(el);
        });
    }
    renderTurnTimeline();
    const stalePetAdvice = document.getElementById("uie-battle-pet-advice");
    if (stalePetAdvice) stalePetAdvice.remove();
}

function renderTurnTimeline() {
    const queueEl = document.getElementById("battle-turn-queue");
    if (!queueEl) return;
    queueEl.innerHTML = "";

    const timelineWrapper = document.getElementById("battle-turn-timeline");
    const queue = battleState?.turnQueue || [];
    const idx = battleState?.turnIndex || 0;

    if (timelineWrapper) {
        timelineWrapper.style.display = queue.length > 1 ? "flex" : "none";
    }

    const windowSize = 8;
    const start = Math.max(0, idx - 1);
    const end = Math.min(queue.length, start + windowSize);

    for (let i = start; i < end; i++) {
        const token = queue[i];
        const combatant = getCombatantByTurnToken(token);
        if (!combatant) continue;
        const el = document.createElement("div");
        el.className = `turn-token ${token.side === "ally" ? "is-ally" : "is-enemy"} ${i === idx ? "active" : ""}`;
        const avatar = combatant.presentation?.portrait || combatant.imageUrl || combatant.sprite || "";
        const avatarBg = avatar ? `background-image:url('${avatar}')` : "";
        el.innerHTML = `
            <div class="turn-token-avatar" style="${avatarBg}"></div>
            <span class="turn-token-name">${esc(token.name)}</span>
        `;
        queueEl.appendChild(el);
    }
}

function renderBottomDock() {
    const dock = document.getElementById("battle-bottom-dock");
    const logPanel = document.getElementById("battle-log-panel");
    if (!dock || !battleState) return;

    const validTabs = new Set(["main", "skills", "magic", "items"]);
    if (activeSubTab === "runes") activeSubTab = "items";
    if (!validTabs.has(activeSubTab)) activeSubTab = "main";

    const battleScreen = document.getElementById("battle-screen");
    const useMobileDrawer = Boolean(
        window.matchMedia?.("(pointer: coarse) and (orientation: landscape)")?.matches
    );

    const allies = battleState?.allies || [];
    const player = battleState?.player || allies[0];
    const activeId = battleState?.activeActorId;
    const selectedId = battleState?.selectedTargetId || selectedTarget;
    const isPlayerTurn =
        battleState?.phase === "player_select" ||
        battleState?.phase === "target_select";

    const skillActions = (player?.actions || []).filter((action) => {
        const type = String(action?.skillType || action?.type || "").toLowerCase();
        return type === "skill" || action?.source === "SkillTree";
    });

    const magicActions = (player?.actions || []).filter((action) => {
        const type = String(action?.skillType || action?.type || "").toLowerCase();
        return (
            type === "magic" ||
            type === "spell" ||
            (Array.isArray(action?.tags) && action.tags.includes("magic"))
        );
    });

    const combatItems = getCombatItems();
    const isSubTab = ["skills", "magic", "items"].includes(activeSubTab);

    let subPanelHeader = "";
    let subPanelContent = "";
    let subPanelCount = 0;

    if (activeSubTab === "skills") {
        subPanelHeader = "Skills";
        subPanelCount = skillActions.length;
        subPanelContent = skillActions.map((action, index) => {
            const preview = getActionPreview(action, player, null);
            return `
                <button class="btn-sub subpanel-item sub-action-node"
                        data-type="skill"
                        data-idx="${index}"
                        ${!isPlayerTurn ? "disabled" : ""}>
                    <span>${esc(action.label || action.name)}</span>
                    <small>${esc(preview?.costs || "Free")}</small>
                    <div class="subpanel-item-tooltip">
                        <strong>${esc(action.label || action.name)}</strong><br>
                        Cost: ${esc(preview?.costs || "Free")}<br>
                        ${esc(action.description || "Active tactical skill.")}
                    </div>
                </button>
            `;
        }).join("");

        if (!skillActions.length) {
            subPanelContent = `
                <div class="battle-action-empty">
                    <i class="fa-solid fa-bolt"></i>
                    <strong>No skills available</strong>
                    <span>This combatant has no usable battle skills.</span>
                </div>
            `;
        }
    } else if (activeSubTab === "magic") {
        subPanelHeader = "Magic";
        subPanelCount = magicActions.length;
        subPanelContent = magicActions.map((action, index) => {
            const preview = getActionPreview(action, player, null);
            return `
                <button class="btn-sub subpanel-item sub-action-node"
                        data-type="magic"
                        data-idx="${index}"
                        ${!isPlayerTurn ? "disabled" : ""}>
                    <span>${esc(action.label || action.name)}</span>
                    <small>${esc(preview?.costs || "Free")}</small>
                    <div class="subpanel-item-tooltip">
                        <strong>${esc(action.label || action.name)}</strong><br>
                        Cost: ${esc(preview?.costs || "Free")}<br>
                        ${esc(action.description || "Cast a magical spell.")}
                    </div>
                </button>
            `;
        }).join("");

        if (!magicActions.length) {
            subPanelContent = `
                <div class="battle-action-empty">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <strong>No magic unlocked</strong>
                    <span>This combatant has no usable spells.</span>
                </div>
            `;
        }
    } else if (activeSubTab === "items") {
        subPanelHeader = "Items";
        subPanelCount = combatItems.length;
        subPanelContent = combatItems.map((item, index) => `
            <button class="btn-sub subpanel-item sub-action-node"
                    data-type="item"
                    data-idx="${index}"
                    ${!isPlayerTurn ? "disabled" : ""}>
                <span>${esc(item.name)}</span>
                <small>x${Number(item.qty || item.quantity || 1)}</small>
                ${isRuneItem(item) ? '<b class="subpanel-badge">Rune</b>' : ""}
                <div class="subpanel-item-tooltip">
                    <strong>${esc(item.name)}</strong><br>
                    ${esc(
                        item.description ||
                        (isRuneItem(item)
                            ? "Inventory rune item."
                            : "Consumable combat item.")
                    )}
                </div>
            </button>
        `).join("");

        if (!combatItems.length) {
            subPanelContent = `
                <div class="battle-action-empty">
                    <i class="fa-solid fa-flask"></i>
                    <strong>No combat items</strong>
                    <span>No carried item is currently usable in battle.</span>
                </div>
            `;
        }
    }

    dock.replaceChildren();

    const mainRow = document.createElement("div");
    mainRow.className = "dock-main-row";

    const vitalsPanel = document.createElement("div");
    vitalsPanel.className = "dock-left-profile";
    const vitals = getCombatVitals(player);

    vitalsPanel.innerHTML = `
        <div class="cb-stats-row vitals-matrix" aria-label="Life trackers">
            ${vitals.map((vital) => `
                <div class="cb-stat-progress gauge-row">
                    <span class="cb-stat-label gauge-id">${esc(vital.label)}</span>
                    <div class="cb-stat-bar-container gauge-track">
                        <div class="cb-stat-bar-fill gauge-bar vital-${esc(vital.key)}"
                             style="width:${vital.ratio}%">
                        </div>
                    </div>
                    <span class="cb-stat-value gauge-fraction">
                        ${Math.round(vital.value)}/${Math.round(vital.max)}
                    </span>
                </div>
            `).join("")}
        </div>
    `;

    const commandPanel = document.createElement("div");
    commandPanel.className = "dock-center-actions";

    const commands = [
        { id: "attack", label: "Attack", icon: "fa-solid fa-sword", needsTarget: true },
        { id: "skills", label: "Skills", icon: "fa-solid fa-bolt" },
        { id: "magic", label: "Magic", icon: "fa-solid fa-wand-magic-sparkles" },
        { id: "items", label: "Items", icon: "fa-solid fa-flask" },
        { id: "defend", label: "Defend", icon: "fa-solid fa-shield-halved" },
    ];

    const menuButtons = commands.map((command) => {
        const isActive = activeSubTab === command.id;
        const disabled = !isPlayerTurn || (command.needsTarget && !selectedId);

        return `
            <button type="button"
                    class="btn-action cb-menu-btn action-trigger-btn
                           ${isActive ? "active selected" : ""}"
                    data-cmd="${command.id}"
                    ${disabled ? 'disabled aria-disabled="true"' : ""}>
                <i class="${command.icon}"></i>
                <span>${command.label}</span>
            </button>
        `;
    }).join("");

    const desktopSubPanel = !useMobileDrawer && isSubTab
        ? `
            <div class="sub-action-pane internal-sub-menu-view">
                <div class="battle-inline-sub-head">
                    <button type="button" class="battle-sub-back">← Back</button>
                    <span class="pane-title sub-view-title">
                        ${subPanelHeader.toUpperCase()}
                    </span>
                    <b>${subPanelCount}</b>
                </div>
                <div class="sub-button-row subpanel-list sub-options-flex-wrapper">
                    ${subPanelContent}
                </div>
            </div>
        `
        : "";

    commandPanel.innerHTML = `
        <div class="action-grid primary-command-row">
            ${menuButtons}
        </div>
        ${desktopSubPanel}
    `;

    mainRow.append(vitalsPanel, commandPanel);
    dock.appendChild(mainRow);

    let actionDrawer = document.getElementById("battle-action-drawer");

    if (useMobileDrawer && isSubTab && battleScreen) {
        if (!actionDrawer) {
            actionDrawer = document.createElement("section");
            actionDrawer.id = "battle-action-drawer";
            battleScreen.appendChild(actionDrawer);
        }

        battleScreen.classList.add("has-action-drawer");
        actionDrawer.dataset.tab = activeSubTab;
        actionDrawer.innerHTML = `
            <header class="battle-action-drawer-head">
                <button type="button"
                        class="battle-drawer-back"
                        aria-label="Back to main battle commands">
                    ← Back
                </button>
                <strong>${subPanelHeader}</strong>
                <span>${subPanelCount}</span>
            </header>
            <div class="battle-action-drawer-list
                        sub-button-row
                        subpanel-list
                        sub-options-flex-wrapper">
                ${subPanelContent}
            </div>
        `;
    } else {
        battleScreen?.classList.remove("has-action-drawer");
        actionDrawer?.remove();
        actionDrawer = null;
    }

    const closeSubScreen = () => {
        activeSubTab = "main";
        battleScreen?.classList.remove("has-action-drawer");
        document.getElementById("battle-action-drawer")?.remove();
        renderBottomDock();
    };

    commandPanel.querySelectorAll(".action-grid .btn-action").forEach((button) => {
        button.onclick = () => {
            const command = button.dataset.cmd;

            if (command === "attack") {
                if (selectedId) {
                    activeSubTab = "main";
                    handleBattleAction({
                        id: "attack",
                        label: "Attack",
                        type: "attack",
                        cost: { ap: 1 },
                    });
                } else {
                    addBattleLog("Select a target first!", "normal");
                }
                return;
            }

            if (command === "defend") {
                activeSubTab = "main";
                handleBattleAction({
                    id: "defend",
                    label: "Defend",
                    type: "defend",
                    cost: {},
                });
                return;
            }

            activeSubTab = activeSubTab === command ? "main" : command;
            renderBottomDock();
        };
    });

    commandPanel
        .querySelector(".battle-sub-back")
        ?.addEventListener("click", closeSubScreen);

    actionDrawer
        ?.querySelector(".battle-drawer-back")
        ?.addEventListener("click", closeSubScreen);

    const optionHosts = [commandPanel, actionDrawer].filter(Boolean);

    optionHosts.forEach((host) => {
        host.querySelectorAll(".btn-sub").forEach((option) => {
            option.onclick = () => {
                const type = option.dataset.type;
                const index = Number(option.dataset.idx);

                if (type === "skill" || type === "magic") {
                    const list = type === "skill" ? skillActions : magicActions;
                    const action = list[index];

                    if (action) {
                        activeSubTab = "main";
                        battleScreen?.classList.remove("has-action-drawer");
                        document.getElementById("battle-action-drawer")?.remove();
                        handleBattleAction(action);
                    }
                    return;
                }

                if (type !== "item") return;

                const item = combatItems[index];
                if (!item) return;

                activeSubTab = "main";
                battleScreen?.classList.remove("has-action-drawer");
                document.getElementById("battle-action-drawer")?.remove();

                if (!isRuneItem(item)) {
                    useBattleItem(item);
                    return;
                }

                openRuneDrawingModal(item, (accuracy) => {
                    if (accuracy < 45) return;

                    const action = {
                        id: `rune_cast_${item.name}`,
                        label: item.name,
                        type: "skill",
                        costs: { mp: 5 },
                    };

                    handleBattleAction(action);
                    consumeInventoryItem(item);
                });
            };
        });
    });

    const logElement = logPanel?.querySelector("#battle-log");
    if (!logElement) return;

    logElement.replaceChildren();

    battleLog.forEach((entry) => {
        const row = document.createElement("div");
        row.className = `battle-log-entry ${entry.type || "normal"}`;
        row.textContent = String(entry.message || "");
        logElement.appendChild(row);
    });

    logElement.scrollTop = logElement.scrollHeight;
}

function openRuneDrawingModal(runeItem, onDone) {
    const modal = document.createElement("div");
    modal.id = "uie-rune-canvas-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483654;background:rgba(3,7,18,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;color:#fff;font-family:system-ui,sans-serif;";
    
    const runeName = String(runeItem?.name || "Rune").toLowerCase();
    let shape = "circle";
    if (runeName.includes("fire") || runeName.includes("pyro")) shape = "triangle";
    else if (runeName.includes("ice") || runeName.includes("cryo")) shape = "star";
    else if (runeName.includes("lightning") || runeName.includes("bolt")) shape = "zigzag";
    
    modal.innerHTML = `
        <div style="width:min(720px,96vw);background:#0a0e17;border:2px solid #0ea5e9;border-radius:12px;padding:20px;box-shadow:0 0 30px rgba(14,165,233,0.3);text-align:center;">
            <h3 style="margin-top:0;color:#0ea5e9;text-transform:uppercase;letter-spacing:1px;">Draw Rune: ${escHtml(runeItem?.name || "Ancient Sigil")}</h3>
            <p style="font-size:12px;color:#94a3b8;margin-bottom:16px;">Trace the pattern on the left onto the drawing canvas on the right.</p>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;justify-items:center;margin-bottom:20px;">
                <div>
                    <div style="font-size:11px;color:#cba35c;margin-bottom:6px;text-transform:uppercase;">Expected Pattern</div>
                    <canvas id="rune-template-canvas" width="200" height="200" style="border:1px dashed rgba(14,165,233,0.3);background:#070a0f;border-radius:8px;"></canvas>
                </div>
                <div>
                    <div style="font-size:11px;color:#0ea5e9;margin-bottom:6px;text-transform:uppercase;">Draw Area</div>
                    <canvas id="rune-draw-canvas" width="200" height="200" style="border:1px solid #0ea5e9;background:#070a0f;border-radius:8px;cursor:crosshair;"></canvas>
                </div>
            </div>
            
            <div id="rune-accuracy-lbl" style="font-weight:900;font-size:16px;color:#cba35c;margin-bottom:16px;height:24px;"></div>
            
            <div style="display:flex;gap:12px;justify-content:center;">
                <button id="rune-clear-btn" class="reply-tool-btn" style="width:auto;padding:8px 16px;cursor:pointer;">Clear</button>
                <button id="rune-cancel-btn" class="reply-tool-btn" style="width:auto;padding:8px 16px;border-color:#ef4444!important;color:#ef4444!important;cursor:pointer;">Cancel</button>
                <button id="rune-cast-btn" class="reply-tool-btn" style="width:auto;padding:8px 16px;background:#0ea5e9;color:#070a0f;border-color:#0ea5e9;cursor:pointer;">Cast Rune</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const tCanvas = modal.querySelector("#rune-template-canvas");
    const dCanvas = modal.querySelector("#rune-draw-canvas");
    const tCtx = tCanvas.getContext("2d");
    const dCtx = dCanvas.getContext("2d");
    
    tCtx.strokeStyle = "rgba(14, 165, 233, 0.4)";
    tCtx.lineWidth = 10;
    tCtx.lineCap = "round";
    tCtx.lineJoin = "round";
    
    function drawTemplatePattern() {
        tCtx.clearRect(0, 0, 200, 200);
        tCtx.beginPath();
        if (shape === "triangle") {
            tCtx.moveTo(100, 30);
            tCtx.lineTo(170, 170);
            tCtx.lineTo(30, 170);
            tCtx.closePath();
        } else if (shape === "star") {
            tCtx.moveTo(100, 20);
            tCtx.lineTo(120, 70);
            tCtx.lineTo(175, 75);
            tCtx.lineTo(135, 115);
            tCtx.lineTo(145, 170);
            tCtx.lineTo(100, 140);
            tCtx.lineTo(55, 170);
            tCtx.lineTo(65, 115);
            tCtx.lineTo(25, 75);
            tCtx.lineTo(80, 70);
            tCtx.closePath();
        } else if (shape === "zigzag") {
            tCtx.moveTo(40, 40);
            tCtx.lineTo(160, 40);
            tCtx.lineTo(40, 100);
            tCtx.lineTo(160, 100);
            tCtx.lineTo(40, 160);
            tCtx.lineTo(160, 160);
        } else {
            tCtx.arc(100, 100, 70, 0, Math.PI * 2);
        }
        tCtx.stroke();
    }
    
    drawTemplatePattern();
    
    let drawing = false;
    dCtx.strokeStyle = "#0ea5e9";
    dCtx.lineWidth = 8;
    dCtx.lineCap = "round";
    dCtx.lineJoin = "round";
    
    function getMousePos(canvas, evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (evt.clientX - rect.left) * (canvas.width / rect.width),
            y: (evt.clientY - rect.top) * (canvas.height / rect.height)
        };
    }
    
    const startDraw = (e) => {
        drawing = true;
        const pos = getMousePos(dCanvas, e);
        dCtx.beginPath();
        dCtx.moveTo(pos.x, pos.y);
    };
    
    const drawMove = (e) => {
        if (!drawing) return;
        const pos = getMousePos(dCanvas, e);
        dCtx.lineTo(pos.x, pos.y);
        dCtx.stroke();
    };
    
    const stopDraw = () => {
        drawing = false;
    };
    
    dCanvas.addEventListener("mousedown", startDraw);
    dCanvas.addEventListener("mousemove", drawMove);
    window.addEventListener("mouseup", stopDraw);
    
    // Support Touch Events
    dCanvas.addEventListener("touchstart", (e) => {
        if (e.touches.length > 0) startDraw(e.touches[0]);
    });
    dCanvas.addEventListener("touchmove", (e) => {
        if (e.touches.length > 0) drawMove(e.touches[0]);
    });
    window.addEventListener("touchend", stopDraw);
    
    modal.querySelector("#rune-clear-btn").onclick = () => {
        dCtx.clearRect(0, 0, 200, 200);
        modal.querySelector("#rune-accuracy-lbl").textContent = "";
    };
    
    modal.querySelector("#rune-cancel-btn").onclick = () => {
        modal.remove();
    };
    
    modal.querySelector("#rune-cast-btn").onclick = () => {
        const tImgData = tCtx.getImageData(0, 0, 200, 200).data;
        const dImgData = dCtx.getImageData(0, 0, 200, 200).data;
        
        let match = 0;
        let total = 0;
        
        for (let i = 0; i < tImgData.length; i += 16) {
            const tAlpha = tImgData[i + 3];
            const dAlpha = dImgData[i + 3];
            
            if (tAlpha > 50 || dAlpha > 50) {
                total++;
                if (tAlpha > 50 && dAlpha > 50) {
                    match++;
                }
            }
        }
        
        const accuracy = total > 0 ? Math.round((match / total) * 100) : 0;
        modal.querySelector("#rune-accuracy-lbl").textContent = `Drawing Accuracy: ${accuracy}%`;
        
        setTimeout(() => {
            modal.remove();
            onDone(accuracy);
        }, 1200);
    };
}

export function ensureBattle(enemies = [], options = {}) {
    if (battleActive) return;
    activeSubTab = "main";
    ensureBattleCss();

    const s = getSettings();
    if (s?.rpgSettings?.battleEnabled === false) {
        notify("info", "Battle UI is disabled in RPG Settings.", "Battle");
        return;
    }
    battleActive = true;
    activeSubTab = "main";
    const projection = buildCombatProjection(s, {
        ...options,
        enemies,
        scale: options.scale || "skirmish"
    });
    const party = projection.allies;
    const projectedEnemies = projection.enemies;
    const controlledMember = party.find(member => String(member.id) === String(projection.controlledCombatantId)) || party[0];

    if (!document.getElementById("battle-screen")) {
        document.body.insertAdjacentHTML("beforeend", buildBattleScreenHtml(projectedEnemies, party));
    }
    const existingBattleScreen = document.getElementById("battle-screen");
    if (existingBattleScreen) {
        existingBattleScreen.classList.add("uie-battle-tactical", "uie-fullscreen-app");
        const overlayRoot = document.getElementById("game-overlay-root") || document.body;
        if (existingBattleScreen.parentElement !== overlayRoot) overlayRoot.appendChild(existingBattleScreen);
        Object.assign(existingBattleScreen.style, { display: "block", width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none", inset: "0", pointerEvents: "auto", transform: "none", zoom: "1", position: "fixed" });
        applyBattleLocationBackground();
    }
    bindBattleControls();
    const vnScreen = document.getElementById("reality-stage") || document.getElementById("vn-screen") || document.getElementById("re-bg");
    if (vnScreen) vnScreen.style.display = "none";

    battleState = initiateCombat(controlledMember, projectedEnemies);
    battleState.allies = party;
    battleState.projection = projection;
    battleState.turnQueue = [];
    battleState.turnIndex = 0;
    battleState.round = 0;
    battleState.activeActorId = null;
    battleState.activeSide = null;
    battleState.phase = "start";
    battleState.surprised = options.surprised === true || options.ambush === true;
    battleState.selectedAction = null;
    battleState.selectedTargetId = null;
    battleState.enemyIntents = {};
    battleState.combatEvents = [];
    
    try {
        if (!s.battle || typeof s.battle !== "object") s.battle = {};
        s.battle.state = {
            active: true,
            sessionId: projection.id,
            scale: projection.scale,
            enemies: projectedEnemies,
            party,
            reserves: projection.reserves,
            controlledCombatantId: projection.controlledCombatantId,
            contextQuarantine: true,
            startedAt: projection.startedAt
        };
        saveSettings();
    } catch (_) {}
    clearBattleLog();
    const enemyNames = projectedEnemies.map((enemy) => enemy?.name).filter(Boolean);
    const encounterLocation = String(s?.worldState?.location || s?.map?.location || "the current area").trim();
    addBattleLog(`Encounter at ${encounterLocation}: ${enemyNames.join(", ") || "an unknown threat"} blocks the way.`, "critical");
    addBattleLog(battleState.surprised ? "The enemy has the advantage!" : `${controlledMember?.name || "You"} can act before the enemy.`, "normal");
    console.log("[Battle] Battle initiated");

    animateGlassShatter(snapshotCanvas, () => {
        if (!battleActive || !battleState) return;
        const battleScreen = document.getElementById("battle-screen");
        if (battleScreen) {
            battleScreen.classList.add("uie-battle-tactical", "landscape-gameplay", "uie-fullscreen-app");
            applyBattleLocationBackground();
            battleScreen.style.display = "block";

            const bgBlur = document.getElementById("battle-bg-blur");
            if (bgBlur) bgBlur.style.display = "none";

            renderBattleStage();
            renderBottomDock();
        }
    });

    showBattleStatus("BATTLE START", 1500);
    try { haptics?.texture?.("success"); } catch (_) {}

    setTimeout(() => {
        if (battleActive && battleState) beginCurrentTurn();
    }, 1600);
}


function handleBattleAction(action) {
    if (battleState?.phase !== "player_select" && battleState?.phase !== "target_select") return;
    const selectedId = battleState?.selectedTargetId || selectedTarget;
    if (action.type === "attack" || action.type === "skill" || action.type === "magic") {
        if (selectedId) {
            battleState.selectedAction = action;
            executePlayerAction(action, selectedId);
        } else {
            pendingAction = action;
            battleState.selectedAction = action;
            battleState.phase = "target_select";
            addBattleLog(`Select a target for ${action.label || action.name || "Attack"}...`, "player-action");
            renderBattleStage();
            renderBottomDock();
        }
    } else if (action.type === "defend") {
        battleState.phase = "resolving";
        const actor = battleState.player;
        applyStatusEffect(actor, { name: "guarded", turns: 2, value: 0 });
        addBattleLog(`${actor?.name || "Player"} takes a defensive stance.`, "player-action");
        renderBattleStage();
        renderBottomDock();
        setTimeout(advanceTurn, 500);
    } else if (action.type === "wait") {
        battleState.phase = "resolving";
        addBattleLog(`${battleState?.player?.name || "Player"} waits.`, "player-action");
        renderBattleStage();
        renderBottomDock();
        setTimeout(advanceTurn, 400);
    } else if (action.type === "flee") {
        fleeBattle();
    } else {
        battleState.selectedAction = action;
        executePlayerAction(action, null);
    }
}

function getCombatItems() {
    const s = getSettings();
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    return items.filter((it) => {
        const tags = [it?.type, it?.category, it?.slotCategory, ...(Array.isArray(it?.tags) ? it.tags : [])]
            .map(x => String(x || "").toLowerCase());
        return tags.some(t => /combat_usable|consumable|potion|bomb|throwing|healing|battle|rune/.test(t));
    });
}

function isRuneItem(item) {
    const name = String(item?.name || "").toLowerCase();
    const tags = [item?.type, item?.category, item?.slotCategory, ...(Array.isArray(item?.tags) ? item.tags : [])]
        .map(x => String(x || "").toLowerCase());
    return name.includes("rune") || tags.some(t => /rune/.test(t));
}

function useBattleItem(item) {
    const name = String(item?.name || "Item");
    const s = getSettings();
    const heal = Number(item?.heal || item?.healing || item?.hp || 0);
    if (heal > 0) {
        const target = battleState?.player;
        if (target) {
            target.hp = Math.min(Number(target.maxHp || target.vitals?.maxHp || 100), Number(target.hp || target.vitals?.hp || 0) + heal);
            if (!target.vitals || typeof target.vitals !== "object") target.vitals = {};
            target.vitals.hp = target.hp;
            target.vitals.maxHp = Number(target.maxHp || target.vitals.maxHp || 100);
            applyCombatantVitalsToSettings(s, target);
        } else {
            s.hp = Math.min(Number(s.maxHp || 100), Number(s.hp || 0) + heal);
        }
        saveSettings();
        addBattleLog(`${name} restores ${heal} HP.`, "player-action");
        
        const targetEl = document.querySelector(`.battle-sprite-container[data-combatant-id="${target.id}"]`);
        showFloatingNumber(targetEl, `+${heal}`, "#22c55e");
        renderBattleStage();
        renderBottomDock();
    } else {
        addBattleLog(`${name} is used.`, "player-action");
    }
    consumeInventoryItem(item);
    void rememberBattleTactic({ id: `item_${name}`, label: name, type: isRuneItem(item) ? "rune" : "item" }, battleState?.player, { item: true });
    setTimeout(advanceTurn, 600);
}

function consumeInventoryItem(item) {
    const s = getSettings();
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    const idx = items.indexOf(item);
    if (idx < 0) return;
    const qty = Number(items[idx].qty ?? items[idx].quantity ?? 1);
    if (qty > 1) {
        if ("qty" in items[idx]) items[idx].qty = qty - 1;
        else items[idx].quantity = qty - 1;
    } else {
        items.splice(idx, 1);
    }
    saveSettings();
}

function liveEnemies() {
    return (battleState?.enemies || []).filter(e => Number(e?.hp || 0) > 0);
}

function battleContextSnapshot(extra = {}) {
    const player = battleState?.player || {};
    const enemies = liveEnemies();
    const recent = Array.isArray(battleState?.actionHistory) ? battleState.actionHistory.slice(-8) : [];
    return {
        turn: Number(battleState?.turn || 0),
        player: {
            name: player.name || "Player",
            hp: Number(player.hp || player.vitals?.hp || 0),
            maxHp: Number(player.maxHp || player.vitals?.maxHp || 100),
            mp: Number(player.mp || player.vitals?.mp || 0),
            maxMp: Number(player.maxMp || player.vitals?.maxMp || 50),
            ap: Number(player.ap || player.vitals?.ap || 0),
            maxAp: Number(player.maxAp || player.vitals?.maxAp || 10),
        },
        enemies: enemies.map(enemy => ({
            name: enemy.name,
            hp: Number(enemy.hp || 0),
            maxHp: Number(enemy.maxHp || 100),
            threatTier: Number(enemy.threatTier || 2),
            statuses: enemy.statuses || enemy.statusEffects || [],
        })),
        recentActions: recent,
        ...extra,
    };
}

function actionCosts(action = {}) {
    return action?.costs && typeof action.costs === "object"
        ? action.costs
        : (action?.cost && typeof action.cost === "object" ? action.cost : {});
}

function canAffordAction(combatant, action) {
    const costs = actionCosts(action);
    const vitals = combatant?.vitals && typeof combatant.vitals === "object" ? combatant.vitals : combatant;
    return ["hp", "mp", "ap"].every(key => Math.max(0, Number(costs?.[key] || 0)) <= Number(vitals?.[key] || 0));
}

function actionText(action = {}) {
    return `${action?.label || action?.name || action?.id || ""} ${action?.description || ""} ${(action?.tags || []).join(" ")}`.toLowerCase();
}

function isHealingAction(action = {}) {
    return /\b(heal|aid|restore|mend|cure|first aid|potion)\b/.test(actionText(action));
}

function estimateActionDamage(action = {}, target = {}) {
    const result = evaluateAction(battleState.player, action, target);
    return Math.max(1, Number(result?.roll?.total || 10) - 5 + Math.max(0, Number(result?.themeBonus || 0)));
}

function chooseBestTarget(action = {}) {
    const enemies = liveEnemies();
    if (!enemies.length) return null;
    const killable = enemies
        .map(enemy => ({ enemy, estimated: estimateActionDamage(action, enemy) }))
        .filter(x => x.estimated >= Number(x.enemy.hp || 0))
        .sort((a, b) => Number(b.enemy.threatTier || 2) - Number(a.enemy.threatTier || 2) || Number(a.enemy.hp || 0) - Number(b.enemy.hp || 0));
    if (killable.length) return killable[0].enemy;
    return enemies.slice().sort((a, b) => {
        const aScore = Number(a.threatTier || 2) * 100 - (Number(a.hp || 0) / Math.max(1, Number(a.maxHp || 100))) * 40;
        const bScore = Number(b.threatTier || 2) * 100 - (Number(b.hp || 0) / Math.max(1, Number(b.maxHp || 100))) * 40;
        return bScore - aScore;
    })[0];
}

async function requestEnemyBattlePlan(enemy, extra = {}) {
    if (!enemy?.name) return null;
    try {
        const response = await planBattle({
            character: enemy.name,
            opponent: battleState?.player?.name || "User",
            allies: (battleState?.enemies || []).map(e => e.name).filter(Boolean),
            context: battleContextSnapshot({
                activeEnemy: enemy.name,
                enemyProfile: {
                    name: enemy.name,
                    level: enemy.level || enemy.jobClass?.level || 1,
                    hp: enemy.hp,
                    maxHp: enemy.maxHp,
                    stats: enemy.stats || enemy.derived?.stats || {},
                    derived: enemy.derived || {},
                    equipment: enemy.equipment || [],
                    items: enemy.items || [],
                    actions: enemy.actions || enemy.attacks || [],
                    morale: enemy.morale,
                    disposition: enemy.disposition,
                    objective: enemy.objective,
                },
                ...extra,
            }),
        }, { required: false, timeoutMs: 900 });
        return response?.ok ? response.plan : null;
    } catch (_) {
        return null;
    }
}

function isMagicalCombatAction(action = {}) {
    return /magic|spell|arcane|fire|frost|lightning|holy|curse/.test(actionText(action));
}

function statBasedDamage(attacker, defender, action, baseRoll = 10) {
    const magical = isMagicalCombatAction(action);
    const attack = Number(magical ? attacker?.derived?.magicalAttack : attacker?.derived?.physicalAttack)
        || Number(magical ? attacker?.stats?.int : attacker?.stats?.str)
        || 10;
    const defense = Number(magical ? defender?.derived?.magicalDefense : defender?.derived?.defense)
        || Number(magical ? defender?.stats?.wis : defender?.stats?.con)
        || 10;
    const level = Math.max(1, Number(attacker?.level || attacker?.jobClass?.level || 1));
    const variance = 0.88 + Math.random() * 0.24;
    return Math.max(1, Math.round((Number(baseRoll || 10) + attack * 0.55 + level * 0.35 - defense * 0.42) * variance));
}

function enemyShouldYield(enemy) {
    if (!enemy || Number(enemy.hp || 0) <= 0) return false;
    const disposition = String(enemy.disposition || enemy.personality || enemy.archetype || "").toLowerCase();
    if (/mindless|fanatic|berserk|construct|undead/.test(disposition)) return false;
    const ratio = Number(enemy.hp || 0) / Math.max(1, Number(enemy.maxHp || 100));
    const morale = Math.max(0.08, Math.min(0.45, Number(enemy.morale ?? 0.2)));
    return ratio <= morale && Math.random() < 0.65;
}

function tryUseEnemyBattleItem(enemy) {
    if (!enemy || !Array.isArray(enemy.items) || !enemy.items.length) return false;
    const hpRatio = Number(enemy.hp || 0) / Math.max(1, Number(enemy.maxHp || 100));
    if (hpRatio > 0.4) return false;
    const index = enemy.items.findIndex((item) => Number(item?.heal || item?.healing || item?.hp || 0) > 0);
    if (index < 0) return false;
    const item = enemy.items[index];
    const heal = Math.max(1, Number(item.heal || item.healing || item.hp || 0));
    enemy.hp = Math.min(Number(enemy.maxHp || 100), Number(enemy.hp || 0) + heal);
    if (enemy.vitals) enemy.vitals.hp = enemy.hp;
    const qty = Math.max(1, Number(item.qty || item.quantity || 1));
    if (qty > 1) item.qty = qty - 1;
    else enemy.items.splice(index, 1);
    addBattleLog(`${enemy.name} uses ${item.name || "a carried item"} and restores ${heal} HP.`, "enemy-action");
    renderBattleStage();
    renderBottomDock();
    return true;
}

function chooseContextualActionFromLocalRules() {
    const player = battleState?.player;
    const enemies = liveEnemies();
    if (!player || !enemies.length) return null;

    const hpRatio = Number(player.hp || 0) / Math.max(1, Number(player.maxHp || 100));
    const actions = (player.actions || []).filter(action => canAffordAction(player, action));
    const healingItem = getCombatItems().find(item => Number(item?.heal || item?.healing || item?.hp || 0) > 0);
    if (hpRatio <= 0.35 && healingItem) return { item: healingItem, target: player, reason: "low_hp_item" };
    if (hpRatio <= 0.25) return { action: { id: "defend", label: "Defend", type: "defend", cost: {} }, target: player, reason: "low_hp_defend" };

    const damaging = actions
        .filter(action => !isHealingAction(action))
        .map(action => {
            const target = chooseBestTarget(action);
            const text = actionText(action);
            const magicBias = /\b(magic|spell|fire|ice|bolt|lightning|arcane)\b/.test(text) ? 5 : 0;
            const cost = actionCosts(action);
            const costPenalty = Number(cost.mp || 0) + Number(cost.ap || 0);
            return { action, target, score: (target ? estimateActionDamage(action, target) : 0) + magicBias - costPenalty * 0.35 };
        })
        .filter(x => x.target)
        .sort((a, b) => b.score - a.score);

    if (damaging.length) return { ...damaging[0], reason: "highest_expected_value" };
    return { action: { id: "attack", label: "Attack", type: "attack", cost: { ap: 1 } }, target: chooseBestTarget(), reason: "fallback_attack" };
}

async function chooseContextualPlayerAction() {
    const enemy = liveEnemies().slice().sort((a, b) => Number(b.threatTier || 2) - Number(a.threatTier || 2))[0];
    const plan = await requestEnemyBattlePlan(enemy, { mode: "predict_user_next_move" });
    const local = chooseContextualActionFromLocalRules();
    if (!local) return null;
    const joined = `${plan?.opener || ""} ${(plan?.counters || []).join(" ")}`.toLowerCase();
    if (joined.includes("guard") || joined.includes("counter")) {
        const fast = (battleState?.player?.actions || []).find(action => /\b(feint|focus|pierce|range|magic|spell)\b/.test(actionText(action)) && canAffordAction(battleState.player, action));
        if (fast) return { action: fast, target: chooseBestTarget(fast), reason: "backend_counter_plan", plan };
    }
    return { ...local, plan };
}

async function rememberBattleTactic(action, target, outcome = {}) {
    const actor = battleState?.player?.name || "User";
    const visibleTo = liveEnemies().map(e => e.name).filter(Boolean);
    const type = String(action?.type || "").toLowerCase();
    const tactic = {
        type: type || "attack",
        action: action?.label || action?.name || action?.id || "Action",
        target: target?.name || target || "",
        damage: Number(outcome?.damage || 0),
        defeated: outcome?.targetDefeated === true,
        critical: outcome?.criticalSuccess === true,
        low_hp: Number(battleState?.player?.hp || 0) <= Math.max(1, Number(battleState?.player?.maxHp || 100) * 0.35),
    };
    const tags = ["battle", type || "attack"];
    if (isHealingAction(action)) tags.push("heal");
    if (/magic|spell/.test(actionText(action))) tags.push("magic", "ranged");
    if (/defend|guard|block/.test(actionText(action))) tags.push("guard");
    recordPlayerTactic(action, target);
    try {
        await processPlayerAction({
            actor,
            action: tactic.action,
            text: `${actor} used ${tactic.action}${tactic.target ? ` on ${tactic.target}` : ""}.`,
            location: "Battle",
            visible_to: visibleTo,
            tags,
            tactic,
        }, { required: false, timeoutMs: 700 });
    } catch (_) {}
}

function executePlayerAction(action, targetId) {
    try {
        pendingAction = null;
        battleState.phase = "resolving";
        renderBattleStage();

        const target = battleState.enemies.find(e => e.id === targetId || e.name === targetId);
        
        if ((action.type === "attack" || action.type === "skill" || action.type === "magic") && target) {
            if (!consumeActionCost(battleState.player, action)) {
                battleState.phase = "player_select";
                return;
            }
            const result = evaluateAction(battleState.player, action, target);
            let baseDamage = statBasedDamage(battleState.player, target, action, Math.max(1, Number(result?.roll?.total || 10) - 5));
            
            // 1. Elemental Synergies
            let synergyApplied = "";
            const actText = actionText(action);
            
            if (hasStatus(target, "burning") && (actText.includes("frost") || actText.includes("ice") || actText.includes("water") || actText.includes("cryo"))) {
                baseDamage = Math.round(baseDamage * 1.8);
                removeStatus(target, "burning");
                synergyApplied = "❄️ MELT / VAPORIZE (1.8x DMG!)";
            } else if (hasStatus(target, "poisoned") && (actText.includes("fire") || actText.includes("pyro") || actText.includes("explode") || actText.includes("burst"))) {
                baseDamage = Math.round(baseDamage * 1.6);
                removeStatus(target, "poisoned");
                synergyApplied = "💥 TOXIC DETONATION (1.6x DMG!)";
            } else if (hasStatus(target, "stunned") || hasStatus(target, "broken")) {
                if (actText.includes("slash") || actText.includes("strike") || actText.includes("bite") || actText.includes("heavy") || actText.includes("backstab")) {
                    baseDamage = Math.round(baseDamage * 1.5);
                    synergyApplied = "⚔️ EXECUTE CRITICAL (1.5x DMG!)";
                }
            }

            // 2. Archetype Weaknesses
            let weaknessExploited = false;
            const enemyClass = String(target.className || "").toLowerCase();
            
            if ((enemyClass.includes("beast") || target.disposition?.includes("beast")) && (actText.includes("fire") || actText.includes("pyro") || actText.includes("burn"))) {
                weaknessExploited = true;
            } else if (enemyClass.includes("undead") && (actText.includes("holy") || actText.includes("light") || actText.includes("heal") || actText.includes("sun"))) {
                weaknessExploited = true;
            } else if (enemyClass.includes("machine") && (actText.includes("lightning") || actText.includes("bolt") || actText.includes("elec") || actText.includes("storm"))) {
                weaknessExploited = true;
            } else if (enemyClass.includes("fiend") && (actText.includes("frost") || actText.includes("ice") || actText.includes("cryo"))) {
                weaknessExploited = true;
            }

            if (weaknessExploited) {
                baseDamage = Math.round(baseDamage * 1.4);
                target.breakStacks = Number(target.breakStacks || 0) + 2;
            }

            const outcome = executeAction(battleState.player, result, target, String(baseDamage));
            if (hasStatus(target, "broken")) {
                outcome.damage = Math.round(Number(outcome.damage || 0) * 1.5);
                target.hp = Math.max(0, Number(target.hp || 0) - Math.round(Number(outcome.damage || 0) * 0.5));
            }
            playAttackFeedback(battleState.player, target, outcome);
            addBreakStack(target);
            
            let logMsg = `${battleState.player.name} uses ${action.label || action.name || "Attack"} on ${target.name}!`;
            if (outcome.criticalSuccess) {
                logMsg += ` CRITICAL HIT! ${outcome.damage} damage!`;
                addBattleLog(logMsg, "critical");
            } else {
                logMsg += ` ${outcome.damage} damage.`;
                addBattleLog(logMsg, "player-action");
            }

            if (synergyApplied) {
                addBattleLog(`[Reaction] ${synergyApplied}`, "critical");
                const targetEl = document.querySelector(`.battle-sprite-container[data-enemy-id="${target.id}"]`);
                showFloatingNumber(targetEl, synergyApplied.split(" ")[0], "#60a5fa");
            }
            if (weaknessExploited) {
                addBattleLog(`⚠️ WEAKNESS EXPLOITED! ${target.name} takes extra stagger & damage!`, "critical");
                const targetEl = document.querySelector(`.battle-sprite-container[data-enemy-id="${target.id}"]`);
                showFloatingNumber(targetEl, "⚠️ WEAKNESS!", "#fbbf24");
            }
            
            renderBattleStage();
            renderBottomDock();
            
            if (!outcome.targetDefeated && enemyShouldYield(target)) {
                outcome.targetDefeated = true;
                outcome.surrendered = true;
            }
            if (outcome.targetDefeated || Number(target.hp || 0) <= 0) {
                addBattleLog(outcome.surrendered ? `${target.name} yields and leaves the fight!` : `${target.name} is incapacitated and defeated!`, "critical");
                removeEnemy(target);
                
                if (liveEnemies().length === 0) {
                    endBattle(true);
                    return;
                }
            }
            if (Array.isArray(battleState.actionHistory)) {
                battleState.actionHistory.push({
                    actor: battleState.player.name,
                    actionName: action.label || action.name || "Attack",
                    target: target.name,
                    damage: outcome.damage,
                    success: outcome.success,
                    noSell: false,
                    critical: outcome.criticalSuccess === true,
                });
            }
            void rememberBattleTactic(action, target, outcome);
            updateLastPlayerTacticDamage(outcome.damage);
            void narrateCombatOutcome(action, target, outcome);
        }
        
        setTimeout(advanceTurn, 650);
    } catch (error) {
        console.error("[Battle] Player action failed:", error);
        setTimeout(advanceTurn, 300);
    }
}

async function executeEnemyTurn(opts = {}) {
    if (!battleActive || !battleState) return;

    try {
        const enemy = opts.enemy || getActiveActor();
        if (!enemy || Number(enemy.hp || enemy.vitals?.hp || 0) <= 0) {
            advanceTurn();
            return;
        }

        const target = chooseEnemyTarget(enemy);
        if (!target) {
            endBattle(false);
            return;
        }

        if (tryUseEnemyBattleItem(enemy)) {
            setTimeout(advanceTurn, 650);
            return;
        }

        const plan = await requestEnemyBattlePlan(enemy, { mode: "enemy_turn" });
        const intel = getEnemyIntelligence(enemy);
        const smartChoice = chooseSmartEnemyAction(enemy, target);
        const guarded = smartChoice?.guarded === true;
        const chosenAttack = smartChoice?.attack;
        const opener = chosenAttack ? (chosenAttack.label || chosenAttack.name || String(plan?.opener || "attacks")) : String(plan?.opener || "attacks");
        const defended = hasStatus(target, "guarded");
        if (intel.seesThroughFeints && Math.random() < 0.2) {
            const counterAttack = enemy.attacks?.find(a => /counter|riposte|retaliate/i.test(a.label || a.name || ""));
            if (counterAttack) {
                addBattleLog(`${enemy.name} sees an opening and counters!`, "enemy-action");
                const counterDmg = Math.max(1, Math.round(damage * 0.4));
                target.hp = Math.max(0, Number(target.hp || 0) - counterDmg);
                if (!target.vitals || typeof target.vitals !== "object") target.vitals = {};
                target.vitals.hp = target.hp;
                applyCombatantVitalsToSettings(s, target);
                saveSettings();
                showFloatingNumber(targetEl, `-${counterDmg}`, "#facc15");
            }
        }

        renderBattleStage();
        renderBottomDock();

        if (Array.isArray(battleState.actionHistory)) {
            battleState.actionHistory.push({
                actor: enemy.name,
                actionName: enemyVerb,
                target: target.name,
                damage,
                success: true,
                noSell: false,
            });
        }

        if (target.hp <= 0) {
            addBattleLog(`${target.name} is down!`, "critical");
        }

        if (livingAllies().length === 0) {
            endBattle(false);
            return;
        }

        setTimeout(advanceTurn, 600);
    } catch (error) {
        console.error("[Battle] Enemy turn failed:", error);
        setTimeout(advanceTurn, 300);
    }
}

async function runAutoBattleTurn() {
    if (!battleActive || !battleState) return;
    if (battleState.phase !== "player_select") return;
    if (liveEnemies().length === 0 || livingAllies().length === 0) return;
    
    try {
        const pick = await chooseContextualPlayerAction();
        if ((!pick?.action && !pick?.item) || !pick?.target) return;
        
        const planText = pick.plan?.uses_seen_user_tactics ? "learned pattern" : pick.reason;
        addBattleLog(`[Auto] ${planText}: ${pick.item?.name || pick.action?.label || pick.action?.name || "Attack"}.`, "normal");
        if (pick.item) {
            useBattleItem(pick.item);
            // Continue auto battle after item use
            const s = getSettings();
            if (s.rpgSettings?.autoBattleEnabled && battleActive) {
                setTimeout(() => {
                    if (battleActive && battleState && battleState.phase === "player_select") {
                        runAutoBattleTurn();
                    }
                }, 800);
            }
            return;
        }
        if (pick.action?.type === "defend") {
            handleBattleAction(pick.action);
            // Continue auto battle after defend
            const s = getSettings();
            if (s.rpgSettings?.autoBattleEnabled && battleActive) {
                setTimeout(() => {
                    if (battleActive && battleState && battleState.phase === "player_select") {
                        runAutoBattleTurn();
                    }
                }, 800);
            }
            return;
        }
        if (pick.target.side === "ally" || String(pick.target.id) === String(battleState.player?.id)) {
            handleBattleAction(pick.action);
            // Continue auto battle after ally target action
            const s = getSettings();
            if (s.rpgSettings?.autoBattleEnabled && battleActive) {
                setTimeout(() => {
                    if (battleActive && battleState && battleState.phase === "player_select") {
                        runAutoBattleTurn();
                    }
                }, 800);
            }
            return;
        }
        executePlayerAction(pick.action, pick.target.id);
        // Continue auto battle after attack
        const s = getSettings();
        if (s.rpgSettings?.autoBattleEnabled && battleActive) {
            setTimeout(() => {
                if (battleActive && battleState && battleState.phase === "player_select") {
                    runAutoBattleTurn();
                }
            }, 800);
        }
    } catch (error) {
        console.error("[Battle] Auto-battle turn failed:", error);
        setTimeout(advanceTurn, 300);
    }
}

function consumeActionCost(combatant, action) {
    if (!combatant) return false;
    const costs = action?.costs && typeof action.costs === "object"
        ? action.costs
        : (action?.cost && typeof action.cost === "object" ? action.cost : {});
    const vitals = combatant.vitals && typeof combatant.vitals === "object" ? combatant.vitals : combatant;
    for (const key of ["hp", "mp", "ap"]) {
        const cost = Math.max(0, Number(costs?.[key] || 0));
        if (cost > Number(vitals?.[key] || 0)) {
            addBattleLog(`${combatant.name} does not have enough ${key.toUpperCase()} for ${action?.label || action?.name || "that action"}.`, "normal");
            return false;
        }
    }
    for (const key of ["hp", "mp", "ap"]) {
        const cost = Math.max(0, Number(costs?.[key] || 0));
        if (!cost) continue;
        vitals[key] = Math.max(0, Number(vitals[key] || 0) - cost);
        combatant[key] = vitals[key];
    }
    const s = getSettings();
    applyCombatantVitalsToSettings(s, combatant);
    saveSettings();
    return true;
}

function playAttackFeedback(attacker, target, outcome) {
    const attackerEl = document.querySelector(`.battle-sprite-container[data-combatant-id="${attacker.id}"]`);
    const targetEl = document.querySelector(`.battle-sprite-container[data-enemy-id="${target.id}"]`);
    
    if (attackerEl) {
        attackerEl.classList.remove("combat-dash");
        void attackerEl.offsetWidth;
        attackerEl.classList.add("combat-dash");
    }
    if (targetEl) {
        setTimeout(() => {
            targetEl.classList.remove("combat-hit");
            void targetEl.offsetWidth;
            targetEl.classList.add("combat-hit");
            showBattleVfx(targetEl);
            showFloatingNumber(targetEl, `-${outcome.damage}`, outcome.criticalSuccess ? "#facc15" : "#ef4444");
        }, 220);
    }
}

function showBattleVfx(targetEl) {
    const r = targetEl?.getBoundingClientRect?.();
    if (!r) return;
    const fx = document.createElement("div");
    fx.className = "uie-battle-vfx";
    fx.style.left = `${r.left + r.width / 2 - 43}px`;
    fx.style.top = `${r.top + r.height / 2 - 43}px`;
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), 500);
}

function showFloatingNumber(targetEl, text, color) {
    const r = targetEl?.getBoundingClientRect?.();
    if (!r) return;
    const n = document.createElement("div");
    n.className = "uie-damage-number";
    n.textContent = text;
    n.style.color = color || "#ef4444";
    n.style.left = `${r.left + r.width / 2 - 20}px`;
    n.style.top = `${r.top + 18}px`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1000);
}

async function narrateCombatOutcome(action, target, outcome) {
    try {
        const payload = `[Combat Action: Player used ${action?.label || action?.name || "Attack"} on ${target?.name || "target"}. Result: ${outcome.criticalSuccess ? "Critical Hit, " : ""}${outcome.damage} DMG. Target State: ${outcome.surrendered ? "Yielded" : outcome.targetDefeated ? "Defeated and incapacitated, not automatically dead" : `${target.hp}/${target.maxHp} HP`}. Synthesize this exact mechanical outcome into one vivid combat narration sentence. Do not calculate damage or turn defeat into death.]`;
        const text = await generateContent(payload, "Combat Narrative");
        const line = String(typeof text === "string" ? text : text?.content || "").trim();
        if (line) addBattleLog(line.slice(0, 500), "normal");
    } catch (_) {}
}

async function narrateBattleResolution(victory, { permadeath = false, penalties = {} } = {}) {
    const s = getSettings();
    const location = String(s?.worldState?.location || s?.map?.location || "the current location").trim();
    const enemies = [...(battleState?.defeatedEnemies || []), ...(battleState?.enemies || [])]
        .map((enemy) => enemy?.name).filter(Boolean);
    const recent = (battleLog || []).slice(-8).map((entry) => entry?.message).filter(Boolean).join(" | ");
    const fallback = victory
        ? `The fight at ${location} ends with the opposition overcome.`
        : permadeath
            ? `The final blow at ${location} ends the player's life.`
            : `The fight at ${location} ends in defeat, but the player survives—wounded and unable to continue the battle.`;
    try {
        const prompt = [
            "Write one short, vivid aftermath paragraph for this completed RPG battle. Plain prose only.",
            `Outcome: ${victory ? "victory" : permadeath ? "permadeath death" : "nonlethal defeat"}.`,
            `Location: ${location}. Opponents: ${enemies.join(", ") || "unknown"}.`,
            !victory && !permadeath ? "The player is alive. Defeat is not death. Describe incapacitation, surrender, rescue, capture, or forced retreat. Do not change location unless the battle log explicitly says so." : "",
            !victory && permadeath ? "Permadeath is active, so this defeat is a true death. State it clearly without inventing a resurrection." : "",
            !victory ? `Mechanical aftermath: HP ${Number(s.hp || 0)}, XP lost ${Number(penalties.xpLost || 0)}, gold lost ${Number(penalties.goldLost || 0)}.` : "",
            `Recent battle log: ${recent.slice(0, 1600)}`,
            "Do not calculate new damage, rewards, penalties, items, or travel.",
        ].filter(Boolean).join("\n");
        const generated = await Promise.race([
            generateContent(prompt, "Combat Narrative"),
            new Promise((resolve) => setTimeout(() => resolve(""), 4500)),
        ]);
        const text = String(typeof generated === "string" ? generated : generated?.content || "").trim();
        return text || fallback;
    } catch (_) {
        return fallback;
    }
}

function removeEnemy(enemy) {
    const targetEl = document.querySelector(`.battle-sprite-container[data-enemy-id="${enemy.id}"]`);
    if (targetEl) {
        targetEl.style.opacity = "0";
        targetEl.style.transform = "scale(0.5)";
        setTimeout(() => {
            targetEl.remove();
            renderBattleStage();
        }, 300);
    }
    
    if (!Array.isArray(battleState.defeatedEnemies)) battleState.defeatedEnemies = [];
    if (!battleState.defeatedEnemies.some((entry) => String(entry?.id || "") === String(enemy?.id || ""))) battleState.defeatedEnemies.push({ ...enemy });
    const index = battleState.enemies.findIndex(e => e.id === enemy.id || e.name === enemy.name);
    if (index >= 0) battleState.enemies.splice(index, 1);
}

function endBattle(victory) {
    const deck = document.getElementById("battle-action-deck");
    if (deck) deck.style.display = "none";
    battleState.phase = victory ? "victory" : "defeat";
    
    saveBattleToCodex(victory);
    
    if (victory) {
        addBattleLog("⚔ VICTORY! ⚔", "critical");
        showBattleStatus("⚔ VICTORY ⚔", 2000);
        
        try { injectRpEvent("[System: Combat Victory! All enemies defeated.]"); } catch (_) {}

        // Helper Pet XP Rewards
        try {
            const s = getSettings();
            if (s.helperPet) {
                s.helperPet.xp = Number(s.helperPet.xp || 0) + 15;
                const petName = s.helperPet.name || "Helper Pet";
                const currentLv = Number(s.helperPet.level || 1);
                const nextLvXp = currentLv * 100;
                addBattleLog(`🐾 ${petName} gained 15 XP.`, "party-action");
                if (s.helperPet.xp >= nextLvXp) {
                    s.helperPet.xp -= nextLvXp;
                    s.helperPet.level = currentLv + 1;
                    addBattleLog(`🐾 LEVELED UP! ${petName} is now Lv. ${s.helperPet.level}!`, "critical");
                }
                saveSettings();
            }
        } catch (e) {
            console.warn("[Pet] Failed to award battle XP:", e);
        }

        const baseRewards = {
            xp: (battleState.defeatedEnemies || battleState.enemies).reduce((sum, e) => sum + (e.xp || 50), 0),
            gold: (battleState.defeatedEnemies || battleState.enemies).reduce((sum, e) => sum + (e.gold || 25), 0),
            loot: (battleState.defeatedEnemies || battleState.enemies).flatMap(e => e.loot || []).slice(0, 3)
        };
        
        setTimeout(() => {
            const rewards = distributeRewards(baseRewards);
            showVictoryWindow(rewards);
        }, 2500);
    } else {
        addBattleLog("☠ DEFEAT ☠", "critical");
        showBattleStatus("☠ DEFEAT ☠", 2000);
        
        const s = getSettings();
        const isPermadeath = permadeathEnabled(s);
        battleState.resolutionPermadeath = isPermadeath;
        const penalties = {
            xpLost: Math.floor(Math.random() * 50) + 10,
            goldLost: Math.floor(Math.random() * 30) + 5,
            statusEffects: ["Wounded"]
        };
        
        try {
            injectRpEvent(isPermadeath
                ? "[System: Combat defeat with PERMADEATH ACTIVE. The player died.]"
                : "[System: Nonlethal combat defeat. The player survived and must never be described as dead.]");
            if (!isPermadeath) {
                const allies = Array.isArray(battleState?.allies) ? battleState.allies : [];
                for (const ally of allies) {
                    if (Number(ally?.hp || ally?.vitals?.hp || 0) > 0) continue;
                    ally.hp = 1;
                    if (!ally.vitals || typeof ally.vitals !== "object") ally.vitals = {};
                    ally.vitals.hp = 1;
                    ally.vitals.maxHp = Number(ally.maxHp || ally.vitals.maxHp || 100);
                    applyCombatantVitalsToSettings(s, ally);
                }
                s.hp = Math.max(1, Number(s.hp || 0));
            }
            if (s.inventory) {
                s.inventory.gold = Math.max(0, (s.inventory.gold || 0) - penalties.goldLost);
                injectRpEvent(`[System: Lost -${penalties.goldLost} Gold due to defeat.]`);
            }
            if (s.jobClass) {
                s.jobClass.xp = Math.max(0, (s.jobClass.xp || 0) - penalties.xpLost);
                injectRpEvent(`[System: Lost -${penalties.xpLost} XP due to defeat.]`);
            }
            if (penalties.statusEffects) {
                s.character = s.character || {};
                s.character.statusEffects = s.character.statusEffects || [];
                penalties.statusEffects.forEach(effect => {
                    if (!s.character.statusEffects.some(x => String(typeof x === "string" ? x : x?.name || "").toLowerCase() === effect.toLowerCase())) {
                        s.character.statusEffects.push(effect);
                        injectRpEvent(`[System: Gained status effect: ${effect}.]`);
                    }
                });
            }
            saveSettings();
            try { if (typeof $ !== "undefined") $(document).trigger("uie:updateVitals"); } catch (_) {}
            try { window.dispatchEvent(new CustomEvent("uie:updateVitals")); } catch (_) {}
        } catch (_) {}

        battleState.resolutionNarration = narrateBattleResolution(false, { permadeath: isPermadeath, penalties })
            .then((text) => {
                const narration = String(text || "").trim();
                const box = document.getElementById("defeat-narration");
                if (box) box.textContent = narration;
                if (narration) injectRpEvent(`[System: Battle aftermath narration: ${narration}]`);
                return narration;
            });

        setTimeout(() => {
            const title = document.querySelector("#battle-defeat-window h2");
            if (title) title.textContent = isPermadeath ? "Death" : "Defeat — You Survived";
            showDefeatWindow(penalties);
        }, 2500);
    }
}

export function closeBattle(options = {}) {
    battleActive = false;
    pendingAction = null;
    selectedTarget = null;
    if (battleState) {
        battleState.phase = null;
        battleState.turnQueue = [];
        battleState.turnIndex = 0;
        battleState.activeActorId = null;
        battleState.activeSide = null;
        battleState.enemyIntents = {};
    }
    try {
        const s = getSettings();
        if (!s.battle || typeof s.battle !== "object") s.battle = {};
        if (!s.battle.state || typeof s.battle.state !== "object") s.battle.state = {};
        s.battle.state.active = false;
        if (options.outcome) s.battle.state.outcome = String(options.outcome);
        if (options.reason) s.battle.state.lastExitReason = String(options.reason);
        saveSettings();
    } catch (_) {}
    const battleScreen = document.getElementById("battle-screen");
    if (battleScreen) {
        battleScreen.style.display = "none";
        battleScreen.remove();
    }
    const victoryWindow = document.getElementById("battle-victory-window");
    if (victoryWindow) victoryWindow.style.display = "none";
    const defeatWindow = document.getElementById("battle-defeat-window");
    if (defeatWindow) defeatWindow.style.display = "none";
    const adviceEl = document.getElementById("uie-battle-pet-advice");
    if (adviceEl) adviceEl.remove();

    const vnScreen = document.getElementById("reality-stage") || document.getElementById("vn-screen");
    if (vnScreen) vnScreen.style.display = "block";
    const partyWindow = document.getElementById("uie-party-window");
    if (partyWindow) {
        partyWindow.style.visibility = "";
        partyWindow.style.pointerEvents = "";
    }

    notify("info", "Battle ended", "Battle");
}

export function fleeBattle() {
    addBattleLog("Fled from battle!", "normal");
    closeBattle({ outcome: "fled", reason: "flee" });
    try { notify("info", "You fled the battle.", "Battle"); } catch (_) {}
}

export function initBattle() {
    bindBattleControls();
    window.UIE_ensureBattle = ensureBattle;
    window.UIE_closeBattle = closeBattle;
    window.UIE_fleeBattle = fleeBattle;
    window.UIE_openBattleTargetPicker = openBattleTargetPicker;

    if (!window.UIE_battleEventBridgeBound) {
        window.UIE_battleEventBridgeBound = true;
        window.addEventListener("uie:battle_detected", async () => {
            try {
                const s = getSettings();
                if (s?.rpgSettings?.battleEnabled === false || s?.rpgSettings?.battleAutoOpen === false) return;
                const enemies = Array.isArray(s?.battle?.state?.enemies) ? s.battle.state.enemies : [];
                if (enemies.length) {
                    const built = await Promise.all(enemies.map((en) => generateEnemyDefinition(en).catch(() => makeEnemyFromTarget(en))));
                    ensureBattle(built, { source: "state_tracker" });
                }
            } catch (e) {
                console.error("[Battle] Failed to open detected battle:", e);
            }
        });
        window.addEventListener("uie:state_updated", (event) => {
            const domain = String(event?.detail?.domain || "");
            if (domain === "party") refreshActiveBattleProjection();
        });
    }
    console.log("[Battle] Battle system initialized");
}

function bindBattleControls() {
    if (!document.documentElement.dataset.uieBattleDelegatedControls) {
        document.documentElement.dataset.uieBattleDelegatedControls = "true";
        document.addEventListener("click", (event) => {
            const close = event.target?.closest?.("#battle-close-btn, .flee-action");
            if (close) {
                event.preventDefault();
                event.stopPropagation();
                fleeBattle();
                return;
            }
            const auto = event.target?.closest?.("#battle-auto-btn");
            if (!auto) return;
            event.preventDefault();
            event.stopPropagation();
            toggleAutoBattle(auto);
        }, true);
    }
    const victoryBtn = document.getElementById("victory-continue");
    if (victoryBtn) {
        victoryBtn.onclick = () => {
            const window = document.getElementById("battle-victory-window");
            if (window) window.style.display = "none";
            closeBattle();
        };
    }

    const defeatContinue = document.getElementById("defeat-continue");
    if (defeatContinue) {
        defeatContinue.onclick = async () => {
            try { await battleState?.resolutionNarration; } catch (_) {}
            const window = document.getElementById("battle-defeat-window");
            if (window) window.style.display = "none";
            const died = battleState?.resolutionPermadeath === true;
            closeBattle({ outcome: died ? "permadeath" : "defeat_survived", reason: died ? "permadeath" : "nonlethal_defeat" });
            if (died) {
                try { globalThis.UIE?.penalties?.checkDeathState?.(); } catch (_) {}
            }
        };
    }

    const defeatRetry = document.getElementById("defeat-retry");
    if (defeatRetry) {
        defeatRetry.onclick = () => {
            const window = document.getElementById("battle-defeat-window");
            if (window) window.style.display = "none";
            notify("info", "Retry not yet implemented", "Battle");
            closeBattle();
        };
    }

    const closeBtn = document.getElementById("battle-close-btn");
    if (closeBtn) {
        closeBtn.style.pointerEvents = "auto";
        closeBtn.onclick = null;
    }
    
    // Auto Battle button
    const autoBtn = document.getElementById("battle-auto-btn");
    if (autoBtn) {
        autoBtn.style.pointerEvents = "auto";
        const s = getSettings();
        if (!s.rpgSettings) s.rpgSettings = {};
        autoBtn.textContent = s.rpgSettings.autoBattleEnabled ? "Auto: ON" : "Auto: OFF";
        autoBtn.onclick = null;
    }
}

function toggleAutoBattle(button = document.getElementById("battle-auto-btn")) {
    const sNow = getSettings();
    if (!sNow.rpgSettings) sNow.rpgSettings = {};
    sNow.rpgSettings.autoBattleEnabled = !sNow.rpgSettings.autoBattleEnabled;
    saveSettings();
    if (button) button.textContent = sNow.rpgSettings.autoBattleEnabled ? "Auto: ON" : "Auto: OFF";
    if (sNow.rpgSettings.autoBattleEnabled) {
        notify("info", "Auto Battle Enabled", "Combat");
        if (battleState?.phase === "player_select") runAutoBattleTurn();
    } else {
        notify("info", "Auto Battle Disabled", "Combat");
    }
}

function distributeRewards(rewards = {}) {
    const s = getSettings();
    const multipliers = {
        xp: Number(s.rpgSettings?.xpMultiplier || 1),
        gold: Number(s.rpgSettings?.goldMultiplier || 1)
    };

    const results = {
        xp: 0,
        gold: 0,
        loot: [],
        skills: [],
        statusEffects: [],
        levelUp: false,
        oldLevel: 0,
        newLevel: 0
    };

    if (rewards.xp) {
        const xpGained = Math.round((rewards.xp || 0) * multipliers.xp);
        results.xp = xpGained;
        const levelData = grantXP(s, xpGained);
        if (levelData.leveledUp) {
            results.levelUp = true;
            results.oldLevel = levelData.oldLevel;
            results.newLevel = levelData.newLevel;
            if (levelData.skillsLearned) {
                results.skills = levelData.skillsLearned;
            }
        }
    }

    if (rewards.gold) {
        const goldGained = Math.round((rewards.gold || 0) * multipliers.gold);
        results.gold = goldGained;
        if (!s.inventory) s.inventory = {};
        s.inventory.gold = (s.inventory.gold || 0) + goldGained;
    }

    if (Array.isArray(rewards.loot)) {
        results.loot = rewards.loot;
        if (!Array.isArray(s.inventory?.items)) {
            if (!s.inventory) s.inventory = {};
            s.inventory.items = [];
        }
        rewards.loot.forEach(item => {
            if (typeof item === "string") {
                s.inventory.items.push({ name: item, quantity: 1 });
            } else if (item && typeof item === "object") {
                s.inventory.items.push(item);
            }
        });
    }

    if (Array.isArray(rewards.statusEffects)) {
        results.statusEffects = rewards.statusEffects;
    }

    try {
        if (results.xp > 0) {
            injectRpEvent(`[System: Gained +${results.xp} XP.]`);
        }
        if (results.levelUp) {
            injectRpEvent(`[System: Level Up! Reached Level ${results.newLevel}.]`);
            if (results.skills && results.skills.length > 0) {
                results.skills.forEach(sk => {
                    injectRpEvent(`[System: Unlocked new skill: ${sk.name}.]`);
                });
            }
        }
        if (results.gold > 0) {
            injectRpEvent(`[System: Gained +${results.gold} Gold.]`);
        }
        if (results.loot && results.loot.length > 0) {
            results.loot.forEach(item => {
                const name = typeof item === "string" ? item : (item?.name || "Unknown Item");
                const qty = typeof item === "object" ? (item?.quantity || item?.qty || 1) : 1;
                injectRpEvent(`[System: Earned loot: ${name} x${qty}.]`);
            });
        }
        if (results.statusEffects && results.statusEffects.length > 0) {
            results.statusEffects.forEach(effect => {
                injectRpEvent(`[System: Gained status effect: ${effect}.]`);
            });
        }
    } catch (_) {}

    saveSettings();
    return results;
}

function grantXP(s, amount) {
    if (!s.jobClass) s.jobClass = { level: 1, xp: 0, class: "Adventurer" };
    const oldLevel = s.jobClass.level || 1;
    s.jobClass.xp = (s.jobClass.xp || 0) + amount;
    
    const XP_TO_LEVEL = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];
    let newLevel = oldLevel;
    const skillsLearned = [];
    
    while (newLevel < 10 && s.jobClass.xp >= XP_TO_LEVEL[newLevel]) {
        newLevel++;
        if (newLevel % 2 === 0) {
            skillsLearned.push({
                name: `Level ${newLevel} Skill`,
                description: `New ability unlocked at level ${newLevel}`
            });
        }
    }
    
    s.jobClass.level = newLevel;
    return {
        leveledUp: newLevel > oldLevel,
        oldLevel,
        newLevel,
        skillsLearned: skillsLearned.length > 0 ? skillsLearned : null
    };
}

function showVictoryWindow(rewards) {
    const window = document.getElementById("battle-victory-window");
    if (!window) return;

    if (rewards.levelUp) {
        const levelUpDiv = document.getElementById("victory-level-up");
        const levelText = document.getElementById("victory-level-text");
        const levelSub = document.getElementById("victory-level-sub");
        if (levelUpDiv) levelUpDiv.style.display = "block";
        if (levelText) levelText.textContent = "⭐ LEVEL UP! ⭐";
        if (levelSub) levelSub.textContent = `Level ${rewards.oldLevel} → Level ${rewards.newLevel}`;
    }

    const rewardsList = document.getElementById("victory-rewards-list");
    if (rewardsList) {
        rewardsList.innerHTML = "";
        if (rewards.xp) {
            rewardsList.innerHTML += `
                <div class="reward-item">
                    <span class="reward-label">✨ Experience Points</span>
                    <span class="reward-value">+${rewards.xp} XP</span>
                </div>
            `;
        }
        if (rewards.gold) {
            rewardsList.innerHTML += `
                <div class="reward-item">
                    <span class="reward-label">💰 Gold</span>
                    <span class="reward-value">+${rewards.gold}</span>
                </div>
            `;
        }
        if (rewards.loot && rewards.loot.length > 0) {
            rewards.loot.forEach(item => {
                const itemName = typeof item === "string" ? item : item.name;
                rewardsList.innerHTML += `
                    <div class="reward-item">
                        <span class="reward-label">🎁 ${itemName}</span>
                        <span class="reward-value">+1</span>
                    </div>
                `;
            });
        }
    }

    if (rewards.skills && rewards.skills.length > 0) {
        const skillsSection = document.getElementById("victory-skills-section");
        const skillsList = document.getElementById("victory-skills-list");
        if (skillsSection) skillsSection.style.display = "block";
        if (skillsList) {
            skillsList.innerHTML = "";
            rewards.skills.forEach(skill => {
                skillsList.innerHTML += `
                    <div class="skill-acquired">
                        <div class="skill-icon">✦</div>
                        <div>
                            <div class="skill-name">${skill.name}</div>
                            <div class="skill-desc">${skill.description || ""}</div>
                        </div>
                    </div>
                `;
            });
        }
    }

    if (rewards.statusEffects && rewards.statusEffects.length > 0) {
        const effectsSection = document.getElementById("victory-effects-section");
        const effectsList = document.getElementById("victory-effects-list");
        if (effectsSection) effectsSection.style.display = "block";
        if (effectsList) {
            effectsList.innerHTML = "";
            rewards.statusEffects.forEach(effect => {
                effectsList.innerHTML += `<span class="status-effect-tag">\${effect}</span>`;
            });
        }
    }

    window.style.display = "flex";
}

function showDefeatWindow(penalties) {
    const window = document.getElementById("battle-defeat-window");
    if (!window) return;

    const penaltiesList = document.getElementById("defeat-penalties-list");
    if (penaltiesList) {
        penaltiesList.innerHTML = "";
        
        if (penalties.xpLost) {
            penaltiesList.innerHTML += `
                <div class="reward-item">
                    <span class="reward-label">✨ Experience Lost</span>
                    <span class="reward-value negative">-${penalties.xpLost} XP</span>
                </div>
            `;
        }
        if (penalties.goldLost) {
            penaltiesList.innerHTML += `
                <div class="reward-item">
                    <span class="reward-label">💰 Gold Lost</span>
                    <span class="reward-value negative">-${penalties.goldLost}</span>
                </div>
            `;
        }
        if (penalties.itemsLost && penalties.itemsLost.length > 0) {
            penalties.itemsLost.forEach(item => {
                penaltiesList.innerHTML += `
                    <div class="reward-item">
                        <span class="reward-label">💔 ${item}</span>
                        <span class="reward-value negative">Lost</span>
                    </div>
                `;
            });
        }
    }

    if (penalties.statusEffects && penalties.statusEffects.length > 0) {
        const effectsSection = document.getElementById("defeat-effects-section");
        const effectsList = document.getElementById("defeat-effects-list");
        if (effectsSection) effectsSection.style.display = "block";
        if (effectsList) {
            effectsList.innerHTML = "";
            penalties.statusEffects.forEach(effect => {
                effectsList.innerHTML += `<span class="status-effect-tag">\${effect}</span>`;
            });
        }
    }

    window.style.display = "flex";
}

function showBattleStatus(message, duration = 2000) {
    const status = document.getElementById("battle-status-message");
    if (!status) return;
    status.textContent = message;
    status.style.display = "block";
    setTimeout(() => {
        status.style.display = "none";
    }, duration);
}

function saveBattleToCodex(victory) {
    try {
        const s = getSettings();
        if (!s) return;
        if (!s.journal || typeof s.journal !== "object") s.journal = {};
        if (!Array.isArray(s.journal.codex)) s.journal.codex = [];
        
        const enemies = (battleState?.enemies || []).map(e => e.name || "Unknown Enemy").filter(Boolean);
        const allies = (battleState?.allies || []).map(a => a.name || "Ally").filter(Boolean);
        const location = String(s?.currentLocation || s?.location || "Unknown Location").slice(0, 60);
        const round = battleState?.round || 0;
        const logSummary = (battleLog || []).slice(-10).map(e => e.message).join(" | ").slice(0, 500);
        
        const title = victory 
            ? `Victory: ${enemies.slice(0, 3).join(", ") || "Battle"}`
            : `Defeat: ${enemies.slice(0, 3).join(", ") || "Battle"}`;
        
        const body = [
            `Outcome: ${victory ? "Victory" : "Defeat"}`,
            `Location: ${location}`,
            `Rounds: ${round}`,
            `Allies: ${allies.join(", ") || "None"}`,
            `Enemies: ${enemies.join(", ") || "None"}`,
            `Summary: ${logSummary || "No battle log available."}`
        ].join("\n");
        
        const keywords = [
            victory ? "victory" : "defeat",
            "battle",
            location.toLowerCase(),
            ...enemies.map(e => e.toLowerCase()).slice(0, 5)
        ].filter(Boolean);
        
        const entry = {
            id: `battle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            title: title.slice(0, 80),
            category: "Battles",
            body: body.slice(0, 3000),
            keywords: keywords.slice(0, 16),
            ts: Date.now(),
            updatedAt: Date.now(),
            _source: "battle_system"
        };
        
        s.journal.codex.push(entry);
        s.journal.codex = s.journal.codex.slice(-100);
        s.codex = { entries: s.journal.codex };
        saveSettings();
        
        try { notify("info", `Battle recorded in Codex`, "Journal"); } catch (_) {}
    } catch (e) {
        console.error("Failed to save battle to codex:", e);
    }
}

function addBattleLog(message, type = "normal") {
    const entry = { message, type, timestamp: Date.now() };
    battleLog.push(entry);
    const logEl = document.getElementById("battle-log");
    if (!logEl) return;
    
    const div = document.createElement("div");
    div.className = `battle-log-entry ${type}`;
    div.style.marginBottom = "4px";
    if (type === "critical") div.style.color = "#fb7185";
    else if (type === "player-action") div.style.color = "#38bdf8";
    else if (type === "enemy-action") div.style.color = "#f43f5e";
    else div.style.color = "#cbd5e1";
    div.textContent = message;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

function clearBattleLog() {
    battleLog = [];
    const logEl = document.getElementById("battle-log");
    if (logEl) logEl.innerHTML = "";
}
