import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Wearable accessories
//
// Every item is built from simple shapes in code (no extra model files) and
// attached to a bone of the leopard's skeleton so it follows every animation.
// Sizes and positions are in the model's bind-pose space (nose at z ≈ 1.0,
// top of the skull at y ≈ 0.56), before the model's 3x scale.
//
// To add an item: add an entry to ACCESSORIES with a build() function.
// ---------------------------------------------------------------------------

export const SLOTS = {
  head: { label: 'Head', bone: 'DEF-spine011' },
  face: { label: 'Face', bone: 'DEF-spine011' },
  neck: { label: 'Neck', bone: 'DEF-spine009' },
  tail: { label: 'Tail', bone: 'DEF-spine003' }
};

export const RARITIES = {
  // hex: gem colour; glimmer: sparkle colour (saturated so it reads against white snow)
  common: { label: 'Common', color: '#cbd5e1', hex: 0xdbeafe, glimmer: 0xfacc15, weight: 60, glimmerRange: 30 },
  rare: { label: 'Rare', color: '#38bdf8', hex: 0x38bdf8, glimmer: 0x0ea5e9, weight: 27, glimmerRange: 38 },
  epic: { label: 'Epic', color: '#c084fc', hex: 0xc084fc, glimmer: 0xa855f7, weight: 10, glimmerRange: 46 },
  legendary: { label: 'Legendary', color: '#fbbf24', hex: 0xffc83d, glimmer: 0xff8c00, weight: 3, glimmerRange: 60 }
};

// Anchor points in bind-pose model space
// (measured from the mesh: skull peaks at y 0.565 around z 0.66-0.70, the brow slopes back
// ~50 degrees, the neck is ~0.24 wide either side, the tail drops steeply from z -0.47)
const CROWN_TOP = new THREE.Vector3(0, 0.565, 0.69);
const CROWN_TILT = -0.12;
const HEAD_SCALE = 1.3; // head items are authored small, then scaled to the skull
const EYES = new THREE.Vector3(0, 0.4, 0.935);
const EYE_TILT = -0.75;
const NECK = new THREE.Vector3(0, 0.315, 0.57);
const NECK_RADIUS = 0.225;
const TAIL = new THREE.Vector3(0, -0.15, -0.535);
const TAIL_TILT = 2.11; // turns a ring's axis to run down the tail

// ------------------------------------------------------------------ materials
const mats = {};
function mat(key, make) {
  if (!mats[key]) mats[key] = make();
  return mats[key];
}
const gold = () => mat('gold', () => new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.65, roughness: 0.28, emissive: 0x4a3200, emissiveIntensity: 0.35 }));
const silver = () => mat('silver', () => new THREE.MeshStandardMaterial({ color: 0xe5e9f0, metalness: 0.6, roughness: 0.25, emissive: 0x1e2430, emissiveIntensity: 0.3 }));
const diamond = (color = 0xe0f2fe, key = 'diamond') => mat(key, () => new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.05, emissive: color, emissiveIntensity: 0.35, flatShading: true }));
const flat = (color, key, extra = {}) => mat(key, () => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra }));

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Places a ring of `count` objects around the y axis
function ring(count, radius, make, { startAngle = 0, arc = Math.PI * 2 } = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = startAngle + (arc === Math.PI * 2 ? (i / count) * arc : (i / (count - 1)) * arc);
    const obj = make(i, a);
    obj.position.x += Math.sin(a) * radius;
    obj.position.z += Math.cos(a) * radius;
    g.add(obj);
  }
  return g;
}

// ------------------------------------------------------------------ head items
function buildGoldCrown() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.035, 20, 1, true), gold()));
  g.children[0].material.side = THREE.DoubleSide;
  g.add(ring(5, 0.064, () => mesh(new THREE.ConeGeometry(0.016, 0.05, 6), gold(), 0, 0.04, 0)));
  g.add(ring(5, 0.067, () => mesh(new THREE.OctahedronGeometry(0.009), diamond(0xef4444, 'ruby'), 0, 0.0, 0), { startAngle: Math.PI / 5 }));
  g.add(ring(5, 0.064, () => mesh(new THREE.SphereGeometry(0.007, 8, 6), gold(), 0, 0.068, 0)));
  g.position.copy(CROWN_TOP);
  g.position.y += 0.012;
  g.rotation.x = CROWN_TILT;
  g.scale.setScalar(HEAD_SCALE);
  return g;
}

