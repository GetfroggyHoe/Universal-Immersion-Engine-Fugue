(() => {
  "use strict";

  const STYLE_ID = "uie-battle-mobile-focus-style";

  const css = String.raw`
/*
 * UIE battle visual-focus pass.
 * Mobile landscape only. The sprites/stage remain the main visual; command
 * information is a compact bottom strip.
 */
@media (pointer: coarse) and (orientation: landscape) {
  #battle-screen.uie-battle-tactical {
    --uie-battle-bottom-height: 80px;
    --uie-battle-bottom-gap: 5px;
  }

  /* Reclaim the lower half of the old command/log footprint for sprites. */
  #battle-screen.uie-battle-tactical .battle-stage {
    top: 44px !important;
    bottom: calc(var(--uie-battle-bottom-height) + 12px) !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  #battle-screen.uie-battle-tactical #battle-bottom-dock,
  #battle-screen.uie-battle-tactical #battle-log {
    position: fixed !important;
    top: auto !important;
    bottom: var(--uie-battle-bottom-gap) !important;
    height: var(--uie-battle-bottom-height) !important;
    min-height: var(--uie-battle-bottom-height) !important;
    max-height: var(--uie-battle-bottom-height) !important;
    margin: 0 !important;
    box-sizing: border-box !important;
    transform: none !important;
    border-radius: 7px !important;
    overflow: hidden !important;
  }

  #battle-screen.uie-battle-tactical #battle-bottom-dock {
    left: var(--uie-battle-bottom-gap) !important;
    right: auto !important;
    width: calc(74vw - 8px) !important;
    padding: 4px !important;
    gap: 4px !important;
    align-items: stretch !important;
  }

  #battle-screen.uie-battle-tactical #battle-log {
    right: var(--uie-battle-bottom-gap) !important;
    left: auto !important;
    width: calc(26vw - 7px) !important;
    padding: 4px 6px !important;
    font-size: 8px !important;
    line-height: 1.18 !important;
    overflow-y: auto !important;
    text-align: left !important;
  }

  #battle-screen.uie-battle-tactical #battle-log > :first-child {
    margin-top: 0 !important;
  }

  #battle-screen.uie-battle-tactical #battle-log :is(
    .battle-log-entry,
    p,
    li,
    div
  ) {
    font-size: inherit !important;
    line-height: inherit !important;
  }

  /* The sprite field is now the actual battle visual. */
  #battle-screen.uie-battle-tactical .sprite-stage-col {
    align-items: flex-end !important;
    padding-bottom: 5px !important;
    gap: clamp(12px, 2vw, 26px) !important;
    overflow: visible !important;
  }

  #battle-screen.uie-battle-tactical .battle-sprite-container {
    width: clamp(86px, 10vw, 132px) !important;
    height: clamp(150px, 48dvh, 226px) !important;
    max-height: calc(100% - 10px) !important;
  }

  #battle-screen.uie-battle-tactical .battle-sprite-container img {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
    object-fit: contain !important;
  }

  #battle-screen.uie-battle-tactical .sprite-name-lbl {
    bottom: -18px !important;
    padding: 1px 4px !important;
    font-size: 7px !important;
  }

  #battle-screen.uie-battle-tactical .sprite-hp-bar {
    bottom: -25px !important;
    width: 68px !important;
    height: 3px !important;
  }

  /* Compact party summaries into a single 72px-tall control strip. */
  #battle-screen.uie-battle-tactical .character-box.is-inactive {
    flex: 0 0 82px !important;
    width: 82px !important;
    min-width: 82px !important;
    max-width: 82px !important;
    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
    padding: 3px 4px !important;
    gap: 3px !important;
    overflow: hidden !important;
  }

  #battle-screen.uie-battle-tactical .character-box.is-inactive .cb-avatar {
    width: 24px !important;
    height: 24px !important;
    min-width: 24px !important;
    min-height: 24px !important;
  }

  #battle-screen.uie-battle-tactical .character-box.is-inactive :is(
    .cb-compact-name,
    .cb-compact-role,
    .cb-compact-copy
  ) {
    font-size: 6.5px !important;
    line-height: 1 !important;
    margin: 0 !important;
  }

  #battle-screen.uie-battle-tactical .character-box.is-active {
    position: relative !important;
    flex: 1 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
    grid-template-columns: minmax(0, 1fr) 122px !important;
    gap: 4px !important;
    padding: 3px 4px !important;
    overflow: hidden !important;
  }

  #battle-screen.uie-battle-tactical .cb-col-profile {
    min-width: 0 !important;
    gap: 2px !important;
    padding: 0 4px 0 0 !important;
    overflow: hidden !important;
  }

  #battle-screen.uie-battle-tactical :is(
    .cb-profile-header,
    .cb-status-effects,
    .cb-status-list,
    .status-effects-list
  ) {
    display: none !important;
  }

  #battle-screen.uie-battle-tactical .cb-stat-progress {
    height: 15px !important;
    min-height: 15px !important;
    gap: 3px !important;
    margin: 0 !important;
  }

  #battle-screen.uie-battle-tactical :is(
    .cb-stat-label,
    .cb-stat-value,
    .cb-profile-info span
  ) {
    font-size: 7px !important;
    line-height: 1 !important;
  }

  /* Main action deck: compact, right-aligned, and contained. */
  #battle-screen.uie-battle-tactical .action-menu-container {
    position: relative !important;
    display: block !important;
    justify-self: end !important;
    width: 122px !important;
    min-width: 122px !important;
    max-width: 122px !important;
    height: 66px !important;
    min-height: 66px !important;
    max-height: 66px !important;
    overflow: hidden !important;
  }

  #battle-screen.uie-battle-tactical .action-grid {
    display: grid !important;
    grid-template-columns: repeat(2, 59px) !important;
    grid-auto-rows: 20px !important;
    width: 122px !important;
    height: 66px !important;
    gap: 3px 4px !important;
    margin: 0 !important;
    padding: 0 !important;
    align-content: start !important;
  }

  #battle-screen.uie-battle-tactical :is(.btn-action, .cb-menu-btn) {
    width: 59px !important;
    min-width: 59px !important;
    max-width: 59px !important;
    height: 20px !important;
    min-height: 20px !important;
    max-height: 20px !important;
    padding: 1px 2px !important;
    gap: 2px !important;
    font-size: 6.5px !important;
    line-height: 1 !important;
    white-space: nowrap !important;
    text-align: center !important;
    overflow: hidden !important;
  }

  /* Skills/items/magic panels must replace the action deck at its right edge,
     never escape over the party cards on the left. */
  #battle-screen.uie-battle-tactical .sub-action-pane {
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    left: auto !important;
    z-index: 8 !important;
    width: 122px !important;
    min-width: 122px !important;
    max-width: 122px !important;
    height: 66px !important;
    min-height: 66px !important;
    max-height: 66px !important;
    padding: 2px !important;
    margin: 0 !important;
    background: rgba(7, 12, 19, .98) !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
  }

  #battle-screen.uie-battle-tactical :is(
    .pane-title,
    .subpanel-header
  ) {
    margin: 0 0 2px !important;
    font-size: 6.5px !important;
    line-height: 1 !important;
  }

  #battle-screen.uie-battle-tactical :is(
    .sub-button-row,
    .subpanel-list,
    .sub-options-flex-wrapper
  ) {
    display: grid !important;
    grid-template-columns: 1fr !important;
    width: 100% !important;
    gap: 2px !important;
    margin: 0 !important;
    overflow: visible !important;
  }

  #battle-screen.uie-battle-tactical :is(.btn-sub, .subpanel-item) {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    min-height: 17px !important;
    padding: 2px 3px !important;
    font-size: 6.5px !important;
    line-height: 1 !important;
  }
}

@media (pointer: coarse) and (orientation: landscape) and (max-height: 430px) {
  #battle-screen.uie-battle-tactical {
    --uie-battle-bottom-height: 74px;
    --uie-battle-bottom-gap: 4px;
  }

  #battle-screen.uie-battle-tactical .battle-stage {
    bottom: 84px !important;
  }

  #battle-screen.uie-battle-tactical .battle-sprite-container {
    height: clamp(144px, 50dvh, 210px) !important;
  }

  #battle-screen.uie-battle-tactical .character-box.is-inactive,
  #battle-screen.uie-battle-tactical .character-box.is-active {
    height: 66px !important;
    min-height: 66px !important;
    max-height: 66px !important;
  }

  #battle-screen.uie-battle-tactical .action-menu-container,
  #battle-screen.uie-battle-tactical .action-grid,
  #battle-screen.uie-battle-tactical .sub-action-pane {
    height: 60px !important;
    min-height: 60px !important;
    max-height: 60px !important;
  }

  #battle-screen.uie-battle-tactical :is(.btn-action, .cb-menu-btn) {
    height: 18px !important;
    min-height: 18px !important;
    max-height: 18px !important;
    font-size: 6px !important;
  }
}

/* UIE_BATTLE_STABLE_WIDTHS
 * Final mobile-landscape widths. These are deliberately inside the same
 * stylesheet as the compact-height rules to prevent cascade ping-pong.
 */
@media (pointer: coarse) and (orientation: landscape) {
  #battle-screen.uie-battle-tactical {
    --uie-battle-dock-left: 11vw;
    --uie-battle-dock-width: 56vw;
    --uie-battle-log-right: 11vw;
    --uie-battle-log-width: 20vw;
  }

  #battle-screen.uie-battle-tactical #battle-bottom-dock {
    left: var(--uie-battle-dock-left) !important;
    right: auto !important;
    width: var(--uie-battle-dock-width) !important;
    max-width: var(--uie-battle-dock-width) !important;
  }

  #battle-screen.uie-battle-tactical #battle-log,
  #battle-screen.uie-battle-tactical .battle-log {
    right: var(--uie-battle-log-right) !important;
    left: auto !important;
    width: var(--uie-battle-log-width) !important;
    max-width: var(--uie-battle-log-width) !important;
  }
}

/* UIE_BATTLE_FINISHING_PASS
 * Mobile landscape only.
 *
 * One real Battle Log, equal sprite-card footprints, readable names, and an
 * action deck that always has a route back to the five main commands.
 */
@media (pointer: coarse) and (orientation: landscape) {
  /* The classed parent was the glassmorphism shell. The actual scrolling log
     is #battle-log. Remove the shell's visual box entirely. */
  #battle-screen.uie-battle-tactical
  [data-uie-battle-log-shell="true"] {
    display: contents !important;
    position: static !important;
    inset: auto !important;
    width: auto !important;
    height: auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: none !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    overflow: visible !important;
  }

  #battle-screen.uie-battle-tactical
  [data-uie-battle-log-shell="true"]
  > [data-uie-log-decoration="true"] {
    display: none !important;
  }

  #battle-screen.uie-battle-tactical #battle-log {
    z-index: 70 !important;
    background: rgba(7, 12, 19, 0.97) !important;
    border: 1px solid rgba(203, 163, 92, 0.48) !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    color: #f3f4f6 !important;
  }

  /* Every player/enemy stage card uses the same footprint. */
  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card {
    position: relative !important;
    width: clamp(104px, 10.5vw, 142px) !important;
    min-width: clamp(104px, 10.5vw, 142px) !important;
    max-width: clamp(104px, 10.5vw, 142px) !important;
    height: clamp(178px, 46dvh, 230px) !important;
    min-height: clamp(178px, 46dvh, 230px) !important;
    max-height: clamp(178px, 46dvh, 230px) !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    box-sizing: border-box !important;
  }

  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card > img,
  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card .battle-sprite-img {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
    object-fit: contain !important;
  }

  /* Names stay inside the lower edge instead of being clipped below stage. */
  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card .sprite-name-lbl,
  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card [class*="sprite-name"],
  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card [class*="enemy-name"] {
    position: absolute !important;
    right: 3px !important;
    bottom: 4px !important;
    left: 3px !important;
    z-index: 8 !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 2px 4px !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    text-align: center !important;
    font-size: 7.5px !important;
    line-height: 1.05 !important;
    border-radius: 4px !important;
    background: rgba(5, 9, 15, 0.90) !important;
  }

  #battle-screen.uie-battle-tactical
  .uie-equal-battle-sprite-card .sprite-hp-bar {
    position: absolute !important;
    right: 8px !important;
    bottom: 1px !important;
    left: 8px !important;
    z-index: 9 !important;
    width: auto !important;
    height: 2px !important;
  }

  /* Keep the five main commands present whenever no real sub-option list is
     open. Old inline display:none values are overridden by the JS state class. */
  #battle-screen.uie-battle-tactical
  .action-menu-container:not(.uie-subpane-open)
  .action-grid {
    display: grid !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  #battle-screen.uie-battle-tactical
  .action-menu-container:not(.uie-subpane-open)
  .sub-action-pane {
    display: none !important;
  }

  #battle-screen.uie-battle-tactical
  .action-menu-container.uie-subpane-open
  .action-grid {
    display: none !important;
  }

  #battle-screen.uie-battle-tactical
  .action-menu-container.uie-subpane-open
  .sub-action-pane[data-uie-active-pane="true"] {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }

  #battle-screen.uie-battle-tactical .uie-battle-sub-back {
    position: sticky !important;
    top: 0 !important;
    z-index: 12 !important;
    display: block !important;
    width: 100% !important;
    min-height: 18px !important;
    margin: 0 0 3px !important;
    padding: 2px 4px !important;
    border: 1px solid rgba(203, 163, 92, 0.55) !important;
    border-radius: 4px !important;
    background: rgba(10, 15, 23, 0.98) !important;
    color: #f0c56f !important;
    font-size: 6.5px !important;
    font-weight: 900 !important;
    line-height: 1 !important;
    text-align: center !important;
  }
}
`;

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = css;
    }
    if (!style.isConnected) document.head.appendChild(style);
    return style;
  }

  function placeStyleAfterBattleCss() {
    const style = ensureStyle();
    /* One deliberate placement when Battle opens. No head observer and no
       permanent competition with another runtime stylesheet. */
    requestAnimationFrame(() => {
      if (style.parentNode) style.parentNode.appendChild(style);
    });
  }

  let battleWasOpen = false;

  function battleIsOpen() {
    const screen = document.getElementById("battle-screen");
    if (!screen || screen.hidden) return false;
    const computed = getComputedStyle(screen);
    return (
      computed.display !== "none" &&
      computed.visibility !== "hidden" &&
      screen.getClientRects().length > 0
    );
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement) || element.hidden) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      element.getClientRects().length > 0
    );
  }

  function normalizeBattleLog(screen) {
    const log = screen.querySelector("#battle-log");
    if (!log) return;

    let shell = log.parentElement;
    while (
      shell &&
      shell !== screen &&
      !shell.classList.contains("battle-log") &&
      !/battle\s*log/i.test(String(shell.className || ""))
    ) {
      shell = shell.parentElement;
    }

    if (!shell || shell === screen) return;

    shell.dataset.uieBattleLogShell = "true";

    for (const child of shell.children) {
      if (child === log || child.contains(log)) continue;
      child.dataset.uieLogDecoration = "true";
    }
  }

  function normalizeSpriteCards(screen) {
    const stageColumns = screen.querySelectorAll(
      ".sprite-stage-col, #battle-party-stage, #battle-enemy-stage"
    );

    for (const column of stageColumns) {
      for (const child of column.children) {
        if (!(child instanceof HTMLElement)) continue;

        const isCard =
          child.matches(
            ".battle-sprite-container, .battle-combatant, .battle-enemy, " +
            ".battle-player, [class*='sprite-container'], [class*='combatant']"
          ) ||
          Boolean(
            child.querySelector(
              "img, .sprite-name-lbl, [class*='sprite-name'], [class*='enemy-name']"
            )
          );

        if (isCard) child.classList.add("uie-equal-battle-sprite-card");
      }
    }
  }

  function paneHasRealOptions(pane) {
    if (!(pane instanceof HTMLElement)) return false;

    const text = String(pane.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (
      !text ||
      /no\s+(skills?|items?|magic|spells?|options?)\s+available/.test(text)
    ) {
      return false;
    }

    return Boolean(
      pane.querySelector(
        "button:not(.uie-battle-sub-back):not([disabled]), " +
        "[role='button']:not(.uie-battle-sub-back), " +
        ".btn-sub:not([disabled]), .subpanel-item:not([aria-disabled='true'])"
      )
    );
  }

  function closeBattleSubpane(deck) {
    if (!(deck instanceof HTMLElement)) return;

    deck.classList.remove("uie-subpane-open");

    for (const pane of deck.querySelectorAll(".sub-action-pane")) {
      pane.dataset.uieActivePane = "false";
      pane.style.setProperty("display", "none", "important");
    }

    const grid = deck.querySelector(".action-grid");
    if (grid) {
      grid.style.setProperty("display", "grid", "important");
      grid.style.setProperty("visibility", "visible", "important");
      grid.style.setProperty("opacity", "1", "important");
      grid.style.setProperty("pointer-events", "auto", "important");
    }
  }

  function normalizeActionDeck(screen) {
    for (const deck of screen.querySelectorAll(".action-menu-container")) {
      const panes = [...deck.querySelectorAll(".sub-action-pane")];
      const activePane = panes.find(
        (pane) => isElementVisible(pane) && paneHasRealOptions(pane)
      );

      /* Empty "No skills available" panes are not a destination. Return to the
         five main options immediately. */
      if (!activePane) {
        closeBattleSubpane(deck);
        continue;
      }

      deck.classList.add("uie-subpane-open");

      for (const pane of panes) {
        const active = pane === activePane;
        pane.dataset.uieActivePane = active ? "true" : "false";

        if (!active) {
          pane.style.setProperty("display", "none", "important");
          continue;
        }

        pane.style.setProperty("display", "block", "important");

        if (!pane.querySelector(".uie-battle-sub-back")) {
          const back = document.createElement("button");
          back.type = "button";
          back.className = "uie-battle-sub-back";
          back.textContent = "← Back";
          back.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeBattleSubpane(deck);
          });
          pane.prepend(back);
        }
      }
    }
  }

  function normalizeBattlePresentation() {
    const screen = document.getElementById("battle-screen");
    if (!screen || !battleIsOpen()) return;

    normalizeBattleLog(screen);
    normalizeSpriteCards(screen);
    normalizeActionDeck(screen);
  }

  function checkBattleOpen() {
    const open = battleIsOpen();
    if (open) normalizeBattlePresentation();
    if (open && !battleWasOpen) {
      /* Battle injects its own CSS during initialization. Place this once
         immediately afterward and once after the opening animation settles. */
      placeStyleAfterBattleCss();
      setTimeout(placeStyleAfterBattleCss, 120);
    }
    battleWasOpen = open;
  }

  const bodyObserver = new MutationObserver(checkBattleOpen);

  function start() {
    ensureStyle();
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
    checkBattleOpen();
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#battle-screen")) return;
    requestAnimationFrame(normalizeBattlePresentation);
    setTimeout(normalizeBattlePresentation, 40);
  }, true);

  window.addEventListener("resize", checkBattleOpen, { passive: true });
  window.addEventListener("orientationchange", checkBattleOpen, { passive: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
