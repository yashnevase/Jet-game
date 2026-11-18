import { BASE_H, MIN_W, PALETTES, PAL_KEYS, RANKS, DEFAULT_LOADOUT, SEA_Y, ORDNANCE } from './constants.js';
import { clamp, damp, lerp, hex2rgb, rgb2hex, mulberry32, loadJSON, saveJSON, rnd, angDiff, wrapAngle } from './util.js';
import { Input } from './input.js';
import { FX } from './vfxSystem.js';
import { makePlayer, updatePlayer, updatePlayerBullets, dyingSpin } from './player.js';
import { CFG, updateEnemies, updateEnemyBullets, damageEnemy, spawnAir } from './enemies.js';
import { updateChunks } from './world.js';
import { surfaceY } from './terrain.js';
import { render } from './render.js';
import { audio } from './audio.js';

function testBulletHit(b, e) {
  const rot = (e.kind === 'jet' ? e.a : (e.tilt || 0));
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);

  // Transform bullet segment (b.px, b.py) -> (b.x, b.y) into enemy local space
  const p0x = (b.px - e.x) * cos - (b.py - e.y) * sin;
  const p0y = (b.px - e.x) * sin + (b.py - e.y) * cos;
  const p1x = (b.x - e.x) * cos - (b.py - e.y) * sin;
  const p1y = (b.x - e.x) * sin + (b.y - e.y) * cos;

  // Box half extents with bullet thickness and generous, crisp collision padding
  const pad = Math.max(3.2, (b.size || 2.0) * 1.2);
  const bx = e.hw + pad;
  const by = e.hh + pad;

  // 1. Point check at endpoints or midpoint
  if (Math.abs(p1x) <= bx && Math.abs(p1y) <= by) return true;
  if (Math.abs(p0x) <= bx && Math.abs(p0y) <= by) return true;
  const pmx = (p0x + p1x) * 0.5;
  const pmy = (p0y + p1y) * 0.5;
  if (Math.abs(pmx) <= bx && Math.abs(pmy) <= by) return true;

  // 2. Swept continuous line-segment vs box intersection (slab test)
  const dx = p1x - p0x;
  const dy = p1y - p0y;

  let tmin = 0;
  let tmax = 1;

  if (Math.abs(dx) < 1e-5) {
    if (Math.abs(p0x) > bx) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (-bx - p0x) * inv;
    let t2 = (bx - p0x) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  if (Math.abs(dy) < 1e-5) {
    if (Math.abs(p0y) > by) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (-by - p0y) * inv;
    let t2 = (by - p0y) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }

  return tmax >= 0 && tmin <= 1;
}

export class Game {
  constructor(canvas, cb = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.cb = cb;
    this.input = new Input(this);
    this.dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.view = { w: 533, h: BASE_H };
    this.loadout = { ...DEFAULT_LOADOUT, ...loadJSON('lowline.loadout', {}) };
    this.best = loadJSON('lowline.best', 0);
    this.fx = new FX();
    this.cam = { x: 0, y: -220, zoom: 1, trauma: 0, kx: 0, ky: 0, ax: 0, ay: 0 };
    this.hitFlash = 0; // 1 → 0 after the player is hit (drives the HUD border ticks)
    this.invertF = 0; // frames of inverted flash left (heavy kills)
    this.lock = null; // render-side target lock state
    this.hitmarker = null; // tactical hit confirmation marker { t, isKill, x, y }
    this.palIdx = 0;
    this.palCur = {};
    this.pal = {};
    for (const k of PAL_KEYS) {
      this.palCur[k] = hex2rgb(PALETTES[0][k]);
      this.pal[k] = PALETTES[0][k];
    }
    this.realT = 0;
    this.raf = 0;
    this.last = 0;
    this.enterMenu();
  }

