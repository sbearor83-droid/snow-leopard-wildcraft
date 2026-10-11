import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { smooth, fbm3, noise2, fbm2, tileFbm2, tileNoise2, makeRng, heightToNormalTexture } from './procgen.js';
import { isMobileDevice } from './utils.js';

const IS_MOBILE = isMobileDevice();

// Procedural Himalayan Mountain Terrain & Environment
export class MountainEnvironment {
  constructor(scene, worldSize = 360) {
    this.scene = scene;
    this.worldSize = worldSize;
    this.halfSize = worldSize / 2;
    this.obstacles = []; // Circles ({ x, z, radius, kind: 'rock' | 'tree' }) used for collision
    this.mistPlanes = [];
    this.rng = makeRng(90210);
    this.time = 0;

    this.createSky();
    this.createDistantMountains();
    this.createTerrain();
    this.createRocks();
    this.createTrees();
    this.createDriftingMist();
    this.createPawTracksSystem();
    this.createSnowWeather();
  }

  // Smooth multi-octave height function for mountain ridges and valleys
  getTerrainHeight(x, z) {
    const distFromCenter = Math.sqrt(x * x + z * z);
    const borderFactor = Math.pow(Math.max(0, (distFromCenter - 100) / (this.halfSize - 100)), 2.2);

    let h = 0;
    h += Math.sin(x * 0.015) * Math.cos(z * 0.015) * 14; // major massifs
    h += Math.sin(x * 0.035 + 1.2) * Math.sin(z * 0.035 - 0.7) * 7; // ridges & crags
    h += Math.sin(x * 0.08) * Math.cos(z * 0.08) * 2.5; // local bumps
    h += Math.sin(x * 0.2 + z * 0.15) * 0.6; // drift ripples
    h += Math.sin(x * 0.55 + z * 0.35) * Math.cos(z * 0.6 - x * 0.25) * 0.22; // fine sastrugi
    h += borderFactor * 45; // boundary mountain wall
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

  // ------------------------------------------------------------------ sky
  createSky() {
    const W = 1024, H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;

    // Zenith -> horizon gradient with a warm glow around the sun azimuth
    const zenith = [48, 92, 150], mid = [112, 160, 212], horizon = [196, 216, 234], haze = [222, 232, 240];
    const sunU = 0.19; // sun azimuth in texture space (matches sun sprite at +x,+z)
    for (let y = 0; y < H; y++) {
      const v = y / H; // 0 = top
      for (let x = 0; x < W; x++) {
        const u = x / W;
        let c;
        if (v < 0.45) {
          const t = smooth(v / 0.45);
          c = [zenith[0] + (mid[0] - zenith[0]) * t, zenith[1] + (mid[1] - zenith[1]) * t, zenith[2] + (mid[2] - zenith[2]) * t];
        } else if (v < 0.62) {
          const t = smooth((v - 0.45) / 0.17);
          c = [mid[0] + (horizon[0] - mid[0]) * t, mid[1] + (horizon[1] - mid[1]) * t, mid[2] + (horizon[2] - mid[2]) * t];
        } else {
          const t = smooth(Math.min(1, (v - 0.62) / 0.12));
          c = [horizon[0] + (haze[0] - horizon[0]) * t, horizon[1] + (haze[1] - horizon[1]) * t, horizon[2] + (haze[2] - horizon[2]) * t];
        }
        // warm sun glow
        let du = Math.abs(u - sunU); du = Math.min(du, 1 - du);
        const dv = v - 0.42;
        const glow = Math.exp(-(du * du * 18 + dv * dv * 22)) * 0.55;
        c[0] += 70 * glow; c[1] += 48 * glow; c[2] += 12 * glow;
        // cirrus bands high in the sky
        if (v < 0.58) {
          const n = fbm2(u * 7 + 3.1, v * 14, 4);
          const streak = fbm2(u * 22, v * 4 + 11, 2);
          let cl = Math.max(0, (n * 0.75 + streak * 0.25) - 0.52) * 4.2;
          cl *= smooth(Math.min(1, v / 0.18)) * smooth(Math.min(1, (0.58 - v) / 0.12));
          cl = Math.min(1, cl);
          c[0] += (238 - c[0]) * cl; c[1] += (242 - c[1]) * cl; c[2] += (248 - c[2]) * cl;
        }
        const i = (y * W + x) * 4;
        d[i] = Math.min(255, c[0]); d[i + 1] = Math.min(255, c[1]); d[i + 2] = Math.min(255, c[2]); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const skyTex = new THREE.CanvasTexture(canvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyGeo = new THREE.SphereGeometry(640, 48, 24);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.rotation.y = Math.PI * 0.25;
    this.scene.add(this.skyDome);

    // Sun disc with a soft halo
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 256;
    sunCanvas.height = 256;
    const sctx = sunCanvas.getContext('2d');
    const g = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,252,238,0.95)');
    g.addColorStop(0.3, 'rgba(255,244,214,0.35)');
    g.addColorStop(0.6, 'rgba(255,238,200,0.08)');
    g.addColorStop(1.0, 'rgba(255,238,200,0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, 256, 256);
    const sunMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sunCanvas), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(150, 150, 150);
    this.sunSprite.position.set(260, 330, 180);
    this.scene.add(this.sunSprite);
  }

  // ------------------------------------------------------------------ distant ranges
  createDistantMountains() {
    this.createMountainRing(310, 160, 70, 150, 1.7, 0x7d93a8, 0xe9f0f6, 0x5a6878);
    this.createMountainRing(470, 200, 120, 260, 2.9, 0x9fb5c8, 0xf1f5f9, 0x71818f);
  }

  // Ring of fbm-shaped ridges around the horizon, coloured snow / rock / haze by height and slope
  createMountainRing(radius, columns, minH, maxH, seed, hazeHex, snowHex, rockHex) {
    const rows = 7;
    const positions = [];
    const colors = [];
    const indices = [];
    const haze = new THREE.Color(hazeHex), snow = new THREE.Color(snowHex), rock = new THREE.Color(rockHex);
    const col = new THREE.Color();

    const ridge = new Array(columns + 1);
    for (let i = 0; i <= columns; i++) {
      const a = (i / columns) * Math.PI * 2;
      const n = fbm2(Math.cos(a) * 2.3 + seed * 10, Math.sin(a) * 2.3 + seed * 3, 5);
      const peaks = Math.pow(Math.abs(Math.sin(a * 5.5 + seed) * 0.6 + Math.sin(a * 13 + seed * 2) * 0.4), 1.3);
      ridge[i] = minH + (maxH - minH) * Math.min(1, n * 0.65 + peaks * 0.55);
    }
    for (let i = 0; i <= columns; i++) {
      const a = (i / columns) * Math.PI * 2;
      const r = radius + Math.sin(a * 7 + seed) * radius * 0.04;
      const h = ridge[i];
      const slope = Math.abs(ridge[Math.min(columns, i + 1)] - ridge[Math.max(0, i - 1)]) / (2 * Math.PI * radius / columns);
      for (let j = 0; j < rows; j++) {
        const t = j / (rows - 1);
        const y = -30 + (h + 30) * t;
        const rr = r + (1 - t) * 18;
        positions.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
        const snowLine = 0.5 + fbm2(a * 3 + seed, t * 2, 2) * 0.25;
        const rocky = Math.min(1, slope * 1.6 + fbm2(a * 9 + seed * 5, t * 6, 3) * 0.6);
        if (t < snowLine) col.copy(rock).lerp(haze, 1 - t / snowLine);
        else col.copy(snow).lerp(rock, Math.max(0, rocky - 0.35) * 0.9);
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let i = 0; i < columns; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = i * rows + j, b = a + rows;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------------ snow terrain
  createSnowTextures() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        // tileable via noise on a torus-ish wrap: sample noise in 4 quadrants and blend
        const n = tileFbm2(u, v, 6, 3);
        const grain = tileNoise2(u, v, 180);
        const base = 236 + (n - 0.5) * 22 + (grain - 0.5) * 10;
        const i = (y * size + x) * 4;
        d[i] = Math.min(255, base - 4); d[i + 1] = Math.min(255, base); d[i + 2] = Math.min(255, base + 6); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(36, 36);
    map.anisotropy = 4;

    // wind-sculpted drifts + crystalline grain for the normal map
    const nrm = heightToNormalTexture(512, (u, v) => {
      const drift = Math.sin((u * 7 + v * 2) * Math.PI * 2 + tileFbm2(u, v, 4, 2, 9) * 3.5) * 0.5 + 0.5;
      const bumps = tileFbm2(u, v, 11, 3, 4);
      const grain = tileNoise2(u, v, 140, 2);
      return drift * 0.45 + bumps * 0.4 + grain * 0.15;
    }, 2.6);
    nrm.repeat.set(36, 36);
    nrm.anisotropy = 4;
    return { map, nrm };
  }

  createTerrain() {
    const segments = IS_MOBILE ? 160 : 240;
    const geometry = new THREE.PlaneGeometry(this.worldSize, this.worldSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const snowColor = new THREE.Color(0xf4f7fb);
    const shadowSnow = new THREE.Color(0xdfe8f2);
    const rockColor = new THREE.Color(0x6d7684);
    const cliffColor = new THREE.Color(0x454d58);
    const normal = new THREE.Vector3();
    const col = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.getTerrainHeight(x, z));
      this.getTerrainNormal(x, z, normal);
      const steepness = 1.0 - normal.y;
      const patch = fbm2(x * 0.02 + 50, z * 0.02 + 50, 3);
      col.copy(snowColor).lerp(shadowSnow, Math.max(0, patch - 0.45) * 1.6);
      const rockNoise = fbm2(x * 0.08, z * 0.08, 3) * 0.12;
      if (steepness > 0.42 + rockNoise) col.lerp(cliffColor, Math.min(1, (steepness - 0.42 - rockNoise) * 3));
      else if (steepness > 0.22 + rockNoise) col.lerp(rockColor, (steepness - 0.22 - rockNoise) * 3.2);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const { map, nrm } = this.createSnowTextures();
    const material = new THREE.MeshStandardMaterial({
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.55, 0.55),
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.0
    });

    // Sparkle: view-dependent glints on sunlit snow, fading with distance
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSnowWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vSnowWp;
uniform vec3 uSunDir;
vec3 snowHash3(vec2 p) {
  vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
  return fract(sin(q) * 43758.5453);
}`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  // ice-crystal glints: each tiny cell has a random microfacet normal; it flashes when it
  // mirrors the sun towards the camera, so the glints twinkle as the view moves
  float dist = length(vViewPosition);
  float reach = smoothstep(45.0, 6.0, dist) * step(0.75, vColor.g);
  if (reach > 0.0) {
    vec2 cell = floor(vSnowWp.xz * 40.0);
    vec3 h = snowHash3(cell);
    vec3 micro = normalize(normal + (h - 0.5) * 0.9);
    vec3 V = normalize(vViewPosition);
    vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    vec3 H = normalize(L + V);
    float glint = pow(max(dot(micro, H), 0.0), 160.0) * step(0.68, h.z);
    gl_FragColor.rgb += vec3(0.95, 0.97, 1.0) * glint * reach * 1.4;
  }
}`);
      shader.uniforms.uSunDir = { value: new THREE.Vector3(65, 85, 45).normalize() };
    };

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  // ------------------------------------------------------------------ boulders
  createRockTextures() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const crack = (u, v) => {
      // fine ridged noise reads as mineral veining / cracks
      const n = fbm2(u * 9 + 20, v * 9 + 20, 4);
      return Math.pow(1 - Math.abs(n - 0.5) * 2, 6);
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        const n = fbm2(u * 5 + 9, v * 5 + 9, 4);
        const grain = noise2(u * 120, v * 120);
        const c = crack(u, v);
        let base = 138 + (n - 0.5) * 70 + (grain - 0.5) * 26 - c * 44;
        const warm = (fbm2(u * 3 + 40, v * 3 + 40, 2) - 0.5) * 18;
        const i = (y * size + x) * 4;
        d[i] = Math.max(0, Math.min(255, base + warm)); d[i + 1] = Math.max(0, Math.min(255, base + warm * 0.5)); d[i + 2] = Math.max(0, Math.min(255, base + 6 - warm * 0.4)); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 1);
    const nrm = heightToNormalTexture(256, (u, v) => fbm2(u * 6 + 9, v * 6 + 9, 4) * 0.7 + noise2(u * 60, v * 60) * 0.3, 3.2);
    nrm.repeat.set(2, 1);
    return { map, nrm };
  }

  // Noise-sculpted boulder with a snow cap, as one BufferGeometry with vertex colours
  buildRockGeometry(detail, seed) {
    // weld the icosahedron's duplicated vertices so the displaced surface shades smoothly
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, detail));
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    // displace along the sphere normal
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = fbm3(v.x * 1.4 + seed, v.y * 1.4 + seed, v.z * 1.4 + seed, 4);
      const facets = Math.abs(fbm3(v.x * 3.0 + seed * 2, v.y * 3.0, v.z * 3.0, 2) - 0.5) * 0.5;
      const r = 0.78 + n * 0.5 - facets;
      v.multiplyScalar(r);
      v.y *= 0.82; // squat
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const snowAmts = new Float32Array(pos.count);
    const rockCol = new THREE.Color(0xc4c8cc); // multiplied by the rock map
    const darkRock = new THREE.Color(0x7b8086);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const ny = nrm.getY(i);
      const y = pos.getY(i);
      const n = fbm3(pos.getX(i) * 4 + seed * 3, y * 4, pos.getZ(i) * 4, 2);
      c.copy(rockCol).lerp(darkRock, Math.max(0, -y) * 0.9);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      snowAmts[i] = Math.max(0, Math.min(1, (ny - 0.5 + (n - 0.5) * 0.4) * 3.2)) * (y > -0.25 ? 1 : 0);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('snowAmt', new THREE.BufferAttribute(snowAmts, 1));
    return geo;
  }

