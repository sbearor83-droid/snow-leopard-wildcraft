import { Capacitor, registerPlugin } from '@capacitor/core';
import { onLocalWrite, readSyncMeta, writeSyncMeta, readRawProgress, writeRawProgress, clearAllProgress, freezeWrites } from './save.js';
import { planSync, walletOf } from './cloudmerge.js';

// ---------------------------------------------------------------------------
// Cloud saves (Firebase: Google sign-in + Firestore) — OFF until configured
//
// Signed-in players' progress (accessories, Pelts, Crystals, daily rewards and
// their leopard) is kept in their Google account, so it survives reinstalls
// and moves to new phones. Merge rules are in cloudmerge.js.
//
// To turn it on:
//   1. Create a Firebase project at https://console.firebase.google.com
//   2. Build > Authentication > Sign-in method: enable Google.
//   3. Build > Firestore Database: create a database, then paste the rules from
//      firestore.rules (in this repo) into its Rules tab and publish.
//   4. Project settings > Your apps > add a Web app; copy its config object into
//      FIREBASE_CONFIG below.
//   5. For the Android app: in the same settings add an Android app with package
//      com.snowleopardworld.game and your signing key's SHA-1 (and the Play
//      Console app-signing SHA-1), download google-services.json into
//      android/app/, then run:
//        npm i @capacitor-firebase/authentication
//        npx cap sync android
//      (Google sign-in can't use a web popup inside the app, so it goes through
//      that native plugin.)
// ---------------------------------------------------------------------------
// Web app config from Firebase console > Project settings > Your apps. These values only
// identify the project (they are meant to ship in the app); firestore.rules controls access.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDmpiFvolcwHMn6y8GSamEoI6llpunSKT0',
  authDomain: 'snow-leopard-world.firebaseapp.com',
  projectId: 'snow-leopard-world',
  storageBucket: 'snow-leopard-world.firebasestorage.app',
  messagingSenderId: '148053120593',
  appId: '1:148053120593:web:901dcfd59ed8e7fe344a70'
};

// In the Android app, Google sign-in goes through the native plugin (step 5 above). Until it is
// installed and synced, keep cloud saves hidden there instead of showing a button that can't work.
function firebaseUsable() {
  if (!FIREBASE_CONFIG) return false;
  return !Capacitor.isNativePlatform() || Capacitor.isPluginAvailable('FirebaseAuthentication');
}

const UPLOAD_DELAY_MS = 60 * 1000; // batch local changes into one upload a minute

// --------------------------------------------------------------- providers
// Each provider offers: onUser(cb), signIn(), signOut(), load(uid), save(uid, expectedRev, data),
// deleteAccount(uid) (removes the cloud save and the sign-in account)
class ConflictError extends Error {}

