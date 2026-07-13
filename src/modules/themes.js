// Theme Management System
import { getSettings, saveSettings } from "./core.js";

// Helper functions that should be available globally
function ensureUiSettings() {
    return getSettings();
}

function showToast(message, duration = 3000) {
    // Simple toast implementation
    console.log(`[Toast] ${message}`);
    // You can implement a proper toast UI later
}

export function getThemes() {
    const s = ensureUiSettings();
    return s.themes || {};
}

export function getActiveTheme() {
    const s = ensureUiSettings();
    return s.activeTheme || 'default';
}

export function saveTheme(themeName, themeData) {
    const s = ensureUiSettings();
    if (!s.themes) s.themes = {};
    s.themes[themeName] = themeData;
    saveSettings();
    showToast(`Theme "${themeName}" saved.`);
}

export function deleteTheme(themeName) {
    const s = ensureUiSettings();
    if (!s.themes) return;
    if (themeName === 'default') {
        showToast("Cannot delete the default theme.");
        return;
    }
    delete s.themes[themeName];
    
    // If active theme was deleted, switch to default
    if (s.activeTheme === themeName) {
        s.activeTheme = 'default';
        applyTheme('default');
    }
    
    saveSettings();
    showToast(`Theme "${themeName}" deleted.`);
}

export function applyTheme(themeName) {
    const s = ensureUiSettings();
    const themes = s.themes || {};
    const theme = themes[themeName];
    
    if (!theme) {
        console.warn(`Theme "${themeName}" not found.`);
        return;
    }
    
    // Remove existing theme styles
    $('#uie-custom-theme-styles').remove();
    
    // Apply new theme styles
    const css = generateThemeCSS(theme);
    $('head').append(`<style id="uie-custom-theme-styles">${css}</style>`);
    
    // Update active theme
    s.activeTheme = themeName;
    saveSettings();
    
    showToast(`Applied theme: ${themeName}`);
}

function generateThemeCSS(theme) {
    let css = '';
    
    // Custom fonts
    if (theme.fontFamily) {
        css += `body, .modal-card, .reply-menu-item, button, input, select, textarea {
            font-family: ${theme.fontFamily} !important;
        }\n`;
    }
    
    // Custom text colors
    if (theme.textColor) {
        css += `body, .modal-card, .reply-menu-item, button, input, select, textarea, .ce-label, .ce-input, .ce-textarea, .ce-select {
            color: ${theme.textColor} !important;
        }\n`;
    }
    
    // Custom background colors
    if (theme.backgroundColor) {
        css += `body, .modal-card, .reply-menu-panel {
            background-color: ${theme.backgroundColor} !important;
        }\n`;
    }
    
    // Custom button colors
    if (theme.buttonColor) {
        css += `button, .reply-tool-btn, .reply-menu-item, .ce-header-btn {
            background-color: ${theme.buttonColor} !important;
            border-color: ${theme.buttonColor} !important;
        }\n`;
    }
    
    // Custom accent colors
    if (theme.accentColor) {
        css += `.reply-tool-btn:hover, .reply-menu-item:hover, .ce-header-btn:hover {
            background-color: ${theme.accentColor} !important;
            border-color: ${theme.accentColor} !important;
        }\n`;
        
        css += `button:active, .reply-tool-btn:active {
            background-color: ${theme.accentColor} !important;
            opacity: 0.8;
        }\n`;
    }
    
    // Custom border colors
    if (theme.borderColor) {
        css += `.modal-card, .reply-menu-panel, .ce-input, .ce-textarea, .ce-select {
            border-color: ${theme.borderColor} !important;
        }\n`;
    }

    // Global Custom CSS
    if (theme.customCss) {
        css += `\n/* Custom CSS */\n${theme.customCss}\n`;
    }

    // Custom link colors
    if (theme.linkColor) {
        css += `a, a:link, a:visited {
            color: ${theme.linkColor} !important;
        }\n`;
        
        css += `a:hover {
            color: ${theme.accentColor || theme.linkColor} !important;
        }\n`;
    }
    
    // Custom header colors
    if (theme.headerColor) {
        css += `h1, h2, h3, h4, h5, h6 {
            color: ${theme.headerColor} !important;
        }\n`;
    }
    
    // Custom code block colors
    if (theme.codeColor) {
        css += `code, pre {
            color: ${theme.codeColor} !important;
            background-color: ${theme.codeBg || 'rgba(0,0,0,0.1)'} !important;
        }\n`;
    }
    
    // Custom scrollbar colors
    if (theme.scrollbarColor) {
        css += `::-webkit-scrollbar {
            width: 12px;
        }\n`;
        
        css += `::-webkit-scrollbar-track {
            background: ${theme.scrollbarBg || 'rgba(0,0,0,0.1)'};
        }\n`;
        
        css += `::-webkit-scrollbar-thumb {
            background: ${theme.scrollbarColor};
            border-radius: 6px;
        }\n`;
        
        css += `::-webkit-scrollbar-thumb:hover {
            background: ${theme.accentColor || theme.scrollbarColor};
        }\n`;
    }
    
    return css;
}

