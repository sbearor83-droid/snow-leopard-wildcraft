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

## 📱 Building for Android

The Capacitor Android project is already set up in `android/` (app ID `com.snowleopardworld.game`).

```bash
npm run android        # vite build + npx cap sync android
npx cap open android   # then Build > Generate Signed App Bundle / APK in Android Studio
```

Ads use Google AdMob (Android app only). See the guide below for switching from test ads to your own ad units.

Release signing reads `android/keystore.properties`, which is git-ignored. See
[`release-builds/GOOGLE_PLAY_UPLOAD_GUIDE.md`](release-builds/GOOGLE_PLAY_UPLOAD_GUIDE.md) for creating a keystore and uploading to Google Play.