async function createFirebaseProvider(config) {
  const [{ initializeApp }, authLib, fs] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore/lite')
  ]);
  const app = initializeApp(config);
  const native = Capacitor.isNativePlatform();
  const auth = authLib.initializeAuth(app, {
    persistence: [authLib.indexedDBLocalPersistence, authLib.browserLocalPersistence],
    popupRedirectResolver: native ? undefined : authLib.browserPopupRedirectResolver
  });
  const db = fs.getFirestore(app);
  // Native Google sign-in (installed with @capacitor-firebase/authentication, see setup above)
  const NativeAuth = native ? registerPlugin('FirebaseAuthentication') : null;

  return {
    onUser(callback) {
      authLib.onAuthStateChanged(auth, (u) => callback(u ? { uid: u.uid, name: u.displayName || u.email || 'Player' } : null));
    },
    async signIn() {
      if (NativeAuth) {
        const result = await NativeAuth.signInWithGoogle({ skipNativeAuth: true });
        const idToken = result && result.credential && result.credential.idToken;
        if (!idToken) throw new Error('Google sign-in was cancelled');
        await authLib.signInWithCredential(auth, authLib.GoogleAuthProvider.credential(idToken));
      } else {
        await authLib.signInWithPopup(auth, new authLib.GoogleAuthProvider());
      }
    },
    async signOut() {
      if (NativeAuth) await NativeAuth.signOut().catch(() => {});
      await authLib.signOut(auth);
    },
    async deleteAccount(uid) {
      await fs.deleteDoc(fs.doc(db, 'players', uid));
      try {
        await auth.currentUser.delete();
      } catch (e) {
        // Firebase may ask for a fresh sign-in before deleting the account itself;
        // the save is already gone, so just sign out.
        console.warn('Account deletion needs a recent sign-in:', e);
      }
      if (NativeAuth) await NativeAuth.signOut().catch(() => {});
      await authLib.signOut(auth);
    },
    async load(uid) {
      const snap = await fs.getDoc(fs.doc(db, 'players', uid));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { rev: d.rev, profile: d.profile || null, leopard: d.leopard || null };
    },
    // Writes only if the cloud is still at expectedRev; returns the new revision
    save(uid, expectedRev, data) {
      const ref = fs.doc(db, 'players', uid);
      return fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? snap.data().rev : 0;
        if (current !== expectedRev) throw new ConflictError('Cloud save changed on another device');
        const rev = expectedRev + 1;
        tx.set(ref, { schema: 1, rev, profile: data.profile || '', leopard: data.leopard || '', updatedAt: fs.serverTimestamp() });
        return rev;
      });
    }
  };
}

// Development only: a pretend cloud kept in this browser's storage, so sign-in
// and sync can be tried without a Firebase project. Open the dev server with ?cloud=mock
function createMockProvider() {
  const SERVER = 'mockCloud.server';
  const SESSION = 'mockCloud.user';
  const read = (k) => JSON.parse(localStorage.getItem(k) || 'null');
  let listener = null;
  const delay = () => new Promise((r) => setTimeout(r, 150));
  return {
    onUser(callback) {
      listener = callback;
      setTimeout(() => callback(read(SESSION)), 50);
    },
    async signIn() {
      await delay();
      const user = { uid: 'mock-player', name: 'Test Player' };
      localStorage.setItem(SESSION, JSON.stringify(user));
      listener(user);
    },
    async signOut() {
      localStorage.removeItem(SESSION);
      listener(null);
    },
    async deleteAccount(uid) {
      await delay();
      const server = read(SERVER) || {};
      delete server[uid];
      localStorage.setItem(SERVER, JSON.stringify(server));
      localStorage.removeItem(SESSION);
      listener(null);
    },
    async load(uid) {
      await delay();
      return (read(SERVER) || {})[uid] || null;
    },
    async save(uid, expectedRev, data) {
      await delay();
      const server = read(SERVER) || {};
      const current = server[uid] ? server[uid].rev : 0;
      if (current !== expectedRev) throw new ConflictError('Cloud save changed on another device');
      server[uid] = { rev: expectedRev + 1, profile: data.profile, leopard: data.leopard };
      localStorage.setItem(SERVER, JSON.stringify(server));
      return expectedRev + 1;
    }
  };
}

function mockRequested() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get('cloud') === 'mock';
}

// --------------------------------------------------------------- sync manager
class CloudSave {
  constructor() {
    this.available = firebaseUsable() || mockRequested();
    this.status = this.available ? 'starting' : 'off'; // off | starting | signed-out | signing-in | syncing | synced | error
    this.user = null;
    this.error = '';
    this.lastSyncAt = readSyncMeta().lastSyncAt || 0;
    this.provider = null;
    this.uploadTimer = null;
    this.syncing = null;
    this.listeners = new Set();
    this.beforeReload = () => {};
  }

  // Calls `callback` whenever status / user / last sync time change
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  setStatus(status, error = '') {
    this.status = status;
    this.error = error;
    this.listeners.forEach((cb) => cb(this));
  }

