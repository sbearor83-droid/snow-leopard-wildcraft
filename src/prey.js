import * as THREE from 'three';
import { sounds } from './audio.js';

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

    // Spawn 2 Legendary Boss Yaks (Titan Crag Yaks)
    this.spawnPrey('yak', 42, 45);
    this.spawnPrey('yak', -55, -50);
  }

  spawnPrey(type, x, z) {
    const p = new PreyAnimal(this.scene, this.terrain, type, x, z, this.difficulty);
    this.preyList.push(p);
  }

  update(delta, player) {
    this.preyList.forEach((p) => {
      p.update(delta, player, this.preyList);
    });

    // Clean up fully consumed carcasses after a delay
    for (let i = this.preyList.length - 1; i >= 0; i--) {
      const p = this.preyList[i];
      if (p.isDead && p.meatAmount <= 0) {
        p.dissolveTimer = (p.dissolveTimer || 0) + delta;
        if (p.dissolveTimer > 6.0) {
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

  getNearestPrey(playerPos) {
    let nearest = null;
    let minDist = Infinity;
    this.preyList.forEach((p) => {
      if (!p.isDead) {
        const d = playerPos.distanceTo(p.position);
        if (d < minDist) {
          minDist = d;
          nearest = p;
        }
      }
    });
    return { prey: nearest, distance: minDist };
  }

  getNearestBoss(playerPos) {
    let nearest = null;
    let minDist = Infinity;
    this.preyList.forEach((p) => {
      if (p.isBoss && !p.isDead) {
        const d = playerPos.distanceTo(p.position);
        if (d < minDist) {
          minDist = d;
          nearest = p;
        }
      }
    });
    return { boss: nearest, distance: minDist };
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

    // Base Archetype Configuration
    if (this.isBoss) {
      this.name = 'Titan Crag Yak';
      this.baseMaxHp = 300;
      this.meatAmount = 350;
      this.xpReward = 350;
      this.maxFleeSpeed = 10.5;
      this.chargeSpeed = 16.5;
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
      this.maxFleeSpeed = 14.8;
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

    // Build stylized 3D Model
    if (this.isBoss) {
      this.mesh = this.buildYakModel();
    } else if (this.type === 'ibex') {
      this.mesh = this.buildIbexModel();
    } else {
      this.mesh = this.buildHareModel();
    }
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
      sprite.position.y = 3.8;
    } else if (this.type === 'ibex') {
      sprite.scale.set(1.6, 1.6, 1.6);
      sprite.position.y = 2.6;
    } else {
      sprite.scale.set(1.4, 1.4, 1.4);
      sprite.position.y = 1.5;
    }
    sprite.visible = false;
    return sprite;
  }

  updateSprite(text, color) {
    if (!this.spriteCanvas) return;
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

  buildYakModel() {
    const group = new THREE.Group();
    // Shaggy dark Tibetan Yak materials
    const shaggyMat = new THREE.MeshStandardMaterial({ color: 0x27201c, roughness: 0.95 });
    const humpMat = new THREE.MeshStandardMaterial({ color: 0x3d322b, roughness: 0.9 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1f1916, roughness: 0.95 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xdcd8d0, roughness: 0.45, metalness: 0.1 });
    const hornTipMat = new THREE.MeshStandardMaterial({ color: 0x221f1d, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x161311, roughness: 0.7 });

    // Massive Body Torso (scale ~ 2.4x of ibex)
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 3.4), shaggyMat);
    body.position.y = 2.4;
    body.castShadow = true;
    group.add(body);

    // Iconic Prominent Shoulder Hump
    const hump = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 1.8), humpMat);
    hump.position.set(0, 3.3, 0.7);
    hump.castShadow = true;
    group.add(hump);

    // Hanging Shaggy Wool Skirt / Fringe on flanks & belly
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.35, 1.2, 3.2), skirtMat);
    skirt.position.set(0, 1.6, 0);
    skirt.castShadow = true;
    group.add(skirt);

    // Heavy Neck & Head
    this.headNode = new THREE.Group();
    this.headNode.position.set(0, 2.7, 1.9);
    group.add(this.headNode);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.4), shaggyMat);
    neck.position.set(0, 0.2, 0.4);
    neck.rotation.x = 0.45;
    neck.castShadow = true;
    this.headNode.add(neck);

    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.5), shaggyMat);
    headMesh.position.set(0, 0.5, 1.1);
    headMesh.castShadow = true;
    this.headNode.add(headMesh);

    // Broad Snout & Nostrils
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), darkMat);
    snout.position.set(0, 0.25, 1.8);
    this.headNode.add(snout);

    // Majestic Sweeping Curved Yak Horns
    for (let side = -1; side <= 1; side += 2) {
      const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.9, 7), hornMat);
      h1.position.set(side * 0.9, 0.85, 1.0);
      h1.rotation.z = side * -1.2;
      h1.rotation.y = side * 0.2;
      h1.castShadow = true;
      this.headNode.add(h1);

      const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.9, 7), hornMat);
      h2.position.set(side * 1.5, 1.25, 1.2);
      h2.rotation.z = side * -0.5;
      h2.rotation.x = 0.5;
      h2.castShadow = true;
      this.headNode.add(h2);

      const h3 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 6), hornTipMat);
      h3.position.set(side * 1.7, 1.9, 1.4);
      h3.rotation.z = side * 0.3;
      h3.rotation.x = 0.8;
      h3.castShadow = true;
      this.headNode.add(h3);
    }

    // Shaggy Bushy Tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 1.8, 6), skirtMat);
    tail.position.set(0, 1.7, -1.9);
    tail.rotation.x = 0.3;
    group.add(tail);

    // Thick Sturdy Pillar Legs
    this.legMeshes = [];
    const legPositions = [
      [0.8, 1.8, 1.2],
      [-0.8, 1.8, 1.2],
      [0.75, 1.8, -1.2],
      [-0.75, 1.8, -1.2]
    ];
    legPositions.forEach(([lx, ly, lz]) => {
      const legRoot = new THREE.Group();
      legRoot.position.set(lx, ly, lz);

      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.6, 0.6), shaggyMat);
      leg.position.y = -0.8;
      leg.castShadow = true;
      legRoot.add(leg);

      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.65), darkMat);
      hoof.position.y = -1.6;
      legRoot.add(hoof);

      group.add(legRoot);
      this.legMeshes.push(legRoot);
    });

    return group;
  }

  buildIbexModel() {
    const group = new THREE.Group();
    const coatMat = new THREE.MeshStandardMaterial({ color: 0x8a7765, roughness: 0.85 }); // Grey-brown mountain pelt
    const underMat = new THREE.MeshStandardMaterial({ color: 0xd6cbbd, roughness: 0.85 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x221f1d, roughness: 0.7 });

    // Torso
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 1.7), coatMat);
    body.position.y = 1.35;
    body.castShadow = true;
    group.add(body);

    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.35, 1.5), underMat);
    belly.position.set(0, 0.95, 0);
    group.add(belly);

    // Neck & Head
    this.headNode = new THREE.Group();
    this.headNode.position.set(0, 1.65, 0.85);
    group.add(this.headNode);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.8, 0.7), coatMat);
    neck.position.set(0, 0.3, 0.2);
    neck.rotation.x = 0.5;
    neck.castShadow = true;
    this.headNode.add(neck);

    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.85), coatMat);
    headMesh.position.set(0, 0.6, 0.45);
    headMesh.castShadow = true;
    this.headNode.add(headMesh);

    // Muzzle
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.5), underMat);
    muzzle.position.set(0, 0.45, 0.85);
    this.headNode.add(muzzle);

    // Beard
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), darkMat);
    beard.position.set(0, 0.2, 0.75);
    beard.rotation.x = -0.3;
    this.headNode.add(beard);

    // Majestic Curved Ibex Horns (scimitar ridges)
    for (let side = -1; side <= 1; side += 2) {
      let hornRoot = this.headNode;
      for (let s = 0; s < 4; s++) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12 - s * 0.025, 0.15 - s * 0.025, 0.4, 6),
          hornMat
        );
        seg.position.set(side * (0.2 + s * 0.06), 0.85 + s * 0.25, 0.35 - s * 0.18);
        seg.rotation.x = -0.5 - s * 0.25;
        seg.rotation.z = side * 0.2;
        seg.castShadow = true;
        this.headNode.add(seg);
      }
    }

    // Legs
    this.legMeshes = [];
    const legPositions = [
      [0.4, 1.1, 0.6],
      [-0.4, 1.1, 0.6],
      [0.38, 1.1, -0.65],
      [-0.38, 1.1, -0.65]
    ];
    legPositions.forEach(([lx, ly, lz]) => {
      const legRoot = new THREE.Group();
      legRoot.position.set(lx, ly, lz);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.0, 0.26), coatMat);
      leg.position.y = -0.5;
      leg.castShadow = true;
      legRoot.add(leg);

      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.3), darkMat);
      hoof.position.y = -1.0;
      legRoot.add(hoof);

      group.add(legRoot);
      this.legMeshes.push(legRoot);
    });

    return group;
  }

  buildHareModel() {
    const group = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f8fc, roughness: 0.9 });
    const earTipMat = new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.8 });
    const pinkMat = new THREE.MeshStandardMaterial({ color: 0xe0969d, roughness: 0.6 });

    // Round plump body
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), whiteMat);
    body.position.y = 0.55;
    body.scale.set(0.8, 0.85, 1.15);
    body.castShadow = true;
    group.add(body);

    // Head
    this.headNode = new THREE.Group();
    this.headNode.position.set(0, 0.75, 0.45);
    group.add(this.headNode);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), whiteMat);
    headMesh.castShadow = true;
    this.headNode.add(headMesh);

    // Tall Ears
    for (let side = -1; side <= 1; side += 2) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.65, 5), whiteMat);
      ear.position.set(side * 0.16, 0.45, -0.05);
      ear.rotation.z = side * -0.2;
      ear.castShadow = true;
      this.headNode.add(ear);

      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 5), earTipMat);
      tip.position.set(side * 0.16, 0.72, -0.05);
      tip.rotation.z = side * -0.2;
      this.headNode.add(tip);
    }

    // Fluffy Pompom Tail
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), whiteMat);
    tail.position.set(0, 0.55, -0.65);
    group.add(tail);

    // Legs
    this.legMeshes = [];
    for (let i = 0; i < 4; i++) {
      const legRoot = new THREE.Group();
      const isBack = i >= 2;
      legRoot.position.set((i % 2 === 0 ? 1 : -1) * 0.28, 0.45, isBack ? -0.35 : 0.35);

      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, isBack ? 0.55 : 0.4, 0.2), whiteMat);
      leg.position.y = -0.2;
      leg.castShadow = true;
      legRoot.add(leg);

      group.add(legRoot);
      this.legMeshes.push(legRoot);
    }

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
      this.mesh.position.y -= 1.8;
      sounds.playBossGrunt();
    } else {
      this.updateSprite('🍖', '#22c55e');
      this.mesh.rotation.z = Math.PI / 2.2;
      this.mesh.position.y -= this.type === 'ibex' ? 0.8 : 0.35;
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

    // Vector to player
    const toPlayer = player.position.clone().sub(this.position);
    toPlayer.y = 0;
    const dirToPlayer = toPlayer.clone().normalize();

    // Facing vector of prey
    const forward = new THREE.Vector3(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
    const angleToPlayer = forward.angleTo(dirToPlayer); // 0 = straight ahead, PI = directly behind

    const perceptionMult = this.perceptionMultiplier || 1.0;
    const speedMult = this.speedMultiplier || 1.0;
    const alertMult = this.alertRateMultiplier || 1.0;

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
    } else {
      if (this.state === 'SUSPICIOUS') {
        this.state = 'GRAZING';
        this.updateSprite(this.isBoss ? '👑' : '', '#fbbf24');
      }
    }

    // --- BEHAVIOR STATE EXECUTION ---
    let targetSpeed = 0;

    if (this.state === 'GRAZING') {
      this.wanderTimer -= delta;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 3 + Math.random() * 5;
        this.facingAngle += (Math.random() - 0.5) * 1.8;
      }
      targetSpeed = 1.2 * speedMult;
      // Head down grazing
      if (this.headNode) {
        this.headNode.rotation.x = 0.5 + Math.sin(this.animTime * 0.4) * 0.2;
      }
    } else if (this.state === 'SUSPICIOUS') {
      // Freeze, look at predator
      targetSpeed = 0;
      const lookAngle = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.facingAngle = THREE.MathUtils.lerp(this.facingAngle, lookAngle, delta * 3);
      if (this.headNode) {
        this.headNode.rotation.x = -0.3; // Head held alert and high
      }
    } else if (this.state === 'CHARGING') {
      // BOSS YAK COMBAT: Charge straight at the predator!
      this.chargeTimer -= delta;
      if (this.chargeCooldown > 0) this.chargeCooldown -= delta;

      targetSpeed = this.chargeSpeed * speedMult;
      const targetAngle = Math.atan2(dirToPlayer.x, dirToPlayer.z);
      this.facingAngle = THREE.MathUtils.lerp(this.facingAngle, targetAngle, delta * 5);

      if (this.headNode) {
        this.headNode.rotation.x = 0.55; // Lower horns ready to ram!
      }

      // Ramming Snow Leopard
      if (distToPlayer < 2.5 && this.chargeCooldown <= 0) {
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

      const fleeDir = this.position.clone().sub(player.position).normalize();
      fleeDir.y = 0;

      if (this.type === 'hare') {
        this.zigzagTimer -= delta;
        if (this.zigzagTimer <= 0) {
          this.zigzagTimer = 0.4 + Math.random() * 0.4;
          this.zigzagDir *= -1;
        }
        // Perpendicular evasive dodge
        const perp = new THREE.Vector3(-fleeDir.z, 0, fleeDir.x).multiplyScalar(this.zigzagDir * 0.6);
        fleeDir.add(perp).normalize();
      }

      const targetAngle = Math.atan2(fleeDir.x, fleeDir.z);
      this.facingAngle = THREE.MathUtils.lerp(this.facingAngle, targetAngle, delta * 8);

      if (this.headNode) {
        this.headNode.rotation.x = 0.1;
      }

      // If fled far enough, calm down
      if (distToPlayer > 55) {
        this.alertMeter -= delta * 20;
      }
    }

    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, delta * 6);

    // Apply movement
    if (this.speed > 0.1) {
      const move = new THREE.Vector3(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
      this.position.addScaledVector(move, this.speed * delta);
    }

    // Keep within world bounds
    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    // Solid collision against rocks and tree trunks
    this.terrain.resolveCollision(this.position, this.isBoss ? 1.4 : (this.type === 'ibex' ? 0.75 : 0.4));

    // Terrain ground clamp
    const groundY = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    this.position.y = groundY;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;

    // Leg trot animations
    const isChargingOrFleeing = this.state === 'FLEEING' || this.state === 'CHARGING';
    const legFreq = isChargingOrFleeing ? 18 : 6;
    const legAmp = isChargingOrFleeing ? 0.7 : 0.3;
    if (this.legMeshes && this.speed > 0.2) {
      this.legMeshes.forEach((leg, idx) => {
        const offset = idx % 2 === 0 ? 0 : Math.PI;
        leg.rotation.x = Math.sin(this.animTime * legFreq + offset) * legAmp;
      });
    }
  }

  destroy() {
    this.scene.remove(this.mesh);
  }
}
