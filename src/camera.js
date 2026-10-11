import * as THREE from 'three';

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
    this.minPitch = -0.10;
    this.maxPitch = 1.25;

    this.smoothPos = new THREE.Vector3(0, 3.4, -6.5);
    this.desiredPos = new THREE.Vector3();
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

      this.yaw -= dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, this.minPitch, this.maxPitch);
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
    this.yaw -= dx * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.006, this.minPitch, this.maxPitch);
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

    const desiredPos = this.desiredPos.set(this.target.x + offsetX, this.target.y + offsetY, this.target.z + offsetZ);

    // Terrain Collision Avoidance: prevent camera clipping through snow rocks
    const groundAtCam = this.terrain.getTerrainHeight(desiredPos.x, desiredPos.z);
    if (desiredPos.y < groundAtCam + 1.4) {
      desiredPos.y = groundAtCam + 1.4;
    }

    this.smoothPos.lerp(desiredPos, delta * 12);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.target);

    // Dynamic cinematic action FOV
    const targetFov = isPouncing ? 75 : (isSprinting ? 68 : (isStalking ? 54 : 60));
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta * 6);
    this.camera.updateProjectionMatrix();
  }
}
