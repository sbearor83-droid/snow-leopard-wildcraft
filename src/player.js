import * as THREE from 'three';
import { sounds } from './audio.js';
import { shortestAngleDiff } from './utils.js';

const _terrainNormal = new THREE.Vector3();

// Procedural 3D Snow Leopard with Realistic Wildcraft Animations & Stats
export class SnowLeopard {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;

    // RPG & Survival Stats
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 100;
    this.maxHp = 100;
    this.hp = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.maxHunger = 100;
    this.hunger = 85; // Starts with mild hunger to encourage first hunt
    this.attackPower = 35;
    this.preyHunted = 0;
    this.meatConsumed = 0;
    this.isDowned = false; // True from death until the player chooses how to respawn
    this.onDeath = null; // Set by Game to show the death screen

    // Movement & State
    this.position = new THREE.Vector3(0, 0, 0);
    this.facingAngle = 0;
    this.walkSpeed = 6.5;
    this.sprintSpeed = 15.5;
    this.stalkSpeed = 3.2;
    this.currentSpeed = 0;
    this.turnVelocity = 0;

    this.isSprinting = false;
    this.isStalking = false;
    this.isPouncing = false;
    this.isSwiping = false;
    this.pounceTimer = 0;
    this.pounceDuration = 0.65;
    this.pounceCooldown = 0;
    this.swipeTimer = 0;
    this.swipeDuration = 0.28;
    this.swipeCooldown = 0;
    this.hungerRate = 0.4; // Overridden by Game.setDifficulty
    this.animTime = 0;
    this.crouchLerp = 0; // 0 = upright, 1 = crouched

    // Snow puff particles on sprint/pounce
    this.createSnowPuffSystem();

    // Build the 3D Snow Leopard Mesh Hierarchy
    this.mesh = this.buildModel();
    this.scene.add(this.mesh);

