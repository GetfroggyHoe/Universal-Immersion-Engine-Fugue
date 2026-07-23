(() => {
  "use strict";

  if (window.UIE_ImageProviderEndpointSync) return;

  const DEFAULTS = Object.freeze({
    koji:           { url: "", model: "koji-v1" },
    openai:         { url: "https://api.openai.com/v1/images/generations", model: "gpt-image-1" },
    stability:      { url: "https://api.stability.ai/v2beta/stable-image/generate/core", model: "" },
    bfl:            { url: "https://api.bfl.ai/v1/flux-pro-1.1", model: "flux-pro-1.1" },
    imagerouter:    { url: "https://api.imagerouter.io/v1/openai/images/generations", model: "openai/gpt-image-1" },
    google:         { url: "https://generativelanguage.googleapis.com/v1beta", model: "imagen-4.0-generate-001" },
    lmrouter:       { url: "https://api.lmrouter.com/openai/v1/images/generations", model: "stabilityai/stable-diffusion-3.5-large" },
    arouter:        { url: "https://api.arouter.com/v1/images/generations", model: "stabilityai/stable-diffusion-3.5-large" },
    nanogpt:        { url: "https://nano-gpt.com/v1/images/generations", model: "hidream" },
    nvidia_nim:     { url: "https://integrate.api.nvidia.com/v1/images/generations", model: "" },
    comfyui:        { url: "http://127.0.0.1:8188", model: "" },
    automatic1111:  { url: "http://127.0.0.1:7860", model: "" },
    sdnext:         { url: "http://127.0.0.1:7860", model: "" },
    pollinations:   { url: "https://image.pollinations.ai/prompt", model: "flux" },
    together:       { url: "https://api.together.xyz/v1/images/generations", model: "" },
    horde:          { url: "https://stablehorde.net/api/v2/generate/async", model: "" },
    openrouter:     { url: "", model: "" },
    fal:            { url: "", model: "" },
    huggingface:    { url: "", model: "" },
    custom:         { url: "", model: "" }
  });

  let applying = false;
  let lastProvider = "";

  function settings() {
    try {
      return window.Core?.getSettings?.() || null;
    } catch (_) {
      return null;
    }
  }

  function value(selector) {
    const element = document.querySelector(selector);
    return element ? String(element.value || "").trim() : "";
  }

  function setValue(selector, next) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.value = String(next ?? "");
  }

  function normalizeProvider(raw) {
    return String(raw || "openai").trim().toLowerCase() || "openai";
  }

  function currentSnapshot(image) {
    return {
      url: String(image?.url || value("#cfg-image-url") || "").trim(),
      model: String(image?.model || value("#cfg-image-model") || "").trim(),
      key: String(image?.key || value("#cfg-image-key") || "").trim()
    };
  }

  function providerState(image, provider, previousSnapshot, previousProvider) {
    image.providerSettings =
      image.providerSettings && typeof image.providerSettings === "object"
        ? image.providerSettings
        : {};

    const saved =
      image.providerSettings[provider] &&
      typeof image.providerSettings[provider] === "object"
        ? image.providerSettings[provider]
        : {};

    const defaults = DEFAULTS[provider] || { url: "", model: "" };
    let url = String(saved.url || defaults.url || "").trim();
    let model = String(saved.model || defaults.model || "").trim();
    const key = String(
      saved.key ||
      image.providerKeys?.[provider] ||
      image[provider]?.key ||
      ""
    ).trim();

    if (
      provider !== previousProvider &&
      previousSnapshot.url &&
      url === previousSnapshot.url &&
      String(defaults.url || "") !== previousSnapshot.url
    ) {
      url = String(defaults.url || "");
    }
    if (
      provider !== previousProvider &&
      previousSnapshot.model &&
      model === previousSnapshot.model &&
      String(defaults.model || "") !== previousSnapshot.model
    ) {
      model = String(defaults.model || "");
    }

    return { url, model, key };
  }

  function savePrevious(image, provider, snapshot) {
    if (!provider) return;
    image.providerSettings =
      image.providerSettings && typeof image.providerSettings === "object"
        ? image.providerSettings
        : {};

    image.providerSettings[provider] = {
      ...(image.providerSettings[provider] || {}),
      url: snapshot.url,
      model: snapshot.model,
      key: snapshot.key
    };
  }

  function updateSpecialFields(provider, route) {
    if (provider === "stability") {
      setValue("#cfg-image-stability-url", route.url);
      setValue("#cfg-image-stability-key", route.key);
    }
    if (provider === "pollinations") {
      setValue("#cfg-image-pollinations-key", route.key);
      setValue("#cfg-image-pollinations-model", route.model || "flux");
    }
    if (provider === "comfyui") {
      setValue("#cfg-image-comfy-url", route.url);
      setValue("#cfg-image-comfy-key", route.key);
    }
    if (provider === "automatic1111" || provider === "sdnext") {
      setValue(
        "#cfg-image-sd-url",
        route.url.replace(/\/sdapi\/v1\/txt2img\s*$/i, "")
      );
    }
  }

  function applyProvider(rawProvider, previous = "") {
    if (applying) return;

    const s = settings();
    if (!s) return;

    applying = true;
    try {
      s.image = s.image && typeof s.image === "object" ? s.image : {};

      const provider = normalizeProvider(rawProvider);
      const oldProvider = normalizeProvider(previous || lastProvider || s.image.provider);
      const oldSnapshot = currentSnapshot(s.image);

      if (oldProvider && oldProvider !== provider) {
        savePrevious(s.image, oldProvider, oldSnapshot);
      }

      const route = providerState(s.image, provider, oldSnapshot, oldProvider);

      s.image.provider = provider;
      s.image.url = route.url;
      s.image.model = route.model;
      s.image.key = route.key;
      s.image.providerSettings[provider] = {
        ...(s.image.providerSettings[provider] || {}),
        ...route
      };

      if (provider === "pollinations") {
        s.image.pollinationsKey = route.key;
        s.image.pollinationsModel = route.model || "flux";
      }
      if (provider === "comfyui") {
        s.image.comfy = {
          ...(s.image.comfy || {}),
          url: route.url,
          key: route.key
        };
      }
      if (provider === "automatic1111" || provider === "sdnext") {
        s.image.sdwebui = {
          ...(s.image.sdwebui || {}),
          url: route.url.replace(/\/sdapi\/v1\/txt2img\s*$/i, "")
        };
      }

      setValue("#cfg-image-provider", provider);
      setValue("#q-img-provider", provider);
      setValue("#cfg-image-url", route.url);
      setValue("#cfg-image-model", route.model);
      setValue("#cfg-image-key", route.key);
      setValue("#cfg-image-model-select", route.model);
      updateSpecialFields(provider, route);

      window.Core?.saveSettings?.();
      lastProvider = provider;

      window.dispatchEvent(
        new CustomEvent("uie:image-provider-route-changed", {
          detail: { provider, ...route }
        })
      );
    } finally {
      applying = false;
    }
  }

  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.id !== "cfg-image-provider" && target.id !== "q-img-provider") return;

      const selected = normalizeProvider(target.value);
      const s = settings();
      const previous = normalizeProvider(
        lastProvider || s?.image?.provider || "openai"
      );

      queueMicrotask(() => applyProvider(selected, previous));
    },
    true
  );

  const initial = settings();
  lastProvider = normalizeProvider(initial?.image?.provider || "openai");

  window.UIE_ImageProviderEndpointSync = Object.freeze({
    defaults: DEFAULTS,
    apply: applyProvider
  });
})();
