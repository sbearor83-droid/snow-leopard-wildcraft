import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sounds } from './audio.js';
import { shortestAngleDiff } from './utils.js';

const _terrainNormal = new THREE.Vector3();
const _tmpMat = new THREE.Matrix4();

// Rigged snow leopard model (skinned mesh + 17 skeletal clips, baked rosette coat).
// Model space: faces +Z, feet on y = 0, ~1.0 m long before scaling.
const MODEL_URL = `${import.meta.env.BASE_URL}snow_leopard.glb`;
const MODEL_SCALE = 2.4;

// Natural ground speed (m/s, after scaling) at which each locomotion clip's feet don't slide.
const CLIP_NATURAL_SPEED = { Walk: 2.6, Run: 4.2, ProwlWalk: 2.0 };

// Snow Leopard player: skinned 3D model, skeletal animation state machine & wildcraft survival stats
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
    this.hunger = 85;
    this.attackPower = 35;
    this.preyHunted = 0;
    this.meatConsumed = 0;
    this.isDowned = false;
    this.onDeath = null;

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
    this.pounceDuration = 0.70;
    this.pounceCooldown = 0;
    this.swipeTimer = 0;
    this.swipeDuration = 0.32;
    this.swipeCooldown = 0;
    this.biteTimer = 0;
    this.hitTimer = 0;
    this.swipeSide = 0;
    this.hungerRate = 0.4;
    this.animTime = 0;
    this.leanAngle = 0;

    // Scene root for the leopard (position / heading / slope alignment)
    this.mesh = new THREE.Group();
    this.scene.add(this.mesh);

    // Scaled root for the loaded model
    this.modelRoot = new THREE.Group();
    this.modelRoot.scale.setScalar(MODEL_SCALE);
    this.mesh.add(this.modelRoot);

    this.createSnowPuffSystem();
    this.createClawSlashEffect();

    // Skeletal animation
    this.mixer = null;
    this.actions = {};
    this.currentActionName = '';
    this.modelLoaded = false;
    this.skinnedMesh = null;
    this.loadModel();

    // Initial position on mountain ground
    const startY = this.terrain.getTerrainHeight(0, 0);
    this.position.set(0, startY, 0);
    this.mesh.position.copy(this.position);
  }

  loadModel() {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => this.onModelLoaded(gltf),
      undefined,
      (err) => {
        console.error('Snow leopard model failed to load, using placeholder body:', err);
        this.buildPlaceholder();
      }
    );
  }

  onModelLoaded(gltf) {
    const model = gltf.scene;

    model.traverse((child) => {
      if (!child.isSkinnedMesh) return;
      this.skinnedMesh = child;
      child.castShadow = true;
      child.receiveShadow = true;
      // Pounce / death clips move the body well outside the bind-pose bounds
      child.frustumCulled = false;

      const mat = child.material;
      if (mat) {
        mat.roughness = 0.92;
        mat.metalness = 0.0;
        mat.side = THREE.FrontSide;
        if (mat.map) mat.map.anisotropy = 4;
        mat.needsUpdate = true;
      }
    });

    this.modelRoot.add(model);
    this.addWhiskers();

    if (gltf.animations && gltf.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => {
        const action = this.mixer.clipAction(clip);
        this.actions[clip.name] = action;
        if (clip.name === 'Pounce' || clip.name === 'Attack_Right' || clip.name === 'Attack_Left' || clip.name === 'Bite' || clip.name === 'Hit_Left') {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        } else if (clip.name === 'Death') {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
      });
      // Pounce clip is authored at the same length as the gameplay leap
      if (this.actions.Pounce) {
        this.actions.Pounce.timeScale = this.actions.Pounce.getClip().duration / this.pounceDuration;
      }
      this.playAction(this.isDowned ? 'Death' : 'Idle_Look', 0.0);
    }

    this.modelLoaded = true;
  }

  // Thin white vibrissae parented to the head bone so they follow every head movement.
  addWhiskers() {
    if (!this.skinnedMesh) return;
    const skeleton = this.skinnedMesh.skeleton;
    const headIndex = skeleton.bones.findIndex((b) => b.name === 'DEF-jaw');
    if (headIndex < 0) return;
    const headBone = skeleton.bones[headIndex];

    const whiskers = new THREE.Group();
    // Place the group at the whisker pads (bind-pose model space) expressed in bone space
    _tmpMat.makeTranslation(0, 0.285, 0.955);
    whiskers.matrix.copy(skeleton.boneInverses[headIndex]).multiply(_tmpMat);
    whiskers.matrix.decompose(whiskers.position, whiskers.quaternion, whiskers.scale);

    const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f2, transparent: true, opacity: 0.8, depthWrite: false });
    const whiskerGeo = new THREE.CylinderGeometry(0.0035, 0.0012, 0.42, 3, 1, true);
    whiskerGeo.translate(0, 0.21, 0);
    whiskerGeo.rotateX(Math.PI / 2); // along +Z

    for (let side = -1; side <= 1; side += 2) {
      for (let w = 0; w < 4; w++) {
        const whisker = new THREE.Mesh(whiskerGeo, whiskerMat);
        whisker.position.set(side * 0.055, (w - 1.5) * 0.012, (w - 1.5) * -0.004);
        // Fan out sideways and slightly back, upper whiskers angle up, lower angle down
        whisker.rotation.set(-0.08 + (1.5 - w) * 0.14, side * (0.95 + w * 0.13), 0);
        whiskers.add(whisker);
      }
    }
    headBone.add(whiskers);
    this.whiskers = whiskers;
  }

  // Minimal stand-in body if the GLB cannot be fetched (keeps the game playable)
  buildPlaceholder() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.55, 6, 12), mat);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0.42, 0);
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat);
    head.position.set(0, 0.5, 0.45);
    head.castShadow = true;
    this.modelRoot.add(body, head);
    this.modelLoaded = true;
  }

  playAction(name, crossFadeDuration = 0.2, force = false) {
    const nextAction = this.actions[name];
    if (!nextAction) return;
    if (this.currentActionName === name && !force) return;

    const prevAction = this.actions[this.currentActionName];
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveWeight(1);
    nextAction.fadeIn(crossFadeDuration);
    nextAction.play();

    if (prevAction && prevAction !== nextAction) {
      prevAction.fadeOut(crossFadeDuration);
    }
    this.currentActionName = name;
  }

  createClawSlashEffect() {
    const slashGeo = new THREE.RingGeometry(0.9, 1.5, 16, 1, 0, Math.PI * 0.75);
    slashGeo.rotateX(-Math.PI / 2);
    const slashMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.slashMesh = new THREE.Mesh(slashGeo, slashMat);
    this.slashMesh.position.set(0.1, 0.55, 1.3);
    this.slashMesh.rotation.y = -0.3;
    this.mesh.add(this.slashMesh);
  }

  createSnowPuffSystem() {
    const puffCount = 50;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(puffCount * 3);

    for (let i = 0; i < puffCount; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -50;
      pos[i * 3 + 2] = 0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.85,
      transparent: true,
      opacity: 0.65,
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
    if (this.isPouncing || this.pounceCooldown > 0 || this.stamina < 20 || this.isDowned) return false;

    this.isPouncing = true;
    this.pounceTimer = this.pounceDuration;
    this.pounceCooldown = 1.8;
    this.stamina = Math.max(0, this.stamina - 25);
    this.biteTimer = 0;
    this.hitTimer = 0;

    for (let i = 0; i < 10; i++) {
      this.emitSnowPuff(this.position);
    }

    this.playAction('Pounce', 0.08, true);
    sounds.playPounce();
    return true;
  }

  pawSwipe() {
    if (this.isSwiping || this.swipeCooldown > 0 || this.stamina < 5 || this.isDowned) return false;

    this.isSwiping = true;
    this.swipeTimer = this.swipeDuration;
    this.swipeCooldown = 0.35;
    this.stamina = Math.max(0, this.stamina - 6);
    this.biteTimer = 0;

    if (this.slashMesh) {
      this.slashMesh.material.opacity = 0.95;
      this.slashMesh.scale.set(0.65, 0.65, 0.65);
    }

    // Alternate paws; play the strike fast enough to land inside the swipe window
    this.swipeSide = 1 - this.swipeSide;
    const name = this.swipeSide ? 'Attack_Left' : 'Attack_Right';
    const action = this.actions[name];
    if (action) {
      action.timeScale = action.getClip().duration / (this.swipeDuration + 0.12);
      this.playAction(name, 0.06, true);
    }

    sounds.playSwipe();
    return true;
  }

  eat(prey) {
    if (!prey || !prey.isDead || prey.meatAmount <= 0 || this.isDowned) return false;

    const consumed = Math.min(prey.meatAmount, 30);
    prey.meatAmount -= consumed;
    this.hunger = Math.min(this.maxHunger, this.hunger + consumed * 1.2);
    this.hp = Math.min(this.maxHp, this.hp + 15);
    this.meatConsumed += Math.round(consumed);
    this.addXp(35);

    if (this.actions.Bite) {
      this.biteTimer = this.actions.Bite.getClip().duration;
      this.playAction('Bite', 0.12, true);
    }

    sounds.playEat();
    return true;
  }

  addXp(amount) {
    this.xp += amount;
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
      this.isPouncing = false;
      this.isSwiping = false;
      this.biteTimer = 0;
      this.hitTimer = 0;
      this.playAction('Death', 0.15, true);
      sounds.playPreyAlert();
      if (this.onDeath) this.onDeath();
      else this.respawnAtCamp();
    } else if (!this.isPouncing && !this.isSwiping && this.actions.Hit_Left) {
      // Short flinch
      this.hitTimer = this.actions.Hit_Left.getClip().duration;
      this.playAction('Hit_Left', 0.05, true);
    }
  }

  respawnAtCamp() {
    this.isDowned = false;
    this.hp = Math.round(this.maxHp * 0.5);
    this.hunger = Math.max(30, this.hunger);
    this.position.set(0, this.terrain.getTerrainHeight(0, 0), 0);
    this.playAction('Idle_Look', 0.3, true);
  }

  reviveHere() {
    this.isDowned = false;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.hunger = Math.max(60, this.hunger);
    this.playAction('Idle_Look', 0.3, true);
  }

  update(delta, inputDir, isSprintInput, isStalkInput) {
    if (this.pounceCooldown > 0) this.pounceCooldown -= delta;
    if (this.swipeCooldown > 0) this.swipeCooldown -= delta;
    if (this.biteTimer > 0) this.biteTimer -= delta;
    if (this.hitTimer > 0) this.hitTimer -= delta;

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

    this.hunger = Math.max(0, this.hunger - delta * this.hungerRate);
    if (this.hunger <= 0) {
      this.hp = Math.max(1, this.hp - delta * 2);
    }

    this.isStalking = isStalkInput && !this.isDowned;
    const isMoving = inputDir.lengthSq() > 0.01 && !this.isDowned;

    if (this.isPouncing) {
      this.pounceTimer -= delta;
      if (this.pounceTimer <= 0) {
        this.isPouncing = false;
      }
    }

    if (isSprintInput && isMoving && this.stamina > 5 && !this.isStalking && !this.isDowned) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - delta * 22);
      if (this.stamina <= 0) this.isSprinting = false;
    } else {
      this.isSprinting = false;
      if (!this.isPouncing && !this.isDowned) {
        const regenRate = isMoving ? (this.isStalking ? 18 : 12) : 26;
        this.stamina = Math.min(this.maxStamina, this.stamina + delta * regenRate);
      }
    }

    let targetSpeed = 0;
    if (this.isDowned) {
      targetSpeed = 0;
    } else if (this.isPouncing) {
      targetSpeed = 22.0;
    } else if (isMoving) {
      if (this.isStalking) targetSpeed = this.stalkSpeed;
      else if (this.isSprinting) targetSpeed = this.sprintSpeed;
      else targetSpeed = this.walkSpeed;
    }

    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, delta * 8);

    if (isMoving || this.isPouncing) {
      if (isMoving && !this.isPouncing) {
        const targetAngle = Math.atan2(inputDir.x, inputDir.z);
        const diff = shortestAngleDiff(this.facingAngle, targetAngle);
        this.facingAngle = shortestAngleDiff(0, this.facingAngle + diff * Math.min(1, delta * 12));
        this.turnVelocity = THREE.MathUtils.lerp(this.turnVelocity, diff, delta * 10);
      } else {
        this.turnVelocity = THREE.MathUtils.lerp(this.turnVelocity, 0, delta * 8);
      }

      this.position.x += Math.sin(this.facingAngle) * this.currentSpeed * delta;
      this.position.z += Math.cos(this.facingAngle) * this.currentSpeed * delta;

      sounds.playFootstep(this.isSprinting, this.isStalking);

      if (this.isSprinting || this.isPouncing) {
        this.emitSnowPuff(this.position);
      }
    } else {
      this.turnVelocity = THREE.MathUtils.lerp(this.turnVelocity, 0, delta * 8);
    }

    this.terrain.resolveCollision(this.position, 0.85);

    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    const groundY = this.terrain.getTerrainHeight(this.position.x, this.position.z);
    let targetY = groundY;

    if (this.isPouncing) {
      const pounceProgress = 1 - (this.pounceTimer / this.pounceDuration);
      const jumpArc = Math.sin(pounceProgress * Math.PI) * 2.8;
      targetY += jumpArc;
    }

    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, delta * 18);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;

    // Orient gently along the mountain slope
    const norm = this.terrain.getTerrainNormal(this.position.x, this.position.z, _terrainNormal);
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, (norm.z * 0.4), delta * 8);
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, (-norm.x * 0.4), delta * 8);

    // Bank into fast turns
    const speedFactor = THREE.MathUtils.clamp(this.currentSpeed / this.sprintSpeed, 0, 1);
    const targetLean = -this.turnVelocity * 0.22 * speedFactor;
    this.leanAngle = THREE.MathUtils.lerp(this.leanAngle, targetLean, delta * 6);
    this.modelRoot.rotation.z = this.leanAngle;

    this.updateAnimationState(delta, isMoving);
    this.updateSnowPuffs(delta);
  }

  updateAnimationState(delta, isMoving) {
    if (!this.mixer) return;

    this.mixer.update(delta);

    // Priority-based animation state selection
    if (this.isDowned) {
      this.playAction('Death', 0.2);
    } else if (this.isPouncing) {
      this.playAction('Pounce', 0.08);
    } else if (this.isSwiping) {
      this.playAction(this.swipeSide ? 'Attack_Left' : 'Attack_Right', 0.06);
    } else if (this.biteTimer > 0 && !isMoving) {
      this.playAction('Bite', 0.12);
    } else if (this.hitTimer > 0 && !isMoving) {
      this.playAction('Hit_Left', 0.05);
    } else if (isMoving) {
      let name;
      let minScale;
      let maxScale;
      if (this.isStalking) {
        name = 'ProwlWalk'; minScale = 0.6; maxScale = 1.8;
      } else if (this.isSprinting) {
        name = 'Run'; minScale = 0.8; maxScale = 1.8;
      } else {
        name = 'Walk'; minScale = 0.6; maxScale = 2.0;
      }
      this.playAction(name, 0.22);
      const action = this.actions[name];
      if (action) {
        action.timeScale = THREE.MathUtils.clamp(this.currentSpeed / CLIP_NATURAL_SPEED[name], minScale, maxScale);
      }
    } else {
      this.biteTimer = 0;
      this.playAction(this.isStalking ? 'ProwlIdle' : 'Idle_Look', 0.35);
    }
  }
}
