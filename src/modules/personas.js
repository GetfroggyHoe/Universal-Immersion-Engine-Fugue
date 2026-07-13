import { getSettings, saveSettings, applyFullState } from './core.js';
import { showPopup } from './popups.js';

const
    EXT_ID = 'universal-immersion-engine',
    PERSONA_KEY_PREFIX = 'uie-persona-';

function getPersonas() {
    const s = getSettings();
    if (!s.personas) {
        s.personas = [];
    }
    return s.personas;
}

function savePersonas(personas) {
    const s = getSettings();
    s.personas = personas;
    saveSettings();
}

function saveCurrentSettingsAsPersona(name) {
    if (!name) {
        showPopup('Persona name cannot be empty.', 'error');
        return;
    }

    const personas = getPersonas();
    const s = getSettings();
    const activePersonaId = s.character?.activePersonaId || '';

    // Create a deep copy of the settings, excluding the personas array itself
    const settingsToSave = JSON.parse(JSON.stringify(s, (key, value) => {
        if (key === 'personas' || key === 'generatedSprites') {
            return undefined;
        }
        return value;
    }));

    const role = document.getElementById('uie-persona-role')?.value?.trim() || '';
    const bio = document.getElementById('uie-persona-bio')?.value?.trim() || '';
    const avatar = document.getElementById('uie-persona-avatar')?.value?.trim() || '';
    const expressions = {
        baby: document.getElementById('uie-persona-expr-baby')?.value?.trim() || '',
        child: document.getElementById('uie-persona-expr-child')?.value?.trim() || '',
        teen: document.getElementById('uie-persona-expr-teen')?.value?.trim() || '',
        young: document.getElementById('uie-persona-expr-young')?.value?.trim() || '',
        adult: document.getElementById('uie-persona-expr-adult')?.value?.trim() || '',
        old: document.getElementById('uie-persona-expr-old')?.value?.trim() || ''
    };

    let targetPersona = personas.find(p => p.id === activePersonaId);
    if (targetPersona) {
        // Update existing
        targetPersona.name = name;
        targetPersona.role = role;
        targetPersona.bio = bio;
        targetPersona.avatar = avatar;
        targetPersona.expressions = expressions;
        targetPersona.settings = settingsToSave;
        showPopup(`Persona "${name}" updated.`, 'success');
    } else {
        // Create new
        const id = PERSONA_KEY_PREFIX + Date.now();
        const newPersona = {
            id: id,
            name: name,
            role: role,
            bio: bio,
            avatar: avatar,
            expressions: expressions,
            settings: settingsToSave,
        };
        personas.push(newPersona);
        s.character = s.character || {};
        s.character.activePersonaId = id;
        showPopup(`Persona "${name}" saved.`, 'success');
    }

    // Apply player details immediately
    s.character = s.character || {};
    s.character.name = name;
    s.character.class = role;
    s.character.avatar = avatar;
    s.character.expressions = expressions;
    s.character.generatedSprites = {}; // Reset generated sprites cache so they update
    saveSettings();

    savePersonas(personas);
    renderPersonaCardsGrid();
}

function loadPersona(id) {
    const personas = getPersonas();
    const persona = personas.find(p => p.id === id);

    if (persona) {
        // Exclude personas from being overwritten
        const settingsToApply = JSON.parse(JSON.stringify(persona.settings, (key, value) => {
            if (key === 'personas' || key === 'generatedSprites') {
                return undefined;
            }
            return value;
        }));

        applyFullState(settingsToApply);

        // Load fields
        loadPersonaFields(id);

        showPopup(`Persona "${persona.name}" loaded.`, 'success');
    } else {
        showPopup('Persona not found.', 'error');
    }
}

