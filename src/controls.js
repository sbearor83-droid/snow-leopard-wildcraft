import * as THREE from 'three';

// Dual Mobile Touch & Desktop Keyboard Input Controller
export class InputManager {
  constructor(gameCam) {
    this.gameCam = gameCam;

    this.keys = {};
    this.moveVector = new THREE.Vector3(0, 0, 0);

    // States
    this.isSprinting = false;
    this.isStalking = false;
    this.isPounceRequested = false;
    this.isSwipeRequested = false;
    this.isEatRequested = false;
    this.isDigRequested = false;
    this.isScentRequested = false;
    this.isActRequested = false; // context action: bite, drag, cache, mark, rest, call

    // Mobile Virtual Joystick State
    this.touchJoyActive = false;
    this.touchJoyTouchId = null;
    this.touchJoyCenter = { x: 0, y: 0 };
    this.touchJoyCurrent = { x: 0, y: 0 };
    this.touchJoyVector = { x: 0, y: 0 };

    // Mobile Camera Drag State
    this.touchCamTouchId = null;
    this.touchCamLast = { x: 0, y: 0 };

    this.setupDesktop();
    this.setupMobile();
  }

  setupDesktop() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      // Held keys auto-repeat; only act on the initial press so toggles don't flicker
      if (e.repeat) return;

