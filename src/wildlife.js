import * as THREE from 'three';
import { buildTube, smoothPath, fbm3 } from './procgen.js';

// ---------------------------------------------------------------------------
// Models for the newer animals, in the same style as prey.js: lofted tube bodies
// with vertex-coloured coats, a 'head' node the AI can move, jointed 'leg'
// groups, and (birds) 'wing' nodes. Each builder receives the PreyAnimal so it
// can reuse its fur materials, legs and eyes. All face +Z, feet at y = 0.
// ---------------------------------------------------------------------------
const c = new THREE.Color();
const mixNoise = (col, px, py, pz, amt, seed = 0) => col.offsetHSL(0, 0, (fbm3(px * 3 + seed, py * 3, pz * 3, 2) - 0.5) * amt);

function addMesh(parent, geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ goat-antelopes
// Shared body for bharal (blue sheep) and herders' goats. `o` sets colours, size and horns.
function buildCaprine(prey, o) {
  const group = new THREE.Group();
  const mat = prey.furMaterial(o.fur);
  const hornMat = new THREE.MeshStandardMaterial({ color: o.horn, roughness: 0.55 });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x241d19, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.15 });
  const s = o.scale;

  const body = buildTube(smoothPath([
    { x: 0, y: 1.32 * s, z: -0.95 * s, rx: 0.14 * s, ry: 0.16 * s },
    { x: 0, y: 1.32 * s, z: -0.76 * s, rx: 0.38 * s, ry: 0.45 * s },
    { x: 0, y: 1.25 * s, z: -0.25 * s, rx: 0.45 * s, ry: 0.53 * s },
    { x: 0, y: 1.24 * s, z: 0.25 * s, rx: 0.45 * s, ry: 0.55 * s },
    { x: 0, y: 1.36 * s, z: 0.58 * s, rx: 0.37 * s, ry: 0.47 * s },
    { x: 0, y: 1.55 * s, z: 0.86 * s, rx: 0.26 * s, ry: 0.32 * s },
    { x: 0, y: 1.66 * s, z: 0.95 * s, rx: 0.21 * s, ry: 0.25 * s }
  ], 4), 18, (i, t, up, side, px, py, pz) => mixNoise(o.coat(t, up, side, px, py, pz), px, py, pz, 0.08, o.seed), { uScale: 3, vScale: 3 });
  addMesh(group, body, mat);

  const headNode = new THREE.Group();
  headNode.name = 'head';
  headNode.position.set(0, 1.56 * s, 0.9 * s);
  group.add(headNode);
  const head = buildTube(smoothPath([
    { x: 0, y: -0.1 * s, z: -0.08 * s, rx: 0.27 * s, ry: 0.31 * s },
    { x: 0, y: 0.24 * s, z: 0.12 * s, rx: 0.21 * s, ry: 0.24 * s },
    { x: 0, y: 0.52 * s, z: 0.3 * s, rx: 0.19 * s, ry: 0.21 * s },
    { x: 0, y: 0.6 * s, z: 0.52 * s, rx: 0.17 * s, ry: 0.17 * s },
    { x: 0, y: 0.52 * s, z: 0.8 * s, rx: 0.12 * s, ry: 0.12 * s },
    { x: 0, y: 0.47 * s, z: 0.96 * s, rx: 0.07 * s, ry: 0.065 * s },
    { x: 0, y: 0.45 * s, z: 1.01 * s, rx: 0.03 * s, ry: 0.03 * s }
  ], 4), 16, (i, t, up, side, px, py, pz) => o.face(t, up, side), { uScale: 2, vScale: 2 });
  addMesh(headNode, head, mat);

  for (let side = -1; side <= 1; side += 2) {
    const path = smoothPath(o.hornPath(side, s), 5);
    path.forEach((pt, i) => { if (o.ridged) { const k = 1 + (i % 2 ? -0.07 : 0.1) * (1 - i / path.length); pt.rx *= k; pt.ry *= k; } });
    addMesh(headNode, buildTube(path, 10), hornMat);
    const ear = buildTube(smoothPath([
      { x: side * 0.13 * s, y: 0.6 * s, z: 0.34 * s, rx: 0.045 * s, ry: 0.03 * s },
      { x: side * 0.27 * s, y: (0.6 + o.earDroop * 0.5) * s, z: 0.3 * s, rx: 0.065 * s, ry: 0.028 * s },
      { x: side * 0.4 * s, y: (0.6 + o.earDroop) * s, z: 0.26 * s, rx: 0.02 * s, ry: 0.014 * s }
    ], 3), 8, () => o.earColor);
    addMesh(headNode, ear, mat, false);
    prey.addEye(headNode, side * 0.145 * s, 0.6 * s, 0.62 * s, 0.045 * s, eyeMat);
  }
  if (o.beard) {
    addMesh(headNode, buildTube(smoothPath([
      { x: 0, y: 0.4 * s, z: 0.82 * s, rx: 0.05 * s, ry: 0.04 * s },
      { x: 0, y: 0.22 * s, z: 0.8 * s, rx: 0.04 * s, ry: 0.04 * s },
      { x: 0, y: 0.1 * s, z: 0.78 * s, rx: 0.012 * s, ry: 0.012 * s }
    ], 3), 8, () => o.beard), mat, false);
  }
  addMesh(group, buildTube(smoothPath([
    { x: 0, y: 1.35 * s, z: -0.93 * s, rx: 0.05 * s, ry: 0.05 * s },
    { x: 0, y: 1.38 * s, z: -1.1 * s, rx: 0.06 * s, ry: 0.06 * s },
    { x: 0, y: 1.3 * s, z: -1.2 * s, rx: 0.015 * s, ry: 0.015 * s }
  ], 3), 8, () => o.tail), mat, false);

  const frontCfg = { upperR: 0.15 * s, lowerR: 0.08 * s, kneeY: 0.62 * s, kneeZ: 0.03 * s, hoofR: 0.075 * s, hoofH: 0.11 * s, colorFn: o.leg };
  const backCfg = { upperR: 0.2 * s, lowerR: 0.08 * s, kneeY: 0.68 * s, kneeZ: -0.15 * s, hoofR: 0.075 * s, hoofH: 0.11 * s, colorFn: o.leg };
  group.add(prey.buildLeg(0.27 * s, 1.22 * s, 0.47 * s, frontCfg, mat, hoofMat));
  group.add(prey.buildLeg(-0.27 * s, 1.22 * s, 0.47 * s, frontCfg, mat, hoofMat));
  group.add(prey.buildLeg(0.27 * s, 1.28 * s, -0.68 * s, backCfg, mat, hoofMat));
  group.add(prey.buildLeg(-0.27 * s, 1.28 * s, -0.68 * s, backCfg, mat, hoofMat));
  return group;
}

