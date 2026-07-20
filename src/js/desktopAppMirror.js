(() => {
  "use strict";

  const media = window.matchMedia(
    "(pointer: coarse) and (orientation: landscape)"
  );

  const SPECS = [
    {
      roots: "#uie-party-window",
      canvas: ".party-shell",
      designWidth: 1536,
    },
    {
      roots: "#uie-factions-window",
      canvas: ".uie-org-shell",
      designWidth: 1536,
    },
    {
      roots: "#uie-map-window, #uie-surroundings-window, #surroundings-local-area",
      canvas: ".uie-simple-map__shell",
      designWidth: 1536,
    },
    {
      roots: "#uie-inventory-window",
      canvas: ".uie-inv-panel",
      designWidth: 1540,
    },
  ];

  let frame = 0;
  let applying = false;

  function viewport() {
    const vv = window.visualViewport;
    return {
      width: Math.max(1, vv?.width || window.innerWidth),
      height: Math.max(1, vv?.height || window.innerHeight),
      left: Math.max(0, vv?.offsetLeft || 0),
      top: Math.max(0, vv?.offsetTop || 0),
    };
  }

  function isVisible(element) {
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      element.getClientRects().length > 0
    );
  }

  function setImportant(style, property, value) {
    if (style.getPropertyValue(property) === value &&
        style.getPropertyPriority(property) === "important") return;
    style.setProperty(property, value, "important");
  }

  function setVariable(style, property, value) {
    if (style.getPropertyValue(property) === value) return;
    style.setProperty(property, value);
  }

  function clearElement(element, className, properties = []) {
    if (!element) return;
    element.classList.remove(className);
    for (const property of properties) element.style.removeProperty(property);
  }

  function clearAll() {
    document.documentElement.classList.remove("uie-mobile-desktop-app");
    document.body.classList.remove("uie-major-app-open");

    for (const spec of SPECS) {
      for (const root of document.querySelectorAll(spec.roots)) {
        const canvas = root.querySelector(spec.canvas);
        clearElement(root, "uie-mobile-desktop-root", [
          "left", "top", "right", "bottom", "width", "height",
          "--uie-physical-width", "--uie-physical-height",
        ]);
        clearElement(canvas, "uie-mobile-desktop-canvas", [
          "width", "height", "transform", "transform-origin",
          "--uie-design-width", "--uie-design-height", "--uie-app-scale",
        ]);
      }
    }
  }

  function fit(root, spec, vp) {
    const canvas = root.querySelector(spec.canvas);
    if (!canvas) {
      console.warn("[UIE mobile desktop app] Canvas missing", root.id, spec.canvas);
      return false;
    }

    const scale = vp.width / spec.designWidth;
    const designHeight = vp.height / scale;

    root.classList.add("uie-mobile-desktop-root");
    canvas.classList.add("uie-mobile-desktop-canvas");

    setImportant(root.style, "left", `${vp.left}px`);
    setImportant(root.style, "top", `${vp.top}px`);
    setImportant(root.style, "right", "auto");
    setImportant(root.style, "bottom", "auto");
    setImportant(root.style, "width", `${vp.width}px`);
    setImportant(root.style, "height", `${vp.height}px`);
    setVariable(root.style, "--uie-physical-width", `${vp.width}px`);
    setVariable(root.style, "--uie-physical-height", `${vp.height}px`);

    setVariable(canvas.style, "--uie-design-width", `${spec.designWidth}px`);
    setVariable(canvas.style, "--uie-design-height", `${designHeight}px`);
    setVariable(canvas.style, "--uie-app-scale", String(scale));
    setImportant(canvas.style, "width", `${spec.designWidth}px`);
    setImportant(canvas.style, "height", `${designHeight}px`);
    setImportant(canvas.style, "transform-origin", "top left");
    setImportant(canvas.style, "transform", `scale(${scale})`);

    return true;
  }

  function update() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (applying) return;
      applying = true;
      try {
        if (!media.matches) {
          clearAll();
          return;
        }

        document.documentElement.classList.add("uie-mobile-desktop-app");
        const vp = viewport();
        let anyOpen = false;

        for (const spec of SPECS) {
          for (const root of document.querySelectorAll(spec.roots)) {
            const canvas = root.querySelector(spec.canvas);
            if (!isVisible(root)) {
              clearElement(root, "uie-mobile-desktop-root", [
                "left", "top", "right", "bottom", "width", "height",
                "--uie-physical-width", "--uie-physical-height",
              ]);
              clearElement(canvas, "uie-mobile-desktop-canvas", [
                "width", "height", "transform", "transform-origin",
                "--uie-design-width", "--uie-design-height", "--uie-app-scale",
              ]);
              continue;
            }
            anyOpen = fit(root, spec, vp) || anyOpen;
          }
        }

        document.body.classList.toggle("uie-major-app-open", anyOpen);
      } finally {
        applying = false;
      }
    });
  }

  const observer = new MutationObserver(() => {
    if (!applying) update();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "style"],
  });

  window.addEventListener("resize", update, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(update, 120), {
    passive: true,
  });
  window.visualViewport?.addEventListener("resize", update, { passive: true });
  window.visualViewport?.addEventListener("scroll", update, { passive: true });
  media.addEventListener?.("change", update);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", update, { once: true });
  } else {
    update();
  }
})();
