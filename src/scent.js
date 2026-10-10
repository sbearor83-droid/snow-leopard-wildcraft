import * as THREE from 'three';
import { sounds } from './audio.js';

// Scent trail colour per prey type (RGB 0-1)
const TRAIL_COLORS = {
  ibex: [0.96, 0.62, 0.07], // amber
  hare: [0.02, 0.71, 0.83], // cyan
  yak: [0.94, 0.27, 0.27] // red: dangerous boss
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

    // Pre-allocated static buffer for scent trails (Zero Garbage Collection / Zero GPU reallocations)
    this.maxTrails = 12;
    this.stepsPerTrail = 8;
    const totalSegments = this.maxTrails * (this.stepsPerTrail - 1);
    const totalVertices = totalSegments * 2;

    this.trailPositions = new Float32Array(totalVertices * 3);
    this.trailColors = new Float32Array(totalVertices * 3);

    // Initialize all off-screen
    for (let i = 0; i < totalVertices; i++) {
      this.trailPositions[i * 3 + 1] = -500;
    }

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));

    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });

    this.trailMesh = new THREE.LineSegments(trailGeo, trailMat);
    this.trailMesh.visible = false;
    this.scene.add(this.trailMesh);

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

    // Reset trail buffer offscreen
    for (let i = 0; i < this.trailPositions.length / 3; i++) {
      this.trailPositions[i * 3 + 1] = -500;
    }
    this.trailMesh.geometry.attributes.position.needsUpdate = true;

    if (this.scentOverlay) {
      this.scentOverlay.classList.remove('active');
    }
  }

  update(delta, playerPos, preyList) {
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

    // Update in-place buffer positions without allocating any new objects
    const posAttr = this.trailMesh.geometry.attributes.position;
    const colAttr = this.trailMesh.geometry.attributes.color;
    let vertIdx = 0;
    let preyIdx = 0;
    const nowTime = performance.now() * 0.003;

    for (let t = 0; t < this.maxTrails; t++) {
      // Advance to the next living prey within scent range
      let p = null;
      while (preyIdx < preyList.length) {
        const candidate = preyList[preyIdx++];
        if (!candidate.isDead && candidate.position.distanceTo(playerPos) < 120) {
          p = candidate;
          break;
        }
      }

      if (p) {
        const dist = playerPos.distanceTo(p.position);
        const [cr, cg, cb] = TRAIL_COLORS[p.type];

        let prevX = playerPos.x;
        let prevY = playerPos.y + 0.8;
        let prevZ = playerPos.z;

        for (let s = 1; s < this.stepsPerTrail; s++) {
          const frac = s / (this.stepsPerTrail - 1);
          const curX = playerPos.x + (p.position.x - playerPos.x) * frac + Math.sin(frac * Math.PI + nowTime) * (dist * 0.06);
          const curY = playerPos.y + (p.position.y - playerPos.y) * frac + Math.sin(frac * Math.PI) * 2.2 + 0.5;
          const curZ = playerPos.z + (p.position.z - playerPos.z) * frac;

          // Segment start
          this.trailPositions[vertIdx * 3] = prevX;
          this.trailPositions[vertIdx * 3 + 1] = prevY;
          this.trailPositions[vertIdx * 3 + 2] = prevZ;
          this.trailColors[vertIdx * 3] = cr;
          this.trailColors[vertIdx * 3 + 1] = cg;
          this.trailColors[vertIdx * 3 + 2] = cb;
          vertIdx++;

          // Segment end
          this.trailPositions[vertIdx * 3] = curX;
          this.trailPositions[vertIdx * 3 + 1] = curY;
          this.trailPositions[vertIdx * 3 + 2] = curZ;
          this.trailColors[vertIdx * 3] = cr;
          this.trailColors[vertIdx * 3 + 1] = cg;
          this.trailColors[vertIdx * 3 + 2] = cb;
          vertIdx++;

          prevX = curX;
          prevY = curY;
          prevZ = curZ;
        }
      } else {
        // Hide unused segments
        for (let s = 0; s < (this.stepsPerTrail - 1) * 2; s++) {
          this.trailPositions[vertIdx * 3 + 1] = -500;
          vertIdx++;
        }
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }
}
