/**
 * domHierarchy.js — DOM Hierarchy State Matrices
 * 
 * Maintains the world's geography in a strict 3-tier nested JSON structure.
 * World (Tier 0) → Region (Tier 1) → LocalGrid (Tier 2)
 * 
 * Prevents AI hallucination by pruning suspended DOMs from prompt context.
 * Handles seamless transitions with portal crossing.
 */

export class DOMHierarchy {
  constructor() {
    this.worlds = {}; // { [worldId]: { regions: { [regionId]: { locals: { [gridId]: {...} } } } } }
    this.playerLocation = { worldId: "default", regionId: "hub", localGridId: "main", gridId: "main" };
    this.activeDOM = null;
    this.focusedDoms = {};
    this.focusedDomTasks = [];
  }

  /**
   * Create or get a world
   */
  getOrCreateWorld(worldId, worldData = {}) {
    if (!this.worlds[worldId]) {
      this.worlds[worldId] = {
        id: worldId,
        name: worldData.name || `World ${worldId}`,
        regions: {},
        metadata: worldData
      };
    }
    return this.worlds[worldId];
  }

  /**
   * Create or get a region within a world
   */
  getOrCreateRegion(worldId, regionId, regionData = {}) {
    const world = this.getOrCreateWorld(worldId);
    if (!world.regions[regionId]) {
      world.regions[regionId] = {
        id: regionId,
        name: regionData.name || `Region ${regionId}`,
        locals: {},
        metadata: regionData,
        connections: regionData.connections || {} // Links to other regions
      };
    }
    return world.regions[regionId];
  }

  /**
   * Create or get a local grid (room/area)
   */
  getOrCreateLocalGrid(worldId, regionId, gridId, gridData = {}) {
    const region = this.getOrCreateRegion(worldId, regionId);
    if (!region.locals[gridId]) {
      region.locals[gridId] = {
        id: gridId,
        name: gridData.name || `Location ${gridId}`,
        description: gridData.description || "",
        entities: [],           // NPCs, enemies
        objects: [],            // Items, furniture
        portals: {},            // { portalId: { target: { w, r, l }, label } }
        state: "suspended",     // "active" or "suspended"
        ssg: gridData.ssg || null, // Semantic Scene Graph
        metadata: gridData
      };
    }
    return region.locals[gridId];
  }

  upsertFocusedDOM(focus = {}) {
    const id = String(focus.id || focus.key || focus.label || "").trim();
    if (!id) return null;
    this.focusedDoms[id] = {
      ...(this.focusedDoms[id] || {}),
      ...focus,
      updatedAt: Date.now()
    };
    if (Array.isArray(focus.tasks)) {
      const taskIds = new Set(focus.tasks.map((task) => String(task?.id || "").trim()).filter(Boolean));
      this.focusedDomTasks = [
        ...this.focusedDomTasks.filter((task) => !taskIds.has(String(task?.id || "").trim())),
        ...focus.tasks
      ];
    }
    if (this.activeDOM) {
      this.activeDOM.focusedDoms = this.focusedDoms;
      this.activeDOM.focusedDomTasks = this.focusedDomTasks;
    }
    return this.focusedDoms[id];
  }

  /**
   * Move player to a new location (with portal crossing)
   */
  movePlayerTo(worldId, regionId, gridId) {
    // Mark old grid as suspended
    const oldLoc = this.playerLocation;
    if (oldLoc && this.worlds[oldLoc.worldId]?.regions[oldLoc.regionId]?.locals[oldLoc.localGridId]) {
      this.worlds[oldLoc.worldId].regions[oldLoc.regionId].locals[oldLoc.localGridId].state = "suspended";
    }

    // Activate new grid
    const newGrid = this.getOrCreateLocalGrid(worldId, regionId, gridId);
    newGrid.state = "active";
    this.activeDOM = newGrid;
    this.playerLocation = { worldId, regionId, localGridId: gridId, gridId };

    console.log(`[DOMHierarchy] Player moved: ${oldLoc.gridId} → ${gridId} (Active DOM updated)`);

    return {
      from: oldLoc,
      to: this.playerLocation,
      newDOM: newGrid,
      ssInject: newGrid.ssg // SSG to inject at Depth: 0
    };
  }

  /**
   * Get active entities for current grid only
   * (Suspended grids are pruned from AI context)
   */
  getActiveEntities() {
    if (!this.activeDOM) return [];
    return this.activeDOM.entities || [];
  }

  /**
   * Get active objects for current grid only
   */
  getActiveObjects() {
    if (!this.activeDOM) return [];
    return this.activeDOM.objects || [];
  }

  /**
   * Add entity to a specific grid
   */
  addEntity(worldId, regionId, gridId, entity) {
    const grid = this.getOrCreateLocalGrid(worldId, regionId, gridId);
    grid.entities.push(entity);
    return entity;
  }

