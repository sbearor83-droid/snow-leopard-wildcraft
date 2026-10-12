import { sounds } from './audio.js';
import { LeopardNPC } from './npc.js';

// ---------------------------------------------------------------------------
// Family: call for a mate at dusk or night (snow leopards yowl in mating
// season), stay close until you bond, then rest in a den to give birth. Cubs
// follow you, need feeding (eat near them) and grow a little every day they
// are fed. After CUB_DAYS days they are grown and leave to find their own range.
// ---------------------------------------------------------------------------
const MIN_LEVEL = 3;
const BOND_SECONDS = 22;
export const CUB_DAYS = 6;
const CUB_SLOTS = [[-1.6, -2.6], [1.6, -2.8], [0, -4.2]];

export class Family {
  constructor(game) {
    this.game = game;
    this.state = 'none'; // none | calling | courting | expecting | cubs
    this.mate = null;
    this.cubs = [];
    this.cubAge = 0;
    this.cubHunger = 80;
    this.bond = 0;
    this.callCooldown = 0;
    this.mewTimer = 8;
  }

  canCall() {
    const g = this.game;
    return this.state === 'none' && this.callCooldown <= 0 && g.player.level >= MIN_LEVEL && (g.world.isNight || g.world.phase === 'dusk');
  }

  callForMate() {
    const g = this.game;
    this.state = 'calling';
    this.callCooldown = 40;
    sounds.playYowl();
    g.announce('📣 Your call echoes across the valley…', '#fbcfe8');
    setTimeout(() => {
      if (this.state !== 'calling') return;
      const p = g.player.position;
      const a = Math.random() * Math.PI * 2;
      this.mate = new LeopardNPC(g.scene, g.terrain, g.player, { size: 0.95, tint: 0xfff4e8, x: p.x + Math.cos(a) * 55, z: p.z + Math.sin(a) * 55 });
      this.mate.setMarker('❤️', '#9d174d');
      this.state = 'courting';
      this.bond = 0;
      sounds.playYowl();
      g.announce('❤️ A snow leopard answers! Go and meet it.', '#f9a8d4');
    }, 4500);
  }

  // Cubs are born when the leopard rests in a den while expecting
  onRest(den) {
    if (this.state !== 'expecting') return;
    const count = Math.random() < 0.5 ? 2 : 3;
    this.spawnCubs(count, den.mouth.x, den.mouth.z);
    this.cubAge = 0;
    this.cubHunger = 80;
    this.state = 'cubs';
    sounds.playCubMew();
    this.game.announce(`🍼 ${count} cubs are born! They follow you. Eat near them to feed them.`, '#fbcfe8');
  }

  spawnCubs(count, x, z) {
    const g = this.game;
    for (let i = 0; i < count; i++) {
      const cub = new LeopardNPC(g.scene, g.terrain, g.player, { size: this.cubSize(), tint: 0xffffff, x: x + i, z: z + i * 0.5 });
      this.cubs.push(cub);
    }
  }

  cubSize() {
    return 0.36 + (this.cubAge / CUB_DAYS) * 0.38;
  }

  // The leopard just ate: cubs nearby share the meal
  onEat() {
    if (this.state !== 'cubs') return;
    const p = this.game.player.position;
    if (this.cubs.some((c) => c.position.distanceTo(p) < 16)) {
      this.cubHunger = Math.min(100, this.cubHunger + 30);
      sounds.playCubMew();
    }
  }

  onNewDay() {
    const g = this.game;
    if (this.state !== 'cubs') return;
    if (this.cubHunger < 25) {
      g.announce('🍼 Your cubs were too hungry to grow. Feed them!', '#fca5a5');
      return;
    }
    this.cubAge++;
    if (this.cubAge >= CUB_DAYS) {
      for (const c of this.cubs) c.destroy();
      this.cubs = [];
      this.state = 'none';
      g.player.addXp(400);
      g.addCurrency({ pelts: 150 });
      g.questEvent('cubsRaised');
      g.announce('🐆 Your cubs are grown and leave to claim their own range! +400 XP +150 🐾', '#86efac');
      return;
    }
    for (const c of this.cubs) c.setSize(this.cubSize());
    g.announce(`🍼 Your cubs are growing (day ${this.cubAge} of ${CUB_DAYS}).`, '#fbcfe8');
  }

