import * as THREE from 'three';
import { ACCESSORIES, RARITIES, rollRarity } from './accessories.js';
import { sounds } from './audio.js';

// ---------------------------------------------------------------------------
// Hidden treasure
//
// A few accessories are always buried in the snow at the foot of boulders and
// fir trees. Each one shows as a small mound with a gem corner poking out and
// a faint glimmer that twinkles every few seconds. Each rarity glimmers in its
// own colour, and rarer finds can be spotted from further away.
//
// Scent Vision reveals them: as its sonar ring sweeps over a treasure, a beam
// of light in the rarity colour rises from it until the scent wears off.
// ---------------------------------------------------------------------------
const ACTIVE_COUNT = 6; // treasures buried in the world at once
const RESPAWN_DELAY = 45; // seconds before a dug-up treasure is replaced elsewhere
const MIN_SPAWN_DIST = 25; // never bury a new treasure right in front of the player
const MIN_SPACING = 18; // between treasures
export const DIG_RANGE = 3.6; // from the leopard's centre (the model is ~3 m long)
const NEAR_CHIME_RANGE = 12;
const GLIMMER_FADE = 12; // metres over which the glimmer fades out past its range
export const SCENT_RANGE = 90; // Scent Vision reveals treasure this close
const BEAM_HEIGHT = 16; // tall enough to show over the fir canopy

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

// Picks the accessory a treasure of `rarity` gives: something not yet owned, of that
// rarity if possible, otherwise the nearest tier. Null when everything is collected.
export function pickReward(rarity, owned) {
  const idx = RARITY_ORDER.indexOf(rarity);
  const tiers = [...RARITY_ORDER].sort((a, b) => {
    const da = Math.abs(RARITY_ORDER.indexOf(a) - idx), db = Math.abs(RARITY_ORDER.indexOf(b) - idx);
    // Same distance: prefer the lower (more common) tier
    return da - db || RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b);
  });
  for (const tier of tiers) {
    const choices = ACCESSORIES.filter((a) => a.rarity === tier && !owned.has(a.id));
    if (choices.length) return choices[Math.floor(Math.random() * choices.length)];
  }
  return null;
}

