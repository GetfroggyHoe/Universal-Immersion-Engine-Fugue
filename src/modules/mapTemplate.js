export const MAP_GENERATION_TEMPLATE = Object.freeze({
    version: 2,
    hierarchy: ["world", "region", "area", "vicinity", "blueprint"],
    layers: {
        world: "Lore container for a planet, setting, plane, or independent world. Never immediate travel.",
        region: "Route-planning container inside one world. Never immediate travel.",
        area: "Complete local atlas of every context-appropriate visitable place, route, district, structure, natural feature, and landmark.",
        vicinity: "Player-POV surroundings and immediately reachable transitions from the current place.",
        blueprint: "Physical layout of one enclosed structure, vehicle, dungeon, cave system, or other bounded interior.",
    },
    rules: [
        "A generated atlas is one complete package: world, regions, local areas, nearby routes, and blueprints.",
        "No region may exist without a parent world.",
        "No local area may exist without a parent region and parent world.",
        "No nearby route or blueprint may exist without a parent local area.",
        "Preserve the current and previous location before inventing the next location.",
        "Local and vicinity are the only immediate travel layers.",
        "Every local space owns a Nearby map for its internal places and immediate routes.",
        "Blueprints are optional detailed layouts for explicitly selected bounded exploration sites. Ordinary buildings, towns, cities, and open areas do not require automatic room generation.",
        "Names, transitions, room presets, and image prompts must match the classified environment.",
        "Infer genre and era from supplied context. Never default to medieval fantasy vocabulary.",
    ],
});

export function validateMapPackage(map = {}) {
    const errors = [];
    const worlds = Array.isArray(map.world) ? map.world : [];
    const regions = Array.isArray(map.region) ? map.region : [];
    const areas = Array.isArray(map.area) ? map.area : [];
    const blueprints = map.blueprints && typeof map.blueprints === "object" ? map.blueprints : {};
    const vicinityByArea = map.vicinityByArea && typeof map.vicinityByArea === "object" ? map.vicinityByArea : {};
    const worldIds = new Set(worlds.map((node) => String(node?.id || "")).filter(Boolean));
    const regionIds = new Set(regions.map((node) => String(node?.id || "")).filter(Boolean));

    if (!worlds.length) errors.push("Atlas requires at least one world.");
    if (!regions.length) errors.push("Atlas requires at least one region.");
    if (!areas.length) errors.push("Atlas requires at least one local area.");

    for (const region of regions) {
        if (!worldIds.has(String(region?.worldId || ""))) errors.push(`Region "${region?.name || region?.id || "unknown"}" has no valid parent world.`);
    }
    for (const area of areas) {
        const name = String(area?.name || "").trim();
        if (!worldIds.has(String(area?.worldId || ""))) errors.push(`Local "${name || area?.id || "unknown"}" has no valid parent world.`);
        if (!regionIds.has(String(area?.regionId || ""))) errors.push(`Local "${name || area?.id || "unknown"}" has no valid parent region.`);
        if (!Array.isArray(area?.laws) || !area.laws.length) errors.push(`Local "${name || area?.id || "unknown"}" has no laws.`);
        if (!Array.isArray(area?.reputation) || !area.reputation.length) errors.push(`Local "${name || area?.id || "unknown"}" has no reputation.`);
        if (area?.blueprintId && (!name || !blueprints[name]?.rooms?.length)) errors.push(`Local "${name || area?.id || "unknown"}" declares a blueprint but has no detailed layout.`);
        if (!name || !Array.isArray(vicinityByArea[name]) || !vicinityByArea[name].length) errors.push(`Local "${name || area?.id || "unknown"}" has no nearby map.`);
    }

    return { valid: errors.length === 0, errors };
}

