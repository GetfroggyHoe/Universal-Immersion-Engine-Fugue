import { getSettings, saveSettings } from "./core.js";
import { normalizeFactions } from "./factions.js";
import { ensureGenericNpcsState } from "./genericNpcs.js";
import { addInventoryItemWithStack } from "./inventoryItems.js";
import { injectRpEvent } from "./features/rp_log.js";
import { issueCredential } from "./credentialSystem.js";

const SCHOOL_LOCATION_RE = /\b(school|academy|campus|university|college|classroom|homeroom|lecture hall|dormitory)\b/i;
const DISCIPLINE_STEPS = ["Clear", "Warning", "Detention", "Suspension", "Expulsion"];
export const ACADEMY_REGEX = Object.freeze({
    location: SCHOOL_LOCATION_RE,
    finalDay: /\b(final\s+(day|week)|end\s+of\s+(term|semester|year)|term\s+completion|graduation\s+day|commencement)\b/i,
    ceremony: /\b(graduation|commencement|ceremony|diploma|degree|valedictorian|graduate)\b/i,
    careerInterface: /\b(phone\s+app|smartphone|pc\s+terminal|career\s+app|education\s+app|job\s+board|college\s+application|student\s+loan|financial\s+aid)\b/i,
    fantasyInterface: /\b(guild\s+hall|town\s+square|notice\s+board|job\s+board|courier|messenger|sealed\s+scroll|patron|guild\s+contract|pigeon\s+network)\b/i,
    club: /\b(club|student\s+council|varsity|team|captain|president|charter|manifesto|tournament|regional|budget\s+battle|rival\s+club)\b/i,
    homework: /\b(homework|assignment|essay|problem\s+set|study|textbook|notes|study\s+guide|deadline|turn\s*in|answer\s+key|cheat)\b/i,
    rank: /\b(rank|leaderboard|bulletin\s+board|honor\s+roll|valedictorian|top\s+student)\b/i,
    debt: /\b(debt|loan|repayment|garnish|tuition|financial\s+aid|scholarship|sponsorship|patronage)\b/i,
    clearance: /\b(id\s+card|clearance|server\s+room|greenhouse|faculty\s+lounge|clubroom|locker|hall\s+pass|excused\s+absence)\b/i
});

export const ACADEMY_MACROS = Object.freeze({
    finalEvaluation: "ACADEMY_FINAL_EVALUATION",
    graduationPayload: "ACADEMY_GRADUATION_PAYLOAD",
    careerEducationApp: "ACADEMY_CAREER_EDUCATION_APP",
    fantasyDelivery: "ACADEMY_FANTASY_DELIVERY",
    assignmentLedger: "ACADEMY_ASSIGNMENT_LEDGER",
    studyResolution: "ACADEMY_STUDY_RESOLUTION",
    clubCharter: "ACADEMY_CLUB_CHARTER",
    clubHierarchy: "ACADEMY_CLUB_HIERARCHY",
    budgetBattle: "ACADEMY_BUDGET_BATTLE",
    tournamentArc: "ACADEMY_TOURNAMENT_ARC",
    macroBleed: "ACADEMY_MACRO_BLEED"
});

function id(prefix = "academy") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clean(value, fallback = "") {
    return String(value ?? fallback).trim();
}

function clip(value, max = 280) {
    return clean(value).replace(/\s+/g, " ").slice(0, max);
}

function normKey(value) {
    return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function clamp(n, min, max, fallback = min) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
}

function asList(value) {
    if (Array.isArray(value)) return value.map((x) => clean(x?.name || x?.text || x)).filter(Boolean);
    return clean(value).split(/\n|,/).map((x) => x.trim()).filter(Boolean);
}

function nowIso() {
    return new Date().toISOString();
}

function worldEra(s = getSettings()) {
    const raw = `${s?.worldState?.era || ""} ${s?.worldState?.tech || ""} ${s?.worldState?.genre || ""} ${s?.worldState?.worldType || ""} ${s?.storyPreset?.genre || ""}`.toLowerCase();
    if (/\b(fantasy|medieval|historical|ancient|guild|kingdom|magic)\b/.test(raw)) return "fantasy";
    if (/\b(sci[-\s]?fi|cyber|space|future)\b/.test(raw)) return "sci-fi";
    return "modern";
}

function schoolSlug(name = "") {
    return normKey(name || "current school").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "current_school";
}

export function isAcademyContext(s = getSettings()) {
    const academy = s?.academy;
    if (academy?.active === true) return true;
    const loc = `${s?.worldState?.location || ""} ${s?.worldState?.locationPath || ""} ${s?.worldState?.mapContext?.local?.name || ""}`;
    return SCHOOL_LOCATION_RE.test(loc);
}

function defaultFactionsForSchool(profile = {}) {
    const type = `${profile.schoolType || profile.type || ""} ${profile.theme || ""}`.toLowerCase();
    if (/\b(military|cadet|war|tactical|officer)\b/.test(type)) {
        return ["The Tacticians", "The Frontline Cadets", "The Legacy Officers", "The Washout Row"];
    }
    if (/\b(magic|arcane|wizard|witch|mage)\b/.test(type)) {
        return ["The Formula Circle", "The Duel Hall", "The Old Blood Houses", "The Forbidden Stacks"];
    }
    if (/\b(public|high school|modern|suburban)\b/.test(type)) {
        return ["Varsity Athletes", "The AV Club", "The Honor Roll Elites", "The Burnouts"];
    }
    return ["The Honor Track", "The Practicals", "The Social Court", "The Outsiders"];
}

function defaultCourses(profile = {}) {
    const major = clean(profile.major || "Undeclared");
    if (/magic|arcane|thaum/i.test(major)) {
        return [
            { code: "ARC-101", name: "Foundations of Applied Spell Theory", credits: 4, required: true },
            { code: "RUN-110", name: "Rune Syntax and Safe Casting", credits: 3, required: true },
            { code: "HIS-120", name: "Institutional Magical History", credits: 3, required: false }
        ];
    }
    if (/military|tactic|strategy|command/i.test(major)) {
        return [
            { code: "TAC-101", name: "Small Unit Tactics", credits: 4, required: true },
            { code: "LOG-120", name: "Field Logistics", credits: 3, required: true },
            { code: "ETH-130", name: "Command Ethics", credits: 3, required: false }
        ];
    }
    return [
        { code: "MTH-101", name: "Applied Mathematics", credits: 4, required: true },
        { code: "ENG-110", name: "Composition and Rhetoric", credits: 3, required: true },
        { code: "HIS-120", name: "World History Survey", credits: 3, required: false }
    ];
}

