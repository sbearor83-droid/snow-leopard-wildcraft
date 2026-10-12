import * as THREE from 'three';
import { sounds } from './audio.js';
import { env } from './world.js';

const _seg = new THREE.Vector3();
const _view = new THREE.Vector3();
const _side = new THREE.Vector3();

// One ribbon corner: `pt` pushed sideways by half of `w` (negative = other edge), with RGBA colour
function writeCorner(pos, col, i, pt, w, r, g, b, a) {
  pos[i * 3] = pt.x + _side.x * w * 0.5;
  pos[i * 3 + 1] = pt.y + _side.y * w * 0.5;
  pos[i * 3 + 2] = pt.z + _side.z * w * 0.5;
  col[i * 4] = r;
  col[i * 4 + 1] = g;
  col[i * 4 + 2] = b;
  col[i * 4 + 3] = a;
}

// Scent trail colour per prey type (RGB 0-1)
const TRAIL_COLORS = {
  ibex: [1.0, 0.55, 0.0], // orange
  bharal: [0.2, 0.45, 1.0], // blue
  hare: [0.0, 0.85, 0.95], // cyan
  marmot: [1.0, 0.85, 0.0], // yellow
  pika: [1.0, 0.3, 0.8], // pink
  snowcock: [0.35, 0.9, 0.2], // green
  goat: [0.6, 0.38, 0.18], // brown: herders' livestock
  yak: [1.0, 0.12, 0.12], // red = danger
  wolf: [1.0, 0.12, 0.12],
  dog: [1.0, 0.12, 0.12]
};

