import fs from 'fs';
import sharp from 'sharp';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Load GLTF model
const glbBuffer = fs.readFileSync('public/snow_leopard.glb');
const arrayBuffer = glbBuffer.buffer.slice(glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuffer, '', async (gltf) => {
  let mesh;
  gltf.scene.traverse((obj) => {
    if (obj.isSkinnedMesh) mesh = obj;
  });

  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  const norm = mesh.geometry.attributes.normal;
  const idx = mesh.geometry.index;

  const W = 2048;
  const H = 2048;
  const diffuseBuf = Buffer.alloc(W * H * 4, 0);
  const bumpBuf = Buffer.alloc(W * H * 4, 128);
  const roughnessBuf = Buffer.alloc(W * H * 4, 200);

  // Precompute 3D Rosette Centers distributed along flanks, ribs, hips
  // Seeded deterministic pseudorandom
  function pseudoRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  const rosetteCenters = [];
  for (let i = 0; i < 90; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    // Flank / haunch distribution
    const rz = -0.55 + pseudoRandom(i * 1.31) * 0.95; // Z in [-0.55, 0.40]
    const ry = -0.15 + pseudoRandom(i * 2.73) * 0.38; // Y in [-0.15, 0.23]
    const rx = side * (0.12 + pseudoRandom(i * 3.19) * 0.14); // X on sides
    const size = 0.045 + pseudoRandom(i * 4.47) * 0.035; // 3D radius ~ 5-8cm
    const numPetals = 4 + Math.floor(pseudoRandom(i * 5.81) * 3); // 4-6 petals
    rosetteCenters.push({ x: rx, y: ry, z: rz, size, numPetals, seed: i });
  }

  // Precompute small dark spots (forehead, neck, legs, tail base)
  const spotCenters = [];
  for (let i = 0; i < 220; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const rz = -0.75 + pseudoRandom(i * 1.83) * 1.65;
    const ry = -0.55 + pseudoRandom(i * 2.41) * 0.95;
    const rx = side * (0.02 + pseudoRandom(i * 3.67) * 0.22);
    const size = 0.015 + pseudoRandom(i * 4.19) * 0.020;
    spotCenters.push({ x: rx, y: ry, z: rz, size });
  }

  console.log('Baking high-definition photorealistic Snow Leopard textures (2048x2048)...');
  const startTime = Date.now();

  // Helper color lerp
  function lerpColor(c1, c2, t) {
    const clampT = Math.max(0, Math.min(1, t));
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * clampT),
      Math.round(c1[1] + (c2[1] - c1[1]) * clampT),
      Math.round(c1[2] + (c2[2] - c1[2]) * clampT)
    ];
  }

  // Palette definitions
  const COL_DORSAL_SPINE = [156, 166, 176];   // Smoky slate alpine grey
  const COL_DORSAL_WARM = [196, 185, 168];    // Warm golden-buff sunlit wash
  const COL_FLANK_PALE = [222, 227, 233];     // Silver-cream flank
  const COL_BELLY_WHITE = [252, 254, 255];    // Snow-white underfur
  const COL_ROSETTE_CENTER = [172, 158, 144]; // Warm shadowed sepia inside rosette
  const COL_CHARCOAL_DARK = [28, 32, 38];     // Charcoal black rosette ring / spots
  const COL_NOSE_LEATHER = [62, 54, 54];      // Slate leather feline nose pad
  const COL_EYELINER = [20, 22, 26];          // Dark eye rim margin

  // Color & bump evaluation at 3D point (px, py, pz) with normal (nx, ny, nz)
  function evaluateShading(px, py, pz, nx, ny, nz) {
    // 1. Base coat gradient based on vertical position and surface normal
    // Upward-facing spine vs downward-facing belly
    let spineFactor = Math.max(0, Math.min(1, (py - 0.05) / 0.30));
    let bellyFactor = Math.max(0, Math.min(1, (-ny - 0.1) / 0.70));
    if (py < -0.10 && Math.abs(px) < 0.16) {
      bellyFactor = Math.max(bellyFactor, Math.min(1, (-py - 0.10) / 0.40));
    }

    // Throat & chest are pure white
    if (pz > 0.35 && pz < 0.75 && py < 0.15 && Math.abs(px) < 0.14) {
      bellyFactor = 1.0;
    }

    let baseCol = lerpColor(COL_FLANK_PALE, COL_DORSAL_WARM, spineFactor * 0.85);
    baseCol = lerpColor(baseCol, COL_DORSAL_SPINE, spineFactor * 0.65);
    baseCol = lerpColor(baseCol, COL_BELLY_WHITE, bellyFactor);

    // Microscopic dense fur grain noise
    const furGrain = ((Math.sin(px * 320 + py * 410) * Math.cos(pz * 370 + px * 290)) + 1) * 0.5;
    const grainDelta = (furGrain - 0.5) * 8;
    let r = Math.min(255, Math.max(0, baseCol[0] + grainDelta));
    let g = Math.min(255, Math.max(0, baseCol[1] + grainDelta));
    let b = Math.min(255, Math.max(0, baseCol[2] + grainDelta));

    let bump = 128 + (furGrain - 0.5) * 22;
    let roughness = 210;

    // 2. Rosettes on Flanks & Hips
    if (bellyFactor < 0.65 && pz < 0.45 && pz > -0.65 && py > -0.35) {
      for (let i = 0; i < rosetteCenters.length; i++) {
        const rc = rosetteCenters[i];
        const dx = px - rc.x;
        const dy = py - rc.y;
        const dz = pz - rc.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const radSq = rc.size * rc.size;

        if (distSq < radSq * 1.6) {
          const dist = Math.sqrt(distSq);
          const normDist = dist / rc.size;

          // Inside rosette center (warm taupe/sepia wash)
          if (normDist < 0.75) {
            const centerBlend = (1.0 - normDist / 0.75) * 0.55;
            const cCol = lerpColor([r, g, b], COL_ROSETTE_CENTER, centerBlend);
            r = cCol[0]; g = cCol[1]; b = cCol[2];
            bump += centerBlend * -10;
          }

          // Outer ring of charcoal spot petals
          // Angle around rosette center
          const angle = Math.atan2(dy, Math.abs(dx) > Math.abs(dz) ? dz : dx);
          const petalWave = Math.sin(angle * rc.numPetals + rc.seed);
          if (normDist >= 0.65 && normDist <= 1.25 && petalWave > -0.2) {
            const petalStrength = Math.min(1.0, (1.0 - Math.abs(normDist - 0.95) / 0.30) * (petalWave + 0.2) * 1.4);
            if (petalStrength > 0.1) {
              const dCol = lerpColor([r, g, b], COL_CHARCOAL_DARK, petalStrength * 0.92);
              r = dCol[0]; g = dCol[1]; b = dCol[2];
              bump += petalStrength * -18;
              roughness = Math.round(roughness - petalStrength * 30);
            }
          }
        }
      }
    }

    // 3. Spinal dark spot streaks along dorsal ridge
    if (py > 0.22 && Math.abs(px) < 0.06 && pz > -0.45 && pz < 0.35) {
      const spineSpotWave = Math.sin(pz * 42.0);
      if (spineSpotWave > 0.45) {
        const spotStrength = (spineSpotWave - 0.45) * 1.8;
        const dCol = lerpColor([r, g, b], COL_CHARCOAL_DARK, spotStrength * 0.88);
        r = dCol[0]; g = dCol[1]; b = dCol[2];
        bump -= spotStrength * 16;
      }
    }

    // 4. Solid dark spots (head crown, face, neck, legs)
    if (bellyFactor < 0.60) {
      for (let i = 0; i < spotCenters.length; i++) {
        const sc = spotCenters[i];
        const dx = px - sc.x;
        const dy = py - sc.y;
        const dz = pz - sc.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const radSq = sc.size * sc.size;
        if (distSq < radSq) {
          const spotStrength = (1.0 - Math.sqrt(distSq) / sc.size) * 0.90;
          const dCol = lerpColor([r, g, b], COL_CHARCOAL_DARK, spotStrength);
          r = dCol[0]; g = dCol[1]; b = dCol[2];
          bump -= spotStrength * 16;
        }
      }
    }

    // 5. Authentic Tail Ring Bands & Dark Furry Tip (NO puffball!)
    if (pz < -0.42) {
      // Ring bands along tail length
      const tailProgress = Math.max(0, Math.min(1, (-pz - 0.42) / 0.58)); // 0 at base, 1 at tip
      const ringPattern = Math.sin((-pz) * 36.0);

      // Tail rings get progressively darker and more solid toward the tip
      if (ringPattern > 0.35 && tailProgress < 0.88) {
        const ringStrength = Math.min(1.0, (ringPattern - 0.35) * 1.55 * (0.6 + tailProgress * 0.4));
        const dCol = lerpColor([r, g, b], COL_CHARCOAL_DARK, ringStrength * 0.90);
        r = dCol[0]; g = dCol[1]; b = dCol[2];
        bump -= ringStrength * 15;
      }

      // Terminal bushy tail tip: soft dark charcoal/black fur (continuous, no separate ball)
      if (pz < -0.92) {
        const tipBlend = Math.min(1.0, (-pz - 0.92) / 0.08);
        const tCol = lerpColor([r, g, b], [24, 26, 30], tipBlend * 0.94);
        r = tCol[0]; g = tCol[1]; b = tCol[2];
        bump -= tipBlend * 12;
      }
    }

    // 6. Facial Features: Muzzle, Whisker Pads, Nose Leather, Eyes, Ears
    // Nose Leather Pad (Tip of snout)
    if (pz > 0.94 && py > 0.20 && py < 0.30 && Math.abs(px) < 0.038) {
      const noseDist = Math.sqrt(px * px * 3.5 + Math.pow(py - 0.25, 2) * 5.0 + Math.pow(1.0 - pz, 2) * 6.0);
      if (noseDist < 0.11) {
        const nBlend = Math.min(1.0, (0.11 - noseDist) / 0.04);
        const nCol = lerpColor([r, g, b], COL_NOSE_LEATHER, nBlend * 0.96);
        r = nCol[0]; g = nCol[1]; b = nCol[2];
        bump = Math.round(bump * (1 - nBlend) + 95 * nBlend); // Fine leather grain
        roughness = Math.round(roughness * (1 - nBlend) + 140 * nBlend);
      }
    }

    // Broad white whisker pads & dark lip margin
    if (pz > 0.82 && pz <= 0.96 && py > 0.16 && py < 0.26 && Math.abs(px) < 0.09) {
      const mCol = lerpColor([r, g, b], [254, 254, 255], 0.90);
      r = mCol[0]; g = mCol[1]; b = mCol[2];

      // Subtle rows of dark whisker follicle dots
      const dotRow = Math.sin((py - 0.16) * 180.0);
      const dotCol = Math.sin(pz * 220.0);
      if (dotRow > 0.75 && dotCol > 0.75) {
        r = 45; g = 48; b = 55;
      }
    }

    // Chin & underjaw (pure white)
    if (pz > 0.78 && pz < 0.98 && py < 0.18 && Math.abs(px) < 0.07) {
      r = 254; g = 254; b = 255;
    }

    // Eye sockets: dark eyeliner rim & icy glacial green iris
    if (pz > 0.70 && pz < 0.84 && py > 0.26 && py < 0.38 && Math.abs(px) > 0.075 && Math.abs(px) < 0.16) {
      const eyeDx = Math.abs(px) - 0.118;
      const eyeDy = py - 0.32;
      const eyeDist = Math.sqrt(eyeDx * eyeDx * 1.8 + eyeDy * eyeDy);

      // Eyeliner rim
      if (eyeDist < 0.042) {
        if (eyeDist > 0.025) {
          r = COL_EYELINER[0]; g = COL_EYELINER[1]; b = COL_EYELINER[2];
        } else if (eyeDist > 0.010) {
          // Pale icy glacial green iris
          r = 126; g = 172; b = 162;
          roughness = 40;
        } else {
          // Vertical slit pupil
          if (Math.abs(eyeDx) < 0.005) {
            r = 15; g = 15; b = 18;
          } else {
            r = 126; g = 172; b = 162;
          }
          roughness = 30;
        }
      }
    }

    // Ears: Charcoal outer shell with white rim and inner insulating tufts
    if (pz > 0.42 && pz < 0.62 && py > 0.38 && Math.abs(px) > 0.12 && Math.abs(px) < 0.26) {
      if (nx > 0.2 || nx < -0.2) {
        // Outer shell
        r = COL_CHARCOAL_DARK[0]; g = COL_CHARCOAL_DARK[1]; b = COL_CHARCOAL_DARK[2];
      } else {
        // Inner ear white fur
        r = 252; g = 254; b = 255;
      }
    }

    // Snowshoe Paws: dense white fur with dark claws
    if (py < -0.52) {
      const pawWhite = Math.min(1.0, (-py - 0.52) / 0.08);
      const pCol = lerpColor([r, g, b], [248, 250, 252], pawWhite * 0.95);
      r = pCol[0]; g = pCol[1]; b = pCol[2];

      // Dark claws at the very bottom front of paws
      if (py < -0.58 && ((pz > 0.25 && pz < 0.40) || (pz < -0.20 && pz > -0.35))) {
        r = 24; g = 26; b = 30;
      }
    }

    return { r, g, b, bump, roughness };
  }

  // Rasterize all 6684 triangles into UV space
  let drawnCount = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);

    // 3D Positions
    const p0 = [pos.getX(i0), pos.getY(i0), pos.getZ(i0)];
    const p1 = [pos.getX(i1), pos.getY(i1), pos.getZ(i1)];
    const p2 = [pos.getX(i2), pos.getY(i2), pos.getZ(i2)];

    // 3D Normals
    const n0 = [norm.getX(i0), norm.getY(i0), norm.getZ(i0)];
    const n1 = [norm.getX(i1), norm.getY(i1), norm.getZ(i1)];
    const n2 = [norm.getX(i2), norm.getY(i2), norm.getZ(i2)];

    // UV coordinates (V flipped for image bitmap)
    const u0 = uv.getX(i0) * (W - 1), v0 = (1.0 - uv.getY(i0)) * (H - 1);
    const u1 = uv.getX(i1) * (W - 1), v1 = (1.0 - uv.getY(i1)) * (H - 1);
    const u2 = uv.getX(i2) * (W - 1), v2 = (1.0 - uv.getY(i2)) * (H - 1);

    const minX = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 1);
    const maxX = Math.min(W - 1, Math.ceil(Math.max(u0, u1, u2)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 1);
    const maxY = Math.min(H - 1, Math.ceil(Math.max(v0, v1, v2)) + 1);

    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
    if (Math.abs(denom) < 1e-6) continue;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((v1 - v2) * (x - u2) + (u2 - u1) * (y - v2)) / denom;
        const w1 = ((v2 - v0) * (x - u2) + (u0 - u2) * (y - v2)) / denom;
        const w2 = 1.0 - w0 - w1;

        // Slight dilation (-0.02) to guarantee no seam cracks between UV islands
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) {
          const pi = (y * W + x) * 4;

          // Interpolated 3D position
          const px = w0 * p0[0] + w1 * p1[0] + w2 * p2[0];
          const py = w0 * p0[1] + w1 * p1[1] + w2 * p2[1];
          const pz = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];

          // Interpolated 3D normal
          let nx = w0 * n0[0] + w1 * n1[0] + w2 * n2[0];
          let ny = w0 * n0[1] + w1 * n1[1] + w2 * n2[1];
          let nz = w0 * n0[2] + w1 * n1[2] + w2 * n2[2];
          const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
          nx /= nlen; ny /= nlen; nz /= nlen;

          const sh = evaluateShading(px, py, pz, nx, ny, nz);

          diffuseBuf[pi] = sh.r;
          diffuseBuf[pi + 1] = sh.g;
          diffuseBuf[pi + 2] = sh.b;
          diffuseBuf[pi + 3] = 255;

          const bVal = Math.max(0, Math.min(255, Math.round(sh.bump)));
          bumpBuf[pi] = bVal;
          bumpBuf[pi + 1] = bVal;
          bumpBuf[pi + 2] = bVal;
          bumpBuf[pi + 3] = 255;

          const rVal = Math.max(0, Math.min(255, Math.round(sh.roughness)));
          roughnessBuf[pi] = rVal;
          roughnessBuf[pi + 1] = rVal;
          roughnessBuf[pi + 2] = rVal;
          roughnessBuf[pi + 3] = 255;

          drawnCount++;
        }
      }
    }
  }

  console.log(`Rasterized ${drawnCount} pixels in ${Date.now() - startTime}ms.`);

  // Post-processing dilation to eliminate any stray 1-pixel seams
  console.log('Dilating texture margins...');
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const pi = (y * W + x) * 4;
      if (diffuseBuf[pi + 3] === 0) {
        // Look for neighbor
        const neighbors = [
          ((y - 1) * W + x) * 4,
          ((y + 1) * W + x) * 4,
          (y * W + (x - 1)) * 4,
          (y * W + (x + 1)) * 4
        ];
        for (const n of neighbors) {
          if (diffuseBuf[n + 3] > 0) {
            diffuseBuf[pi] = diffuseBuf[n];
            diffuseBuf[pi + 1] = diffuseBuf[n + 1];
            diffuseBuf[pi + 2] = diffuseBuf[n + 2];
            diffuseBuf[pi + 3] = 255;
            bumpBuf[pi] = bumpBuf[n];
            bumpBuf[pi + 1] = bumpBuf[n + 1];
            bumpBuf[pi + 2] = bumpBuf[n + 2];
            bumpBuf[pi + 3] = 255;
            roughnessBuf[pi] = roughnessBuf[n];
            roughnessBuf[pi + 1] = roughnessBuf[n + 1];
            roughnessBuf[pi + 2] = roughnessBuf[n + 2];
            roughnessBuf[pi + 3] = 255;
            break;
          }
        }
      }
    }
  }

  // Save textures using sharp
  await sharp(diffuseBuf, { raw: { width: W, height: H, channels: 4 } })
    .png({ quality: 95 })
    .toFile('public/snow_leopard_diffuse.png');
  console.log('Saved public/snow_leopard_diffuse.png');

  await sharp(bumpBuf, { raw: { width: W, height: H, channels: 4 } })
    .png({ quality: 90 })
    .toFile('public/snow_leopard_bump.png');
  console.log('Saved public/snow_leopard_bump.png');

  await sharp(roughnessBuf, { raw: { width: W, height: H, channels: 4 } })
    .png({ quality: 90 })
    .toFile('public/snow_leopard_roughness.png');
  console.log('Saved public/snow_leopard_roughness.png');

  console.log('Finished all textures successfully!');
});
