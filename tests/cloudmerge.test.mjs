// Cloud save merge rules (src/cloudmerge.js). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, mergeProfiles, walletOf } from '../src/cloudmerge.js';
const prof = (o) => JSON.stringify({ version: 1, owned: [], equipped: {}, foundAt: {}, milestones: [], goldPrints: true, wallet: { pelts: 0, crystals: 0 }, daily: { lastLoginDay: null, streak: 0, stashDay: null, stashFound: 0 }, removeAds: false, ...o });
const leo = (level, xp) => JSON.stringify({ version: 1, player: { level, xp } });
const meta = (o) => ({ updatedAt: 0, uid: null, syncedRev: 0, lastSyncAt: 0, baseWallet: null, ...o });
const t = test;

t('first upload when cloud empty', () => {
  const p = planSync({ profile: prof({}), leopard: leo(2, 5) }, null, meta({ updatedAt: 5 }), 'u1');
  assert.equal(p.upload, true); assert.equal(p.applyLocally, false);
});
t('new phone, fresh install takes cloud', () => {
  const remote = { profile: prof({ owned: ['a'], wallet: { pelts: 900, crystals: 30 } }), leopard: leo(9, 1), rev: 4 };
  const p = planSync({ profile: null, leopard: null }, remote, meta({}), 'u1');
  assert.equal(p.applyLocally, true); assert.equal(p.upload, false); assert.equal(p.result.profile, remote.profile);
});
t('new phone that played a bit first: merge adds, keeps higher leopard', () => {
  const remote = { profile: prof({ owned: ['a', 'b'], wallet: { pelts: 900, crystals: 30 }, milestones: [3] }), leopard: leo(9, 1), rev: 4 };
  const local = { profile: prof({ owned: ['c', 'a'], wallet: { pelts: 50, crystals: 0 } }), leopard: leo(1, 40) };
  const p = planSync(local, remote, meta({ updatedAt: 10 }), 'u1');
  const m = JSON.parse(p.result.profile);
  assert.deepEqual(m.owned.sort(), ['a', 'b', 'c']); assert.deepEqual(m.wallet, { pelts: 950, crystals: 30 });
  assert.deepEqual(m.milestones, [3]); assert.equal(p.result.leopard, remote.leopard); assert.ok(p.upload && p.applyLocally);
});
t('only this device changed: upload as-is', () => {
  const local = { profile: prof({ wallet: { pelts: 300, crystals: 0 } }), leopard: leo(3, 0) };
  const p = planSync(local, { profile: prof({ wallet: { pelts: 100, crystals: 0 } }), leopard: leo(2, 0), rev: 7 }, meta({ uid: 'u1', syncedRev: 7, updatedAt: 20, lastSyncAt: 10 }), 'u1');
  assert.equal(p.upload, true); assert.equal(p.applyLocally, false); assert.equal(p.result, local);
});
t('only the cloud changed: take it', () => {
  const remote = { profile: prof({ wallet: { pelts: 500, crystals: 0 } }), leopard: leo(5, 0), rev: 9 };
  const p = planSync({ profile: prof({}), leopard: leo(1, 0) }, remote, meta({ uid: 'u1', syncedRev: 8, updatedAt: 10, lastSyncAt: 10 }), 'u1');
  assert.equal(p.applyLocally, true); assert.equal(p.upload, false); assert.equal(p.result.profile, remote.profile);
});
t('two phones both earned and spent: deltas combine, no double count', () => {
  // Last sync: both had 1000 pelts / 50 crystals. Phone A earned 200; phone B (cloud) spent 400 and earned 30 crystals.
  const remote = { profile: prof({ wallet: { pelts: 600, crystals: 80 } }), leopard: leo(4, 0), rev: 12 };
  const local = { profile: prof({ wallet: { pelts: 1200, crystals: 50 } }), leopard: leo(4, 10) };
  const p = planSync(local, remote, meta({ uid: 'u1', syncedRev: 11, updatedAt: 30, lastSyncAt: 20, baseWallet: { pelts: 1000, crystals: 50 } }), 'u1');
  assert.deepEqual(walletOf(p.result.profile), { pelts: 800, crystals: 80 });
  assert.equal(p.result.leopard, local.leopard);
});
t('nothing changed: nothing to do', () => {
  const local = { profile: prof({}), leopard: leo(1, 0) };
  const p = planSync(local, { ...local, rev: 3 }, meta({ uid: 'u1', syncedRev: 3, updatedAt: 10, lastSyncAt: 10 }), 'u1');
  assert.equal(p.upload, false); assert.equal(p.applyLocally, false);
});
t('daily: later login wins, same-day stash takes max', () => {
  const a = prof({ daily: { lastLoginDay: '2026-10-11', streak: 3, stashDay: '2026-10-11', stashFound: 1 } });
  const b = prof({ daily: { lastLoginDay: '2026-10-09', streak: 6, stashDay: '2026-10-11', stashFound: 2 } });
  assert.deepEqual(JSON.parse(mergeProfiles(a, b)).daily, { lastLoginDay: '2026-10-11', streak: 3, stashDay: '2026-10-11', stashFound: 2, bonusChestDay: null, rerollDay: null, rerolls: 0 });
});
t('foundAt keeps earliest, removeAds sticks', () => {
  const m = JSON.parse(mergeProfiles(prof({ owned: ['a'], foundAt: { a: 50 } }), prof({ owned: ['a'], foundAt: { a: 20 }, removeAds: true })));
  assert.equal(m.foundAt.a, 20); assert.equal(m.removeAds, true);
});
t('wallet never goes negative', () => {
  const m = JSON.parse(mergeProfiles(prof({ wallet: { pelts: 0, crystals: 0 } }), prof({ wallet: { pelts: 100, crystals: 0 } }), { pelts: 500, crystals: 0 }));
  assert.equal(m.wallet.pelts, 0);
});

t('coat colours and starter pack survive a merge from both sides', () => {
  const remote = { profile: prof({ coats: ['natural', 'frost'], coat: 'frost', starterPack: true, daily: { lastLoginDay: '2026-10-10', streak: 2, stashDay: '2026-10-10', stashFound: 1, bonusChestDay: '2026-10-10', rerollDay: '2026-10-10', rerolls: 1 } }), leopard: leo(3, 0), rev: 2 };
  const local = { profile: prof({ coats: ['natural', 'midnight'], coat: 'midnight', daily: { lastLoginDay: '2026-10-11', streak: 3, stashDay: '2026-10-11', stashFound: 0, bonusChestDay: null, rerollDay: '2026-10-11', rerolls: 2 } }), leopard: leo(2, 0) };
  const m = JSON.parse(planSync(local, remote, meta({ updatedAt: 9 }), 'u1').result.profile);
  assert.deepEqual(m.coats.sort(), ['frost', 'midnight', 'natural']);
  assert.equal(m.coat, 'midnight');
  assert.equal(m.starterPack, true);
  assert.equal(m.daily.bonusChestDay, '2026-10-10');
  assert.equal(m.daily.rerollDay, '2026-10-11');
  assert.equal(m.daily.rerolls, 2);
});