function schoolStatusForRank(rank) {
    if (rank <= 3) return "elite honors";
    if (rank <= 10) return "honors track";
    if (rank <= 35) return "good standing";
    if (rank <= 55) return "academic watch";
    return "academic probation";
}

function visualForFaction(faction, role = "student") {
    const f = normKey(faction);
    if (f.includes("legacy") || f.includes("old blood")) return `A composed ${role} with immaculate uniform lines, polished shoes, and a family signet worn like a warning. Their posture is too practiced to be casual, and their eyes keep measuring who belongs in the room.`;
    if (f.includes("athlete") || f.includes("frontline") || f.includes("duel")) return `A kinetic ${role} with rolled sleeves, scuffed training gear, and the kind of balance that comes from daily drills. They carry themself as if every hallway could become an arena.`;
    if (f.includes("honor") || f.includes("tactician") || f.includes("formula")) return `A focused ${role} with neat notes, sharp eyes, and a uniform arranged with almost mathematical precision. They look tired in the specific way of someone competing against a leaderboard.`;
    if (f.includes("burnout") || f.includes("washout") || f.includes("outsider")) return `A guarded ${role} with loose uniform details, wary shoulders, and a gaze that checks exits before faces. Their style says they know the rules and have already priced the consequences.`;
    return `A distinct ${role} with a school-issued badge, practical clothing, and a watchful expression tuned to the institution around them. They seem ordinary only until the hierarchy notices them.`;
}

function makeNpcCard({ name, role, rank, faction, club = "", schoolName = "", tier = "standard", userRank = 50, mandatory = false }) {
    const safeRank = clamp(rank, 1, 80, 40);
    const disposition = safeRank < userRank
        ? "Dismissive until the user proves academic competence."
        : safeRank > userRank
            ? "Alert and slightly intimidated by the user's standing."
            : "Competitive because the user is a direct peer.";
    return {
        id: id("academy_npc"),
        scope: "save_only",
        source: "dynamic_academy",
        name: clean(name || `Rank ${safeRank} Student`),
        role: clean(role || "Student"),
        archetype: "Academy NPC",
        faction: clean(faction || "Unaffiliated"),
        tags: ["Academy", "Save Only", clean(role || "Student"), clean(faction || "Faction")].filter(Boolean),
        visualAnchor: visualForFaction(faction, role),
        hierarchyStatus: `Rank ${safeRank}, ${schoolStatusForRank(safeRank)}`,
        rank: safeRank,
        disciplinaryStanding: "Clear",
        club: clean(club),
        schoolName: clean(schoolName),
        tier: clean(tier),
        loreHook: `${clean(name || "This student")}'s academic pressure is tied to ${schoolName || "the school"}'s reputation ladder.`,
        dispositionMatrix: disposition,
        stressLevel: clamp(30 + safeRank, 5, 95, 55),
        opinionOfUser: disposition,
        wants: "Improve their institutional standing without being publicly humiliated.",
        needs: "Protect their schedule, notes, rank, and faction ties.",
        desires: "Convert school success into privileges outside the campus boundary.",
        habits: ["Checks posted rankings", "Tracks deadlines", "Reads faction cues"],
        recentEvents: [],
        affinity: 45,
        createdAt: Date.now(),
        mandatory: !!mandatory
    };
}

function ensureAcademyNpcStore(s) {
    ensureGenericNpcsState(s);
    if (!s.genericNpcs.academy || typeof s.genericNpcs.academy !== "object") s.genericNpcs.academy = {};
    if (!s.genericNpcs.academy.npcs || typeof s.genericNpcs.academy.npcs !== "object") s.genericNpcs.academy.npcs = {};
    return s.genericNpcs.academy.npcs;
}

function upsertSchoolFactions(s, academy) {
    const factions = normalizeFactions(s);
    const schoolId = schoolSlug(academy.profile.name);
    const existingByName = new Map(factions.list.map((f) => [normKey(f.name), f]));
    for (const fac of academy.factions) {
        const name = `${academy.profile.name}: ${fac.name}`;
        let org = existingByName.get(normKey(name));
        if (!org) {
            org = {
                id: `school_${schoolId}_${schoolSlug(fac.name)}`,
                name,
                type: "school faction",
                standing: 0,
                scope: "campus",
                influence: "campus",
                base: academy.profile.name,
                baseType: "school",
                controlledSpaces: fac.controlledSpaces || [],
                assets: ["Class ranking influence", "Notes network", "Access rumors"],
                members: [],
                leader: "",
                subLeaders: [],
                runIns: [],
                majorEvents: [],
                notes: fac.description || "",
                npcTemplate: fac.name,
                updatedAt: Date.now()
            };
            factions.list.push(org);
        }
        const memberNames = [
            ...Object.values(academy.npcs || {}).filter((n) => n.faction === fac.name).map((n) => n.name),
            ...Object.values(ensureAcademyNpcStore(s)).filter((n) => n.faction === fac.name && n.schoolName === academy.profile.name).map((n) => n.name)
        ];
        const seen = new Set((org.members || []).map((m) => normKey(m.name || m)));
        for (const member of memberNames) {
            if (!member || seen.has(normKey(member))) continue;
            org.members.push({ id: id("mem"), name: member, rank: "Student", role: fac.name, authority: "", location: academy.profile.name, notes: "Dynamic Academy save-only NPC." });
            seen.add(normKey(member));
        }
        org.updatedAt = Date.now();
    }
}