// Bharal (blue sheep), the snow leopard's main prey: slate blue-grey coat, black stripe
// along the flank and down the front of the legs, white belly, thick horns curving out
// and back over the neck.
export function buildBharalModel(prey) {
  const slate = new THREE.Color(0x7c8796), back = new THREE.Color(0x67707e), belly = new THREE.Color(0xeceae4), black = new THREE.Color(0x1d1d22);
  return buildCaprine(prey, {
    fur: 'bharal', scale: 0.95, seed: 4, horn: 0x6f6658, earDroop: 0.02, earColor: slate, beard: null, ridged: false,
    coat: (t, up, side) => {
      c.copy(slate).lerp(back, Math.max(0, up) * 0.7).lerp(belly, Math.max(0, -up - 0.25) * 1.6);
      if (Math.abs(up + 0.2) < 0.13 && t > 0.15 && t < 0.85) c.lerp(black, 0.85); // flank stripe
      if (t > 0.78 && up < 0) c.lerp(black, (t - 0.78) * 3); // black chest
      return c;
    },
    face: (t, up) => (t > 0.75 ? c.copy(belly).lerp(slate, 0.35) : c.copy(slate).lerp(black, up < -0.3 ? 0.35 : 0)),
    tail: black,
    leg: (t, up, side, px) => c.copy(slate).lerp(black, side > 0.2 ? 0.8 : 0.1).lerp(belly, side < -0.5 ? 0.5 : 0),
    hornPath: (side, s) => [
      { x: side * 0.08 * s, y: 0.72 * s, z: 0.38 * s, rx: 0.1 * s, ry: 0.11 * s },
      { x: side * 0.26 * s, y: 0.86 * s, z: 0.28 * s, rx: 0.085 * s, ry: 0.095 * s },
      { x: side * 0.46 * s, y: 0.88 * s, z: 0.06 * s, rx: 0.07 * s, ry: 0.075 * s },
      { x: side * 0.58 * s, y: 0.76 * s, z: -0.2 * s, rx: 0.05 * s, ry: 0.055 * s },
      { x: side * 0.56 * s, y: 0.62 * s, z: -0.38 * s, rx: 0.025 * s, ry: 0.025 * s },
      { x: side * 0.5 * s, y: 0.6 * s, z: -0.44 * s, rx: 0.006 * s, ry: 0.006 * s }
    ]
  });
}

