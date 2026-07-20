(() => {
  "use strict";

  const root = document.documentElement;
  const media = window.matchMedia("(pointer: coarse) and (orientation: landscape)");
  let frame = 0;
  let hudObserver = null;

  function getViewport() {
    const vv = window.visualViewport;
    return {
      width: Math.max(1, vv?.width || window.innerWidth),
      height: Math.max(1, vv?.height || window.innerHeight),
    };
  }

  function clearFit() {
    root.classList.remove("uie-fluid-landscape");
    root.style.removeProperty("--uie-chrome-scale");
    root.style.removeProperty("--uie-vn-width");
    root.style.removeProperty("--uie-vn-pad-left");
    root.style.removeProperty("--uie-vn-pad-right");
  }

  function updateFit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!media.matches) {
        clearFit();
        return;
      }

      const { width, height } = getViewport();

      /*
       * Reference dimensions describe the desktop chrome, not a fixed game
       * canvas. The world and full-screen applications remain 100vw × 100dvh.
       */
      const scale = Math.max(
        0.60,
        Math.min(0.88, width / 1180, height / 600)
      );

      root.classList.add("uie-fluid-landscape");
      root.style.setProperty("--uie-chrome-scale", scale.toFixed(4));

      /*
       * Measure the already-scaled HUD in physical CSS pixels. The composer
       * begins 18px after it and receives every remaining pixel.
       */
      requestAnimationFrame(() => {
        const hud = document.getElementById("hud");
        const hudRect = hud?.getBoundingClientRect();
        const left = Math.min(
          width * 0.42,
          Math.max(8, (hudRect?.right || 0) + 18)
        );
        const right = 8;

        root.style.setProperty("--uie-vn-width", `${width / scale}px`);
        root.style.setProperty("--uie-vn-pad-left", `${left / scale}px`);
        root.style.setProperty("--uie-vn-pad-right", `${right / scale}px`);
      });
    });
  }

  function connectHudObserver() {
    const hud = document.getElementById("hud");
    if (!hud || typeof ResizeObserver !== "function") return;
    hudObserver?.disconnect();
    hudObserver = new ResizeObserver(updateFit);
    hudObserver.observe(hud);
  }

  window.addEventListener("resize", updateFit, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(updateFit, 120), {
    passive: true,
  });
  window.visualViewport?.addEventListener("resize", updateFit, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateFit, { passive: true });
  media.addEventListener?.("change", updateFit);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      connectHudObserver();
      updateFit();
    }, { once: true });
  } else {
    connectHudObserver();
    updateFit();
  }

  /*
   * Templates can recreate the HUD. Reconnect without changing application
   * layout or opening a separate mobile mode.
   */
  new MutationObserver(() => {
    if (!hudObserver && document.getElementById("hud")) connectHudObserver();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
