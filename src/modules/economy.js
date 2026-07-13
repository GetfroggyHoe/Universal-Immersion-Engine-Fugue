export const CURRENCY_PRESETS = Object.freeze([
  { code: "CUSTOM", name: "Custom", symbol: "G", rate: 0 },
  { code: "USD", name: "US Dollar", symbol: "$", rate: 1 },
  { code: "EUR", name: "Euro", symbol: "€", rate: 1.08 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", rate: 1.27 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", rate: 0.0067 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", rate: 0.14 },
  { code: "KRW", name: "Korean Won", symbol: "₩", rate: 0.00073 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", rate: 0.012 },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", rate: 0.73 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", rate: 0.65 },
  { code: "CREDIT", name: "Credits", symbol: "CR", rate: 1 },
  { code: "GOLD", name: "Gold", symbol: "G", rate: 10 }
]);

export const LOAN_TIERS = Object.freeze([
  { id: "starter", name: "Starter Credit", principal: 100, interestRate: 0.08, minScore: 0, termDays: 30 },
  { id: "personal", name: "Personal Loan", principal: 500, interestRate: 0.12, minScore: 120, termDays: 60 },
  { id: "business", name: "Business Credit", principal: 2000, interestRate: 0.18, minScore: 320, termDays: 90 },
  { id: "elite", name: "Elite Line", principal: 10000, interestRate: 0.06, minScore: 700, termDays: 120 }
]);

const TRANSIT_FARES = Object.freeze({
  train: 8,
  airport: 45,
  bus: 3,
  subway: 4,
  ferry: 7,
  tram: 4,
  taxi: 12,
  transit: 5
});

function cleanText(v, fallback = "") {
  const out = String(v ?? "").trim();
  return out || fallback;
}

function clampMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function presetByCode(code) {
  const key = cleanText(code, "CUSTOM").toUpperCase();
  return CURRENCY_PRESETS.find((p) => p.code === key) || CURRENCY_PRESETS[0];
}

function inferStartingCreditScore(s) {
  const wealth = Number(s?.currency || 0) || 0;
  const knownRich = s?.character?.knownRich === true || s?.character?.wealthTier === "rich" || s?.knownRich === true;
  if (knownRich || wealth >= 10000) return 720;
  if (wealth >= 2500) return 420;
  return 0;
}

function calculateCreditScore(bank) {
  const history = Array.isArray(bank?.loanHistory) ? bank.loanHistory : [];
  let score = Number(bank?.creditScore || 0) || 0;
  for (const item of history.slice(-80)) {
    if (item.type === "loan_opened") score += 8;
    if (item.type === "payment") score += Number(item.onTime) === 1 ? 18 : 8;
    if (item.type === "loan_paid") score += 42;
    if (item.type === "missed_payment") score -= 55;
    if (item.type === "default") score -= 140;
  }
  return Math.max(0, Math.min(850, Math.round(score)));
}

function syncCurrencyItem(s) {
  if (!s || typeof s !== "object") return null;
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  const amount = clampMoney(s.currency);
  s.currency = amount;
  s.inventory.currency = amount;
  const sym = cleanText(s.currencySymbol, "G");
  const name = cleanText(s.currencyName, sym === "G" ? "Gold" : `${sym} Currency`);
  let curItem = s.inventory.items.find((it) => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
  if (!curItem) curItem = s.inventory.items.find((it) => String(it?.type || "").toLowerCase() === "currency");
  if (!curItem) {
    curItem = { kind: "item", name, type: "currency", symbol: sym, code: cleanText(s.currencyCode, "CUSTOM"), description: `Currency item for ${name}.`, rarity: "common", qty: amount, mods: {}, statusEffects: [] };
    s.inventory.items.push(curItem);
  } else {
    curItem.symbol = sym;
    curItem.code = cleanText(s.currencyCode, "CUSTOM");
    curItem.qty = amount;
    if (!cleanText(curItem.name) || String(curItem.name || "").includes("Currency") || String(curItem.name || "") === `${sym} Currency`) curItem.name = name;
  }
  return curItem;
}

export function ensureEconomyState(s) {
  if (!s || typeof s !== "object") return s;
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Number.isFinite(Number(s.currency))) s.currency = Number.isFinite(Number(s.inventory.currency)) ? Number(s.inventory.currency) : 0;
  s.currency = clampMoney(s.currency);
  if (!cleanText(s.currencyCode)) s.currencyCode = "CUSTOM";
  if (!cleanText(s.currencySymbol)) s.currencySymbol = presetByCode(s.currencyCode).symbol || "G";
  if (!cleanText(s.currencyName)) s.currencyName = presetByCode(s.currencyCode).name || "Gold";
  if (!Number.isFinite(Number(s.currencyRate))) s.currencyRate = 0;
  if (!s.phone || typeof s.phone !== "object") s.phone = {};
  if (!s.phone.bank || typeof s.phone.bank !== "object") s.phone.bank = {};
  if (!Number.isFinite(Number(s.phone.bank.savings))) s.phone.bank.savings = 0;
  s.phone.bank.savings = clampMoney(s.phone.bank.savings);
  if (!Array.isArray(s.phone.bank.history)) s.phone.bank.history = [];
  if (!Array.isArray(s.phone.bank.loans)) s.phone.bank.loans = [];
  if (!Array.isArray(s.phone.bank.loanHistory)) s.phone.bank.loanHistory = [];
  if (!Number.isFinite(Number(s.phone.bank.creditScore))) s.phone.bank.creditScore = inferStartingCreditScore(s);
  s.phone.bank.creditScore = calculateCreditScore(s.phone.bank);
  if (!s.phone.travel || typeof s.phone.travel !== "object") s.phone.travel = {};
  if (!Array.isArray(s.phone.travel.history)) s.phone.travel.history = [];
  syncCurrencyItem(s);
  return s;
}

export function applyCurrencySettings(s, { code, name, symbol, rate } = {}) {
  ensureEconomyState(s);
  const preset = presetByCode(code);
  const finalCode = cleanText(code, "CUSTOM").toUpperCase();
  s.currencyCode = finalCode;
  s.currencyName = cleanText(name, finalCode === "CUSTOM" ? cleanText(s.currencyName, "Currency") : preset.name).slice(0, 60);
  s.currencySymbol = cleanText(symbol, preset.symbol || "G").slice(0, 8);
  const nextRate = Number(rate);
  s.currencyRate = Number.isFinite(nextRate) ? Math.max(0, nextRate) : 0;
  syncCurrencyItem(s);
  return s;
}

export function getCurrencyPreset(code) {
  return presetByCode(code);
}

export function formatCurrency(amount, s, opts = {}) {
  const st = ensureEconomyState(s || {});
  const n = clampMoney(amount);
  const sym = cleanText(st.currencySymbol, "G");
  const prefix = /^[\$€£¥₹₩₽₺₦]$/.test(sym) || /\$$/.test(sym);
  const base = prefix ? `${sym}${n.toLocaleString()}` : `${n.toLocaleString()} ${sym}`;
  if (opts.exchange !== true) return base;
  const rate = Number(st.currencyRate || 0);
  if (!Number.isFinite(rate) || rate <= 0 || sym === "$") return base;
  return `${base} ($${(n * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })})`;
}

export function addCurrency(s, amount) {
  ensureEconomyState(s);
  const amt = clampMoney(amount);
  if (!amt) return false;
  s.currency = clampMoney(Number(s.currency || 0) + amt);
  syncCurrencyItem(s);
  return true;
}

export function spendCurrency(s, amount) {
  ensureEconomyState(s);
  const amt = clampMoney(amount);
  if (!amt) return true;
  if (Number(s.currency || 0) < amt) return false;
  s.currency = clampMoney(Number(s.currency || 0) - amt);
  syncCurrencyItem(s);
  return true;
}

export function openLoan(s, tierId) {
  ensureEconomyState(s);
  const tier = LOAN_TIERS.find((t) => t.id === tierId) || LOAN_TIERS[0];
  if (Number(s.phone.bank.creditScore || 0) < Number(tier.minScore || 0)) return { ok: false, reason: "credit_score", tier };
  const principal = clampMoney(tier.principal);
  const interest = clampMoney(principal * Number(tier.interestRate || 0));
  const loan = {
    id: `loan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    tierId: tier.id,
    name: tier.name,
    principal,
    interestRate: tier.interestRate,
    balance: principal + interest,
    openedAt: Date.now(),
    dueAt: Date.now() + Math.max(1, Number(tier.termDays || 30)) * 86400000,
    status: "open"
  };
  s.phone.bank.loans.unshift(loan);
  s.phone.bank.loanHistory.push({ type: "loan_opened", loanId: loan.id, amount: loan.balance, t: Date.now(), onTime: 1 });
  addCurrency(s, principal);
  s.phone.bank.creditScore = calculateCreditScore(s.phone.bank);
  return { ok: true, loan };
}

export function payLoan(s, loanId, amount) {
  ensureEconomyState(s);
  const loan = s.phone.bank.loans.find((l) => String(l.id) === String(loanId) && l.status === "open");
  if (!loan) return { ok: false, reason: "missing_loan" };
  const amt = Math.min(clampMoney(amount), clampMoney(loan.balance));
  if (!amt) return { ok: false, reason: "invalid_amount" };
  if (!spendCurrency(s, amt)) return { ok: false, reason: "insufficient_funds" };
  loan.balance = clampMoney(Number(loan.balance || 0) - amt);
  const paidOff = loan.balance <= 0;
  if (paidOff) {
    loan.balance = 0;
    loan.status = "paid";
    loan.closedAt = Date.now();
  }
  s.phone.bank.loanHistory.push({ type: paidOff ? "loan_paid" : "payment", loanId: loan.id, amount: amt, t: Date.now(), onTime: Date.now() <= Number(loan.dueAt || Date.now()) ? 1 : 0 });
  s.phone.bank.creditScore = calculateCreditScore(s.phone.bank);
  syncCurrencyItem(s);
  return { ok: true, loan, paidOff };
}

export function inferTransitMode(value) {
  const t = cleanText(value).toLowerCase();
  if (/(airport|plane|flight|airline)/.test(t)) return "airport";
  if (/(bus|coach)/.test(t)) return "bus";
  if (/(train|rail|railway)/.test(t)) return "train";
  if (/(subway|metro|underground)/.test(t)) return "subway";
  if (/(ferry|dock|harbor|boat)/.test(t)) return "ferry";
  if (/(tram|streetcar)/.test(t)) return "tram";
  if (/(taxi|cab|rideshare)/.test(t)) return "taxi";
  return "";
}

export function getTransitFare(mode, s) {
  ensureEconomyState(s);
  const key = cleanText(mode, "transit").toLowerCase();
  const fareTable = s?.phone?.travel?.fares && typeof s.phone.travel.fares === "object" ? s.phone.travel.fares : null;
  const raw = fareTable && Number.isFinite(Number(fareTable[key])) ? Number(fareTable[key]) : TRANSIT_FARES[key] ?? TRANSIT_FARES.transit;
  return clampMoney(raw);
}

export function payTransitFare(s, { mode = "transit", destination = "destination", fare = null } = {}) {
  ensureEconomyState(s);
  const actualFare = fare === null || fare === undefined ? getTransitFare(mode, s) : clampMoney(fare);
  const actualMode = cleanText(mode, "transit");
  const actualDestination = cleanText(destination, "destination").slice(0, 120);
  if (!spendCurrency(s, actualFare)) return { ok: false, fare: actualFare, reason: "insufficient_funds" };
  s.phone.travel.history.unshift({ id: Date.now(), mode: actualMode, destination: actualDestination, fare: actualFare, t: Date.now() });
  s.phone.travel.history = s.phone.travel.history.slice(0, 60);
  return { ok: true, fare: actualFare, mode: actualMode, destination: actualDestination };
}

export function ensureProgressionState(s) {
  if (!s || typeof s !== "object") return s;
  if (!s.character || typeof s.character !== "object") s.character = {};
  if (!s.character.progression || typeof s.character.progression !== "object") s.character.progression = {};
  if (!Number.isFinite(Number(s.character.level))) s.character.level = 1;
  if (!Number.isFinite(Number(s.xp))) s.xp = 0;
  if (!Number.isFinite(Number(s.maxXp)) || Number(s.maxXp) <= 0) s.maxXp = 100;
  if (!Number.isFinite(Number(s.character.skillPoints))) s.character.skillPoints = Number(s.character.progression.skillPoints || 0) || 0;
  s.character.level = Math.max(1, Math.floor(Number(s.character.level || 1)));
  s.xp = Math.max(0, Number(s.xp || 0));
  s.maxXp = Math.max(1, Math.floor(Number(s.maxXp || 100)));
  s.character.progression.level = s.character.level;
  s.character.progression.xp = s.xp;
  s.character.progression.skillPoints = Math.max(0, Math.floor(Number(s.character.skillPoints || 0)));
  return s;
}

export function grantXp(s, amount, source = "activity") {
  ensureProgressionState(s);
  const gain = Math.max(0, Math.round(Number(amount || 0)));
  if (!gain) return { gained: 0, levels: 0 };
  s.xp += gain;
  let levels = 0;
  while (s.xp >= s.maxXp && levels < 100) {
    s.xp -= s.maxXp;
    s.character.level = Math.max(1, Number(s.character.level || 1) + 1);
    s.maxXp = Math.max(10, Math.round(Number(s.maxXp || 100) * 1.18));
    s.character.skillPoints = Math.max(0, Number(s.character.skillPoints || 0) + 1);
    levels++;
  }
  s.character.progression.level = s.character.level;
  s.character.progression.xp = s.xp;
  s.character.progression.maxXp = s.maxXp;
  s.character.progression.skillPoints = s.character.skillPoints;
  if (!Array.isArray(s.character.xpLog)) s.character.xpLog = [];
  s.character.xpLog.unshift({ amount: gain, source: cleanText(source, "activity").slice(0, 80), t: Date.now(), levels });
  s.character.xpLog = s.character.xpLog.slice(0, 80);
  return { gained: gain, levels };
}