// Herders' goat: shaggy white coat with brown patches, short backswept horns, droopy ears
export function buildGoatModel(prey) {
  const white = new THREE.Color(0xeee9df), brown = new THREE.Color(0x7a5332), dark = new THREE.Color(0x2c2420);
  return buildCaprine(prey, {
    fur: 'goat', scale: 0.78, seed: 9, horn: 0x8a7c6a, earDroop: -0.16, earColor: brown, beard: white, ridged: true,
    coat: (t, up, side, px, py, pz) => (fbm3(px * 1.6 + 3, py * 1.6, pz * 1.6, 2) > 0.56 ? c.copy(brown) : c.copy(white)),
    face: (t) => (t > 0.5 ? c.copy(brown).lerp(white, 0.3) : c.copy(white)),
    tail: white,
    leg: () => c.copy(white).lerp(dark, 0.15),
    hornPath: (side, s) => [
      { x: side * 0.07 * s, y: 0.72 * s, z: 0.36 * s, rx: 0.06 * s, ry: 0.07 * s },
      { x: side * 0.11 * s, y: 0.9 * s, z: 0.24 * s, rx: 0.045 * s, ry: 0.05 * s },
      { x: side * 0.15 * s, y: 0.98 * s, z: 0.04 * s, rx: 0.025 * s, ry: 0.028 * s },
      { x: side * 0.17 * s, y: 0.95 * s, z: -0.08 * s, rx: 0.005 * s, ry: 0.005 * s }
    ]
  });
}

