import * as THREE from 'three';
import { MountainEnvironment } from './terrain.js';
import { SnowLeopard } from './player.js';
import { PreyManager } from './prey.js';
import { GameCamera } from './camera.js';
import { InputManager } from './controls.js';
import { ScentVision } from './scent.js';
import { sounds } from './audio.js';
import { ads } from './ads.js';
import { isMobileDevice, isSafeRenderMode, rememberSafeRenderMode, gpuRendererName, gpuHasShadowMapBug } from './utils.js';
import { AUTOSAVE_INTERVAL_MS, readSave, writeSave, clearSave, readCollection, writeCollection } from './save.js';
import { ACCESSORIES, ACCESSORY_BY_ID, RARITIES, SLOTS, MILESTONES } from './accessories.js';
import { TreasureManager, pickReward } from './treasure.js';
import {
  CURRENCY, PREY_PELTS, SPARE_TREASURE_PELTS, PRICES, STREAK_REWARDS, DAILY_STASH_COUNT, DAILY_STASH_FALLBACK,
  dayKey, msUntilTomorrow, dailyLoginReward, dailyOffers, canAfford, formatPrice, formatReward
} from './economy.js';
import { BILLING_ENABLED, PRODUCTS, purchase } from './store.js';
import { cloud } from './cloud.js';
import { reportError, setErrorContext } from './errors.js';
import { settings, onSettingsChange, updateSettings, QUALITY_LEVELS } from './settings.js';
import { buzz, HAPTIC } from './haptics.js';
import { Tutorial } from './tutorial.js';
import { APP_VERSION, APP_BUILD } from './version.js';
import { World, env } from './world.js';
import { Territory, MARK_INCOME } from './territory.js';
import { Scavengers } from './scavengers.js';
import { buildCamp } from './camp.js';
import { Quests } from './quests.js';
import { COATS, COAT_BY_ID } from './coats.js';
import { DOUBLE_PELTS_COOLDOWN, MAX_OFFER_REFRESHES } from './economy.js';
import { Family } from './family.js';
import { HERDER_CAMP } from './prey.js';

const COMPASS_HEADINGS = ['NORTH', 'NE', 'EAST', 'SE', 'SOUTH', 'SW', 'WEST', 'NW'];

const detectMobile = isMobileDevice;

// Settings > Graphics: Low trades sharpness for frame rate, High the reverse
function pixelRatioFor(isMobile) {
  const dpr = window.devicePixelRatio || 1;
  if (settings.quality === 'low') return isMobile ? 0.75 : 1.0;
  if (settings.quality === 'high') return Math.min(dpr, isMobile ? 1.5 : 2);
  return isMobile ? 1.0 : Math.min(dpr, 1.5);
}

