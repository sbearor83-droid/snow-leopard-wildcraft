// Procedural Audio Engine using Web Audio API for Snow Leopard Game
class SoundManager {
  constructor() {
    this.ctx = null;
    this.windNode = null;
    this.lastStepTime = 0;
    this.footstepBuffer = null;
  }

  // Must be called from a user gesture (browsers block audio until then)
  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      // master -> speakers, with separate effects and ambience channels for the volume settings
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.amb = this.ctx.createGain();
      this.amb.connect(this.master);
      this.applyVolumes();
      this.startAmbientWind();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Volume settings (0..1 each). Ambience also rises with the wind during blizzards.
  setVolumes({ master, effects, ambience }) {
    this.volumes = { master, effects, ambience };
    this.applyVolumes();
  }

  setWindStrength(strength) {
    this.windStrength = strength;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx || !this.master) return;
    const v = this.volumes || { master: 0.8, effects: 1, ambience: 0.7 };
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(v.effects, t, 0.05);
    this.amb.gain.setTargetAtTime(v.ambience * (this.windStrength || 1), t, 0.6);
  }

  // Silences the game while a full-screen ad plays its own audio
  setSuspended(suspended) {
    if (!this.ctx) return;
    if (suspended) this.ctx.suspend();
    else this.ctx.resume();
  }

  // True when sounds can be played right now
  isReady() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  playFootstep(isSprinting = false, isStalking = false) {
    if (!this.isReady()) return;

    const now = this.ctx.currentTime;
    const interval = isStalking ? 0.6 : (isSprinting ? 0.22 : 0.38);
    if (now - this.lastStepTime < interval) return;
    this.lastStepTime = now;

    // Snow crunch: filtered white noise burst with quick decay (generated once, reused)
    if (!this.footstepBuffer) {
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
      this.footstepBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = this.footstepBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
      }
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.footstepBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isStalking ? 500 : 900, now);

    const gain = this.ctx.createGain();
    const volume = isStalking ? 0.04 : (isSprinting ? 0.18 : 0.1);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfx);
    noise.start();
  }

  playPounce() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    // 1. Whoosh leap sound (frequency ramp down)
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.35);

    oscGain.gain.setValueAtTime(0.3, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

    osc.connect(oscGain);
    oscGain.connect(this.sfx);
    osc.start();
    osc.stop(now + 0.36);

    // 2. Snow Leopard Growl / Snarl
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.4);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.4);
    filter.Q.setValueAtTime(3.5, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.005, now + 0.4);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfx);
    noise.start();
  }

  playAttackHit() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    // Thud impact
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start();
    osc.stop(now + 0.22);
  }

  playSwipe() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    // Fast claw swipe whoosh & scratch
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.15);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.15);

    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start();
    osc.stop(now + 0.16);
  }

  playBossGrunt() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.45);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start();
    osc.stop(now + 0.46);
  }

  playEat() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    // Bite crunch
    for (let i = 0; i < 2; i++) {
      const delay = i * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280 + i * 40, now + delay);
      osc.frequency.exponentialRampToValueAtTime(110, now + delay + 0.08);

      gain.gain.setValueAtTime(0.25, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.08);

      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start(now + delay);
      osc.stop(now + delay + 0.09);
    }
  }

  playPreyAlert() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(950, now + 0.12);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start();
    osc.stop(now + 0.16);
  }

  playScentSonar() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;

    const freqs = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    freqs.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.06);

      gain.gain.setValueAtTime(0.12, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.4);

      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.45);
    });
  }

  playLevelUp() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);

      gain.gain.setValueAtTime(0.2, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);

      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.4);
    });
  }

  // Short sine notes with soft decay; used for the treasure sounds
  playChimeNotes(notes, step, volume, length) {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      const t = now + idx * step;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start(t);
      osc.stop(t + length + 0.05);
    });
  }

  // Faint twinkle when the leopard first gets close to hidden treasure
  playTreasureNear() {
    this.playChimeNotes([1567.98, 2093.0], 0.09, 0.05, 0.5);
  }

  // Sparkling arpeggio when treasure is dug up
  playTreasureFound() {
    this.playChimeNotes([783.99, 987.77, 1174.66, 1567.98, 1975.53], 0.07, 0.12, 0.6);
  }

  // ------------------------------------------------------------------ animal voices
  // Snow leopards can't roar. They chuff (a breathy friendly greeting), yowl (long calls in
  // mating season), hiss and growl. All synthesized, so there are no audio files to ship.
  noiseBuffer() {
    if (!this.noiseBuf) {
      const n = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  // Filtered noise puff: type 'bandpass' | 'lowpass' | 'highpass'
  noisePuff(start, length, freq, q, volume, type = 'bandpass', freqEnd = freq) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, start);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + length);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.04, length * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(start, Math.random() * 0.5);
    src.stop(start + length + 0.02);
  }

  // Voiced tone with a pitch contour [[time, Hz], ...] through a formant filter
  voice(start, contour, volume, { type = 'sawtooth', formant = 900, q = 3, vibrato = 0 } = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(contour[0][1], start);
    for (const [t, hz] of contour.slice(1)) osc.frequency.exponentialRampToValueAtTime(hz, start + t);
    const length = contour[contour.length - 1][0];
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 6;
      lfoGain.gain.value = vibrato;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + length + 0.05);
    }
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = formant;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.12, length * 0.2));
    g.gain.setValueAtTime(volume, start + length * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  playChuff() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.noisePuff(now + i * 0.17, 0.12, 700, 1.4, 0.32, 'bandpass', 380);
  }

  playYowl() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    this.voice(now, [[0, 260], [0.5, 430], [1.2, 390], [1.9, 230]], 0.22, { formant: 820, q: 2.2, vibrato: 9 });
    this.noisePuff(now, 1.9, 1400, 0.8, 0.05, 'bandpass', 900);
  }

  playHiss() {
    if (!this.isReady()) return;
    this.noisePuff(this.ctx.currentTime, 0.55, 4200, 0.7, 0.22, 'highpass', 3000);
  }

  playGrowl() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    this.voice(now, [[0, 95], [0.5, 110], [0.9, 80]], 0.3, { type: 'sawtooth', formant: 380, q: 1.5, vibrato: 14 });
    this.noisePuff(now, 0.9, 300, 1, 0.12, 'lowpass', 200);
  }

  playCubMew() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    this.voice(now, [[0, 700], [0.15, 980], [0.35, 760]], 0.12, { type: 'triangle', formant: 1400, q: 2 });
  }

  playMarmotWhistle() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    this.voice(now, [[0, 2300], [0.08, 2700], [0.22, 2200]], 0.12, { type: 'sine', formant: 2500, q: 1 });
  }

  playWolfHowl(distance = 60) {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    const vol = Math.max(0.03, 0.2 * (1 - Math.min(1, distance / 160)));
    this.voice(now, [[0, 380], [0.6, 620], [1.8, 600], [2.6, 420]], vol, { type: 'triangle', formant: 650, q: 1.5, vibrato: 5 });
  }

  playBirdCall() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) this.voice(now + i * 0.28, [[0, 520], [0.18, 380]], 0.07, { type: 'sawtooth', formant: 1100, q: 2 });
  }

  playThroatBite() {
    if (!this.isReady()) return;
    const now = this.ctx.currentTime;
    this.noisePuff(now, 0.25, 600, 1, 0.35, 'lowpass', 180);
    this.voice(now + 0.05, [[0, 160], [0.4, 90]], 0.18, { formant: 400, q: 1.2 });
  }

  startAmbientWind() {
    if (!this.ctx || this.windNode) return;
    try {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.amb);

      noise.start();
      this.windNode = noise;
    } catch (e) {
      console.warn("Could not start ambient wind audio:", e);
    }
  }
}

export const sounds = new SoundManager();
