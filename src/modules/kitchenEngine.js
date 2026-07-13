const DEFAULT_STATE_FILTERS = {
  raw: "",
  chopped: "contrast(1.08) saturate(1.08)",
  cooked: "sepia(0.35) saturate(1.2) brightness(0.95)",
  burnt: "grayscale(0.55) brightness(0.55) contrast(1.25)",
  rotten: "grayscale(0.8) sepia(0.35) hue-rotate(55deg) brightness(0.72)",
};

function cleanToken(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function slug(value) {
  return cleanToken(value, "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

export class Ingredient {
  constructor({ name, baseType, state = "raw", isRotten = false, assetUrl = "", tags = [] } = {}) {
    this.id = `ingredient_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    this.name = cleanToken(name, "Ingredient");
    this.baseType = cleanToken(baseType, this.name);
    this.state = cleanToken(state, "raw").toLowerCase();
    this.isRotten = isRotten === true;
    this.assetUrl = cleanToken(assetUrl);
    this.tags = Array.isArray(tags) ? tags.map((tag) => cleanToken(tag).toLowerCase()).filter(Boolean) : [];
  }

  label() {
    const state = this.state && this.state !== "raw" ? `${this.state} ` : "";
    return `${state}${this.name}`.trim();
  }
}

export class Workspace {
  constructor({ id, name = "Workspace", tags = [], accepts = ["ingredient"] } = {}) {
    this.id = cleanToken(id, slug(name));
    this.name = cleanToken(name, "Workspace");
    this.tags = new Set(tags.map((tag) => cleanToken(tag).toLowerCase()).filter(Boolean));
    this.accepts = new Set(accepts.map((tag) => cleanToken(tag).toLowerCase()).filter(Boolean));
    this.ingredients = [];
  }

  acceptsIngredient(ingredient) {
    if (!(ingredient instanceof Ingredient)) return false;
    if (this.accepts.has("ingredient")) return true;
    return ingredient.tags.some((tag) => this.accepts.has(tag));
  }

  add(ingredient) {
    if (!this.acceptsIngredient(ingredient)) return false;
    this.ingredients.push(ingredient);
    return true;
  }

  remove(ingredient) {
    const index = this.ingredients.indexOf(ingredient);
    if (index < 0) return null;
    return this.ingredients.splice(index, 1)[0];
  }
}

export class Station {
  constructor({ id, name, interfaceType = "workspace", tags = [], x = 0, y = 0, draggable = true, assetUrl = "" } = {}) {
    this.id = cleanToken(id, slug(name));
    this.name = cleanToken(name, "Station");
    this.interfaceType = cleanToken(interfaceType, "workspace");
    this.tags = new Set(tags.map((tag) => cleanToken(tag).toLowerCase()).filter(Boolean));
    this.x = Number.isFinite(Number(x)) ? Number(x) : 0;
    this.y = Number.isFinite(Number(y)) ? Number(y) : 0;
    this.draggable = draggable !== false;
    this.assetUrl = cleanToken(assetUrl);
  }

  render({ onOpen } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "uie-kitchen-station";
    button.dataset.stationId = this.id;
    button.dataset.interfaceType = this.interfaceType;
    button.style.left = `${this.x}%`;
    button.style.top = `${this.y}%`;
    button.draggable = this.draggable;
    button.title = this.name;
    button.innerHTML = this.assetUrl
      ? `<img src="${this.assetUrl}" alt=""><span>${this.name}</span>`
      : `<span>${this.name}</span>`;
    button.addEventListener("click", () => {
      if (typeof onOpen === "function") onOpen(this);
    });
    return button;
  }
}

export class KitchenEngine {
  constructor({ macros = [] } = {}) {
    this.stations = new Map();
    this.workspaces = new Map();
    this.macros = [];
    this.narrativeLog = [];
    this.registerMacro({
      id: "knife_raw_to_chopped",
      when: { state: "raw", toolTags: ["knife"] },
      then: { state: "chopped", log: "The {name} was sliced." },
    });
    this.registerMacro({
      id: "boil_chopped_to_cooked",
      when: { state: "chopped", surfaceTags: ["boiling"] },
      then: { state: "cooked", event: "PushedToPot", log: "The sliced {name} was added to the boiling water." },
    });
    macros.forEach((macro) => this.registerMacro(macro));
  }

  registerStation(station) {
    const entry = station instanceof Station ? station : new Station(station);
    this.stations.set(entry.id, entry);
    return entry;
  }

  registerWorkspace(workspace) {
    const entry = workspace instanceof Workspace ? workspace : new Workspace(workspace);
    this.workspaces.set(entry.id, entry);
    return entry;
  }

  registerMacro(macro) {
    if (!macro || typeof macro !== "object") return null;
    const id = cleanToken(macro.id, `macro_${this.macros.length + 1}`);
    const entry = { ...macro, id };
    this.macros = this.macros.filter((item) => item.id !== id);
    this.macros.push(entry);
    return entry;
  }

  processState(ingredient, tool = {}, surface = {}) {
    if (!(ingredient instanceof Ingredient)) return null;
    const toolTags = new Set((tool.tags || [tool.tag, tool.type, tool.name]).map((tag) => cleanToken(tag).toLowerCase()).filter(Boolean));
    const surfaceTags = new Set((surface.tags || [surface.tag, surface.type, surface.name]).map((tag) => cleanToken(tag).toLowerCase()).filter(Boolean));
    const macro = this.macros.find((entry) => macroMatches(entry, ingredient, toolTags, surfaceTags));
    if (!macro) return null;

    const previousState = ingredient.state;
    if (macro.then?.state) ingredient.state = cleanToken(macro.then.state).toLowerCase();
    if (typeof macro.then?.isRotten === "boolean") ingredient.isRotten = macro.then.isRotten;

    const log = formatLog(macro.then?.log || "{name} changed state.", ingredient, previousState);
    this.narrativeLog.push(log);
    if (macro.then?.event) {
      this.narrativeLog.push(`${macro.then.event}: ${ingredient.label()}`);
    }
    return { ingredient, previousState, macro, log };
  }

  moveToSurface(ingredient, targetSurface) {
    if (!(ingredient instanceof Ingredient)) return null;
    const surface = targetSurface instanceof Workspace ? targetSurface : this.workspaces.get(cleanToken(targetSurface));
    if (!surface || !surface.add(ingredient)) return null;
    const event = surface.tags.has("bowl") ? "PushedToBowl" : surface.tags.has("pot") || surface.tags.has("boiling") ? "PushedToPot" : "MovedToSurface";
    const line = `${ingredient.label()} was moved to ${surface.name}.`;
    this.narrativeLog.push(`${event}: ${line}`);
    return { event, line, surface, ingredient };
  }
}

function macroMatches(macro, ingredient, toolTags, surfaceTags) {
  const when = macro.when || {};
  if (when.state && cleanToken(when.state).toLowerCase() !== ingredient.state) return false;
  if (typeof when.isRotten === "boolean" && when.isRotten !== ingredient.isRotten) return false;
  if (Array.isArray(when.baseTypes) && !when.baseTypes.map((x) => cleanToken(x).toLowerCase()).includes(ingredient.baseType.toLowerCase())) return false;
  if (Array.isArray(when.toolTags) && !when.toolTags.some((tag) => toolTags.has(cleanToken(tag).toLowerCase()))) return false;
  if (Array.isArray(when.surfaceTags) && !when.surfaceTags.some((tag) => surfaceTags.has(cleanToken(tag).toLowerCase()))) return false;
  return true;
}

function formatLog(template, ingredient, previousState) {
  return cleanToken(template)
    .replace(/\{name\}/g, ingredient.name)
    .replace(/\{label\}/g, ingredient.label())
    .replace(/\{state\}/g, ingredient.state)
    .replace(/\{previousState\}/g, previousState);
}

export function applyVisualModifier(ingredient, element) {
  if (!element || !(ingredient instanceof Ingredient)) return "";
  const key = ingredient.isRotten ? "rotten" : ingredient.state;
  const filter = DEFAULT_STATE_FILTERS[key] ?? "";
  element.style.filter = filter;
  element.dataset.ingredientState = ingredient.state;
  element.dataset.rotten = ingredient.isRotten ? "true" : "false";
  return filter;
}

export function createKitchenEngine(options = {}) {
  return new KitchenEngine(options);
}

if (typeof window !== "undefined") {
  window.UIEKitchenEngine = {
    Ingredient,
    Workspace,
    Station,
    KitchenEngine,
    createKitchenEngine,
    applyVisualModifier,
  };
}