function loadPersonaFields(id) {
    const personas = getPersonas();
    const persona = personas.find(p => p.id === id);
    if (!persona) return;

    // Fill form elements
    const nameEl = document.getElementById('uie-persona-name');
    if (nameEl) nameEl.value = persona.name || '';
    const roleEl = document.getElementById('uie-persona-role');
    if (roleEl) roleEl.value = persona.role || '';
    const bioEl = document.getElementById('uie-persona-bio');
    if (bioEl) bioEl.value = persona.bio || '';
    const avatarEl = document.getElementById('uie-persona-avatar');
    if (avatarEl) avatarEl.value = persona.avatar || '';

    if (persona.expressions) {
        const exprBaby = document.getElementById('uie-persona-expr-baby');
        if (exprBaby) exprBaby.value = persona.expressions.baby || '';
        const exprChild = document.getElementById('uie-persona-expr-child');
        if (exprChild) exprChild.value = persona.expressions.child || '';
        const exprTeen = document.getElementById('uie-persona-expr-teen');
        if (exprTeen) exprTeen.value = persona.expressions.teen || '';
        const exprYoung = document.getElementById('uie-persona-expr-young');
        if (exprYoung) exprYoung.value = persona.expressions.young || '';
        const exprAdult = document.getElementById('uie-persona-expr-adult');
        if (exprAdult) exprAdult.value = persona.expressions.adult || '';
        const exprOld = document.getElementById('uie-persona-expr-old');
        if (exprOld) exprOld.value = persona.expressions.old || '';
    }

    const avatarDiv = document.getElementById('uie-persona-card-avatar');
    if (avatarDiv) {
        avatarDiv.style.backgroundImage = `url('${persona.avatar || 'https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png'}')`;
    }
    
    // Tag active state
    const selectedTag = document.getElementById('uie-persona-selected-tag');
    if (selectedTag) selectedTag.style.display = 'block';
}

