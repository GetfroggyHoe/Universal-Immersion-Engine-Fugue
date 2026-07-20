// Pocket and Kokoro both run through the bundled local backend. Keeping this
// module free of a top-level CDN import means Pocket-TTS still works fully
// offline and Kokoro uses the checked-in ONNX model instead of downloading a
// second browser model.
const KokoroTTS = null;

function defaultPocketBackendUrl() {
  try {
    if (typeof window !== "undefined" && window.location) {
      return new URL("./api/backend", window.location.href).toString().replace(/\/+$/, "");
    }
  } catch (_) {}
  return "http://127.0.0.1:28101";
}

export const POCKET_DEFAULT_BACKEND_URL = defaultPocketBackendUrl();
export const POCKET_PRESET_VOICES = [
  "cosette",
  "marius",
  "javert",
  "alba",
  "jean",
  "anna",
  "vera",
  "fantine",
  "charles",
  "paul",
  "eponine",
  "azelma",
  "george",
  "mary",
  "jane",
  "michael",
  "eve",
  "bill_boerst",
  "peter_yearsley",
  "stuart_bell",
  "caro_davy"
];
export const KOKORO_PRESET_VOICES = [
  "af_heart",
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis"
];
export const KOKORO_LANGUAGE_OPTIONS = [
  { value: "english", label: "English (US)" },
  { value: "en-gb", label: "English (UK)" },
  { value: "japanese", label: "Japanese" },
  { value: "chinese", label: "Chinese / Mandarin" },
  { value: "spanish", label: "Spanish" },
  { value: "french", label: "French" },
  { value: "hindi", label: "Hindi" },
  { value: "italian", label: "Italian" },
  { value: "portuguese", label: "Portuguese" }
];
const POCKET_SAMPLE_RATE = 24000;