// ------------------------------------------------------------------ small mammals
// Himalayan marmot: chunky golden-brown burrower with a darker back, dark face, short tail
export function buildMarmotModel(prey) {
  const group = new THREE.Group();
  const mat = prey.furMaterial('marmot');
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120e0b, roughness: 0.2 });
  const gold = new THREE.Color(0xc39a5a), back = new THREE.Color(0x6b5133), face = new THREE.Color(0x3a2c1f), cream = new THREE.Color(0xe2cfa2);
  const body = buildTube(smoothPath([
    { x: 0, y: 0.26, z: -0.34, rx: 0.09, ry: 0.09 },
    { x: 0, y: 0.3, z: -0.24, rx: 0.2, ry: 0.2 },
    { x: 0, y: 0.31, z: 0.0, rx: 0.22, ry: 0.21 },
    { x: 0, y: 0.3, z: 0.2, rx: 0.18, ry: 0.18 },
    { x: 0, y: 0.32, z: 0.3, rx: 0.12, ry: 0.13 }
  ], 4), 14, (i, t, up, side, px, py, pz) => mixNoise(c.copy(gold).lerp(back, Math.max(0, up) * 0.8), px, py, pz, 0.1, 7), { uScale: 2, vScale: 2 });
  addMesh(group, body, mat);
  const headNode = new THREE.Group();
  headNode.name = 'head';
  headNode.position.set(0, 0.33, 0.3);
  group.add(headNode);
  addMesh(headNode, buildTube(smoothPath([
    { x: 0, y: 0.0, z: -0.04, rx: 0.11, ry: 0.11 },
    { x: 0, y: 0.03, z: 0.08, rx: 0.115, ry: 0.105 },
    { x: 0, y: 0.01, z: 0.17, rx: 0.075, ry: 0.07 },
    { x: 0, y: -0.01, z: 0.22, rx: 0.035, ry: 0.032 }
  ], 4), 12, (i, t, up) => (t > 0.6 ? c.copy(cream) : c.copy(face).lerp(gold, Math.max(0, -up) * 0.4))), mat);
  for (let side = -1; side <= 1; side += 2) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat);
    ear.scale.set(1, 1, 0.5);
    ear.position.set(side * 0.08, 0.1, 0.0);
    headNode.add(ear);
    prey.addEye(headNode, side * 0.07, 0.05, 0.12, 0.018, eyeMat);
  }
  prey.addWhiskers(headNode, 0.03, 0.0, 0.2, 0.12, 2);
  addMesh(group, buildTube(smoothPath([
    { x: 0, y: 0.27, z: -0.33, rx: 0.045, ry: 0.045 },
    { x: 0, y: 0.25, z: -0.45, rx: 0.05, ry: 0.05 },
    { x: 0, y: 0.22, z: -0.52, rx: 0.015, ry: 0.015 }
  ], 3), 8, () => back), mat, false);
  const legCol = () => c.copy(back);
  const cfg = { upperR: 0.05, lowerR: 0.035, kneeY: 0.08, kneeZ: 0.0, hoofR: 0.035, hoofH: 0, colorFn: legCol };
  group.add(prey.buildLeg(0.12, 0.2, 0.17, cfg, mat, null));
  group.add(prey.buildLeg(-0.12, 0.2, 0.17, cfg, mat, null));
  group.add(prey.buildLeg(0.13, 0.21, -0.2, cfg, mat, null));
  group.add(prey.buildLeg(-0.13, 0.21, -0.2, cfg, mat, null));
  group.scale.setScalar(1.15);
  return group;
}

// Plateau pika: a round grey-brown fluffball with big round ears and no visible tail
export function buildPikaModel(prey) {
  const group = new THREE.Group();
  const mat = prey.furMaterial('pika');
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0b0a, roughness: 0.2 });
  const fur = new THREE.Color(0x968a7d), dark = new THREE.Color(0x6e6359), pale = new THREE.Color(0xd6cdc0);
  addMesh(group, buildTube(smoothPath([
    { x: 0, y: 0.12, z: -0.14, rx: 0.05, ry: 0.05 },
    { x: 0, y: 0.15, z: -0.08, rx: 0.12, ry: 0.11 },
    { x: 0, y: 0.15, z: 0.04, rx: 0.12, ry: 0.11 },
    { x: 0, y: 0.15, z: 0.12, rx: 0.08, ry: 0.08 }
  ], 4), 12, (i, t, up) => c.copy(fur).lerp(dark, Math.max(0, up) * 0.5).lerp(pale, Math.max(0, -up - 0.3))), mat);
  const headNode = new THREE.Group();
  headNode.name = 'head';
  headNode.position.set(0, 0.17, 0.12);
  group.add(headNode);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mat);
  head.scale.set(1, 0.95, 1.1);
  head.position.set(0, 0.0, 0.03);
  headNode.add(head);
  for (let side = -1; side <= 1; side += 2) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat);
    ear.scale.set(1, 1, 0.35);
    ear.position.set(side * 0.05, 0.07, -0.01);
    headNode.add(ear);
    prey.addEye(headNode, side * 0.045, 0.02, 0.08, 0.014, eyeMat);
  }
  const cfg = { upperR: 0.025, lowerR: 0.02, kneeY: 0.04, kneeZ: 0, hoofR: 0.02, hoofH: 0, colorFn: () => c.copy(dark) };
  group.add(prey.buildLeg(0.06, 0.09, 0.08, cfg, mat, null));
  group.add(prey.buildLeg(-0.06, 0.09, 0.08, cfg, mat, null));
  group.add(prey.buildLeg(0.07, 0.09, -0.08, cfg, mat, null));
  group.add(prey.buildLeg(-0.07, 0.09, -0.08, cfg, mat, null));
  group.scale.setScalar(1.6); // a touch larger than life so it reads on a phone screen
  return group;
}

