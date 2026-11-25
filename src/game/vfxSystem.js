import { SEA_Y } from './constants.js';
import { rnd, TAU, lerp } from './util.js';
import { FONT, starburst, diamond, lw, dash } from './cadRenderer.js';
import { audio } from './audio.js';

// ─────────────────────────────────────────────────────────────
//  vfxSystem: geometric CAD effects. No soft circles, no blobs.
//  Particle kinds (all vector):
//    dot     filled diamond shard (embers)   | with fade: hollow diamond puff
//    star    4-point vector starburst        | flash: alias of star
//    ring    solid shockwave ring            | cadShock: dashed ring + quadrant ticks
//    cadArc  dashed bore ray + degree arc    | line/dotted: sparks / tracers
//    rect    spinning debris stick           | poly: spinning debris triangle
//    ell     water ripple ellipse
//  Contrails are ribbons (see trail()): tapering strip with rhythmic chevrons.
// ─────────────────────────────────────────────────────────────
const MAX = 1400;
const RIB_MAX = 70;

export class FX {
  constructor() {
    this.p = [];
    this.pop = [];
    this.streams = new Map(); // contrail ribbons keyed by owner
    this.dist = []; // visual-only water disturbances {x, amp, age}
    this.warps = []; // grid-warp shockwaves {x, y, amp, age}: the CAD grid ripples near big blasts
  }

  clear() {
    this.p.length = 0;
    this.pop.length = 0;
    this.streams.clear();
    this.dist.length = 0;
    this.warps.length = 0;
  }

  add(o) {
    o.max = o.life;
    o.vx = o.vx || 0; // stationary effects (rings, flashes, starbursts) omit velocity
    o.vy = o.vy || 0;
    if (this.p.length >= MAX) this.p[(Math.random() * MAX) | 0] = o;
    else this.p.push(o);
  }

