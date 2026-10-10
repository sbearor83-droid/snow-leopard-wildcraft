import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sounds } from './audio.js';
import { shortestAngleDiff } from './utils.js';

const _terrainNormal = new THREE.Vector3();

// Realistic 3D Snow Leopard with Skinned Mesh, Skeletal Animations & Wildcraft Survival Mechanics
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
    this.swipeDuration = 0.35;
    this.swipeCooldown = 0;
    this.hungerRate = 0.4;
    this.animTime = 0;

    // Root node added to the scene
    this.mesh = new THREE.Group();
    this.scene.add(this.mesh);

    // Snow puff particles on sprint/pounce
    this.createSnowPuffSystem();

    // 3D Luminous Claw Slash Arc Effect
    this.createClawSlashEffect();

    // Load the Authentic 3D Snow Leopard Model & Animations
    this.actions = {};
    this.currentActionName = '';
    this.modelLoaded = false;
    this.loadModel();

    // Initial position on mountain ground
    const startY = this.terrain.getTerrainHeight(0, 0);
    this.position.set(0, startY, 0);
    this.mesh.position.copy(this.position);
  }

  loadModel() {
    this.modelRoot = new THREE.Group();
    // Offset model so snowshoe paws rest naturally on the terrain
    this.modelRoot.position.set(0, 0.638, 0);
    this.mesh.add(this.modelRoot);

    const textureLoader = new THREE.TextureLoader();
    const bumpMap = textureLoader.load('/snow_leopard_bump.png');
    const roughnessMap = textureLoader.load('/snow_leopard_roughness.png');

    const loader = new GLTFLoader();
    loader.load(
      '/snow_leopard.glb',
      (gltf) => {
        const model = gltf.scene;
        this.skinnedMesh = null;

        model.traverse((child) => {
          if (child.isSkinnedMesh) {
            this.skinnedMesh = child;
            child.castShadow = true;
            child.receiveShadow = true;

            // Apply realistic physically-based alpine fur material
            if (child.material) {
              child.material.roughness = 0.82;
              child.material.metalness = 0.02;
              child.material.bumpMap = bumpMap;
              child.material.bumpScale = 0.024;
              child.material.roughnessMap = roughnessMap;
              child.material.needsUpdate = true;
            }
          }
        });

        // Add 3D tactile feline whiskers to the snout whisker pads
        this.addTactileWhiskers(model);

        this.modelRoot.add(model);

        // Setup Animation Mixer & Actions
        if (gltf.animations && gltf.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(model);

          gltf.animations.forEach((clip) => {
            const action = this.mixer.clipAction(clip);
            this.actions[clip.name] = action;

            // Configure non-looping action properties
            if (clip.name === 'Pounce' || clip.name === 'Attack_Right' || clip.name === 'Attack_Left' || clip.name === 'Bite') {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = false;
            } else if (clip.name === 'Death') {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = true;
            }
          });

          // Start in serene, alert standing idle
          this.playAction('Idle_Look', 0.1);
        }

        this.modelLoaded = true;
      },
      undefined,
      (err) => {
        console.error('Error loading snow leopard model:', err);
      }
    );
  }

  // Adds authentic curved sensory vibrissae radiating from the velvet whisker pads
  addTactileWhiskers(model) {
    const whiskerGroup = new THREE.Group();
    // Snout whisker pad position in model local coordinates
    whiskerGroup.position.set(0, 0.22, 0.88);

    const whiskerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85
    });

    const whiskerGeo = new THREE.CylinderGeometry(0.003, 0.001, 0.38, 4);
    whiskerGeo.rotateZ(Math.PI / 2);

    for (let side = -1; side <= 1; side += 2) {
      for (let w = 0; w < 4; w++) {
        const whisker = new THREE.Mesh(whiskerGeo, whiskerMat);
        const pitch = (w - 1.5) * 0.14;
        const splay = side * (0.28 + w * 0.12);
        whisker.position.set(side * 0.08, (w - 1.5) * 0.025, (w - 1.5) * 0.015);
        whisker.rotation.set(pitch, splay, side * -0.12);
        whiskerGroup.add(whisker);
      }
    }

    model.add(whiskerGroup);
  }

  playAction(name, crossFadeDuration = 0.2) {
    if (!this.actions || !this.actions[name] || this.currentActionName === name) return;

    const prevAction = this.actions[this.currentActionName];
    const nextAction = this.actions[name];

    nextAction.reset();
    nextAction.fadeIn(crossFadeDuration);
    nextAction.play();

    if (prevAction) {
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
    this.slashMesh.position.set(0.1, 0.85, 1.1);
    this.slashMesh.rotation.y = -0.3;
    this.mesh.add(this.slashMesh);
  }

  createSnowPuffSystem() {
    const puffCount = 50;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(puffCount * 3);
    const scales = new Float32Array(puffCount);

    for (let i = 0; i < puffCount; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -50;
      pos[i * 3 + 2] = 0;
      scales[i] = 0;
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

    // Burst snow spray ring at leap takeoff
    for (let i = 0; i < 10; i++) {
      this.emitSnowPuff(this.position);
    }

    // Trigger authentic pounce hunting leap animation
    if (this.actions['Pounce']) {
      this.playAction('Pounce', 0.1);
    }

    sounds.playPounce();
    return true;
  }

  pawSwipe() {
    if (this.isSwiping || this.swipeCooldown > 0 || this.stamina < 5 || this.isDowned) return false;

    this.isSwiping = true;
    this.swipeTimer = this.swipeDuration;
    this.swipeCooldown = 0.35;
    this.stamina = Math.max(0, this.stamina - 6);

    // Trigger luminous 3D claw slash arc
    if (this.slashMesh) {
      this.slashMesh.material.opacity = 0.95;
      this.slashMesh.scale.set(0.65, 0.65, 0.65);
    }

    // Trigger ferocious right paw swipe attack animation
    if (this.actions['Attack_Right']) {
      this.playAction('Attack_Right', 0.08);
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

    // Play predatory feeding bite animation
    if (this.actions['Bite']) {
      this.playAction('Bite', 0.15);
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
      sounds.playPreyAlert();

      if (this.actions['Death']) {
        this.playAction('Death', 0.2);
      }

      if (this.onDeath) this.onDeath();
      else this.respawnAtCamp();
    }
  }

  respawnAtCamp() {
    this.isDowned = false;
    this.hp = Math.round(this.maxHp * 0.5);
    this.hunger = Math.max(30, this.hunger);
    this.position.set(0, this.terrain.getTerrainHeight(0, 0), 0);
    if (this.actions['Idle_Look']) {
      this.playAction('Idle_Look', 0.3);
    }
  }

  reviveHere() {
    this.isDowned = false;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.hunger = Math.max(60, this.hunger);
    if (this.actions['Idle_Look']) {
      this.playAction('Idle_Look', 0.3);
    }
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

    // Hunger drain
    this.hunger = Math.max(0, this.hunger - delta * this.hungerRate);
    if (this.hunger <= 0) {
      this.hp = Math.max(1, this.hp - delta * 2);
    }

    // Stamina Regeneration & Sprint Cost
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

    // Determine target speed
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

    // Apply Movement & Rotation
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
    }

    // Solid collision with mountain obstacles
    this.terrain.resolveCollision(this.position, 0.85);

    // Arena boundary clamp
    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    // Ground Clamping & Ballistic Pounce Arc
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

    // Orient gently along mountain slope terrain
    const norm = this.terrain.getTerrainNormal(this.position.x, this.position.z, _terrainNormal);
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, (norm.z * 0.4), delta * 8);
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, (-norm.x * 0.4), delta * 8);

    // Update Skeletal Animations
    this.updateAnimationState(delta, isMoving);
    this.updateSnowPuffs(delta);
  }

  updateAnimationState(delta, isMoving) {
    if (!this.mixer) return;

    // Advance skeletal animation mixer
    this.mixer.update(delta);

    // Priority-based animation state selection
    if (this.isDowned) {
      this.playAction('Death', 0.2);
    } else if (this.isPouncing) {
      this.playAction('Pounce', 0.1);
    } else if (this.isSwiping) {
      this.playAction('Attack_Right', 0.08);
    } else if (isMoving) {
      if (this.isStalking) {
        this.playAction('ProwlWalk', 0.25);
        if (this.actions['ProwlWalk']) {
          this.actions['ProwlWalk'].timeScale = Math.max(0.6, this.currentSpeed / this.stalkSpeed);
        }
      } else if (this.isSprinting) {
        this.playAction('Run', 0.18);
        if (this.actions['Run']) {
          this.actions['Run'].timeScale = Math.max(0.7, this.currentSpeed / this.sprintSpeed);
        }
      } else {
        this.playAction('Walk', 0.2);
        if (this.actions['Walk']) {
          this.actions['Walk'].timeScale = Math.max(0.6, this.currentSpeed / this.walkSpeed);
        }
      }
    } else {
      // Stationary poses
      if (this.isStalking) {
        this.playAction('ProwlIdle', 0.3);
      } else {
        this.playAction('Idle_Look', 0.35);
      }
    }
  }
}