// ------------------------------------------------------------------ birds
// Himalayan snowcock: plump grey game bird, white throat and breast patch, chestnut neck
// stripes, red-orange beak; two 'wing' nodes flap when it flies.
export function buildSnowcockModel(prey) {
  const group = new THREE.Group();
  const mat = prey.furMaterial('snowcock');
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.5 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xcf7a2e, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.2 });
  const grey = new THREE.Color(0x8a8f96), dark = new THREE.Color(0x4d5157), white = new THREE.Color(0xf1efe9), chestnut = new THREE.Color(0x7b4a2c);
  addMesh(group, buildTube(smoothPath([
    { x: 0, y: 0.44, z: -0.36, rx: 0.04, ry: 0.03 },
    { x: 0, y: 0.44, z: -0.24, rx: 0.15, ry: 0.13 },
    { x: 0, y: 0.42, z: -0.02, rx: 0.2, ry: 0.19 },
    { x: 0, y: 0.47, z: 0.16, rx: 0.15, ry: 0.16 },
    { x: 0, y: 0.6, z: 0.26, rx: 0.07, ry: 0.08 }
  ], 4), 14, (i, t, up, side, px, py, pz) => {
    c.copy(grey).lerp(dark, Math.max(0, up) * 0.5);
    if (t > 0.6 && up < 0.2) c.lerp(white, 0.85);
    if (t > 0.8 && Math.abs(side) > 0.5) c.lerp(chestnut, 0.7);
    return mixNoise(c, px, py, pz, 0.12, 11);
  }), mat);
  const headNode = new THREE.Group();
  headNode.name = 'head';
  headNode.position.set(0, 0.64, 0.28);
  group.add(headNode);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), mat);
  head.position.set(0, 0.03, 0.03);
  headNode.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 8), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.02, 0.11);
  headNode.add(beak);
  for (let side = -1; side <= 1; side += 2) prey.addEye(headNode, side * 0.05, 0.05, 0.06, 0.013, eyeMat);
  for (let side = -1; side <= 1; side += 2) {
    const wing = new THREE.Group();
    wing.name = 'wing';
    wing.position.set(side * 0.16, 0.5, 0.02);
    const panel = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6), mat);
    panel.scale.set(1.6, 0.15, 1.1);
    panel.position.set(side * 0.2, 0, -0.04);
    wing.add(panel);
    wing.userData.side = side;
    group.add(wing);
  }
  for (let side = -1; side <= 1; side += 2) {
    const leg = new THREE.Group();
    leg.name = 'leg';
    leg.position.set(side * 0.07, 0.3, 0.0);
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.3, 6), legMat);
    shank.position.y = -0.15;
    leg.add(shank);
    const knee = new THREE.Group();
    knee.name = 'knee';
    knee.position.y = -0.3;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.08), legMat);
    foot.position.z = 0.02;
    knee.add(foot);
    leg.add(knee);
    group.add(leg);
  }
  return group;
}