// Preserve punctuation but remove markup that belongs on-screen rather than in
// spoken audio. This gives both engines cleaner phrasing and faster previews.
export function prepareDialogueForSpeech(value, maxChars = 900) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\*[^*]{1,160}\*/g, " ")
    .replace(/\[[^\]]{1,160}\]/g, " ")
    .replace(/[—–]/g, ", ")
    .replace(/\.{3,}/g, "… ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

const ttsRuntimeState = {
  status: "Idle",
  provider: "pocket",
  progress: 0,
  error: ""
};

let sharedEngine = null;

function publishTtsState(patch = {}) {
  Object.assign(ttsRuntimeState, patch);
  try { window.UIE_TTS_STATE = { ...ttsRuntimeState }; } catch (_) {}
  try { window.dispatchEvent(new CustomEvent("uie:tts-state", { detail: { ...ttsRuntimeState } })); } catch (_) {}
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getRuntimeSettings() {
  try {
    return window.extension_settings?.["universal-immersion-engine"] || window.UIE_SETTINGS || window.uie_settings || {};
  } catch (_) {
    return {};
  }
}

function backendBaseUrl(options = {}) {
  const audio = getRuntimeSettings()?.audio || {};
  const optionUrl = String(options.backendUrl || options.url || "").trim();
  if (optionUrl) return optionUrl.replace(/\/+$/, "");

  const configured = String(audio.pocket?.url || audio.url || "").trim();
  if (configured) {
    try {
      const parsed = new URL(configured, window.location.href);
      const isLegacyLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) && parsed.port === "8101";
      if (!isLegacyLoopback) return configured.replace(/\/+$/, "");
    } catch (_) {
      return configured.replace(/\/+$/, "");
    }
  }

  return String(window.UIE_BACKEND?.baseUrl || POCKET_DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

function createOfflineVoiceRegistry(error) {
  return {
    schemaVersion: 2,
    offline: true,
    error: String(error?.message || error || "Pocket TTS backend unavailable."),
    updatedAt: new Date().toISOString(),
    voices: POCKET_PRESET_VOICES.map((voice) => ({
      id: `model_pocket_${voice}`,
      name: voice.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      engine: "pocket",
      voice,
      category: "model",
      sourceType: "built-in",
      agePresentation: "adult",
      genderPresentation: "other",
      accent: "",
      tone: "",
      tags: [],
      vocalTraits: [],
      poolRules: {},
      usage: {},
      favorite: false,
      qualityScore: null,
      enabled: true,
      ready: false,
      status: "unavailable"
    }))
  };
}

function getAudioContext(procdAudioInstance) {
  if (procdAudioInstance?.ctx) return procdAudioInstance.ctx;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  return new AudioContextCtor();
}

function sameSpeaker(a, b) {
  const aa = String(a || "").trim().toLowerCase();
  const bb = String(b || "").trim().toLowerCase();
  return !!aa && !!bb && aa === bb;
}

function normalizePocketVoice(value, fallback = "alba") {
  const raw = String(value || "").trim().toLowerCase();
  if (POCKET_PRESET_VOICES.includes(raw)) return raw;
  const fb = String(fallback ?? "alba").trim().toLowerCase();
  if (POCKET_PRESET_VOICES.includes(fb)) return fb;
  return fallback === "" ? "" : "alba";
}

function extractVoiceRecipe(entity) {
  if (!entity || typeof entity !== "object") return "";
  if (entity.voice_enabled === false || entity.voiceEnabled === false || entity.tts?.enabled === false) return "";
  return String(entity.voice_recipe || entity.voiceRecipe || entity.tts?.voice_recipe || entity.tts?.voiceRecipe || "").trim();
}

function entityVoiceDisabled(entity) {
  return !!entity && typeof entity === "object"
    && (entity.voice_enabled === false || entity.voiceEnabled === false || entity.tts?.enabled === false);
}

function stableVoiceIndex(value, length) {
  let hash = 2166136261;
  for (const ch of String(value || "voice")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, length);
}

function assignVoiceRecipe(entity, recipe) {
  if (!entity || typeof entity !== "object" || !recipe) return false;
  if (entity.voice_enabled === false || entity.voiceEnabled === false || entity.tts?.enabled === false) return false;
  if (extractVoiceRecipe(entity)) return false;
  entity.voice_recipe = recipe;
  entity.voiceRecipe = recipe;
  entity.voice_enabled = true;
  entity.voiceEnabled = true;
  entity.tts = { ...(entity.tts && typeof entity.tts === "object" ? entity.tts : {}), enabled: true, voice_recipe: recipe };
  return true;
}

function defaultVoiceRecipe(name = "", provider = "pocket") {
  const key = String(name || "character").trim().toLowerCase() || "character";
  if (String(provider || "").toLowerCase() === "kokoro") {
    const voice = KOKORO_PRESET_VOICES[stableVoiceIndex(key, KOKORO_PRESET_VOICES.length)] || "af_heart";
    return createKokoroVoiceRecipe({ voice, language: "english", label: `${name || "Character"} Voice` });
  }
  const voice = POCKET_PRESET_VOICES[stableVoiceIndex(key, POCKET_PRESET_VOICES.length)] || "alba";
  return createPocketVoiceRecipe({ fallbackVoice: voice, voice, language: "english", label: `${name || "Character"} Voice` });
}

function voiceEntityCollections(s) {
  const relationships = s.relationships && typeof s.relationships === "object" ? Object.values(s.relationships) : [];
  const social = s.social && typeof s.social === "object"
    ? Object.values(s.social).flatMap((value) => Array.isArray(value) ? value : [])
    : [];
  return [
    ...(Array.isArray(s.character_cards) ? s.character_cards : []),
    ...(Array.isArray(s.personas) ? s.personas : []),
    ...(Array.isArray(s.sceneCharacters) ? s.sceneCharacters : []),
    ...(Array.isArray(s.party?.members) ? s.party.members : []),
    ...(Array.isArray(s.trackedCharacters) ? s.trackedCharacters : []),
    ...(Array.isArray(s.externalCharacters) ? s.externalCharacters : []),
    ...relationships,
    ...social,
  ].filter((entity) => entity && typeof entity === "object");
}

function entityMatchesSpeaker(entity, id) {
  return sameSpeaker(entity?.id, id)
    || sameSpeaker(entity?.cardId, id)
    || sameSpeaker(entity?.name, id)
    || sameSpeaker(entity?.identity?.name, id);
}

export function ensureVoiceAssignments(settings = getRuntimeSettings()) {
  const s = settings && typeof settings === "object" ? settings : {};
  const audio = s.audio && typeof s.audio === "object" ? s.audio : (s.audio = {});
  const provider = String(audio.provider || "pocket").toLowerCase() === "kokoro" ? "kokoro" : "pocket";
  let changed = false;

  for (const entity of voiceEntityCollections(s)) {
    const name = String(entity?.name || entity?.identity?.name || entity?.id || "Character").trim() || "Character";
    changed = assignVoiceRecipe(entity, defaultVoiceRecipe(name, provider)) || changed;
  }

  if (!String(audio.narratorVoiceRecipe || "").trim()) {
    audio.narratorVoiceRecipe = defaultVoiceRecipe("Narrator", provider);
    changed = true;
  }

  if (changed) {
    try { window.UIE?.saveSettings?.(); } catch (_) {}
  }
  return changed;
}

function findRuntimeVoiceRecipe(charId = "") {
  const s = getRuntimeSettings();
  const id = String(charId || "").trim();
  if (!id) return "";
  ensureVoiceAssignments(s);
  const cards = Array.isArray(s.character_cards) ? s.character_cards : [];
  const card = cards.find((c) => sameSpeaker(c?.id, id) || sameSpeaker(c?.name, id));
  const cardRecipe = extractVoiceRecipe(card);
  if (cardRecipe) return cardRecipe;

  const personas = Array.isArray(s.personas) ? s.personas : [];
  const activePersonaId = String(s.activePersonaId || s.character?.activePersonaId || "").trim();
  const isUser = /^(user|you|me|player|protagonist)$/i.test(id);
  const persona = personas.find((p) => sameSpeaker(p?.id, id) || sameSpeaker(p?.name, id))
    || (isUser ? personas.find((p) => sameSpeaker(p?.id, activePersonaId)) : null);
  if (entityVoiceDisabled(persona)) return "none";
  const personaRecipe = extractVoiceRecipe(persona);
  if (personaRecipe) return personaRecipe;

  if (/^(narrator|omniscient narrator|world)$/i.test(id)) {
    const audio = s.audio && typeof s.audio === "object" ? s.audio : {};
    const narratorCards = Array.isArray(s.omniscient?.narratorCards) ? s.omniscient.narratorCards : [];
    const narratorId = String(s.omniscient?.narratorCardId || "narrator_default").trim();
    const narrator = narratorCards.find((n) => sameSpeaker(n?.id, narratorId) || sameSpeaker(n?.name, id)) || narratorCards[0];
    return extractVoiceRecipe(narrator) || String(audio.narratorVoiceRecipe || "").trim();
  }
  const entity = voiceEntityCollections(s).find((item) => entityMatchesSpeaker(item, id));
  if (entityVoiceDisabled(entity)) return "none";
  const entityRecipe = extractVoiceRecipe(entity);
  if (entityRecipe) return entityRecipe;
  return defaultVoiceRecipe(id, String(s.audio?.provider || "pocket").toLowerCase() === "kokoro" ? "kokoro" : "pocket");
}

function normalizePocketRecipe(recipe = "", fallback = {}) {
  const raw = String(recipe || "").trim();
  const parts = raw.split("|");
  if (parts[0] === "pocket-tts-v1") {
    return {
      engine: "pocket",
      refAudioUrl: decodeURIComponent(parts[1] || ""),
      refText: decodeURIComponent(parts[2] || ""),
      label: decodeURIComponent(parts[3] || "Pocket Reference Voice"),
      language: decodeURIComponent(parts[4] || fallback.language || "english"),
      fallbackVoice: decodeURIComponent(parts[5] || fallback.fallbackVoice || fallback.voice || ""),
      speed: clampNumber(decodeURIComponent(parts[6] || ""), 0.25, 4, fallback.speed ?? 1),
      pitch: clampNumber(decodeURIComponent(parts[7] || ""), 0.5, 2, fallback.pitch ?? 1),
      warmth: clampNumber(decodeURIComponent(parts[8] || ""), 0, 1, fallback.warmth ?? 0.5),
      clarity: clampNumber(decodeURIComponent(parts[9] || ""), 0, 1, fallback.clarity ?? 0.5)
    };
  }
  return {
    engine: "pocket",
    refAudioUrl: String(fallback.refAudioUrl || fallback.referenceAudioUrl || fallback.voiceRef || ""),
    refText: String(fallback.refText || fallback.referenceText || ""),
    label: String(fallback.label || "Pocket Reference Voice"),
    language: String(fallback.language || "english"),
    fallbackVoice: String(fallback.fallbackVoice || fallback.voice || ""),
    speed: clampNumber(fallback.speed, 0.25, 4, 1),
    pitch: clampNumber(fallback.pitch, 0.5, 2, 1),
    warmth: clampNumber(fallback.warmth, 0, 1, 0.5),
    clarity: clampNumber(fallback.clarity, 0, 1, 0.5)
  };
}

function normalizeKokoroRecipe(recipe = "", fallback = {}) {
  const parts = String(recipe || "").trim().split("|");
  if (parts[0] === "kokoro-tts-v1") {
    return {
      engine: "kokoro",
      voice: decodeURIComponent(parts[1] || fallback.voice || "af_heart"),
      language: decodeURIComponent(parts[2] || fallback.language || "english"),
      speed: clampNumber(decodeURIComponent(parts[3] || ""), 0.25, 4, fallback.speed ?? 1),
      pitch: clampNumber(decodeURIComponent(parts[4] || ""), 0.5, 2, fallback.pitch ?? 1),
      label: decodeURIComponent(parts[5] || fallback.label || "Kokoro Voice")
    };
  }
  return {
    engine: "kokoro",
    voice: String(fallback.voice || "af_heart"),
    language: String(fallback.language || "english"),
    speed: clampNumber(fallback.speed, 0.25, 4, 1),
    pitch: clampNumber(fallback.pitch, 0.5, 2, 1),
    label: String(fallback.label || "Kokoro Voice")
  };
}

function normalizeVoiceRecipe(recipe = "", fallback = {}) {
  const raw = String(recipe || "").trim();
  if (raw.startsWith("kokoro-studio-v1|")) {
    const parts = raw.split("|");
    return {
      engine: "kokoro-studio",
      genderBlend: clampNumber(decodeURIComponent(parts[1] || ""), 0, 1, 0.5),
      vibeBlend: clampNumber(decodeURIComponent(parts[2] || ""), 0, 1, 0.5),
      speed: clampNumber(decodeURIComponent(parts[3] || ""), 0.25, 4, fallback.speed ?? 1),
      pitch: clampNumber(decodeURIComponent(parts[4] || ""), 0.5, 2, fallback.pitch ?? 1),
      label: decodeURIComponent(parts[5] || fallback.label || "Kokoro Studio Voice")
    };
  }
  if (raw.startsWith("kokoro-tts-v1|")) return normalizeKokoroRecipe(raw, fallback);
  return normalizePocketRecipe(raw, fallback);
}

export function createPocketVoiceRecipe(config = {}) {
  const refAudioUrl = encodeURIComponent(String(config.refAudioUrl || config.referenceAudioUrl || config.voiceRef || "").trim());
  const refText = encodeURIComponent(String(config.refText || config.referenceText || "").trim());
  const label = encodeURIComponent(String(config.label || "Pocket Reference Voice").trim());
  const language = encodeURIComponent(String(config.language || "english").trim() || "english");
  const fallbackVoice = encodeURIComponent(String(config.fallbackVoice || config.voice || "").trim());
  const speed = encodeURIComponent(String(clampNumber(config.speed, 0.25, 4, 1)));
  const pitch = encodeURIComponent(String(clampNumber(config.pitch, 0.5, 2, 1)));
  const warmth = encodeURIComponent(String(clampNumber(config.warmth, 0, 1, 0.5)));
  const clarity = encodeURIComponent(String(clampNumber(config.clarity, 0, 1, 0.5)));
  return `pocket-tts-v1|${refAudioUrl}|${refText}|${label}|${language}|${fallbackVoice}|${speed}|${pitch}|${warmth}|${clarity}`;
}

export function createKokoroVoiceRecipe(config = {}) {
  const voice = encodeURIComponent(String(config.voice || "af_heart").trim() || "af_heart");
  const language = encodeURIComponent(String(config.language || "english").trim() || "english");
  const speed = encodeURIComponent(String(clampNumber(config.speed, 0.25, 4, 1)));
  const pitch = encodeURIComponent(String(clampNumber(config.pitch, 0.5, 2, 1)));
  const label = encodeURIComponent(String(config.label || "Kokoro Voice").trim() || "Kokoro Voice");
  return `kokoro-tts-v1|${voice}|${language}|${speed}|${pitch}|${label}`;
}

export function createKokoroStudioVoiceRecipe(config = {}) {
  const gender = encodeURIComponent(String(clampNumber(config.genderBlend ?? config.gender, 0, 1, 0.5)));
  const vibe = encodeURIComponent(String(clampNumber(config.vibeBlend ?? config.vibe, 0, 1, 0.5)));
  const speed = encodeURIComponent(String(clampNumber(config.speed, 0.25, 4, 1)));
  const pitch = encodeURIComponent(String(clampNumber(config.pitch, 0.5, 2, 1)));
  const label = encodeURIComponent(String(config.label || "Kokoro Studio Voice").trim() || "Kokoro Studio Voice");
  return `kokoro-studio-v1|${gender}|${vibe}|${speed}|${pitch}|${label}`;
}

export function createDefaultPocketVoiceRecipe(label = "Pocket Reference Voice") {
  return createPocketVoiceRecipe({ label });
}

export function createRandomPocketVoiceRecipe(seed = Math.random()) {
  const n = Math.floor(Number(seed) * 1000000) || Date.now();
  return createPocketVoiceRecipe({ label: `Pocket Reference ${n.toString(36).slice(-4)}` });
}

let RawAudioClass = null;
async function captureRawAudioClass(tts) {
  if (RawAudioClass) return RawAudioClass;
  try {
    const dummy = await tts.generate(".", { voice: "af_heart" });
    RawAudioClass = dummy.constructor;
  } catch (err) {
    console.warn("[VoiceBridge] Capture RawAudio constructor failed:", err);
  }
  return RawAudioClass;
}

// Monkeypatch KokoroTTS prototype to support Float32Array style vectors and select correct phonemizer language
if (KokoroTTS?.prototype) {
  const originalValidateVoice = KokoroTTS.prototype._validate_voice;
  KokoroTTS.prototype._validate_voice = function(e) {
    if (e instanceof Float32Array) {
      return "a"; // default to American English phonemizer
    }
    if (e && typeof e === "object" && e.vector instanceof Float32Array) {
      const lang = String(e.language || "english").toLowerCase();
      if (lang === "japanese" || lang === "ja") return "j";
      if (lang === "chinese" || lang === "zh") return "z";
      if (lang === "spanish" || lang === "es") return "e";
      if (lang === "french" || lang === "fr") return "f";
      if (lang === "hindi" || lang === "hi") return "h";
      if (lang === "italian" || lang === "it") return "i";
      if (lang === "portuguese" || lang === "pt") return "p";
      if (lang === "en-gb" || lang === "gb") return "b";
      return "a";
    }
    return originalValidateVoice.call(this, e);
  };

  const originalGenerateFromIds = KokoroTTS.prototype.generate_from_ids;
  KokoroTTS.prototype.generate_from_ids = async function(ids, options = {}) {
    let { voice = "af_heart", speed = 1 } = options;
    let vector = null;
    if (voice instanceof Float32Array) {
      vector = voice;
    } else if (voice && typeof voice === "object" && voice.vector instanceof Float32Array) {
      vector = voice.vector;
    }
    if (vector) {
      const l = 256 * Math.min(Math.max(ids.dims.at(-1) - 2, 0), 509);
      const s = vector.slice(l, l + 256);
      const TensorClass = ids.constructor;
      const inputs = {
        input_ids: ids,
        style: new TensorClass("float32", s, [1, 256]),
        speed: new TensorClass("float32", [speed], [1])
      };
      const { waveform } = await this.model(inputs);
      const RawAudio = await captureRawAudioClass(this);
      if (RawAudio) {
        return new RawAudio(waveform.data, 24000);
      }
      return { data: waveform.data, samplerate: 24000 };
    }
    return originalGenerateFromIds.call(this, ids, options);
  };
}

export class KokoroLocalEngine {
  constructor() {
    this.tts = null;
    this.loading = null;
    this.voiceVectors = new Map();
  }

  async initialize() {
    if (this.tts) return this.tts;
    if (this.loading) return this.loading;
    if (!KokoroTTS) throw new Error("Browser Kokoro is disabled; use the bundled local backend.");

    this.loading = (async () => {
      publishTtsState({ status: "Downloading Model...", provider: "kokoro", progress: 0.05, error: "" });
      
      const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
      const options = {
        dtype: "q8",
        progress_callback: (progress) => {
          if (progress.status === "downloading") {
            publishTtsState({
              status: `Downloading Model...`,
              provider: "kokoro",
              progress: 0.05 + 0.8 * (progress.progress / 100 || 0)
            });
          }
        }
      };

      try {
        console.log("[KokoroLocalEngine] Initializing with WebGPU...");
        this.tts = await KokoroTTS.from_pretrained(modelId, { ...options, device: "webgpu" });
        console.log("[KokoroLocalEngine] WebGPU initialized successfully.");
      } catch (err) {
        console.warn("[KokoroLocalEngine] WebGPU failed, falling back to WASM:", err);
        publishTtsState({ status: "WebGPU failed, falling back to WASM...", provider: "kokoro", progress: 0.1 });
        this.tts = await KokoroTTS.from_pretrained(modelId, { ...options, device: "wasm" });
      }

      await captureRawAudioClass(this.tts);

      publishTtsState({ status: "Ready", provider: "kokoro", progress: 1, error: "" });
      this.loading = null;
      return this.tts;
    })();

    return this.loading;
  }

  async getVoiceVector(voiceName) {
    if (this.voiceVectors.has(voiceName)) {
      return this.voiceVectors.get(voiceName);
    }
    const url = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voiceName}.bin`;
    let arrayBuffer = null;
    try {
      const cache = await caches.open("kokoro-voices");
      const matched = await cache.match(url);
      if (matched) {
        arrayBuffer = await matched.arrayBuffer();
      }
    } catch (e) {
      console.warn("[KokoroLocalEngine] Error reading voice cache:", e);
    }

    if (!arrayBuffer) {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch voice vector ${voiceName}`);
      arrayBuffer = await resp.arrayBuffer();
      try {
        const cache = await caches.open("kokoro-voices");
        await cache.put(url, new Response(arrayBuffer.slice(0), { headers: resp.headers }));
      } catch (e) {}
    }

    const vector = new Float32Array(arrayBuffer);
    this.voiceVectors.set(voiceName, vector);
    return vector;
  }

  async blendVectors(cfg = {}) {
    const wGender = clampNumber(cfg.genderBlend ?? cfg.gender ?? 0.5, 0, 1, 0.5);
    const wVibe = clampNumber(cfg.vibeBlend ?? cfg.vibe ?? 0.5, 0, 1, 0.5);

    const vAdam = await this.getVoiceVector("am_adam");
    const vHeart = await this.getVoiceVector("af_heart");
    const vSky = await this.getVoiceVector("af_sky");
    const vBella = await this.getVoiceVector("af_bella");

    const size = vAdam.length;
    const blended = new Float32Array(size);

    for (let i = 0; i < size; i++) {
      const genderVal = (1 - wGender) * vAdam[i] + wGender * vHeart[i];
      const vibeVal = (1 - wVibe) * vSky[i] + wVibe * vBella[i];
      blended[i] = 0.5 * genderVal + 0.5 * vibeVal;
    }

    return blended;
  }

  async synthesize(text, options = {}) {
    await this.initialize();
    publishTtsState({ status: "Synthesizing...", provider: "kokoro", progress: 0.6 });

    let voiceOption = options.voice || "af_heart";
    const speed = clampNumber(options.speed ?? 1, 0.25, 4, 1);
    const language = options.language || "english";

    if (options.isStudio || options.genderBlend !== undefined || options.vibeBlend !== undefined) {
      const blendedVector = await this.blendVectors(options);
      voiceOption = {
        vector: blendedVector,
        language: language
      };
    }

    const audio = await this.tts.generate(prepareDialogueForSpeech(text), {
      voice: voiceOption,
      speed: speed
    });

    publishTtsState({ status: "Ready", provider: "kokoro", progress: 1 });
    return audio;
  }
}

