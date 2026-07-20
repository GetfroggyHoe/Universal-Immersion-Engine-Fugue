export const CREDENTIAL_SCHEMA_VERSION = 2;

const TYPE_DEFINITIONS = [
  ["driver_license", "Driver's License", "identity", "plastic_card", "modern", true],
  ["state_id", "State / National ID", "identity", "plastic_card", "modern", true],
  ["passport", "Passport", "identity", "booklet", "modern", true],
  ["student_id", "Student ID", "identity", "plastic_card", "modern", true],
  ["employee_badge", "Employee Badge", "identity", "badge", "modern", true],
  ["press_badge", "Press Badge", "identity", "badge", "modern", true],
  ["medical_id", "Medical Identification", "identity", "plastic_card", "modern", true],
  ["military_id", "Military Identification", "identity", "plastic_card", "modern", true],
  ["diplomatic_credential", "Diplomatic Credential", "identity", "booklet", "modern", true],
  ["security_credential", "Police / Security Credential", "identity", "badge", "modern", true],
  ["hotel_key", "Hotel Room Key", "access", "keycard", "modern", false],
  ["apartment_keycard", "Apartment Keycard", "access", "keycard", "modern", false],
  ["workplace_badge", "Workplace Access Badge", "access", "badge", "modern", true],
  ["lab_clearance", "Lab Clearance Card", "access", "badge", "modern", true],
  ["vip_pass", "VIP Pass", "access", "badge", "modern", false],
  ["backstage_pass", "Backstage Pass", "access", "badge", "modern", true],
  ["visitor_pass", "Temporary / Visitor Pass", "access", "badge", "modern", true],
  ["master_keycard", "Building Master Key", "access", "keycard", "modern", false],
  ["faction_pass", "Faction Territory Pass", "access", "badge", "any", true],
  ["debit_card", "Debit Card", "financial", "plastic_card", "modern", false, true],
  ["credit_card", "Credit Card", "financial", "plastic_card", "modern", false, true],
  ["prepaid_card", "Prepaid Card", "financial", "plastic_card", "modern", false, true],
  ["gift_card", "Gift Card", "financial", "plastic_card", "modern", false],
  ["expense_card", "Business Expense Card", "financial", "plastic_card", "modern", false, true],
  ["joint_account_card", "Joint Account Card", "financial", "plastic_card", "modern", false, true],
  ["membership_card", "Membership Card", "financial", "plastic_card", "modern", false],
  ["casino_player_card", "Casino Player Card", "financial", "plastic_card", "modern", false],
  ["transit_pass", "Transit Pass", "travel", "digital_or_card", "modern", false],
  ["train_ticket", "Train Ticket", "travel", "ticket", "any", false],
  ["boarding_pass", "Boarding Pass", "travel", "ticket", "modern", false],
  ["cruise_ticket", "Cruise Ticket", "travel", "ticket", "modern", false],
  ["vehicle_registration", "Vehicle Registration", "travel", "document", "modern", false],
  ["parking_permit", "Parking Permit", "travel", "permit", "modern", false],
  ["toll_card", "Toll Card", "travel", "plastic_card", "modern", false],
  ["travel_visa", "Travel Visa", "travel", "document", "any", true],
  ["business_card", "Business Card", "custom", "plastic_card", "any", false],
  ["contact_card", "Contact Card", "custom", "digital_or_card", "any", false],
  ["club_card", "Club Card", "custom", "plastic_card", "any", false],
  ["event_badge", "Event Badge", "custom", "badge", "any", true],
  ["loyalty_card", "Loyalty Card", "custom", "plastic_card", "modern", false],
  ["fantasy_document", "Custom Fantasy Document", "document", "document", "fantasy", false],
  ["guild_seal", "Guild Seal", "identity", "seal", "fantasy", false],
  ["adventurer_license", "Adventurer License", "identity", "document", "fantasy", true],
  ["noble_writ", "Noble Writ", "document", "scroll", "fantasy", false],
  ["royal_decree", "Royal Decree", "document", "scroll", "fantasy", false],
  ["merchant_permit", "Merchant Permit", "access", "document", "fantasy", true],
  ["city_entry_token", "City-entry Token", "access", "token", "fantasy", false],
  ["mage_certification", "Mage Certification", "identity", "document", "fantasy", true],
  ["bounty_charter", "Bounty Charter", "document", "scroll", "fantasy", false],
  ["caravan_pass", "Caravan Pass", "travel", "document", "fantasy", false],
  ["temple_identification", "Temple Identification", "identity", "seal", "fantasy", true],
  ["property_deed", "Property Deed", "document", "document", "fantasy", false],
  ["ship_papers", "Ship Papers", "travel", "document", "fantasy", false],
  ["letter_of_passage", "Letter of Passage", "travel", "scroll", "fantasy", false],
  ["sealed_invitation", "Wax-sealed Invitation", "access", "document", "fantasy", false],
  ["faction_insignia", "Faction Insignia", "access", "insignia", "fantasy", false],
  ["rune_access_tablet", "Rune Access Tablet", "access", "tablet", "fantasy", false]
];