function buildIceCrown() {
  const g = new THREE.Group();
  const ice = mat('ice', () => new THREE.MeshStandardMaterial({ color: 0xbfeaff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x3aa8e0, emissiveIntensity: 0.45, flatShading: true }));
  g.add(mesh(new THREE.TorusGeometry(0.066, 0.008, 6, 24), ice));
  g.children[0].rotation.x = Math.PI / 2;
  g.add(ring(9, 0.066, (i) => {
    const h = i % 2 ? 0.05 : 0.085;
    const shard = mesh(new THREE.ConeGeometry(0.013, h, 4), ice, 0, h / 2, 0);
    shard.rotation.z = (i % 3 - 1) * 0.12;
    return shard;
  }));
  g.position.copy(CROWN_TOP);
  g.rotation.x = CROWN_TILT;
  g.scale.setScalar(HEAD_SCALE);
  return g;
}

function buildRoyalTiara() {
  const g = new THREE.Group();
  // Front arc of silver filigree with a big pink diamond in the middle
  const arcGeo = new THREE.TorusGeometry(0.07, 0.006, 6, 24, Math.PI * 1.1);
  const band = mesh(arcGeo, silver());
  band.rotation.set(Math.PI / 2, 0, Math.PI * 0.95 / 2 + Math.PI / 4.4);
  g.add(band);
  g.add(ring(7, 0.07, (i) => {
    const tall = 0.025 + (3 - Math.abs(i - 3)) * 0.012;
    const spike = mesh(new THREE.ConeGeometry(0.006, tall, 6), silver(), 0, tall / 2, 0);
    const gem = mesh(new THREE.OctahedronGeometry(0.008), diamond(), 0, tall + 0.004, 0);
    const p = new THREE.Group();
    p.add(spike, gem);
    return p;
  }, { startAngle: -Math.PI * 0.45, arc: Math.PI * 0.9 }));
  const heart = mesh(new THREE.OctahedronGeometry(0.022), diamond(0xff7ac6, 'pinkDiamond'), 0, 0.085, 0.072);
  heart.scale.set(1, 1.3, 0.6);
  g.add(heart);
  g.position.copy(CROWN_TOP);
  g.position.y += 0.005;
  g.rotation.x = CROWN_TILT;
  g.scale.setScalar(HEAD_SCALE);
  return g;
}

function buildFlowerCrown() {
  const g = new THREE.Group();
  const vine = mesh(new THREE.TorusGeometry(0.068, 0.009, 6, 24), flat(0x4d7c3a, 'vine'));
  vine.rotation.x = Math.PI / 2;
  g.add(vine);
  const petals = [0xffffff, 0xf9a8d4, 0xfde047, 0xc4b5fd];
  g.add(ring(8, 0.068, (i) => {
    const f = new THREE.Group();
    const petalMat = flat(petals[i % petals.length], `petal${i % petals.length}`);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      f.add(mesh(new THREE.SphereGeometry(0.009, 6, 4), petalMat, Math.cos(a) * 0.01, 0.006, Math.sin(a) * 0.01));
    }
    f.add(mesh(new THREE.SphereGeometry(0.006, 6, 4), flat(0xf59e0b, 'flowerCore'), 0, 0.01, 0));
    return f;
  }));
  g.position.copy(CROWN_TOP);
  g.rotation.x = CROWN_TILT;
  g.scale.setScalar(HEAD_SCALE);
  return g;
}

function buildPartyHat() {
  const g = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#38bdf8' : '#f472b6';
    ctx.fillRect(i * 8, 0, 8, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cone = mesh(new THREE.ConeGeometry(0.055, 0.15, 20, 1, true), mat('partyHat', () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide })), 0, 0.075, 0);
  g.add(cone);
  g.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), flat(0xfde047, 'pompom'), 0, 0.155, 0));
  g.position.copy(CROWN_TOP);
  g.rotation.set(-0.3, 0, 0.25);
  g.scale.setScalar(HEAD_SCALE);
  return g;
}

