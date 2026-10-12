import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The herders' summer camp: yak-hair tents, a dry-stone goat pen, a cold fire
// ring and a line of prayer flags. Purely scenery plus collision for the tents.
// ---------------------------------------------------------------------------
export function buildCamp(scene, terrain, at) {
  const group = new THREE.Group();
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x2d2622, roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f747c, roughness: 0.95 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  const flagColors = [0x2563eb, 0xf8fafc, 0xdc2626, 0x16a34a, 0xfacc15];
  const y = (x, z) => terrain.getSurfaceHeight(x, z);

  // two black yak-hair tents with white trim
  [[-6, -4, 0.4], [5, -6, -0.5]].forEach(([dx, dz, rot]) => {
    const x = at.x + dx, z = at.z + dz;
    const tent = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 3.4, 2.6, 4, 1), tentMat);
    body.position.y = 1.3;
    body.rotation.y = Math.PI / 4;
    body.scale.set(1.3, 1, 0.9);
    body.castShadow = true;
    body.receiveShadow = true;
    tent.add(body);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), trimMat);
    door.position.set(0, 0.65, 2.25);
    tent.add(door);
    tent.position.set(x, y(x, z), z);
    tent.rotation.y = rot;
    group.add(tent);
    terrain.obstacles.push({ x, z, radius: 3.2, kind: 'tent' });
  });

  // dry-stone pen
  const stoneGeo = new THREE.DodecahedronGeometry(0.45, 0);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2;
    if (a > 0.2 && a < 0.6) continue; // gate
    const x = at.x + Math.cos(a) * 9, z = at.z + 6 + Math.sin(a) * 6;
    const s = new THREE.Mesh(stoneGeo, stoneMat);
    s.position.set(x, y(x, z) + 0.2, z);
    s.rotation.set(Math.random(), Math.random(), Math.random());
    s.scale.set(1 + Math.random() * 0.4, 0.8, 1 + Math.random() * 0.4);
    s.castShadow = true;
    group.add(s);
  }

  // fire ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = at.x + 1 + Math.cos(a) * 0.8, z = at.z - 1 + Math.sin(a) * 0.8;
    const s = new THREE.Mesh(stoneGeo, stoneMat);
    s.scale.setScalar(0.45);
    s.position.set(x, y(x, z) + 0.1, z);
    group.add(s);
  }

  // prayer flags strung between two poles
  const p1 = new THREE.Vector3(at.x - 9, 0, at.z - 8), p2 = new THREE.Vector3(at.x + 10, 0, at.z - 11);
  p1.y = y(p1.x, p1.z) + 3.4;
  p2.y = y(p2.x, p2.z) + 3.4;
  for (const p of [p1, p2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.6, 6), poleMat);
    pole.position.set(p.x, p.y - 1.7, p.z);
    pole.castShadow = true;
    group.add(pole);
  }
  const flagGeo = new THREE.PlaneGeometry(0.42, 0.5);
  for (let i = 0; i < 18; i++) {
    const t = (i + 0.5) / 18;
    const pos = new THREE.Vector3().lerpVectors(p1, p2, t);
    pos.y -= Math.sin(t * Math.PI) * 0.9 + 0.25;
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: flagColors[i % 5], side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.copy(pos);
    flag.rotation.y = Math.atan2(p2.x - p1.x, p2.z - p1.z) + Math.PI / 2;
    flag.rotation.z = (Math.random() - 0.5) * 0.3;
    group.add(flag);
  }
  scene.add(group);
  return group;
}
