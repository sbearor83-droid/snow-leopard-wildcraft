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
| **Eat / Feed / Dig** | `E` key (near a carcass or treasure) | 🍖 **Eat** / ✨ **Dig** button |
| **Context action** | `R` key | Teal button above the action buttons: 🦷 Bite, 🦴 Drag, 🪨 Cache, ⬇️ Drop, 💤 Rest, 🐾 Mark, 📣 Call |

---

## 🌲 Core Game Mechanics

### 1. 🐆 Snow Leopard Predator System
- **Stalking Mode:** Lowers body close to the snow and cuts how far prey can hear and see you, allowing close approach without triggering alert meters.
- **Sprint, Pounce & Swipe:** High-speed pursuit, explosive leap attacks for heavy damage, and quick close-range claw swipes.
- **Vital Stats:** Health, Stamina (depleted by sprints/pounces/swipes), and Hunger (drains over time; refill by eating).
- **RPG Progression:** Successful hunts and meals grant XP. Leveling up permanently increases Max Health, Stamina, and Attack Power!

### 2. 🦌 Prey AI & Perception
All animals are defined in the `PREY_TYPES` table in `src/prey.js` (models in `src/wildlife.js`).
- **Bharal (blue sheep):** the snow leopard's main real prey. Herds that flee uphill onto the crags.
- **Himalayan Ibex:** Medium prey that graze in herds and sound alarm calls that stampede nearby herd mates.
- **Snow Hare:** Small, agile winter hare with evasive zigzag fleeing patterns.
- **Himalayan Marmot:** sits up on sentry, whistles the alarm and dives into its burrow, peeking out again later.
- **Pika:** darts under the nearest boulder and hides.
- **Himalayan Snowcock:** bursts into flight and lands further away; can't be caught in the air.
- **Titan Crag Yak (Boss):** Huge, tough, and charges to ram you when provoked — until it's badly hurt.
- **Grey wolves:** a pack that hunts the other animals, feeds on its kills, turns on you near its kill or up close, and retreats when badly hurt.
- **Herders' camp:** goats graze at a camp guarded by two mastiffs. Take a goat and the dogs come for you (a nod to the real conflict that gets snow leopards killed).
- **Sense System:** Prey react to sight cones and footstep noise (sprinting alerts from far; stalking allows close-range ambush). Darkness, twilight and blizzards cut how far they see and hear. Spooked prey calm down and return to grazing once they've escaped.

### 🐾 Hunting like a snow leopard
- **Ghost of the mountains:** hold still (or creep) beside a boulder and the 👻 Hidden badge appears: prey see you from a quarter of the distance.
- **Ambush from above:** pounce at a spot at least 2.2 m below you for a longer, harder-hitting leap (2.8x damage).
- **Throat bite:** a pounce that doesn't kill pins the animal for 2.2 s. Tap 🦷 Bite to finish it.
- **Caching:** drag a kill (🦴) next to a rock or tree and cache it (🪨). Cached kills keep 10 minutes and scavengers ignore them. Kills left in the open draw bearded vultures and ravens.
- **Territory:** scent-mark boulders (🐾 Mark). Marks stay fresh for 4 in-game days; each dawn pays 3 Pelts per fresh mark. With 3+ marks a rival snow leopard comes to mark over yours: drive it off (`src/territory.js`).

### 🌄 Day, night & weather
A full day lasts 14 minutes (`src/world.js`). Dawn and dusk are the best hunting light; prey see less at night. Weather drifts between clear, snow and blizzard. A blizzard thickens the fog and wind and shortens how far prey sense you and how far Scent Vision reaches. Rest in one of the three dens (💤) to skip to dawn and heal.

### 🍼 Family
From level 3, at dusk or night, 📣 Call (a yowl) brings a mate. Stay close until you bond, then rest in a den to give birth to 2-3 cubs. Cubs follow you, share your meals and grow each day they're fed; after 6 days they leave to claim their own range (`src/family.js`, other leopards in `src/npc.js`).

### 📜 Quests
16 guided quests walk through every behaviour, then endless wild challenges (`src/quests.js`). A first-run tutorial (`src/tutorial.js`) teaches the controls one step at a time.

### 3. 👃 Scent Vision
- Triggers a sensory sonar pulse across the snow.
- Draws scent trails toward nearby living prey (amber: ibex, slate blue: bharal, cyan: hare, gold: marmot, pink: pika, lime: snowcock, orange: wolves and dogs, red: boss).
- Marked boulders glow violet, and buried treasure shoots up a beam.
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

### ⚙️ Settings
Volume (master, effects, wind), look speed, invert up/down, graphics quality (Auto / Low / High, applied on restart), vibration, replay tutorial and New game (`src/settings.js`, stored on the device only).

### 🎨 Coat colours & rewarded ads
Six coat colours (`src/coats.js`) are sold in the shop and worn from the Wardrobe. Optional rewarded videos, only offered when an ad is ready: double the Pelts from a kill, one bonus treasure chest per day, and up to two shop offer refreshes per day. The one-time Starter Pack (`src/store.js`) waits for Google Play Billing like the other real-money products.

### 🐞 Error reports
JavaScript errors and lost WebGL contexts are sent to the Firestore collection `errorReports` (no personal data; see `src/errors.js`). Read them in the Firebase console under Firestore Database. After changing `firestore.rules`, paste the file into the console's Rules tab and publish.

### 💾 Saving
Progress saves automatically (every 15 seconds, after each kill, meal, revive or respawn, and whenever the app is backgrounded). Level, XP, vitals, hunt totals, position, difficulty, the time of day, territory marks, quest progress and cubs are restored on the next launch. **New game** under the difficulty toggle resets the leopard; accessories, Pelts, Crystals and daily progress are kept. Saves live on the device (`src/save.js`), so uninstalling the app or clearing its data removes them.


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

**Pixel 10 / PowerVR GPUs:** the PowerVR driver in the Pixel 10 family drops the WebGL context when three.js
renders shadow maps (the screen goes blank a moment after the leopard appears). The game detects those GPUs and
runs without shadow maps; any other device that loses its GL context is reloaded into the same "safe render" mode
and remembers it (`localStorage` key `slw.safeRender`).

Release signing reads `android/keystore.properties`, which is git-ignored. See
[`release-builds/GOOGLE_PLAY_UPLOAD_GUIDE.md`](release-builds/GOOGLE_PLAY_UPLOAD_GUIDE.md) for creating a keystore and uploading to Google Play.
