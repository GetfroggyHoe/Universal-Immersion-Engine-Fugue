const DEFAULT_PROFILE = Object.freeze({
    moodRating: 50,
    relationshipScore: 50,
    isBusy: false,
});

const CALL_BLOCK_REASONS = Object.freeze({
    BUSY: "busy",
    RINGS_OUT_IGNORED: "rings_out_ignored",
    DECLINED_CALL_ANGRY: "declined_call_angry",
});

const ROUTE_SUFFIXES = Object.freeze({
    busy: "_busy_voicemail",
    rings_out_ignored: "_rings_out_ignored",
    declined_call_angry: "_declined_call_angry",
    hangup_left_busy: "_hangup_left_busy",
    hangup_angry: "_hangup_angry",
});

function clampPercent(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(100, Math.trunc(numeric)));
}

function cleanId(value) {
    const id = String(value ?? "").trim();
    if (!id) throw new Error("Character id is required.");
    return id;
}

function defaultNodeName(characterId, suffix) {
    return `${characterId}${suffix}`;
}

/**
 * Persistent NPC communication profile.
 * The host game owns persistence; this object only models runtime-safe state.
 */
export class CharacterProfile {
    constructor(characterId, profile = {}) {
        this.characterId = cleanId(characterId);
        this.moodRating = clampPercent(profile.moodRating, DEFAULT_PROFILE.moodRating);
        this.relationshipScore = clampPercent(profile.relationshipScore, DEFAULT_PROFILE.relationshipScore);
        this.isBusy = Boolean(profile.isBusy ?? DEFAULT_PROFILE.isBusy);
    }

    setMood(value) {
        this.moodRating = clampPercent(value, this.moodRating);
        return this;
    }

    adjustMood(delta) {
        this.moodRating = clampPercent(this.moodRating + Number(delta || 0), this.moodRating);
        return this;
    }

    setRelationshipScore(value) {
        this.relationshipScore = clampPercent(value, this.relationshipScore);
        return this;
    }

    setBusy(isBusy) {
        this.isBusy = Boolean(isBusy);
        return this;
    }

    canTakeCall() {
        // Busy has top priority: the call is actively blocked by availability.
        if (this.isBusy) {
            return { allowed: false, reason: CALL_BLOCK_REASONS.BUSY };
        }

        // The ignored ring-out is a stricter angry case, so it must run before mood < 25.
        if (this.moodRating < 15 && this.relationshipScore < 20) {
            return { allowed: false, reason: CALL_BLOCK_REASONS.RINGS_OUT_IGNORED };
        }

        // Low mood without the severe relationship break produces a direct decline.
        if (this.moodRating < 25) {
            return { allowed: false, reason: CALL_BLOCK_REASONS.DECLINED_CALL_ANGRY };
        }

        return { allowed: true, reason: null };
    }

    toJSON() {
        return {
            characterId: this.characterId,
            moodRating: this.moodRating,
            relationshipScore: this.relationshipScore,
            isBusy: this.isBusy,
        };
    }
}

/**
 * Character State Registry.
 * Stores communication profiles and exposes narrow mutation/query methods.
 */
export class CharacterRegistry {
    constructor(initialProfiles = {}) {
        this.profiles = new Map();
        this.registerMany(initialProfiles);
    }

    registerMany(initialProfiles = {}) {
        if (Array.isArray(initialProfiles)) {
            initialProfiles.forEach((profile) => {
                this.register(profile.characterId || profile.id || profile.name, profile);
            });
            return this;
        }

        Object.entries(initialProfiles || {}).forEach(([characterId, profile]) => {
            this.register(characterId, profile);
        });
        return this;
    }

    register(characterId, profile = {}) {
        const id = cleanId(characterId);
        const existing = this.profiles.get(id);
        const next = existing
            ? Object.assign(existing, {
                moodRating: clampPercent(profile.moodRating ?? existing.moodRating, existing.moodRating),
                relationshipScore: clampPercent(profile.relationshipScore ?? existing.relationshipScore, existing.relationshipScore),
                isBusy: Boolean(profile.isBusy ?? existing.isBusy),
            })
            : new CharacterProfile(id, profile);

        this.profiles.set(id, next);
        return next;
    }

    has(characterId) {
        return this.profiles.has(cleanId(characterId));
    }

