# Snow Leopard: Mountain Hunter 🐆❄️
*A Wildcraft-inspired 3D animal simulator and mountain hunting RPG for Android and Web.*

---

## 🎮 How to Play

### Local Development Server
The game is currently running live at:
- **Desktop Browser:** [http://localhost:5173/](http://localhost:5173/)
- **Android Phone (on same Wi-Fi):** `http://192.168.4.68:5173/`

---

## 🕹️ Controls

| Action | Desktop Keyboard | Mobile Touch Screen |
| :--- | :--- | :--- |
| **Movement** | `W`, `A`, `S`, `D` or Arrow Keys | Left side virtual touch joystick |
| **Camera Orbit** | Left Click + Drag mouse | Right side swipe / drag |
| **Sprint** | `Shift` (hold or toggle) | ⚡ **Sprint** button |
| **Stalk / Sneak** | `C` key (toggle low crouch) | 🐾 **Stalk** button |
| **Pounce Attack** | `Space` or `F` | 💥 **Pounce** button |
| **Scent Vision** | `V` key | 👃 **Scent** button |
| **Eat / Feed** | `E` key (near downed carcass) | 🍖 **Eat** button |

---

## 🌲 Core Game Mechanics

### 1. 🐆 Snow Leopard Predator System
- **Stalking Mode:** Lowers body close to the snow, reduces movement noise by 80%, allowing close approach to skittish prey without triggering alert meters.
- **Sprint & Pounce:** High-speed pursuit with explosive leap arcs, dealing damage and claw swipes on impact.
- **Vital Stats:** Health, Stamina (depleted by sprints/pounces), and Hunger (drains over time; refill by eating).
- **RPG Progression:** Successful hunts grant XP. Leveling up permanently increases Max Health, Stamina, and Attack Power!

### 2. 🦌 Prey AI & Perception
- **Himalayan Ibex / Blue Sheep (Bharal):** Medium prey that roam in herds, graze on mountain moss, and sound alarm calls that trigger herd stampedes when startled.
- **Snow Hare:** Small, agile winter hare with evasive zigzag fleeing patterns.
- **Sense System:** Prey reacts to sight cones and footsteps sound volume (sprinting alerts from far; stalking allows close-range ambush).

### 3. 👃 Wildcraft Scent Vision
- Triggers a sensory sonar pulse across the snow.
- Displays wind-curling ethereal scent trails directly pointing toward living prey herds.
- Compass radar displays real-time target distance and heading.

---

## 📱 Packaging for Android

### Method 1: Instant PWA Install (No build tools needed)
1. Open the network URL `http://192.168.4.68:5173/` in **Google Chrome** on your Android device.
2. Tap the three dots menu `⋮` and select **"Install app"** or **"Add to Home screen"**.
3. The game will launch full-screen in landscape orientation without address bars, just like a native app.

### Method 2: Native Android APK via Capacitor
To bundle into an Android Studio `.apk`:
```bash
# In the project directory:
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Snow Leopard" "com.wildcraft.snowleopard" --web-dir dist
npm run build
npx cap add android
npx cap open android
```
Then click **Build > Build Bundle(s) / APK(s) > Build APK(s)** in Android Studio.
