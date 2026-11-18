// ─────────────────────────────────────────────────────────────
//  audio.js: Procedural Web Audio synthesizer for LOWLINE.
//  Zero external audio files; pure synthesised military-tactical audio.
// ─────────────────────────────────────────────────────────────

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.masterGain = null;
    this.engineGain = null;
    this.engineOsc = null;
    this.engineNoise = null;
    this.lastWarn = 0;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.28;
      this.masterGain.connect(this.ctx.destination);
    } catch (_) {}
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // ── Procedural UI sounds ──
  uiHover() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(1800, t + 0.035);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.035);
    } catch (_) {}
  }

  uiClick() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(240, t + 0.07);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (_) {}
  }

  // ── Weapon fire ──
  shoot(gunId) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      if (gunId === 'cannon') {
        // Heavy 57mm Bofors: deep bass thump + metallic crack
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.22);
        g.gain.setValueAtTime(0.42, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      } else if (gunId === 'scatter') {
        // Cluster Flak: snappy triple crack
        osc.type = 'square';
        osc.frequency.setValueAtTime(450, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
        g.gain.setValueAtTime(0.24, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      } else {
        // Autocannon 20mm: rapid punchy snap
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(650, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.07);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      }

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + (gunId === 'cannon' ? 0.25 : 0.1));
    } catch (_) {}
  }

  // ── Tactical Hitmarker confirmation ──
  hitmarker(isKill = false) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      if (isKill) {
        // Satisfying kill confirmation: double chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(1800, t + 0.1);
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      } else {
        // Crisp high-velocity tick
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2200, t);
        osc.frequency.exponentialRampToValueAtTime(950, t + 0.04);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      }

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + (isKill ? 0.15 : 0.05));
    } catch (_) {}
  }

  // ── Explosions ──
  explode(heavy = false) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const dur = heavy ? 0.6 : 0.35;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(heavy ? 120 : 180, t);
      osc.frequency.exponentialRampToValueAtTime(25, t + dur);

      g.gain.setValueAtTime(heavy ? 0.5 : 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + dur);
    } catch (_) {}
  }

  // ── GPWS Pull-up Warning Alarm ──
  gpwsWarning() {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - this.lastWarn < 650) return; // rate limit beep
    this.lastWarn = now;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(660, t + 0.1);
      g.gain.setValueAtTime(0.18, t);
      g.gain.setValueAtTime(0.18, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.23);
    } catch (_) {}
  }

  // ── Guided Missile Launch (Rocket motor ignition & whoosh) ──
  missileLaunch() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(540, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.35);
      g.gain.setValueAtTime(0.38, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.36);
    } catch (_) {}
  }

  // ── Bomb Drop (Mechanical pylon release clack & whoosh) ──
  bombDrop() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.14);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch (_) {}
  }

  // ── Heavy Bomb Ground / Sea Crater Detonation ──
  bombExplode() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(18, t + 0.75);
      g.gain.setValueAtTime(0.65, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.76);
    } catch (_) {}
  }
}

export const audio = new SoundEngine();