// Vertical fade for the Scent Vision beam: bright at the snow, fading out upward
function makeBeamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeSparkleTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.15, 'rgba(255,255,255,1)');
  glow.addColorStop(0.4, 'rgba(255,255,255,0.3)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Star rays: four long ones plus four short diagonals
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (let i = 0; i < 4; i++) {
    const len = i < 2 ? c : c * 0.55;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((i % 2) * (Math.PI / 2) + (i >= 2 ? Math.PI / 4 : 0));
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.quadraticCurveTo(12, 0, 0, len);
    ctx.quadraticCurveTo(-12, 0, 0, -len);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TreasureManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.spots = terrain.obstacles.filter((o) => o.kind === 'rock' || o.kind === 'tree');
    this.treasures = [];
    this.respawnTimers = [];
    this.started = false;

    this.sparkleTex = makeSparkleTexture();
    this.moundGeo = new THREE.SphereGeometry(0.6, 14, 8);
    this.moundMat = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 0.9 });
    this.gemGeo = new THREE.OctahedronGeometry(0.16);
    this.gemMats = {};
    for (const [key, r] of Object.entries(RARITIES)) {
      this.gemMats[key] = new THREE.MeshStandardMaterial({ color: r.hex, emissive: r.hex, emissiveIntensity: 0.55, roughness: 0.1, metalness: 0.2, flatShading: true });
    }
    this.beamTex = makeBeamTexture();
    this.beamGeo = new THREE.CylinderGeometry(0.45, 0.8, BEAM_HEIGHT, 12, 1, true);
    this.beamGeo.translate(0, BEAM_HEIGHT / 2, 0);
    this._normal = new THREE.Vector3();

    // Nearest treasure revealed by the current Scent Vision pulse: { treasure, distance } or null
    this.nearestRevealed = null;
  }

  // Finds a free spot at the foot of a random rock or tree
  findSpot(playerPos) {
    const limit = this.terrain.halfSize - 40;
    for (let attempt = 0; attempt < 60; attempt++) {
      const o = this.spots[Math.floor(Math.random() * this.spots.length)];
      const angle = Math.random() * Math.PI * 2;
      const offset = o.radius + (o.kind === 'rock' ? 0.35 : 0.75);
      const x = o.x + Math.cos(angle) * offset;
      const z = o.z + Math.sin(angle) * offset;

      if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
      if (Math.hypot(x - playerPos.x, z - playerPos.z) < MIN_SPAWN_DIST) continue;
      if (this.treasures.some((t) => Math.hypot(t.position.x - x, t.position.z - z) < MIN_SPACING)) continue;
      if (this.terrain.obstacles.some((q) => q !== o && Math.hypot(q.x - x, q.z - z) < q.radius + 0.3)) continue;
      if (this.terrain.getTerrainNormal(x, z, this._normal).y < 0.75) continue;
      return { x, z, kind: o.kind };
    }
    return null;
  }

  spawn(playerPos) {
    const spot = this.findSpot(playerPos);
    if (!spot) return false;
    const rarity = rollRarity();
    const r = RARITIES[rarity];
    const y = this.terrain.getTerrainHeight(spot.x, spot.z);

    const group = new THREE.Group();
    group.position.set(spot.x, y, spot.z);

    const mound = new THREE.Mesh(this.moundGeo, this.moundMat);
    mound.scale.set(1, 0.32, 1);
    mound.position.y = -0.05;
    mound.receiveShadow = true;
    group.add(mound);

    // Corner of the buried item poking out of the snow
    const gem = new THREE.Mesh(this.gemGeo, this.gemMats[rarity]);
    gem.position.set(0.12, 0.12, 0.05);
    gem.rotation.set(0.6, 0, 0.4);
    group.add(gem);

    const sparkle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.sparkleTex,
      color: r.glimmer,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false // keep the colour vivid against bright snow
    }));
    sparkle.position.set(0.12, 0.4, 0.05);
    group.add(sparkle);

    // Scent Vision beam (hidden until revealed)
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({
      map: this.beamTex,
      color: r.glimmer,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    }));
    beam.visible = false;
    group.add(beam);

    this.scene.add(group);
    this.treasures.push({
      position: group.position,
      group,
      gem,
      sparkle,
      beam,
      revealed: false,
      rarity,
      glimmerRange: r.glimmerRange,
      sparkleSize: rarity === 'legendary' ? 1.9 : rarity === 'epic' ? 1.5 : 1.2,
      twinklePeriod: 2.2 + Math.random() * 1.6,
      twinkleClock: Math.random() * 3,
      chimed: false,
      digging: false
    });
    return true;
  }

  // Removes a dug-up treasure and schedules a replacement somewhere else
  collect(treasure) {
    const i = this.treasures.indexOf(treasure);
    if (i < 0) return;
    this.treasures.splice(i, 1);
    treasure.group.removeFromParent();
    treasure.sparkle.material.dispose();
    treasure.beam.material.dispose();
    this.respawnTimers.push(RESPAWN_DELAY);
  }

  // Animates every treasure and returns the nearest one within digging range (or null).
  // `scent` is the Scent Vision state: { active, radius } (radius = how far its sonar ring has spread).
  update(delta, playerPos, scent = { active: false, radius: 0 }) {
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < ACTIVE_COUNT; i++) this.spawn(playerPos);
    }

    for (let i = this.respawnTimers.length - 1; i >= 0; i--) {
      this.respawnTimers[i] -= delta;
      if (this.respawnTimers[i] <= 0 && this.spawn(playerPos)) this.respawnTimers.splice(i, 1);
    }

    let nearest = null;
    let nearestDist = DIG_RANGE;
    let revealedNewly = false;
    this.nearestRevealed = null;
    for (const t of this.treasures) {
      const d = Math.hypot(t.position.x - playerPos.x, t.position.z - playerPos.z);

      // Scent Vision: revealed once the sonar ring reaches it, hidden again when the scent ends
      if (!scent.active) t.revealed = false;
      else if (!t.revealed && d < SCENT_RANGE && scent.radius >= d) {
        t.revealed = true;
        revealedNewly = true;
      }
      const beamTarget = t.revealed ? 0.75 : 0;
      const beamOpacity = THREE.MathUtils.lerp(t.beam.material.opacity, beamTarget, Math.min(1, delta * 4));
      t.beam.material.opacity = beamOpacity < 0.01 ? 0 : beamOpacity;
      t.beam.visible = t.beam.material.opacity > 0;
      if (t.revealed && (!this.nearestRevealed || d < this.nearestRevealed.distance)) {
        this.nearestRevealed = { treasure: t, distance: d };
      }

      // Twinkle: a faint constant glow plus a brief flare every few seconds (steady while revealed)
      t.twinkleClock += delta;
      const phase = (t.twinkleClock % t.twinklePeriod) / 0.7;
      const flare = t.revealed ? 0.85 + 0.15 * Math.sin(t.twinkleClock * 6) : phase < 1 ? Math.sin(phase * Math.PI) : 0;
      const fade = t.revealed ? 1 : THREE.MathUtils.clamp(1 - (d - t.glimmerRange) / GLIMMER_FADE, 0, 1);
      t.sparkle.material.opacity = (0.18 + 0.82 * flare) * fade;
      t.sparkle.material.rotation += delta * 0.6;
      t.sparkle.scale.setScalar(t.sparkleSize * (0.45 + 0.9 * flare));
      t.gem.rotation.y += delta * 0.8;

      if (!t.chimed && d < NEAR_CHIME_RANGE) {
        t.chimed = true;
        sounds.playTreasureNear();
      }
      if (!t.digging && d < nearestDist) {
        nearest = t;
        nearestDist = d;
      }
    }
    if (revealedNewly) sounds.playTreasureNear();
    return nearest;
  }
}