function injectIdCard(s, academy) {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    const cardName = `${academy.profile.name} Student ID`;
    const schoolKey = schoolSlug(academy.profile.name || academy.id || "academy");
    issueCredential(s, {
        type: "student_id",
        issueKey: `academy:${academy.id}:student_id`,
        issuerId: academy.id,
        issuerName: academy.profile.name,
        holderId: "player",
        holderName: s.character?.name || "Student",
        credentialNumber: academy.idCard.studentNumber,
        title: `${academy.profile.major || "Undeclared"} Student`,
        permissions: [
            `${schoolKey}.student_entry`,
            `${schoolKey}.clearance.${academy.idCard.clearanceLevel}`,
            ...(Number(academy.idCard.clearanceLevel || 0) >= 3 ? [`${schoolKey}.club_access`] : []),
            ...(Number(academy.idCard.clearanceLevel || 0) >= 5 ? [`${schoolKey}.faculty_lounge`] : [])
        ],
        linkedLocationIds: [academy.id, academy.profile.name],
        appearance: { templateId: "modern_identity_student", theme: "academic", accent: "#38bdf8" },
        security: { barcodeValue: academy.idCard.studentNumber, qrValue: `uie:academy:${academy.id}:${academy.idCard.studentNumber}`, hologram: true, scanDifficulty: 78 }
    });
    const exists = s.inventory.items.some((it) => normKey(it?.name) === normKey(cardName) && it?._meta?.schoolId === academy.id);
    if (exists) return false;
    addInventoryItemWithStack(s.inventory.items, {
        name: cardName,
        type: "Access ID",
        rarity: "common",
        locked: true,
        starred: true,
        tags: ["school_id", "academy_access", `clearance:${academy.idCard.clearanceLevel}`],
        description: `A tangible school ID for ${academy.profile.name}. Clearance ${academy.idCard.clearanceLevel}; locked sectors must show a real door, checkpoint, or staff barrier.`,
        _meta: {
            source: "dynamic_academy",
            schoolId: academy.id,
            clearanceLevel: academy.idCard.clearanceLevel,
            studentNumber: academy.idCard.studentNumber
        }
    }, { source: "dynamic_academy" });
    return true;
}

function injectTextbooks(s, academy) {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    let changed = false;
    for (const course of academy.curriculum.courses) {
        const name = `${course.code} ${course.name} Textbook`;
        const exists = s.inventory.items.some((it) => normKey(it?.name) === normKey(name) && it?._meta?.schoolId === academy.id);
        if (exists) continue;
        const pages = clamp(academy.settings.maxTextbookPages, 5, 50, 25);
        addInventoryItemWithStack(s.inventory.items, {
            name,
            type: "Textbook",
            rarity: "common",
            locked: true,
            tags: ["textbook", "school_supply", course.code],
            description: `Required textbook for ${course.name}. Assignments and exams should draw from this book, not unrelated world fluff.`,
            book: {
                title: name,
                source: "dynamic_academy",
                text: [
                    `${course.name}`,
                    `Course code: ${course.code}. Credits: ${course.credits}.`,
                    `This persistent textbook is capped at roughly ${pages} pages in the School Settings model.`,
                    "Core lesson structure: definitions, worked examples, practice prompts, and exam-review facts should be generated from the enrolled school lore or real subject matter when the class begins.",
                    "The AI educator must teach from this material and keep exams strictly grounded in generated course content."
                ].join("\n\n")
            },
            _meta: {
                source: "dynamic_academy",
                schoolId: academy.id,
                courseCode: course.code
            }
        }, { source: "dynamic_academy", forceBook: true });
        changed = true;
    }
    return changed;
}

function ensureCareerState(s) {
    if (!s.academyCareer || typeof s.academyCareer !== "object") s.academyCareer = {};
    const c = s.academyCareer;
    if (!Array.isArray(c.educationApplications)) c.educationApplications = [];
    if (!Array.isArray(c.jobApplications)) c.jobApplications = [];
    if (!Array.isArray(c.debts)) c.debts = [];
    if (!Array.isArray(c.deliveryQueue)) c.deliveryQueue = [];
    if (!Array.isArray(c.unlockedJobs)) c.unlockedJobs = [];
    return c;
}

function ensureClubState(academy) {
    if (!academy.clubs || typeof academy.clubs !== "object") academy.clubs = { memberships: [], budget: {}, tournaments: [] };
    if (!Array.isArray(academy.clubs.memberships)) academy.clubs.memberships = [];
    if (!academy.clubs.budget || typeof academy.clubs.budget !== "object") academy.clubs.budget = {};
    if (!Array.isArray(academy.clubs.tournaments)) academy.clubs.tournaments = [];
    return academy.clubs;
}

function hasInventoryMatch(s, test) {
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    return items.some((it) => test(it, `${it?.name || ""} ${it?.type || ""} ${(it?.tags || []).join(" ")} ${it?.description || ""}`));
}

function injectAcademyItem(s, item, source = "dynamic_academy") {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    addInventoryItemWithStack(s.inventory.items, {
        id: item.id || id("academy_item"),
        qty: 1,
        rarity: "important",
        locked: true,
        starred: true,
        ...item
    }, { source });
}

function ensureIdClearance(s, academy, clearanceLevel, tags = []) {
    academy.idCard.clearanceLevel = Math.max(Number(academy.idCard.clearanceLevel || 1), clamp(clearanceLevel, 0, 9, 1));
    const cardName = `${academy.profile.name} Student ID`;
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    const card = items.find((it) => normKey(it?.name) === normKey(cardName) && it?._meta?.schoolId === academy.id);
    if (card) {
        card.tags = Array.from(new Set([...(card.tags || []), `clearance:${academy.idCard.clearanceLevel}`, ...tags]));
        card.description = `A tangible school ID for ${academy.profile.name}. Clearance ${academy.idCard.clearanceLevel}; club privileges can bend access only through physical doors, passes, and witnesses.`;
        card._meta = { ...(card._meta || {}), clearanceLevel: academy.idCard.clearanceLevel, clubPrivileges: tags };
    }
}

function buildLeaderboard(factions, size = 60) {
    const names = [
        "Arthur Pendelton", "Mina Vale", "Soren Halberg", "Iris Kade", "Jun Arclight", "Leona Voss",
        "Theo Marwick", "Selene Crowe", "Haruto Saye", "Dalia Finch", "Rowan Pell", "Cass Mira",
        "Nadia Cross", "Elias Thorn", "Vera Holt", "Kaito Wren", "Mara Quill", "Felix Nohr"
    ];
    const out = [];
    for (let rank = 1; rank <= size; rank++) {
        const faction = factions[(rank - 1) % Math.max(1, factions.length)]?.name || "Unaffiliated";
        out.push({
            id: `rank_${rank}`,
            name: names[(rank - 1) % names.length] + (rank > names.length ? ` ${Math.ceil(rank / names.length)}` : ""),
            rank,
            faction,
            instantiated: false
        });
    }
    return out;
}

