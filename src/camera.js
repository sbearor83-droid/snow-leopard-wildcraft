import * as THREE from 'three';

const MIN_PULL_IN = 3.0; // closest the camera gets to the leopard's centre (it is ~3 m long)
const MAX_LOOK_TILT = 0.42; // rad (~24 deg) of extra upward view tilt; keeps the leopard on screen

// Wildcraft 3rd Person Orbit & Terrain-Aware Follow Camera
export class GameCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;

    this.target = new THREE.Vector3(0, 1.0, 0);
    this.distance = 6.8;
    this.minDistance = 3.6;
    this.maxDistance = 17.0;

    this.yaw = Math.PI - 0.22; // Over-the-right-shoulder 3/4 cinematic angle
    this.pitch = 0.38; // 22 degrees downward elevation showing full body and tail
    this.minPitch = -0.55; // drag up to look up at the peaks and sky
    this.maxPitch = 1.25;
    this.lookTilt = 0; // extra upward view tilt when terrain stops the camera going as low as asked
    this.sensitivity = 1; // Settings > Look speed
    this.invertY = false; // Settings > Invert up / down

    this.smoothPos = new THREE.Vector3(0, 3.4, -6.5);
    this.desiredPos = new THREE.Vector3();
    this.lookAtPoint = new THREE.Vector3();
    this.targetLookAt = new THREE.Vector3();
    this.baseFov = 60;
    this.camera.fov = this.baseFov;

    this.setupListeners();
  }

  setupListeners() {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    // Desktop Mouse Drag Orbit (any button, outside the HUD)
    window.addEventListener('mousedown', (e) => {
      // Don't intercept UI buttons, the HUD or the virtual joystick
      if (e.target.closest('#joystick-container, .action-btn, .top-hud, #death-screen')) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      this.rotate(dx * 0.005, dy * 0.005);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    window.addEventListener('wheel', (e) => {
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.008, this.minDistance, this.maxDistance);
    });
  }

  // Mobile touch drag camera pan (called by touch manager)
  applyTouchPan(dx, dy) {
    this.rotate(dx * 0.006, dy * 0.006);
  }

  rotate(dYaw, dPitch) {
    this.yaw -= dYaw * this.sensitivity;
    const pitchStep = dPitch * this.sensitivity * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchStep, this.minPitch, this.maxPitch);
  }

  update(delta, playerPos, isSprinting, isPouncing, isStalking = false) {
    // Follow player center (dips lower in stalking mode for predator prowl perspective)
    this.targetLookAt.set(playerPos.x, playerPos.y + (isStalking ? 0.75 : 1.0), playerPos.z);
    this.target.lerp(this.targetLookAt, delta * 10);

    // Dynamic cinematic distance: pulls in close when stalking, pulls back when sprinting
    const targetDist = isStalking ? (this.distance * 0.82) : (isPouncing ? (this.distance * 0.88) : (isSprinting ? (this.distance * 1.15) : this.distance));
    this.currentFollowDist = THREE.MathUtils.lerp(this.currentFollowDist || this.distance, targetDist, delta * 5);

    // Calculate desired camera orbit offset
    const cosPitch = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cosPitch * this.currentFollowDist;
    const offsetY = Math.sin(this.pitch) * this.currentFollowDist;
    const offsetZ = Math.cos(this.yaw) * cosPitch * this.currentFollowDist;

    // Terrain avoidance. Lifting the camera straight up over rising snow (e.g. leopard facing
    // downhill) tips the view down into the snow, so first pull the camera in along its own line
    // of sight, which keeps the viewing angle; only lift it if it is already as close as allowed.
    const dist = this.currentFollowDist;
    const dirX = offsetX / dist, dirY = offsetY / dist, dirZ = offsetZ / dist;
    const clearance = 0.8;
    const steps = 10;
    let camDist = dist;
    for (let i = 1; i <= steps; i++) {
      const t = (dist * i) / steps;
      const px = this.target.x + dirX * t;
      const pz = this.target.z + dirZ * t;
      if (this.target.y + dirY * t < this.terrain.getTerrainHeight(px, pz) + clearance) {
        camDist = Math.max(MIN_PULL_IN, (dist * (i - 1)) / steps);
        break;
      }
    }
    const desiredPos = this.desiredPos.set(this.target.x + dirX * camDist, this.target.y + dirY * camDist, this.target.z + dirZ * camDist);
    const groundAtCam = this.terrain.getTerrainHeight(desiredPos.x, desiredPos.z);
    if (desiredPos.y < groundAtCam + clearance) desiredPos.y = groundAtCam + clearance;

    this.smoothPos.lerp(desiredPos, delta * 12);
    this.camera.position.copy(this.smoothPos);

    // If the camera had to sit higher than the player asked for, tilt the view up by the difference
    // (capped so the leopard stays in frame), so dragging up always shows more of the sky.
    const toTargetX = this.target.x - this.smoothPos.x;
    const toTargetZ = this.target.z - this.smoothPos.z;
    const flatDist = Math.max(0.001, Math.hypot(toTargetX, toTargetZ));
    const actualPitch = Math.atan2(this.smoothPos.y - this.target.y, flatDist);
    const wantTilt = THREE.MathUtils.clamp(actualPitch - this.pitch, 0, MAX_LOOK_TILT);
    this.lookTilt = THREE.MathUtils.lerp(this.lookTilt, wantTilt, Math.min(1, delta * 8));
    const lookAt = this.lookAtPoint.copy(this.target);
    lookAt.y += Math.tan(this.lookTilt) * flatDist;
    this.camera.lookAt(lookAt);

    // Dynamic cinematic action FOV
    const targetFov = isPouncing ? 75 : (isSprinting ? 68 : (isStalking ? 54 : 60));
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta * 6);
    this.camera.updateProjectionMatrix();
  }
}