// ------------------------------------------------------------------ face items
function buildGlasses(lensGeo, lensMat, frameMat, spacing = 0.058) {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const lens = mesh(lensGeo, lensMat, side * spacing, 0, 0);
    g.add(lens);
    // Arm running back towards the ear
    const arm = mesh(new THREE.BoxGeometry(0.004, 0.004, 0.13), frameMat, side * (spacing + 0.04), 0.006, -0.065);
    arm.rotation.y = side * 0.35;
    g.add(arm);
  }
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.005, 0.005), frameMat, 0, 0.008, 0.004));
  g.position.copy(EYES);
  g.rotation.x = EYE_TILT;
  return g;
}

function buildAviators() {
  const lensGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.004, 20);
  lensGeo.rotateX(Math.PI / 2);
  lensGeo.scale(1, 0.85, 1);
  const lens = mat('aviatorLens', () => new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.9, roughness: 0.08, emissive: 0x0b1220 }));
  return buildGlasses(lensGeo, lens, gold());
}

function buildHeartShades() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.028);
  s.bezierCurveTo(-0.034, -0.004, -0.032, 0.026, -0.015, 0.026);
  s.bezierCurveTo(-0.006, 0.026, 0, 0.018, 0, 0.012);
  s.bezierCurveTo(0, 0.018, 0.006, 0.026, 0.015, 0.026);
  s.bezierCurveTo(0.032, 0.026, 0.034, -0.004, 0, -0.028);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -0.002);
  const lens = mat('heartLens', () => new THREE.MeshStandardMaterial({ color: 0xff3d8b, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.88, emissive: 0x80103c, emissiveIntensity: 0.4 }));
  return buildGlasses(geo, lens, flat(0xff69b4, 'heartFrame'));
}

function buildSkiGoggles() {
  const g = new THREE.Group();
  // One wide mirrored lens over both eyes, with a black frame and a strap round the head
  const lens = mesh(new THREE.BoxGeometry(0.2, 0.065, 0.008), mat('goggleLens', () => new THREE.MeshStandardMaterial({ color: 0xff8a1f, metalness: 0.85, roughness: 0.12, emissive: 0x7a2e00, emissiveIntensity: 0.5 })), 0, 0, 0.004);
  g.add(lens);
  const black = mat('goggleStrap', () => new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 }));
  g.add(mesh(new THREE.BoxGeometry(0.212, 0.077, 0.008), black, 0, 0, -0.002));
  const strap = mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 32), black, 0, 0, -0.1);
  strap.rotation.x = Math.PI / 2;
  g.add(strap);
  // Taller than glasses, so it sits a little higher to cover the eyes rather than the nose
  g.position.copy(EYES).add(new THREE.Vector3(0, 0.025, -0.018));
  g.rotation.x = EYE_TILT;
  return g;
}

// ------------------------------------------------------------------ neck items
// The neck runs forward and slightly upward; collars are rings tilted to sit across it
function neckRing(tube, material) {
  const t = mesh(new THREE.TorusGeometry(NECK_RADIUS, tube, 8, 36), material);
  t.scale.y = 0.9; // the neck is a little narrower top-to-bottom than side-to-side
  return t;
}

function placeOnNeck(g, scale = 1) {
  g.position.copy(NECK);
  g.scale.setScalar(scale);
  g.rotation.x = -0.6;
  return g;
}

function buildRedScarf() {
  const g = new THREE.Group();
  const knit = flat(0xc81e2c, 'scarf', { roughness: 0.95 });
  const wrap = neckRing(0.04, knit);
  wrap.scale.z = 1.5;
  g.add(wrap);
  // Loose end hanging down the chest
  const stripe = flat(0xfafafa, 'scarfStripe', { roughness: 0.95 });
  const end = new THREE.Group();
  end.add(mesh(new THREE.BoxGeometry(0.08, 0.22, 0.03), knit, 0, -0.11, 0));
  end.add(mesh(new THREE.BoxGeometry(0.082, 0.025, 0.032), stripe, 0, -0.15, 0));
  end.add(mesh(new THREE.BoxGeometry(0.082, 0.025, 0.032), stripe, 0, -0.19, 0));
  end.position.set(0.09, -NECK_RADIUS + 0.02, 0.05);
  end.rotation.set(0.5, 0, 0.25);
  g.add(end);
  return placeOnNeck(g);
}