export function ensureAcademyState(s = getSettings()) {
    if (!s.academy || typeof s.academy !== "object") s.academy = {};
    const a = s.academy;
    if (typeof a.active !== "boolean") a.active = false;
    if (!a.profile || typeof a.profile !== "object") a.profile = {};
    a.profile.name = clean(a.profile.name || "Current Academy");
    a.profile.schoolType = clean(a.profile.schoolType || a.profile.type || "School");
    a.profile.tier = clean(a.profile.tier || "Standard");
    a.profile.major = clean(a.profile.major || "Undeclared");
    if (!a.settings || typeof a.settings !== "object") a.settings = {};
    a.settings.maxTextbookPages = clamp(a.settings.maxTextbookPages, 5, 50, 25);
    a.settings.maxTestQuestions = clamp(a.settings.maxTestQuestions, 1, 200, 25);
    if (!Array.isArray(a.memoryTags)) a.memoryTags = [];
    if (!Array.isArray(a.events)) a.events = [];
    if (!a.curriculum || typeof a.curriculum !== "object") a.curriculum = { major: a.profile.major, courses: [] };
    if (!Array.isArray(a.curriculum.courses)) a.curriculum.courses = [];
    if (!Array.isArray(a.factions)) a.factions = [];
    if (!Array.isArray(a.leaderboard)) a.leaderboard = [];
    if (!a.npcs || typeof a.npcs !== "object") a.npcs = {};
    if (!a.idCard || typeof a.idCard !== "object") {
        a.idCard = { clearanceLevel: 1, studentNumber: `STU-${Math.floor(100000 + Math.random() * 899999)}` };
    }
    a.idCard.clearanceLevel = clamp(a.idCard.clearanceLevel, 0, 9, 1);
    if (!a.discipline || typeof a.discipline !== "object") a.discipline = { level: 0, status: "Clear", infractions: [] };
    a.discipline.level = clamp(a.discipline.level, 0, DISCIPLINE_STEPS.length - 1, 0);
    a.discipline.status = DISCIPLINE_STEPS[a.discipline.level] || "Clear";
    if (!a.schedule || typeof a.schedule !== "object") a.schedule = { blocks: [] };
    if (!Array.isArray(a.schedule.blocks)) a.schedule.blocks = [];
    if (!a.assignments || typeof a.assignments !== "object") a.assignments = { active: [], completed: [] };
    if (!Array.isArray(a.assignments.active)) a.assignments.active = [];
    if (!Array.isArray(a.assignments.completed)) a.assignments.completed = [];
    if (!a.grades || typeof a.grades !== "object") a.grades = { gpa: 2.5, courseScores: {}, exams: [] };
    a.grades.gpa = clamp(a.grades.gpa, 0, 4, 2.5);
    if (!a.term || typeof a.term !== "object") a.term = { locked: false, finalYear: false, completedTerms: 0, scorecards: [] };
    if (!Array.isArray(a.term.scorecards)) a.term.scorecards = [];
    ensureClubState(a);
    return a;
}

export function enterAcademy(profile = {}, options = {}) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const name = clean(profile.name || profile.schoolName || academy.profile.name || s?.worldState?.location || "Current Academy");
    academy.active = true;
    academy.id = academy.id || `school_${schoolSlug(name)}`;
    academy.profile = {
        ...academy.profile,
        name,
        schoolType: clean(profile.schoolType || profile.type || academy.profile.schoolType || "School"),
        tier: clean(profile.tier || academy.profile.tier || "Standard"),
        reputation: clean(profile.reputation || academy.profile.reputation || academy.profile.tier || "Standard"),
        major: clean(profile.major || academy.profile.major || "Undeclared"),
        gradingStrictness: clip(profile.gradingStrictness || academy.profile.gradingStrictness || "Strict deterministic grading; performance must be earned.", 220)
    };
    academy.settings.maxTextbookPages = clamp(profile.maxTextbookPages ?? academy.settings.maxTextbookPages, 5, 50, 25);
    academy.settings.maxTestQuestions = clamp(profile.maxTestQuestions ?? profile.maxQuestions ?? academy.settings.maxTestQuestions, 1, 200, 25);
    academy.curriculum.major = academy.profile.major;
    if (!academy.curriculum.courses.length || options.replaceCurriculum) {
        academy.curriculum.courses = Array.isArray(profile.courses) && profile.courses.length ? profile.courses : defaultCourses(academy.profile);
    }
    if (!academy.factions.length || options.replaceFactions) {
        academy.factions = defaultFactionsForSchool(academy.profile).map((name, index) => ({
            id: `fac_${schoolSlug(name)}`,
            name,
            description: `${name} are part of ${academy.profile.name}'s campus social ecosystem.`,
            controlledSpaces: index === 0 ? ["Library", "Study Hall"] : index === 1 ? ["Gym", "Training Yard"] : index === 2 ? ["Student Council Office"] : ["Courtyard", "Back Hall"]
        }));
    }
    if (!academy.leaderboard.length || options.replaceLeaderboard) academy.leaderboard = buildLeaderboard(academy.factions, 60);

    const top = academy.leaderboard[0] || { name: "Rank One Student", rank: 1, faction: academy.factions[0]?.name };
    const mandatory = [
        makeNpcCard({ name: "Professor Halden Mire", role: "Homeroom Teacher", rank: 0, faction: academy.factions[0]?.name, schoolName: academy.profile.name, tier: academy.profile.tier, mandatory: true }),
        makeNpcCard({ name: top.name, role: "Top Ranked Student", rank: 1, faction: top.faction, schoolName: academy.profile.name, tier: academy.profile.tier, userRank: 50, mandatory: true }),
        makeNpcCard({ name: "Director Maris Vale", role: "Disciplinary Officer", rank: 0, faction: academy.factions[2]?.name, schoolName: academy.profile.name, tier: academy.profile.tier, mandatory: true }),
        makeNpcCard({ name: "Club President Placeholder", role: "Club President", rank: 8, faction: academy.factions[1]?.name, schoolName: academy.profile.name, tier: academy.profile.tier, mandatory: true })
    ];
    for (const npc of mandatory) {
        if (!Object.values(academy.npcs).some((x) => normKey(x.name) === normKey(npc.name))) academy.npcs[npc.id] = npc;
    }
    injectIdCard(s, academy);
    injectTextbooks(s, academy);
    upsertSchoolFactions(s, academy);
    academy.events.unshift({ ts: Date.now(), type: "enter", text: `Entered ${academy.profile.name}; academy context sandbox enabled.` });
    academy.events = academy.events.slice(0, 40);
    saveSettings();
    try { injectRpEvent(`[School System: Entered ${academy.profile.name}. Context sandbox active. ID card, curriculum, leaderboard, factions, and save-only NPC generation are authoritative.]`); } catch (_) {}
    return academy;
}

export function autoEnterAcademyFromLocation(s = getSettings()) {
    if (!isAcademyContext(s)) return null;
    const academy = ensureAcademyState(s);
    if (academy.active && academy.id) return academy;
    const loc = clean(s?.worldState?.location || s?.worldState?.mapContext?.local?.name || "Current Academy");
    return enterAcademy({ name: loc, schoolType: "School" });
}

