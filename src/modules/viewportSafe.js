const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function viewportBox() {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    return {
        left: finite(vv?.offsetLeft, 0),
        top: finite(vv?.offsetTop, 0),
        width: Math.max(0, finite(vv?.width, window.innerWidth || document.documentElement?.clientWidth || 0)),
        height: Math.max(0, finite(vv?.height, window.innerHeight || document.documentElement?.clientHeight || 0))
    };
}

export function clampViewportPosition(left, top, width, height, margin = 12, viewport = viewportBox()) {
    const safe = Math.max(0, finite(margin, 12));
    const w = Math.max(1, finite(width, 1));
    const h = Math.max(1, finite(height, 1));
    const minLeft = viewport.left + safe;
    const minTop = viewport.top + safe;
    const maxLeft = Math.max(minLeft, viewport.left + viewport.width - w - safe);
    const maxTop = Math.max(minTop, viewport.top + viewport.height - h - safe);
    return {
        left: Math.max(minLeft, Math.min(maxLeft, finite(left, minLeft))),
        top: Math.max(minTop, Math.min(maxTop, finite(top, minTop)))
    };
}

export function defaultViewportPosition(width, height, anchor = "bottom-right", margin = 18, viewport = viewportBox()) {
    const safe = Math.max(0, finite(margin, 18));
    const w = Math.max(1, finite(width, 1));
    const h = Math.max(1, finite(height, 1));
    const horizontal = anchor.includes("right") ? viewport.left + viewport.width - w - safe
        : anchor.includes("center") ? viewport.left + (viewport.width - w) / 2
        : viewport.left + safe;
    const vertical = anchor.includes("bottom") ? viewport.top + viewport.height - h - safe
        : anchor.includes("center") ? viewport.top + (viewport.height - h) / 2
        : viewport.top + safe;
    return clampViewportPosition(horizontal, vertical, w, h, safe, viewport);
}

export function recoverElementToViewport(element, options = {}) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const width = rect.width || element.offsetWidth || finite(options.width, 48);
    const height = rect.height || element.offsetHeight || finite(options.height, 48);
    const margin = finite(options.margin, 12);
    const viewport = options.viewport || viewportBox();
    const fallback = defaultViewportPosition(width, height, options.anchor || "bottom-right", margin, viewport);
    const reset = options.reset === true;
    const currentLeft = reset ? fallback.left : finite(options.left, rect.left);
    const currentTop = reset ? fallback.top : finite(options.top, rect.top);
    const position = clampViewportPosition(currentLeft, currentTop, width, height, margin, viewport);
    element.style.position = "fixed";
    element.style.left = `${Math.round(position.left)}px`;
    element.style.top = `${Math.round(position.top)}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.transform = options.preserveTransform ? element.style.transform : "none";
    return position;
}
