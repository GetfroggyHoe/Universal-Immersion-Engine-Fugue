const DEFAULT_STATE = {
  characterId: "character",
  bodyType: "default",
  currentPose: "neutral",
  currentExpression: "neutral",
  equippedTop: "default_top",
  equippedTopColor: "#ffffff",
};

function mergeState(base, next) {
  return { ...base, ...(next && typeof next === "object" ? next : {}) };
}

function ensureLayer(container, className, tagName = "img") {
  let node = container.querySelector(`.${className}`);
  if (!node) {
    node = document.createElement(tagName);
    node.className = `vn-layer ${className}`;
    if (tagName === "img") node.alt = "";
    container.appendChild(node);
  }
  return node;
}

export class VNCharacterEngine {
  constructor(container, initialState = {}) {
    this.container = typeof container === "string" ? document.querySelector(container) : container;
    if (!this.container) throw new Error("VNCharacterEngine requires a .vn-character container.");
    this.container.classList.add("vn-character");
    this.state = mergeState(DEFAULT_STATE, initialState);
    this.layers = this.ensureDom();
    this.updateState(this.state);
  }

  ensureDom() {
    const hairBack = ensureLayer(this.container, "vn-layer-hair-back");
    const base = ensureLayer(this.container, "vn-layer-base");
    const face = ensureLayer(this.container, "vn-layer-face");

    let clothing = this.container.querySelector(".vn-clothing-container");
    if (!clothing) {
      clothing = document.createElement("div");
      clothing.className = "vn-layer vn-clothing-container";
      this.container.appendChild(clothing);
    }

    let colorFlat = clothing.querySelector(".cloth-color-flat");
    if (!colorFlat) {
      colorFlat = document.createElement("div");
      colorFlat.className = "cloth-color-flat";
      clothing.appendChild(colorFlat);
    }

    let shadowMap = clothing.querySelector(".cloth-shadow-map");
    if (!shadowMap) {
      shadowMap = document.createElement("img");
      shadowMap.className = "cloth-shadow-map";
      shadowMap.alt = "";
      clothing.appendChild(shadowMap);
    }

    const hairFront = ensureLayer(this.container, "vn-layer-hair-front");
    return { hairBack, base, face, clothing, colorFlat, shadowMap, hairFront };
  }

  assetPaths(state = this.state) {
    const { bodyType, currentPose, currentExpression, equippedTop } = state;
    return {
      body: `assets/sprites/${bodyType}/${currentPose}_base.png`,
      face: `assets/sprites/${bodyType}/${currentPose}_face_${currentExpression}.png`,
      clothingShadow: `assets/clothes/${equippedTop}/${bodyType}/${currentPose}_shadows.png`,
      clothingMask: `assets/clothes/${equippedTop}/${bodyType}/${currentPose}_mask.png`,
      hairBack: `assets/sprites/${bodyType}/${currentPose}_hair_back.png`,
      hairFront: `assets/sprites/${bodyType}/${currentPose}_hair_front.png`,
    };
  }

  setImage(img, src) {
    if (!img || img.getAttribute("src") === src) return;
    img.decoding = "async";
    img.loading = "eager";
    img.src = src;
  }

  updateState(newState = {}) {
    this.state = mergeState(this.state, newState);
    this.container.dataset.characterId = this.state.characterId;
    this.container.dataset.bodyType = this.state.bodyType;
    this.container.dataset.pose = this.state.currentPose;
    this.container.dataset.expression = this.state.currentExpression;

    const paths = this.assetPaths();
    this.setImage(this.layers.hairBack, paths.hairBack);
    this.setImage(this.layers.base, paths.body);
    this.setImage(this.layers.face, paths.face);
    this.setImage(this.layers.shadowMap, paths.clothingShadow);
    this.setImage(this.layers.hairFront, paths.hairFront);

    this.layers.colorFlat.style.backgroundColor = this.state.equippedTopColor;
    this.layers.colorFlat.style.maskImage = `url("${paths.clothingMask}")`;
    this.layers.colorFlat.style.webkitMaskImage = `url("${paths.clothingMask}")`;
    this.layers.clothing.dataset.equippedTop = this.state.equippedTop;
    return this.state;
  }
}

export function createVNCharacter(container, initialState = {}) {
  return new VNCharacterEngine(container, initialState);
}

if (typeof window !== "undefined") {
  window.VNCharacterEngine = VNCharacterEngine;
  window.createVNCharacter = createVNCharacter;
}
