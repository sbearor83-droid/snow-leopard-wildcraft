import * as THREE from 'three';
import { sounds } from './audio.js';
import { LeopardNPC } from './npc.js';

// ---------------------------------------------------------------------------
// Territory: snow leopards scrape the ground and scent-mark prominent boulders
// to claim their range. Each marked boulder stays fresh for MARK_DAYS in-game
// days; every dawn the territory pays MARK_INCOME Pelts per fresh mark.
// Once the territory is big enough, rival leopards come to mark over it. Drive
// them off (they flee when badly hurt) or they steal a mark.
// ---------------------------------------------------------------------------
export const MARK_DAYS = 4;
export const MARK_INCOME = 3;
const MAX_MARKS = 15;
const RIVAL_MIN_TERRITORY = 3;

export class Territory {
  constructor(game) {
    this.game = game;
    this.terrain = game.terrain;
    this.marks = new Map(); // obstacle index -> { day, decal }
    this.rival = null;
    this.rivalCooldown = 240; // seconds before the first rival can appear
    const tex = this.makeScrapeTexture();
    this.scrapeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.scrapeGeo = new THREE.PlaneGeometry(1.4, 2.0).rotateX(-Math.PI / 2);
    this.glowGeo = new THREE.CylinderGeometry(0.35, 0.35, 14, 10, 1, true).translate(0, 7, 0);
  }

  makeScrapeTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(92, 70, 52, 0.75)');
    g.addColorStop(0.6, 'rgba(120, 98, 78, 0.45)');
    g.addColorStop(1, 'rgba(140, 120, 100, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(70, 52, 38, 0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(22 + i * 6, 14);
      ctx.lineTo(20 + i * 7, 50);
      ctx.stroke();
    }
    return new THREE.CanvasTexture(c);
  }

  get day() {
    return this.game.world.day;
  }

  freshCount() {
    let n = 0;
    for (const m of this.marks.values()) if (this.day - m.day < MARK_DAYS) n++;
    return n;
  }

  // Boulder within reach that can be (re)marked now, or null
  markableRock(pos) {
    const { obstacle, index, gap } = this.terrain.nearestObstacle(pos, 'rock');
    if (!obstacle || gap > 2.4 || obstacle.radius < 1.4) return null;
    const m = this.marks.get(index);
    if (m && this.day - m.day < 2) return null; // still fresh
    return { obstacle, index };
  }

  mark(index, quiet = false) {
    const o = this.terrain.obstacles[index];
    const old = this.marks.get(index);
    if (old) this.removeVisual(old);
    const entry = { day: this.day };
    this.addVisual(entry, o);
    this.marks.set(index, entry);
    // keep the newest marks only
    if (this.marks.size > MAX_MARKS) {
      const oldest = [...this.marks.entries()].sort((a, b) => a[1].day - b[1].day)[0];
      this.removeVisual(oldest[1]);
      this.marks.delete(oldest[0]);
    }
    if (!quiet) sounds.playChuff();
  }

  addVisual(entry, o) {
    const p = this.game.player.position;
    const ang = Math.atan2(p.x - o.x, p.z - o.z);
    const x = o.x + Math.sin(ang) * (o.radius + 0.6);
    const z = o.z + Math.cos(ang) * (o.radius + 0.6);
    const scrape = new THREE.Mesh(this.scrapeGeo, this.scrapeMat);
    scrape.position.set(x, this.terrain.getSurfaceHeight(x, z) + 0.04, z);
    scrape.rotation.y = ang;
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    glow.position.set(o.x, this.terrain.getTerrainHeight(o.x, o.z), o.z);
    this.game.scene.add(scrape, glow);
    entry.decal = scrape;
    entry.glow = glow;
  }

  removeVisual(entry) {
    if (entry.decal) this.game.scene.remove(entry.decal);
    if (entry.glow) this.game.scene.remove(entry.glow);
  }

  // Called at every new in-game day. Returns the Pelts earned.
  dailyIncome() {
    // expired marks fade away
    for (const [i, m] of this.marks) {
      if (this.day - m.day >= MARK_DAYS) {
        this.removeVisual(m);
        this.marks.delete(i);
      }
    }
    return this.freshCount() * MARK_INCOME;
  }

  // ------------------------------------------------------------------ rival leopard
  update(delta) {
    // marked boulders glow violet while Scent Vision is on
    const sv = this.game.scentVision;
    this.glowMat.opacity = sv.isActive ? 0.35 + Math.sin(performance.now() * 0.004) * 0.1 : 0;

    if (this.rival) {
      this.updateRival(delta);
      return;
    }
    this.rivalCooldown -= delta;
    if (this.rivalCooldown <= 0 && this.freshCount() >= RIVAL_MIN_TERRITORY && !this.game.player.isDowned) this.spawnRival();
  }

  spawnRival() {
    const g = this.game;
    // pick the marked boulder furthest from the player (but not absurdly far)
    let target = null;
    let best = -1;
    for (const [i] of this.marks) {
      const o = this.terrain.obstacles[i];
      const d = Math.hypot(o.x - g.player.position.x, o.z - g.player.position.z);
      if (d < 140 && d > best) {
        best = d;
        target = i;
      }
    }
    if (target === null) {
      this.rivalCooldown = 120;
      return;
    }
    const o = this.terrain.obstacles[target];
    const a = Math.random() * Math.PI * 2;
    const rival = new LeopardNPC(g.scene, this.terrain, g.player, { size: 1.05, tint: 0xa79d92, x: o.x + Math.cos(a) * 35, z: o.z + Math.sin(a) * 35 });
    Object.assign(rival, {
      type: 'rival', name: 'Rival Snow Leopard', isRival: true, isPredator: true, isBoss: false, hidden: false, airborne: false,
      cfg: { livestock: false }, meatAmount: 0, xpReward: 150, isDead: false, targetRock: target, markTimer: 0, swipeCooldown: 0, state: 'MARKING', fleeTimer: 0
    });
    const diff = g.difficulty === 'hard' ? 1.35 : g.difficulty === 'easy' ? 0.75 : 1;
    rival.maxHp = Math.round(160 * diff);
    rival.hp = rival.maxHp;
    rival.damage = Math.round(9 * diff);
    rival.takeDamage = (amount) => this.hitRival(amount);
    rival.updateSprite = () => {};
    rival.setMarker('⚔️', '#7f1d1d');
    this.rival = rival;
    g.announce('⚠️ A rival snow leopard is marking over your territory! Drive it off.', '#fca5a5');
    sounds.playYowl();
  }

  hitRival(amount) {
    const r = this.rival;
    if (!r || r.isDead) return;
    r.hp -= amount;
    sounds.playGrowl();
    r.state = 'FIGHT';
    if (r.hp <= r.maxHp * 0.3) {
      // beaten: it turns tail (counts as a win)
      r.isDead = true;
      r.state = 'FLEE';
      r.fleeTimer = 7;
      r.setMarker('💨', '#334155');
      this.game.questEvent('rivalDefeat');
      this.game.announce('🏔️ Rival driven off! Your territory is safe.', '#86efac');
    }
  }

  updateRival(delta) {
    const g = this.game;
    const r = this.rival;
    const p = g.player;
    const d = Math.hypot(p.position.x - r.position.x, p.position.z - r.position.z);
    if (r.swipeCooldown > 0) r.swipeCooldown -= delta;

    if (r.state === 'FLEE') {
      const away = Math.atan2(r.position.x - p.position.x, r.position.z - p.position.z);
      r.goTo(r.position.x + Math.sin(away) * 20, r.position.z + Math.cos(away) * 20, 13);
      r.fleeTimer -= delta;
      if (r.fleeTimer <= 0) this.removeRival(300);
    } else if (r.state === 'FIGHT' || d < 22) {
      if (r.state !== 'FIGHT') {
        r.state = 'FIGHT';
        sounds.playGrowl();
      }
      r.goTo(p.position.x, p.position.z, d > 3 ? 10 : 0);
      if (d < 3.2 && r.swipeCooldown <= 0 && !p.isDowned) {
        r.swipeCooldown = 1.7;
        r.playOnce(Math.random() < 0.5 ? 'Attack_Left' : 'Attack_Right', 0.45);
        p.takeDamage(r.damage);
        g.spawnFloatingText(`😾 CLAWED! -${r.damage} HP`, '#ef4444', g.getScreenCoords(p.position));
      }
      if (p.isDowned || d > 60) r.state = 'MARKING';
    } else {
      // walk to the boulder and mark over it
      const o = this.terrain.obstacles[r.targetRock];
      const dist = r.goTo(o.x, o.z, 4.5);
      if (dist < o.radius + 1.6) {
        r.targetSpeed = 0;
        r.markTimer += delta;
        if (r.markTimer > 4) {
          const m = this.marks.get(r.targetRock);
          if (m) {
            this.removeVisual(m);
            this.marks.delete(r.targetRock);
            g.announce('😾 The rival marked over one of your boulders. Territory lost.', '#fca5a5');
          }
          r.state = 'FLEE';
          r.fleeTimer = 10;
          r.isDead = true; // done here; just leaves
          r.setMarker('', '');
        }
      }
    }
    r.update(delta);
  }

  removeRival(cooldown) {
    if (!this.rival) return;
    this.rival.destroy();
    this.rival = null;
    this.rivalCooldown = cooldown + Math.random() * 200;
  }

  // ------------------------------------------------------------------ save
  serialize() {
    return [...this.marks.entries()].map(([i, m]) => [i, m.day]);
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!Array.isArray(item)) continue;
      const [i, day] = item;
      if (!Number.isInteger(i) || !this.terrain.obstacles[i] || !Number.isFinite(day)) continue;
      const entry = { day };
      this.addVisual(entry, this.terrain.obstacles[i]);
      this.marks.set(i, entry);
    }
  }
}
