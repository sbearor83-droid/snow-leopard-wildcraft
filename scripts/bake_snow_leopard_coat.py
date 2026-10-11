#!/usr/bin/env python3
"""
Bake the snow leopard coat (base color + fur normal map) straight onto the rigged
model's UV layout and embed the result in public/snow_leopard.glb.

The coat is evaluated in 3D model space (rosettes on a lattice wrapped around the
torso, spots around each leg, rings along the tail, eyes/nose/ears by position),
so it is seam-free regardless of the auto-generated UV islands.

Usage:
    python3 scripts/bake_snow_leopard_coat.py            # 2048px, writes public/snow_leopard.glb
    python3 scripts/bake_snow_leopard_coat.py --size 1024 --preview out.png

Requires: numpy, Pillow (pip install numpy pillow). Takes ~2 minutes at 2048px.
"""
import argparse, json, os, struct, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_PATH = os.path.join(ROOT, 'public', 'snow_leopard.glb')

# ---------------------------------------------------------------- glb reading
def read_glb(path):
    d = open(path, 'rb').read()
    ln = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + ln])
    bl = struct.unpack('<I', d[20 + ln:24 + ln])[0]
    return j, d[28 + ln:28 + ln + bl]

def read_accessor(j, bin_, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride')
    ct = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    item = n * np.dtype(ct).itemsize
    if stride and stride != item:
        rows = [np.frombuffer(bin_, dtype=ct, count=n, offset=off + k * stride) for k in range(a['count'])]
        return np.stack(rows)
    return np.frombuffer(bin_, dtype=ct, count=a['count'] * n, offset=off).reshape(a['count'], n)

def load_mesh(j, bin_):
    p = j['meshes'][0]['primitives'][0]
    A = p['attributes']
    pos = read_accessor(j, bin_, A['POSITION']).astype(np.float64)
    uv = read_accessor(j, bin_, A['TEXCOORD_0']).astype(np.float64)
    nrm = read_accessor(j, bin_, A['NORMAL']).astype(np.float64)
    jnt = read_accessor(j, bin_, A['JOINTS_0'])
    wgt = read_accessor(j, bin_, A['WEIGHTS_0']).astype(np.float64)
    idx = read_accessor(j, bin_, p['indices']).ravel().astype(np.int64)
    names = [j['nodes'][k]['name'] for k in j['skins'][0]['joints']]
    return pos, uv, nrm, jnt, wgt, idx, names

# ---------------------------------------------------------------- uv rasterizer
def bone_weight_matrix(jnt, wgt, nbones=49):
    W = np.zeros((len(jnt), nbones))
    for c in range(4):
        np.add.at(W, (np.arange(len(jnt)), jnt[:, c].astype(int)), wgt[:, c])
    return W

def rasterize(uv, idx, attrs, size=2048, pad_px=1.0):
    """Rasterize triangles in UV space; attrs: (nverts, k). Returns (size,size,k) float32 buffer and coverage mask.
    glTF UV origin top-left: pixel row = v*size."""
    k = attrs.shape[1]
    buf = np.zeros((size, size, k), np.float32)
    cov = np.zeros((size, size), bool)
    tris = idx.reshape(-1, 3)
    P = uv * size  # pixel coords (u -> col, v -> row)
    for t in tris:
        a, b, c = P[t[0]], P[t[1]], P[t[2]]
        xmin = int(max(0, np.floor(min(a[0], b[0], c[0]) - pad_px))); xmax = int(min(size - 1, np.ceil(max(a[0], b[0], c[0]) + pad_px)))
        ymin = int(max(0, np.floor(min(a[1], b[1], c[1]) - pad_px))); ymax = int(min(size - 1, np.ceil(max(a[1], b[1], c[1]) + pad_px)))
        if xmax < xmin or ymax < ymin:
            continue
        xs = np.arange(xmin, xmax + 1) + 0.5
        ys = np.arange(ymin, ymax + 1) + 0.5
        X, Y = np.meshgrid(xs, ys)
        det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
        if abs(det) < 1e-12:
            continue
        l1 = ((b[0] - X) * (c[1] - Y) - (c[0] - X) * (b[1] - Y)) / det
        l2 = ((c[0] - X) * (a[1] - Y) - (a[0] - X) * (c[1] - Y)) / det
        l3 = 1.0 - l1 - l2
        # expand slightly (pad) in barycentric space so seams get covered
        eps = pad_px / max(1.0, np.sqrt(abs(det)))
        inside = (l1 >= -eps) & (l2 >= -eps) & (l3 >= -eps)
        # don't overwrite true-inside texels with padded ones
        strict = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not inside.any():
            continue
        sub_cov = cov[ymin:ymax + 1, xmin:xmax + 1]
        write = strict | (inside & ~sub_cov)
        if not write.any():
            continue
        lc1 = np.clip(l1, 0, 1); lc2 = np.clip(l2, 0, 1); lc3 = np.clip(l3, 0, 1)
        s = lc1 + lc2 + lc3; lc1 /= s; lc2 /= s; lc3 /= s
        vals = lc1[..., None] * attrs[t[0]] + lc2[..., None] * attrs[t[1]] + lc3[..., None] * attrs[t[2]]
        sub = buf[ymin:ymax + 1, xmin:xmax + 1]
        sub[write] = vals[write]
        sub_cov |= write
    return buf, cov

def dilate(img, cov, iters=12):
    """Fill uncovered texels with nearest covered colors (seam padding)."""
    img = img.copy(); cov = cov.copy()
    H, W = cov.shape
    for _ in range(iters):
        acc = np.zeros_like(img); cnt = np.zeros(cov.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0: continue
                sh = np.roll(np.roll(img, dy, 0), dx, 1); sc = np.roll(np.roll(cov, dy, 0), dx, 1)
                acc += sh * sc[..., None]; cnt += sc
        fill = (~cov) & (cnt > 0)
        img[fill] = acc[fill] / cnt[fill][:, None]
        cov = cov | fill
    return img, cov

# ---------------------------------------------------------------- noise / hash
def hash_u32(*ints, salt=0):
    h = np.uint32(salt * 2654435761 & 0xffffffff)
    primes = (73856093, 19349663, 83492791, 49979687)
    for k, v in enumerate(ints):
        h = h ^ (v.astype(np.int64) * primes[k % 4] & 0xffffffff).astype(np.uint32)
        h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
    h = h ^ (h >> np.uint32(16))
    return (h & np.uint32(0xffffff)).astype(np.float32) / np.float32(0xffffff)

def vnoise3(p, salt=0):
    i = np.floor(p).astype(np.int64); f = p - i
    f = f * f * f * (f * (f * 6 - 15) + 10)
    def h(dx, dy, dz): return hash_u32(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, salt=salt)
    c00 = h(0, 0, 0) * (1 - f[:, 0]) + h(1, 0, 0) * f[:, 0]
    c10 = h(0, 1, 0) * (1 - f[:, 0]) + h(1, 1, 0) * f[:, 0]
    c01 = h(0, 0, 1) * (1 - f[:, 0]) + h(1, 0, 1) * f[:, 0]
    c11 = h(0, 1, 1) * (1 - f[:, 0]) + h(1, 1, 1) * f[:, 0]
    c0 = c00 * (1 - f[:, 1]) + c10 * f[:, 1]
    c1 = c01 * (1 - f[:, 1]) + c11 * f[:, 1]
    return c0 * (1 - f[:, 2]) + c1 * f[:, 2]

def fbm3(p, octaves=3, salt=0):
    v = np.zeros(len(p), np.float32); amp = 0.5; tot = 0
    for o in range(octaves):
        v += amp * vnoise3(p * (2 ** o), salt=salt + o); tot += amp; amp *= 0.5
    return v / tot

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def lerp(a, b, t):
    t = np.asarray(t, np.float32)[..., None] if np.ndim(t) == 1 else t
    return a + (b - a) * t

def col(r, g, b): return np.array([r, g, b], np.float32)

# ---------------------------------------------------------------- mesh + attributes

# ---------------------------------------------------------------- coat
def bake_coat(pos, uv, nrm, jnt, wgt, idx, names, SIZE):
    W = bone_weight_matrix(jnt, wgt)
    bi = {n: k for k, n in enumerate(names)}
    def bw(*ns): return sum(W[:, bi[n]] for n in ns)
    wTail = bw('DEF-spine', 'DEF-spine.001', 'DEF-spine.002')
    tailT = (W[:, bi['DEF-spine']] * 1.0 + W[:, bi['DEF-spine.001']] * 0.55 + W[:, bi['DEF-spine.002']] * 0.2) / np.maximum(wTail, 1e-6)
    wEar = bw('DEF-ear.L', 'DEF-ear.R')
    wJaw = bw('DEF-jaw')
    wHead = bw('DEF-spine.011', 'DEF-spine.010')
    legF = ['DEF-shoulder.%s', 'DEF-front_thigh.%s', 'DEF-front_thigh.%s.001', 'DEF-front_shin.%s', 'DEF-front_shin.%s.001', 'DEF-front_foot.%s', 'DEF-front_foot.%s.001', 'DEF-front_toe.%s']
    legB = ['DEF-thigh.%s', 'DEF-thigh.%s.001', 'DEF-shin.%s', 'DEF-shin.%s.001', 'DEF-foot.%s', 'DEF-foot.%s.001', 'DEF-toe.%s']
    wLegF = sum(bw(n % s) for n in legF for s in 'LR')
    wLegB = sum(bw(n % s) for n in legB for s in 'LR')
    wChest = bw('DEF-breast.L', 'DEF-breast.R')
    attrs = np.column_stack([pos, nrm, wTail, tailT, wEar, wJaw, wHead, wLegF, wLegB, wChest]).astype(np.float32)
    print('rasterizing', SIZE, 'px'); buf, cov = rasterize(uv, idx, attrs, size=SIZE)
    m = cov
    P = buf[m][:, 0:3].astype(np.float32); N = buf[m][:, 3:6].astype(np.float32)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-6)
    A = buf[m][:, 6:]
    wTail, tailT, wEar, wJaw, wHead, wLegF, wLegB, wChest = [A[:, k] for k in range(8)]
    x, y, z = P[:, 0], P[:, 1], P[:, 2]; nx, ny, nz = N[:, 0], N[:, 1], N[:, 2]
    n_tex = len(P); print('texels', n_tex)
    sx = np.where(x >= 0, 1.0, -1.0).astype(np.float32)

    # ---------------------------------------------------------------- palette
    C_BACK = col(122, 118, 110); C_FLANK = col(170, 166, 157); C_PALE = col(208, 205, 197); C_WHITE = col(242, 240, 235)
    C_ROS = col(40, 38, 37); C_ROS_SOFT = col(72, 68, 64); C_ROS_C = col(148, 141, 130)
    C_BLACK = col(26, 25, 25); C_NOSE = col(96, 72, 74); C_IRIS = col(158, 172, 150); C_IRIS_DK = col(96, 112, 92)
    C_EAR_BACK = col(74, 70, 66); C_INNER_EAR = col(236, 232, 226)

    # ---------------------------------------------------------------- regions
    tailMask = sstep(0.35, 0.65, wTail)
    earMask = sstep(0.45, 0.8, wEar) * sstep(0.44, 0.50, y) * sstep(0.09, 0.14, np.abs(x))
    legMask = np.clip(sstep(0.4, 0.75, wLegF) + sstep(0.4, 0.75, wLegB), 0, 1) * sstep(-0.02, -0.12, y)
    headMask = sstep(0.62, 0.72, z) * (1 - tailMask)
    muzzleMask = sstep(0.86, 0.92, z) * sstep(0.37, 0.32, y) * sstep(0.18, 0.13, np.abs(x) - 0.0 * y)
    chinMask = sstep(0.80, 0.86, z) * sstep(0.24, 0.17, y) * sstep(0.17, 0.10, np.abs(x))
    throatMask = sstep(0.42, 0.55, z) * sstep(0.26, 0.10, y) * sstep(0.3, -0.2, ny) * (1 - legMask) * sstep(0.84, 0.76, z)
    chestMask = np.clip(sstep(0.25, 0.6, wChest) + throatMask, 0, 1)

    # torso height factor using back / belly profiles along z
    zk = np.array([-0.70, -0.50, -0.30, 0.00, 0.30, 0.50, 0.70, 0.90])
    backk = np.array([0.02, 0.17, 0.28, 0.25, 0.31, 0.45, 0.55, 0.56])
    bellyk = np.array([-0.18, -0.20, -0.16, -0.14, -0.21, -0.15, 0.05, 0.14])
    back_y = np.interp(z, zk, backk).astype(np.float32); belly_y = np.interp(z, zk, bellyk).astype(np.float32)
    h = np.clip((y - belly_y) / np.maximum(back_y - belly_y, 0.05), 0, 1)
    up = np.clip(ny * 0.5 + 0.5, 0, 1)
    side = 1 - np.abs(ny)  # 1 on vertical flanks
    g = 0.66 * h + 0.34 * up                                 # 0 = white belly, 1 = grey spine
    # legs: paler, inner side whiter
    inner = np.clip(-nx * sx, 0, 1)
    g_leg = 0.50 - 0.34 * inner - 0.16 * sstep(-0.3, -0.55, y)
    g = g * (1 - legMask) + g_leg * legMask
    # head
    g_head = 0.72 * sstep(0.36, 0.48, y) + 0.22 * sstep(0.46, 0.36, y) * sstep(0.08, 0.18, np.abs(x))
    g = g * (1 - headMask) + g_head * headMask
    # whites
    white = np.clip(muzzleMask + chinMask + chestMask, 0, 1)
    g = g * (1 - white)
    # tail: upper half grey, underside white
    tdir = np.array([0.2, -0.31, -0.48], np.float32); tdir /= np.linalg.norm(tdir)
    tu = np.cross(tdir, [0, 1, 0]); tu /= np.linalg.norm(tu); tv = np.cross(tu, tdir)
    tphi = np.arctan2(N @ tu, N @ tv)   # 0 = up-ish
    g_tail = 0.62 * np.clip(0.5 + 0.5 * np.cos(tphi), 0, 1) + 0.16
    g = g * (1 - tailMask) + g_tail * tailMask
    # low frequency coat variation
    g = np.clip(g + (fbm3(P * 6.0, 2, salt=11) - 0.5) * 0.16, 0, 1)

    base = np.where((g < 0.26)[:, None], lerp(C_WHITE, C_PALE, sstep(0.0, 0.26, g)),
           np.where((g < 0.62)[:, None], lerp(C_PALE, C_FLANK, sstep(0.26, 0.62, g)), lerp(C_FLANK, C_BACK, sstep(0.62, 1.0, g))))

    # ---------------------------------------------------------------- pattern helpers
    def lattice_spots(s, a, cs, salt, r_lo, r_hi, prob=0.9, hex_offset=True, kind='ring', tw_scale=1.0, elong=1.0, radius_noise=None):
        """s,a = 2D surface params. Returns (dark, center) intensities in [0,1]."""
        i = np.floor(s / cs).astype(np.int64)
        dark = np.zeros(len(s), np.float32); cen = np.zeros(len(s), np.float32)
        for di in (-1, 0, 1):
            ii = i + di
            off = (ii % 2) * 0.5 * cs if hex_offset else 0
            j = np.floor((a + off) / cs).astype(np.int64)
            for dj in (-1, 0, 1):
                jj = j + dj
                r1 = hash_u32(ii, jj, salt=salt + 1); r2 = hash_u32(ii, jj, salt=salt + 2); r3 = hash_u32(ii, jj, salt=salt + 3)
                r4 = hash_u32(ii, jj, salt=salt + 4); r5 = hash_u32(ii, jj, salt=salt + 5); r6 = hash_u32(ii, jj, salt=salt + 6)
                present = (r6 < prob).astype(np.float32)
                sc = (ii + 0.5) * cs + (r1 - 0.5) * cs * 0.55
                ac = (jj + 0.5) * cs - off + (r2 - 0.5) * cs * 0.55
                ds = (s - sc) / elong; da = a - ac
                d = np.sqrt(ds * ds + da * da)
                r = r_lo + (r_hi - r_lo) * r3
                if radius_noise is not None: r = r * (1 + radius_noise)
                if kind == 'ring':
                    tw = 0.0125 * tw_scale * (0.85 + 0.3 * r4)
                    ring = sstep(tw, tw * 0.35, np.abs(d - r))
                    k = 3 + np.floor(r5 * 3); ph = r4 * 6.283
                    phi = np.arctan2(da, ds)
                    pm = 0.5 + 0.5 * np.cos(k * phi + ph)
                    gaps = sstep(0.06, 0.30, pm)
                    v = ring * gaps * present
                    c = sstep(r - tw * 0.3, r - tw * 1.3, d) * present
                    dark = np.maximum(dark, v); cen = np.maximum(cen, c)
                else:
                    v = sstep(r, r * 0.55, d) * present
                    dark = np.maximum(dark, v)
        return dark, cen

    rn = (fbm3(P * 28.0, 2, salt=21) - 0.5) * 0.36   # rosette outline wobble

    # torso / neck lattice (cylindrical around body axis)
    theta = np.arctan2(x, y - 0.05)   # 0 = top
    R_body = 0.235
    a_body = theta * R_body
    cs_body = 0.152
    dark_t, cen_t = lattice_spots(z, a_body, cs_body, 100, 0.050, 0.066, prob=0.92, kind='ring', radius_noise=rn)
    # dorsal stripe-blotches along the spine (two rows)
    dark_d, _ = lattice_spots(z, a_body * 2.2, 0.075, 200, 0.012, 0.017, prob=0.85, kind='spot', elong=2.0)
    dorsalBand = sstep(0.11, 0.06, np.abs(a_body)) * sstep(0.08, 0.02, np.abs(a_body)) + sstep(0.14, 0.10, np.abs(a_body)) * 0.0
    # neck spots (smaller solid) replace rosettes forward of the shoulders
    dark_n, _ = lattice_spots(z, a_body * 1.0, 0.07, 300, 0.012, 0.019, prob=0.8, kind='spot')
    neckBlend = sstep(0.30, 0.50, z)
    torsoDark = dark_t * (1 - neckBlend) + dark_n * neckBlend
    torsoDark = np.maximum(torsoDark * (1 - dorsalBand), dark_d * dorsalBand)
    torsoCen = cen_t * (1 - neckBlend)
    # fade pattern on the white underside / chest / muzzle, and off the tail/legs/ears
    rumpFace = sstep(-0.35, -0.75, nz) * sstep(-0.25, -0.45, z)
    patFade = sstep(0.20, 0.44, g) * (1 - tailMask) * (1 - legMask) * (1 - earMask) * (1 - white) * (1 - rumpFace)
    torsoDark *= patFade; torsoCen *= patFade
    # sparse solid spots on the pale lower flank / upper legs
    dark_b, _ = lattice_spots(z, a_body, 0.09, 400, 0.010, 0.016, prob=0.45, kind='spot')
    bellyBand = sstep(0.48, 0.30, g) * sstep(0.08, 0.20, g) * (1 - tailMask) * (1 - legMask) * (1 - white) * (1 - headMask)
    torsoDark = np.maximum(torsoDark, dark_b * bellyBand)

    # legs lattice (around each leg axis)
    legX = np.where(wLegF > wLegB, 0.17, 0.145) * sx; legZ = np.where(wLegF > wLegB, 0.47, -0.33)
    alpha = np.arctan2(z - legZ, (x - legX) * sx)
    dark_l, _ = lattice_spots(y, alpha * 0.085, 0.062, 500, 0.010, 0.016, prob=0.7, kind='spot')
    legFade = legMask * (1 - inner) * sstep(-0.52, -0.40, y)
    legDark = dark_l * legFade

    # head spots (3D jittered grid on the crown / forehead / cheeks)
    cell = 0.034
    ci = np.floor(P / cell).astype(np.int64)
    headDark = np.zeros(n_tex, np.float32)
    for dx_ in (-1, 0, 1):
        for dy_ in (-1, 0, 1):
            for dz_ in (-1, 0, 1):
                cx, cy, cz = ci[:, 0] + dx_, ci[:, 1] + dy_, ci[:, 2] + dz_
                r1 = hash_u32(cx, cy, cz, salt=601); r2 = hash_u32(cx, cy, cz, salt=602); r3 = hash_u32(cx, cy, cz, salt=603); r4 = hash_u32(cx, cy, cz, salt=604)
                c = np.stack([(cx + 0.2 + 0.6 * r1) * cell, (cy + 0.2 + 0.6 * r2) * cell, (cz + 0.2 + 0.6 * r3) * cell], 1)
                d = np.linalg.norm(P - c, axis=1)
                rr = 0.0055 + 0.004 * r4
                headDark = np.maximum(headDark, sstep(rr, rr * 0.5, d) * (r1 < 0.7))
    headFade = headMask * (1 - white) * (1 - earMask) * sstep(0.34, 0.40, y) * sstep(0.95, 0.90, z)
    headDark *= headFade

    # tail rings
    ringPos = tailT * 10.5 + (fbm3(P * 30, 2, salt=31) - 0.5) * 0.5
    ridx = np.floor(ringPos).astype(np.int64)
    rf = ringPos - ridx
    rph = hash_u32(ridx, salt=700) * 6.283
    pmt = 0.5 + 0.5 * np.cos(2 * tphi + rph)
    tailRing = sstep(0.30, 0.22, np.abs(rf - 0.5)) * sstep(0.10, 0.40, pmt) * sstep(0.10, 0.18, tailT) * sstep(0.86, 0.80, tailT)
    tailRing *= sstep(-0.35, 0.1, np.cos(tphi))  # fewer marks on the underside
    tailCen = sstep(0.22, 0.12, np.abs(rf - 0.5)) * sstep(0.10, 0.18, tailT) * sstep(0.86, 0.80, tailT)
    tipBlack = sstep(0.80, 0.92, tailT)

    # ---------------------------------------------------------------- compose
    color = base.copy()
    # rosette centres: warm taupe wash
    color = lerp(color, C_ROS_C, np.clip(torsoCen, 0, 1) * 0.5 * (1 - tailMask))
    color = lerp(color, C_ROS_C, tailCen * tailMask * 0.35)
    # dark markings
    darkAll = np.clip(torsoDark + legDark + headDark + tailRing * tailMask, 0, 1)
    dark_col = lerp(C_ROS, C_ROS_SOFT, fbm3(P * 40, 2, salt=41))
    color = lerp(color, dark_col, darkAll * 0.88)
    # ears
    earBack = earMask * sstep(0.15, -0.25, nz)
    earOcellus = earBack * sstep(0.055, 0.03, np.sqrt((np.abs(x) - 0.185) ** 2 + (y - 0.54) ** 2 + (z - 0.72) ** 2))
    color = lerp(color, C_EAR_BACK, earBack * 0.92)
    color = lerp(color, C_PALE, earOcellus * 0.85)
    color = lerp(color, C_INNER_EAR, earMask * sstep(-0.1, 0.3, nz) * 0.6)
    # tail tip
    color = lerp(color, C_BLACK, tipBlack)

    # face: eyes
    for s in (1.0, -1.0):
        E = np.array([s * 0.100, 0.395, 0.875], np.float32)
        L = np.array([s * 0.76, 0.0, -0.65], np.float32); L /= np.linalg.norm(L)
        rel = P - E
        el = rel @ L; ev = rel[:, 1] - 0.30 * el; ed = rel @ np.array([s * 0.65, 0, 0.76], np.float32)
        near = sstep(0.07, 0.03, np.abs(ed)) * (nz > -0.1)
        e = np.sqrt((el / 0.030) ** 2 + (ev / 0.017) ** 2)
        eyeIn = sstep(1.0, 0.92, e) * near
        liner = sstep(1.45, 1.3, e) * sstep(0.92, 1.0, e) * near
        linerTop = sstep(1.8, 1.4, e) * sstep(0.9, 1.0, e) * sstep(-0.004, 0.004, ev) * near
        whiteRing = sstep(2.6, 1.5, e) * sstep(1.25, 1.45, e) * sstep(0.006, -0.004, ev) * near
        pupil = sstep(0.0085, 0.0055, np.sqrt(el ** 2 + (ev * 1.0) ** 2)) * near
        irisGrad = sstep(0.5, 1.0, e)
        color = lerp(color, C_WHITE, whiteRing * 0.9)
        color = lerp(color, lerp(C_IRIS, C_IRIS_DK, irisGrad), eyeIn)
        color = lerp(color, C_BLACK, np.maximum(liner, linerTop * 0.85))
        color = lerp(color, C_BLACK, pupil)
        # eye glint
        glint = sstep(0.004, 0.002, np.sqrt((el + s * 0.0 - 0.009) ** 2 + (ev - 0.006) ** 2)) * near
        color = lerp(color, col(250, 250, 250), glint * 0.9)
        # dark tear line from inner eye corner down the muzzle side
        tear = sstep(0.006, 0.002, np.abs((x * s) - (0.075 - (0.395 - y) * 0.15))) * sstep(0.40, 0.36, y) * sstep(0.28, 0.33, y) * sstep(0.85, 0.90, z) * near
        color = lerp(color, C_ROS_SOFT, tear * 0.55)
    # nose leather
    noseC = np.array([0.0, 0.268, 0.992], np.float32)
    dn = np.sqrt(((P - noseC) / np.array([0.028, 0.018, 0.03], np.float32)) ** 2).sum(1) ** 0.5
    dn = np.sqrt((((P - noseC) / np.array([0.028, 0.019, 0.030], np.float32)) ** 2).sum(1))
    color = lerp(color, C_NOSE, sstep(1.0, 0.8, dn))
    color = lerp(color, C_BLACK, sstep(1.0, 0.8, dn) * sstep(0.26, 0.255, y) * 0.5)   # nostril shadow
    philtrum = sstep(0.004, 0.0015, np.abs(x)) * sstep(0.262, 0.255, y) * sstep(0.205, 0.215, y) * sstep(0.95, 0.975, z)
    color = lerp(color, C_NOSE, philtrum * 0.8)
    # lip line
    lip = sstep(0.006, 0.002, np.abs(y - 0.214)) * sstep(0.95, 0.975, z) * sstep(0.10, 0.06, np.abs(x))
    color = lerp(color, C_ROS_SOFT, lip * 0.55)
    # whisker dots on the muzzle pads
    for row, yy in enumerate((0.300, 0.282, 0.264)):
        for k in range(4):
            xx = 0.028 + k * 0.021 + (row % 2) * 0.01
            for s in (1, -1):
                dd = np.sqrt((x - s * xx) ** 2 + (y - yy) ** 2 + ((z - 0.975) * 0.6) ** 2)
                color = lerp(color, C_ROS_SOFT, sstep(0.0045, 0.0025, dd) * muzzleMask * 0.75)

    # fur grain: anisotropic noise along fur flow (down + back), plus fine grain
    grainP = np.column_stack([x * 70, (y + z * 0.35) * 24, z * 70]).astype(np.float32)
    grain = fbm3(grainP, 2, salt=51) - 0.5
    fine = vnoise3(P * 260, salt=52) - 0.5
    lum = 1 + grain * 0.11 + fine * 0.07
    color = np.clip(color * lum[:, None], 0, 255)

    img = np.zeros((SIZE, SIZE, 3), np.float32)
    img[m] = color
    img, _ = dilate(img, cov, iters=14 if SIZE >= 2048 else 8)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------- fur normal map
def bake_normal_map(pos, uv, idx, NS=1024):
# normal map from fur grain height (tangent space, UV-based)
    hbuf, hcov = rasterize(uv, idx, pos.astype(np.float32), size=NS)
    HP = hbuf.reshape(-1, 3)
    hgt = (fbm3(np.column_stack([HP[:, 0] * 90, (HP[:, 1] + HP[:, 2] * 0.35) * 30, HP[:, 2] * 90]), 3, salt=61) - 0.5)
    hgt += (vnoise3(HP * 420, salt=62) - 0.5) * 0.5
    hgt = hgt.reshape(NS, NS)
    hgt, _ = dilate(hgt[..., None], hcov, iters=6); hgt = hgt[..., 0]
    gx = np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1); gy = np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)
    strength = 2.2
    nrm_img = np.stack([-gx * strength, gy * strength, np.ones_like(gx)], -1)
    nrm_img /= np.linalg.norm(nrm_img, axis=-1, keepdims=True)
    nrm_img = ((nrm_img * 0.5 + 0.5) * 255).astype(np.uint8)
    return Image.fromarray(nrm_img)

