import { Capacitor } from '@capacitor/core';
import { FIREBASE_CONFIG } from './cloud.js';
import { APP_VERSION, APP_BUILD } from './version.js';

// ---------------------------------------------------------------------------
// Error reporting
//
// Android vitals only sees native crashes. A JavaScript error inside the game's
// WebView would never reach you, so uncaught errors, failed promises and lost
// WebGL contexts are sent to Firestore (collection `errorReports`, see
// firestore.rules). Read them in the Firebase console > Firestore Database.
//
// Reports carry no account or personal data: the error text, game version,
// browser/device string and graphics chip. Duplicates are sent once and each
// session sends at most MAX_REPORTS, so a crash loop can't flood the database.
// Firebase is only loaded when the first report is sent.
// ---------------------------------------------------------------------------
const MAX_REPORTS = 6;
const sent = new Set();
let count = 0;
let context = { gpu: '', safeRender: false };
let dbPromise = null;

const clip = (v, n) => String(v ?? '').slice(0, n);

// main.js fills in details that help explain graphics problems
export function setErrorContext(extra) {
  context = { ...context, ...extra };
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const [{ initializeApp, getApps, getApp }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore/lite')]);
      const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
      return { db: fs.getFirestore(app), fs };
    })();
  }
  return dbPromise;
}

export async function reportError(kind, message, stack = '', where = '') {
  if (!FIREBASE_CONFIG || import.meta.env.DEV) return; // keep development noise out of the database
  const key = `${kind}|${message}|${where}`;
  if (sent.has(key) || count >= MAX_REPORTS) return;
  sent.add(key);
  count++;
  try {
    const { db, fs } = await getDb();
    await fs.addDoc(fs.collection(db, 'errorReports'), {
      kind: clip(kind, 40),
      message: clip(message, 500),
      stack: clip(stack, 3000),
      where: clip(where, 300),
      version: `${APP_VERSION} (${APP_BUILD})`,
      platform: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web',
      userAgent: clip(navigator.userAgent, 300),
      gpu: clip(context.gpu, 200),
      safeRender: Boolean(context.safeRender),
      at: fs.serverTimestamp()
    });
  } catch (e) {
    // Offline or blocked: nothing else to do
  }
}

window.addEventListener('error', (e) => {
  const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '';
  reportError('error', e.message || 'Unknown error', e.error && e.error.stack, where);
});

window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  reportError('promise', (r && r.message) || String(r), r && r.stack);
});
