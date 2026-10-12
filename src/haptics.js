import { settings } from './settings.js';

// Short vibrations for hits, kills and rewards (Android; ignored where unsupported)
export const HAPTIC = {
  hit: 25,
  kill: [30, 40, 70],
  hurt: 70,
  reward: [20, 40, 20],
  levelUp: [40, 60, 40, 60, 90],
  bite: [60, 30, 90]
};

export function buzz(pattern) {
  if (!settings.vibration || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch (e) {
    // Some WebViews throw without a user gesture; vibration is optional
  }
}