function buildBellCollar() {
  const g = new THREE.Group();
  g.add(neckRing(0.016, flat(0x7c2d12, 'leather', { roughness: 0.6 })));
  g.add(mesh(new THREE.TorusGeometry(0.01, 0.004, 6, 12), gold(), 0, -NECK_RADIUS - 0.018, 0.01));
  g.add(mesh(new THREE.SphereGeometry(0.032, 14, 10), gold(), 0, -NECK_RADIUS - 0.05, 0.012));
  return placeOnNeck(g, 1.1);
}

function buildDiamondCollar() {
  const g = new THREE.Group();
  g.add(neckRing(0.013, silver()));
  const count = 18;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2; // first stone hangs at the bottom
    const r = NECK_RADIUS + 0.012;
    const size = i === 0 ? 0.036 : 0.02;
    g.add(mesh(new THREE.OctahedronGeometry(size), diamond(), Math.cos(a) * r, Math.sin(a) * r - (i === 0 ? 0.02 : 0), 0.008));
  }
  return placeOnNeck(g, 1.1);
}

// ------------------------------------------------------------------ tail items
function buildTailBow() {
  const g = new THREE.Group();
  const satin = flat(0xff5fa2, 'bow', { roughness: 0.35, metalness: 0.1 });
  // Band wrapped around the tail
  const band = mesh(new THREE.TorusGeometry(0.075, 0.013, 6, 20), satin);
  band.rotation.x = TAIL_TILT;
  g.add(band);
  // Bow tied on the top (back) side of the tail
  const bow = new THREE.Group();
  for (const side of [-1, 1]) {
    const loop = mesh(new THREE.ConeGeometry(0.045, 0.09, 4), satin, side * 0.045, 0, 0);
    loop.rotation.z = side * Math.PI / 2;
    bow.add(loop);
    const ribbon = mesh(new THREE.BoxGeometry(0.02, 0.09, 0.006), satin, side * 0.02, -0.05, 0);
    ribbon.rotation.z = side * 0.35;
    bow.add(ribbon);
  }
  bow.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), satin));
  bow.position.set(0, 0.51 * 0.085, -0.86 * 0.085);
  bow.rotation.x = -1.0;
  g.add(bow);
  g.position.copy(TAIL);
  return g;
}

// ------------------------------------------------------------------ catalog
export const ACCESSORIES = [
  { id: 'flower_crown', name: 'Edelweiss Flower Crown', slot: 'head', rarity: 'common', icon: '🌼', build: buildFlowerCrown },
  { id: 'party_hat', name: 'Party Hat', slot: 'head', rarity: 'common', icon: '🥳', build: buildPartyHat },
  { id: 'gold_crown', name: 'Gold Crown', slot: 'head', rarity: 'rare', icon: '👑', build: buildGoldCrown },
  { id: 'ice_crown', name: 'Ice Crystal Crown', slot: 'head', rarity: 'epic', icon: '❄️', build: buildIceCrown },
  { id: 'royal_tiara', name: 'Royal Snow Tiara', slot: 'head', rarity: 'legendary', icon: '💎', build: buildRoyalTiara },
  { id: 'aviators', name: 'Aviator Sunglasses', slot: 'face', rarity: 'common', icon: '🕶️', build: buildAviators },
  { id: 'heart_shades', name: 'Heart Shades', slot: 'face', rarity: 'rare', icon: '💖', build: buildHeartShades },
  { id: 'ski_goggles', name: 'Ski Goggles', slot: 'face', rarity: 'rare', icon: '🥽', build: buildSkiGoggles },
  { id: 'red_scarf', name: 'Cozy Red Scarf', slot: 'neck', rarity: 'common', icon: '🧣', build: buildRedScarf },
  { id: 'bell_collar', name: 'Bell Collar', slot: 'neck', rarity: 'common', icon: '🔔', build: buildBellCollar },
  { id: 'diamond_collar', name: 'Diamond Collar', slot: 'neck', rarity: 'epic', icon: '💠', build: buildDiamondCollar },
  { id: 'tail_bow', name: 'Tail Bow', slot: 'tail', rarity: 'common', icon: '🎀', build: buildTailBow }
];

export const ACCESSORY_BY_ID = Object.fromEntries(ACCESSORIES.map((a) => [a.id, a]));

// Picks a random rarity tier using the RARITIES weights
export function rollRarity(rng = Math.random) {
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = rng() * total;
  for (const [key, r] of Object.entries(RARITIES)) {
    roll -= r.weight;
    if (roll < 0) return key;
  }
  return 'common';
}