function clearPersonaFields() {
    const fields = ['uie-persona-name', 'uie-persona-role', 'uie-persona-bio', 'uie-persona-avatar', 'uie-persona-expr-baby', 'uie-persona-expr-child', 'uie-persona-expr-teen', 'uie-persona-expr-young', 'uie-persona-expr-adult', 'uie-persona-expr-old'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const avatarDiv = document.getElementById('uie-persona-card-avatar');
    if (avatarDiv) {
        avatarDiv.style.backgroundImage = `url('https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png')`;
    }
    const selectedTag = document.getElementById('uie-persona-selected-tag');
    if (selectedTag) selectedTag.style.display = 'none';
    
    // Clear active persona selection key
    const s = getSettings();
    s.character = s.character || {};
    s.character.activePersonaId = '';
    saveSettings();
    renderPersonaCardsGrid();
}

function deletePersona(id) {
    let personas = getPersonas();
    const initialLength = personas.length;
    const pName = personas.find(p => p.id === id)?.name || '';
    personas = personas.filter(p => p.id !== id);

    if (personas.length < initialLength) {
        savePersonas(personas);
        showPopup(`Persona "${pName}" deleted.`, 'success');
        clearPersonaFields();
    } else {
        showPopup('Persona not found.', 'error');
    }
}

function renderPersonaCardsGrid() {
    const grid = document.getElementById('uie-personas-grid');
    if (!grid) return;
    const personas = getPersonas();
    const activePersonaId = getSettings().character?.activePersonaId || '';

    let html = '';
    // "New Card" trigger element
    html += `
        <div class="uie-persona-card uie-persona-card-new" style="background:rgba(255,255,255,0.05); border:1.5px dashed rgba(225,193,122,0.4); border-radius:10px; padding:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; cursor:pointer; height:120px; transition:all 0.2s;">
            <i class="fa-solid fa-plus-circle" style="font-size:2em; color:#cba35c; margin-bottom:6px;"></i>
            <span style="font-size:0.75em; font-weight:bold; color:#cba35c;">New Persona</span>
        </div>
    `;

    personas.forEach(p => {
        const isActive = p.id === activePersonaId;
        const avatar = p.avatar || 'https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png';
        const borderStyle = isActive ? '2px solid #2ecc71' : '1px solid rgba(255,255,255,0.15)';
        const shadow = isActive ? '0 0 10px rgba(46,204,113,0.4)' : '0 4px 6px rgba(0,0,0,0.3)';
        const bg = isActive ? 'rgba(46,204,113,0.08)' : 'rgba(255,255,255,0.03)';
        
        html += `
            <div class="uie-persona-card" data-id="${p.id}" style="background:${bg}; border:${borderStyle}; border-radius:10px; padding:8px; display:flex; flex-direction:column; align-items:center; cursor:pointer; height:120px; position:relative; box-shadow:${shadow}; transition:all 0.2s;">
                <div style="width:50px; height:50px; border-radius:50%; border:2px solid ${isActive ? '#2ecc71' : '#cba35c'}; background:url('${avatar}') center/cover no-repeat; margin-bottom:6px;"></div>
                <div style="font-size:0.8em; font-weight:900; color:#fff; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">${p.name}</div>
                <div style="font-size:0.65em; color:#aaa; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%; margin-top:2px;">${p.role || 'Adventurer'}</div>
                ${isActive ? `<div style="position:absolute; top:4px; right:4px; font-size:9px; color:#2ecc71;"><i class="fa-solid fa-circle-check"></i></div>` : ''}
            </div>
        `;
    });

    grid.innerHTML = html;

    // Apply inline quick style triggers dynamically
    grid.querySelectorAll('.uie-persona-card').forEach(card => {
        card.addEventListener('mouseover', () => {
            card.style.transform = 'translateY(-3px)';
            card.style.borderColor = '#cba35c';
        });
        card.addEventListener('mouseout', () => {
            card.style.transform = 'none';
            const cardId = card.getAttribute('data-id');
            card.style.borderColor = (cardId === activePersonaId) ? '#2ecc71' : 'rgba(255,255,255,0.15)';
        });
        
        card.addEventListener('click', () => {
            const id = card.getAttribute('data-id');
            if (id) {
                getSettings().character = getSettings().character || {};
                getSettings().character.activePersonaId = id;
                saveSettings();
                loadPersonaFields(id);
                renderPersonaCardsGrid();
                
                // Trigger profile exchange or state load if desired
                try {
                    const settingsToApply = JSON.parse(JSON.stringify(personas.find(p => p.id === id).settings, (key, value) => {
                        if (key === 'personas' || key === 'generatedSprites') return undefined;
                        return value;
                    }));
                    applyFullState(settingsToApply);
                } catch(_) {}
            } else if (card.classList.contains('uie-persona-card-new')) {
                clearPersonaFields();
            }
        });
    });
}

function initPersonaManager() {
    const saveBtn = document.getElementById('uie-persona-save-btn');
    const deleteActiveBtn = document.getElementById('uie-persona-delete-active-btn');
    const imgGenBtn = document.getElementById('uie-persona-imggen-btn');

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const nameEl = document.getElementById('uie-persona-name');
            if (nameEl && nameEl.value.trim()) {
                saveCurrentSettingsAsPersona(nameEl.value.trim());
            } else {
                showPopup('Persona name cannot be empty.', 'error');
            }
        });
    }

    if (deleteActiveBtn) {
        deleteActiveBtn.addEventListener('click', () => {
            const s = getSettings();
            const id = s.character?.activePersonaId || '';
            if (id) {
                deletePersona(id);
            } else {
                showPopup('No character card is selected.', 'error');
            }
        });
    }

    if (imgGenBtn) {
        imgGenBtn.addEventListener('click', async () => {
            const pName = document.getElementById('uie-persona-name')?.value?.trim() || 'Lead Singer';
            const pRole = document.getElementById('uie-persona-role')?.value?.trim() || 'Artist';
            const pBio = document.getElementById('uie-persona-bio')?.value?.trim() || '';
            try {
                if (typeof window.toastr?.info === "function") window.toastr.info("Generating character portrait...");
                if (typeof window.generateImageFromSdRequest === "function") {
                    const r = await window.generateImageFromSdRequest(
                        `A high quality VN anime character card portrait of ${pName}, a ${pRole}. Description: ${pBio}`,
                        "me"
                    );
                    if (r && r.url) {
                        const avatarInput = document.getElementById('uie-persona-avatar');
                        if (avatarInput) avatarInput.value = r.url;
                        const avatarDiv = document.getElementById('uie-persona-card-avatar');
                        if (avatarDiv) avatarDiv.style.backgroundImage = `url('${r.url}')`;
                        if (typeof window.toastr?.success === "function") window.toastr.success("Portrait generated successfully!");
                    }
                } else {
                    if (typeof window.toastr?.error === "function") window.toastr.error("Image generation system is not fully loaded yet.");
                }
            } catch (e) {
                if (typeof window.toastr?.error === "function") window.toastr.error(`Image gen failed: ${e.message}`);
            }
        });
    }

    const avatarInput = document.getElementById('uie-persona-avatar');
    if (avatarInput) {
        avatarInput.addEventListener('input', () => {
            const url = avatarInput.value.trim();
            const avatarDiv = document.getElementById('uie-persona-card-avatar');
            if (avatarDiv) {
                avatarDiv.style.backgroundImage = `url('${url || 'https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png'}')`;
            }
        });
    }

    // Dynamic grid check
    renderPersonaCardsGrid();
    
    // Auto populate editor form with currently active persona if exists
    const activePersonaId = getSettings().character?.activePersonaId || '';
    if (activePersonaId) {
        loadPersonaFields(activePersonaId);
    }
}

