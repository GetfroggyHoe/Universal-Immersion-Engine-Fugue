import { getSettings, commitStateUpdate } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "./gameContext.js";
import { injectRpEvent } from "./features/rp_log.js";
import { getChatTranscriptText } from "./chatLog.js";
import { safeJsonParseArray } from "./jsonUtil.js";
import { addInventoryItemWithStack } from "./inventoryItems.js";
import { notify } from "./notifications.js";
import { registerNPCRecord } from "./npcManagementModal.js";

const SHOP_WORDS = /\b(shop|store|market|merchant|vendor|boutique|emporium|retail|supermarket|grocery|pharmacy|apothecary|bakery|grocer|blacksmith|smithy|armory|bookstore|cafe|tavern|bar|restaurant|diner|mall|outfitter|trading post|supply depot|dealership|showroom|pawnshop|florist|jeweler|tailor|outlet|kiosk)\b/i;
const KEEPER_FIRST = ["Mara", "Tovin", "Iris", "Rook", "Nadia", "Ember", "Silas", "Jun", "Orin", "Vale"];
const KEEPER_LAST = ["Vell", "Mercer", "Thorne", "Bell", "Dusk", "Reed", "Ash", "Quill", "Pike", "Rowan"];

const STOCK_PRESETS = {
    food: [
        ["Fresh Bread", "food", 6, "common", "A warm loaf wrapped for travel."],
        ["House Meal", "food", 14, "common", "A filling meal made from local ingredients."],
        ["Travel Rations", "food", 18, "common", "A sealed ration pack for the road."],
        ["Rare Spice Tin", "ingredient", 32, "uncommon", "A fragrant local spice used in valuable recipes."],
        ["Restorative Tea", "drink", 22, "uncommon", "A calming blend traditionally served to tired travelers."],
        ["Chef's Special", "food", 45, "rare", "The shopkeeper's limited seasonal specialty."]
    ],
    books: [
        ["Local Gazetteer", "book", 20, "common", "A practical guide to nearby people and places."],
        ["Pocket Phrasebook", "book", 14, "common", "Useful phrases, customs, and trade etiquette."],
        ["Annotated Field Manual", "book", 38, "uncommon", "Advice collected by experienced travelers."],
        ["Collector's Chronicle", "book", 72, "rare", "A finely bound volume with scarce regional lore."],
        ["Blank Journal", "book", 10, "common", "A durable notebook with fresh pages."],
        ["Sealed Correspondence", "document", 55, "rare", "A curious letter sold on consignment."]
    ],
    medicine: [
        ["First Aid Kit", "medical", 34, "common", "Bandages and practical supplies for minor injuries."],
        ["Restorative Tonic", "potion", 28, "uncommon", "A local remedy sold in a sealed bottle."],
        ["Antidote", "potion", 42, "uncommon", "A broad remedy for common toxins."],
        ["Medicinal Herbs", "ingredient", 16, "common", "Clean, dried herbs ready for alchemy or tea."],
        ["Trauma Pack", "medical", 85, "rare", "Advanced emergency supplies for severe injuries."],
        ["Calming Draught", "potion", 30, "uncommon", "A measured dose intended to settle stress."]
    ],
    gear: [
        ["Utility Knife", "weapon", 24, "common", "A sturdy general-purpose blade."],
        ["Reinforced Jacket", "armor", 48, "uncommon", "Protective outerwear suited to local hazards."],
        ["Traveler's Pack", "container", 30, "common", "A balanced pack with extra storage."],
        ["Repair Kit", "tool", 36, "uncommon", "Tools and spare parts for field repairs."],
        ["Specialist Tool", "tool", 68, "rare", "A precise tool chosen for the region's common obstacles."],
        ["Merchant's Curio", "trinket", 95, "rare", "A scarce object with a story the keeper will gladly tell."]
    ],
    general: [
        ["Local Supplies", "supply", 12, "common", "Everyday supplies selected for this area."],
        ["Travel Rations", "food", 18, "common", "Food packed to survive a journey."],
        ["Utility Rope", "tool", 20, "common", "A reliable coil with many practical uses."],
        ["Repair Kit", "tool", 36, "uncommon", "Compact tools and common replacement parts."],
        ["Regional Keepsake", "trinket", 28, "uncommon", "A small object made by local craftspeople."],
        ["Rare Local Curio", "artifact", 88, "rare", "An unusual consignment with uncertain history."]
    ]
};