export function showThemeManager() {
    // Create theme manager modal if it doesn't exist
    if (!$("#uie-theme-manager-modal").length) {
        const modalHtml = '<div id="uie-theme-manager-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:2147483647; align-items:center; justify-content:center; padding:20px;">' +
            '<div style="background:#1a1a1a; border:1px solid #444; border-radius:12px; padding:20px; width:100%; max-width:600px; color:#fff; box-shadow:0 20px 50px rgba(0,0,0,0.5); max-height:90vh; overflow-y:auto;">' +
                '<h3 style="margin:0 0 15px 0; color:#cba35c;">Theme Manager</h3>' +
                
                '<div style="display:flex; gap:10px; margin-bottom:15px;">' +
                    '<button id="uie-theme-new" style="flex:1; padding:8px; border:none; border-radius:6px; background:#27ae60; color:#fff; cursor:pointer;">New Theme</button>' +
                    '<button id="uie-theme-import" style="flex:1; padding:8px; border:none; border-radius:6px; background:#3498db; color:#fff; cursor:pointer;">Import Theme</button>' +
                    '<button id="uie-theme-export" style="flex:1; padding:8px; border:none; border-radius:6px; background:#9b59b6; color:#fff; cursor:pointer;">Export Theme</button>' +
                '</div>' +
                
                '<div id="uie-theme-list" style="margin-bottom:15px;"></div>' +
                
                '<div id="uie-theme-editor" style="display:none;">' +
                    '<h4 style="margin:15px 0 10px 0;">Theme Editor</h4>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Theme Name</label>' +
                        '<input type="text" id="uie-theme-name" style="width:100%; padding:8px; border:1px solid #444; border-radius:6px; background:#2a2a2a; color:#fff;">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Font Family</label>' +
                        '<input type="text" id="uie-theme-font" placeholder="Arial, sans-serif" style="width:100%; padding:8px; border:1px solid #444; border-radius:6px; background:#2a2a2a; color:#fff;">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Text Color</label>' +
                        '<input type="color" id="uie-theme-text-color" style="width:50px; height:30px; margin-right:10px;">' +
                        '<input type="text" id="uie-theme-text-hex" placeholder="#ffffff" style="width:120px; padding:6px; border:1px solid #444; border-radius:4px; background:#2a2a2a; color:#fff;">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Background Color</label>' +
                        '<input type="color" id="uie-theme-bg-color" style="width:50px; height:30px; margin-right:10px;">' +
                        '<input type="text" id="uie-theme-bg-hex" placeholder="#000000" style="width:120px; padding:6px; border:1px solid #444; border-radius:4px; background:#2a2a2a; color:#fff;">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Button Color</label>' +
                        '<input type="color" id="uie-theme-btn-color" style="width:50px; height:30px; margin-right:10px;">' +
                        '<input type="text" id="uie-theme-btn-hex" placeholder="#3498db" style="width:120px; padding:6px; border:1px solid #444; border-radius:4px; background:#2a2a2a; color:#fff;">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Accent Color</label>' +
                        '<input type="color" id="uie-theme-accent-color" style="width:50px; height:30px; margin-right:10px;">' +
                        '<input type="text" id="uie-theme-accent-hex" placeholder="#cba35c" style="width:120px; padding:6px; border:1px solid #444; border-radius:4px; background:#2a2a2a; color:#fff;">' +
                    '</div>' +
                    
                    '<div style="margin-bottom:10px;">' +
                        '<label style="display:block; margin-bottom:5px; font-weight:bold;">Custom CSS</label>' +
                        '<textarea id="uie-theme-custom-css" placeholder="/* Add custom global CSS here */" style="width:100%; height:100px; padding:8px; border:1px solid #444; border-radius:6px; background:#2a2a2a; color:#fff; font-family:monospace; resize:vertical;"></textarea>' +
                    '</div>' +
                    
                    '<div style="display:flex; gap:10px; margin-top:15px;">' +
                        '<button id="uie-theme-save" style="flex:1; padding:8px; border:none; border-radius:6px; background:#27ae60; color:#fff; cursor:pointer;">Save Theme</button>' +
                        '<button id="uie-theme-cancel" style="flex:1; padding:8px; border:none; border-radius:6px; background:#e74c3c; color:#fff; cursor:pointer;">Cancel</button>' +
                    '</div>' +
                '</div>' +
                
                '<div style="display:flex; justify-content:flex-end; margin-top:15px;">' +
                    '<button id="uie-theme-manager-close" style="padding:8px 16px; border:none; border-radius:6px; background:#e74c3c; color:#fff; cursor:pointer;">Close</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        $("body").append(modalHtml);
        
        // Add event handlers
        $(document).on("click.uieThemeMgr", "#uie-theme-new", showThemeEditor);
        $(document).on("click.uieThemeMgr", "#uie-theme-import", importTheme);
        $(document).on("click.uieThemeMgr", "#uie-theme-export", exportTheme);
        $(document).on("click.uieThemeMgr", "#uie-theme-save", saveThemeFromEditor);
        $(document).on("click.uieThemeMgr", "#uie-theme-cancel", hideThemeEditor);
        $(document).on("click.uieThemeMgr", "#uie-theme-manager-close", hideThemeManager);
        
        // Color picker sync
        $(document).on("input.uieThemeMgr", "#uie-theme-text-color", function() {
            $("#uie-theme-text-hex").val($(this).val());
        });
        $(document).on("input.uieThemeMgr", "#uie-theme-text-hex", function() {
            $("#uie-theme-text-color").val($(this).val());
        });
        
        $(document).on("input.uieThemeMgr", "#uie-theme-bg-color", function() {
            $("#uie-theme-bg-hex").val($(this).val());
        });
        $(document).on("input.uieThemeMgr", "#uie-theme-bg-hex", function() {
            $("#uie-theme-bg-color").val($(this).val());
        });
        
        $(document).on("input.uieThemeMgr", "#uie-theme-btn-color", function() {
            $("#uie-theme-btn-hex").val($(this).val());
        });
        $(document).on("input.uieThemeMgr", "#uie-theme-btn-hex", function() {
            $("#uie-theme-btn-color").val($(this).val());
        });
        
        $(document).on("input.uieThemeMgr", "#uie-theme-accent-color", function() {
            $("#uie-theme-accent-hex").val($(this).val());
        });
        $(document).on("input.uieThemeMgr", "#uie-theme-accent-hex", function() {
            $("#uie-theme-accent-color").val($(this).val());
        });
        
        $(document).on("click.uieThemeMgr", "#uie-theme-manager-modal", function(e) {
            if (e.target === this) {
                hideThemeManager();
            }
        });
    }
    
    renderThemeList();
    $("#uie-theme-manager-modal").show();
}