let sharedKokoroLocalEngine = null;
export function getKokoroLocalEngine() {
  if (!sharedKokoroLocalEngine) {
    sharedKokoroLocalEngine = new KokoroLocalEngine();
  }
  return sharedKokoroLocalEngine;
}

function audioBufferToWavBlob(audioBuffer) {
  const numOfChan = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // raw PCM
  const bitDepth = 16;
  
  let result;
  if (numOfChan === 1) {
    result = audioBuffer.getChannelData(0);
  } else {
    const c0 = audioBuffer.getChannelData(0);
    const c1 = audioBuffer.getChannelData(1);
    result = new Float32Array(c0.length);
    for (let i = 0; i < c0.length; i++) {
      result[i] = 0.5 * (c0[i] + c1[i]);
    }
  }
  
  const buffer = new ArrayBuffer(44 + result.length * 2);
  const view = new DataView(buffer);
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + result.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, result.length * 2, true);
  
  let offset = 44;
  for (let i = 0; i < result.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function wavBytesToAudioBuffer(bytes, audioContext) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes?.buffer?.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (!buffer) throw new Error("Pocket TTS returned no WAV bytes.");
  return audioContext.decodeAudioData(buffer.slice(0));
}

function makeSilentBuffer(audioContext, seconds = 1) {
  const frames = Math.max(1, Math.floor(audioContext.sampleRate * seconds));
  return audioContext.createBuffer(1, frames, audioContext.sampleRate);
}