export function instantiateAcademyNpc(phantomIdOrName, hints = {}) {
    const s = getSettings();
    const academy = autoEnterAcademyFromLocation(s) || ensureAcademyState(s);
    const key = normKey(phantomIdOrName);
    const phantom = academy.leaderboard.find((x) => normKey(x.id) === key || normKey(x.name) === key) || null;
    const rank = clamp(hints.rank ?? phantom?.rank, 1, 80, 30);
    const faction = clean(hints.faction || phantom?.faction || academy.factions[(rank - 1) % Math.max(1, academy.factions.length)]?.name || "Unaffiliated");
    const npc = makeNpcCard({
        name: hints.name || phantom?.name || phantomIdOrName,
        role: hints.role || "Student",
        rank,
        faction,
        club: hints.club || "",
        schoolName: academy.profile.name,
        tier: academy.profile.tier,
        userRank: academy.userRank || 50
    });
    const store = ensureAcademyNpcStore(s);
    store[npc.id] = npc;
    academy.npcs[npc.id] = npc;
    if (phantom) phantom.instantiated = true;
    upsertSchoolFactions(s, academy);
    saveSettings();
    try { injectRpEvent(`[School NPC: ${npc.name} instantiated as a save-only academy NPC from ${faction}, Rank ${rank}.]`); } catch (_) {}
    return npc;
}

export function recordAcademyInfraction(reason = "", severity = 1) {
    const s = getSettings();
    const academy = autoEnterAcademyFromLocation(s) || ensureAcademyState(s);
    academy.discipline.level = clamp(Number(academy.discipline.level || 0) + clamp(severity, 1, 4, 1), 0, DISCIPLINE_STEPS.length - 1, 0);
    academy.discipline.status = DISCIPLINE_STEPS[academy.discipline.level] || "Clear";
    academy.discipline.infractions = Array.isArray(academy.discipline.infractions) ? academy.discipline.infractions : [];
    academy.discipline.infractions.unshift({ ts: Date.now(), reason: clip(reason || "Institutional violation", 220), status: academy.discipline.status });
    academy.discipline.infractions = academy.discipline.infractions.slice(0, 20);
    if (academy.discipline.status === "Suspension" || academy.discipline.status === "Expulsion") {
        academy.forcedLocationShift = {
            status: academy.discipline.status,
            reason: reason || "Institutional discipline",
            destination: "Off Campus",
            lockSchoolMap: academy.discipline.status === "Expulsion"
        };
    }
    saveSettings();
    return academy.discipline;
}

export function createAcademyAssignment(payload = {}) {
    const s = getSettings();
    const academy = autoEnterAcademyFromLocation(s) || ensureAcademyState(s);
    const course = clean(payload.course || payload.courseCode || academy.curriculum.courses[0]?.code || "GEN-100");
    const assignment = {
        id: payload.id || id("assignment"),
        macro: ACADEMY_MACROS.assignmentLedger,
        title: clean(payload.title || payload.name || `${course} Assignment`),
        course,
        issuedAt: payload.issuedAt || nowIso(),
        dueAt: clean(payload.dueAt || payload.deadline || ""),
        hoursRequired: clamp(payload.hoursRequired ?? 2, 1, 12, 2),
        materialTags: asList(payload.materialTags || ["textbook"]),
        status: "active",
        quality: 0,
        source: "teacher"
    };
    academy.assignments.active.unshift(assignment);
    academy.events.unshift({ ts: Date.now(), type: "assignment_issued", text: `${assignment.title} due ${assignment.dueAt || "next class"}.`, assignmentId: assignment.id });
    saveSettings();
    return assignment;
}

export function completeAcademyAssignment(assignmentId, options = {}) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const idx = academy.assignments.active.findIndex((a) => String(a.id) === String(assignmentId));
    if (idx < 0) return null;
    const assignment = academy.assignments.active[idx];
    const hasTextbook = hasInventoryMatch(s, (_it, hay) => /\btextbook\b/i.test(hay) && (!assignment.course || hay.includes(assignment.course)));
    const hasGuide = hasInventoryMatch(s, (_it, hay) => /\b(study\s*guide|annotated\s+notes|custom\s+notes)\b/i.test(hay));
    const socialBoost = clamp(options.socialBoost ?? 0, 0, 30, 0);
    const activeBonus = options.activeRoleplay ? 30 : 0;
    const cheating = !!options.cheating;
    let quality = hasTextbook ? 68 : 45;
    if (hasGuide) quality += 20;
    quality += socialBoost + activeBonus;
    if (cheating) quality += 12;
    quality = clamp(quality, 0, 100, 50);
    if (cheating && Math.random() < clamp(options.catchChance ?? 0.22, 0, 1, 0.22)) {
        recordAcademyInfraction(`Caught cheating on ${assignment.title}.`, 3);
    }
    const completed = {
        ...assignment,
        macro: ACADEMY_MACROS.studyResolution,
        status: "completed",
        completedAt: nowIso(),
        quality,
        hoursSpent: clamp(options.hoursSpent ?? assignment.hoursRequired, 0, 24, assignment.hoursRequired),
        evidence: {
            textbook: hasTextbook,
            studyGuide: hasGuide,
            activeRoleplay: !!options.activeRoleplay,
            cheating
        }
    };
    academy.assignments.active.splice(idx, 1);
    academy.assignments.completed.unshift(completed);
    academy.grades.courseScores[assignment.course] = clamp(((academy.grades.courseScores[assignment.course] ?? 70) * 0.75) + (quality * 0.25), 0, 100, quality);
    saveSettings();
    return completed;
}

export function evaluateOverdueAssignments(now = new Date()) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const current = new Date(now).getTime();
    if (!Number.isFinite(current)) return [];
    const missed = [];
    for (const assignment of [...academy.assignments.active]) {
        const due = Date.parse(assignment.dueAt || "");
        if (!Number.isFinite(due) || due > current) continue;
        missed.push(assignment);
        assignment.status = "missed";
        academy.assignments.active = academy.assignments.active.filter((a) => a.id !== assignment.id);
        academy.assignments.completed.unshift({ ...assignment, quality: 0, missedAt: nowIso() });
        recordAcademyInfraction(`Missed deadline for ${assignment.title}.`, 1);
    }
    if (missed.length) saveSettings();
    return missed;
}

