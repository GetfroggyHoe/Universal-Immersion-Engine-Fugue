import { getSettings, saveSettings } from "../core.js";
import {
  TRAVEL_ASSET_CATEGORIES,
  ensureTravelAssetFields,
  isTravelAsset,
  normalizeTravelCategory,
  travelCategoryDefinition,
} from "../travelAssets.js";
import { ensureProcessedAssetLibrary } from "../assetLibrary.js";

function assetName(asset) {
  return String(asset?.name || asset?.title || "Asset").trim();
}

function findAsset(settings, name) {
  const key = String(name || "").trim().toLowerCase();
  return (settings?.inventory?.assets || []).find((asset) => assetName(asset).toLowerCase() === key) || null;
}

async function runMapAction(action, name) {
  const map = await import("../map.js");
  const handler = map?.[action];
  if (typeof handler === "function") await handler(name);
  await init();
}

function bindHandlers() {
  $(document)
    .off("click.uieAssetsHelp", ".uie-assets-help")
    .on("click.uieAssetsHelp", ".uie-assets-help", () => {
      try {
        if (window.uie?.phone?.openBooksGuide) window.uie.phone.openBooksGuide("guide-inventory");
        else if (typeof window.UIE_openGuide === "function") window.UIE_openGuide("guide-inventory");
      } catch (_) {}
    })
    .off("change.uieAssetTravelCategory", ".asset-travel-category")
    .on("change.uieAssetTravelCategory", ".asset-travel-category", function () {
      const settings = getSettings();
      const name = String($(this).closest("[data-asset-name]").attr("data-asset-name") || "");
      const asset = findAsset(settings, name);
      if (!asset) return;
      const wasTravel = isTravelAsset(asset);
      asset.travelCategory = normalizeTravelCategory($(this).val()) || "none";
      if (!wasTravel && isTravelAsset(asset)) asset.location = "";
      if (!isTravelAsset(asset) && String(settings?.worldState?.activeVehicle?.name || "").toLowerCase() === name.toLowerCase()) {
        delete settings.worldState.activeVehicle;
      }
      saveSettings();
      init();
    })
    .off("click.uieAssetPlace", ".asset-action-place")
    .on("click.uieAssetPlace", ".asset-action-place", function () {
      runMapAction("placeTravelAssetHere", $(this).closest("[data-asset-name]").attr("data-asset-name"));
    })
    .off("click.uieAssetGo", ".asset-action-go")
    .on("click.uieAssetGo", ".asset-action-go", function () {
      runMapAction("moveToTravelAsset", $(this).closest("[data-asset-name]").attr("data-asset-name"));
    })
    .off("click.uieAssetBoard", ".asset-action-board")
    .on("click.uieAssetBoard", ".asset-action-board", function () {
      runMapAction("boardTravelAsset", $(this).closest("[data-asset-name]").attr("data-asset-name"));
    })
    .off("click.uieAssetPark", ".asset-action-park")
    .on("click.uieAssetPark", ".asset-action-park", function () {
      runMapAction("parkTravelAssetHere", $(this).closest("[data-asset-name]").attr("data-asset-name"));
    });
}

export async function init() {
  const settings = getSettings();
  if (!settings) return;
  await ensureProcessedAssetLibrary();
  bindHandlers();
  render();
}

export function render() {
  const settings = getSettings();
  if (!settings) return;
  const list = [...(settings.inventory?.assets || [])].sort((a, b) => {
    const ac = String(a?.category || a?.type || "").localeCompare(String(b?.category || b?.type || ""));
    if (ac) return ac;
    return assetName(a).localeCompare(assetName(b));
  });
  const $list = $("#uie-assets-list");
  if (!$list.length) return;
  $list.empty();
  if (!list.length) {
    $list.append($("<div>").css({ opacity: 0.7 }).text("No assets yet."));
  }

  const template = document.getElementById("uie-asset-card-template");
  if (!template) {
    return;
  }
  const current = String(settings?.worldState?.location || settings?.worldState?.currentLocation || "").trim();
  const active = String(settings?.worldState?.activeVehicle?.name || settings?.worldState?.activeVehicle || "").trim();

  for (const asset of list) {
    ensureTravelAssetFields(asset);
    const name = assetName(asset);
    const category = String(asset?.category || "other").trim();
    const owned = asset?.owned !== false;
    const kwRaw = Array.isArray(asset?.keywords) ? asset.keywords.filter(Boolean).join(", ") : String(asset?.keywords || "").trim();
    const definition = travelCategoryDefinition(asset);
    const location = String(asset.location || "").trim();
    const travel = isTravelAsset(asset);
    const here = Boolean(location) && location.toLowerCase() === current.toLowerCase();
    const isActive = active.toLowerCase() === name.toLowerCase();

    const clone = template.content.cloneNode(true);
    const $card = $(clone).children().first();
    $card.attr("data-asset-name", name);

    if (asset.img) {
      $card.find(".asset-img-container").show();
      $card.find(".asset-img").attr("src", asset.img);
    }
    $card.find(".asset-name").text(name);
    if (asset.description) $card.find(".asset-desc").text(asset.description).show();

    const chips = [];
    if (category) chips.push(category);
    if (owned) chips.push("owned");
    if (Number.isFinite(Number(asset?.cost))) chips.push(`cost: ${Number(asset.cost)}`);
    if (Number.isFinite(Number(asset?.sellPrice))) chips.push(`sell: ${Number(asset.sellPrice)}`);
    if (String(asset?.homeLocation || "").trim()) chips.push(`home: ${String(asset.homeLocation).trim()}`);
    if (Number.isFinite(Number(asset?.durability))) chips.push(`durability: ${Math.max(0, Number(asset.durability))}/${Math.max(1, Number(asset.maxDurability || 100))}`);
    if (Number.isFinite(Number(asset?.speedModifier ?? asset?.travelSpeedModifier))) chips.push(`travel speed: x${Number(asset.speedModifier ?? asset.travelSpeedModifier)}`);
    if (kwRaw) chips.push(`keywords: ${kwRaw.slice(0, 160)}`);
    if (chips.length) {
      if (!$card.find(".asset-desc").text()) $card.find(".asset-desc").show();
      $card.find(".asset-desc").append($("<div>").css({ marginTop: "6px", opacity: 0.8, fontSize: ".85em" }).text(chips.join(" | ")));
    }

    const $controls = $card.find(".asset-travel-controls").css("display", "flex");
    const $category = $controls.find(".asset-travel-category");
    for (const option of TRAVEL_ASSET_CATEGORIES) {
      $category.append($("<option>").val(option.value).text(option.label));
    }
    $category.val(definition.category);
    $controls.find(".asset-location").text(
      !travel ? "Travel status: disabled"
        : isActive ? `In use at ${current || location || "current location"}`
          : location ? `Parked at: ${location}`
            : "Unplaced: choose Place Here at a valid location",
    );
    $controls.find(".asset-travel-rule").text(definition.placement);
    $controls.find(".asset-action-place").toggle(travel && !location);
    $controls.find(".asset-action-go").toggle(travel && Boolean(location) && !here);
    $controls.find(".asset-action-board").toggle(travel && here && !isActive);
    $controls.find(".asset-action-park").toggle(travel && isActive);
    $list.append($card);
  }
}
