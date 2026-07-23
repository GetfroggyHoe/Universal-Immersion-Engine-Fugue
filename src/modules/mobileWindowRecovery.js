(() => {
  "use strict";

  if (window.UIE_MobileWindowRecovery) return;

  const isMobileLandscape = () => {
    try {
      return window.matchMedia(
        "(pointer: coarse) and (orientation: landscape)"
      ).matches;
    } catch (_) {
      return false;
    }
  };

  const lorebookSelector = [
    "#lorebook-modal",
    "#lorebook-window",
    "#lorebook-manager",
    "#uie-lorebook-window",
    ".lorebook-modal",
    ".lorebook-window",
    ".uie-lorebook-window",
    "[id*='lorebook' i][role='dialog']",
    "[id*='lorebook' i].uie-window",
    "[class*='lorebook' i][class*='modal' i]",
    "[class*='lorebook' i][class*='window' i]",
    "body > [id*='lorebook' i]"
  ].join(",");

  function repairInventoryHeader() {
    if (!isMobileLandscape()) return;

    const inventory = document.getElementById("uie-inventory-window");
    if (!inventory) return;

    const actions = inventory.querySelector(".uie-inv-actions");
    const picker = inventory.querySelector(".window-bg-btn");
    if (!actions || !picker) return;

    picker.removeAttribute("style");
    picker.classList.add("uie-inv-icon", "uie-inv-background-picker");
    picker.setAttribute("aria-label", "Choose inventory background");
    picker.setAttribute("title", "Choose inventory background");

    const close = actions.querySelector(".uie-inv-close");
    if (picker.parentElement !== actions) {
      if (close) actions.insertBefore(picker, close);
      else actions.appendChild(picker);
    } else if (close && picker.nextElementSibling !== close) {
      actions.insertBefore(picker, close);
    }
  }

  function repairLorebook(root) {
    if (!(root instanceof Element) || root.dataset.uieMobileRecovered === "1") {
      return;
    }

    root.dataset.uieMobileRecovered = "1";

    const stopWorldSwipe = (event) => {
      event.stopPropagation();
    };

    root.addEventListener("touchstart", stopWorldSwipe, { passive: true });
    root.addEventListener("touchmove", stopWorldSwipe, { passive: true });
    root.addEventListener("pointerdown", stopWorldSwipe, true);
  }

  function repairVisibleWindows() {
    repairInventoryHeader();

    if (!isMobileLandscape()) return;

    document.querySelectorAll(lorebookSelector).forEach(repairLorebook);

    const diary = document.getElementById("uie-diary-window");
    if (diary) diary.dataset.uieMobileRecovered = "1";
  }

  const observer = new MutationObserver(() => {
    requestAnimationFrame(repairVisibleWindows);
  });

  const begin = () => {
    repairVisibleWindows();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "aria-hidden"]
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", begin, { once: true });
  } else {
    begin();
  }

  window.addEventListener("resize", repairVisibleWindows, { passive: true });
  window.addEventListener("orientationchange", repairVisibleWindows, {
    passive: true
  });

  window.UIE_MobileWindowRecovery = Object.freeze({
    repair: repairVisibleWindows
  });
})();
