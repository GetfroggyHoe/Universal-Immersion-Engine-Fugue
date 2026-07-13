const STYLE_ID = "uie-scene-effects-style";
const EFFECT_ROOT_ID = "uie-effects-layer";
const activePersistentEffects = new Map();
const activeMacroTimers = new Map();
const MAX_MACRO_DURATION_MS = 7000;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${EFFECT_ROOT_ID}{position:fixed;inset:0;z-index:2147483500;pointer-events:none;overflow:hidden}
.uie-fx{position:absolute;inset:0;pointer-events:none}
.uie-fx-flash{background:#fff;animation:uie-fx-flash var(--uie-fx-duration,.5s) ease-out forwards}
.uie-fx-flash.soft{background:#fff8e8}
.uie-fx-vignette{background:radial-gradient(circle,transparent 42%,rgba(80,0,8,.78) 100%);animation:uie-fx-pulse 1s ease-in-out infinite}
.uie-fx-shadow{background:radial-gradient(circle,transparent 38%,rgba(0,0,0,.94) 100%);animation:uie-fx-creep var(--uie-fx-duration,8s) ease-in forwards}
.uie-fx-glow{background:radial-gradient(circle at 50% 70%,rgba(255,145,55,.28),transparent 68%);animation:uie-fx-glow .22s ease-in-out infinite alternate}
.uie-fx-fog{inset:auto -40% 0;height:55%;background:linear-gradient(180deg,transparent,rgba(220,225,230,.28));filter:blur(18px);animation:uie-fx-fog 14s linear infinite}
.uie-fx-letterbox::before,.uie-fx-letterbox::after,.uie-fx-eyelids::before,.uie-fx-eyelids::after{content:"";position:absolute;left:0;width:100%;height:var(--uie-fx-bar,14%);background:#000}
.uie-fx-letterbox::before{top:0;animation:uie-fx-bar-top var(--uie-fx-duration,.6s) ease-out both}
.uie-fx-letterbox::after{bottom:0;animation:uie-fx-bar-bottom var(--uie-fx-duration,.6s) ease-out both}
.uie-fx-eyelids::before{top:0;height:50%;animation:uie-fx-lid-top var(--uie-fx-duration,1.2s) ease-in both}
.uie-fx-eyelids::after{bottom:0;height:50%;animation:uie-fx-lid-bottom var(--uie-fx-duration,1.2s) ease-in both}
.uie-fx-slash{inset:50% -20%;height:8px;background:#fff;box-shadow:0 0 18px #fff,0 0 34px #d20b42;transform:rotate(-28deg) scaleX(0);animation:uie-fx-slash .28s ease-out forwards}
.uie-fx-blackout{background:#000}
.uie-fx-spotlight{background:radial-gradient(circle at var(--uie-fx-x,50%) var(--uie-fx-y,48%),transparent 0 12%,rgba(0,0,0,.9) 32%,#000 68%);animation:uie-fx-fade-in .8s ease-out both}
.uie-fx-dust i,.uie-fx-snow i,.uie-fx-sparks i{position:absolute;display:block;border-radius:50%;animation:uie-fx-float var(--d,8s) linear infinite;animation-delay:var(--delay,0s)}
.uie-fx-dust i{width:var(--s,3px);height:var(--s,3px);background:rgba(255,235,190,.42)}
.uie-fx-snow i{width:var(--s,7px);height:var(--s,7px);background:rgba(255,255,255,.82)}
.uie-fx-rain i{position:absolute;display:block;width:1px;height:var(--s,36px);background:linear-gradient(transparent,rgba(190,220,255,.58));transform:rotate(14deg);animation:uie-fx-rain var(--d,.7s) linear infinite;animation-delay:var(--delay,0s)}
.uie-fx-sparks i{width:var(--s,4px);height:var(--s,4px);background:var(--c,#70ff9a);box-shadow:0 0 8px var(--c,#70ff9a)}
.uie-paper-overlay{position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;padding:24px;background:rgba(8,6,3,.68);backdrop-filter:blur(5px)}
.uie-paper-letter{position:relative;width:min(680px,92vw);max-height:82vh;overflow:auto;padding:clamp(24px,5vw,54px);color:#3d2d1d;background:linear-gradient(135deg,#f4e7c5,#e8d2a2);border:1px solid #c09b5c;box-shadow:0 24px 80px rgba(0,0,0,.65),inset 0 0 50px rgba(116,73,25,.12);font:18px/1.7 Georgia,serif;white-space:pre-wrap}
.uie-paper-close{position:absolute;top:10px;right:10px;border:1px solid #8d6b3d;background:#f7e9c8;color:#3d2d1d;border-radius:6px;padding:7px 11px;font-weight:700;cursor:pointer}
.uie-rune-canvas{position:fixed;inset:0;z-index:2147483600;touch-action:none;cursor:crosshair}
.uie-fx-shake-light{animation:uie-fx-shake-light .25s linear}
.uie-fx-shake-heavy{animation:uie-fx-shake-heavy .5s linear}
.uie-fx-invert{animation:uie-fx-invert .22s steps(2)}
.uie-fx-dying{animation:uie-fx-dying 2.8s ease-in forwards}
.uie-fx-ui-glitch{animation:uie-fx-glitch .28s steps(2)}
.uie-fx-breathe{animation:uie-fx-breathe 4.8s ease-in-out infinite;transform-origin:50% 100%}
.uie-fx-angry{animation:uie-fx-angry .08s linear infinite}
.uie-fx-blush{position:relative}
.uie-fx-blush::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 35%,rgba(255,100,95,.42),transparent 52%);animation:uie-fx-fade-in 1.5s ease both}
.uie-fx-blood{background:radial-gradient(circle,transparent 38%,rgba(150,0,0,.74) 100%);animation:uie-fx-blood 1.5s ease-out forwards}
.uie-fx-whiteout{background:#fff;animation:uie-fx-whiteout var(--uie-fx-duration,2s) cubic-bezier(.1,.8,.3,1) forwards}
.uie-fx-static{opacity:.34;background:repeating-radial-gradient(circle at 18% 22%,rgba(255,255,255,.9) 0 1px,transparent 1px 4px),repeating-linear-gradient(0deg,rgba(255,255,255,.18) 0 1px,transparent 1px 3px);mix-blend-mode:screen;animation:uie-fx-static .12s steps(2) infinite}
.uie-fx-frost{background:radial-gradient(circle,transparent 45%,rgba(130,215,255,.55) 100%);box-shadow:inset 0 0 42px rgba(210,245,255,.8);animation:uie-fx-frost 5s ease-in-out infinite alternate}
.uie-fx-toxic{background:radial-gradient(circle,transparent 36%,rgba(85,255,60,.34) 100%);mix-blend-mode:screen;animation:uie-fx-sway 2.6s ease-in-out infinite}
.uie-fx-drip{background:linear-gradient(180deg,rgba(95,0,0,.72),rgba(95,0,0,0) 22%);animation:uie-fx-drip 4s linear infinite}
.uie-fx-scanlines{background:repeating-linear-gradient(0deg,rgba(255,255,255,.12) 0 1px,transparent 1px 4px);mix-blend-mode:overlay;animation:uie-fx-scan 1.2s linear infinite}
.uie-fx-alarm{box-shadow:inset 0 0 42px rgba(255,0,0,.84);animation:uie-fx-alarm .8s ease-in-out infinite alternate}
.uie-fx-ripple{background:radial-gradient(circle,rgba(120,210,255,.45) 0 2%,transparent 3%);animation:uie-fx-ripple .85s ease-out forwards}
.uie-fx-laser::before{content:"";position:absolute;left:var(--uie-fx-x,50%);top:var(--uie-fx-y,45%);width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#ff1238;box-shadow:0 0 16px #ff1238;animation:uie-fx-laser .5s ease-in-out infinite alternate}
.uie-fx-thunder{background:rgba(210,235,255,.82);animation:uie-fx-thunder .55s steps(2) forwards}
.uie-fx-macro-target{will-change:transform,filter,opacity}
@keyframes uie-fx-flash{0%{opacity:1}100%{opacity:0}}
@keyframes uie-fx-fade-in{from{opacity:0}to{opacity:1}}
@keyframes uie-fx-pulse{50%{opacity:.42;transform:scale(1.04)}}
@keyframes uie-fx-creep{from{opacity:.08}to{opacity:1}}
@keyframes uie-fx-glow{from{opacity:.45}to{opacity:1}}
@keyframes uie-fx-fog{to{transform:translateX(28%)}}
@keyframes uie-fx-bar-top{from{transform:translateY(-100%)}to{transform:none}}
@keyframes uie-fx-bar-bottom{from{transform:translateY(100%)}to{transform:none}}
@keyframes uie-fx-lid-top{from{transform:translateY(-100%)}to{transform:none}}
@keyframes uie-fx-lid-bottom{from{transform:translateY(100%)}to{transform:none}}
@keyframes uie-fx-slash{70%{transform:rotate(-28deg) scaleX(1)}100%{transform:rotate(-28deg) scaleX(1);opacity:0}}
@keyframes uie-fx-float{from{transform:translate(0,20vh);opacity:0}20%{opacity:1}to{transform:translate(var(--drift,30px),-110vh);opacity:0}}
@keyframes uie-fx-rain{to{transform:translate(-18vw,115vh) rotate(14deg)}}
@keyframes uie-fx-shake-light{25%{transform:translate(2px,-1px)}50%{transform:translate(-2px,1px)}75%{transform:translate(1px,1px)}}
@keyframes uie-fx-shake-heavy{10%{transform:translate(-10px,6px) rotate(-.4deg)}30%{transform:translate(9px,-7px) rotate(.5deg)}50%{transform:translate(-7px,-3px)}70%{transform:translate(8px,5px)}90%{transform:translate(-3px,2px)}}
@keyframes uie-fx-invert{50%{filter:invert(1) contrast(1.4)}}
@keyframes uie-fx-dying{0%{filter:none}45%{filter:grayscale(1) contrast(1.15)}100%{filter:grayscale(1) brightness(0)}}
@keyframes uie-fx-glitch{20%{transform:translate(-7px,2px);filter:drop-shadow(5px 0 #f0f) drop-shadow(-5px 0 #0ff)}60%{transform:translate(6px,-2px);filter:drop-shadow(-5px 0 #f0f) drop-shadow(5px 0 #0ff)}}
@keyframes uie-fx-breathe{50%{transform:translateY(-2px) scaleY(1.008) scaleX(.997)}}
@keyframes uie-fx-angry{50%{transform:translateX(2px)}}
@keyframes uie-fx-slash-lunge{45%{transform:translateX(var(--uie-lunge,9vw)) scale(1.03)}100%{transform:none}}
@keyframes uie-fx-blood{0%{opacity:1}100%{opacity:.3}}
@keyframes uie-fx-whiteout{0%,10%{opacity:1}100%{opacity:0}}
@keyframes uie-fx-static{50%{filter:invert(1) contrast(1.8);transform:translateX(4px)}}
@keyframes uie-fx-frost{from{opacity:.42;filter:saturate(1)}to{opacity:.8;filter:saturate(1.6)}}
@keyframes uie-fx-sway{50%{transform:translateX(9px) rotate(.35deg);opacity:.5}}
@keyframes uie-fx-drip{from{transform:translateY(-18%)}to{transform:translateY(18%)}}
@keyframes uie-fx-scan{to{transform:translateY(4px)}}
@keyframes uie-fx-alarm{from{opacity:.35}to{opacity:1}}
@keyframes uie-fx-ripple{from{transform:scale(.2);opacity:.95}to{transform:scale(2.8);opacity:0}}
@keyframes uie-fx-laser{to{transform:scale(1.8);opacity:.45}}
@keyframes uie-fx-thunder{0%,24%,52%{opacity:0}12%,36%{opacity:1}100%{opacity:0}}
@media(prefers-reduced-motion:reduce){.uie-fx,.uie-fx *{animation-duration:.001ms!important;animation-iteration-count:1!important}}
`;
    document.head.appendChild(style);
}

function effectRoot() {
    injectStyles();
    let root = document.getElementById(EFFECT_ROOT_ID);
    if (!root) {
        root = document.createElement("div");
        root.id = EFFECT_ROOT_ID;
        root.setAttribute("aria-hidden", "true");
        document.body.appendChild(root);
    }
    return root;
}

function stage() {
    return document.getElementById("game-root") || document.body;
}

function spriteTarget(target) {
    if (target instanceof Element) return target;
    if (typeof target === "string" && target) return document.querySelector(target);
    return document.querySelector("#vn-sprite-layer img, #re-sprites-layer img, .vn-sprite, .re-sprite");
}

function addOverlay(className, { duration = 600, persistent = false, style = {} } = {}) {
    const el = document.createElement("div");
    el.className = `uie-fx ${className}`;
    Object.assign(el.style, style);
    effectRoot().appendChild(el);
    if (!persistent) setTimeout(() => el.remove(), duration + 80);
    return el;
}

function particles(kind, count, persistent = true) {
    const el = addOverlay(`uie-fx-${kind}`, { persistent });
    for (let i = 0; i < count; i += 1) {
        const p = document.createElement("i");
        p.style.left = `${Math.random() * 115}%`;
        p.style.top = `${Math.random() * 100}%`;
        p.style.setProperty("--s", `${2 + Math.random() * (kind === "snow" ? 9 : 4)}px`);
        p.style.setProperty("--d", `${kind === "rain" ? .45 + Math.random() * .55 : 6 + Math.random() * 9}s`);
        p.style.setProperty("--delay", `${-Math.random() * 12}s`);
        p.style.setProperty("--drift", `${-45 + Math.random() * 90}px`);
        el.appendChild(p);
    }
    return el;
}

function pulseClass(target, className, duration = 600) {
    const el = target || stage();
    if (!el) return null;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), duration);
    return el;
}

function capDuration(duration, fallback = 1200) {
    const n = Number(duration);
    if (!Number.isFinite(n) || n <= 0) return Math.min(MAX_MACRO_DURATION_MS, fallback);
    return Math.max(1, Math.min(MAX_MACRO_DURATION_MS, Math.round(n)));
}

function animateTemp(target, keyframes, options = {}) {
    const el = target || stage();
    if (!el || typeof el.animate !== "function") return null;
    const duration = capDuration(options.duration, 800);
    el.classList.add("uie-fx-macro-target");
    const anim = el.animate(keyframes, { ...options, duration });
    const done = () => el.classList.remove("uie-fx-macro-target");
    try { anim.finished.then(done).catch(done); } catch (_) { setTimeout(done, duration + 40); }
    return anim;
}

function addTimedPersistent(name, creator, duration = MAX_MACRO_DURATION_MS) {
    const el = setPersistent(name, creator);
    const ms = capDuration(duration, MAX_MACRO_DURATION_MS);
    clearTimeout(activeMacroTimers.get(name));
    activeMacroTimers.set(name, setTimeout(() => {
        clearEffect(name);
        activeMacroTimers.delete(name);
    }, ms));
    return el;
}

function setPersistent(name, creator) {
    clearEffect(name);
    const el = creator();
    activePersistentEffects.set(name, el);
    return el;
}

export function clearEffect(name) {
    const el = activePersistentEffects.get(name);
    if (el) el.remove();
    activePersistentEffects.delete(name);
    clearTimeout(activeMacroTimers.get(name));
    activeMacroTimers.delete(name);
}

export function clearAllEffects() {
    activePersistentEffects.forEach((el) => el?.remove());
    activePersistentEffects.clear();
    activeMacroTimers.forEach((timer) => clearTimeout(timer));
    activeMacroTimers.clear();
    document.getElementById(EFFECT_ROOT_ID)?.replaceChildren();
    [stage(), document.querySelector("#vn-ui"), document.querySelector("#re-ui")].forEach((el) => {
        if (!el) return;
        el.classList.remove("uie-fx-shake-light", "uie-fx-shake-heavy", "uie-fx-invert", "uie-fx-dying", "uie-fx-ui-glitch");
    });
}

export function createLetterOverlay(text) {
    injectStyles();
    const overlay = document.createElement("div");
    overlay.className = "uie-paper-overlay";
    const letter = document.createElement("div");
    letter.className = "uie-paper-letter";
    const close = document.createElement("button");
    close.className = "uie-paper-close";
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => overlay.remove(), { once: true });
    const content = document.createElement("div");
    content.textContent = String(text ?? "");
    letter.append(close, content);
    overlay.appendChild(letter);
    document.body.appendChild(overlay);
    return overlay;
}

export const effects = {
    wakingUp() {
        const black = addOverlay("uie-fx-blackout", { duration: 1900 });
        black.animate([{ opacity: 1 }, { opacity: 1, offset: .2 }, { opacity: 0, offset: .42 }, { opacity: .78, offset: .52 }, { opacity: 0, offset: .64 }, { opacity: .6, offset: .73 }, { opacity: 0 }], { duration: 1900, easing: "ease-out" });
        return black;
    },
    sleep({ duration = 1400 } = {}) {
        return addOverlay("uie-fx-eyelids", { duration, style: { "--uie-fx-duration": `${duration}ms` } });
    },
    softFlash: () => addOverlay("uie-fx-flash soft", { duration: 650, style: { "--uie-fx-duration": ".65s" } }),
    flashbang() {
        const el = addOverlay("uie-fx-flash", { duration: 1600, style: { "--uie-fx-duration": "1.6s" } });
        pulseClass(stage(), "uie-fx-invert", 260);
        return el;
    },
    letterbox({ duration = 600, size = "14%" } = {}) {
        return setPersistent("letterbox", () => addOverlay("uie-fx-letterbox", { persistent: true, style: { "--uie-fx-duration": `${duration}ms`, "--uie-fx-bar": size } }));
    },
    clearLetterbox: () => clearEffect("letterbox"),
    shakeLight: () => pulseClass(stage(), "uie-fx-shake-light", 300),
    shakeHeavy: () => pulseClass(stage(), "uie-fx-shake-heavy", 560),
    directionalLunge(target, direction = 1) {
        const el = spriteTarget(target);
        if (!el) return null;
        el.style.setProperty("--uie-lunge", `${9 * Math.sign(Number(direction) || 1)}vw`);
        el.animate([{ transform: "none" }, { transform: `translateX(${9 * Math.sign(Number(direction) || 1)}vw) scale(1.03)`, offset: .45 }, { transform: "none" }], { duration: 360, easing: "cubic-bezier(.2,.8,.3,1)" });
        return el;
    },
    criticalStrike() {
        pulseClass(stage(), "uie-fx-invert", 250);
        effects.shakeHeavy();
        return addOverlay("uie-fx-slash", { duration: 340 });
    },
    fatalBlow: () => pulseClass(stage(), "uie-fx-dying", 2900),
    injuryOn: () => setPersistent("injury", () => addOverlay("uie-fx-vignette", { persistent: true })),
    injuryOff: () => clearEffect("injury"),
    spriteBreathingOn(target) { return spriteTarget(target)?.classList.add("uie-fx-breathe"); },
    spriteBreathingOff(target) { return spriteTarget(target)?.classList.remove("uie-fx-breathe"); },
    dustOn: () => setPersistent("dust", () => particles("dust", 42)),
    dustOff: () => clearEffect("dust"),
    fireplaceOn: () => setPersistent("fireplace", () => addOverlay("uie-fx-glow", { persistent: true })),
    fireplaceOff: () => clearEffect("fireplace"),
    rainOn: () => setPersistent("rain", () => particles("rain", 75)),
    rainOff: () => clearEffect("rain"),
    snowOn: () => setPersistent("snow", () => particles("snow", 48)),
    snowOff: () => clearEffect("snow"),
    fogOn: () => setPersistent("fog", () => addOverlay("uie-fx-fog", { persistent: true })),
    fogOff: () => clearEffect("fog"),
    uiGlitch() {
        const ui = document.querySelector("#vn-ui") || document.querySelector("#re-ui") || stage();
        return pulseClass(ui, "uie-fx-ui-glitch", 340);
    },
    spriteTear(target) {
        const el = spriteTarget(target);
        if (!el) return null;
        el.animate([{ clipPath: "inset(0)" }, { clipPath: "polygon(0 0,100% 0,100% 24%,0 28%,0 42%,100% 38%,100% 66%,0 70%,0 100%,100% 100%)", transform: "translateX(7px)" }, { clipPath: "inset(0)", transform: "none" }], { duration: 360, iterations: 2 });
        return el;
    },
    blackout({ hold = 650, x = "50%", y = "48%" } = {}) {
        const black = addOverlay("uie-fx-blackout", { duration: hold + 1000 });
        setTimeout(() => {
            black.className = "uie-fx uie-fx-spotlight";
            black.style.setProperty("--uie-fx-x", x);
            black.style.setProperty("--uie-fx-y", y);
        }, hold);
        return black;
    },
    creepingShadows({ duration = 8000 } = {}) {
        return setPersistent("shadows", () => addOverlay("uie-fx-shadow", { persistent: true, style: { "--uie-fx-duration": `${duration}ms` } }));
    },
    clearShadows: () => clearEffect("shadows"),
    kiss(target) {
        const el = spriteTarget(target);
        el?.animate([{ transform: "none" }, { transform: "translateX(2vw) scale(1.05)" }], { duration: 1200, easing: "ease-out", fill: "forwards" });
        document.querySelector("#re-bg, #main-screen-html-host")?.animate([{ filter: "none" }, { filter: "blur(4px)" }], { duration: 1200, fill: "forwards" });
        return el;
    },
    punch(attacker) {
        effects.directionalLunge(attacker);
        setTimeout(() => { effects.shakeHeavy(); effects.softFlash(); }, 150);
    },
    hug(target) {
        const el = spriteTarget(target);
        el?.animate([{ transform: "none" }, { transform: "translateX(2vw) scale(1.04,.98)" }], { duration: 1000, easing: "ease-out", fill: "forwards" });
        addOverlay("uie-fx-glow", { duration: 1500 });
        return el;
    },
    blush(target) {
        const el = spriteTarget(target);
        el?.classList.add("uie-fx-blush");
        return el;
    },
    angry(target) {
        const el = spriteTarget(target);
        el?.classList.add("uie-fx-angry");
        document.querySelector("#re-bg, #main-screen-html-host")?.animate([{ filter: "none" }, { filter: "brightness(.5)" }], { duration: 450, fill: "forwards" });
        return el;
    }
};

function playExpression(name, target) {
    const el = spriteTarget(target);
    if (!el) return null;
    const n = String(name || "").toUpperCase();
    const common = { easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" };
    const map = {
        SHOCK: [[{ transform: "scale(1) translateY(0)" }, { transform: "scale(1.15) translateY(-10px)", offset: .22 }, { transform: "scale(1) translateY(0)" }], { duration: 620, ...common }],
        ANGRY: [[{ transform: "translateX(-3px)", filter: "sepia(.4) saturate(1.7) hue-rotate(-22deg)" }, { transform: "translateX(3px)", filter: "sepia(.4) saturate(1.7) hue-rotate(-22deg)" }, { transform: "translateX(0)", filter: "none" }], { duration: 900, iterations: 4, ...common }],
        SAD: [[{ transform: "translateY(0) rotate(0)", filter: "none" }, { transform: "translateY(8px) rotate(-2deg)", filter: "brightness(.85)" }], { duration: 1200, ...common }],
        HAPPY: [[{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-12px) scale(1.04,.96)", offset: .25 }, { transform: "translateY(0) scale(.98,1.04)", offset: .48 }, { transform: "translateY(-8px) scale(1.03,.97)", offset: .7 }, { transform: "translateY(0) scale(1)" }], { duration: 760, ...common }],
        SHY: [[{ transform: "translateX(0) rotate(0)" }, { transform: "translateX(-16px) rotate(-2deg)" }, { transform: "translateX(-8px) rotate(-1deg)" }], { duration: 1500, ...common }],
        SMUG: [[{ transform: "scale(1) rotate(0)" }, { transform: "scale(1.04) rotate(2deg)" }, { transform: "scale(1.03) rotate(-2deg)" }, { transform: "scale(1) rotate(0)" }], { duration: 2200, iterations: 2, ...common }],
        CONFUSED: [[{ transform: "rotate(-4deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(0)" }], { duration: 900, iterations: 3, ...common }],
        LAUGH: [[{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-5px) scale(1.03)" }, { transform: "translateY(2px) scale(.99)" }, { transform: "translateY(0) scale(1)" }], { duration: 260, iterations: 10, ...common }],
        TERRIFIED: [[{ transform: "translate(0,0)", opacity: 1 }, { transform: "translate(-6px,4px)", opacity: .7 }, { transform: "translate(6px,10px)", opacity: 1 }, { transform: "translate(-3px,7px)", opacity: .82 }, { transform: "translate(0,0)", opacity: 1 }], { duration: 1300, iterations: 2, ...common }],
        FLUSTERED: [[{ transform: "translate(0,0)", filter: "blur(0)" }, { transform: "translate(-4px,1px)", filter: "blur(1px)" }, { transform: "translate(4px,-1px)", filter: "blur(1px)" }, { transform: "translate(0,0)", filter: "blur(0)" }], { duration: 180, iterations: 14, ...common }],
        DISGUST: [[{ transform: "translate(0,0)", filter: "none" }, { transform: "translate(-5px,-5px)", filter: "hue-rotate(80deg) saturate(1.3)" }, { transform: "translate(-2px,-2px)", filter: "hue-rotate(55deg)" }], { duration: 1300, ...common }],
        TIRED: [[{ transform: "translateY(4px) scale(1)" }, { transform: "translateY(9px) scale(1,.985)" }, { transform: "translateY(4px) scale(1)" }], { duration: 4000, iterations: 1, ...common }],
        COCKY: [[{ transform: "translateY(0) rotate(0)" }, { transform: "translateY(-8px) rotate(2deg)" }, { transform: "translateY(0) rotate(4deg)" }], { duration: 720, ...common }],
        GLARE: [[{ transform: "translateY(0)", filter: "none" }, { transform: "translateY(4px)", filter: "brightness(1.18) contrast(1.55)" }], { duration: 1700, ...common }],
        WHISPER: [[{ transform: "scale(1) translateX(0)" }, { transform: "scale(.95) translateX(10px)" }], { duration: 1200, ...common }],
        CRY: [[{ transform: "translateY(6px)" }, { transform: "translateY(10px)" }, { transform: "translateY(7px)" }], { duration: 420, iterations: 8, ...common }],
        NERVOUS: [[{ transform: "translateX(0)" }, { transform: "translateX(-2px)", offset: .12 }, { transform: "translateX(0)", offset: .2 }, { transform: "translateX(1px)", offset: .72 }, { transform: "translateX(0)" }], { duration: 900, iterations: 5, ...common }],
        HYPED: [[{ transform: "translateY(0) rotate(0)" }, { transform: "translateY(-10px) rotate(2deg)" }, { transform: "translateY(0) rotate(-2deg)" }], { duration: 360, iterations: 12, ...common }],
        DAZED: [[{ transform: "rotate(0) translate(0,0)" }, { transform: "rotate(4deg) translate(3px,-3px)" }, { transform: "rotate(-4deg) translate(-3px,3px)" }, { transform: "rotate(0) translate(0,0)" }], { duration: 1800, iterations: 3, ...common }],
        DEAD: [[{ transform: "rotate(0) translateY(0)", filter: "none", opacity: 1 }, { transform: "rotate(90deg) translateY(34px)", filter: "grayscale(1)", opacity: .65 }], { duration: 1400, ...common }],
    };
    const item = map[n];
    if (!item) return null;
    return animateTemp(el, item[0], item[1]);
}

function visualMacro(command, argument = "") {
    const cmd = String(command || "").trim().toUpperCase();
    const arg = String(argument || "").trim();
    const bg = () => document.querySelector("#re-bg, #main-screen-html-host, #game-root") || stage();
    switch (cmd) {
        case "BITE":
            effects.shakeHeavy();
            addOverlay("uie-fx-blood", { duration: 1500 });
            animateTemp(stage(), [
                { filter: "contrast(2) sepia(.2)", transform: "scale(1)" },
                { filter: "contrast(3) hue-rotate(-30deg)", transform: "translate(-10px,15px) scale(1.06)", offset: .1 },
                { transform: "translate(12px,-10px) rotate(2deg)", offset: .2 },
                { transform: "translate(-8px,-8px) rotate(-2deg)", offset: .4 },
                { filter: "none", transform: "none" },
            ], { duration: 500, easing: "cubic-bezier(.36,.07,.19,.97)" });
            return true;
        case "EXPLOSION":
        case "FLASHBANG":
            addOverlay("uie-fx-whiteout", { duration: 2200, style: { "--uie-fx-duration": "2s" } });
            animateTemp(bg(), [{ filter: "blur(10px) saturate(0)" }, { filter: "blur(5px) saturate(.5)", offset: .3 }, { filter: "none" }], { duration: 2500, easing: "ease-out" });
            effects.shakeHeavy();
            return true;
        case "TWIST":
            animateTemp(stage(), [{ filter: "invert(0) contrast(1)", transform: "scale(1)" }, { filter: "invert(1) contrast(1.5)", transform: "scale(1.05) rotate(1deg)", offset: .15 }, { filter: "invert(1) contrast(1.5)", transform: "scale(1.05) rotate(-1deg)", offset: .3 }, { filter: "none", transform: "none" }], { duration: 600, easing: "cubic-bezier(.25,1,.5,1)" });
            return true;
        case "WAKE": effects.wakingUp(); return true;
        case "PASS_OUT": effects.sleep({ duration: 1400 }); return true;
        case "BLACKOUT": addOverlay("uie-fx-blackout", { duration: 1800 }); return true;
        case "GLITCH": effects.uiGlitch(); return true;
        case "HEARTBEAT": animateTemp(stage(), [{ transform: "scale(1)" }, { transform: "scale(1.02)", offset: .18 }, { transform: "scale(1)", offset: .32 }, { transform: "scale(1.018)", offset: .5 }, { transform: "scale(1)" }], { duration: 1200, iterations: 3, easing: "ease-in-out" }); return true;
        case "BLOOD_DRIP": addTimedPersistent("blood_drip", () => addOverlay("uie-fx-drip", { persistent: true }), 7000); return true;
        case "STRIKE": effects.criticalStrike(); return true;
        case "EARTHQUAKE": animateTemp(stage(), [{ transform: "translate(-2px,1px)" }, { transform: "translate(2px,-1px)" }, { transform: "translate(-1px,-2px)" }, { transform: "translate(0,0)" }], { duration: 110, iterations: 45, easing: "linear" }); return true;
        case "EMP": addOverlay("uie-fx-static", { duration: 1800 }); effects.uiGlitch(); return true;
        case "FREEZE": addTimedPersistent("frost", () => addOverlay("uie-fx-frost", { persistent: true }), 7000); return true;
        case "BURN": animateTemp(bg(), [{ filter: "blur(0) saturate(1)" }, { filter: "blur(1px) saturate(1.35) hue-rotate(-12deg)" }, { filter: "none" }], { duration: 3000, easing: "ease-in-out" }); return true;
        case "TOXIC": addTimedPersistent("toxic", () => addOverlay("uie-fx-toxic", { persistent: true }), 7000); return true;
        case "DIZZY": animateTemp(stage(), [{ transform: "rotate(0) translate(0,0)" }, { transform: "rotate(1.5deg) translate(7px,-4px)" }, { transform: "rotate(-1.5deg) translate(-7px,4px)" }, { transform: "rotate(0) translate(0,0)" }], { duration: 2600, iterations: 2, easing: "ease-in-out" }); return true;
        case "ADRENALINE": animateTemp(bg(), [{ filter: "saturate(1)", transform: "scale(1)" }, { filter: "saturate(1.65) contrast(1.12)", transform: "scale(1.018)" }, { filter: "none", transform: "none" }], { duration: 4000, easing: "ease-out" }); return true;
        case "TIME_WARP": animateTemp(bg(), [{ filter: "sepia(0)" }, { filter: "sepia(.75) saturate(.7)" }, { filter: "none" }], { duration: 5000, easing: "ease-in-out" }); return true;
        case "SHADOWS": effects.creepingShadows({ duration: 7000 }); setTimeout(() => effects.clearShadows(), 7000); return true;
        case "THUNDER": addOverlay("uie-fx-thunder", { duration: 700 }); return true;
        case "RAIN_START": addTimedPersistent("rain", () => particles("rain", 75), 7000); return true;
        case "SMOKE": addTimedPersistent("fog", () => addOverlay("uie-fx-fog", { persistent: true }), 7000); return true;
        case "LASER": addTimedPersistent("laser", () => addOverlay("uie-fx-laser", { persistent: true }), 7000); return true;
        case "ALARM": addTimedPersistent("alarm", () => addOverlay("uie-fx-alarm", { persistent: true }), 7000); return true;
        case "CONFEDERATE": animateTemp(spriteTarget(), [{ opacity: 1, filter: "none" }, { opacity: .4, filter: "drop-shadow(0 0 14px #6ec7ff)" }, { opacity: 1, filter: "none" }], { duration: 4200, easing: "ease-in-out" }); return true;
        case "PSYCHIC": addOverlay("uie-fx-ripple", { duration: 1000 }); return true;
        case "MEMO": addTimedPersistent("scanlines", () => addOverlay("uie-fx-scanlines", { persistent: true }), 7000); return true;
        case "TELEPORT": animateTemp(spriteTarget(), [{ transform: "scale(1)", opacity: 1 }, { transform: "scaleY(3) scaleX(.1)", opacity: .8 }, { transform: "scaleY(1) scaleX(1)", opacity: 1 }], { duration: 850, easing: "ease-in" }); return true;
        case "HEAL":
            effects.softFlash();
            return true;
        case "DEATH":
            effects.fatalBlow();
            playExpression("DEAD");
            return true;
        case "RESET":
            clearAllEffects();
            return true;
        default:
            return false;
    }
}

export function runSceneMacro(command, argument = "") {
    const cmd = String(command || "").trim().toUpperCase();
    if (!cmd) return false;
    if (cmd.startsWith("EXP:")) return !!playExpression(cmd.slice(4) || argument);
    if (cmd === "EVENT") return visualMacro(argument);
    if (cmd === "EXP") return !!playExpression(argument);
    return visualMacro(cmd, argument);
}

export function processSceneMacros(rawText = "") {
    const text = String(rawText || "");
    if (!text) return "";
    const macroRe = /\[(?:(EVENT|EXP):([A-Z0-9_-]+)(?::([^\]\r\n]+))?|([A-Z0-9_-]+)(?::([^\]\r\n]+))?)\]/g;
    return text.replace(macroRe, (match, family, familyCommand, familyArg, command, arg) => {
        const name = family ? String(family).toUpperCase() : String(command || "").toUpperCase();
        const value = family ? String(familyCommand || "") : String(arg || "");
        const handled = family
            ? runSceneMacro(name, value || familyArg || "")
            : runSceneMacro(command, arg || "");
        return handled ? "" : match;
    }).replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function createRuneTracing({ color = "#68f7ff", lineWidth = 7, onComplete } = {}) {
    injectStyles();
    const canvas = document.createElement("canvas");
    canvas.className = "uie-rune-canvas";
    const ctx = canvas.getContext("2d");
    const points = [];
    let drawing = false;
    const resize = () => {
        canvas.width = window.innerWidth * devicePixelRatio;
        canvas.height = window.innerHeight * devicePixelRatio;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    const point = (e) => ({ x: e.clientX, y: e.clientY });
    const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (points.length < 2) return;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.shadowColor = color;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
    };
    const finish = () => {
        drawing = false;
        onComplete?.(points.slice(), { success, fail, remove: () => canvas.remove() });
    };
    const success = () => {
        canvas.animate([{ filter: "brightness(1)" }, { filter: "brightness(3) hue-rotate(70deg)", opacity: 1 }, { opacity: 0 }], { duration: 700, fill: "forwards" });
        setTimeout(() => canvas.remove(), 720);
    };
    const fail = () => {
        canvas.animate([{ transform: "none", filter: "none" }, { transform: "translate(5px,-3px)", filter: "hue-rotate(150deg) brightness(2)" }, { transform: "translate(-5px,3px)", opacity: 0 }], { duration: 650, fill: "forwards" });
        setTimeout(() => canvas.remove(), 680);
    };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; points.length = 0; points.push(point(e)); draw(); });
    canvas.addEventListener("pointermove", (e) => { if (drawing) { points.push(point(e)); draw(); } });
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    window.addEventListener("resize", resize, { once: true });
    resize();
    document.body.appendChild(canvas);
    return { canvas, points, success, fail, remove: () => canvas.remove() };
}

export function initSceneEffects() {
    injectStyles();
    window.createLetterOverlay = createLetterOverlay;
    window.UIEEffects = { ...effects, createLetterOverlay, createRuneTracing, clearEffect, clearAllEffects, runSceneMacro, processSceneMacros };
}
