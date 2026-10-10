import * as THREE from 'three';

// Wildcraft 3rd Person Orbit & Terrain-Aware Follow Camera
export class GameCamera {
  constructor(camera, domElement, terrain) {
    this.camera = camera;
    this.domElement = domElement;
    this.terrain = terrain;

    this.target = new THREE.Vector3(0, 2, 0);
    this.distance = 9.5;
    this.minDistance = 4.0;
    this.maxDistance = 16.0;

    this.yaw = 0; // Horizontal orbit angle (radians)
    this.pitch = 0.35; // Vertical orbit angle (radians)
    this.minPitch = -0.15;
    this.maxPitch = 1.25;

    this.smoothPos = new THREE.Vector3(0, 5, 10);
    this.baseFov = 60;
    this.camera.fov = this.baseFov;

    this.setupListeners();
  }

  setupListeners() {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    // Desktop Mouse Drag Orbit (Right button or left drag outside joystick)
    window.addEventListener('mousedown', (e) => {
      // Don't intercept UI buttons or virtual joystick
      if (e.target.closest('#joystick-container, .action-btn, #top-hud')) return;
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

  update(delta, playerPos, isSprinting, isPouncing) {
    // Follow player chest
    const targetLookAt = playerPos.clone().add(new THREE.Vector3(0, 1.6, 0));
    this.target.lerp(targetLookAt, delta * 10);

    // Calculate desired camera orbit offset
    const cosPitch = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cosPitch * this.distance;
    const offsetY = Math.sin(this.pitch) * this.distance;
    const offsetZ = Math.cos(this.yaw) * cosPitch * this.distance;

    let desiredPos = this.target.clone().add(new THREE.Vector3(offsetX, offsetY, offsetZ));

    // Terrain Collision Avoidance: prevent camera clipping through snow rocks
    const groundAtCam = this.terrain.getTerrainHeight(desiredPos.x, desiredPos.z);
    if (desiredPos.y < groundAtCam + 1.2) {
      desiredPos.y = groundAtCam + 1.2;
    }

    this.smoothPos.lerp(desiredPos, delta * 12);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.target);

    // Speed sensation dynamic FOV
    const targetFov = isPouncing ? 75 : (isSprinting ? 68 : 60);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta * 6);
    this.camera.updateProjectionMatrix();
  }
}
