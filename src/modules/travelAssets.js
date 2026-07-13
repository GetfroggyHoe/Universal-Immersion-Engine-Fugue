const DEFINITIONS = {
  none: {
    label: "Not a travel asset",
    placement: "No travel controls",
    speedModifier: 1,
  },
  mount: {
    label: "Mount / Horse",
    placement: "May be placed at any outdoor location",
    speedModifier: 0.8,
  },
  cart: {
    label: "Cart / Wagon",
    placement: "May be placed at any outdoor location",
    speedModifier: 0.75,
  },
  road_vehicle: {
    label: "Road Vehicle",
    placement: "May be placed at any outdoor location",
    speedModifier: 0.55,
  },
  boat: {
    label: "Boat / Ship",
    placement: "Requires a dock, harbor, port, pier, marina, or berth",
    speedModifier: 0.7,
    large: true,
  },
  spacecraft: {
    label: "Spacecraft",
    placement: "Requires a spaceport, orbital dock, launch pad, or spacecraft hangar",
    speedModifier: 0.2,
    large: true,
  },
  aircraft: {
    label: "Aircraft",
    placement: "Requires an airport, airfield, hangar, or landing pad",
    speedModifier: 0.3,
    large: true,
  },
  rail: {
    label: "Train / Rail",
    placement: "Requires a station, depot, platform, or rail terminal",
    speedModifier: 0.35,
    large: true,
  },
};

const ALIASES = {
  horse: "mount",
  animal: "mount",
  rideable: "mount",
  wagon: "cart",
  carriage: "cart",
  coach: "cart",
  vehicle: "road_vehicle",
  road: "road_vehicle",
  car: "road_vehicle",
  truck: "road_vehicle",
  motorcycle: "road_vehicle",
  bike: "road_vehicle",
  ship: "boat",
  vessel: "boat",
  watercraft: "boat",
  starship: "spacecraft",
  spaceship: "spacecraft",
  shuttle: "spacecraft",
  plane: "aircraft",
  airplane: "aircraft",
  train: "rail",
};

export const TRAVEL_ASSET_CATEGORIES = Object.freeze(
  Object.entries(DEFINITIONS).map(([value, definition]) => ({ value, ...definition })),
);

export function normalizeTravelCategory(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (Object.hasOwn(DEFINITIONS, raw)) return raw;
  return ALIASES[raw] || "";
}

export function inferTravelCategory(asset = {}) {
  asset = asset && typeof asset === "object" ? asset : {};
  const explicit = normalizeTravelCategory(asset.travelCategory || asset.travelType || asset.transportCategory);
  if (explicit) return explicit;
  const text = `${asset.category || ""} ${asset.type || ""} ${asset.kind || ""} ${asset.name || asset.title || ""}`.toLowerCase();
  if (/\b(horse|pony|steed|mount|camel|donkey|mule|rideable)\b/.test(text)) return "mount";
  if (/\b(cart|wagon|carriage|chariot|coach|buggy|sled|sleigh)\b/.test(text)) return "cart";
  if (/\b(spacecraft|starship|spaceship|space ship|shuttle|rocket)\b/.test(text)) return "spacecraft";
  if (/\b(boat|ship|vessel|ferry|yacht|submarine|watercraft|canoe|raft)\b/.test(text)) return "boat";
  if (/\b(aircraft|airplane|plane|jet|airship|helicopter|balloon)\b/.test(text)) return "aircraft";
  if (/\b(train|railcar|locomotive|tram|subway)\b/.test(text)) return "rail";
  if (/\b(vehicle|car|truck|van|motorcycle|motorbike|bike|bicycle|scooter)\b/.test(text)) return "road_vehicle";
  return "none";
}

export function travelCategoryDefinition(assetOrCategory) {
  const category = typeof assetOrCategory === "string"
    ? (normalizeTravelCategory(assetOrCategory) || "none")
    : inferTravelCategory(assetOrCategory);
  return { category, ...DEFINITIONS[category] };
}

function inferAssetBaseValue(asset = {}) {
  const text = `${asset.category || ""} ${asset.type || ""} ${asset.kind || ""} ${asset.name || asset.title || ""}`.toLowerCase();
  if (/\b(spacecraft|starship|aircraft|plane|train)\b/.test(text)) return 50000;
  if (/\b(boat|ship|vehicle|car|truck|van)\b/.test(text)) return 12000;
  if (/\b(house|home|apartment|building|land|property|business)\b/.test(text)) return 25000;
  if (/\b(computer|terminal|workbench|equipment|machine)\b/.test(text)) return 1500;
  if (/\b(bag|case|briefcase|bookbag|school bag|storage|container|chest)\b/.test(text)) return 80;
  return 250;
}