  update(delta) {
    const g = this.game;
    const p = g.player;
    if (this.callCooldown > 0) this.callCooldown -= delta;

    if (this.state === 'courting' && this.mate) {
      const m = this.mate;
      const d = m.position.distanceTo(p.position);
      if (d > 6) m.goTo(p.position.x, p.position.z, d > 25 ? 9 : 4.5);
      else {
        m.targetSpeed = 0;
        m.targetFacing = Math.atan2(p.position.x - m.position.x, p.position.z - m.position.z);
      }
      if (d < 12) {
        if (this.bond === 0) sounds.playChuff();
        this.bond += delta;
      }
      m.update(delta);
      if (this.bond >= BOND_SECONDS) {
        sounds.playChuff();
        this.state = 'expecting';
        g.questEvent('mate');
        g.announce('💞 Bonded! Rest in a den to give birth to cubs.', '#f9a8d4');
        this.mateLeaving = 10;
        m.setMarker('', '');
      } else if (g.world.phase === 'day') {
        g.announce('The other leopard wandered off at daybreak. Try again at dusk.', '#cbd5e1');
        this.mateLeaving = 8;
        this.state = 'none';
      }
    } else if (this.mate && this.mateLeaving !== undefined) {
      const m = this.mate;
      const away = Math.atan2(m.position.x - p.position.x, m.position.z - p.position.z);
      m.goTo(m.position.x + Math.sin(away) * 30, m.position.z + Math.cos(away) * 30, 5);
      m.update(delta);
      this.mateLeaving -= delta;
      if (this.mateLeaving <= 0) {
        m.destroy();
        this.mate = null;
        this.mateLeaving = undefined;
      }
    }

    if (this.state === 'cubs') {
      this.cubHunger = Math.max(0, this.cubHunger - delta * 0.12);
      const sin = Math.sin(p.facingAngle), cos = Math.cos(p.facingAngle);
      this.cubs.forEach((c, i) => {
        const [lx, lz] = CUB_SLOTS[i % CUB_SLOTS.length];
        const tx = p.position.x + lx * cos + lz * sin;
        const tz = p.position.z + lz * cos - lx * sin;
        const d = Math.hypot(tx - c.position.x, tz - c.position.z);
        if (d > 90) c.position.set(tx, c.position.y, tz); // caught up off-screen
        c.goTo(tx, tz, d > 12 ? 13 : d > 3 ? Math.max(3, p.currentSpeed) : 0);
        if (d <= 1.5) c.targetFacing = p.facingAngle;
        c.update(delta, p.isStalking);
      });
      this.mewTimer -= delta;
      if (this.mewTimer <= 0) {
        this.mewTimer = this.cubHunger < 25 ? 6 : 20 + Math.random() * 20;
        sounds.playCubMew();
      }
    }
  }

  label() {
    if (this.state === 'cubs') {
      const hungry = this.cubHunger < 25;
      return { text: `🍼 Cubs ×${this.cubs.length} · day ${this.cubAge}/${CUB_DAYS} · ${hungry ? 'HUNGRY!' : `fed ${Math.round(this.cubHunger)}%`}`, warn: hungry };
    }
    if (this.state === 'courting') return { text: `❤️ Bonding ${Math.min(100, Math.round((this.bond / BOND_SECONDS) * 100))}%`, warn: false };
    if (this.state === 'expecting') return { text: '💞 Expecting cubs: rest in a den', warn: false };
    return null;
  }

  serialize() {
    const state = this.state === 'cubs' || this.state === 'expecting' ? this.state : 'none';
    return { s: state, n: this.cubs.length, a: this.cubAge, h: Math.round(this.cubHunger) };
  }

  restore(data) {
    if (!data) return;
    if (data.s === 'expecting') this.state = 'expecting';
    if (data.s === 'cubs' && Number.isInteger(data.n) && data.n > 0) {
      this.cubAge = Math.max(0, Math.min(CUB_DAYS - 1, data.a | 0));
      this.cubHunger = Number.isFinite(data.h) ? data.h : 60;
      const p = this.game.player.position;
      this.spawnCubs(Math.min(3, data.n), p.x - 2, p.z - 2);
      this.state = 'cubs';
    }
  }
}