  // ── lifecycle ────────────────────────────────────────────
  reset() {
    this.seed = (Math.random() * 1e9) | 0;
    this.t = 0;
    this.player = makePlayer(this.loadout);
    this.enemies = [];
    this.pb = [];
    this.pm = [];
    this.bombs = [];
    this.eb = [];
    this.islands = [];
    this.chunks = new Map();
    this.lastPc = null;
    this.fx.clear();
    this.score = 0;
    this.kills = 0;
    this.combo = 0;
    this.mult = 1;
    this.comboT = 0;
    this.rank = 1;
    this.airT = 0;
    this.hitstop = 0;
    this.slowT = 0;
    this.timeScale = 1;
    this.flash = 0;
    this.banner = null;
    this.overAt = 0;
    this.cam.trauma = 0;
    this.cam.zoom = 1;
    this.cam.kx = this.cam.ky = this.cam.ax = this.cam.ay = 0;
    this.hitFlash = 0;
    this.invertF = 0;
    this.lock = null;
    this.hitmarker = null;
    const savedPal = loadJSON('lowline.palette', 0);
    this.setPalette(savedPal);
    updateChunks(this);
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
  }

  enterMenu() {
    this.reset();
    this.mode = 'menu';
    this.player.demo = true;
    this.cb.onMode?.('menu');
  }

  startRun() {
    this.reset();
    this.mode = 'play';
    this.cb.onMode?.('play');
  }

  setLoadout(l) {
    this.loadout = { ...this.loadout, ...l };
    saveJSON('lowline.loadout', this.loadout);
  }

  togglePause() {
    if (this.mode === 'play') {
      this.mode = 'paused';
      this.cb.onMode?.('paused');
    } else if (this.mode === 'paused') {
      this.mode = 'play';
      this.cb.onMode?.('play');
    }
  }
  autoPause() { if (this.mode === 'play') this.togglePause(); }

  onKey(code) {
    if (code === 'KeyP' || code === 'Escape') this.togglePause();
    else if ((code === 'Enter' || code === 'KeyR') && this.mode === 'over' && this.realT - this.overAt > 0.7) this.startRun();
  }

