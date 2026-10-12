import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sounds } from './audio.js';
import { lerpAngle } from './utils.js';
import { buildTube, smoothPath, makeFurTextures, fbm3 } from './procgen.js';
import { env } from './world.js';
import { buildBharalModel, buildGoatModel, buildMarmotModel, buildPikaModel, buildSnowcockModel, buildWolfModel, buildMastiffModel } from './wildlife.js';

// ---------------------------------------------------------------------------
// Every animal in the valley. behavior:
//   herd     grazes in groups, bolts and alarms the herd (ibex, bharal, goats)
//   zigzag   jinks left and right as it runs (hare)
//   burrow   dives into its burrow and hides for a while (marmot)
//   hider    darts under the nearest boulder and hides (pika)
//   bird     bursts into flight and lands further away; can't be caught in the air
//   boss     the Titan Crag Yak: charges and rams
//   predator wolves: hunt other animals, defend kills, attack the leopard in packs
//   guard    herders' mastiffs: defend the camp and its goats
// climber: flees uphill toward the crags (bharal). livestock: lives at the herder camp.
// sprite: [scale, height] of the ?/! marker. drop: how far the body sinks when it falls.
// ---------------------------------------------------------------------------
export const PREY_TYPES = {
  ibex: { name: 'Himalayan Ibex', hp: 80, meat: 90, xp: 85, flee: 12.5, behavior: 'herd', sprite: [1.6, 3.2], stride: 1.5, print: 0.95, radius: 0.75, drop: 0.75 },
  bharal: { name: 'Bharal (Blue Sheep)', hp: 70, meat: 80, xp: 80, flee: 13, behavior: 'herd', climber: true, sprite: [1.5, 3.0], stride: 1.45, print: 0.9, radius: 0.7, drop: 0.7 },
  hare: { name: 'Snow Hare', hp: 32, meat: 35, xp: 45, flee: 12.5, behavior: 'zigzag', sprite: [1.0, 1.4], stride: 0.9, print: 0.6, radius: 0.4, drop: 0.25 },
  marmot: { name: 'Himalayan Marmot', hp: 22, meat: 22, xp: 35, flee: 8.5, behavior: 'burrow', sprite: [0.9, 1.2], stride: 0.6, print: 0.45, radius: 0.4, drop: 0.2, smallShadow: true },
  pika: { name: 'Pika', hp: 10, meat: 8, xp: 18, flee: 9.5, behavior: 'hider', sprite: [0.7, 0.9], stride: 0.4, print: 0.3, radius: 0.25, drop: 0.1, smallShadow: true },
  snowcock: { name: 'Himalayan Snowcock', hp: 14, meat: 12, xp: 28, flee: 6, behavior: 'bird', sprite: [0.9, 1.4], stride: 0.5, print: 0.35, radius: 0.3, drop: 0.2, smallShadow: true },
  goat: { name: "Herders' Goat", hp: 40, meat: 50, xp: 25, flee: 9, behavior: 'herd', livestock: true, sprite: [1.3, 2.4], stride: 1.2, print: 0.75, radius: 0.6, drop: 0.55 },
  yak: { name: 'Titan Crag Yak', hp: 300, meat: 350, xp: 350, flee: 7.5, behavior: 'boss', sprite: [2.4, 4.6], stride: 2.6, print: 1.6, radius: 1.4, drop: 1.5 },
  wolf: { name: 'Grey Wolf', hp: 90, meat: 0, xp: 90, flee: 13, chase: 13.5, bite: 6, behavior: 'predator', sprite: [1.3, 2.2], stride: 1.6, print: 0.8, radius: 0.6, drop: 0.45 },
  dog: { name: 'Herding Mastiff', hp: 110, meat: 0, xp: 70, flee: 11, chase: 12.5, bite: 7, behavior: 'guard', sprite: [1.3, 2.2], stride: 1.5, print: 0.8, radius: 0.6, drop: 0.45 }
};

// Where the herders camp (tents built in camp.js); goats graze and mastiffs guard here
export const HERDER_CAMP = { x: -72, z: 118 };

// Carcasses that are never fully eaten rot away after this many seconds
const CARCASS_LIFETIME = 90;
// A kill dragged into cover by a rock or tree (cached) keeps much longer
const CACHED_CARCASS_LIFETIME = 600;
// Seconds a fully eaten carcass lingers before it is removed
const EATEN_DISSOLVE_TIME = 6;

// One model per prey type is built once and cloned; clones share geometry and materials
const MODEL_CACHE = {};
const MODEL_CACHE_LOW = {}; // fully merged copies without moving legs, shown beyond LOD_DISTANCE
const LOD_DISTANCE = 50;
// The Titan Yak gives up the chase once the leopard is this far away at the end of a charge
const YAK_GIVE_UP_DISTANCE = 22;
const FUR_MATERIALS = {};
const GLINT_COLOR = new THREE.Color(2.2, 2.2, 2.2); // over-bright so the highlight still pops on a lit eye
const WHISKER_MAT = new THREE.MeshBasicMaterial({ color: 0xf2f2f0, transparent: true, opacity: 0.75, depthWrite: false });

