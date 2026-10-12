// ---------------------------------------------------------------------------
// Coat colours: a tint over the leopard's baked rosette coat. Bought in the
// shop, worn from the Wardrobe. `price` null = owned by everyone.
// ---------------------------------------------------------------------------
export const COATS = [
  { id: 'natural', name: 'Natural', icon: '🐆', tint: 0xffffff, price: null },
  { id: 'frost', name: 'Frost', icon: '❄️', tint: 0xe4eeff, price: { pelts: 600 } },
  { id: 'golden', name: 'Golden Dusk', icon: '🌅', tint: 0xffdcae, price: { pelts: 900 } },
  { id: 'ember', name: 'Ember', icon: '🔥', tint: 0xffbea4, price: { pelts: 1200 } },
  { id: 'aurora', name: 'Aurora', icon: '🌌', tint: 0xc6f0e2, price: { crystals: 40 } },
  { id: 'midnight', name: 'Midnight', icon: '🌑', tint: 0x6a7080, price: { crystals: 60 } }
];

export const COAT_BY_ID = Object.fromEntries(COATS.map((c) => [c.id, c]));