export function calculateAcademyScorecard() {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const scores = Object.values(academy.grades.courseScores || {}).map(Number).filter(Number.isFinite);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : clamp(Number(academy.grades.gpa || 2.5) * 25, 0, 100, 62.5);
    const gpa = clamp(avg / 25, 0, 4, 2.5);
    const missed = (academy.assignments.completed || []).filter((a) => a.status === "missed").length;
    const completed = (academy.assignments.completed || []).filter((a) => a.status === "completed").length;
    const rank = clamp(Math.round(61 - (avg * 0.55) + (academy.discipline.level * 4) + missed - Math.min(8, completed)), 1, 60, academy.userRank || 50);
    return {
        macro: ACADEMY_MACROS.finalEvaluation,
        school: academy.profile.name,
        gpa: Number(gpa.toFixed(2)),
        average: Math.round(avg),
        rank,
        leaderboardTitle: rank === 1 ? "Valedictorian" : rank <= 10 ? "Honor Graduate" : rank >= 55 ? "Barely Graduated" : "Graduate",
        discipline: academy.discipline.status,
        strikes: academy.discipline.level,
        completedAssignments: completed,
        missedAssignments: missed
    };
}

export function completeAcademyTerm(options = {}) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    academy.term.locked = true;
    academy.term.completedTerms = Number(academy.term.completedTerms || 0) + 1;
    const scorecard = calculateAcademyScorecard();
    academy.grades.gpa = scorecard.gpa;
    academy.userRank = scorecard.rank;
    academy.term.scorecards.unshift({ ...scorecard, ts: Date.now() });
    const finalYear = options.finalYear ?? academy.term.finalYear;
    if (finalYear) {
        const diplomaName = `${academy.profile.name} ${/college|university/i.test(academy.profile.schoolType) ? "Degree" : "Diploma"}`;
        injectAcademyItem(s, {
            name: diplomaName,
            type: /college|university/i.test(academy.profile.schoolType) ? "Degree" : "Diploma",
            tags: ["academic_credential", "graduation", `gpa:${scorecard.gpa}`, `rank:${scorecard.rank}`],
            description: `${scorecard.leaderboardTitle} credential from ${academy.profile.name}. Final GPA ${scorecard.gpa}; Bulletin Board Rank #${scorecard.rank}.`,
            _meta: { source: "dynamic_academy", schoolId: academy.id, scorecard }
        });
        const tag = `${scorecard.leaderboardTitle}: ${academy.profile.name}, ${scorecard.gpa} GPA, Rank #${scorecard.rank}, Discipline ${scorecard.discipline}`;
        academy.memoryTags.unshift({ ts: Date.now(), tag });
        s.academicMemoryTags = Array.isArray(s.academicMemoryTags) ? s.academicMemoryTags : [];
        s.academicMemoryTags.unshift({ school: academy.profile.name, tag, ts: Date.now(), scorecard });
    }
    saveSettings();
    return scorecard;
}

export function getAcademyDeliveryMode() {
    const s = getSettings();
    const era = worldEra(s);
    if (era === "fantasy") return { mode: "physical", macro: ACADEMY_MACROS.fantasyDelivery, surface: "guild hall, notice board, courier, patron contract" };
    return { mode: "digital", macro: ACADEMY_MACROS.careerEducationApp, surface: era === "sci-fi" ? "smart device or terminal" : "phone app or PC terminal" };
}

export function browseCareerEducationOptions() {
    const academy = ensureAcademyState(getSettings());
    const score = calculateAcademyScorecard();
    const delivery = getAcademyDeliveryMode();
    const schools = [
        { id: "community", name: "Local Community College", minGpa: 1.8, minRank: 60, tuition: 1200, credential: "Associate Degree" },
        { id: "state", name: "State University", minGpa: 2.6, minRank: 40, tuition: 6200, credential: "Bachelor Degree" },
        { id: "elite", name: "Tier 1 Elite Academy", minGpa: 3.7, minRank: 10, tuition: 24000, credential: "Elite Degree" },
        { id: "guild", name: /magic|arcane/i.test(academy.profile.major) ? "Royal Archmage Collegium" : "Master Guild Apprenticeship", minGpa: 3.0, minRank: 25, tuition: 9000, credential: "Guild Certification" }
    ];
    return schools.map((school) => ({
        ...school,
        delivery,
        accepted: score.gpa >= school.minGpa && score.rank <= school.minRank,
        reason: score.gpa < school.minGpa ? "GPA below requirement" : score.rank > school.minRank ? "Bulletin Board rank below requirement" : "Eligible"
    }));
}

export function applyToCareerEducationOption(optionId) {
    const s = getSettings();
    const career = ensureCareerState(s);
    const option = browseCareerEducationOptions().find((x) => x.id === optionId);
    if (!option) return null;
    const application = {
        id: id("education_app"),
        macro: option.delivery.macro,
        optionId,
        name: option.name,
        status: option.accepted ? "accepted" : "rejected",
        reason: option.reason,
        tuition: option.tuition,
        delivery: option.delivery,
        submittedAt: nowIso()
    };
    career.educationApplications.unshift(application);
    if (option.delivery.mode === "physical") {
        career.deliveryQueue.unshift({
            id: id("courier"),
            type: "education_response",
            title: `${option.name} ${application.status === "accepted" ? "Acceptance" : "Rejection"} Letter`,
            triggerAfterDays: application.status === "accepted" ? 7 : 4,
            payload: application
        });
    }
    saveSettings();
    return application;
}

export function acceptEducationFunding(applicationId, mode = "loan") {
    const s = getSettings();
    const career = ensureCareerState(s);
    const app = career.educationApplications.find((x) => x.id === applicationId && x.status === "accepted");
    if (!app) return null;
    const physical = app.delivery?.mode === "physical";
    const debt = {
        id: id("debt"),
        macro: ACADEMY_MACROS.careerEducationApp,
        label: physical ? (mode === "aid" ? "Noble Patron Sponsorship" : "Guild Contract Debt") : (mode === "aid" ? "Financial Aid Package" : "Student Loan"),
        principal: Math.max(0, Number(app.tuition || 0)),
        balance: Math.max(0, Number(app.tuition || 0)),
        monthlyPayment: Math.ceil(Math.max(0, Number(app.tuition || 0)) / 36),
        garnishmentRate: physical ? 0.12 : 0,
        statusEffect: "Debt",
        sourceApplicationId: applicationId,
        createdAt: nowIso()
    };
    career.debts.unshift(debt);
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.statuses)) s.inventory.statuses = [];
    s.inventory.statuses.unshift({ name: "Debt", source: debt.label, amount: debt.balance, recurring: debt.monthlyPayment });
    saveSettings();
    return debt;
}