function generateCharacterSaveName(s) {
    const charClass = String(s.character?.class || "").trim();
    const charName = String(s.character?.name || "").trim();
    const level = s.character?.level || s.rpg?.level || 1;
    
    if (charClass && charName) {
        return `${charName} - ${charClass} Lv.${level}`;
    }
    if (charClass) {
        return `${charClass} Lv.${level}`;
    }
    if (charName) {
        return `${charName} - Adventurer Lv.${level}`;
    }
    return `Character Save Lv.${level}`;
}

function getGameSpecificSaveKey() {
    const s = getSettings();
    const gameId = s.gameId || s.worldState?.gameId || 'default';
    return `game_${gameId}`;
}

function saveCharacterToPersona(customName = null) {
    const s = getSettings();
    const personas = getPersonas();
    const activePersonaId = s.character?.activePersonaId || '';
    
    if (!activePersonaId) {
        showPopup('No active persona. Create or select a persona first.', 'error');
        return null;
    }
    
    const persona = personas.find(p => p.id === activePersonaId);
    if (!persona) {
        showPopup('Active persona not found.', 'error');
        return null;
    }
    
    const gameKey = getGameSpecificSaveKey();
    const saveName = customName || generateCharacterSaveName(s);
    const timestamp = Date.now();
    
    const characterState = {
        name: saveName,
        timestamp: timestamp,
        gameKey: gameKey,
        character: {
            name: s.character?.name || '',
            class: s.character?.class || '',
            level: s.character?.level || s.rpg?.level || 1,
            avatar: s.character?.avatar || '',
            bio: s.character?.bio || '',
        },
        stats: {
            hp: s.character?.hp || s.rpg?.hp || 100,
            maxHp: s.character?.maxHp || s.rpg?.maxHp || 100,
            mp: s.character?.mp || s.rpg?.mp || 50,
            maxMp: s.character?.maxMp || s.rpg?.maxMp || 50,
            strength: s.character?.strength || s.rpg?.strength || 10,
            dexterity: s.character?.dexterity || s.rpg?.dexterity || 10,
            intelligence: s.character?.intelligence || s.rpg?.intelligence || 10,
            charisma: s.character?.charisma || s.rpg?.charisma || 10,
        },
        inventory: JSON.parse(JSON.stringify(s.inventory || [])),
        equipment: JSON.parse(JSON.stringify(s.equipment || {})),
        quests: JSON.parse(JSON.stringify(s.quests || [])),
        lifeTrackers: JSON.parse(JSON.stringify(s.lifeTrackers || s.character?.lifeTrackers || {})),
        schedule: JSON.parse(JSON.stringify(s.schedule || {})),
        worldState: {
            location: s.worldState?.location || '',
            time: s.worldState?.time || {},
        },
    };
    
    if (!persona.characterSaves) {
        persona.characterSaves = {};
    }
    if (!persona.characterSaves[gameKey]) {
        persona.characterSaves[gameKey] = [];
    }
    
    persona.characterSaves[gameKey].push(characterState);
    persona.characterSaves[gameKey] = persona.characterSaves[gameKey].slice(-20);
    
    savePersonas(personas);
    showPopup(`Character saved: "${saveName}"`, 'success');
    return characterState;
}