    // Initial position on mountain ground
    const startY = this.terrain.getTerrainHeight(0, 0);
    this.position.set(0, startY, 0);
    this.mesh.position.copy(this.position);
  }

  // Generates high-definition authentic Snow Leopard rosette spotted fur texture
  createFurTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Base smoky cream with cold blue-grey alpine tint
    ctx.fillStyle = '#dde5eb';
    ctx.fillRect(0, 0, 1024, 1024);

    // Warm ochre-tan dorsal mantle and cold snow-white gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0.0, '#b8c4ce'); // Spine top shade
    grad.addColorStop(0.2, '#d6dee4');
    grad.addColorStop(0.5, '#eef3f7'); // Flanks
    grad.addColorStop(0.85, '#f8fafc'); // White belly/throat
    grad.addColorStop(1.0, '#ffffff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    // Microscopic fur grain fibers
    for (let i = 0; i < 18000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      ctx.fillStyle = Math.random() > 0.45 ? 'rgba(185, 200, 215, 0.28)' : 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(x, y, 2.5, 2.5);
    }

    // Authentic Snow Leopard Rosettes (open rings with broken charcoal spots & warm shadowed centers)
    for (let i = 0; i < 160; i++) {
      const rx = Math.random() * 1024;
      const ry = 60 + Math.random() * 850; // Focused on flanks and back
      const radius = 12 + Math.random() * 18;
      const numPetals = 4 + Math.floor(Math.random() * 3);

      ctx.save();
      ctx.translate(rx, ry);

      // Warm taupe-sepia center inside rosette
      ctx.fillStyle = 'rgba(165, 148, 136, 0.42)';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring of charcoal spot petals
      for (let p = 0; p < numPetals; p++) {
        const angle = (p / numPetals) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        ctx.fillStyle = '#22252a';
        ctx.beginPath();
        ctx.arc(px, py, 4.5 + Math.random() * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Solid dark spots on lower limbs, face, and ears
    for (let i = 0; i < 280; i++) {
      const sx = Math.random() * 1024;
      const sy = Math.random() * 1024;
      ctx.fillStyle = '#1c1f24';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5 + Math.random() * 4.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft charcoal paw pad impressions in texture corner
    ctx.fillStyle = '#26292e';
    ctx.beginPath();
    ctx.ellipse(880, 880, 45, 38, 0, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  buildModel() {
    const group = new THREE.Group();
    const furTex = this.createFurTexture();

    const bodyMat = new THREE.MeshStandardMaterial({
      map: furTex,
      roughness: 0.8,
      metalness: 0.05
    });

    const whiteFurMat = new THREE.MeshStandardMaterial({
      color: 0xf3f7fa,
      roughness: 0.85
    });

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1f2329,
      roughness: 0.6
    });

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x8cd982, // Amber-mint feline eyes
      roughness: 0.1,
      metalness: 0.3,
      emissive: 0x224422,
      emissiveIntensity: 0.2
    });

    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xd98a96, // Soft pink/grey nose
      roughness: 0.5
    });

    // Root node for crouching / body shifts
    this.bodyRoot = new THREE.Group();
    group.add(this.bodyRoot);

    // --- Torso & Spine ---
    // Main ribcage / chest
    const chestGeo = new THREE.BoxGeometry(1.2, 1.1, 1.5);
    this.chest = new THREE.Mesh(chestGeo, bodyMat);
    this.chest.position.set(0, 1.35, 0.4);
    this.chest.castShadow = true;
    this.bodyRoot.add(this.chest);

    // Hips / abdomen
    const hipsGeo = new THREE.BoxGeometry(1.05, 0.95, 1.4);
    this.hips = new THREE.Mesh(hipsGeo, bodyMat);
    this.hips.position.set(0, 1.3, -0.7);
    this.hips.castShadow = true;
    this.bodyRoot.add(this.hips);

    // Belly fluff under chest
    const bellyGeo = new THREE.BoxGeometry(0.95, 0.3, 2.2);
    const belly = new THREE.Mesh(bellyGeo, whiteFurMat);
    belly.position.set(0, 0.85, -0.1);
    this.bodyRoot.add(belly);

    // --- Neck & Head ---
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.5, 1.1);
    this.bodyRoot.add(this.neck);

    const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.8), bodyMat);
    neckMesh.position.set(0, 0.15, 0.25);
    neckMesh.rotation.x = 0.35;
    neckMesh.castShadow = true;
    this.neck.add(neckMesh);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.45, 0.65);
    this.neck.add(this.head);

    // Skull
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 0.95), bodyMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);

    // Muzzle / Snout
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.6), whiteFurMat);
    muzzle.position.set(0, -0.15, 0.6);
    this.head.add(muzzle);

    // Nose
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.15), noseMat);
    nose.position.set(0, -0.05, 0.92);
    this.head.add(nose);

    // Eyes (left & right)
    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(0.32, 0.12, 0.42);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-0.32, 0.12, 0.42);
    this.head.add(leftEye, rightEye);

    // Pupils & Specular Eye Highlights
    const pupilGeo = new THREE.BoxGeometry(0.04, 0.14, 0.05);
    const leftPupil = new THREE.Mesh(pupilGeo, darkMat);
    leftPupil.position.set(0.35, 0.12, 0.5);
    const rightPupil = new THREE.Mesh(pupilGeo, darkMat);
    rightPupil.position.set(-0.35, 0.12, 0.5);
    this.head.add(leftPupil, rightPupil);

    const eyeGlintGeo = new THREE.SphereGeometry(0.025, 4, 4);
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const leftGlint = new THREE.Mesh(eyeGlintGeo, glintMat);
    leftGlint.position.set(0.37, 0.15, 0.51);
    const rightGlint = new THREE.Mesh(eyeGlintGeo, glintMat);
    rightGlint.position.set(-0.33, 0.15, 0.51);
    this.head.add(leftGlint, rightGlint);

    // Whiskers (feline sensory vibrissae)
    const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let w = -1; w <= 1; w++) {
      const leftW = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.42, 3), whiskerMat);
      leftW.rotation.z = Math.PI / 2 + w * 0.22;
      leftW.position.set(0.38, -0.16 + w * 0.04, 0.68);
      this.head.add(leftW);

      const rightW = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.42, 3), whiskerMat);
      rightW.rotation.z = -Math.PI / 2 - w * 0.22;
      rightW.position.set(-0.38, -0.16 + w * 0.04, 0.68);
      this.head.add(rightW);
    }

    // Rounded Snow Leopard Ears with White Inner Tuft
    const earGeo = new THREE.ConeGeometry(0.24, 0.38, 6);
    const leftEar = new THREE.Mesh(earGeo, bodyMat);
    leftEar.position.set(0.35, 0.48, -0.1);
    leftEar.rotation.set(-0.2, 0, -0.3);
    const rightEar = new THREE.Mesh(earGeo, bodyMat);
    rightEar.position.set(-0.35, 0.48, -0.1);
    rightEar.rotation.set(-0.2, 0, 0.3);
    this.head.add(leftEar, rightEar);

    // --- Iconic Long Thick Snow Leopard Tail ---
    // Snow leopards have exceptionally thick, bushy tails for mountain balance & warmth
    this.tailSegments = [];
    let parentTailNode = this.hips;
    const numSegments = 5;
    for (let i = 0; i < numSegments; i++) {
      const segGroup = new THREE.Group();
      if (i === 0) {
        segGroup.position.set(0, 0.1, -0.75);
      } else {
        segGroup.position.set(0, -0.1, -0.45);
      }

      // Significantly thicker, rounder and plusher
      const thickness = 0.35 + Math.sin((i / numSegments) * Math.PI) * 0.12;
      const segMesh = new THREE.Mesh(new THREE.CylinderGeometry(thickness * 0.88, thickness, 0.52, 8), bodyMat);
      segMesh.rotation.x = Math.PI / 2.3;
      segMesh.castShadow = true;
      segGroup.add(segMesh);

      parentTailNode.add(segGroup);
      this.tailSegments.push(segGroup);
      parentTailNode = segGroup;
    }

    // --- 3D Luminous Claw Slash Arc Effect ---
    const slashGeo = new THREE.RingGeometry(0.9, 1.6, 16, 1, 0, Math.PI * 0.75);
    slashGeo.rotateX(-Math.PI / 2);
    const slashMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.slashMesh = new THREE.Mesh(slashGeo, slashMat);
    this.slashMesh.position.set(0.1, 1.15, 1.2);
    this.slashMesh.rotation.y = -0.3;
    this.bodyRoot.add(this.slashMesh);

    // --- Four Articulated Legs ---
    this.legs = {
      frontLeft: this.createLeg(0.48, 1.15, 0.85, bodyMat, whiteFurMat, darkMat),
      frontRight: this.createLeg(-0.48, 1.15, 0.85, bodyMat, whiteFurMat, darkMat),
      backLeft: this.createLeg(0.45, 1.15, -1.1, bodyMat, whiteFurMat, darkMat, true),
      backRight: this.createLeg(-0.45, 1.15, -1.1, bodyMat, whiteFurMat, darkMat, true)
    };

    Object.values(this.legs).forEach((leg) => this.bodyRoot.add(leg.root));

    return group;
  }

  createLeg(x, y, z, mat, pawMat, clawMat, isBack = false) {
    const root = new THREE.Group();
    root.position.set(x, y, z);

    // Upper thigh/shoulder
    const upperLen = isBack ? 0.65 : 0.6;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.38, upperLen, 0.42), mat);
    upper.position.y = -upperLen * 0.45;
    upper.castShadow = true;
    root.add(upper);

    // Knee / Hock joint
    const lowerJoint = new THREE.Group();
    lowerJoint.position.set(0, -upperLen * 0.85, isBack ? -0.1 : 0.05);
    root.add(lowerJoint);

    const lowerLen = 0.55;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.32, lowerLen, 0.35), mat);
    lower.position.y = -lowerLen * 0.45;
    lower.castShadow = true;
    lowerJoint.add(lower);

    // Wide Snow Paws (Snowshoes adaptation!)
    const paw = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.52), pawMat);
    paw.position.set(0, -lowerLen * 0.85, 0.12);
    paw.castShadow = true;
    lowerJoint.add(paw);

    // Retractable Claws
    for (let c = -1; c <= 1; c++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), clawMat);
      claw.position.set(c * 0.12, -lowerLen * 0.9, 0.38);
      claw.rotation.x = Math.PI / 2.3;
      lowerJoint.add(claw);
    }

    return { root, lowerJoint };
  }

  createSnowPuffSystem() {
    const puffCount = 40;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(puffCount * 3);
    const scales = new Float32Array(puffCount);

    for (let i = 0; i < puffCount; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -50; // Hidden initially
      pos[i * 3 + 2] = 0;
      scales[i] = 0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.8,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });

    this.snowPuffs = new THREE.Points(geo, mat);
    this.snowPuffData = Array.from({ length: puffCount }, () => ({ life: 0, maxLife: 0.5, vy: 0 }));
    this.scene.add(this.snowPuffs);
  }

  emitSnowPuff(pos) {
    for (let i = 0; i < this.snowPuffData.length; i++) {
      if (this.snowPuffData[i].life <= 0) {
        this.snowPuffData[i].life = 0.5;
        this.snowPuffData[i].vy = 0.8 + Math.random() * 1.2;
        const attr = this.snowPuffs.geometry.attributes.position;
        attr.setXYZ(i, pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.1, pos.z + (Math.random() - 0.5) * 0.6);
        attr.needsUpdate = true;
        break;
      }
    }
  }

  updateSnowPuffs(delta) {
    const attr = this.snowPuffs.geometry.attributes.position;
    for (let i = 0; i < this.snowPuffData.length; i++) {
      if (this.snowPuffData[i].life > 0) {
        this.snowPuffData[i].life -= delta;
        const y = attr.getY(i) + this.snowPuffData[i].vy * delta;
        attr.setY(i, y);
        if (this.snowPuffData[i].life <= 0) {
          attr.setY(i, -50);
        }
      }
    }
    attr.needsUpdate = true;
  }

  // Locomotion & Actions
  pounce() {
    if (this.isPouncing || this.pounceCooldown > 0 || this.stamina < 20) return false;

    this.isPouncing = true;
    this.pounceTimer = this.pounceDuration;
    this.pounceCooldown = 1.8;
    this.stamina = Math.max(0, this.stamina - 25);

    // Burst snow spray ring at leap takeoff
    for (let i = 0; i < 8; i++) {
      this.emitSnowPuff(this.position);
    }

    sounds.playPounce();
    return true;
  }

  pawSwipe() {
    if (this.isSwiping || this.swipeCooldown > 0 || this.stamina < 5) return false;

    this.isSwiping = true;
    this.swipeTimer = this.swipeDuration;
    this.swipeCooldown = 0.35;
    this.stamina = Math.max(0, this.stamina - 6);

    // Trigger luminous 3D claw slash arc
    if (this.slashMesh) {
      this.slashMesh.material.opacity = 0.95;
      this.slashMesh.scale.set(0.65, 0.65, 0.65);
    }

    sounds.playSwipe();
    return true;
  }

  eat(prey) {
    if (!prey || !prey.isDead || prey.meatAmount <= 0) return false;

    // Consume meat chunk
    const consumed = Math.min(prey.meatAmount, 30);
    prey.meatAmount -= consumed;
    this.hunger = Math.min(this.maxHunger, this.hunger + consumed * 1.2);
    this.hp = Math.min(this.maxHp, this.hp + 15);
    this.meatConsumed += Math.round(consumed);
    this.addXp(35);

    sounds.playEat();
    return true;
  }

  addXp(amount) {
    this.xp += amount;
    // A big reward (e.g. the boss) can be worth several levels at once
    while (this.xp >= this.xpToNext) {
      this.levelUp();
    }
  }

  levelUp() {
    this.level += 1;
    this.xp -= this.xpToNext;
    this.xpToNext = Math.round(this.xpToNext * 1.5);
    this.maxHp += 20;
    this.hp = this.maxHp;
    this.maxStamina += 15;
    this.stamina = this.maxStamina;
    this.attackPower += 10;
    sounds.playLevelUp();
  }

  takeDamage(amount) {
    if (this.isDowned) return;
    this.hp = Math.max(0, this.hp - amount);
    sounds.playAttackHit();
    if (this.hp <= 0) {
      this.isDowned = true;
      sounds.playPreyAlert();
      if (this.onDeath) this.onDeath();
      else this.respawnAtCamp();
    }
  }

  // Survival respawn at mountain camp with half health
  respawnAtCamp() {
    this.isDowned = false;
    this.hp = Math.round(this.maxHp * 0.5);
    this.hunger = Math.max(30, this.hunger);
    this.position.set(0, this.terrain.getTerrainHeight(0, 0), 0);
  }

  // Revive on the spot at full strength (reward for watching an ad)
  reviveHere() {
    this.isDowned = false;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.hunger = Math.max(60, this.hunger);
  }

  update(delta, inputDir, isSprintInput, isStalkInput) {
    // Cooldown timers
    if (this.pounceCooldown > 0) this.pounceCooldown -= delta;
    if (this.swipeCooldown > 0) this.swipeCooldown -= delta;

    if (this.isSwiping) {
      this.swipeTimer -= delta;
      if (this.slashMesh) {
        const progress = 1.0 - Math.max(0, this.swipeTimer / this.swipeDuration);
        this.slashMesh.scale.setScalar(0.65 + progress * 0.95);
        this.slashMesh.material.opacity = (1.0 - progress) * 0.95;
      }
      if (this.swipeTimer <= 0) {
        this.isSwiping = false;
        if (this.slashMesh) this.slashMesh.material.opacity = 0;
      }
    } else if (this.slashMesh && this.slashMesh.material.opacity > 0) {
      this.slashMesh.material.opacity = 0;
    }

    // Hunger drain (scaled by difficulty)
    this.hunger = Math.max(0, this.hunger - delta * this.hungerRate);
    if (this.hunger <= 0) {
      this.hp = Math.max(1, this.hp - delta * 2); // Starvation damage
    }

    // Stamina Regeneration & Sprint Cost
    this.isStalking = isStalkInput;
    const isMoving = inputDir.lengthSq() > 0.01;

    if (this.isPouncing) {
      this.pounceTimer -= delta;
      if (this.pounceTimer <= 0) {
        this.isPouncing = false;
      }
    }

    if (isSprintInput && isMoving && this.stamina > 5 && !this.isStalking) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - delta * 22);
      if (this.stamina <= 0) this.isSprinting = false;
    } else {
      this.isSprinting = false;
      // Stamina regens when not sprinting or pouncing
      if (!this.isPouncing) {
        const regenRate = isMoving ? (this.isStalking ? 18 : 12) : 26;
        this.stamina = Math.min(this.maxStamina, this.stamina + delta * regenRate);
      }
    }

    // Determine target speed
    let targetSpeed = 0;
    if (this.isPouncing) {
      targetSpeed = 22.0;
    } else if (isMoving) {
      if (this.isStalking) targetSpeed = this.stalkSpeed;
      else if (this.isSprinting) targetSpeed = this.sprintSpeed;
      else targetSpeed = this.walkSpeed;
    }

    // Smooth speed acceleration
    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, delta * 8);

    // Apply Movement & Rotation
    if (isMoving || this.isPouncing) {
      if (isMoving && !this.isPouncing) {
        // Rotate towards input direction
        const targetAngle = Math.atan2(inputDir.x, inputDir.z);
        const diff = shortestAngleDiff(this.facingAngle, targetAngle);
        this.facingAngle = shortestAngleDiff(0, this.facingAngle + diff * Math.min(1, delta * 12));
        this.turnVelocity = THREE.MathUtils.lerp(this.turnVelocity, diff, delta * 10);
      } else {
        this.turnVelocity = THREE.MathUtils.lerp(this.turnVelocity, 0, delta * 8);
      }

      this.position.x += Math.sin(this.facingAngle) * this.currentSpeed * delta;
      this.position.z += Math.cos(this.facingAngle) * this.currentSpeed * delta;

      // Audio footstep
      sounds.playFootstep(this.isSprinting, this.isStalking);

      // Emit snow puffs when running or pouncing
      if (this.isSprinting || this.isPouncing) {
        this.emitSnowPuff(this.position);
      }
    }

    // Solid collision with rocks and trees (smooth sliding along obstacle surfaces)
    this.terrain.resolveCollision(this.position, 0.85);

    // Keep within mountain arena boundary walls
    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    // Ground Clamping & Slope Alignment
    const groundY = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    let targetY = groundY;

    // Pounce ballistic arc
    if (this.isPouncing) {
      const pounceProgress = 1 - (this.pounceTimer / this.pounceDuration);
      const jumpArc = Math.sin(pounceProgress * Math.PI) * 2.8;
      targetY += jumpArc;
    }

    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, delta * 18);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;

    // Orient mesh gently along terrain slope
    const norm = this.terrain.getTerrainNormal(this.position.x, this.position.z, _terrainNormal);
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, (norm.z * 0.4), delta * 8);
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, (-norm.x * 0.4), delta * 8);

    // --- Animations & Skeleton Poses ---
    this.updateAnimation(delta, isMoving);
    this.updateSnowPuffs(delta);
  }

  updateAnimation(delta, isMoving) {
    const animRate = this.isSprinting ? 14 : (this.isStalking ? 5 : 8.5);
    if (isMoving || this.isPouncing) {
      this.animTime += delta * animRate;
    }

    // Stalk Crouch interpolation
    const targetCrouch = this.isStalking ? 1 : 0;
    this.crouchLerp = THREE.MathUtils.lerp(this.crouchLerp, targetCrouch, delta * 6);

    // Body crouching height shift
    this.bodyRoot.position.y = -this.crouchLerp * 0.45;
    this.chest.rotation.x = this.crouchLerp * 0.15;
    this.neck.position.y = 1.5 - this.crouchLerp * 0.55;
    this.neck.rotation.x = this.crouchLerp * 0.25;

    // Hip and Pelvis articulation matching gallop & stride
    if (this.isSprinting) {
      // Energetic gallop: spine and hips pump rhythmically with hind leg thrust
      this.hips.rotation.x = Math.sin(this.animTime) * 0.16;
      this.hips.position.y = 1.3 + Math.abs(Math.sin(this.animTime)) * 0.14;
    } else if (this.isStalking) {
      this.hips.rotation.x = -0.06;
      this.hips.position.y = 1.25;
    } else if (isMoving) {
      this.hips.rotation.x = Math.sin(this.animTime * 0.5) * 0.05;
      this.hips.position.y = 1.3 + Math.sin(this.animTime) * 0.03;
    } else {
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, 0, delta * 8);
      this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, 1.3, delta * 8);
    }

    // Dynamic Tail Physics & Aerodynamic Balancing (Lively gallop whip when sprinting)
    if (this.isPouncing) {
      // Pounce: tail arches high upward and back for aerodynamic pitch stabilization
      this.tailSegments.forEach((seg, idx) => {
        seg.rotation.x = -0.28 + Math.sin(idx * 0.4) * 0.06;
        seg.rotation.y = 0;
      });
    } else if (this.isSprinting) {
      // SPRINT: Fast, lively, dynamic trailing whip!
      // Synchronized with the rapid bounding gallop (no more slow-motion delay)
      const gallopCadence = this.animTime * 1.0;
      const rudderTurn = -this.turnVelocity * 0.6; // Rudder counter-balance when turning

      this.tailSegments.forEach((seg, idx) => {
        // Fast, energetic horizontal whip + centrifugal turn rudder
        const horizWave = Math.sin(gallopCadence - idx * 0.7) * 0.22;
        seg.rotation.y = horizWave + rudderTurn * (idx * 0.2);

        // High-energy vertical gallop bounce (trailing whip with phase delay)
        // Root lifts up (-0.22) so tail streams behind the galloping leopard
        const vertWave = Math.sin(gallopCadence - idx * 0.6) * 0.22;
        seg.rotation.x = -0.2 + vertWave;
      });
    } else if (this.isStalking) {
      // STALK: Tail held low, cautious, with iconic predatory tip twitch
      this.tailSegments.forEach((seg, idx) => {
        const basePitch = 0.22 + idx * 0.07;
        const tipTwitch = idx >= 3 ? Math.sin(this.animTime * 1.5) * 0.16 : 0;
        seg.rotation.x = basePitch;
        seg.rotation.y = Math.sin(this.animTime * 0.6) * 0.05 + tipTwitch;
      });
    } else if (isMoving) {
      // WALK: Natural relaxed trot sway matching footfalls
      this.tailSegments.forEach((seg, idx) => {
        const sway = Math.sin(this.animTime * 0.8 - idx * 0.5) * 0.15;
        seg.rotation.y = sway;
        seg.rotation.x = 0.05 + Math.sin(this.animTime * 0.8 - idx * 0.4) * 0.07;
      });
    } else {
      // IDLE: Gentle breathing sway
      this.tailSegments.forEach((seg, idx) => {
        seg.rotation.y = Math.sin(this.animTime * 0.4 - idx * 0.4) * 0.08;
        seg.rotation.x = 0.1 + Math.sin(this.animTime * 0.3 - idx * 0.3) * 0.04;
      });
    }

    if (this.isPouncing) {
      // Pounce pose: front paws reached forward, hind legs pushed back
      const pounceProgress = 1 - (this.pounceTimer / this.pounceDuration);
      this.legs.frontLeft.root.rotation.x = -1.1 + Math.sin(pounceProgress * Math.PI) * 0.4;
      this.legs.frontRight.root.rotation.x = -1.1 + Math.sin(pounceProgress * Math.PI) * 0.4;
      this.legs.backLeft.root.rotation.x = 1.0;
      this.legs.backRight.root.rotation.x = 1.0;
      this.head.rotation.x = 0.2;
      return;
    }

    // Ease the head back to neutral after a pounce
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0, delta * 8);

    if (isMoving) {
      // Diagonal feline trot & gallop
      const swing = this.isSprinting ? 0.85 : (this.isStalking ? 0.35 : 0.55);
      const legSin = Math.sin(this.animTime);

      this.legs.frontLeft.root.rotation.x = legSin * swing;
      this.legs.frontRight.root.rotation.x = -legSin * swing;
      this.legs.backLeft.root.rotation.x = -legSin * swing;
      this.legs.backRight.root.rotation.x = legSin * swing;

      // Lower knee flex
      this.legs.frontLeft.lowerJoint.rotation.x = Math.max(0, -legSin * swing * 0.8);
      this.legs.frontRight.lowerJoint.rotation.x = Math.max(0, legSin * swing * 0.8);
      this.legs.backLeft.lowerJoint.rotation.x = Math.max(0, legSin * swing * 0.8);
      this.legs.backRight.lowerJoint.rotation.x = Math.max(0, -legSin * swing * 0.8);

      // Spine bounce
      this.chest.position.y = 1.35 + Math.abs(legSin) * (this.isSprinting ? 0.2 : 0.06);
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, 0, delta * 8);
    } else {
      // Idle breathing and head sway
      const idleSin = Math.sin(this.animTime * 0.5);
      this.chest.position.y = 1.35 + idleSin * 0.03;
      this.head.rotation.y = Math.sin(this.animTime * 0.25) * 0.08;

      // Reset legs
      Object.values(this.legs).forEach((l) => {
        l.root.rotation.x = THREE.MathUtils.lerp(l.root.rotation.x, 0, delta * 8);
        l.lowerJoint.rotation.x = THREE.MathUtils.lerp(l.lowerJoint.rotation.x, 0, delta * 8);
      });
    }

    // Paw Swipe attack animation (fast horizontal slashing claw swipe)
    if (this.isSwiping) {
      const swipeProgress = 1 - (this.swipeTimer / this.swipeDuration);
      const slashArc = Math.sin(swipeProgress * Math.PI);
      this.legs.frontRight.root.rotation.x = -1.25 * slashArc;
      this.legs.frontRight.root.rotation.z = -0.6 * slashArc;
      this.legs.frontRight.root.rotation.y = 0.5 * slashArc;
      this.legs.frontRight.lowerJoint.rotation.x = 0.8 * slashArc;
      this.head.rotation.y = -0.25 * slashArc;
    } else {
      // Untwist the swiping leg once the swipe is over
      const fr = this.legs.frontRight.root.rotation;
      fr.y = THREE.MathUtils.lerp(fr.y, 0, delta * 10);
      fr.z = THREE.MathUtils.lerp(fr.z, 0, delta * 10);
    }
  }
}