  createRocks() {
    const { map, nrm } = this.createRockTextures();
    const rockMat = new THREE.MeshStandardMaterial({
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.8, 0.8),
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0
    });
    // Snow cap blended over the textured rock (not multiplied by the rock map)
    rockMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float snowAmt;\nvarying float vSnowAmt;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnowAmt = snowAmt;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSnowAmt;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.975), vSnowAmt);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.8, vSnowAmt);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, nonPerturbedNormal, vSnowAmt * 0.8));');
    };
    rockMat.customProgramCacheKey = () => 'snowcap-rock';
    const variants = [];
    const detail = IS_MOBILE ? 2 : 3;
    for (let k = 0; k < 4; k++) variants.push(this.buildRockGeometry(detail, 11.3 + k * 7.7));

    const bigCount = IS_MOBILE ? 96 : 130;
    const perVariant = Math.ceil(bigCount / variants.length);
    const dummy = new THREE.Object3D();
    const rng = makeRng(4242);

    variants.forEach((geo, vi) => {
      const inst = new THREE.InstancedMesh(geo, rockMat, perVariant);
      inst.castShadow = true;
      inst.receiveShadow = true;
      for (let i = 0; i < perVariant; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = 16 + rng() * (this.halfSize - 36);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        const y = this.getTerrainHeight(x, z);
        const s = 1.6 + rng() * 3.6;
        const sx = s * (0.8 + rng() * 0.5), sy = s * (0.6 + rng() * 0.6), sz = s * (0.8 + rng() * 0.5);
        dummy.position.set(x, y + sy * 0.18, z);
        dummy.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        this.obstacles.push({ x, z, radius: Math.max(sx, sz) * 0.78, kind: 'rock' });
      }
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    });

    // Small half-buried stones scattered in the snow (no collision)
    const smallGeo = this.buildRockGeometry(1, 3.3);
    const smallCount = IS_MOBILE ? 160 : 260;
    const small = new THREE.InstancedMesh(smallGeo, rockMat, smallCount);
    small.castShadow = true;
    small.receiveShadow = true;
    for (let i = 0; i < smallCount; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = 8 + rng() * (this.halfSize - 30);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const s = 0.35 + rng() * 0.9;
      dummy.position.set(x, this.getTerrainHeight(x, z) - s * 0.25, z);
      dummy.rotation.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6);
      dummy.scale.set(s * (0.8 + rng() * 0.6), s * 0.7, s * (0.8 + rng() * 0.6));
      dummy.updateMatrix();
      small.setMatrixAt(i, dummy.matrix);
    }
    small.instanceMatrix.needsUpdate = true;
    this.scene.add(small);
  }

  // ------------------------------------------------------------------ trees
  // Texture atlas for the firs: side-view needle sprig (top-left), top-view sprig with snow
  // (top-right) and bark (bottom half). Sprigs are alpha-cut branch cards.
  createTreeAtlas() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rng = makeRng(2024);
    ctx.clearRect(0, 0, size, size);

    const needleColor = () => {
      const g = 62 + rng() * 48;
      return `rgb(${Math.round(g * 0.42)}, ${Math.round(g)}, ${Math.round(g * 0.55)})`;
    };
    // draws one twig with needles; (x0,y0)->(x1,y1); snowTop paints snow along the upper side
    const twig = (x0, y0, x1, y1, len, snowTop, snowAmount) => {
      const dx = x1 - x0, dy = y1 - y0;
      const L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L;
      const px = -uy, py = ux; // perpendicular
      ctx.strokeStyle = '#3a2a18';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.lineWidth = 1.5;
      const n = Math.max(4, Math.floor(L / 2.8));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const bx = x0 + dx * t, by = y0 + dy * t;
        const taper = 1 - t * 0.55;
        for (const side of [-1, 1]) {
          const nl = len * taper * (0.7 + rng() * 0.5);
          const sw = 0.35; // needles sweep towards the tip
          const nx = px * side * (1 - sw) + ux * sw, ny = py * side * (1 - sw) + uy * sw;
          const nn = Math.hypot(nx, ny);
          ctx.strokeStyle = needleColor();
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + (nx / nn) * nl, by + (ny / nn) * nl); ctx.stroke();
        }
      }
      if (snowAmount > 0) {
        // snow sitting on the upper side of the twig
        for (let i = 0; i < n * 1.4; i++) {
          if (rng() > snowAmount) continue;
          const t = rng();
          const bx = x0 + dx * t, by = y0 + dy * t;
          const up = snowTop ? -1 : (rng() < 0.5 ? -1 : 1);
          const r = 2.2 + rng() * 3.2 * (1 - t * 0.4);
          const g = ctx.createRadialGradient(bx, by + up * r * 0.9, 0, bx, by + up * r * 0.9, r * 1.6);
          g.addColorStop(0, 'rgba(248,250,253,0.98)');
          g.addColorStop(0.6, 'rgba(236,242,248,0.9)');
          g.addColorStop(1, 'rgba(225,235,245,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(bx, by + up * r * 0.9, r * 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    };

    // --- side-view sprig (0..255 x 0..255): stem from left (trunk) to right (tip), drooping
    {
      const x0 = 6, y0 = 118, x1 = 250, y1 = 150;
      const steps = 11;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t * t;
        const tl = (46 - t * 28) * (0.85 + rng() * 0.3);
        const ang = 0.9 + rng() * 0.25;
        // twig pairs above and below the stem, both swept towards the tip
        twig(bx, by, bx + Math.cos(ang * 0.55) * tl, by - Math.sin(ang * 0.55) * tl, 10, true, 0.4);
        twig(bx, by, bx + Math.cos(ang * 0.6) * tl, by + Math.sin(ang * 0.6) * tl, 10, true, 0.08);
      }
      // main stem with a snow ridge on top
      ctx.strokeStyle = '#4a3620'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) * 0.5, y0 - 6, x1, y1); ctx.stroke();
      for (let i = 0; i < 26; i++) {
        const t = rng();
        const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t * t - 5 - rng() * 4;
        const r = 3 + rng() * 5 * (1 - t * 0.5);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        g.addColorStop(0, 'rgba(250,252,255,1)'); g.addColorStop(1, 'rgba(235,242,250,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // --- top-view sprig (256..511 x 0..255): stem left to right, twigs both sides, snow all over
    {
      const x0 = 262, y0 = 128, x1 = 506, y1 = 128;
      const steps = 11;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const bx = x0 + (x1 - x0) * t;
        const tl = (50 - t * 30) * (0.85 + rng() * 0.3);
        const ang = 0.95 + rng() * 0.2;
        twig(bx, y0, bx + Math.cos(ang) * tl, y0 - Math.sin(ang) * tl, 10, false, 0.5);
        twig(bx, y0, bx + Math.cos(ang) * tl, y0 + Math.sin(ang) * tl, 10, false, 0.5);
      }
      ctx.strokeStyle = '#4a3620'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      for (let i = 0; i < 40; i++) {
        const t = rng();
        const bx = x0 + (x1 - x0) * t, by = y0 + (rng() - 0.5) * 36 * (1 - t * 0.5);
        const r = 3 + rng() * 6 * (1 - t * 0.5);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        g.addColorStop(0, 'rgba(250,252,255,1)'); g.addColorStop(1, 'rgba(235,242,250,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // --- bark (0..511 x 256..511): opaque, vertical fissures
    {
      const img = ctx.getImageData(0, 256, size, 256);
      const d = img.data;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size, v = y / 256;
          const fiss = tileFbm2(u, v * 0.25, 18, 3, 5);
          const grain = tileNoise2(u, v, 90, 6);
          let l = 112 + (fiss - 0.5) * 80 + (grain - 0.5) * 24;
          l = Math.max(50, Math.min(175, l));
          const i = (y * size + x) * 4;
          d[i] = l * 0.92; d[i + 1] = l * 0.74; d[i + 2] = l * 0.56; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 256);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  // Snow-laden Himalayan fir built from branch cards: a bark trunk plus whorls of drooping
  // sprigs (a vertical side card and a horizontal top card each), shortening towards the leader.
  buildFirGeometry(seed) {
    const rng = makeRng(Math.floor(seed * 1000));
    const positions = [], normals = [], uvs = [], colors = [];
    const c = new THREE.Color();

    // --- trunk: tapered polygon with bark UVs (bottom half of the atlas)
    const trunkH = 10.5;
    const segs = 9;
    const rings = 6;
    const trunkRing = (k) => {
      const t = k / (rings - 1);
      return { y: t * trunkH, r: 0.46 * Math.pow(1 - t, 0.9) + 0.045 };
    };
    for (let k = 0; k < rings - 1; k++) {
      const a = trunkRing(k), b = trunkRing(k + 1);
      for (let j = 0; j < segs; j++) {
        const a0 = (j / segs) * Math.PI * 2, a1 = ((j + 1) / segs) * Math.PI * 2;
        const quad = [
          [Math.cos(a0) * a.r, a.y, Math.sin(a0) * a.r, j / segs, 0.5 + (k / (rings - 1)) * 0.5],
          [Math.cos(a1) * a.r, a.y, Math.sin(a1) * a.r, (j + 1) / segs, 0.5 + (k / (rings - 1)) * 0.5],
          [Math.cos(a1) * b.r, b.y, Math.sin(a1) * b.r, (j + 1) / segs, 0.5 + ((k + 1) / (rings - 1)) * 0.5],
          [Math.cos(a0) * b.r, b.y, Math.sin(a0) * b.r, j / segs, 0.5 + ((k + 1) / (rings - 1)) * 0.5]
        ];
        const n0 = [Math.cos(a0), 0.1, Math.sin(a0)], n1 = [Math.cos(a1), 0.1, Math.sin(a1)];
        const tri = (p, n) => { positions.push(p[0], p[1], p[2]); normals.push(n[0], n[1], n[2]); uvs.push(p[3], 1 - p[4]); colors.push(1, 1, 1); };
        tri(quad[0], n0); tri(quad[1], n1); tri(quad[2], n1);
        tri(quad[0], n0); tri(quad[2], n1); tri(quad[3], n0);
      }
    }

    // --- branch cards
    // Pushes a bent 3-column strip (two quads) given corner rows; both windings so it is lit
    // as a front face from either side with an upward-leaning normal.
    const strip = (rows, uvRegion, nrm, tint) => {
      const [u0, v0, u1, v1] = uvRegion;
      const rowUv = (i) => u0 + (u1 - u0) * (i / 2);
      const push = (p, uu, vv) => { positions.push(p[0], p[1], p[2]); normals.push(nrm[0], nrm[1], nrm[2]); uvs.push(uu, vv); colors.push(tint.r, tint.g, tint.b); };
      for (let i = 0; i < 2; i++) {
        const A = rows[0][i], B = rows[0][i + 1], C = rows[1][i + 1], D = rows[1][i];
        const ua = rowUv(i), ub = rowUv(i + 1);
        // front
        push(A, ua, 1 - v0); push(B, ub, 1 - v0); push(C, ub, 1 - v1);
        push(A, ua, 1 - v0); push(C, ub, 1 - v1); push(D, ua, 1 - v1);
        // back
        push(A, ua, 1 - v0); push(C, ub, 1 - v1); push(B, ub, 1 - v0);
        push(A, ua, 1 - v0); push(D, ua, 1 - v1); push(C, ub, 1 - v1);
      }
    };
    const SIDE = [0.012, 0.0, 0.49, 0.5];
    const TOP = [0.512, 0.0, 0.99, 0.5];

    const baseY = 1.4, topY = trunkH - 0.6;
    const whorlStep = 0.52;
    const perWhorl = IS_MOBILE ? 4 : 6;
    for (let y = baseY; y < topY; y += whorlStep) {
      const f = (y - baseY) / (topY - baseY);
      const L = 3.0 * Math.pow(1 - f, 0.75) + 0.35;
      const count = f > 0.85 ? 3 : perWhorl;
      const az0 = rng() * Math.PI * 2;
      for (let b = 0; b < count; b++) {
        const az = az0 + (b / count) * Math.PI * 2 + (rng() - 0.5) * 0.6;
        const len = L * (0.8 + rng() * 0.4);
        const dx = Math.cos(az), dz = Math.sin(az);
        // pitch: lower branches droop, upper reach up; the tip droops under snow
        const pitch = (-0.22 + f * 0.42) + (rng() - 0.5) * 0.12;
        const r0 = trunkRing(y / trunkH * (rings - 1)).r * 0.6;
        const p0 = [dx * r0, y, dz * r0];
        const p1 = [dx * (r0 + len * 0.5), y + len * 0.5 * pitch, dz * (r0 + len * 0.5)];
        const p2 = [dx * (r0 + len), y + len * pitch - len * 0.14, dz * (r0 + len)];
        const half = len * 0.26;
        const tint = c.setRGB(0.85 + rng() * 0.3, 0.85 + rng() * 0.3, 0.85 + rng() * 0.3);
        // side card: vertical strip along the branch
        const up = [0, 1, 0];
        strip([
          [[p0[0], p0[1] + half, p0[2]], [p1[0], p1[1] + half * 0.9, p1[2]], [p2[0], p2[1] + half * 0.7, p2[2]]],
          [[p0[0], p0[1] - half, p0[2]], [p1[0], p1[1] - half * 0.9, p1[2]], [p2[0], p2[1] - half * 0.7, p2[2]]]
        ], SIDE, [dx * 0.3 - dz * 0.0, 0.95, dz * 0.3], tint);
        // tilted card (desktop only) so the branch keeps volume when seen edge-on
        if (!IS_MOBILE) {
          const tilt = (b % 2 ? 1 : -1) * 0.6;
          const tx = -dz * Math.sin(tilt) * half, ty = Math.cos(tilt) * half, tz = dx * Math.sin(tilt) * half;
          strip([
            [[p0[0] + tx, p0[1] + ty, p0[2] + tz], [p1[0] + tx * 0.9, p1[1] + ty * 0.9, p1[2] + tz * 0.9], [p2[0] + tx * 0.7, p2[1] + ty * 0.7, p2[2] + tz * 0.7]],
            [[p0[0] - tx, p0[1] - ty, p0[2] - tz], [p1[0] - tx * 0.9, p1[1] - ty * 0.9, p1[2] - tz * 0.9], [p2[0] - tx * 0.7, p2[1] - ty * 0.7, p2[2] - tz * 0.7]]
          ], SIDE, [dx * 0.3, 0.95, dz * 0.3], tint);
        }
        // top card: horizontal strip across the branch
        const px = -dz * half, pz = dx * half;
        strip([
          [[p0[0] + px, p0[1], p0[2] + pz], [p1[0] + px * 0.95, p1[1], p1[2] + pz * 0.95], [p2[0] + px * 0.7, p2[1], p2[2] + pz * 0.7]],
          [[p0[0] - px, p0[1], p0[2] - pz], [p1[0] - px * 0.95, p1[1], p1[2] - pz * 0.95], [p2[0] - px * 0.7, p2[1], p2[2] - pz * 0.7]]
        ], TOP, up, tint);
      }
    }
    // leader: a few short upright sprigs at the very top
    for (let b = 0; b < 3; b++) {
      const az = (b / 3) * Math.PI * 2 + rng();
      const dx = Math.cos(az), dz = Math.sin(az);
      const y0 = topY - 0.1;
      strip([
        [[0, y0 + 0.25, 0], [dx * 0.3, y0 + 0.75, dz * 0.3], [dx * 0.45, y0 + 1.1, dz * 0.45]],
        [[0, y0 - 0.25, 0], [dx * 0.3, y0 + 0.2, dz * 0.3], [dx * 0.45, y0 + 0.5, dz * 0.45]]
      ], SIDE, [dx * 0.4, 0.9, dz * 0.4], c.setRGB(0.95, 0.95, 0.95));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }

  createTrees() {
    const atlas = this.createTreeAtlas();
    const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, vertexColors: true, roughness: 0.9, metalness: 0.0 });
    // alpha-cut shadows need a depth material that knows about the atlas
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.45 });
    const variants = [this.buildFirGeometry(1.1), this.buildFirGeometry(5.7), this.buildFirGeometry(9.3)];
    const rng = makeRng(777);

    // Groves: cluster centres with a handful of trees each, plus loners
    const placements = [];
    const groves = IS_MOBILE ? 11 : 14;
    for (let g = 0; g < groves; g++) {
      const ga = rng() * Math.PI * 2;
      const gd = 28 + rng() * (this.halfSize - 58);
      const gx = Math.cos(ga) * gd, gz = Math.sin(ga) * gd;
      const n = 5 + Math.floor(rng() * 7);
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rng()) * 14;
        const a = rng() * Math.PI * 2;
        placements.push({ x: gx + Math.cos(a) * r, z: gz + Math.sin(a) * r, s: 0.7 + rng() * 0.8 });
      }
    }
    for (let i = 0; i < 20; i++) {
      const a = rng() * Math.PI * 2;
      const d = 24 + rng() * (this.halfSize - 50);
      placements.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.8 + rng() * 0.9 });
    }

    const perVariant = Math.ceil(placements.length / variants.length);
    const meshes = variants.map((geo) => {
      const inst = new THREE.InstancedMesh(geo, mat, perVariant);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.customDepthMaterial = depthMat;
      inst.count = 0;
      return inst;
    });
    const dummy = new THREE.Object3D();
    const norm = new THREE.Vector3();
    placements.forEach((pl, idx) => {
      if (Math.sqrt(pl.x * pl.x + pl.z * pl.z) < 20) return;
      this.getTerrainNormal(pl.x, pl.z, norm);
      if (norm.y < 0.8) return;
      // keep trees out of boulders
      for (const o of this.obstacles) {
        if ((o.x - pl.x) ** 2 + (o.z - pl.z) ** 2 < (o.radius + 1.5) ** 2) return;
      }
      const inst = meshes[idx % meshes.length];
      const y = this.getTerrainHeight(pl.x, pl.z);
      dummy.position.set(pl.x, y - 0.3, pl.z);
      dummy.rotation.set((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
      dummy.scale.set(pl.s, pl.s * (0.9 + rng() * 0.3), pl.s);
      dummy.updateMatrix();
      inst.setMatrixAt(inst.count, dummy.matrix);
      inst.count++;
      this.obstacles.push({ x: pl.x, z: pl.z, radius: 0.55 * pl.s, kind: 'tree' });
    });
    meshes.forEach((inst) => {
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    });
  }

  // ------------------------------------------------------------------ mist
  createDriftingMist() {
    const mistGeo = new THREE.PlaneGeometry(70, 48);
    mistGeo.rotateX(-Math.PI / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(235, 245, 255, 0.22)');
    grad.addColorStop(0.5, 'rgba(215, 235, 255, 0.10)');
    grad.addColorStop(1.0, 'rgba(200, 225, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const mistMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
    const rng = makeRng(31);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + rng() * 0.4;
      const dist = 30 + rng() * (this.halfSize - 60);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = this.getTerrainHeight(x, z) + 1.2 + rng() * 2.5;
      const mist = new THREE.Mesh(mistGeo, mistMat);
      mist.position.set(x, y, z);
      mist.scale.set(1.0 + rng() * 0.8, 1.0, 1.0 + rng() * 0.8);
      mist.rotation.y = rng() * Math.PI;
      this.scene.add(mist);
      this.mistPlanes.push({ mesh: mist, speed: 0.8 + rng() * 1.2, baseX: x, baseZ: z });
    }
  }

  // ------------------------------------------------------------------ paw prints
  createPawTracksSystem() {
    const trackGeo = new THREE.PlaneGeometry(0.75, 0.9);
    trackGeo.rotateX(-Math.PI / 2);

    this.pawPrintTextures = {
      normal: this.makePawPrintTexture([96, 118, 146], [120, 142, 168], [150, 170, 195]),
      gold: null // built on first use (collection book reward)
    };
    const trackMat = new THREE.MeshBasicMaterial({ map: this.pawPrintTextures.normal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

    this.maxPawTracks = 120;
    this.pawTrackMesh = new THREE.InstancedMesh(trackGeo, trackMat, this.maxPawTracks);
    this.pawTrackIndex = 0;
    this.pawTrackDummy = new THREE.Object3D();
    this.pawTrackDummy.position.set(0, -999, 0);
    this.pawTrackDummy.updateMatrix();
    for (let i = 0; i < this.maxPawTracks; i++) this.pawTrackMesh.setMatrixAt(i, this.pawTrackDummy.matrix);
    this.pawTrackMesh.instanceMatrix.needsUpdate = true;
    this.pawTrackMesh.frustumCulled = false;
    this.scene.add(this.pawTrackMesh);
    this.pawSide = 1;
  }

  // Feline print: big pad + four toes. Colours are the centre, mid and edge of each pad.
  makePawPrintTexture(inner, mid, outer) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const blob = (x, y, rx, ry, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      g.addColorStop(0, `rgba(${inner.join(', ')}, ${a})`);
      g.addColorStop(0.65, `rgba(${mid.join(', ')}, ${a * 0.55})`);
      g.addColorStop(1, `rgba(${outer.join(', ')}, 0)`);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / rx);
      ctx.translate(-x, -y);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    blob(32, 40, 15, 13, 0.75);
    blob(16, 23, 7, 8, 0.7);
    blob(27, 14, 7, 8, 0.7);
    blob(39, 14, 7, 8, 0.7);
    blob(49, 23, 7, 8, 0.7);
    return new THREE.CanvasTexture(canvas);
  }

  // Switches every paw print between the plain snow-shadow look and gold
  setGoldenPawPrints(on) {
    if (on && !this.pawPrintTextures.gold) {
      const tex = this.makePawPrintTexture([226, 160, 18], [245, 196, 64], [255, 222, 120]);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.pawPrintTextures.gold = tex;
    }
    this.pawTrackMesh.material.map = on ? this.pawPrintTextures.gold : this.pawPrintTextures.normal;
    this.pawTrackMesh.material.needsUpdate = true;
  }

  // Called when the leopard or prey steps on snow
  addPawPrint(x, z, angle, scale = 1.0) {
    if (!this.pawTrackMesh) return;
    // alternate left / right of the travel line
    this.pawSide = -this.pawSide;
    const ox = Math.cos(angle) * 0.32 * scale * this.pawSide;
    const oz = -Math.sin(angle) * 0.32 * scale * this.pawSide;
    const px = x + ox, pz = z + oz;
    const y = this.getTerrainHeight(px, pz) + 0.03;
    this.pawTrackDummy.position.set(px, y, pz);
    this.pawTrackDummy.rotation.set(0, angle, 0);
    this.pawTrackDummy.scale.set(scale, 1.0, scale);
    this.pawTrackDummy.updateMatrix();
    this.pawTrackMesh.setMatrixAt(this.pawTrackIndex, this.pawTrackDummy.matrix);
    this.pawTrackMesh.instanceMatrix.needsUpdate = true;
    this.pawTrackIndex = (this.pawTrackIndex + 1) % this.maxPawTracks;
  }

  // ------------------------------------------------------------------ weather
  createSnowWeather() {
    const flakeCount = IS_MOBILE ? 420 : 700;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(flakeCount * 3);
    const velocities = new Float32Array(flakeCount * 3);
    for (let i = 0; i < flakeCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
      velocities[i * 3] = -0.5 - Math.random() * 1.5;
      velocities[i * 3 + 1] = -1.2 - Math.random() * 1.8;
      velocities[i * 3 + 2] = 0.2 + (Math.random() - 0.5) * 0.8;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snowVelocities = velocities;

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.4, 'rgba(240, 248, 255, 0.6)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    const material = new THREE.PointsMaterial({ size: 0.32, map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0.8, depthWrite: false });
    this.snowParticles = new THREE.Points(geometry, material);
    this.snowParticles.frustumCulled = false;
    this.scene.add(this.snowParticles);
  }

  update(delta, playerPos) {
    this.time += delta;
    if (this.skyDome) {
      this.skyDome.position.x = playerPos.x;
      this.skyDome.position.z = playerPos.z;
    }
    for (let i = 0; i < this.mistPlanes.length; i++) {
      const mist = this.mistPlanes[i];
      mist.mesh.position.x += mist.speed * delta * 1.8;
      if (mist.mesh.position.x > mist.baseX + 40) mist.mesh.position.x = mist.baseX - 40;
    }
    if (!this.snowParticles) return;
    this.snowParticles.position.x = playerPos.x;
    this.snowParticles.position.z = playerPos.z;
    const pos = this.snowParticles.geometry.attributes.position;
    const gust = Math.sin(this.time * 0.7) * 0.6;
    for (let i = 0; i < pos.count; i++) {
      let py = pos.getY(i) + this.snowVelocities[i * 3 + 1] * delta * 4;
      let px = pos.getX(i) + (this.snowVelocities[i * 3] + gust) * delta * 4;
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