let lastObservedLocation = "";
let lastObservedContext = "";
let arrivalBusy = false;

function slug(value) {
    return String(value || "shop").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "shop";
}

function hash(value) {
    let out = 2166136261;
    for (const ch of String(value || "")) out = Math.imul(out ^ ch.charCodeAt(0), 16777619);
    return out >>> 0;
}

function ensureShop(s) {
    if (!s.shop || typeof s.shop !== "object") s.shop = {};
    if (!Array.isArray(s.shop.catalog)) s.shop.catalog = [];
    if (!s.shop.locations || typeof s.shop.locations !== "object") s.shop.locations = {};
    if (typeof s.shop.keywords !== "string") s.shop.keywords = "";
    if (!s.shop.mode) s.shop.mode = "buy";
    if (!s.ai || typeof s.ai !== "object") s.ai = {};
    if (typeof s.ai.shop !== "boolean") s.ai.shop = true;
}

function currentLocationContext(s = getSettings()) {
    const name = String(s.worldState?.currentLocation || s.worldState?.location || s.map?.location || "Current Location").trim() || "Current Location";
    const pools = [
        s.worldState?.mapNodes,
        s.simpleMap?.nodes,
        s.mapData?.nodes,
        s.mapEngine?.nodes
    ];
    let node = null;
    for (const pool of pools) {
        if (!pool) continue;
        if (Array.isArray(pool)) node = pool.find((item) => String(item?.name || item?.label || item?.id || "").toLowerCase() === name.toLowerCase());
        else if (typeof pool === "object") node = pool[name] || Object.values(pool).find((item) => String(item?.name || item?.label || item?.id || "").toLowerCase() === name.toLowerCase());
        if (node) break;
    }
    const description = String(node?.description || node?.desc || s.worldState?.description || "").trim();
    const type = String(node?.type || node?.environmentType || node?.category || "").trim();
    const tags = Array.isArray(node?.tags) ? node.tags.join(" ") : String(node?.tags || "");
    return { name, key: slug(name), description, type, tags, node: node || {} };
}

function isShopLocation(context) {
    const text = [context.name, context.type, context.tags, context.description].filter(Boolean).join(" ");
    if (SHOP_WORDS.test(text)) return true;
    const commercialType = /\b(commercial|service|food service|retail interior|shopping)\b/i.test(`${context.type} ${context.tags}`);
    const salesLanguage = /\b(sells?|buys?|purchase|for sale|merchandise|stocked shelves?|checkout|cashier|sales clerk|storefront|wares?)\b/i.test(context.description);
    return commercialType || salesLanguage;
}

function shopKind(context) {
    const text = [context.name, context.type, context.tags, context.description].join(" ").toLowerCase();
    if (/cafe|tavern|bar|restaurant|diner|bakery|grocer|food|kitchen/.test(text)) return "food";
    if (/book|archive|library|stationer|scroll/.test(text)) return "books";
    if (/pharmacy|apothecary|clinic|hospital|medicine|potion/.test(text)) return "medicine";
    if (/blacksmith|smithy|armory|outfitter|weapon|armor|gear|supply depot/.test(text)) return "gear";
    return "general";
}