      if (e.code === 'KeyC') {
        this.isStalking = !this.isStalking;
      }
      if (e.code === 'Space' || e.code === 'KeyF') {
        this.isPounceRequested = true;
      }
      if (e.code === 'KeyQ') {
        this.isSwipeRequested = true;
      }
      if (e.code === 'KeyE') {
        // E eats when next to a carcass, otherwise digs up nearby treasure
        this.isEatRequested = true;
        this.isDigRequested = true;
      }
      if (e.code === 'KeyV') {
        this.isScentRequested = true;
      }
      if (e.code === 'KeyR') {
        this.isActRequested = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.isSprinting = false;
      }
    });

    // Keyup never fires for keys held while the window loses focus, so release everything
    window.addEventListener('blur', () => {
      this.keys = {};
      this.isSprinting = false;
    });
  }

  setupMobile() {
    const joyContainer = document.getElementById('joystick-container');
    const joyKnob = document.getElementById('joystick-knob');

    // Touch start handler for joystick and camera drag
    window.addEventListener(
      'touchstart',
      (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const target = document.elementFromPoint(t.clientX, t.clientY);

          // If touching action or difficulty buttons, let button handlers process it
          if (target && target.closest('.action-btn, .diff-btn, .death-btn, .privacy-btn, .menu-btn, .ui-overlay')) {
            continue;
          }

          // Left half of screen -> Virtual Joystick
          if (t.clientX < window.innerWidth * 0.5 && !this.touchJoyActive) {
            this.touchJoyActive = true;
            this.touchJoyTouchId = t.identifier;
            this.touchJoyCenter = { x: t.clientX, y: t.clientY };
            this.touchJoyCurrent = { x: t.clientX, y: t.clientY };

            if (joyContainer) {
              joyContainer.style.display = 'block';
              joyContainer.style.left = `${t.clientX - 60}px`;
              joyContainer.style.top = `${t.clientY - 60}px`;
            }
          }
          // Right half of screen -> Camera Drag Pan
          else if (t.clientX >= window.innerWidth * 0.5 && this.touchCamTouchId === null) {
            this.touchCamTouchId = t.identifier;
            this.touchCamLast = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: false }
    );

    // Touch move handler (also blocks default scrolling / pinch-zoom gestures)
    window.addEventListener(
      'touchmove',
      (e) => {
        // Menus scroll and their sliders drag natively; everywhere else, block page panning/zoom
        if (!(e.target && e.target.closest && e.target.closest('.ui-overlay'))) e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];

          // Update joystick
          if (this.touchJoyActive && t.identifier === this.touchJoyTouchId) {
            const dx = t.clientX - this.touchJoyCenter.x;
            const dy = t.clientY - this.touchJoyCenter.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxRadius = 55;

            const clampedDist = Math.min(dist, maxRadius);
            const angle = Math.atan2(dy, dx);

            const knobX = Math.cos(angle) * clampedDist;
            const knobY = Math.sin(angle) * clampedDist;

            if (joyKnob) {
              joyKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;
            }

            // Normalized input (-1 to 1)
            this.touchJoyVector.x = knobX / maxRadius;
            this.touchJoyVector.y = knobY / maxRadius;
          }

          // Update camera drag
          if (this.touchCamTouchId !== null && t.identifier === this.touchCamTouchId) {
            const dx = t.clientX - this.touchCamLast.x;
            const dy = t.clientY - this.touchCamLast.y;
            this.touchCamLast = { x: t.clientX, y: t.clientY };

            if (this.gameCam) {
              this.gameCam.applyTouchPan(dx, dy);
            }
          }
        }
      },
      { passive: false }
    );

    // Touch end handler
    const handleTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.touchJoyActive && t.identifier === this.touchJoyTouchId) {
          this.touchJoyActive = false;
          this.touchJoyTouchId = null;
          this.touchJoyVector = { x: 0, y: 0 };
          if (joyKnob) joyKnob.style.transform = `translate(0px, 0px)`;
          if (joyContainer) joyContainer.style.display = 'none';
        }
        if (this.touchCamTouchId !== null && t.identifier === this.touchCamTouchId) {
          this.touchCamTouchId = null;
        }
      }
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    // Hook up Mobile UI Buttons
    this.setupButton('btn-pounce', () => (this.isPounceRequested = true));
    this.setupButton('btn-swipe', () => (this.isSwipeRequested = true));
    this.setupButton('btn-sprint', () => (this.isSprinting = !this.isSprinting));
    this.setupButton('btn-stalk', () => (this.isStalking = !this.isStalking));
    this.setupButton('btn-scent', () => (this.isScentRequested = true));
    this.setupButton('btn-eat', () => (this.isEatRequested = true));
    this.setupButton('btn-dig', () => (this.isDigRequested = true));
    this.setupButton('btn-act', () => (this.isActRequested = true));
  }

  setupButton(id, callback) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      callback();
    });
  }

  getMovementVector() {
    let forwardInput = 0;
    let rightInput = 0;

    // Desktop inputs:
    // W / ArrowUp = forward (away from camera / screen)
    if (this.keys['KeyW'] || this.keys['ArrowUp']) forwardInput += 1;
    // S / ArrowDown = backward (towards camera / screen)
    if (this.keys['KeyS'] || this.keys['ArrowDown']) forwardInput -= 1;
    // D / ArrowRight = right (to the right of the screen)
    if (this.keys['KeyD'] || this.keys['ArrowRight']) rightInput += 1;
    // A / ArrowLeft = left (to the left of the screen)
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) rightInput -= 1;

    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
      this.isSprinting = true;
    }

    // Mobile Joystick input:
    // touchJoyVector.y is negative when dragging UP (forward), positive when dragging DOWN
    // touchJoyVector.x is positive when dragging RIGHT, negative when dragging LEFT
    if (this.touchJoyActive) {
      forwardInput = -this.touchJoyVector.y;
      rightInput = this.touchJoyVector.x;
    }

    const lenSq = forwardInput * forwardInput + rightInput * rightInput;
    if (lenSq > 0.01) {
      const len = Math.sqrt(lenSq);
      const normForward = forwardInput / (len > 1 ? len : 1);
      const normRight = rightInput / (len > 1 ? len : 1);

      // Camera orientation:
      // Camera is placed at target + (sin(yaw)*dist, ..., cos(yaw)*dist).
      // Vector from camera to target (away from screen) is:
      // camForward = (-sin(yaw), 0, -cos(yaw))
      // camRight   = (cos(yaw), 0, -sin(yaw))
      const camYaw = this.gameCam.yaw;
      const sinYaw = Math.sin(camYaw);
      const cosYaw = Math.cos(camYaw);

      const fwdX = -sinYaw;
      const fwdZ = -cosYaw;

      const rgtX = cosYaw;
      const rgtZ = -sinYaw;

      const worldX = fwdX * normForward + rgtX * normRight;
      const worldZ = fwdZ * normForward + rgtZ * normRight;

      this.moveVector.set(worldX, 0, worldZ).normalize();
    } else {
      this.moveVector.set(0, 0, 0);
    }

    return this.moveVector;
  }
}
