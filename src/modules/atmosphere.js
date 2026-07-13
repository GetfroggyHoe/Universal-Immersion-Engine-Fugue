
import { getSettings, saveSettings } from "./core.js";
import { advanceWorldTimeMinutes, ensurePlayerClock, ensureTimeProgress } from "./timeProgress.js";
import { ensureCalendar, renderCalendar } from "./calendar.js";

const TIME_FILTERS = {
    night: "brightness(0.6) hue-rotate(240deg) contrast(1.1)",
    sunset: "sepia(0.4) hue-rotate(-30deg) contrast(1.1)",
    day: "none"
};

const WEATHER_EFFECTS = {
    rain: "rain",
    storm: "rain", // Storm uses rain + maybe darker filter
    snow: "snow",
    fog: "fog",
    clear: ""
};

function ensureLayers() {
    const stage = document.getElementById("reality-stage");
    if (!stage) return;

    if (!document.getElementById("re-time-filter")) {
        const tf = document.createElement("div");
        tf.id = "re-time-filter";
        tf.style.position = "absolute";
        tf.style.top = "0";
        tf.style.left = "0";
        tf.style.width = "100%";
        tf.style.height = "100%";
        tf.style.pointerEvents = "none";
        tf.style.zIndex = "10";
        tf.style.transition = "backdrop-filter 2s ease";
        stage.appendChild(tf);
    }

    if (!document.getElementById("re-weather-layer")) {
        const wl = document.createElement("div");
        wl.id = "re-weather-layer";
        wl.style.position = "absolute";
        wl.style.top = "0";
        wl.style.left = "0";
        wl.style.width = "100%";
        wl.style.height = "100%";
        wl.style.pointerEvents = "none";
        wl.style.zIndex = "11";
        stage.appendChild(wl);
    }
    
    // SENSORY LAYERS (Mobile-First / True Reality)
    if (!document.getElementById("re-sensory-style")) {
        const s = document.createElement("style");
        s.id = "re-sensory-style";
        s.textContent = `
            @keyframes re-drift { 
                0% { transform: scale(1.0) rotate(0deg); } 
                50% { transform: scale(1.02) rotate(0.1deg); } 
                100% { transform: scale(1.0) rotate(0deg); } 
            }
            .re-breathing { animation: re-drift 24s infinite ease-in-out; }
            .re-blur-bg { filter: blur(3px); transition: filter 0.5s; }
            .re-focus-sprite { filter: drop-shadow(0 0 5px rgba(0,0,0,0.5)); }
        `;
        document.head.appendChild(s);
        // Apply breathing to background container
        const bg = document.getElementById("re-bg");
        if (bg) bg.classList.add("re-breathing");
    }
}

let _mouseX = 0;
let _mouseY = 0;
let _lastParallaxAt = 0;
let _lastPx = 0;
let _lastPy = 0;
let atmosphereSyncInterval = null;
let sensoryEventsBound = false;
let sensoryFramePending = false;

function refreshHudFromAtmosphere() {
    try {
        if (typeof window !== "undefined" && typeof window.updateHudFromState === "function") {
            window.updateHudFromState();
        }
    } catch (_) {}
    try {
        window.dispatchEvent(new CustomEvent("uie:hud-refresh", { detail: { source: "atmosphere" } }));
    } catch (_) {}
}

function queueSensoryFrame() {
    if (sensoryFramePending) return;
    sensoryFramePending = true;
    requestAnimationFrame(updateSensoryFrame);
}

function initSensoryEvents() {
    // Mouse
    document.addEventListener("mousemove", (e) => {
        _mouseX = e.clientX;
        _mouseY = e.clientY;
        queueSensoryFrame();
    });

    // Touch (for Flashlight/Focus)
    document.addEventListener("touchmove", (e) => {
        if (e.touches[0]) {
            _mouseX = e.touches[0].clientX;
            _mouseY = e.touches[0].clientY;
            queueSensoryFrame();
        }
    }, { passive: true });

    // Gyroscope (for Parallax - Mobile Reality)
    window.addEventListener("deviceorientation", (e) => {
        // Gamma: Left/Right (-90 to 90)
        // Beta: Front/Back (-180 to 180)
        if (e.gamma !== null && e.beta !== null) {
            // Clamp and Normalize
            const tiltX = Math.min(Math.max(e.gamma, -45), 45) / 45; // -1 to 1
            const tiltY = Math.min(Math.max(e.beta - 45, -45), 45) / 45; // Centered at 45deg holding angle
            
            window._tiltX = tiltX;
            window._tiltY = tiltY;
            queueSensoryFrame();
        }
    }, true);
}

