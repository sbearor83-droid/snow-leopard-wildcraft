# Google Play Store Upload & Release Guide 🚀

Built `.apk` / `.aab` files go in this folder but are **not committed to git** (see `.gitignore`).
Attach them to a GitHub Release or upload them straight to the Play Console instead.

| File | Purpose |
| :--- | :--- |
| **`SnowLeopardWorld.aab`** | The file to upload to Google Play Console (Android App Bundle). |
| **`SnowLeopardWorld.apk`** | Standalone installable APK for sideloading onto a phone. |

---

## 💰 Ads (AdMob)

The game ships with Google's **test** ads so it can't crash or earn invalid revenue before you're set up.
Ads appear on the death screen: a rewarded ad to revive on the spot, and an interstitial (at most every 3 minutes) when respawning at camp.

To switch to real ads:
1. Sign up at https://admob.google.com and add an Android app called **Snow Leopard World**.
   If it's already on Google Play, link it; otherwise choose "not published yet" and link it later.
2. Create two ad units: **Rewarded** (e.g. `Revive`) and **Interstitial** (e.g. `Respawn`).
3. Put the **App ID** (`ca-app-pub-…~…`) in `android/app/src/main/res/values/strings.xml` → `admob_app_id`.
4. Put the two **ad unit IDs** (`ca-app-pub-…/…`) in `src/ads.js` → `AD_UNITS`, and set `TEST_MODE = false`.
5. Under **Privacy & messaging** in AdMob, create a **GDPR** message (and a **US state regulations** message) so the consent form appears where required.
6. Rebuild (`npm run android`) and upload a new version (bump `versionCode`).
7. Optional but recommended: publish an `app-ads.txt` file on your developer website (AdMob shows the exact line under **Apps → app-ads.txt**).

**Never tap your own live ads.** Test on your phone with `TEST_MODE = true`, or add your phone as a test device in AdMob.

---

## 🔑 Signing Setup

Signing credentials are **never** stored in source control. The release build reads them from
`android/keystore.properties`, which is git-ignored.

1. Create a release keystore (once), choosing a strong password:
   ```bash
   cd android/app
   keytool -genkeypair -v -keystore release.keystore -alias snowleopard -keyalg RSA -keysize 2048 -validity 10000
   ```
   `*.keystore` files are git-ignored. **Back the keystore and its password up somewhere safe** (e.g. a password manager) — losing it means you can't sign updates.
2. Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the password and alias.
3. Build:
   ```bash
   npm run android
   cd android
   ./gradlew bundleRelease   # -> app/build/outputs/bundle/release/app-release.aab
   ./gradlew assembleRelease # -> app/build/outputs/apk/release/app-release.apk
   ```
   (On Windows use `gradlew.bat`.)

Google Play requires new apps to target a recent Android API level; `targetSdkVersion` is set in `android/variables.gradle`.

Enroll in **Play App Signing** when you create the app (the default). Google then holds the real app-signing key and your keystore is only the *upload* key, which Google can reset if it is ever lost or leaked.

Before each new Play upload, bump `versionCode` (and usually `versionName`) in `android/app/build.gradle`.

---

## 📲 How to Upload to Google Play Developer Console

1. **Log in to Google Play Console:** [https://play.google.com/console](https://play.google.com/console).
2. **Create New App:**
   * Click **Create app**.
   * App name: `Snow Leopard World`
   * Default language: `English (United States)`
   * App or game: **Game**
   * Free or paid: **Free** (or your preference).
3. **App Releases:**
   * In the left sidebar under *Release*, go to **Production** (or **Internal testing** / **Closed testing** for your first test run).
   * Click **Create new release**.
   * Drag and drop the `.aab` into the *App bundles* upload box.
   * Add release notes, e.g. *"Initial release of Snow Leopard World! Stalk through snowy mountain peaks, track herds with scent vision, and pounce on prey."*
   * Click **Save** and **Review release**.
4. **Store Presence & Listing:**
   * Under *Grow > Store presence > Main store listing*:
     * Short description: `3D Snow Leopard mountain hunting simulator with stealth and scent tracking.`
     * Full description: mountain exploration, stalking herds of Himalayan Ibex and Snow Hares, boss yaks, scent vision, XP progression, and survival stats.
     * Graphics: app icon (512x512) and gameplay screenshots.
5. **Roll out Release:**
   * Once the listing checklist is complete (Content Rating, Target Audience, Privacy Policy), click **Start rollout to Production**.