  // beforeReload: stops the game from saving while cloud data is swapped in
  async init({ beforeReload } = {}) {
    if (beforeReload) this.beforeReload = beforeReload;
    if (!this.available) return;
    try {
      this.provider = mockRequested() ? createMockProvider() : await createFirebaseProvider(FIREBASE_CONFIG);
    } catch (e) {
      console.warn('Cloud save unavailable:', e);
      this.setStatus('error', 'Cloud saves could not start.');
      return;
    }

    this.provider.onUser((user) => {
      this.user = user;
      if (user) this.sync();
      else this.setStatus('signed-out');
    });
    onLocalWrite(() => this.scheduleUpload());
    // Upload right away when the app goes to the background (it may never come back)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.uploadTimer) this.sync();
    });
  }

  scheduleUpload() {
    if (!this.user || this.uploadTimer) return;
    this.uploadTimer = setTimeout(() => this.sync(), UPLOAD_DELAY_MS);
  }

  async signIn() {
    if (!this.provider || this.user) return;
    this.setStatus('signing-in');
    try {
      await this.provider.signIn(); // onUser fires and starts the first sync
    } catch (e) {
      console.warn('Sign-in failed:', e);
      this.setStatus('signed-out', 'Sign-in was cancelled or failed. Please try again.');
    }
  }

  // Signing out leaves the progress in the cloud and starts this device fresh
  async signOut() {
    if (!this.provider || !this.user) return;
    await this.sync(); // push anything not uploaded yet
    await this.provider.signOut();
    freezeWrites();
    this.beforeReload();
    // Keep today's daily reward / stash state, or signing out and back in would hand them out again
    let daily = null;
    try {
      daily = JSON.parse(readRawProgress().profile || '{}').daily || null;
    } catch (e) {
      // No usable profile: nothing to keep
    }
    clearAllProgress();
    if (daily) writeRawProgress({ profile: JSON.stringify({ version: 1, owned: [], daily }), leopard: null });
    window.location.reload();
  }

  // Deletes the cloud save and sign-in account. Progress on this device is kept.
  async deleteAccount() {
    if (!this.provider || !this.user) return;
    const uid = this.user.uid;
    clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    this.setStatus('syncing');
    try {
      await this.provider.deleteAccount(uid);
      writeSyncMeta({ ...readSyncMeta(), uid: null, syncedRev: 0, lastSyncAt: 0, baseWallet: null });
      this.lastSyncAt = 0;
      this.setStatus('signed-out', 'Your cloud save was deleted. Progress on this device is kept.');
    } catch (e) {
      console.warn('Cloud save deletion failed:', e);
      this.setStatus('error', "Couldn't delete your cloud save. Check your connection and try again.");
    }
  }

  // Runs one sync; concurrent calls share the same run
  sync() {
    if (!this.user) return Promise.resolve();
    if (!this.syncing) {
      this.syncing = this.runSync().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  async runSync(attempt = 1) {
    clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    const uid = this.user.uid;
    this.setStatus('syncing');
    try {
      const startedAt = Date.now();
      const meta = readSyncMeta();
      const local = readRawProgress();
      const remote = await this.provider.load(uid);
      const plan = planSync(local, remote, meta, uid);

      let rev = remote ? remote.rev : 0;
      if (plan.upload) rev = await this.provider.save(uid, rev, plan.result);

      // Only after the cloud has accepted it: record what we synced
      writeSyncMeta({
        ...readSyncMeta(),
        uid,
        syncedRev: rev,
        lastSyncAt: startedAt, // changes made while syncing still count as unsynced
        baseWallet: walletOf(plan.result.profile)
      });
      this.lastSyncAt = Date.now();

      if (plan.applyLocally) {
        // Cloud data differs from what the game has loaded: store it and restart
        this.setStatus('restoring');
        freezeWrites();
        this.beforeReload();
        writeRawProgress(plan.result);
        window.location.reload();
        return;
      }
      this.setStatus('synced');
    } catch (e) {
      if (e instanceof ConflictError && attempt < 3) return this.runSync(attempt + 1);
      console.warn('Cloud sync failed:', e);
      this.setStatus('error', "Couldn't reach the cloud. Your progress is safe on this device and will sync later.");
      this.scheduleUpload();
    }
  }
}

export const cloud = new CloudSave();
