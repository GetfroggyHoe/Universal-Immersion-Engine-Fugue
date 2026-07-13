import { getSettings, saveSettings } from "./core.js";
import {
    VoiceBridge,
    createDefaultPocketVoiceRecipe,
    createKokoroVoiceRecipe,
    createPocketVoiceRecipe,
    createRandomPocketVoiceRecipe,
    KOKORO_LANGUAGE_OPTIONS,
    KOKORO_PRESET_VOICES,
    POCKET_PRESET_VOICES
} from "./voiceBridge.js";

/*
  UIE Character Cards Module
  Popup-driven, tabbed, mobile-safe character creator/editor.
*/

const CSS = `
#uie-card-manager {
    position: fixed; inset: 0; z-index: 2147483647;
    width: 100vw !important; height: 100dvh !important;
    max-width: 100vw !important; max-height: 100dvh !important;
    background: #fcf5eb; color: #3a2211;
    font-family: 'Georgia', serif;
    display: flex; flex-direction: column; pointer-events: auto !important; isolation: isolate;
    border: 8px double #5c3a21;
}
#uie-card-manager * { pointer-events: auto; }
.cm-header {
    height: 64px; border-bottom: 4px solid #5c3a21;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; background: #e2c0a2;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}
.cm-title { font-family: 'Georgia', serif; font-size: 1.4em; font-weight: bold; color: #3a2211; letter-spacing: .02em; }
.cm-icon-btn {
    width: 40px; height: 40px; border-radius: 4px; border: 2.5px solid #5c3a21; background: #b36629; color: #fffdf9;
    cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 16px;
    padding: 0; flex-shrink: 0; box-shadow: inset -2px -2px #5c3a21, inset 2px 2px #f7c86f;
    transition: all 0.1s;
}
.cm-icon-btn:hover { background: #c97b30; transform: scale(1.02); }
.ce-header-btn {
    background: #b36629; border: 2.5px solid #5c3a21; color: #fffdf9;
    padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px;
    font-weight: bold; flex-shrink: 0; box-shadow: inset -2px -2px #5c3a21, inset 2px 2px #f7c86f;
    font-family: 'Georgia', serif; display: inline-flex; align-items: center; gap: 6px;
}
.ce-header-btn:hover { background: #c97b30; }
.ce-header-btn-primary {
    background: #4caf50; border-color: #2e7d32; box-shadow: inset -2px -2px #2e7d32, inset 2px 2px #a5d6a7;
}
.ce-header-btn-primary:hover { background: #66bb6a; }
.cm-content { flex: 1; overflow-y: auto; padding: 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; background: #fcf5eb; }

.char-card-preview {
    background: #fffdf5 !important;
    border: 4px double #5c3a21 !important;
    border-radius: 8px !important;
    overflow: hidden; cursor: pointer; transition: all 0.2s;
    display: flex; flex-direction: column; min-height: 290px;
    box-shadow: 0 4px 12px rgba(92,55,32,0.18), 0 3px 0 #3b2212 !important;
    color: #3a2211 !important;
}
.char-card-preview:hover { 
    transform: translateY(-3px); 
    box-shadow: 0 8px 16px rgba(92,55,32,0.25), 0 3px 0 var(--accent) !important; 
    border-color: var(--accent) !important; 
}
.ccp-img { 
    flex: 1; 
    min-height: 160px; 
    background: #e8d0ad !important; 
    background-size: cover; 
    background-position: center; 
    border-bottom: 2.5px solid #5c3a21 !important; 
}
.ccp-actions {
    display: flex; gap: 6px; padding: 6px;
    background: rgba(92,55,32,0.06) !important; 
    border-top: 1.5px dashed rgba(92,55,32,0.2) !important;
    flex-shrink: 0;
}
.ccp-narrator-btn, .ccp-game-btn {
    flex: 1; font-size: 9.5px; font-weight: 800;
    padding: 6px 4px; border-radius: 4px; 
    border: 2px solid #3e2212 !important;
    background: #8e5431 !important; 
    color: #ffdcb0 !important; 
    cursor: pointer; transition: all 0.1s;
    text-transform: uppercase; 
    box-shadow: inset 0 -2px 0 #281408, 0 1.5px 0 #281408 !important;
    font-family: 'Cinzel', Georgia, serif;
}
.ccp-narrator-btn:hover, .ccp-game-btn:hover { 
    background: #a2653c !important; 
}
.ccp-narrator-btn:active, .ccp-game-btn:active {
    transform: translateY(1px);
    box-shadow: inset 0 -2px 0 #281408, 0 0.5px 0 #281408 !important;
}
.ccp-game-btn.active {
    background: #4f8f48 !important; 
    border-color: #264a22 !important; 
    color: #fffdf9 !important;
    box-shadow: inset 0 -2px 0 #183315, 0 1px 0 #281408 !important;
}
.ccp-info { 
    padding: 10px; 
    background: transparent !important; 
    flex-shrink: 0; 
    border-top: 1.5px dashed rgba(92,55,32,0.2) !important; 
}
.ccp-name { 
    font-weight: 900; 
    color: #3a2211 !important; 
    font-size: 1.05em; 
    white-space: nowrap; 
    overflow: hidden; 
    text-overflow: ellipsis; 
    font-family: Georgia, serif;
}
.ccp-role { 
    font-size: 0.82em; 
    color: #85593c !important; 
    margin-top: 2px; 
    font-style: italic; 
    font-family: Georgia, serif;
}
.ccp-trackers { display:grid; gap:4px; margin-top:8px; }
.ccp-meter { display:grid; grid-template-columns:44px 1fr 20px; align-items:center; gap:5px; font-size:9px; color:#3a2211 !important; }
.ccp-meter-track { 
    height:6px; 
    border-radius:3px; 
    overflow:hidden; 
    background:#e8d0ad !important; 
    border: 1px solid #5c3a21 !important; 
}
.ccp-meter-fill { height:100%; border-radius:inherit; background: #ff4a5a !important; }

/* Anime roster refresh */
.uie-sr-only {
    position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important;
    overflow:hidden !important; clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important;
}
#uie-card-manager {
    background:
        linear-gradient(135deg, rgba(15,23,42,0.98), rgba(25,35,58,0.98) 48%, rgba(39,21,43,0.98)) !important;
    color: #e5e7eb !important;
    font-family: Inter, system-ui, -apple-system, sans-serif !important;
    border: none !important;
}
.cm-header {
    min-height: 68px !important;
    height: auto !important;
    padding: 10px 18px !important;
    background: rgba(6, 12, 24, 0.86) !important;
    border-bottom: 1px solid rgba(125, 211, 252, 0.24) !important;
    box-shadow: 0 18px 48px rgba(0,0,0,0.28) !important;
}
.cm-title {
    display: inline-flex !important;
    align-items: center !important;
    gap: 10px !important;
    color: #f8fafc !important;
    font-family: Inter, system-ui, -apple-system, sans-serif !important;
    font-size: 15px !important;
    text-transform: uppercase !important;
    letter-spacing: 0.08em !important;
}
.cm-title i { color: #7dd3fc; }
.cm-toolbar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
}
.cm-icon-btn,
.cm-action-btn {
    height: 36px !important;
    border-radius: 8px !important;
    border: 1px solid rgba(226, 232, 240, 0.16) !important;
    background: rgba(15, 23, 42, 0.76) !important;
    color: #e5e7eb !important;
    box-shadow: none !important;
    font-family: Inter, system-ui, -apple-system, sans-serif !important;
    font-weight: 800 !important;
}
.cm-icon-btn {
    width: 36px !important;
    font-size: 14px !important;
}
.cm-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 12px !important;
    cursor: pointer;
}
.cm-icon-btn:hover,
.cm-action-btn:hover {
    transform: translateY(-1px) !important;
    border-color: rgba(125, 211, 252, 0.46) !important;
    color: #7dd3fc !important;
}
.cm-action-btn.is-primary {
    background: linear-gradient(135deg, #f59e0b, #22c55e) !important;
    color: #08111f !important;
    border: none !important;
}
.cm-action-btn.is-danger,
.cm-icon-btn.is-danger {
    color: #fecaca !important;
    border-color: rgba(248, 113, 113, 0.34) !important;
}
.cm-content {
    padding: 20px !important;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)) !important;
    gap: 16px !important;
    background:
        linear-gradient(90deg, rgba(125,211,252,0.06) 1px, transparent 1px),
        linear-gradient(0deg, rgba(226,232,240,0.05) 1px, transparent 1px),
        transparent !important;
    background-size: 42px 42px !important;
}
.char-card-preview {
    min-height: 318px !important;
    border: 1px solid rgba(226, 232, 240, 0.16) !important;
    border-radius: 8px !important;
    background: rgba(8, 13, 26, 0.82) !important;
    color: #f8fafc !important;
    box-shadow: 0 16px 36px rgba(0,0,0,0.30) !important;
}
.char-card-preview:hover {
    transform: translateY(-4px) !important;
    border-color: rgba(125, 211, 252, 0.5) !important;
    box-shadow: 0 22px 44px rgba(0,0,0,0.38), 0 0 0 1px rgba(125,211,252,0.16) !important;
}
.char-card-preview.is-narrator {
    border-color: rgba(244, 114, 182, 0.58) !important;
}
.ccp-img {
    position: relative !important;
    min-height: 188px !important;
    background:
        linear-gradient(135deg, rgba(125,211,252,0.22), rgba(244,114,182,0.14) 48%, rgba(250,204,21,0.15)),
        #111827 !important;
    border-bottom: 1px solid rgba(226, 232, 240, 0.13) !important;
}
.ccp-img::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 42%, rgba(3,7,18,0.78));
    pointer-events: none;
}
.ccp-fallback-icon {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: rgba(226, 232, 240, 0.36);
    font-size: 42px;
}
.ccp-img.has-portrait .ccp-fallback-icon {
    opacity: 0;
}
.ccp-actions {
    gap: 7px !important;
    padding: 8px !important;
    background: rgba(3, 7, 18, 0.60) !important;
    border-top: 1px solid rgba(226, 232, 240, 0.10) !important;
}
.ccp-narrator-btn, .ccp-game-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 5px !important;
    min-height: 31px !important;
    border-radius: 7px !important;
    border: 1px solid rgba(226, 232, 240, 0.16) !important;
    background: rgba(15, 23, 42, 0.82) !important;
    color: #cbd5e1 !important;
    box-shadow: none !important;
    font-family: Inter, system-ui, -apple-system, sans-serif !important;
    font-size: 10px !important;
    text-transform: none !important;
}
.ccp-narrator-btn:hover, .ccp-game-btn:hover {
    background: rgba(30, 41, 59, 0.95) !important;
    color: #f8fafc !important;
}
.ccp-game-btn.active {
    background: rgba(34, 197, 94, 0.18) !important;
    border-color: rgba(34, 197, 94, 0.48) !important;
    color: #bbf7d0 !important;
}
.ccp-narrator-btn.active {
    background: rgba(244, 114, 182, 0.18) !important;
    border-color: rgba(244, 114, 182, 0.48) !important;
    color: #fbcfe8 !important;
}
.ccp-info {
    padding: 12px !important;
    border-top: 1px solid rgba(226, 232, 240, 0.08) !important;
}
.ccp-name {
    color: #f8fafc !important;
    font-family: Inter, system-ui, -apple-system, sans-serif !important;
}
.ccp-role {
    color: #93c5fd !important;
    font-family: Inter, system-ui, -apple-system, sans-serif !important;
    font-style: normal !important;
}
.ccp-meter {
    color: #cbd5e1 !important;
}
.ccp-meter-track {
    background: rgba(15, 23, 42, 0.9) !important;
    border-color: rgba(226, 232, 240, 0.13) !important;
}

/* EDITOR POPUP */
#uie-card-editor {
    position: fixed; inset: 0; z-index: 2147483647;
    width: 100vw !important; height: 100dvh !important;
    max-width: 100vw !important; max-height: 100dvh !important;
    background: #fcf5eb; display: flex; flex-direction: column; color: #3a2211;
    pointer-events: auto !important; border: 8px double #5c3a21;
    font-family: 'Georgia', serif;
}
.ce-header {
    min-height: 60px; border-bottom: 4px solid #5c3a21;
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 12px; padding: 10px 24px; background: #e2c0a2;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}
.ce-header-actions {
    display: flex; flex-wrap: nowrap; gap: 8px; align-items: center;
    max-width: 100%; flex: 1 1 auto; justify-content: flex-end;
}
.ce-tabs { 
    height: 48px; background: #d8b99c; border-bottom: 3px solid #5c3a21;
    display: flex; overflow-x: auto; align-items: center; padding: 0 16px; gap: 8px;
    scrollbar-width: none;
}
.ce-tabs::-webkit-scrollbar { display:none; }
.ce-tab {
    padding: 6px 14px; background: #fcf5eb; border-radius: 4px;
    font-size: 12px; cursor: pointer; border: 2px solid #5c3a21; white-space: nowrap;
    color: #3a2211; transition: all 0.15s; font-weight: bold;
    box-shadow: inset -1px -1px rgba(0,0,0,0.1);
}
.ce-tab:hover { background: #e2c0a2; }
.ce-tab.active { background: #b36629 !important; color: #fffdf9 !important; border-color: #5c3a21 !important; box-shadow: inset -2px -2px #5c3a21, inset 2px 2px #f7c86f !important; }
 
.ce-body { flex: 1; display: flex; overflow: hidden; }
.ce-form { flex: 1; overflow-y: auto; padding: 24px; max-width: 900px; margin: 0 auto; width: 100%; box-sizing: border-box; scrollbar-width: thin; pointer-events: auto; }
.ce-preview { width: 320px; background: #fffdf9; border-left: 4px solid #5c3a21; overflow-y: auto; padding: 20px; display: flex; pointer-events: auto; flex-direction: column; align-items: center; box-sizing: border-box; }

.ce-section { display: none; }
.ce-section.active { display: block; }

.ce-group { margin-bottom: 16px; }
.ce-label { display: block; font-size: 0.8em; color: #3a2211; margin-bottom: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
.ce-input, .ce-textarea, .ce-select {
    width: 100%; padding: 10px; background: #fffdf9 !important; border: 2px solid #5c3a21 !important;
    border-radius: 4px; color: #3a2211 !important; font-size: 14px; box-sizing: border-box; pointer-events: auto; cursor: text;
    font-family: 'Georgia', serif;
}
.ce-input::placeholder, .ce-textarea::placeholder { color: #4b2b16; opacity: 1; }
.ce-input[hidden] { display: none !important; }
.ce-input:focus, .ce-textarea:focus, .ce-select:focus { border-color: #b36629 !important; outline: none; }
.ce-input,
.ce-textarea,
.ce-select,
#uie-character-generator-modal textarea,
#uie-character-generator-modal input {
    background: #fffdf9 !important;
    color: #2f1a0e !important;
}
.ce-voice-field[type="range"],
#uie-character-generator-modal input[type="range"],
.uie-voice-semantic input[type="range"] {
    width: 100%;
    accent-color: #b86f2c;
}
.ce-voice-semantic-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
}
.ce-voice-slider {
    min-width: 0;
}
.ce-voice-hidden {
    display: none !important;
}
@media (min-width: 99999px) {
    #uie-card-editor {
        border-width: 4px !important;
        border-radius: 0 !important;
    }
    .ce-header {
        min-height: 48px;
        padding: 8px 10px;
        gap: 8px;
    }
    .ce-header .cm-title {
        min-width: 0;
        flex: 1 1 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 1.05em;
    }
    .ce-header-actions {
        justify-content: flex-start;
        overflow-x: auto;
        flex-wrap: nowrap;
        width: 100%;
        padding-bottom: 2px;
    }
    .ce-header-btn {
        width: 36px;
        min-width: 36px;
        max-width: 36px;
        min-height: 34px;
        height: 34px;
        padding: 0;
        justify-content: center;
        gap: 0;
        font-size: 0;
        overflow: hidden;
        white-space: nowrap;
    }
    .ce-header-btn i {
        font-size: 14px;
        margin: 0;
    }
    .ce-header-btn-primary {
        width: 44px;
        min-width: 44px;
        max-width: 44px;
    }
    .ce-tabs {
        height: 42px;
        padding: 0 8px;
    }
    .ce-tab {
        padding: 6px 10px;
    }
    .ce-body {
        display: block;
        overflow: auto;
    }
    .ce-form {
        padding: 12px;
        max-width: none;
    }
    .ce-preview {
        display: none !important;
    }
    .ce-voice-semantic-grid {
        grid-template-columns: 1fr;
        gap: 8px;
    }
}
.ccp-listen-btn {
    width: 30px;
    min-width: 30px;
    height: 30px;
    border-radius: 6px;
    border: 1px solid rgba(151, 91, 39, 0.36);
    background: #fff4e3;
    color: #5c3a21;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: 0 0 auto;
}
.ccp-listen-btn:hover { border-color: #b86f2c; color: #b86f2c; }

/* Tag Pill Lists */
.ce-tag-editor { display: flex; flex-direction: column; gap: 8px; border: 2px solid #5c3a21; border-radius: 4px; padding: 12px; background: rgba(0,0,0,0.03); }
.ce-tag-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.ce-tag {
    display: inline-flex; align-items: center; gap: 6px; background: #fffdf9; border: 2.5px solid #5c3a21;
    border-radius: 4px; padding: 4px 8px; font-size: 12px; font-weight: bold; color: #3a2211;
    box-shadow: 1px 1px 0 rgba(0,0,0,0.1);
}
.ce-tag .tag-del { color: #f44; cursor: pointer; font-weight: bold; font-size: 14px; border: none; background: none; padding: 0 2px; }
.ce-tag .tag-del:hover { color: #d32f2f; }

/* Expressions Grid */
.exp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; }
.exp-tile {
    background: #fffdf9; border: 2.5px solid #5c3a21; border-radius: 4px;
    padding: 8px; text-align: center; cursor: pointer; position: relative;
    box-shadow: 1px 1px 0 rgba(0,0,0,0.1);
}
.exp-tile:hover { border-color: #b36629; }
.exp-emoji { font-size: 20px; display: block; margin-bottom: 4px; }
.exp-name { font-size: 12px; color: #3a2211; font-weight: bold; }
.exp-count { font-size: 10px; color: #8b6f47; margin-top: 2px; display: block; }
.exp-thumb { width: 100%; height: 80px; object-fit: cover; background:#fffdf9; border:2px solid #5c3a21; border-radius:4px; margin-top:6px; }

/* Age Stage Grid */
.age-stage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; margin-top: 8px; }
.age-stage-tile {
    background: #fffdf9; border: 2px solid #5c3a21; border-radius: 4px;
    padding: 6px; text-align: center; cursor: pointer; position: relative;
    display: flex; flex-direction: column; align-items: center;
}
.age-stage-thumb {
    width: 100%; height: 70px; object-fit: cover; border-radius: 4px; border: 1.5px solid #5c3a21; background: #e2c0a2;
}
.age-stage-name { font-size: 11px; font-weight: bold; color: #3a2211; margin-top: 4px; text-align: center; width: 100%; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
.age-stage-plus {
    width: 100%; height: 70px; border: 1.5px dashed #5c3a21; border-radius: 4px; display: grid; place-items: center; font-size: 24px; font-weight: bold; color: #5c3a21; background: rgba(0,0,0,0.02);
}
.age-stage-plus:hover { background: rgba(0,0,0,0.05); }

/* Play/Pause controls */
.ce-preview-controls {
    display: flex; gap: 8px; align-items: center; margin-top: 12px;
}
.ce-preview-btn {
    width: 32px; height: 32px; border-radius: 4px; border: 2px solid #5c3a21; background: #b36629; color: #fffdf9;
    font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: inset -1px -1px #5c3a21, inset 1px 1px #f7c86f;
}
.ce-preview-btn:hover { background: #c97b30; }

.ce-portrait-gallery { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; max-height: 200px; overflow-y: auto; padding: 4px 0; }
.ce-portrait-thumb { position: relative; width: 72px; height: 72px; border-radius: 4px; overflow: hidden; border: 2px solid #5c3a21; flex-shrink: 0; cursor: pointer; }
.ce-portrait-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ce-portrait-thumb .ce-pg-del { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; border: none; border-radius: 2px; background: rgba(220,53,69,0.9); color: #fff; cursor: pointer; font-size: 12px; line-height: 1; z-index: 2; }

#ce-avatar-preview-box {
    position: relative;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.1s;
    border: 3px solid #5c3a21 !important;
}
#ce-avatar-preview-box:hover {
    border-color: #b36629 !important;
}
#ce-avatar-preview-box::after {
    content: "Upload";
    position: absolute;
    inset: 0;
    background: rgba(92, 58, 33, 0.75);
    color: #fffdf9;
    font-size: 10px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    pointer-events: none;
}
#ce-avatar-preview-box:hover::after {
    opacity: 1;
}

/* Bright card manager skin */
#uie-card-manager,
#uie-card-editor {
    --accent: #b86f2c;
    background: #fff8ed !important;
    color: #392214 !important;
    border-color: #b97a43 !important;
}
.cm-header,
.ce-header,
.ce-tabs {
    background: #f3d7b5 !important;
    border-color: #b97a43 !important;
    box-shadow: 0 4px 12px rgba(120, 76, 38, 0.18) !important;
}
.cm-title,
.ce-label,
.ce-tab,
.exp-name,
.age-stage-name,
.ccp-name {
    color: #3a2211 !important;
}
.cm-content,
.ce-form,
.ce-preview {
    background: #fff8ed !important;
    color: #392214 !important;
}
.char-card-preview,
.ccp-info,
.ce-input,
.ce-textarea,
.ce-select,
.ce-tag-editor,
.ce-tag,
.exp-tile,
.age-stage-tile,
.ce-portrait-thumb,
.macro-row {
    background: #fffdf7 !important;
    color: #392214 !important;
    border-color: rgba(151, 91, 39, 0.46) !important;
}
.char-card-preview {
    box-shadow: 0 8px 18px rgba(120, 76, 38, 0.18), 0 3px 0 #b97a43 !important;
}
.char-card-preview:hover {
    border-color: #b86f2c !important;
    box-shadow: 0 12px 22px rgba(120, 76, 38, 0.24), 0 3px 0 #b86f2c !important;
}
.ccp-img,
.exp-thumb,
.age-stage-thumb,
.age-stage-plus {
    background: #efd4af !important;
    border-color: rgba(151, 91, 39, 0.46) !important;
    color: #392214 !important;
}
.ccp-role,
.exp-count {
    color: #80512d !important;
}
.ccp-actions {
    background: #f6e2c8 !important;
    border-color: rgba(151, 91, 39, 0.28) !important;
}
.ccp-narrator-btn,
.ccp-game-btn,
.ce-header-btn,
.cm-icon-btn,
.ce-preview-btn {
    background: #c9853d !important;
    border-color: #7a4a20 !important;
    color: #fffdf9 !important;
    box-shadow: inset 0 -2px 0 #7a4a20, inset 1px 1px rgba(255,255,255,0.35) !important;
}
.ccp-narrator-btn:hover,
.ccp-game-btn:hover,
.ce-header-btn:hover,
.cm-icon-btn:hover,
.ce-preview-btn:hover {
    background: #d99647 !important;
    color: #fffdf9 !important;
}
.ce-header-btn-primary,
.ccp-game-btn.active {
    background: #2f8a46 !important;
    border-color: #1e5b2f !important;
    color: #f2fff0 !important;
}
.ce-tab {
    background: #fff4e3 !important;
    border-color: rgba(151, 91, 39, 0.42) !important;
}
.ce-tab:hover,
.ce-tab.active {
    background: #c9853d !important;
    color: #fffdf9 !important;
    border-color: #8c551f !important;
}
.ce-input::placeholder,
.ce-textarea::placeholder {
    color: #8a5b36 !important;
}
#uie-character-generator-modal > div,
#uie-image-gen-modal > div,
#ce-upload-chooser-overlay > div {
    background: #fff8ed !important;
    border-color: rgba(151, 91, 39, 0.46) !important;
    color: #392214 !important;
}
#uie-character-generator-modal h3,
#uie-image-gen-modal h3,
#ce-upload-chooser-overlay h4 {
    color: #3a2211 !important;
}
#uie-char-gen-input,
#uie-char-gen-content,
#uie-img-prompt,
#uie-img-gen-content {
    background: #fffdf7 !important;
    border-color: rgba(151, 91, 39, 0.46) !important;
    color: #392214 !important;
}
#uie-char-gen-generate,
#uie-char-regenerate,
#uie-char-gen-create,
#uie-char-gen-cancel,
#uie-img-generate,
#uie-img-create,
#uie-img-cancel {
    background: #c9853d !important;
    color: #fffdf9 !important;
    border: 1px solid rgba(122, 74, 32, 0.72) !important;
}
#uie-char-gen-generate:hover,
#uie-char-regenerate:hover,
#uie-char-gen-create:hover,
#uie-char-gen-cancel:hover,
#uie-img-generate:hover,
#uie-img-create:hover,
#uie-img-cancel:hover {
    background: #d99647 !important;
    color: #fffdf9 !important;
}
.uie-char-gen-shell {
    width: min(980px, 96vw) !important;
    max-width: 980px !important;
}
.uie-char-gen-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
    gap: 16px;
    align-items: start;
}
.uie-char-gen-preview-card {
    border: 1px solid rgba(151,91,39,.46);
    border-radius: 8px;
    overflow: hidden;
    background: #fffdf7;
    box-shadow: 0 12px 26px rgba(120,76,38,.18);
}
.uie-char-gen-art {
    aspect-ratio: 4 / 5;
    min-height: 260px;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #efd4af, #f8e9d2);
    background-size: cover;
    background-position: center;
    color: rgba(57,34,20,.44);
    font-size: 42px;
}
.uie-char-gen-body { padding: 12px; }
.uie-char-gen-name { font-size: 20px; font-weight: 900; color: #2f1a0e; line-height: 1.1; overflow-wrap: anywhere; }
.uie-char-gen-role { margin-top: 3px; color: #80512d; font-weight: 800; font-size: 12px; }
.uie-char-gen-desc { margin-top: 10px; font-size: 12px; line-height: 1.45; color: #392214; white-space: pre-wrap; }
.uie-char-gen-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.uie-char-gen-chip { border: 1px solid rgba(151,91,39,.3); border-radius: 999px; padding: 4px 7px; background: #f8e9d2; font-size: 10px; font-weight: 900; color: #5c3a21; }
.uie-char-gen-image-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (min-width: 99999px) {
    #uie-character-generator-modal { padding: 8px !important; align-items: stretch !important; }
    .uie-char-gen-shell { max-height: calc(100dvh - 16px) !important; padding: 12px !important; }
    .uie-char-gen-layout { grid-template-columns: 1fr; }
    .uie-char-gen-art { min-height: 220px; }
    .uie-char-gen-image-row { grid-template-columns: 1fr; }
    #uie-character-generator-modal button { min-height: 42px; }
}
`; 

