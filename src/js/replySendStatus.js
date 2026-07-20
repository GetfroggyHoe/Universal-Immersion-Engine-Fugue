(() => {
  "use strict";

  const STATUS_ID = "reply-generation-status";
  const utilitiesId = "reply-send-utilities";
  const sendId = "send-btn";
  const hudStatusId = "hud-api-status";

  let state = navigator.onLine ? "active" : "inactive";
  let generationInFlight = false;
  let clickFallbackTimer = 0;

  const labels = {
    active: "AI active and ready",
    done: "Generation complete",
    generating: "AI is generating",
    failed: "Generation failed",
    inactive: "AI inactive or disconnected",
  };

  function utilities() {
    return document.getElementById(utilitiesId);
  }

  function isLikelyLegacyDot(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.id === STATUS_ID || element.id === "reply-image-attach") return false;
    if (!element.matches("span, i, div")) return false;

    const identity = `${element.id} ${element.className}`.toLowerCase();
    if (/(status|state|indicator|connection|activity|active|dot)/.test(identity)) {
      return true;
    }

    if (element.textContent.trim() || element.childElementCount) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.width <= 18 && rect.height > 0 && rect.height <= 18;
  }

  function removeLegacyDots(container) {
    for (const child of [...container.children]) {
      if (isLikelyLegacyDot(child)) child.remove();
    }
  }

  function ensureDot() {
    const container = utilities();
    if (!container) return null;

    removeLegacyDots(container);

    let dot = document.getElementById(STATUS_ID);
    if (!dot) {
      dot = document.createElement("span");
      dot.id = STATUS_ID;
      dot.className = "reply-generation-status";
      dot.setAttribute("role", "status");
      dot.setAttribute("aria-live", "polite");
      container.appendChild(dot);
    } else if (dot.parentElement !== container) {
      container.appendChild(dot);
    }

    return dot;
  }

  function setState(nextState, detail = "") {
    const valid = new Set(["active", "done", "generating", "failed", "inactive"]);
    state = valid.has(nextState) ? nextState : "inactive";
    generationInFlight = state === "generating";

    const dot = ensureDot();
    if (!dot) return;

    const title = detail ? `${labels[state]} — ${detail}` : labels[state];
    dot.dataset.state = state;
    dot.title = title;
    dot.setAttribute("aria-label", title);
  }

  function phaseToState(rawPhase) {
    const phase = String(rawPhase || "").trim().toLowerCase();

    if (["start", "starting", "request", "generating", "progress", "streaming"].includes(phase)) {
      return "generating";
    }
    if (["end", "done", "complete", "completed", "success", "ready"].includes(phase)) {
      return "done";
    }
    if (["error", "failed", "failure", "abort", "aborted", "cancelled", "canceled"].includes(phase)) {
      return "failed";
    }
    if (["inactive", "offline", "disconnected", "disabled"].includes(phase)) {
      return "inactive";
    }
    if (["active", "online", "connected", "idle"].includes(phase)) {
      return "active";
    }

    return "";
  }

  function handleGenerationEvent(event) {
    const detail = event?.detail || {};
    const mapped = phaseToState(detail.phase || detail.status || detail.state);

    if (mapped) {
      setState(mapped, detail.error || detail.message || detail.route || "");
      if (mapped === "done") {
        setTimeout(() => {
          if (!generationInFlight) setState("active");
        }, 900);
      }
    }
  }

  function readHudStatus() {
    const text = String(document.getElementById(hudStatusId)?.textContent || "")
      .trim()
      .toLowerCase();

    if (!text) return;
    if (/(failed|failure|error|offline|inactive|disconnected)/.test(text)) {
      setState(text.includes("offline") || text.includes("inactive") ? "inactive" : "failed", text);
      return;
    }
    if (/(ai main|ai turbo|generat|stream|working|request)/.test(text)) {
      setState("generating", text);
      return;
    }
    if (/(done|ready|active|connected|\btok\b|tokens?)/.test(text)) {
      setState("active", text);
    }
  }

  function observeSendButton() {
    const send = document.getElementById(sendId);
    if (!send || send.dataset.uieStatusObserved === "true") return;

    send.dataset.uieStatusObserved = "true";

    send.addEventListener(
      "click",
      () => {
        if (send.disabled) return;
        clearTimeout(clickFallbackTimer);
        setState("generating");
        clickFallbackTimer = window.setTimeout(() => {
          if (generationInFlight && !send.disabled) setState("active");
        }, 3000);
      },
      true
    );

    new MutationObserver(() => {
      if (generationInFlight) return;
      setState(send.disabled ? "inactive" : navigator.onLine ? "active" : "inactive");
    }).observe(send, {
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "class"],
    });
  }

  function observeHudStatus() {
    const hud = document.getElementById(hudStatusId);
    if (!hud || hud.dataset.uieStatusObserved === "true") return;

    hud.dataset.uieStatusObserved = "true";
    new MutationObserver(readHudStatus).observe(hud, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    readHudStatus();
  }

  function install() {
    ensureDot();
    observeSendButton();
    observeHudStatus();
    setState(navigator.onLine ? "active" : "inactive");
  }

  window.addEventListener("uie-generation", handleGenerationEvent);
  for (const eventName of [
    "uie-generation-start",
    "uie-generation-end",
    "uie-generation-error",
    "uie-generation-failed",
    "uie-api-status",
  ]) {
    window.addEventListener(eventName, handleGenerationEvent);
  }

  window.addEventListener("online", () => {
    if (!generationInFlight) setState("active");
  });
  window.addEventListener("offline", () => setState("inactive"));

  window.UIEGenerationStatus = Object.freeze({
    set: setState,
    active: (detail = "") => setState("active", detail),
    generating: (detail = "") => setState("generating", detail),
    done: (detail = "") => {
      setState("done", detail);
      setTimeout(() => setState("active"), 900);
    },
    failed: (detail = "") => setState("failed", detail),
    inactive: (detail = "") => setState("inactive", detail),
    get state() {
      return state;
    },
  });

  const observer = new MutationObserver(() => {
    install();
    const container = utilities();
    if (container) removeLegacyDots(container);
    ensureDot();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
