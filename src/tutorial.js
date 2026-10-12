// ---------------------------------------------------------------------------
// First-run tutorial: one hint at a time in a banner above the controls. Each
// step finishes when the player actually does the thing, so nothing blocks play.
// Shown once for brand-new players; "Replay tutorial" in Settings restarts it.
// ---------------------------------------------------------------------------
const DONE_KEY = 'snowLeopardWorld.tutorialDone';

const touch = () => window.matchMedia('(pointer: coarse)').matches;

// text: [touch, keyboard]
const STEPS = [
  { id: 'move', text: ['Drag on the left side of the screen to walk.', 'Use W A S D to walk.'], done: (g, s) => s.moved > 8 },
  { id: 'look', text: ['Drag on the right side to look around.', 'Drag with the mouse to look around.'], done: (g, s) => s.turned > 1.2 },
  { id: 'scent', text: ['Tap 👃 Scent to sniff out nearby prey.', 'Press V to sniff out nearby prey.'], done: (g) => g.scentVision.isActive },
  { id: 'stalk', text: ['Tap 🐾 Stalk to creep up quietly. Prey hears and sees you less.', 'Press C to stalk. Prey hears and sees you less.'], done: (g, s) => s.stalkTime > 1 },
  { id: 'pounce', text: ['Follow the scent trail, get close, then tap 💥 Pounce.', 'Follow the scent trail, get close, then press Space to pounce.'], event: 'pounceHit' },
  { id: 'finish', text: ['Pinned it! Tap 🦷 Bite for a throat bite, or 🐾 Swipe.', 'Pinned it! Press R for a throat bite, or Q to swipe.'], event: 'kill' },
  { id: 'eat', text: ['Tap 🍖 Eat to fill your hunger bar.', 'Press E to eat and fill your hunger bar.'], event: 'eat' },
  { id: 'done', text: ['Great hunting! The card at the top right shows your next goal.', 'Great hunting! The card at the top right shows your next goal.'], timeout: 6 }
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.banner = document.getElementById('hint-banner');
    this.textEl = document.getElementById('hint-text');
    document.getElementById('btn-hint-skip').addEventListener('click', () => this.finish());
    this.active = false;
  }

  static isDone() {
    try {
      return localStorage.getItem(DONE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  start() {
    this.active = true;
    this.index = -1;
    this.next();
  }

  next() {
    this.index++;
    const step = STEPS[this.index];
    if (!step) {
      this.finish();
      return;
    }
    const g = this.game;
    this.state = { moved: 0, turned: 0, stalkTime: 0, time: 0, lastPos: g.player.position.clone(), lastYaw: g.gameCam.yaw, event: false };
    this.textEl.textContent = step.text[touch() ? 0 : 1];
    // restart the pop-in animation
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  // Called by the game when something happens (pounceHit, kill, eat, ...)
  notify(event) {
    if (!this.active) return;
    const step = STEPS[this.index];
    if (step && step.event === event) this.state.event = true;
  }

  update(delta) {
    if (!this.active) return;
    const g = this.game;
    const s = this.state;
    const step = STEPS[this.index];
    s.time += delta;
    s.moved += g.player.position.distanceTo(s.lastPos);
    s.lastPos.copy(g.player.position);
    s.turned += Math.abs(g.gameCam.yaw - s.lastYaw);
    s.lastYaw = g.gameCam.yaw;
    if (g.player.isStalking) s.stalkTime += delta;

    const done = step.event ? s.event : step.timeout ? s.time > step.timeout : step.done(g, s);
    if (done) this.next();
  }

  finish() {
    this.active = false;
    this.banner.classList.remove('show');
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch (e) {
      // Storage unavailable: the tutorial may show again next launch
    }
  }

  replay() {
    try {
      localStorage.removeItem(DONE_KEY);
    } catch (e) {
      // ignore
    }
    this.start();
  }
}