const LOCAL_SERVER_LABELS = {
    ollama: "Ollama",
    lmstudio: "LM Studio",
    llamacpp: "llama.cpp",
    vllm: "vLLM",
    textgenwebui: "Text Generation WebUI",
    kobold: "KoboldCpp",
    tabby: "TabbyAPI"
};

let cardVoiceBridge = null;
let cardVoicePreviewDeck = [];
const CARD_VOICE_PREVIEW_PHRASES = [
    "Hello. This is how I sound when I am speaking normally.",
    "I can soften my tone, pause, and let the moment breathe.",
    "If the scene turns tense, my voice can carry that edge.",
    "One more line, just to check the rhythm and pacing."
];

if (!window.__uieCharacterCardCloseCapture) {
    window.__uieCharacterCardCloseCapture = true;
    document.addEventListener("click", (event) => {
        const closeEditor = event.target?.closest?.("#btn-ce-cancel");
        const closeManager = event.target?.closest?.("#btn-cc-close");
        if (!closeEditor && !closeManager) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        
        // Invoke cleanup if registered on editor element
        const $editor = $("#uie-card-editor");
        if ($editor.length && typeof $editor.data("cleanup") === "function") {
            try { $editor.data("cleanup")(); } catch (_) {}
        }
        
        if (closeEditor) $("#uie-card-editor").remove();
        if (closeManager) $("#uie-card-editor, #uie-card-manager").remove();
    }, true);
}

function cssEscape(value) {
    const str = String(value || "");
    try {
        if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
            return globalThis.CSS.escape(str);
        }
    } catch (_) {}
    return str.replace(/["\\]/g, "\\$&").replace(/\]/g, "\\]");
}

function injectCSS() {
    if ($('#cc-css').length) return;
    $('<style id="cc-css">').text(CSS).appendTo('head');
}

