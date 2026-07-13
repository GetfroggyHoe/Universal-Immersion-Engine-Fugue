import { getSettings, saveSettings } from "./core.js";

// List of built-in categories
export const SECRET_CATEGORIES = [
    "hidden_identity",
    "hidden_relationship",
    "secret_goal",
    "manipulation",
    "betrayal",
    "crime",
    "conspiracy",
    "abuse",
    "obsession",
    "exploitation",
    "blackmail",
    "corruption",
    "forbidden_knowledge",
    "hidden_knowledge",
    "concealed_history",
    "secret_loyalty",
    "false_loyalty",
    "secret_fear",
    "secret_shame",
    "secret_weakness",
    "secret_power",
    "hidden_health",
    "supernatural",
    "planned_action",
    "cover_up",
    "lie",
    "false_memory",
    "framed_person",
    "double_life",
    "surveillance",
    "experiment",
    "custom"
];

// Helper to generate a slug-like string
function slugId(value) {
    return String(value || "npc")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48) || "npc";
}

// Normalize a simple string into a structured secret object
export function normalizeSimpleSecret(str, npc = {}) {
    const npcName = npc.name || "npc";
    const now = new Date().toISOString();
    return {
        id: `secret_${slugId(npcName)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title: str.length > 60 ? str.slice(0, 57) + "..." : str,
        category: "custom",
        truth: str,
        publicCover: "",
        motive: "",
        objective: "",
        strategy: "",
        methods: [],
        targets: [],
        accomplices: [],
        witnesses: [],
        evidence: [],
        dependencies: [],
        relatedSecretIds: [],
        awareness: {
            ownerKnows: true,
            playerKnows: false,
            knownByNpcIds: [],
            suspectedByNpcIds: [],
            falselyBelievedByNpcIds: []
        },
        exposure: {
            status: "hidden",
            risk: 0.1,
            pressure: 0.1,
            lastNearExposureAt: null,
            exposedAt: null,
            exposedBy: null
        },
        behaviorRules: [],
        contradictionRules: [],
        triggerConditions: [],
        escalationPlan: [],
        fallbackPlan: "",
        consequencesIfExposed: [],
        origin: "migration",
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        active: true,
        archived: false,
        immutable: false,
        notes: ""
    };
}

// Normalize an existing secret object to ensure all fields are defined
export function normalizeObjectSecret(obj, npc = {}) {
    const npcName = npc.name || "npc";
    const now = new Date().toISOString();
    const defaults = {
        id: obj.id || `secret_${slugId(npcName)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title: obj.title || "Untitled Secret",
        category: obj.category || "custom",
        truth: obj.truth || "",
        publicCover: obj.publicCover || "",
        motive: obj.motive || "",
        objective: obj.objective || "",
        strategy: obj.strategy || "",
        methods: Array.isArray(obj.methods) ? obj.methods : [],
        targets: Array.isArray(obj.targets) ? obj.targets : [],
        accomplices: Array.isArray(obj.accomplices) ? obj.accomplices : [],
        witnesses: Array.isArray(obj.witnesses) ? obj.witnesses : [],
        evidence: Array.isArray(obj.evidence) ? obj.evidence.map(e => ({
            id: e.id || `evidence_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            type: e.type || "physical",
            description: e.description || "",
            location: e.location || "",
            discovered: !!e.discovered,
            destroyed: !!e.destroyed
        })) : [],
        dependencies: Array.isArray(obj.dependencies) ? obj.dependencies : [],
        relatedSecretIds: Array.isArray(obj.relatedSecretIds) ? obj.relatedSecretIds : [],
        awareness: {
            ownerKnows: obj.awareness?.ownerKnows !== false,
            playerKnows: !!obj.awareness?.playerKnows,
            knownByNpcIds: Array.isArray(obj.awareness?.knownByNpcIds) ? obj.awareness.knownByNpcIds : [],
            suspectedByNpcIds: Array.isArray(obj.awareness?.suspectedByNpcIds) ? obj.awareness.suspectedByNpcIds : [],
            falselyBelievedByNpcIds: Array.isArray(obj.awareness?.falselyBelievedByNpcIds) ? obj.awareness.falselyBelievedByNpcIds : []
        },
        exposure: {
            status: obj.exposure?.status || "hidden",
            risk: Number.isFinite(obj.exposure?.risk) ? obj.exposure.risk : 0.1,
            pressure: Number.isFinite(obj.exposure?.pressure) ? obj.exposure.pressure : 0.1,
            lastNearExposureAt: obj.exposure?.lastNearExposureAt || null,
            exposedAt: obj.exposure?.exposedAt || null,
            exposedBy: obj.exposure?.exposedBy || null
        },
        behaviorRules: Array.isArray(obj.behaviorRules) ? obj.behaviorRules : [],
        contradictionRules: Array.isArray(obj.contradictionRules) ? obj.contradictionRules : [],
        triggerConditions: Array.isArray(obj.triggerConditions) ? obj.triggerConditions : [],
        escalationPlan: Array.isArray(obj.escalationPlan) ? obj.escalationPlan : [],
        fallbackPlan: obj.fallbackPlan || "",
        consequencesIfExposed: Array.isArray(obj.consequencesIfExposed) ? obj.consequencesIfExposed : [],
        origin: obj.origin || "manual",
        createdAt: obj.createdAt || now,
        updatedAt: obj.updatedAt || now,
        lastUsedAt: obj.lastUsedAt || null,
        active: obj.active !== false,
        archived: !!obj.archived,
        immutable: !!obj.immutable,
        notes: obj.notes || ""
    };
    return defaults;
}

// Normalize all secrets and privateIntel for an NPC
export function normalizeNpcSecrets(npc) {
    if (!npc) return npc;
    if (!Array.isArray(npc.secrets)) {
        npc.secrets = [];
    } else {
        npc.secrets = npc.secrets.map(s => {
            if (typeof s === "string") return normalizeSimpleSecret(s, npc);
            return normalizeObjectSecret(s, npc);
        });
    }
    if (!Array.isArray(npc.privateIntel)) {
        npc.privateIntel = [];
    } else {
        npc.privateIntel = npc.privateIntel.map(i => ({
            id: i.id || `intel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            sourceNpcId: i.sourceNpcId || "",
            learnedThrough: i.learnedThrough || "observation",
            content: i.content || "",
            sensitivity: Number.isFinite(i.sensitivity) ? i.sensitivity : 0.5,
            trustContext: i.trustContext || "",
            intendedUse: i.intendedUse || "none",
            actualUse: i.actualUse || "none",
            hasBeenWeaponized: !!i.hasBeenWeaponized,
            weaponizedAt: i.weaponizedAt || null,
            targetAwareness: !!i.targetAwareness
        }));
    }
    return npc;
}

// Sanitizes an NPC object for player-visible prompts, stripping hidden secrets
export function sanitizeNpcForPlayer(npc, playerKnowledgeState = {}) {
    if (!npc) return npc;
    const sanitized = JSON.parse(JSON.stringify(npc));
    normalizeNpcSecrets(sanitized);

    const allSecrets = sanitized.secrets || [];
    const activeHidden = allSecrets.filter(s => s.active && !s.archived && s.exposure?.status === "hidden");
    const activeKnown = allSecrets.filter(s => s.active && !s.archived && (s.exposure?.status === "discovered" || s.exposure?.status === "public"));

    sanitized.secretsCount = activeHidden.length;
    sanitized.knownSecretsCount = activeKnown.length;

    // Filter to only player-known or public secrets
    sanitized.secrets = allSecrets.filter(s => {
        if (!s.active || s.archived) return false;
        const playerKnows = s.awareness?.playerKnows === true || playerKnowledgeState[s.id] === "discovered" || playerKnowledgeState[s.id] === "public" || s.exposure?.status === "discovered" || s.exposure?.status === "public";
        const partial = s.exposure?.status === "partially_discovered" || playerKnowledgeState[s.id] === "partially_discovered";
        const suspected = s.exposure?.status === "suspected" || playerKnowledgeState[s.id] === "suspected";
        return playerKnows || partial || suspected;
    }).map(s => {
        const status = s.exposure?.status || "hidden";
        if (status === "discovered" || status === "public") {
            return {
                id: s.id,
                title: s.title,
                category: s.category,
                truth: s.truth,
                publicCover: s.publicCover,
                motive: s.motive,
                objective: s.objective,
                exposure: { status },
                evidence: (s.evidence || []).filter(e => e.discovered || e.destroyed)
            };
        } else if (status === "partially_discovered") {
            return {
                id: s.id,
                title: s.title,
                category: s.category,
                publicCover: s.publicCover,
                exposure: { status },
                truth: `[Partially Discovered] Some details of this secret have been revealed: ${s.title}.`,
                evidence: (s.evidence || []).filter(e => e.discovered || e.destroyed)
            };
        } else { // suspected
            return {
                id: s.id,
                title: s.title,
                category: s.category,
                publicCover: s.publicCover,
                exposure: { status: "suspected" },
                truth: `[Suspected] There are rumors or signs pointing to a secret: "${s.publicCover || s.title}".`
            };
        }
    });

    delete sanitized.privateIntel;
    return sanitized;
}

// Builds the private context channel of an acting NPC
export function buildPrivateNpcContext(npc, sceneState = {}) {
    if (!npc) return "";
    const sanitized = JSON.parse(JSON.stringify(npc));
    normalizeNpcSecrets(sanitized);

    const activeSecrets = (sanitized.secrets || []).filter(s => s.active && !s.archived);
    const activeIntel = sanitized.privateIntel || [];

    if (!activeSecrets.length && !activeIntel.length) return "";

    const lines = [];
    lines.push(`### PRIVATE SECRETS AND MOTIVES FOR ${npc.name} ###`);
    lines.push(`These are hidden truths, plans, and strategies that ${npc.name} keeps secret. They must guide decisions, dialogue cues, and schedules without being directly exposed to the player.`);

    activeSecrets.forEach(s => {
        lines.push(`\n- Secret: "${s.title}" (Category: ${s.category}, Status: ${s.exposure?.status}, Risk: ${s.exposure?.risk})`);
        lines.push(`  * The Truth: ${s.truth}`);
        if (s.publicCover) lines.push(`  * Public Cover Story: ${s.publicCover}`);
        if (s.motive) lines.push(`  * Hidden Motive: ${s.motive}`);
        if (s.objective) lines.push(`  * Objective: ${s.objective}`);
        if (s.strategy) lines.push(`  * Strategy: ${s.strategy}`);
        if (s.behaviorRules && s.behaviorRules.length) {
            lines.push(`  * Behavior Rules:`);
            s.behaviorRules.forEach(r => lines.push(`    - ${r}`));
        }
        if (s.contradictionRules && s.contradictionRules.length) {
            lines.push(`  * Contradiction Rules (Support public cover while avoiding exposure):`);
            s.contradictionRules.forEach(r => lines.push(`    - ${r}`));
        }
        if (s.triggerConditions && s.triggerConditions.length) {
            lines.push(`  * Triggers for Panic/Escalation: ${s.triggerConditions.join(", ")}`);
        }
        if (s.escalationPlan && s.escalationPlan.length) {
            lines.push(`  * Escalation Plan: ${s.escalationPlan.join(" -> ")}`);
        }
        if (s.fallbackPlan) {
            lines.push(`  * Fallback Cover: ${s.fallbackPlan}`);
        }
    });

    if (activeIntel.length) {
        lines.push(`\n- Private Intel & Leverage:`);
        activeIntel.forEach(i => {
            lines.push(`  * Knows about ${i.sourceNpcId || "someone"}: "${i.content}" (learned through ${i.learnedThrough}, weaponized: ${i.hasBeenWeaponized ? "yes" : "no"})`);
        });
    }

    return lines.join("\n");
}

// Builds subject secrets filtered by viewer's knowledge
export function buildNpcKnowledgeContext(viewerNpcId, subjectNpcId, worldState = {}) {
    const s = getSettings();
    const npcs = Array.isArray(s.npcs) ? s.npcs : [];
    const subject = npcs.find(n => n.id === subjectNpcId || n.name === subjectNpcId || n.cardId === subjectNpcId);
    if (!subject) return "";

    const normalized = JSON.parse(JSON.stringify(subject));
    normalizeNpcSecrets(normalized);

    const activeSecrets = (normalized.secrets || []).filter(sec => sec.active && !sec.archived);
    if (!activeSecrets.length) return "";

    const lines = [];
    const viewerKey = String(viewerNpcId || "").trim().toLowerCase();
    const subjectKey = String(normalized.id || normalized.name || "").trim().toLowerCase();

    activeSecrets.forEach(sec => {
        const isOwner = viewerKey === subjectKey || viewerKey === String(normalized.name || "").trim().toLowerCase();
        const isAccomplice = sec.accomplices.some(a => String(a).trim().toLowerCase() === viewerKey);
        const knows = sec.awareness?.knownByNpcIds?.some(k => String(k).trim().toLowerCase() === viewerKey);
        const suspects = sec.awareness?.suspectedByNpcIds?.some(su => String(su).trim().toLowerCase() === viewerKey);

        if (isOwner) {
            lines.push(`- Owns Secret: "${sec.title}". Truth: ${sec.truth}. Cover: ${sec.publicCover}`);
        } else if (isAccomplice) {
            lines.push(`- Accomplice to ${normalized.name}'s secret: "${sec.title}". Objective: ${sec.objective}`);
        } else if (knows) {
            lines.push(`- Knows ${normalized.name}'s secret: "${sec.title}". Truth: ${sec.truth}`);
        } else if (suspects) {
            lines.push(`- Suspects ${normalized.name}'s secret: "${sec.title}". (Cover story claims: "${sec.publicCover || 'nothing'}")`);
        }
    });

    const output = lines.join("\n").trim();
    return output ? `[Viewer Knowledge about ${normalized.name}]\n${output}` : "";
}

// Helper to set nested properties on an object using dot notation
function setNestedProperty(obj, path, value) {
    const parts = path.split(".");
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined) {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

// Deletes or cleans references to an NPC or Secret
export function cleanOrphanedReferences(npcIdOrName) {
    const s = getSettings();
    const cleanId = String(npcIdOrName || "").trim().toLowerCase();
    if (!cleanId) return;

    const npcs = Array.isArray(s.npcs) ? s.npcs : [];
    npcs.forEach(npc => {
        if (!Array.isArray(npc.secrets)) return;
        npc.secrets.forEach(sec => {
            if (typeof sec === "string") return;
            if (sec.targets) sec.targets = sec.targets.filter(t => String(t).trim().toLowerCase() !== cleanId);
            if (sec.accomplices) sec.accomplices = sec.accomplices.filter(a => String(a).trim().toLowerCase() !== cleanId);
            if (sec.witnesses) sec.witnesses = sec.witnesses.filter(w => String(w).trim().toLowerCase() !== cleanId);
            if (sec.awareness) {
                if (sec.awareness.knownByNpcIds) sec.awareness.knownByNpcIds = sec.awareness.knownByNpcIds.filter(id => String(id).trim().toLowerCase() !== cleanId);
                if (sec.awareness.suspectedByNpcIds) sec.awareness.suspectedByNpcIds = sec.awareness.suspectedByNpcIds.filter(id => String(id).trim().toLowerCase() !== cleanId);
                if (sec.awareness.falselyBelievedByNpcIds) sec.awareness.falselyBelievedByNpcIds = sec.awareness.falselyBelievedByNpcIds.filter(id => String(id).trim().toLowerCase() !== cleanId);
            }
        });
    });
}

// Builds separate prompt context channels for the generation payload
export function buildSecretsPromptContext(s, currentLocation, presentEntities = []) {
    const npcs = Array.isArray(s.npcs) ? s.npcs : [];
    
    // Resolve present entities
    const resolvedPresent = npcs.filter(npc => {
        const name = String(npc.name || "").trim().toLowerCase();
        return presentEntities.some(pe => String(pe).trim().toLowerCase() === name);
    });

    const publicNpcContext = {};
    const privateNpcContext = {};
    const playerKnownContext = {};
    const developerDebugContext = {};

    resolvedPresent.forEach(npc => {
        const name = npc.name;
        
        // 1. Public Context
        publicNpcContext[name] = {
            role: npc.role || npc.title || "NPC",
            appearance: npc.appearance || "",
            personality: npc.personality || "",
            affiliations: npc.affiliations || "",
            publicCoverStories: (npc.secrets || [])
                .filter(sec => sec.active && !sec.archived)
                .map(sec => sec.publicCover || sec.title)
                .filter(Boolean)
        };

        // 2. Private Context
        privateNpcContext[name] = {
            motive: npc.bio || "",
            activeSecrets: (npc.secrets || [])
                .filter(sec => sec.active && !sec.archived)
                .map(sec => ({
                    title: sec.title,
                    category: sec.category,
                    truth: sec.truth,
                    motive: sec.motive,
                    objective: sec.objective,
                    strategy: sec.strategy,
                    behaviorRules: sec.behaviorRules || [],
                    contradictionRules: sec.contradictionRules || []
                })),
            privateIntel: npc.privateIntel || []
        };

        // 3. Player Known Context
        playerKnownContext[name] = {
            discoveredSecrets: (npc.secrets || [])
                .filter(sec => sec.active && !sec.archived && (sec.exposure?.status === "discovered" || sec.exposure?.status === "public" || sec.awareness?.playerKnows))
                .map(sec => ({
                    title: sec.title,
                    truth: sec.truth,
                    exposedAt: sec.exposure?.exposedAt || null
                })),
            evidenceDiscovered: (npc.secrets || [])
                .filter(sec => sec.active && !sec.archived)
                .flatMap(sec => (sec.evidence || []).filter(e => e.discovered).map(e => e.description))
        };

        // 4. Developer Debug Context
        developerDebugContext[name] = {
            allSecrets: (npc.secrets || []).map(sec => ({
                id: sec.id,
                title: sec.title,
                truth: sec.truth,
                exposureStatus: sec.exposure?.status || "hidden",
                risk: sec.exposure?.risk || 0.1,
                awareness: sec.awareness || {}
            }))
        };
    });

    const isDebug = s.includeHiddenSecretsInDebug === true || s.secretsDebugMode === true;
    
    const blocks = [];
    blocks.push("=== NPC SECRETS SYSTEM STATE ===");
    blocks.push(`[publicNpcContext]\\n${JSON.stringify(publicNpcContext, null, 2)}`);
    blocks.push(`[privateNpcContext (For NPC portrayal guidance only)]\\n${JSON.stringify(privateNpcContext, null, 2)}`);
    blocks.push(`[playerKnownContext]\\n${JSON.stringify(playerKnownContext, null, 2)}`);
    
    if (isDebug) {
        blocks.push(`[developerDebugContext (DEVELOPER DEBUG ONLY - DO NOT EXPOSE TO PLAYER)]\\n${JSON.stringify(developerDebugContext, null, 2)}`);
    }

    return blocks.join("\\n\\n");
}

