# Snow Leopard World 🐆❄️
*A 3D animal simulator and mountain hunting RPG for Android and Web, built with Three.js and Capacitor.*

---

## 🎮 Running Locally

```bash
npm install
npm run dev
```

Vite prints a local URL (http://localhost:5173/) and, because `dev` runs with `--host`, a network URL you can open on a phone on the same Wi-Fi.

---

## 🕹️ Controls

| Action | Desktop Keyboard | Mobile Touch Screen |
| :--- | :--- | :--- |
| **Movement** | `W`, `A`, `S`, `D` or Arrow Keys | Left side virtual touch joystick |
| **Camera Orbit** | Click + drag mouse, wheel to zoom | Right side swipe / drag |
| **Sprint** | Hold `Shift` | ⚡ **Sprint** button (toggle) |
| **Stalk / Sneak** | `C` key (toggle low crouch) | 🐾 **Stalk** button |
| **Pounce Attack** | `Space` or `F` | 💥 **Pounce** button |
| **Paw Swipe** | `Q` | 🐾 **Swipe** button |
| **Scent Vision** | `V` key | 👃 **Scent** button |
| **Eat / Feed** | `E` key (near downed carcass) | 🍖 **Eat** button |

---

## 🌲 Core Game Mechanics

### 1. 🐆 Snow Leopard Predator System
- **Stalking Mode:** Lowers body close to the snow and cuts how far prey can hear and see you, allowing close approach without triggering alert meters.
- **Sprint, Pounce & Swipe:** High-speed pursuit, explosive leap attacks for heavy damage, and quick close-range claw swipes.
- **Vital Stats:** Health, Stamina (depleted by sprints/pounces/swipes), and Hunger (drains over time; refill by eating).
- **RPG Progression:** Successful hunts and meals grant XP. Leveling up permanently increases Max Health, Stamina, and Attack Power!

### 2. 🦌 Prey AI & Perception
- **Himalayan Ibex:** Medium prey that graze in herds and sound alarm calls that stampede nearby herd mates.
- **Snow Hare:** Small, agile winter hare with evasive zigzag fleeing patterns.
- **Titan Crag Yak (Boss):** Huge, tough, and charges to ram you when provoked — until it's badly hurt.
- **Sense System:** Prey react to sight cones and footstep noise (sprinting alerts from far; stalking allows close-range ambush). Spooked prey calm down and return to grazing once they've escaped.

### 3. 👃 Scent Vision
- Triggers a sensory sonar pulse across the snow.
- Draws scent trails toward nearby living prey (amber: ibex, cyan: hare, red: boss).
- The compass radar shows the nearest prey and its distance.

### 🐆 Snow Leopard Model
- `public/snow_leopard.glb` is a rigged, skinned snow leopard (6.7k triangles, 49 bones) with 17 skeletal clips: Idle_Look, ProwlIdle, Walk, ProwlWalk, Run, Pounce, Attack_Left/Right, Bite, Hit_Left, Death and more. `src/player.js` drives these from the gameplay state (stalk → ProwlWalk, sprint → Run, pounce → Pounce, swipe → alternating Attack clips) and syncs the stride rate to the ground speed.
- The coat (rosettes, dorsal blotches, leg spots, ringed tail with a black tip, eyes, nose, ears) is baked onto the model's UV layout by `scripts/bake_snow_leopard_coat.py` and embedded in the GLB as a 2048px base color plus a 1024px fur-grain normal map. Re-run the script (needs `numpy` and `Pillow`) after tweaking the colors or pattern parameters at the top of `bake_coat()`.

### 🏔️ World & Prey Rendering
- Everything in the world is generated procedurally at load (`src/procgen.js` holds the shared noise, texture and tube-loft helpers): the snow terrain with its drift normal map and sun-glint shader, the noise-sculpted snow-capped boulders, the snow-laden firs, the sky dome and the horizon ranges (`src/terrain.js`).
- Prey are lofted from smooth spine paths with vertex-coloured coats, fur-grain maps and jointed legs (`src/prey.js`): grey-brown ibex with knobbed scimitar horns, white snow hares with black-tipped ears, and the shaggy humped Titan Crag Yak. Leg cadence follows ground speed so hooves don't slide.

### Difficulty
- **Easy:** slower hunger, less perceptive and slower prey, weaker boss.
- **Medium:** standard wilderness.
- **Hard:** savage hunger, alert and faster prey, fierce bosses.

---

### ✨ Hidden Treasure & Accessories
- **Treasure:** Six accessories are always buried around the mountain at the foot of boulders and fir trees. Each one is a small snow mound with a gem poking out and a faint glimmer that twinkles every few seconds. Rarer finds glimmer in their own colour and can be spotted from further away (Common yellow, Rare blue, Epic purple, Legendary orange). A soft chime plays when you get close.
- **Digging:** Walk up and press `E` (or the ✨ **Dig** button) to paw it out of the snow. You always get an accessory you don't own yet, and a replacement treasure is buried somewhere else 45 seconds later.
- **Wardrobe:** The 🎒 **Wardrobe** button under the difficulty toggle shows everything you've found (and silhouettes of what's still out there). Tap an item to wear it or take it off. One item per slot: Head, Face, Neck, Tail.
- **Scent Vision finds treasure too:** Press 👃 Scent and, as the sonar ring sweeps outward (up to 90 m), every buried treasure it passes shoots up a beam of light in its rarity colour, tall enough to see over the trees. The compass shows the nearest one's distance (e.g. "✨ Rare treasure (34m)"). The beams fade when the scent wears off.
- **Collection Book:** The second tab in the Wardrobe shows overall and per-rarity progress, when you found each item, and hints (rarity and slot) for the ones you're missing. Rewards unlock automatically: 3 found = +100 XP, 6 = +250 XP, 9 = +500 XP, and finding all 12 unlocks **golden paw prints**, which can be switched on or off in the book.
- **12 accessories so far** (`src/accessories.js`): flower crown, party hat, gold crown, ice crystal crown, royal snow tiara, aviators, heart shades, ski goggles, cozy red scarf, bell collar, diamond collar, tail bow. Each is built from simple shapes in code and attached to a bone of the leopard's skeleton, so it moves with every animation. Tuning numbers (how many treasures, respawn time, rarity odds, glimmer range) are at the top of `src/treasure.js` and `src/accessories.js`.

