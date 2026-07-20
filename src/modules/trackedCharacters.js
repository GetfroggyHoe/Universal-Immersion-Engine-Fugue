function text(value) {
    return String(value ?? "").trim();
}

function locationOf(entity, fallback = "") {
    return text(entity?.lockedLocation || entity?.location || entity?.currentLocation || entity?.lastKnownLocation || fallback);
}

export function getTrackedCharacters(settings = {}) {
    const currentLocation = text(settings?.worldState?.location || settings?.location);
    const playerName = text(settings?.character?.name || settings?.name).toLowerCase();
    const rows = [];
    const seen = new Set();
    const add = (entity, meta) => {
        const name = text(entity?.identity?.name || entity?.name);
        const key = name.toLowerCase();
        if (!name || key === playerName || seen.has(key)) return;
        const location = locationOf(entity, currentLocation);
        rows.push({
            id: text(entity?.id) || `${meta.category}:${key}`,
            name,
            category: meta.category,
            categoryLabel: meta.label,
            role: text(entity?.partyRole || entity?.role || entity?.familyRole || entity?.relationshipStatus || meta.role),
            location: location || "Unknown",
            locationKnown: !!location && !/^unknown(?: location)?$/i.test(location),
            withPlayer: !!location && !!currentLocation && location.toLowerCase() === currentLocation.toLowerCase(),
            affinity: Number.isFinite(Number(entity?.affinity)) ? Number(entity.affinity) : 50,
            avatar: text(entity?.images?.portrait || entity?.avatar || entity?.url),
            birthday: text(entity?.birthday),
            likes: text(entity?.likes),
            dislikes: text(entity?.dislikes),
            color: meta.color,
            automatic: meta.automatic === true,
        });
        seen.add(key);
    };
    for (const member of Array.isArray(settings?.party?.members) ? settings.party.members : []) {
        add(member, { category: "party", label: "Party Member", role: "Companion", color: "#67e8f9", automatic: true });
    }
    const categories = {
        friends: ["Friend", "#34d399"],
        family: ["Family", "#c084fc"],
        romance: ["Relationship", "#fb7185"],
        associates: ["Associate", "#38bdf8"],
        rivals: ["Rival", "#f59e0b"],
    };
    for (const [category, [label, color]] of Object.entries(categories)) {
        for (const person of Array.isArray(settings?.social?.[category]) ? settings.social[category] : []) {
            if (person?.mapTracked === true) add(person, { category, label, color, automatic: false });
        }
    }
    return rows;
}

export function getTrackedCharactersAt(settings = {}, locationName = "") {
    const target = text(locationName).toLowerCase();
    return target ? getTrackedCharacters(settings).filter((row) => row.locationKnown && row.location.toLowerCase() === target) : [];
}