// Main Game Controller
class Game {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // Setup Three.js Scene & Renderer
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc9d9e8, 110, 640);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

    const isMobile = detectMobile();
    this.isMobile = isMobile;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance',
      precision: isMobile ? 'mediump' : 'highp',
      stencil: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(pixelRatioFor(isMobile));

    // Shadow maps crash the PowerVR driver in the Pixel 10 family (blank canvas a moment after
    // the first frame), so they stay off there and on any device that already lost its context.
    const gpuName = gpuRendererName(this.renderer.getContext());
    this.safeRender = isSafeRenderMode() || gpuHasShadowMapBug(gpuName);
    if (this.safeRender) console.warn(`Safe render mode (no shadow maps) for GPU: ${gpuName}`);
    setErrorContext({ gpu: gpuName, safeRender: this.safeRender });
    this.renderer.shadowMap.enabled = !this.safeRender && settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Context loss guards to prevent Android GPU driver freezes
    this.startedAt = performance.now();
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost - preventing driver hang.');
      reportError('webgl-context-lost', `Context lost ${Math.round(performance.now() - this.startedAt)} ms after start`);
      if (this.safeRender) return; // already running the lightest path; wait for a restore
      // Drop shadow maps for the restored context and for every launch from now on. If this
      // happened right after start-up (nothing to lose yet) relaunch straight into safe mode.
      this.safeRender = true;
      this.renderer.shadowMap.enabled = false;
      rememberSafeRenderMode();
      if (performance.now() - this.startedAt < 30000) location.reload();
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
    this.gameCam = new GameCamera(this.camera, this.terrain);
    this.input = new InputManager(this.gameCam);
    this.scentVision = new ScentVision(this.scene);
    this.treasures = new TreasureManager(this.scene, this.terrain);
    this.world = new World({ scene: this.scene, terrain: this.terrain, renderer: this.renderer, sunLight: this.sunLight, rimLight: this.rimLight, hemiLight: this.hemiLight });
    this.world.onPhaseChange = (phase) => this.onPhaseChange(phase);
    this.world.onWeatherChange = (weather) => this.onWeatherChange(weather);
    this.world.onNewDay = (day) => this.onNewDay(day);
    buildCamp(this.scene, this.terrain, HERDER_CAMP);
    this.territory = new Territory(this);
    this.scavengers = new Scavengers(this.scene, this.terrain);
    this.quests = new Quests((q) => this.onQuestComplete(q), () => this.renderQuest());
    this.family = new Family(this);
    this.scavengers.onFirstVisit = () => this.announce('🦅 Scavengers are circling a kill! Drag kills into cover by a rock or tree to cache them.', '#fde68a');

    // Track state
    this.pounceHasHit = false;
    this.lastLevelSeen = 1;
    this.hudCache = new Map(); // element -> { prop: lastValue }, avoids redundant DOM writes
    this.difficulty = 'medium';
    this.isPaused = false; // world frozen while a menu (treasure popup, wardrobe) is open
    this.nearTreasure = null;
    this.lastFoundItem = null;

    // Death screen (revive with a rewarded ad, or respawn at camp)
    this.player.onDeath = () => this.showDeathScreen();

    // Boss ramming reaction callback
    this.player.onRammed = (ramDmg) => {
      const screenPos = this.getScreenCoords(this.player.position);
      this.spawnFloatingText(`RAMMED! -${ramDmg} HP`, '#ef4444', screenPos);
    };

    // UI Cache
    this.cacheUIElements();
    this.setupSettings();
    this.tutorial = new Tutorial(this);
    this.player.onHurt = () => buzz(HAPTIC.hurt);
    this.player.onBitten = (dmg, attacker) => {
      this.spawnFloatingText(`${attacker.type === 'dog' ? '🐕' : '🐺'} BITTEN! -${dmg} HP`, '#ef4444', this.getScreenCoords(this.player.position));
      sounds.playHiss();
    };
    this.preyManager.onLivestockKilled = () => {
      this.announce('🐕 The herders saw that! Their mastiffs are coming for you.', '#fca5a5');
      setTimeout(() => this.announce('Real snow leopards are often killed in revenge for taking livestock.', '#cbd5e1'), 2600);
    };

    // Resume saved progress, then keep saving automatically
    this.loadCollection();
    this.loadGame();
    this.renderQuest();
    // New players (and anyone who quit before finishing it) get the tutorial
    if (!Tutorial.isDone() && this.player.preyHunted === 0 && this.player.level === 1) this.tutorial.start();
    // Catch up on book rewards earned before milestones existed (needs the loaded XP)
    const owed = this.claimMilestones();
    if (owed.length) this.spawnFloatingText(`📖 Collection rewards: ${owed.map((m) => m.label).join(', ')}`, '#4ade80', { x: window.innerWidth * 0.5, y: 140 });
    this.setupDaily();

    // Cloud saves (no-op until configured in cloud.js)
    cloud.subscribe(() => this.renderCloud());
    cloud.init({ beforeReload: () => (this.isResetting = true) });
    this.renderCloud();
    setInterval(() => this.saveGame(), AUTOSAVE_INTERVAL_MS);
    // Android can kill a backgrounded app without warning, so save the moment it's hidden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveGame();
    });
    window.addEventListener('pagehide', () => this.saveGame());

    // Window Resize Event
    window.addEventListener('resize', () => this.onResize());

    // Audio may only start (or resume after the OS suspends it) from a user gesture
    const unlockAudio = () => sounds.ensureContext();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    // Ads (Android app only; no-op in the browser)
    ads.init().then(() => {
      if (ads.privacyOptionsRequired && this.btnAdPrivacy) this.btnAdPrivacy.style.display = 'block';
    });

    // Start Game Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setDifficulty(diff, announce = true) {
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

    if (!announce) return;
    this.saveGame();

    const diffNames = { easy: 'Easy (Relaxed Hunt)', medium: 'Medium (Wilderness Balanced)', hard: 'Hard (Apex Challenge)' };
    this.spawnFloatingText(`Mode: ${diffNames[diff] || diff}`, '#38bdf8', {
      x: window.innerWidth * 0.5,
      y: 110
    });
  }

  saveGame() {
    // Don't snapshot the death screen; the save from just before death is kept instead.
    // Also skip while a new game reloads the page, or the pagehide save would undo the reset.
    if (this.player.isDowned || this.isResetting) return;
    writeSave(this.player, this.difficulty, this.worldState());
  }

  // Everything about this leopard's world that should survive a restart (stored in the leopard save)
  worldState() {
    return { clock: this.world.serialize(), marks: this.territory.serialize(), quests: this.quests.serialize(), family: this.family.serialize() };
  }

  restoreWorldState(state) {
    if (!state || typeof state !== 'object') return;
    this.world.restore(state.clock);
    this.territory.restore(state.marks);
    this.quests.restore(state.quests);
    this.family.restore(state.family);
  }

  // ------------------------------------------------------------------ quests
  renderQuest() {
    const q = this.quests.current;
    this.setText(this.questTitle, q.challenge ? '🌄 Wild challenge' : `Quest ${Math.min(this.quests.index + 1, 16)}: ${q.title}`);
    this.setText(this.questDesc, q.challenge ? q.title.replace('Wild challenge: ', '') + '. ' + q.desc : q.desc);
    const unit = q.event === 'eat' ? ' kg' : '';
    this.setText(this.questStats, this.quests.waiting ? '✅ Complete!' : `Progress: ${Math.floor(this.quests.progress)} / ${q.count}${unit}`);
  }

  onQuestComplete(q) {
    this.player.addXp(q.xp);
    this.addCurrency({ pelts: q.pelts });
    buzz(HAPTIC.reward);
    sounds.playTreasureFound();
    this.showBanner(q.challenge ? 'Challenge complete!' : 'Quest complete!', `${q.title.replace('Wild challenge: ', '')}  +${q.xp} XP  +${q.pelts} 🐾`);
    this.saveGame();
  }

  // Returns true if a saved game was resumed
  loadGame() {
    const save = readSave();
    if (!save) return false;
    this.player.restoreProgress(save.player);
    this.restoreWorldState(save.world);
    this.lastLevelSeen = this.player.level;
    this.setDifficulty(save.difficulty, false);
    this.spawnFloatingText(`Welcome back! Lv ${this.player.level}`, '#38bdf8', {
      x: window.innerWidth * 0.5,
      y: 110
    });
    return true;
  }

  // ------------------------------------------------------------------ day, night & weather
  announce(text, color = '#fde68a') {
    this.spawnFloatingText(text, color, { x: window.innerWidth * 0.5, y: window.innerHeight * 0.32 });
  }

  onPhaseChange(phase) {
    if (phase === 'dawn') this.announce('🌅 Dawn: the best hunting light. Prey see you less.');
    else if (phase === 'dusk') this.announce('🌇 Dusk: twilight hunting time.');
    else if (phase === 'night') this.announce('🌙 Night falls. Rest in a den, or hunt by moonlight.', '#c7d2fe');
  }

  onWeatherChange(weather) {
    if (weather === 'blizzard') this.announce('🌨️ Blizzard! Prey can barely see, hear or smell you.', '#e0f2fe');
    else if (weather === 'clear') this.announce('☀️ The sky clears.', '#e0f2fe');
  }

  onNewDay(day) {
    this.family.onNewDay();
    const income = this.territory.dailyIncome();
    if (income > 0) {
      this.addCurrency({ pelts: income });
      this.announce(`🏔️ Your territory yields +${income} 🐾`, '#c4b5fd');
    }
    this.saveGame();
  }

  // ------------------------------------------------------------------ drag & cache kills
  canDrag(c) {
    return c && c.isDead && c.meatAmount > 0 && !c.isBoss && !c.isPredator && !c.dragged;
  }

  startDrag(carcass) {
    this.dragging = carcass;
    carcass.dragged = true;
    carcass.cached = false;
    this.player.dragging = true;
    this.player.isSprinting = false;
    this.input.isSprinting = false;
    carcass.updateSprite('🦴', '#0d9488');
  }

  updateDrag(delta) {
    const c = this.dragging;
    if (!c) return;
    if (!c.isDead || c.meatAmount <= 0 || !this.preyManager.preyList.includes(c)) {
      this.stopDrag();
      return;
    }
    const p = this.player;
    const x = p.position.x + Math.sin(p.facingAngle) * 1.7;
    const z = p.position.z + Math.cos(p.facingAngle) * 1.7;
    const ground = this.terrain.getSurfaceHeight(x, z);
    c.position.set(x, ground, z);
    c.mesh.position.set(x, ground - c.cfg.drop, z);
    c.mesh.rotation.y = p.facingAngle + Math.PI / 2;
    c.deadTimer = Math.max(0, c.deadTimer - delta); // doesn't spoil while carried
  }

  // Cover = within reach of a boulder or tree
  nearCover(pos) {
    const rock = this.terrain.nearestObstacle(pos, 'rock');
    const tree = this.terrain.nearestObstacle(pos, 'tree');
    return rock.gap < 3 || tree.gap < 2.5;
  }

  stopDrag(cache = false) {
    const c = this.dragging;
    this.dragging = null;
    this.player.dragging = false;
    if (!c) return;
    c.dragged = false;
    if (!cache) {
      c.updateSprite('🍖', '#22c55e');
      return;
    }
    c.cached = true;
    c.deadTimer = 0;
    c.updateSprite('🪨', '#0f766e');
    this.questEvent('cache');
    this.announce('🪨 Kill cached! It keeps far longer and scavengers can\'t find it.', '#99f6e4');
    sounds.playChuff();
  }

  // ------------------------------------------------------------------ scent marking
  markRock(index) {
    const p = this.player;
    p.finisherTimer = 1.1;
    p.playAction('ProwlIdle', 0.15, true);
    setTimeout(() => {
      this.territory.mark(index);
      p.addXp(15);
      this.questEvent('mark');
      const n = this.territory.freshCount();
      this.announce(`🐾 Boulder marked! Territory: ${n} (+${n * MARK_INCOME} 🐾 each dawn)`, '#d8b4fe');
      this.saveGame();
    }, 700);
  }

  // Everything an attack can hit: animals plus a rival leopard
  targets() {
    const rival = this.territory.rival;
    return rival && !rival.isDead ? [...this.preyManager.preyList, rival] : this.preyManager.preyList;
  }

  // Rest in a den: skip to dawn (or 4 hours by day), fully heal, get a little hungrier
  startRest(den) {
    if (this.resting) return;
    this.resting = true;
    this.restDen = den;
    this.setPaused(true);
    this.player.position.set(den.mouth.x, den.mouth.y, den.mouth.z);
    this.player.facingAngle = Math.atan2(den.x - den.mouth.x, den.z - den.mouth.z) + Math.PI;
    this.player.playAction('ProwlIdle', 0.4, true);
    this.restOverlay.classList.add('show');
    setTimeout(() => this.finishRest(), 2400);
  }

  finishRest() {
    const w = this.world;
    const hours = w.isNight || w.phase === 'dusk' ? w.hoursUntilDawn() : 4;
    w.skipHours(hours);
    const p = this.player;
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    p.hunger = Math.max(15, p.hunger - hours * 1.2);
    this.restOverlay.classList.remove('show');
    this.resting = false;
    this.setPaused(false);
    this.announce(`💤 Rested ${Math.round(hours)} h. Fully healed. ${w.label()}`, '#a7f3d0');
    this.afterRest(hours);
    this.saveGame();
  }

  // Systems that react to resting: cubs are born in the den, quests
  afterRest() {
    this.family.onRest(this.restDen);
    this.questEvent('rest');
  }

  // ------------------------------------------------------------------ context action
  // One button (R key) whose job depends on the situation. Highest priority first.
  contextActions() {
    const acts = [];
    const pinned = this.pinnedPrey;
    if (pinned && !pinned.isDead && pinned.pinnedTimer > 0 && pinned.position.distanceTo(this.player.position) < 5) {
      acts.push({ id: 'bite', icon: '🦷', label: 'Bite', urgent: true, run: () => this.throatBite(pinned) });
    }
    const pos = this.player.position;
    if (this.dragging) {
      if (this.nearCover(this.dragging.position)) acts.push({ id: 'cache', icon: '🪨', label: 'Cache', run: () => this.stopDrag(true) });
      else acts.push({ id: 'drop', icon: '⬇️', label: 'Drop', run: () => this.stopDrag(false) });
      return acts;
    }
    const { den, distance } = this.terrain.nearestDen(pos);
    if (den && distance < 5) acts.push({ id: 'rest', icon: '💤', label: 'Rest', run: () => this.startRest(den) });
    let carcass = null;
    for (const p of this.preyManager.preyList) if (this.canDrag(p) && p.position.distanceTo(pos) < 3.8) carcass = p;
    if (carcass) acts.push({ id: 'drag', icon: '🦴', label: 'Drag', run: () => this.startDrag(carcass) });
    const rock = this.territory.markableRock(pos);
    if (rock) acts.push({ id: 'mark', icon: '🐾', label: 'Mark', run: () => this.markRock(rock.index) });
    if (this.family.canCall()) acts.push({ id: 'call', icon: '📣', label: 'Call', run: () => this.family.callForMate() });
    return acts;
  }

  updateContextAction() {
    const act = this.player.isDowned ? null : this.contextActions()[0] || null;
    this.setStyle(this.btnAct, 'display', act ? 'flex' : 'none');
    if (act) {
      this.setText(this.actIcon, act.icon);
      this.setText(this.actLabel, act.label);
      this.btnAct.classList.toggle('urgent', Boolean(act.urgent));
    }
    if (this.input.isActRequested) {
      this.input.isActRequested = false;
      if (act) act.run();
    }
  }

  // ------------------------------------------------------------------ settings
  setupSettings() {
    this.settingsPanel = document.getElementById('settings-panel');
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-settings-close').addEventListener('click', () => this.closeSettings());
    this.settingsPanel.addEventListener('click', (e) => {
      if (e.target === this.settingsPanel) this.closeSettings();
    });
    this.startQuality = settings.quality;
    for (const input of this.settingsPanel.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      const scale = Number(input.dataset.scale || 1);
      if (input.type === 'checkbox') input.checked = settings[key];
      else input.value = Math.round(settings[key] * scale);
      input.addEventListener('input', () => {
        updateSettings({ [key]: input.type === 'checkbox' ? input.checked : Number(input.value) / scale });
        if (key === 'vibration' && input.checked) buzz(HAPTIC.hit);
      });
    }
    const qualityButtons = this.settingsPanel.querySelectorAll('[data-quality]');
    const showQuality = () => {
      qualityButtons.forEach((b) => b.classList.toggle('active', b.dataset.quality === settings.quality));
      document.getElementById('btn-restart').style.display = settings.quality !== this.startQuality ? '' : 'none';
    };
    qualityButtons.forEach((b) => b.addEventListener('click', () => {
      if (QUALITY_LEVELS.includes(b.dataset.quality)) updateSettings({ quality: b.dataset.quality });
      showQuality();
    }));
    showQuality();
    document.getElementById('btn-restart').addEventListener('click', () => {
      this.saveGame();
      window.location.reload();
    });
    document.getElementById('btn-replay-tutorial').addEventListener('click', () => {
      this.closeSettings();
      this.tutorial.replay();
    });
    document.getElementById('settings-version').textContent = `Snow Leopard World ${APP_VERSION} (${APP_BUILD})`;

    onSettingsChange((st) => {
      sounds.setVolumes({ master: st.master, effects: st.effects, ambience: st.ambience });
      this.gameCam.sensitivity = st.camSensitivity;
      this.gameCam.invertY = st.invertY;
    });
  }

  openSettings() {
    if (this.player.isDowned) return;
    this.settingsPanel.style.display = 'flex';
    this.setPaused(true);
  }

  closeSettings() {
    this.settingsPanel.style.display = 'none';
    this.setPaused(false);
  }

  startNewGame() {
    if (!window.confirm('Start a new game? Your leopard\'s level and stats will be reset. Accessories you\'ve found are kept.')) return;
    this.isResetting = true;
    clearSave();
    window.location.reload();
  }

  // ------------------------------------------------------------------ accessories
  loadCollection() {
    this.collection = readCollection(new Set(Object.keys(ACCESSORY_BY_ID)));
    // drop coat colours that no longer exist, then wear the chosen one
    this.collection.coats = new Set([...this.collection.coats].filter((id) => COAT_BY_ID[id]));
    this.collection.coats.add('natural');
    if (!this.collection.coats.has(this.collection.coat)) this.collection.coat = 'natural';
    this.player.setCoat(COAT_BY_ID[this.collection.coat].tint);
    for (const [slot, id] of Object.entries(this.collection.equipped)) {
      if (SLOTS[slot] && ACCESSORY_BY_ID[id].slot === slot) this.player.setAccessory(slot, id);
      else delete this.collection.equipped[slot];
    }
    this.applyGoldPrints();
    this.updateWardrobeCount();
    this.updateWalletHUD();
  }

  hasGoldPrintsUnlocked() {
    return MILESTONES.some((m) => m.goldPrints && this.collection.milestones.includes(m.count));
  }

  applyGoldPrints() {
    this.terrain.setGoldenPawPrints(this.hasGoldPrintsUnlocked() && this.collection.goldPrints);
  }

  // Grants every collection book milestone the collection has reached but not yet claimed.
  // Returns the newly claimed milestones.
  claimMilestones() {
    const claimed = [];
    for (const m of MILESTONES) {
      if (this.collection.owned.size < m.count || this.collection.milestones.includes(m.count)) continue;
      this.collection.milestones.push(m.count);
      if (m.xp) this.player.addXp(m.xp);
      claimed.push(m);
    }
    if (claimed.length) {
      writeCollection(this.collection);
      this.applyGoldPrints();
      this.saveGame();
    }
    return claimed;
  }

  // Wears an owned item, or takes it off if it's already worn
  toggleAccessory(id) {
    const item = ACCESSORY_BY_ID[id];
    if (!item || !this.collection.owned.has(id)) return;
    const wearing = this.collection.equipped[item.slot] === id;
    if (wearing) delete this.collection.equipped[item.slot];
    else this.collection.equipped[item.slot] = id;
    this.player.setAccessory(item.slot, wearing ? null : id);
    writeCollection(this.collection);
  }

  updateWardrobeCount() {
    this.setText(this.wardrobeCount, `${this.collection.owned.size}/${ACCESSORIES.length}`);
  }

  setPaused(paused) {
    this.isPaused = paused;
    if (!paused) this.clearActionRequests();
  }

  // Drops any actions pressed while the world was frozen
  clearActionRequests() {
    this.input.isPounceRequested = false;
    this.input.isSwipeRequested = false;
    this.input.isEatRequested = false;
    this.input.isDigRequested = false;
    this.input.isScentRequested = false;
  }

  digTreasure(treasure) {
    if (!this.player.dig(treasure.position)) return;
    treasure.digging = true;
    // Let the paws hit the snow before the reveal
    setTimeout(() => this.revealTreasure(treasure), 450);
  }

  revealTreasure(treasure) {
    this.treasures.collect(treasure);
    if (treasure.daily && !treasure.bonus) {
      this.collection.daily.stashFound += 1;
      writeCollection(this.collection);
    }
    const item = pickReward(treasure.rarity, this.collection.owned);
    const screenPos = this.getScreenCoords(treasure.position);

    if (!item) {
      // Everything is collected: treasure pays out currency instead
      const reward = treasure.daily ? DAILY_STASH_FALLBACK : { pelts: SPARE_TREASURE_PELTS };
      this.addCurrency(reward);
      this.spawnFloatingText(`${treasure.daily ? '🎁 Daily stash!' : '✨ Spare trinket!'} ${formatReward(reward)}`, '#fcd34d', screenPos);
      sounds.playTreasureFound();
      this.saveGame();
      return;
    }

    this.collection.owned.add(item.id);
    this.collection.foundAt[item.id] = Date.now();
    writeCollection(this.collection);
    this.updateWardrobeCount();
    this.player.addXp(25);
    const milestones = this.claimMilestones();
    this.saveGame();
    sounds.playTreasureFound();
    buzz(HAPTIC.reward);
    this.showTreasurePopup(item, milestones, treasure.daily ? '🎁 Daily stash! 🎁' : undefined);
  }

  setRarityVars(el, rarity) {
    const color = RARITIES[rarity].color;
    el.style.setProperty('--rarity', color);
    el.style.setProperty('--rarity-soft', `${color}99`);
    el.style.setProperty('--rarity-dim', `${color}40`);
  }

  showTreasurePopup(item, milestones = [], title = '✨ You found something! ✨') {
    this.lastFoundItem = item;
    this.treasureTitle.textContent = title;
    // Collection book milestone reached with this find
    this.treasureBonus.style.display = milestones.length ? 'block' : 'none';
    this.treasureBonus.textContent = milestones
      .map((m) => (m.goldPrints ? '🐾 Collection complete! Golden paw prints unlocked!' : `📖 ${m.count} found! Collection reward: ${m.label}`))
      .join('\n');
    this.treasureIcon.textContent = item.icon;
    this.treasureName.textContent = item.name;
    this.treasureRarity.textContent = RARITIES[item.rarity].label;
    this.setRarityVars(this.treasureCard, item.rarity);
    // Restart the pop-in animation
    this.treasureCard.style.animation = 'none';
    void this.treasureCard.offsetWidth;
    this.treasureCard.style.animation = '';
    this.treasurePopup.style.display = 'flex';
    this.setPaused(true);
  }

  hideTreasurePopup(wear) {
    if (wear && this.lastFoundItem && this.collection.equipped[this.lastFoundItem.slot] !== this.lastFoundItem.id) {
      this.toggleAccessory(this.lastFoundItem.id);
    }
    this.treasurePopup.style.display = 'none';
    this.setPaused(false);
  }

  openWardrobe(tab = 'wear') {
    if (this.player.isDowned) return;
    this.showWardrobeTab(tab);
    this.wardrobe.style.display = 'flex';
    this.setPaused(true);
  }

  closeWardrobe() {
    this.wardrobe.style.display = 'none';
    this.setPaused(false);
  }

  showWardrobeTab(tab) {
    this.wardrobeTab = tab;
    for (const btn of this.wardrobe.querySelectorAll('.wardrobe-tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    this.wardrobeWear.style.display = tab === 'wear' ? 'block' : 'none';
    this.wardrobeBook.style.display = tab === 'book' ? 'block' : 'none';
    if (tab === 'book') this.renderBook();
    else this.renderWardrobe();
  }

  // Small DOM helper for the book: el('div', 'class', 'text', ...children)
  el(tag, className, text, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    node.append(...children);
    return node;
  }

  renderBook() {
    const owned = this.collection.owned;
    const total = ACCESSORIES.length;
    const book = this.wardrobeBook;
    book.replaceChildren();

    // Overall progress
    const pct = Math.round((owned.size / total) * 100);
    const totalBar = this.el('div', 'book-bar');
    const totalFill = this.el('div', 'book-bar-fill');
    totalFill.style.width = `${pct}%`;
    totalBar.append(totalFill);
    book.append(
      this.el('div', 'book-total', '', this.el('strong', '', `${owned.size} / ${total}`), this.el('span', '', `accessories found (${pct}%)`)),
      totalBar
    );

    // Progress per rarity
    book.append(this.el('div', 'book-section-title', 'By rarity'));
    for (const [key, r] of Object.entries(RARITIES)) {
      const items = ACCESSORIES.filter((a) => a.rarity === key);
      const found = items.filter((a) => owned.has(a.id)).length;
      const bar = this.el('div', 'book-bar');
      const fill = this.el('div', 'book-bar-fill');
      fill.style.width = `${(found / items.length) * 100}%`;
      fill.style.setProperty('--rarity', r.color);
      bar.append(fill);
      const label = this.el('span', '', r.label);
      label.style.color = r.color;
      book.append(this.el('div', 'book-rarity-row', '', label, bar, this.el('span', 'count', `${found}/${items.length}`)));
    }

    // Milestone rewards
    book.append(this.el('div', 'book-section-title', 'Collection rewards'));
    for (const m of MILESTONES) {
      const done = this.collection.milestones.includes(m.count);
      const row = this.el('div', `book-milestone${done ? ' done' : ''}`, '',
        this.el('span', 'check', done ? '✅' : '🔒'),
        this.el('span', 'what', `Find ${m.count === total ? 'all ' + total : m.count}: ${m.label}`));
      if (done && m.goldPrints) {
        const toggle = this.el('button', 'book-toggle', this.collection.goldPrints ? 'On' : 'Off');
        toggle.addEventListener('click', () => {
          this.collection.goldPrints = !this.collection.goldPrints;
          writeCollection(this.collection);
          this.applyGoldPrints();
          this.renderBook();
        });
        row.append(toggle);
      } else {
        row.append(this.el('span', 'status', done ? 'Claimed' : `${m.count - owned.size} to go`));
      }
      book.append(row);
    }

    // Every item, with when it was found or a hint for the missing ones
    book.append(this.el('div', 'book-section-title', 'All accessories'));
    const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    for (const item of ACCESSORIES) {
      const has = owned.has(item.id);
      const r = RARITIES[item.rarity];
      const when = this.collection.foundAt[item.id];
      const detail = has
        ? `${r.label} · ${SLOTS[item.slot].label} · ${when ? 'Found ' + dateFmt.format(when) : 'Found'}`
        : `${r.label} · ${SLOTS[item.slot].label} · Not found yet`;
      const entry = this.el('div', `book-entry${has ? '' : ' locked'}`, '',
        this.el('span', 'item-icon', item.icon),
        this.el('span', 'info', '', this.el('span', 'name', has ? item.name : '???'), this.el('span', 'detail', detail)));
      this.setRarityVars(entry, item.rarity);
      book.append(entry);
    }
  }

  renderWardrobe() {
    this.wardrobeProgress.textContent = `${this.collection.owned.size} / ${ACCESSORIES.length} found`;
    this.wardrobeSlots.replaceChildren();
    // coat colours first
    const coatTitle = this.el('div', 'wardrobe-slot-title', 'Coat');
    const coatGrid = this.el('div', 'wardrobe-items');
    for (const coat of COATS) {
      const owned = this.collection.coats.has(coat.id);
      const btn = this.el('button', 'wardrobe-item', '', this.coatSwatch(coat), this.el('span', '', owned ? coat.name : '???'),
        this.el('span', 'item-rarity', this.collection.coat === coat.id ? 'Wearing' : owned ? 'Coat' : 'In the shop'));
      btn.classList.toggle('locked', !owned);
      btn.classList.toggle('equipped', this.collection.coat === coat.id);
      if (owned) btn.addEventListener('click', () => { this.wearCoat(coat.id); this.renderWardrobe(); });
      else btn.disabled = true;
      coatGrid.append(btn);
    }
    this.wardrobeSlots.append(coatTitle, coatGrid);
    for (const [slot, info] of Object.entries(SLOTS)) {
      const title = document.createElement('div');
      title.className = 'wardrobe-slot-title';
      title.textContent = info.label;
      const grid = document.createElement('div');
      grid.className = 'wardrobe-items';

      for (const item of ACCESSORIES.filter((a) => a.slot === slot)) {
        const owned = this.collection.owned.has(item.id);
        const btn = document.createElement('button');
        btn.className = 'wardrobe-item';
        btn.classList.toggle('locked', !owned);
        btn.classList.toggle('equipped', this.collection.equipped[slot] === item.id);
        this.setRarityVars(btn, item.rarity);

        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.textContent = item.icon;
        const name = document.createElement('span');
        name.textContent = owned ? item.name : '???';
        const rarity = document.createElement('span');
        rarity.className = 'item-rarity';
        rarity.textContent = owned && this.collection.equipped[slot] === item.id ? 'Wearing' : RARITIES[item.rarity].label;
        btn.append(icon, name, rarity);

        if (owned) {
          btn.addEventListener('click', () => {
            this.toggleAccessory(item.id);
            this.renderWardrobe();
          });
        } else {
          btn.disabled = true;
        }
        grid.appendChild(btn);
      }
      this.wardrobeSlots.append(title, grid);
    }
  }

  // ------------------------------------------------------------------ wallet
  addCurrency(reward) {
    for (const cur of Object.keys(CURRENCY)) {
      if (reward[cur]) this.collection.wallet[cur] += reward[cur];
    }
    writeCollection(this.collection);
    this.updateWalletHUD();
  }

  updateWalletHUD() {
    const w = this.collection.wallet;
    this.setText(this.hudPelts, `🐾 ${w.pelts}`);
    this.setText(this.hudCrystals, `💎 ${w.crystals}`);
  }

  // ------------------------------------------------------------------ daily
  setupDaily() {
    const today = dayKey();
    const daily = this.collection.daily;
    if (daily.stashDay !== today) {
      daily.stashDay = today;
      daily.stashFound = 0;
      writeCollection(this.collection);
    }
    this.treasures.dailyToSpawn = Math.max(0, DAILY_STASH_COUNT - daily.stashFound);
    this.treasures.dailyFirstIsFresh = daily.stashFound === 0;

    this.pendingLogin = dailyLoginReward(daily, today);
    if (this.pendingLogin) this.showDailyPopup(this.pendingLogin);
  }

  showDailyPopup(login) {
    this.dailyDay.textContent = `Day ${login.day} of ${STREAK_REWARDS.length}`;
    this.dailyStrip.replaceChildren();
    STREAK_REWARDS.forEach((reward, i) => {
      const day = i + 1;
      const cell = this.el('div', `daily-cell${day < login.day ? ' past' : ''}${day === login.day ? ' today' : ''}`, '',
        this.el('span', '', `Day ${day}`),
        ...Object.entries(reward).map(([cur, amount]) => this.el('span', 'reward', `${CURRENCY[cur].icon}${amount}`)));
      this.dailyStrip.appendChild(cell);
    });
    this.dailyNote.textContent = login.day === STREAK_REWARDS.length
      ? 'Full week! Your streak starts over tomorrow.'
      : 'Come back tomorrow to keep your streak going! Miss a day and it starts over.';
    this.dailyPopup.style.display = 'flex';
    this.setPaused(true);
  }

  claimDailyReward() {
    const login = this.pendingLogin;
    this.dailyPopup.style.display = 'none';
    this.setPaused(false);
    if (!login) return;
    this.pendingLogin = null;
    const daily = this.collection.daily;
    daily.lastLoginDay = dayKey();
    daily.streak = login.streak;
    this.addCurrency(login.reward);
    sounds.playTreasureFound();
    this.spawnFloatingText(`☀️ Daily reward ${formatReward(login.reward)}`, '#fcd34d', { x: window.innerWidth * 0.5, y: 150 });
  }

  // ------------------------------------------------------------------ cloud save
  openCloud() {
    if (this.player.isDowned) return;
    this.renderCloud();
    this.cloudPanel.style.display = 'flex';
    this.setPaused(true);
  }

  closeCloud() {
    this.cloudPanel.style.display = 'none';
    this.setPaused(false);
  }

  renderCloud() {
    if (!this.btnCloud) return;
    // Players only see the button once cloud saves are configured; developers always do
    this.btnCloud.style.display = cloud.available || import.meta.env.DEV ? '' : 'none';
    const badges = { synced: '✓', syncing: '…', restoring: '…', 'signing-in': '…', error: '!', 'signed-out': 'Off' };
    this.cloudBadge.textContent = badges[cloud.status] || '';

    const ago = cloud.lastSyncAt ? this.timeAgo(cloud.lastSyncAt) : 'never';
    const lines = {
      off: "Cloud saves aren't set up yet.\n(Developer: add your Firebase project in src/cloud.js.)",
      starting: 'Connecting…',
      'signed-out': 'Not signed in. Progress is only saved on this device.',
      'signing-in': 'Signing in…',
      syncing: `Signed in as ${cloud.user ? cloud.user.name : ''}\nSyncing…`,
      restoring: 'Loading your cloud save…',
      synced: `Signed in as ${cloud.user ? cloud.user.name : ''}\n✓ Saved to the cloud ${ago}`,
      error: cloud.user ? `Signed in as ${cloud.user.name}\nLast synced ${ago}` : 'Not signed in.'
    };
    this.cloudStatus.textContent = lines[cloud.status] || '';
    this.cloudError.textContent = cloud.error;
    this.cloudError.style.display = cloud.error ? 'block' : 'none';

    const signedIn = Boolean(cloud.user);
    const busy = ['starting', 'signing-in', 'syncing', 'restoring'].includes(cloud.status);
    this.btnCloudSignIn.style.display = cloud.available && !signedIn ? '' : 'none';
    this.btnCloudSignIn.disabled = busy;
    this.btnCloudSync.style.display = signedIn ? '' : 'none';
    this.btnCloudSync.disabled = busy;
    this.btnCloudSignOut.style.display = signedIn ? '' : 'none';
    this.btnCloudSignOut.disabled = busy;
    this.btnCloudDelete.style.display = signedIn ? 'block' : 'none';
    this.btnCloudDelete.disabled = busy;
  }

  timeAgo(time) {
    const s = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(time).toLocaleDateString();
  }

  // ------------------------------------------------------------------ shop
  openShop() {
    if (this.player.isDowned) return;
    this.shopStatus = '';
    this.renderShop();
    this.shop.style.display = 'flex';
    this.setPaused(true);
  }

  closeShop() {
    this.shop.style.display = 'none';
    this.setPaused(false);
  }

  shopItemCard(item, prices) {
    const card = this.el('div', 'shop-item', '',
      this.el('span', 'item-icon', item.icon),
      this.el('span', '', item.name),
      this.el('span', 'item-rarity', `${RARITIES[item.rarity].label} · ${SLOTS[item.slot].label}`));
    this.setRarityVars(card, item.rarity);
    for (const [cur, amount] of Object.entries(prices)) {
      const price = { [cur]: amount };
      const btn = this.el('button', 'buy-btn', formatPrice(price));
      btn.disabled = !canAfford(this.collection.wallet, price);
      btn.addEventListener('click', () => this.buyAccessory(item, price));
      card.append(btn);
    }
    return card;
  }

  renderShop() {
    const w = this.collection.wallet;
    this.shopWallet.textContent = `🐾 ${w.pelts}   💎 ${w.crystals}`;
    const body = this.shopBody;
    body.replaceChildren();
    if (this.shopStatus) body.append(this.el('div', 'treasure-bonus shop-status', this.shopStatus));

    // Today's rotating offers
    const left = msUntilTomorrow();
    const hours = Math.floor(left / 3600000);
    const mins = Math.floor((left % 3600000) / 60000);
    body.append(this.el('div', 'shop-section-title', '', this.el('span', '', "Today's offers"), this.el('small', '', `New offers in ${hours}h ${mins}m`)));
    const d = this.collection.daily;
    const today = dayKey();
    const rerolls = d.rerollDay === today ? d.rerolls : 0;
    const offers = dailyOffers(this.collection.owned, today, rerolls);
    if (offers.length) {
      const grid = this.el('div', 'shop-grid');
      for (const item of offers) grid.append(this.shopItemCard(item, PRICES[item.rarity]));
      body.append(grid);
    } else {
      body.append(this.el('div', 'shop-empty', 'You own every accessory! New items are coming soon.'));
    }

    // Free stuff for watching an ad (only when an ad is ready)
    if (ads.canShowRewarded) {
      body.append(this.el('div', 'shop-section-title', '', this.el('span', '', '📺 Free with a short video'), this.el('small', '', 'Optional')));
      const adGrid = this.el('div', 'shop-grid');
      const chestUsed = d.bonusChestDay === today;
      adGrid.append(this.adCard('🎁', 'Bonus treasure chest', chestUsed ? 'Come back tomorrow' : 'A Rare-or-better chest, buried nearby', chestUsed, () => this.adBonusChest()));
      const refreshLeft = MAX_OFFER_REFRESHES - rerolls;
      adGrid.append(this.adCard('🔄', 'New shop offers', refreshLeft > 0 ? `${refreshLeft} left today` : 'Come back tomorrow', refreshLeft <= 0, () => this.adRefreshOffers()));
      body.append(adGrid);
    }

    // Coat colours
    const coatsForSale = COATS.filter((c) => c.price && !this.collection.coats.has(c.id));
    if (coatsForSale.length) {
      body.append(this.el('div', 'shop-section-title', '', this.el('span', '', '🎨 Coat colours'), this.el('small', '', 'Wear them from the Wardrobe')));
      const coatGrid = this.el('div', 'shop-grid');
      for (const coat of coatsForSale) {
        const card = this.el('div', 'shop-item', '', this.coatSwatch(coat), this.el('span', '', coat.name), this.el('span', 'item-rarity', 'Coat colour'));
        const btn = this.el('button', 'buy-btn', formatPrice(coat.price));
        btn.disabled = !canAfford(this.collection.wallet, coat.price);
        btn.addEventListener('click', () => this.buyCoat(coat));
        card.append(btn);
        coatGrid.append(card);
      }
      body.append(coatGrid);
    }

    // Premium: every Epic & Legendary item not owned yet, for Snow Crystals
    const premium = ACCESSORIES.filter((a) => PRICES[a.rarity].crystals && !this.collection.owned.has(a.id) && !offers.includes(a));
    if (premium.length) {
      body.append(this.el('div', 'shop-section-title', '', this.el('span', '', '💎 Crystal exclusives'), this.el('small', '', 'Always available')));
      const grid = this.el('div', 'shop-grid');
      for (const item of premium) grid.append(this.shopItemCard(item, { crystals: PRICES[item.rarity].crystals }));
      body.append(grid);
    }

    // Real-money products (disabled until Google Play Billing is connected)
    body.append(this.el('div', 'shop-section-title', '', this.el('span', '', 'Snow Crystals'), this.el('small', '', BILLING_ENABLED ? '' : 'Coming soon')));
    const grid = this.el('div', 'shop-grid');
    for (const product of PRODUCTS) {
      if (product.grants.removeAds && this.collection.removeAds) continue;
      if (product.oneTime && this.collection.starterPack) continue;
      const g = product.grants;
      const what = g.removeAds
        ? 'No more forced ads'
        : [g.pelts && `${g.pelts} 🐾`, g.crystals && `${g.crystals} 💎`, g.coat && `${COAT_BY_ID[g.coat].name} coat`].filter(Boolean).join(' + ');
      const card = this.el('div', 'shop-item', '',
        this.el('span', 'item-icon', product.icon),
        this.el('span', '', product.name),
        this.el('span', 'item-rarity', what));
      if (product.tag) card.append(this.el('span', 'tag', product.tag));
      const btn = this.el('button', 'buy-btn', BILLING_ENABLED ? product.price : 'Coming soon');
      btn.disabled = !BILLING_ENABLED;
      btn.addEventListener('click', () => this.buyProduct(product));
      card.append(btn);
      grid.append(card);
    }
    body.append(grid);
  }

  // ------------------------------------------------------------------ coats & ad rewards
  coatSwatch(coat) {
    const sw = this.el('span', 'coat-swatch', coat.icon);
    sw.style.background = `#${coat.tint.toString(16).padStart(6, '0')}`;
    return sw;
  }

  buyCoat(coat) {
    if (this.collection.coats.has(coat.id) || !canAfford(this.collection.wallet, coat.price)) return;
    for (const [cur, amount] of Object.entries(coat.price)) this.collection.wallet[cur] -= amount;
    this.collection.coats.add(coat.id);
    this.wearCoat(coat.id);
    this.updateWalletHUD();
    sounds.playTreasureFound();
    this.shopStatus = `✅ ${coat.icon} ${coat.name} coat bought and on! Change it any time in the Wardrobe.`;
    this.renderShop();
  }

  wearCoat(id) {
    if (!this.collection.coats.has(id)) return;
    this.collection.coat = id;
    this.player.setCoat(COAT_BY_ID[id].tint);
    writeCollection(this.collection);
  }

  adCard(icon, name, note, disabled, onClick) {
    const card = this.el('div', 'shop-item', '', this.el('span', 'item-icon', icon), this.el('span', '', name), this.el('span', 'item-rarity', note));
    const btn = this.el('button', 'buy-btn', '📺 Watch');
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    card.append(btn);
    return card;
  }

  // Shows a rewarded ad; resolves true if the player earned the reward
  async watchAd() {
    sounds.setSuspended(true);
    const earned = await ads.showRewarded();
    sounds.setSuspended(false);
    return earned;
  }

  async adBonusChest() {
    if (!(await this.watchAd())) return;
    this.collection.daily.bonusChestDay = dayKey();
    writeCollection(this.collection);
    if (this.treasures.spawn(this.player.position, { daily: true, minRarity: 'rare' })) {
      this.treasures.treasures[this.treasures.treasures.length - 1].bonus = true;
    }
    this.shopStatus = '🎁 A bonus chest is buried nearby! Use 👃 Scent to find it.';
    this.renderShop();
  }

  async adRefreshOffers() {
    if (!(await this.watchAd())) return;
    const d = this.collection.daily;
    const today = dayKey();
    d.rerolls = d.rerollDay === today ? d.rerolls + 1 : 1;
    d.rerollDay = today;
    writeCollection(this.collection);
    this.shopStatus = '🔄 New offers!';
    this.renderShop();
  }

  // After a kill worth a few Pelts, briefly offer to double them for a video (opt-in, rate-limited)
  afterKill(prey, pelts) {
    if (pelts < 10 || !ads.canShowRewarded) return;
    const now = performance.now();
    if (this.lastDoubleOffer && now - this.lastDoubleOffer < DOUBLE_PELTS_COOLDOWN * 1000) return;
    this.lastDoubleOffer = now;
    this.doublePelts = pelts;
    this.adOffer.querySelector('span').textContent = `📺 Double it: +${pelts} 🐾`;
    this.adOffer.classList.add('show');
    clearTimeout(this.adOfferTimer);
    this.adOfferTimer = setTimeout(() => this.adOffer.classList.remove('show'), 7000);
  }

  async claimDoublePelts() {
    this.adOffer.classList.remove('show');
    const pelts = this.doublePelts;
    this.doublePelts = 0;
    if (!pelts || !(await this.watchAd())) return;
    this.addCurrency({ pelts });
    this.announce(`📺 Thanks! +${pelts} 🐾`, '#fde68a');
  }

  buyAccessory(item, price) {
    if (this.collection.owned.has(item.id) || !canAfford(this.collection.wallet, price)) return;
    for (const [cur, amount] of Object.entries(price)) this.collection.wallet[cur] -= amount;
    this.collection.owned.add(item.id);
    this.collection.foundAt[item.id] = Date.now();
    writeCollection(this.collection);
    const milestones = this.claimMilestones();
    this.updateWardrobeCount();
    this.updateWalletHUD();
    sounds.playTreasureFound();
    this.shopStatus = [`✅ Bought ${item.icon} ${item.name}! Wear it from your Wardrobe.`]
      .concat(milestones.map((m) => (m.goldPrints ? '🐾 Collection complete! Golden paw prints unlocked!' : `📖 ${m.count} owned! Collection reward: ${m.label}`)))
      .join('\n');
    this.renderShop();
  }

  async buyProduct(product) {
    const grants = await purchase(product.id);
    if (!grants) return;
    if (grants.crystals || grants.pelts) this.addCurrency({ crystals: grants.crystals || 0, pelts: grants.pelts || 0 });
    if (grants.coat && COAT_BY_ID[grants.coat]) this.collection.coats.add(grants.coat);
    if (product.oneTime) this.collection.starterPack = true;
    if (grants.removeAds) this.collection.removeAds = true;
    writeCollection(this.collection);
    this.shopStatus = `✅ Thank you! ${product.name} added.`;
    this.renderShop();
  }

  setupLighting() {
    // Hemispherical Ambient Light (azure alpine sky + warm snow ground reflection)
    this.hemiLight = new THREE.HemisphereLight(0x9ec4ea, 0xe4ebf1, 0.95);
    this.scene.add(this.hemiLight);

    // Directional Alpine Sun Light with Crisp Shadows
    this.sunLight = new THREE.DirectionalLight(0xfff3dc, 2.3);
    this.sunLight.position.set(65, 85, 45);
    this.sunLight.castShadow = true;
    const shadowRes = this.isMobile ? 1024 : 2048;
    this.sunLight.shadow.mapSize.width = shadowRes;
    this.sunLight.shadow.mapSize.height = shadowRes;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 160;
    const shadowDist = 45;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.035;
    this.sunLight.shadow.radius = this.isMobile ? 1 : 2;
    this.scene.add(this.sunLight);

    // Cinematic Rim Light (back-light silhouetting feline and prey muscles/fur)
    this.rimLight = new THREE.DirectionalLight(0x9ec8f5, 0.7);
    this.rimLight.position.set(-50, 40, -40);
    this.scene.add(this.rimLight);
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
    this.questTitle = document.getElementById('quest-title');
    this.questDesc = document.getElementById('quest-desc');
    this.familyText = document.getElementById('family-text');
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

    // Death screen
    this.deathScreen = document.getElementById('death-screen');
    this.btnReviveAd = document.getElementById('btn-revive-ad');
    this.btnRespawn = document.getElementById('btn-respawn');
    this.btnReviveAd.addEventListener('click', () => this.reviveWithAd());
    this.btnRespawn.addEventListener('click', () => this.respawnAtCamp());

    // Ad consent options (only shown where privacy law requires it)
    this.btnAdPrivacy = document.getElementById('btn-ad-privacy');
    this.btnAdPrivacy.addEventListener('click', () => ads.showPrivacyOptions());

    this.btnNewGame = document.getElementById('btn-new-game');
    this.btnNewGame.addEventListener('click', () => this.startNewGame());

    // Treasure & wardrobe
    this.btnDig = document.getElementById('btn-dig');
    this.btnAct = document.getElementById('btn-act');
    this.adOffer = document.getElementById('ad-offer');
    this.adOffer.addEventListener('click', () => this.claimDoublePelts());
    this.actIcon = document.getElementById('act-icon');
    this.actLabel = document.getElementById('act-label');
    this.restOverlay = document.getElementById('rest-overlay');
    this.worldText = document.getElementById('world-text');
    this.camoBadge = document.getElementById('camo-badge');
    this.denRadarText = document.getElementById('den-radar-text');
    this.treasurePopup = document.getElementById('treasure-popup');
    this.treasureCard = document.getElementById('treasure-card');
    this.treasureIcon = document.getElementById('treasure-icon');
    this.treasureName = document.getElementById('treasure-name');
    this.treasureRarity = document.getElementById('treasure-rarity');
    document.getElementById('btn-treasure-wear').addEventListener('click', () => this.hideTreasurePopup(true));
    document.getElementById('btn-treasure-close').addEventListener('click', () => this.hideTreasurePopup(false));

    this.wardrobe = document.getElementById('wardrobe');
    this.wardrobeSlots = document.getElementById('wardrobe-slots');
    this.wardrobeProgress = document.getElementById('wardrobe-progress');
    this.wardrobeCount = document.getElementById('wardrobe-count');
    this.wardrobeWear = document.getElementById('wardrobe-wear');
    this.wardrobeBook = document.getElementById('wardrobe-book');
    this.treasureBonus = document.getElementById('treasure-bonus');
    this.treasureTitle = this.treasureCard.querySelector('.treasure-title');

    // Wallet, shop & daily reward
    this.hudPelts = document.getElementById('hud-pelts');
    this.hudCrystals = document.getElementById('hud-crystals');
    this.dailyStashText = document.getElementById('daily-stash-text');
    this.shop = document.getElementById('shop');
    this.shopBody = document.getElementById('shop-body');
    this.shopWallet = document.getElementById('shop-wallet');
    document.getElementById('btn-shop').addEventListener('click', () => this.openShop());
    document.getElementById('btn-shop-close').addEventListener('click', () => this.closeShop());
    this.shop.addEventListener('click', (e) => {
      if (e.target === this.shop) this.closeShop();
    });
    this.dailyPopup = document.getElementById('daily-popup');
    this.dailyDay = document.getElementById('daily-day');
    this.dailyStrip = document.getElementById('daily-strip');
    this.dailyNote = document.getElementById('daily-note');
    document.getElementById('btn-daily-claim').addEventListener('click', () => this.claimDailyReward());

    this.cloudPanel = document.getElementById('cloud-panel');
    this.btnCloud = document.getElementById('btn-cloud');
    this.cloudBadge = document.getElementById('cloud-badge');
    this.cloudStatus = document.getElementById('cloud-status');
    this.cloudError = document.getElementById('cloud-error');
    this.btnCloudSignIn = document.getElementById('btn-cloud-signin');
    this.btnCloudSync = document.getElementById('btn-cloud-sync');
    this.btnCloudSignOut = document.getElementById('btn-cloud-signout');
    this.btnCloudDelete = document.getElementById('btn-cloud-delete');
    this.btnCloudDelete.addEventListener('click', () => {
      if (window.confirm('Delete your cloud save and sign-in account? Progress on this device is kept, but the copy in the cloud is gone for good.')) cloud.deleteAccount();
    });
    this.btnCloud.addEventListener('click', () => this.openCloud());
    document.getElementById('btn-cloud-close').addEventListener('click', () => this.closeCloud());
    this.cloudPanel.addEventListener('click', (e) => {
      if (e.target === this.cloudPanel) this.closeCloud();
    });
    this.btnCloudSignIn.addEventListener('click', () => cloud.signIn());
    this.btnCloudSync.addEventListener('click', () => cloud.sync());
    this.btnCloudSignOut.addEventListener('click', () => {
      if (window.confirm('Sign out? Your progress stays saved in your Google account, and this device will start fresh until you sign in again.')) cloud.signOut();
    });
    this.treasureRadarText = document.getElementById('treasure-radar-text');
    for (const btn of this.wardrobe.querySelectorAll('.wardrobe-tab')) {
      btn.addEventListener('click', () => this.showWardrobeTab(btn.dataset.tab));
    }
    document.getElementById('btn-wardrobe').addEventListener('click', () => this.openWardrobe());
    document.getElementById('btn-wardrobe-close').addEventListener('click', () => this.closeWardrobe());
    // Tapping the dimmed background closes the wardrobe too
    this.wardrobe.addEventListener('click', (e) => {
      if (e.target === this.wardrobe) this.closeWardrobe();
    });

    // Difficulty buttons
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.setDifficulty(btn.dataset.diff);
      });
    });
  }

  showDeathScreen() {
    this.updateHUD();
    this.btnReviveAd.style.display = ads.canShowRewarded ? 'block' : 'none';
    this.setDeathButtonsDisabled(false);
    this.deathScreen.style.display = 'flex';
  }

  hideDeathScreen() {
    this.deathScreen.style.display = 'none';
    this.clearActionRequests();
  }

  setDeathButtonsDisabled(disabled) {
    this.btnReviveAd.disabled = disabled;
    this.btnRespawn.disabled = disabled;
  }

  async reviveWithAd() {
    this.setDeathButtonsDisabled(true);
    sounds.setSuspended(true);
    const earned = await ads.showRewarded();
    sounds.setSuspended(false);

    if (!earned) {
      // Ad was skipped or failed: only the camp option remains
      this.btnReviveAd.style.display = 'none';
      this.setDeathButtonsDisabled(false);
      return;
    }

    this.player.reviveHere();
    this.saveGame();
    // Give the leopard a moment before a nearby boss can ram again
    for (const p of this.preyManager.preyList) {
      if (p.isBoss) p.chargeCooldown = Math.max(p.chargeCooldown, 3);
    }
    this.hideDeathScreen();
    this.spawnFloatingText('REVIVED! Full Strength', '#22c55e', this.getScreenCoords(this.player.position));
  }

  async respawnAtCamp() {
    this.setDeathButtonsDisabled(true);
    sounds.setSuspended(true);
    if (!this.collection.removeAds) await ads.maybeShowInterstitial();
    sounds.setSuspended(false);
    this.player.respawnAtCamp();
    this.hideDeathScreen();
    this.saveGame();
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
    this.showBanner('Level Up!', `Level ${level} Reached! Max HP, Stamina, and Attack Boosted!`);
  }

  showBanner(title, details) {
    if (!this.levelUpBanner) return;
    this.levelUpBanner.querySelector('h2').textContent = title;
    this.levelUpDetails.innerText = details;
    this.levelUpBanner.style.display = 'block';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.levelUpBanner.style.display = 'none';
    }, 2800);
  }

  getScreenCoords(worldPos) {
    const v = worldPos.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(v.y * 0.5) + 0.5) * window.innerHeight;
    return { x, y };
  }

  // Hits the first living prey within range and in front of the leopard. Returns true on a hit.
  strikeNearbyPrey(range, minDot, damageMult, damageSpread, label, color) {
    const forward = new THREE.Vector3(Math.sin(this.player.facingAngle), 0, Math.cos(this.player.facingAngle));
    const toPrey = new THREE.Vector3();

    for (const prey of this.targets()) {
      if (prey.isDead || prey.hidden || prey.airborne) continue;
      toPrey.subVectors(prey.position, this.player.position);
      const dist = toPrey.length();
      if (dist >= range || forward.dot(toPrey.divideScalar(dist || 1)) <= minDot) continue;

      const damage = Math.round(this.player.attackPower * damageMult * (damageSpread + Math.random() * 0.25));
      prey.takeDamage(damage);
      buzz(HAPTIC.hit);

      const screenPos = this.getScreenCoords(prey.position);
      this.spawnFloatingText(`${label}! -${damage} HP`, color, screenPos);

      if (prey.isDead) this.onPreyKilled(prey, screenPos);
      else if (label !== 'SWIPE' && !prey.isBoss && !prey.isPredator) {
        // A pounce that doesn't kill pins the animal: finish it with a throat bite
        prey.pinnedTimer = 2.2;
        prey.updateSprite('🦷', '#dc2626');
        this.pinnedPrey = prey;
      }
      return true;
    }
    return false;
  }

  // Rewards and bookkeeping for every kill, however it was made
  onPreyKilled(prey, screenPos = this.getScreenCoords(prey.position), how = '') {
    buzz(HAPTIC.kill);
    this.tutorial.notify('kill');
    if (prey === this.pinnedPrey) this.pinnedPrey = null;
    this.player.preyHunted += 1;
    const pelts = PREY_PELTS[prey.type] || 0;
    const tag = prey.isBoss ? ' 👑 BOSS SLAIN!' : how;
    this.spawnFloatingText(`+${prey.xpReward} XP  +${pelts} 🐾${tag}`, '#a855f7', { x: screenPos.x, y: screenPos.y - 30 });
    this.player.addXp(prey.xpReward);
    this.addCurrency({ pelts });
    this.questEvent(`kill:${prey.type}`);
    if (!prey.isPredator && !prey.cfg.livestock) this.questEvent('kill');
    if (prey.isPredator && prey.type === 'wolf') this.questEvent('wolfDefeat');
    if (this.player.camo > 0.6 || this.killWasHidden) this.questEvent('camoKill');
    if (this.world.isTwilight) this.questEvent('twilightKill');
    if (env.blizzard > 0.5) this.questEvent('blizzardKill');
    this.killWasHidden = false;
    this.lastKill = { prey, at: performance.now(), pelts };
    if (this.afterKill) this.afterKill(prey, pelts);
    this.saveGame();
  }

  // Quest progress hook (quests.js)
  questEvent(name, amount = 1) {
    if (this.quests) this.quests.event(name, amount);
  }

  throatBite(prey) {
    if (!this.player.throatBite(prey)) return;
    buzz(HAPTIC.bite);
    prey.pinnedTimer = 1.2; // held fast while the bite lands
    setTimeout(() => {
      if (prey.isDead) return;
      prey.takeDamage(prey.hp + 1);
      this.spawnFloatingText('🦷 THROAT BITE!', '#f87171', this.getScreenCoords(prey.position));
      this.questEvent('bite');
      this.onPreyKilled(prey);
    }, 450);
  }

  checkPounceAttack() {
    // When Snow Leopard is pouncing, hit detection runs forward in leap arc (one hit per pounce)
    if (!this.player.isPouncing) {
      this.pounceHasHit = false;
      return;
    }
    if (this.pounceHasHit) return;

    // Heavy burst damage; a leap down from a ledge (ambush) hits far harder
    const ambush = this.player.isAmbush;
    this.killWasHidden = this.player.camo > 0.6 || this.pounceStartCamo > 0.6;
    this.pounceHasHit = ambush
      ? this.strikeNearbyPrey(5.2, 0.3, 2.8, 0.95, '🏔️ AMBUSH', '#f97316')
      : this.strikeNearbyPrey(4.4, 0.35, 1.8, 0.95, 'POUNCE', '#ef4444');
    if (this.pounceHasHit && ambush) this.questEvent('ambush');
    if (this.pounceHasHit) this.tutorial.notify('pounceHit');
  }

  checkSwipeAttack() {
    if (!this.input.isSwipeRequested) return;
    this.input.isSwipeRequested = false;

    // Trigger leopard claw swipe animation & sound
    if (!this.player.pawSwipe()) return;

    // Close-range melee: fast, lower damage
    this.strikeNearbyPrey(3.4, 0.2, 0.65, 0.9, 'SWIPE', '#f59e0b');
  }

  setText(el, text) {
    this.setStyle(el, 'textContent', text);
  }

  // Writes a style property (or 'textContent') only when its value changed since last frame
  setStyle(el, prop, value) {
    if (!el) return;
    let cache = this.hudCache.get(el);
    if (!cache) {
      cache = {};
      this.hudCache.set(el, cache);
    }
    if (cache[prop] === value) return;
    cache[prop] = value;
    if (prop === 'textContent') el.textContent = value;
    else el.style[prop] = value;
  }

  setBarWidth(el, value, max) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    this.setStyle(el, 'width', `${pct.toFixed(1)}%`);
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

    if (nearestCarcass) {
      this.setStyle(this.btnEat, 'display', 'flex');
      // Feed action requested
      if (this.input.isEatRequested) {
        this.input.isEatRequested = false;
        const kgBefore = this.player.meatConsumed;
        const fed = this.player.eat(nearestCarcass);
        if (fed) {
          this.questEvent('eat', this.player.meatConsumed - kgBefore);
          this.family.onEat();
          const screenPos = this.getScreenCoords(this.player.position);
          this.spawnFloatingText(`+Meat! Hunger Restored`, '#22c55e', screenPos);
          this.tutorial.notify('eat');
          this.saveGame();
        }
      }
    } else {
      this.setStyle(this.btnEat, 'display', 'none');
      this.input.isEatRequested = false;
    }

    // Dig up buried treasure (the carcass takes priority when both are in reach)
    const treasure = nearestCarcass ? null : this.nearTreasure;
    this.setStyle(this.btnDig, 'display', treasure ? 'flex' : 'none');
    if (treasure && this.input.isDigRequested) this.digTreasure(treasure);
    this.input.isDigRequested = false;

    // Pounce input request (remember whether it was launched from hiding)
    if (this.input.isPounceRequested) {
      this.input.isPounceRequested = false;
      const camo = this.player.camo;
      if (this.player.pounce()) this.pounceStartCamo = camo;
    }

    // Scent vision input request
    if (this.input.isScentRequested) {
      this.input.isScentRequested = false;
      this.scentVision.toggle(this.player.position);
    }
  }

  updateHUD() {
    const player = this.player;

    // Stat Bars
    this.setBarWidth(this.barHp, player.hp, player.maxHp);
    this.setBarWidth(this.barStamina, player.stamina, player.maxStamina);
    this.setBarWidth(this.barHunger, player.hunger, player.maxHunger);
    this.setBarWidth(this.barXp, player.xp, player.xpToNext);
    this.setText(this.hudLevel, `Lv ${player.level}`);
    this.setStyle(this.camoBadge, 'opacity', player.camo > 0.6 ? '1' : '0');

    // Level up check
    if (player.level > this.lastLevelSeen) {
      this.lastLevelSeen = player.level;
      this.showLevelUpBanner(player.level);
      buzz(HAPTIC.levelUp);
    }

    // Toggle button UI active states
    if (this.btnStalk) this.btnStalk.classList.toggle('active', player.isStalking);
    if (this.btnSprint) this.btnSprint.classList.toggle('active', player.isSprinting);

    // Compass Cardinal Heading
    const camAngle = ((this.gameCam.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.round((camAngle / (Math.PI * 2)) * 8) % 8;
    this.setText(this.compassHeading, COMPASS_HEADINGS[idx]);

    // Boss Yak Health Bar HUD (displays when near living boss)
    const { prey: boss, distance: bossDist } = this.preyManager.getNearestLiving(player.position, true);
    if (boss && bossDist < 48) {
      this.setStyle(this.bossHud, 'display', 'flex');
      this.setBarWidth(this.bossBarFill, boss.hp, boss.maxHp);
      this.setText(this.bossHpLabel, `${Math.max(0, boss.hp)} / ${boss.maxHp} HP`);
    } else {
      this.setStyle(this.bossHud, 'display', 'none');
    }

    // Nearest Prey Scent Radar
    const { prey, distance } = this.preyManager.getNearestLiving(player.position);
    if (prey) {
      const name = prey.isBoss ? '👑 Titan Crag Yak (BOSS)' : prey.isPredator ? `⚠️ ${prey.name}` : prey.name;
      this.setText(this.preyRadarText, `Scent: ${name} (${Math.round(distance)}m)`);
      this.setStyle(this.preyRadarText, 'color', prey.isBoss ? '#fbbf24' : prey.isPredator ? '#fb923c' : '#38bdf8');
    } else {
      this.setText(this.preyRadarText, 'All nearby prey hunted');
      this.setStyle(this.preyRadarText, 'color', '#94a3b8');
    }

    // Daily stash chests still buried today
    const stashLeft = this.treasures.dailyRemaining;
    this.setStyle(this.dailyStashText, 'display', stashLeft ? 'block' : 'none');
    if (stashLeft) this.setText(this.dailyStashText, `🎁 Daily stash: ${stashLeft} chest${stashLeft > 1 ? 's' : ''} left`);

    // Treasure revealed by Scent Vision
    const revealed = this.treasures.nearestRevealed;
    this.setStyle(this.treasureRadarText, 'display', revealed ? 'block' : 'none');
    if (revealed) {
      this.setText(this.treasureRadarText, `✨ ${RARITIES[revealed.treasure.rarity].label} treasure (${Math.round(revealed.distance)}m)`);
      this.setStyle(this.treasureRadarText, 'color', RARITIES[revealed.treasure.rarity].color);
    }

    // Time of day & weather; point to the nearest den at night or when hurt
    this.setText(this.worldText, this.world.label());
    const wantDen = this.world.isNight || player.hp < player.maxHp * 0.4;
    const { den, distance: denDist } = this.terrain.nearestDen(player.position);
    const showDen = wantDen && den && denDist > 5;
    this.setStyle(this.denRadarText, 'display', showDen ? 'block' : 'none');
    if (showDen) this.setText(this.denRadarText, `💤 Den (${Math.round(denDist)}m)`);

    // Family status (mate / cubs) under the quest
    const fam = this.family.label();
    this.setStyle(this.familyText, 'display', fam ? 'block' : 'none');
    if (fam) {
      this.setText(this.familyText, fam.text);
      this.setStyle(this.familyText, 'color', fam.warn ? '#f87171' : '#f9a8d4');
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(pixelRatioFor(detectMobile()));
  }

  animate() {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // World is frozen while the death screen or a menu is up
    if (this.player.isDowned || this.isPaused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 1. Get input
    const moveVec = this.input.getMovementVector();

    // 2. Update Snow Leopard Player
    this.player.update(delta, moveVec, this.input.isSprinting, this.input.isStalking);

    // Dynamic Paw Print Tracks on snow
    if (this.player.currentSpeed > 1.2) {
      this.stepTimer = (this.stepTimer || 0) + delta;
      const interval = this.player.isSprinting ? 0.12 : 0.22;
      if (this.stepTimer > interval) {
        this.stepTimer = 0;
        this.terrain.addPawPrint(this.player.position.x, this.player.position.z, this.player.facingAngle, this.player.isSprinting ? 1.7 : 1.35);
      }
    }

    // 3. Sun / moon and sky follow the clock; the light stays centred on the player for sharp shadows
    this.world.update(delta, this.player.position);
    this.sunLight.target.position.copy(this.player.position);
    this.sunLight.target.updateMatrixWorld();

    if (this.rimLight) {
      this.rimLight.position.set(this.player.position.x - 50, 40, this.player.position.z - 40);
      this.rimLight.target.position.copy(this.player.position);
      this.rimLight.target.updateMatrixWorld();
    }

    // 3b. Buried treasure glimmer & proximity
    this.nearTreasure = this.treasures.update(delta, this.player.position, {
      active: this.scentVision.isActive,
      radius: this.scentVision.sonarRadius
    });

    // 4. Update Prey AI
    this.preyManager.update(delta, this.player);

    // 5. Check Pounce Attack Hitbox
    this.checkPounceAttack();

    // 5b. Check Paw Swipe Attack Melee Hitbox
    this.checkSwipeAttack();

    // 6. Update Interactions (Feed carcass, toggles)
    this.updateInteractionPrompts();
    this.updateContextAction();
    this.updateDrag(delta);
    this.territory.update(delta);
    this.family.update(delta);
    this.scavengers.update(delta, this.preyManager.preyList, this.player.position);

    // 7. Update Scent Vision Trails & Pulse
    this.scentVision.update(delta, this.player.position, this.preyManager.preyList, this.camera.position);

    // 8. Update Camera Follow & Collision
    this.gameCam.update(delta, this.player.position, this.player.isSprinting, this.player.isPouncing, this.player.isStalking);

    // 9. Update Weather (blowing mountain snow particles)
    this.terrain.update(delta, this.player.position);

    // 10. Update UI HUD
    this.updateHUD();
    this.tutorial.update(delta);

    // Render Scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Start Game on window load
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  if (import.meta.env.DEV) {
    // Handy for debugging in the browser console
    window.__game = game;
    window.__cloud = cloud;
    window.__ads = ads;
  }
});