function updateSensoryFrame() {
    sensoryFramePending = false;
    const stage = document.getElementById("reality-stage");
    if (!stage || stage.style.display === "none") return;
    // Avoid parallax jitter while dragging UI windows
    if (window.UIE_isDragging) return;
    const now = Date.now();
    if (now - _lastParallaxAt < 33) return; // ~30fps cap
    _lastParallaxAt = now;
    
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // Parallax Factors (Default to Mouse)
    let px = (_mouseX / w - 0.5); 
    let py = (_mouseY / h - 0.5);

    // Override with Tilt if available (True Reality)
    if (typeof window._tiltX === "number") {
        px = window._tiltX * 0.8; 
        py = window._tiltY * 0.8;
    }

    // 1. Parallax (enabled on both mobile and desktop)
    const bg = document.getElementById("re-bg");
    const sprites = document.getElementById("re-sprites-layer");
    // Smooth values to reduce jitter
    const smoothing = 0.18;
    _lastPx = _lastPx + (px - _lastPx) * smoothing;
    _lastPy = _lastPy + (py - _lastPy) * smoothing;
    if (bg) bg.style.transform = `scale(1.04) translate(${_lastPx * -14}px, ${_lastPy * -9}px)`; 
    // Keep sprites stable to avoid hover jitter/vibration
    if (sprites) sprites.style.transform = "none";

    // 2. Flashlight (Night Mode) - Always follows Finger/Mouse
    const tf = document.getElementById("re-time-filter");
    if (tf && tf.dataset.mode === "night") {
        // Darker outer rim for better immersion
        tf.style.background = `radial-gradient(circle 280px at ${_mouseX}px ${_mouseY}px, transparent 5%, rgba(0,0,5,0.96) 100%)`;
        tf.style.backdropFilter = "none"; 
    } else if (tf) {
        tf.style.background = "";
    }
}

function detectTime(text) {
    const t = text.toLowerCase();
    if (t.includes("night") || t.includes("midnight") || t.includes("moon")) return "night";
    if (t.includes("sunset") || t.includes("dusk") || t.includes("evening")) return "sunset";
    if (t.includes("morning") || t.includes("noon") || t.includes("day")) return "day";
    return null; // No change
}

function detectWeather(text) {
    const t = text.toLowerCase();
    if (t.includes("rain") || t.includes("downpour")) return "rain";
    if (t.includes("snow") || t.includes("blizzard")) return "snow";
    if (t.includes("fog") || t.includes("mist")) return "fog";
    if (t.includes("clear sky") || t.includes("sunny")) return "clear";
    return null;
}

function normalizeWeatherVisualMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return ["auto", "clear", "rain", "storm", "snow", "fog"].includes(mode) ? mode : "auto";
}

export function updateAtmosphere(text = "") {
    ensureLayers();
    const s = getSettings();
    const tf = document.getElementById("re-time-filter");
    const wl = document.getElementById("re-weather-layer");

    // 1. Time
    let time = detectTime(text);
    if (!time && s.worldState?.time) {
        const wt = s.worldState.time.toLowerCase();
        if (wt.includes("night")) time = "night";
        else if (wt.includes("sunset") || wt.includes("dusk")) time = "sunset";
        else time = "day";
    }
    if (time && tf) {
        tf.dataset.mode = time; // Store mode for flashlight
        if (time !== "night") { // Flashlight handles night CSS manually
            tf.style.backdropFilter = TIME_FILTERS[time] || "none";
            tf.style.background = "";
        }
    }

    // 2. Weather
    let weather = detectWeather(text);
    const configuredVisual = normalizeWeatherVisualMode(s.worldState?.weatherVisual);
    if (configuredVisual !== "auto") {
        weather = configuredVisual;
    }
    const durationSeconds = Number(s.worldState?.weatherVisualDurationSeconds);
    const appliedAt = Number(s.worldState?.weatherVisualAppliedAt || 0);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0 && appliedAt > 0 && Date.now() - appliedAt > durationSeconds * 1000) {
        weather = "clear";
    }
    if (!weather && s.worldState?.weather) {
        const ww = s.worldState.weather.toLowerCase();
        if (ww.includes("storm") || ww.includes("thunder")) weather = "storm";
        else if (ww.includes("rain")) weather = "rain";
        else if (ww.includes("snow")) weather = "snow";
        else if (ww.includes("fog")) weather = "fog";
        else weather = "clear";
    }

    if (wl) {
        // Remove existing weather classes
        wl.className = "";
        if (weather && WEATHER_EFFECTS[weather]) {
            wl.classList.add(`re-weather-${WEATHER_EFFECTS[weather]}`);
            // Add particles dynamically if needed, or rely on CSS pseudo-elements
            // For rain/snow, we often need inner elements for parallax
            if (weather === "rain" || weather === "snow") {
                wl.innerHTML = '<div class="particles"></div>';
            } else {
                wl.innerHTML = '';
            }
        } else {
            wl.innerHTML = '';
        }
    }
}