function renderThemeList() {
    const themes = getThemes();
    const activeTheme = getActiveTheme();
    const list = $("#uie-theme-list");
    list.empty();
    
    // Add default theme
    const defaultItem = $(`
        <div class="theme-item" data-theme="default" style="padding:10px; border:1px solid #444; border-radius:6px; margin-bottom:8px; cursor:pointer; ${activeTheme === 'default' ? 'background:#2a2a2a; border-color:#cba35c;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:bold;">Default Theme</div>
                    <div style="font-size:12px; opacity:0.8;">Built-in theme</div>
                </div>
                <div style="display:flex; gap:5px;">
                    ${activeTheme === 'default' ? '<span style="color:#27ae60; font-size:12px;">Active</span>' : ''}
                    <button class="theme-apply" data-theme="default" style="padding:4px 8px; border:none; border-radius:4px; background:#3498db; color:#fff; cursor:pointer; font-size:12px;">Apply</button>
                </div>
            </div>
        </div>
    `);
    list.append(defaultItem);
    
    // Add custom themes
    Object.keys(themes).forEach(themeName => {
        if (themeName === 'default') return;
        
        const theme = themes[themeName];
        const item = $(`
            <div class="theme-item" data-theme="${themeName}" style="padding:10px; border:1px solid #444; border-radius:6px; margin-bottom:8px; cursor:pointer; ${activeTheme === themeName ? 'background:#2a2a2a; border-color:#cba35c;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:bold;">${escapeHtmlText(themeName)}</div>
                        <div style="font-size:12px; opacity:0.8;">Custom theme</div>
                    </div>
                    <div style="display:flex; gap:5px;">
                        ${activeTheme === themeName ? '<span style="color:#27ae60; font-size:12px;">Active</span>' : ''}
                        <button class="theme-apply" data-theme="${themeName}" style="padding:4px 8px; border:none; border-radius:4px; background:#3498db; color:#fff; cursor:pointer; font-size:12px;">Apply</button>
                        <button class="theme-edit" data-theme="${themeName}" style="padding:4px 8px; border:none; border-radius:4px; background:#f39c12; color:#fff; cursor:pointer; font-size:12px;">Edit</button>
                        <button class="theme-delete" data-theme="${themeName}" style="padding:4px 8px; border:none; border-radius:4px; background:#e74c3c; color:#fff; cursor:pointer; font-size:12px;">Delete</button>
                    </div>
                </div>
            </div>
        `);
        list.append(item);
    });
    
    // Add event handlers for theme items
    $(document).off("click.uieThemeItems").on("click.uieThemeItems", ".theme-apply", function() {
        const themeName = $(this).data("theme");
        applyTheme(themeName);
        renderThemeList();
    });
    
    $(document).off("click.uieThemeItems").on("click.uieThemeItems", ".theme-edit", function() {
        const themeName = $(this).data("theme");
        editTheme(themeName);
    });
    
    $(document).off("click.uieThemeItems").on("click.uieThemeItems", ".theme-delete", function() {
        const themeName = $(this).data("theme");
        if (confirm(`Are you sure you want to delete theme "${themeName}"?`)) {
            deleteTheme(themeName);
            renderThemeList();
        }
    });
}

