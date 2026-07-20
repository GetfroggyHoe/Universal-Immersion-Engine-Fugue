import assert from "node:assert/strict";
import {
  copyCredential,
  destroyCredential,
  ensureCredentialState,
  getDefaultCredential,
  inspectCredential,
  inventoryCategoryForCredential,
  issueCredential,
  setCredentialDefault,
  syncAutomaticCredentials,
  upsertCredential,
  useCredential,
  validateCredential
} from "../src/modules/credentialSystem.js";

const settings = {
  character: { name: "Chai" },
  world: { gameMode: "modern" },
  phone: {
    cards: [{
      id: "legacy-bank-card",
      type: "bank_card",
      name: "Chai",
      cardNumber: "4012 8888 8888 1881",
      expiry: "12/29",
      image: "data:image/png;base64,rendered-front"
    }]
  },
  inventory: { items: [] }
};

const migrated = ensureCredentialState(settings);
assert.equal(migrated.length, 1);
assert.equal(migrated[0].schemaVersion, 2);
assert.equal(migrated[0].type, "debit_card");
assert.equal(migrated[0].appearance.frontImage, "data:image/png;base64,rendered-front");
assert.equal(migrated[0].appearance.portraitImage, "");
assert.equal(inventoryCategoryForCredential(migrated[0]), "Financial");
assert.equal(settings.inventory.items[0].category, "Financial");

settings.phone.bank = { username: "Chai", loggedIn: true, createdAt: Date.now() };
settings.activeJob = { id: "job_crimson_den", title: "Table Supervisor", employer: "The Crimson Den", location: "crimson_den" };
settings.primaryHome = { id: "home_12", name: "Juniper Court" };
const automatic = syncAutomaticCredentials(settings);
assert.equal(automatic.length, 3);
assert.equal(settings.phone.bank.accounts.length, 1);
assert.ok(settings.phone.credentials.some((entry) => entry.type === "employee_badge" && entry.linkedJobId === "job_crimson_den"));
assert.ok(settings.phone.credentials.some((entry) => entry.type === "apartment_keycard" && entry.permissions.includes("home_12.resident_entry")));
const automaticCount = settings.phone.credentials.length;
syncAutomaticCredentials(settings);
assert.equal(settings.phone.credentials.length, automaticCount, "automatic issuance should not duplicate credentials");

const accountCard = issueCredential(settings, {
  type: "debit_card",
  issuerId: "universal_bank",
  issuerName: "Universal Bank",
  holderId: "player",
  holderName: "Chai",
  linkedAccountId: "checking-main",
  issueKey: "debit:checking-main"
});
assert.equal(issueCredential(settings, {
  type: "debit_card",
  linkedAccountId: "checking-main",
  issueKey: "debit:checking-main"
}).id, accountCard.id, "issued credentials should deduplicate by issue key");

setCredentialDefault(settings, "payment", accountCard.id);
assert.equal(getDefaultCredential(settings, "payment")?.id, accountCard.id);
assert.equal(validateCredential(accountCard, { linkedAccountId: "checking-main", currentHolderId: "player" }).accepted, true);
assert.equal(validateCredential(accountCard, { linkedAccountId: "business", currentHolderId: "player" }).reason, "account_mismatch");

const badge = upsertCredential(settings, {
  id: "staff-badge",
  type: "employee_badge",
  authenticity: "issued",
  holderId: "player",
  holderName: "Chai",
  issuerId: "crimson_den",
  issuerName: "The Crimson Den",
  permissions: ["crimson_den.staff_entry"],
  linkedLocationIds: ["crimson_den"]
});
assert.equal(validateCredential(badge, {
  currentHolderId: "player",
  locationId: "crimson_den",
  requiredPermission: "crimson_den.staff_entry"
}).accepted, true);
assert.equal(validateCredential(badge, { requiredPermission: "crimson_den.vault" }).reason, "clearance_too_low");

const expired = upsertCredential(settings, {
  id: "expired-pass",
  type: "transit_pass",
  authenticity: "issued",
  expiresAt: Date.now() - 1000
});
assert.equal(validateCredential(expired).reason, "credential_expired");

const forged = upsertCredential(settings, {
  id: "forged-badge",
  type: "employee_badge",
  authenticity: "forged",
  quality: 20,
  permissions: ["lab.staff_entry"],
  security: { scanDifficulty: 10 }
});
const failedUse = useCredential(settings, forged.id, {
  locationId: "lab",
  requiredPermission: "lab.staff_entry",
  scannerStrength: 90
}, { roll: 99 });
assert.equal(failedUse.accepted, false);
assert.equal(failedUse.triggeredAlarm, true);
assert.ok(failedUse.suspicionDelta > 0);
assert.equal(settings.phone.credentials.find((entry) => entry.id === forged.id)?.status, "revoked");

const scan = inspectCredential(badge, { requiredPermission: "crimson_den.staff_entry", scannerStrength: 60 });
assert.equal(scan.issuerDatabase, "match");
assert.equal(scan.clearance, "valid");
assert.equal(typeof scan.estimate.band, "string");
assert.equal(scan.estimate.range.length, 2);

const copied = copyCredential(settings, badge.id);
assert.equal(copied.authenticity, "forged");
assert.notEqual(copied.id, badge.id);
assert.equal(destroyCredential(settings, copied.id), true);
assert.equal(settings.phone.credentials.some((entry) => entry.id === copied.id), false);

console.log("credential-system: ok");