const ENVIRONMENTS = {
    wild: {
        enclosed: false,
        vicinity: ["Current Spot", "Forward Trail", "Side Trail", "Nearby Landmark", "Natural Shelter", "Outer Edge"],
        blueprint: ["Clearing", "Old Trail", "Dense Thicket", "Hidden Stream", "Mossy Ridge", "Sunlit Grove"],
        forbidden: /\b(room|hall(?:way)?|corridor|stair(?:s|way)?|floor|chamber|doorway)\b/i,
        image: "open natural landscape, continuous terrain, no indoor architecture",
    },
    field: {
        enclosed: false,
        vicinity: ["Current Spot", "Grass Path", "Distant Marker", "Low Rise", "Field Shelter", "Far Edge"],
        blueprint: ["Grass Path", "Low Rise", "Wildflower Patch", "Creek Bank", "Windbreak", "Far Edge"],
        forbidden: /\b(room|hall(?:way)?|corridor|stair(?:s|way)?|floor|chamber|doorway)\b/i,
        image: "wide open field, continuous outdoor terrain, no hallways or stairs",
    },
    aquatic: {
        enclosed: false,
        vicinity: ["Current Waters", "Forward Channel", "Shallows", "Visible Landmark", "Safe Landing", "Open Water"],
        blueprint: ["Shallows", "Reef Shelf", "Tidal Channel", "Sandbar", "Rocky Landing", "Open Water"],
        forbidden: /\b(room|hall(?:way)?|corridor|stair(?:s|way)?|floor|chamber|doorway|trail)\b/i,
        image: "open water environment, navigable water routes, no indoor architecture",
    },
    urban: {
        enclosed: false,
        vicinity: ["Current Street", "Main Thoroughfare", "Side Alley", "Nearby Landmark", "Building Entrance", "Next Block"],
        blueprint: ["Street", "Alley", "Plaza", "Market", "Crossing", "Building Entrance"],
        forbidden: /\b(bedroom|stairwell|private room|deep chamber)\b/i,
        image: "outdoor urban streetscape, visible routes and building fronts",
    },
    school: {
        enclosed: true,
        vicinity: ["Campus Gate", "Main Quad", "Class Wing", "Library Entrance", "Gym Route", "Transit Stop"],
        blueprint: ["Entry Hall", "Classroom", "Library", "Laboratory", "Cafeteria", "Infirmary", "Office", "Stairwell", "Elevator", "Club Room"],
        forbidden: /\b(open water|wilderness|deep forest|ship bridge|airlock)\b/i,
        image: "bounded school or campus interior, classroom wings, focused travel areas, no generic fantasy rooms",
    },
    subterranean: {
        enclosed: true,
        vicinity: ["Current Cavern", "Main Passage", "Side Tunnel", "Rock Shelf", "Lower Passage", "Exit Route"],
        blueprint: ["Mouth", "Main Cavern", "Stone Gallery", "Lower Tunnel", "Echo Chamber", "Water Pocket", "Crystal Shelf", "Old Camp"],
        forbidden: /\b(street|alley|plaza|thoroughfare|bedroom|office)\b/i,
        image: "bounded subterranean cave system, connected natural passages",
    },
    vehicle: {
        enclosed: true,
        vicinity: ["Current Compartment", "Main Passage", "Adjacent Compartment", "Control Access", "Service Access", "Exit Hatch"],
        blueprint: ["Airlock", "Main Passage", "Bridge", "Crew Quarters", "Engineering", "Cargo Bay", "Med Bay", "Observation", "Docking Collar"],
        forbidden: /\b(street|alley|plaza|forest|grove|field)\b/i,
        image: "bounded vehicle interior, functional connected compartments",
    },
    interior: {
        enclosed: true,
        vicinity: ["Current Room", "Doorway", "Adjacent Room", "Main Hall", "Service Space", "Outside Threshold"],
        blueprint: ["Entry", "Main Hall", "Side Room", "Storage", "Private Room", "Utility", "Stairwell", "Courtyard", "Office", "Back Room"],
        forbidden: /\b(open water|open field|far edge|forest trail)\b/i,
        image: "bounded architectural interior, coherent connected rooms",
    },
};

function textOf(place = {}) {
    return `${place.type || ""} ${place.name || ""} ${place.theme || ""} ${place.desc || place.description || ""}`.toLowerCase();
}

export function classifySpatialEnvironment(place = {}) {
    const text = textOf(place);
    if (/\b(school|academy|university|college|campus|classroom|lecture hall|dormitory|student hall|faculty|gymnasium|library wing)\b/.test(text)) return "school";
    if (/\b(ocean|sea|lake|river|water|reef|shallows|channel|bay)\b/.test(text)) return "aquatic";
    if (/\b(field|meadow|grassland|prairie|plains|golden fields?)\b/.test(text)) return "field";
    if (/\b(forest|woods|woodland|grove|jungle|wild|wilderness|mountain|valley|desert|swamp|marsh|trail|path)\b/.test(text)) return "wild";
    if (/\b(cave|cavern|mine|tunnel|dungeon|crypt|catacomb)\b/.test(text)) return "subterranean";
    if (/\b(train station|rail station|railway station|depot|platform|rail terminal|train terminal|spaceport|dock|harbor|port|pier|hangar|landing pad)\b/.test(text)) return "interior";
    if (/\b(ship|spacecraft|starship|vehicle|train|aircraft|submarine|station deck)\b/.test(text)) return "vehicle";
    if (/\b(city|town|street|road|alley|plaza|market|district|village|harbor|dock|port)\b/.test(text)) return "urban";
    if (/\b(interior|inside|room|building|house|home|castle|tower|temple|inn|office|station)\b/.test(text)) return "interior";
    return String(place.type || "").toLowerCase() === "exterior" ? "wild" : "interior";
}

