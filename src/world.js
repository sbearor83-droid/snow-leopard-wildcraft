import * as THREE from 'three';
import { sounds } from './audio.js';

// ---------------------------------------------------------------------------
// World clock and weather
//
// A full day passes in 24 * HOUR_SECONDS real seconds (14 minutes). Snow
// leopards hunt mostly at dawn and dusk, so twilight is the best time to
// stalk; at night prey see less but so do you. Weather drifts between clear,
// snow and blizzard: a blizzard shortens how far prey see, hear and smell, and
// how far your Scent Vision reaches.
//
// `env` is read every frame by prey, wolves and scent vision.
// ---------------------------------------------------------------------------
export const HOUR_SECONDS = 35;

export const env = {
  hour: 8,
  daylight: 1, // 0 night .. 1 full day
  phase: 'day', // dawn | day | dusk | night
  sight: 1, // multiplier on how far prey can see
  hearing: 1, // multiplier on how far prey can hear
  scentRange: 120, // metres Scent Vision reaches
  blizzard: 0 // 0..1 storm strength
};

// Lighting keyframes by hour; values between keys are blended
const KEYS = [
  { h: 0, sky: 0x1b2542, fog: 0x1f2a44, hemiSky: 0x40568a, hemiGround: 0x2c3858, hemi: 0.62, light: 0xaec2ff, lightI: 0.7, exposure: 1.05, fogNear: 70, fogFar: 430 },
  { h: 4.8, sky: 0x1b2542, fog: 0x1f2a44, hemiSky: 0x40568a, hemiGround: 0x2c3858, hemi: 0.62, light: 0xaec2ff, lightI: 0.7, exposure: 1.05, fogNear: 70, fogFar: 430 },
  { h: 6.0, sky: 0x9a7d98, fog: 0xa596a8, hemiSky: 0x8192bd, hemiGround: 0xb5a3a3, hemi: 0.75, light: 0xff9e6c, lightI: 1.1, exposure: 1.0, fogNear: 90, fogFar: 520 },
  { h: 7.6, sky: 0xffffff, fog: 0xc9d9e8, hemiSky: 0x9ec4ea, hemiGround: 0xe4ebf1, hemi: 0.95, light: 0xfff3dc, lightI: 2.3, exposure: 1.0, fogNear: 110, fogFar: 640 },
  { h: 16.6, sky: 0xffffff, fog: 0xc9d9e8, hemiSky: 0x9ec4ea, hemiGround: 0xe4ebf1, hemi: 0.95, light: 0xffe6c0, lightI: 2.1, exposure: 1.0, fogNear: 110, fogFar: 640 },
  { h: 18.3, sky: 0xffa07c, fog: 0xc99c94, hemiSky: 0x9a8ab4, hemiGround: 0xc4aaa2, hemi: 0.78, light: 0xff8a52, lightI: 1.2, exposure: 1.0, fogNear: 90, fogFar: 520 },
  { h: 19.8, sky: 0x1b2542, fog: 0x1f2a44, hemiSky: 0x40568a, hemiGround: 0x2c3858, hemi: 0.62, light: 0xaec2ff, lightI: 0.7, exposure: 1.05, fogNear: 70, fogFar: 430 },
  { h: 24, sky: 0x1b2542, fog: 0x1f2a44, hemiSky: 0x40568a, hemiGround: 0x2c3858, hemi: 0.62, light: 0xaec2ff, lightI: 0.7, exposure: 1.05, fogNear: 70, fogFar: 430 }
];
const COLOR_FIELDS = ['sky', 'fog', 'hemiSky', 'hemiGround', 'light'];
const NUM_FIELDS = ['hemi', 'lightI', 'exposure', 'fogNear', 'fogFar'];
const BLIZZARD_FOG = new THREE.Color(0xd5dde6);

const _ca = new THREE.Color();
const _cb = new THREE.Color();
const _dir = new THREE.Vector3();

export function phaseOf(hour) {
  if (hour >= 5 && hour < 7.5) return 'dawn';
  if (hour >= 7.5 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19.8) return 'dusk';
  return 'night';
}