// ------------------------------------------------------------------ draw-call trimming
// Every mesh is a separate draw call (two with shadows), and an animal is built from 15-30 of
// them. Parts that move together and share a material are merged into one mesh, per node
// (body, head, each leg segment, each wing). Tiny animals also lose their separate legs.
function prepForMerge(geo) {
  const g = geo.index ? geo : geo.toNonIndexed();
  const n = g.attributes.position.count;
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

function mergeChildren(node) {
  const groups = new Map();
  for (const child of node.children) {
    if (!child.isMesh || child.isSkinnedMesh) continue;
    const key = `${child.material.uuid}|${child.castShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child);
  }
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      m.updateMatrix();
      return prepForMerge(m.geometry.clone().applyMatrix4(m.matrix));
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, meshes[0].material);
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    for (const m of meshes) node.remove(m);
    node.add(mesh);
  }
  for (const child of node.children) if (!child.isMesh) mergeChildren(child);
}

function optimizeModel(group, flattenLegs) {
  if (flattenLegs) {
    group.updateMatrixWorld(true);
    for (const leg of group.children.filter((c) => c.name === 'leg')) {
      const meshes = [];
      leg.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const m of meshes) group.attach(m);
      group.remove(leg);
    }
  }
  mergeChildren(group);
  return group;
}

// Scratch vectors reused every frame to avoid per-frame allocations
const _toPlayer = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _fleeDir = new THREE.Vector3();
const _uphill = new THREE.Vector3();

// Prey Entity (Himalayan Ibex / Snow Hare / Titan Yak Boss) with Wildcraft Stealth & Perception AI
export class PreyManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.difficulty = 'medium';
    this.preyList = [];

    this.spawnInitialPrey();
  }

  setDifficulty(diff) {
    this.difficulty = diff;
    this.preyList.forEach((p) => p.applyDifficulty(diff));
  }

  // Random point on a ring around the valley centre
  ringPoint(minDist, maxDist) {
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    return { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
  }

  // A group of `count` animals within `spread` metres of a point
  spawnGroup(type, count, x, z, spread, extra = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.spawnPrey(type, x + Math.cos(a) * r, z + Math.sin(a) * r, extra);
    }
  }

  spawnInitialPrey() {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 35 + Math.random() * 70;
      this.spawnPrey('ibex', Math.cos(angle) * dist, Math.sin(angle) * dist);
    }
    for (let i = 0; i < 5; i++) {
      const p = this.ringPoint(25, 105);
      this.spawnPrey('hare', p.x, p.z);
    }
    // Bharal herds on the slopes
    for (let h = 0; h < 2; h++) {
      const p = this.ringPoint(50, 120);
      this.spawnGroup('bharal', 4, p.x, p.z, 7);
    }
    // A marmot colony, pikas among the boulders, snowcocks on the open slopes
    const colony = this.ringPoint(40, 90);
    this.spawnGroup('marmot', 3, colony.x, colony.z, 9);
    for (let i = 0; i < 3; i++) {
      const p = this.ringPoint(30, 120);
      this.spawnPrey('pika', p.x, p.z);
    }
    const covey = this.ringPoint(40, 110);
    this.spawnGroup('snowcock', 3, covey.x, covey.z, 5);

    // Two Titan Crag Yaks far out on the high crags, away from camp
    this.spawnPrey('yak', 84, 88);
    this.spawnPrey('yak', -96, -82);

    // A wolf pack roams the far side of the valley
    this.spawnGroup('wolf', 3, 112, -96, 6, { packId: 1 });

    // Herder camp: goats and their mastiffs
    this.spawnGroup('goat', 4, HERDER_CAMP.x, HERDER_CAMP.z, 9, { home: HERDER_CAMP });
    this.spawnGroup('dog', 2, HERDER_CAMP.x, HERDER_CAMP.z, 4, { home: HERDER_CAMP });
  }

  spawnPrey(type, x, z, extra = {}) {
    const p = new PreyAnimal(this.scene, this.terrain, type, x, z, this.difficulty, extra);
    p.manager = this;
    this.preyList.push(p);
    return p;
  }

  // Where a replacement for an animal of this type appears
  respawnPoint(dead) {
    if (dead.home && (dead.type === 'goat' || dead.type === 'dog')) {
      const a = Math.random() * Math.PI * 2;
      return { x: dead.home.x + Math.cos(a) * 30, z: dead.home.z + Math.sin(a) * 30 };
    }
    return this.ringPoint(80, 130);
  }

  update(delta, player) {
    if (this.alarmTimer > 0) this.alarmTimer -= delta;
    this.preyList.forEach((p) => {
      p.update(delta, player, this.preyList);
    });

    // Clean up eaten carcasses quickly, and uneaten ones once they have rotted
    for (let i = this.preyList.length - 1; i >= 0; i--) {
      const p = this.preyList[i];
      if (p.isDead) {
        p.deadTimer += delta;
        if (p.meatAmount <= 0) p.dissolveTimer += delta;
        const lifetime = p.cached ? CACHED_CARCASS_LIFETIME : CARCASS_LIFETIME;
        if (p.dissolveTimer > EATEN_DISSOLVE_TIME || p.deadTimer > lifetime) {
          p.destroy();
          this.preyList.splice(i, 1);
          // A replacement wanders in from afar (livestock and dogs from the camp's surroundings)
          const at = this.respawnPoint(p);
          const extra = { packId: p.packId, home: p.type === 'goat' || p.type === 'dog' ? p.home : undefined };
          this.spawnPrey(p.type, at.x, at.z, extra);
        }
      }
    }
  }

  // Nearest living prey (optionally bosses only) and its distance
  getNearestLiving(playerPos, bossOnly = false) {
    let nearest = null;
    let minDistSq = Infinity;
    for (const p of this.preyList) {
      if (p.isDead || p.hidden || (bossOnly && !p.isBoss)) continue;
      const dSq = playerPos.distanceToSquared(p.position);
      if (dSq < minDistSq) {
        minDistSq = dSq;
        nearest = p;
      }
    }
    return { prey: nearest, distance: Math.sqrt(minDistSq) };
  }
}

export class PreyAnimal {
  constructor(scene, terrain, type, x, z, difficulty = 'medium', extra = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.type = type; // a key of PREY_TYPES
    this.cfg = PREY_TYPES[type];
    this.behavior = this.cfg.behavior;
    this.isBoss = type === 'yak';
    this.isPredator = this.behavior === 'predator' || this.behavior === 'guard';
    this.packId = extra.packId || 0;
    this.home = extra.home || (this.behavior === 'burrow' ? { x, z } : null);
    this.pinnedTimer = 0; // held down by a pounce, waiting for the throat bite
    this.hidden = false; // in a burrow / under a rock
    this.airborne = false; // birds in flight
    this.threat = null; // position of a wolf chasing it (flees from that instead of the leopard)
    this.cached = false;

    this.position = new THREE.Vector3(x, this.terrain.getTerrainHeight(x, z), z);
    this.facingAngle = Math.random() * Math.PI * 2;
    this.state = 'GRAZING'; // GRAZING, SUSPICIOUS, FLEEING, CHARGING, DOWNED
    this.alertMeter = 0; // 0 to 100
    this.isDead = false;
    this.deadTimer = 0;
    this.dissolveTimer = 0;

    // Base Archetype Configuration
    const cfg = this.cfg;
    this.name = cfg.name;
    this.baseMaxHp = cfg.hp;
    this.meatAmount = cfg.meat;
    this.xpReward = cfg.xp;
    this.maxFleeSpeed = cfg.flee;
    this.chargeSpeed = 0;
    this.baseRamDamage = 0;
    if (this.isBoss) {
      // A yak is a heavy animal: slower than a sprinting snow leopard both charging and fleeing
      this.chargeSpeed = 9.0; // a sprinting leopard (14.5 m/s) clearly outruns it
      this.baseRamDamage = 18;
      this.chargeTimer = 0;
      this.chargeCooldown = 0;
    }
    if (this.isPredator) {
      this.baseRamDamage = cfg.bite;
      this.biteCooldown = 0;
      this.huntTimer = 40 + Math.random() * 60; // seconds until the pack gets hungry
      this.state = 'PATROL';
    }

    this.speed = 0;
    this.wanderTimer = Math.random() * 4;
    this.animTime = Math.random() * 10;
    this.zigzagTimer = 0;
    this.zigzagDir = 1;
    this.difficulty = difficulty;

    // Apply difficulty modifiers
    this.applyDifficulty(difficulty);
    this.hp = this.maxHp;

    // Build stylized 3D Model (once per type, then cloned)
    if (!MODEL_CACHE[type]) {
      const builders = {
        yak: () => this.buildYakModel(),
        ibex: () => this.buildIbexModel(),
        hare: () => this.buildHareModel(),
        bharal: () => buildBharalModel(this),
        goat: () => buildGoatModel(this),
        marmot: () => buildMarmotModel(this),
        pika: () => buildPikaModel(this),
        snowcock: () => buildSnowcockModel(this),
        wolf: () => buildWolfModel(this),
        dog: () => buildMastiffModel(this)
      };
      const raw = builders[type]();
      // Tiny animals don't need to cast shadows (saves a lot of draw calls on phones)
      if (this.cfg.smallShadow) raw.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      MODEL_CACHE_LOW[type] = optimizeModel(raw.clone(), true);
      MODEL_CACHE[type] = optimizeModel(raw, this.cfg.smallShadow && type !== 'snowcock');
    }
    // `mesh` positions the animal; inside it the detailed body (near) or the merged one (far)
    this.mesh = new THREE.Group();
    this.body = MODEL_CACHE[type].clone();
    this.bodyLow = MODEL_CACHE_LOW[type].clone();
    this.bodyLow.visible = false;
    this.mesh.add(this.body, this.bodyLow);
    this.headNode = this.body.getObjectByName('head') || new THREE.Group();
    this.wingNodes = this.body.children.filter((c) => c.name === 'wing');
    this.legMeshes = this.body.children.filter((c) => c.name === 'leg');
    this.kneeNodes = this.legMeshes.map((leg) => leg.getObjectByName('knee'));
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);

    // Alert Sprite Indicator (? and ! and 👑)
    this.alertSprite = this.createStatusSprite();
    this.mesh.add(this.alertSprite);

    if (this.isBoss) {
      this.updateSprite('👑', '#fbbf24');
    }
  }

  applyDifficulty(diff) {
    this.difficulty = diff;
    if (diff === 'easy') {
      this.maxHp = Math.round(this.baseMaxHp * 0.8);
      this.ramDamage = Math.round(this.baseRamDamage * 0.65);
      this.perceptionMultiplier = 0.75;
      this.speedMultiplier = 0.9;
      this.alertRateMultiplier = 0.65;
    } else if (diff === 'hard') {
      this.maxHp = Math.round(this.baseMaxHp * 1.35);
      this.ramDamage = Math.round(this.baseRamDamage * 1.5);
      this.perceptionMultiplier = 1.35;
      this.speedMultiplier = 1.12;
      this.alertRateMultiplier = 1.45;
    } else {
      // medium
      this.maxHp = this.baseMaxHp;
      this.ramDamage = this.baseRamDamage;
      this.perceptionMultiplier = 1.0;
      this.speedMultiplier = 1.0;
      this.alertRateMultiplier = 1.0;
    }
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  }

  createStatusSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    this.spriteCanvas = canvas;
    this.spriteTex = tex;

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const [scale, height] = this.cfg.sprite;
    sprite.scale.set(scale, scale, scale);
    sprite.position.y = height;
    sprite.visible = false;
    return sprite;
  }

  updateSprite(text, color) {
    if (!this.spriteCanvas) return;
    // Skip redrawing (and re-uploading the texture) when nothing changed
    if (text === this.spriteText && color === this.spriteColor) return;
    this.spriteText = text;
    this.spriteColor = color;
    const ctx = this.spriteCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    if (!text) {
      this.alertSprite.visible = false;
      return;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);

    this.spriteTex.needsUpdate = true;
    this.alertSprite.visible = true;
  }

  // ------------------------------------------------------------------ model builders
  // All prey are lofted from smooth tube paths (one continuous surface from rump to nose) with
  // vertex-coloured coats, a fur-grain map + normal map, jointed legs (hip + knee) and a
  // 'head' node at the neck base so the AI can raise and lower the head.

  furMaterial(kind) {
    if (!FUR_MATERIALS[kind]) {
      const cfg = {
        ibex: { shag: 1.2, contrast: 0.22, seed: 1, normal: 0.55, rough: 0.9 },
        hare: { shag: 0.7, contrast: 0.12, seed: 2, normal: 0.35, rough: 0.92 },
        yak: { shag: 2.6, contrast: 0.4, seed: 3, normal: 0.9, rough: 0.95 },
        bharal: { shag: 0.9, contrast: 0.16, seed: 4, normal: 0.45, rough: 0.9 },
        goat: { shag: 2.0, contrast: 0.3, seed: 9, normal: 0.8, rough: 0.95 },
        marmot: { shag: 1.1, contrast: 0.2, seed: 5, normal: 0.5, rough: 0.92 },
        pika: { shag: 0.9, contrast: 0.15, seed: 6, normal: 0.4, rough: 0.92 },
        snowcock: { shag: 0.5, contrast: 0.25, seed: 7, normal: 0.3, rough: 0.85 },
        wolf: { shag: 1.6, contrast: 0.28, seed: 13, normal: 0.6, rough: 0.92 },
        dog: { shag: 2.4, contrast: 0.3, seed: 17, normal: 0.8, rough: 0.95 }
      }[kind];
      const { map, normalMap } = makeFurTextures(256, cfg.shag, cfg.contrast, cfg.seed);
      FUR_MATERIALS[kind] = new THREE.MeshStandardMaterial({
        map,
        normalMap,
        normalScale: new THREE.Vector2(cfg.normal, cfg.normal),
        vertexColors: true,
        roughness: cfg.rough,
        metalness: 0.0
      });
    }
    return FUR_MATERIALS[kind];
  }

  // Jointed leg: hip group ('leg') -> upper tube -> knee group ('knee') -> lower tube -> hoof
  buildLeg(x, hipY, z, cfg, mat, hoofMat) {
    const leg = new THREE.Group();
    leg.name = 'leg';
    leg.position.set(x, hipY, z);
    const kneeDrop = hipY - cfg.kneeY;
    const col = cfg.colorFn || (() => new THREE.Color(0xffffff));

    const upper = buildTube(smoothPath([
      { x: 0, y: 0.12, z: 0, rx: cfg.upperR * 1.15, ry: cfg.upperR * 1.25 },
      { x: 0, y: -kneeDrop * 0.5, z: cfg.kneeZ * 0.5, rx: cfg.upperR * 0.95, ry: cfg.upperR },
      { x: 0, y: -kneeDrop, z: cfg.kneeZ, rx: cfg.lowerR * 1.15, ry: cfg.lowerR * 1.2 },
      { x: 0, y: -kneeDrop - cfg.lowerR * 0.9, z: cfg.kneeZ, rx: cfg.lowerR * 0.9, ry: cfg.lowerR * 0.9 }
    ], 3), 10, (i, t, up, side, px, py, pz) => col(t * 0.5, up, side, px, py + hipY, pz), { vScale: 1.2 });
    const upperMesh = new THREE.Mesh(upper, mat);
    upperMesh.castShadow = true;
    leg.add(upperMesh);

    const knee = new THREE.Group();
    knee.name = 'knee';
    knee.position.set(0, -kneeDrop, cfg.kneeZ);
    leg.add(knee);

    const lowerLen = cfg.kneeY - cfg.hoofH;
    const lower = buildTube(smoothPath([
      { x: 0, y: cfg.lowerR * 0.6, z: 0, rx: cfg.lowerR * 1.05, ry: cfg.lowerR * 1.1 },
      { x: 0, y: -lowerLen * 0.5, z: -cfg.kneeZ * 0.45, rx: cfg.lowerR * 0.85, ry: cfg.lowerR * 0.9 },
      { x: 0, y: -lowerLen, z: -cfg.kneeZ, rx: cfg.hoofR * 1.05, ry: cfg.hoofR * 1.05 },
      { x: 0, y: -lowerLen - 0.02, z: -cfg.kneeZ, rx: cfg.hoofR * 0.9, ry: cfg.hoofR * 0.9 }
    ], 3), 10, (i, t, up, side, px, py, pz) => col(0.5 + t * 0.5, up, side, px, py + cfg.kneeY, pz), { vScale: 1.2 });
    const lowerMesh = new THREE.Mesh(lower, mat);
    lowerMesh.castShadow = true;
    knee.add(lowerMesh);

    if (cfg.hoofH > 0) {
      // hoof colour is baked into vertex colours so it merges with the leg into one draw call
      const hoofGeo = new THREE.CylinderGeometry(cfg.hoofR * 0.95, cfg.hoofR * 1.1, cfg.hoofH, 10);
      const hc = hoofMat.color;
      hoofGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(hoofGeo.attributes.position.count * 3).map((_, i) => [hc.r, hc.g, hc.b][i % 3]), 3));
      const hoof = new THREE.Mesh(hoofGeo, mat);
      hoof.position.set(0, -lowerLen - cfg.hoofH * 0.5, -cfg.kneeZ + cfg.hoofR * 0.15);
      hoof.castShadow = true;
      knee.add(hoof);
    }
    return leg;
  }

  // Glossy dark eye with a specular highlight so faces read from a distance
  addEye(parent, x, y, z, r, mat) {
    // Eye and highlight share one vertex-coloured material so they merge into a single draw call
    if (!mat.userData.eyeColor) {
      mat.userData.eyeColor = mat.color.clone();
      mat.color.set(0xffffff);
      mat.vertexColors = true;
    }
    const tint = (geo, col) => geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).map((_, i) => [col.r, col.g, col.b][i % 3]), 3));
    const eyeGeo = new THREE.SphereGeometry(r, 12, 10);
    tint(eyeGeo, mat.userData.eyeColor);
    const eye = new THREE.Mesh(eyeGeo, mat);
    eye.position.set(x, y, z);
    parent.add(eye);
    const glintGeo = new THREE.SphereGeometry(r * 0.28, 6, 6);
    tint(glintGeo, GLINT_COLOR);
    const glint = new THREE.Mesh(glintGeo, mat);
    // highlight sits on the upper-outer-front of the eyeball
    glint.position.set(x + Math.sign(x) * r * 0.35, y + r * 0.45, z + r * 0.7);
    parent.add(glint);
  }

  // Thin whiskers fanning out from the muzzle pads
  addWhiskers(parent, x, y, z, length, count = 3) {
    const geo = new THREE.CylinderGeometry(length * 0.006, length * 0.002, length, 3, 1, true);
    geo.translate(0, length * 0.5, 0);
    geo.rotateX(Math.PI / 2);
    for (let side = -1; side <= 1; side += 2) {
      for (let w = 0; w < count; w++) {
        const whisker = new THREE.Mesh(geo, WHISKER_MAT);
        whisker.position.set(side * x, y + (w - (count - 1) / 2) * length * 0.05, z);
        whisker.rotation.set(0.1 - w * 0.12, side * (1.0 + w * 0.18), 0);
        parent.add(whisker);
      }
    }
  }

  // Himalayan ibex: stocky grey-brown winter coat, dark dorsal stripe and legs, pale belly and
  // rump, dark beard, long knobbed scimitar horns sweeping back over the shoulders.
  buildIbexModel() {
    const group = new THREE.Group();
    const mat = this.furMaterial('ibex');
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x5b5048, roughness: 0.55, metalness: 0.05 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.6 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.15 });

    const dorsal = new THREE.Color(0x6f5f4d), flank = new THREE.Color(0x9c8d77), belly = new THREE.Color(0xd9d0c1);
    const stripe = new THREE.Color(0x2f2620), rumpPatch = new THREE.Color(0xe6dfd3), c = new THREE.Color();
    const bodyColor = (i, t, up, side, px, py, pz) => {
      const n = fbm3(px * 3 + 2, py * 3, pz * 3, 2);
      c.copy(flank).lerp(dorsal, Math.max(0, up) * 0.9).lerp(belly, Math.max(0, -up - 0.15) * 1.2);
      if (up > 0.86 && t > 0.08 && t < 0.78) c.lerp(stripe, (up - 0.86) * 6); // dorsal stripe
      if (t < 0.1 && up > -0.2) c.lerp(rumpPatch, (0.1 - t) * 7 * (0.5 + up * 0.5)); // pale rump
      if (t > 0.8) c.lerp(dorsal, (t - 0.8) * 2.5); // darker neck
      return c.offsetHSL(0, 0, (n - 0.5) * 0.08);
    };

    // Body: tail root -> rump -> belly -> chest -> shoulders -> neck base
    const body = buildTube(smoothPath([
      { x: 0, y: 1.42, z: -1.02, rx: 0.16, ry: 0.18 },
      { x: 0, y: 1.4, z: -0.82, rx: 0.42, ry: 0.5 },
      { x: 0, y: 1.32, z: -0.3, rx: 0.5, ry: 0.58 },
      { x: 0, y: 1.3, z: 0.25, rx: 0.5, ry: 0.6 },
      { x: 0, y: 1.42, z: 0.62, rx: 0.42, ry: 0.52 },
      { x: 0, y: 1.6, z: 0.92, rx: 0.3, ry: 0.36 },
      { x: 0, y: 1.72, z: 1.02, rx: 0.24, ry: 0.28 }
    ], 4), 18, bodyColor, { uScale: 3, vScale: 3 });
    const bodyMesh = new THREE.Mesh(body, mat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Neck + head pivoting at the neck base
    const headNode = new THREE.Group();
    headNode.name = 'head';
    headNode.position.set(0, 1.62, 0.95);
    group.add(headNode);
    const headCol = (i, t, up, side, px, py, pz) => {
      c.copy(dorsal).lerp(flank, Math.max(0, -up) * 0.5);
      if (t > 0.72) c.lerp(belly, (t - 0.72) * 2.2 * (0.6 - up * 0.4)); // pale muzzle
      if (t > 0.45 && t < 0.7 && up < -0.3) c.lerp(stripe, 0.6); // dark chin / beard shadow
      return c;
    };
    const head = buildTube(smoothPath([
      { x: 0, y: -0.1, z: -0.08, rx: 0.3, ry: 0.34 },
      { x: 0, y: 0.25, z: 0.12, rx: 0.24, ry: 0.27 },
      { x: 0, y: 0.56, z: 0.3, rx: 0.21, ry: 0.23 },
      { x: 0, y: 0.68, z: 0.5, rx: 0.2, ry: 0.2 },
      { x: 0, y: 0.6, z: 0.8, rx: 0.14, ry: 0.14 },
      { x: 0, y: 0.52, z: 1.0, rx: 0.09, ry: 0.08 },
      { x: 0, y: 0.5, z: 1.06, rx: 0.04, ry: 0.035 }
    ], 4), 16, headCol, { uScale: 2, vScale: 2 });
    const headMesh = new THREE.Mesh(head, mat);
    headMesh.castShadow = true;
    headNode.add(headMesh);

    // Beard
    const beard = new THREE.Mesh(buildTube(smoothPath([
      { x: 0, y: 0.42, z: 0.86, rx: 0.07, ry: 0.05 },
      { x: 0, y: 0.26, z: 0.84, rx: 0.06, ry: 0.05 },
      { x: 0, y: 0.1, z: 0.8, rx: 0.02, ry: 0.02 }
    ], 3), 8, () => stripe), mat);
    headNode.add(beard);

    // Horns: knobbed scimitars curving back over the neck
    for (let side = -1; side <= 1; side += 2) {
      const ctrl = [
        { x: side * 0.08, y: 0.8, z: 0.42, rx: 0.085, ry: 0.1 },
        { x: side * 0.14, y: 1.12, z: 0.3, rx: 0.075, ry: 0.09 },
        { x: side * 0.22, y: 1.4, z: 0.02, rx: 0.06, ry: 0.07 },
        { x: side * 0.3, y: 1.5, z: -0.32, rx: 0.042, ry: 0.05 },
        { x: side * 0.36, y: 1.42, z: -0.62, rx: 0.022, ry: 0.025 },
        { x: side * 0.4, y: 1.3, z: -0.8, rx: 0.006, ry: 0.006 }
      ];
      const path = smoothPath(ctrl, 5);
      // knobbed ridges along the front edge
      path.forEach((pt, i) => { const k = 1 + (i % 2 === 0 ? 0.14 : -0.08) * (1 - i / path.length); pt.rx *= k; pt.ry *= k; });
      const horn = new THREE.Mesh(buildTube(path, 10), hornMat);
      horn.castShadow = true;
      headNode.add(horn);
    }

    // Ears and eyes
    for (let side = -1; side <= 1; side += 2) {
      const ear = new THREE.Mesh(buildTube(smoothPath([
        { x: side * 0.14, y: 0.66, z: 0.34, rx: 0.05, ry: 0.035 },
        { x: side * 0.26, y: 0.72, z: 0.26, rx: 0.07, ry: 0.03 },
        { x: side * 0.4, y: 0.76, z: 0.18, rx: 0.02, ry: 0.015 }
      ], 3), 8, () => flank), mat);
      headNode.add(ear);
      this.addEye(headNode, side * 0.155, 0.67, 0.66, 0.05, eyeMat);
    }

    // Short tail
    const tail = new THREE.Mesh(buildTube(smoothPath([
      { x: 0, y: 1.45, z: -1.0, rx: 0.06, ry: 0.06 },
      { x: 0, y: 1.5, z: -1.2, rx: 0.07, ry: 0.07 },
      { x: 0, y: 1.42, z: -1.32, rx: 0.02, ry: 0.02 }
    ], 3), 8, () => stripe), mat);
    group.add(tail);

    // Legs: dark fronts with pale inner faces
    const legCol = (t, up, side, px, py, pz) => {
      c.copy(dorsal).lerp(stripe, 0.55 + t * 0.3);
      if (px * side < 0 || side > 0.4) c.lerp(belly, 0.45); // inner / rear face paler
      return c;
    };
    const frontCfg = { upperR: 0.16, lowerR: 0.09, kneeY: 0.66, kneeZ: 0.03, hoofR: 0.085, hoofH: 0.12, colorFn: legCol };
    const backCfg = { upperR: 0.22, lowerR: 0.09, kneeY: 0.72, kneeZ: -0.16, hoofR: 0.085, hoofH: 0.12, colorFn: legCol };
    group.add(this.buildLeg(0.3, 1.3, 0.5, frontCfg, mat, hoofMat));
    group.add(this.buildLeg(-0.3, 1.3, 0.5, frontCfg, mat, hoofMat));
    group.add(this.buildLeg(0.3, 1.35, -0.72, backCfg, mat, hoofMat));
    group.add(this.buildLeg(-0.3, 1.35, -0.72, backCfg, mat, hoofMat));
    return group;
  }

  // Snow hare: compact arched white body, long black-tipped ears, powerful hind legs, pink nose
  buildHareModel() {
    const group = new THREE.Group();
    const mat = this.furMaterial('hare');
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.15 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xd98a93, roughness: 0.5 });
    const white = new THREE.Color(0xf4f5f7), greyBack = new THREE.Color(0xd7dce2), earTip = new THREE.Color(0x1d1d20), innerEar = new THREE.Color(0xd9b8b8), c = new THREE.Color();
    const coat = (i, t, up, side, px, py, pz) => c.copy(white).lerp(greyBack, Math.max(0, up) * 0.6 * (1 - Math.abs(t - 0.5)));

    const body = buildTube(smoothPath([
      { x: 0, y: 0.4, z: -0.46, rx: 0.1, ry: 0.1 },
      { x: 0, y: 0.5, z: -0.32, rx: 0.27, ry: 0.3 },
      { x: 0, y: 0.54, z: -0.02, rx: 0.26, ry: 0.28 },
      { x: 0, y: 0.46, z: 0.26, rx: 0.2, ry: 0.22 },
      { x: 0, y: 0.48, z: 0.4, rx: 0.15, ry: 0.16 }
    ], 4), 16, coat, { uScale: 2, vScale: 2 });
    const bodyMesh = new THREE.Mesh(body, mat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    const headNode = new THREE.Group();
    headNode.name = 'head';
    headNode.position.set(0, 0.5, 0.36);
    group.add(headNode);
    const head = buildTube(smoothPath([
      { x: 0, y: -0.02, z: -0.06, rx: 0.13, ry: 0.13 },
      { x: 0, y: 0.1, z: 0.1, rx: 0.15, ry: 0.15 },
      { x: 0, y: 0.1, z: 0.26, rx: 0.11, ry: 0.11 },
      { x: 0, y: 0.06, z: 0.36, rx: 0.05, ry: 0.045 },
      { x: 0, y: 0.05, z: 0.39, rx: 0.02, ry: 0.02 }
    ], 4), 14, coat, { uScale: 2, vScale: 1.5 });
    headNode.add(new THREE.Mesh(head, mat));
    // nose, split upper lip, whisker pads and whiskers
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), noseMat);
    nose.scale.set(1.15, 0.85, 0.8);
    nose.position.set(0, 0.075, 0.385);
    headNode.add(nose);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0xb0a4a2, roughness: 0.8 }));
    lip.position.set(0, 0.04, 0.37);
    headNode.add(lip);
    for (let side = -1; side <= 1; side += 2) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mat);
      pad.scale.set(1, 0.8, 1);
      pad.position.set(side * 0.045, 0.04, 0.33);
      headNode.add(pad);
    }
    this.addWhiskers(headNode, 0.05, 0.05, 0.36, 0.3, 3);

    for (let side = -1; side <= 1; side += 2) {
      const ear = new THREE.Mesh(buildTube(smoothPath([
        { x: side * 0.05, y: 0.18, z: 0.02, rx: 0.045, ry: 0.035 },
        { x: side * 0.08, y: 0.42, z: -0.06, rx: 0.06, ry: 0.022 },
        { x: side * 0.11, y: 0.64, z: -0.14, rx: 0.045, ry: 0.018 },
        { x: side * 0.12, y: 0.72, z: -0.17, rx: 0.012, ry: 0.01 }
      ], 4), 10, (i, t, up, sd) => (t > 0.82 ? earTip : (sd * side < -0.5 && t < 0.75 ? innerEar : white))), mat);
      ear.castShadow = true;
      headNode.add(ear);
      // large dark hare eyes, set high and to the side of the skull
      this.addEye(headNode, side * 0.105, 0.155, 0.19, 0.042, eyeMat);
    }

    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat);
    tail.position.set(0, 0.5, -0.47);
    group.add(tail);

    const legCol = () => white;
    const frontCfg = { upperR: 0.05, lowerR: 0.035, kneeY: 0.2, kneeZ: 0.02, hoofR: 0.035, hoofH: 0, colorFn: legCol };
    const backCfg = { upperR: 0.11, lowerR: 0.045, kneeY: 0.22, kneeZ: -0.1, hoofR: 0.045, hoofH: 0, colorFn: legCol };
    group.add(this.buildLeg(0.13, 0.4, 0.22, frontCfg, mat, null));
    group.add(this.buildLeg(-0.13, 0.4, 0.22, frontCfg, mat, null));
    group.add(this.buildLeg(0.17, 0.46, -0.24, backCfg, mat, null));
    group.add(this.buildLeg(-0.17, 0.46, -0.24, backCfg, mat, null));
    return group;
  }

  // Titan crag yak: massive humped body under a hanging shaggy skirt, low heavy head with
  // wide sweeping horns, bushy tail
  buildYakModel() {
    const group = new THREE.Group();
    const mat = this.furMaterial('yak');
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xcdc3b2, roughness: 0.5, metalness: 0.05 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.6 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120f0d, roughness: 0.15 });
    const dark = new THREE.Color(0x2e221a), mid = new THREE.Color(0x4a3829), hump = new THREE.Color(0x7d6650), muzzle = new THREE.Color(0x9a948a), c = new THREE.Color();
    const coat = (i, t, up, side, px, py, pz) => {
      const n = fbm3(px * 2 + 5, py * 2, pz * 2, 2);
      c.copy(mid).lerp(hump, Math.max(0, up) * (t > 0.5 && t < 0.9 ? 1.0 : 0.45)).lerp(dark, Math.max(0, -up) * 0.8);
      return c.offsetHSL(0, 0, (n - 0.5) * 0.12);
    };

    // Body: deep chest, tall shoulder hump, neck dropping to a low-carried head
    const body = buildTube(smoothPath([
      { x: 0, y: 2.55, z: -2.2, rx: 0.4, ry: 0.5 },
      { x: 0, y: 2.55, z: -1.6, rx: 0.92, ry: 1.05 },
      { x: 0, y: 2.4, z: -0.5, rx: 1.0, ry: 1.2 },
      { x: 0, y: 2.55, z: 0.6, rx: 1.0, ry: 1.25 },
      { x: 0, y: 3.1, z: 1.25, rx: 0.85, ry: 1.12 },
      { x: 0, y: 2.75, z: 1.95, rx: 0.68, ry: 0.8 },
      { x: 0, y: 2.25, z: 2.35, rx: 0.55, ry: 0.6 }
    ], 4), 20, coat, { uScale: 4, vScale: 4 });
    const bodyMesh = new THREE.Mesh(body, mat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Shaggy skirt hanging from the flanks with a ragged hem
    const skirt = buildTube(smoothPath([
      { x: 0, y: 1.95, z: -1.95, rx: 0.8, ry: 0.75 },
      { x: 0, y: 1.9, z: -1.0, rx: 1.1, ry: 0.95 },
      { x: 0, y: 1.85, z: 0.2, rx: 1.14, ry: 1.0 },
      { x: 0, y: 1.95, z: 1.2, rx: 1.06, ry: 0.9 },
      { x: 0, y: 2.1, z: 1.6, rx: 0.78, ry: 0.7 }
    ], 3), 24, (i, t, up) => c.copy(dark).lerp(mid, Math.max(0, up) * 0.5), { uScale: 5, vScale: 4 });
    {
      // ragged hanging hem
      const p = skirt.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < 1.5) {
          const rag = fbm3(p.getX(i) * 3, 0, p.getZ(i) * 3, 2);
          p.setY(i, y - (1.5 - y) * 0.7 * (0.3 + rag));
        }
      }
      skirt.computeVertexNormals();
    }
    const skirtMesh = new THREE.Mesh(skirt, mat);
    skirtMesh.castShadow = true;
    group.add(skirtMesh);

    const headNode = new THREE.Group();
    headNode.name = 'head';
    headNode.position.set(0, 2.45, 2.3);
    group.add(headNode);
    const headCol = (i, t, up) => (t > 0.78 ? c.copy(muzzle).lerp(dark, Math.max(0, up) * 0.4) : c.copy(mid).lerp(dark, 0.3 + Math.max(0, -up) * 0.4));
    const head = buildTube(smoothPath([
      { x: 0, y: 0.0, z: -0.15, rx: 0.48, ry: 0.52 },
      { x: 0, y: -0.05, z: 0.3, rx: 0.5, ry: 0.54 },
      { x: 0, y: -0.4, z: 0.75, rx: 0.42, ry: 0.42 },
      { x: 0, y: -0.75, z: 1.1, rx: 0.33, ry: 0.3 },
      { x: 0, y: -0.9, z: 1.32, rx: 0.24, ry: 0.2 },
      { x: 0, y: -0.95, z: 1.4, rx: 0.1, ry: 0.08 }
    ], 4), 16, headCol, { uScale: 3, vScale: 2 });
    const headMesh = new THREE.Mesh(head, mat);
    headMesh.castShadow = true;
    headNode.add(headMesh);

    for (let side = -1; side <= 1; side += 2) {
      const horn = new THREE.Mesh(buildTube(smoothPath([
        { x: side * 0.3, y: 0.3, z: 0.15, rx: 0.19, ry: 0.19 },
        { x: side * 0.95, y: 0.35, z: 0.05, rx: 0.15, ry: 0.15 },
        { x: side * 1.45, y: 0.6, z: 0.2, rx: 0.1, ry: 0.1 },
        { x: side * 1.65, y: 1.1, z: 0.6, rx: 0.06, ry: 0.06 },
        { x: side * 1.5, y: 1.45, z: 0.9, rx: 0.012, ry: 0.012 }
      ], 5), 10), hornMat);
      horn.castShadow = true;
      headNode.add(horn);
      const ear = new THREE.Mesh(buildTube(smoothPath([
        { x: side * 0.42, y: 0.05, z: 0.25, rx: 0.08, ry: 0.06 },
        { x: side * 0.68, y: 0.0, z: 0.2, rx: 0.1, ry: 0.05 },
        { x: side * 0.86, y: -0.06, z: 0.16, rx: 0.03, ry: 0.02 }
      ], 3), 8, () => dark), mat);
      headNode.add(ear);
      this.addEye(headNode, side * 0.38, -0.05, 0.62, 0.07, eyeMat);
    }

    const tail = new THREE.Mesh(buildTube(smoothPath([
      { x: 0, y: 2.6, z: -2.25, rx: 0.12, ry: 0.12 },
      { x: 0, y: 2.1, z: -2.5, rx: 0.22, ry: 0.22 },
      { x: 0, y: 1.5, z: -2.62, rx: 0.3, ry: 0.3 },
      { x: 0, y: 1.05, z: -2.6, rx: 0.1, ry: 0.1 }
    ], 4), 10, () => dark, { uScale: 2, vScale: 2 }), mat);
    tail.castShadow = true;
    group.add(tail);

    const legCol = () => dark;
    const frontCfg = { upperR: 0.32, lowerR: 0.2, kneeY: 1.05, kneeZ: 0.05, hoofR: 0.22, hoofH: 0.26, colorFn: legCol };
    const backCfg = { upperR: 0.36, lowerR: 0.2, kneeY: 1.1, kneeZ: -0.3, hoofR: 0.22, hoofH: 0.26, colorFn: legCol };
    group.add(this.buildLeg(0.62, 2.0, 0.95, frontCfg, mat, hoofMat));
    group.add(this.buildLeg(-0.62, 2.0, 0.95, frontCfg, mat, hoofMat));
    group.add(this.buildLeg(0.62, 2.1, -1.35, backCfg, mat, hoofMat));
    group.add(this.buildLeg(-0.62, 2.1, -1.35, backCfg, mat, hoofMat));
    return group;
  }

  takeDamage(amount) {
    if (this.isDead) return;
    this.hp -= amount;
    sounds.playAttackHit();

    if (this.hp <= 0) {
      this.die();
    } else if (this.isPredator) {
      // Wolves and mastiffs fight back, and break off once badly hurt
      this.alertMeter = 100;
      if (this.hp < this.maxHp * 0.35) this.retreat();
      else {
        this.state = 'ATTACK';
        this.updateSprite('⚔️', '#dc2626');
      }
    } else {
      this.alertMeter = 100;
      if (this.isBoss) {
        if (this.hp > this.maxHp * 0.25) {
          this.state = 'CHARGING';
          this.chargeTimer = 5.0;
          this.updateSprite('⚔️', '#dc2626');
          sounds.playBossGrunt();
        } else {
          this.state = 'FLEEING';
          this.updateSprite('!', '#ef4444');
        }
      } else {
        // Immediate panic flight
        this.state = 'FLEEING';
        this.updateSprite('!', '#e02424');
        sounds.playPreyAlert();
      }
    }
  }

  die() {
    this.isDead = true;
    this.state = 'DOWNED';
    this.pinnedTimer = 0;
    this.airborne = false;
    if (this.cfg.livestock && this.manager) {
      // Taking livestock sets the herders' dogs on you (the real-life cause of most snow leopard killings)
      this.manager.alarmTimer = 60;
      if (this.manager.onLivestockKilled) this.manager.onLivestockKilled(this);
    }
    if (!this.isBoss) {
      this.updateSprite(this.meatAmount > 0 ? '🍖' : '', '#22c55e');
      this.mesh.rotation.z = Math.PI / 2.2;
      this.mesh.position.y = this.terrain.getSurfaceHeight(this.position.x, this.position.z) - this.cfg.drop;
      this.position.y = this.mesh.position.y;
      return;
    }
    if (this.isBoss) {
      this.updateSprite('👑🍖', '#f59e0b');
      this.mesh.rotation.z = Math.PI / 2.2;
      this.mesh.position.y -= 1.5;
      sounds.playBossGrunt();
    } else {
      this.updateSprite('🍖', '#22c55e');
      this.mesh.rotation.z = Math.PI / 2.2;
      this.mesh.position.y -= this.type === 'ibex' ? 0.75 : 0.25;
    }
  }

  update(delta, player, allPrey) {
    if (this.isDead) {
      if (this.meatAmount <= 0) {
        this.updateSprite('', '');
      }
      return;
    }

    // Tucked away in a burrow or under a rock: invisible and untouchable until it peeks out
    if (this.hidden) {
      this.hiddenTimer -= delta;
      if (this.hiddenTimer <= 0 && this.position.distanceTo(player.position) > 12) this.emerge();
      return;
    }

    this.animTime += delta * 6;
    const distToPlayer = this.position.distanceTo(player.position);

    // Far-away animals are hidden from the renderer: small ones are a few pixels well before that
    this.mesh.visible = this.isBoss || distToPlayer < (this.cfg.smallShadow ? 75 : this.type === 'hare' ? 110 : 170);
    const near = distToPlayer < LOD_DISTANCE || this.airborne;
    this.body.visible = near;
    this.bodyLow.visible = !near;

    let targetSpeed;
    if (this.pinnedTimer > 0) {
      // Pinned by a pounce: thrashes in place until bitten or it breaks free
      this.pinnedTimer -= delta;
      targetSpeed = 0;
      this.speed = 0;
      this.mesh.rotation.z = Math.sin(this.animTime * 4) * 0.25;
      if (this.pinnedTimer <= 0) {
        this.mesh.rotation.z = 0;
        this.state = 'FLEEING';
        this.alertMeter = 100;
        this.updateSprite('!', '#ef4444');
      }
    } else if (this.isPredator) {
      targetSpeed = this.thinkPredator(delta, player, allPrey, distToPlayer);
    } else {
      targetSpeed = this.thinkPrey(delta, player, allPrey, distToPlayer);
    }
    this.move(delta, targetSpeed, player);
  }

  // ------------------------------------------------------------------ prey senses & choices
  thinkPrey(delta, player, allPrey, distToPlayer) {
    // Flat direction to player
    const dirToPlayer = _toPlayer.subVectors(player.position, this.position).setY(0).normalize();

    // Facing vector of prey
    _forward.set(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
    const angleToPlayer = _forward.angleTo(dirToPlayer); // 0 = straight ahead, PI = directly behind

    const perceptionMult = this.perceptionMultiplier;
    const speedMult = this.speedMultiplier;
    const alertMult = this.alertRateMultiplier;
    // A leopard holding still against the rocks is nearly invisible ("ghost of the mountains")
    const camo = player.camo || 0;

    // --- SENSE CALCULATIONS ---
    // Hearing: drastically reduced when player is STALKING
    let hearingDistance = 14 * perceptionMult;
    if (player.isSprinting) hearingDistance = 38 * perceptionMult;
    else if (player.isStalking) hearingDistance = 6.5 * perceptionMult; // Sneak reward!
    hearingDistance *= env.hearing; // blizzard wind masks footsteps

    // Sight: prey sees forward cone (~120 deg) further than back; darkness and snowstorms cut it
    let sightDistance = 42 * perceptionMult * env.sight * (1 - 0.75 * camo);
    const inSightCone = angleToPlayer < (Math.PI * 0.65);
    const canSee = inSightCone && distToPlayer < (player.isStalking ? sightDistance * 0.45 : sightDistance);
    const canHear = distToPlayer < hearingDistance;
    const touching = distToPlayer < (this.cfg.behavior === 'bird' || this.type === 'pika' ? 4 : 7) * (1 - 0.4 * camo);

    // A yak that just gave up the chase ignores you for a while unless you come right up close
    if (this.calmTimer > 0) this.calmTimer -= delta;
    const ignoring = this.calmTimer > 0 && distToPlayer > 12;

    // Detect Player
    if ((canSee || canHear || touching) && !ignoring) {
      // Stalking fills alert meter 70% slower!
      const alertRate = (player.isStalking ? 18 : (player.isSprinting ? 95 : 45)) * alertMult * (1 - 0.5 * camo);
      this.alertMeter = Math.min(100, this.alertMeter + delta * alertRate);
    } else {
      // Calms down over time if out of range
      this.alertMeter = Math.max(0, this.alertMeter - delta * 15);
    }
    // A wolf on its heels counts as a threat too
    if (this.threat) {
      this.alertMeter = 100;
      this.threatTimer -= delta;
      if (this.threatTimer <= 0) this.threat = null;
    }

    // State transitions based on alert meter
    if (this.alertMeter >= 85) {
      if (this.isBoss) {
        if (this.state !== 'CHARGING' && this.state !== 'FLEEING' && this.state !== 'WINDED') {
          if (this.hp > this.maxHp * 0.25) {
            this.state = 'CHARGING';
            this.chargeTimer = 5.0;
            this.chargeCooldown = 0;
            this.updateSprite('⚔️', '#dc2626');
            sounds.playBossGrunt();
          } else {
            this.state = 'FLEEING';
            this.updateSprite('!', '#ef4444');
          }
        }
      } else if (this.state !== 'FLEEING') {
        this.startFleeing(allPrey, true);
      }
    } else if (this.alertMeter > 25) {
      if (this.state === 'GRAZING') {
        this.state = 'SUSPICIOUS';
        this.updateSprite(this.isBoss ? '👑?' : '?', '#eab308');
      }
    } else if (this.state === 'SUSPICIOUS' || this.state === 'FLEEING') {
      // Calmed down (or escaped): go back to grazing
      this.state = 'GRAZING';
      this.updateSprite(this.isBoss ? '👑' : '', '#fbbf24');
    }

    // --- BEHAVIOR STATE EXECUTION ---
    let targetSpeed = 0;

    if (this.state === 'GRAZING') {
      this.wanderTimer -= delta;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 3 + Math.random() * 5;
        let turn = (Math.random() - 0.5) * 1.8;
        // Livestock and marmots stay close to home
        if (this.home && Math.hypot(this.home.x - this.position.x, this.home.z - this.position.z) > (this.cfg.livestock ? 16 : 8)) {
          turn = lerpAngle(0, Math.atan2(this.home.x - this.position.x, this.home.z - this.position.z) - this.facingAngle, 1);
        }
        this.facingAngle = lerpAngle(this.facingAngle, this.facingAngle + turn, 1);
      }
      // Drowsy at night: barely moves
      targetSpeed = (env.phase === 'night' ? 0.5 : 1.2) * speedMult * (this.cfg.flee < 10 ? 0.6 : 1);
      // Head down grazing; marmots sit up on sentry now and then
      if (this.behavior === 'burrow' && Math.sin(this.animTime * 0.18) > 0.7) {
        targetSpeed = 0;
        this.headNode.rotation.x = -0.7;
        this.mesh.rotation.x = -0.55;
      } else {
        this.mesh.rotation.x = 0;
        this.headNode.rotation.x = 0.5 + Math.sin(this.animTime * 0.4) * 0.2;
      }
    } else if (this.state === 'SUSPICIOUS') {
      // Freeze, look at predator
      targetSpeed = 0;
      const lookAngle = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.facingAngle = lerpAngle(this.facingAngle, lookAngle, delta * 3);
      this.headNode.rotation.x = -0.3; // Head held alert and high
      this.mesh.rotation.x = 0;
    } else if (this.state === 'CHARGING') {
      // BOSS YAK COMBAT: Charge straight at the predator!
      this.chargeTimer -= delta;
      if (this.chargeCooldown > 0) this.chargeCooldown -= delta;

      // Thunder in, then hold at horn range rather than trampling straight through the leopard
      targetSpeed = distToPlayer < 3.6 ? 0 : this.chargeSpeed * speedMult;
      const targetAngle = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.facingAngle = lerpAngle(this.facingAngle, targetAngle, delta * 5);

      this.headNode.rotation.x = 0.55; // Lower horns ready to ram!

      // Ramming Snow Leopard
      if (distToPlayer < 3.8 && this.chargeCooldown <= 0) {
        this.chargeCooldown = 2.4;
        player.takeDamage(this.ramDamage);
        sounds.playBossGrunt();
        if (player.onRammed) {
          player.onRammed(this.ramDamage);
        }
      }

      if (this.chargeTimer <= 0) {
        if (distToPlayer > YAK_GIVE_UP_DISTANCE) {
          // You got away: it loses interest
          this.state = 'GRAZING';
          this.alertMeter = 30;
          this.calmTimer = 8;
          this.updateSprite('👑', '#fbbf24');
        } else {
          // Heavy animal: it has to stop and blow before charging again
          this.state = 'WINDED';
          this.windedTimer = 2.5;
          this.updateSprite('💨', '#64748b');
        }
      }
    } else if (this.state === 'WINDED') {
      targetSpeed = 0;
      this.headNode.rotation.x = 0.7 + Math.sin(this.animTime * 2) * 0.1; // head low, panting
      this.windedTimer -= delta;
      if (this.windedTimer <= 0) {
        if (distToPlayer > YAK_GIVE_UP_DISTANCE) {
          this.state = 'GRAZING';
          this.alertMeter = 30;
          this.calmTimer = 8;
          this.updateSprite('👑', '#fbbf24');
        } else {
          this.state = 'CHARGING';
          this.chargeTimer = 4.5;
          this.updateSprite('⚔️', '#dc2626');
          sounds.playBossGrunt();
        }
      }
    } else if (this.state === 'FLEEING') {
      targetSpeed = this.maxFleeSpeed * speedMult;
      this.mesh.rotation.x = 0;
      const from = this.threat && this.threat.distanceTo(this.position) < distToPlayer ? this.threat : player.position;
      const fleeDir = _fleeDir.subVectors(this.position, from).setY(0).normalize();

      if (this.behavior === 'zigzag') {
        this.zigzagTimer -= delta;
        if (this.zigzagTimer <= 0) {
          this.zigzagTimer = 0.4 + Math.random() * 0.4;
          this.zigzagDir *= -1;
        }
        // Perpendicular evasive dodge
        const px = -fleeDir.z * this.zigzagDir * 0.6;
        const pz = fleeDir.x * this.zigzagDir * 0.6;
        fleeDir.set(fleeDir.x + px, 0, fleeDir.z + pz).normalize();
      } else if (this.cfg.climber) {
        // Bharal escape up onto the steep crags
        const n = this.terrain.getTerrainNormal(this.position.x, this.position.z, _uphill);
        fleeDir.x -= n.x * 1.4;
        fleeDir.z -= n.z * 1.4;
        fleeDir.normalize();
      } else if (this.refuge) {
        // Marmots and pikas run for the burrow / nearest boulder and vanish into it
        const dx = this.refuge.x - this.position.x;
        const dz = this.refuge.z - this.position.z;
        const d = Math.hypot(dx, dz);
        if (d < this.refuge.reach) {
          this.hide();
          return 0;
        }
        fleeDir.set(dx / d, 0, dz / d);
      }

      const targetAngle = Math.atan2(fleeDir.x, fleeDir.z);
      this.facingAngle = lerpAngle(this.facingAngle, targetAngle, delta * 8);

      this.headNode.rotation.x = 0.1;

      // If fled far enough, calm down
      if (distToPlayer > 55 && !this.threat) {
        this.alertMeter = Math.max(0, this.alertMeter - delta * 20);
      }
    }
    return targetSpeed;
  }

  // Panic: bolt, and warn every other animal nearby (alarm calls, marmot whistles)
  startFleeing(allPrey, spread) {
    this.state = 'FLEEING';
    this.updateSprite('!', '#ef4444');
    if (this.behavior === 'bird') {
      this.takeOff();
      return;
    }
    if (this.behavior === 'burrow') {
      sounds.playMarmotWhistle();
      this.refuge = { x: this.home.x, z: this.home.z, reach: 1.4 };
    } else if (this.behavior === 'hider') {
      const { obstacle } = this.terrain.nearestObstacle(this.position, 'rock');
      this.refuge = obstacle ? { x: obstacle.x, z: obstacle.z, reach: obstacle.radius + 0.8 } : null;
    } else {
      sounds.playPreyAlert();
    }
    if (!spread) return;
    const reach = this.behavior === 'burrow' ? 32 : 24;
    allPrey.forEach((other) => {
      if (other === this || other.isDead || other.isBoss || other.isPredator || other.hidden || other.state === 'FLEEING') return;
      if (this.position.distanceTo(other.position) < reach) {
        other.alertMeter = 90;
        other.startFleeing(allPrey, false);
      }
    });
  }

  hide() {
    this.hidden = true;
    this.hiddenTimer = 12 + Math.random() * 10;
    this.mesh.visible = false;
    this.state = 'GRAZING';
    this.alertMeter = 0;
    this.speed = 0;
    this.updateSprite('', '');
  }

  emerge() {
    this.hidden = false;
    this.mesh.visible = true;
    this.refuge = null;
    this.state = 'SUSPICIOUS';
    this.alertMeter = 40;
    this.updateSprite('?', '#eab308');
  }

  // Snowcock bursts into flight downhill and lands a good way off
  takeOff() {
    this.airborne = true;
    this.flightTime = 0;
    this.flightLength = 2.6 + Math.random() * 0.8;
    sounds.playBirdCall();
  }

  // ------------------------------------------------------------------ wolves & mastiffs
  // PATROL with the pack -> HUNT a target -> FEED on the kill. They turn on the leopard when it
  // comes too close (to their kill, or to the camp for mastiffs) and RETREAT once badly hurt.
  thinkPredator(delta, player, allPrey, distToPlayer) {
    const isDog = this.behavior === 'guard';
    const cfg = this.cfg;
    const leopardDown = player.isDowned;
    if (this.biteCooldown > 0) this.biteCooldown -= delta;
    this.headNode.rotation.x = 0.2;

    if (this.state === 'RETREAT') {
      this.retreatTimer -= delta;
      if (this.retreatTimer <= 0) this.state = 'PATROL';
      const away = _fleeDir.subVectors(this.position, player.position).setY(0).normalize();
      this.facingAngle = lerpAngle(this.facingAngle, Math.atan2(away.x, away.z), delta * 6);
      return cfg.flee * this.speedMultiplier;
    }

    // Decide whether to go for the leopard
    let provoked = false;
    if (isDog) {
      const fromCamp = Math.hypot(player.position.x - this.home.x, player.position.z - this.home.z);
      const alarm = this.manager && this.manager.alarmTimer > 0;
      provoked = fromCamp < 30 || (alarm && distToPlayer < 90);
      if (this.state === 'ATTACK' && !alarm && fromCamp > 48) provoked = false;
    } else {
      const pack = allPrey.filter((p) => p.type === 'wolf' && p.packId === this.packId && !p.isDead);
      const brave = pack.length >= 2 || player.hp < player.maxHp * 0.4;
      const guardingKill = this.feedOn && !this.feedOn.isDead ? false : this.feedOn && this.feedOn.position.distanceTo(player.position) < 13;
      const closeCall = distToPlayer < 9 * env.sight * (1 - 0.6 * (player.camo || 0)) * (player.isStalking ? 0.6 : 1);
      provoked = brave && (guardingKill || closeCall || this.state === 'ATTACK') && distToPlayer < 32;
      if (!brave && distToPlayer < 14) this.retreat();
    }
    if (leopardDown) provoked = false;

    if (provoked) {
      if (this.state !== 'ATTACK') {
        this.state = 'ATTACK';
        this.updateSprite('⚔️', '#dc2626');
        sounds.playGrowl();
      }
      const dir = _toPlayer.subVectors(player.position, this.position).setY(0).normalize();
      this.facingAngle = lerpAngle(this.facingAngle, Math.atan2(dir.x, dir.z), delta * 7);
      this.headNode.rotation.x = 0.45;
      if (distToPlayer < 2.7 && this.biteCooldown <= 0) {
        this.biteCooldown = 1.9;
        const dmg = Math.round(this.ramDamage);
        player.takeDamage(dmg);
        if (player.onBitten) player.onBitten(dmg, this);
      }
      return distToPlayer < 2.2 ? 0 : cfg.chase * this.speedMultiplier;
    }
    if (this.state === 'ATTACK') {
      this.state = 'PATROL';
      this.updateSprite('', '');
    }

    // Mastiffs just pace around the camp
    if (isDog) return this.wander(delta, this.home, 10, 1.4);

    // Feeding on a kill
    if (this.state === 'FEED') {
      const kill = this.feedOn;
      const d = kill ? Math.hypot(kill.position.x - this.position.x, kill.position.z - this.position.z) : Infinity;
      if (!kill || kill.meatAmount <= 0 || d > 60) {
        this.state = 'PATROL';
        this.feedOn = null;
      } else if (d > 2.6) {
        // trot over to the pack's kill
        this.facingAngle = lerpAngle(this.facingAngle, Math.atan2(kill.position.x - this.position.x, kill.position.z - this.position.z), delta * 6);
        return d > 12 ? this.cfg.chase * 0.7 : 3;
      } else {
        kill.meatAmount = Math.max(0, kill.meatAmount - delta * 1.5);
        this.headNode.rotation.x = 0.8;
        return 0;
      }
    }

    // Hunting
    if (this.state === 'HUNT') {
      const t = this.target;
      this.huntChase -= delta;
      if (!t || t.isDead || t.hidden || t.airborne || this.huntChase <= 0) {
        this.state = 'PATROL';
        this.huntTimer = 60 + Math.random() * 60;
        if (t && t.isDead) {
          this.state = 'FEED';
          this.feedOn = t;
        }
        return 0;
      }
      t.threat = this.position;
      t.threatTimer = 1;
      const dir = _toPlayer.subVectors(t.position, this.position).setY(0);
      const d = dir.length();
      dir.normalize();
      this.facingAngle = lerpAngle(this.facingAngle, Math.atan2(dir.x, dir.z), delta * 6);
      if (d < 2.3) {
        t.takeDamage(t.hp + 1); // pulled down
        t.threat = null;
        this.state = 'FEED';
        this.feedOn = t;
        for (const w of allPrey) if (w.type === 'wolf' && w.packId === this.packId && !w.isDead && w !== this && w.state !== 'ATTACK') { w.state = 'FEED'; w.feedOn = t; }
        return 0;
      }
      return cfg.chase * this.speedMultiplier;
    }

    // Patrolling: the leader wanders, the rest trot along behind
    this.huntTimer -= delta;
    const leader = allPrey.find((p) => p.type === 'wolf' && p.packId === this.packId && !p.isDead);
    if (this.huntTimer <= 0 && leader === this) {
      let best = null;
      let bestD = 70;
      for (const p of allPrey) {
        if (p.isDead || p.hidden || p.airborne || p.isBoss || p.isPredator || p.cfg.livestock) continue;
        const d = p.position.distanceTo(this.position);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        for (const w of allPrey) {
          if (w.type === 'wolf' && w.packId === this.packId && !w.isDead && w.state === 'PATROL') {
            w.state = 'HUNT';
            w.target = best;
            w.huntChase = 18;
          }
        }
        if (env.phase === 'night' || Math.random() < 0.4) sounds.playWolfHowl(distToPlayer);
        return cfg.chase;
      }
      this.huntTimer = 20;
    }
    if (leader && leader !== this && leader.position.distanceTo(this.position) > 7) {
      const dir = _toPlayer.subVectors(leader.position, this.position).setY(0).normalize();
      this.facingAngle = lerpAngle(this.facingAngle, Math.atan2(dir.x, dir.z), delta * 4);
      return leader.position.distanceTo(this.position) > 20 ? cfg.chase * 0.8 : 3.2;
    }
    return this.wander(delta, null, 0, 2.2);
  }

  retreat() {
    this.state = 'RETREAT';
    this.retreatTimer = 12;
    this.updateSprite('!', '#ef4444');
  }

  // Ambles around, turning back toward `home` if it strays more than `range` metres
  wander(delta, home, range, speed) {
    this.wanderTimer -= delta;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2 + Math.random() * 4;
      if (home && Math.hypot(home.x - this.position.x, home.z - this.position.z) > range) {
        this.facingAngle = Math.atan2(home.x - this.position.x, home.z - this.position.z);
      } else {
        this.facingAngle = lerpAngle(this.facingAngle, this.facingAngle + (Math.random() - 0.5) * 1.6, 1);
      }
    }
    return speed * (env.phase === 'night' ? 0.7 : 1);
  }

  // ------------------------------------------------------------------ movement & animation
  move(delta, targetSpeed, player) {
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, delta * 6);

    // Birds in flight: fast, high arc, wings beating; land and settle afterwards
    let lift = 0;
    if (this.airborne) {
      this.flightTime += delta;
      const f = this.flightTime / this.flightLength;
      this.speed = 15;
      lift = Math.sin(Math.min(1, f) * Math.PI) * 9;
      for (const w of this.wingNodes) w.rotation.z = Math.sin(this.flightTime * 28) * 0.9 * w.userData.side;
      if (f >= 1) {
        this.airborne = false;
        this.state = 'SUSPICIOUS';
        this.alertMeter = 45;
        for (const w of this.wingNodes) w.rotation.z = 0;
      }
    }

    // Apply movement
    if (this.speed > 0.1) {
      this.position.x += Math.sin(this.facingAngle) * this.speed * delta;
      this.position.z += Math.cos(this.facingAngle) * this.speed * delta;

      // Dynamic hoof/paw prints on snow when running or charging
      if (this.speed > 2.8 && !this.airborne) {
        this.stepTimer = (this.stepTimer || 0) + delta;
        if (this.stepTimer > 0.18) {
          this.stepTimer = 0;
          this.terrain.addPawPrint(this.position.x, this.position.z, this.facingAngle, this.cfg.print);
        }
      }
    }

    // Keep within world bounds
    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    // Solid collision against rocks and tree trunks (birds fly over them)
    if (!this.airborne) this.terrain.resolveCollision(this.position, this.cfg.radius);

    // A yak is a wall of muscle: keep the leopard (and the camera) out of its body
    if (this.isBoss) {
      const minGap = 2.9;
      const gapSq = (player.position.x - this.position.x) ** 2 + (player.position.z - this.position.z) ** 2;
      if (gapSq < minGap * minGap && gapSq > 0.0001) {
        const gap = Math.sqrt(gapSq);
        const push = (minGap - gap) / gap;
        player.position.x += (player.position.x - this.position.x) * push;
        player.position.z += (player.position.z - this.position.z) * push;
      }
    }

    // Stand on the snow as drawn
    const groundY = this.terrain.getSurfaceHeight(this.position.x, this.position.z);
    this.position.y = groundY + lift;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;

    // Leg animation: stride rate follows actual ground speed and leg length, so a lumbering yak
    // takes slow heavy steps while a hare's legs blur
    if (this.speed > 0.2 && !this.airborne && this.mesh.visible && this.body.visible) {
      const strideLen = this.cfg.stride;
      this.legPhase = (this.legPhase || 0) + delta * (this.speed / strideLen) * Math.PI * 2;
      const legAmp = Math.min(0.75, 0.25 + this.speed * 0.045);
      this.legMeshes.forEach((leg, idx) => {
        // diagonal pairs move together: FL+BR, FR+BL
        const offset = (idx === 0 || idx === 3) ? 0 : Math.PI;
        const swing = Math.sin(this.legPhase + offset);
        leg.rotation.x = swing * legAmp;
        // knee folds while the leg swings forward (lifted)
        const knee = this.kneeNodes[idx];
        if (knee) knee.rotation.x = Math.max(0, -swing) * legAmp * 1.3 + 0.08;
      });
      // body bob + head nod in time with the stride
      this.mesh.position.y = groundY + Math.abs(Math.sin(this.legPhase)) * Math.min(0.12, this.speed * 0.012);
    } else if (!this.airborne) {
      this.legMeshes.forEach((leg, idx) => {
        leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, 0, delta * 6);
        const knee = this.kneeNodes[idx];
        if (knee) knee.rotation.x = THREE.MathUtils.lerp(knee.rotation.x, 0.08, delta * 6);
      });
    }
  }

  destroy() {
    this.scene.remove(this.mesh);
    // Geometry and materials are shared with the cached model; only the status sprite is unique
    this.spriteTex.dispose();
    this.alertSprite.material.dispose();
  }
}
