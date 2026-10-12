// ---------------------------------------------------------------------------
// Quest chain: a guided path through everything a snow leopard does, shown on
// the card at the top right. After the chain, endless "Wild challenges".
// The game reports events (kill, kill:<type>, eat <kg>, mark, cache, ambush,
// bite, camoKill, twilightKill, blizzardKill, rest, wolfDefeat, rivalDefeat,
// mate, cubsRaised); the active quest counts the one it wants.
// ---------------------------------------------------------------------------
export const QUESTS = [
  { title: 'First Hunt', desc: 'Bring down any prey. Use 👃 Scent to find it.', event: 'kill', count: 1, xp: 50, pelts: 30 },
  { title: 'Fill Your Belly', desc: 'Eat 40 kg of meat from your kills.', event: 'eat', count: 40, xp: 60, pelts: 30 },
  { title: 'Ghost of the Mountains', desc: 'Hold still by a boulder until you are 👻 Hidden, then pounce on prey.', event: 'camoKill', count: 1, xp: 80, pelts: 40 },
  { title: 'Blue Sheep', desc: 'Hunt 2 bharal (blue sheep), the snow leopard\'s favourite prey. They flee uphill.', event: 'kill:bharal', count: 2, xp: 100, pelts: 50 },
  { title: 'The Killing Bite', desc: 'Pin prey with a pounce, then tap 🦷 Bite for the throat bite.', event: 'bite', count: 1, xp: 80, pelts: 40 },
  { title: 'Mark Your Range', desc: 'Scent-mark 3 boulders (🐾 Mark). Your territory pays Pelts every dawn.', event: 'mark', count: 3, xp: 80, pelts: 40 },
  { title: 'From Above', desc: 'Pounce down onto prey from a ledge or steep slope for an ambush.', event: 'ambush', count: 1, xp: 100, pelts: 50 },
  { title: 'Save It for Later', desc: 'Drag a kill (🦴) next to a rock or tree and cache it so scavengers can\'t find it.', event: 'cache', count: 1, xp: 80, pelts: 40 },
  { title: 'Burrow Watch', desc: 'Catch a marmot before it dives into its burrow.', event: 'kill:marmot', count: 1, xp: 70, pelts: 35 },
  { title: 'Rest Easy', desc: 'Rest in a den (💤). The compass points to one at night or when you are hurt.', event: 'rest', count: 1, xp: 60, pelts: 30 },
  { title: 'Twilight Hunter', desc: 'Make a kill at dawn or dusk, when snow leopards hunt best.', event: 'twilightKill', count: 1, xp: 100, pelts: 50 },
  { title: 'Pack Trouble', desc: 'Defeat a grey wolf. Wolves are braver in a pack, so pick them off.', event: 'wolfDefeat', count: 1, xp: 120, pelts: 60 },
  { title: 'Defend Your Ground', desc: 'Drive off a rival snow leopard. Rivals come once you hold 3 marked boulders.', event: 'rivalDefeat', count: 1, xp: 150, pelts: 75 },
  { title: "A Mate's Call", desc: 'At dusk or night, tap 📣 Call. Stay close to your mate until you bond.', event: 'mate', count: 1, xp: 150, pelts: 75 },
  { title: 'Raising Cubs', desc: 'Rest in a den to give birth, then feed your cubs (eat near them) until they are grown.', event: 'cubsRaised', count: 1, xp: 300, pelts: 150 },
  { title: 'Titan Slayer', desc: 'Defeat a Titan Crag Yak, the giant of the high crags.', event: 'kill:yak', count: 1, xp: 250, pelts: 120 }
];

const CHALLENGES = [
  { title: 'Wild challenge: Bharal season', desc: 'Hunt 3 bharal.', event: 'kill:bharal', count: 3 },
  { title: 'Wild challenge: Swift paws', desc: 'Catch 2 snow hares.', event: 'kill:hare', count: 2 },
  { title: 'Wild challenge: Grounded', desc: 'Catch a snowcock before it takes off.', event: 'kill:snowcock', count: 1 },
  { title: 'Wild challenge: Pika patrol', desc: 'Catch a pika before it hides.', event: 'kill:pika', count: 1 },
  { title: 'Wild challenge: Stocking up', desc: 'Cache 2 kills.', event: 'cache', count: 2 },
  { title: 'Wild challenge: Strike from above', desc: 'Land 2 ambush pounces.', event: 'ambush', count: 2 },
  { title: 'Wild challenge: Unseen', desc: 'Make 2 kills while hidden.', event: 'camoKill', count: 2 },
  { title: 'Wild challenge: Storm hunter', desc: 'Make a kill during a blizzard.', event: 'blizzardKill', count: 1 },
  { title: 'Wild challenge: Big appetite', desc: 'Eat 80 kg of meat.', event: 'eat', count: 80 },
  { title: 'Wild challenge: Keep your range', desc: 'Scent-mark 3 boulders.', event: 'mark', count: 3 },
  { title: 'Wild challenge: Ibex hunter', desc: 'Hunt 2 Himalayan ibex.', event: 'kill:ibex', count: 2 }
];

export class Quests {
  // onComplete(quest) is called with the finished quest (to pay out the reward)
  constructor(onComplete, onChange) {
    this.onComplete = onComplete;
    this.onChange = onChange;
    this.index = 0;
    this.progress = 0;
    this.challengesDone = 0;
    this.challenge = null; // active challenge after the chain
    this.waiting = false; // short pause between quests
  }

  get current() {
    if (this.index < QUESTS.length) return QUESTS[this.index];
    if (!this.challenge) this.challenge = this.pickChallenge();
    return this.challenge;
  }

  pickChallenge() {
    const base = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    const level = Math.min(4, Math.floor(this.challengesDone / 4));
    return { ...base, xp: 80 + level * 30, pelts: 40 + level * 15, challenge: true };
  }

  event(name, amount = 1) {
    if (this.waiting) return;
    const q = this.current;
    if (q.event !== name) return;
    this.progress = Math.min(q.count, this.progress + amount);
    if (this.progress >= q.count) {
      this.waiting = true;
      this.onComplete(q);
      setTimeout(() => this.advance(), 2500);
    }
    this.onChange();
  }

  advance() {
    if (this.index < QUESTS.length) this.index++;
    else {
      this.challengesDone++;
      this.challenge = null;
    }
    this.progress = 0;
    this.waiting = false;
    this.onChange();
  }

  serialize() {
    return { i: this.index, p: Math.round(this.progress), c: this.challengesDone, ch: this.challenge ? CHALLENGES.findIndex((c) => c.event === this.challenge.event && c.count === this.challenge.count) : -1 };
  }

  restore(data) {
    if (!data) return;
    if (Number.isInteger(data.i)) this.index = Math.max(0, Math.min(QUESTS.length, data.i));
    if (Number.isFinite(data.p)) this.progress = Math.max(0, data.p);
    if (Number.isInteger(data.c)) this.challengesDone = Math.max(0, data.c);
    if (Number.isInteger(data.ch) && CHALLENGES[data.ch]) {
      const level = Math.min(4, Math.floor(this.challengesDone / 4));
      this.challenge = { ...CHALLENGES[data.ch], xp: 80 + level * 30, pelts: 40 + level * 15, challenge: true };
    }
  }
}
