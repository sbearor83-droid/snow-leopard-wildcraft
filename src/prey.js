import * as THREE from 'three';
import { sounds } from './audio.js';
import { lerpAngle } from './utils.js';
import { buildTube, smoothPath, makeFurTextures, fbm3 } from './procgen.js';

// Carcasses that are never fully eaten rot away after this many seconds
const CARCASS_LIFETIME = 90;
// Seconds a fully eaten carcass lingers before it is removed
const EATEN_DISSOLVE_TIME = 6;

// One model per prey type is built once and cloned; clones share geometry and materials
const MODEL_CACHE = {};
const FUR_MATERIALS = {};

// Scratch vectors reused every frame to avoid per-frame allocations
const _toPlayer = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _fleeDir = new THREE.Vector3();

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

  spawnInitialPrey() {
    // Spawn 7 Himalayan Ibex
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 35 + Math.random() * 70;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      this.spawnPrey('ibex', x, z);
    }

    // Spawn 6 Snow Hares
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 80;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      this.spawnPrey('hare', x, z);
    }

    // Spawn 2 Legendary Boss Yaks (Titan Crag Yaks) far out on the high crags, away from camp
    this.spawnPrey('yak', 84, 88);
    this.spawnPrey('yak', -96, -82);
  }

  spawnPrey(type, x, z) {
    const p = new PreyAnimal(this.scene, this.terrain, type, x, z, this.difficulty);
    this.preyList.push(p);
  }

  update(delta, player) {
    this.preyList.forEach((p) => {
      p.update(delta, player, this.preyList);
    });

    // Clean up eaten carcasses quickly, and uneaten ones once they have rotted
    for (let i = this.preyList.length - 1; i >= 0; i--) {
      const p = this.preyList[i];
      if (p.isDead) {
        p.deadTimer += delta;
        if (p.meatAmount <= 0) p.dissolveTimer += delta;
        if (p.dissolveTimer > EATEN_DISSOLVE_TIME || p.deadTimer > CARCASS_LIFETIME) {
          p.destroy();
          this.preyList.splice(i, 1);
          // Respawn in distant location
          const angle = Math.random() * Math.PI * 2;
          const dist = 80 + Math.random() * 50;
          this.spawnPrey(p.type, Math.cos(angle) * dist, Math.sin(angle) * dist);
        }
      }
    }
  }

  // Nearest living prey (optionally bosses only) and its distance
  getNearestLiving(playerPos, bossOnly = false) {
    let nearest = null;
    let minDistSq = Infinity;
    for (const p of this.preyList) {
      if (p.isDead || (bossOnly && !p.isBoss)) continue;
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
  constructor(scene, terrain, type, x, z, difficulty = 'medium') {
    this.scene = scene;
    this.terrain = terrain;
    this.type = type; // 'ibex', 'hare', or 'yak'
    this.isBoss = type === 'yak';

    this.position = new THREE.Vector3(x, this.terrain.getTerrainHeight(x, z), z);
    this.facingAngle = Math.random() * Math.PI * 2;
    this.state = 'GRAZING'; // GRAZING, SUSPICIOUS, FLEEING, CHARGING, DOWNED
    this.alertMeter = 0; // 0 to 100
    this.isDead = false;
    this.deadTimer = 0;
    this.dissolveTimer = 0;

    // Base Archetype Configuration
    if (this.isBoss) {
      this.name = 'Titan Crag Yak';
      this.baseMaxHp = 300;
      this.meatAmount = 350;
      this.xpReward = 350;
      // A yak is a heavy animal: slower than a sprinting snow leopard both charging and fleeing
      this.maxFleeSpeed = 7.5;
      this.chargeSpeed = 11.0;
      this.baseRamDamage = 18;
      this.chargeTimer = 0;
      this.chargeCooldown = 0;
    } else if (type === 'ibex') {
      this.name = 'Himalayan Ibex';
      this.baseMaxHp = 80;
      this.meatAmount = 90;
      this.xpReward = 85;
      this.maxFleeSpeed = 12.5;
      this.chargeSpeed = 0;
      this.baseRamDamage = 0;
    } else {
      this.name = 'Snow Hare';
      this.baseMaxHp = 32;
      this.meatAmount = 35;
      this.xpReward = 45;
      this.maxFleeSpeed = 12.5;
      this.chargeSpeed = 0;
      this.baseRamDamage = 0;
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
      if (this.isBoss) MODEL_CACHE[type] = this.buildYakModel();
      else if (type === 'ibex') MODEL_CACHE[type] = this.buildIbexModel();
      else MODEL_CACHE[type] = this.buildHareModel();
    }
    this.mesh = MODEL_CACHE[type].clone();
    this.headNode = this.mesh.getObjectByName('head');
    this.legMeshes = this.mesh.children.filter((c) => c.name === 'leg');
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
    if (this.isBoss) {
      sprite.scale.set(2.4, 2.4, 2.4);
      sprite.position.y = 4.6;
    } else if (this.type === 'ibex') {
      sprite.scale.set(1.6, 1.6, 1.6);
      sprite.position.y = 3.2;
    } else {
      sprite.scale.set(1.0, 1.0, 1.0);
      sprite.position.y = 1.4;
    }
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
        yak: { shag: 2.6, contrast: 0.4, seed: 3, normal: 0.9, rough: 0.95 }
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
      const hoof = new THREE.Mesh(new THREE.CylinderGeometry(cfg.hoofR * 0.95, cfg.hoofR * 1.1, cfg.hoofH, 10), hoofMat);
      hoof.position.set(0, -lowerLen - cfg.hoofH * 0.5, -cfg.kneeZ + cfg.hoofR * 0.15);
      hoof.castShadow = true;
      knee.add(hoof);
    }
    return leg;
  }

  addEye(parent, x, y, z, r, mat) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    eye.position.set(x, y, z);
    parent.add(eye);
  }

  // Himalayan ibex: stocky grey-brown winter coat, dark dorsal stripe and legs, pale belly and
  // rump, dark beard, long knobbed scimitar horns sweeping back over the shoulders.
  buildIbexModel() {
    const group = new THREE.Group();
    const mat = this.furMaterial('ibex');
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x5b5048, roughness: 0.55, metalness: 0.05 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.6 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.25 });

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
      this.addEye(headNode, side * 0.15, 0.66, 0.66, 0.035, eyeMat);
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
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.25 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xd9929a, roughness: 0.6 });
    const white = new THREE.Color(0xf4f5f7), greyBack = new THREE.Color(0xd7dce2), earTip = new THREE.Color(0x1d1d20), c = new THREE.Color();
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
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), noseMat);
    nose.position.set(0, 0.06, 0.38);
    headNode.add(nose);

    for (let side = -1; side <= 1; side += 2) {
      const ear = new THREE.Mesh(buildTube(smoothPath([
        { x: side * 0.05, y: 0.18, z: 0.02, rx: 0.045, ry: 0.035 },
        { x: side * 0.08, y: 0.42, z: -0.06, rx: 0.06, ry: 0.022 },
        { x: side * 0.11, y: 0.64, z: -0.14, rx: 0.045, ry: 0.018 },
        { x: side * 0.12, y: 0.72, z: -0.17, rx: 0.012, ry: 0.01 }
      ], 4), 10, (i, t) => (t > 0.82 ? earTip : white)), mat);
      ear.castShadow = true;
      headNode.add(ear);
      this.addEye(headNode, side * 0.1, 0.14, 0.2, 0.028, eyeMat);
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
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120f0d, roughness: 0.3 });
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
      this.addEye(headNode, side * 0.37, -0.05, 0.62, 0.05, eyeMat);
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

    this.animTime += delta * 6;
    const distToPlayer = this.position.distanceTo(player.position);

    // Flat direction to player
    const dirToPlayer = _toPlayer.subVectors(player.position, this.position).setY(0).normalize();

    // Facing vector of prey
    _forward.set(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
    const angleToPlayer = _forward.angleTo(dirToPlayer); // 0 = straight ahead, PI = directly behind

    const perceptionMult = this.perceptionMultiplier;
    const speedMult = this.speedMultiplier;
    const alertMult = this.alertRateMultiplier;

    // --- SENSE CALCULATIONS ---
    // Hearing: drastically reduced when player is STALKING
    let hearingDistance = 14 * perceptionMult;
    if (player.isSprinting) hearingDistance = 38 * perceptionMult;
    else if (player.isStalking) hearingDistance = 6.5 * perceptionMult; // Sneak reward!

    // Sight: prey sees forward cone (~120 deg) further than back
    let sightDistance = 42 * perceptionMult;
    const inSightCone = angleToPlayer < (Math.PI * 0.65);
    const canSee = inSightCone && distToPlayer < (player.isStalking ? sightDistance * 0.45 : sightDistance);
    const canHear = distToPlayer < hearingDistance;

    // Detect Player
    if (canSee || canHear || distToPlayer < 7) {
      // Stalking fills alert meter 70% slower!
      const alertRate = (player.isStalking ? 18 : (player.isSprinting ? 95 : 45)) * alertMult;
      this.alertMeter = Math.min(100, this.alertMeter + delta * alertRate);
    } else {
      // Calms down over time if out of range
      this.alertMeter = Math.max(0, this.alertMeter - delta * 15);
    }

    // State transitions based on alert meter
    if (this.alertMeter >= 85) {
      if (this.isBoss) {
        if (this.state !== 'CHARGING' && this.state !== 'FLEEING') {
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
        this.state = 'FLEEING';
        this.updateSprite('!', '#ef4444');
        sounds.playPreyAlert();

        // Alert nearby herd mates!
        allPrey.forEach((other) => {
          if (other !== this && !other.isDead && !other.isBoss && this.position.distanceTo(other.position) < 24) {
            other.alertMeter = 90;
            other.state = 'FLEEING';
            other.updateSprite('!', '#ef4444');
          }
        });
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
        this.facingAngle = lerpAngle(this.facingAngle, this.facingAngle + (Math.random() - 0.5) * 1.8, 1);
      }
      targetSpeed = 1.2 * speedMult;
      // Head down grazing
      this.headNode.rotation.x = 0.5 + Math.sin(this.animTime * 0.4) * 0.2;
    } else if (this.state === 'SUSPICIOUS') {
      // Freeze, look at predator
      targetSpeed = 0;
      const lookAngle = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.facingAngle = lerpAngle(this.facingAngle, lookAngle, delta * 3);
      this.headNode.rotation.x = -0.3; // Head held alert and high
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
        if (distToPlayer > 40) {
          this.state = 'GRAZING';
          this.updateSprite('👑', '#fbbf24');
        } else {
          // Restart charge cycle
          this.chargeTimer = 4.5;
          sounds.playBossGrunt();
        }
      }
    } else if (this.state === 'FLEEING') {
      // Bolt in opposite direction of predator, with erratic zigzags for hares
      targetSpeed = this.maxFleeSpeed * speedMult;

      const fleeDir = _fleeDir.subVectors(this.position, player.position).setY(0).normalize();

      if (this.type === 'hare') {
        this.zigzagTimer -= delta;
        if (this.zigzagTimer <= 0) {
          this.zigzagTimer = 0.4 + Math.random() * 0.4;
          this.zigzagDir *= -1;
        }
        // Perpendicular evasive dodge
        const px = -fleeDir.z * this.zigzagDir * 0.6;
        const pz = fleeDir.x * this.zigzagDir * 0.6;
        fleeDir.set(fleeDir.x + px, 0, fleeDir.z + pz).normalize();
      }

      const targetAngle = Math.atan2(fleeDir.x, fleeDir.z);
      this.facingAngle = lerpAngle(this.facingAngle, targetAngle, delta * 8);

      this.headNode.rotation.x = 0.1;

      // If fled far enough, calm down
      if (distToPlayer > 55) {
        this.alertMeter = Math.max(0, this.alertMeter - delta * 20);
      }
    }

    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, delta * 6);

    // Apply movement
    if (this.speed > 0.1) {
      this.position.x += Math.sin(this.facingAngle) * this.speed * delta;
      this.position.z += Math.cos(this.facingAngle) * this.speed * delta;

      // Dynamic hoof/paw prints on snow when running or charging
      if (this.speed > 2.8) {
        this.stepTimer = (this.stepTimer || 0) + delta;
        if (this.stepTimer > 0.18) {
          this.stepTimer = 0;
          this.terrain.addPawPrint(
            this.position.x,
            this.position.z,
            this.facingAngle,
            this.isBoss ? 1.6 : (this.type === 'ibex' ? 0.95 : 0.6)
          );
        }
      }
    }

    // Keep within world bounds
    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    // Solid collision against rocks and tree trunks
    this.terrain.resolveCollision(this.position, this.isBoss ? 1.4 : (this.type === 'ibex' ? 0.75 : 0.4));

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

    // Terrain ground clamp
    const groundY = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    this.position.y = groundY;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;

    // Leg animation: stride rate follows actual ground speed and leg length, so a lumbering yak
    // takes slow heavy steps while a hare's legs blur
    if (this.speed > 0.2) {
      const strideLen = this.isBoss ? 2.6 : (this.type === 'ibex' ? 1.5 : 0.9);
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
    } else {
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
