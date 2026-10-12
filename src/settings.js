// ---------------------------------------------------------------------------
// Player settings (sound, camera, graphics, vibration). Kept on this device only;
// they are not part of the save or cloud sync.
// ---------------------------------------------------------------------------
const KEY = 'snowLeopardWorld.settings';

export const QUALITY_LEVELS = ['auto', 'low', 'high'];

const DEFAULTS = {
  master: 0.8, // 0..1
  effects: 1.0,
  ambience: 0.7,
  camSensitivity: 1.0, // 0.4..2
  invertY: false,
  quality: 'auto', // auto | low | high (applied on restart)
  vibration: true
};

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = {};
    for (const [k, def] of Object.entries(DEFAULTS)) {
      const v = data[k];
      if (typeof def === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof def === 'boolean' && typeof v === 'boolean') out[k] = v;
      else if (k === 'quality' && QUALITY_LEVELS.includes(v)) out[k] = v;
    }
    return out;
  } catch (e) {
    return {};
  }
}

export const settings = { ...DEFAULTS, ...load() };

const listeners = [];

export function onSettingsChange(callback) {
  listeners.push(callback);
  callback(settings);
}

export function updateSettings(changes) {
  Object.assign(settings, changes);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    // Storage unavailable: settings last for this session only
  }
  for (const cb of listeners) cb(settings);
}