export function ensureTravelAssetFields(asset, options = {}) {
  if (!asset || typeof asset !== "object") return asset;
  asset.travelCategory = inferTravelCategory(asset);
  if (options.forceUnplaced === true) asset.location = "";
  else asset.location = String(asset.location || "").trim();
  if (!String(asset.homeLocation || "").trim()) {
    asset.homeLocation = String(asset.location || asset.originLocation || asset.createdAtLocation || "").trim();
  }
  const rawValue = Number(asset.value ?? asset.cost ?? asset.purchaseCost);
  const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : inferAssetBaseValue(asset);
  if (!Number.isFinite(Number(asset.value)) || Number(asset.value) <= 0) asset.value = value;
  if (!Number.isFinite(Number(asset.cost)) || Number(asset.cost) <= 0) asset.cost = value;
  if (!Number.isFinite(Number(asset.purchaseCost)) || Number(asset.purchaseCost) <= 0) asset.purchaseCost = value;
  if (!Number.isFinite(Number(asset.sellPrice)) || Number(asset.sellPrice) < 0) {
    asset.sellPrice = Math.max(0, Math.floor(value * 0.6));
  }
  return asset;
}

export function isTravelAsset(asset) {
  return inferTravelCategory(asset) !== "none";
}

export function requiresVehicleMicroMap(asset) {
  return asset?.largeVehicle === true || travelCategoryDefinition(asset).large === true;
}

export function defaultTravelSpeedModifier(asset) {
  if (!asset) return 1;
  return travelCategoryDefinition(asset).speedModifier || 1;
}

export function classifyTravelLocation(node = {}, fallbackName = "") {
  const text = [
    node?.type,
    node?.name,
    fallbackName,
    node?.theme,
    node?.district,
    node?.docking?.kind,
    node?.docking?.label,
  ].filter(Boolean).join(" ").toLowerCase();
  const interior = Boolean(node?.blueprintParent)
    || /\b(interior|room|bedroom|bathroom|kitchen|office|apartment|house|home|building|shop|store|cave|dungeon|hallway|corridor|closet)\b/.test(text);
  const explicitAccess = Array.isArray(node?.accessModes)
    ? node.accessModes
    : String(node?.accessModes || node?.travelAccess || "").split(/\n|,|;/);
  const accessModes = new Set(explicitAccess.map((mode) => String(mode || "").trim().toLowerCase()).filter(Boolean));
  if (!interior) {
    accessModes.add("foot");
    if (!/\b(cave|deep forest|wilderness|mountain|swamp|underwater)\b/.test(text)) accessModes.add("road");
  }
  if (/\b(trail|path|dirt path|bridleway)\b/.test(text)) accessModes.add("trail");
  if (/\b(portal|gateway|teleport|shunt|warp)\b/.test(text)) accessModes.add("portal");
  if (/\b(dock|harbor|harbour|port|pier|marina|berth|wharf|quay|shipyard)\b/.test(text)) accessModes.add("water");
  if (/\b(spaceport|orbital dock|orbital station|launch pad|launch site|spacecraft hangar|starship hangar)\b/.test(text)) accessModes.add("space");
  if (/\b(airport|airfield|airstrip|aircraft hangar|landing pad|helipad)\b/.test(text)) accessModes.add("air");
  if (/\b(train station|rail station|railway station|depot|platform|rail terminal|train terminal)\b/.test(text)) accessModes.add("rail");
  return {
    interior,
    accessModes: Array.from(accessModes),
    marineDock: /\b(dock|harbor|harbour|port|pier|marina|berth|wharf|quay|shipyard)\b/.test(text),
    spacecraftDock: /\b(spaceport|orbital dock|orbital station|launch pad|launch site|spacecraft hangar|starship hangar)\b/.test(text),
    aircraftDock: /\b(airport|airfield|airstrip|aircraft hangar|landing pad|helipad)\b/.test(text),
    railDock: /\b(train station|rail station|railway station|depot|platform|rail terminal|train terminal)\b/.test(text),
  };
}

export function evaluateTravelAssetPlacement(asset, node = {}, fallbackName = "") {
  const definition = travelCategoryDefinition(asset);
  const location = classifyTravelLocation(node, fallbackName);
  let ok = false;
  if (definition.category === "mount") {
    ok = location.accessModes.includes("trail") || location.accessModes.includes("road") || (!location.interior && location.accessModes.includes("foot"));
  } else if (definition.category === "cart" || definition.category === "road_vehicle") {
    ok = location.accessModes.includes("road");
  } else if (definition.category === "boat") {
    ok = location.marineDock || location.accessModes.includes("water");
  } else if (definition.category === "spacecraft") {
    ok = location.spacecraftDock || location.accessModes.includes("space");
  } else if (definition.category === "aircraft") {
    ok = location.aircraftDock || location.accessModes.includes("air");
  } else if (definition.category === "rail") {
    ok = location.railDock || location.accessModes.includes("rail");
  }
  return {
    ok,
    category: definition.category,
    label: definition.label,
    reason: definition.category === "none"
      ? "This asset is not categorized for travel."
      : ok ? "" : definition.placement,
  };
}

export function canPlaceTravelAssetAt(asset, node = {}, fallbackName = "") {
  return evaluateTravelAssetPlacement(asset, node, fallbackName).ok;
}
