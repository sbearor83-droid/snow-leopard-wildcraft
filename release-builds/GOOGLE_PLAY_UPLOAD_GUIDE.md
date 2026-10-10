# Google Play Store Upload & Release Guide 🚀

Your game has been compiled and signed into production-ready Android artifacts.

---

## 📁 Release Artifacts
Located in: `C:\Users\bearo\.gemini\antigravity\scratch\snow-leopard-wildcraft\release-builds\`

| File | Purpose |
| :--- | :--- |
| **`SnowLeopard-MountainHunter.aab`** | **The file to upload to Google Play Console** (Android App Bundle format, required by Google). |
| **`SnowLeopard-MountainHunter.apk`** | **Standalone installable APK** (can be sent to any Android phone via USB, Google Drive, or email and installed immediately). |
| **`release.keystore`** | **The digital release certificate** used to sign the game. Keep this file safe! |

---

## 🔑 Signing Certificate Credentials
Store these securely. Google Play uses these to verify updates to your game:

* **Keystore File:** `release.keystore`
* **Keystore Password:** `snowleopard123`
* **Key Alias:** `snowleopard`
* **Key Password:** `snowleopard123`
* **Package Name (Application ID):** `com.snowleopard.mountainhunter`
* **Version Code:** `1`
* **Version Name:** `1.0`
* **Target SDK:** API 35 (Android 15 ready, exceeds Google Play API 34+ requirement)

---

## 📲 How to Upload to Google Play Developer Console

1. **Log in to Google Play Console:**
   * Go to [https://play.google.com/console](https://play.google.com/console).
2. **Create New App:**
   * Click **Create app**.
   * App name: `Snow Leopard: Mountain Hunter`
   * Default language: `English (United States)`
   * App or game: **Game**
   * Free or paid: **Free** (or your preference).
3. **App Releases:**
   * In the left sidebar under *Release*, go to **Production** (or **Internal testing** / **Closed testing** for your first test run).
   * Click **Create new release**.
   * Drag and drop `SnowLeopard-MountainHunter.aab` into the *App bundles* upload box.
   * Release name will automatically populate as `1.0 (1)`.
   * Add Release notes: *"Initial release of Snow Leopard: Mountain Hunter! Stalk through snowy mountain peaks, track herds with scent vision, and pounce on prey."*
   * Click **Save** and **Review release**.
4. **Store Presence & Listing:**
   * Under *Grow > Store presence > Main store listing*:
     * Short description: `3D Snow Leopard mountain hunting simulator with stealth and scent tracking.`
     * Full description: Describe the game features (Mountain exploration, stalking herds of Himalayan Ibex and Snow Hares, Wildcraft-style scent vision, XP progression, and survival stats).
     * Graphics: Add the app icon (512x512) and gameplay screenshots (captured from your browser or device).
5. **Roll out Release:**
   * Once Google reviews your listing checklist (Content Rating, Target Audience, Privacy Policy), click **Start rollout to Production**!