export class World {
  constructor({ scene, terrain, renderer, sunLight, rimLight, hemiLight }) {
    Object.assign(this, { scene, terrain, renderer, sunLight, rimLight, hemiLight });
    this.hour = 8;
    this.day = 1;
    this.weather = 'clear'; // clear | snow | blizzard
    this.weatherTarget = 0.35; // fraction of snowflakes falling
    this.blizzardTarget = 0;
    this.weatherHoursLeft = 3;
    this.onNewDay = null; // (day) => void
    this.onPhaseChange = null; // (phase) => void
    this.onWeatherChange = null; // (weather) => void
    this.lastPhase = phaseOf(this.hour);
    this.current = {};
    for (const f of COLOR_FIELDS) this.current[f] = new THREE.Color();
    this.createStars();
    this.apply(0, new THREE.Vector3(), true);
  }

  createStars() {
    const count = 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.9 + 0.1); // upper sky only
      pos[i * 3] = Math.sin(v) * Math.cos(u) * 600;
      pos[i * 3 + 1] = Math.cos(v) * 600;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 600;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  get phase() {
    return phaseOf(this.hour);
  }

  get isTwilight() {
    const p = this.phase;
    return p === 'dawn' || p === 'dusk';
  }

  get isNight() {
    return this.phase === 'night';
  }

  // e.g. "🌅 Dawn · Day 3"
  label() {
    const icon = { dawn: '🌅', day: '☀️', dusk: '🌇', night: '🌙' }[this.phase];
    const name = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' }[this.phase];
    const storm = this.weather === 'blizzard' ? ' · 🌨️ Blizzard' : this.weather === 'snow' ? ' · ❄️ Snow' : '';
    return `${icon} ${name} ${this.day}${storm}`;
  }

  // Skips time forward (resting). Returns how many new days began.
  skipHours(hours) {
    let days = 0;
    let left = hours;
    while (left > 0) {
      const step = Math.min(left, 24 - this.hour);
      this.hour += step;
      left -= step;
      if (this.hour >= 24) {
        this.hour -= 24;
        this.day++;
        days++;
        if (this.onNewDay) this.onNewDay(this.day);
      }
    }
    this.rollWeather(true);
    return days;
  }

  // Hours until the next 6:00
  hoursUntilDawn() {
    return this.hour < 6 ? 6 - this.hour : 30 - this.hour;
  }

  rollWeather(force = false) {
    this.weatherHoursLeft -= 1;
    if (!force && this.weatherHoursLeft > 0) return;
    const r = Math.random();
    const prev = this.weather;
    if (this.weather === 'clear') this.weather = r < 0.3 ? 'snow' : 'clear';
    else if (this.weather === 'snow') this.weather = r < 0.28 ? 'blizzard' : r < 0.65 ? 'clear' : 'snow';
    else this.weather = r < 0.7 ? 'snow' : 'blizzard';
    this.weatherHoursLeft = this.weather === 'blizzard' ? 2 + Math.random() * 2 : 2 + Math.random() * 4;
    this.weatherTarget = { clear: 0.35, snow: 0.7, blizzard: 1 }[this.weather];
    this.blizzardTarget = this.weather === 'blizzard' ? 1 : 0;
    if (prev !== this.weather && this.onWeatherChange) this.onWeatherChange(this.weather);
  }

