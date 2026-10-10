import * as THREE from 'three';
import { MountainEnvironment } from './terrain.js';
import { SnowLeopard } from './player.js';
import { PreyManager } from './prey.js';
import { GameCamera } from './camera.js';
import { InputManager } from './controls.js';
import { ScentVision } from './scent.js';
import { sounds } from './audio.js';

// Main Game Controller
class Game {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // Setup Three.js Scene & Renderer
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbdd4e7);
    this.scene.fog = new THREE.FogExp2(0xc0d8ec, 0.0075);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);

    const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent) || window.innerWidth <= 1024;
    this.isMobile = isMobile;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance',
      precision: isMobile ? 'mediump' : 'highp',
      stencil: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Context loss guards to prevent Android GPU driver freezes
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost - preventing driver hang.');
    }, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.info('WebGL context restored.');
    }, false);

    this.lastTime = performance.now();

    // Setup Lighting & Sky
    this.setupLighting();

    // Initialize Game Systems
    this.terrain = new MountainEnvironment(this.scene);
    this.player = new SnowLeopard(this.scene, this.terrain);
    this.preyManager = new PreyManager(this.scene, this.terrain);
    this.gameCam = new GameCamera(this.camera, this.renderer.domElement, this.terrain);
    this.input = new InputManager(this.gameCam);
    this.scentVision = new ScentVision(this.scene);

    // Track state
    this.difficulty = 'medium';
    this.nearestDownedPrey = null;
    this.lastPounceHitCheck = false;
    this.lastLevelSeen = 1;

    // Boss ramming reaction callback
    this.player.onRammed = (ramDmg) => {
      const screenPos = this.getScreenCoords(this.player.position);
      this.spawnFloatingText(`RAMMED! -${ramDmg} HP`, '#ef4444', screenPos);
    };

    // UI Cache
    this.cacheUIElements();

    // Window Resize Event
    window.addEventListener('resize', () => this.onResize());

    // User interaction unlock audio context
    const unlockAudio = () => {
      sounds.ensureContext();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    // Start Game Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setDifficulty(diff) {
    this.difficulty = diff;
    this.preyManager.setDifficulty(diff);

    if (diff === 'easy') {
      this.player.hungerRate = 0.22;
    } else if (diff === 'hard') {
      this.player.hungerRate = 0.6;
    } else {
      this.player.hungerRate = 0.4;
    }

    document.querySelectorAll('.diff-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.diff === diff);
    });

    const diffNames = { easy: 'Easy (Plentiful Prey)', medium: 'Medium (Wilderness Balanced)', hard: 'Hard (Apex Challenge)' };
    this.spawnFloatingText(`Mode: ${diffNames[diff] || diff}`, '#38bdf8', {
      x: window.innerWidth * 0.5,
      y: 110
    });
  }

  setupLighting() {
    // Hemispherical Ambient Light (cool blue sky + snow bounce reflection)
    const hemiLight = new THREE.HemisphereLight(0xe8f4ff, 0x90a4ae, 0.75);
    this.scene.add(hemiLight);

    // Directional Alpine Sun Light with Crisp Shadows
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.4);
    this.sunLight.position.set(60, 90, 45);
    this.sunLight.castShadow = true;
    const shadowRes = this.isMobile ? 1024 : 1536;
    this.sunLight.shadow.mapSize.width = shadowRes;
    this.sunLight.shadow.mapSize.height = shadowRes;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 150;
    const shadowDist = 45;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
  }

  cacheUIElements() {
    this.barHp = document.getElementById('bar-hp');
    this.barStamina = document.getElementById('bar-stamina');
    this.barHunger = document.getElementById('bar-hunger');
    this.barXp = document.getElementById('bar-xp');
    this.hudLevel = document.getElementById('hud-level');
    this.compassHeading = document.getElementById('compass-heading');
    this.preyRadarText = document.getElementById('prey-radar-text');
    this.questStats = document.getElementById('quest-stats');
    this.btnEat = document.getElementById('btn-eat');
    this.btnStalk = document.getElementById('btn-stalk');
    this.btnSprint = document.getElementById('btn-sprint');
    this.floatingContainer = document.getElementById('floating-text-container');
    this.levelUpBanner = document.getElementById('levelup-banner');
    this.levelUpDetails = document.getElementById('levelup-details');

    // Boss HUD
    this.bossHud = document.getElementById('boss-hud');
    this.bossBarFill = document.getElementById('boss-bar-fill');
    this.bossHpLabel = document.getElementById('boss-hp-label');

    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.setDifficulty(btn.dataset.diff);
      });
    });
  }

  spawnFloatingText(text, color, screenPos) {
    if (!this.floatingContainer) return;
    const el = document.createElement('div');
    el.className = 'floating-msg';
    el.innerText = text;
    el.style.color = color;
    el.style.left = `${screenPos.x}px`;
    el.style.top = `${screenPos.y}px`;
    this.floatingContainer.appendChild(el);

    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1200);
  }

  showLevelUpBanner(level) {
    if (!this.levelUpBanner) return;
    this.levelUpDetails.innerText = `Level ${level} Reached! Max HP, Stamina, and Attack Boosted!`;
    this.levelUpBanner.style.display = 'block';
    setTimeout(() => {
      this.levelUpBanner.style.display = 'none';
    }, 2800);
  }

  getScreenCoords(worldPos) {
    const v = worldPos.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(v.y * 0.5) + 0.5) * window.innerHeight;
    return { x, y };
  }

  checkPounceAttack() {
    // When Snow Leopard is pouncing, hit detection runs forward in leap arc
    if (!this.player.isPouncing) {
      this.lastPounceHitCheck = false;
      return;
    }

    if (this.lastPounceHitCheck) return; // already struck during this pounce leap

    const attackRange = 3.6;
    const forward = new THREE.Vector3(Math.sin(this.player.facingAngle), 0, Math.cos(this.player.facingAngle));

    for (const prey of this.preyManager.preyList) {
      if (prey.isDead) continue;
      const toPrey = prey.position.clone().sub(this.player.position);
      const dist = toPrey.length();

      if (dist < attackRange) {
        toPrey.normalize();
        const dot = forward.dot(toPrey);
        if (dot > 0.35) {
          // DIRECT POUNCE HIT! Heavy burst damage
          this.lastPounceHitCheck = true;
          const damage = Math.round(this.player.attackPower * 1.8 * (0.95 + Math.random() * 0.25));
          prey.takeDamage(damage);

          const screenPos = this.getScreenCoords(prey.position);
          this.spawnFloatingText(`POUNCE! -${damage} HP`, '#ef4444', screenPos);

          if (prey.isDead) {
            this.player.preyHunted += 1;
            const xp = prey.xpReward || (prey.isBoss ? 350 : (prey.type === 'ibex' ? 85 : 45));
            this.spawnFloatingText(`+${xp} XP${prey.isBoss ? ' 👑 BOSS SLAIN!' : ''}`, '#a855f7', {
              x: screenPos.x,
              y: screenPos.y - 30
            });
            this.player.addXp(xp);
          }
          break;
        }
      }
    }
  }

  checkSwipeAttack() {
    if (!this.input.isSwipeRequested) return;
    this.input.isSwipeRequested = false;

    // Trigger leopard claw swipe animation & sound
    const swiped = this.player.pawSwipe();
    if (!swiped) return;

    const attackRange = 2.7; // Close-range melee reach
    const forward = new THREE.Vector3(Math.sin(this.player.facingAngle), 0, Math.cos(this.player.facingAngle));

    for (const prey of this.preyManager.preyList) {
      if (prey.isDead) continue;
      const toPrey = prey.position.clone().sub(this.player.position);
      const dist = toPrey.length();

      if (dist < attackRange) {
        toPrey.normalize();
        const dot = forward.dot(toPrey);
        if (dot > 0.2) {
          // CLOSE MELEE PAW SWIPE HIT! Fast lower damage
          const damage = Math.round(this.player.attackPower * 0.65 * (0.9 + Math.random() * 0.25));
          prey.takeDamage(damage);

          const screenPos = this.getScreenCoords(prey.position);
          this.spawnFloatingText(`SWIPE! -${damage} HP`, '#f59e0b', screenPos);

          if (prey.isDead) {
            this.player.preyHunted += 1;
            const xp = prey.xpReward || (prey.isBoss ? 350 : (prey.type === 'ibex' ? 85 : 45));
            this.spawnFloatingText(`+${xp} XP${prey.isBoss ? ' 👑 BOSS SLAIN!' : ''}`, '#a855f7', {
              x: screenPos.x,
              y: screenPos.y - 30
            });
            this.player.addXp(xp);
          }
          break;
        }
      }
    }
  }

  updateInteractionPrompts() {
    // Find if player is close to a downed carcass to feed
    let nearestCarcass = null;
    let minDist = 3.8;

    for (const p of this.preyManager.preyList) {
      if (p.isDead && p.meatAmount > 0) {
        const d = this.player.position.distanceTo(p.position);
        if (d < minDist) {
          minDist = d;
          nearestCarcass = p;
        }
      }
    }

    this.nearestDownedPrey = nearestCarcass;

    if (nearestCarcass) {
      if (this.btnEat) this.btnEat.style.display = 'flex';
      // Feed action requested
      if (this.input.isEatRequested) {
        this.input.isEatRequested = false;
        const fed = this.player.eat(nearestCarcass);
        if (fed) {
          const screenPos = this.getScreenCoords(this.player.position);
          this.spawnFloatingText(`+Meat! Hunger Restored`, '#22c55e', screenPos);
        }
      }
    } else {
      if (this.btnEat) this.btnEat.style.display = 'none';
      this.input.isEatRequested = false;
    }

    // Pounce input request
    if (this.input.isPounceRequested) {
      this.input.isPounceRequested = false;
      this.player.pounce();
    }

    // Scent vision input request
    if (this.input.isScentRequested) {
      this.input.isScentRequested = false;
      this.scentVision.toggle(this.player.position);
    }
  }

  updateHUD() {
    // Stat Bars
    this.barHp.style.width = `${Math.max(0, (this.player.hp / this.player.maxHp) * 100)}%`;
    this.barStamina.style.width = `${Math.max(0, (this.player.stamina / this.player.maxStamina) * 100)}%`;
    this.barHunger.style.width = `${Math.max(0, (this.player.hunger / this.player.maxHunger) * 100)}%`;
    this.barXp.style.width = `${Math.max(0, (this.player.xp / this.player.xpToNext) * 100)}%`;
    this.hudLevel.innerText = `Lv ${this.player.level}`;

    // Level up check
    if (this.player.level > this.lastLevelSeen) {
      this.lastLevelSeen = this.player.level;
      this.showLevelUpBanner(this.player.level);
    }

    // Toggle button UI active states
    if (this.btnStalk) {
      this.btnStalk.classList.toggle('active', this.player.isStalking);
    }
    if (this.btnSprint) {
      this.btnSprint.classList.toggle('active', this.player.isSprinting);
    }

    // Compass Cardinal Heading
    const camAngle = ((this.gameCam.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const headings = ['NORTH', 'NE', 'EAST', 'SE', 'SOUTH', 'SW', 'WEST', 'NW'];
    const idx = Math.round((camAngle / (Math.PI * 2)) * 8) % 8;
    this.compassHeading.innerText = headings[idx];

    // Boss Yak Health Bar HUD (displays when near living boss)
    const { boss, distance: bossDist } = this.preyManager.getNearestBoss(this.player.position);
    if (this.bossHud) {
      if (boss && !boss.isDead && bossDist < 48) {
        this.bossHud.style.display = 'flex';
        const hpPct = Math.max(0, (boss.hp / boss.maxHp) * 100);
        if (this.bossBarFill) this.bossBarFill.style.width = `${hpPct}%`;
        if (this.bossHpLabel) this.bossHpLabel.innerText = `${boss.hp} / ${boss.maxHp} HP`;
      } else {
        this.bossHud.style.display = 'none';
      }
    }

    // Nearest Prey Scent Radar
    const { prey, distance } = this.preyManager.getNearestPrey(this.player.position);
    if (prey) {
      const isBoss = prey.isBoss;
      const name = isBoss ? '👑 Titan Crag Yak (BOSS)' : (prey.type === 'ibex' ? 'Himalayan Ibex' : 'Snow Hare');
      this.preyRadarText.innerText = `Scent: ${name} (${Math.round(distance)}m)`;
      this.preyRadarText.style.color = isBoss ? '#fbbf24' : '#38bdf8';
    } else {
      this.preyRadarText.innerText = 'All nearby prey hunted';
      this.preyRadarText.style.color = '#94a3b8';
    }

    // Quest tracker
    this.questStats.innerText = `Hunted: ${this.player.preyHunted} | Fed: ${this.player.meatConsumed} kg`;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent) || window.innerWidth <= 1024;
    this.renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.5));
  }

  animate() {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // 1. Get input
    const moveVec = this.input.getMovementVector();

    // 2. Update Snow Leopard Player
    this.player.update(delta, moveVec, this.input.isSprinting, this.input.isStalking);

    // 3. Keep Sun Light following player for sharp shadow map coverage
    this.sunLight.position.set(this.player.position.x + 60, 90, this.player.position.z + 45);
    this.sunLight.target.position.copy(this.player.position);
    this.sunLight.target.updateMatrixWorld();

    // 4. Update Prey AI
    this.preyManager.update(delta, this.player);

    // 5. Check Pounce Attack Hitbox
    this.checkPounceAttack();

    // 5b. Check Paw Swipe Attack Melee Hitbox
    this.checkSwipeAttack();

    // 6. Update Interactions (Feed carcass, toggles)
    this.updateInteractionPrompts();

    // 7. Update Scent Vision Trails & Pulse
    this.scentVision.update(delta, this.player.position, this.preyManager.preyList);

    // 8. Update Camera Follow & Collision
    this.gameCam.update(delta, this.player.position, this.player.isSprinting, this.player.isPouncing);

    // 9. Update Weather (blowing mountain snow particles)
    this.terrain.update(delta, this.player.position);

    // 10. Update UI HUD
    this.updateHUD();

    // Render Scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Start Game on window load
window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