export const CREDENTIAL_TYPES = Object.freeze(Object.fromEntries(TYPE_DEFINITIONS.map((row) => {
  const [id, label, category, format, worldMode, portraitRequired, linkedAccountRequired = false] = row;
  return [id, Object.freeze({ id, label, category, format, worldMode, portraitRequired, linkedAccountRequired })];
})));

const LEGACY_TYPES = Object.freeze({
  id_license: "driver_license",
  id_work: "employee_badge",
  id_business: "business_card",
  bank_card: "debit_card"
});

const INVENTORY_CATEGORIES = Object.freeze({
  identity: "Credential",
  access: "Access",
  financial: "Financial",
  travel: "Ticket",
  custom: "Credential",
  document: "Document"
});

const DEFAULT_SECURITY = Object.freeze({
  barcodeValue: "",
  qrValue: "",
  magneticStripe: false,
  chip: false,
  hologram: false,
  signatureRequired: false,
  scanDifficulty: 35
});

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : min;
}

function list(value) {
  if (Array.isArray(value)) return [...new Set(value.map((entry) => text(entry)).filter(Boolean))];
  return text(value).split(/[\n,;]/).map((entry) => entry.trim()).filter(Boolean);
}

function timestamp(value) {
  if (value === null || value === "" || /^never$/i.test(String(value || ""))) return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function legacyExpiry(value) {
  const raw = text(value);
  if (!raw || /^never$/i.test(raw)) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return timestamp(raw);
  const month = Math.max(1, Math.min(12, Number(match[1])));
  const year = Number(match[2]) < 100 ? 2000 + Number(match[2]) : Number(match[2]);
  return new Date(year, month, 0, 23, 59, 59, 999).getTime();
}

function makeId(prefix = "cred") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveCredentialWorldMode(settings = {}) {
  const mode = text(settings?.world?.gameMode, "modern").toLowerCase();
  return mode === "high-fantasy" || mode === "rpg" ? "fantasy" : mode === "futuristic" ? "futuristic" : "modern";
}

export function credentialDefinition(type) {
  const normalized = LEGACY_TYPES[text(type)] || text(type, "business_card");
  return CREDENTIAL_TYPES[normalized] || CREDENTIAL_TYPES.business_card;
}

export function normalizeCredential(raw = {}, settings = {}) {
  const now = Date.now();
  const oldType = text(raw.type, "business_card");
  const type = LEGACY_TYPES[oldType] || oldType;
  const definition = credentialDefinition(type);
  const legacyImage = text(raw.image);
  const appearance = raw.appearance && typeof raw.appearance === "object" ? raw.appearance : {};
  const authenticity = ["issued", "custom", "forged"].includes(text(raw.authenticity))
    ? text(raw.authenticity)
    : raw.schemaVersion ? "custom" : "forged";
  const credentialNumber = text(raw.credentialNumber || raw.cardNumber, `CF-${String(now).slice(-7)}`);
  const holderName = text(raw.holderName || raw.name, settings?.character?.name || "Unknown holder");
  const expiresAt = raw.expiresAt === null ? null : timestamp(raw.expiresAt) ?? legacyExpiry(raw.expiry);
  const createdAt = timestamp(raw.createdAt || raw.t) || now;
  const normalized = {
    ...raw,
    id: text(raw.id, makeId("cred")),
    schemaVersion: CREDENTIAL_SCHEMA_VERSION,
    category: text(raw.category, definition.category),
    type: definition.id,
    typeName: text(raw.typeName, definition.label),
    format: text(raw.format, definition.format),
    worldMode: text(raw.worldMode, definition.worldMode === "any" ? resolveCredentialWorldMode(settings) : definition.worldMode),
    holderId: text(raw.holderId, "player"),
    holderName,
    holderPhoto: text(raw.holderPhoto || appearance.portraitImage),
    issuerId: text(raw.issuerId, authenticity === "issued" ? "uie_system" : "self"),
    issuerName: text(raw.issuerName, authenticity === "issued" ? "Universal Registry" : "Self-issued"),
    title: text(raw.title),
    credentialNumber,
    issuedAt: timestamp(raw.issuedAt) || createdAt,
    validFrom: timestamp(raw.validFrom) || createdAt,
    expiresAt,
    status: ["active", "expired", "revoked", "frozen", "confiscated", "destroyed"].includes(text(raw.status)) ? text(raw.status) : "active",
    authenticity,
    quality: clamp(raw.quality ?? (authenticity === "issued" ? 100 : 82)),
    condition: clamp(raw.condition ?? 100),
    permissions: list(raw.permissions),
    restrictions: list(raw.restrictions),
    linkedAccountId: raw.linkedAccountId ? text(raw.linkedAccountId) : null,
    linkedReservationId: raw.linkedReservationId ? text(raw.linkedReservationId) : null,
    linkedJobId: raw.linkedJobId ? text(raw.linkedJobId) : null,
    linkedLocationIds: list(raw.linkedLocationIds),
    physical: raw.physical !== false,
    favorite: raw.favorite === true,
    appearance: {
      templateId: text(appearance.templateId, `${resolveCredentialWorldMode(settings)}_${definition.category}_01`),
      theme: text(appearance.theme, "charcoal_gold"),
      frontImage: text(appearance.frontImage || legacyImage),
      backImage: text(appearance.backImage),
      portraitImage: text(appearance.portraitImage || raw.holderPhoto),
      emblemImage: text(appearance.emblemImage),
      accent: text(appearance.accent, "#cba35c"),
      fontScale: Math.max(0.75, Math.min(1.25, Number(appearance.fontScale || 1))),
      portraitX: Math.max(0, Math.min(1, Number(appearance.portraitX ?? 0.5))),
      portraitY: Math.max(0, Math.min(1, Number(appearance.portraitY ?? 0.5)))
    },
    security: {
      ...DEFAULT_SECURITY,
      ...(raw.security && typeof raw.security === "object" ? raw.security : {}),
      barcodeValue: text(raw.security?.barcodeValue, credentialNumber),
      qrValue: text(raw.security?.qrValue, `uie:credential:${credentialNumber}`),
      scanDifficulty: clamp(raw.security?.scanDifficulty ?? (authenticity === "forged" ? 45 : 75))
    },
    history: Array.isArray(raw.history) ? raw.history.slice(-100) : [],
    createdAt,
    updatedAt: timestamp(raw.updatedAt) || now,
    lastUsedAt: timestamp(raw.lastUsedAt),
    lastUsedLocationId: raw.lastUsedLocationId ? text(raw.lastUsedLocationId) : null
  };

  // Compatibility fields keep old integrations functional without making them authoritative.
  normalized.name = normalized.holderName;
  normalized.cardNumber = normalized.credentialNumber;
  normalized.expiry = normalized.expiresAt ? new Date(normalized.expiresAt).toLocaleDateString() : "Never";
  normalized.image = normalized.appearance.frontImage;
  normalized.t = normalized.createdAt;
  return normalized;
}

export function inventoryCategoryForCredential(credential) {
  return INVENTORY_CATEGORIES[text(credential?.category)] || "Credential";
}

export function syncCredentialInventory(settings, credential) {
  if (!credential?.id || credential.physical === false) return null;
  if (!settings.inventory || typeof settings.inventory !== "object") settings.inventory = {};
  if (!Array.isArray(settings.inventory.items)) settings.inventory.items = [];
  const inventoryId = `credential_${credential.id}`;
  const legacyInventoryId = `card_${credential.id}`;
  const item = {
    id: inventoryId,
    name: `${credential.holderName}'s ${credential.typeName}`,
    description: `${credential.authenticity === "forged" ? "Forged" : credential.authenticity === "issued" ? "Issued" : "Custom"} ${credential.typeName}.\nIssuer: ${credential.issuerName}\nCredential: ${credential.credentialNumber}\nStatus: ${credential.status}`,
    quantity: 1,
    qty: 1,
    category: inventoryCategoryForCredential(credential),
    type: "credential",
    imageUrl: credential.appearance.frontImage,
    img: credential.appearance.frontImage,
    rarity: credential.authenticity === "forged" ? "Rare" : "Unique",
    customAttributes: {
      credentialId: credential.id,
      credentialType: credential.type,
      credentialCategory: credential.category,
      issuerId: credential.issuerId,
      linkedAccountId: credential.linkedAccountId,
      status: credential.status,
      authenticity: credential.authenticity
    }
  };
  const index = settings.inventory.items.findIndex((entry) => entry?.id === inventoryId || entry?.id === legacyInventoryId);
  if (index >= 0) settings.inventory.items[index] = item;
  else settings.inventory.items.push(item);
  return item;
}

export function removeCredentialInventory(settings, credentialId) {
  if (!Array.isArray(settings?.inventory?.items)) return;
  settings.inventory.items = settings.inventory.items.filter((entry) => entry?.id !== `credential_${credentialId}` && entry?.id !== `card_${credentialId}`);
}

export function ensureCredentialState(settings = {}) {
  if (!settings.phone || typeof settings.phone !== "object") settings.phone = {};
  const source = Array.isArray(settings.phone.credentials)
    ? settings.phone.credentials
    : Array.isArray(settings.phone.cards) ? settings.phone.cards : [];
  const seen = new Set();
  settings.phone.credentials = source.map((entry) => normalizeCredential(entry, settings)).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  settings.phone.cards = settings.phone.credentials;
  if (!settings.phone.credentialDefaults || typeof settings.phone.credentialDefaults !== "object") settings.phone.credentialDefaults = {};
  if (!Array.isArray(settings.phone.credentialDesigns)) settings.phone.credentialDesigns = [];
  for (const credential of settings.phone.credentials) syncCredentialInventory(settings, credential);
  return settings.phone.credentials;
}

export function getCredentials(settings = {}, filters = {}) {
  let credentials = ensureCredentialState(settings).slice();
  const now = Number(filters.now || Date.now());
  if (filters.category && filters.category !== "all") credentials = credentials.filter((entry) => entry.category === filters.category);
  if (filters.status && filters.status !== "all") {
    credentials = credentials.filter((entry) => filters.status === "expired"
      ? entry.status === "expired" || (entry.expiresAt !== null && entry.expiresAt < now)
      : entry.status === filters.status);
  }
  if (filters.issuerId) credentials = credentials.filter((entry) => entry.issuerId === filters.issuerId);
  if (filters.search) {
    const needle = text(filters.search).toLowerCase();
    credentials = credentials.filter((entry) => [entry.typeName, entry.holderName, entry.issuerName, entry.title, entry.credentialNumber].some((value) => text(value).toLowerCase().includes(needle)));
  }
  if (filters.locationId) credentials = credentials.filter((entry) => !entry.linkedLocationIds.length || entry.linkedLocationIds.includes(filters.locationId) || entry.permissions.some((permission) => permission.includes(filters.locationId)));
  const sort = text(filters.sort, "relevance");
  credentials.sort((a, b) => {
    if (sort === "recent") return Number(b.lastUsedAt || b.createdAt) - Number(a.lastUsedAt || a.createdAt);
    if (sort === "issuer") return a.issuerName.localeCompare(b.issuerName);
    if (sort === "type") return a.typeName.localeCompare(b.typeName);
    const locationId = text(filters.locationId);
    const relevant = (entry) => locationId && (entry.linkedLocationIds.includes(locationId) || entry.permissions.some((permission) => permission.includes(locationId))) ? 1 : 0;
    return relevant(b) - relevant(a) || Number(b.favorite) - Number(a.favorite) || Number(b.lastUsedAt || b.createdAt) - Number(a.lastUsedAt || a.createdAt);
  });
  return credentials;
}

export function upsertCredential(settings, raw, options = {}) {
  const credentials = ensureCredentialState(settings);
  const credential = normalizeCredential(raw, settings);
  const index = credentials.findIndex((entry) => entry.id === credential.id);
  if (index >= 0) credentials[index] = credential;
  else credentials.unshift(credential);
  settings.phone.cards = settings.phone.credentials;
  if (options.syncInventory !== false) syncCredentialInventory(settings, credential);
  return credential;
}

export function issueCredential(settings, detail = {}) {
  const definition = credentialDefinition(detail.type);
  const fingerprint = text(detail.issueKey || detail.linkedAccountId || detail.linkedReservationId || detail.linkedJobId);
  const credentials = ensureCredentialState(settings);
  if (fingerprint) {
    const existing = credentials.find((entry) => entry.type === definition.id && [entry.linkedAccountId, entry.linkedReservationId, entry.linkedJobId, entry.issueKey].includes(fingerprint));
    if (existing) {
      return upsertCredential(settings, {
        ...existing,
        ...detail,
        id: existing.id,
        authenticity: "issued",
        status: existing.status === "revoked" || existing.status === "confiscated" ? existing.status : text(detail.status, existing.status),
        issueKey: fingerprint,
        appearance: { ...existing.appearance, ...(detail.appearance || {}) },
        security: { ...existing.security, ...(detail.security || {}) },
        history: existing.history,
        createdAt: existing.createdAt,
        updatedAt: Date.now()
      });
    }
  }
  return upsertCredential(settings, {
    ...detail,
    id: text(detail.id, makeId("cred")),
    type: definition.id,
    category: detail.category || definition.category,
    authenticity: "issued",
    quality: 100,
    condition: 100,
    status: "active",
    issueKey: fingerprint || null,
    issuedAt: detail.issuedAt || Date.now(),
    createdAt: detail.createdAt || Date.now(),
    issuerId: detail.issuerId || "uie_system",
    issuerName: detail.issuerName || "Universal Registry"
  });
}

function permissionKey(value, fallback = "location") {
  return text(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

export function syncAutomaticCredentials(settings = {}) {
  ensureCredentialState(settings);
  const issued = [];
  const holderName = text(settings?.character?.name || settings?.phone?.bank?.username, "Account holder");
  const bank = settings?.phone?.bank;
  if (bank && (bank.loggedIn || bank.username || bank.createdAt)) {
    if (!Array.isArray(bank.accounts)) bank.accounts = [];
    let checking = bank.accounts.find((account) => account.type === "checking") || bank.accounts[0];
    if (!checking) {
      checking = {
        id: `account_checking_${permissionKey(bank.username || holderName, "player")}`,
        type: "checking",
        name: "Primary Checking",
        ownerIds: ["player"],
        balanceSource: "currency",
        status: "active",
        createdAt: bank.createdAt || Date.now()
      };
      bank.accounts.push(checking);
    }
    if (!text(checking.cardNumber)) checking.cardNumber = `4012 ${String(Date.now()).slice(-4)} ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`;
    issued.push(issueCredential(settings, {
      type: "debit_card",
      issueKey: `bank:${checking.id}:debit`,
      issuerId: "universal_bank",
      issuerName: text(bank.name, "Universal Bank"),
      holderId: "player",
      holderName,
      linkedAccountId: checking.id,
      credentialNumber: checking.cardNumber,
      title: checking.name || "Debit",
      appearance: { templateId: "modern_financial_01", theme: "charcoal_gold", accent: "#cba35c" },
      security: { chip: true, magneticStripe: true, hologram: true, signatureRequired: true, scanDifficulty: 82 }
    }));
  }

  const job = settings?.activeJob;
  if (job && typeof job === "object" && (job.id || job.title || job.employer)) {
    const employer = text(job.employer || job.company || job.location, "Employer");
    const employerKey = permissionKey(job.employerId || employer, "employer");
    issued.push(issueCredential(settings, {
      type: "employee_badge",
      issueKey: `job:${job.id || permissionKey(job.title, "active")}:badge`,
      issuerId: text(job.employerId, employerKey),
      issuerName: employer,
      holderId: "player",
      holderName,
      title: text(job.title, "Employee"),
      linkedJobId: text(job.id, `job_${permissionKey(job.title, "active")}`),
      linkedLocationIds: list(job.locationIds || job.location || employer),
      permissions: list(job.permissions).length ? list(job.permissions) : [`${employerKey}.staff_entry`, `${employerKey}.employee_area`],
      appearance: { templateId: "modern_identity_employee", theme: "security", accent: "#ef4444" },
      security: { barcodeValue: text(job.employeeNumber, `${employerKey}:${holderName}`), hologram: true, scanDifficulty: 76 }
    }));
  }

  const home = settings?.primaryHome;
  if (home && typeof home === "object" && (home.id || home.name)) {
    const homeId = text(home.id || home.name);
    const homeKey = permissionKey(homeId, "home");
    issued.push(issueCredential(settings, {
      type: "apartment_keycard",
      issueKey: `housing:${homeId}:resident_key`,
      issuerId: homeKey,
      issuerName: text(home.name, "Property Management"),
      holderId: "player",
      holderName,
      title: "Resident",
      linkedLocationIds: [homeId, home.name].filter(Boolean),
      permissions: [`${homeKey}.resident_entry`, `${homeKey}.home_entry`],
      appearance: { templateId: "modern_access_resident", theme: "residential", accent: "#22c55e" },
      security: { magneticStripe: true, scanDifficulty: 70 }
    }));
  }

  const assets = [
    ...(Array.isArray(settings?.inventory?.assets) ? settings.inventory.assets : []),
    ...(Array.isArray(settings?.assets) ? settings.assets : [])
  ];
  for (const asset of assets.filter((entry) => /vehicle|car|truck|motorcycle|ship|boat|aircraft/i.test(`${entry?.category || ""} ${entry?.type || ""} ${entry?.name || ""}`))) {
    const assetId = text(asset.id || asset.name);
    if (!assetId) continue;
    issued.push(issueCredential(settings, {
      type: resolveCredentialWorldMode(settings) === "fantasy" && /ship|boat/i.test(`${asset.category || ""} ${asset.type || ""} ${asset.name || ""}`) ? "ship_papers" : "vehicle_registration",
      issueKey: `vehicle:${assetId}:registration`,
      issuerId: resolveCredentialWorldMode(settings) === "fantasy" ? "harbor_registry" : "vehicle_registry",
      issuerName: resolveCredentialWorldMode(settings) === "fantasy" ? "Harbor Registry" : "Vehicle Registry",
      holderId: "player",
      holderName,
      title: text(asset.name, "Registered Vehicle"),
      linkedLocationIds: list(asset.location),
      permissions: [`vehicle.${permissionKey(assetId, "registered")}.operate`],
      physical: true
    }));
  }
  return issued;
}

export function setCredentialDefault(settings, purpose, credentialId) {
  ensureCredentialState(settings);
  const key = ["payment", "transit", "identity", "wallet"].includes(text(purpose)) ? text(purpose) : "wallet";
  const credential = settings.phone.credentials.find((entry) => entry.id === credentialId);
  if (!credential) return null;
  settings.phone.credentialDefaults[key] = credential.id;
  return credential;
}

export function getDefaultCredential(settings, purpose, options = {}) {
  const credentials = getCredentials(settings, { locationId: options.locationId, sort: "relevance" });
  const id = settings.phone.credentialDefaults?.[purpose];
  const target = { locationId: options.locationId || "", currentHolderId: options.currentHolderId || "player" };
  const explicit = credentials.find((entry) => entry.id === id && validateCredential(entry, target, options).accepted);
  if (explicit) return explicit;
  const allowed = purpose === "payment"
    ? ["debit_card", "credit_card", "prepaid_card", "expense_card", "joint_account_card"]
    : purpose === "transit" ? ["transit_pass", "train_ticket", "boarding_pass", "toll_card"]
      : purpose === "identity" ? credentials.filter((entry) => entry.category === "identity").map((entry) => entry.type) : [];
  return credentials.find((entry) => allowed.includes(entry.type) && validateCredential(entry, target, options).accepted) || null;
}

function result(accepted, reason, extra = {}) {
  return { accepted, reason, suspicionDelta: 0, consumed: false, triggeredAlarm: false, outcome: accepted ? "accepted" : "rejected", ...extra };
}

export function validateCredential(credential, target = {}, options = {}) {
  const now = Number(options.now || Date.now());
  if (!credential) return result(false, "credential_missing");
  if (credential.status !== "active") return result(false, credential.status === "frozen" ? "credential_frozen" : `credential_${credential.status}`);
  if (credential.validFrom && credential.validFrom > now) return result(false, "not_yet_valid");
  if (credential.expiresAt !== null && credential.expiresAt <= now) return result(false, "credential_expired");
  const holderId = text(target.currentHolderId || options.currentHolderId || options.holderId);
  if (holderId && credential.holderId && credential.holderId !== holderId) return result(false, "holder_mismatch", { suspicionDelta: credential.authenticity === "forged" ? 12 : 5, outcome: "manual_inspection" });
  if (target.linkedAccountId && credential.linkedAccountId !== target.linkedAccountId) return result(false, "account_mismatch");
  if (target.linkedReservationId && credential.linkedReservationId !== target.linkedReservationId) return result(false, "reservation_mismatch");
  const permission = text(target.requiredPermission);
  if (permission && !credential.permissions.includes(permission) && !credential.permissions.includes("*")) return result(false, "clearance_too_low", { suspicionDelta: credential.authenticity === "forged" ? 8 : 0 });
  const locationId = text(target.locationId);
  if (locationId && credential.linkedLocationIds.length && !credential.linkedLocationIds.includes(locationId)) return result(false, "wrong_location");
  if (credential.restrictions.some((restriction) => restriction === text(target.action) || restriction === locationId)) return result(false, "restricted_use");
  return result(true, "valid");
}

export function inspectCredential(credential, target = {}, options = {}) {
  const structural = validateCredential(credential, target, options);
  const scannerStrength = clamp(target.scannerStrength ?? 50);
  const issuerMatched = credential?.authenticity === "issued" || (credential?.quality || 0) >= scannerStrength + 20;
  const holderMatched = structural.reason !== "holder_mismatch";
  const tamperingScore = credential?.authenticity === "forged" ? clamp(100 - credential.quality + scannerStrength / 3) : Math.max(0, 100 - Number(credential?.condition || 100));
  const base = clamp((credential?.quality || 0) * 0.55 + (credential?.security?.scanDifficulty || 0) * 0.35 + (credential?.condition || 0) * 0.1 - scannerStrength * 0.3);
  const low = clamp(base - 12);
  const high = clamp(base + 12);
  const band = high >= 85 ? "very likely" : high >= 65 ? "likely" : high >= 40 ? "uncertain" : "unlikely";
  return {
    credentialId: credential?.id || null,
    visual: credential?.condition >= 70 ? "clean" : credential?.condition >= 40 ? "worn" : "damaged",
    barcode: credential?.security?.barcodeValue ? "readable" : "missing",
    issuerDatabase: issuerMatched ? "match" : "no_match",
    holderMatch: holderMatched,
    expiration: credential?.expiresAt === null ? "no_expiration" : credential.expiresAt > Number(options.now || Date.now()) ? "valid" : "expired",
    clearance: structural.reason === "clearance_too_low" ? "insufficient" : structural.accepted ? "valid" : "not_checked",
    tampering: tamperingScore >= 55 ? "likely" : tamperingScore >= 25 ? "possible" : "none_detected",
    estimate: { band, range: [low, high] },
    locations: credential?.linkedLocationIds || [],
    permissions: credential?.permissions || [],
    structural
  };
}

export function useCredential(settings, credentialId, target = {}, options = {}) {
  const credential = ensureCredentialState(settings).find((entry) => entry.id === credentialId);
  let verification = validateCredential(credential, target, options);
  if (!credential) return verification;
  if (verification.accepted && credential.authenticity === "forged" && options.skipRisk !== true) {
    const scannerStrength = clamp(target.scannerStrength ?? 50);
    const resistance = clamp(credential.quality * 0.6 + credential.security.scanDifficulty * 0.4 - scannerStrength * 0.35);
    const roll = Number.isFinite(Number(options.roll)) ? Number(options.roll) : Math.random() * 100;
    if (roll > resistance) {
      const severe = roll - resistance > 28;
      verification = result(false, severe ? "forgery_detected" : "manual_inspection", {
        suspicionDelta: severe ? 18 : 8,
        triggeredAlarm: severe && scannerStrength >= 75,
        outcome: severe ? (scannerStrength >= 75 ? "alarm_triggered" : "confiscated") : "manual_inspection",
        confiscated: severe
      });
      if (severe) credential.status = scannerStrength >= 75 ? "revoked" : "confiscated";
    } else if (roll > resistance - 12) {
      verification = result(true, "accepted_logged", { suspicionDelta: 3, outcome: "accepted_logged" });
    }
  }
  const now = Date.now();
  credential.lastUsedAt = now;
  credential.lastUsedLocationId = text(target.locationId) || null;
  credential.updatedAt = now;
  credential.history.push({
    id: makeId("hist"),
    action: text(target.action, "use"),
    targetId: text(target.id || target.locationId),
    result: verification.outcome,
    reason: verification.reason,
    t: now
  });
  credential.history = credential.history.slice(-100);
  if (target.consumeOnUse && verification.accepted) verification.consumed = true;
  if (verification.consumed) credential.status = "revoked";
  syncCredentialInventory(settings, credential);
  return { ...verification, credentialId: credential.id };
}

export function revokeCredential(settings, credentialId, reason = "revoked_by_holder") {
  const credential = ensureCredentialState(settings).find((entry) => entry.id === credentialId);
  if (!credential) return null;
  credential.status = "revoked";
  credential.updatedAt = Date.now();
  credential.history.push({ id: makeId("hist"), action: "revoke", reason: text(reason), result: "revoked", t: Date.now() });
  syncCredentialInventory(settings, credential);
  return credential;
}

export function destroyCredential(settings, credentialId) {
  const credentials = ensureCredentialState(settings);
  const index = credentials.findIndex((entry) => entry.id === credentialId);
  if (index < 0) return false;
  credentials.splice(index, 1);
  Object.keys(settings.phone.credentialDefaults || {}).forEach((key) => {
    if (settings.phone.credentialDefaults[key] === credentialId) delete settings.phone.credentialDefaults[key];
  });
  removeCredentialInventory(settings, credentialId);
  settings.phone.cards = settings.phone.credentials;
  return true;
}

export function copyCredential(settings, credentialId) {
  const source = ensureCredentialState(settings).find((entry) => entry.id === credentialId);
  if (!source) return null;
  return upsertCredential(settings, {
    ...source,
    id: makeId("cred"),
    authenticity: "forged",
    quality: Math.min(95, Math.max(20, Number(source.quality || 80) - 12)),
    status: "active",
    credentialNumber: `${source.credentialNumber}-COPY`,
    appearance: { ...source.appearance },
    security: { ...source.security, scanDifficulty: Math.max(10, Number(source.security.scanDifficulty || 45) - 10) },
    history: [{ id: makeId("hist"), action: "copied", sourceCredentialId: source.id, result: "created", t: Date.now() }],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

export function installCredentialEventBridge({ getSettings, saveSettings, onChange } = {}) {
  if (typeof window === "undefined" || typeof getSettings !== "function" || window.__uieCredentialBridgeInstalled) return;
  window.__uieCredentialBridgeInstalled = true;
  const persist = (settings, credential, eventName) => {
    if (typeof saveSettings === "function") saveSettings();
    if (typeof onChange === "function") onChange(credential, eventName);
    try { window.dispatchEvent(new CustomEvent("uie:credentials-changed", { detail: { credential, eventName } })); } catch (_) {}
  };
  window.addEventListener("uie:credential-issued", (event) => {
    const settings = getSettings();
    const credential = issueCredential(settings, event.detail || {});
    persist(settings, credential, "issued");
  });
  const issuanceAdapters = {
    "uie:bank-account-created": (detail) => ({ type: "debit_card", issuerId: detail.bankId || detail.issuerId, issuerName: detail.bankName || detail.issuerName, linkedAccountId: detail.accountId, issueKey: `bank:${detail.accountId}:debit` }),
    "uie:job-started": (detail) => ({ type: "employee_badge", issuerId: detail.employerId, issuerName: detail.employerName || detail.employer, title: detail.title, linkedJobId: detail.jobId || detail.id, linkedLocationIds: detail.locationIds || detail.location, permissions: detail.permissions, issueKey: `job:${detail.jobId || detail.id}:badge` }),
    "uie:hotel-reserved": (detail) => ({ type: "hotel_key", issuerId: detail.hotelId, issuerName: detail.hotelName, title: detail.roomNumber ? `Room ${detail.roomNumber}` : "Guest", linkedReservationId: detail.reservationId || detail.id, linkedLocationIds: [detail.hotelId, detail.hotelName].filter(Boolean), permissions: detail.permissions || (detail.roomNumber ? [`hotel.room.${detail.roomNumber}`] : []), expiresAt: detail.checkOutAt || detail.expiresAt, issueKey: `hotel:${detail.reservationId || detail.id}:key` }),
    "uie:transit-pass-purchased": (detail) => ({ type: detail.type || "transit_pass", issuerId: detail.issuerId || detail.networkId, issuerName: detail.issuerName || detail.networkName, permissions: detail.permissions || ["transit.board"], expiresAt: detail.expiresAt, issueKey: `transit:${detail.passId || detail.purchaseId || detail.id}` }),
    "uie:school-enrolled": (detail) => ({ type: "student_id", issuerId: detail.schoolId, issuerName: detail.schoolName, title: detail.program || detail.major || "Student", permissions: detail.permissions || [`${permissionKey(detail.schoolId, "school")}.student_entry`], linkedLocationIds: detail.locationIds || [detail.schoolId, detail.schoolName].filter(Boolean), issueKey: `school:${detail.schoolId}:student_id` }),
    "uie:vehicle-registered": (detail) => ({ type: detail.type || "vehicle_registration", issuerId: detail.issuerId || "vehicle_registry", issuerName: detail.issuerName || "Vehicle Registry", title: detail.vehicleName, permissions: detail.permissions || [`vehicle.${permissionKey(detail.vehicleId || detail.vehicleName, "registered")}.operate`], issueKey: `vehicle:${detail.vehicleId || detail.id}:registration` })
  };
  Object.entries(issuanceAdapters).forEach(([eventName, adapter]) => {
    window.addEventListener(eventName, (event) => {
      const settings = getSettings();
      const detail = event.detail || {};
      const credential = issueCredential(settings, { ...detail, ...adapter(detail), holderId: detail.holderId || "player", holderName: detail.holderName || settings?.character?.name });
      persist(settings, credential, "issued");
    });
  });
  window.addEventListener("uie:credential-revoke", (event) => {
    const settings = getSettings();
    const credential = revokeCredential(settings, event.detail?.credentialId || event.detail?.id, event.detail?.reason);
    persist(settings, credential, "revoked");
  });
  window.addEventListener("uie:credential-use", (event) => {
    const settings = getSettings();
    const resultValue = useCredential(settings, event.detail?.credentialId || event.detail?.id, event.detail?.target || event.detail || {});
    if (typeof saveSettings === "function") saveSettings();
    try { window.dispatchEvent(new CustomEvent("uie:credential-result", { detail: { requestId: event.detail?.requestId || null, ...resultValue } })); } catch (_) {}
  });
  window.addEventListener("uie:credential-scan", (event) => {
    const settings = getSettings();
    const credential = ensureCredentialState(settings).find((entry) => entry.id === (event.detail?.credentialId || event.detail?.id));
    const scan = inspectCredential(credential, event.detail?.target || event.detail || {});
    try { window.dispatchEvent(new CustomEvent("uie:credential-scan-result", { detail: { requestId: event.detail?.requestId || null, ...scan } })); } catch (_) {}
  });
}
