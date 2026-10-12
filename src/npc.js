import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { shortestAngleDiff } from './utils.js';

// ---------------------------------------------------------------------------
// Other snow leopards (rival, mate, cubs). Each is a skinned copy of the
// player's model with its own animation mixer, but without fur shells or
// whiskers so a few of them stay cheap on a phone. `tint` shades the coat.
// ---------------------------------------------------------------------------
const MODEL_SCALE = 3.0; // same as the player
const STRIDE = { Walk: 0.926, Run: 2.55, ProwlWalk: 1.82 };
const PAW_FRONT_Z = 0.72;
const PAW_BACK_Z = -0.56;
const PAW_HALF_WIDTH = 0.25;

export class LeopardNPC {
  // player: the SnowLeopard (provides the model template and clips once loaded)
  constructor(scene, terrain, player, { size = 1, tint = 0xffffff, x = 0, z = 0 } = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.size = size;
    this.position = new THREE.Vector3(x, terrain.getSurfaceHeight(x, z), z);
    this.facingAngle = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.targetSpeed = 0;
    this.targetFacing = this.facingAngle;
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = 'YXZ';
    this.root = new THREE.Group();
    this.root.scale.setScalar(MODEL_SCALE * size);
    this.mesh.add(this.root);
    scene.add(this.mesh);
    this.actions = {};
    this.current = '';
    this.oneShot = 0; // seconds left of a one-off clip (swipe, chuff, lie down)
    this.build(player, tint);
  }

  build(player, tint) {
    if (!player.npcTemplate) {
      // Model still loading: try again shortly
      this.retry = setTimeout(() => this.build(player, tint), 300);
      return;
    }
    const model = cloneSkinned(player.npcTemplate);
    model.traverse((o) => {
      if (!o.isSkinnedMesh && !o.isMesh) return;
      o.material = o.material.clone();
      o.material.color = new THREE.Color(tint);
      o.castShadow = this.size > 0.6;
      o.frustumCulled = false;
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of player.animationClips) this.actions[clip.name] = this.mixer.clipAction(clip);
    for (const name of ['Attack_Left', 'Attack_Right', 'Bite', 'Pounce', 'Hit_Left']) {
      if (!this.actions[name]) continue;
      this.actions[name].setLoop(THREE.LoopOnce, 1);
      this.actions[name].clampWhenFinished = true;
    }
    this.play('Idle_Look', 0);
  }

  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || this.current === name) return;
    const prev = this.actions[this.current];
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.fadeIn(fade);
    next.play();
    if (prev) prev.fadeOut(fade);
    this.current = name;
  }

  // Plays a one-off clip (e.g. 'Attack_Left') for `seconds`, then returns to locomotion
  playOnce(name, seconds) {
    const a = this.actions[name];
    if (!a) return;
    this.current = '';
    a.timeScale = a.getClip().duration / seconds;
    this.play(name, 0.08);
    this.oneShot = seconds;
  }

  // Turn toward / walk to a point at `speed` m/s; returns the remaining distance
  goTo(x, z, speed) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const d = Math.hypot(dx, dz);
    this.targetFacing = Math.atan2(dx, dz);
    this.targetSpeed = d > 0.6 ? speed : 0;
    return d;
  }

  update(delta, prowl = false) {
    const turn = shortestAngleDiff(this.facingAngle, this.targetFacing);
    this.facingAngle = shortestAngleDiff(0, this.facingAngle + turn * Math.min(1, delta * 6));
    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, Math.min(1, delta * 5));
    this.position.x += Math.sin(this.facingAngle) * this.speed * delta;
    this.position.z += Math.cos(this.facingAngle) * this.speed * delta;
    this.terrain.resolveCollision(this.position, 0.9 * this.size);
    const bound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -bound, bound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -bound, bound);

    // plant the paws (same method as the player, scaled to this leopard's size)
    const s = this.size;
    const sin = Math.sin(this.facingAngle), cos = Math.cos(this.facingAngle);
    const at = (lx, lz) => this.terrain.getSurfaceHeight(this.position.x + (lx * cos + lz * sin) * s, this.position.z + (lz * cos - lx * sin) * s);
    const fl = at(PAW_HALF_WIDTH, PAW_FRONT_Z), fr = at(-PAW_HALF_WIDTH, PAW_FRONT_Z);
    const bl = at(PAW_HALF_WIDTH, PAW_BACK_Z), br = at(-PAW_HALF_WIDTH, PAW_BACK_Z);
    const front = (fl + fr) / 2, back = (bl + br) / 2, span = (PAW_FRONT_Z - PAW_BACK_Z) * s;
    this.position.y = back + (front - back) * (-PAW_BACK_Z / (PAW_FRONT_Z - PAW_BACK_Z));
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, THREE.MathUtils.clamp(Math.atan2(back - front, span), -0.7, 0.7), Math.min(1, delta * 10));
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, THREE.MathUtils.clamp(Math.atan2((fl + bl) - (fr + br), 4 * PAW_HALF_WIDTH * s), -0.7, 0.7), Math.min(1, delta * 10));

    if (!this.mixer) return;
    this.mixer.update(delta);
    if (this.oneShot > 0) {
      this.oneShot -= delta;
      return;
    }
    if (this.speed > 0.4) {
      const name = this.speed > 7 ? 'Run' : prowl ? 'ProwlWalk' : 'Walk';
      this.play(name, 0.2);
      const a = this.actions[name];
      if (a) a.timeScale = THREE.MathUtils.clamp(this.speed / (STRIDE[name] * MODEL_SCALE * s), 0.35, 2.4);
    } else {
      this.play(prowl ? 'ProwlIdle' : 'Idle_Look', 0.3);
    }
  }

  // Small floating marker (⚔️, ❤️, 🍼 ...) above the head
  setMarker(text, color = '#1e293b') {
    if (!this.marker) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      this.markerCanvas = canvas;
      this.markerTex = new THREE.CanvasTexture(canvas);
      this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex, depthTest: false, transparent: true }));
      this.marker.scale.setScalar(1.3);
      this.marker.position.y = 2.6 * this.size + 0.6;
      this.mesh.add(this.marker);
    }
    if (this.markerText === text) return;
    this.markerText = text;
    const ctx = this.markerCanvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    this.marker.visible = Boolean(text);
    if (!text) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 32, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 35);
    this.markerTex.needsUpdate = true;
  }

  setSize(size) {
    this.size = size;
    this.root.scale.setScalar(MODEL_SCALE * size);
    if (this.marker) this.marker.position.y = 2.6 * size + 0.6;
  }

  destroy() {
    clearTimeout(this.retry);
    this.scene.remove(this.mesh);
    if (this.mixer) this.mixer.stopAllAction();
  }
}