  /**
   * Remove entity from a grid
   */
  removeEntity(worldId, regionId, gridId, entityId) {
    const grid = this.getOrCreateLocalGrid(worldId, regionId, gridId);
    grid.entities = grid.entities.filter(e => e.id !== entityId);
  }

  /**
   * Add object/item to grid
   */
  addObject(worldId, regionId, gridId, object) {
    const grid = this.getOrCreateLocalGrid(worldId, regionId, gridId);
    grid.objects.push(object);
    return object;
  }

  /**
   * Create a portal (micro/macro transition)
   */
  addPortal(worldId, regionId, gridId, portalId, portalData) {
    const grid = this.getOrCreateLocalGrid(worldId, regionId, gridId);
    grid.portals[portalId] = {
      id: portalId,
      label: portalData.label || "Portal",
      target: portalData.target, // { worldId, regionId, gridId }
      type: portalData.type || "door" // "door", "stairs", "gateway", etc.
    };
  }

  /**
   * Get locator path for entity
   */
  getEntityLocator(entity) {
    const loc = this.playerLocation;
    return `[${loc.worldId}, ${loc.regionId}, ${loc.localGridId || loc.gridId}]`;
  }

  /**
   * Seamless transition: Cross a portal
   */
  crossPortal(portalId) {
    if (!this.activeDOM || !this.activeDOM.portals[portalId]) {
      console.warn(`[DOMHierarchy] Portal ${portalId} not found`);
      return null;
    }

    const portal = this.activeDOM.portals[portalId];
    const target = portal.target;

    const transition = this.movePlayerTo(target.worldId, target.regionId, target.gridId);
    
    return {
      portalCrossed: true,
      label: portal.label,
      ...transition
    };
  }

  /**
   * Generate locator string for context injection
   */
  generateLocatorString() {
    const loc = this.playerLocation;
    return `Current Location: [World: ${loc.worldId}, Region: ${loc.regionId}, Grid: ${loc.localGridId || loc.gridId}]`;
  }

  /**
   * Export active DOM state (for AI prompt injection at Depth: 0)
   */
  exportActiveDOMState() {
    if (!this.activeDOM) return null;

    return {
      name: this.activeDOM.name,
      description: this.activeDOM.description,
      entities: this.activeDOM.entities.map(e => ({
        id: e.id,
        name: e.name,
        role: e.role || "npc"
      })),
      objects: this.activeDOM.objects.map(o => ({
        id: o.id,
        name: o.name,
        type: o.type
      })),
      portals: Object.values(this.activeDOM.portals).map(p => ({
        id: p.id,
        label: p.label,
        type: p.type
      })),
      focusedDoms: this.focusedDoms,
      focusedDomTasks: this.focusedDomTasks,
      ssg: this.activeDOM.ssg // Semantic Scene Graph JSON
    };
  }

  /**
   * Prune all suspended DOMs from context (prevent hallucination bleed)
   */
  getPrunedWorldState() {
    const activeLoc = this.playerLocation;
    return {
      current: {
        ...this.activeDOM
      },
      adjacentRegions: this.getAdjacentRegions(activeLoc.worldId, activeLoc.regionId)
    };
  }

  /**
   * Get adjacent regions (for fast travel prompts)
   */
  getAdjacentRegions(worldId, regionId) {
    const region = this.worlds[worldId]?.regions[regionId];
    if (!region) return [];

    return Object.entries(region.connections || {}).map(([key, targetId]) => ({
      id: key,
      targetRegionId: targetId,
      label: key
    }));
  }

  /**
   * Validate DOM structure
   */
  validate() {
    const errors = [];
    for (const [wId, world] of Object.entries(this.worlds)) {
      for (const [rId, region] of Object.entries(world.regions || {})) {
        for (const [gId, grid] of Object.entries(region.locals || {})) {
          if (!grid.id) errors.push(`Grid missing ID in ${wId}/${rId}`);
          if (!Array.isArray(grid.entities)) errors.push(`Entities not array in ${wId}/${rId}/${gId}`);
          if (!Array.isArray(grid.objects)) errors.push(`Objects not array in ${wId}/${rId}/${gId}`);
        }
      }
    }
    return errors.length === 0 ? null : errors;
  }
}

/**
 * Initialize global DOM hierarchy
 */
let globalDOMHierarchy = null;

export function initDOMHierarchy() {
  // Don't create default world here - create lazily on first use
  // globalDOMHierarchy = new DOMHierarchy();

  window.UIE_DOMHierarchy = {
    globalDOMHierarchy: () => globalDOMHierarchy,
    DOMHierarchy,
    initDOMHierarchy,
    getGlobalDOM: () => globalDOMHierarchy || (globalDOMHierarchy = new DOMHierarchy(), globalDOMHierarchy)
  };

  console.log("[DOMHierarchy] Initialized - 3-tier world structure ready (lazy-loaded)");
}

export function getGlobalDOM() {
  if (!globalDOMHierarchy) {
    initDOMHierarchy();
    globalDOMHierarchy = new DOMHierarchy();
  }
  return globalDOMHierarchy;
}
