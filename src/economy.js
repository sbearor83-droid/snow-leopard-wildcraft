import { ACCESSORIES } from './accessories.js';

// ---------------------------------------------------------------------------
// Economy: currencies, prices, daily rewards and the shop's daily offers
//
//   Pelts (🐾)         earned by playing: hunting, daily rewards, spare treasure
//   Snow Crystals (💎)  premium: a few are earned (7-day streak, daily stash),
//                       the rest will come from real-money packs (see store.js)
//
// Everything here is tuning; change numbers freely.
// ---------------------------------------------------------------------------

export const CURRENCY = {
  pelts: { icon: '🐾', name: 'Pelts' },
  crystals: { icon: '💎', name: 'Snow Crystals' }
};

// Pelts for each kill
export const PREY_PELTS = { hare: 10, ibex: 20, bharal: 20, marmot: 8, pika: 5, snowcock: 6, goat: 5, yak: 100, wolf: 25, dog: 15 };

// Treasure that has no new accessory left to give pays out this instead
export const SPARE_TREASURE_PELTS = 40;

// Shop prices by rarity. Legendary items cost Crystals only; epics can be bought with either.
export const PRICES = {
  common: { pelts: 150 },
  rare: { pelts: 400 },
  epic: { pelts: 900, crystals: 25 },
  legendary: { crystals: 60 }
};

export const DAILY_OFFER_COUNT = 4;

// Daily login reward, by day of the streak (day 7 is the big one, then it starts over)
export const STREAK_REWARDS = [
  { pelts: 50 },
  { pelts: 75 },
  { pelts: 100 },
  { pelts: 125 },
  { pelts: 150 },
  { pelts: 200 },
  { pelts: 250, crystals: 10 }
];

// Daily stash: bonus treasure chests buried once a day, with better odds
export const DAILY_STASH_COUNT = 3;
export const DAILY_STASH_FALLBACK = { pelts: 100, crystals: 2 }; // when the collection is complete

// ------------------------------------------------------------------ days
// Local calendar day as 'YYYY-MM-DD', so rewards reset at the player's midnight
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function previousDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

// Milliseconds until the next local midnight
export function msUntilTomorrow(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight - now;
}

// Works out today's login reward. Returns null if today's was already claimed,
// otherwise { day (1-7), reward, streak } where `streak` is the new streak count.
export function dailyLoginReward(daily, today = dayKey()) {
  if (daily.lastLoginDay === today) return null;
  const continues = daily.lastLoginDay === previousDayKey(today);
  const streak = continues ? daily.streak + 1 : 1;
  const day = ((streak - 1) % STREAK_REWARDS.length) + 1;
  return { day, reward: STREAK_REWARDS[day - 1], streak };
}

// ------------------------------------------------------------------ shop
// Small seeded RNG so every player sees the same offers all day
function seededRng(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// Today's rotating offers: up to DAILY_OFFER_COUNT unowned accessories that sell for Pelts
// (Crystal-only items live in their own always-available shop row)
export function dailyOffers(owned, today = dayKey()) {
  const rng = seededRng(`offers-${today}`);
  const shuffled = [...ACCESSORIES].sort(() => rng() - 0.5);
  return shuffled.filter((a) => PRICES[a.rarity].pelts && !owned.has(a.id)).slice(0, DAILY_OFFER_COUNT);
}

export function canAfford(wallet, price) {
  return Object.entries(price).every(([cur, amount]) => (wallet[cur] || 0) >= amount);
}

export function formatPrice(price) {
  return Object.entries(price).map(([cur, amount]) => `${CURRENCY[cur].icon} ${amount}`).join(' ');
}

export function formatReward(reward) {
  return Object.entries(reward)
    .filter(([, amount]) => amount > 0)
    .map(([cur, amount]) => `+${amount} ${CURRENCY[cur].icon}`)
    .join('  ');
}