function escHtml(t) {
    return String(t ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escAttr(t) {
    return String(t ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
}

function clampFieldWeight(n) {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return 50;
    return Math.max(0, Math.min(100, x));
}

function parseCardVoiceStudio(recipe = "") {
    const parts = String(recipe || "").trim().split("|");
    if (parts[0] === "kokoro-studio-v1") return {
        engine: "kokoro",
        isStudio: true,
        genderBlend: Number(decodeURIComponent(parts[1] || "0.5")) ?? 0.5,
        vibeBlend: Number(decodeURIComponent(parts[2] || "0.5")) ?? 0.5,
        speed: Number(decodeURIComponent(parts[3] || "1")) || 1,
        pitch: Number(decodeURIComponent(parts[4] || "1")) || 1,
        label: decodeURIComponent(parts[5] || "Kokoro Studio Voice"),
        voice: "af_heart",
        language: "english",
        refAudioUrl: "",
        refText: "",
        fallbackVoice: "alba",
        warmth: 0.5,
        clarity: 0.5
    };
    if (parts[0] === "kokoro-tts-v1") return {
        engine: "kokoro",
        voice: decodeURIComponent(parts[1] || "af_heart"),
        language: decodeURIComponent(parts[2] || "english"),
        speed: Number(decodeURIComponent(parts[3] || "1")) || 1,
        pitch: Number(decodeURIComponent(parts[4] || "1")) || 1,
        label: decodeURIComponent(parts[5] || "Kokoro Voice"),
        refAudioUrl: "",
        refText: "",
        fallbackVoice: "alba",
        warmth: 0.5,
        clarity: 0.5
    };
    if (parts[0] !== "pocket-tts-v1") return { engine: "pocket", refAudioUrl: "", refText: "", label: "Pocket Reference Voice", language: "english", fallbackVoice: "alba", speed: 1, pitch: 1, warmth: 0.5, clarity: 0.5, voice: "af_heart" };
    return {
        engine: "pocket",
        refAudioUrl: decodeURIComponent(parts[1] || ""),
        refText: decodeURIComponent(parts[2] || ""),
        label: decodeURIComponent(parts[3] || "Pocket Reference Voice"),
        language: decodeURIComponent(parts[4] || "english"),
        fallbackVoice: decodeURIComponent(parts[5] || "alba"),
        speed: Number(decodeURIComponent(parts[6] || "1")) || 1,
        pitch: Number(decodeURIComponent(parts[7] || "1")) || 1,
        warmth: Number(decodeURIComponent(parts[8] || "0.5")) || 0.5,
        clarity: Number(decodeURIComponent(parts[9] || "0.5")) || 0.5,
        voice: "af_heart"
    };
}

function savedCardVoiceOptions(selected = "") {
    const s = getSettings();
    const voices = Array.isArray(s.audio?.savedVoices) ? s.audio.savedVoices : [];
    return `<option value="">Saved voices...</option>${voices.map((voice) => {
        const id = escAttr(voice?.id || "");
        const name = escHtml(voice?.name || voice?.id || "Saved Voice");
        const provider = escHtml(voice?.provider || "pocket");
        return `<option value="${id}"${String(selected) === String(voice?.id || "") ? " selected" : ""}>${name} (${provider})</option>`;
    }).join("")}`;
}

function recipeFromSavedVoice(item = {}) {
    const provider = String(item.provider || "pocket").toLowerCase();
    if (provider === "kokoro") {
        if (item.voiceRecipe && item.voiceRecipe.startsWith("kokoro-studio-v1")) {
            return item.voiceRecipe;
        }
        if (item.isStudio || item.genderBlend !== undefined || item.vibeBlend !== undefined) {
            return createKokoroStudioVoiceRecipe({
                genderBlend: item.genderBlend,
                vibeBlend: item.vibeBlend,
                speed: item.speed || 1,
                pitch: item.pitch || 1,
                label: item.name || "Kokoro Studio Voice"
            });
        }
        return createKokoroVoiceRecipe({
            voice: item.voice || "af_heart",
            language: item.language || "english",
            speed: item.speed || 1,
            pitch: item.pitch || 1,
            label: item.name || "Kokoro Voice"
        });
    }
    return createPocketVoiceRecipe({
        refAudioUrl: item.reference || item.referenceAudioUrl || item.reference_audio_url || "",
        refText: item.referenceText || item.refText || item.reference_text || "",
        label: item.name || "Pocket Reference Voice",
        language: item.language || "english",
        fallbackVoice: item.voice || item.fallbackVoice || "alba",
        speed: item.speed || 1,
        pitch: item.pitch || 1,
        warmth: item.warmth ?? 0.5,
        clarity: item.clarity ?? 0.5
    });
}

const CARD_VOICE_PRESETS = {
    narrator: { label: "Pocket narrator reference" },
    conversational: { label: "Pocket conversational reference" },
    energetic: { label: "Pocket energetic reference" },
    quiet: { label: "Pocket quiet reference" }
};

function nextCardVoicePreviewPhrase() {
    return "Hello. This is a clear voice preview for this character.";
}

async function previewCurrentCardVoice() {
    const btn = $("#ce-voice-preview");
    const status = $("#ce-voice-preview-status");
    try {
        if (!cardVoiceBridge) cardVoiceBridge = new VoiceBridge();
        const recipe = String($("#ce-voice-recipe").val() || "").trim();
        const phrase = nextCardVoicePreviewPhrase();
        btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Previewing');
        status.text(`"${phrase}"`);
        const audioBuffer = await cardVoiceBridge.synthesizeVoice(phrase, "preview", {
            voice_recipe: recipe,
            speed: Number($("#ce-voice-speed").val() || 1),
            pitch: Number($("#ce-voice-pitch").val() || 1),
            useFallback: false
        });
        cardVoiceBridge.playVoiceWithEffects(audioBuffer, { volume: 0.95, pitch: Number($("#ce-voice-pitch").val() || 1) });
        status.text(`Playing: "${phrase}"`);
    } catch (error) {
        status.text(String(error?.message || "Voice preview failed."));
    } finally {
        btn.prop("disabled", false).html('<i class="fa-solid fa-ear-listen"></i> Listen');
    }
}

async function previewCardVoiceRecipe(recipe = "", label = "character") {
    try {
        if (!cardVoiceBridge) cardVoiceBridge = new VoiceBridge();
        const audioBuffer = await cardVoiceBridge.synthesizeVoice(`This is ${label}. Here is a quick voice sample.`, "preview", {
            voice_recipe: recipe || createDefaultPocketVoiceRecipe(),
            useFallback: false
        });
        cardVoiceBridge.playVoiceWithEffects(audioBuffer, { volume: 0.95 });
    } catch (error) {
        console.warn("[CharacterCards] Voice sample failed:", error);
    }
}

function randomSemanticVoiceRecipe() {
    return createRandomPocketVoiceRecipe(Math.random());
}

// --- DATA ---
function getCards() {
    const s = getSettings();
    return s.character_cards || []; // Array of Card objects
}

function isCharacterInGame(cardId) {
    const s = getSettings();
    if (!Array.isArray(s.gameCharacters)) return false;
    return s.gameCharacters.includes(cardId);
}

function clampMeter(value, fallback = 50) {
    const n = Number(value);
    return Math.max(0, Math.min(100, Number.isFinite(n) ? n : fallback));
}

function ensureInterruptTracker(card) {
    if (!card.interruptTracker || typeof card.interruptTracker !== "object") card.interruptTracker = {};
    const tracker = card.interruptTracker;
    tracker.hp = clampMeter(tracker.hp, 100);
    tracker.needs = clampMeter(tracker.needs, Math.max(0, ...(card.needsList || []).map((x) => Number(x?.weight || 0)), 35));
    tracker.wants = clampMeter(tracker.wants, Math.max(0, ...(card.wantsList || []).map((x) => Number(x?.weight || 0)), 25));
    tracker.desires = clampMeter(tracker.desires, card.desires ? 40 : 15);
    return tracker;
}

function renderInterruptMeters(card, enabled) {
    return "";
}

function saveCard(card) {
    const s = getSettings();
    if (!s.character_cards) s.character_cards = [];
    const idx = s.character_cards.findIndex(c => c.id === card.id);
    if (idx >= 0) s.character_cards[idx] = card;
    else s.character_cards.push(card);
    saveSettings();
    if (typeof window.applyCustomCssSettings === "function") {
        window.applyCustomCssSettings();
    }
}

function ensureOmniscientBucket(s) {
    if (!s.omniscient || typeof s.omniscient !== "object") s.omniscient = {};
    if (typeof s.omniscient.narratorCharacterCardId !== "string") s.omniscient.narratorCharacterCardId = "";
}

function getNarratorCharacterCardId() {
    const s = getSettings();
    ensureOmniscientBucket(s);
    return String(s.omniscient.narratorCharacterCardId || "").trim();
}

function setNarratorCharacterCardId(cardId) {
    const s = getSettings();
    ensureOmniscientBucket(s);
    s.omniscient.narratorCharacterCardId = String(cardId || "").trim();
    saveSettings();
}

function toggleNarratorForCardId(cardId) {
    const id = String(cardId || "").trim();
    if (!id) return;
    const cur = getNarratorCharacterCardId();
    if (cur === id) {
        setNarratorCharacterCardId("");
        return "default";
    }
    setNarratorCharacterCardId(id);
    return "set";
}

function toastNarrator(msg) {
    try {
        if (typeof window.showToast === "function") window.showToast(msg);
        else alert(msg);
    } catch (_) {
        try { alert(msg); } catch (_) {}
    }
}

function ensureExpressions(card) {
    if (!Array.isArray(card.expressions)) card.expressions = [];
    card.expressions = card.expressions.map((e) => ({
        name: String(e?.name || "neutral"),
        emoji: String(e?.emoji || "😐"),
        intensity: Number(e?.intensity || 1),
        sprites: Array.isArray(e?.sprites) ? e.sprites.map((s) => ({
            name: String(s?.name || "sprite"),
            src: String(s?.src || "")
        })).filter(s => s.src) : []
    }));
}

function ensureCharacterInventory(card) {
    if (!card || typeof card !== "object") return null;
    if (!card.inventory || typeof card.inventory !== "object") card.inventory = {};
    const inv = card.inventory;
    if (!Array.isArray(inv.items)) inv.items = [];
    if (!Array.isArray(inv.equipment)) inv.equipment = [];
    if (!Array.isArray(inv.equipped)) inv.equipped = [];
    if (!Array.isArray(inv.outfits)) inv.outfits = [];
    const styleText = String(card.style || card.appearance || card.description || "").trim();
    if (styleText && !inv.appearanceStyle) inv.appearanceStyle = styleText;
    if (styleText && !inv.outfits.length) {
        inv.outfits.push({
            id: `card_outfit_${String(card.id || card.name || "character").replace(/[^a-z0-9_-]+/gi, "_")}`,
            name: "Default Look",
            type: "clothing",
            slotId: "outfit",
            equipmentKind: "outfit",
            description: styleText,
            source: "character_card_appearance"
        });
    }
    return inv;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

async function ensureJsZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load JSZip"));
        document.head.appendChild(s);
    });
    if (!window.JSZip) throw new Error("JSZip not available");
    return window.JSZip;
}

function normalizeExpressionName(raw) {
    const inName = String(raw || "").trim().toLowerCase();
    if (!inName) return "neutral";
    return inName.split(/[._-]/)[0] || "neutral";
}

function upsertExpression(card, name) {
    ensureExpressions(card);
    const n = normalizeExpressionName(name);
    let exp = card.expressions.find((e) => normalizeExpressionName(e.name) === n);
    if (!exp) {
        exp = { name: n, emoji: "😐", intensity: 1, sprites: [] };
        card.expressions.push(exp);
    }
    if (!Array.isArray(exp.sprites)) exp.sprites = [];
    return exp;
}

function createUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function downloadJsonFile(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function normalizeImportToCardArray(parsed) {
    if (!parsed || typeof parsed !== "object") return [];
    if (parsed.kind === "uie.character_card" && parsed.card && typeof parsed.card === "object") {
        return [parsed.card];
    }
    if (parsed.kind === "uie.character_cards_bundle" && Array.isArray(parsed.cards)) {
        return parsed.cards.filter((c) => c && typeof c === "object");
    }
    if (Array.isArray(parsed)) {
        return parsed.filter((c) => c && typeof c === "object");
    }
    if (Array.isArray(parsed.cards)) {
        return parsed.cards.filter((c) => c && typeof c === "object");
    }
    if (parsed.name || parsed.char_name) return [parsed];
    const d0 = parsed.data && typeof parsed.data === "object" ? parsed.data : null;
    if (d0 && String(d0.name || d0.char_name || "").trim()) return [parsed];
    return [];
}

/** Character Card / v2 PNG JSON use `description` (often under `data`); stored as `bio`. */
function getImportedDescriptionText(obj) {
    if (!obj || typeof obj !== "object") return "";
    const data = obj.data && typeof obj.data === "object" ? obj.data : null;
    const top = String(obj.description ?? "").trim();
    if (top) return top;
    if (data) {
        const inner = String(
            data.description ?? data.char_description ?? ""
        ).trim();
        if (inner) return inner;
    }
    return "";
}

function smartParseCharacterDescription(card) {
    if (!card || typeof card !== "object") return;
    const data = card.data && typeof card.data === "object" ? card.data : card;
    
    // Core SillyTavern properties
    let descText = String(data.description || data.char_description || card.description || "").trim();
    let personalityText = String(data.personality || card.personality || "").trim();
    let systemPromptText = String(data.system_prompt || card.system_prompt || data.post_history_instructions || "").trim();
    
    // Initialize target fields if not present
    if (!card.traits) card.traits = "";
    if (!card.rules) card.rules = "";
    if (!card.bio) card.bio = "";
    if (!card.style) card.style = "";
    if (!card.stats || typeof card.stats !== "object") card.stats = {};
    if (!Array.isArray(card.skills)) card.skills = [];
    if (!Array.isArray(card.lore_entries)) card.lore_entries = [];
    
    // 1. Map basic fields directly if card's target fields are empty
    if (!card.traits && personalityText) card.traits = personalityText;
    if (!card.rules && systemPromptText) card.rules = systemPromptText;
    
    // 2. Section Parsing of description text
    if (descText) {
        const headerRegex = /(?:^|\n)(?:\s*(?:###?|##?|#)\s*([^\n]+)|\s*\[\s*([^\]]+)\s*\]|\s*\*\*\s*([^\*]+)\s*\*\*|\s*([A-Za-z\s]+)\s*:)(?=\n|$)/g;
        
        let lastIndex = 0;
        let currentSectionType = "bio";
        let match;
        
        const sections = [];
        
        while ((match = headerRegex.exec(descText)) !== null) {
            const sectionContent = descText.substring(lastIndex, match.index).trim();
            if (sectionContent) {
                sections.push({ type: currentSectionType, content: sectionContent });
            }
            
            const headerTitle = (match[1] || match[2] || match[3] || match[4] || "").trim().toLowerCase();
            if (headerTitle.match(/appearance|style|look|wear|clothe|attire|features|eyes|hair/)) {
                currentSectionType = "style";
            } else if (headerTitle.match(/personality|trait|behavior|like|dislike/)) {
                currentSectionType = "traits";
            } else if (headerTitle.match(/bio|background|history|backstory|story/)) {
                currentSectionType = "bio";
            } else if (headerTitle.match(/rule|prompt|instruction|system/)) {
                currentSectionType = "rules";
            } else if (headerTitle.match(/stat|level|hp|mp|power/)) {
                currentSectionType = "stats";
            } else if (headerTitle.match(/skill|ability|magic|spell/)) {
                currentSectionType = "skills";
            } else if (headerTitle.match(/lore|world|universe|history/)) {
                currentSectionType = "lore";
            } else {
                currentSectionType = "bio";
            }
            
            lastIndex = headerRegex.lastIndex;
        }
        
        const lastContent = descText.substring(lastIndex).trim();
        if (lastContent) {
            sections.push({ type: currentSectionType, content: lastContent });
        }
        
        if (sections.length > 1) {
            sections.forEach(sec => {
                if (sec.type === "style") {
                    card.style = (card.style ? card.style + "\n" : "") + sec.content;
                } else if (sec.type === "traits") {
                    card.traits = (card.traits ? card.traits + "\n" : "") + sec.content;
                } else if (sec.type === "bio") {
                    card.bio = (card.bio ? card.bio + "\n" : "") + sec.content;
                } else if (sec.type === "rules") {
                    card.rules = (card.rules ? card.rules + "\n" : "") + sec.content;
                } else if (sec.type === "stats") {
                    sec.content.split("\n").forEach(line => {
                        const m = line.match(/([A-Za-z0-9_\s]+)\s*[:=]\s*(\d+)/);
                        if (m) {
                            const k = m[1].trim().toLowerCase();
                            card.stats[k] = Number(m[2]);
                        }
                    });
                } else if (sec.type === "skills") {
                    sec.content.split("\n").forEach(line => {
                        const clean = line.replace(/^[\s\-\*\d\.\)]+/, "").trim();
                        if (clean && !card.skills.includes(clean)) card.skills.push(clean);
                    });
                } else if (sec.type === "lore") {
                    sec.content.split("\n\n").forEach(para => {
                        const clean = para.trim();
                        if (clean && !card.lore_entries.includes(clean)) card.lore_entries.push(clean);
                    });
                }
            });
        } else {
            if (!card.bio) card.bio = descText;
            if (!card.style) card.style = descText;
        }
    }
}

function normalizeImportedCharacterCardShape(card) {
    if (!card || typeof card !== "object") return;
    const data = card.data && typeof card.data === "object" ? card.data : null;
    if (data && !String(card.name || "").trim()) {
        const n = String(data.name || data.char_name || "").trim();
        if (n) card.name = n;
    }
    smartParseCharacterDescription(card);
}

function assignFreshCardIds(importedList) {
    const s = getSettings();
    const used = new Set((s.character_cards || []).map((c) => String(c?.id || "")));
    return importedList.map((raw) => {
        const c = JSON.parse(JSON.stringify(raw));
        normalizeImportedCharacterCardShape(c);
        let id = String(c.id || "").trim();
        if (!id || used.has(id)) id = createUUID();
        used.add(id);
        c.id = id;
        return c;
    });
}

function cardPayloadForExport(card) {
    if (!card || typeof card !== "object") return {};
    const o = JSON.parse(JSON.stringify(card));
    return o;
}

const DEFAULT_EXPRESSIONS = [
    "admiration","amusement","anger","annoyance","approval","caring","confusion","curiosity",
    "desire","disappointment","disapproval","disgust","embarrassment","excitement","fear","gratitude",
    "grief","joy","love","nervousness","optimism","pride","realization","relief","remorse","sadness",
    "surprise","neutral","serious","shy","determined","smug","flirty","tired"
];

function parsePrefs(raw) {
    if (Array.isArray(raw)) return raw;
    const txt = String(raw || "").trim();
    if (!txt) return [];
    const out = [];
    for (const part of txt.split(",")) {
        const p = String(part || "").trim();
        if (!p) continue;
        const m = p.match(/^(.+?)\s*\(\s*(\d+)\s*\)\s*$/);
        if (m) out.push({ text: m[1].trim(), weight: clampFieldWeight(m[2]) });
        else out.push({ text: p, weight: 50 });
    }
    return out;
}

function ensurePreferenceLists(card) {
    if (!Array.isArray(card.likesList)) card.likesList = parsePrefs(card.likes);
    if (!Array.isArray(card.dislikesList)) card.dislikesList = parsePrefs(card.dislikes);
    if (!Array.isArray(card.needsList)) card.needsList = parsePrefs(card.needs);
    if (!Array.isArray(card.wantsList)) card.wantsList = parsePrefs(card.wants);
    const norm = (x) => ({ text: String(x?.text || ""), weight: Number.isFinite(Number(x?.weight)) ? Number(x.weight) : 50 });
    card.likesList = card.likesList.map(norm).filter((x) => x.text);
    card.dislikesList = card.dislikesList.map(norm).filter((x) => x.text);
    card.needsList = card.needsList.map(norm).filter((x) => x.text);
    card.wantsList = card.wantsList.map(norm).filter((x) => x.text);
    if (!Number.isFinite(Number(card.age)) && card.age !== "") card.age = "";
    if (typeof card.ageStage !== "string" || !card.ageStage) card.ageStage = "adult";
    if (typeof card.gender !== "string") card.gender = String(card.sex || "");
    if (typeof card.phoneNumber !== "string") card.phoneNumber = String(card.phone || "");
    if (!Array.isArray(card.factions)) card.factions = String(card.factions || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (typeof card.standings !== "string") card.standings = String(card.standing || "");
}

function serializePrefs(list) {
    return (Array.isArray(list) ? list : []).map((x) => `${x.text} (${x.weight})`).join(", ");
}

// --- RENDERERS ---

export function renderCardManager() {
    injectCSS();
    $("#uie-card-editor").remove();
    $("#uie-card-manager").remove();
    const cards = getCards();
    const narrId = getNarratorCharacterCardId();

    const html = `
    <div id="uie-card-manager" class="uie-window">
        <div class="cm-header">
            <div class="cm-title"><i class="fa-solid fa-address-card" aria-hidden="true"></i><span>Character Cards</span></div>
            <div class="cm-toolbar">
                <button type="button" class="cm-icon-btn" id="btn-cc-generate" title="Generate character with AI" aria-label="Generate character with AI"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i></button>
                <button type="button" class="cm-icon-btn" id="btn-cc-import" title="Import card JSON (file)" aria-label="Import card JSON"><i class="fa-solid fa-file-import" aria-hidden="true"></i></button>
                <button type="button" class="cm-icon-btn" id="btn-cc-export-all" title="Export all cards JSON" aria-label="Export all cards JSON"><i class="fa-solid fa-file-export" aria-hidden="true"></i></button>
                <input type="file" id="cc-import-file" accept=".json,application/json" style="display:none" />
                <button type="button" id="btn-cc-new" class="cm-action-btn is-primary"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>New Card</span></button>
                <button type="button" id="btn-cc-close" class="cm-icon-btn is-danger" title="Close character cards" aria-label="Close character cards"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
        </div>
        <div class="cm-content" id="cc-list">
            ${cards.map((c) => {
                const cidAttr = escAttr(c.id);
                const isNarr = narrId && String(c.id) === narrId;
                const isInGame = isCharacterInGame(c.id);
                return `
                <div class="char-card-preview${isNarr ? " is-narrator" : ""}" data-id="${cidAttr}">
                    <div class="ccp-img"><i class="fa-solid fa-user-astronaut ccp-fallback-icon" aria-hidden="true"></i></div>
                    <div class="ccp-actions">
                        <button type="button" class="ccp-game-btn${isInGame ? " active" : ""}" data-game-for="${cidAttr}" aria-pressed="${isInGame ? "true" : "false"}" title="Add this character to the current game"><i class="fa-solid fa-users" aria-hidden="true"></i><span>${isInGame ? "In Game" : "Add"}</span></button>
                        <button type="button" class="ccp-narrator-btn${isNarr ? " active" : ""}" data-narrator-for="${cidAttr}" aria-pressed="${isNarr ? "true" : "false"}" title="Use this card as omniscient narrator (bio). Tap again for default."><i class="fa-solid fa-book-open-reader" aria-hidden="true"></i><span>Narrator</span></button>
                    </div>
                    <div class="ccp-info">
                        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                            <div class="ccp-name" style="flex:1;min-width:0;">${escHtml(c.name || "Unnamed")}</div>
                            <button type="button" class="ccp-listen-btn" data-listen-for="${cidAttr}" title="Listen" aria-label="Listen to ${escAttr(c.name || "character")}"><i class="fa-solid fa-ear-listen" aria-hidden="true"></i></button>
                        </div>
                        <div class="ccp-role">${escHtml(c.role || "Unknown")}</div>
                        ${renderInterruptMeters(c, isInGame)}
                    </div>
                </div>
            `;
            }).join("")}
        </div>
    </div>
    `;

    $("body").append(html);

    $("#cc-list .char-card-preview").each(function () {
        const id = String($(this).data("id") || "").trim();
        const c = cards.find((x) => String(x?.id || "") === id);
        const av = String(c?.avatar || "").trim();
        if (av && !/^none$/i.test(av)) {
            try {
                const scale = c?.avatarScale || 100;
                const x = c?.avatarX || 0;
                const y = c?.avatarY || 0;
                $(this).find(".ccp-img").addClass("has-portrait").css({
                    "background-image": `url(${JSON.stringify(av)})`,
                    "background-repeat": "no-repeat",
                    "background-size": `${scale}%`,
                    "background-position": `calc(50% + ${x}%) calc(50% + ${y}%)`
                });
            } catch (_) {}
        }
    });

    $("#cc-list").on("click", ".ccp-narrator-btn", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).data("narrator-for") || "").trim();
        const nm = cards.find((x) => String(x?.id || "") === id);
        const r = toggleNarratorForCardId(id);
        if (r === "default") toastNarrator("Narrator: default omniscient voice.");
        else toastNarrator(`Narrator: ${String(nm?.name || "Card")} (bio as world layer).`);
        renderCardManager();
    });

    $("#cc-list").on("click", ".ccp-listen-btn", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).data("listen-for") || "").trim();
        const card = cards.find((x) => String(x?.id || "") === id);
        const recipe = String(card?.voice_recipe || card?.voiceRecipe || card?.tts?.voice_recipe || "").trim();
        void previewCardVoiceRecipe(recipe, String(card?.name || "this character"));
    });

    $(document).off("click.uieCardManagerClose", "#btn-cc-close")
        .on("click.uieCardManagerClose", "#btn-cc-close", function (e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-card-editor, #uie-card-manager").remove();
        });

    $("#btn-cc-generate").on("click", () => showCharacterGeneratorModal());

    $("#btn-cc-import").on("click", () => $("#cc-import-file").trigger("click"));
    $("#btn-cc-export-all").on("click", () => {
        const all = getCards();
        downloadJsonFile(`character-cards-${Date.now()}.json`, {
            kind: "uie.character_cards_bundle",
            version: 1,
            exportedAt: Date.now(),
            cards: all.map((c) => cardPayloadForExport(c))
        });
    });
    $("#cc-import-file").on("change", function () {
        const f = this.files && this.files[0];
        this.value = "";
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || "null"));
                const rawList = normalizeImportToCardArray(parsed);
                if (!rawList.length) {
                    alert("No character cards found in file.");
                    return;
                }
                const withIds = assignFreshCardIds(rawList);
                withIds.forEach((c) => saveCard(c));
                renderCardManager();
                alert(`Imported ${withIds.length} card(s).`);
            } catch (e) {
                alert("Failed to import file: " + String(e?.message || e));
            }
        };
        reader.readAsText(f);
    });

    // Game inclusion handlers
    $("#cc-list").on("click", ".ccp-game-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const cardId = String($(this).data("game-for") || "").trim();
        if (!cardId) return;
        
        const s = getSettings();
        if (!s.gameCharacters) s.gameCharacters = [];
        
        const index = s.gameCharacters.indexOf(cardId);
        if (index >= 0) {
            // Remove from game
            s.gameCharacters.splice(index, 1);
            $(this).removeClass("active").text("Add to Game");
        } else {
            // Add to game
            s.gameCharacters.push(cardId);
            const trackedCard = cards.find((x) => String(x?.id || "") === cardId);
            if (trackedCard) {
                ensureInterruptTracker(trackedCard);
                ensureCharacterInventory(trackedCard);
                saveCard(trackedCard);
            }
            $(this).addClass("active").text("In Game ✓");
        }
        
        const card = cards.find((x) => String(x?.id || "") === cardId);
        if (card) {
            if (!Array.isArray(s.sceneCharacters)) s.sceneCharacters = [];
            const exists = s.sceneCharacters.some((x) => String(x?.cardId || x?.id || "") === cardId);
            if (index < 0 && !exists) {
                s.sceneCharacters.push({
                    id: cardId,
                    cardId,
                    name: String(card.name || "Unnamed"),
                    role: String(card.role || ""),
                    avatar: String(card.avatar || ""),
                    inventory: ensureCharacterInventory(card) || { items: [], equipment: [], equipped: [], outfits: [] },
                    source: "character_cards"
                });
            } else if (index >= 0) {
                s.sceneCharacters = s.sceneCharacters.filter((x) => String(x?.cardId || x?.id || "") !== cardId);
            }
        }
        saveSettings();
        renderCardManager();
        return;

        // Update other buttons for the same card
        $(`.ccp-game-btn[data-game-for="${cssEscape(cardId)}"]`).each(function() {
            if (index >= 0) {
                $(this).removeClass("active").text("Add to Game");
            } else {
                $(this).addClass("active").text("In Game ✓");
            }
        });
    });

    $("#btn-cc-new").on("click", () => {
        const newCard = {
            id: createUUID(),
            name: "New Character",
            role: "Protagonist",
            expressions: [],
            portrait_gallery: []
        };
        renderCardEditor(newCard);
    });

    $(document).off("click.uieCardPreview", "#uie-card-manager .char-card-preview")
        .on("click.uieCardPreview", "#uie-card-manager .char-card-preview", function (e) {
            if ($(e.target).closest(".ccp-narrator-btn, .ccp-game-btn, .ccp-listen-btn").length) return;
            e.preventDefault();
            e.stopPropagation();
            const id = String($(this).data("id") || "").trim();
            const card = getCards().find((c) => String(c?.id || "") === id);
            if (card) renderCardEditor(card);
        });
}

