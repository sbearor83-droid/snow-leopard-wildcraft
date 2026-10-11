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
const SAVE_VERSION = 1;
export const AUTOSAVE_INTERVAL_MS = 15 * 1000;

const DIFFICULTIES = ['easy', 'medium', 'hard'];

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
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSave(player, difficulty)));
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
  } catch (e) {
    console.warn('Could not clear save:', e);
  }
}

// ---------------------------------------------------------------------------
// Accessory collection
//
// Kept under its own key so "New game" resets the leopard but not the
// accessories the player has found (or, later, bought).
// ---------------------------------------------------------------------------
const COLLECTION_KEY = 'snowLeopardWorld.collection';
const COLLECTION_VERSION = 1;

// `validIds` filters out items that no longer exist in the catalog
export function readCollection(validIds) {
  const empty = { owned: new Set(), equipped: {}, foundAt: {}, milestones: [], goldPrints: true };
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
  return { owned, equipped, foundAt, milestones, goldPrints };
}

export function writeCollection(collection) {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify({
      version: COLLECTION_VERSION,
      owned: [...collection.owned],
      equipped: collection.equipped,
      foundAt: collection.foundAt,
      milestones: collection.milestones,
      goldPrints: collection.goldPrints
    }));
  } catch (e) {
    console.warn('Collection save failed:', e);
  }
}
