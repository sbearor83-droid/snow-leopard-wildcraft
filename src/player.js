import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { sounds } from './audio.js';
import { shortestAngleDiff, isMobileDevice } from './utils.js';
import { SLOTS, ACCESSORY_BY_ID } from './accessories.js';

const _tmpMat = new THREE.Matrix4();

// Rigged snow leopard model (skinned mesh + 17 skeletal clips, baked rosette coat).
// Model space: faces +Z, feet on y = 0, ~1.0 m long before scaling.
const MODEL_URL = `${import.meta.env.BASE_URL}snow_leopard.glb`;
const MODEL_SCALE = 3.0;

// Ground speed (model units per second at playback rate 1) that each locomotion clip's feet
// cover during their stance phase, measured from the toe bones. Multiplied by MODEL_SCALE this
// is the speed at which the paws stay planted; playback rate = ground speed / this.
const CLIP_STRIDE_SPEED = { Walk: 0.926, Run: 2.55, ProwlWalk: 1.82 };

// Fur shell rendering (extruded alpha-tested copies of the skinned mesh)
const FUR_SHELLS = isMobileDevice() ? 5 : 10;
const FUR_LENGTH = 0.019; // model units before scaling (~6 cm in-game)

// Where the paws rest relative to the leopard's origin (metres, +Z forward, +X to its left).
// The body is tilted and lifted so the plane through these four points lies on the snow.
const PAW_FRONT_Z = 0.72;
const PAW_BACK_Z = -0.56;
const PAW_HALF_WIDTH = 0.25;
const MAX_BODY_TILT = 0.7; // rad, a little steeper than the steepest walkable slope

