// ---------------------------------------------------------------------------
// Cloud save merging (pure functions, no storage or network)
//
// Progress is two JSON strings: `profile` (the collection: items, wallet, daily
// rewards — see save.js) and `leopard` (level, stats, position).
//
// A device remembers which cloud revision it last synced with and what its
// wallet held at that moment (`baseWallet`). That lets it tell apart:
//   - only this device changed      -> upload local
//   - only the cloud changed        -> take the cloud copy
//   - both changed (two phones, or a phone that never synced with this
//     account, e.g. a new phone)    -> merge:
//       items, find dates, book rewards, Remove Ads: union (nothing is lost)
//       Pelts / Crystals: cloud + what this device earned or spent since the
//                         last sync (so nothing is counted twice)
//       daily streak / stash: whichever is from the later day
//       leopard: the higher level (then XP)
// ---------------------------------------------------------------------------

const ZERO_WALLET = { pelts: 0, crystals: 0 };

function parse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function laterDay(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b; // 'YYYY-MM-DD' strings sort chronologically
}

function mergeDaily(local = {}, remote = {}) {
  const daily = {};
  // Login streak: from whichever side logged in most recently
  const loginFrom = laterDay(local.lastLoginDay, remote.lastLoginDay) === local.lastLoginDay ? local : remote;
  daily.lastLoginDay = loginFrom.lastLoginDay ?? null;
  daily.streak = local.lastLoginDay === remote.lastLoginDay
    ? Math.max(local.streak || 0, remote.streak || 0)
    : loginFrom.streak || 0;
  // Daily stash: chests found today on either device
  daily.stashDay = laterDay(local.stashDay, remote.stashDay) ?? null;
  if (local.stashDay === remote.stashDay) daily.stashFound = Math.max(local.stashFound || 0, remote.stashFound || 0);
  else daily.stashFound = (daily.stashDay === local.stashDay ? local.stashFound : remote.stashFound) || 0;
  return daily;
}

export function mergeProfiles(localJson, remoteJson, baseWallet = ZERO_WALLET) {
  const local = parse(localJson);
  const remote = parse(remoteJson);
  if (!local) return remoteJson;
  if (!remote) return localJson;

  const owned = [...new Set([...(remote.owned || []), ...(local.owned || [])])];
  const foundAt = { ...(remote.foundAt || {}) };
  for (const [id, t] of Object.entries(local.foundAt || {})) {
    foundAt[id] = foundAt[id] ? Math.min(foundAt[id], t) : t;
  }
  const milestones = [...new Set([...(remote.milestones || []), ...(local.milestones || [])])].sort((a, b) => a - b);

  const base = baseWallet || ZERO_WALLET;
  const wallet = {};
  for (const cur of Object.keys(ZERO_WALLET)) {
    const earnedHere = ((local.wallet || {})[cur] || 0) - (base[cur] || 0);
    wallet[cur] = Math.max(0, ((remote.wallet || {})[cur] || 0) + earnedHere);
  }

  return JSON.stringify({
    version: local.version ?? remote.version,
    owned,
    equipped: local.equipped || remote.equipped || {}, // keep this device's current look
    foundAt,
    milestones,
    goldPrints: local.goldPrints ?? remote.goldPrints,
    wallet,
    daily: mergeDaily(local.daily, remote.daily),
    removeAds: Boolean(local.removeAds || remote.removeAds)
  });
}

// The leopard with more progress wins (level, then XP)
export function mergeLeopards(localJson, remoteJson) {
  const local = parse(localJson);
  const remote = parse(remoteJson);
  if (!local || !local.player) return remoteJson;
  if (!remote || !remote.player) return localJson;
  const score = (s) => s.player.level * 1e9 + s.player.xp;
  return score(local) >= score(remote) ? localJson : remoteJson;
}

export function walletOf(profileJson) {
  const p = parse(profileJson);
  return { ...ZERO_WALLET, ...((p && p.wallet) || {}) };
}

/**
 * Decides what a sync should do.
 *   local:  { profile, leopard }            this device's data
 *   remote: { profile, leopard, rev } | null the cloud copy (null = never uploaded)
 *   meta:   this device's sync bookkeeping (save.js readSyncMeta)
 *   uid:    the signed-in account
 * Returns { result: { profile, leopard }, applyLocally, upload }.
 */
export function planSync(local, remote, meta, uid) {
  const sameAccount = meta.uid === uid;
  const localChanged = !sameAccount || meta.updatedAt > meta.lastSyncAt;
  const hasLocal = Boolean(local.profile || local.leopard);

  if (!remote) {
    return { result: local, applyLocally: false, upload: hasLocal };
  }
  const remoteChanged = !sameAccount || remote.rev !== meta.syncedRev;

  if (!remoteChanged) {
    return { result: local, applyLocally: false, upload: localChanged && hasLocal };
  }
  const remoteData = { profile: remote.profile, leopard: remote.leopard };
  if (!localChanged || !hasLocal) {
    return { result: remoteData, applyLocally: true, upload: false };
  }
  const base = sameAccount ? meta.baseWallet : ZERO_WALLET;
  const result = {
    profile: mergeProfiles(local.profile, remote.profile, base),
    leopard: mergeLeopards(local.leopard, remote.leopard)
  };
  return {
    result,
    applyLocally: result.profile !== local.profile || result.leopard !== local.leopard,
    upload: result.profile !== remote.profile || result.leopard !== remote.leopard
  };
}