export function initAtmosphere() {
    console.log("[UIE] Atmosphere Engine Initialized");
    if (!sensoryEventsBound) {
        initSensoryEvents();
        sensoryEventsBound = true;
    }
    if (atmosphereSyncInterval) return;

    atmosphereSyncInterval = setInterval(() => {
        try {
            if (document.hidden) return;
            if (document.getElementById("startup-modal")?.style.display !== "none") return;
            const stage = document.getElementById("reality-stage");
            if (!stage) return;
            if (stage.hidden || stage.style.display === "none" || stage.style.visibility === "hidden") return;
        } catch (_) {
            return;
        }

        // Periodic check to sync with world state settings if chat isn't moving
        updateAtmosphere("");
    }, 15000);
}

export function initAtmosphereWindow() {
    const s = getSettings();
    const $win = $("#uie-atmosphere-window");
    if (!$win.length) return;
    ensurePlayerClock(s);
    ensureTimeProgress(s);
    ensureCalendar(s);

    // 1. Close Button
    $win.off("click.uieAtmoClose").on("click.uieAtmoClose", "#uie-atmosphere-close", () => {
        $win.hide();
    });

    // Helper to refresh clock display
    function updateClockDisplay() {
        ensurePlayerClock(s);
        ensureTimeProgress(s);
        ensureCalendar(s);
        const hour = String(s.playerRoom?.hour ?? 8).padStart(2, "0");
        const minute = String(s.playerRoom?.minute ?? 0).padStart(2, "0");
        const day = s.playerRoom?.day ?? 1;
        const rpDate = s.calendar?.rpDate ?? "";
        $("#uie-tweaker-clock-time").text(`${hour}:${minute}`);
        $("#uie-tweaker-clock-date").text(`Day ${day} ${rpDate ? `· ${rpDate}` : ""}`);
        $("#uie-atmo-hour").val(Number(s.playerRoom?.hour ?? 8));
        $("#uie-atmo-minute").val(Number(s.playerRoom?.minute ?? 0));
        $("#uie-atmo-day").val(Number(s.playerRoom?.day ?? 1));
        $("#uie-atmo-rp-date").val(String(s.calendar?.rpDate || ""));
        const minutesPerGameDay = Math.max(1, Number(s.calendar?.minutesPerGameDay || 240));
        $("#uie-atmo-speed").val(Math.max(1, Math.round(minutesPerGameDay / 24)));
        $("#uie-atmo-dynamic").val(s.ui?.timeProgress?.enabled === false ? "off" : "on");
        $("#uie-atmo-weather-name").val(String(s.worldState?.weather || ""));
        $("#uie-atmo-weather-visual").val(normalizeWeatherVisualMode(s.worldState?.weatherVisual || "auto"));
    }

    // Helper to highlight active time/weather buttons
    function updateButtonHighlights() {
        // Time Filter
        const curTime = String(s.worldState?.time || "day").toLowerCase();
        let activeTimeId = "day";
        if (curTime.includes("night")) activeTimeId = "night";
        else if (curTime.includes("sunset") || curTime.includes("evening")) activeTimeId = "sunset";
        
        $win.find("[data-time]").removeClass("active");
        $win.find(`[data-time="${activeTimeId}"]`).addClass("active");

        // Weather Effect
        const curWeather = String(s.worldState?.weatherVisual || s.worldState?.weather || "clear").toLowerCase();
        let activeWeatherId = "clear";
        if (curWeather.includes("rain")) activeWeatherId = "rain";
        else if (curWeather.includes("storm") || curWeather.includes("thunder")) activeWeatherId = "storm";
        else if (curWeather.includes("snow") || curWeather.includes("blizzard")) activeWeatherId = "snow";
        else if (curWeather.includes("fog") || curWeather.includes("mist")) activeWeatherId = "fog";

        $win.find("[data-weather]").removeClass("active");
        $win.find(`[data-weather="${activeWeatherId}"]`).addClass("active");
    }

    // 2. Bind Time Buttons
    $win.off("click.uieAtmoTime").on("click.uieAtmoTime", "[data-time]", function() {
        const timeVal = $(this).attr("data-time");
        s.worldState = s.worldState || {};
        
        // Map day/sunset/night to proper label
        let label = "Morning";
        if (timeVal === "sunset") label = "Evening";
        else if (timeVal === "night") label = "Night";
        
        s.worldState.time = label;
        saveSettings();
        updateAtmosphere();
        refreshHudFromAtmosphere();
        updateButtonHighlights();
        try { window.toastr?.success?.(`Time filter set to: ${label}`); } catch(_) {}
    });

    // 3. Bind Weather Buttons
    $win.off("click.uieAtmoWeather").on("click.uieAtmoWeather", "[data-weather]", function() {
        const weatherVal = $(this).attr("data-weather");
        s.worldState = s.worldState || {};
        s.worldState.weatherVisual = weatherVal;
        s.worldState.weather = weatherVal === "clear" ? "Clear" : weatherVal.charAt(0).toUpperCase() + weatherVal.slice(1);
        saveSettings();
        updateAtmosphere();
        refreshHudFromAtmosphere();
        updateButtonHighlights();
        try { window.toastr?.success?.(`Weather set to: ${s.worldState.weather}`); } catch(_) {}
    });

    $win.off("click.uieAtmoCustomWeather").on("click.uieAtmoCustomWeather", "#uie-atmo-apply-weather", function(e) {
        e.preventDefault();
        s.worldState = s.worldState || {};
        const weatherName = String($("#uie-atmo-weather-name").val() || "").trim();
        const visual = normalizeWeatherVisualMode($("#uie-atmo-weather-visual").val() || "auto");
        s.worldState.weather = weatherName || (visual === "auto" ? "Clear" : visual.charAt(0).toUpperCase() + visual.slice(1));
        s.worldState.weatherLabel = s.worldState.weather;
        s.worldState.weatherVisual = visual;
        s.worldState.customWeatherEvent = {
            name: s.worldState.weather,
            visual,
            updatedAt: Date.now()
        };
        saveSettings();
        updateAtmosphere("");
        refreshHudFromAtmosphere();
        updateButtonHighlights();
        updateClockDisplay();
        try { renderCalendar(); } catch (_) {}
        try { window.toastr?.success?.(`Weather set to: ${s.worldState.weather}`); } catch(_) {}
    });

    $win.off("click.uieAtmoClockApply").on("click.uieAtmoClockApply", "#uie-atmo-apply-clock", function(e) {
        e.preventDefault();
        ensurePlayerClock(s);
        ensureTimeProgress(s);
        ensureCalendar(s);
        const hour = Math.max(0, Math.min(23, Math.floor(Number($("#uie-atmo-hour").val() || 0))));
        const minute = Math.max(0, Math.min(59, Math.floor(Number($("#uie-atmo-minute").val() || 0))));
        const day = Math.max(1, Math.floor(Number($("#uie-atmo-day").val() || 1)));
        const realMinutesPerGameHour = Math.max(1, Math.min(1440, Math.floor(Number($("#uie-atmo-speed").val() || 10))));
        const rpDate = String($("#uie-atmo-rp-date").val() || "").trim();
        s.playerRoom.hour = hour;
        s.playerRoom.minute = minute;
        s.playerRoom.day = day;
        s.calendar.minutesPerGameDay = realMinutesPerGameHour * 24;
        if (rpDate) {
            s.calendar.rpEnabled = true;
            s.calendar.rpDate = rpDate;
        }
        s.ui.timeProgress.enabled = String($("#uie-atmo-dynamic").val() || "on") !== "off";
        s.worldState = s.worldState || {};
        if (hour < 6) s.worldState.time = "Night";
        else if (hour < 12) s.worldState.time = "Morning";
        else if (hour < 18) s.worldState.time = "Afternoon";
        else s.worldState.time = "Evening";
        saveSettings();
        updateAtmosphere("");
        refreshHudFromAtmosphere();
        updateClockDisplay();
        updateButtonHighlights();
        try { renderCalendar(); } catch (_) {}
        try { window.toastr?.success?.("Time and calendar updated."); } catch(_) {}
    });

    // 4. Bind Fast-Forward Clock Buttons
    $win.off("click.uieAtmoAdvance").on("click.uieAtmoAdvance", "[data-advance]", function() {
        const mins = parseInt($(this).attr("data-advance") || "0", 10);
        if (mins > 0) {
            advanceWorldTimeMinutes(s, mins, { reason: "Atmosphere Tweaker" });
            updateClockDisplay();
            updateAtmosphere();
            refreshHudFromAtmosphere();
            updateButtonHighlights();
            try { renderCalendar(); } catch (_) {}
        }
    });

    // Initialize display state
    updateClockDisplay();
    updateButtonHighlights();
}