// Lammergeier (bearded vulture) / raven silhouette for scavengers: body + two wing nodes
export function buildScavengerModel(big) {
  const group = new THREE.Group();
  const col = big ? 0x3b3330 : 0x111114;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: big ? 0xd9a066 : 0x111114, roughness: 0.7 });
  const s = big ? 1.6 : 0.7;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 10, 8), mat);
  body.scale.set(0.8, 0.7, 2.0);
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 8, 6), headMat);
  head.position.set(0, 0.04 * s, 0.42 * s);
  group.add(head);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14 * s, 0.5 * s, 4), mat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.5 * s;
  tail.scale.set(1.6, 0.25, 1);
  group.add(tail);
  for (let side = -1; side <= 1; side += 2) {
    const wing = new THREE.Group();
    wing.name = 'wing';
    wing.userData.side = side;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1 * s, 0.03 * s, 0.38 * s), mat);
    panel.position.x = side * 0.55 * s;
    wing.add(panel);
    group.add(wing);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

// ------------------------------------------------------------------ canids
// Grey wolf (also the herders' Tibetan mastiff, via `o`): long legs, deep chest, long
// muzzle, pricked ears, bushy tail.
function buildCanid(prey, o) {
  const group = new THREE.Group();
  const mat = prey.furMaterial(o.fur);
  const eyeMat = new THREE.MeshStandardMaterial({ color: o.eye, roughness: 0.2 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  const s = o.scale;
  addMesh(group, buildTube(smoothPath([
    { x: 0, y: 0.92 * s, z: -0.72 * s, rx: 0.12 * s, ry: 0.13 * s },
    { x: 0, y: 0.92 * s, z: -0.56 * s, rx: 0.26 * s, ry: 0.3 * s },
    { x: 0, y: 0.88 * s, z: -0.1 * s, rx: 0.27 * s, ry: 0.32 * s },
    { x: 0, y: 0.92 * s, z: 0.3 * s, rx: 0.3 * s * o.mane, ry: 0.38 * s * o.mane },
    { x: 0, y: 1.02 * s, z: 0.55 * s, rx: 0.22 * s * o.mane, ry: 0.27 * s * o.mane },
    { x: 0, y: 1.12 * s, z: 0.68 * s, rx: 0.15 * s, ry: 0.17 * s }
  ], 4), 16, (i, t, up, side, px, py, pz) => mixNoise(o.coat(t, up, side, px, py, pz), px, py, pz, 0.12, o.seed), { uScale: 3, vScale: 3 }), mat);
  const headNode = new THREE.Group();
  headNode.name = 'head';
  headNode.position.set(0, 1.12 * s, 0.68 * s);
  group.add(headNode);
  addMesh(headNode, buildTube(smoothPath([
    { x: 0, y: 0.0, z: -0.04 * s, rx: 0.16 * s, ry: 0.16 * s },
    { x: 0, y: 0.04 * s, z: 0.1 * s, rx: 0.15 * s, ry: 0.14 * s },
    { x: 0, y: -0.02 * s, z: 0.24 * s, rx: 0.08 * s, ry: 0.08 * s },
    { x: 0, y: -0.04 * s, z: 0.4 * s, rx: 0.055 * s, ry: 0.055 * s },
    { x: 0, y: -0.04 * s, z: 0.45 * s, rx: 0.02 * s, ry: 0.02 * s }
  ], 4), 14, (i, t, up) => o.face(t, up)), mat);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03 * s, 8, 6), noseMat);
  nose.position.set(0, -0.02 * s, 0.45 * s);
  headNode.add(nose);
  for (let side = -1; side <= 1; side += 2) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.12 * s, 6), mat);
    ear.position.set(side * 0.08 * s, 0.15 * s + o.earDrop * 0.1 * s, 0.02 * s);
    ear.rotation.z = -side * (0.15 + o.earDrop * 1.6);
    headNode.add(ear);
    prey.addEye(headNode, side * 0.075 * s, 0.06 * s, 0.17 * s, 0.022 * s, eyeMat);
  }
  addMesh(group, buildTube(smoothPath(o.tailPath(s), 4), 10, (i, t) => o.tailColor(t)), mat);
  const legCol = (t) => o.leg(t);
  const frontCfg = { upperR: 0.09 * s, lowerR: 0.05 * s, kneeY: 0.45 * s, kneeZ: 0.02 * s, hoofR: 0.05 * s, hoofH: 0, colorFn: legCol };
  const backCfg = { upperR: 0.12 * s, lowerR: 0.05 * s, kneeY: 0.5 * s, kneeZ: -0.12 * s, hoofR: 0.05 * s, hoofH: 0, colorFn: legCol };
  group.add(prey.buildLeg(0.15 * s, 0.85 * s, 0.4 * s, frontCfg, mat, null));
  group.add(prey.buildLeg(-0.15 * s, 0.85 * s, 0.4 * s, frontCfg, mat, null));
  group.add(prey.buildLeg(0.16 * s, 0.88 * s, -0.55 * s, backCfg, mat, null));
  group.add(prey.buildLeg(-0.16 * s, 0.88 * s, -0.55 * s, backCfg, mat, null));
  return group;
}