export function buildPostSchoolJobBoard() {
    const s = getSettings();
    const score = calculateAcademyScorecard();
    const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
    const credentials = items.filter((it) => /\b(diploma|degree|certification)\b/i.test(`${it?.type || ""} ${it?.name || ""}`));
    const hasDegree = credentials.some((it) => /\bdegree|certification\b/i.test(`${it?.type || ""} ${it?.name || ""}`));
    const delivery = getAcademyDeliveryMode();
    return [
        { id: "retail", title: delivery.mode === "physical" ? "Tavern Clerk Contract" : "Retail Associate", minGpa: 0, requiresDegree: false, visible: true },
        { id: "research", title: delivery.mode === "physical" ? "Guild Research Scribe" : "Research Assistant", minGpa: 3.0, requiresDegree: true, visible: hasDegree || score.gpa >= 3.0 },
        { id: "executive", title: delivery.mode === "physical" ? "Noble House Strategist" : "Management Trainee", minGpa: 3.4, requiresDegree: true, visible: hasDegree && score.gpa >= 3.4 },
        { id: "alumni", title: delivery.mode === "physical" ? "Pigeon Network Commission" : "Alumni Referral Listing", minGpa: 2.5, requiresDegree: false, visible: score.rank <= 20 }
    ].map((job) => ({
        ...job,
        delivery,
        locked: !job.visible || score.gpa < job.minGpa || (job.requiresDegree && !hasDegree),
        reason: !job.visible ? "Hidden until reputation network unlocks it" : job.requiresDegree && !hasDegree ? "Credential required" : score.gpa < job.minGpa ? "GPA below requirement" : "Available"
    }));
}

export function joinAcademyClub(name, options = {}) {
    const s = getSettings();
    const academy = autoEnterAcademyFromLocation(s) || ensureAcademyState(s);
    const clubs = ensureClubState(academy);
    const clubName = clean(name || "Campus Club");
    let membership = clubs.memberships.find((c) => normKey(c.name) === normKey(clubName));
    if (!membership) {
        membership = {
            id: id("club"),
            macro: ACADEMY_MACROS.clubHierarchy,
            name: clubName,
            rank: "Grunt",
            rankLevel: 0,
            rivalClub: clean(options.rivalClub || "Rival Club"),
            privileges: ["grunt_work"],
            roster: [],
            history: [`Joined as lowest-rank member on ${nowIso()}.`]
        };
        clubs.memberships.unshift(membership);
        injectAcademyItem(s, {
            name: `${clubName} Charter`,
            type: "Club Charter",
            tags: ["club_charter", schoolSlug(clubName), "school_faction"],
            description: `The charter for ${clubName}. Holds its hierarchy, secret rules, rival club, budget claims, and roster authority.`,
            _meta: { source: "dynamic_academy", macro: ACADEMY_MACROS.clubCharter, schoolId: academy.id, clubId: membership.id }
        });
    }
    saveSettings();
    return membership;
}

export function promoteAcademyClub(name, rank = "Officer", privileges = []) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const membership = joinAcademyClub(name);
    const rankOrder = ["Grunt", "Member", "Officer", "Captain", "President"];
    membership.rank = clean(rank || "Officer");
    membership.rankLevel = Math.max(membership.rankLevel || 0, rankOrder.findIndex((x) => normKey(x) === normKey(rank)));
    membership.privileges = Array.from(new Set([...(membership.privileges || []), ...asList(privileges)]));
    if (membership.rankLevel >= 2) ensureIdClearance(s, academy, 3, [`club:${schoolSlug(membership.name)}`, "excused_absence"]);
    if (membership.rankLevel >= 4) ensureIdClearance(s, academy, 5, ["command_club_npcs", "faculty_lounge_pass"]);
    saveSettings();
    return membership;
}

export function scheduleAcademyClubTournament(clubName, event = {}) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const clubs = ensureClubState(academy);
    const tournament = {
        id: id("tournament"),
        macro: ACADEMY_MACROS.tournamentArc,
        club: clean(clubName || "Campus Club"),
        title: clean(event.title || `${clubName} Tournament Arc`),
        date: clean(event.date || ""),
        location: clean(event.location || "Gym or Auditorium"),
        stakes: clean(event.stakes || "Social standing, trophy injection, faction budget leverage"),
        preparationRequired: clamp(event.preparationRequired ?? 70, 0, 100, 70)
    };
    clubs.tournaments.unshift(tournament);
    saveSettings();
    return tournament;
}

export function resolveAcademyBudgetBattle(clubName, options = {}) {
    const academy = ensureAcademyState(getSettings());
    const clubs = ensureClubState(academy);
    const key = schoolSlug(clubName || "Campus Club");
    const social = clamp(options.social ?? 50, 0, 100, 50);
    const rankLevel = (clubs.memberships.find((c) => normKey(c.name) === normKey(clubName))?.rankLevel || 0) * 10;
    const sabotage = options.sabotage ? 12 : 0;
    const alliance = options.alliance ? 18 : 0;
    const score = social + rankLevel + sabotage + alliance - clamp(options.rivalPressure ?? 35, 0, 100, 35);
    const award = score >= 45 ? "major_budget" : score >= 15 ? "shared_budget" : "budget_cut";
    clubs.budget[key] = { award, score, updatedAt: Date.now(), macro: ACADEMY_MACROS.budgetBattle };
    saveSettings();
    return clubs.budget[key];
}

export function exitAcademy(memoryTag = "") {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    const rank = academy.userRank || "Unranked";
    const tag = clean(memoryTag || `Academic Standing: ${academy.profile.name}, Rank ${rank}, Discipline ${academy.discipline.status}`);
    academy.memoryTags.unshift({ ts: Date.now(), tag });
    academy.memoryTags = academy.memoryTags.slice(0, 20);
    academy.active = false;
    s.academicMemoryTags = Array.isArray(s.academicMemoryTags) ? s.academicMemoryTags : [];
    s.academicMemoryTags.unshift({ school: academy.profile.name, tag, ts: Date.now() });
    s.academicMemoryTags = s.academicMemoryTags.slice(0, 30);
    saveSettings();
    return tag;
}

