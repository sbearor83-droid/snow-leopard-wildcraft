import * as THREE from 'three';

// Procedural Mountain Terrain and Environment
export class MountainEnvironment {
  constructor(scene, worldSize = 360) {
    this.scene = scene;
    this.worldSize = worldSize;
    this.halfSize = worldSize / 2;
    this.obstacles = []; // Circles ({ x, z, radius }) used for collision
    this.mistPlanes = [];

    this.createSkyAndDistantMountains();
    this.createTerrain();
    this.createDecorations();
    this.createDriftingMist();
    this.createPawTracksSystem();
    this.createSnowWeather();
  }

  // Smooth multi-octave height function for mountain ridges and valleys
  getTerrainHeight(x, z) {
    // Distance from center for boundary mountain walls
    const distFromCenter = Math.sqrt(x * x + z * z);
    const borderFactor = Math.pow(Math.max(0, (distFromCenter - 100) / (this.halfSize - 100)), 2.2);

    // Valley base and hills
    let h = 0;
    // Octave 1: Major mountain massifs
    h += Math.sin(x * 0.015) * Math.cos(z * 0.015) * 14;
    // Octave 2: Ridges & crags
    h += Math.sin(x * 0.035 + 1.2) * Math.sin(z * 0.035 - 0.7) * 7;
    // Octave 3: Local slope bumps
    h += Math.sin(x * 0.08) * Math.cos(z * 0.08) * 2.5;
    // Octave 4: Fine snow drift ripples
    h += Math.sin(x * 0.2 + z * 0.15) * 0.6;

    // Boundary towering mountain wall so player and prey stay in arena
    h += borderFactor * 45;

    return h;
  }

  getTerrainNormal(x, z, target = new THREE.Vector3()) {
    const delta = 0.5;
    const hL = this.getTerrainHeight(x - delta, z);
    const hR = this.getTerrainHeight(x + delta, z);
    const hD = this.getTerrainHeight(x, z - delta);
    const hU = this.getTerrainHeight(x, z + delta);

    return target.set(hL - hR, 2 * delta, hD - hU).normalize();
  }

  // Panoramic Himalayan Sky Dome, Distant Mountain Peaks & Golden Sun Corona
  createSkyAndDistantMountains() {
    // 1. Panoramic Alpine Sky Dome with Rayleigh scattering atmospheric gradient
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 512;
    skyCanvas.height = 512;
    const sCtx = skyCanvas.getContext('2d');

    const skyGrad = sCtx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0.0, '#152e6b'); // Deep Himalayan zenith sapphire
    skyGrad.addColorStop(0.35, '#2b6cb0'); // High-altitude alpine blue
    skyGrad.addColorStop(0.62, '#63b3ed'); // Cerulean sky
    skyGrad.addColorStop(0.80, '#bee3f8'); // Icy horizon wash
    skyGrad.addColorStop(0.92, '#fde68a'); // Warm golden-peach sunlit horizon
    skyGrad.addColorStop(1.0, '#cbd5e1'); // Valley atmospheric haze
    sCtx.fillStyle = skyGrad;
    sCtx.fillRect(0, 0, 512, 512);

    // Wispy cirrus mountain clouds along the lower sky
    sCtx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    for (let i = 0; i < 28; i++) {
      const cx = (i / 28) * 512 + Math.random() * 20;
      const cy = 340 + Math.sin(i * 1.5) * 35 + Math.random() * 20;
      const w = 45 + Math.random() * 65;
      const h = 10 + Math.random() * 14;
      sCtx.beginPath();
      sCtx.ellipse(cx, cy, w, h, (Math.random() - 0.5) * 0.2, 0, Math.PI * 2);
      sCtx.fill();
    }