function showThemeEditor() {
    $("#uie-theme-editor").show();
    $("#uie-theme-name").val("").focus();
    resetThemeEditor();
}

function editTheme(themeName) {
    const themes = getThemes();
    const theme = themes[themeName];
    if (!theme) return;
    
    $("#uie-theme-editor").show();
    $("#uie-theme-name").val(themeName);
    
    // Load theme data into editor
    $("#uie-theme-font").val(theme.fontFamily || "");
    $("#uie-theme-text-color").val(theme.textColor || "#ffffff");
    $("#uie-theme-text-hex").val(theme.textColor || "#ffffff");
    $("#uie-theme-bg-color").val(theme.backgroundColor || "#000000");
    $("#uie-theme-bg-hex").val(theme.backgroundColor || "#000000");
    $("#uie-theme-btn-color").val(theme.buttonColor || "#3498db");
    $("#uie-theme-btn-hex").val(theme.buttonColor || "#3498db");
    $("#uie-theme-accent-color").val(theme.accentColor || "#cba35c");
    $("#uie-theme-accent-hex").val(theme.accentColor || "#cba35c");
    $('#uie-theme-custom-css').val(theme.customCss || '');
}

function resetThemeEditor() {
    $("#uie-theme-font").val("");
    $("#uie-theme-text-color").val("#ffffff");
    $("#uie-theme-text-hex").val("#ffffff");
    $("#uie-theme-bg-color").val("#000000");
    $("#uie-theme-bg-hex").val("#000000");
    $("#uie-theme-btn-color").val("#3498db");
    $("#uie-theme-btn-hex").val("#3498db");
    $("#uie-theme-accent-color").val("#cba35c");
    $("#uie-theme-accent-hex").val("#cba35c");
    $('#uie-theme-custom-css').val('');
}

function hideThemeEditor() {
    $("#uie-theme-editor").hide();
    resetThemeEditor();
}

function hideThemeManager() {
    $("#uie-theme-manager-modal").hide();
    hideThemeEditor();
}