    get(characterId) {
        const id = cleanId(characterId);
        const profile = this.profiles.get(id);
        if (!profile) throw new Error(`Unknown communication character: ${id}`);
        return profile;
    }

    update(characterId, patch = {}) {
        const profile = this.get(characterId);
        if (Object.prototype.hasOwnProperty.call(patch, "moodRating")) profile.setMood(patch.moodRating);
        if (Object.prototype.hasOwnProperty.call(patch, "relationshipScore")) profile.setRelationshipScore(patch.relationshipScore);
        if (Object.prototype.hasOwnProperty.call(patch, "isBusy")) profile.setBusy(patch.isBusy);
        return profile;
    }

    canTakeCall(characterId) {
        return this.get(characterId).canTakeCall();
    }

    entries() {
        return Array.from(this.profiles.entries());
    }

    toJSON() {
        return Object.fromEntries(
            this.entries().map(([characterId, profile]) => [characterId, profile.toJSON()]),
        );
    }
}

/**
 * Game-Time Deferred Message Queue.
 * Uses abstract in-game day thresholds only. No setTimeout, Date.now, or wall clock.
 */
export class DelayedMessageScheduler {
    constructor({ inboundTextParser = null } = {}) {
        this.pendingMessages = [];
        this.inboundTextParser = inboundTextParser;
        this.sequence = 0;
    }

    scheduleMessage({ characterId, body, currentDay, delayDays = 1, metadata = {} }) {
        const senderId = cleanId(characterId);
        const day = Number(currentDay);
        const delay = Math.max(0, Math.trunc(Number(delayDays || 0)));
        if (!Number.isFinite(day)) throw new Error("currentDay must be a finite in-game day number.");

        const message = {
            id: `delayed_text_${senderId}_${day}_${this.sequence += 1}`,
            characterId: senderId,
            body: String(body ?? ""),
            scheduledDay: Math.trunc(day),
            targetDay: Math.trunc(day) + delay,
            metadata: { ...metadata },
        };

        this.pendingMessages.push(message);
        return message;
    }

    updateForDay(currentDay, inboundTextParser = this.inboundTextParser) {
        const day = Number(currentDay);
        if (!Number.isFinite(day)) throw new Error("currentDay must be a finite in-game day number.");

        const due = [];
        const stillPending = [];

        for (const message of this.pendingMessages) {
            // Day validation hook: only release messages whose abstract target day has arrived.
            if (Math.trunc(day) >= message.targetDay) due.push(message);
            else stillPending.push(message);
        }

        this.pendingMessages = stillPending;

        if (typeof inboundTextParser === "function") {
            due.forEach((message) => inboundTextParser({
                characterId: message.characterId,
                body: message.body,
                receivedDay: Math.trunc(day),
                metadata: message.metadata,
            }));
        }

        return due;
    }

    cancelMessage(messageId) {
        const before = this.pendingMessages.length;
        this.pendingMessages = this.pendingMessages.filter((message) => message.id !== messageId);
        return before !== this.pendingMessages.length;
    }

    clear() {
        this.pendingMessages = [];
    }
}

/**
 * Bidirectional Communication Logic Controller.
 * Injects narrative state hooks but does not own UI, rendering, persistence, or save/load.
 */
export class CommunicationEngine {
    constructor(narrativeStateManager, {
        characterRegistry = new CharacterRegistry(),
        delayedMessageScheduler = null,
        inboundTextParser = null,
        nodeNameResolver = defaultNodeName,
    } = {}) {
        if (!narrativeStateManager || typeof narrativeStateManager.jumpToNode !== "function") {
            throw new Error("CommunicationEngine requires a narrative state manager with jumpToNode(nodeName).");
        }

        this.storyEngine = narrativeStateManager;
        this.characterRegistry = characterRegistry;
        this.inboundTextParser = inboundTextParser || delayedMessageScheduler?.inboundTextParser || null;
        this.nodeNameResolver = nodeNameResolver;
        this.delayedMessages = delayedMessageScheduler || new DelayedMessageScheduler({ inboundTextParser });
        this.activeCall = null;
    }

