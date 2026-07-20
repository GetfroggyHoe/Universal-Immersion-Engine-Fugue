const DEFAULT_TIMEOUT_MS = 3000;

function getTemplateTimeoutMs() {
  try {
    const configured = Number(window.UIE_TEMPLATE_TIMEOUT_MS);
    if (Number.isFinite(configured) && configured > 0) return configured;
  } catch (_) {}
  return DEFAULT_TIMEOUT_MS;
}

function makeTimeoutError(url) {
  const err = new Error(`Template fetch timed out: ${url}`);
  err.name = "UIETemplateTimeout";
  return err;
}

async function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "default", credentials: "same-origin", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } catch (err) {
    if (String(err?.name || "") === "AbortError") throw makeTimeoutError(url);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function ajaxWithTimeout(url, timeoutMs) {
  if (!window.$?.ajax) throw new Error("jQuery ajax is not available");
  try {
    return await window.$.ajax({ url, method: "GET", timeout: timeoutMs, cache: true });
  } catch (err) {
    if (String(err?.statusText || "") === "timeout") throw makeTimeoutError(url);
    throw err;
  }
}

export async function fetchTemplateHtml(url) {
  const timeoutMs = getTemplateTimeoutMs();
  let fetchErr = null;
  try {
    return await fetchWithTimeout(url, timeoutMs);
  } catch (err) {
    fetchErr = err;
  }

  // The full timeout budget was already consumed. jQuery uses the same browser
  // transport here, so retrying only doubles template and startup latency.
  if (fetchErr?.name === "UIETemplateTimeout") throw fetchErr;

  try {
    return await ajaxWithTimeout(url, timeoutMs);
  } catch (jqErr) {
    if (fetchErr?.name === "UIETemplateTimeout" || jqErr?.name === "UIETemplateTimeout") {
      throw makeTimeoutError(url);
    }
    const err = new Error(`Template fetch failed: ${url}`, { cause: jqErr });
    err.fetchError = fetchErr;
    err.ajaxError = jqErr;
    throw err;
  }
}