    const skyTex = new THREE.CanvasTexture(skyCanvas);
    const skyGeo = new THREE.SphereGeometry(600, 32, 20);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    // 2. Alpine Sun Corona Billboard (matches directional sun light vector)
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 128;
    sunCanvas.height = 128;
    const sunCtx = sunCanvas.getContext('2d');
    const sunGrad = sunCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    sunGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    sunGrad.addColorStop(0.18, 'rgba(255, 248, 220, 0.95)');
    sunGrad.addColorStop(0.42, 'rgba(254, 215, 170, 0.45)');
    sunGrad.addColorStop(0.75, 'rgba(253, 186, 116, 0.12)');
    sunGrad.addColorStop(1.0, 'rgba(253, 186, 116, 0.0)');
    sunCtx.fillStyle = sunGrad;
    sunCtx.fillRect(0, 0, 128, 128);

    const sunTex = new THREE.CanvasTexture(sunCanvas);
    const sunSpriteMat = new THREE.SpriteMaterial({
      map: sunTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    });
    this.sunSprite = new THREE.Sprite(sunSpriteMat);
    this.sunSprite.scale.set(160, 160, 160);
    this.sunSprite.position.set(240, 340, 180);
    this.scene.add(this.sunSprite);

    // 3. Panoramic Distant Mountain Ridge Rings (Cinematic Himalayan Skyline)
    this.createDistantMountainRing(320, 48, 75, 140, 0x90a4ae); // Mid-range crags
    this.createDistantMountainRing(480, 64, 130, 240, 0xb0c4de); // Towering distant summits
  }

  // Generates 360-degree jagged alpine mountain ranges around the horizon
  createDistantMountainRing(radius, segments, minHeight, maxHeight, baseColorHex) {
    const geo = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];

    const snowCol = new THREE.Color(0xf5f8fc);
    const rockCol = new THREE.Color(0x475569);
    const hazeCol = new THREE.Color(baseColorHex);

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const aMid = (a0 + a1) * 0.5;

      // Radial jitter creates authentic serrated mountain silhouettes
      const r0 = radius + (Math.sin(i * 3.7) + Math.cos(i * 1.9)) * 25;
      const r1 = radius + (Math.sin((i + 1) * 3.7) + Math.cos((i + 1) * 1.9)) * 25;
      const rPeak = radius * 1.05 + Math.sin(i * 5.3) * 30;

      const peakH = minHeight + (Math.sin(i * 2.3) * 0.5 + 0.5) * (maxHeight - minHeight);
      const saddleH0 = peakH * (0.35 + Math.random() * 0.2);
      const saddleH1 = peakH * (0.35 + Math.random() * 0.2);

      // Triangle 1: Base quad left -> peak
      const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
      const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
      const xp = Math.cos(aMid) * rPeak, zp = Math.sin(aMid) * rPeak;

      // Face 1: Left slope
      positions.push(x0, 0, z0,  x0, saddleH0, z0,  xp, peakH, zp);
      colors.push(hazeCol.r, hazeCol.g, hazeCol.b, rockCol.r, rockCol.g, rockCol.b, snowCol.r, snowCol.g, snowCol.b);

      // Face 2: Right slope
      positions.push(xp, peakH, zp,  x1, saddleH1, z1,  x1, 0, z1);
      colors.push(snowCol.r, snowCol.g, snowCol.b, rockCol.r, rockCol.g, rockCol.b, hazeCol.r, hazeCol.g, hazeCol.b);

      // Face 3: Center filler
      positions.push(x0, 0, z0,  xp, peakH, zp,  x1, 0, z1);
      colors.push(hazeCol.r, hazeCol.g, hazeCol.b, snowCol.r, snowCol.g, snowCol.b, hazeCol.r, hazeCol.g, hazeCol.b);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true
    });

    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
  }

  // Drifting ground mist planes across valley hollows
  createDriftingMist() {
    const mistGeo = new THREE.PlaneGeometry(65, 45);
    mistGeo.rotateX(-Math.PI / 2);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(235, 245, 255, 0.28)');
    grad.addColorStop(0.5, 'rgba(215, 235, 255, 0.12)');
    grad.addColorStop(1.0, 'rgba(200, 225, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const mistTex = new THREE.CanvasTexture(canvas);
    const mistMat = new THREE.MeshBasicMaterial({
      map: mistTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 30 + Math.random() * (this.halfSize - 60);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = this.getTerrainHeight(x, z) + 1.2 + Math.random() * 2.5;

      const mist = new THREE.Mesh(mistGeo, mistMat);
      mist.position.set(x, y, z);
      mist.scale.set(1.0 + Math.random() * 0.8, 1.0, 1.0 + Math.random() * 0.8);
      mist.rotation.y = Math.random() * Math.PI;
      this.scene.add(mist);
      this.mistPlanes.push({ mesh: mist, speed: 0.8 + Math.random() * 1.2, baseX: x, baseZ: z, offset: Math.random() * 100 });
    }
  }

  // Lightweight Paw Print Tracks System on snow
  createPawTracksSystem() {
    const trackGeo = new THREE.CircleGeometry(0.26, 6);
    trackGeo.rotateX(-Math.PI / 2);

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(110, 130, 155, 0.6)');
    grad.addColorStop(0.7, 'rgba(140, 160, 180, 0.35)');
    grad.addColorStop(1, 'rgba(180, 200, 220, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const trackTex = new THREE.CanvasTexture(canvas);
    const trackMat = new THREE.MeshBasicMaterial({
      map: trackTex,
      transparent: true,
      depthWrite: false
    });

    this.maxPawTracks = 90;
    this.pawTrackMesh = new THREE.InstancedMesh(trackGeo, trackMat, this.maxPawTracks);
    this.pawTrackIndex = 0;
    this.pawTrackDummy = new THREE.Object3D();

    // Hide all instances initially
    this.pawTrackDummy.position.set(0, -999, 0);
    this.pawTrackDummy.updateMatrix();
    for (let i = 0; i < this.maxPawTracks; i++) {
      this.pawTrackMesh.setMatrixAt(i, this.pawTrackDummy.matrix);
    }
    this.pawTrackMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.pawTrackMesh);
  }

  // Called when leopard or prey steps on snow
  addPawPrint(x, z, angle, scale = 1.0) {
    if (!this.pawTrackMesh) return;
    const y = this.getTerrainHeight(x, z) + 0.04;
    this.pawTrackDummy.position.set(x, y, z);
    this.pawTrackDummy.rotation.set(0, angle, 0);
    this.pawTrackDummy.scale.set(scale, 1.0, scale * 1.25);
    this.pawTrackDummy.updateMatrix();

    this.pawTrackMesh.setMatrixAt(this.pawTrackIndex, this.pawTrackDummy.matrix);
    this.pawTrackMesh.instanceMatrix.needsUpdate = true;
    this.pawTrackIndex = (this.pawTrackIndex + 1) % this.maxPawTracks;
  }

  // High-Definition Procedural Snow with wind sastrugi, ice crystalline flecks, and rock scree
  createTerrainTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Base crisp alpine snow
    ctx.fillStyle = '#edf3fa';
    ctx.fillRect(0, 0, 1024, 1024);

    // 1. Wind-carved snow sastrugi ripples (directional alpine wind sculpture)
    ctx.strokeStyle = 'rgba(195, 215, 235, 0.35)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 90; i++) {
      const y = (i / 90) * 1024 + (Math.random() - 0.5) * 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(280, y + 14, 680, y - 18, 1024, y + 8);
      ctx.stroke();
    }

    // 2. Cold blue shadow drifts & granite grit
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const r = Math.random() * 3.5 + 0.8;
      const grey = Math.floor(190 + Math.random() * 55);
      const blue = Math.floor(grey + 14);
      ctx.fillStyle = `rgba(${grey}, ${grey + 4}, ${blue}, 0.22)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Crystalline snow glitter / ice sparkles (catches direct alpine sunlight)
    for (let i = 0; i < 3500; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      ctx.fillStyle = Math.random() > 0.3 ? 'rgba(255, 255, 255, 0.9)' : 'rgba(230, 245, 255, 0.75)';
      ctx.fillRect(x, y, 2.5, 2.5);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(28, 28);
    return texture;
  }

  createTerrain() {
    const segments = 90;
    const geometry = new THREE.PlaneGeometry(this.worldSize, this.worldSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const snowColor = new THREE.Color(0xf1f6fb);
    const rockColor = new THREE.Color(0x737e8c);
    const cliffColor = new THREE.Color(0x4a535e);

    const normal = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.getTerrainHeight(x, z);
      pos.setY(i, y);

      // Slope-based coloring
      this.getTerrainNormal(x, z, normal);
      const steepness = 1.0 - normal.y; // 0 is flat, 1 is vertical cliff

      col.copy(snowColor);
      if (steepness > 0.45) {
        col.lerp(cliffColor, Math.min(1, (steepness - 0.45) * 3));
      } else if (steepness > 0.25) {
        col.lerp(rockColor, (steepness - 0.25) * 3);
      }

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const texture = this.createTerrainTexture();
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.04,
      flatShading: false
    });

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  createDecorations() {
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x5a636e,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true
    });

    // 1. Rocky Crags and Boulders (great for stalking and hunting)
    const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, 130);
    rockInstanced.castShadow = true;
    rockInstanced.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < 130; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * (this.halfSize - 35);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = this.getTerrainHeight(x, z);

      const scaleX = 1.8 + Math.random() * 3.5;
      const scaleY = 1.2 + Math.random() * 4.0;
      const scaleZ = 1.8 + Math.random() * 3.5;

      dummy.position.set(x, y + scaleY * 0.4, z);
      dummy.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
      dummy.scale.set(scaleX, scaleY, scaleZ);
      dummy.updateMatrix();

      rockInstanced.setMatrixAt(i, dummy.matrix);
      const rockRadius = Math.max(scaleX, scaleZ) * 0.72;
      this.obstacles.push({ x, z, radius: rockRadius });
    }
    this.scene.add(rockInstanced);

    // 2. Himalayan Snowy Pine / Fir Trees
    this.createSnowTrees();
  }

  createSnowTrees() {
    const numTrees = 65;
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 3.8, 6);
    trunkGeo.translate(0, 1.9, 0); // Center pivot at ground base
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });

    const coneGeo = new THREE.ConeGeometry(2.4, 3.0, 7);
    coneGeo.translate(0, 1.5, 0);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x1d3a2b,
      roughness: 0.75,
      flatShading: true
    });

    const snowCapGeo = new THREE.ConeGeometry(2.2, 1.2, 7);
    snowCapGeo.translate(0, 0.6, 0);
    const snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xf5f8fc,
      roughness: 0.7,
      flatShading: true
    });

    const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, numTrees);
    trunkInstanced.castShadow = true;
    trunkInstanced.receiveShadow = true;

    const foliageInstanced = new THREE.InstancedMesh(coneGeo, foliageMat, numTrees * 3);
    foliageInstanced.castShadow = true;
    foliageInstanced.receiveShadow = true;

    const snowCapInstanced = new THREE.InstancedMesh(snowCapGeo, snowCapMat, numTrees * 3);
    snowCapInstanced.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const tierOffsets = [
      { y: 3.2, s: 1.0 },
      { y: 5.0, s: 0.76 },
      { y: 6.6, s: 0.52 }
    ];

    let treeCount = 0;
    for (let i = 0; i < numTrees; i++) {
      const angle = (i / numTrees) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 20 + Math.random() * (this.halfSize - 40);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = this.getTerrainHeight(x, z);

      const norm = this.getTerrainNormal(x, z);
      if (norm.y < 0.82) continue; // Skip steep cliffs

      const s = 0.85 + Math.random() * 0.65;

      // Trunk instance
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      trunkInstanced.setMatrixAt(treeCount, dummy.matrix);

      // 3 Foliage & Snow tiers
      for (let t = 0; t < 3; t++) {
        const tier = tierOffsets[t];
        const instIdx = treeCount * 3 + t;

        dummy.position.set(x, y + tier.y * s, z);
        dummy.scale.set(s * tier.s, s * tier.s, s * tier.s);
        dummy.updateMatrix();
        foliageInstanced.setMatrixAt(instIdx, dummy.matrix);

        dummy.position.set(x, y + (tier.y + 0.9 * tier.s) * s, z);
        dummy.scale.set(s * tier.s * 0.95, s * tier.s, s * tier.s * 0.95);
        dummy.updateMatrix();
        snowCapInstanced.setMatrixAt(instIdx, dummy.matrix);
      }

      const trunkRadius = 0.68 * s;
      this.obstacles.push({ x, z, radius: trunkRadius });
      treeCount++;
    }

    trunkInstanced.count = treeCount;
    foliageInstanced.count = treeCount * 3;
    snowCapInstanced.count = treeCount * 3;

    trunkInstanced.instanceMatrix.needsUpdate = true;
    foliageInstanced.instanceMatrix.needsUpdate = true;
    snowCapInstanced.instanceMatrix.needsUpdate = true;

    this.scene.add(trunkInstanced);
    this.scene.add(foliageInstanced);
    this.scene.add(snowCapInstanced);
  }

  createSnowWeather() {
    const flakeCount = 450;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(flakeCount * 3);
    const velocities = new Float32Array(flakeCount * 3);

    for (let i = 0; i < flakeCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;

      velocities[i * 3] = -0.5 - Math.random() * 1.5; // Wind drift X
      velocities[i * 3 + 1] = -1.5 - Math.random() * 2.0; // Fall Y
      velocities[i * 3 + 2] = 0.2 + (Math.random() - 0.5) * 0.8; // Z swirl
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snowVelocities = velocities;

    // Soft circular snowflake sprite via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(230, 245, 255, 0.7)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const snowTex = new THREE.CanvasTexture(canvas);
    const material = new THREE.PointsMaterial({
      size: 0.45,
      map: snowTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.snowParticles = new THREE.Points(geometry, material);
    this.scene.add(this.snowParticles);
  }

  update(delta, playerPos) {
    // Keep Sky Dome centered on player so panoramic mountains and sky stay infinite
    if (this.skyDome) {
      this.skyDome.position.x = playerPos.x;
      this.skyDome.position.z = playerPos.z;
    }

    // Gentle alpine wind drift on valley mist planes
    if (this.mistPlanes) {
      for (let i = 0; i < this.mistPlanes.length; i++) {
        const mist = this.mistPlanes[i];
        mist.mesh.position.x += mist.speed * delta * 1.8;
        if (mist.mesh.position.x > mist.baseX + 40) {
          mist.mesh.position.x = mist.baseX - 40;
        }
      }
    }

    if (!this.snowParticles) return;

    // Follow player position so snow is always dense around the camera
    this.snowParticles.position.x = playerPos.x;
    this.snowParticles.position.z = playerPos.z;

    const pos = this.snowParticles.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let py = pos.getY(i) + this.snowVelocities[i * 3 + 1] * delta * 4;
      let px = pos.getX(i) + this.snowVelocities[i * 3] * delta * 4;
      let pz = pos.getZ(i) + this.snowVelocities[i * 3 + 2] * delta * 4;

      if (py < -5) {
        py = 35 + Math.random() * 5;
        px = (Math.random() - 0.5) * 120;
        pz = (Math.random() - 0.5) * 120;
      }
      if (px < -60) px = 60;
      if (px > 60) px = -60;
      if (pz < -60) pz = 60;
      if (pz > 60) pz = -60;

      pos.setXYZ(i, px, py, pz);
    }
    pos.needsUpdate = true;
  }

  // Circle-circle collision resolution against rocks and tree trunks with smooth surface sliding
  resolveCollision(position, entityRadius = 0.85) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.obstacles.length; i++) {
        const obs = this.obstacles[i];
        const dx = position.x - obs.x;
        const dz = position.z - obs.z;
        const minDist = entityRadius + obs.radius;

        // Fast bounding box rejection
        if (Math.abs(dx) > minDist || Math.abs(dz) > minDist) continue;

        const distSq = dx * dx + dz * dz;
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            const push = minDist - dist;
            position.x += (dx / dist) * push;
            position.z += (dz / dist) * push;
          } else {
            position.x += minDist;
          }
        }
      }
    }
    return position;
  }
}
