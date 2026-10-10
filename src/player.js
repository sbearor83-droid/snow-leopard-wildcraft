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

    // Base smoky alpine cream coat with cold blue-grey tint
    ctx.fillStyle = '#dde5eb';
    ctx.fillRect(0, 0, 1024, 1024);

    // Warm ochre-tan dorsal mantle fading into snowy white flanks and underbelly
    const grad = ctx.createLinearGradient(0, 0, 0, 1024);
    grad.addColorStop(0.0, '#b4becc'); // Dorsal spine top shade
    grad.addColorStop(0.18, '#cec3b4'); // Warm golden-tan mantle wash
    grad.addColorStop(0.42, '#dfe7ee'); // Pale silver flanks
    grad.addColorStop(0.75, '#f4f7fa'); // Pure snow-white belly/throat
    grad.addColorStop(1.0, '#ffffff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    // Microscopic fur grain fibers (dense winter coat underfur)
    for (let i = 0; i < 24000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      ctx.fillStyle = Math.random() > 0.42 ? 'rgba(175, 192, 210, 0.24)' : 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(x, y, 2.2, 2.2);
    }

    // Authentic Snow Leopard Rosettes (open rings with broken charcoal petal spots & warm shadowed centers)
    for (let i = 0; i < 180; i++) {
      const rx = Math.random() * 1024;
      const ry = 50 + Math.random() * 820; // Concentrated on back, flanks, and thighs
      const radius = 13 + Math.random() * 20;
      const numPetals = 4 + Math.floor(Math.random() * 3);

      ctx.save();
      ctx.translate(rx, ry);

      // Warm taupe-sepia shadowed center inside rosette
      ctx.fillStyle = 'rgba(168, 149, 134, 0.45)';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring of charcoal spot petals
      for (let p = 0; p < numPetals; p++) {
        const angle = (p / numPetals) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        ctx.fillStyle = '#22252b';
        ctx.beginPath();
        ctx.arc(px, py, 4.5 + Math.random() * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Solid dark spots on lower limbs, face, ears, and tail rings
    for (let i = 0; i < 320; i++) {
      const sx = Math.random() * 1024;
      const sy = Math.random() * 1024;
      ctx.fillStyle = '#1b1d22';
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5 + Math.random() * 4.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tail ring bands across the bottom quadrant
    for (let r = 0; r < 5; r++) {
      ctx.fillStyle = 'rgba(26, 29, 34, 0.72)';
      ctx.fillRect(0, 920 + r * 20, 1024, 12);
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  // Generates procedural bump map for alpine fur grain and rosette depth
  createFurBumpMap() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 512, 512);

    // Fine fur grain embossing
    for (let i = 0; i < 15000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.16)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Embossed rosette rims
    for (let i = 0; i < 90; i++) {
      const rx = Math.random() * 512;
      const ry = 40 + Math.random() * 420;
      const r = 8 + Math.random() * 12;

      ctx.strokeStyle = 'rgba(40, 40, 40, 0.35)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  buildModel() {
    const group = new THREE.Group();
    const furTex = this.createFurTexture();
    const bumpTex = this.createFurBumpMap();

    const bodyMat = new THREE.MeshStandardMaterial({
      map: furTex,
      bumpMap: bumpTex,
      bumpScale: 0.028,
      roughness: 0.82,
      metalness: 0.02
    });

    const whiteFurMat = new THREE.MeshStandardMaterial({
      color: 0xf6f9fc,
      bumpMap: bumpTex,
      bumpScale: 0.022,
      roughness: 0.86,
      metalness: 0.01
    });

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x181a1f,
      roughness: 0.55
    });

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xd4a038, // Piercing predatory amber feline iris
      roughness: 0.12,
      metalness: 0.25
    });

    const noseMat = new THREE.MeshStandardMaterial({
      color: 0x3f3939, // Slate dark feline leather nose pad
      roughness: 0.62
    });

    // Helper: Sculpted organic cylinder lying along the Z-axis with smooth feline contour
    const createOrganicVolume = (rTop, rBottom, length, radSegs = 16, hSegs = 6, scaleX = 1.0, scaleY = 1.0, dorsalPeak = 1.05) => {
      const geo = new THREE.CylinderGeometry(rTop, rBottom, length, radSegs, hSegs);
      geo.rotateX(Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        x *= scaleX;
        y *= scaleY;
        if (y > 0) y *= dorsalPeak; // Muscular spine ridge at the top
        pos.setXYZ(i, x, y, z);
      }
      geo.computeVertexNormals();
      return geo;
    };

    // Root node for crouching / body shifts
    this.bodyRoot = new THREE.Group();
    group.add(this.bodyRoot);

    // --- 1. Athletic Sculpted Feline Torso (Deep chest, narrow waist, muscular haunches) ---
    // Deep feline chest with broad shoulder girdle
    const chestGeo = createOrganicVolume(0.38, 0.42, 1.25, 18, 6, 0.98, 1.12, 1.06);
    const chest = new THREE.Mesh(chestGeo, bodyMat);
    chest.position.set(0, 1.25, 0.35);
    chest.castShadow = true;
    this.chest = chest;
    this.bodyRoot.add(chest);

    // Flank / Waist (athletic feline tuck-up, narrower than chest)
    const waistGeo = createOrganicVolume(0.31, 0.35, 0.76, 18, 6, 0.90, 0.96, 1.03);
    const waist = new THREE.Mesh(waistGeo, bodyMat);
    waist.position.set(0, 1.22, -0.40);
    waist.castShadow = true;
    this.bodyRoot.add(waist);

    // Pelvis / Rump (broad muscular big-cat haunches)
    const hipsGeo = createOrganicVolume(0.36, 0.33, 0.74, 18, 6, 1.06, 1.04, 1.04);
    const hips = new THREE.Mesh(hipsGeo, bodyMat);
    hips.position.set(0, 1.25, -0.92);
    hips.castShadow = true;
    this.hips = hips;
    this.bodyRoot.add(hips);

    // Pure snow-white fur underbelly plate
    const bellyGeo = createOrganicVolume(0.24, 0.28, 1.82, 16, 4, 0.95, 0.45, 1.0);
    const belly = new THREE.Mesh(bellyGeo, whiteFurMat);
    belly.position.set(0, 0.88, -0.15);
    this.bodyRoot.add(belly);

    // --- 2. Muscular Neck & Realistic Predator Head ---
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.42, 0.85);
    this.bodyRoot.add(this.neck);

    // Muscular feline cervical column arching forward
    const neckGeo = createOrganicVolume(0.28, 0.36, 0.78, 16, 6, 0.94, 1.12, 1.08);
    const neckMesh = new THREE.Mesh(neckGeo, bodyMat);
    neckMesh.position.set(0, 0.18, 0.25);
    neckMesh.rotation.x = 0.32;
    neckMesh.castShadow = true;
    this.neck.add(neckMesh);

    this.head = new THREE.Group();
    this.head.position.set(0, 0.42, 0.65);
    this.neck.add(this.head);

    // Authentic Sculpted Feline Skull (compact cranium, flattened crown, flared cheekbones)
    const skullGeo = new THREE.SphereGeometry(0.32, 16, 14);
    skullGeo.scale(0.96, 0.80, 1.16);
    const sPos = skullGeo.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      let x = sPos.getX(i);
      let y = sPos.getY(i);
      let z = sPos.getZ(i);
      // Flatten skull roof
      if (y > 0.12) y *= 0.86;
      // Zygomatic arches (cheekbones flare outwards below the eyes)
      if (z > -0.05 && z < 0.18 && y > -0.12 && y < 0.08) {
        x *= 1.24;
      }
      // Sloping brow ridge toward snout bridge
      if (z > 0.06 && y > 0) y -= (z - 0.06) * 0.30;
      sPos.setXYZ(i, x, y, z);
    }
    skullGeo.computeVertexNormals();

    const skull = new THREE.Mesh(skullGeo, bodyMat);
    skull.castShadow = true;
    this.head.add(skull);

    // Sloping nasal bridge connecting cranium to muzzle
    const bridgeGeo = createOrganicVolume(0.12, 0.16, 0.40, 12, 4, 1.05, 0.85, 1.0);
    const bridge = new THREE.Mesh(bridgeGeo, bodyMat);
    bridge.position.set(0, 0.02, 0.32);
    bridge.rotation.x = -0.18;
    this.head.add(bridge);

    // Broad, rounded feline whisker pads / muzzle (white fur)
    const muzzleGeo = new THREE.CylinderGeometry(0.16, 0.21, 0.32, 14, 4);
    muzzleGeo.rotateX(Math.PI / 2);
    muzzleGeo.scale(1.22, 0.78, 1.0);
    muzzleGeo.computeVertexNormals();
    const muzzle = new THREE.Mesh(muzzleGeo, whiteFurMat);
    muzzle.position.set(0, -0.10, 0.44);
    this.head.add(muzzle);

    // Slate leather nose pad with nostrils
    const noseGeo = new THREE.ConeGeometry(0.08, 0.10, 8);
    noseGeo.rotateX(-Math.PI / 2);
    noseGeo.scale(1.2, 0.8, 0.8);
    const nose = new THREE.Mesh(noseGeo, noseMat);
    nose.position.set(0, -0.04, 0.60);
    this.head.add(nose);

    // Sculpted feline chin / lower jaw tucked underneath
    const chinGeo = createOrganicVolume(0.10, 0.14, 0.28, 12, 4, 0.92, 0.65, 1.0);
    const chin = new THREE.Mesh(chinGeo, whiteFurMat);
    chin.position.set(0, -0.20, 0.38);
    this.head.add(chin);

    // Forward-facing predatory almond feline eyes
    for (let side = -1; side <= 1; side += 2) {
      // Dark eyeliner eye socket rim
      const socketGeo = new THREE.SphereGeometry(0.08, 10, 8);
      socketGeo.scale(1.15, 0.85, 0.7);
      const eyeSocket = new THREE.Mesh(socketGeo, darkMat);
      eyeSocket.position.set(side * 0.17, 0.07, 0.26);
      this.head.add(eyeSocket);

      // Piercing luminous amber iris
      const irisGeo = new THREE.SphereGeometry(0.065, 12, 10);
      irisGeo.scale(1.0, 0.9, 0.6);
      const eye = new THREE.Mesh(irisGeo, eyeMat);
      eye.position.set(side * 0.17, 0.07, 0.29);
      this.head.add(eye);

      // Dark predatory vertical slit pupil
      const pupilGeo = new THREE.BoxGeometry(0.022, 0.085, 0.03);
      const pupil = new THREE.Mesh(pupilGeo, darkMat);
      pupil.position.set(side * 0.17, 0.07, 0.32);
      this.head.add(pupil);

      // Bright specular glint catchlight
      const glintGeo = new THREE.SphereGeometry(0.015, 6, 6);
      const glint = new THREE.Mesh(glintGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(side * 0.18, 0.09, 0.33);
      this.head.add(glint);
    }

    // Realistic cup-shaped feline ears (short, rounded for snow habitat, angled naturally)
    for (let side = -1; side <= 1; side += 2) {
      const earShellGeo = new THREE.CylinderGeometry(0.06, 0.14, 0.24, 10, 2);
      earShellGeo.scale(0.85, 1.0, 0.55);
      const earShell = new THREE.Mesh(earShellGeo, darkMat);
      earShell.position.set(side * 0.24, 0.25, -0.06);
      earShell.rotation.set(-0.25, 0, side * -0.32);
      this.head.add(earShell);

      const earInnerGeo = new THREE.CylinderGeometry(0.04, 0.11, 0.20, 8, 2);
      earInnerGeo.scale(0.85, 1.0, 0.45);
      const earInner = new THREE.Mesh(earInnerGeo, whiteFurMat);
      earInner.position.set(side * 0.23, 0.25, -0.04);
      earInner.rotation.set(-0.25, 0, side * -0.32);
      this.head.add(earInner);
    }

    // Feline Whiskers (curved white sensory vibrissae radiating outwards)
    const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    for (let w = -1; w <= 1; w++) {
      for (let side = -1; side <= 1; side += 2) {
        const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.42, 4), whiskerMat);
        whisker.rotation.z = side * (Math.PI / 2 + w * 0.18);
        whisker.rotation.x = -0.15;
        whisker.position.set(side * 0.26, -0.10 + w * 0.035, 0.46);
        this.head.add(whisker);
      }
    }

    // --- 3. Long, Thick Snow Leopard Tail (6 continuous, heavy, beautifully articulated segments) ---
    this.tailSegments = [];
    let parentTailNode = this.hips;
    const numSegments = 6;
    for (let i = 0; i < numSegments; i++) {
      const segGroup = new THREE.Group();
      if (i === 0) {
        segGroup.position.set(0, 0.04, -0.42);
      } else {
        segGroup.position.set(0, -0.11, -0.36);
      }

      // Authentic thick snow leopard tail girth (swells in middle, tapers to bushy tip)
      const tailRadius = 0.13 + Math.sin((i / numSegments) * Math.PI) * 0.035;
      const segGeo = new THREE.CylinderGeometry(tailRadius * 0.94, tailRadius * 1.06, 0.42, 12, 2);
      segGeo.computeVertexNormals();
      const segMesh = new THREE.Mesh(segGeo, bodyMat);
      segMesh.rotation.x = Math.PI / 3.0; // Hangs naturally down and curls
      segMesh.castShadow = true;
      segGroup.add(segMesh);

      // Rounded end cap on final tip segment (dark bushy brush)
      if (i === numSegments - 1) {
        const tipGeo = new THREE.SphereGeometry(tailRadius * 0.92, 10, 8);
        const tipMesh = new THREE.Mesh(tipGeo, darkMat);
        tipMesh.position.set(0, -0.22, 0.12);
        segGroup.add(tipMesh);
      }

      parentTailNode.add(segGroup);
      this.tailSegments.push(segGroup);
      parentTailNode = segGroup;
    }

    // --- 4. 3D Luminous Claw Slash Arc Effect ---
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

    // --- 5. Four Articulated Feline Legs (Digitigrade predator anatomy with wide snowshoe paws) ---
    this.legs = {
      frontLeft: this.createLeg(0.38, 1.15, 0.65, bodyMat, whiteFurMat, darkMat, false),
      frontRight: this.createLeg(-0.38, 1.15, 0.65, bodyMat, whiteFurMat, darkMat, false),
      backLeft: this.createLeg(0.34, 1.15, -0.85, bodyMat, whiteFurMat, darkMat, true),
      backRight: this.createLeg(-0.34, 1.15, -0.85, bodyMat, whiteFurMat, darkMat, true)
    };

    Object.values(this.legs).forEach((leg) => this.bodyRoot.add(leg.root));

    return group;
  }

  createLeg(x, y, z, mat, pawMat, clawMat, isBack = false) {
    const root = new THREE.Group();
    root.position.set(x, y, z);

    // Upper thigh / shoulder (tapered muscular contour)
    const upperLen = isBack ? 0.62 : 0.55;
    const upperGeo = new THREE.CylinderGeometry(isBack ? 0.20 : 0.15, isBack ? 0.14 : 0.11, upperLen, 12, 3);
    upperGeo.scale(isBack ? 0.85 : 0.95, 1.0, isBack ? 1.25 : 1.05); // Muscular anterior/posterior thigh curve
    upperGeo.computeVertexNormals();
    const upper = new THREE.Mesh(upperGeo, mat);
    upper.position.y = -upperLen * 0.45;
    upper.castShadow = true;
    root.add(upper);

    // Knee / Hock joint
    const lowerJoint = new THREE.Group();
    lowerJoint.position.set(0, -upperLen * 0.85, isBack ? -0.10 : 0.05);
    root.add(lowerJoint);

    // Forearm / Gaskin (lower leg)
    const lowerLen = 0.52;
    const lowerGeo = new THREE.CylinderGeometry(0.11, 0.085, lowerLen, 10, 3);
    lowerGeo.computeVertexNormals();
    const lower = new THREE.Mesh(lowerGeo, mat);
    lower.position.y = -lowerLen * 0.45;
    lower.castShadow = true;
    lowerJoint.add(lower);

    // Wide, flat Snowshoe Paw with rounded contours
    const pawGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.11, 12, 2);
    pawGeo.scale(1.15, 1.0, 1.35); // Broad snowshoe oval resting flat on snow
    pawGeo.computeVertexNormals();
    const paw = new THREE.Mesh(pawGeo, pawMat);
    paw.position.set(0, -lowerLen * 0.88, 0.08);
    paw.castShadow = true;
    lowerJoint.add(paw);

    // 3 Rounded cushioned toe arches
    for (let c = -1; c <= 1; c++) {
      const toeGeo = new THREE.SphereGeometry(0.045, 8, 6);
      toeGeo.scale(0.85, 0.7, 1.15);
      const toe = new THREE.Mesh(toeGeo, pawMat);
      toe.position.set(c * 0.08, -lowerLen * 0.89, 0.24);
      lowerJoint.add(toe);

      // Dark retractile claws
      const clawGeo = new THREE.ConeGeometry(0.018, 0.07, 4);
      clawGeo.rotateX(Math.PI / 2.2);
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.position.set(c * 0.08, -lowerLen * 0.90, 0.29);
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
