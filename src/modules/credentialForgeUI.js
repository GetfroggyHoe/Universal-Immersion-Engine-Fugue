import {
  CREDENTIAL_TYPES,
  copyCredential,
  destroyCredential,
  ensureCredentialState,
  getCredentials,
  inspectCredential,
  installCredentialEventBridge,
  resolveCredentialWorldMode,
  revokeCredential,
  setCredentialDefault,
  syncAutomaticCredentials,
  syncAutomaticCredentials,
  upsertCredential,
  useCredential
} from "./credentialSystem.js";

const CUSTOM_TYPES = new Set(["business_card", "contact_card", "club_card", "event_badge", "gift_card", "loyalty_card", "fantasy_document"]);
const PURPOSE_LABELS = { wallet: "Wallet", payment: "Payment", transit: "Transit", identity: "Identity" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function csv(value) {
  return String(value || "").split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);
}

function dateInput(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function sceneLocation(settings) {
  return String(settings?.worldState?.currentLocation || settings?.worldState?.location || settings?.world?.currentLocationId || "current_scene").trim();
}

function statusFor(credential) {
  if (credential.expiresAt && credential.expiresAt <= Date.now() && credential.status === "active") return "expired";
  return credential.status || "active";
}

function short(value, limit = 30) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}...` : text;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function drawCover(ctx, image, x, y, width, height, px = 0.5, py = 0.5) {
  const scale = Math.max(width / image.width, height / image.height);
  const sw = width / scale;
  const sh = height / scale;
  const sx = Math.max(0, Math.min(image.width - sw, (image.width - sw) * px));
  const sy = Math.max(0, Math.min(image.height - sh, (image.height - sh) * py));
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function initCredentialForgeUI(options = {}) {
  const root = options.root || document;
  const $root = window.jQuery ? window.jQuery(root) : null;
  if (!$root || !$root.find("#uie-app-cardforge-view").length) return { render() {}, open() {} };
  if (root.__uieCredentialForgeUI) return root.__uieCredentialForgeUI;

  const state = {
    tab: "wallet",
    createPath: "custom",
    selectedId: null,
    side: "front",
    createSide: "front",
    portraitImage: "",
    emblemImage: "",
    editingId: null,
    actionId: null,
    scanResult: null
  };
  const getSettings = options.getSettings;
  const saveSettings = options.saveSettings || (() => {});
  const notify = options.notify || (() => {});
  const onRpEvent = options.onRpEvent || (() => {});
  const confirmAction = options.confirmAction || ((message) => Promise.resolve(window.confirm(message)));

  function persist(eventName, credential = null) {
    saveSettings();
    try { window.renderInventory?.(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("uie:credentials-changed", { detail: { eventName, credential } })); } catch (_) {}
  }

  function credentials(filters = {}) {
    const settings = getSettings();
    return getCredentials(settings, { ...filters, locationId: filters.locationId === false ? "" : sceneLocation(settings) });
  }

  function selectedCredential() {
    const all = ensureCredentialState(getSettings());
    return all.find((item) => item.id === state.selectedId) || all[0] || null;
  }

  function syncIssuedCredentials() {
    const issued = syncAutomaticCredentials(getSettings());
    if (issued.length) saveSettings();
    return issued;
  }

  function renderHeader() {
    const fantasy = resolveCredentialWorldMode(getSettings()) === "fantasy";
    $root.find("#cf-view-title").text(fantasy ? "Credential Forge" : "Card Forge");
    $root.find("#app-cardforge").attr("title", fantasy ? "Credential Forge" : "Card Forge");
  }

  function renderTabs() {
    $root.find(".cf-tab").removeClass("is-active").attr("aria-selected", "false");
    $root.find(`.cf-tab[data-cf-tab="${state.tab}"]`).addClass("is-active").attr("aria-selected", "true");
    $root.find(".cf-panel").removeClass("is-active");
    $root.find(`#cf-${state.tab}-panel`).addClass("is-active");
  }

  function renderWallet() {
    const settings = getSettings();
    const filters = {
      search: $root.find("#cf-wallet-search").val() || "",
      category: $root.find("#cf-wallet-category").val() || "all",
      status: $root.find("#cf-wallet-status").val() || "all",
      sort: $root.find("#cf-wallet-sort").val() || "relevance"
    };
    const list = credentials(filters);
    if (!list.some((item) => item.id === state.selectedId)) state.selectedId = list[0]?.id || null;
    const credential = list.find((item) => item.id === state.selectedId) || null;
    const $stage = $root.find("#cf-wallet-stage");
    const $list = $root.find("#cf-wallet-list").empty();
    if (!credential) {
      $stage.html(`<div class="cf-empty"><i class="fa-regular fa-id-card"></i><strong>No credentials found</strong><span>Change filters or create a personal credential.</span><button type="button" class="cf-command" data-cf-tab="create"><i class="fa-solid fa-plus"></i> Create</button></div>`);
      return;
    }
    const defaults = settings.phone.credentialDefaults || {};
    const badges = Object.entries(defaults).filter(([, id]) => id === credential.id).map(([purpose]) => `<span class="cf-badge default">${esc(PURPOSE_LABELS[purpose] || purpose)}</span>`).join("");
    const status = statusFor(credential);
    const relevant = credential.linkedLocationIds.includes(sceneLocation(settings)) || credential.permissions.some((permission) => permission.includes(sceneLocation(settings)));
    $stage.html(`
      <div class="cf-stack-nav">
        <button type="button" class="cf-icon" id="cf-prev" title="Previous credential"><i class="fa-solid fa-chevron-left"></i></button>
        <span>${list.indexOf(credential) + 1} / ${list.length}</span>
        <button type="button" class="cf-icon" id="cf-next" title="Next credential"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <button type="button" class="cf-card-object ${esc(credential.format)}" id="cf-wallet-card" title="Flip credential">
        ${state.side === "front" && credential.appearance.frontImage ? `<img src="${esc(credential.appearance.frontImage)}" alt="${esc(credential.typeName)} front">` : state.side === "back" && credential.appearance.backImage ? `<img src="${esc(credential.appearance.backImage)}" alt="${esc(credential.typeName)} back">` : `<canvas id="cf-wallet-canvas" width="340" height="210"></canvas>`}
        <span class="cf-flip-mark"><i class="fa-solid fa-rotate"></i> ${state.side}</span>
      </button>
      <div class="cf-badge-row"><span class="cf-badge ${esc(status)}">${esc(status)}</span><span class="cf-badge ${esc(credential.authenticity)}">${esc(credential.authenticity)}</span>${relevant ? '<span class="cf-badge relevant">usable here</span>' : ""}${badges}</div>
      <div class="cf-credential-heading"><div><strong>${esc(credential.typeName)}</strong><span>${esc(credential.issuerName)}</span></div><button type="button" class="cf-icon cf-favorite ${credential.favorite ? "is-active" : ""}" title="Favorite"><i class="fa-${credential.favorite ? "solid" : "regular"} fa-star"></i></button></div>
      <dl class="cf-meta"><div><dt>Holder</dt><dd>${esc(credential.holderName)}</dd></div><div><dt>Number</dt><dd>${esc(credential.credentialNumber)}</dd></div><div><dt>Title</dt><dd>${esc(credential.title || "None")}</dd></div><div><dt>Expires</dt><dd>${credential.expiresAt ? esc(new Date(credential.expiresAt).toLocaleDateString()) : "Never"}</dd></div></dl>
      ${credential.linkedAccountId ? `<div class="cf-linked"><i class="fa-solid fa-building-columns"></i><span>${esc(credential.linkedAccountId)}</span><strong>${Number.isFinite(Number(settings.currency)) ? esc(String(settings.currency)) : "Linked"}</strong></div>` : ""}
      ${credential.linkedLocationIds.length ? `<div class="cf-linked"><i class="fa-solid fa-location-dot"></i><span>${esc(credential.linkedLocationIds.join(", "))}</span></div>` : ""}
      <div class="cf-primary-actions"><button type="button" class="cf-command brass" data-cf-quick="use"><i class="fa-solid fa-key"></i> Use</button><button type="button" class="cf-command" data-cf-quick="show"><i class="fa-solid fa-eye"></i> Show</button><button type="button" class="cf-icon" id="cf-more-actions" title="More actions"><i class="fa-solid fa-ellipsis"></i></button></div>
      <details class="cf-history"><summary>History <span>${credential.history.length}</span></summary>${credential.history.length ? credential.history.slice().reverse().slice(0, 8).map((item) => `<div><span>${esc(item.action || "event")}</span><strong>${esc(item.result || item.reason || "recorded")}</strong><time>${new Date(item.t || Date.now()).toLocaleDateString()}</time></div>`).join("") : '<p>No recorded uses.</p>'}</details>
    `);
    if ($root.find("#cf-wallet-canvas").length) renderCredentialCanvas($root.find("#cf-wallet-canvas")[0], credential, state.side);
    list.forEach((item) => {
      const itemStatus = statusFor(item);
      $list.append(`<button type="button" class="cf-list-row ${item.id === credential.id ? "is-active" : ""}" data-cf-select="${esc(item.id)}"><span class="cf-list-icon ${esc(item.category)}"><i class="fa-solid ${item.physical ? "fa-id-card" : "fa-mobile-screen"}"></i></span><span class="cf-list-copy"><strong>${esc(item.typeName)}</strong><small>${esc(item.issuerName)} · ${esc(short(item.credentialNumber, 18))}</small></span><span class="cf-list-status ${esc(itemStatus)}"></span></button>`);
    });
  }

  function typeOptions(path = state.createPath) {
    const world = resolveCredentialWorldMode(getSettings());
    return Object.values(CREDENTIAL_TYPES).filter((definition) => {
      const modeFits = definition.worldMode === "any" || definition.worldMode === world || (world === "modern" && definition.worldMode === "modern");
      return modeFits && (path === "custom" ? CUSTOM_TYPES.has(definition.id) : true);
    });
  }

  function updateTypeFields() {
    const definition = CREDENTIAL_TYPES[$root.find("#cf-type").val()] || CREDENTIAL_TYPES.business_card;
    $root.find("#cf-portrait-field").toggle(definition.portraitRequired);
    $root.find("#cf-account-field").toggle(definition.linkedAccountRequired || definition.category === "financial");
    $root.find("#cf-title-label").text(definition.id === "hotel_key" ? "Room" : definition.category === "access" ? "Role / clearance" : "Title / role");
    $root.find("#cf-title").attr("required", definition.id === "hotel_key" || definition.id === "employee_badge" || definition.id === "workplace_badge");
    $root.find("#cf-linked-account").attr("required", definition.linkedAccountRequired);
    $root.find("#cf-create-requirements").text([definition.portraitRequired ? "Portrait" : "", definition.linkedAccountRequired ? "Linked account" : "", definition.category === "access" ? "Permission" : ""].filter(Boolean).join(" · ") || "No additional required fields");
  }

  function resetCreate(keepPath = true) {
    const path = state.createPath;
    const form = $root.find("#cf-create-form")[0];
    form?.reset();
    state.createPath = keepPath ? path : "custom";
    state.editingId = null;
    state.portraitImage = "";
    state.emblemImage = "";
    state.createSide = "front";
    $root.find("#cf-create-heading").text("New credential");
    $root.find("#cf-accent").val("#cba35c");
    $root.find("#cf-quality,#cf-scan-difficulty").val(state.createPath === "forged" ? 60 : 82);
    $root.find("#cf-condition,#cf-font-scale,#cf-portrait-x,#cf-portrait-y").val(100);
    renderCreate();
  }

  function populateCreate(credential) {
    state.editingId = credential.id;
    state.createPath = credential.authenticity === "forged" ? "forged" : "custom";
    state.portraitImage = credential.appearance.portraitImage || "";
    state.emblemImage = credential.appearance.emblemImage || "";
    const values = {
      "#cf-type": credential.type, "#cf-holder": credential.holderName, "#cf-issuer": credential.issuerName,
      "#cf-number": credential.credentialNumber, "#cf-title": credential.title, "#cf-valid-from": dateInput(credential.validFrom),
      "#cf-expires": dateInput(credential.expiresAt), "#cf-permissions": credential.permissions.join(", "),
      "#cf-linked-account": credential.linkedAccountId || "", "#cf-linked-location": credential.linkedLocationIds.join(", "),
      "#cf-accent": credential.appearance.accent, "#cf-quality": credential.quality, "#cf-condition": credential.condition,
      "#cf-scan-difficulty": credential.security.scanDifficulty, "#cf-font-scale": Math.round(credential.appearance.fontScale * 100),
      "#cf-portrait-x": Math.round(credential.appearance.portraitX * 100), "#cf-portrait-y": Math.round(credential.appearance.portraitY * 100)
    };
    Object.entries(values).forEach(([selector, value]) => $root.find(selector).val(value));
    $root.find("#cf-physical").prop("checked", credential.physical !== false);
    $root.find("#cf-chip").prop("checked", credential.security.chip === true);
    $root.find("#cf-stripe").prop("checked", credential.security.magneticStripe === true);
    $root.find("#cf-hologram").prop("checked", credential.security.hologram === true);
    $root.find("#cf-signature").prop("checked", credential.security.signatureRequired === true);
    $root.find("#cf-create-heading").text("Edit appearance");
    state.tab = "create";
    renderCreate();
  }

  function draftCredential() {
    const settings = getSettings();
    const type = String($root.find("#cf-type").val() || "business_card");
    const definition = CREDENTIAL_TYPES[type] || CREDENTIAL_TYPES.business_card;
    const sourceId = String($root.find("#cf-source").val() || "");
    const source = ensureCredentialState(settings).find((item) => item.id === sourceId);
    const validFrom = $root.find("#cf-valid-from").val();
    const expires = $root.find("#cf-expires").val();
    return {
      ...(state.editingId ? ensureCredentialState(settings).find((item) => item.id === state.editingId) : source || {}),
      id: state.editingId || undefined,
      type,
      category: definition.category,
      format: definition.format,
      worldMode: resolveCredentialWorldMode(settings),
      authenticity: state.createPath,
      holderId: "player",
      holderName: String($root.find("#cf-holder").val() || settings?.character?.name || "Unknown holder").trim(),
      issuerId: String($root.find("#cf-issuer").val() || "self").toLowerCase().replace(/\W+/g, "_") || "self",
      issuerName: String($root.find("#cf-issuer").val() || "Self-issued").trim(),
      credentialNumber: String($root.find("#cf-number").val() || `CF-${String(Date.now()).slice(-7)}`).trim(),
      title: String($root.find("#cf-title").val() || "").trim(),
      validFrom: validFrom ? new Date(`${validFrom}T00:00:00`).getTime() : Date.now(),
      expiresAt: expires ? new Date(`${expires}T23:59:59`).getTime() : null,
      status: "active",
      quality: Number($root.find("#cf-quality").val() || 82),
      condition: Number($root.find("#cf-condition").val() || 100),
      permissions: state.createPath === "forged" ? csv($root.find("#cf-permissions").val()) : [],
      linkedAccountId: String($root.find("#cf-linked-account").val() || "").trim() || null,
      linkedLocationIds: csv($root.find("#cf-linked-location").val()),
      physical: $root.find("#cf-physical").prop("checked"),
      appearance: {
        ...(source?.appearance || {}), templateId: `${resolveCredentialWorldMode(settings)}_${definition.category}_01`, theme: $root.find("#cf-theme").val() || "charcoal_gold",
        portraitImage: state.portraitImage, emblemImage: state.emblemImage, accent: $root.find("#cf-accent").val() || "#cba35c",
        fontScale: Number($root.find("#cf-font-scale").val() || 100) / 100, portraitX: Number($root.find("#cf-portrait-x").val() || 50) / 100,
        portraitY: Number($root.find("#cf-portrait-y").val() || 50) / 100
      },
      security: {
        barcodeValue: String($root.find("#cf-number").val() || ""), qrValue: `uie:credential:${String($root.find("#cf-number").val() || "")}`,
        magneticStripe: $root.find("#cf-stripe").prop("checked"), chip: $root.find("#cf-chip").prop("checked"),
        hologram: $root.find("#cf-hologram").prop("checked"), signatureRequired: $root.find("#cf-signature").prop("checked"),
        scanDifficulty: Number($root.find("#cf-scan-difficulty").val() || 45)
      }
    };
  }

  async function renderCredentialCanvas(canvas, credential, side = "front") {
    if (!canvas || !credential) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const appearance = credential.appearance || {};
    const security = credential.security || {};
    const accent = appearance.accent || "#cba35c";
    const fantasy = credential.worldMode === "fantasy" || ["scroll", "document", "seal", "token", "tablet", "insignia"].includes(credential.format);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = fantasy ? "#d9c9a3" : "#111214";
    ctx.fillRect(0, 0, width, height);
    if (fantasy) {
      ctx.fillStyle = "rgba(86,55,27,.08)";
      for (let y = 10; y < height; y += 9) ctx.fillRect(0, y, width, 1);
      ctx.strokeStyle = "#7c5a2e"; ctx.lineWidth = 3; ctx.strokeRect(7, 7, width - 14, height - 14);
    } else {
      ctx.fillStyle = "#070809"; ctx.fillRect(0, 0, width, 42);
      ctx.fillStyle = accent; ctx.fillRect(0, 42, 7, height - 42);
    }
    if (side === "back") {
      if (security.magneticStripe && !fantasy) { ctx.fillStyle = "#27272a"; ctx.fillRect(0, 34, width, 45); }
      ctx.fillStyle = fantasy ? "#352513" : "#f4f1e8"; ctx.font = `700 ${Math.round(12 * (appearance.fontScale || 1))}px sans-serif`;
      ctx.fillText(short(credential.issuerName || "ISSUER", 34).toUpperCase(), 22, fantasy ? 40 : 105);
      ctx.font = "10px monospace"; ctx.fillText(short(credential.credentialNumber, 34), 22, fantasy ? 66 : 128);
      if (security.signatureRequired) { ctx.strokeStyle = fantasy ? "#735b37" : "#e5e7eb"; ctx.strokeRect(20, 145, 190, 30); ctx.font = "8px sans-serif"; ctx.fillText("AUTHORIZED SIGNATURE", 25, 164); }
      ctx.fillStyle = fantasy ? "#53351f" : "#f4f1e8";
      for (let i = 0; i < 26; i += 1) ctx.fillRect(width - 112 + i * 3, 134, i % 3 === 0 ? 2 : 1, 38);
      ctx.font = "8px sans-serif"; ctx.fillText(short(credential.permissions.join(" · ") || "No encoded permissions", 50), 22, 194);
      return;
    }
    const portrait = await loadImage(appearance.portraitImage);
    const emblem = await loadImage(appearance.emblemImage);
    if (emblem) { ctx.globalAlpha = 0.22; drawCover(ctx, emblem, width - 116, 48, 92, 92); ctx.globalAlpha = 1; }
    if (portrait) {
      ctx.fillStyle = fantasy ? "#f0e4c5" : "#e7e5df"; ctx.fillRect(18, 60, 88, 112);
      drawCover(ctx, portrait, 21, 63, 82, 106, appearance.portraitX, appearance.portraitY);
    } else if (CREDENTIAL_TYPES[credential.type]?.portraitRequired) {
      ctx.fillStyle = fantasy ? "#b8a47c" : "#303238"; ctx.fillRect(18, 60, 88, 112);
      ctx.fillStyle = fantasy ? "#6a5736" : "#8b8d91"; ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("PORTRAIT", 62, 116); ctx.textAlign = "left";
    }
    const left = portrait || CREDENTIAL_TYPES[credential.type]?.portraitRequired ? 121 : 22;
    const textColor = fantasy ? "#352513" : "#f5f2e9";
    ctx.fillStyle = fantasy ? "#352513" : accent; ctx.font = `800 ${Math.round(13 * (appearance.fontScale || 1))}px sans-serif`;
    ctx.fillText(short(credential.typeName, portrait ? 24 : 42).toUpperCase(), fantasy ? 22 : 18, fantasy ? 34 : 27);
    ctx.fillStyle = textColor; ctx.font = `800 ${Math.round(14 * (appearance.fontScale || 1))}px sans-serif`; ctx.fillText(short(credential.holderName, portrait ? 22 : 38), left, 77);
    ctx.font = "9px sans-serif"; ctx.fillStyle = fantasy ? "#6a5736" : "#a7a9ad"; ctx.fillText("ISSUER", left, 98);
    ctx.font = "700 11px sans-serif"; ctx.fillStyle = textColor; ctx.fillText(short(credential.issuerName, portrait ? 24 : 40), left, 113);
    ctx.font = "9px sans-serif"; ctx.fillStyle = fantasy ? "#6a5736" : "#a7a9ad"; ctx.fillText("CREDENTIAL", left, 134);
    ctx.font = "700 11px monospace"; ctx.fillStyle = accent; ctx.fillText(short(credential.credentialNumber, portrait ? 22 : 40), left, 149);
    ctx.font = "700 10px sans-serif"; ctx.fillStyle = textColor; ctx.fillText(short(credential.title || credential.category, portrait ? 27 : 46), left, 171);
    if (security.chip && !fantasy) { ctx.fillStyle = "#d1ae5b"; ctx.fillRect(22, 130, 33, 25); ctx.strokeStyle = "#6e5927"; ctx.strokeRect(28, 130, 12, 25); ctx.strokeRect(22, 138, 33, 8); }
    if (security.hologram) { ctx.strokeStyle = "rgba(70,220,225,.65)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(width - 30, height - 28, 14, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = accent; ctx.fillRect(0, height - 8, width, 8);
  }

  function renderCreate() {
    const world = resolveCredentialWorldMode(getSettings());
    $root.find(".cf-path").removeClass("is-active");
    $root.find(`.cf-path[data-cf-path="${state.createPath}"]`).addClass("is-active");
    $root.find("#cf-forgery-fields").toggle(state.createPath === "forged");
    $root.find("#cf-permissions-field,#cf-security-controls,#cf-security-band").toggle(state.createPath === "forged");
    $root.find("#cf-permissions,#cf-security-controls input,#cf-security-controls select").prop("disabled", state.createPath !== "forged");
    const currentType = $root.find("#cf-type").val();
    $root.find("#cf-type").html(typeOptions().map((definition) => `<option value="${esc(definition.id)}">${esc(definition.label)}</option>`).join(""));
    if (currentType && $root.find(`#cf-type option[value="${currentType}"]`).length) $root.find("#cf-type").val(currentType);
    const sourceOptions = ensureCredentialState(getSettings()).map((item) => `<option value="${esc(item.id)}">${esc(item.typeName)} · ${esc(item.issuerName)}</option>`).join("");
    $root.find("#cf-source").html(`<option value="">No source selected</option>${sourceOptions}`);
    $root.find("#cf-create-world").text(world === "fantasy" ? "Document workshop" : "Credential editor");
    $root.find("#cf-create-flip").html(`<i class="fa-solid fa-rotate"></i> ${state.createSide}`);
    $root.find("#cf-material").html(world === "fantasy" ? '<option value="parchment">Parchment</option><option value="vellum">Vellum</option><option value="metal">Metal / rune</option>' : '<option value="plastic">PVC plastic</option><option value="paper">Security paper</option><option value="metal">Metal</option><option value="digital">Digital only</option>');
    updateTypeFields();
    const draft = draftCredential();
    renderCredentialCanvas($root.find("#cf-create-canvas")[0], draft, state.createSide);
  }

  function renderScanner() {
    const all = ensureCredentialState(getSettings());
    const selected = String($root.find("#cf-scan-credential").val() || state.selectedId || all[0]?.id || "");
    $root.find("#cf-scan-credential").html(all.map((item) => `<option value="${esc(item.id)}">${esc(item.typeName)} · ${esc(item.issuerName)}</option>`).join(""));
    $root.find("#cf-scan-credential").val(selected);
    if (!all.length) {
      $root.find("#cf-scan-results").html('<div class="cf-empty compact"><i class="fa-solid fa-barcode"></i><strong>No credential to scan</strong></div>');
      return;
    }
    if (!state.scanResult) {
      $root.find("#cf-scan-results").html('<div class="cf-scan-idle"><i class="fa-solid fa-wave-square"></i><span>Scanner ready</span></div>');
      return;
    }
    const result = state.scanResult;
    const rows = [["Visual", result.visual], ["Barcode", result.barcode], ["Issuer database", result.issuerDatabase], ["Holder", result.holderMatch ? "match" : "mismatch"], ["Expiration", result.expiration], ["Clearance", result.clearance], ["Tampering", result.tampering]];
    $root.find("#cf-scan-results").html(`<div class="cf-scan-outcome ${result.structural.accepted ? "accepted" : "rejected"}"><i class="fa-solid ${result.structural.accepted ? "fa-circle-check" : "fa-triangle-exclamation"}"></i><div><strong>${esc(result.structural.outcome.replace(/_/g, " "))}</strong><span>${esc(result.structural.reason.replace(/_/g, " "))}</span></div></div><dl class="cf-scan-grid">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(String(value).replace(/_/g, " "))}</dd></div>`).join("")}</dl><div class="cf-acceptance"><span>Estimated acceptance</span><strong>${esc(result.estimate.band)}</strong><div><i style="left:${result.estimate.range[0]}%"></i><i style="left:${result.estimate.range[1]}%"></i></div><small>Varies by scanner and inspector</small></div><div class="cf-usable"><strong>Usable locations</strong><span>${result.locations.length ? esc(result.locations.join(", ")) : "No location lock"}</span></div>`);
  }

  function renderActionSheet() {
    const credential = ensureCredentialState(getSettings()).find((item) => item.id === state.actionId);
    const $sheet = $root.find("#cf-action-sheet");
    if (!credential) return $sheet.removeClass("is-open").attr("aria-hidden", "true");
    $root.find("#cf-action-title").text(credential.typeName);
    $root.find("#cf-action-subtitle").text(`${credential.issuerName} · ${credential.credentialNumber}`);
    $sheet.addClass("is-open").attr("aria-hidden", "false");
  }

  function render() {
    renderHeader();
    ensureCredentialState(getSettings());
    renderTabs();
    if (state.tab === "wallet") renderWallet();
    if (state.tab === "create") renderCreate();
    if (state.tab === "scanner") renderScanner();
  }

  async function saveCredential() {
    const form = $root.find("#cf-create-form")[0];
    if (!form?.reportValidity()) return;
    if (state.createPath === "forged") {
      const source = $root.find("#cf-source").val();
      const changedIssuer = String($root.find("#cf-issuer").val() || "").trim();
      const changedHolder = String($root.find("#cf-holder").val() || "").trim();
      if (!source && !changedIssuer && !changedHolder) {
        notify("warning", "Select a source or alter the issuer or holder.", "Card Forge");
        return;
      }
    }
    const settings = getSettings();
    const draft = draftCredential();
    const temp = upsertCredential(settings, draft);
    const canvas = document.createElement("canvas"); canvas.width = 340; canvas.height = 210;
    await renderCredentialCanvas(canvas, temp, "front");
    temp.appearance.frontImage = canvas.toDataURL("image/png");
    await renderCredentialCanvas(canvas, temp, "back");
    temp.appearance.backImage = canvas.toDataURL("image/png");
    const credential = upsertCredential(settings, temp);
    persist(state.editingId ? "updated" : "created", credential);
    notify("success", `${credential.typeName} saved.`, resolveCredentialWorldMode(settings) === "fantasy" ? "Credential Forge" : "Card Forge");
    onRpEvent(`${credential.authenticity === "forged" ? "creates a forged" : "creates a custom"} ${credential.typeName} for ${credential.holderName}.`);
    state.selectedId = credential.id;
    state.tab = "wallet";
    resetCreate();
    render();
  }

  function performUse(action = "use", credential = selectedCredential()) {
    if (!credential) return;
    const settings = getSettings();
    const locationId = sceneLocation(settings);
    const result = useCredential(settings, credential.id, { locationId, id: locationId, action, scannerStrength: 50, currentHolderId: "player" });
    persist(action, credential);
    const type = result.accepted ? "success" : result.triggeredAlarm ? "error" : "warning";
    notify(type, `${result.outcome.replace(/_/g, " ")}: ${result.reason.replace(/_/g, " ")}.`, credential.typeName);
    onRpEvent(`${action === "show" ? "shows" : "uses"} ${credential.typeName} at ${locationId}; ${result.outcome.replace(/_/g, " ")}.`);
    renderWallet();
    return result;
  }

  async function action(name) {
    const settings = getSettings();
    const credential = ensureCredentialState(settings).find((item) => item.id === state.actionId);
    if (!credential) return;
    if (name === "show" || name === "use") performUse(name, credential);
    if (name === "scan") { state.selectedId = credential.id; state.tab = "scanner"; state.scanResult = null; }
    if (["wallet", "payment", "transit", "identity"].includes(name)) {
      setCredentialDefault(settings, name, credential.id); persist("default", credential); notify("success", `Set as ${PURPOSE_LABELS[name].toLowerCase()} credential.`, credential.typeName);
    }
    if (name === "share") {
      const text = `${credential.typeName} · ${credential.holderName} · ${credential.issuerName} · ${credential.credentialNumber}`;
      try { await navigator.clipboard.writeText(text); notify("success", "Credential details copied.", credential.typeName); } catch (_) { notify("info", text, credential.typeName); }
    }
    if (name === "copy") { const copy = copyCredential(settings, credential.id); persist("copied", copy); state.selectedId = copy?.id || credential.id; notify("success", "Forgery copy created.", credential.typeName); }
    if (name === "edit") populateCreate(credential);
    if (name === "revoke" && await confirmAction(`Revoke ${credential.typeName}? It will no longer validate.`)) { revokeCredential(settings, credential.id); persist("revoked", credential); notify("warning", "Credential revoked.", credential.typeName); }
    if (name === "destroy" && await confirmAction(`Destroy ${credential.typeName}? This cannot be undone.`)) { destroyCredential(settings, credential.id); persist("destroyed", credential); state.selectedId = null; notify("warning", "Credential destroyed.", "Card Forge"); }
    state.actionId = null;
    renderActionSheet();
    render();
  }

  function bind() {
    $root.off(".credentialForge");
    $root.on("click.credentialForge", ".cf-tab, [data-cf-tab]", function () { state.tab = String(this.dataset.cfTab); render(); });
    $root.on("click.credentialForge", ".cf-path", function () { state.createPath = String(this.dataset.cfPath); resetCreate(); });
    $root.on("input.credentialForge change.credentialForge", "#cf-wallet-search,#cf-wallet-category,#cf-wallet-status,#cf-wallet-sort", () => renderWallet());
    $root.on("click.credentialForge", "[data-cf-select]", function () { state.selectedId = String(this.dataset.cfSelect); state.side = "front"; renderWallet(); });
    $root.on("click.credentialForge", "#cf-prev,#cf-next", function () { const list = credentials({ search: $root.find("#cf-wallet-search").val(), category: $root.find("#cf-wallet-category").val(), status: $root.find("#cf-wallet-status").val(), sort: $root.find("#cf-wallet-sort").val() }); const index = Math.max(0, list.findIndex((item) => item.id === state.selectedId)); const delta = this.id === "cf-next" ? 1 : -1; state.selectedId = list[(index + delta + list.length) % list.length]?.id || null; state.side = "front"; renderWallet(); });
    $root.on("click.credentialForge", "#cf-wallet-card", () => { state.side = state.side === "front" ? "back" : "front"; renderWallet(); });
    $root.on("click.credentialForge", ".cf-favorite", () => { const credential = selectedCredential(); if (!credential) return; credential.favorite = !credential.favorite; credential.updatedAt = Date.now(); upsertCredential(getSettings(), credential); persist("favorite", credential); renderWallet(); });
    $root.on("click.credentialForge", "[data-cf-quick]", function () { performUse(String(this.dataset.cfQuick)); });
    $root.on("click.credentialForge", "#cf-more-actions", () => { state.actionId = state.selectedId; renderActionSheet(); });
    $root.on("click.credentialForge", "#cf-sheet-close,.cf-sheet-scrim", () => { state.actionId = null; renderActionSheet(); });
    $root.on("click.credentialForge", "[data-cf-action]", function () { void action(String(this.dataset.cfAction)); });
    $root.on("change.credentialForge input.credentialForge", "#cf-create-form input,#cf-create-form select,#cf-create-form textarea", () => renderCreate());
    $root.on("click.credentialForge", "#cf-create-flip", () => { state.createSide = state.createSide === "front" ? "back" : "front"; renderCreate(); });
    $root.on("click.credentialForge", "#cf-reset", () => resetCreate());
    $root.on("click.credentialForge", "#cf-duplicate-preset", () => { state.editingId = null; $root.find("#cf-number").val(`${$root.find("#cf-number").val() || "CF"}-2`); notify("info", "Design duplicated into a new credential.", "Card Forge"); renderCreate(); });
    $root.on("click.credentialForge", "#cf-save-preset", () => { const settings = getSettings(); ensureCredentialState(settings); settings.phone.credentialDesigns.push({ id: `design_${Date.now()}`, type: $root.find("#cf-type").val(), theme: $root.find("#cf-theme").val(), accent: $root.find("#cf-accent").val(), security: draftCredential().security, appearance: draftCredential().appearance }); saveSettings(); notify("success", "Design preset saved.", "Card Forge"); });
    $root.on("submit.credentialForge", "#cf-create-form", (event) => { event.preventDefault(); void saveCredential(); });
    $root.on("click.credentialForge", "#cf-portrait-button", () => $root.find("#cf-portrait-upload").trigger("click"));
    $root.on("click.credentialForge", "#cf-emblem-button", () => $root.find("#cf-emblem-upload").trigger("click"));
    $root.on("change.credentialForge", "#cf-portrait-upload,#cf-emblem-upload", async function () { const file = this.files?.[0]; if (!file) return; const value = await readFile(file); if (this.id === "cf-portrait-upload") state.portraitImage = value; else state.emblemImage = value; renderCreate(); });
    $root.on("click.credentialForge", "#cf-run-scan", () => { const credential = ensureCredentialState(getSettings()).find((item) => item.id === $root.find("#cf-scan-credential").val()); state.scanResult = inspectCredential(credential, { locationId: String($root.find("#cf-scan-target").val() || sceneLocation(getSettings())), requiredPermission: String($root.find("#cf-scan-permission").val() || ""), scannerStrength: Number($root.find("#cf-scanner-strength").val() || 50), currentHolderId: "player" }); renderScanner(); });
  }

  const onCredentialsChanged = () => { if ($root.find("#uie-app-cardforge-view").is(":visible")) render(); };
  const onModeChanged = () => { resetCreate(false); render(); };
  window.addEventListener("uie:credentials-changed", onCredentialsChanged);
  window.addEventListener("uie:game_mode_changed", onModeChanged);
  installCredentialEventBridge({ getSettings, saveSettings, onChange: onCredentialsChanged });
  bind();
  ensureCredentialState(getSettings());
  syncIssuedCredentials();
  render();

  const api = { render, open() { syncIssuedCredentials(); state.tab = "wallet"; render(); }, destroy() { window.removeEventListener("uie:credentials-changed", onCredentialsChanged); window.removeEventListener("uie:game_mode_changed", onModeChanged); $root.off(".credentialForge"); delete root.__uieCredentialForgeUI; } };
  root.__uieCredentialForgeUI = api;
  window.UIE = window.UIE || {};
  window.UIE.credentialForge = api;
  return api;
}