### 🛒 Shop, Currency & Daily Rewards
- **Currencies:** 🐾 **Pelts** are earned by playing (hare 10, ibex 20, Titan Yak 100, plus daily rewards and spare treasure). 💎 **Snow Crystals** are premium: a few are earned (day 7 of the login streak, daily stash once your collection is complete). Real-money packs will add more once billing is connected. Your balance shows on the 🛒 button under the difficulty toggle.
- **Daily reward:** The first launch each day shows a 7-day streak (🐾 50 → 75 → 100 → 125 → 150 → 200 → 🐾 250 + 💎 10). Missing a day starts it over.
- **Daily stash:** Each day, 3 bonus treasure chests (a gold chest lid peeking out of the snow) are buried in addition to the regular treasure. The first is always Rare or better. The compass shows how many are left, and found chests stay found if you restart.
- **Shop:** "Today's offers" shows 4 accessories you don't own, rotating at midnight (Common 🐾150, Rare 🐾400, Epic 🐾900). "Crystal exclusives" always sells Epic (💎25) and Legendary (💎60) items. Bought items count toward the Collection Book.
- **Real-money products** (Crystal packs, Remove Ads) are listed but show **Coming soon** until Google Play Billing is connected. Setup steps are in `src/store.js`. Nothing is granted without a real purchase.
- Wallet, purchases and daily progress are kept when you start a New game. Tuning lives in `src/economy.js`.

### 💾 Saving
Progress saves automatically (every 15 seconds, after each kill, meal, revive or respawn, and whenever the app is backgrounded). Level, XP, vitals, hunt totals, position and difficulty are restored on the next launch. **New game** under the difficulty toggle resets the leopard; accessories, Pelts, Crystals and daily progress are kept. Saves live on the device (`src/save.js`), so uninstalling the app or clearing its data removes them.


### ☁️ Cloud Saves (off until set up)
Players can **Sign in with Google** from the ☁️ button to keep their accessories, Pelts, Crystals, daily rewards and leopard in the cloud, so progress survives reinstalls and moves to new phones. It uses Firebase (Google sign-in + Firestore) and stays hidden from players until a Firebase project is added. Setup steps are at the top of `src/cloud.js`, and the database rules are in `firestore.rules`.

- **Syncing:** happens on launch, about once a minute while playing, when the app goes to the background, and on **Sync now**.
- **Two phones / a new phone:** progress is merged, never overwritten. Items from both sides are kept, Pelts and Crystals add up what each phone earned or spent since its last sync (nothing counted twice), and the higher-level leopard wins. The rules are in `src/cloudmerge.js` and covered by `npm test`.
- **Offline:** the game keeps saving on the device and syncs later.
- **Sign out** leaves the cloud copy intact and starts the device fresh. **Delete my cloud save** removes the cloud copy and the sign-in account (a Google Play requirement).
- **Trying it without Firebase:** run `npm run dev` and open the game with `?cloud=mock`. That uses a pretend cloud stored in the browser (development builds only).

## 📱 Building for Android

The Capacitor Android project is already set up in `android/` (app ID `com.snowleopardworld.game`).

```bash
npm run android        # vite build + npx cap sync android
npx cap open android   # then Build > Generate Signed App Bundle / APK in Android Studio
```

Ads use Google AdMob (Android app only). See the guide below for switching from test ads to your own ad units.

Release signing reads `android/keystore.properties`, which is git-ignored. See
[`release-builds/GOOGLE_PLAY_UPLOAD_GUIDE.md`](release-builds/GOOGLE_PLAY_UPLOAD_GUIDE.md) for creating a keystore and uploading to Google Play.
