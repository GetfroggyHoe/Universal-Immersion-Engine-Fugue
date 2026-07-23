(() => {
  "use strict";

  if (window.__uieReplyKeyboardTouchFixInstalled) return;
  window.__uieReplyKeyboardTouchFixInstalled = true;

  const LAYOUT_KEY = "uie.replyKeyboard.layout.v4";
  const MIN_WIDTH = 242;
  const MIN_HEIGHT = 220;
  const DEFAULT_WIDTH = 308;
  const DEFAULT_HEIGHT = 300;

  function install() {
    const panel = document.getElementById("reply-keyboard-panel");
    const input = document.getElementById("user-input");
    if (!panel || !input) return false;
    if (panel.dataset.uieTouchKeyboardFixed === "true") return true;
    panel.dataset.uieTouchKeyboardFixed = "true";

    let caretStart = Number.isFinite(input.selectionStart)
      ? input.selectionStart
      : input.value.length;
    let caretEnd = Number.isFinite(input.selectionEnd)
      ? input.selectionEnd
      : caretStart;
    let originalReadOnly = input.readOnly;
    let originalInputMode = input.getAttribute("inputmode");
    let originalPolicy = input.getAttribute("virtualkeyboardpolicy");
    let resizing = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startWidth = DEFAULT_WIDTH;
    let startHeight = DEFAULT_HEIGHT;
    let panelLeft = 0;
    let panelTop = 0;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const isOpen = () => panel.classList.contains("active");

    const captureCaret = () => {
      try {
        if (Number.isFinite(input.selectionStart)) caretStart = input.selectionStart;
        if (Number.isFinite(input.selectionEnd)) caretEnd = input.selectionEnd;
      } catch (_) {
        caretStart = input.value.length;
        caretEnd = caretStart;
      }
    };

    const setCaret = (start, end = start) => {
      caretStart = clamp(Number(start) || 0, 0, input.value.length);
      caretEnd = clamp(Number(end) || caretStart, caretStart, input.value.length);
      try { input.setSelectionRange(caretStart, caretEnd); } catch (_) {}
    };

    const updatePredictions = () => {
      const host = document.getElementById("reply-keyboard-predictions");
      if (!host) return;
      const bank = [
        "I understand",
        "Tell me more",
        "What happened next?",
        "Let us take a moment",
        "I need some space",
        "Can we try again?",
        "Thank you",
        "I am listening"
      ];
      const word = String(input.value || "")
        .slice(0, caretStart)
        .split(/\s+/)
        .pop()
        .toLowerCase();
      const choices = bank
        .filter((item) => !word || item.toLowerCase().startsWith(word))
        .slice(0, 3);
      host.innerHTML = choices.map((item) => {
        const safe = item.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        return `<button type="button" class="reply-prediction" data-prediction="${safe}" role="option">${item}</button>`;
      }).join("");
    };

    const emitInput = () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      updatePredictions();
    };

    const writeValue = (value, nextCaret) => {
      input.value = value;
      setCaret(nextCaret, nextCaret);
      emitInput();
    };

    const insertText = (text) => {
      const start = clamp(caretStart, 0, input.value.length);
      const end = clamp(caretEnd, start, input.value.length);
      writeValue(
        input.value.slice(0, start) + text + input.value.slice(end),
        start + text.length
      );
    };

    const backspace = () => {
      const start = clamp(caretStart, 0, input.value.length);
      const end = clamp(caretEnd, start, input.value.length);
      if (start !== end) {
        writeValue(input.value.slice(0, start) + input.value.slice(end), start);
      } else if (start > 0) {
        writeValue(
          input.value.slice(0, start - 1) + input.value.slice(start),
          start - 1
        );
      }
    };

    const lockNativeKeyboard = () => {
      captureCaret();
      originalReadOnly = input.readOnly;
      originalInputMode = input.getAttribute("inputmode");
      originalPolicy = input.getAttribute("virtualkeyboardpolicy");
      try { input.blur(); } catch (_) {}
      input.readOnly = true;
      input.setAttribute("inputmode", "none");
      input.setAttribute("virtualkeyboardpolicy", "manual");
      input.setAttribute("data-uie-virtual-locked", "true");
      document.documentElement.classList.add("uie-virtual-keyboard-open");
    };

    const unlockNativeKeyboard = () => {
      input.readOnly = originalReadOnly;
      if (originalInputMode == null) input.removeAttribute("inputmode");
      else input.setAttribute("inputmode", originalInputMode);
      if (originalPolicy == null) input.removeAttribute("virtualkeyboardpolicy");
      else input.setAttribute("virtualkeyboardpolicy", originalPolicy);
      input.removeAttribute("data-uie-virtual-locked");
      document.documentElement.classList.remove("uie-virtual-keyboard-open");
    };

    const viewport = () => ({
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight)
    });

    const clampPanel = () => {
      const view = viewport();
      const rect = panel.getBoundingClientRect();
      const width = clamp(rect.width || DEFAULT_WIDTH, MIN_WIDTH, Math.max(MIN_WIDTH, view.width - 12));
      const height = clamp(rect.height || DEFAULT_HEIGHT, MIN_HEIGHT, Math.max(MIN_HEIGHT, view.height - 12));
      const left = clamp(rect.left, 6, Math.max(6, view.width - width - 6));
      const top = clamp(rect.top, 6, Math.max(6, view.height - height - 6));
      Object.assign(panel.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        right: "auto",
        bottom: "auto",
        width: `${width}px`,
        height: `${height}px`,
        transform: "none",
        margin: "0"
      });
    };

    const saveLayout = () => {
      try {
        const rect = panel.getBoundingClientRect();
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        }));
      } catch (_) {}
    };

    const restoreLayout = () => {
      const view = viewport();
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"); } catch (_) {}
      const width = clamp(Number(saved?.width) || DEFAULT_WIDTH, MIN_WIDTH, Math.max(MIN_WIDTH, view.width - 12));
      const height = clamp(Number(saved?.height) || DEFAULT_HEIGHT, MIN_HEIGHT, Math.max(MIN_HEIGHT, view.height - 12));
      const fallbackLeft = Math.max(6, (view.width - width) / 2);
      const fallbackTop = Math.max(6, view.height - height - 72);
      const rawLeft = Number(saved?.left);
      const rawTop = Number(saved?.top);
      const left = clamp(Number.isFinite(rawLeft) ? rawLeft : fallbackLeft, 6, Math.max(6, view.width - width - 6));
      const top = clamp(Number.isFinite(rawTop) ? rawTop : fallbackTop, 6, Math.max(6, view.height - height - 6));
      Object.assign(panel.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        right: "auto",
        bottom: "auto",
        width: `${width}px`,
        height: `${height}px`,
        transform: "none",
        margin: "0"
      });
    };

    const syncOpenState = () => {
      if (isOpen()) {
        if (panel.parentElement !== document.body) document.body.appendChild(panel);
        restoreLayout();
        lockNativeKeyboard();
        updatePredictions();
      } else {
        unlockNativeKeyboard();
        saveLayout();
      }
    };

    const observer = new MutationObserver(syncOpenState);
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });

    document.addEventListener("pointerdown", (event) => {
      const toggle = event.target instanceof Element
        ? event.target.closest("#reply-keyboard-toggle")
        : null;
      if (toggle) {
        captureCaret();
        try { input.blur(); } catch (_) {}
        return;
      }

      if (!isOpen() || event.target !== input) return;
      captureCaret();
      event.preventDefault();
      event.stopImmediatePropagation();
      try { input.blur(); } catch (_) {}
    }, true);

    document.addEventListener("focusin", (event) => {
      if (!isOpen() || event.target !== input) return;
      captureCaret();
      try { input.blur(); } catch (_) {}
    }, true);

    document.addEventListener("click", (event) => {
      if (!isOpen()) return;
      const target = event.target instanceof Element ? event.target : null;
      const key = target?.closest(".reply-keyboard-key, .reply-keyboard-mini");
      if (key) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const action = String(key.getAttribute("data-action") || "");
        const value = String(key.getAttribute("data-key") || key.textContent || "");
        if (action === "backspace") backspace();
        else if (action === "space") insertText(" ");
        else if (action === "enter") insertText("\n");
        else insertText(value);
        return;
      }

      const prediction = target?.closest(".reply-prediction");
      if (prediction) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const phrase = String(prediction.getAttribute("data-prediction") || "");
        if (!phrase) return;
        const start = clamp(caretStart, 0, input.value.length);
        const before = input.value.slice(0, start).replace(/[^\s]*$/, "");
        const suffix = input.value.slice(clamp(caretEnd, start, input.value.length));
        const inserted = `${before}${phrase} `;
        writeValue(inserted + suffix, inserted.length);
      }
    }, true);

    const resizeHandle = panel.querySelector(".reply-keyboard-resize");
    resizeHandle?.addEventListener("pointerdown", (event) => {
      if (!isOpen()) return;
      const rect = panel.getBoundingClientRect();
      resizing = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      panelLeft = rect.left;
      panelTop = rect.top;
      resizeHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });

    document.addEventListener("pointermove", (event) => {
      if (!resizing || (pointerId != null && event.pointerId !== pointerId)) return;
      const view = viewport();
      const maxWidth = Math.max(MIN_WIDTH, view.width - panelLeft - 6);
      const maxHeight = Math.max(MIN_HEIGHT, view.height - panelTop - 6);
      panel.style.width = `${clamp(startWidth + event.clientX - startX, MIN_WIDTH, maxWidth)}px`;
      panel.style.height = `${clamp(startHeight + event.clientY - startY, MIN_HEIGHT, maxHeight)}px`;
      event.preventDefault();
    }, { capture: true, passive: false });

    const finishResize = (event) => {
      if (!resizing || (pointerId != null && event.pointerId !== pointerId)) return;
      resizing = false;
      pointerId = null;
      clampPanel();
      saveLayout();
    };
    document.addEventListener("pointerup", finishResize, true);
    document.addEventListener("pointercancel", finishResize, true);

    window.addEventListener("resize", () => {
      if (isOpen()) requestAnimationFrame(clampPanel);
    }, { passive: true });

    updatePredictions();
    syncOpenState();
    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("DOMContentLoaded", install, { once: true });
  }
})();