function renderCardEditor(card) {
    $("#uie-card-editor").remove();
    // Clone to avoid direct mutation until save
    let editCard = JSON.parse(JSON.stringify(card));
    ensurePreferenceLists(editCard);
    const narrOn = getNarratorCharacterCardId() === String(editCard.id || "").trim();
    const genderValue = String(editCard.gender || editCard.sex || "").trim();
    const genderPreset = /^(man|woman)$/i.test(genderValue) ? genderValue.replace(/^./, (c) => c.toUpperCase()) : (genderValue ? "Custom" : "");
    const genderCustom = genderPreset === "Custom" ? genderValue : "";
    const voiceRecipe = String(editCard.voice_recipe || editCard.voiceRecipe || editCard.tts?.voice_recipe || "").trim();
    const voiceStudio = parseCardVoiceStudio(voiceRecipe);

    const html = `
    <div id="uie-card-editor" class="uie-window">
        <div class="ce-header">
            <div class="cm-title">EDIT: ${escHtml(editCard.name || "Character")}</div>
            <div class="ce-header-actions">
                <button type="button" id="btn-ce-import" class="ce-header-btn" title="Import JSON into this card"><i class="fa-solid fa-file-import"></i> Import</button>
                <button type="button" id="btn-ce-export" class="ce-header-btn" title="Export this card as JSON"><i class="fa-solid fa-file-export"></i> Export</button>
                <input type="file" id="ce-import-file" accept=".json,application/json" style="display:none" />
                <div class="ce-dropdown" style="position:relative; display:inline-block;">
                <button type="button" id="btn-ce-genimg" class="ce-header-btn" title="AI generate card art" aria-label="AI generate card art"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Gen</button>
                    <div id="ce-genimg-dropdown" style="display:none; position:absolute; right:0; top:45px; background:#fcf5eb; border:2.5px solid #5c3a21; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:2147483647; min-width:200px;">
                        <div class="ce-dropdown-item" id="ce-dropdown-gen-avatar" style="padding:10px 14px; cursor:pointer; font-weight:bold; font-size:12px; border-bottom:1.5px solid #5c3a21;">Generate Avatar / Photo</div>
                        <div class="ce-dropdown-item" id="ce-dropdown-gen-gallery" style="padding:10px 14px; cursor:pointer; font-weight:bold; font-size:12px;">Generate Gallery Image</div>
                    </div>
                </div>
                <button type="button" id="btn-ce-save" class="ce-header-btn ce-header-btn-primary" title="Save card" aria-label="Save card"><i class="fa-solid fa-floppy-disk"></i> Save</button>
                <button type="button" id="btn-ce-cancel" class="ce-header-btn" style="background:#dc3545; border-color:#bd2130;" aria-label="Close character card editor"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="ce-tabs">
            <div class="ce-tab active" data-tab="profile">Profile</div>
            <div class="ce-tab" data-tab="gallery">Gallery</div>
            <div class="ce-tab" data-tab="expressions">Expressions</div>
            <div class="ce-tab" data-tab="drives">Drives & Organizations</div>
            <div class="ce-tab" data-tab="voice">Voice Studio</div>

            <div class="ce-tab" data-tab="rules">Chat Rules</div>
        </div>
        
        <div class="ce-body">
            <div class="ce-form">
                
                <!-- PROFILE TAB -->
                <div class="ce-section active" id="tab-profile">
                    <div class="ce-group">
                        <label class="ce-label">Character Name</label>
                        <input type="text" class="ce-input" id="ce-name" value="${escAttr(editCard.name || "")}" placeholder="e.g. Alyx Shirakawa">
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Avatar Image</label>
                        <div style="display:flex; gap:15px; align-items:center; margin-top:5px;">
                            <div id="ce-avatar-preview-box" style="width: 96px; height: 96px; border-radius: 4px; background: #e2c0a2; flex-shrink: 0; background-repeat: no-repeat; background-size: cover; background-position: center; ${editCard.avatar && !/^none$/i.test(editCard.avatar) ? `background-image: url(${JSON.stringify(editCard.avatar)});` : ''}"></div>
                            <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                                <input type="text" class="ce-input" id="ce-avatar" value="${escAttr(editCard.avatar || "")}" placeholder="https://example.com/image.png">
                                <div style="display:flex; gap:10px;">
                                    <input type="file" id="ce-avatar-file" accept="image/*" style="display:none;">
                                    <button type="button" id="ce-avatar-file-btn" class="ce-header-btn" style="padding:6px 12px; font-size:12px;">Choose File</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Role / Archetype</label>
                        <input type="text" class="ce-input" id="ce-role" value="${escAttr(editCard.role || "")}">
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Gender</label>
                        <div style="display:grid; grid-template-columns:160px 1fr; gap:8px;">
                            <select class="ce-select" id="ce-gender">
                                <option value=""${genderPreset === "" ? " selected" : ""}></option>
                                <option value="Man"${genderPreset === "Man" ? " selected" : ""}>Man</option>
                                <option value="Woman"${genderPreset === "Woman" ? " selected" : ""}>Woman</option>
                                <option value="Custom"${genderPreset === "Custom" ? " selected" : ""}>Custom</option>
                            </select>
                            <input type="text" class="ce-input" id="ce-gender-custom" value="${escAttr(genderCustom)}" placeholder="Custom gender" ${genderPreset === "Custom" ? "" : "hidden"}>
                        </div>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Age / Stage / Phone</label>
                        <div style="display:grid; grid-template-columns:110px 1.2fr 1fr; gap:8px;">
                            <input type="number" class="ce-input" id="ce-age" value="${escAttr(editCard.age ?? "")}" placeholder="Age">
                            <select class="ce-select" id="ce-age-stage">
                                <option value="baby_toddler">Baby / Toddler</option>
                                <option value="child">Child</option>
                                <option value="teen">Teen</option>
                                <option value="young_adult">Young Adult</option>
                                <option value="adult">Adult</option>
                                <option value="elder">Old / Elder</option>
                            </select>
                            <input type="text" class="ce-input" id="ce-phone-number" value="${escAttr(editCard.phoneNumber || editCard.phone || "")}" placeholder="555-0123-4567">
                        </div>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">API Profile for this character</label>
                        <select class="ce-select" id="ce-char-api-profile"></select>
                        <p style="color:#8b6f47;font-size:11px;margin:6px 0 0;font-style:italic;">Select a saved API profile from Settings, or use global default.</p>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Provider (if not using profile)</label>
                        <select class="ce-select" id="ce-char-api-provider">
                            <option value="">Use profile or global default</option>
                            <option value="openrouter">OpenRouter</option>
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="google">Google AI</option>
                            <option value="cohere">Cohere</option>
                            <option value="groq">Groq</option>
                            <option value="together">Together AI</option>
                            <option value="deepseek">DeepSeek</option>
                            <option value="custom">Custom endpoint</option>
                        </select>
                    </div>
                    <div class="ce-group" id="ce-char-api-builtin-extra" style="display:none;">
                        <label class="ce-label">Model id (optional — overrides default for this server)</label>
                        <input type="text" class="ce-input" id="ce-char-api-builtin-model" value="${escAttr(editCard.char_api_builtin_model || "")}" placeholder="e.g. llama3.1:8b">
                        <label class="ce-label" style="margin-top:10px;">API key (only if this server requires one)</label>
                        <input type="password" class="ce-input" id="ce-char-api-builtin-key" value="${escAttr(editCard.char_api_builtin_key || "")}">
                    </div>
                    <div class="ce-group" id="ce-char-api-custom-fields" style="display:none;">
                        <label class="ce-label">Base URL (OpenAI-compatible)</label>
                        <input type="text" class="ce-input" id="ce-char-api-url" value="${escAttr((editCard.char_api_custom && editCard.char_api_custom.url) || "")}" placeholder="http://127.0.0.1:11434/v1">
                        <label class="ce-label" style="margin-top:10px;">API key</label>
                        <input type="password" class="ce-input" id="ce-char-api-key" value="${escAttr((editCard.char_api_custom && editCard.char_api_custom.key) || "")}">
                        <label class="ce-label" style="margin-top:10px;">Model id</label>
                        <input type="text" class="ce-input" id="ce-char-api-model" value="${escAttr((editCard.char_api_custom && editCard.char_api_custom.model) || "")}">
                        <label class="ce-label" style="margin-top:10px;">Endpoint shape</label>
                        <select class="ce-select" id="ce-char-api-endpoint">
                            <option value="openai_chat">openai_chat</option>
                            <option value="auto">auto</option>
                            <option value="anthropic_messages">anthropic_messages</option>
                        </select>
                    </div>
                    <div class="ce-group" id="ce-voice-studio" style="border:2px solid #5c3a21; border-radius:4px; padding:12px; background:rgba(0,0,0,0.025);">
                        <label class="ce-label">Voice Studio</label>
                        <input type="hidden" id="ce-voice-recipe" value="${escAttr(voiceRecipe || createPocketVoiceRecipe(voiceStudio))}">
                        <div class="ce-voice-semantic-grid">
                            <div class="ce-voice-slider" style="margin-top:8px;">
                                <label class="ce-label">Voice Utility</label>
                                <select class="ce-select ce-voice-field" id="ce-voice-provider">
                                    <option value="pocket"${voiceStudio.engine !== "kokoro" ? " selected" : ""}>Pocket-TTS</option>
                                    <option value="kokoro"${voiceStudio.engine === "kokoro" ? " selected" : ""}>Kokoro</option>
                                </select>
                            </div>
                            <div class="ce-voice-slider ce-pocket-panel" style="margin-top:8px;">
                                <label class="ce-label">Saved Voice</label>
                                <select class="ce-select" id="ce-saved-voice">${savedCardVoiceOptions("")}</select>
                            </div>
                        </div>
                        <div class="ce-voice-slider ce-pocket-panel" style="margin-top:8px;">
                            <label class="ce-label">Pocket TTS Reference Label</label>
                            <input class="ce-input ce-voice-field" id="ce-f5-label" value="${escAttr(voiceStudio.label)}" placeholder="Pocket Reference Voice">
                        </div>
                        <div class="ce-voice-slider ce-pocket-panel" style="margin-top:8px;">
                            <label class="ce-label">Pocket-TTS Preset</label>
                            <select class="ce-select" id="ce-voice-preset">
                                <option value="">Custom reference</option>
                                ${Object.entries(CARD_VOICE_PRESETS).map(([key, preset]) => `<option value="${escAttr(key)}">${escHtml(preset.label)}</option>`).join("")}
                            </select>
                        </div>
                        <div class="ce-voice-semantic-grid ce-pocket-panel">
                            <div class="ce-voice-slider ce-pocket-panel">
                                <label class="ce-label">Reference Audio</label>
                                <input class="ce-voice-field" id="ce-f5-reference" type="hidden" value="${escAttr(voiceStudio.refAudioUrl)}">
                                <input class="ce-input" id="ce-f5-reference-file" type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg,audio/mp3">
                                <p id="ce-f5-reference-label" style="color:#8b6f47;font-size:11px;margin:6px 0 0;font-style:italic;">${voiceStudio.refAudioUrl ? "Reference audio selected." : "No reference audio selected."}</p>
                            </div>
                            <div class="ce-voice-slider ce-kokoro-panel">
                                <label class="ce-label">Reference Transcript</label>
                                <input class="ce-input ce-voice-field" id="ce-f5-ref-text" value="${escAttr(voiceStudio.refText)}" placeholder="Exact words spoken in the reference audio">
                            </div>
                        </div>
                        <div class="ce-voice-semantic-grid" style="margin-top:8px;">
                            <div class="ce-voice-slider ce-pocket-panel">
                                <label class="ce-label">Pocket Fallback Voice</label>
                                <select class="ce-select ce-voice-field" id="ce-pocket-fallback-voice">
                                    ${POCKET_PRESET_VOICES.map((voice) => `<option value="${escAttr(voice)}"${voice === voiceStudio.fallbackVoice ? " selected" : ""}>${escHtml(voice)}</option>`).join("")}
                                </select>
                            </div>
                            <div class="ce-voice-slider ce-kokoro-panel">
                                <label class="ce-label">Kokoro Voice</label>
                                <select class="ce-select ce-voice-field" id="ce-kokoro-voice">
                                    <option value="custom"${voiceStudio.isStudio ? " selected" : ""}>Custom Blend (Studio)</option>
                                    ${KOKORO_PRESET_VOICES.map((voice) => `<option value="${escAttr(voice)}"${!voiceStudio.isStudio && voice === voiceStudio.voice ? " selected" : ""}>${escHtml(voice)}</option>`).join("")}
                                </select>
                            </div>
                            <div class="ce-voice-slider ce-kokoro-panel">
                                <label class="ce-label">Kokoro / WASM Language</label>
                                <select class="ce-select ce-voice-field" id="ce-kokoro-language">
                                    ${KOKORO_LANGUAGE_OPTIONS.map((lang) => `<option value="${escAttr(lang.value)}"${lang.value === voiceStudio.language ? " selected" : ""}>${escHtml(lang.label)}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="ce-voice-semantic-grid ce-kokoro-panel" style="margin-top:8px;">
                            <div>
                                <label class="ce-label">Gender (Masc vs Fem)</label>
                                <input class="ce-input ce-voice-field" id="ce-voice-gender-blend" type="range" min="0" max="1" step="0.01" value="${escAttr(voiceStudio.genderBlend ?? 0.5)}">
                            </div>
                            <div>
                                <label class="ce-label">Vibe (Calm vs Energetic)</label>
                                <input class="ce-input ce-voice-field" id="ce-voice-vibe-blend" type="range" min="0" max="1" step="0.01" value="${escAttr(voiceStudio.vibeBlend ?? 0.5)}">
                            </div>
                        </div>
                        <div class="ce-voice-semantic-grid" style="margin-top:8px;">
                            <div><label class="ce-label">Pitch</label><input class="ce-input ce-voice-field" id="ce-voice-pitch" type="range" min="0.75" max="1.35" step="0.01" value="${escAttr(voiceStudio.pitch || 1)}"></div>
                            <div><label class="ce-label">Speed</label><input class="ce-input ce-voice-field" id="ce-voice-speed" type="range" min="0.7" max="1.4" step="0.01" value="${escAttr(voiceStudio.speed || 1)}"></div>
                            <div class="ce-pocket-panel"><label class="ce-label">Warmth</label><input class="ce-input ce-voice-field" id="ce-voice-warmth" type="range" min="0" max="1" step="0.01" value="${escAttr(voiceStudio.warmth ?? 0.5)}"></div>
                            <div class="ce-pocket-panel"><label class="ce-label">Clarity</label><input class="ce-input ce-voice-field" id="ce-voice-clarity" type="range" min="0" max="1" step="0.01" value="${escAttr(voiceStudio.clarity ?? 0.5)}"></div>
                        </div>
                        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px;">
                            <button type="button" class="ce-header-btn" id="ce-voice-preview" style="width:auto;" title="Listen"><i class="fa-solid fa-ear-listen"></i> Listen</button>
                            <button type="button" class="ce-header-btn" id="ce-voice-random" style="width:auto;"><i class="fa-solid fa-shuffle"></i> New Reference Label</button>
                            <button type="button" class="ce-header-btn" id="ce-voice-save" style="width:auto;"><i class="fa-solid fa-floppy-disk"></i> Save Voice</button>
                            <button type="button" class="ce-header-btn" id="ce-voice-delete" style="width:auto;background:#b42318;border-color:#7f1d1d;"><i class="fa-solid fa-trash"></i> Delete Voice</button>
                            <span id="ce-voice-preview-status" style="font-size:11px; color:#80512d; font-style:italic;"></span>
                        </div>
                        <p id="ce-voice-summary" style="color:#8b6f47;font-size:11px;margin:6px 0 0;font-style:italic;"></p>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Appearance & style</label>
                        <textarea class="ce-textarea" id="ce-style" rows="4" placeholder="Outfits, build, height, hair/eyes...">${escHtml(editCard.style || "")}</textarea>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Personality & traits</label>
                        <textarea class="ce-textarea" id="ce-traits" rows="4" placeholder="Friendly, tsundere, anxious, loves music...">${escHtml(editCard.traits || "")}</textarea>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Backstory & History</label>
                        <textarea class="ce-textarea" id="ce-bio" rows="6" placeholder="Where they grew up, significant life events...">${escHtml(editCard.bio || "")}</textarea>
                    </div>
                    <button type="button" class="ce-header-btn" id="btn-ce-open-pref-profile" style="width:100%; margin-top:10px; padding:10px; font-size:13px;"><i class="fa-solid fa-gears"></i> Edit Character Preferences (Likes/Dislikes/Needs/Wants)</button>
                </div>

                <!-- VOICE TAB -->

                <div class="ce-section" id="tab-voice">

                    <div id="ce-voice-tab-host"></div>

                </div>



                <!-- GALLERY TAB -->
                <div class="ce-section" id="tab-gallery">
                    <div class="ce-group">
                        <label class="ce-label">AI Portraits Gallery</label>
                        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                            <input type="file" id="ce-pg-file" accept="image/*" style="display:none;">
                            <button type="button" class="ce-header-btn" id="btn-ce-pg-add" style="padding:6px 12px; font-size:12px;">Add File</button>
                            <button type="button" class="ce-header-btn ce-header-btn-primary" id="btn-ce-gen-portrait" style="padding:6px 12px; font-size:12px;">Gen Portrait</button>
                            <button type="button" class="ce-header-btn ce-header-btn-primary" id="btn-ce-gen-face" style="padding:6px 12px; font-size:12px;">Gen Face</button>
                        </div>
                        <div class="ce-portrait-gallery" id="ce-ai-portrait-gallery"></div>
                        <p style="color:#8b6f47;font-size:11px;margin-top:6px;font-style:italic;">Click a portrait thumb to copy it into the character's active Avatar field.</p>
                    </div>
                </div>

                <!-- EXPRESSIONS TAB -->
                <div class="ce-section" id="tab-expressions">
                    <div class="ce-group" style="border: 2px solid #5c3a21; border-radius: 4px; padding: 12px; background: rgba(0,0,0,0.02); margin-bottom: 20px;">
                        <label class="ce-label">Age Stage Expressions</label>
                        <p style="color:#8b6f47; font-size:11px; margin-top:2px; font-style:italic;">Sprites generated automatically during world aging. Click '+' to add or click a tile to pick a portrait.</p>
                        
                        <div style="margin-top: 10px;">
                            <strong style="font-size: 12px; color: #5c3a21; display:block; border-bottom: 1.5px solid #5c3a21; padding-bottom: 2px;">Baby / Toddler</strong>
                            <div class="age-stage-grid" id="age-grid-baby_toddler"></div>
                        </div>
                        <div style="margin-top: 10px;">
                            <strong style="font-size: 12px; color: #5c3a21; display:block; border-bottom: 1.5px solid #5c3a21; padding-bottom: 2px;">Child</strong>
                            <div class="age-stage-grid" id="age-grid-child"></div>
                        </div>
                        <div style="margin-top: 10px;">
                            <strong style="font-size: 12px; color: #5c3a21; display:block; border-bottom: 1.5px solid #5c3a21; padding-bottom: 2px;">Teen</strong>
                            <div class="age-stage-grid" id="age-grid-teen"></div>
                        </div>
                        <div style="margin-top: 10px;">
                            <strong style="font-size: 12px; color: #5c3a21; display:block; border-bottom: 1.5px solid #5c3a21; padding-bottom: 2px;">Young Adult</strong>
                            <div class="age-stage-grid" id="age-grid-young_adult"></div>
                        </div>
                        <div style="margin-top: 10px;">
                            <strong style="font-size: 12px; color: #5c3a21; display:block; border-bottom: 1.5px solid #5c3a21; padding-bottom: 2px;">Adult</strong>
                            <div class="age-stage-grid" id="age-grid-adult"></div>
                        </div>
                        <div style="margin-top: 10px;">
                            <strong style="font-size: 12px; color: #5c3a21; display:block; border-bottom: 1.5px solid #5c3a21; padding-bottom: 2px;">Old / Elder</strong>
                            <div class="age-stage-grid" id="age-grid-elder"></div>
                        </div>
                    </div>

                    <div class="ce-group">
                        <label class="ce-label">General Expression Sprites</label>
                        <div class="ce-click-upload-box" id="ce-click-upload-pack">
                            <span style="font-size: 28px; font-weight: bold; color: #5c3a21; display: block; margin-bottom: 4px;">+</span>
                            <span style="font-size: 13px; font-weight: bold; color: #3a2211;">Add Expression Pack / Sprites</span>
                            <span style="font-size: 11px; color: #8b6f47; display: block; margin-top: 4px;">Click to select ZIP pack or multiple image files</span>
                            <input type="file" id="ce-exp-files" accept="image/*" multiple style="display:none;">
                            <input type="file" id="ce-exp-zip" accept=".zip,application/zip,application/x-zip-compressed" style="display:none;">
                        </div>
                        <button type="button" id="btn-exp-defaults" class="ce-header-btn" style="margin-bottom:12px; width: 100%;">Add Default Expression Set (30+)</button>
                        <div class="exp-grid" id="exp-grid"></div>
                        <button type="button" id="btn-add-exp" class="ce-header-btn" style="margin-top:16px; width:100%; border:2px dashed #5c3a21; background:none; color:#5c3a21;">+ Add Custom Expression</button>
                    </div>
                </div>

                <!-- DRIVES & FACTIONS TAB -->
                <div class="ce-section" id="tab-drives">
                    <button type="button" class="ce-header-btn" id="btn-ce-open-pref-drives" style="width:100%; margin-bottom:16px; padding:12px; font-size:14px;"><i class="fa-solid fa-gears"></i> Edit Likes, Dislikes, Wants & Needs</button>

                    <div class="ce-group" style="margin-top:16px;">
                        <label class="ce-label">Organization Standings</label>
                        <div id="ce-factions-list" style="display:flex; flex-direction:column; gap:8px;"></div>
                        <button type="button" class="ce-header-btn" id="ce-faction-add" style="margin-top:8px; width:auto;">+ Add Organization Standing</button>
                    </div>

                </div>

                <!-- CHAT RULES TAB -->
                <div class="ce-section" id="tab-rules">
                    <div class="ce-group">
                        <label class="ce-label">Chat Rules</label>
                        <textarea class="ce-textarea" id="ce-rules" rows="6" placeholder="Formatting, emojis rules, style requirements...">${escHtml(editCard.rules || "")}</textarea>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Example dialogue & Chat examples</label>
                        <textarea class="ce-textarea" id="ce-mes-example" rows="8" placeholder="[Name]: Hello!\n[Name]: Hello back!">${escHtml(editCard.mes_example || "")}</textarea>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Post-history instructions (System prompt suffix)</label>
                        <textarea class="ce-textarea" id="ce-post-history" rows="4" placeholder="Instructions appended to chat prompt...">${escHtml(editCard.post_history_instructions || "")}</textarea>
                    </div>
                    <div class="ce-group">
                        <label class="ce-label">Creator notes (OOC)</label>
                        <textarea class="ce-textarea" id="ce-creator-notes" rows="3" placeholder="Out-of-character notes...">${escHtml(editCard.creator_notes || "")}</textarea>
                    </div>
                </div>
            </div>
            
            <div class="ce-preview" style="display:flex;">
                <h3 style="color:#5c3a21; margin-top:0; border-bottom: 2px solid #5c3a21; width: 100%; text-align: center; padding-bottom: 6px; font-size:15px; font-weight:bold;">Slideshow</h3>
                <div id="ce-slideshow-frame" style="width: 260px; height: 340px; border: 4px solid #5c3a21; border-radius: 4px; background: #e2c0a2; background-size: contain; background-position: center; background-repeat: no-repeat; box-shadow: 2px 2px 0 rgba(0,0,0,0.1);"></div>
                <div id="ce-slideshow-name" style="font-size: 13px; font-weight: bold; margin-top: 10px; color: #5c3a21; height: 18px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; width: 100%; text-align: center;">Default</div>
                <div class="ce-preview-controls">
                    <button type="button" class="ce-preview-btn" id="btn-prev-expr" title="Previous expression">◀</button>
                    <button type="button" class="ce-preview-btn" id="btn-play-expr" title="Play/Pause slideshow">⏸</button>
                    <button type="button" class="ce-preview-btn" id="btn-next-expr" title="Next expression">▶</button>
                </div>
            </div>
        </div>
    </div>
    `;
    
    $("body").append(html);
    $("#ce-voice-studio").appendTo("#ce-voice-tab-host");

    ensureExpressions(editCard);
    if (!Array.isArray(editCard.portrait_gallery)) editCard.portrait_gallery = [];
    $("#ce-age-stage").val(String(editCard.ageStage || editCard.age_stage || "adult"));

    const s0 = getSettings();
    (function fillCharApiProfileSelect() {
        const $sel = $("#ce-char-api-profile");
        $sel.empty();
        $sel.append($("<option>", { value: "" }).text("Use global default (Settings → Main API)"));
        (Array.isArray(s0.connections?.mainProfiles) ? s0.connections.mainProfiles : []).forEach((p) => {
            const pid = String(p?.id || "").trim();
            if (!pid) return;
            const prov = String(p?.provider || "").trim();
            const label = `${String(p?.name || pid).slice(0, 100)}${prov ? ` — ${prov}` : ""}`;
            $sel.append($("<option>", { value: pid }).text(label));
        });
        
        // Set current profile selection
        let profileId = String(editCard.main_profile_id || editCard.model_profile_id || "").trim();
        $sel.val(profileId || "");
    })();

    (function fillCharApiProviderSelect() {
        const $sel = $("#ce-char-api-provider");
        // Set current provider selection
        let provider = String(editCard.char_api_provider || "").trim();
        if (!provider && editCard.char_api_route) {
            // Extract provider from old route format for compatibility
            if (editCard.char_api_route.startsWith("builtin:")) {
                provider = editCard.char_api_route.slice(8);
            } else if (editCard.char_api_route === "custom") {
                provider = "custom";
            }
        }
        $sel.val(provider || "");
    })();

    function toggleCharApiFields() {
        const profileId = String($("#ce-char-api-profile").val() || "").trim();
        const provider = String($("#ce-char-api-provider").val() || "").trim();
        const legacyRoute = String($("#ce-char-api-route").val() || "").trim();
        const route = legacyRoute || (provider ? (provider === "custom" ? "custom" : `builtin:${provider}`) : "");
        const builtInProviders = new Set(["ollama", "lmstudio", "llamacpp", "vllm", "textgenwebui", "kobold", "tabby"]);
        $("#ce-char-api-provider").prop("disabled", !!profileId);
        $("#ce-char-api-builtin-extra").toggle(!profileId && (route.startsWith("builtin:") || builtInProviders.has(provider)));
        $("#ce-char-api-custom-fields").toggle(!profileId && route === "custom");
    }

    (function fillLegacyRouteSelect() {
        const $sel = $("#ce-char-api-route");
        $sel.empty();
        $sel.append($("<option>", { value: "" }).text("Global default (Settings → Main API, active profile)"));
        const ogP = $("<optgroup>", { label: "Saved profiles" });
        (Array.isArray(s0.connections?.mainProfiles) ? s0.connections.mainProfiles : []).forEach((p) => {
            const pid = String(p?.id || "").trim();
            if (!pid) return;
            const prov = String(p?.provider || "").trim();
            const label = `${String(p?.name || pid).slice(0, 100)}${prov ? ` — ${prov}` : ""}`;
            ogP.append($("<option>", { value: `profile:${pid}` }).text(label));
        });
        $sel.append(ogP);
        const ogL = $("<optgroup>", { label: "Local or direct API" });
        ["ollama", "lmstudio", "llamacpp", "vllm", "textgenwebui", "kobold", "tabby"].forEach((k) => {
            const lbl = LOCAL_SERVER_LABELS[k] || k;
            ogL.append($("<option>", { value: `builtin:${k}` }).text(lbl));
        });
        $sel.append(ogL);
        $sel.append($("<option>", { value: "custom" }).text("This card: custom URL, key & model"));
        let routeVal = String(editCard.char_api_route || "").trim();
        if (!routeVal) {
            const leg = String(editCard.main_profile_id || editCard.model_profile_id || "").trim();
            if (leg) routeVal = `profile:${leg}`;
        }
        let hasOpt = false;
        if (routeVal) {
            hasOpt = $sel.find(`option[value="${cssEscape(routeVal)}"]`).length > 0;
        }
        if (routeVal && routeVal.startsWith("profile:") && !hasOpt) {
            $sel.append($("<option>", { value: routeVal }).text(`(Missing profile) ${routeVal.slice(8)}`));
        }
        $sel.val(routeVal || "");
        const ep = String((editCard.char_api_custom && editCard.char_api_custom.endpointShape) || "openai_chat").trim();
        $("#ce-char-api-endpoint").val(ep);
        toggleCharApiFields();
    })();

    function syncCharApiRoutePanels() {
        toggleCharApiFields();
    }
    syncCharApiRoutePanels();
    $("#ce-char-api-route, #ce-char-api-profile, #ce-char-api-provider").on("change", syncCharApiRoutePanels);
    $("#uie-card-editor").on("change", "#ce-gender", function() {
        $("#ce-gender-custom").prop("hidden", String($(this).val() || "") !== "Custom");
    });
    function updateCardVoiceRecipe() {
        const refAudioUrl = String($("#ce-f5-reference").val() || "").trim();
        const refText = String($("#ce-f5-ref-text").val() || "").trim();
        const label = String($("#ce-f5-label").val() || "Pocket Reference Voice").trim();
        const provider = String($("#ce-voice-provider").val() || "pocket").toLowerCase();
        const speed = Number($("#ce-voice-speed").val() || 1);
        const pitch = Number($("#ce-voice-pitch").val() || 1);
        if (provider === "kokoro") {
            const kokoroLanguage = String($("#ce-kokoro-language").val() || "english");
            const kokoroVoice = String($("#ce-kokoro-voice").val() || "af_heart");
            const gender = Number($("#ce-voice-gender-blend").val() ?? 0.5);
            const vibe = Number($("#ce-voice-vibe-blend").val() ?? 0.5);
            if (kokoroVoice === "custom") {
                $("#ce-voice-recipe").val(createKokoroStudioVoiceRecipe({
                    genderBlend: gender,
                    vibeBlend: vibe,
                    speed,
                    pitch,
                    label: label || "Kokoro Studio Voice"
                }));
            } else {
                $("#ce-voice-recipe").val(createKokoroVoiceRecipe({
                    voice: kokoroVoice,
                    language: kokoroLanguage,
                    speed,
                    pitch,
                    label: label || "Kokoro Voice"
                }));
            }
            $("#ce-voice-summary").text("Kokoro voice selected for this character.");
            $("#ce-voice-studio .ce-pocket-panel").hide();
            $("#ce-voice-studio .ce-kokoro-panel").show();
        } else {
            $("#ce-voice-recipe").val(createPocketVoiceRecipe({
                refAudioUrl,
                refText,
                label,
                fallbackVoice: $("#ce-pocket-fallback-voice").val() || "alba",
                speed,
                pitch,
                warmth: Number($("#ce-voice-warmth").val() || 0.5),
                clarity: Number($("#ce-voice-clarity").val() || 0.5)
            }));
            $("#ce-voice-summary").text(refAudioUrl
                ? "Pocket-TTS will clone cadence and timbre from the reference audio and transcript."
                : "Add a reference audio file/transcript or use the fallback voice.");
            $("#ce-voice-studio .ce-pocket-panel").show();
            $("#ce-voice-studio .ce-kokoro-panel").hide();
        }
    }
    $("#uie-card-editor").on("input change", ".ce-voice-field", updateCardVoiceRecipe);
    $("#uie-card-editor").on("input change", "#ce-voice-gender-blend, #ce-voice-vibe-blend", function() {
        $("#ce-kokoro-voice").val("custom");
        updateCardVoiceRecipe();
    });
    $("#uie-card-editor").on("change", "#ce-kokoro-voice", function() {
        const val = $(this).val();
        if (val === "am_adam") {
            $("#ce-voice-gender-blend").val(0);
            $("#ce-voice-vibe-blend").val(0);
        } else if (val === "af_heart") {
            $("#ce-voice-gender-blend").val(1);
            $("#ce-voice-vibe-blend").val(0.3);
        } else if (val === "af_sky") {
            $("#ce-voice-gender-blend").val(1);
            $("#ce-voice-vibe-blend").val(0);
        } else if (val === "af_bella") {
            $("#ce-voice-gender-blend").val(1);
            $("#ce-voice-vibe-blend").val(1);
        }
        updateCardVoiceRecipe();
    });
    $("#ce-voice-preset").on("change", function (event) {
        event.preventDefault();
        const preset = CARD_VOICE_PRESETS[String($(this).val() || "")];
        if (!preset) return;
        $("#ce-f5-label").val(preset.label);
        updateCardVoiceRecipe();
    });
    $("#ce-voice-preview").on("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void previewCurrentCardVoice();
    });
    $("#ce-f5-reference-file").on("change", async function () {
        const file = this.files?.[0];
        if (!file) return;
        if (!/\.(wav|mp3)$/i.test(file.name || "") && !/^audio\/(wav|x-wav|mpeg|mp3)$/i.test(file.type || "")) {
            $("#ce-f5-reference-label").text("Pick a WAV or MP3 reference audio file.");
            return;
        }
        try {
            const dataUrl = await readFileAsDataUrl(file);
            $("#ce-f5-reference").val(dataUrl);
            $("#ce-f5-reference-label").text(file.name || "Reference audio selected.");
            updateCardVoiceRecipe();
        } catch (error) {
            $("#ce-f5-reference-label").text("Could not read reference audio.");
        }
    });
    $("#ce-voice-random").on("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const recipe = randomSemanticVoiceRecipe();
        const voice = parseCardVoiceStudio(recipe);
        $("#ce-f5-label").val(voice.label);
        updateCardVoiceRecipe();
        void previewCurrentCardVoice();
    });
    $("#ce-saved-voice").on("change", function () {
        const id = String($(this).val() || "");
        const s = getSettings();
        const item = (Array.isArray(s.audio?.savedVoices) ? s.audio.savedVoices : []).find((voice) => String(voice?.id || "") === id);
        if (!item) return;
        const recipe = recipeFromSavedVoice(item);
        const parsed = parseCardVoiceStudio(recipe);
        $("#ce-voice-provider").val(parsed.engine || "pocket");
        $("#ce-f5-label").val(parsed.label || item.name || "Saved Voice");
        $("#ce-f5-reference").val(parsed.refAudioUrl || "");
        $("#ce-f5-reference-label").text(parsed.refAudioUrl ? "Reference audio selected." : "No reference audio selected.");
        $("#ce-f5-ref-text").val(parsed.refText || "");
        $("#ce-pocket-fallback-voice").val(parsed.fallbackVoice || item.voice || "alba");
        if (parsed.isStudio) {
            $("#ce-kokoro-voice").val("custom");
        } else {
            $("#ce-kokoro-voice").val(parsed.voice || item.voice || "af_heart");
        }
        $("#ce-voice-gender-blend").val(parsed.genderBlend ?? 0.5);
        $("#ce-voice-vibe-blend").val(parsed.vibeBlend ?? 0.5);
        $("#ce-kokoro-language").val(parsed.language || item.language || "english");
        $("#ce-voice-speed").val(parsed.speed || item.speed || 1);
        $("#ce-voice-pitch").val(parsed.pitch || item.pitch || 1);
        $("#ce-voice-warmth").val(parsed.warmth ?? item.warmth ?? 0.5);
        $("#ce-voice-clarity").val(parsed.clarity ?? item.clarity ?? 0.5);
        updateCardVoiceRecipe();
    });
    $("#ce-voice-save").on("click", (event) => {
        event.preventDefault();
        updateCardVoiceRecipe();
        const s = getSettings();
        s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
        const list = Array.isArray(s.audio.savedVoices) ? s.audio.savedVoices : [];
        const provider = String($("#ce-voice-provider").val() || "pocket").toLowerCase();
        const name = String($("#ce-f5-label").val() || $("#ce-name").val() || "Saved Voice").trim();
        const item = {
            id: `voice_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || Date.now()}`,
            name,
            provider,
            voiceRecipe: String($("#ce-voice-recipe").val() || ""),
            voice: provider === "kokoro" ? ($("#ce-kokoro-voice").val() || "af_heart") : ($("#ce-pocket-fallback-voice").val() || "alba"),
            reference: String($("#ce-f5-reference").val() || ""),
            referenceText: String($("#ce-f5-ref-text").val() || ""),
            language: provider === "kokoro" ? ($("#ce-kokoro-language").val() || "english") : "english",
            speed: Number($("#ce-voice-speed").val() || 1),
            pitch: Number($("#ce-voice-pitch").val() || 1),
            warmth: Number($("#ce-voice-warmth").val() || 0.5),
            clarity: Number($("#ce-voice-clarity").val() || 0.5),
            genderBlend: Number($("#ce-voice-gender-blend").val() ?? 0.5),
            vibeBlend: Number($("#ce-voice-vibe-blend").val() ?? 0.5),
            isStudio: provider === "kokoro" && $("#ce-kokoro-voice").val() === "custom",
            updatedAt: Date.now()
        };
        s.audio.savedVoices = [item, ...list.filter((voice) => String(voice?.id || "") !== item.id)].slice(0, 100);
        saveSettings();
        $("#ce-saved-voice").html(savedCardVoiceOptions(item.id));
    });
    $("#ce-voice-delete").on("click", (event) => {
        event.preventDefault();
        const id = String($("#ce-saved-voice").val() || "");
        if (!id) return;
        const s = getSettings();
        s.audio = s.audio && typeof s.audio === "object" ? s.audio : {};
        s.audio.savedVoices = (Array.isArray(s.audio.savedVoices) ? s.audio.savedVoices : []).filter((voice) => String(voice?.id || "") !== id);
        saveSettings();
        $("#ce-saved-voice").html(savedCardVoiceOptions(""));
    });
    updateCardVoiceRecipe();

    $(document).off("click.uieCardEditorClose", "#btn-ce-cancel")
        .on("click.uieCardEditorClose", "#btn-ce-cancel", function (e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-card-editor").remove();
        });

    // Dropdown for AI Gen Header Button
    $("#uie-card-editor").on("click", "#btn-ce-genimg", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#ce-genimg-dropdown").toggle();
    });
    
    $(document).off("click.ceDropdownClose").on("click.ceDropdownClose", function() {
        $("#ce-genimg-dropdown").hide();
    });

    $("#uie-card-editor").on("click", "#ce-dropdown-gen-avatar", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#ce-genimg-dropdown").hide();
        window.UIE_imageGenTarget = "avatar";
        runCardPortraitGen("face");
    });

    $("#uie-card-editor").on("click", "#ce-dropdown-gen-gallery", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#ce-genimg-dropdown").hide();
        window.UIE_imageGenTarget = "gallery";
        runCardPortraitGen("you");
    });

    // Preferences popup button bindings
    $("#uie-card-editor").on("click", "#btn-ce-open-pref-drives, #btn-ce-open-pref-profile", function(e) {
        e.preventDefault();
        e.stopPropagation();
        openPreferencesEditorWindow();
    });

    $("#btn-ce-narrator").on("click", () => {
        const id = String(editCard.id || "").trim();
        if (!id) return;
        const r = toggleNarratorForCardId(id);
        const n = String($("#ce-name").val() || editCard.name || "Card").trim();
        if (r === "default") toastNarrator("Narrator: default omniscient voice.");
        else toastNarrator(`Narrator: ${n} (bio as world layer).`);
        const on = r === "set";
        $("#btn-ce-narrator")
            .toggleClass("ce-narrator-on", on)
            .text(on ? "Narrator ✓" : "Narrator");
    });

    $("#btn-ce-target").on("click", () => {
        const n = String($("#ce-name").val() || "").trim();
        if (!n) {
            alert("Enter a character name first.");
            return;
        }
        try {
            if (typeof window.__UIE_onCardSetTarget === "function") window.__UIE_onCardSetTarget(n);
            else alert("Target wiring not ready — save and use the in-game target control.");
        } catch (e) {
            alert(String(e?.message || e));
        }
    });
    function mergeCardFromSettingsAfterGen() {
        const s = getSettings();
        const fresh = (s.character_cards || []).find((c) => c.id === editCard.id);
        if (fresh) {
            editCard.portrait_gallery = Array.isArray(fresh.portrait_gallery) ?
                 fresh.portrait_gallery.map((x) => ({ ...x }))
                : [];
            if (fresh.avatar) editCard.avatar = fresh.avatar;
            $("#ce-avatar").val(editCard.avatar || "");
            $("#ce-avatar-preview-box").css("background-image", editCard.avatar && !/^none$/i.test(editCard.avatar) ? `url(${JSON.stringify(editCard.avatar)})` : "");
        }
        renderCardPortraitGallery();
    }

    function renderCardPortraitGallery() {
        const $g = $("#ce-ai-portrait-gallery");
        if (!$g.length) return;
        $g.empty();
        const gallery = Array.isArray(editCard.portrait_gallery) ? editCard.portrait_gallery : [];
        gallery.forEach((img) => {
            $g.append(`
                <div class="ce-portrait-thumb" data-id="${img.id}">
                    <img src="${img.url}" alt="${escAttr(img.name || '')}">
                    <button type="button" class="ce-pg-del" data-id="${img.id}">×</button>
                </div>
            `);
        });
        updatePreview();
    }

    function updatePreview() {
        const name = escHtml($("#ce-name").val() || editCard.name || "Unnamed");
        const role = escHtml($("#ce-role").val() || editCard.role || "Unknown");
        const avatar = String($("#ce-avatar").val() || "").trim();
        const isNarr = getNarratorCharacterCardId() === String(editCard.id || "").trim();
        
        const scale = Number($("#ce-avatar-scale").val()) || editCard.avatarScale || 100;
        const x = Number($("#ce-avatar-x").val()) || editCard.avatarX || 0;
        const y = Number($("#ce-avatar-y").val()) || editCard.avatarY || 0;
        
        const imgStyle = avatar && !/^none$/i.test(avatar)
            ? `background-image: url(${JSON.stringify(avatar)}); background-repeat: no-repeat; background-size: ${scale}%; background-position: calc(50% + ${x}%) calc(50% + ${y}%);`
            : '';
            
        const previewHtml = `
            <div class="char-card-preview${isNarr ? " is-narrator" : ""}" style="cursor: default; pointer-events: none; transform: none; box-shadow: none; margin: 0 auto; max-width: 260px; min-height: 250px;">
                <div class="ccp-img${editCard.avatar ? " has-portrait" : ""}" style="${imgStyle}"><i class="fa-solid fa-user-astronaut ccp-fallback-icon" aria-hidden="true"></i></div>
                <div class="ccp-info">
                    <div class="ccp-name">${name}</div>
                    <div class="ccp-role">${role}</div>
                </div>
            </div>
        `;
        $("#preview-card-content").html(previewHtml);
    }

    // Bind inputs to live preview
    $("#uie-card-editor").on("input change", "#ce-name, #ce-role, #ce-avatar, #ce-avatar-scale, #ce-avatar-x, #ce-avatar-y", function() {
        const val = String($("#ce-avatar").val() || "").trim();
        const scale = Number($("#ce-avatar-scale").val()) || 100;
        const x = Number($("#ce-avatar-x").val()) || 0;
        const y = Number($("#ce-avatar-y").val()) || 0;

        $("#ce-avatar-scale-val").text(scale);
        $("#ce-avatar-x-val").text(x);
        $("#ce-avatar-y-val").text(y);

        if (this.id === "ce-avatar" || this.id === "ce-avatar-scale" || this.id === "ce-avatar-x" || this.id === "ce-avatar-y") {
            const bgImg = val && !/^none$/i.test(val) ? `url(${JSON.stringify(val)})` : "";
            $("#ce-avatar-preview-box").css({
                "background-image": bgImg,
                "background-size": `${scale}%`,
                "background-position": `calc(50% + ${x}%) calc(50% + ${y}%)`,
                "background-repeat": "no-repeat"
            });
        }
        updatePreview();
    });

    // Bind gallery click events
    $("#uie-card-editor").on("click", "#ce-ai-portrait-gallery .ce-portrait-thumb", function(e) {
        if ($(e.target).closest(".ce-pg-del").length) return;
        const id = $(this).data("id");
        const img = (editCard.portrait_gallery || []).find((x) => x.id === id);
        if (img && img.url) {
            $("#ce-avatar").val(img.url).trigger("change");
        }
    });

    $("#uie-card-editor").on("click", "#ce-ai-portrait-gallery .ce-pg-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const id = $(this).data("id");
        editCard.portrait_gallery = (editCard.portrait_gallery || []).filter((x) => x.id !== id);
        renderCardPortraitGallery();
    });

    async function runCardPortraitGen(mode) {
        const n = String($("#ce-name").val() || "").trim();
        if (!n) {
            alert("Enter a character name first.");
            return;
        }
        
        // Show image generation modal
        showImageGenModal(n, mode);
    }

    function showImageGenModal(characterName, mode) {
        // Create modal if it doesn't exist
        if (!$("#uie-image-gen-modal").length) {
            const modalHtml = '<div id="uie-image-gen-modal" style="display:none; position:fixed; inset:0; background:rgba(57,34,20,0.34); z-index:2147483647; align-items:center; justify-content:center; padding:20px;">' +
                '<div style="background:#fff8ed; border:1px solid rgba(151,91,39,0.46); border-radius:12px; padding:20px; width:100%; max-width:500px; color:#392214; box-shadow:0 20px 50px rgba(57,34,20,0.28);">' +
                    '<h3 style="margin:0 0 15px 0; color:#5c3a21;">Generate Character Portrait</h3>' +
                    '<p style="margin:0 0 15px 0; font-size:14px; opacity:0.9;">Describe the character appearance for AI image generation.</p>' +
                    
                    '<div style="margin-bottom:15px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Character Name</label>' +
                        '<input type="text" id="uie-img-char-name" readonly style="width:100%; padding:8px; border:1.5px solid rgba(151,91,39,0.5); border-radius:6px; background:#fffdf7; color:#392214;" value="' + characterName + '">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:15px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Image Type</label>' +
                        '<select id="uie-img-mode" style="width:100%; padding:8px; border:1.5px solid rgba(151,91,39,0.5); border-radius:6px; background:#fffdf7; color:#392214;">' +
                            '<option value="you">Full Portrait</option>' +
                            '<option value="face">Face Only</option>' +
                            '<option value="scene">Scene with Character</option>' +
                        '</select>' +
                    '</div>' +
                    
                    '<div style="margin-bottom:15px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Description (Optional)</label>' +
                        '<textarea id="uie-img-description" placeholder="Describe appearance, clothing, style, mood..." style="width:100%; height:80px; border:1.5px solid rgba(151,91,39,0.5); border-radius:6px; background:#fffdf7; color:#392214; padding:8px; resize:none; font-size:14px;"></textarea>' +
                    '</div>' +
                    
                    '<div id="uie-img-preview" style="margin:15px 0; display:none;">' +
                        '<div style="font-size:12px; opacity:0.8; margin-bottom:8px;">Generated Prompt:</div>' +
                        '<div id="uie-img-prompt" style="border:1.5px solid rgba(151,91,39,0.5); border-radius:6px; background:#fffdf7; color:#392214; padding:10px; font-size:12px; max-height:100px; overflow-y:auto;"></div>' +
                    '</div>' +
                    
                    '<div style="display:flex; gap:10px; margin-top:15px;">' +
                        '<button id="uie-img-generate" style="flex:1; padding:10px; border:none; border-radius:8px; background:#cba35c; color:#000; font-weight:bold; cursor:pointer;">Generate</button>' +
                        '<button id="uie-img-create" style="flex:1; padding:10px; border:none; border-radius:8px; background:#27ae60; color:#fff; font-weight:bold; cursor:pointer; display:none;">Create Image</button>' +
                        '<button id="uie-img-cancel" style="flex:1; padding:10px; border:none; border-radius:8px; background:#e74c3c; color:#fff; font-weight:bold; cursor:pointer;">Cancel</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
            $("body").append(modalHtml);
            
            // Add event handlers
            $(document).on("click.uieImgGen", "#uie-img-generate", async () => {
                const name = $("#uie-img-char-name").val().trim();
                const mode = $("#uie-img-mode").val();
                const description = $("#uie-img-description").val().trim();
                
                if (!name) return;
                
                try {
                    // Show loading state
                    $("#uie-img-generate").text("Generating...").prop("disabled", true);
                    
                    // Generate image prompt
                    const prompt = await generateImagePrompt(name, mode, description);
                    
                    // Display prompt
                    $("#uie-img-prompt").text(prompt);
                    $("#uie-img-preview").show();
                    $("#uie-img-create").show();
                    $("#uie-img-generate").text("Regenerate").prop("disabled", false);
                    
                } catch (error) {
                    console.error("Failed to generate image prompt:", error);
                    $("#uie-img-generate").text("Generate").prop("disabled", false);
                }
            });
            
            $(document).on("click.uieImgGen", "#uie-img-create", async () => {
                const prompt = $("#uie-img-prompt").text().trim();
                if (!prompt) return;
                
                try {
                    $("#uie-img-create").text("Creating...").prop("disabled", true);
                    $("#uie-img-cancel").prop("disabled", true);
                    
                    const { generateImageAPI } = await import("./imageGen.js");
                    const dataUrl = await generateImageAPI(prompt, { mode });
                    
                    if (dataUrl) {
                        const id = createUUID();
                        const newImage = { id, url: dataUrl, name: `${characterName}_${mode}_${Date.now()}.png` };
                        
                        const isAvatarTarget = window.UIE_imageGenTarget === "avatar";
                        if (isAvatarTarget) {
                            $("#ce-avatar").val(dataUrl).trigger("change");
                        } else {
                            if (!Array.isArray(editCard.portrait_gallery)) editCard.portrait_gallery = [];
                            editCard.portrait_gallery.push(newImage);
                            renderCardPortraitGallery();
                        }
                        
                        if (window.toastr) window.toastr.success("Character portrait generated successfully!");
                    } else {
                        alert("Image generation returned no data. Check API configuration.");
                    }
                } catch (error) {
                    console.error("Failed to generate image:", error);
                    alert("Failed to generate image: " + (error?.message || error));
                } finally {
                    $("#uie-img-create").text("Create Image").prop("disabled", false);
                    $("#uie-img-cancel").prop("disabled", false);
                    $("#uie-image-gen-modal").hide();
                    resetImageGenModal();
                }
            });
            
            $(document).on("click.uieImgGen", "#uie-img-cancel", () => {
                $("#uie-image-gen-modal").hide();
                resetImageGenModal();
            });
            
            $(document).on("click.uieImgGen", "#uie-image-gen-modal", (e) => {
                if (e.target === e.currentTarget) {
                    $("#uie-image-gen-modal").hide();
                    resetImageGenModal();
                }
            });
        }
        
        // Set current mode and show modal
        $("#uie-img-mode").val(mode);
        $("#uie-image-gen-modal").show();
        resetImageGenModal();
    }

    function resetImageGenModal() {
        $("#uie-img-description").val("");
        $("#uie-img-preview").hide();
        $("#uie-img-prompt").empty();
        $("#uie-img-generate").text("Generate").prop("disabled", false);
        $("#uie-img-create").hide();
    }

    async function generateImagePrompt(characterName, mode, description) {
        const s = getSettings();
        const turboEnabled = !!(s.turbo && s.turbo.enabled);
        
        const modeDescriptions = {
            "you": "full body portrait showing complete character",
            "face": "close-up portrait focusing on face and expression",
            "scene": "character in a detailed scene with environment"
        };
        
        const prompt = `Create a detailed AI image generation prompt for a character portrait.

