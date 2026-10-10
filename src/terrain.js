import * as THREE from 'three';

// Procedural Mountain Terrain and Environment
export class MountainEnvironment {
  constructor(scene, worldSize = 360) {
    this.scene = scene;
    this.worldSize = worldSize;
    this.halfSize = worldSize / 2;
    this.rocks = [];
    this.trees = [];
    this.obstacles = [];

    this.createTerrain();
    this.createDecorations();
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

  getTerrainNormal(x, z) {
    const delta = 0.5;
    const hL = this.getTerrainHeight(x - delta, z);
    const hR = this.getTerrainHeight(x + delta, z);
    const hD = this.getTerrainHeight(x, z - delta);
    const hU = this.getTerrainHeight(x, z + delta);

    const normal = new THREE.Vector3(hL - hR, 2 * delta, hD - hU).normalize();
    return normal;
  }

  createTerrainTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base crisp snow
    ctx.fillStyle = '#e8eff7';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle blue shadow drifts & granite grit
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = Math.random() * 4 + 1;
      const grey = Math.floor(190 + Math.random() * 55);
      const blue = Math.floor(grey + 10);
      ctx.fillStyle = `rgba(${grey}, ${grey + 4}, ${blue}, 0.25)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snow glitter / ice flecks
    for (let i = 0; i < 1500; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(x, y, 2, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(24, 24);
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

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.getTerrainHeight(x, z);
      pos.setY(i, y);

      // Slope-based and height-based coloring
      const normal = this.getTerrainNormal(x, z);
      const steepness = 1.0 - normal.y; // 0 is flat, 1 is vertical cliff

      let col = snowColor.clone();
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
      roughness: 0.85,
      metalness: 0.05,
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

    const snowCapMat = new THREE.MeshStandardMaterial({
      color: 0xf0f5fa,
      roughness: 0.8
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
      this.rocks.push({ position: dummy.position.clone(), radius: rockRadius });
      this.obstacles.push({ x, z, radius: rockRadius, type: 'rock' });
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
      this.trees.push({ position: new THREE.Vector3(x, y, z), radius: trunkRadius });
      this.obstacles.push({ x, z, radius: trunkRadius, type: 'tree' });
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