# ---------------------------------------------------------------- glb writing
def repack_glb(src, dst, base_png, normal_png=None):
    j, bin_ = read_glb(src)
    img_bv = j['images'][0]['bufferView']
    views = []
    for k, bv in enumerate(j['bufferViews']):
        off = bv.get('byteOffset', 0)
        views.append(bytes(bin_[off:off + bv['byteLength']]))
    views[img_bv] = open(base_png, 'rb').read()
    j['images'][0]['name'] = 'snow_leopard_basecolor'; j['images'][0]['mimeType'] = 'image/jpeg' if base_png.endswith('.jpg') else 'image/png'
    if normal_png:
        nt = j['materials'][0].get('normalTexture')
        if nt is not None:
            # re-bake: replace the existing normal image in place
            nimg = j['images'][j['textures'][nt['index']]['source']]
            views[nimg['bufferView']] = open(normal_png, 'rb').read()
            nimg['mimeType'] = 'image/jpeg' if normal_png.endswith('.jpg') else 'image/png'
        else:
            views.append(open(normal_png, 'rb').read())
            j['bufferViews'].append({'buffer': 0, 'byteLength': 0})
            j['images'].append({'name': 'snow_leopard_normal', 'mimeType': 'image/jpeg' if normal_png.endswith('.jpg') else 'image/png', 'bufferView': len(views) - 1})
            j['textures'].append({'sampler': 0, 'source': len(j['images']) - 1})
            j['materials'][0]['normalTexture'] = {'index': len(j['textures']) - 1, 'scale': 0.6}
    mat = j['materials'][0]
    mat['name'] = 'snow_leopard_fur'
    mat['pbrMetallicRoughness']['roughnessFactor'] = 0.92
    mat['pbrMetallicRoughness']['metallicFactor'] = 0.0
    mat['doubleSided'] = False
    mat['extras'] = {'coat': 'baked by scripts/bake_snow_leopard_coat.py'}
    j['meshes'][0]['name'] = 'SnowLeopard'; j['skins'][0]['name'] = 'SnowLeopard_Rig'
    j['asset']['generator'] = 'snow-leopard-wildcraft bake'
    out = bytearray(); 
    for k, data in enumerate(views):
        while len(out) % 4: out.append(0)
        j['bufferViews'][k]['byteOffset'] = len(out); j['bufferViews'][k]['byteLength'] = len(data)
        out += data
    while len(out) % 4: out.append(0)
    j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    glb = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(dst, 'wb').write(glb)
    print('wrote', dst, total, 'bytes')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--size', type=int, default=2048, help='base color resolution (default 2048)')
    ap.add_argument('--glb', default=GLB_PATH, help='model to bake onto / overwrite')
    ap.add_argument('--preview', help='also write the base color texture to this PNG path')
    ap.add_argument('--no-write', action='store_true', help='do not modify the GLB')
    args = ap.parse_args()

    j, bin_ = read_glb(args.glb)
    pos, uv, nrm, jnt, wgt, idx, names = load_mesh(j, bin_)
    print('mesh:', len(pos), 'verts,', len(idx) // 3, 'tris,', len(names), 'bones')

    base = bake_coat(pos, uv, nrm, jnt, wgt, idx, names, args.size)
    if args.preview:
        base.save(args.preview, optimize=True); print('saved preview', args.preview)
    normal = bake_normal_map(pos, uv, idx)
    if args.no_write:
        return
    tmp_base = args.glb + '.base.jpg'; tmp_nrm = args.glb + '.normal.jpg'
    base.save(tmp_base, 'JPEG', quality=90)
    normal.save(tmp_nrm, 'JPEG', quality=90)
    try:
        repack_glb(args.glb, args.glb, tmp_base, tmp_nrm)
    finally:
        os.remove(tmp_base); os.remove(tmp_nrm)

if __name__ == '__main__':
    main()