Character Name: ${characterName}
Image Type: ${modeDescriptions[mode] || "portrait"}
${description ? `Additional Description: ${description}` : ""}

Requirements:
- Create a vivid, detailed prompt for AI image generation
- Include details about appearance, clothing, style, lighting, and mood
- Use descriptive language that works well with image AI models
- Keep it concise but comprehensive (2-3 sentences)
- Focus on visual elements only

Format as a single paragraph prompt suitable for image generation APIs.`;
        
        if (turboEnabled) {
            try {
                const { generateContent } = await import("./apiClient.js");
                const response = await generateContent(prompt, "image_prompt");
                return response?.choices?.[0]?.message?.content || response?.content || `Portrait of ${characterName}, detailed character art`;
            } catch (error) {
                console.error("Turbo API failed, falling back to local generation:", error);
            }
        }
        
        // Fallback to local generation
        return `Detailed portrait of ${characterName}, ${description || "character art"}, professional illustration, high quality, detailed features`;
    }

    // No direct single action on #btn-ce-genimg (it toggles dropdown instead)

    // Portrait gallery file picker
    $("#btn-ce-pg-add").on("click", () => $("#ce-pg-file").trigger("click"));
    $("#ce-pg-file").on("change", async function() {
        const file = this.files && this.files[0];
        this.value = "";
        if (!file) return;
        
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const id = createUUID();
            const newImage = { id, url: dataUrl, name: file.name };
            if (!Array.isArray(editCard.portrait_gallery)) editCard.portrait_gallery = [];
            editCard.portrait_gallery.push(newImage);
            renderCardPortraitGallery();
        } catch (error) {
            console.error("Failed to read file:", error);
            alert("Failed to read image file. Please try again.");
        }
    });
    $("#uie-card-editor").on("click", "#btn-ce-gen-portrait", function(e) {
        window.UIE_imageGenTarget = "gallery";
        runCardPortraitGen("you");
    });
    $("#uie-card-editor").on("click", "#btn-ce-gen-face", function(e) {
        window.UIE_imageGenTarget = "gallery";
        runCardPortraitGen("face");
    });

    // Avatar file picker
    $("#ce-avatar-file-btn").on("click", () => $("#ce-avatar-file").trigger("click"));
    $("#uie-card-editor").on("click", "#ce-avatar-preview-box", () => $("#ce-avatar-file").trigger("click"));
    $("#ce-avatar-file").on("change", async function() {
        const file = this.files && this.files[0];
        this.value = "";
        if (!file) return;
        
        try {
            const dataUrl = await readFileAsDataUrl(file);
            $("#ce-avatar").val(dataUrl).trigger("change");
        } catch (error) {
            console.error("Failed to read file:", error);
            alert("Failed to read image file. Please try again.");
        }
    });
    $("#btn-ce-scene").on("click", () => {
        const n = String($("#ce-name").val() || "").trim();
        if (!n) {
            alert("Enter a character name first.");
            return;
        }
        try {
            if (typeof window.__UIE_onCardSceneToggle === "function") window.__UIE_onCardSceneToggle(n);
            else alert("Scene wiring not ready — use Scene Characters in the menu.");
        } catch (e) {
            alert(String(e?.message || e));
        }
    });

    function readEditorIntoCard(ec) {
        ec.name = String($("#ce-name").val() || "").trim();
        ec.role = String($("#ce-role").val() || "").trim();
        const genderChoice = String($("#ce-gender").val() || "").trim();
        ec.gender = genderChoice === "Custom" ? String($("#ce-gender-custom").val() || "").trim() : genderChoice;
        ec.age = Number.isFinite(Number($("#ce-age").val())) ? Number($("#ce-age").val()) : "";
        ec.ageStage = String($("#ce-age-stage").val() || "adult").trim();
        ec.phoneNumber = String($("#ce-phone-number").val() || "").trim();
        ec.hook = String($("#ce-hook").val() || "").trim();
        ec.bio = String($("#ce-bio").val() || "").trim();
        ec.avatar = String($("#ce-avatar").val() || "").trim();
        ec.avatarScale = Number($("#ce-avatar-scale").val()) || 100;
        ec.avatarX = Number($("#ce-avatar-x").val()) || 0;
        ec.avatarY = Number($("#ce-avatar-y").val()) || 0;
        ec.build = String($("#ce-build").val() || "").trim();
        ec.style = String($("#ce-style").val() || "").trim();
        ec.traits = String($("#ce-traits").val() || "").trim();
        const cardVoiceRecipe = String($("#ce-voice-recipe").val() || "").trim();
        if (cardVoiceRecipe) {
            ec.voice_recipe = cardVoiceRecipe;
            ec.voiceRecipe = cardVoiceRecipe;
            ec.tts = { ...(ec.tts && typeof ec.tts === "object" ? ec.tts : {}), voice_recipe: cardVoiceRecipe };
        } else {
            delete ec.voice_recipe;
            delete ec.voiceRecipe;
            if (ec.tts && typeof ec.tts === "object") delete ec.tts.voice_recipe;
        }
        // Handle new separated profile and provider fields
        const profileId = String($("#ce-char-api-profile").val() || "").trim();
        const provider = String($("#ce-char-api-provider").val() || "").trim();
        
        // Handle legacy route field for backward compatibility
        const route = String($("#ce-char-api-route").val() || "").trim();
        delete ec.main_profile_id;
        delete ec.model_profile_id;
        delete ec.api_profile_id;
        delete ec.char_api_route;
        delete ec.char_api_builtin_model;
        delete ec.char_api_builtin_key;
        delete ec.char_api_custom;
        delete ec.char_api_provider;
        
        // Set profile if selected
        if (profileId) {
            ec.main_profile_id = profileId;
            ec.model_profile_id = profileId;
        }
        
        // Set provider if selected (and no profile)
        if (provider && !profileId) {
            ec.char_api_provider = provider;
            if (provider === "custom") {
                ec.char_api_route = "custom";
                const url = String($("#ce-char-api-url").val() || "").trim();
                const key = String($("#ce-char-api-key").val() || "").trim();
                const model = String($("#ce-char-api-model").val() || "").trim();
                let endpointShape = String($("#ce-char-api-endpoint").val() || "openai_chat").trim();
                if (!["openai_chat", "auto", "anthropic_messages"].includes(endpointShape)) endpointShape = "openai_chat";
                ec.char_api_custom = { url, key, model, endpointShape };
            } else {
                ec.char_api_route = `builtin:${provider}`;
                const bm = String($("#ce-char-api-builtin-model").val() || "").trim();
                const bk = String($("#ce-char-api-builtin-key").val() || "").trim();
                if (bm) ec.char_api_builtin_model = bm;
                if (bk) ec.char_api_builtin_key = bk;
            }
        }
        
        // Handle legacy route format
        if (route && !profileId && !provider) {
            if (route.startsWith("profile:")) {
                const pid = route.slice(8).trim();
                if (pid) {
                    ec.char_api_route = route;
                    ec.main_profile_id = pid;
                    ec.model_profile_id = pid;
                }
            } else if (route.startsWith("builtin:")) {
                ec.char_api_route = route;
                const bm = String($("#ce-char-api-builtin-model").val() || "").trim();
                const bk = String($("#ce-char-api-builtin-key").val() || "").trim();
                if (bm) ec.char_api_builtin_model = bm;
                if (bk) ec.char_api_builtin_key = bk;
            } else if (route === "custom") {
                ec.char_api_route = "custom";
                const url = String($("#ce-char-api-url").val() || "").trim();
                const key = String($("#ce-char-api-key").val() || "").trim();
                const model = String($("#ce-char-api-model").val() || "").trim();
                let endpointShape = String($("#ce-char-api-endpoint").val() || "openai_chat").trim();
                if (!["openai_chat", "auto", "anthropic_messages"].includes(endpointShape)) endpointShape = "openai_chat";
                ec.char_api_custom = { url, key, model, endpointShape };
            } else if (route) {
                ec.char_api_route = route;
            }
        }
        ec.likes_weight = clampFieldWeight(editCard.likes_weight ?? 50);
        ec.dislikes_weight = clampFieldWeight(editCard.dislikes_weight ?? 50);
        ec.needs_weight = clampFieldWeight(editCard.needs_weight ?? 50);
        ec.wants_weight = clampFieldWeight(editCard.wants_weight ?? 50);
        delete ec.likes_priority;
        delete ec.dislikes_priority;
        delete ec.needs_priority;
        delete ec.wants_priority;
        delete ec.ui_sliders;
        ec.likesList = JSON.parse(JSON.stringify(editCard.likesList || []));
        ec.dislikesList = JSON.parse(JSON.stringify(editCard.dislikesList || []));
        ec.needsList = JSON.parse(JSON.stringify(editCard.needsList || []));
        ec.wantsList = JSON.parse(JSON.stringify(editCard.wantsList || []));
        ec.likes = serializePrefs(ec.likesList);
        ec.dislikes = serializePrefs(ec.dislikesList);
        ec.needs = serializePrefs(ec.needsList);
        ec.wants = serializePrefs(ec.wantsList);
        delete ec.desires;
        delete ec.interruptTracker;
        delete ec.schedule;
        ec.factions = Array.isArray(editCard.factions) ? [...editCard.factions] : [];
        ec.standings = String(editCard.standings || "").trim();
        ec.ageStageExpressions = JSON.parse(JSON.stringify(editCard.ageStageExpressions || {}));
        delete ec.stats;
        ec.story_hooks = String($("#ce-hooks").val() || "").trim();
        ec.mes_example = String($("#ce-mes-example").val() || "").trim();
        ec.post_history_instructions = String($("#ce-post-history").val() || "").trim();
        ec.creator_notes = String($("#ce-creator-notes").val() || "").trim();
        ec.rules = String($("#ce-rules").val() || "").trim();
        ec.customCss = String($("#ce-custom-css").val() || "").trim();
        ensureExpressions(ec);
        return ec;
    }

    $("#btn-ce-export").on("click", () => {
        const c = readEditorIntoCard(JSON.parse(JSON.stringify(editCard)));
        const safeName = String(c.name || "character").replace(/[^\w\-\s]/g, "").trim().replace(/\s+/g, "-") || "character";
        downloadJsonFile(`character-${safeName}.json`, {
            kind: "uie.character_card",
            version: 1,
            exportedAt: Date.now(),
            card: cardPayloadForExport(c)
        });
    });

    $("#btn-ce-import").on("click", () => $("#ce-import-file").trigger("click"));
    $("#ce-import-file").on("change", function () {
        const f = this.files && this.files[0];
        this.value = "";
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result || "null"));
                const list = normalizeImportToCardArray(parsed);
                const one = list[0];
                if (!one) {
                    alert("No card found in file.");
                    return;
                }
                const keepId = editCard.id;
                const merged = { ...JSON.parse(JSON.stringify(editCard)), ...one };
                merged.id = keepId;
                normalizeImportedCharacterCardShape(merged);
                $("#uie-card-editor").remove();
                renderCardEditor(merged);
            } catch (e) {
                alert(`Import failed: ${String(e?.message || e)}`);
            }
        };
        reader.readAsText(f);
    });

    // Tab Logic
    $(document).off('click.ceTab').on('click.ceTab', '.ce-tab', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $('.ce-tab').removeClass('active');
        $(this).addClass('active');
        const t = $(this).data('tab');
        $('.ce-section').removeClass('active');
        $(`#tab-${t}`).addClass('active');
    });

    // Render Expressions
    function renderExps() {
        const $g = $('#exp-grid');
        $g.empty();
        (editCard.expressions || []).forEach((exp, i) => {
            const src = String(exp?.sprites?.[0]?.src || "");
            $g.append(`
                <div class="exp-tile" data-idx="${i}">
                    <span class="exp-emoji">${exp.emoji || '😐'}</span>
                    <input class="ce-input exp-name-input" data-idx="${i}" value="${String(exp.name || 'neutral')}" style="margin-top:6px; padding:6px; font-size:12px;">
                    <span class="exp-count">${Array.isArray(exp.sprites) ? exp.sprites.length : 0} sprite(s)</span>
                    ${src ? `<img class="exp-thumb" src="${src}" alt="${String(exp.name || "expression")}">` : `<div class="exp-thumb" style="display:grid; place-items:center; color:#666;">No image</div>`}
                    <button class="ce-input exp-del-btn" data-idx="${i}" style="margin-top:8px; padding:6px;">Delete</button>
                </div>
            `);
        });

        $('.exp-name-input').off('input').on('input', function() {
            const idx = Number($(this).data('idx'));
            if (!Number.isFinite(idx) || !editCard.expressions[idx]) return;
            editCard.expressions[idx].name = String($(this).val() || "neutral").trim() || "neutral";
        });
        $('.exp-del-btn').off('click').on('click', function() {
            const idx = Number($(this).data('idx'));
            if (!Number.isFinite(idx)) return;
            editCard.expressions.splice(idx, 1);
            renderExps();
        });
    }
    renderExps();

    // Slide show state variables
    let slideshowIndex = 0;
    let slideshowIntervalId = null;
    let slideshowIsPlaying = true;

    function updateSlideshow() {
        const slides = [];
        (editCard.expressions || []).forEach(exp => {
            (exp.sprites || []).forEach(sprite => {
                if (sprite.src) {
                    slides.push({
                        name: `${exp.name || 'neutral'}: ${sprite.name || 'sprite'}`,
                        url: sprite.src
                    });
                }
            });
        });
        
        const stages = ["baby_toddler", "child", "teen", "young_adult", "adult", "elder"];
        stages.forEach(stg => {
            const list = editCard.ageStageExpressions[stg] || [];
            list.forEach(expr => {
                if (expr.url) {
                    slides.push({
                        name: `Stage [${stg}]: ${expr.name || 'Default'}`,
                        url: expr.url
                    });
                }
            });
        });
        
        if (slides.length === 0) {
            const av = String($("#ce-avatar").val() || editCard.avatar || "").trim();
            if (av && !/^none$/i.test(av)) {
                slides.push({
                    name: "Avatar",
                    url: av
                });
            }
        }
        
        if (slides.length === 0) {
            $("#ce-slideshow-frame").css("background-image", "");
            $("#ce-slideshow-name").text("No sprites");
            return;
        }
        
        if (slideshowIndex >= slides.length) slideshowIndex = 0;
        if (slideshowIndex < 0) slideshowIndex = slides.length - 1;
        
        const cur = slides[slideshowIndex];
        $("#ce-slideshow-frame").css({
            "background-image": `url(${JSON.stringify(cur.url)})`,
            "background-size": "cover",
            "background-position": "center",
            "background-repeat": "no-repeat"
        });
        $("#ce-slideshow-name").text(cur.name);
    }

    function startSlideshow() {
        if (slideshowIntervalId) clearInterval(slideshowIntervalId);
        slideshowIntervalId = setInterval(() => {
            slideshowIndex++;
            updateSlideshow();
        }, 2000);
        $("#btn-play-expr").text("⏸");
        slideshowIsPlaying = true;
    }

    function stopSlideshow() {
        if (slideshowIntervalId) {
            clearInterval(slideshowIntervalId);
            slideshowIntervalId = null;
        }
        $("#btn-play-expr").text("▶");
        slideshowIsPlaying = false;
    }

    // List rendering methods
    function renderPrefLists() {
        const types = [
            { key: "likesList", gridId: "#pref-likes-tags", label: "Like", btnId: "#pref-btn-add-like" },
            { key: "dislikesList", gridId: "#pref-dislikes-tags", label: "Dislike", btnId: "#pref-btn-add-dislike" },
            { key: "needsList", gridId: "#pref-needs-tags", label: "Need", btnId: "#pref-btn-add-need" },
            { key: "wantsList", gridId: "#pref-wants-tags", label: "Want", btnId: "#pref-btn-add-want" }
        ];

        types.forEach(({ key, gridId, label, btnId }) => {
            const $grid = $(gridId);
            if (!$grid.length) return;
            $grid.empty();
            
            const list = editCard[key] || [];
            list.forEach((it, i) => {
                const tagHtml = `
                    <div class="ce-tag" data-idx="${i}" title="Double-click to edit" style="cursor:pointer; user-select:none;">
                        <span>${escHtml(it.text)} (${it.weight})</span>
                        <button type="button" class="tag-del" data-idx="${i}">×</button>
                    </div>
                `;
                const $tag = $(tagHtml);
                
                // Double click to edit tag
                $tag.on("dblclick", function() {
                    const newText = prompt(`Edit name of ${label}:`, it.text);
                    if (newText === null) return;
                    const cleanText = newText.trim();
                    if (!cleanText) return;
                    
                    const newWeightRaw = prompt(`Edit weight of ${label} (0-100):`, it.weight);
                    if (newWeightRaw === null) return;
                    const cleanWeight = clampFieldWeight(newWeightRaw);
                    
                    it.text = cleanText;
                    it.weight = cleanWeight;
                    renderPrefLists();
                });
                
                // Del tag
                $tag.find(".tag-del").on("click", function(e) {
                    e.stopPropagation();
                    list.splice(i, 1);
                    renderPrefLists();
                });
                
                $grid.append($tag);
            });

            // Bind add button
            $(btnId).off("click").on("click", function() {
                const text = prompt(`Enter new ${label}:`);
                if (text === null) return;
                const cleanText = text.trim();
                if (!cleanText) return;

                const weightRaw = prompt(`Enter weight for ${label} (0-100):`, "50");
                if (weightRaw === null) return;
                const cleanWeight = clampFieldWeight(weightRaw);

                list.push({ text: cleanText, weight: cleanWeight });
                renderPrefLists();
            });
        });
    }

    function openPreferencesEditorWindow() {
        $("#ce-pref-editor").remove();
        
        const html = `
        <div id="ce-pref-editor" style="position:fixed; inset:0; z-index:2147483647; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; padding:20px;">
            <div style="width:640px; max-width:100%; max-height:90vh; background:#fcf5eb; border:8px double #5c3a21; border-radius:4px; display:flex; flex-direction:column; color:#3a2211; font-family:'Georgia', serif; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
                <div style="height:50px; border-bottom:4px solid #5c3a21; display:flex; align-items:center; justify-content:space-between; padding:0 16px; background:#e2c0a2; flex-shrink:0;">
                    <span style="font-weight:bold; font-size:1.1em; color:#3a2211;">Preferences (Likes, Dislikes, Wants & Needs)</span>
                    <button type="button" id="btn-pref-close" class="ce-header-btn" style="background:#dc3545; border-color:#bd2130;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:16px;">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                        <div class="ce-group">
                            <label class="ce-label">Likes</label>
                            <div class="ce-tag-editor">
                                <div id="pref-likes-tags" class="ce-tag-grid"></div>
                                <button type="button" class="ce-header-btn" id="pref-btn-add-like" style="padding:4px 8px; font-size:11px; width:auto; align-self:flex-start; margin-top:8px;">+ Add Like</button>
                            </div>
                        </div>
                        <div class="ce-group">
                            <label class="ce-label">Dislikes</label>
                            <div class="ce-tag-editor">
                                <div id="pref-dislikes-tags" class="ce-tag-grid"></div>
                                <button type="button" class="ce-header-btn" id="pref-btn-add-dislike" style="padding:4px 8px; font-size:11px; width:auto; align-self:flex-start; margin-top:8px;">+ Add Dislike</button>
                            </div>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                        <div class="ce-group">
                            <label class="ce-label">Needs</label>
                            <div class="ce-tag-editor">
                                <div id="pref-needs-tags" class="ce-tag-grid"></div>
                                <button type="button" class="ce-header-btn" id="pref-btn-add-need" style="padding:4px 8px; font-size:11px; width:auto; align-self:flex-start; margin-top:8px;">+ Add Need</button>
                            </div>
                        </div>
                        <div class="ce-group">
                            <label class="ce-label">Wants</label>
                            <div class="ce-tag-editor">
                                <div id="pref-wants-tags" class="ce-tag-grid"></div>
                                <button type="button" class="ce-header-btn" id="pref-btn-add-want" style="padding:4px 8px; font-size:11px; width:auto; align-self:flex-start; margin-top:8px;">+ Add Want</button>
                            </div>
                        </div>
                    </div>
                    
                    <div style="border: 2px solid #5c3a21; border-radius: 4px; padding: 12px; background: rgba(0,0,0,0.02); display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:11px; color:#5c3a21; font-weight:bold; display:block; margin-bottom:2px;">Likes Weight</label>
                            <input type="range" id="pref-w-likes" min="0" max="100" value="${clampFieldWeight(editCard.likes_weight ?? editCard.likes_priority ?? 50)}" style="width:100%; accent-color:#b36629;">
                            <span id="pref-w-likes-lbl" style="font-size:11px;color:#8b6f47;">${clampFieldWeight(editCard.likes_weight ?? editCard.likes_priority ?? 50)}</span>
                        </div>
                        <div>
                            <label style="font-size:11px; color:#5c3a21; font-weight:bold; display:block; margin-bottom:2px;">Dislikes Weight</label>
                            <input type="range" id="pref-w-dislikes" min="0" max="100" value="${clampFieldWeight(editCard.dislikes_weight ?? editCard.dislikes_priority ?? 50)}" style="width:100%; accent-color:#b36629;">
                            <span id="pref-w-dislikes-lbl" style="font-size:11px;color:#8b6f47;">${clampFieldWeight(editCard.dislikes_weight ?? editCard.dislikes_priority ?? 50)}</span>
                        </div>
                        <div>
                            <label style="font-size:11px; color:#5c3a21; font-weight:bold; display:block; margin-bottom:2px;">Needs Weight</label>
                            <input type="range" id="pref-w-needs" min="0" max="100" value="${clampFieldWeight(editCard.needs_weight ?? editCard.needs_priority ?? 50)}" style="width:100%; accent-color:#b36629;">
                            <span id="pref-w-needs-lbl" style="font-size:11px;color:#8b6f47;">${clampFieldWeight(editCard.needs_weight ?? editCard.needs_priority ?? 50)}</span>
                        </div>
                        <div>
                            <label style="font-size:11px; color:#5c3a21; font-weight:bold; display:block; margin-bottom:2px;">Wants Weight</label>
                            <input type="range" id="pref-w-wants" min="0" max="100" value="${clampFieldWeight(editCard.wants_weight ?? editCard.wants_priority ?? 50)}" style="width:100%; accent-color:#b36629;">
                            <span id="pref-w-wants-lbl" style="font-size:11px;color:#8b6f47;">${clampFieldWeight(editCard.wants_weight ?? editCard.wants_priority ?? 50)}</span>
                        </div>
                    </div>
                </div>
                <div style="height:60px; border-top:4px solid #5c3a21; display:flex; align-items:center; justify-content:center; padding:10px; background:#e2c0a2; flex-shrink:0;">
                    <button type="button" id="btn-pref-save" class="ce-header-btn ce-header-btn-primary" style="width:150px;"><i class="fa-solid fa-check"></i> Done</button>
                </div>
            </div>
        </div>
        `;
        $("body").append(html);
        
        renderPrefLists();
        
        $("#pref-w-needs, #pref-w-wants, #pref-w-likes, #pref-w-dislikes").on("input", function () {
            const sid = String(this.id || "").trim();
            if (!sid) return;
            $(`#${sid}-lbl`).text(String($(this).val() ?? ""));
            const key = sid.replace("pref-w-", "") + "_weight";
            editCard[key] = clampFieldWeight($(this).val());
        });
        
        $("#btn-pref-close, #btn-pref-save").on("click", function() {
            editCard.likes_weight = clampFieldWeight($("#pref-w-likes").val());
            editCard.dislikes_weight = clampFieldWeight($("#pref-w-dislikes").val());
            editCard.needs_weight = clampFieldWeight($("#pref-w-needs").val());
            editCard.wants_weight = clampFieldWeight($("#pref-w-wants").val());
            
            $("#ce-pref-editor").remove();
        });
    }

    function parseStandings(standingsStr) {
        const list = [];
        if (!standingsStr) return list;
        standingsStr.split(",").forEach(part => {
            const colonIdx = part.indexOf(":");
            if (colonIdx >= 0) {
                const name = part.slice(0, colonIdx).trim();
                const val = part.slice(colonIdx + 1).trim();
                if (name) list.push({ faction: name, standing: val });
            } else {
                const name = part.trim();
                if (name) list.push({ faction: name, standing: "" });
            }
        });
        return list;
    }

    function renderFactionsList() {
        const $list = $("#ce-factions-list");
        if (!$list.length) return;
        $list.empty();

        const s = getSettings();
        const factionsSettingsList = (s.factions && Array.isArray(s.factions.list)) ? s.factions.list : [];
        const cardStandings = parseStandings(editCard.standings);

        if (factionsSettingsList.length === 0 && cardStandings.length === 0) {
            $list.append(`<div style="font-size:12px; font-style:italic; color:#8b6f47;">No factions defined in settings. Create factions first in the main game menu.</div>`);
            $("#ce-faction-add").prop("disabled", true).css("opacity", 0.5);
            return;
        }
        $("#ce-faction-add").prop("disabled", false).css("opacity", 1);

        cardStandings.forEach((item, idx) => {
            const uniqueFactions = Array.from(new Set([...factionsSettingsList.map(f => f.name), item.faction])).filter(Boolean);
            const optionsHtml = uniqueFactions.map(fName => 
                `<option value="${escAttr(fName)}" ${fName === item.faction ? "selected" : ""}>${escHtml(fName)}</option>`
            ).join("");

            const rowHtml = `
                <div class="faction-standing-row" style="display:flex; gap:8px; align-items:center;">
                    <select class="ce-select faction-select" style="flex:1;">
                        ${optionsHtml}
                    </select>
                    <input type="text" class="ce-input faction-standing" style="flex:1;" placeholder="e.g. Friendly, Neutral" value="${escAttr(item.standing)}">
                    <button type="button" class="ce-header-btn faction-del" style="background:#dc3545; border-color:#bd2130; padding:4px 8px; line-height:1;">×</button>
                </div>
            `;
            const $row = $(rowHtml);

            $row.find(".faction-select, .faction-standing").on("change input", function() {
                updateFactionsMemory();
            });

            $row.find(".faction-del").on("click", function() {
                $row.remove();
                updateFactionsMemory();
            });

            $list.append($row);
        });

        function updateFactionsMemory() {
            const list = [];
            $("#ce-factions-list .faction-standing-row").each(function() {
                const fac = $(this).find(".faction-select").val();
                const std = $(this).find(".faction-standing").val().trim();
                if (fac) list.push({ faction: fac, standing: std });
            });
            editCard.factions = list.map(x => x.faction);
            editCard.standings = list.map(x => `${x.faction}: ${x.standing}`).join(", ");
        }

        $("#ce-faction-add").off("click").on("click", function() {
            if (factionsSettingsList.length === 0) {
                alert("Please define factions in game settings first!");
                return;
            }
            const defaultFaction = factionsSettingsList[0].name;
            const currentStandings = parseStandings(editCard.standings);
            currentStandings.push({ faction: defaultFaction, standing: "Neutral" });
            editCard.standings = currentStandings.map(x => `${x.faction}: ${x.standing}`).join(", ");
            renderFactionsList();
        });
    }
    function openImagePicker(onSelect) {
        $("#ce-image-picker-overlay").remove();
        const gallery = Array.isArray(editCard.portrait_gallery) ? editCard.portrait_gallery : [];
        
        let galleryHtml = "";
        if (gallery.length > 0) {
            galleryHtml = gallery.map(img => 
                `<div class="picker-gallery-item" data-url="${escAttr(img.url)}" style="width:50px; height:50px; border:1.5px solid #5c3a21; border-radius:4px; overflow:hidden; cursor:pointer; flex-shrink:0;">
                    <img src="${img.url}" style="width:100%; height:100%; object-fit:cover;">
                 </div>`
            ).join("");
        } else {
            galleryHtml = `<div style="font-size:11px; font-style:italic; color:#8b6f47;">Gallery is empty. Upload portraits in Profile tab.</div>`;
        }
        
        const html = `
            <div id="ce-image-picker-overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2147483647; display:grid; place-items:center;">
                <div style="background:#fcf5eb; border:4px double #5c3a21; border-radius:8px; padding:16px; width:280px; font-family:'Georgia', serif; color:#3a2211; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                    <h4 style="margin:0 0 12px 0; text-align:center; font-size:14px; border-bottom:2px solid #5c3a21; padding-bottom:4px; font-weight:bold;">CHOOSE IMAGE</h4>
                    
                    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
                        <button type="button" class="ce-header-btn" id="btn-picker-upload" style="width:100%; justify-content:center;">📤 Upload File</button>
                        <button type="button" class="ce-header-btn" id="btn-picker-url" style="width:100%; justify-content:center;">🔗 Enter URL</button>
                        <input type="file" id="picker-file-input" accept="image/*" style="display:none;">
                    </div>
                    
                    <label class="ce-label" style="font-size:10px; margin-bottom:4px;">PORTRAIT GALLERY</label>
                    <div style="display:flex; flex-wrap:wrap; gap:6px; max-height:110px; overflow-y:auto; border:2.5px solid #5c3a21; padding:6px; background:#fffdf9; border-radius:4px; margin-bottom:14px;">
                        ${galleryHtml}
                    </div>
                    
                    <div style="display:flex; justify-content:flex-end;">
                        <button type="button" class="ce-header-btn" id="btn-picker-cancel" style="background:#dc3545; border-color:#bd2130; padding:4px 10px; font-size:11px;">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        
        $("body").append(html);
        
        $("#btn-picker-cancel").on("click", () => {
            $("#ce-image-picker-overlay").remove();
            onSelect(null);
        });
        
        $("#btn-picker-url").on("click", () => {
            const url = prompt("Enter image URL:");
            $("#ce-image-picker-overlay").remove();
            if (url) onSelect(url.trim());
            else onSelect(null);
        });
        
        $("#btn-picker-upload").on("click", () => {
            $("#picker-file-input").trigger("click");
        });
        
        $("#picker-file-input").on("change", async function() {
            const file = this.files && this.files[0];
            if (!file) return;
            try {
                const dataUrl = await readFileAsDataUrl(file);
                $("#ce-image-picker-overlay").remove();
                onSelect(dataUrl);
            } catch (error) {
                alert("Failed to read file.");
                $("#ce-image-picker-overlay").remove();
                onSelect(null);
            }
        });
        
        $(".picker-gallery-item").on("click", function() {
            const url = $(this).data("url");
            $("#ce-image-picker-overlay").remove();
            onSelect(url);
        });
    }

    function renderAgeStageGrids() {
        if (!editCard.ageStageExpressions || typeof editCard.ageStageExpressions !== "object") {
            editCard.ageStageExpressions = {};
        }
        const stages = ["baby_toddler", "child", "teen", "young_adult", "adult", "elder"];
        
        stages.forEach((stg) => {
            const $g = $(`#age-grid-${stg}`);
            if (!$g.length) return;
            $g.empty();
            
            if (!Array.isArray(editCard.ageStageExpressions[stg])) {
                editCard.ageStageExpressions[stg] = [];
            }
            
            const list = editCard.ageStageExpressions[stg];
            list.forEach((expr, idx) => {
                const url = String(expr.url || "").trim();
                const name = String(expr.name || "").trim();
                
                const tileHtml = `
                    <div class="age-stage-tile" data-stage="${stg}" data-idx="${idx}" style="position:relative; width:90px; padding:6px; box-sizing:border-box;">
                        <button type="button" class="age-stage-del" data-stage="${stg}" data-idx="${idx}" style="position:absolute; top:2px; right:2px; background:#dc3545; color:#fff; border:1px solid #5c3a21; border-radius:2px; font-size:10px; padding:0 4px; cursor:pointer; z-index:5;">×</button>
                        ${url ? `<img class="age-stage-thumb" src="${url}" style="width:100%; height:70px; object-fit:cover; border:2px solid #5c3a21; border-radius:4px; cursor:pointer;" title="Click to change image">` 
                              : `<div class="age-stage-plus" style="width:100%; height:70px; display:grid; place-items:center; border:2px dashed #5c3a21; border-radius:4px; font-size:9px; background:rgba(0,0,0,0.02); cursor:pointer;" title="Click to select image">No Image</div>`}
                        <input type="text" class="age-stage-input-name" data-stage="${stg}" data-idx="${idx}" value="${escAttr(name)}" style="width:100%; margin-top:4px; padding:2px; font-size:9px; font-family:'Georgia', serif; border:2px solid #5c3a21; text-align:center; box-sizing:border-box;" placeholder="Name">
                    </div>
                `;
                const $tile = $(tileHtml);
                
                $tile.find(".age-stage-input-name").on("input", function() {
                    expr.name = $(this).val();
                });
                
                $tile.find(".age-stage-thumb, .age-stage-plus").on("click", function(e) {
                    if ($(e.target).hasClass("age-stage-del")) return;
                    openImagePicker(url => {
                        if (url) {
                            expr.url = url;
                            renderAgeStageGrids();
                        }
                    });
                });
                
                $tile.find(".age-stage-del").on("click", function() {
                    list.splice(idx, 1);
                    renderAgeStageGrids();
                });
                
                $g.append($tile);
            });
            
            const $plusTile = $(`<div class="age-stage-tile age-stage-plus" data-stage="${stg}" style="width:90px; height:90px; display:flex; flex-direction:column; align-items:center; justify-content:center; border:2px dashed #5c3a21; border-radius:4px; cursor:pointer; background:rgba(0,0,0,0.02);" title="Add expression"><span style="font-size:20px; font-weight:bold; color:#5c3a21;">+</span><span style="font-size:9px; color:#5c3a21;">Add</span></div>`);
            $plusTile.on("click", function() {
                const name = prompt("Enter name of new expression (e.g. Happy, Serious):", "Default");
                if (name === null) return;
                const cleanName = name.trim() || "Default";
                
                openImagePicker(url => {
                    list.push({ name: cleanName, url: url || "" });
                    renderAgeStageGrids();
                });
            });
            $g.append($plusTile);
        });
    }

    function openUploadChooser() {
        const html = `
            <div id="ce-upload-chooser-overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2147483647; display:grid; place-items:center;">
                <div style="background:#fcf5eb; border:4px double #5c3a21; border-radius:8px; padding:16px; width:280px; font-family:'Georgia', serif; color:#3a2211; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                    <h4 style="margin:0 0 12px 0; font-size:14px; border-bottom:2px solid #5c3a21; padding-bottom:4px; font-weight:bold;">UPLOAD SPRITES</h4>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <button type="button" class="ce-header-btn" id="btn-choose-images" style="justify-content:center;">🖼 Select Image File(s)</button>
                        <button type="button" class="ce-header-btn" id="btn-choose-zip" style="justify-content:center;">📦 Select ZIP Pack</button>
                        <button type="button" class="ce-header-btn" id="btn-choose-cancel" style="background:#dc3545; border-color:#bd2130; justify-content:center;">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        $("body").append(html);
        $("#btn-choose-images").on("click", () => {
            $("#ce-upload-chooser-overlay").remove();
            $("#ce-exp-files").trigger("click");
        });
        $("#btn-choose-zip").on("click", () => {
            $("#ce-upload-chooser-overlay").remove();
            $("#ce-exp-zip").trigger("click");
        });
        $("#btn-choose-cancel").on("click", () => {
            $("#ce-upload-chooser-overlay").remove();
        });
    }

    $("#ce-click-upload-pack").on("click", function(e) {
        if ($(e.target).closest("input").length) return;
        openUploadChooser();
    });

    renderPrefLists();
    renderFactionsList();
    renderAgeStageGrids();

    $('#btn-add-exp').click(() => {
        if (!editCard.expressions) editCard.expressions = [];
        editCard.expressions.push({ name: "neutral", emoji: "😐", intensity: 1, sprites: [] });
        renderExps();
    });

    $('#btn-exp-defaults').click(() => {
        const have = new Set((editCard.expressions || []).map(e => normalizeExpressionName(e?.name)));
        DEFAULT_EXPRESSIONS.forEach((nm) => {
            if (have.has(normalizeExpressionName(nm))) return;
            editCard.expressions.push({ name: nm, emoji: "😐", intensity: 1, sprites: [] });
        });
        renderExps();
    });

    $('#ce-exp-files').on('change', async function() {
        const files = Array.from(this.files || []);
        if (!files.length) return;
        for (const f of files) {
            const base = String(f.name || "").replace(/\.[^/.]+$/, "");
            const exp = upsertExpression(editCard, base);
            try {
                const src = await readFileAsDataUrl(f);
                exp.sprites.push({ name: String(f.name || "sprite"), src });
            } catch (_) {}
        }
        renderExps();
        this.value = "";
    });

    $('#ce-exp-zip').on('change', async function() {
        const zf = this.files && this.files[0];
        if (!zf) return;
        try {
            const JSZip = await ensureJsZip();
            const zip = await JSZip.loadAsync(zf);
            const entries = Object.values(zip.files || {});
            for (const ent of entries) {
                if (ent.dir) continue;
                if (String(ent.name || "").includes("/")) continue;
                if (!/\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(ent.name || "")) continue;
                const base = String(ent.name || "").replace(/\.[^/.]+$/, "");
                const exp = upsertExpression(editCard, base);
                const blob = await ent.async("blob");
                const src = await readFileAsDataUrl(new File([blob], ent.name, { type: blob.type || "image/png" }));
                exp.sprites.push({ name: String(ent.name || "sprite"), src });
            }
            renderExps();
        } catch (e) {
            alert(`ZIP import failed: ${String(e?.message || e)}`);
        } finally {
            this.value = "";
        }
    });

    // Slideshow control hooks
    $("#btn-play-expr").on("click", function() {
        if (slideshowIsPlaying) {
            stopSlideshow();
        } else {
            startSlideshow();
        }
    });

    $("#btn-prev-expr").on("click", function() {
        stopSlideshow();
        slideshowIndex--;
        updateSlideshow();
    });

    $("#btn-next-expr").on("click", function() {
        stopSlideshow();
        slideshowIndex++;
        updateSlideshow();
    });

    // Auto-start slideshow
    updateSlideshow();
    startSlideshow();

    // Clean up slideshow timer on cancel/close/save
    function cleanupSlideshow() {
        if (slideshowIntervalId) {
            clearInterval(slideshowIntervalId);
            slideshowIntervalId = null;
        }
    }

    // Register cleanup callback on the editor element
    $("#uie-card-editor").data("cleanup", cleanupSlideshow);
    $("#btn-next-expr").on("click", function() {
        stopSlideshow();
        slideshowIndex++;
        updateSlideshow();
    });

    // Auto-start slideshow
    updateSlideshow();
    startSlideshow();

    // Clean up slideshow timer on cancel/close/save
    function cleanupSlideshow() {
        if (slideshowIntervalId) {
            clearInterval(slideshowIntervalId);
            slideshowIntervalId = null;
        }
    }

    // Register cleanup callback on the editor element
    $("#uie-card-editor").data("cleanup", cleanupSlideshow);

    $("#btn-ce-cancel").on("click", () => {
        cleanupSlideshow();
    });

    // Save Logic
    $("#btn-ce-save").on("click", () => {
        cleanupSlideshow();
        readEditorIntoCard(editCard);

        saveCard(editCard);
        $("#uie-card-editor").remove();
        $("#uie-card-manager").remove();
        try {
            if (typeof window.__UIE_afterCharacterCardsSaved === "function") window.__UIE_afterCharacterCardsSaved();
        } catch (_) {}
        renderCardManager();
    });

    renderCardPortraitGallery();
}

// Character Generator Modal System
function showCharacterGeneratorModal() {
    // Create modal if it doesn't exist
    if (!$("#uie-character-generator-modal").length) {
        $("body").append(`
            <div id="uie-character-generator-modal" style="display:none; position:fixed; inset:0; background:rgba(57,34,20,0.34); z-index:2147483647; align-items:center; justify-content:center; padding:20px;">
                <div class="uie-char-gen-shell" style="background:#fff8ed; border:1px solid rgba(151,91,39,0.46); border-radius:12px; padding:20px; color:#392214; box-shadow:0 20px 50px rgba(57,34,20,0.28); max-height:90vh; overflow-y:auto;">
                    <h3 style="margin:0 0 12px 0; color:#5c3a21;">Visual Card Generator</h3>
                    <div class="uie-char-gen-layout">
                        <div>
                            <div style="display:grid; gap:12px;">
                                <label style="display:block; font-weight:bold;">Card Nature
                                    <input id="uie-char-gen-nature" value="Character" placeholder="Character, companion, rival, vendor, deity, faction avatar..." style="width:100%; margin-top:5px; border:1px solid #b97a43; border-radius:8px; background:#fffdf9; color:#2f1a0e; padding:10px; font-size:14px;">
                                </label>
                                <label style="display:block; font-weight:bold;">Description
                                    <textarea id="uie-char-gen-input" placeholder="Example: A tough detective in a noir setting, cynical but with a heart of gold, always wears a trench coat" style="width:100%; height:118px; margin-top:5px; border:1px solid #b97a43; border-radius:8px; background:#fffdf9; color:#2f1a0e; padding:10px; resize:vertical; outline:none; font-size:14px;"></textarea>
                                </label>
                                <div class="uie-char-gen-image-row">
                                    <button id="uie-char-gen-upload-image" style="padding:10px; border:none; border-radius:8px; background:#8e5431; color:#fffdf9; font-weight:bold; cursor:pointer;"><i class="fa-solid fa-image"></i> Choose Image</button>
                                    <button id="uie-char-gen-url-image" style="padding:10px; border:none; border-radius:8px; background:#8e5431; color:#fffdf9; font-weight:bold; cursor:pointer;"><i class="fa-solid fa-link"></i> Image URL</button>
                                    <input type="file" id="uie-char-gen-image-file" accept="image/*" style="display:none;">
                                </div>
                                <button id="uie-char-gen-random-voice" style="width:100%; padding:10px; border:none; border-radius:8px; background:#8e5431; color:#fffdf9; font-weight:bold; cursor:pointer;"><i class="fa-solid fa-shuffle"></i> Generate Random Voice</button>
                                <div id="uie-char-gen-voice-status" style="font-size:12px; opacity:0.8;"></div>
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                    <input type="checkbox" id="uie-char-gen-image" style="width:16px; height:16px;">
                                    <span>Generate portrait if no image is chosen</span>
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                    <input type="checkbox" id="uie-char-gen-full" style="width:16px; height:16px;" checked>
                                    <span>Generate complete card fields</span>
                                </label>
                            </div>
                        </div>
                        <div>
                            <div id="uie-char-gen-content"></div>
                            <div id="uie-char-gen-preview" style="display:none;"></div>
                        </div>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:15px; flex-wrap:wrap;">
                        <button id="uie-char-gen-generate" style="flex:1; padding:10px; border:none; border-radius:8px; background:#cba35c; color:#000; font-weight:bold; cursor:pointer;">Generate Character</button>
                        <button id="uie-char-regenerate" style="flex:1; padding:10px; border:none; border-radius:8px; background:#3498db; color:#fff; font-weight:bold; cursor:pointer; display:none;">Regenerate</button>
                        <button id="uie-char-gen-create" style="flex:1; padding:10px; border:none; border-radius:8px; background:#27ae60; color:#fff; font-weight:bold; cursor:pointer; display:none;">Create Card</button>
                        <button id="uie-char-gen-cancel" style="flex:1; padding:10px; border:none; border-radius:8px; background:#e74c3c; color:#fff; font-weight:bold; cursor:pointer;">Cancel</button>
                    </div>
                </div>
            </div>
        `);
        
        // Add event handlers
        $(document).on("click.uieCharGen", "#uie-char-gen-random-voice", async () => {
            const recipe = randomSemanticVoiceRecipe();
            $("#uie-character-generator-modal").data("voiceRecipe", recipe);
            const current = $("#uie-char-gen-content").data("characterData") || {};
            current.voice_recipe = recipe;
            current.voiceRecipe = recipe;
            current.tts = { ...(current.tts && typeof current.tts === "object" ? current.tts : {}), voice_recipe: recipe };
            $("#uie-char-gen-content").data("characterData", current);
            $("#uie-char-gen-voice-status").text("Random voice locked to this generated card. Playing sample...");
            await previewCardVoiceRecipe(recipe, String(current.name || "this character"));
        });

        $(document).on("input.uieCharGen change.uieCharGen", "#uie-char-gen-input, #uie-char-gen-nature", () => {
            const current = $("#uie-char-gen-content").data("characterData") || generatorDraftFromInputs();
            displayCharacterPreview({ ...current, ...generatorDraftFromInputs(), avatar: current.avatar || current.image || "" });
        });

        $(document).on("click.uieCharGen", "#uie-char-gen-upload-image", (e) => {
            e.preventDefault();
            $("#uie-char-gen-image-file").trigger("click");
        });

        $(document).on("change.uieCharGen", "#uie-char-gen-image-file", async function() {
            const file = this.files && this.files[0];
            this.value = "";
            if (!file) return;
            try {
                const dataUrl = await readFileAsDataUrl(file);
                const current = $("#uie-char-gen-content").data("characterData") || generatorDraftFromInputs();
                current.avatar = dataUrl;
                current.image = dataUrl;
                current.portrait_gallery = [{ id: createUUID(), url: dataUrl, name: file.name || "chosen-image" }];
                displayCharacterPreview(current);
            } catch (error) {
                alert("Failed to read image file. Please try again.");
            }
        });

        $(document).on("click.uieCharGen", "#uie-char-gen-url-image", (e) => {
            e.preventDefault();
            const url = prompt("Enter image URL:");
            if (!url) return;
            const current = $("#uie-char-gen-content").data("characterData") || generatorDraftFromInputs();
            current.avatar = url.trim();
            current.image = url.trim();
            current.portrait_gallery = [{ id: createUUID(), url: url.trim(), name: "linked-image" }];
            displayCharacterPreview(current);
        });

        $(document).on("click.uieCharGen", "#uie-char-gen-generate", async () => {
            const description = $("#uie-char-gen-input").val().trim();
            if (!description) return;
            
            const s = getSettings();
            const turboEnabled = !!(s.turbo && s.turbo.enabled);
            const generateImage = $("#uie-char-gen-image").is(":checked");
            const generateFull = $("#uie-char-gen-full").is(":checked");
            
            try {
                // Show loading state
                $("#uie-char-gen-generate").text("Generating...").prop("disabled", true);
                
                // Generate character using Turbo API if available, otherwise fallback
                const nature = $("#uie-char-gen-nature").val().trim() || "Character";
                const existing = $("#uie-char-gen-content").data("characterData") || {};
                const characterData = await generateCharacterData(description, turboEnabled, generateImage, generateFull, nature);
                const lockedVoice = String($("#uie-character-generator-modal").data("voiceRecipe") || "").trim();
                if (lockedVoice) {
                    characterData.voice_recipe = lockedVoice;
                    characterData.voiceRecipe = lockedVoice;
                    characterData.tts = { ...(characterData.tts && typeof characterData.tts === "object" ? characterData.tts : {}), voice_recipe: lockedVoice };
                }
                if (existing.avatar || existing.image) {
                    characterData.avatar = existing.avatar || existing.image;
                    characterData.image = characterData.avatar;
                    characterData.portrait_gallery = existing.portrait_gallery || [{ id: createUUID(), url: characterData.avatar, name: "chosen-image" }];
                } else if (generateImage) {
                    await attachGeneratedCardImage(characterData, description, nature);
                }
                
                // Display preview
                displayCharacterPreview(characterData);
                
                // Show create and regenerate buttons
                $("#uie-char-gen-create").show();
                $("#uie-char-regenerate").show();
                $("#uie-char-gen-generate").text("Generate Character").prop("disabled", false);
                
            } catch (error) {
                console.error("Failed to generate character:", error);
                $("#uie-char-gen-generate").text("Generate Character").prop("disabled", false);
            }
        });
        
        $(document).on("click.uieCharGen", "#uie-char-regenerate", async () => {
            $("#uie-char-regenerate").text("Regenerating...").prop("disabled", true);
            const description = $("#uie-char-gen-input").val().trim();
            if (description) {
                const s = getSettings();
                const turboEnabled = !!(s.turbo && s.turbo.enabled);
                const generateImage = $("#uie-char-gen-image").is(":checked");
                const generateFull = $("#uie-char-gen-full").is(":checked");
                const nature = $("#uie-char-gen-nature").val().trim() || "Character";
                const existing = $("#uie-char-gen-content").data("characterData") || {};
                const characterData = await generateCharacterData(description, turboEnabled, generateImage, generateFull, nature);
                const lockedVoice = String($("#uie-character-generator-modal").data("voiceRecipe") || "").trim();
                if (lockedVoice) {
                    characterData.voice_recipe = lockedVoice;
                    characterData.voiceRecipe = lockedVoice;
                    characterData.tts = { ...(characterData.tts && typeof characterData.tts === "object" ? characterData.tts : {}), voice_recipe: lockedVoice };
                }
                if (existing.avatar || existing.image) {
                    characterData.avatar = existing.avatar || existing.image;
                    characterData.image = characterData.avatar;
                    characterData.portrait_gallery = existing.portrait_gallery || [{ id: createUUID(), url: characterData.avatar, name: "chosen-image" }];
                } else if (generateImage) {
                    await attachGeneratedCardImage(characterData, description, nature);
                }
                displayCharacterPreview(characterData);
            }
            $("#uie-char-regenerate").text("Regenerate").prop("disabled", false);
        });
        
        $(document).on("click.uieCharGen", "#uie-char-gen-create", () => {
            const characterData = $("#uie-char-gen-content").data("characterData");
            if (characterData) {
                createCharacterCard(characterData);
                $("#uie-character-generator-modal").hide();
                resetCharacterGeneratorModal();
            }
        });
        
        $(document).on("click.uieCharGen", "#uie-char-gen-cancel", () => {
            $("#uie-character-generator-modal").hide();
            resetCharacterGeneratorModal();
        });
        
        $(document).on("click.uieCharGen", "#uie-character-generator-modal", (e) => {
            if (e.target === e.currentTarget) {
                $("#uie-character-generator-modal").hide();
                resetCharacterGeneratorModal();
            }
        });
    }
    
    // Show modal
    $("#uie-character-generator-modal").show();
    resetCharacterGeneratorModal();
    displayCharacterPreview(generatorDraftFromInputs());
}

function resetCharacterGeneratorModal() {
    $("#uie-char-gen-input").val("");
    $("#uie-char-gen-nature").val("Character");
    $("#uie-char-gen-image").prop("checked", false);
    $("#uie-char-gen-preview").hide();
    $("#uie-char-gen-content").empty().removeData("characterData");
    $("#uie-char-gen-voice-status").text("");
    $("#uie-character-generator-modal").removeData("voiceRecipe");
    $("#uie-char-gen-generate").text("Generate Character").prop("disabled", false);
    $("#uie-char-regenerate").hide();
    $("#uie-char-gen-create").hide();
}

function generatorDraftFromInputs() {
    const nature = String($("#uie-char-gen-nature").val() || "Character").trim() || "Character";
    const description = String($("#uie-char-gen-input").val() || "").trim();
    return {
        name: description ? "Preview Card" : "New Card",
        role: nature,
        cardNature: nature,
        description: description || "Your generated card will appear here as you build it.",
        personality: "",
        background: "",
        likes: "",
        dislikes: "",
        needs: "",
        wants: "",
        hooks: "",
        rules: ""
    };
}

async function attachGeneratedCardImage(characterData, description, nature = "Character") {
    try {
        const prompt = await generateCardImagePrompt(characterData, description, nature);
        const { generateImageAPI } = await import("./imageGen.js");
        const dataUrl = await generateImageAPI(prompt, { mode: "you" });
        if (!dataUrl) return;
        characterData.avatar = dataUrl;
        characterData.image = dataUrl;
        characterData.portrait_gallery = [{ id: createUUID(), url: dataUrl, name: `${characterData.name || "card"}_${Date.now()}.png` }];
    } catch (error) {
        console.warn("[CharacterCards] Card image generation failed:", error);
    }
}

async function generateCardImagePrompt(characterData, description, nature = "Character") {
    const visualText = [
        characterData?.description,
        characterData?.personality,
        characterData?.background,
        description
    ].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
    return `Visual novel ${nature.toLowerCase()} card portrait of ${characterData?.name || "a generated card subject"}: ${visualText || "distinctive design"}, clear readable silhouette, expressive face, polished character card art, high detail, no text, no watermark.`;
}

async function generateCharacterData(description, useTurbo = true, generateImage = false, generateFull = true, nature = "Character") {
    const s = getSettings();
    const turboEnabled = useTurbo && !!(s.turbo && s.turbo.enabled);
    
    let prompt;
    if (generateFull) {
        prompt = `Generate a detailed ${nature} card based on this description: "${description}"
        
        Create a JSON object with the following fields:
        - name: Character name
        - role: Role, type, or occupation
        - cardNature: The card nature/category
        - description: Detailed physical appearance and personality
        - personality: Key personality traits
        - background: Brief backstory
        - likes: Things the character likes (comma separated)
        - dislikes: Things the character dislikes (comma separated)
        - needs: What the character needs or wants
        - wants: Specific goals or desires
        - hooks: Story hooks or interesting facts
        - rules: Character rules or constraints
        
        Format as valid JSON only, no additional text.`;
    } else {
        prompt = `Generate basic ${nature} card information based on this description: "${description}"
        
        Create a JSON object with the following fields only:
        - name: Card subject name
        - role: Role, type, or occupation
        - cardNature: The card nature/category
        - description: Brief physical appearance and personality
        
        Format as valid JSON only, no additional text.`;
    }
    
    if (turboEnabled) {
        try {
            const { generateContent } = await import("./apiClient.js");
            const response = await generateContent(prompt, "character_generation");
            const text = typeof response === "string" ? response : (response?.choices?.[0]?.message?.content || response?.content || "");
            return { cardNature: nature, ...parseCharacterData(text, generateFull, nature) };
        } catch (error) {
            console.error("Turbo API failed, falling back to local generation:", error);
        }
    }
    
    // Fallback to local generation
    return generateCharacterFallback(description, generateFull, nature);
}

function parseCharacterData(text, generateFull = true, nature = "Character") {
    try {
        // Try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (error) {
        console.error("Failed to parse character JSON:", error);
    }
    
    // Fallback if JSON parsing fails
    return generateCharacterFallback(text, generateFull, nature);
}

function generateCharacterFallback(description, generateFull = true, nature = "Character") {
    if (generateFull) {
        return {
            name: "Generated Character",
            role: nature,
            cardNature: nature,
            description: `A character based on: ${description}`,
            personality: "Mysterious, complex",
            background: "Unknown background",
            likes: "Adventure, mystery",
            dislikes: "Boredom, routine",
            needs: "Purpose, connection",
            wants: "To discover their true calling",
            hooks: "Has a secret past",
            rules: "Always tells the truth, never breaks promises"
        };
    } else {
        return {
            name: "Generated Character",
            role: nature,
            cardNature: nature,
            description: `A character based on: ${description}`
        };
    }
}

function displayCharacterPreview(characterData) {
    const avatar = String(characterData.avatar || characterData.image || "").trim();
    const artStyle = avatar ? `background-image:url(${JSON.stringify(avatar)});` : "";
    const chips = [
        characterData.cardNature || "Character",
        characterData.personality ? "Personality" : "",
        characterData.background ? "Backstory" : "",
        characterData.voice_recipe || characterData.voiceRecipe ? "Voice" : ""
    ].filter(Boolean);
    const preview = `
        <div class="uie-char-gen-preview-card">
            <div class="uie-char-gen-art" style="${artStyle}">${avatar ? "" : '<i class="fa-solid fa-address-card"></i>'}</div>
            <div class="uie-char-gen-body">
                <div class="uie-char-gen-name">${escHtml(characterData.name || "Unnamed")}</div>
                <div class="uie-char-gen-role">${escHtml(characterData.role || characterData.cardNature || "Card")}</div>
                <div class="uie-char-gen-desc">${escHtml(characterData.description || "No description yet.")}</div>
                <div class="uie-char-gen-chips">${chips.map((chip) => `<span class="uie-char-gen-chip">${escHtml(chip)}</span>`).join("")}</div>
                ${(characterData.personality || characterData.background || characterData.hooks) ? `
                    <div style="margin-top:12px;display:grid;gap:7px;font-size:11px;line-height:1.35;">
                        ${characterData.personality ? `<div><strong>Personality:</strong> ${escHtml(characterData.personality)}</div>` : ""}
                        ${characterData.background ? `<div><strong>Background:</strong> ${escHtml(characterData.background)}</div>` : ""}
                        ${characterData.hooks ? `<div><strong>Hook:</strong> ${escHtml(characterData.hooks)}</div>` : ""}
                    </div>
                ` : ""}
            </div>
        </div>
    `;
    
    $("#uie-char-gen-content").html(preview).data("characterData", characterData);
    $("#uie-char-gen-preview").show();
}

function createCharacterCard(characterData) {
    const newCard = {
        id: createUUID(),
        name: characterData.name || "Generated Character",
        role: characterData.role || "Unknown",
        cardNature: characterData.cardNature || characterData.nature || "Character",
        description: characterData.description || "",
        personality: characterData.personality || "",
        background: characterData.background || "",
        likes: characterData.likes || "",
        dislikes: characterData.dislikes || "",
        needs: characterData.needs || "",
        wants: characterData.wants || "",
        hooks: characterData.hooks || "",
        rules: characterData.rules || "",
        avatar: characterData.avatar || characterData.image || "",
        voice_recipe: characterData.voice_recipe || characterData.voiceRecipe || "",
        voiceRecipe: characterData.voice_recipe || characterData.voiceRecipe || "",
        personality: characterData.personality || "",
        background: characterData.background || "",
        likes: characterData.likes || "",
        dislikes: characterData.dislikes || "",
        needs: characterData.needs || "",
        wants: characterData.wants || "",
        hooks: characterData.hooks || "",
        rules: characterData.rules || "",
        avatar: characterData.avatar || characterData.image || "",
        voice_recipe: characterData.voice_recipe || characterData.voiceRecipe || "",
        voiceRecipe: characterData.voice_recipe || characterData.voiceRecipe || "",
        tts: { voice_recipe: characterData.voice_recipe || characterData.voiceRecipe || "" },
        portrait_gallery: Array.isArray(characterData.portrait_gallery) ? characterData.portrait_gallery : (characterData.avatar || characterData.image ? [{ id: createUUID(), url: characterData.avatar || characterData.image, name: "card-image" }] : []),
        expressions: [],
        data: {}
    };
    
    saveCard(newCard);
    
    // Show success message
    try {
        import("./notifications.js")
            .then(({ notify }) => {
                notify("success", `Character "${newCard.name}" created successfully!`, "Character Generator");
            })
            .catch(() => {});
    } catch (_) {}
    
    // Refresh the character cards manager
    renderCardManager();
}
