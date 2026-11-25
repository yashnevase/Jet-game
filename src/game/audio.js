// ─────────────────────────────────────────────────────────────
//  audio.js: Procedural Web Audio synthesiser for VECTOR // AERO.
//  Zero external audio files. Everything is oscillators + one shared noise buffer.
//
//  Signal chain:   voices ─► master (mute/volume) ─► compressor ─► destination
//                  engine loop ─► engineBus (pause/phase duck) ─► master
//
//  Layers
//   • Engine: turbine whine + sub rumble + wind rush + afterburner roar, all driven every frame
//     from airspeed / throttle / afterburner via tick().
//   • Cannon: low thump + crisp noise transient + body tone, pitch-jittered so it never machine-guns.
//   • Missile: ignition thud + rising/falling filtered-noise whoosh. Bomb: pylon release clack.
//   • Explosions: sub boom + low-passed noise sweep + crackle pops, scaled by blast size and distance.
//   • Warnings: GPWS, hull hit, stall buzzer, lock tone, incoming-threat tick, enemy telegraph tick.
//  Mute persists. Pause ducks engine and silences world SFX but keeps UI clicks alive.
// ─────────────────────────────────────────────────────────────

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const MAX_VOICES = 44;

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineBus = null;
    this.noise = null;
    this.eng = null; // engine loop nodes
    this.muted = false;
    this.paused = false;
    this.voices = 0;
    this.last = {}; // per-sound rate limiters (performance.now ms)
    this.lockNext = 0;
    this.stallNext = 0;
    this.incomingNext = 0;
    try {
      this.muted = typeof localStorage !== 'undefined' && localStorage.getItem('lowline.muted') === '1';
    } catch (_) {}
  }

  // ── lifecycle ─────────────────────────────────────────────
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.engineBus = ctx.createGain();
      this.engineBus.gain.value = 0;
      this.engineBus.connect(this.master);
      // 2 s of white noise, shared by every noise voice
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.buildEngine();
    } catch (_) {
      this.ctx = null;
    }
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get live() { return !!this.ctx && !this.muted && !this.paused; }

  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem('lowline.muted', this.muted ? '1' : '0'); } catch (_) {}
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.03);
    return this.muted;
  }
  toggleMute() { this.resume(); const m = this.setMuted(!this.muted); if (!m) this.uiClick(); return m; }

  // Pause/resume: click + hard duck of the engine loop. The context keeps running so resume is instant.
  setPaused(p, silent = false) {
    if (this.paused === !!p) return;
    this.paused = !!p;
    if (!this.ctx) return;
    this.engineBus.gain.cancelScheduledValues(this.ctx.currentTime);
    if (this.paused) this.engineBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    if (!silent) this.pauseClick(this.paused);
  }

  // ── building blocks ───────────────────────────────────────
  _voice(dur) {
    this.voices++;
    return setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, (dur + 0.1) * 1000);
  }

  // Oscillator with exponential pitch + gain envelope.
  tone({ type = 'sine', f0, f1 = f0, dur = 0.1, gain = 0.2, delay = 0, attack = 0.002, bus = null, detune = 0 }) {
    const ctx = this.ctx;
    if (!ctx || this.voices > MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
    this._voice(dur + delay);
  }

  // Filtered noise burst with a filter sweep.
  burst({ type = 'lowpass', f0 = 1000, f1 = f0, q = 0.7, dur = 0.2, gain = 0.2, delay = 0, attack = 0.002, bus = null }) {
    const ctx = this.ctx;
    if (!ctx || this.voices > MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus || this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
    this._voice(dur + delay);
  }

  rate(key, ms) {
    const now = performance.now();
    if (now - (this.last[key] || 0) < ms) return false;
    this.last[key] = now;
    return true;
  }

  // ── UI (works while paused, respects mute) ────────────────
  uiHover() {
    if (!this.ctx || this.muted) return;
    this.tone({ type: 'sine', f0: 1400, f1: 1800, dur: 0.035, gain: 0.05 });
  }
  uiClick() {
    if (!this.ctx || this.muted) return;
    this.tone({ type: 'triangle', f0: 800, f1: 240, dur: 0.07, gain: 0.16 });
    this.burst({ type: 'highpass', f0: 4000, dur: 0.012, gain: 0.05 });
  }
  pauseClick(down) {
    if (!this.ctx || this.muted) return;
    // two-note mechanical switch: falling on pause, rising on resume
    const a = down ? 900 : 520;
    const b = down ? 480 : 1000;
    this.tone({ type: 'square', f0: a, f1: a * 0.8, dur: 0.045, gain: 0.07 });
    this.tone({ type: 'triangle', f0: b, f1: b * 0.7, dur: 0.07, gain: 0.12, delay: 0.05 });
    this.burst({ type: 'highpass', f0: 3500, dur: 0.015, gain: 0.05 });
  }

  // ── weapons ───────────────────────────────────────────────
  shoot(gunId) {
    if (!this.live) return;
    const j = rand(0.94, 1.06);
    if (gunId === 'cannon') {
      // Bofors 57mm: chest-thump, armour-piercing crack, long low tail
      this.tone({ type: 'sine', f0: 150 * j, f1: 34, dur: 0.34, gain: 0.5 });
      this.tone({ type: 'sawtooth', f0: 320 * j, f1: 60, dur: 0.2, gain: 0.22 });
      this.burst({ type: 'bandpass', f0: 2600, f1: 700, q: 0.9, dur: 0.09, gain: 0.34 });
      this.burst({ type: 'lowpass', f0: 900, f1: 120, dur: 0.3, gain: 0.2, delay: 0.01 });
    } else if (gunId === 'scatter') {
      for (let i = 0; i < 3; i++) {
        this.tone({ type: 'square', f0: (460 - i * 40) * j, f1: 90, dur: 0.1, gain: 0.1, delay: i * 0.012 });
        this.burst({ type: 'bandpass', f0: 2200, f1: 600, q: 1.2, dur: 0.05, gain: 0.14, delay: i * 0.012 });
      }
      this.tone({ type: 'sine', f0: 110, f1: 40, dur: 0.18, gain: 0.3 });
    } else {
      // GSh-30: thump + crisp transient + body, pitched around so the stream sounds mechanical, not looped
      this.tone({ type: 'sine', f0: 130 * j, f1: 50, dur: 0.11, gain: 0.3 });
      this.tone({ type: 'triangle', f0: 700 * j, f1: 120, dur: 0.065, gain: 0.12 });
      this.burst({ type: 'highpass', f0: 3200, f1: 2000, dur: 0.03, gain: 0.17 });
    }
  }

  missileLaunch() {
    if (!this.live) return;
    // pneumatic ejector clunk, then motor ignition and a long whoosh
    this.tone({ type: 'sine', f0: 170, f1: 55, dur: 0.16, gain: 0.34 });
    this.burst({ type: 'bandpass', f0: 500, f1: 2800, q: 0.8, dur: 0.55, gain: 0.34, delay: 0.1, attack: 0.08 });
    this.burst({ type: 'lowpass', f0: 1800, f1: 200, dur: 0.8, gain: 0.2, delay: 0.1, attack: 0.05 });
    this.tone({ type: 'sawtooth', f0: 110, f1: 260, dur: 0.45, gain: 0.07, delay: 0.1, attack: 0.08 });
  }

  bombDrop() {
    if (!this.live) return;
    // pylon release: sharp latch click, heavy thunk, then a falling whistle
    this.tone({ type: 'square', f0: 2200, f1: 900, dur: 0.012, gain: 0.16 });
    this.tone({ type: 'triangle', f0: 260, f1: 80, dur: 0.14, gain: 0.3 });
    this.burst({ type: 'bandpass', f0: 1800, q: 2, dur: 0.03, gain: 0.12 });
    this.tone({ type: 'sine', f0: 1500, f1: 520, dur: 0.9, gain: 0.025, delay: 0.1, attack: 0.1 });
  }

  dryFire() { // out of ordnance: hollow click
    if (!this.live || !this.rate('dry', 120)) return;
    this.tone({ type: 'square', f0: 300, f1: 180, dur: 0.03, gain: 0.08 });
    this.burst({ type: 'bandpass', f0: 2400, q: 2, dur: 0.02, gain: 0.06 });
  }

  // ── explosions: size ~0.6 (small) .. 3.5 (carrier); dist in world units from the player ──
  explode(size = 1, dist = 0) {
    if (!this.live) return;
    if (size === true) size = 2;
    else if (size === false) size = 0.8;
    size = clamp(size, 0.3, 4);
    const fall = 1 / (1 + (dist || 0) / 520);
    if (fall < 0.12) return;
    if (!this.rate('boom', 35)) return;
    const k = clamp(0.22 + size * 0.2, 0.2, 0.95) * fall;
    const dur = 0.35 + size * 0.28;
    this.tone({ type: 'sine', f0: 95 / Math.pow(size, 0.25), f1: 22, dur, gain: k * 0.95, attack: 0.004 }); // sub boom
    this.tone({ type: 'sawtooth', f0: 180, f1: 30, dur: dur * 0.7, gain: k * 0.28 });
    this.burst({ type: 'lowpass', f0: 2600, f1: 160, q: 0.6, dur: dur * 1.25, gain: k * 0.75, attack: 0.003 }); // body
    this.burst({ type: 'highpass', f0: 5000, dur: 0.025, gain: k * 0.3 }); // initial crack
    const pops = Math.round(2 + size * 2);
    for (let i = 0; i < pops; i++) {
      this.burst({ type: 'bandpass', f0: rand(900, 3200), q: 1.4, dur: rand(0.02, 0.05), gain: k * rand(0.12, 0.26), delay: rand(0.06, 0.2 + size * 0.14) }); // crackle
    }
  }
  bombExplode() { this.explode(2.4, 0); }

  hitmarker(isKill = false) {
    if (!this.live) return;
    if (isKill) {
      this.tone({ type: 'sine', f0: 1200, f1: 1800, dur: 0.14, gain: 0.2 });
      this.tone({ type: 'sine', f0: 1800, f1: 2400, dur: 0.1, gain: 0.12, delay: 0.07 });
    } else {
      if (!this.rate('hit', 28)) return;
      this.tone({ type: 'sine', f0: 2200, f1: 950, dur: 0.045, gain: 0.14 });
    }
  }

  // Player took damage: dull clang + metal rattle + low thud. sev 0..1
  hullHit(sev = 0.5) {
    if (!this.live) return;
    const k = 0.25 + sev * 0.35;
    this.tone({ type: 'triangle', f0: 420, f1: 300, dur: 0.28, gain: k * 0.6 });
    this.tone({ type: 'triangle', f0: 593, f1: 410, dur: 0.22, gain: k * 0.45 });
    this.tone({ type: 'sine', f0: 100, f1: 38, dur: 0.3, gain: k });
    this.burst({ type: 'bandpass', f0: 1500, f1: 500, q: 1.6, dur: 0.18, gain: k * 0.8 });
  }

  // ── warnings ──────────────────────────────────────────────
  gpwsWarning() {
    if (!this.live || !this.rate('gpws', 650)) return;
    this.tone({ type: 'square', f0: 880, f1: 880, dur: 0.1, gain: 0.1 });
    this.tone({ type: 'square', f0: 660, f1: 660, dur: 0.12, gain: 0.1, delay: 0.1 });
  }
  stallWarning() {
    if (!this.live || !this.rate('stall', 180)) return;
    this.tone({ type: 'sawtooth', f0: 150, f1: 140, dur: 0.12, gain: 0.12 });
  }
  lockPing(locked) {
    if (!this.live) return;
    this.tone({ type: 'sine', f0: locked ? 1900 : 1250, dur: locked ? 0.1 : 0.05, gain: locked ? 0.1 : 0.07 });
  }
  incomingTick(urgency = 0.5) {
    if (!this.live) return;
    this.tone({ type: 'square', f0: 1050 + urgency * 500, dur: 0.05, gain: 0.08 + urgency * 0.05 });
  }
  threatTick() { // enemy telegraph: a gun is about to fire at you
    if (!this.live || !this.rate('threat', 140)) return;
    this.tone({ type: 'square', f0: 1500, dur: 0.035, gain: 0.05 });
    this.tone({ type: 'square', f0: 1200, dur: 0.035, gain: 0.05, delay: 0.05 });
  }
  chain(mult = 2) {
    if (!this.live) return;
    const f = 520 * Math.pow(1.122, Math.min(mult, 8));
    this.tone({ type: 'triangle', f0: f, f1: f * 1.5, dur: 0.12, gain: 0.1 });
  }
  rankUp() {
    if (!this.live) return;
    [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'triangle', f0: 440 * Math.pow(2, s / 12), dur: 0.16, gain: 0.12, delay: i * 0.07 }));
  }

  // ── continuous engine loop ───────────────────────────────
  buildEngine() {
    const ctx = this.ctx;
    const out = this.engineBus;
    // turbine whine
    const turb = ctx.createOscillator();
    turb.type = 'sawtooth';
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    const tg = ctx.createGain();
    turb.connect(tf); tf.connect(tg); tg.connect(out);
    // sub rumble
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    const sg = ctx.createGain();
    sub.connect(sg); sg.connect(out);
    // wind rush
    const wn = ctx.createBufferSource();
    wn.buffer = this.noise; wn.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass'; wf.Q.value = 0.7;
    const wg = ctx.createGain();
    wn.connect(wf); wf.connect(wg); wg.connect(out);
    // afterburner roar
    const rn = ctx.createBufferSource();
    rn.buffer = this.noise; rn.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    const rg = ctx.createGain();
    rn.connect(rf); rf.connect(rg); rg.connect(out);
    tg.gain.value = sg.gain.value = wg.gain.value = rg.gain.value = 0;
    turb.start(); sub.start(); wn.start(); rn.start(0.37);
    this.eng = { turb, tf, tg, sub, sg, wf, wg, rf, rg };
  }

  // Called once per frame by the game. speed01: 0..1 of max speed, thr: 0..1 throttle, ab: 0..1 afterburner.
  engine(on, speed01 = 0, thr = 0, ab = 0, dive = 0) {
    if (!this.eng) return;
    const e = this.eng;
    const t = this.ctx.currentTime;
    const active = on && !this.muted && !this.paused;
    const tc = 0.07;
    this.engineBus.gain.setTargetAtTime(active ? 1 : 0, t, active ? 0.25 : 0.06);
    if (!active) return;
    speed01 = clamp(speed01, 0, 1.2);
    e.turb.frequency.setTargetAtTime(78 + 95 * thr + 70 * speed01 + 40 * ab, t, tc);
    e.tf.frequency.setTargetAtTime(380 + 1500 * speed01 + 1100 * thr + 900 * ab, t, tc);
    e.tg.gain.setTargetAtTime(0.045 + 0.07 * thr + 0.02 * speed01, t, tc);
    e.sub.frequency.setTargetAtTime(38 + 34 * thr + 14 * ab, t, tc);
    e.sg.gain.setTargetAtTime(0.1 + 0.12 * thr, t, tc);
    e.wf.frequency.setTargetAtTime(320 + 2300 * speed01 + 700 * dive, t, tc);
    e.wg.gain.setTargetAtTime(0.012 + 0.2 * speed01 * speed01 + 0.05 * dive, t, tc);
    e.rf.frequency.setTargetAtTime(260 + 900 * ab, t, tc);
    e.rg.gain.setTargetAtTime(0.28 * ab, t, 0.12);
  }

  // Per-frame driver: engine loop + lock tone + stall / incoming warnings. `g` is the Game.
  tick(g) {
    if (!this.ctx) return;
    const P = g.player;
    const play = g.mode === 'play' && P && P.alive && !P.dying;
    const menu = g.mode === 'menu';
    if (!play) {
      this.engine(menu, menu ? 0.35 : 0, menu ? 0.5 : 0, 0, 0);
      return;
    }
    const sp = Math.hypot(P.vx, P.vy);
    this.engine(true, sp / (P.eng ? P.eng.maxSpeed : 560), P.throttle || 0, P.ab || 0, clamp((P.vy - 120) / 400, 0, 1));
    const now = g.realT;
    // missile lock tone: slow chirps while acquiring, steady rapid tone when locked
    if (g.lock) {
      if (now >= this.lockNext) {
        const locked = g.lock.t >= 1;
        this.lockPing(locked);
        this.lockNext = now + (locked ? 0.16 : 0.42 - g.lock.t * 0.28);
      }
    }
    if (P.stall && now >= this.stallNext) { this.stallWarning(); this.stallNext = now + 0.2; }
    if (g.incoming > 0 && now >= this.incomingNext) {
      this.incomingTick(g.incoming);
      this.incomingNext = now + clamp(0.4 - g.incoming * 0.3, 0.08, 0.4);
    }
  }
}

export const audio = new SoundEngine();