export function buildWolfModel(prey) {
  const grey = new THREE.Color(0x8d8476), dark = new THREE.Color(0x4a443d), cream = new THREE.Color(0xe0d6c4), tawny = new THREE.Color(0xa88a62);
  return buildCanid(prey, {
    fur: 'wolf', scale: 1.15, seed: 13, mane: 1.05, earDrop: 0, eye: 0x6b4a12,
    coat: (t, up) => c.copy(grey).lerp(tawny, Math.max(0, -up) * 0.4).lerp(dark, Math.max(0, up - 0.3) * 0.9).lerp(cream, Math.max(0, -up - 0.5) * 1.2),
    face: (t, up) => (t > 0.5 && up < 0 ? c.copy(cream) : c.copy(grey).lerp(dark, Math.max(0, up) * 0.5)),
    leg: (t) => c.copy(tawny).lerp(cream, t * 0.6),
    tailColor: (t) => c.copy(grey).lerp(dark, t > 0.8 ? 1 : 0.2),
    tailPath: (s) => [
      { x: 0, y: 0.92 * s, z: -0.7 * s, rx: 0.06 * s, ry: 0.06 * s },
      { x: 0, y: 0.78 * s, z: -0.86 * s, rx: 0.1 * s, ry: 0.1 * s },
      { x: 0, y: 0.56 * s, z: -0.96 * s, rx: 0.1 * s, ry: 0.1 * s },
      { x: 0, y: 0.42 * s, z: -1.0 * s, rx: 0.03 * s, ry: 0.03 * s }
    ]
  });
}

export function buildMastiffModel(prey) {
  const black = new THREE.Color(0x1c1a19), tan = new THREE.Color(0xb3743c);
  return buildCanid(prey, {
    fur: 'dog', scale: 1.05, seed: 17, mane: 1.35, earDrop: 1, eye: 0x3a2410,
    coat: (t, up) => c.copy(black).lerp(tan, Math.max(0, -up - 0.35) * 1.2),
    face: (t, up) => (t > 0.55 ? c.copy(tan) : c.copy(black)),
    leg: (t) => c.copy(black).lerp(tan, t),
    tailColor: () => c.copy(black),
    tailPath: (s) => [
      { x: 0, y: 0.95 * s, z: -0.7 * s, rx: 0.07 * s, ry: 0.07 * s },
      { x: 0, y: 1.18 * s, z: -0.78 * s, rx: 0.12 * s, ry: 0.12 * s },
      { x: 0.08 * s, y: 1.25 * s, z: -0.55 * s, rx: 0.1 * s, ry: 0.1 * s },
      { x: 0.1 * s, y: 1.12 * s, z: -0.45 * s, rx: 0.03 * s, ry: 0.03 * s }
    ]
  });
}