function locationShop(s, context = currentLocationContext(s)) {
    ensureShop(s);
    const entry = s.shop.locations[context.key] || (s.shop.locations[context.key] = {
        location: context.name,
        kind: shopKind(context),
        catalog: [],
        keywords: "",
        keeperId: "",
        visits: 0,
        createdAt: Date.now()
    });
    if (!Array.isArray(entry.catalog)) entry.catalog = [];
    s.shop.activeLocationKey = context.key;
    s.shop.catalog = entry.catalog;
    s.shop.keywords = String(entry.keywords || "");
    return entry;
}

function keeperForLocation(s, context, entry) {
    if (!Array.isArray(s.character_cards)) s.character_cards = [];
    const id = entry.keeperId || `shopkeeper_${context.key}`;
    let card = s.character_cards.find((item) => String(item?.id || "") === id);
    if (!card) {
        const seed = hash(context.name);
        const name = `${KEEPER_FIRST[seed % KEEPER_FIRST.length]} ${KEEPER_LAST[(seed >>> 5) % KEEPER_LAST.length]}`;
        card = {
            id,
            name,
            role: `${context.name} Shopkeeper`,
            cardNature: "Character",
            description: `The proprietor of ${context.name}, knowledgeable about local goods, customers, prices, and rumors.`,
            personality: seed % 3 === 0 ? "Warm, observant, and fond of regulars." : seed % 3 === 1 ? "Practical, sharp-eyed, and fair when treated fairly." : "Expressive, persuasive, and proud of unusual stock.",
            background: `Runs ${context.name} and sources inventory from the surrounding area.`,
            likes: "Respectful customers, repeat business, useful local news",
            dislikes: "Theft, damaged merchandise, time-wasters",
            wants: "Keep the shop supplied and profitable",
            needs: "Reliable customers and safe trade routes",
            hooks: `Knows what is scarce, valuable, illegal, or newly arrived near ${context.name}.`,
            rules: "Acts as a persistent merchant NPC and remembers shop visits.",
            avatar: "",
            expressions: [],
            data: { source: "context_shop", shopLocation: context.name, shopKey: context.key }
        };
        s.character_cards.push(card);
    }
    entry.keeperId = card.id;
    if (!Array.isArray(s.gameCharacters)) s.gameCharacters = [];
    if (!s.gameCharacters.includes(card.id)) s.gameCharacters.push(card.id);
    if (!Array.isArray(s.sceneCharacters)) s.sceneCharacters = [];
    if (!s.sceneCharacters.some((item) => String(item?.cardId || item?.id || "") === card.id)) {
        s.sceneCharacters.push({ cardId: card.id, id: card.id, name: card.name, role: card.role, source: "context_shop", location: context.name });
    }
    if (!entry.npcRegisteredAt) {
        registerNPCRecord({
            id: card.id,
            cardId: card.id,
            characterCardId: card.id,
            name: card.name,
            role: "Shopkeeper",
            title: `Proprietor of ${context.name}`,
            age: "Adult",
            location: context.name,
            currentLocation: context.name,
            appearance: `A distinctive local merchant whose clothing, tools, and presentation reflect ${context.name} and its ${entry.kind || "general"} trade.`,
            personality: card.personality,
            bio: card.description,
            likes: ["Respectful customers", "Repeat business", "Useful local news"],
            dislikes: ["Theft", "Damaged merchandise", "Bad-faith bargaining"],
            affiliations: [`${context.name} Staff`],
            organizationAffiliations: [`${context.name} Staff`],
            organization: context.name,
            rumors: [`Keeps track of supply problems and unusual customers around ${context.name}.`],
            schedules: [`Open during the normal business hours of ${context.name}.`, `Sources stock and handles accounts when the shop is closed.`],
            schedule: `Works at ${context.name}; restocking and private business occur outside customer hours.`,
            lockMode: "auto",
            locked: false,
            canUnlock: true,
            wants: ["Keep the shop profitable", "Find distinctive stock", "Build a reliable customer base"],
            needs: { business: "Reliable suppliers", personal: "Safety and time away from the counter" },
            secrets: [{
                title: "Private merchant leverage",
                truth: `Knows a concealed supply, debt, customer, or trade-route detail connected to ${context.name}.`,
                publicCover: "The shop's business is ordinary and fully transparent.",
                category: "business",
                active: true,
                archived: false,
                exposure: { status: "hidden" }
            }],
            privateIntel: [`The shopkeeper's supplier terms and sensitive customer information are private.`],
            avatar: card.avatar,
            expressions: card.expressions,
            data: { source: "context_shop", shopLocation: context.name, shopKey: context.key }
        }, { source: "context_shop" });
        entry.npcRegisteredAt = Date.now();
    }
    return card;
}