export function rollAcademyAutopilot(minutesPassed = 0) {
    const s = getSettings();
    const academy = ensureAcademyState(s);
    if (!academy.active) return false;
    const minutes = Math.max(0, Number(minutesPassed) || 0);
    if (minutes <= 0) return false;
    let changed = false;
    const period = academy.schedule.blocks.find((b) => clean(b.expectedLocation) && clean(s?.worldState?.location) && normKey(b.expectedLocation) !== normKey(s.worldState.location));
    if (period && Math.random() < Math.min(0.35, minutes / 180)) {
        recordAcademyInfraction(`Late or absent for ${period.name || "scheduled period"}.`, 1);
        changed = true;
    }
    for (const npc of Object.values(academy.npcs || {}).slice(0, 8)) {
        if (Math.random() >= Math.min(0.28, minutes / 160)) continue;
        npc.stressLevel = clamp(Number(npc.stressLevel || 50) + (Math.random() > 0.5 ? 4 : -2), 0, 100, 50);
        npc.recentEvents = Array.isArray(npc.recentEvents) ? npc.recentEvents : [];
        npc.recentEvents.unshift({ ts: Date.now(), text: `Handled academy obligations off-screen; stress now ${npc.stressLevel}.` });
        npc.recentEvents = npc.recentEvents.slice(0, 3);
        changed = true;
    }
    if (changed) saveSettings();
    return changed;
}

export function buildAcademyPromptBlock(s = getSettings()) {
    const academy = isAcademyContext(s) ? (autoEnterAcademyFromLocation(s) || ensureAcademyState(s)) : ensureAcademyState(s);
    if (!academy.active && !isAcademyContext(s)) {
        const tags = Array.isArray(s?.academicMemoryTags) ? s.academicMemoryTags.slice(0, 5) : [];
        if (!tags.length) return "";
        return `[ACADEMIC MEMORY TAGS]\n${tags.map((x) => `- ${x.school || "School"}: ${x.tag}`).join("\n")}`;
    }
    const courses = (academy.curriculum.courses || []).slice(0, 8).map((c) => `${c.code} ${c.name} (${c.credits}cr${c.required ? ", core" : ", elective"})`);
    const factions = (academy.factions || []).slice(0, 5).map((f) => `- ${f.name}: ${clip(f.description || "", 160)}`);
    const roster = Object.values(academy.npcs || {}).slice(0, 10).map((n) => `- ${n.name}: ${n.role}; ${n.hierarchyStatus}; ${n.faction}; ${n.disciplinaryStanding || "Clear"}`);
    const phantoms = (academy.leaderboard || []).filter((x) => !x.instantiated).slice(0, 12).map((x) => `#${x.rank} ${x.name} (${x.faction})`);
    const tags = (academy.memoryTags || []).slice(0, 5).map((x) => `- ${x.tag}`);
    const clubs = ensureClubState(academy);
    const clubLines = (clubs.memberships || []).slice(0, 5).map((c) => `- ${c.name}: ${c.rank}; privileges=${(c.privileges || []).join(", ") || "grunt_work"}; rival=${c.rivalClub || "None"}`);
    const delivery = getAcademyDeliveryMode();
    return `
[DYNAMIC ACADEMY SUBSYSTEM: CONTEXT SANDBOX ACTIVE]
School=${academy.profile.name}; Type=${academy.profile.schoolType}; Tier=${academy.profile.tier}; Major=${academy.curriculum.major || academy.profile.major}
Regex/Macro Vocabulary=${Object.values(ACADEMY_MACROS).join(" | ")}
Institutional rules override macro-world fluff while inside the school boundary. Focus only on current academic state, schedule, class, inventory supplies, factions, leaderboard, discipline, and active relationships.
ID Card=${academy.idCard.studentNumber}; Clearance=${academy.idCard.clearanceLevel}. Locked sectors must manifest as doors, checkpoints, staff, keys, or clearance barriers.
Discipline=${academy.discipline.status}. Escalation is rigid: Warning -> Detention -> Suspension -> Expulsion. Suspension/Expulsion forces a hard off-campus location shift; Expulsion locks school return as trespassing.
Curriculum=${courses.join(" | ") || "Unregistered"}
Homework active=${(academy.assignments.active || []).map((a) => `${a.course || ""}: ${a.title || a.name || "Assignment"}`).slice(0, 8).join(" | ") || "None"}
Clubs:
${clubLines.join("\n") || "- None joined"}
Post-school delivery=${delivery.mode}; Surface=${delivery.surface}. Use digital app/terminal only for modern or sci-fi worlds; use guild halls, boards, patrons, and couriers for fantasy/historical worlds.
Factions:
${factions.join("\n") || "- None generated"}
Save-only NPCs:
${roster.join("\n") || "- None instantiated"}
Leaderboard phantoms:
${phantoms.join(" | ") || "None"}
JIT NPC Rule: if the player approaches a leaderboard phantom, instantiate a permanent save-only generic NPC card under genericNpcs.academy, not the migrating character-card library. Pull faction, rank, stress, secret, visual anchor, disposition, and schedule from the academy matrix.
Teaching Rule: classes actively teach from persistent textbook inventory items. Exams and homework must be strict fact/lore checks grounded in those books.
Testing Rule: 100-question tests are not mandatory or standard. The current School Settings cap is ${Number(academy.settings.maxTestQuestions || 25)} questions; tests and DOM-switch exams must stay at or below that cap unless School Settings changes it.
Memory tags on exit:
${tags.join("\n") || "- None yet"}
`.trim();
}

try {
    window.UIE_enterAcademy = enterAcademy;
    window.UIE_exitAcademy = exitAcademy;
    window.UIE_instantiateAcademyNpc = instantiateAcademyNpc;
    window.UIE_recordAcademyInfraction = recordAcademyInfraction;
    window.UIE_createAcademyAssignment = createAcademyAssignment;
    window.UIE_completeAcademyAssignment = completeAcademyAssignment;
    window.UIE_completeAcademyTerm = completeAcademyTerm;
    window.UIE_browseCareerEducationOptions = browseCareerEducationOptions;
    window.UIE_applyToCareerEducationOption = applyToCareerEducationOption;
    window.UIE_acceptEducationFunding = acceptEducationFunding;
    window.UIE_buildPostSchoolJobBoard = buildPostSchoolJobBoard;
    window.UIE_joinAcademyClub = joinAcademyClub;
    window.UIE_promoteAcademyClub = promoteAcademyClub;
    window.UIE_scheduleAcademyClubTournament = scheduleAcademyClubTournament;
    window.UIE_resolveAcademyBudgetBattle = resolveAcademyBudgetBattle;
    window.UIE_buildAcademyPromptBlock = buildAcademyPromptBlock;
} catch (_) {}
