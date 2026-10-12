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

// ---------------------------------------------------------------------------
// Safe render mode (no shadow maps)
//
// The PowerVR driver on the Pixel 10 family (Tensor G5, "PowerVR D-Series DXT") fails to link
// three.js's shadow-map shaders and drops the whole WebGL context a moment after the first frame,
// leaving a blank canvas (three.js #34311). Shadow maps are switched off on those GPUs up front.
// Any other device whose GL context dies gets the same mode remembered for its next launch.
// ---------------------------------------------------------------------------
const SAFE_RENDER_KEY = 'slw.safeRender';

export function isSafeRenderMode() {
  try {
    return localStorage.getItem(SAFE_RENDER_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSafeRenderMode() {
  try {
    localStorage.setItem(SAFE_RENDER_KEY, '1');
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

// Unmasked GPU name, e.g. "ANGLE (Imagination Technologies, PowerVR D-Series DXT-48-1536, ...)"
export function gpuRendererName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

export function gpuHasShadowMapBug(rendererName) {
  return /PowerVR|Imagination|\bIMG\b/i.test(rendererName);
}