function greetingFor(card, context, entry) {
    const returning = Number(entry.visits || 0) > 1;
    const kind = entry.kind || "general";
    const offer = kind === "food" ? "Something hot, something packed, or a local specialty?" : kind === "books" ? "Looking for practical knowledge, local history, or something scarce?" : kind === "medicine" ? "Tell me what hurts—or what journey you're preparing for." : kind === "gear" ? "Need repairs, protection, tools, or something with a sharper edge?" : "Have a look around. I keep the useful things near the front and the interesting things under the counter.";
    return returning ? `Welcome back to ${context.name}. ${offer}` : `Welcome to ${context.name}. I'm ${card.name}. ${offer}`;
}

function proceduralCatalog(context, entry) {
    const base = STOCK_PRESETS[entry.kind] || STOCK_PRESETS.general;
    const seed = hash(`${context.name}:${entry.keywords || ""}`);
    return base.map((row, index) => ({
        id: `${context.key}_${slug(row[0])}`,
        name: row[0],
        type: row[1],
        price: Math.max(1, Math.round(row[2] * (0.9 + ((seed + index * 17) % 25) / 100))),
        rarity: row[3],
        desc: `${row[4]} Stocked for ${context.name}.`,
        icon: entry.kind === "books" ? "📘" : entry.kind === "food" ? "🍲" : entry.kind === "medicine" ? "🧪" : entry.kind === "gear" ? "🛠️" : "🛒",
        stock: 1 + ((seed + index * 13) % 5),
        source: "procedural_context"
    }));
}

async function chatSnippet() {
    try {
        const text = await getChatTranscriptText({ maxMessages: 30, maxChars: 2400 });
        if (text) return text;
    } catch (_) {}
    return "";
}

function loreKeys() {
    try {
        const ctx = getContext?.();
        const source = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo;
        if (!Array.isArray(source)) return [];
        return Array.from(new Set(source.map((item) => item?.key || item?.name || item?.title).filter(Boolean).map(String))).slice(0, 60);
    } catch (_) { return []; }
}

function activeEntry(s) {
    ensureShop(s);
    const context = currentLocationContext(s);
    return { context, entry: locationShop(s, context) };
}

function renderKeeper(card, context, entry) {
    const initials = String(card?.name || "Shopkeeper").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
    $("#uie-shopkeeper-avatar").text(initials).css("background-image", card?.avatar ? `url("${String(card.avatar).replace(/\"/g, "%22")}")` : "none");
    $("#uie-shopkeeper-name").text(card?.name || "Shopkeeper");
    $("#uie-shopkeeper-role").text(`${card?.role || "Merchant"} • ${context.name}`);
    $("#uie-shopkeeper-dialogue").text(entry.greeting || greetingFor(card, context, entry));
    $("#uie-shop-location-label").text(`${context.name} • ${String(entry.kind || "general").toUpperCase()}`);
}

