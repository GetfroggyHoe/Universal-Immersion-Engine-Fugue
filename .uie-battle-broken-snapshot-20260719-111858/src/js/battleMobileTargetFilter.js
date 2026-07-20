(() => {
  "use strict";

  let scheduled = 0;

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hpCount(text) {
    return (String(text || "").match(/\bHP\s*\d+\s*\/\s*\d+\b/gi) || []).length;
  }

  function isSystemTarget(text) {
    const value = normalize(text);

    if (!value || hpCount(value) !== 1) return false;

    /* These subtitles identify synthetic stage/tracker entries. */
    if (/\bBattle Tracker\b/i.test(value)) return true;
    if (/\bStage\s*[-–—]\s*HP\s*\d+\s*\/\s*\d+\b/i.test(value)) return true;

    /* Exact known synthetic rows, but only when paired with their stage
       subtitle. A real character named Focus is not removed. */
    return /^(?:Custom|First Aid|Focus)\b.*\bStage\s*[-–—]\s*HP\b/i.test(value);
  }

  function findBattleTargetModal() {
    const headings = document.querySelectorAll(
      "h1, h2, h3, [role='heading'], .modal-title, .uie-modal-title"
    );

    for (const heading of headings) {
      if (!/^battle target$/i.test(normalize(heading.textContent))) continue;

      let node = heading.parentElement;
      while (node && node !== document.body) {
        const text = normalize(node.innerText);
        const rect = node.getBoundingClientRect();

        if (
          /^battle target\b/i.test(text) &&
          hpCount(text) >= 1 &&
          rect.width >= 240 &&
          rect.height >= 160
        ) {
          return node;
        }

        node = node.parentElement;
      }
    }

    return null;
  }

  function findSingleTargetRow(start, modal) {
    let node = start;
    let best = null;

    while (node && node !== modal) {
      if (node instanceof HTMLElement) {
        const text = normalize(node.innerText);
        const rect = node.getBoundingClientRect();

        if (
          isSystemTarget(text) &&
          rect.width >= 160 &&
          rect.height >= 38 &&
          rect.height <= 190
        ) {
          best = node;

          const parentText = normalize(node.parentElement?.innerText);
          if (hpCount(parentText) > 1 || /^battle target\b/i.test(parentText)) {
            break;
          }
        }
      }

      node = node.parentElement;
    }

    return best;
  }

  function hideSystemRows() {
    const modal = findBattleTargetModal();
    if (!modal) return;

    const rows = new Set();

    for (const element of modal.querySelectorAll(
      "button, [role='button'], li, [data-target], [data-target-id], " +
      ".battle-target-row, .target-row, .modal-list-item, div"
    )) {
      if (!isSystemTarget(element.innerText)) continue;
      const row = findSingleTargetRow(element, modal);
      if (row) rows.add(row);
    }

    for (const row of rows) {
      row.hidden = true;
      row.setAttribute("aria-hidden", "true");
      row.dataset.uieSystemTargetHidden = "true";
      row.style.setProperty("display", "none", "important");
      row.style.setProperty("pointer-events", "none", "important");
    }
  }

  function update() {
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(hideSystemRows);
  }

  const observer = new MutationObserver(update);

  function start() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    update();
  }

  document.addEventListener("click", update, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