// Gait follows the leopard's real speed, not which buttons are held, so switching between
// sprint, walk and stalk never plays a slow-gait clip at sprint speed (legs blurring).
const RUN_ENTER_SPEED = 8.0; // m/s: Walk/ProwlWalk -> Run
const RUN_EXIT_SPEED = 6.5; // m/s: Run -> Walk/ProwlWalk (gap avoids flicker)
const SPRINT_RUN_SPEED = 4.5; // m/s: with sprint on, Run from here so speeding up never plays a fast walk
const MAX_GAIT_RATE = 2.4; // cap on clip playback speed while the leopard speeds up or slows down
const SPRINT_STAMINA_PER_SECOND = 16; // ~6 s of sprint from 100 stamina (more as you level up)
const AMBUSH_MIN_DROP = 2.2; // metres the landing spot must lie below the leopard for an ambush

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

    // Worn accessories: slot -> accessory id, and slot -> attached Object3D
    this.equipped = {};
    this.accessoryObjects = {};

    // Movement & State
    this.position = new THREE.Vector3(0, 0, 0);
    this.facingAngle = 0;
    this.walkSpeed = 5.2;
    this.sprintSpeed = 14.5;
    this.stalkSpeed = 3.8;
    this.currentSpeed = 0;
    this.turnVelocity = 0;

    this.isSprinting = false;
    this.isStalking = false;
    this.isPouncing = false;
    this.isSwiping = false;
    this.pounceTimer = 0;
    this.pounceDuration = 0.70;
    this.pounceLength = 0.70; // this pounce's duration (longer for a cliff ambush)
    this.pounceSpeed = 22.0;
    this.pounceArc = 2.8;
    this.isAmbush = false; // leapt down from higher ground
    this.camo = 0; // 0..1: how well the coat blends into the rocks right now
    this.finisherTimer = 0; // throat bite in progress (leopard holds still)
    this.pounceCooldown = 0;
    this.swipeTimer = 0;
    this.swipeDuration = 0.32;
    this.swipeCooldown = 0;
    this.biteTimer = 0;
    this.hitTimer = 0;
    this.swipeSide = 0;
    this.hungerRate = 0.4;
    this.leanAngle = 0;

    // Scene root for the leopard (position / heading / slope alignment)
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = 'YXZ'; // heading first, then pitch and roll in the leopard's own frame
    this.locomotionClip = 'Walk';
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
    // Untouched copy for other leopards (rival, mate, cubs), taken before fur shells and
    // accessories are added to this one
    this.npcTemplate = cloneSkinned(model);
    this.animationClips = gltf.animations || [];

    model.traverse((child) => {
      if (!child.isSkinnedMesh) return;
      this.skinnedMesh = child;
      child.castShadow = true;
      child.receiveShadow = true;
      // Pounce / death clips move the body well outside the bind-pose bounds
      child.frustumCulled = false;

      child.material = this.createFurMaterial(child.material);
    });

    this.modelRoot.add(model);
    if (this.skinnedMesh) this.createFurShells(this.skinnedMesh);
    this.addWhiskers();
    for (const slot of Object.keys(this.equipped)) this.attachAccessory(slot);
    if (this.coatTint !== undefined) this.setCoat(this.coatTint);

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

  // Soft fur base material: baked coat + fur-grain normal map + a sheen lobe for the velvety
  // light scattering real fur has at grazing angles.
  createFurMaterial(src) {
    const mat = new THREE.MeshPhysicalMaterial({
      map: src.map || null,
      normalMap: src.normalMap || null,
      normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(0.6, 0.6),
      roughness: 0.9,
      metalness: 0.0,
      sheen: 0.55,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0xe8edf2),
      side: THREE.FrontSide
    });
    if (mat.map) mat.map.anisotropy = 4;
    return mat;
  }

  // Tileable hair-follicle alpha texture: each fibre is a soft dot whose brightness sets how far
  // up the shell stack it survives the alpha test, so fibres taper towards the tips.
  createFurStrandTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    let seed = 1337;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7000; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 0.7 + rnd() * 1.3;
      const a = 0.4 + rnd() * 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      // draw with wrap-around so the tile seams are invisible
      for (let ox = -size; ox <= size; ox += size) {
        for (let oy = -size; oy <= size; oy += size) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(30, 30);
    return tex;
  }

  // Volumetric fur: N copies of the skinned mesh pushed out along the (skinned) normals with an
  // alpha-tested follicle texture. Per-vertex fur length comes from the bone weights, so the
  // tail, belly, chest ruff and neck get long plush fur while the face, ears and paws stay short.
  createFurShells(skinnedMesh) {
    const geo = skinnedMesh.geometry;
    const skinIndex = geo.attributes.skinIndex;
    const skinWeight = geo.attributes.skinWeight;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const boneNames = skinnedMesh.skeleton.bones.map((b) => b.name);
    const lengthByBone = boneNames.map((name) => {
      if (/^DEF-spine00[012]?$/.test(name) || name === 'DEF-spine') return 1.35; // tail
      if (name.startsWith('DEF-breast')) return 1.5; // chest ruff
      if (/DEF-spine0(09|10)/.test(name)) return 1.35; // neck ruff
      if (name === 'DEF-jaw' || name === 'DEF-spine011') return 0.5; // face
      if (name.startsWith('DEF-ear')) return 0.45;
      if (/toe|foot/.test(name)) return 0.45; // paws
      if (/shin/.test(name)) return 0.7; // lower legs
      return 1.0;
    });

    const furMul = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      let m = 0;
      for (let c = 0; c < 4; c++) {
        const b = skinIndex.getComponent(i, c);
        const w = skinWeight.getComponent(i, c);
        m += (lengthByBone[b] || 1.0) * w;
      }
      // belly / underside fur hangs longer
      if (nrm.getY(i) < -0.35 && pos.getY(i) < 0.0 && pos.getY(i) > -0.3) m *= 1.4;
      furMul[i] = m;
    }
    geo.setAttribute('furMul', new THREE.BufferAttribute(furMul, 1));

    const strandTex = this.createFurStrandTexture();
    const baseMat = skinnedMesh.material;
    this.furShells = [];

    for (let s = 1; s <= FUR_SHELLS; s++) {
      const t = s / FUR_SHELLS;
      const mat = new THREE.MeshPhysicalMaterial({
        map: baseMat.map,
        normalMap: baseMat.normalMap,
        normalScale: baseMat.normalScale,
        alphaMap: strandTex,
        alphaTest: 0.08 + t * 0.7,
        roughness: 0.95 - 0.15 * t,
        metalness: 0.0,
        sheen: 0.7,
        sheenRoughness: 0.6,
        sheenColor: new THREE.Color(0xf2f5f8),
        side: THREE.FrontSide
      });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uShell = { value: t };
        shader.uniforms.uFurLength = { value: FUR_LENGTH };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float furMul;\nuniform float uShell;\nuniform float uFurLength;')
          .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n{\n  float ext = uFurLength * uShell * furMul;\n  transformed += normalize(objectNormal) * ext;\n  transformed.y -= ext * uShell * 0.45;\n}');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uShell;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= mix(0.82, 1.05, uShell);');
      };
      mat.customProgramCacheKey = () => 'snowleopard-fur-shell';

      const shell = new THREE.SkinnedMesh(geo, mat);
      shell.bind(skinnedMesh.skeleton, skinnedMesh.bindMatrix);
      shell.frustumCulled = false;
      shell.castShadow = false;
      shell.receiveShadow = true;
      shell.renderOrder = s;
      skinnedMesh.add(shell);
      this.furShells.push(shell);
    }
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

  // Coat colour: tints the baked coat (base layer and every fur shell)
  setCoat(tint) {
    this.coatTint = tint;
    if (!this.skinnedMesh) return; // applied when the model finishes loading
    this.skinnedMesh.material.color.setHex(tint);
    for (const shell of this.furShells || []) shell.material.color.setHex(tint);
  }

  // Wears (or with a null id, removes) the accessory for a slot
  setAccessory(slot, id) {
    this.equipped[slot] = id || null;
    this.attachAccessory(slot);
  }

  attachAccessory(slot) {
    const old = this.accessoryObjects[slot];
    if (old) {
      old.removeFromParent();
      old.traverse((o) => o.geometry && o.geometry.dispose());
      delete this.accessoryObjects[slot];
    }
    const item = ACCESSORY_BY_ID[this.equipped[slot]];
    if (!item || !this.skinnedMesh) return;

    const skeleton = this.skinnedMesh.skeleton;
    const boneIndex = skeleton.bones.findIndex((b) => b.name === SLOTS[slot].bone);
    if (boneIndex < 0) return;

    // The wrapper cancels the bone's bind transform, so items are authored in bind-pose model space
    const wrapper = new THREE.Group();
    skeleton.boneInverses[boneIndex].decompose(wrapper.position, wrapper.quaternion, wrapper.scale);
    wrapper.add(item.build());
    skeleton.bones[boneIndex].add(wrapper);
    this.accessoryObjects[slot] = wrapper;
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
    this.slashMesh.position.set(0.1, 0.7, 1.7);
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
    if (this.isPouncing || this.pounceCooldown > 0 || this.stamina < 20 || this.isDowned || this.dragging) return false;

    // Ambush from above: leaping down from a ledge goes further and lands far harder
    const ahead = 7;
    const ax = this.position.x + Math.sin(this.facingAngle) * ahead;
    const az = this.position.z + Math.cos(this.facingAngle) * ahead;
    const drop = this.position.y - this.terrain.getSurfaceHeight(ax, az);
    this.isAmbush = drop > AMBUSH_MIN_DROP;
    this.pounceLength = this.isAmbush ? 0.9 : this.pounceDuration;
    this.pounceSpeed = this.isAmbush ? 27 : 22;
    this.pounceArc = this.isAmbush ? 3.4 : 2.8;
    if (this.actions.Pounce) this.actions.Pounce.timeScale = this.actions.Pounce.getClip().duration / this.pounceLength;

    this.isPouncing = true;
    this.pounceTimer = this.pounceLength;
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

  // Paws at the snow to uncover buried treasure at `target`
  dig(target) {
    if (this.isSwiping || this.isPouncing || this.isDowned) return false;
    this.facingAngle = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    this.isSwiping = true;
    this.swipeTimer = this.swipeDuration;
    this.swipeCooldown = 0.35;
    this.biteTimer = 0;
    this.swipeSide = 1 - this.swipeSide;
    const name = this.swipeSide ? 'Attack_Left' : 'Attack_Right';
    const action = this.actions[name];
    if (action) {
      action.timeScale = action.getClip().duration / (this.swipeDuration + 0.12);
      this.playAction(name, 0.06, true);
    }
    for (let i = 0; i < 12; i++) this.emitSnowPuff(target);
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

  // Rebuilds stats from a saved game. Level bonuses are recomputed from the level so
  // rebalancing levelUp() also applies to existing saves.
  restoreProgress(saved) {
    const level = Math.max(1, Math.floor(saved.level));
    const gained = level - 1;
    this.level = level;
    this.xpToNext = 100;
    for (let i = 0; i < gained; i++) this.xpToNext = Math.round(this.xpToNext * 1.5);
    this.xp = THREE.MathUtils.clamp(saved.xp, 0, this.xpToNext - 1);
    this.maxHp = 100 + gained * 20;
    this.maxStamina = 100 + gained * 15;
    this.attackPower = 35 + gained * 10;

    // Never load into a dead or starving state
    this.hp = THREE.MathUtils.clamp(saved.hp, this.maxHp * 0.5, this.maxHp);
    this.stamina = THREE.MathUtils.clamp(saved.stamina, 0, this.maxStamina);
    this.hunger = THREE.MathUtils.clamp(saved.hunger, 30, this.maxHunger);
    this.preyHunted = Math.max(0, Math.floor(saved.preyHunted));
    this.meatConsumed = Math.max(0, Math.floor(saved.meatConsumed));

    this.position.set(saved.x, this.terrain.getTerrainHeight(saved.x, saved.z), saved.z);
    this.facingAngle = saved.facingAngle;
    this.mesh.position.copy(this.position);
  }

  takeDamage(amount) {
    if (this.isDowned) return;
    this.hp = Math.max(0, this.hp - amount);
    sounds.playAttackHit();
    if (this.onHurt) this.onHurt(amount);

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
    if (this.finisherTimer > 0) this.finisherTimer -= delta;
    const isMoving = inputDir.lengthSq() > 0.01 && !this.isDowned && this.finisherTimer <= 0;

    if (this.isPouncing) {
      this.pounceTimer -= delta;
      if (this.pounceTimer <= 0) {
        this.isPouncing = false;
      }
    }

    if (this.dragging) isSprintInput = false; // hauling a kill in your jaws
    if (isSprintInput && isMoving && this.stamina > 5 && !this.isStalking && !this.isDowned) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - delta * SPRINT_STAMINA_PER_SECOND);
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
      targetSpeed = this.pounceSpeed;
    } else if (isMoving) {
      if (this.isStalking) targetSpeed = this.stalkSpeed;
      else if (this.isSprinting) targetSpeed = this.sprintSpeed;
      else targetSpeed = this.walkSpeed;
      if (this.dragging) targetSpeed *= 0.6;
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

    this.terrain.resolveCollision(this.position, 1.15);

    const maxBound = this.terrain.halfSize - 15;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -maxBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -maxBound, maxBound);

    // Plant the paws: sample the drawn snow under each paw, then tilt and lift the body so all four
    // touch it. Height is set directly (no smoothing lag), so the paws don't hover when running downhill.
    const ground = this.sampleGroundUnderPaws();
    let targetY = ground.y;

    if (this.isPouncing) {
      const pounceProgress = 1 - (this.pounceTimer / this.pounceLength);
      const jumpArc = Math.sin(pounceProgress * Math.PI) * this.pounceArc;
      targetY += jumpArc;
    }

    this.position.y = targetY;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingAngle;
    const tiltBlend = Math.min(1, delta * 14);
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, ground.pitch, tiltBlend);
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, ground.roll, tiltBlend);

    // Bank into fast turns
    const speedFactor = THREE.MathUtils.clamp(this.currentSpeed / this.sprintSpeed, 0, 1);
    const targetLean = -this.turnVelocity * 0.22 * speedFactor;
    this.leanAngle = THREE.MathUtils.lerp(this.leanAngle, targetLean, delta * 6);
    this.modelRoot.rotation.z = this.leanAngle;

    this.updateCamouflage(delta);
    this.updateAnimationState(delta, isMoving);
    this.updateSnowPuffs(delta);
  }

  // Ghost of the mountains: holding still (or creeping) beside a boulder blends the coat into the
  // rock. Prey then see the leopard from far less distance. Moving fast breaks it at once.
  updateCamouflage(delta) {
    const { gap } = this.terrain.nearestObstacle(this.position, 'rock');
    const nearRock = gap < 2.5;
    const slow = this.currentSpeed < (this.isStalking ? 4.2 : 0.6);
    let target = 0;
    if (!this.isPouncing && !this.isSprinting && slow) target = nearRock ? 1 : (this.isStalking ? 0.3 : 0);
    const rate = target > this.camo ? 0.9 : 5;
    this.camo += (target - this.camo) * Math.min(1, delta * rate);
  }

  // Throat bite on a pinned animal: the snow leopard's real killing hold
  throatBite(prey) {
    if (this.isDowned) return false;
    this.facingAngle = Math.atan2(prey.position.x - this.position.x, prey.position.z - this.position.z);
    const clip = this.actions.Finisher || this.actions.Bite;
    if (clip) {
      clip.setLoop(THREE.LoopOnce, 1);
      clip.clampWhenFinished = true;
      clip.timeScale = clip.getClip().duration / 0.9;
      this.biteTimer = 0.9;
      this.playAction(clip === this.actions.Finisher ? 'Finisher' : 'Bite', 0.08, true);
    }
    this.finisherTimer = 0.9;
    sounds.playThroatBite();
    return true;
  }

  // Snow height under the four paws for the current heading -> body height, nose pitch and roll
  sampleGroundUnderPaws() {
    const sin = Math.sin(this.facingAngle);
    const cos = Math.cos(this.facingAngle);
    const { x, z } = this.position;
    const at = (lx, lz) => this.terrain.getSurfaceHeight(x + lx * cos + lz * sin, z + lz * cos - lx * sin);
    const fl = at(PAW_HALF_WIDTH, PAW_FRONT_Z);
    const fr = at(-PAW_HALF_WIDTH, PAW_FRONT_Z);
    const bl = at(PAW_HALF_WIDTH, PAW_BACK_Z);
    const br = at(-PAW_HALF_WIDTH, PAW_BACK_Z);
    const front = (fl + fr) / 2;
    const back = (bl + br) / 2;
    const span = PAW_FRONT_Z - PAW_BACK_Z;
    return {
      y: back + (front - back) * (-PAW_BACK_Z / span), // plane height under the leopard's origin
      pitch: THREE.MathUtils.clamp(Math.atan2(back - front, span), -MAX_BODY_TILT, MAX_BODY_TILT), // + = nose down
      roll: THREE.MathUtils.clamp(Math.atan2((fl + bl) - (fr + br), 4 * PAW_HALF_WIDTH), -MAX_BODY_TILT, MAX_BODY_TILT)
    };
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
      this.playAction(this.finisherTimer > 0 && this.actions.Finisher ? 'Finisher' : 'Bite', 0.12);
    } else if (this.hitTimer > 0 && !isMoving) {
      this.playAction('Hit_Left', 0.05);
    } else if (isMoving) {
      // Pick the gait from the actual speed so a slow clip is never played at sprint speed
      // (while sprinting, break into the run as soon as the leopard is moving at all briskly)
      const runThreshold = this.isSprinting ? SPRINT_RUN_SPEED : (this.locomotionClip === 'Run' ? RUN_EXIT_SPEED : RUN_ENTER_SPEED);
      let name;
      if (this.currentSpeed > runThreshold) name = 'Run';
      else name = this.isStalking ? 'ProwlWalk' : 'Walk';
      this.locomotionClip = name;
      this.playAction(name, 0.22);
      const action = this.actions[name];
      if (action) {
        // Lock the paws to the ground: playback rate follows ground speed (capped during speed changes)
        const plantedSpeed = CLIP_STRIDE_SPEED[name] * MODEL_SCALE;
        action.timeScale = THREE.MathUtils.clamp(this.currentSpeed / plantedSpeed, 0.35, MAX_GAIT_RATE);
      }
    } else {
      this.biteTimer = 0;
      this.playAction(this.isStalking ? 'ProwlIdle' : 'Idle_Look', 0.35);
    }
  }
}
