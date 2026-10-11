import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic noise helpers (hash-based value noise) shared by every generator
// ---------------------------------------------------------------------------
export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function smooth(t) { return t * t * (3 - 2 * t); }
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz
  );
}
export function fbm3(x, y, z, octaves = 4) {
  let v = 0, amp = 0.5, tot = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise3(x * f, y * f, z * f);
    tot += amp; amp *= 0.5; f *= 2.03;
  }
  return v / tot;
}
export function noise2(x, y) { return noise3(x, y, 7.31); }
export function fbm2(x, y, octaves = 4) { return fbm3(x, y, 3.17, octaves); }
// Seamlessly tileable fbm over the unit square (blend of four shifted copies)
export function tileFbm2(u, v, f, octaves = 3, seed = 0) {
  return fbm2(u * f + seed, v * f, octaves) * (1 - u) * (1 - v) + fbm2((u - 1) * f + seed, v * f, octaves) * u * (1 - v) +
         fbm2(u * f + seed, (v - 1) * f, octaves) * (1 - u) * v + fbm2((u - 1) * f + seed, (v - 1) * f, octaves) * u * v;
}
export function tileNoise2(u, v, f, seed = 0) {
  return noise2(u * f + seed, v * f) * (1 - u) * (1 - v) + noise2((u - 1) * f + seed, v * f) * u * (1 - v) +
         noise2(u * f + seed, (v - 1) * f) * (1 - u) * v + noise2((u - 1) * f + seed, (v - 1) * f) * u * v;
}

// Seeded RNG for repeatable scatter layouts
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a tangent-space normal map texture from a height callback over a tileable canvas
export function heightToNormalTexture(size, heightFn, strength = 2.0) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = heightFn(x / size, y / size);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
      const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
      let nx = -(xr - xl) * strength, ny = -(yd - yu) * strength, nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Greyscale tileable fur-grain colour map (streaks along v) that multiplies vertex colours,
// plus a matching normal map. `shag` stretches the streaks for long coarse hair.
export function makeFurTextures(size = 256, shag = 1.0, contrast = 0.2, seed = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const heightFn = (u, v) => {
    const streak = tileNoise2(u, v * (0.18 / shag), 90 * shag, seed) * 0.55 + tileNoise2(u, v * 0.4, 36, seed + 3) * 0.3;
    const clump = tileFbm2(u, v, 5, 2, seed + 7) * 0.4;
    return streak + clump;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = heightFn(x / size, y / size);
      const g = Math.max(0, Math.min(255, 200 + (h - 0.6) * 255 * contrast * 2));
      const i = (y * size + x) * 4;
      d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const normalMap = heightToNormalTexture(size, heightFn, 3.0);
  return { map, normalMap };
}

// ---------------------------------------------------------------------------
// Lofted tube: a smooth surface swept along a path of elliptical cross-sections.
// path: [{ x, y, z, rx, ry }] ; colorFn(pointIndex, t, upness, px, py, pz) -> THREE.Color
// Returns an indexed BufferGeometry with position / normal / uv / color.
// ---------------------------------------------------------------------------
const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3();
const _p = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
export function buildTube(path, radial = 16, colorFn = null, opts = {}) {
  const positions = [], uvs = [], colors = [], indices = [];
  const rings = path.length;
  const c = new THREE.Color(0xffffff);
  const uScale = opts.uScale || 1, vScale = opts.vScale || 1;

  for (let i = 0; i < rings; i++) {
    const pt = path[i];
    _p.set(pt.x, pt.y, pt.z);
    const prev = path[Math.max(0, i - 1)], next = path[Math.min(rings - 1, i + 1)];
    _pa.set(prev.x, prev.y, prev.z); _pb.set(next.x, next.y, next.z);
    _t.subVectors(_pb, _pa).normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_t.dot(_up)) > 0.96) _up.set(0, 0, -1);
    _n.copy(_up).addScaledVector(_t, -_up.dot(_t)).normalize(); // local "up"
    _b.crossVectors(_t, _n).normalize(); // local "right"
    const roll = pt.roll || 0;
    for (let j = 0; j <= radial; j++) {
      const a = ((j % radial) / radial) * Math.PI * 2 + roll;
      const cx = Math.cos(a) * pt.rx, cy = Math.sin(a) * pt.ry;
      const x = _p.x + _b.x * cx + _n.x * cy;
      const y = _p.y + _b.y * cx + _n.y * cy;
      const z = _p.z + _b.z * cx + _n.z * cy;
      positions.push(x, y, z);
      uvs.push((j / radial) * uScale, (i / (rings - 1)) * vScale);
      const upness = Math.sin(a);
      const sideness = Math.cos(a);
      if (colorFn) c.copy(colorFn(i, i / (rings - 1), upness, sideness, x, y, z));
      colors.push(c.r, c.g, c.b);
    }
  }
  const cols = radial + 1;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j, b = i * cols + j + 1;
      const cIdx = a + cols, dIdx = b + cols;
      indices.push(a, cIdx, b, b, cIdx, dIdx);
    }
  }
  // end caps (centre vertex fans)
  const capStart = positions.length / 3;
  for (const end of [0, rings - 1]) {
    const pt = path[end];
    positions.push(pt.x, pt.y, pt.z);
    uvs.push(0.5, end === 0 ? 0 : vScale);
    if (colorFn) c.copy(colorFn(end, end === 0 ? 0 : 1, 0, 0, pt.x, pt.y, pt.z));
    colors.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < radial; j++) {
    indices.push(capStart, j + 1, j);
    const base = (rings - 1) * cols;
    indices.push(capStart + 1, base + j, base + j + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // the duplicated seam column must share one normal so the UV seam stays invisible
  const nAttr = geo.attributes.normal;
  for (let i = 0; i < rings; i++) {
    const a = i * cols, b = i * cols + radial;
    const nx = nAttr.getX(a) + nAttr.getX(b), ny = nAttr.getY(a) + nAttr.getY(b), nz = nAttr.getZ(a) + nAttr.getZ(b);
    const len = Math.hypot(nx, ny, nz) || 1;
    nAttr.setXYZ(a, nx / len, ny / len, nz / len);
    nAttr.setXYZ(b, nx / len, ny / len, nz / len);
  }
  nAttr.needsUpdate = true;
  return geo;
}

// Interpolates a sparse list of control points {x,y,z,rx,ry} into a smooth (Catmull-Rom) path
export function smoothPath(controls, subdivisions = 4) {
  const out = [];
  const n = controls.length;
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  for (let i = 0; i < n - 1; i++) {
    const p0 = controls[Math.max(0, i - 1)], p1 = controls[i], p2 = controls[i + 1], p3 = controls[Math.min(n - 1, i + 2)];
    const steps = i === n - 2 ? subdivisions + 1 : subdivisions;
    for (let s = 0; s < steps; s++) {
      const t = s / subdivisions;
      const pt = {};
      for (const k of ['x', 'y', 'z', 'rx', 'ry']) pt[k] = cr(p0[k], p1[k], p2[k], p3[k], t);
      if (p1.roll !== undefined || p2.roll !== undefined) pt.roll = (p1.roll || 0) * (1 - t) + (p2.roll || 0) * t;
      pt.rx = Math.max(0.005, pt.rx); pt.ry = Math.max(0.005, pt.ry);
      out.push(pt);
    }
  }
  return out;
}