export function environmentTemplate(place = {}) {
    const environment = classifySpatialEnvironment(place);
    return { environment, ...ENVIRONMENTS[environment] };
}

export function allowsBlueprint(place = {}) {
    return environmentTemplate(place).enclosed;
}

export function allowsGeneratedBlueprint(place = {}, mode = "sites") {
    const policy = String(mode || "sites").toLowerCase();
    if (policy === "none") return false;
    if (policy === "all") return allowsBlueprint(place);
    const text = textOf(place);
    return /\b(cave|cavern|mine|tunnel|dungeon|crypt|catacomb|undercity|sewer|labyrinth|ruin|vault|bunker|ship|spacecraft|starship|vehicle|train|aircraft|submarine|school|academy|university|college|campus|classroom|lecture hall|dormitory)\b/.test(text);
}

export function vicinityPresetNames(place = {}) {
    return [...environmentTemplate(place).vicinity];
}

export function sanitizePresetName(name, place = {}, index = 0, kind = "blueprint") {
    const template = environmentTemplate(place);
    const raw = String(name || "").trim();
    if (raw && !template.forbidden.test(raw)) return raw.slice(0, 120);
    const bank = kind === "vicinity" ? template.vicinity : template.blueprint;
    return bank[index % bank.length];
}

export function proceduralSpatialPresets(place = {}, count = 8) {
    const template = environmentTemplate(place);
    const parentName = String(place.name || "Current Location").trim();
    return Array.from({ length: Math.max(1, Number(count) || 1) }, (_, index) => {
        const name = template.blueprint[index % template.blueprint.length];
        return {
            name,
            theme: `${template.environment} / ${name}`,
            imagePrompt: `${parentName}, ${name}, ${template.image}, visually coherent with ${parentName}, visual novel background, no text, no UI`,
        };
    });
}

export function proceduralEditRoomPresets(room = {}, parent = {}) {
    const template = environmentTemplate({
        ...room,
        name: `${parent.name || ""} ${room.name || ""}`.trim(),
        type: parent.type || room.type,
        desc: `${parent.desc || parent.description || ""} ${room.desc || room.description || ""}`.trim(),
    });
    const roomName = String(room.name || parent.name || "Current Location").trim();
    const banks = template.environment === "school"
        ? [["Class Desk", "classroom_v1", "utility", "Classes, exams, and schoolwork"], ["Archive Shelf", "books_v1", "foundation", "Research and lore"], ["Elevator Panel", "elevator_v1", "utility", "Floor selection and vertical travel"]]
        : template.environment === "vehicle"
        ? [["Control Console", "computer_v1", "utility", "Navigation and systems control"], ["Crew Rest", "bed_v1", "utility", "Rest and recovery"], ["Service Bench", "workbench_v1", "utility", "Repairs and crafting"]]
        : template.environment === "subterranean"
            ? [["Explorer Camp", "bed_v1", "foundation", "Rest and expedition staging"], ["Survey Table", "workbench_v1", "utility", "Mapping and discoveries"], ["Supply Cache", "loft_v1", "utility", "Storage and survival supplies"]]
            : [["Scene Anchor", "loft_v1", "foundation", "Defines the room's primary composition"], ["Interactive Utility", "workbench_v1", "utility", "Supports context-appropriate interaction"], ["Atmosphere Detail", "plant_overlay_04", "atmospheric", "Reinforces mood and local identity"]];
    return banks.map(([name, assetId, slotType, purpose], index) => ({
        id: `procedural_${template.environment}_${index + 1}`,
        name,
        assetId,
        slotType,
        purpose,
        content: `${name} for ${roomName}`,
        imagePrompt: `${roomName}, ${name}, ${template.image}, cohesive interactive visual novel set dressing, no text, no UI`,
        generated: true,
    }));
}

export function generationTemplatePrompt() {
    return [
        `TemplateVersion=${MAP_GENERATION_TEMPLATE.version}`,
        `Hierarchy=${MAP_GENERATION_TEMPLATE.hierarchy.join(" > ")}`,
        ...MAP_GENERATION_TEMPLATE.rules.map((rule) => `- ${rule}`),
    ].join("\n");
}