  attach() {
    if (this.raf) return;
    this.input.attach();
    this.last = performance.now() / 1000;
    const loop = (ts) => {
      this.raf = requestAnimationFrame(loop);
      const now = ts / 1000;
      const dt = now - this.last;
      this.last = now;
      this.update(Math.max(0, dt));
      render(this);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.detach();
  }

  // cw/ch are CSS pixels. The backing store is cw×dpr by ch×dpr (native resolution, so strokes stay razor
  // sharp); `view` is the logical world window (BASE_H tall) that render() scales onto it.
  resize(cw, ch) {
    let dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    while (dpr > 1 && cw * dpr * ch * dpr > 9e6) dpr = Math.max(1, dpr - 0.5); // keep huge displays fast
    let ih = BASE_H;
    let iw = (ih * cw) / ch;
    if (iw < MIN_W) {
      iw = MIN_W;
      ih = (iw * ch) / cw;
    }
    this.dpr = dpr;
    this.view = { w: iw, h: ih };
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(cw * dpr));
      this.canvas.height = Math.max(1, Math.round(ch * dpr));
    }
  }

  // ── main update: real-time effects, then fixed-ish sub-steps ──
  update(raw) {
    const dt0 = Math.min(raw, 1 / 15);
    this.realT += dt0;
    this.cam.trauma = Math.max(0, this.cam.trauma - dt0 * 1.4);
    this.flash = Math.max(0, this.flash - dt0 * 2.5);
    this.hitFlash = Math.max(0, this.hitFlash - dt0 * 3.2);
    if (this.hitmarker) {
      this.hitmarker.t -= dt0;
      if (this.hitmarker.t <= 0) this.hitmarker = null;
    }
    const kd = Math.exp(-9 * dt0);
    this.cam.kx *= kd;
    this.cam.ky *= kd;
    this.updatePalette(dt0);
    this.input.pollGamepad();
    if (this.mode === 'paused') return;
    if (this.hitstop > 0) {
      this.hitstop -= dt0;
      return;
    }
    if (this.slowT > 0) {
      this.slowT -= dt0;
      this.timeScale = damp(this.timeScale, 0.3, 14, dt0);
    } else {
      this.timeScale = damp(this.timeScale, 1, 6, dt0);
    }
    const dt = dt0 * this.timeScale;
    if (this.mode === 'over') {
      this.fx.update(dt);
      this.updateCamera(dt);
      return;
    }
    const n = Math.max(1, Math.ceil(dt * 60 - 1e-6));
    for (let i = 0; i < n; i++) this.step(dt / n);
  }

  step(dt) {
    this.t += dt;
    if (this.mode === 'menu') this.demoFlight(dt);
    else updatePlayer(this, dt);
    updateChunks(this);
    updatePlayerBullets(this, dt);
    this.updateMissiles(dt);
    this.updateBombs(dt);
    updateEnemies(this, dt);
    updateEnemyBullets(this, dt);
    if (this.mode === 'play') {
      this.collide();
      this.director(dt);
    }
    this.comboT -= dt;
    if (this.comboT <= 0 && this.combo > 0) {
      this.combo = 0;
      this.mult = 1;
    }
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
    this.fx.update(dt);
    this.updateCamera(dt);
    if (this.mode === 'dying' && !this.player.alive && this.realT >= this.overAt) this.finishRun();
  }

  demoFlight(dt) {
    const P = this.player;
    P.vx = 180;
    P.x += P.vx * dt;
    P.y = -135 + Math.sin(this.t * 0.7) * 30;
    P.vy = Math.cos(this.t * 0.7) * 24;
    P.a = Math.cos(this.t * 0.7) * 0.12;
    P.thrusting = true;
    P.trailD += 180 * dt;
    while (P.trailD > 4) {
      P.trailD -= 4;
      this.fx.trail(P.x - 17 - P.trailD * 0.1, P.y + Math.sin(this.t * 0.7) * 0, 1.1);
    }

    // Live demonstration of AGM-73 homing missile, GBU-12 bomb, and 30mm cannon on title screen
    this.demoFireT = (this.demoFireT || 0) + dt;
    if (this.demoFireT > 3.0) {
      this.demoFireT = 0;
      this.demoStep = ((this.demoStep || 0) + 1) % 3;
      if (this.demoStep === 0) {
        const tgt = this.enemies.find(e => !e.dying && e.x > P.x + 80 && e.x < P.x + 700);
        this.launchMissile(P, tgt);
      } else if (this.demoStep === 1) {
        this.dropBomb(P);
      } else {
        for (let s = 0; s < 3; s++) {
          this.pb.push({
            x: P.x + 18 + s * 14, y: P.y + 2, px: P.x, py: P.y,
            vx: 780 + P.vx * 0.6, vy: P.vy * 0.6,
            life: 0.8, dmg: 3, size: 1.6,
          });
        }
        this.fx.muzzle(P.x + 22, P.y + 2, 0, 1.4);
      }
    }
  }

  // ── collisions: precise swept continuous collision detection (CCD) ──
  collide() {
    const P = this.player;
    for (let i = this.pb.length - 1; i >= 0; i--) {
      const b = this.pb[i];
      let hit = false;
      for (const e of this.enemies) {
        if (e.dying) continue;
        if (testBulletHit(b, e)) {
          damageEnemy(this, e, b.dmg);
          this.fx.spark(b.x, b.y, b.vx, b.vy, b.size > 2 ? 8 : 4);
          this.addShake(0.02 + b.size * 0.012);
          if (b.dmg >= 10) this.hitstop = Math.max(this.hitstop, 0.025);
          hit = true;
          break;
        }
      }
      if (hit) {
        this.pb[i] = this.pb[this.pb.length - 1];
        this.pb.pop();
      }
    }
    // ramming
    if (P.alive && !P.dying && P.inv <= 0) {
      for (const e of this.enemies) {
        if (e.dying) continue;
        const cx = clamp(P.x, e.x - e.hw, e.x + e.hw);
        const cy = clamp(P.y, e.y - e.hh, e.y + e.hh);
        if (Math.hypot(P.x - cx, P.y - cy) < P.r) {
          const air = CFG[e.kind].air;
          this.hurtPlayer(air ? 22 : 35, e.x, e.y);
          damageEnemy(this, e, air ? 999 : 40);
          break;
        }
      }
    }
  }

  // ── director: how hard the sky fights back ───────────────
  airCount() {
    let n = 0;
    for (const e of this.enemies) if (CFG[e.kind].air && !e.dying) n++;
    return n;
  }
  airCap() { return Math.min(1 + this.rank, 8); }

  director(dt) {
    this.airT -= dt;
    if (this.t < 20 && this.score < 250) return;
    if (this.airT > 0) return;
    this.airT = Math.max(2.4, 7.5 - this.rank * 0.7) * rnd(0.8, 1.2);
    if (this.airCount() < this.airCap()) spawnAir(this, this.rank >= 2 && Math.random() < 0.32 ? 'chopper' : 'jet');
  }

  // ── scoring & rank ───────────────────────────────────────
  addScore(base, x, y, big) {
    this.combo++;
    this.comboT = 3.6;
    this.mult = Math.min(8, 1 + Math.floor((this.combo - 1) / 3));
    const pts = base * this.mult;
    this.score += pts;
    this.fx.popup(x, y, '+' + pts, big || this.mult >= 4);
    this.checkRank();
  }

  checkRank() {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) if (this.score >= RANKS[i]) idx = i;
    if (idx + 1 > this.rank) {
      this.rank = idx + 1;
      this.banner = { text: `DEFCON ${this.rank} // RE-ARMED +5 AGM +5 GBU`, t: 2.8 };
      this.flash = 0.7;
      this.addShake(0.4);
      if (this.player && this.player.alive) {
        this.player.missiles = Math.min(this.player.maxMissiles, this.player.missiles + ORDNANCE.MISSILE_REARM);
        this.player.bombs = Math.min(this.player.maxBombs, this.player.bombs + ORDNANCE.BOMB_REARM);
      }
      this.setPalette((this.rank - 1) % PALETTES.length);
    }
  }

  selectTheme(idx) {
    this.palIdx = idx % PALETTES.length;
    for (const k of PAL_KEYS) {
      this.palCur[k] = hex2rgb(PALETTES[this.palIdx][k]);
      this.pal[k] = PALETTES[this.palIdx][k];
    }
    this.cb.onPalette?.(PALETTES[this.palIdx]);
    saveJSON('lowline.palette', this.palIdx);
  }

  setPalette(i) {
    this.palIdx = i % PALETTES.length;
    this.cb.onPalette?.(PALETTES[this.palIdx]);
  }

  updatePalette(dt) {
    const tgt = PALETTES[this.palIdx];
    for (const k of PAL_KEYS) {
      const c = this.palCur[k];
      const t = hex2rgb(tgt[k]);
      for (let j = 0; j < 3; j++) c[j] = lerp(c[j], t[j], 1 - Math.exp(-2.2 * dt));
      this.pal[k] = rgb2hex(c);
    }
  }

  // ── player damage / death ────────────────────────────────
  addShake(a) { this.cam.trauma = Math.min(1, this.cam.trauma + a); }
  // Directional camera shove (unit vector dx,dy, strength k): nearby blasts push the whole scene away.
  addKick(dx, dy, k) {
    this.cam.kx = clamp(this.cam.kx + dx * k * 9, -14, 14);
    this.cam.ky = clamp(this.cam.ky + dy * k * 9, -14, 14);
  }

  hurtPlayer(n, sx, sy) {
    const P = this.player;
    if (this.mode !== 'play' || !P.alive || P.dying || P.inv > 0) return;
    P.hp -= n;
    P.flash = 0.14;
    P.inv = 0.3;
    P.lastHurt = this.t;
    this.hitFlash = 1;
    this.addShake(0.4 + n / 70);
    this.hitstop = Math.max(this.hitstop, 0.05);
    this.flash = Math.max(this.flash, 0.25);
    this.comboT = Math.min(this.comboT, 1.2);
    audio.explode(false);
    const dx = P.x - sx;
    const dy = P.y - sy;
    const d = Math.hypot(dx, dy) || 1;
    P.vx += (dx / d) * 60;
    P.vy += (dy / d) * 60;
    this.fx.spark(P.x, P.y, -dx, -dy, 7);
    if (P.hp <= 0) {
      P.hp = 0;
      P.dying = true;
      P.dyingT = 0;
      P.spin = dyingSpin();
      this.mode = 'dying';
      this.slowT = 1.2;
      this.fx.explode(this, P.x, P.y, 0.8);
    }
  }

  crashPlayer(land) {
    const P = this.player;
    if (!P.alive) return;
    P.alive = false;
    audio.explode(true);
    const y = land ? surfaceY(this, P.x) : SEA_Y;
    this.fx.explode(this, P.x, Math.min(P.y, y), 2.4);
    if (!land) this.fx.splash(P.x, 1.8);
    this.addShake(0.8);
    this.flash = 0.6;
    this.slowT = Math.max(this.slowT, 0.5);
    this.mode = 'dying';
    this.overAt = this.realT + 1.3;
  }

  finishRun() {
    this.mode = 'over';
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = Math.floor(this.score);
      saveJSON('lowline.best', this.best);
    }
    this.cb.onMode?.('over', {
      score: Math.floor(this.score), best: this.best, newBest, rank: this.rank, kills: this.kills, time: Math.floor(this.t),
    });
  }

  // ── camera: wide tactical zoom & intelligent terrain lookahead ──────────────────
  updateCamera(dt) {
    const P = this.player;
    const c = this.cam;
    const sp = Math.hypot(P.vx, P.vy);
    // Wider tactical field of view (0.76 cruise down to 0.62 at supersonic speeds)
    c.zoom = damp(c.zoom, lerp(0.76, 0.62, clamp((sp - 180) / 380, 0, 1)), 1.6, dt);
    // Look-ahead: forward velocity + nose vector + downward dive anticipation
    const live = P.alive && !P.dying ? 1 : 0;
    c.ax = damp(c.ax, Math.cos(P.a) * 58 * live, 2.4, dt);
    // Downward dive lookahead: if descending towards ground, frame camera lower to reveal terrain in advance
    const diveLook = P.vy > 40 ? Math.min(140, P.vy * 0.32) : 0;
    c.ay = damp(c.ay, (Math.sin(P.a) * 38 + diveLook) * live, 2.4, dt);
    let tx = P.x + P.vx * 0.44 + c.ax;
    let ty = P.y + P.vy * 0.28 + c.ay;
    const h = this.view.h / c.zoom;
    ty = Math.min(ty, -0.22 * h);
    c.x = damp(c.x, tx, 4.5, dt);
    c.y = damp(c.y, ty, 3.2, dt);
    c.y = Math.min(c.y, -0.18 * h);
  }

  // ── guided homing missiles (GTA V Oppressor Mk2 style tracking & break-turn dodging) ─
  launchMissile(p, overrideTgt = null) {
    const S = (p.hull.scale || 1) * 1.25;
    const flip = Math.cos(p.a) < 0 ? -1 : 1;
    const ca = Math.cos(p.a);
    const sa = Math.sin(p.a);
    p.missileWing = ((p.missileWing || 0) + 1) % 2;
    const ly = (p.missileWing === 0 ? 15 : -15) * S * flip;
    const lx = -4 * S;
    const sx = p.x + lx * ca - ly * sa;
    const sy = p.y + lx * sa + ly * ca;

    // Prefer active target lock, otherwise acquire closest enemy in 65° forward cone
    let tgt = overrideTgt || (this.lock?.e && !this.lock.e.dying ? this.lock.e : null);
    if (!tgt) {
      let bd = 900;
      for (const e of this.enemies) {
        if (e.dying) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 900) continue;
        const err = Math.abs(angDiff(p.a, Math.atan2(dy, dx)));
        if (err < 0.65 && d < bd) {
          bd = d;
          tgt = e;
        }
      }
    }

    const initSpd = Math.max(340, Math.hypot(p.vx, p.vy) + 140);
    this.pm.push({
      x: sx, y: sy, px: sx, py: sy,
      a: p.a,
      vx: Math.cos(p.a) * initSpd,
      vy: Math.sin(p.a) * initSpd,
      tgt,
      life: ORDNANCE.MISSILE_LIFE,
      trailT: 0,
    });
    this.fx.smoke(sx, sy, 1.4, ['light', 'mid'], 0.6);
    this.fx.shock(sx, sy, 16, 'ring', 0.22);
    this.addShake(0.08);
  }

  dropBomb(p) {
    const S = (p.hull.scale || 1) * 1.25;
    const ca = Math.cos(p.a);
    const sx = p.x - 3 * S * ca;
    const sy = p.y + 7 * S;

    this.bombs.push({
      x: sx, y: sy, px: sx, py: sy,
      vx: p.vx * 0.94 + (Math.random() - 0.5) * 18,
      vy: p.vy * 0.35 + 24,
      a: p.a,
      life: 5.5,
    });
    this.fx.smoke(sx, sy, 0.9, ['mid'], 0.4);
    this.addShake(0.06);
  }

  updateMissiles(dt) {
    const a = this.pm;
    for (let i = a.length - 1; i >= 0; i--) {
      const m = a[i];
      m.px = m.x;
      m.py = m.y;
      m.life -= dt;

      // Proportional navigation guidance
      const tgt = m.tgt && !m.tgt.dying ? m.tgt : null;
      if (tgt) {
        const dx = tgt.x - m.x;
        const dy = tgt.y - m.y;
        const want = Math.atan2(dy, dx);
        const diff = angDiff(m.a, want);
        const maxTurn = ORDNANCE.MISSILE_TURN * dt;
        m.a = wrapAngle(m.a + clamp(diff, -maxTurn, maxTurn));
      }

      // Acceleration to top speed
      const curSpd = Math.hypot(m.vx, m.vy);
      const newSpd = Math.min(ORDNANCE.MISSILE_SPEED, curSpd + 650 * dt);
      m.vx = Math.cos(m.a) * newSpd;
      m.vy = Math.sin(m.a) * newSpd;
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      m.trailT -= dt;
      if (m.trailT <= 0) {
        m.trailT = 0.016;
        this.fx.trail(m.x - Math.cos(m.a) * 9, m.y - Math.sin(m.a) * 9, 0.9);
      }

      let dead = m.life <= 0;
      // Proximity & CCD hit check on enemies
      if (!dead) {
        for (const e of this.enemies) {
          if (e.dying) continue;
          if (Math.hypot(e.x - m.x, e.y - m.y) < Math.max(e.hw, e.hh) + 12) {
            damageEnemy(this, e, ORDNANCE.MISSILE_DMG);
            this.fx.shock(m.x, m.y, 38, 'ring', 0.35);
            this.fx.explode(this, m.x, m.y, 1.4);
            audio.explode(true);
            audio.hitmarker(e.hp <= 0);
            this.hitmarker = { t: 0.22, isKill: e.hp <= 0, x: m.x, y: m.y };
            this.addShake(0.32);
            dead = true;
            break;
          }
        }
      }

      // Sea / ground impact
      if (!dead) {
        const sy = surfaceY(this, m.x);
        if (m.y >= sy) {
          dead = true;
          this.fx.explode(this, m.x, sy - 2, 1.2);
          if (sy < SEA_Y - 1) this.fx.spark(m.x, m.y, 0, -120, 8);
          else this.fx.splash(m.x, 0.7);
          audio.explode(false);
        }
      }

      if (dead) {
        a[i] = a[a.length - 1];
        a.pop();
      }
    }
  }

  updateBombs(dt) {
    const a = this.bombs;
    for (let i = a.length - 1; i >= 0; i--) {
      const b = a[i];
      b.px = b.x;
      b.py = b.y;
      b.life -= dt;
      b.vy += ORDNANCE.BOMB_GRAV * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a = Math.atan2(b.vy, b.vx);

      let dead = b.life <= 0;
      const sy = surfaceY(this, b.x);

      if (!dead) {
        for (const e of this.enemies) {
          if (e.dying) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < Math.max(e.hw, e.hh) + 10) {
            dead = true;
            break;
          }
        }
      }

      if (!dead && b.y >= sy) dead = true;

      if (dead) {
        const bx = b.x;
        const by = Math.min(b.y, sy);
        this.fx.shock(bx, by, ORDNANCE.BOMB_RADIUS, 'ring', 0.45);
        this.fx.explode(this, bx, by, 1.8);
        this.addShake(0.48);
        audio.bombExplode();

        if (sy < SEA_Y - 1) this.fx.spark(bx, by, 0, -180, 14);
        else this.fx.splash(bx, 1.4);

        let anyKill = false;
        for (const e of this.enemies) {
          if (e.dying) continue;
          const dist = Math.hypot(e.x - bx, e.y - by);
          if (dist < ORDNANCE.BOMB_RADIUS + Math.max(e.hw, e.hh)) {
            const dmg = ORDNANCE.BOMB_DMG * (1 - dist / (ORDNANCE.BOMB_RADIUS + 30));
            damageEnemy(this, e, Math.max(15, dmg));
            if (e.hp <= 0) anyKill = true;
          }
        }
        audio.hitmarker(anyKill);
        this.hitmarker = { t: 0.28, isKill: anyKill, x: bx, y: by };

        a[i] = a[a.length - 1];
        a.pop();
      }
    }
  }
}