function escapeOption(value) { return String(value ?? "").replace(/[&<>\"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]); }

export function refreshVoiceDropdown(select, registry) {
  if (!select || !registry?.voices) return;
  const selected = select.value;
  const groups = new Map([
    ["Model Preset Voices — Female", []], ["Model Preset Voices — Male", []], ["Model Preset Voices — Kid", []], ["Model Preset Voices — Other", []], ["Creator Preset Voices", []]
  ]);
  for (const voice of registry.voices) {
    const group = voice.category === "creator" ? "Creator Preset Voices" : voice.agePresentation === "child" ? "Model Preset Voices — Kid" : voice.genderPresentation === "feminine" ? "Model Preset Voices — Female" : voice.genderPresentation === "masculine" ? "Model Preset Voices — Male" : "Model Preset Voices — Other";
    groups.get(group).push(voice);
  }
  select.innerHTML = [...groups].filter(([, voices]) => voices.length).map(([label, voices]) => `<optgroup label="${label}">${voices.sort((a,b) => a.name.localeCompare(b.name)).map(v => `<option value="${escapeOption(v.id)}"${v.enabled && v.ready ? "" : " disabled"}>${escapeOption(v.name)}${v.category === "creator" ? " · Creator" : ""}${v.enabled && v.ready ? "" : " (Unavailable)"}</option>`).join("")}</optgroup>`).join("");
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function refreshEngineVoiceDropdown(select, registry, engine, includeCustom = false) {
  if (!select || !registry?.voices) return;
  const selected = String(select.value || "");
  const voices = registry.voices
    .filter((voice) => voice?.engine === engine && voice?.category === "model" && voice?.enabled !== false && voice?.ready !== false)
    .map((voice) => String(voice.engineVoice || voice.voice || "").trim())
    .filter(Boolean);
  const unique = [...new Set(voices)];
  select.innerHTML = [
    ...(includeCustom ? ['<option value="custom">Custom Blend (Studio)</option>'] : []),
    ...unique.map((voice) => `<option value="${escapeOption(voice)}">${escapeOption(voice)}</option>`),
  ].join("");
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  else if (select.options.length) select.selectedIndex = 0;
}

function publishVoiceRegistry(registry) {
  document.querySelectorAll("[data-uie-voice-registry]").forEach((select) => refreshVoiceDropdown(select, registry));
  document.querySelectorAll("#cfg-audio-pocket-voice, #persona-pocket-fallback-voice, #uie-npc-pocket-fallback-voice, #ce-pocket-fallback-voice")
    .forEach((select) => refreshEngineVoiceDropdown(select, registry, "pocket"));
  document.querySelectorAll("#cfg-audio-kokoro-voice, #persona-kokoro-voice, #uie-npc-kokoro-voice, #ce-kokoro-voice")
    .forEach((select) => refreshEngineVoiceDropdown(select, registry, "kokoro", true));
  try { window.dispatchEvent(new CustomEvent("uie:voice-registry", { detail: registry })); } catch (_) {}
}


function ttsDisabled() {
  try {
    const audio = getRuntimeSettings()?.audio || {};
    return audio.enabled === false
      || audio.ttsEnabled === false
      || String(audio.assignment || "").toLowerCase() === "none";
  } catch (_) {
    return false;
  }
}

export class PocketVoiceEngine {
  constructor(options = {}) {
    this.baseUrl = backendBaseUrl(options);
    this.ready = null;
    this.referenceVoices = new Map();
    this.queue = Promise.resolve();
  }

  async initialize(options = {}) {
    this.baseUrl = backendBaseUrl(options);
    if (!this.ready) {
      publishTtsState({ status: "Connecting Pocket TTS...", provider: "pocket", progress: 0.25, error: "" });
      this.ready = fetch(`${this.baseUrl}/audio/voices`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Pocket TTS backend unavailable (${response.status}).`);
          const data = await response.json().catch(() => ({}));
          fetch(`${this.baseUrl}/api/tts/voices`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(registry => {
            if (!registry) return;
            publishVoiceRegistry(registry);
          }).catch(() => {});
          publishTtsState({ status: "Ready", provider: "pocket", progress: 1, error: "" });
          return data;
        })
        .catch((error) => {
          this.ready = null;
          publishTtsState({ status: "Error", provider: "pocket", progress: 0, error: String(error?.message || error || "") });
          throw error;
        });
    }
    return this.ready;
  }

  registerReferenceVoice(characterId, reference = {}) {
    const id = String(characterId || "default");
    const entry = {
      refAudioUrl: String(reference.refAudioUrl || reference.referenceAudioUrl || reference.voiceRef || ""),
      refText: String(reference.refText || reference.referenceText || ""),
      language: String(reference.language || "english")
    };
    this.referenceVoices.set(id, entry);
    return entry;
  }

  resolveReference(characterId = "default", options = {}) {
    const registered = this.referenceVoices.get(String(characterId || "default")) || {};
    const recipe = normalizeVoiceRecipe(
      options.voice_recipe || options.voiceRecipe || options.voice || findRuntimeVoiceRecipe(characterId),
      registered
    );
    const audio = getRuntimeSettings()?.audio || {};
    const pocket = audio.pocket || {};
    const registryVoiceId = String(options.voiceId || options.voice_id || options.presetVoice || options.fallbackVoice || options.voiceName || pocket.voice || audio.voice || "").trim();
    const optionVoice = normalizePocketVoice(options.voice, "");
    const voice = normalizePocketVoice(
      options.presetVoice || options.fallbackVoice || options.voiceName || optionVoice || pocket.voice || audio.voice || "alba",
      "alba"
    );
    return {
      refAudioUrl: String(options.refAudioUrl || options.referenceAudioUrl || recipe.refAudioUrl || registered.refAudioUrl || pocket.reference || audio.reference || ""),
      refText: String(options.refText || options.referenceText || recipe.refText || registered.refText || pocket.refText || audio.referenceText || audio.f5RefText || ""),
      language: String(options.language || recipe.language || registered.language || pocket.language || audio.language || "english"),
      voice: normalizePocketVoice(options.fallbackVoice || recipe.fallbackVoice || voice, voice),
      voiceId: /^(model|creator)_/.test(registryVoiceId) ? registryVoiceId : "",
      engine: recipe.engine || "pocket",
      kokoroVoice: String(options.kokoroVoice || recipe.voice || ""),
      speed: clampNumber(options.speed ?? recipe.speed, 0.25, 4, 1),
      pitch: clampNumber(options.pitch ?? recipe.pitch, 0.5, 2, 1),
      useReference: pocket.useReference !== false,
      referenceSeconds: clampNumber(pocket.referenceSeconds, 1, 15, 6)
    };
  }

  synthesize(characterId, dialogueText, options = {}) {
    const task = async () => {
      await this.initialize(options);
      const reference = this.resolveReference(characterId, options);
      const audio = getRuntimeSettings()?.audio || {};
      const requestedRecipe = String(options.voice_recipe || options.voiceRecipe || options.voice || findRuntimeVoiceRecipe(characterId) || "").trim();
      const recipeProvider = String(reference.engine || "").startsWith("kokoro") ? "kokoro" : "pocket";
      const provider = String(requestedRecipe ? recipeProvider : (options.provider || audio.provider || "pocket")).toLowerCase();
      const kokoro = audio.kokoro || {};
      const pocketReference = reference.useReference === false ? "" : reference.refAudioUrl;
      const pocketRefText = reference.useReference === false ? "" : reference.refText;
      const payload = {
        text: prepareDialogueForSpeech(dialogueText),
        character_id: String(characterId || "default"),
        engine_preference: provider === "kokoro" ? "kokoro" : "pocket",
        reference_audio_url: provider === "kokoro" ? "" : pocketReference,
        reference_text: provider === "kokoro" ? "" : pocketRefText,
        voice: provider === "kokoro" ? String(reference.kokoroVoice || options.kokoroVoice || kokoro.voice || "af_heart") : (reference.voice || "alba"),
        voice_id: String(options.voiceId || options.voice_id || reference.voiceId || ""),
        voice_recipe: provider === "kokoro" ? "" : String(options.voice_recipe || options.voiceRecipe || options.voice || findRuntimeVoiceRecipe(characterId) || ""),
        language: provider === "kokoro" ? String(reference.language || options.language || kokoro.language || "english") : (reference.language || "english"),
        speed: clampNumber(options.speed ?? reference.speed ?? kokoro.speed, 0.25, 4, 1),
        reference_seconds: reference.referenceSeconds,
        format: "wav"
      };
      publishTtsState({ status: provider === "kokoro" ? "Synthesizing Kokoro TTS..." : "Synthesizing Pocket TTS...", provider, progress: 0.6, error: "" });
      const response = await fetch(`${this.baseUrl}/audio/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let detail = "";
        try { detail = (await response.json())?.detail || ""; } catch (_) {}
        throw new Error(detail || `Pocket TTS generation failed (${response.status}).`);
      }
      const wavBytes = await response.arrayBuffer();
      publishTtsState({ status: "Ready", provider, progress: 1, error: "" });
      return { wavBytes, sampleRate: POCKET_SAMPLE_RATE, provider };
    };
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  async createPlaybackUrl(characterId, dialogueText, options = {}) {
    const result = await this.synthesize(characterId, dialogueText, options);
    const audioBlob = new Blob([result.wavBytes], { type: "audio/wav" });
    return URL.createObjectURL(audioBlob);
  }

  getRuntimeState() {
    return { ...ttsRuntimeState };
  }
}

export class VoiceBridge {
  constructor(procdAudioInstance) {
    this.audioContext = getAudioContext(procdAudioInstance);
    this.voiceDatabase = {};
    this.cacheEnabled = true;
    this.audioCache = new Map();
    this.maxCachedVoiceAssets = 12;
    this.activeSource = null;
    this.lastPlaybackUrl = "";
    this.engine = sharedEngine || new PocketVoiceEngine();
    sharedEngine = this.engine;
    this.initializeContext();
    window.UIE_VOICE_BRIDGE = this;
    window.UIE_POCKET_VOICE_ENGINE = this.engine;
  }

  initializeContext() {
    if (this.audioContext.state === "suspended") {
      document.addEventListener("click", () => this.audioContext.resume(), { once: true });
    }
  }

  registerVoice(charId, voiceRefPath, metadata = {}) {
    const entry = {
      refAudioUrl: String(metadata.refAudioUrl || metadata.referenceAudioUrl || voiceRefPath || ""),
      refText: String(metadata.refText || metadata.referenceText || ""),
      language: String(metadata.language || "english")
    };
    this.voiceDatabase[charId] = entry;
    this.engine.registerReferenceVoice(charId, entry);
  }

  createStudioRecipe(config = {}) {
    if (config.isStudio || config.genderBlend !== undefined || config.vibeBlend !== undefined) {
      return createKokoroStudioVoiceRecipe(config);
    }
    if (config.provider === "kokoro") {
      return createKokoroVoiceRecipe(config);
    }
    return createPocketVoiceRecipe(config);
  }

  parseStudioRecipe(recipe = "") {
    return normalizeVoiceRecipe(recipe);
  }

  getRuntimeState() {
    return this.engine.getRuntimeState();
  }

  async getTts(options = {}) {
    return this.engine.initialize(options);
  }

  async synthesizeVoiceUrl(text, charId = "default", options = {}) {
    this.stopActiveVoice();
    const audioSettings = getRuntimeSettings()?.audio || {};
    const provider = String(options.provider || audioSettings.provider || "pocket").toLowerCase();
    const recipe = String(options.voice_recipe || options.voiceRecipe || options.voice || findRuntimeVoiceRecipe(charId) || "");
    if (recipe.toLowerCase() === "none") throw new Error(`Voice is disabled for ${charId}.`);
    const parsedRecipe = normalizeVoiceRecipe(recipe, {});
    const effectiveProvider = recipe
      ? (String(parsedRecipe.engine || "").startsWith("kokoro") ? "kokoro" : "pocket")
      : provider;

    if (effectiveProvider === "kokoro") {
      const audioBuffer = await this.synthesizeVoice(text, charId, options);
      const wavBlob = audioBufferToWavBlob(audioBuffer);
      const url = URL.createObjectURL(wavBlob);
      if (this.lastPlaybackUrl) URL.revokeObjectURL(this.lastPlaybackUrl);
      this.lastPlaybackUrl = url;
      return url;
    }

    if (this.voiceDatabase[charId]) {
      this.engine.registerReferenceVoice(charId, this.voiceDatabase[charId]);
    }
    const url = await this.engine.createPlaybackUrl(charId, text, options);
    if (this.lastPlaybackUrl) URL.revokeObjectURL(this.lastPlaybackUrl);
    this.lastPlaybackUrl = url;
    return url;
  }

  async synthesizeVoice(text, charId = "default", options = {}) {
    const { useFallback = true } = options;
    if (ttsDisabled()) {
      const message = "TTS is disabled in Audio settings.";
      publishTtsState({ status: "TTS disabled", error: message });
      if (useFallback) return makeSilentBuffer(this.audioContext);
      throw new Error(message);
    }
    
    this.stopActiveVoice();

    const audioSettings = getRuntimeSettings()?.audio || {};
    const provider = String(options.provider || audioSettings.provider || "pocket").toLowerCase();
    const recipe = String(options.voice_recipe || options.voiceRecipe || options.voice || findRuntimeVoiceRecipe(charId) || "");
    if (recipe.toLowerCase() === "none") {
      const message = `Voice is disabled for ${charId}.`;
      publishTtsState({ status: "Voice disabled", error: message });
      if (useFallback) return makeSilentBuffer(this.audioContext);
      throw new Error(message);
    }
    const parsedRecipe = normalizeVoiceRecipe(recipe, {});
    const effectiveProvider = recipe
      ? (String(parsedRecipe.engine || "").startsWith("kokoro") ? "kokoro" : "pocket")
      : provider;
    
    const providerVoiceKey = effectiveProvider === "kokoro"
      ? `${parsedRecipe.voice || options.kokoroVoice || audioSettings.kokoro?.voice || "af_heart"}:${parsedRecipe.language || options.language || audioSettings.kokoro?.language || "english"}:${parsedRecipe.speed || options.speed || audioSettings.kokoro?.speed || 1}:${parsedRecipe.pitch || options.pitch || 1}:${parsedRecipe.genderBlend ?? ""}:${parsedRecipe.vibeBlend ?? ""}`
      : `${recipe}:${options.fallbackVoice || options.voiceName || ""}:${options.speed || parsedRecipe.speed || 1}:${options.pitch || parsedRecipe.pitch || 1}`;
    
    const cacheKey = `${charId}:${effectiveProvider}:${providerVoiceKey}:${String(text || "")}`;
    if (this.cacheEnabled && this.audioCache.has(cacheKey)) return this.audioCache.get(cacheKey);
    
    try {
      if (this.voiceDatabase[charId]) {
        this.engine.registerReferenceVoice(charId, this.voiceDatabase[charId]);
      }
      
      let audioBuffer;
      if (effectiveProvider === "kokoro") {
        const studioVoice = (() => {
          if (parsedRecipe.engine !== "kokoro-studio") return "";
          const feminine = Number(parsedRecipe.genderBlend ?? 0.5) >= 0.5;
          const energetic = Number(parsedRecipe.vibeBlend ?? 0.5) >= 0.58;
          if (feminine) return energetic ? "af_bella" : "af_sky";
          return energetic ? "am_puck" : "am_adam";
        })();
        const result = await this.engine.synthesize(charId, text, {
          ...options,
          provider: "kokoro",
          kokoroVoice: studioVoice || parsedRecipe.voice || options.kokoroVoice || audioSettings.kokoro?.voice || "af_heart",
          language: parsedRecipe.language || options.language || audioSettings.kokoro?.language || "english",
          speed: parsedRecipe.speed || options.speed || audioSettings.kokoro?.speed || 1,
        });
        audioBuffer = await wavBytesToAudioBuffer(result.wavBytes, this.audioContext);
      } else {
        const result = await this.engine.synthesize(charId, text, options);
        audioBuffer = await wavBytesToAudioBuffer(result.wavBytes, this.audioContext);
      }
      
      this.cacheVoiceAsset(cacheKey, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.error("[VoiceBridge] TTS synthesis error:", error);
      publishTtsState({ status: "Error", error: String(error?.message || error || "") });
      if (useFallback) return makeSilentBuffer(this.audioContext);
      throw error;
    }
  }

  stopActiveVoice() {
    try { this.activeSource?.stop?.(0); } catch (_) {}
    try { this.activeSource?.disconnect?.(); } catch (_) {}
    this.activeSource = null;
  }

  playVoiceWithEffects(audioBuffer, effects = {}) {
    const sceneDefaults = getRuntimeSettings()?.audio?.immersion || {};
    const { volume = 0.8, commsFilter = false, room = "", distance = 0, pan = 0 } = { ...sceneDefaults, ...effects };
    this.stopActiveVoice();
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = clampNumber(effects.playbackRate ?? effects.speed ?? effects.pitch, 0.5, 2, 1);

    let currentNode = source;
    if (commsFilter) {
      const biquad = this.audioContext.createBiquadFilter();
      biquad.type = "bandpass";
      biquad.frequency.value = 1500;
      biquad.Q.value = 5;
      currentNode.connect(biquad);
      currentNode = biquad;
    }

    // Optional scene placement: distance, stereo position, and a subtle room
    // response make dialogue feel located in the world without obscuring it.
    const normalizedDistance = clampNumber(distance, 0, 1, 0);
    if (normalizedDistance > 0) {
      const lowpass = this.audioContext.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 18000 - (normalizedDistance * 10500);
      lowpass.Q.value = 0.35;
      currentNode.connect(lowpass);
      currentNode = lowpass;
    }
    const requestedPan = clampNumber(pan, -1, 1, 0);
    if (requestedPan && this.audioContext.createStereoPanner) {
      const panner = this.audioContext.createStereoPanner();
      panner.pan.value = requestedPan;
      currentNode.connect(panner);
      currentNode = panner;
    }
    if (room && this.audioContext.createConvolver) {
      const seconds = room === "large" ? 0.55 : 0.22;
      const impulse = this.audioContext.createBuffer(1, Math.ceil(this.audioContext.sampleRate * seconds), this.audioContext.sampleRate);
      const data = impulse.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, room === "large" ? 2.1 : 3.6) * 0.18;
      const convolver = this.audioContext.createConvolver();
      convolver.buffer = impulse;
      const wet = this.audioContext.createGain();
      wet.gain.value = room === "large" ? 0.16 : 0.09;
      currentNode.connect(convolver);
      convolver.connect(wet);
      currentNode.connect(wet);
      currentNode = wet;
    }

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = clampNumber(volume, 0, 2, 0.8);
    currentNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    source.start(0);
    this.activeSource = source;
    source.onended = () => {
      if (this.activeSource === source) this.activeSource = null;
    };
    return source;
  }

  async createSpeechBubble(container, text, charId, options = {}) {
    const { duration = 3000, position = { x: 0, y: 0 }, effects = {} } = options;
    const bubble = document.createElement("div");
    bubble.className = "re-speech-bubble";
    bubble.textContent = text;
    bubble.style.cssText = `
      position: absolute;
      left: ${position.x}px;
      top: ${position.y}px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      max-width: 300px;
      z-index: 9999;
      white-space: pre-wrap;
    `;
    container.appendChild(bubble);
    try {
      const audioBuffer = await this.synthesizeVoice(text, charId, options.synthesis || {});
      this.playVoiceWithEffects(audioBuffer, effects);
      setTimeout(() => bubble.remove(), Math.max(audioBuffer.duration * 1000 + 500, duration));
    } catch (_) {
      setTimeout(() => bubble.remove(), duration);
    }
  }

  async listVoices() {
    try {
      const data = await this.getTts();
      return Array.isArray(data?.voices) ? data.voices : [...POCKET_PRESET_VOICES, "custom_reference"];
    } catch (_) {
      return [...POCKET_PRESET_VOICES, "custom_reference"];
    }
  }

  async listVoiceRegistry(force = false) {
    try {
      const data = await this.getTts();
      if (force || !this.voiceRegistry || this.voiceRegistry.offline) {
        const response = await fetch(`${this.engine.baseUrl}/api/tts/voices`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not refresh the voice registry.");
        this.voiceRegistry = await response.json();
      }
      return this.voiceRegistry || data;
    } catch (error) {
      this.voiceRegistry = createOfflineVoiceRegistry(error);
      return this.voiceRegistry;
    }
  }

  cacheVoiceAsset(key, value) {
    if (!this.cacheEnabled) return;
    this.audioCache.delete(key);
    this.audioCache.set(key, value);
    while (this.audioCache.size > this.maxCachedVoiceAssets) this.audioCache.delete(this.audioCache.keys().next().value);
  }

  async voiceLibraryRequest(path, options = {}) {
    const response = await fetch(`${this.engine.baseUrl}${path}`, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Voice Library request failed.");
    const data = await response.json();
    if (data.registry) this.voiceRegistry = data.registry;
    return data;
  }

  updateVoiceMetadata(voiceId, patch) { return this.voiceLibraryRequest(`/api/tts/voices/${encodeURIComponent(voiceId)}`, { method: "PATCH", body: JSON.stringify(patch) }); }
  compileVoices(voiceIds) { return this.voiceLibraryRequest("/api/tts/voices/bulk/compile", { method: "POST", body: JSON.stringify({ voice_ids: voiceIds }) }); }
  scanVoices(voiceIds) { return this.voiceLibraryRequest("/api/tts/voices/bulk/scan", { method: "POST", body: JSON.stringify({ voice_ids: voiceIds }) }); }
  updateVoiceBatch(voiceIds, patch) { return this.voiceLibraryRequest("/api/tts/voices/bulk/metadata", { method: "POST", body: JSON.stringify({ voice_ids: voiceIds, ...patch }) }); }
  refreshVoiceWatch() { return this.voiceLibraryRequest("/api/tts/voices/watch/refresh", { method: "POST", body: "{}" }); }

  async previewVoice(voiceId, line = "Hello. This is a preview of the selected voice.", options = {}) {
    this.stopActiveVoice();
    const key = `preview:${voiceId}:${line}`;
    let buffer = this.audioCache.get(key);
    if (!buffer || options.forceRegenerate) {
      buffer = await this.synthesizeVoice(line, "preview", { ...options, voiceId, useFallback: false });
      this.cacheVoiceAsset(key, buffer);
    }
    if (!buffer || !buffer.duration) throw new Error("Voice preview did not return playable audio.");
    return this.playVoiceWithEffects(buffer, { volume: options.volume ?? 0.95 });
  }

  createStreamingCoordinator(options = {}) {
    return new VoiceStreamingCoordinator(this, options);
  }

  async isServerAvailable() {
    try {
      await this.getTts();
      return true;
    } catch (_) {
      return false;
    }
  }

  clearCache() {
    this.audioCache.clear();
  }

  setCommsFilter() {}
}

// Sentence-aware coordinator. Feed it token deltas as they arrive; it never
// waits for the complete model response and keeps playback strictly ordered.
export class VoiceStreamingCoordinator {
  constructor(bridge, options = {}) {
    this.bridge = bridge; this.options = options; this.buffer = ""; this.sequence = 0;
    this.cancelled = false; this.chain = Promise.resolve(); this.messageId = options.messageId || crypto.randomUUID?.() || String(Date.now());
  }
  clean(text) { return String(text || "").replace(/```[\s\S]*?```/g, "").replace(/<[^>]*>/g, "").replace(/[`*_#]/g, "").replace(/\{\s*\"(?:type|ui|debug)[\s\S]*?\}/g, "").replace(/\s+/g, " ").trim(); }
  push(delta) {
    if (this.cancelled) return; this.buffer += String(delta || "");
    const match = this.buffer.match(/^([\s\S]*?[.!?](?:[\"')\]]|\s|$))/);
    if (match && this.clean(match[1]).length >= (this.options.minChunkLength || 18)) { this.buffer = this.buffer.slice(match[1].length); this.enqueue(match[1]); }
    else if (this.buffer.length >= (this.options.maxChunkLength || 260)) { const cut = this.buffer.lastIndexOf(",", 220); const chunk = this.buffer.slice(0, cut > 40 ? cut + 1 : 220); this.buffer = this.buffer.slice(chunk.length); this.enqueue(chunk); }
  }
  enqueue(raw) {
    const text = this.clean(raw); if (!text || this.cancelled) return;
    const sequence = this.sequence++;
    this.chain = this.chain.then(async () => {
      if (this.cancelled) return;
      window.dispatchEvent(new CustomEvent("uie:speech-chunk-start", { detail: { messageId: this.messageId, sequence } }));
      const audio = await this.bridge.synthesizeVoice(text, this.options.characterId || "default", { ...(this.options.synthesis || {}), useFallback: false });
      if (this.cancelled) return;
      const source = this.bridge.playVoiceWithEffects(audio, this.options.effects || {});
      await new Promise(resolve => { source.onended = resolve; });
      window.dispatchEvent(new CustomEvent("uie:speech-chunk-end", { detail: { messageId: this.messageId, sequence } }));
    }).catch(error => window.dispatchEvent(new CustomEvent("uie:speech-error", { detail: { messageId: this.messageId, sequence, error } })));
  }
  finish() { if (this.buffer.trim()) this.enqueue(this.buffer); this.buffer = ""; return this.chain; }
  cancel() { this.cancelled = true; this.buffer = ""; this.bridge.stopActiveVoice(); window.dispatchEvent(new CustomEvent("uie:speech-cancelled", { detail: { messageId: this.messageId } })); }
}

export function createVoiceBridge(procdAudio) {
  return new VoiceBridge(procdAudio);
}