  update(delta, playerPos) {
    const prevHour = this.hour;
    this.hour += delta / HOUR_SECONDS;
    if (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
      if (this.onNewDay) this.onNewDay(this.day);
    }
    if (Math.floor(this.hour) !== Math.floor(prevHour)) this.rollWeather();
    this.apply(delta, playerPos);
    const phase = this.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      if (this.onPhaseChange) this.onPhaseChange(phase);
    }
  }

  apply(delta, playerPos, instant = false) {
    // blend the lighting keyframes
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (this.hour >= KEYS[i].h && this.hour <= KEYS[i + 1].h) {
        a = KEYS[i];
        b = KEYS[i + 1];
        break;
      }
    }
    const t = (this.hour - a.h) / Math.max(0.0001, b.h - a.h);
    const c = this.current;
    for (const f of COLOR_FIELDS) c[f].copy(_ca.setHex(a[f])).lerp(_cb.setHex(b[f]), t);
    for (const f of NUM_FIELDS) c[f] = a[f] + (b[f] - a[f]) * t;

    // weather eases toward its target
    const k = instant ? 1 : Math.min(1, delta * 0.08);
    env.blizzard += (this.blizzardTarget - env.blizzard) * k;
    this.flakes = (this.flakes ?? this.weatherTarget) + (this.weatherTarget - (this.flakes ?? this.weatherTarget)) * k;
    const bz = env.blizzard;

    // sun by day, moon by night: the main light comes from whichever is up
    const ang = ((this.hour - 6) / 12) * Math.PI;
    const sunUp = Math.sin(ang);
    const fromSun = sunUp > -0.08;
    const a2 = fromSun ? ang : ang + Math.PI;
    _dir.set(Math.cos(a2) * 0.75, Math.max(0.18, Math.abs(Math.sin(a2))), 0.42).normalize();
    this.sunLight.position.set(playerPos.x + _dir.x * 120, playerPos.y + _dir.y * 120, playerPos.z + _dir.z * 120);
    this.sunLight.color.copy(c.light);
    // dip the light briefly as the sun hands over to the moon at the horizon
    const handover = THREE.MathUtils.smoothstep(Math.abs(sunUp), 0.0, 0.12);
    this.sunLight.intensity = c.lightI * (0.35 + 0.65 * handover) * (1 - bz * 0.55);
    this.rimLight.intensity = 0.7 * (0.4 + 0.6 * THREE.MathUtils.clamp(sunUp + 0.2, 0, 1));
    this.hemiLight.color.copy(c.hemiSky);
    this.hemiLight.groundColor.copy(c.hemiGround);
    this.hemiLight.intensity = c.hemi * (1 + bz * 0.15);
    this.renderer.toneMappingExposure = c.exposure;

    const fog = this.scene.fog;
    fog.color.copy(c.fog).lerp(_ca.copy(BLIZZARD_FOG).multiplyScalar(0.35 + 0.65 * THREE.MathUtils.clamp(sunUp + 0.5, 0, 1)), bz * 0.85);
    fog.near = THREE.MathUtils.lerp(c.fogNear, 14, bz);
    fog.far = THREE.MathUtils.lerp(c.fogFar, 120, bz);

    const terrain = this.terrain;
    if (terrain.skyDome) terrain.skyDome.material.color.copy(c.sky).lerp(fog.color, bz * 0.9);
    if (terrain.sunSprite) {
      const s = terrain.sunSprite;
      s.position.set(playerPos.x + _dir.x * 560, playerPos.y + _dir.y * 560, playerPos.z + _dir.z * 560);
      s.material.color.setHex(fromSun ? 0xffffff : 0xdce6ff);
      s.scale.setScalar(fromSun ? 150 : 70);
      s.material.opacity = (fromSun ? 1 : 0.85) * (1 - bz) * Math.max(0.15, handover);
    }
    env.daylight = THREE.MathUtils.clamp((sunUp + 0.15) / 0.5, 0, 1);
    this.stars.material.opacity = (1 - env.daylight) * 0.9 * (1 - bz);
    this.stars.position.set(playerPos.x, 0, playerPos.z);
    terrain.setWeather(this.flakes, bz);
    sounds.setWindStrength(1 + bz * 2.2);

    // what this means for hunting
    const phase = phaseOf(this.hour);
    env.hour = this.hour;
    env.phase = phase;
    env.sight = (phase === 'night' ? 0.6 : phase === 'day' ? 1 : 0.8) * (1 - 0.5 * bz);
    env.hearing = 1 - 0.4 * bz;
    env.scentRange = 120 - 50 * bz;
  }

  serialize() {
    return { hour: Math.round(this.hour * 100) / 100, day: this.day, weather: this.weather };
  }

  restore(data) {
    if (!data) return;
    if (Number.isFinite(data.hour)) this.hour = THREE.MathUtils.clamp(data.hour, 0, 23.99);
    if (Number.isFinite(data.day) && data.day >= 1) this.day = Math.floor(data.day);
    if (['clear', 'snow', 'blizzard'].includes(data.weather)) {
      this.weather = data.weather;
      this.weatherTarget = { clear: 0.35, snow: 0.7, blizzard: 1 }[this.weather];
      this.blizzardTarget = this.weather === 'blizzard' ? 1 : 0;
      env.blizzard = this.blizzardTarget;
      this.flakes = this.weatherTarget;
    }
    this.lastPhase = this.phase;
  }
}
