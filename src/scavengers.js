import * as THREE from 'three';
import { sounds } from './audio.js';
import { buildScavengerModel } from './wildlife.js';

// ---------------------------------------------------------------------------
// Scavengers: a kill left out in the open draws bearded vultures (lammergeiers)
// and ravens. They circle, land and eat it down. Walking back scatters them.
// Dragging a kill into cover by a rock or tree (caching) hides it from them.
// ---------------------------------------------------------------------------
const NOTICE_AFTER = 18; // seconds a kill lies in the open before birds arrive
const EAT_RATE = 0.9; // kg per second per bird
const SCARE_DIST = 10;

export class Scavengers {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.birds = [];
    for (let i = 0; i < 5; i++) {
      const big = i < 2;
      const mesh = buildScavengerModel(big);
      mesh.visible = false;
      scene.add(mesh);
      this.birds.push({ mesh, big, wings: mesh.children.filter((c) => c.name === 'wing'), state: 'AWAY', carcass: null, t: Math.random() * 10, pos: new THREE.Vector3(), timer: 0 });
    }
    this.onFirstVisit = null; // () => void, for a one-time hint
  }

  update(delta, preyList, playerPos) {
    // which carcasses are fair game
    const open = preyList.filter((p) => p.isDead && p.meatAmount > 0 && !p.cached && !p.dragged && p.deadTimer > NOTICE_AFTER);
    for (const bird of this.birds) {
      bird.t += delta;
      const c = bird.carcass;
      if (c && (!c.isDead || c.meatAmount <= 0 || c.cached || c.dragged || !preyList.includes(c))) this.leave(bird);
      if (bird.state === 'AWAY') {
        // pick a carcass that has fewer than two birds
        const target = open.find((p) => this.birds.filter((b) => b.carcass === p).length < 2);
        if (target && Math.random() < delta * 0.5) this.arrive(bird, target);
        continue;
      }
      this.fly(bird, delta, playerPos);
    }
  }

  arrive(bird, carcass) {
    bird.carcass = carcass;
    bird.state = 'CIRCLE';
    bird.timer = 6 + Math.random() * 4;
    const a = Math.random() * Math.PI * 2;
    bird.pos.set(carcass.position.x + Math.cos(a) * 60, carcass.position.y + 30, carcass.position.z + Math.sin(a) * 60);
    bird.mesh.visible = true;
    if (this.onFirstVisit) {
      this.onFirstVisit();
      this.onFirstVisit = null;
    }
  }

  leave(bird) {
    bird.state = 'LEAVING';
    bird.carcass = null;
    bird.timer = 5;
  }

  fly(bird, delta, playerPos) {
    const c = bird.carcass;
    const m = bird.mesh;
    let flap = true;
    const center = c ? c.position : bird.pos;
    const playerNear = c && Math.hypot(playerPos.x - c.position.x, playerPos.z - c.position.z) < SCARE_DIST;

    if (bird.state === 'LEAVING') {
      bird.timer -= delta;
      bird.pos.y += delta * 6;
      bird.pos.x += Math.sin(bird.t) * delta * 14;
      if (bird.timer <= 0) {
        bird.state = 'AWAY';
        m.visible = false;
      }
    } else if (bird.state === 'CIRCLE' || (bird.state !== 'CIRCLE' && playerNear)) {
      if (bird.state !== 'CIRCLE') {
        bird.state = 'CIRCLE';
        bird.timer = 8;
        sounds.playBirdCall();
      }
      const r = bird.big ? 12 : 8;
      const speed = bird.big ? 0.45 : 0.7;
      const target = new THREE.Vector3(center.x + Math.cos(bird.t * speed) * r, center.y + (bird.big ? 16 : 11), center.z + Math.sin(bird.t * speed) * r);
      bird.pos.lerp(target, Math.min(1, delta * 1.2));
      flap = bird.big ? Math.sin(bird.t * 0.7) > 0.6 : true; // vultures mostly glide
      if (!playerNear) bird.timer -= delta;
      if (bird.timer <= 0) bird.state = 'LANDING';
    } else if (bird.state === 'LANDING') {
      const a = (this.birds.indexOf(bird) / this.birds.length) * Math.PI * 2;
      const target = new THREE.Vector3(center.x + Math.cos(a) * 1.6, this.terrain.getSurfaceHeight(center.x + Math.cos(a) * 1.6, center.z + Math.sin(a) * 1.6) + 0.15, center.z + Math.sin(a) * 1.6);
      bird.pos.lerp(target, Math.min(1, delta * 1.5));
      if (bird.pos.distanceTo(target) < 0.3) {
        bird.state = 'FEEDING';
        sounds.playBirdCall();
      }
    } else if (bird.state === 'FEEDING') {
      flap = false;
      c.meatAmount = Math.max(0, c.meatAmount - EAT_RATE * delta);
      m.rotation.x = Math.sin(bird.t * 6) > 0.3 ? 0.5 : 0.1; // pecking
    }

    const prev = m.position.clone();
    m.position.copy(bird.pos);
    if (bird.state !== 'FEEDING') {
      const dx = bird.pos.x - prev.x, dz = bird.pos.z - prev.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) m.rotation.y = Math.atan2(dx, dz);
      m.rotation.x = 0;
    }
    for (const w of bird.wings) w.rotation.z = flap ? Math.sin(bird.t * (bird.big ? 6 : 14)) * 0.7 * w.userData.side : 0.05 * w.userData.side;
  }

  // Number of birds currently eating a given carcass
  feedingOn(carcass) {
    return this.birds.filter((b) => b.carcass === carcass && b.state === 'FEEDING').length;
  }
}