function saveThemeFromEditor() {
    const themeName = $("#uie-theme-name").val().trim();
    if (!themeName) {
        showToast("Please enter a theme name.");
        return;
    }
    
    const themeData = {
        fontFamily: $("#uie-theme-font").val().trim(),
        textColor: $("#uie-theme-text-hex").val().trim(),
        backgroundColor: $("#uie-theme-bg-hex").val().trim(),
        buttonColor: $("#uie-theme-btn-hex").val().trim(),
        accentColor: $('#uie-theme-accent-hex').val(),
        customCss: $('#uie-theme-custom-css').val()
    };
    
    saveTheme(themeName, themeData);
    renderThemeList();
    hideThemeEditor();
}

function importTheme() {
    const input = $('<input type="file" accept=".json">');
    input.on('change', function() {
        const file = this.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const themeData = JSON.parse(e.target.result);
                const themeName = themeData.name || "Imported Theme";
                delete themeData.name; // Remove name from theme data
                saveTheme(themeName, themeData);
                renderThemeList();
                showToast(`Theme "${themeName}" imported successfully.`);
            } catch (error) {
                showToast("Failed to import theme: Invalid JSON format.");
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

function exportTheme() {
    const activeTheme = getActiveTheme();
    const themes = getThemes();
    const theme = themes[activeTheme];
    
    if (!theme && activeTheme !== 'default') {
        showToast("No theme to export.");
        return;
    }
    
    const exportData = {
        name: activeTheme,
        ...theme
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = $('<a></a>').attr({
        href: url,
        download: `${activeTheme}-theme.json`
    });
    a[0].click();
    URL.revokeObjectURL(url);
    showToast(`Theme "${activeTheme}" exported.`);
}

// Dynamic Game Mode Styles & Themes
export function initGameModeTheme() {
    try {
        const s = getSettings();
        const mode = String(s.character?.mode || s.world?.gameMode || "adventure").toLowerCase();
        
        // Remove existing game mode styles
        $('#uie-gamemode-styles').remove();
        
        let css = "";
        
        switch (mode) {
            case "rpg": // High Fantasy RPG
                css = ` ?
                    /* High Fantasy RPG - Bronze/Gold Premium Theme */
                    :root {
                        --uie-primary: #e1c16e;
                        --uie-secondary: #cd7f32;
                        --uie-bg: #1a1410;
                        --uie-bg-gradient: linear-gradient(135deg, #1a1410 0%, #2d2416 50%, #1f1915 100%);
                        --uie-accent: rgba(205, 127, 50, 0.3);
                    }
                    body, .modal-card, button, input, select, textarea {
                        font-family: 'Georgia', 'Times New Roman', serif !important;
                    }
                    .reply-tool-btn, button, .uie-newgame-btn {
                        background: linear-gradient(135deg, rgba(205, 127, 50, 0.25) 0%, rgba(139, 110, 58, 0.15) 100%) !important;
                        border-color: rgba(205, 127, 50, 0.4) !important;
                        color: #e1c16e !important;
                        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                    }
                    .reply-tool-btn:hover, button:hover, .uie-newgame-btn:hover {
                        background: linear-gradient(135deg, rgba(205, 127, 50, 0.45) 0%, rgba(139, 110, 58, 0.25) 100%) !important;
                        box-shadow: 0 0 10px rgba(225, 193, 122, 0.2) !important;
                    }
                `;
                break;
                
            case "combat": // Combat Mode
                css = ` ?
                    /* Combat Mode - Crimson/Charcoal Sharp Theme */
                    :root {
                        --uie-primary: #e74c3c;
                        --uie-secondary: #c0392b;
                        --uie-bg: #111111;
                        --uie-bg-gradient: linear-gradient(135deg, #111 0%, #222 50%, #151515 100%);
                        --uie-accent: rgba(231, 76, 60, 0.3);
                    }
                    body, .modal-card, button, input, select, textarea {
                        font-family: 'Impact', 'Arial Black', sans-serif !important;
                        letter-spacing: 0.5px;
                    }
                    .reply-tool-btn, button, .uie-newgame-btn {
                        background: linear-gradient(135deg, rgba(231, 76, 60, 0.2) 0%, rgba(192, 57, 43, 0.15) 100%) !important;
                        border-color: rgba(231, 76, 60, 0.4) !important;
                        color: #e74c3c !important;
                        text-transform: uppercase;
                    }
                    .reply-tool-btn:hover, button:hover, .uie-newgame-btn:hover {
                        background: linear-gradient(135deg, rgba(231, 76, 60, 0.4) 0%, rgba(192, 57, 43, 0.25) 100%) !important;
                        box-shadow: 0 0 10px rgba(231, 76, 60, 0.3) !important;
                    }
                `;
                break;
                
            case "survival": // Survival Mode
                css = ` ?
                    /* Survival Mode - Gritty Green/Amber Theme */
                    :root {
                        --uie-primary: #f39c12;
                        --uie-secondary: #27ae60;
                        --uie-bg: #141915;
                        --uie-bg-gradient: linear-gradient(135deg, #141915 0%, #2c3e50 50%, #1a241c 100%);
                        --uie-accent: rgba(39, 174, 96, 0.3);
                    }
                    body, .modal-card, button, input, select, textarea {
                        font-family: 'Courier New', Courier, monospace !important;
                        font-weight: bold;
                    }
                    .reply-tool-btn, button, .uie-newgame-btn {
                        background: rgba(39, 174, 96, 0.15) !important;
                        border-color: rgba(39, 174, 96, 0.3) !important;
                        color: #27ae60 !important;
                    }
                    .reply-tool-btn:hover, button:hover, .uie-newgame-btn:hover {
                        background: rgba(39, 174, 96, 0.35) !important;
                        box-shadow: 0 0 10px rgba(39, 174, 96, 0.2) !important;
                        color: #2ecc71 !important;
                    }
                `;
                break;
                
            case "roleplay": // Roleplay Mode
                css = ` ?
                    /* Roleplay Mode - Warm Parchment/Ink Literary Theme */
                    :root {
                        --uie-primary: #d35400;
                        --uie-secondary: #95a5a6;
                        --uie-bg: #2c2520;
                        --uie-bg-gradient: linear-gradient(135deg, #2c2520 0%, #1e1814 100%);
                        --uie-accent: rgba(211, 84, 0, 0.25);
                    }
                    body, .modal-card, button, input, select, textarea {
                        font-family: 'Times New Roman', Times, serif !important;
                        font-style: italic;
                    }
                    .reply-tool-btn, button, .uie-newgame-btn {
                        background: rgba(211, 84, 0, 0.1) !important;
                        border-color: rgba(211, 84, 0, 0.2) !important;
                        color: #f39c12 !important;
                    }
                    .reply-tool-btn:hover, button:hover, .uie-newgame-btn:hover {
                        background: rgba(211, 84, 0, 0.25) !important;
                        color: #e67e22 !important;
                    }
                `;
                break;
                
            case "adventure": // Adventure Mode (Default)
            default:
                css = ` ?
                    /* Adventure Mode - Bright Gold/Dark Slate Theme */
                    :root {
                        --uie-primary: #cba35c;
                        --uie-secondary: #34495e;
                        --uie-bg: #111318;
                        --uie-bg-gradient: linear-gradient(135deg, #111318 0%, #1b2028 100%);
                        --uie-accent: rgba(203, 163, 92, 0.25);
                    }
                    body, .modal-card, button, input, select, textarea {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important;
                    }
                    .reply-tool-btn, button, .uie-newgame-btn {
                        background: rgba(203, 163, 92, 0.1) !important;
                        border-color: rgba(203, 163, 92, 0.3) !important;
                        color: #cba35c !important;
                    }
                    .reply-tool-btn:hover, button:hover, .uie-newgame-btn:hover {
                        background: rgba(203, 163, 92, 0.25) !important;
                        box-shadow: 0 0 8px rgba(203, 163, 92, 0.15) !important;
                    }
                `;
                break;
        }
        
        $('head').append(`<style id="uie-gamemode-styles">${css}</style>`);
    } catch (_) {}
}

// Initialize theme system
export function initThemeSystem() {
    // Apply active theme on load
    const activeTheme = getActiveTheme();
    if (activeTheme !== 'default') {
        applyTheme(activeTheme);
    }
    initGameModeTheme();
    
    // Expose globally
    window.UIE_initGameModeTheme = initGameModeTheme;
}