// Optimized Zero-Allocation Wildcraft Scent Vision & Hunting Radar System
export class ScentVision {
  constructor(scene) {
    this.scene = scene;
    this.isActive = false;
    this.timer = 0;
    this.maxDuration = 10.0;
    this.sonarRadius = 0;

    // Glowing Sonar Ring expanding across snow (low polygon count for mobile)
    const ringGeo = new THREE.RingGeometry(0.9, 1.2, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.sonarMesh = new THREE.Mesh(ringGeo, ringMat);
    this.sonarMesh.position.y = 0.3;
    this.scene.add(this.sonarMesh);

    // Scent trails are ribbons that always face the camera. A ribbon gets wider and brighter the
    // closer its animal is, so the strongest scent stands out. Buffers are allocated once.
    this.maxTrails = 12;
    this.stepsPerTrail = 10;
    const quads = this.maxTrails * (this.stepsPerTrail - 1);
    this.trailPositions = new Float32Array(quads * 4 * 3);
    this.trailColors = new Float32Array(quads * 4 * 4);
    const index = new Uint16Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    }
    for (let i = 0; i < quads * 4; i++) this.trailPositions[i * 3 + 1] = -500;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 4));
    trailGeo.setIndex(new THREE.BufferAttribute(index, 1));
    const trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false // keep the colours true; filmic tone mapping washes them out on snow
    });
    this.trailMesh = new THREE.Mesh(trailGeo, trailMat);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 5;
    this.trailMesh.visible = false;
    this.scene.add(this.trailMesh);
    this.nearby = []; // reused list of { prey, dist }
    this.points = Array.from({ length: this.stepsPerTrail }, () => new THREE.Vector3());

    this.scentOverlay = document.getElementById('scent-overlay');
  }

  toggle(playerPos) {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate(playerPos);
    }
    return this.isActive;
  }

  activate(playerPos) {
    this.isActive = true;
    this.timer = this.maxDuration;
    this.sonarRadius = 0.5;
    this.sonarMesh.position.set(playerPos.x, playerPos.y + 0.3, playerPos.z);
    this.sonarMesh.scale.set(1, 1, 1);
    this.sonarMesh.material.opacity = 0.85;
    this.trailMesh.visible = true;

    sounds.playScentSonar();

    if (this.scentOverlay) {
      this.scentOverlay.classList.add('active');
    }
  }

  deactivate() {
    this.isActive = false;
    this.timer = 0;
    this.sonarMesh.material.opacity = 0;
    this.trailMesh.visible = false;

    if (this.scentOverlay) {
      this.scentOverlay.classList.remove('active');
    }
  }

  // cameraPos: ribbons are turned to face it
  update(delta, playerPos, preyList, cameraPos) {
    if (!this.isActive) return;

    this.timer -= delta;
    if (this.timer <= 0) {
      this.deactivate();
      return;
    }

    // Expand Sonar Pulse across landscape
    this.sonarRadius += delta * 45;
    this.sonarMesh.scale.set(this.sonarRadius, this.sonarRadius, this.sonarRadius);
    this.sonarMesh.position.x = playerPos.x;
    this.sonarMesh.position.z = playerPos.z;
    this.sonarMesh.material.opacity = Math.max(0, 0.85 * (1 - this.sonarRadius / 110));

    // The nearest animals within scent range, closest first
    const nearby = this.nearby;
    nearby.length = 0;
    for (const p of preyList) {
      if (p.isDead || p.hidden) continue;
      const dist = p.position.distanceTo(playerPos);
      if (dist < env.scentRange) nearby.push({ prey: p, dist });
    }
    nearby.sort((a, b) => a.dist - b.dist);

    const pos = this.trailPositions;
    const col = this.trailColors;
    const pts = this.points;
    const n = this.stepsPerTrail;
    const wave = performance.now() * 0.003;
    // fade the whole effect out over the last second
    const fade = Math.min(1, this.timer);
    let q = 0;

    for (let t = 0; t < this.maxTrails; t++) {
      const entry = nearby[t];
      if (!entry) {
        // park unused ribbons out of sight
        for (let k = 0; k < (n - 1) * 4; k++) pos[(q * 4 + k) * 3 + 1] = -500;
        q += n - 1;
        continue;
      }
      const p = entry.prey;
      const dist = entry.dist;
      const [cr, cg, cb] = TRAIL_COLORS[p.type] || [1, 1, 1];
      // 0 = far edge of scent range, 1 = right on top of it
      const close = 1 - THREE.MathUtils.clamp((dist - 4) / (env.scentRange - 4), 0, 1);
      const width = 0.12 + close * close * 0.85;
      const alpha = (0.55 + close * 0.4) * fade;

      // gently arcing path from the leopard's nose to the animal
      for (let k = 0; k < n; k++) {
        const f = k / (n - 1);
        pts[k].set(
          playerPos.x + (p.position.x - playerPos.x) * f + Math.sin(f * Math.PI + wave) * (dist * 0.05),
          playerPos.y + (p.position.y - playerPos.y) * f + Math.sin(f * Math.PI) * 2.2 + 0.6,
          playerPos.z + (p.position.z - playerPos.z) * f
        );
      }
      for (let k = 0; k < n - 1; k++, q++) {
        const a = pts[k];
        const b = pts[k + 1];
        // side vector: perpendicular to the segment and to the view direction
        _seg.subVectors(b, a);
        _view.subVectors(cameraPos, a);
        _side.crossVectors(_seg, _view).normalize();
        // taper: thin at the leopard, full width toward the animal
        const wa = width * (0.35 + 0.65 * (k / (n - 1)));
        const wb = width * (0.35 + 0.65 * ((k + 1) / (n - 1)));
        const base = q * 4;
        // the first segment fades out near the leopard so it doesn't block the view
        const nearAlpha = k === 0 ? alpha * 0.15 : alpha;
        writeCorner(pos, col, base, a, -wa, cr, cg, cb, nearAlpha);
        writeCorner(pos, col, base + 1, a, wa, cr, cg, cb, nearAlpha);
        writeCorner(pos, col, base + 2, b, -wb, cr, cg, cb, alpha);
        writeCorner(pos, col, base + 3, b, wb, cr, cg, cb, alpha);
      }
    }

    this.trailMesh.geometry.attributes.position.needsUpdate = true;
    this.trailMesh.geometry.attributes.color.needsUpdate = true;
  }
}
