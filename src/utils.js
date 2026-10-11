const TWO_PI = Math.PI * 2;

// Wraps an angle difference into [-PI, PI] so turns always take the shortest way round
export function shortestAngleDiff(from, to) {
  let diff = (to - from) % TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  return diff;
}

// Lerp between two angles along the shortest arc, keeping the result within [-PI, PI]
export function lerpAngle(from, to, t) {
  const result = from + shortestAngleDiff(from, to) * Math.min(1, t);
  return shortestAngleDiff(0, result);
}

// Phones and tablets get the lighter rendering path (fewer fur shells, coarser terrain, no AA)
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent) || window.innerWidth <= 1024;
}