  update(dt) {
    const a = this.p;
    for (let i = a.length - 1; i >= 0; i--) {
      const q = a[i];
      q.life -= dt;
      if (q.life <= 0) {
        a[i] = a[a.length - 1];
        a.pop();
        continue;
      }
      if (q.drag) {
        const d = Math.exp(-q.drag * dt);
        q.vx *= d;
        q.vy *= d;
      }
      if (q.g) q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.vr) q.r += q.vr * dt;
      if (q.water && q.y > SEA_Y) {
        this.ripple(q.x, 0.25);
        a[i] = a[a.length - 1];
        a.pop();
      }
    }
    for (let i = this.pop.length - 1; i >= 0; i--) {
      const p = this.pop[i];
      p.life -= dt;
      p.y -= 20 * dt;
      if (p.life <= 0) this.pop.splice(i, 1);
    }
    for (let i = this.warps.length - 1; i >= 0; i--) {
      const w = this.warps[i];
      w.age += dt;
      if (w.age > 1.1) this.warps.splice(i, 1);
    }
    for (let i = this.dist.length - 1; i >= 0; i--) {
      const d = this.dist[i];
      d.age += dt;
      if (d.age > 1.9) this.dist.splice(i, 1);
    }
    for (const [k, arr] of this.streams) {
      for (let i = 0; i < arr.length; i++) arr[i].life -= dt;
      while (arr.length && arr[0].life <= 0) arr.shift();
      if (!arr.length) this.streams.delete(k);
    }
  }

  // ── contrail ribbons ───────────────────────────────────────
  drawRibbons(ctx, pal) {
    ctx.lineCap = 'butt';
    for (const arr of this.streams.values()) {
      const n = arr.length;
      if (n < 2) continue;
      for (let i = 1; i < n; i++) {
        const p0 = arr[i - 1];
        const p1 = arr[i];
        if (p1.brk || Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y) > 60) continue; // stream was re-seeded / paused
        const u = Math.max(0, p1.life / p1.max);
        const k = i / n; // 0 = old tail, 1 = fresh
        ctx.globalAlpha = u * u * 0.9 * p1.a;
        ctx.strokeStyle = pal.light;
        lw(ctx, Math.max(0.6, p1.w * u * (0.4 + 0.6 * k) * 1.3));
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        // rhythmic chevron every 4th point
        if (i % 4 === 0 && u > 0.15) {
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          const s = 1.6 + p1.w * 1.3 * u;
          const bx = Math.cos(ang);
          const by = Math.sin(ang);
          ctx.strokeStyle = pal.hot;
          lw(ctx, 0.75);
          ctx.globalAlpha = u * 0.8 * p1.a;
          ctx.beginPath();
          ctx.moveTo(p1.x - bx * s - by * s, p1.y - by * s + bx * s);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p1.x - bx * s + by * s, p1.y - by * s - bx * s);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── particles ──────────────────────────────────────────────
  draw(ctx, pal, z) {
    if (z === 0) this.drawRibbons(ctx, pal);
    const a = this.p;
    ctx.lineJoin = 'miter';
    for (let i = 0; i < a.length; i++) {
      const q = a[i];
      if ((q.z || 0) !== z) continue;
      const u = 1 - q.life / q.max;
      const ramp = q.ramp;
      ctx.globalAlpha = (q.fade ? 1 - u : 1) * (q.a === undefined ? 1 : q.a);
      const col = pal[ramp[Math.min(ramp.length - 1, (u * ramp.length) | 0)]];
      switch (q.k) {
        case 'dot': {
          const r = Math.max(0.5, lerp(q.s0, q.s1, u)) * 0.75;
          if (q.fade) {
            ctx.strokeStyle = col;
            lw(ctx, 0.6);
            diamond(ctx, q.x, q.y, r, r);
            ctx.stroke();
          } else {
            ctx.fillStyle = col;
            diamond(ctx, q.x, q.y, r, r * 0.8);
            ctx.fill();
          }
          break;
        }
        case 'flash':
        case 'star': {
          const r = Math.max(0.5, lerp(q.s0, q.s1, u)) * 1.7;
          ctx.fillStyle = col;
          starburst(ctx, q.x, q.y, q.ang || 0.785, r);
          break;
        }
        case 'ring': {
          const e = 1 - (1 - u) * (1 - u);
          ctx.strokeStyle = col;
          lw(ctx, Math.max(0.5, lerp(q.w0, 0.5, u)));
          ctx.beginPath();
          ctx.arc(q.x, q.y, lerp(q.s0, q.s1, e), 0, TAU);
          ctx.stroke();
          break;
        }
        case 'cadShock': {
          const e = 1 - (1 - u) * (1 - u);
          const rad = lerp(q.s0, q.s1, e);
          ctx.strokeStyle = col;
          lw(ctx, 0.9);
          dash(ctx, 4, 4);
          ctx.beginPath();
          ctx.arc(q.x, q.y, rad, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          const tl = Math.min(6, rad * 0.4);
          ctx.beginPath();
          ctx.moveTo(q.x - rad - tl, q.y); ctx.lineTo(q.x - rad + tl, q.y);
          ctx.moveTo(q.x + rad - tl, q.y); ctx.lineTo(q.x + rad + tl, q.y);
          ctx.moveTo(q.x, q.y - rad - tl); ctx.lineTo(q.x, q.y - rad + tl);
          ctx.moveTo(q.x, q.y + rad - tl); ctx.lineTo(q.x, q.y + rad + tl);
          ctx.stroke();
          if (q.label && u < 0.65) {
            ctx.font = `7px ${FONT}`;
            ctx.fillStyle = col;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(q.label, q.x + rad + 4, q.y - 2);
          }
          break;
        }
        case 'cadArc': {
          const rad = q.r || 18;
          ctx.strokeStyle = col;
          lw(ctx, 0.6);
          dash(ctx, 2, 3);
          ctx.beginPath();
          ctx.arc(q.x, q.y, rad, q.ang - 0.3, q.ang + 0.3);
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + Math.cos(q.ang) * rad * 2.2, q.y + Math.sin(q.ang) * rad * 2.2);
          ctx.stroke();
          ctx.setLineDash([]);
          if (q.label && u < 0.7) {
            ctx.font = `6.5px ${FONT}`;
            ctx.fillStyle = col;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(q.label, q.x + Math.cos(q.ang) * (rad + 9), q.y + Math.sin(q.ang) * (rad + 9));
          }
          break;
        }
        case 'line':
        case 'tracer': {
          const L = q.k === 'tracer' ? 0.05 : 0.035;
          ctx.strokeStyle = col;
          lw(ctx, q.w || 1);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - q.vx * L, q.y - q.vy * L);
          ctx.stroke();
          break;
        }
        case 'dotted':
          ctx.strokeStyle = col;
          lw(ctx, q.w || 0.8);
          dash(ctx, 2, 3);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - q.vx * 0.05, q.y - q.vy * 0.05);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        case 'rect': {
          // spinning debris stick
          const c = Math.cos(q.r) * q.s0 * 1.6;
          const s = Math.sin(q.r) * q.s0 * 1.6;
          ctx.strokeStyle = col;
          lw(ctx, 1);
          ctx.beginPath();
          ctx.moveTo(q.x - c, q.y - s);
          ctx.lineTo(q.x + c, q.y + s);
          ctx.stroke();
          break;
        }
        case 'poly': {
          // spinning debris triangle
          const r = q.s0;
          ctx.strokeStyle = col;
          lw(ctx, 0.9);
          ctx.beginPath();
          for (let j = 0; j < 3; j++) {
            const an = q.r + j * 2.094 + (j === 1 ? 0.5 : 0);
            const rr = j === 2 ? r * 0.6 : r;
            const px = q.x + Math.cos(an) * rr;
            const py = q.y + Math.sin(an) * rr;
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        }
        case 'ell': {
          const rx = lerp(q.s0, q.s1, 1 - (1 - u) * (1 - u));
          ctx.strokeStyle = col;
          lw(ctx, 0.8);
          ctx.beginPath();
          ctx.ellipse(q.x, q.y, rx, Math.max(0.6, rx * 0.16), 0, 0, TAU);
          ctx.stroke();
          break;
        }
        default:
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  drawPopups(ctx, pal) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.pop) {
      const u = p.life / p.max;
      ctx.globalAlpha = Math.min(1, u * 2.5);
      const s = p.size * (1 + Math.max(0, u - 0.8) * 2.5);
      ctx.font = `bold ${s}px ${FONT}`;
      ctx.lineJoin = 'round';
      lw(ctx, 3);
      ctx.strokeStyle = pal.dark;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.big ? pal.hot : pal.light;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  popup(x, y, text, big) {
    this.pop.push({ x, y, text, life: 1.1, max: 1.1, size: big ? 11 : 8, big });
  }

  // ── effect recipes ─────────────────────────────────────────
  explode(g, x, y, size = 1) {
    const s = size;
    const sq = Math.sqrt(s);
    this.add({ k: 'star', x, y, ang: rnd(0, 1.5), life: 0.12, s0: 10 * s, s1: 18 * s, ramp: ['light'], z: 1 });
    // multi-stage shockwave: solid ring + dashed calibration ring + delayed outer ring
    this.add({ k: 'ring', x, y, life: 0.38, s0: 2, s1: 26 * s, w0: 2.4, ramp: ['light', 'hot'], z: 1 });
    this.add({ k: 'cadShock', x, y, life: 0.55, s0: 4, s1: 40 * s, ramp: ['hot', 'light'], label: `R ${(s * 32).toFixed(0)}M`, z: 1 });
    this.add({ k: 'ring', x, y, life: 0.7, s0: 8 * s, s1: 52 * s, w0: 0.9, ramp: ['hot'], a: 0.6, z: 1 });

    // radiating debris lines
    for (let i = 0; i < 8 + 6 * s; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(140, 380) * sq;
      this.add({ k: 'tracer', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, g: 220, drag: 1.5, life: rnd(0.3, 0.7), ramp: ['light', 'hot'], w: 1, z: 1 });
    }
    // spinning polygon shards
    for (let i = 0; i < 4 + 4 * s; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(40, 200) * sq;
      this.add({
        k: 'poly', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        g: 380, drag: 0.6, r: rnd(0, TAU), vr: rnd(-12, 12), s0: rnd(1.6, 3.6) * Math.pow(s, 0.6),
        life: rnd(0.7, 1.4), ramp: ['light', 'light', 'mid'], fade: true, water: true, z: 1,
      });
    }
    // incandescent embers
    for (let i = 0; i < 4 + 5 * s; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(20, 140) * sq;
      this.add({
        k: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, drag: 2,
        life: rnd(0.35, 0.8), s0: rnd(3, 5) * Math.pow(s, 0.5), s1: 0.6, ramp: ['light', 'hot', 'hot', 'mid'], z: 1,
      });
    }
    // hollow rising smoke diamonds
    for (let i = 0; i < 2 + 3 * s; i++) {
      this.add({
        k: 'dot', x: x + rnd(-6, 6) * s, y: y + rnd(-4, 4) * s, vx: rnd(-16, 16), vy: -rnd(10, 35),
        drag: 0.7, life: rnd(0.9, 1.7), s0: rnd(3, 5), s1: rnd(9, 15) * Math.pow(s, 0.6), ramp: ['mid'], a: 0.7, fade: true, z: 0,
      });
    }
    if (y > SEA_Y - 14 * s) this.splash(x, 0.8 * s);
    g.addShake(0.12 + 0.17 * s);
    if (s >= 1) g.freeze(0.025 + 0.01 * Math.min(s, 3));
    if (s >= 2.2) g.flash = Math.max(g.flash, 0.45);
    if (s >= 1.3) g.invertF = Math.max(g.invertF || 0, 2); // 2-frame inverted flash on heavy kills
    // directional trauma: nearer blasts hit harder
    const d = Math.hypot(g.player.x - x, g.player.y - y);
    audio.explode(s, d);
    if (s >= 0.9) this.warp(x, y, s);
    if (d < 260) {
      const k = (1 - d / 260) * Math.min(s, 2.5);
      g.addShake(k * 0.25);
      if (g.addKick) g.addKick((g.player.x - x) / (d || 1), (g.player.y - y) / (d || 1), k);
    }
  }

  // spatial shockwave: the background grid bulges outward from the blast (rendered in scene.drawBackdrop)
  warp(x, y, s) {
    if (this.warps.length >= 6) this.warps.shift();
    this.warps.push({ x, y, amp: Math.min(16, 5 + 4.5 * s), age: 0 });
  }

  // persistent wireframe wreckage: chunks and girders that tumble, trail sparks and splash into the sea
  wreck(x, y, hw, hh, vx = 0, vy = 0, big = 1) {
    const n = Math.min(14, 3 + Math.round((hw / 9) * big));
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(30, 170) * (0.6 + big * 0.35);
      const ox = rnd(-hw, hw) * 0.8;
      const oy = rnd(-hh, hh) * 0.8;
      this.add({
        k: i % 3 === 0 ? 'rect' : 'poly', x: x + ox, y: y + oy,
        vx: vx * 0.35 + Math.cos(a) * sp, vy: vy * 0.25 + Math.sin(a) * sp - 70,
        g: 430, drag: 0.35, r: rnd(0, TAU), vr: rnd(-9, 9), s0: rnd(2.6, 6.5) * (0.8 + big * 0.3),
        life: rnd(1.5, 2.6), ramp: ['light', 'light', 'mid'], fade: true, water: true, z: 0,
      });
    }
  }

  // bomb release: pylon tick ring + two downward tick marks (a "REL" tag on the first of a ripple)
  release(x, y, ripple = 0) {
    this.add({ k: 'ring', x, y, life: 0.16, s0: 2, s1: 9, w0: 1.2, ramp: ['hot', 'light'], z: 1 });
    for (const dx of [-3, 3]) {
      this.add({ k: 'tracer', x: x + dx, y, vx: 0, vy: 70, life: 0.14, ramp: ['hot', 'light'], w: 1, z: 1 });
    }
    if (ripple === 0) this.add({ k: 'cadShock', x, y, life: 0.3, s0: 2, s1: 11, ramp: ['hot'], label: 'REL', z: 1 });
  }

  // water impact: ripple ellipses + short vertical spray lines + hollow puffs
  splash(x, size = 1) {
    const s = size;
    for (let i = 0; i < 5 + 7 * s; i++) {
      this.add({ k: 'tracer', x: x + rnd(-4, 4) * s, y: SEA_Y, vx: rnd(-45, 45) * s, vy: -rnd(70, 210) * Math.pow(s, 0.7), g: 520, life: rnd(0.45, 0.9), ramp: ['light', 'mid'], w: 0.9, z: 1 });
    }
    this.ripple(x, s);
    for (let i = 0; i < 1 + s; i++) {
      this.add({ k: 'dot', x: x + rnd(-6, 6) * s, y: SEA_Y - 2, vx: rnd(-10, 10), vy: -rnd(5, 20), life: rnd(0.6, 1.1), s0: 2, s1: 5 * s, ramp: ['light'], a: 0.6, fade: true, z: 0 });
    }
  }

  // concentric geometric wave ripples on the surface
  ripple(x, size = 1) {
    this.disturb(x, size);
    this.add({ k: 'ell', x, y: SEA_Y + 1, life: 0.9, s0: 2, s1: 26 * size, ramp: ['light'], a: 0.9, fade: true, z: 1 });
    this.add({ k: 'ell', x, y: SEA_Y + 1.5, life: 1.3, s0: 1, s1: 42 * size, ramp: ['hot'], a: 0.55, fade: true, z: 1 });
    this.add({ k: 'ell', x, y: SEA_Y + 2.5, life: 1.7, s0: 1, s1: 58 * size, ramp: ['mid'], a: 0.5, fade: true, z: 1 });
  }

  // Visual-only displacement of the water line (gameplay still uses terrain.waveY).
  disturb(x, amp) {
    for (const d of this.dist) {
      if (Math.abs(d.x - x) < 10 && d.age < 0.3) {
        d.amp = Math.max(d.amp, amp);
        d.age = Math.min(d.age, 0.15);
        return;
      }
    }
    if (this.dist.length < 14) this.dist.push({ x, amp, age: 0 });
  }

  // Extra surface height at x from recent impacts: a damped travelling ring wave.
  surfaceDelta(x) {
    let y = 0;
    for (let i = 0; i < this.dist.length; i++) {
      const d = this.dist[i];
      const r = Math.abs(x - d.x);
      const front = d.age * 90; // wavefront radius
      const rel = r - front;
      if (rel > 6 || rel < -46) continue;
      const env = Math.exp(-d.age * 1.8) * Math.exp(-(rel * rel) / 260);
      y += Math.sin(rel * 0.55) * env * Math.min(3.2, 1.2 + d.amp * 1.6);
    }
    return y;
  }

  muzzle(x, y, ang, size = 1) {
    this.add({ k: 'star', x, y, ang, life: 0.06, s0: 3 * size, s1: 4.5 * size, ramp: ['light', 'hot'], z: 1 });
    if (size >= 1.5 || Math.random() < 0.18) {
      const deg = Math.round((((ang * 180) / Math.PI) % 360 + 360) % 360);
      this.add({ k: 'cadArc', x, y, ang, r: 14 * size, life: 0.2, ramp: ['hot', 'mid'], label: `θ ${deg}°`, z: 1 });
    }
    for (let i = 0; i < 2; i++) {
      const a = ang + rnd(-0.25, 0.25);
      const sp = rnd(140, 280);
      this.add({ k: 'dotted', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.12, ramp: ['hot', 'light'], z: 1 });
    }
  }

  // Shockwave ring / sonic boom vapor cone
  shock(x, y, radius = 24, kind = 'ring', life = 0.35) {
    this.add({ k: kind, x, y, life, s0: 4, s1: radius, w0: 1.8, ramp: ['light', 'hot'], z: 1 });
  }

  // spent shell casing: ejected sideways-up, tumbles under gravity with light drag
  casing(x, y, ang, size = 1) {
    const a = ang - (Math.PI / 2) * (Math.cos(ang) >= 0 ? 1 : -1) + rnd(-0.4, 0.4);
    const sp = rnd(45, 95);
    this.add({ k: 'rect', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 25, g: 420, drag: 0.5, r: rnd(0, 3), vr: rnd(-26, 26), s0: 0.9 * size, life: rnd(0.8, 1.2), ramp: ['hot', 'mid'], water: true, z: 0 });
  }

  // armour impact: sharp vector sparks + small starburst
  spark(x, y, dx, dy, n = 4) {
    const base = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const a = base + Math.PI + rnd(-1.1, 1.1);
      const sp = rnd(80, 260);
      this.add({ k: 'tracer', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200, drag: 1.6, life: rnd(0.15, 0.35), ramp: ['light', 'hot'], w: 1, z: 1 });
    }
    this.add({ k: 'star', x, y, ang: base + 0.78, life: 0.08, s0: 2.5, s1: 3.5, ramp: ['light', 'hot'], z: 1 });
  }

  // smoke = hollow geometric puff (diamond outline that grows and fades)
  smoke(x, y, size = 1, ramp = ['mid'], a = 0.7) {
    this.add({ k: 'dot', x, y, vx: rnd(-8, 8), vy: -rnd(10, 30), drag: 0.5, life: rnd(0.9, 1.6), s0: 1.5 * size, s1: 5.5 * size, ramp, a, fade: true, z: 0 });
  }

  // contrail point → ribbon. `id` keys the stream (player, an enemy object…); `size` sets width.
  trail(x, y, size = 1, id = 'p') {
    let arr = this.streams.get(id);
    if (!arr) this.streams.set(id, (arr = []));
    const life = 0.55 + size * 0.3;
    const last = arr[arr.length - 1];
    const brk = !!last && last.max - last.life > 0.12; // emitter paused: don't bridge the gap
    arr.push({ x, y, life, max: life, brk, w: 1.2 + size * 1.5, a: Math.min(1, 0.55 + size * 0.3) });
    if (arr.length > RIB_MAX) arr.shift();
  }

  burn(x, y, size = 1) {
    this.add({ k: 'dot', x, y, vx: rnd(-10, 10), vy: -rnd(4, 24), life: rnd(0.3, 0.55), s0: 3.2 * size, s1: 0.8, ramp: ['light', 'hot', 'hot', 'mid'], z: 1 });
    if (Math.random() < 0.5) this.smoke(x, y, size * 0.9, ['mid'], 0.8);
  }

  wake(x, vx) {
    for (let i = 0; i < 2; i++) {
      this.add({ k: 'tracer', x, y: SEA_Y - 1, vx: -vx * rnd(0.05, 0.2) + rnd(-20, 20), vy: -rnd(20, 70), g: 420, life: rnd(0.3, 0.6), ramp: ['light'], w: 0.8, z: 1 });
    }
    this.add({ k: 'ell', x, y: SEA_Y + 1, life: 0.8, s0: 1, s1: 16, ramp: ['light'], a: 0.7, fade: true, z: 1 });
    this.add({ k: 'ell', x, y: SEA_Y + 2, life: 1.2, s0: 1, s1: 28, ramp: ['mid'], a: 0.5, fade: true, z: 1 });
  }
}