    playerDialCharacter(characterId) {
        const profile = this.characterRegistry.get(characterId);
        const callCheck = profile.canTakeCall();

        if (!callCheck.allowed) {
            const suffix = ROUTE_SUFFIXES[callCheck.reason];
            this.activeCall = null;
            this.jumpToCharacterNode(profile.characterId, suffix);
            return {
                connected: false,
                characterId: profile.characterId,
                reason: callCheck.reason,
                activeCall: null,
            };
        }

        this.activeCall = {
            characterId: profile.characterId,
            interactionDepth: 0,
            patienceThreshold: this.calculatePatienceThreshold(profile),
            isActive: true,
        };

        return {
            connected: true,
            characterId: profile.characterId,
            reason: null,
            activeCall: { ...this.activeCall },
        };
    }

    processMidCallInteraction({ characterId = null, offensePoints = 0 } = {}) {
        if (!this.activeCall?.isActive) {
            return { active: false, terminated: false, reason: "no_active_call" };
        }

        const activeCharacterId = cleanId(characterId || this.activeCall.characterId);
        if (activeCharacterId !== this.activeCall.characterId) {
            throw new Error(`Active call is with ${this.activeCall.characterId}, not ${activeCharacterId}.`);
        }

        const profile = this.characterRegistry.get(activeCharacterId);
        this.activeCall.interactionDepth += 1;
        this.activeCall.patienceThreshold = this.calculatePatienceThreshold(profile);

        const offense = Math.max(0, Number(offensePoints || 0));
        if (offense > 0) {
            profile.adjustMood(-offense);
        }

        // Any dialogue option that drops mood below 25 ends the call immediately.
        if (profile.moodRating < 25) {
            return this.terminateActiveCall(ROUTE_SUFFIXES.hangup_angry, "hangup_angry");
        }

        // Patience is floor(mood / 10); exceeding that choice count triggers a busy hang-up.
        if (this.activeCall.interactionDepth > this.activeCall.patienceThreshold) {
            return this.terminateActiveCall(ROUTE_SUFFIXES.hangup_left_busy, "hangup_left_busy");
        }

        return {
            active: true,
            terminated: false,
            reason: null,
            activeCall: { ...this.activeCall },
            moodRating: profile.moodRating,
        };
    }

    scheduleDelayedTextReply(characterId, body, { currentDay, delayDays = 1, metadata = {} } = {}) {
        return this.delayedMessages.scheduleMessage({
            characterId,
            body,
            currentDay,
            delayDays,
            metadata,
        });
    }

    updateGameDay(currentDay) {
        return this.delayedMessages.updateForDay(currentDay, this.inboundTextParser);
    }

    endCall({ reason = "ended" } = {}) {
        if (!this.activeCall) return { ended: false, reason: "no_active_call" };
        const endedCall = { ...this.activeCall, endReason: reason, isActive: false };
        this.activeCall = null;
        return { ended: true, reason, activeCall: endedCall };
    }

    calculatePatienceThreshold(profile) {
        return Math.floor(clampPercent(profile.moodRating, 0) / 10);
    }

    terminateActiveCall(routeSuffix, reason) {
        const endedCall = this.activeCall ? { ...this.activeCall, endReason: reason, isActive: false } : null;
        this.activeCall = null;
        if (endedCall) this.jumpToCharacterNode(endedCall.characterId, routeSuffix);
        return {
            active: false,
            terminated: true,
            reason,
            activeCall: endedCall,
        };
    }

    jumpToCharacterNode(characterId, suffix) {
        const nodeName = this.nodeNameResolver(cleanId(characterId), suffix);
        this.storyEngine.jumpToNode(nodeName);
        return nodeName;
    }
}

export function createFugueCommunicationSystem(narrativeStateManager, {
    initialProfiles = {},
    inboundTextParser = null,
    nodeNameResolver = defaultNodeName,
} = {}) {
    const characterRegistry = new CharacterRegistry(initialProfiles);
    const delayedMessageScheduler = new DelayedMessageScheduler({ inboundTextParser });
    const communicationEngine = new CommunicationEngine(narrativeStateManager, {
        characterRegistry,
        delayedMessageScheduler,
        inboundTextParser,
        nodeNameResolver,
    });

    return {
        characterRegistry,
        delayedMessageScheduler,
        communicationEngine,
    };
}

export { CALL_BLOCK_REASONS, ROUTE_SUFFIXES };
