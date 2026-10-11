import * as THREE from 'three';
import { sounds } from './audio.js';
import { shortestAngleDiff } from './utils.js';

const _terrainNormal = new THREE.Vector3();

// Authentic 3D Snow Leopard with Volumetric Layered Fur Shells & Wildcraft Survival Mechanics
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
    this.hungerRate = 0.4;
    this.animTime = 0;
    this.crouchLerp = 0;

    // Snow puff particles on sprint/pounce
    this.createSnowPuffSystem();

    // Build the 3D Snow Leopard with Volumetric Fur Shells
    this.mesh = this.buildModel();
    this.scene.add(this.mesh);

    // Initial position on mountain ground
    const startY = this.terrain.getTerrainHeight(0, 0);
    this.position.set(0, startY, 0);
    this.mesh.position.copy(this.position);
  }

  // Generates high-fidelity sparse hair follicle fiber alpha texture for volumetric fur shells
  createFurStrandTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Transparent black background - only individual hair fibers are opaque
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 512, 512);

    const imgData = ctx.getImageData(0, 0, 512, 512);
    const data = imgData.data;

    let seed = 98765;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // 2,800 sharp, directional tapered hair fibers running along the coat grain
    const numFollicles = 2800;
    for (let i = 0; i < numFollicles; i++) {
      const fx = Math.floor(rnd() * 512);
      const fy = Math.floor(rnd() * 512);
      const strandLen = 4.0 + rnd() * 6.0; // Directional hair strand length
      const rad = 1.2 + rnd() * 1.2;

      for (let dy = -Math.ceil(strandLen); dy <= Math.ceil(strandLen); dy++) {
        for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
          const normY = dy / strandLen;
          const normX = dx / rad;
          const dSq = normX * normX + normY * normY;
          if (dSq <= 1.0) {
            const px = (fx + dx + 512) % 512;
            const py = (fy + dy + 512) % 512;
            const pi = (py * 512 + px) * 4;
            const val = Math.round(255 * Math.pow(1.0 - Math.sqrt(dSq), 1.3));
            data[pi] = Math.max(data[pi], val);
            data[pi + 1] = Math.max(data[pi + 1], val);
            data[pi + 2] = Math.max(data[pi + 2], val);
            data[pi + 3] = Math.max(data[pi + 3], val);
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    return tex;
  }

  // Generates authentic Snow Leopard rosette coat texture
  createFurCoatTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Circumferential Gradient: Spine (top) -> Flank (sides) -> Belly (bottom) -> Spine
    const grad = ctx.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0.00, '#98a4af'); // Dorsal spine (smoky-slate alpine grey)
    grad.addColorStop(0.12, '#c8bdae'); // Upper dorsal transition (warm golden-buff wash)
    grad.addColorStop(0.28, '#dce3ea'); // Flank (pale silver-cream)
    grad.addColorStop(0.44, '#f8fafc'); // Lower flank fading to white
    grad.addColorStop(0.50, '#ffffff'); // Ventral midline (pure snow-white underbelly)
    grad.addColorStop(0.56, '#f8fafc'); // Lower flank fading to white
    grad.addColorStop(0.72, '#dce3ea'); // Opposite flank (pale silver-cream)
    grad.addColorStop(0.88, '#c8bdae'); // Upper dorsal transition (warm golden-buff wash)
    grad.addColorStop(1.00, '#98a4af'); // Returning to dorsal spine midline
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    // Microscopic dense winter underfur grain
    for (let i = 0; i < 32000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const isBelly = Math.abs(x - 512) < 95;
      if (isBelly) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      } else {
        ctx.fillStyle = Math.random() > 0.45 ? 'rgba(160, 175, 190, 0.22)' : 'rgba(255, 255, 255, 0.45)';
      }
      ctx.fillRect(x, y, 2.0, 2.0);
    }

    // Authentic Snow Leopard Rosettes (flanks)
    for (let i = 0; i < 220; i++) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const rx = side === 1 ? (130 + Math.random() * 250) : (640 + Math.random() * 250);
      const ry = 40 + Math.random() * 920;
      const radius = 14 + Math.random() * 22;
      const numPetals = 4 + Math.floor(Math.random() * 3);

      ctx.save();
      ctx.translate(rx, ry);

      // Warm taupe-sepia shadowed center inside rosette
      ctx.fillStyle = 'rgba(162, 146, 132, 0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring of charcoal spot petals
      for (let p = 0; p < numPetals; p++) {
        const angle = (p / numPetals) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        ctx.fillStyle = '#1e2126';
        ctx.beginPath();
        ctx.arc(px, py, 4.2 + Math.random() * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Spinal streak spots along dorsal midline
    for (let i = 0; i < 85; i++) {
      const x = Math.random() > 0.5 ? Math.random() * 60 : 1024 - Math.random() * 60;
      const y = Math.random() * 1024;
      ctx.fillStyle = '#181b20';
      ctx.beginPath();
      ctx.arc(x, y, 4.0 + Math.random() * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Solid dark spots on head, face, and limbs
    for (let i = 0; i < 320; i++) {
      const sx = Math.random() * 1024;
      if (Math.abs(sx - 512) < 75) continue;
      const sy = Math.random() * 1024;
      ctx.fillStyle = '#1a1d22';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.2 + Math.random() * 3.8, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  // Authentic Tail Texture (pale silver-cream with natural rosette rings, NO solid bars)
  createTailTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0.00, '#a0abb6');
    grad.addColorStop(0.25, '#d6e0ea');
    grad.addColorStop(0.50, '#f0f4f8');
    grad.addColorStop(0.75, '#d6e0ea');
    grad.addColorStop(1.00, '#a0abb6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Dense underfur grain
    for (let i = 0; i < 16000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.45)' : 'rgba(150, 165, 180, 0.22)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Natural charcoal rosette clusters wrapping around the tail
    for (let r = 0; r < 6; r++) {
      const ry = 45 + r * 75;
      const spotsInRing = 6;
      for (let s = 0; s < spotsInRing; s++) {
        const sx = (s / spotsInRing) * 512 + (Math.random() - 0.5) * 20;
        const srad = 5.5 + Math.random() * 3.5;
        // Warm taupe center
        ctx.fillStyle = 'rgba(150, 138, 126, 0.55)';
        ctx.beginPath();
        ctx.arc(sx, ry, srad * 1.2, 0, Math.PI * 2);
        ctx.fill();
        // Charcoal petal
        ctx.fillStyle = '#1c1f24';
        ctx.beginPath();
        ctx.arc(sx, ry, srad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  // Dedicated Tail Tip Texture: PURE JET BLACK VELVET FUR (Fulfills: "Also, the end of their tail is black.")
  createBlackTailTipTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Deep rich velvety charcoal-black fur
    ctx.fillStyle = '#121417';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle dark hair fibers and soft highlights
    for (let i = 0; i < 18000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const val = Math.random();
      if (val > 0.85) {
        ctx.fillStyle = 'rgba(38, 42, 48, 0.40)'; // Soft dark charcoal fiber
      } else if (val > 0.60) {
        ctx.fillStyle = 'rgba(26, 29, 34, 0.50)';
      } else {
        ctx.fillStyle = 'rgba(8, 9, 11, 0.60)'; // Deep black fiber
      }
      ctx.fillRect(x, y, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  // Generates procedural bump map for fur grain
  createFurBumpMap() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 18000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(x, y, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  buildModel() {
    const group = new THREE.Group();

    // High-definition textures
    const coatTex = this.createFurCoatTexture();
    const tailTex = this.createTailTexture();
    const blackTipTex = this.createBlackTailTipTexture();
    const strandTex = this.createFurStrandTexture();
    const bumpTex = this.createFurBumpMap();

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({
      map: coatTex,
      bumpMap: bumpTex,
      bumpScale: 0.024,
      roughness: 0.82,
      metalness: 0.02
    });

    const tailMat = new THREE.MeshStandardMaterial({
      map: tailTex,
      bumpMap: bumpTex,
      bumpScale: 0.026,
      roughness: 0.84,
      metalness: 0.02
    });

    // Deep rich velvety jet black fur material for tail tip (Fulfills: "Also, the end of their tail is black.")
    const blackTailMat = new THREE.MeshStandardMaterial({
      map: blackTipTex,
      bumpMap: bumpTex,
      bumpScale: 0.026,
      roughness: 0.88,
      metalness: 0.01
    });

    const whiteFurMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafd,
      bumpMap: bumpTex,
      bumpScale: 0.020,
      roughness: 0.85,
      metalness: 0.01
    });

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x7faea2,
      roughness: 0.10,
      metalness: 0.12
    });

    const noseLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x443c3c,
      roughness: 0.55,
      metalness: 0.04
    });

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1c1e24,
      roughness: 0.55
    });

    // =========================================================================
    // VOLUMETRIC FUR SHELL GENERATOR ("Lay the fur on top of them")
    // Creates concentric extruded fur shells with alpha-tested hair fibers
    // =========================================================================
    const createVolumetricFur = (baseGeo, baseMat, furLength = 0.035, numShells = 5, gravityDroop = 0.008, tint = 0xffffff) => {
      const furGroup = new THREE.Group();

      // 1. Solid Base Core Mesh
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      furGroup.add(baseMesh);

      // 2. Extruded Volumetric Fur Shell Layers laid on top!
      for (let s = 1; s < numShells; s++) {
        const t = s / (numShells - 1);
        const shellGeo = baseGeo.clone();
        const sPos = shellGeo.attributes.position;
        const sNorm = shellGeo.attributes.normal;

        for (let i = 0; i < sPos.count; i++) {
          const nx = sNorm.getX(i);
          const ny = sNorm.getY(i);
          const nz = sNorm.getZ(i);
          const ext = furLength * t;

          const gx = sPos.getX(i) + nx * ext;
          const gy = sPos.getY(i) + ny * ext - t * t * gravityDroop;
          const gz = sPos.getZ(i) + nz * ext;
          sPos.setXYZ(i, gx, gy, gz);
        }
        shellGeo.computeVertexNormals();

        // Ambient Occlusion: roots are shadowed, hair tips catch sunlight
        const aoFactor = 0.55 + 0.45 * t;
        const shellColor = new THREE.Color(tint).multiplyScalar(aoFactor);

        const shellMat = new THREE.MeshStandardMaterial({
          map: baseMat.map || null,
          alphaMap: strandTex,
          transparent: true,
          alphaTest: 0.14 + t * 0.52,
          color: baseMat.map ? shellColor : new THREE.Color(baseMat.color).multiplyScalar(aoFactor),
          bumpMap: bumpTex,
          bumpScale: 0.018,
          roughness: 0.88 - 0.18 * t,
          metalness: 0.01,
          depthWrite: true,
          depthTest: true
        });

        const shellMesh = new THREE.Mesh(shellGeo, shellMat);
        shellMesh.castShadow = (s === numShells - 1);
        furGroup.add(shellMesh);
      }

      return furGroup;
    };

    // Helper: Sculpted organic capsule along Z-axis (completely smooth, NO flat end caps!)
    const createSmoothCapsule = (radius, length, capSegs = 8, radSegs = 16, scaleX = 1.0, scaleY = 1.0, dorsalPeak = 1.0) => {
      const geo = new THREE.CapsuleGeometry(radius, length, capSegs, radSegs);
      geo.rotateX(Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) * scaleX;
        let y = pos.getY(i) * scaleY;
        let z = pos.getZ(i);
        if (y > 0) y *= dorsalPeak;
        pos.setXYZ(i, x, y, z);
      }
      geo.computeVertexNormals();
      return geo;
    };

    // Root node for crouching / movement
    this.bodyRoot = new THREE.Group();
    group.add(this.bodyRoot);

    // =========================================================================
    // 1. ATHLETIC FELINE TORSO WITH PLUSH VOLUMETRIC FUR SHELLS (Smooth Overlapping Anatomy)
    // =========================================================================
    // Deep chest with broad shoulder girdle
    const chestGeo = createSmoothCapsule(0.34, 0.64, 8, 16, 0.96, 1.10, 1.05);
    const chestFur = createVolumetricFur(chestGeo, bodyMat, 0.036, 5, 0.008);
    chestFur.position.set(0, 1.25, 0.22);
    this.chest = chestFur;
    this.bodyRoot.add(chestFur);

    // Dynamic Muscular Scapulae (Shoulder blades with thick plush fur)
    const scapulaGeo = createSmoothCapsule(0.15, 0.30, 6, 12, 0.70, 1.22, 1.10);
    const leftScapFur = createVolumetricFur(scapulaGeo, bodyMat, 0.032, 5, 0.006);
    leftScapFur.position.set(0.26, 0.18, 0.10);
    leftScapFur.rotation.set(-0.15, 0, 0.16);
    this.chest.add(leftScapFur);
    this.leftScapula = leftScapFur;

    const rightScapFur = createVolumetricFur(scapulaGeo, bodyMat, 0.032, 5, 0.006);
    rightScapFur.position.set(-0.26, 0.18, 0.10);
    rightScapFur.rotation.set(-0.15, -0, -0.16);
    this.chest.add(rightScapFur);
    this.rightScapula = rightScapFur;

    // Flank / Waist (seamless feline tuck-up smoothly bridging chest and pelvis)
    const waistGeo = createSmoothCapsule(0.31, 0.60, 8, 16, 0.90, 0.96, 1.02);
    const waistFur = createVolumetricFur(waistGeo, bodyMat, 0.035, 5, 0.008);
    waistFur.position.set(0, 1.24, -0.26);
    this.waist = waistFur;
    this.bodyRoot.add(waistFur);

    // Pelvis / Haunches (broad muscular haunches with thick plush fur)
    const hipsGeo = createSmoothCapsule(0.33, 0.54, 8, 16, 1.02, 1.02, 1.03);
    const hipsFur = createVolumetricFur(hipsGeo, bodyMat, 0.036, 5, 0.008);
    hipsFur.position.set(0, 1.25, -0.72);
    this.hips = hipsFur;
    this.bodyRoot.add(hipsFur);

    // Shaggy Snow-White Underbelly Apron (soft hanging winter fur)
    const bellyGeo = createSmoothCapsule(0.22, 1.05, 8, 16, 0.92, 0.40, 1.0);
    const bellyFur = createVolumetricFur(bellyGeo, whiteFurMat, 0.042, 5, 0.015);
    bellyFur.position.set(0, 0.96, -0.20);
    this.bodyRoot.add(bellyFur);

    // =========================================================================
    // 2. MUSCULAR CERVICAL COLUMN & SCULPTED FELINE HEAD WITH FUR RUFF
    // =========================================================================
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.42, 0.72);
    this.bodyRoot.add(this.neck);

    // Muscular neck with thick winter fur ruff (6.8cm fur thickness!)
    const neckGeo = createSmoothCapsule(0.28, 0.42, 8, 16, 0.94, 1.12, 1.08);
    const neckFur = createVolumetricFur(neckGeo, bodyMat, 0.068, 6, 0.018);
    neckFur.position.set(0, 0.16, 0.22);
    neckFur.rotation.x = 0.32;
    this.neck.add(neckFur);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.38, 0.58);
    this.neck.add(this.head);

    // Sculpted Alpine Feline Skull (domed cranium, wide cheekbones)
    const skullGeo = new THREE.SphereGeometry(0.30, 18, 14);
    skullGeo.scale(0.96, 0.80, 1.12);
    const sPos = skullGeo.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      let x = sPos.getX(i);
      let y = sPos.getY(i);
      let z = sPos.getZ(i);
      if (y > 0.08 && z > -0.05 && z < 0.22) y *= 1.10;
      if (z > -0.05 && z < 0.18 && y > -0.12 && y < 0.08) x *= 1.20;
      if (z > 0.12 && y > 0) y -= (z - 0.12) * 0.30;
      sPos.setXYZ(i, x, y, z);
    }
    skullGeo.computeVertexNormals();
    const skullFur = createVolumetricFur(skullGeo, bodyMat, 0.036, 5, 0.008);
    this.head.add(skullFur);

    // Wide, sloping nasal bridge (wide mountain feline air chamber)
    const bridgeGeo = createSmoothCapsule(0.08, 0.22, 6, 12, 1.15, 0.85, 1.0);
    const bridgeFur = createVolumetricFur(bridgeGeo, bodyMat, 0.024, 4, 0.004);
    bridgeFur.position.set(0, 0.04, 0.22);
    bridgeFur.rotation.x = -0.16;
    this.head.add(bridgeFur);

    // Authentic Feline Whisker Pads (Left and Right rounded velvet lobes)
    for (let side = -1; side <= 1; side += 2) {
      const padGeo = new THREE.SphereGeometry(0.085, 12, 10);
      padGeo.scale(1.0, 0.65, 1.25);
      const padFur = createVolumetricFur(padGeo, whiteFurMat, 0.028, 4, 0.005);
      padFur.position.set(side * 0.075, -0.05, 0.34);
      this.head.add(padFur);
    }

    // Sculpted feline chin / lower jaw tucked underneath
    const chinGeo = new THREE.SphereGeometry(0.075, 12, 8);
    chinGeo.scale(0.85, 0.55, 1.15);
    const chinFur = createVolumetricFur(chinGeo, whiteFurMat, 0.028, 4, 0.008);
    chinFur.position.set(0, -0.12, 0.28);
    this.head.add(chinFur);

    // Realistic Feline Nose Pad (rhinarium): Flat heart-shaped leather pad (NO CONE!)
    const noseGeo = new THREE.BoxGeometry(0.058, 0.034, 0.018);
    const nPos = noseGeo.attributes.position;
    for (let i = 0; i < nPos.count; i++) {
      let x = nPos.getX(i);
      let y = nPos.getY(i);
      let z = nPos.getZ(i);
      if (y < 0) x *= 0.68;
      nPos.setXYZ(i, x, y, z);
    }
    noseGeo.computeVertexNormals();
    const nose = new THREE.Mesh(noseGeo, noseLeatherMat);
    nose.position.set(0, -0.015, 0.42);
    this.head.add(nose);

    // Predatory Almond-Shaped Eyes (Pale Icy Glacial Green, hooded brow)
    for (let side = -1; side <= 1; side += 2) {
      const socketGeo = new THREE.SphereGeometry(0.065, 10, 8);
      socketGeo.scale(1.25, 0.70, 0.65);
      const eyeSocket = new THREE.Mesh(socketGeo, darkMat);
      eyeSocket.position.set(side * 0.145, 0.07, 0.22);
      eyeSocket.rotation.z = side * -0.18;
      this.head.add(eyeSocket);

      const irisGeo = new THREE.SphereGeometry(0.052, 12, 10);
      irisGeo.scale(1.0, 0.85, 0.55);
      const eye = new THREE.Mesh(irisGeo, eyeMat);
      eye.position.set(side * 0.145, 0.07, 0.245);
      eye.rotation.z = side * -0.18;
      this.head.add(eye);

      const pupilGeo = new THREE.BoxGeometry(0.016, 0.068, 0.025);
      const pupil = new THREE.Mesh(pupilGeo, darkMat);
      pupil.position.set(side * 0.145, 0.07, 0.265);
      this.head.add(pupil);

      const glintGeo = new THREE.SphereGeometry(0.012, 6, 6);
      const glint = new THREE.Mesh(glintGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(side * 0.155, 0.085, 0.275);
      this.head.add(glint);
    }

    // Small rounded ears set low and wide with white insulating inner fur tufts
    for (let side = -1; side <= 1; side += 2) {
      const earShellGeo = new THREE.SphereGeometry(0.09, 10, 8);
      earShellGeo.scale(0.85, 1.10, 0.40);
      const earShell = new THREE.Mesh(earShellGeo, bodyMat);
      earShell.position.set(side * 0.22, 0.16, -0.06);
      earShell.rotation.set(-0.35, 0, side * -0.42);
      this.head.add(earShell);

      const earInnerGeo = new THREE.SphereGeometry(0.07, 8, 6);
      earInnerGeo.scale(0.80, 0.95, 0.35);
      const earInner = createVolumetricFur(earInnerGeo, whiteFurMat, 0.038, 4, 0.005);
      earInner.position.set(side * 0.21, 0.16, -0.04);
      earInner.rotation.set(-0.35, 0, side * -0.42);
      this.head.add(earInner);
    }

    // Sensory Vibrissae Whiskers
    const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    for (let w = -1; w <= 1; w++) {
      for (let side = -1; side <= 1; side += 2) {
        const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.002, 0.40, 4), whiskerMat);
        whisker.rotation.z = side * (Math.PI / 2 + w * 0.18);
        whisker.rotation.x = -0.15;
        whisker.position.set(side * 0.18, -0.05 + w * 0.03, 0.36);
        this.head.add(whisker);
      }
    }

    // =========================================================================
    // 3. THE ICONIC SNOW LEOPARD TAIL WITH PLUSH VOLUMETRIC FUR & JET BLACK FUR TIP
    // 7 Articulated segments with natural feline curvature and authentic black fur brush tip!
    // =========================================================================
    this.tailSegments = [];
    let parentTailNode = this.hips;
    const numSegments = 7;

    for (let i = 0; i < numSegments; i++) {
      const segGroup = new THREE.Group();
      // Graceful natural feline curve: slopes downward from pelvis, levels out, and curls upward at black tip
      if (i === 0) {
        segGroup.position.set(0, -0.04, -0.32);
        segGroup.rotation.x = -0.32;
      } else if (i === 1) {
        segGroup.position.set(0, -0.06, -0.22);
        segGroup.rotation.x = -0.22;
      } else if (i === 2) {
        segGroup.position.set(0, -0.05, -0.22);
        segGroup.rotation.x = -0.08;
      } else if (i === 3) {
        segGroup.position.set(0, -0.02, -0.22);
        segGroup.rotation.x = 0.08;
      } else if (i === 4) {
        segGroup.position.set(0, 0.03, -0.22);
        segGroup.rotation.x = 0.22;
      } else if (i === 5) {
        // Penultimate segment: transition into deep black fur
        segGroup.position.set(0, 0.07, -0.20);
        segGroup.rotation.x = 0.35;
      } else {
        // Terminal tip segment: JET BLACK FUR TIP (Fulfills: "Also, the end of their tail is black.")
        segGroup.position.set(0, 0.10, -0.18);
        segGroup.rotation.x = 0.45;
      }

      // Authentic woolly snow leopard tail girth (0.065 to 0.08m core + 0.035m fur = ~0.20-0.22m thick woolly tail)
      const isBlackTip = (i >= numSegments - 2);
      const isFinalTip = (i === numSegments - 1);
      const tailRadius = 0.065 + Math.sin((i / numSegments) * Math.PI) * 0.016;

      const segGeo = createSmoothCapsule(
        isFinalTip ? tailRadius * 0.85 : tailRadius,
        isFinalTip ? 0.20 : 0.24,
        6,
        14
      );

      // Dedicated materials: pale silver rosette coat on base/mid, JET BLACK FUR on the tip!
      const currentMat = isBlackTip ? blackTailMat : tailMat;
      const segFur = createVolumetricFur(segGeo, currentMat, 0.035, 5, 0.008);
      segGroup.add(segFur);

      // On the final tip, add a soft rounded plush dome tuft with dense black fur fibers
      if (isFinalTip) {
        const tipDomeGeo = new THREE.SphereGeometry(tailRadius * 0.88, 10, 8);
        tipDomeGeo.scale(1.0, 1.0, 1.25);
        const tipDomeFur = createVolumetricFur(tipDomeGeo, blackTailMat, 0.038, 5, 0.005);
        tipDomeFur.position.set(0, 0, -0.12);
        segGroup.add(tipDomeFur);
      }

      parentTailNode.add(segGroup);
      this.tailSegments.push(segGroup);
      parentTailNode = segGroup;
    }

    // =========================================================================
    // 4. 3D LUMINOUS CLAW SLASH ARC EFFECT
    // =========================================================================
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
    this.slashMesh.position.set(0.1, 1.15, 1.2);
    this.slashMesh.rotation.y = -0.3;
    this.bodyRoot.add(this.slashMesh);

    // =========================================================================
    // 5. FOUR ARTICULATED LIMBS WITH VOLUMETRIC FUR & EXTRA-LARGE SNOWSHOE PAWS
    // =========================================================================
    this.legs = {
      frontLeft: this.createLeg(0.36, 1.15, 0.58, bodyMat, whiteFurMat, darkMat, strandTex, createVolumetricFur, createSmoothCapsule, false),
      frontRight: this.createLeg(-0.36, 1.15, 0.58, bodyMat, whiteFurMat, darkMat, strandTex, createVolumetricFur, createSmoothCapsule, false),
      backLeft: this.createLeg(0.33, 1.18, -0.82, bodyMat, whiteFurMat, darkMat, strandTex, createVolumetricFur, createSmoothCapsule, true),
      backRight: this.createLeg(-0.33, 1.18, -0.82, bodyMat, whiteFurMat, darkMat, strandTex, createVolumetricFur, createSmoothCapsule, true)
    };

    Object.values(this.legs).forEach((leg) => this.bodyRoot.add(leg.root));

    return group;
  }

  createLeg(x, y, z, mat, pawMat, clawMat, strandTex, createVolumetricFur, createSmoothCapsule, isBack = false) {
    const root = new THREE.Group();
    root.position.set(x, y, z);

    // Upper thigh / shoulder with plush fur shells (Smooth capsule)
    const upperLen = isBack ? 0.44 : 0.32;
    const upperRadius = isBack ? 0.18 : 0.14;
    const upperGeo = createSmoothCapsule(upperRadius, upperLen, 6, 12, isBack ? 0.88 : 0.95, 1.0, isBack ? 1.25 : 1.05);

    const upperFur = createVolumetricFur(upperGeo, mat, 0.045, 5, 0.010);
    upperFur.position.y = -upperLen * 0.65;
    root.add(upperFur);

    // Knee / Hock joint
    const lowerJoint = new THREE.Group();
    lowerJoint.position.set(0, -upperLen * 1.15, isBack ? -0.10 : 0.04);
    root.add(lowerJoint);

    // Forearm / Gaskin with fur shells (Smooth capsule)
    const lowerLen = isBack ? 0.36 : 0.30;
    const lowerRadius = isBack ? 0.11 : 0.10;
    const lowerGeo = createSmoothCapsule(lowerRadius, lowerLen, 6, 12);

    const lowerFur = createVolumetricFur(lowerGeo, mat, 0.040, 5, 0.008);
    lowerFur.position.y = -lowerLen * 0.65;
    lowerJoint.add(lowerFur);

    // Extra-Large "Snowshoe" Paw: Broad rounded fur cushion (Ellipsoid dome, NO flat puck!)
    const pawGeo = new THREE.SphereGeometry(0.18, 14, 10);
    pawGeo.scale(1.15, 0.42, 1.35);
    pawGeo.computeVertexNormals();

    const pawFur = createVolumetricFur(pawGeo, pawMat, 0.042, 5, 0.005);
    pawFur.position.set(0, -lowerLen * 1.08, 0.10);
    lowerJoint.add(pawFur);

    // 4 Digitigrade cushioned toe lobes
    const toeOffsets = [-0.10, -0.035, 0.035, 0.10];
    for (let i = 0; i < 4; i++) {
      const tx = toeOffsets[i];
      const toeGeo = new THREE.SphereGeometry(0.045, 8, 6);
      toeGeo.scale(0.85, 0.65, 1.15);
      const toe = new THREE.Mesh(toeGeo, pawMat);
      toe.position.set(tx, -lowerLen * 1.09, 0.25);
      lowerJoint.add(toe);

      // Dark claws
      const clawGeo = new THREE.ConeGeometry(0.014, 0.058, 4);
      clawGeo.rotateX(Math.PI / 2.2);
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.set(tx, -lowerLen * 1.10, 0.30);
      lowerJoint.add(claw);
    }

    return { root, lowerJoint };
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

    for (let i = 0; i < 10; i++) {
      this.emitSnowPuff(this.position);
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

    if (this.slashMesh) {
      this.slashMesh.material.opacity = 0.95;
      this.slashMesh.scale.set(0.65, 0.65, 0.65);
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
      if (this.onDeath) this.onDeath();
      else this.respawnAtCamp();
    }
  }

  respawnAtCamp() {
    this.isDowned = false;
    this.hp = Math.round(this.maxHp * 0.5);
    this.hunger = Math.max(30, this.hunger);
    this.position.set(0, this.terrain.getTerrainHeight(0, 0), 0);
  }

  reviveHere() {
    this.isDowned = false;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.hunger = Math.max(60, this.hunger);
  }

  update(delta, inputDir, isSprintInput, isStalkInput) {
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

    const norm = this.terrain.getTerrainNormal(this.position.x, this.position.z, _terrainNormal);
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, (norm.z * 0.4), delta * 8);
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, (-norm.x * 0.4), delta * 8);

    this.updateAnimation(delta, isMoving);
    this.updateSnowPuffs(delta);
  }

  updateAnimation(delta, isMoving) {
    const animRate = this.isSprinting ? 11.5 : (this.isStalking ? 4.2 : 6.8);
    if (isMoving || this.isPouncing) {
      this.animTime += delta * animRate;
    }

    const targetCrouch = this.isStalking ? 1 : 0;
    this.crouchLerp = THREE.MathUtils.lerp(this.crouchLerp, targetCrouch, delta * 6);

    this.bodyRoot.position.y = -this.crouchLerp * 0.48;
    this.chest.rotation.x = this.crouchLerp * 0.12;
    this.neck.position.y = 1.42 - this.crouchLerp * 0.58;
    this.neck.rotation.x = 0.32 - this.crouchLerp * 0.20;
    this.head.rotation.x = this.crouchLerp * 0.18;

    const tailBasePitches = [-0.32, -0.22, -0.08, 0.08, 0.22, 0.35, 0.45];

    // 1. POUNCE LEAP ATTACK POSE & AIR STABILIZER
    if (this.isPouncing) {
      const pProgress = 1 - (this.pounceTimer / this.pounceDuration);
      const arc = Math.sin(pProgress * Math.PI);

      this.legs.frontLeft.root.rotation.x = -1.20 + arc * 0.35;
      this.legs.frontRight.root.rotation.x = -1.20 + arc * 0.35;
      this.legs.frontLeft.lowerJoint.rotation.x = 0.35;
      this.legs.frontRight.lowerJoint.rotation.x = 0.35;

      this.legs.backLeft.root.rotation.x = 1.15;
      this.legs.backRight.root.rotation.x = 1.15;
      this.legs.backLeft.lowerJoint.rotation.x = 0.18;
      this.legs.backRight.lowerJoint.rotation.x = 0.18;

      this.tailSegments.forEach((seg, idx) => {
        seg.rotation.x = tailBasePitches[idx] + 0.20;
        seg.rotation.y = 0;
      });

      this.head.rotation.x = 0.15;
      return;
    }

    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0, delta * 8);

    // 2. SPRINT: ROTARY BOUNDING GALLOP
    if (this.isSprinting && isMoving) {
      const gTime = this.animTime;
      const gSin = Math.sin(gTime);

      this.chest.position.y = 1.25 - gSin * 0.10;
      this.hips.position.y = 1.28 + Math.abs(gSin) * 0.18;
      this.hips.rotation.x = -gSin * 0.22;

      const hindPropulsion = Math.max(-0.6, gSin * 0.95);
      this.legs.backLeft.root.rotation.x = hindPropulsion;
      this.legs.backRight.root.rotation.x = hindPropulsion - 0.15;
      this.legs.backLeft.lowerJoint.rotation.x = gSin < 0 ? Math.abs(gSin) * 0.85 : 0.15;
      this.legs.backRight.lowerJoint.rotation.x = gSin < 0 ? Math.abs(gSin) * 0.85 : 0.15;

      const frontReach = -hindPropulsion * 0.90;
      this.legs.frontLeft.root.rotation.x = frontReach;
      this.legs.frontRight.root.rotation.x = frontReach + 0.15;
      this.legs.frontLeft.lowerJoint.rotation.x = gSin > 0 ? 0.35 : 0.10;
      this.legs.frontRight.lowerJoint.rotation.x = gSin > 0 ? 0.35 : 0.10;

      if (this.leftScapula && this.rightScapula) {
        this.leftScapula.position.y = 0.22 + gSin * 0.08;
        this.rightScapula.position.y = 0.22 - gSin * 0.08;
      }

      const rudderTurn = -this.turnVelocity * 0.80;
      this.tailSegments.forEach((seg, idx) => {
        const wave = Math.sin(gTime - idx * 0.52);
        seg.rotation.x = tailBasePitches[idx] + wave * 0.18;
        seg.rotation.y = rudderTurn * (idx * 0.24) + Math.sin(gTime * 0.5 - idx * 0.38) * 0.10;
      });

      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, 0, delta * 8);
    }
    // 3. WALK & STALK: 4-BEAT LATERAL SEQUENCE GAIT
    else if (isMoving) {
      const strideAmp = this.isStalking ? 0.38 : 0.58;

      const legPhases = {
        backLeft: 0.00,
        frontLeft: 0.25,
        backRight: 0.50,
        frontRight: 0.75
      };

      const calcLegMotion = (phaseOffset) => {
        const cycle = (this.animTime + phaseOffset * Math.PI * 2) % (Math.PI * 2);
        const sin = Math.sin(cycle);
        const cos = Math.cos(cycle);
        const rootRot = sin * strideAmp;
        const jointFlex = sin < 0 ? Math.abs(sin) * (strideAmp * 1.35) : Math.max(0, cos * 0.12);
        return { rootRot, jointFlex };
      };

      const fl = calcLegMotion(legPhases.frontLeft);
      const fr = calcLegMotion(legPhases.frontRight);
      const bl = calcLegMotion(legPhases.backLeft);
      const br = calcLegMotion(legPhases.backRight);

      this.legs.frontLeft.root.rotation.x = fl.rootRot;
      this.legs.frontLeft.lowerJoint.rotation.x = fl.jointFlex;

      this.legs.frontRight.root.rotation.x = fr.rootRot;
      this.legs.frontRight.lowerJoint.rotation.x = fr.jointFlex;

      this.legs.backLeft.root.rotation.x = bl.rootRot;
      this.legs.backLeft.lowerJoint.rotation.x = bl.jointFlex;

      this.legs.backRight.root.rotation.x = br.rootRot;
      this.legs.backRight.lowerJoint.rotation.x = br.jointFlex;

      if (this.leftScapula && this.rightScapula) {
        const scapRoll = Math.sin(this.animTime + legPhases.frontLeft * Math.PI * 2) * (this.isStalking ? 0.10 : 0.07);
        this.leftScapula.position.y = 0.22 + scapRoll;
        this.rightScapula.position.y = 0.22 - scapRoll;
        this.leftScapula.rotation.x = -0.15 + scapRoll * 1.3;
        this.rightScapula.rotation.x = -0.15 - scapRoll * 1.3;
      }

      const spineSway = Math.sin(this.animTime * 0.5) * (this.isStalking ? 0.025 : 0.045);
      this.chest.rotation.y = spineSway;
      this.hips.rotation.y = -spineSway * 1.2;
      this.hips.rotation.x = Math.sin(this.animTime) * 0.04;
      this.chest.position.y = 1.25 + Math.abs(Math.sin(this.animTime)) * 0.035;

      if (this.isStalking) {
        this.tailSegments.forEach((seg, idx) => {
          const tipTwitch = idx >= 4 ? Math.sin(this.animTime * 1.6) * 0.18 : 0;
          seg.rotation.x = tailBasePitches[idx] + 0.10;
          seg.rotation.y = Math.sin(this.animTime * 0.35) * 0.04 + tipTwitch;
        });
      } else {
        this.tailSegments.forEach((seg, idx) => {
          const sway = Math.sin(this.animTime * 0.65 - idx * 0.42) * 0.14;
          seg.rotation.y = sway;
          seg.rotation.x = tailBasePitches[idx] + Math.sin(this.animTime * 0.65 - idx * 0.32) * 0.05;
        });
      }

      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, 0, delta * 8);
    }
    // 4. IDLE: GENTLE BREATHING & AWARE POSTURE
    else {
      const breathSin = Math.sin(this.animTime * 0.7);
      this.chest.position.y = 1.25 + breathSin * 0.02;
      this.chest.scale.set(1.0 + breathSin * 0.012, 1.0 + breathSin * 0.012, 1.0);
      this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, 1.26, delta * 6);
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, 0, delta * 6);
      this.chest.rotation.y = THREE.MathUtils.lerp(this.chest.rotation.y, 0, delta * 6);
      this.hips.rotation.y = THREE.MathUtils.lerp(this.hips.rotation.y, 0, delta * 6);

      this.head.rotation.y = Math.sin(this.animTime * 0.25) * 0.06;
      this.head.rotation.x = Math.sin(this.animTime * 0.35) * 0.025;

      if (this.leftScapula && this.rightScapula) {
        this.leftScapula.position.y = THREE.MathUtils.lerp(this.leftScapula.position.y, 0.22, delta * 6);
        this.rightScapula.position.y = THREE.MathUtils.lerp(this.rightScapula.position.y, 0.22, delta * 6);
      }

      this.tailSegments.forEach((seg, idx) => {
        const sway = Math.sin(this.animTime * 0.4 - idx * 0.35) * 0.05;
        seg.rotation.y = sway;
        seg.rotation.x = tailBasePitches[idx] + Math.sin(this.animTime * 0.35 - idx * 0.28) * 0.025;
      });

      Object.values(this.legs).forEach((l) => {
        l.root.rotation.x = THREE.MathUtils.lerp(l.root.rotation.x, 0, delta * 8);
        l.lowerJoint.rotation.x = THREE.MathUtils.lerp(l.lowerJoint.rotation.x, 0.10, delta * 8);
      });
    }

    // 5. PAW SWIPE ATTACK (Fast slashing strike)
    if (this.isSwiping) {
      const swipeProgress = 1 - (this.swipeTimer / this.swipeDuration);
      const slashArc = Math.sin(swipeProgress * Math.PI);
      this.legs.frontRight.root.rotation.x = -1.25 * slashArc;
      this.legs.frontRight.root.rotation.z = -0.60 * slashArc;
      this.legs.frontRight.root.rotation.y = 0.50 * slashArc;
      this.legs.frontRight.lowerJoint.rotation.x = 0.80 * slashArc;
      this.head.rotation.y = -0.25 * slashArc;
    } else {
      const fr = this.legs.frontRight.root.rotation;
      fr.y = THREE.MathUtils.lerp(fr.y, 0, delta * 10);
      fr.z = THREE.MathUtils.lerp(fr.z, 0, delta * 10);
    }
  }
}