function inventorySellRows(s) {
    return (Array.isArray(s.inventory?.items) ? s.inventory.items : [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item && String(item.type || "").toLowerCase() !== "currency" && Number(item.qty || 1) > 0);
}

function renderShop() {
    const s = getSettings();
    const { context, entry } = activeEntry(s);
    const keeper = keeperForLocation(s, context, entry);
    const sym = String(s.currencySymbol || "G");
    $("#uie-shop-balance").text(`${Number(s.currency || 0)} ${sym}`);
    $("#uie-shop-keywords").val(String(entry.keywords || ""));
    $("#uie-shop-mode-buy").toggleClass("active", s.shop.mode !== "sell");
    $("#uie-shop-mode-sell").toggleClass("active", s.shop.mode === "sell");
    renderKeeper(keeper, context, entry);

    const query = String($("#uie-shop-search").val() || "").trim().toLowerCase();
    const $list = $("#uie-shop-items").empty();
    if (s.shop.mode === "sell") {
        const rows = inventorySellRows(s).filter(({ item }) => !query || [item.name, item.type, item.description].join(" ").toLowerCase().includes(query));
        if (!rows.length) return void $list.html('<div class="uie-shop-empty">No sellable inventory matches this search.</div>');
        for (const { item, index } of rows) {
            const value = Math.max(1, Math.floor(Number(item.price || item.value || 10) * 0.5));
            $list.append(`<article class="uie-shop-item"><div class="uie-shop-icon">📦</div><div class="uie-shop-copy"><div class="uie-shop-name"></div><div class="uie-shop-desc"></div><div class="uie-shop-meta"></div></div><div class="uie-shop-purchase"><div class="uie-shop-price"></div><button class="uie-shop-sell" data-idx="${index}">SELL ONE</button></div></article>`);
            const $row = $list.children().last();
            $row.find(".uie-shop-name").text(String(item.name || "Item"));
            $row.find(".uie-shop-desc").text(String(item.description || "No description."));
            $row.find(".uie-shop-meta").text(`${String(item.type || "misc")} • owned ${Number(item.qty || 1)}`);
            $row.find(".uie-shop-price").text(`${value} ${sym}`);
        }
        return;
    }

    const catalog = entry.catalog.filter((item) => !query || [item.name, item.type, item.rarity, item.desc].join(" ").toLowerCase().includes(query));
    if (!catalog.length) return void $list.html('<div class="uie-shop-empty">The shelves are being stocked. Try Refresh Stock.</div>');
    for (const item of catalog) {
        const price = Math.max(0, Number(item.price || 0));
        const stock = Math.max(0, Number(item.stock ?? 1));
        const disabled = stock < 1 || Number(s.currency || 0) < price;
        $list.append(`<article class="uie-shop-item"><div class="uie-shop-icon"></div><div class="uie-shop-copy"><div class="uie-shop-name"></div><div class="uie-shop-desc"></div><div class="uie-shop-meta"></div></div><div class="uie-shop-purchase"><div class="uie-shop-price"></div><button class="uie-shop-buy" data-id="${String(item.id || "")}" ${disabled ? "disabled" : ""}>${stock ? "BUY" : "SOLD OUT"}</button></div></article>`);
        const $row = $list.children().last();
        $row.find(".uie-shop-icon").text(String(item.icon || "🛒"));
        $row.find(".uie-shop-name").text(String(item.name || "Item"));
        $row.find(".uie-shop-desc").text(String(item.desc || ""));
        $row.find(".uie-shop-meta").text(`${String(item.rarity || "common")} • ${String(item.type || "misc")} • stock ${stock}`);
        $row.find(".uie-shop-price").text(`${price} ${sym}`);
    }
}

export function renderShopView() { renderShop(); }

export async function generateCatalog(options = {}) {
    const s = getSettings();
    ensureShop(s);
    const context = options.context || currentLocationContext(s);
    const entry = locationShop(s, context);
    const keeper = keeperForLocation(s, context, entry);
    const typed = String($("#uie-shop-keywords").val() || entry.keywords || "").trim();
    entry.keywords = typed;
    let catalog = [];

    if (s.ai.shop !== false) {
        try {
            const prompt = [
                "Generate a grounded merchant catalog for an RPG location. Return JSON only as an array.",
                "Each item: {\"name\":\"\",\"desc\":\"\",\"type\":\"\",\"rarity\":\"common|uncommon|rare\",\"price\":0,\"stock\":1,\"icon\":\"\"}.",
                "Return 6-10 distinct items. Prices and availability must fit the location, lore, recent events, and merchant specialty.",
                `Location: ${context.name}`,
                `Location type: ${context.type || entry.kind}`,
                `Location description: ${context.description || "No description supplied."}`,
                `Merchant: ${keeper.name}, ${keeper.personality}`,
                `Customer request: ${typed || "general local stock"}`,
                `Currency symbol: ${String(s.currencySymbol || "G")}`,
                `Lore keys: ${loreKeys().join(", ")}`,
                `Recent story: ${(await chatSnippet()).slice(-1800)}`
            ].join("\n");
            const response = await generateContent(prompt.slice(0, 6500), "Shop Inventory");
            const parsed = safeJsonParseArray(response || "");
            if (parsed) catalog = parsed.slice(0, 10).map((item, index) => ({
                id: `${context.key}_${slug(item.name || `item_${index}`)}`,
                name: String(item.name || "Item").slice(0, 70),
                desc: String(item.desc || item.description || "").slice(0, 220),
                type: String(item.type || "misc").slice(0, 40),
                rarity: /^(common|uncommon|rare)$/i.test(String(item.rarity || "")) ? String(item.rarity).toLowerCase() : "common",
                price: Math.max(0, Math.round(Number(item.price || 0))),
                stock: Math.max(1, Math.min(99, Math.round(Number(item.stock || 1)))),
                icon: String(item.icon || "🛒").slice(0, 8),
                source: "ai_context"
            }));
        } catch (error) {
            console.warn("[Shop] Context inventory generation failed; using local stock.", error);
        }
    }
    if (!catalog.length) catalog = proceduralCatalog(context, entry);
    entry.catalog = catalog;
    entry.generatedAt = Date.now();
    s.shop.catalog = entry.catalog;
    s.shop.keywords = entry.keywords;
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderShop();
    return catalog;
}

async function openContextShop(context, options = {}) {
    if (arrivalBusy || !isShopLocation(context)) return false;
    const $win = $("#uie-shop-window");
    if (!$win.length) return false;
    arrivalBusy = true;
    try {
        const s = getSettings();
        const entry = locationShop(s, context);
        const keeper = keeperForLocation(s, context, entry);
        entry.visits = Number(entry.visits || 0) + 1;
        entry.lastOpenedAt = Date.now();
        entry.greeting = greetingFor(keeper, context, entry);
        s.shop.mode = "buy";
        commitStateUpdate({ save: true, layout: false, emit: false });
        $win.css("display", $win.attr("data-open-display") || "flex");
        renderShop();
        if (!entry.catalog.length || options.forceRefresh) {
            $("#uie-shop-items").html('<div class="uie-shop-empty">The shopkeeper is selecting stock for this location…</div>');
            await generateCatalog({ context, auto: true });
        }
        try { injectRpEvent(`[${keeper.name}, shopkeeper at ${context.name}: "${entry.greeting}"]`); } catch (_) {}
        window.dispatchEvent(new CustomEvent("uie:shop_entered", { detail: { location: context.name, keeperId: keeper.id, catalogSize: entry.catalog.length } }));
        return true;
    } finally {
        arrivalBusy = false;
    }
}

async function detectShopArrival(event) {
    const detail = event?.detail || {};
    const s = getSettings();
    const context = currentLocationContext(s);
    const fingerprint = `${context.name}|${context.type}|${context.tags}|${context.description}`.toLowerCase();
    if (!context.name || fingerprint === lastObservedContext) return;
    const previous = lastObservedLocation;
    lastObservedLocation = context.name;
    lastObservedContext = fingerprint;
    const shop = isShopLocation(context);
    if (shop && (detail.travel === true || previous || event?.type === "uie:shop-check")) {
        await openContextShop(context);
    } else if (!shop && previous && previous !== context.name) {
        $("#uie-shop-window").hide();
    }
}

export function initShop() {
    const s = getSettings();
    ensureShop(s);
    const $win = $("#uie-shop-window");
    if (!$win.length) return;
    const initialContext = currentLocationContext(s);
    lastObservedLocation = "";
    lastObservedContext = "";

    $win.off("click.uieShop input.uieShop");
    $(window).off("uie:state_updated.uieShop uie:shop-check.uieShop uie:open-shop.uieShop");

    $win.on("click.uieShop", "#uie-shop-generate, #uie-shop-refresh", async function(event) {
        event.preventDefault(); event.stopPropagation();
        const $button = $(this).prop("disabled", true);
        try { await generateCatalog({ forceRefresh: true }); } finally { $button.prop("disabled", false); }
    });
    $win.on("click.uieShop", "#uie-shop-mode-buy, #uie-shop-mode-sell", function() {
        const state = getSettings(); ensureShop(state);
        state.shop.mode = this.id.endsWith("sell") ? "sell" : "buy";
        commitStateUpdate({ save: true, layout: false, emit: false });
        renderShop();
    });
    $win.on("input.uieShop", "#uie-shop-search", renderShop);
    $win.on("click.uieShop", ".uie-shop-buy", function() {
        const state = getSettings();
        const { entry } = activeEntry(state);
        const item = entry.catalog.find((candidate) => String(candidate.id) === String($(this).data("id")));
        if (!item || Number(item.stock || 0) < 1) return;
        const price = Math.max(0, Number(item.price || 0));
        if (Number(state.currency || 0) < price) return void notify("warning", "You cannot afford that item.", "Merchant");
        state.currency = Number(state.currency || 0) - price;
        state.inventory = state.inventory || {}; state.inventory.items = state.inventory.items || [];
        addInventoryItemWithStack(state.inventory.items, { kind: "item", name: item.name, type: item.type, description: item.desc, rarity: item.rarity, qty: 1, price: item.price, statusEffects: [] }, { source: "shop_purchase" });
        item.stock = Math.max(0, Number(item.stock || 0) - 1);
        commitStateUpdate({ save: true, layout: false, emit: true });
        try { injectRpEvent(`[System: Purchased ${item.name} for ${price} ${String(state.currencySymbol || "G")} at ${entry.location}.]`); } catch (_) {}
        notify("success", `Purchased ${item.name}.`, "Merchant");
        renderShop();
    });
    $win.on("click.uieShop", ".uie-shop-sell", function() {
        const state = getSettings();
        const index = Number($(this).data("idx"));
        const item = state.inventory?.items?.[index];
        if (!item || Number(item.qty || 1) < 1) return;
        const value = Math.max(1, Math.floor(Number(item.price || item.value || 10) * 0.5));
        state.currency = Number(state.currency || 0) + value;
        if (Number(item.qty || 1) > 1) item.qty = Number(item.qty) - 1;
        else state.inventory.items.splice(index, 1);
        commitStateUpdate({ save: true, layout: false, emit: true });
        try { injectRpEvent(`[System: Sold ${String(item.name || "Item")} for ${value} ${String(state.currencySymbol || "G")}.]`); } catch (_) {}
        notify("success", `Sold ${String(item.name || "Item")} for ${value} ${String(state.currencySymbol || "G")}.`, "Merchant");
        renderShop();
    });

    $(window).on("uie:state_updated.uieShop uie:shop-check.uieShop", detectShopArrival);
    $(window).on("uie:open-shop.uieShop", async function(_event, detail) {
        const context = currentLocationContext(getSettings());
        await openContextShop(context, { forceRefresh: detail?.forceRefresh === true });
    });
    window.UIE_openContextShop = async function(options = {}) {
        return openContextShop(currentLocationContext(getSettings()), options);
    };
    if (isShopLocation(initialContext)) renderShop();
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent("uie:shop-check", { detail: { startup: true, location: initialContext.name } }));
    }, 500);
}
