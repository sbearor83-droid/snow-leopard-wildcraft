// ---------------------------------------------------------------------------
// Save system
//
// Progress is stored in localStorage, which the Android WebView keeps on the
// device until the app is uninstalled or its data is cleared. The game saves
// automatically: every AUTOSAVE_INTERVAL_MS, after kills / meals / level-ups,
// and whenever the app is backgrounded or closed.
//
// Bump SAVE_VERSION if the format changes and add a migration in migrate().
// ---------------------------------------------------------------------------
const SAVE_KEY = 'snowLeopardWorld.save';
const COLLECTION_KEY = 'snowLeopardWorld.collection';
const SAVE_VERSION = 1;
export const AUTOSAVE_INTERVAL_MS = 15 * 1000;

const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Cloud sync bookkeeping (see cloud.js): when this device last changed its data,
// which account/revision it last synced with, and the wallet at that moment.
const SYNC_META_KEY = 'snowLeopardWorld.syncMeta';
let localWriteListener = null;
let writesFrozen = false;

// Stops all saving until the page reloads (used while swapping in cloud data,
// so the running game can't overwrite it with its stale in-memory state)
export function freezeWrites() {
  writesFrozen = true;
}

// cloud.js registers here to hear about every local save
export function onLocalWrite(callback) {
  localWriteListener = callback;
}

function markLocalWrite() {
  try {
    const meta = readSyncMeta();
    meta.updatedAt = Date.now();
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch (e) {
    // Storage unavailable: nothing to sync either
  }
  if (localWriteListener) localWriteListener();
}

export function readSyncMeta() {
  const meta = { updatedAt: 0, uid: null, syncedRev: 0, lastSyncAt: 0, baseWallet: null };
  try {
    Object.assign(meta, JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'));
  } catch (e) {
    // Corrupt meta: start over (the next sync merges everything)
  }
  return meta;
}

export function writeSyncMeta(meta) {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('Sync meta save failed:', e);
  }
}

// The stored progress exactly as saved (JSON strings, or null), for cloud upload
export function readRawProgress() {
  try {
    return { profile: localStorage.getItem(COLLECTION_KEY), leopard: localStorage.getItem(SAVE_KEY) };
  } catch (e) {
    return { profile: null, leopard: null };
  }
}

// Replaces local progress with synced data (does not count as a local change)
export function writeRawProgress({ profile, leopard }) {
  try {
    if (profile) localStorage.setItem(COLLECTION_KEY, profile);
    else localStorage.removeItem(COLLECTION_KEY);
    if (leopard) localStorage.setItem(SAVE_KEY, leopard);
    else localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    console.warn('Could not store synced progress:', e);
  }
}

// Wipes everything on this device (used when signing out of cloud saves)
export function clearAllProgress() {
  try {
    for (const key of [SAVE_KEY, COLLECTION_KEY, SYNC_META_KEY]) localStorage.removeItem(key);
  } catch (e) {
    console.warn('Could not clear progress:', e);
  }
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Upgrades older save formats to the current one. Returns null if unusable.
function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SAVE_VERSION) return null;
  return data;
}

export function buildSave(player, difficulty) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    difficulty,
    player: {
      level: player.level,
      xp: player.xp,
      hp: player.hp,
      stamina: player.stamina,
      hunger: player.hunger,
      preyHunted: player.preyHunted,
      meatConsumed: player.meatConsumed,
      x: player.position.x,
      z: player.position.z,
      facingAngle: player.facingAngle
    }
  };
}

export function writeSave(player, difficulty) {
  if (writesFrozen) return false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSave(player, difficulty)));
    markLocalWrite();
    return true;
  } catch (e) {
    console.warn('Save failed:', e);
    return false;
  }
}

// Returns a validated save object, or null if there is no usable save
export function readSave() {
  let data;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    data = migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('Save could not be read:', e);
    return null;
  }
  if (!data || !data.player) return null;

  const p = data.player;
  const numericFields = ['level', 'xp', 'hp', 'stamina', 'hunger', 'preyHunted', 'meatConsumed', 'x', 'z', 'facingAngle'];
  if (!numericFields.every((k) => isFiniteNumber(p[k]))) return null;
  if (p.level < 1) return null;
  if (!DIFFICULTIES.includes(data.difficulty)) data.difficulty = 'medium';
  return data;
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
    markLocalWrite();
  } catch (e) {
    console.warn('Could not clear save:', e);
  }
}

// ---------------------------------------------------------------------------
// Accessory collection
//
// Kept under its own key so "New game" resets the leopard but not the
// accessories the player has found or bought, their wallet, or daily rewards.
// ---------------------------------------------------------------------------
const COLLECTION_VERSION = 1;

// `validIds` filters out items that no longer exist in the catalog
export function readCollection(validIds) {
  const empty = {
    owned: new Set(),
    equipped: {},
    foundAt: {},
    milestones: [],
    goldPrints: true,
    wallet: { pelts: 0, crystals: 0 },
    daily: { lastLoginDay: null, streak: 0, stashDay: null, stashFound: 0 },
    removeAds: false
  };
  let data;
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    if (!raw) return empty;
    data = JSON.parse(raw);
  } catch (e) {
    console.warn('Collection could not be read:', e);
    return empty;
  }
  if (!data || data.version !== COLLECTION_VERSION || !Array.isArray(data.owned)) return empty;

  const owned = new Set(data.owned.filter((id) => validIds.has(id)));
  const equipped = {};
  for (const [slot, id] of Object.entries(data.equipped || {})) {
    if (owned.has(id)) equipped[slot] = id;
  }
  // When each item was found (ms timestamps); older saves don't have these
  const foundAt = {};
  for (const [id, t] of Object.entries(data.foundAt || {})) {
    if (owned.has(id) && Number.isFinite(t)) foundAt[id] = t;
  }
  const milestones = Array.isArray(data.milestones) ? data.milestones.filter(Number.isFinite) : [];
  const goldPrints = data.goldPrints !== false;

  const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const w = data.wallet || {};
  const wallet = { pelts: count(w.pelts), crystals: count(w.crystals) };
  const d = data.daily || {};
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const daily = { lastLoginDay: day(d.lastLoginDay), streak: count(d.streak), stashDay: day(d.stashDay), stashFound: count(d.stashFound) };
  return { owned, equipped, foundAt, milestones, goldPrints, wallet, daily, removeAds: data.removeAds === true };
}

export function writeCollection(collection) {
  if (writesFrozen) return;
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify({
      version: COLLECTION_VERSION,
      owned: [...collection.owned],
      equipped: collection.equipped,
      foundAt: collection.foundAt,
      milestones: collection.milestones,
      goldPrints: collection.goldPrints,
      wallet: collection.wallet,
      daily: collection.daily,
      removeAds: collection.removeAds
    }));
    markLocalWrite();
  } catch (e) {
    console.warn('Collection save failed:', e);
  }
}
