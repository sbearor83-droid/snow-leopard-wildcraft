// ---------------------------------------------------------------------------
// Real-money store (Google Play Billing) — NOT CONNECTED YET
//
// The shop lists these products, but while BILLING_ENABLED is false their
// buttons say "Coming soon" and nothing can be bought. Nothing is ever granted
// without a real, verified purchase.
//
// To turn it on:
//   1. Create the products below in Google Play Console (Monetize > Products),
//      using exactly these product IDs.
//   2. Add a billing plugin, e.g. RevenueCat: npm i @revenuecat/purchases-capacitor
//      then `npx cap sync android`.
//   3. Implement purchase() below with the plugin, and verify each purchase on a
//      server (RevenueCat does this for you) before granting anything.
//   4. Make purchases restorable (reinstalls / new phones) — this needs cloud
//      saves, since the wallet currently lives only on the device.
//   5. Set BILLING_ENABLED to true.
// ---------------------------------------------------------------------------
export const BILLING_ENABLED = false;

// Prices shown here are placeholders; with billing on, show the localized
// price string the store returns instead.
// grants: crystals, pelts, coat (a coat colour id), removeAds. oneTime products disappear once bought.
export const PRODUCTS = [
  { id: 'starter_pack', name: 'Starter Pack', icon: '🎁', grants: { crystals: 150, pelts: 1500, coat: 'golden' }, price: '$1.99', tag: 'One-time offer', oneTime: true },
  { id: 'crystals_small', name: 'Handful of Crystals', icon: '💎', grants: { crystals: 80 }, price: '$0.99' },
  { id: 'crystals_medium', name: 'Pouch of Crystals', icon: '💎', grants: { crystals: 450 }, price: '$4.99', tag: 'Popular' },
  { id: 'crystals_large', name: 'Chest of Crystals', icon: '💎', grants: { crystals: 1000 }, price: '$9.99', tag: 'Best value' },
  { id: 'remove_ads', name: 'Remove Ads', icon: '🚫', grants: { removeAds: true }, price: '$3.99' }
];

// Starts a purchase. Resolves with the product's grants once paid and verified,
// or null if cancelled / unavailable.
export async function purchase(productId) {
  if (!BILLING_ENABLED) return null;
  // TODO: call the billing plugin here and return the product's grants after verification
  console.warn('Billing is enabled but purchase() is not implemented:', productId);
  return null;
}