function loadCharacterFromPersona(saveIndex = -1, gameKey = null) {
    const s = getSettings();
    const personas = getPersonas();
    const activePersonaId = s.character?.activePersonaId || '';
    
    if (!activePersonaId) {
        showPopup('No active persona selected.', 'error');
        return false;
    }
    
    const persona = personas.find(p => p.id === activePersonaId);
    if (!persona || !persona.characterSaves) {
        showPopup('No character saves found for this persona.', 'error');
        return false;
    }
    
    const targetGameKey = gameKey || getGameSpecificSaveKey();
    const saves = persona.characterSaves[targetGameKey] || [];
    
    if (saves.length === 0) {
        showPopup('No character saves found for this game.', 'error');
        return false;
    }
    
    const saveData = saveIndex === -1 ? saves[saves.length - 1] : saves[saveIndex];
    if (!saveData) {
        showPopup('Save not found.', 'error');
        return false;
    }
    
    s.character = s.character || {};
    s.character.name = saveData.character?.name || s.character.name;
    s.character.class = saveData.character?.class || s.character.class;
    s.character.level = saveData.character?.level || s.character.level;
    s.character.avatar = saveData.character?.avatar || s.character.avatar;
    s.character.bio = saveData.character?.bio || s.character.bio;
    
    s.character.hp = saveData.stats?.hp || s.character.hp;
    s.character.maxHp = saveData.stats?.maxHp || s.character.maxHp;
    s.character.mp = saveData.stats?.mp || s.character.mp;
    s.character.maxMp = saveData.stats?.maxMp || s.character.maxMp;
    s.character.strength = saveData.stats?.strength || s.character.strength;
    s.character.dexterity = saveData.stats?.dexterity || s.character.dexterity;
    s.character.intelligence = saveData.stats?.intelligence || s.character.intelligence;
    s.character.charisma = saveData.stats?.charisma || s.character.charisma;
    
    s.inventory = JSON.parse(JSON.stringify(saveData.inventory || []));
    s.equipment = JSON.parse(JSON.stringify(saveData.equipment || {}));
    s.quests = JSON.parse(JSON.stringify(saveData.quests || []));
    s.lifeTrackers = JSON.parse(JSON.stringify(saveData.lifeTrackers || {}));
    s.schedule = JSON.parse(JSON.stringify(saveData.schedule || {}));
    
    s.worldState = s.worldState || {};
    if (saveData.worldState?.location) s.worldState.location = saveData.worldState.location;
    if (saveData.worldState?.time) s.worldState.time = saveData.worldState.time;
    
    saveSettings();
    showPopup(`Character loaded: "${saveData.name}"`, 'success');
    return true;
}

function listCharacterSaves(gameKey = null) {
    const s = getSettings();
    const personas = getPersonas();
    const activePersonaId = s.character?.activePersonaId || '';
    
    if (!activePersonaId) return [];
    
    const persona = personas.find(p => p.id === activePersonaId);
    if (!persona || !persona.characterSaves) return [];
    
    const targetGameKey = gameKey || getGameSpecificSaveKey();
    return persona.characterSaves[targetGameKey] || [];
}

function deleteCharacterSave(saveIndex, gameKey = null) {
    const s = getSettings();
    const personas = getPersonas();
    const activePersonaId = s.character?.activePersonaId || '';
    
    if (!activePersonaId) {
        showPopup('No active persona selected.', 'error');
        return false;
    }
    
    const persona = personas.find(p => p.id === activePersonaId);
    if (!persona || !persona.characterSaves) {
        showPopup('No saves found.', 'error');
        return false;
    }
    
    const targetGameKey = gameKey || getGameSpecificSaveKey();
    const saves = persona.characterSaves[targetGameKey] || [];
    
    if (saveIndex < 0 || saveIndex >= saves.length) {
        showPopup('Save not found.', 'error');
        return false;
    }
    
    const saveName = saves[saveIndex]?.name || 'Unknown';
    saves.splice(saveIndex, 1);
    persona.characterSaves[targetGameKey] = saves;
    
    savePersonas(personas);
    showPopup(`Deleted save: "${saveName}"`, 'success');
    return true;
}

export { initPersonaManager, renderPersonaCardsGrid, getPersonas, loadPersona, deletePersona, saveCurrentSettingsAsPersona, saveCharacterToPersona, loadCharacterFromPersona, listCharacterSaves, deleteCharacterSave };
