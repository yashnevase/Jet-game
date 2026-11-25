import { clamp, angDiff, TAU } from './util.js';
import { ORDNANCE } from './constants.js';
import { surfaceY } from './terrain.js';
import { playerMuzzle } from './spritesPlayer.js';
import { jetMuzzle } from './spritesEnemy.js';
import {
  lw, dash, brackets, needle, arrow, label, cross, diamond, inkReset, line, leader, angleArc, W_RIB, W_FINE, W_OUT,
} from './cadRenderer.js';

// ─────────────────────────────────────────────────────────────
//  tactical: the "fire-control computer" layer. World-space overlays that make the screen read as a
//  live ballistics calculation:
//    • sight line / flight line / ballistic trajectory from the player jet (see reference diagram)
//    • target lock: CAD corner brackets, lead pip and DST / ALT leader callouts
//    • predicted impact arcs for artillery shells, proximity envelopes for flak
//    • velocity vectors on fast threats
//    • needle projectiles with white cores and amber tails
//  All of it is visual: nothing here feeds back into the simulation.
// ─────────────────────────────────────────────────────────────

const M = 0.2; // world units → metres, the same factor the HUD uses
const FT = 3.28;

// Tapered motion tail: a thin triangle from a point `len` behind the head, widening to `w` at the head.
function taper(ctx, x, y, ang, len, w) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  ctx.beginPath();
  ctx.moveTo(x - c * len, y - s * len);
  ctx.lineTo(x - s * w * 0.5, y + c * w * 0.5);
  ctx.lineTo(x + s * w * 0.5, y - c * w * 0.5);
  ctx.closePath();
  ctx.fill();
}

const enemyVel = (e) => {
  if (e.kind === 'jet') return [Math.cos(e.a) * e.speed, Math.sin(e.a) * e.speed];
  return [e.vx || 0, e.vy || 0];
};

// ── lock-on state machine (render-side only) ──
export function updateLock(g) {
  const P = g.player;
  const dt = clamp(g.realT - (g._lockT === undefined ? g.realT : g._lockT), 0, 0.1);
  g._lockT = g.realT;
  if (g.mode !== 'play' || !P.alive || P.dying) {
    g.lock = null;
    return;
  }
  let best = null;
  let bestScore = 1e9;
  for (const e of g.enemies) {
    if (e.dying) continue;
    const dx = e.x - P.x;
    const dy = e.y - P.y;
    const d = Math.hypot(dx, dy);
    if (d > 640 || d < 24) continue;
    const err = Math.abs(angDiff(P.a, Math.atan2(dy, dx)));
    const limit = 0.17 + 38 / d; // forgiving cone at close range
    if (err < limit && err * d < bestScore) {
      bestScore = err * d;
      best = e;
    }
  }
  if (best) {
    if (g.lock && g.lock.e === best) g.lock.t = Math.min(1, g.lock.t + dt * 4.5);
    else g.lock = { e: best, t: 0 };
    g.lock.hold = 0.25;
  } else if (g.lock) {
    g.lock.hold -= dt;
    if (g.lock.hold <= 0) g.lock.t -= dt * 5;
    if (g.lock.t <= 0) g.lock = null;
  }
}

// Intercept point for the player's gun against a moving target (two fixed-point iterations).
function leadPoint(P, e) {
  const [tvx, tvy] = enemyVel(e);
  const gs = P.gun.speed;
  let t = Math.hypot(e.x - P.x, e.y - P.y) / gs;
  let ax = e.x;
  let ay = e.y;
  for (let i = 0; i < 2; i++) {
    ax = e.x + (tvx - P.vx * 0.6) * t;
    ay = e.y + (tvy - P.vy * 0.6) * t;
    t = Math.hypot(ax - P.x, ay - P.y) / gs;
  }
  return [ax, ay];
}

// ── target lock brackets, lead pip, telemetry leader ──
export function drawLock(ctx, g) {
  const L = g.lock;
  if (!L) return;
  const { pal, player: P } = g;
  const e = L.e;
  const t = L.t;
  const locked = t >= 1;
  const ease = 1 - (1 - t) * (1 - t);
  const pad = 3 + (1 - ease) * 15;
  const hw = e.hw + pad;
  const hh = e.hh + pad;
  const cy = e.y;

  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = locked ? pal.danger : pal.hot;
  ctx.globalAlpha = 0.45 + 0.5 * ease;
  lw(ctx, locked ? 1.5 : 1);
  if (!locked) dash(ctx, 3, 2);
  brackets(ctx, e.x, cy, hw, hh, Math.min(6, hw * 0.5, hh * 0.8 + 2));
  ctx.setLineDash([]);

  // centre pip, ticks on the bracket mid-points
  ctx.globalAlpha = 0.35 + 0.4 * ease;
  lw(ctx, W_RIB);
  line(ctx, e.x - 1.6, cy, e.x + 1.6, cy);
  line(ctx, e.x, cy - 1.6, e.x, cy + 1.6);

  // leader with live range / altitude readout
  const d = Math.hypot(e.x - P.x, e.y - P.y);
  const air = e.kind === 'jet' || e.kind === 'chopper';
  const side = e.x >= P.x ? 1 : -1;
  const ox = e.x + side * hw;
  const oy = cy - hh;
  ctx.globalAlpha = 0.45 + 0.4 * ease;
  ctx.strokeStyle = pal.light;
  lw(ctx, W_RIB);
  leader(ctx, ox, oy, side * 9, -9, `DST ${Math.round(d * M)}M`, pal.light, 5.5);
  const tx = ox + side * 9 + side * 12;
  label(ctx, air ? `ALT ${Math.round(Math.max(0, -e.y) * FT)}FT` : `HP ${Math.max(0, Math.round((e.hp / e.maxHp) * 100))}%`, tx, oy - 9 + 8.2, pal.hot, 5.5, side > 0 ? 'left' : 'right', 0.85);
  if (locked) label(ctx, 'LOCK', tx, oy - 9 + 15.4, pal.danger, 5.5, side > 0 ? 'left' : 'right', 0.9);

  // lead pip + dotted firing solution once acquired
  if (ease > 0.55) {
    const [ax, ay] = leadPoint(P, e);
    ctx.strokeStyle = pal.hot;
    ctx.globalAlpha = 0.85 * ease;
    lw(ctx, 1);
    diamond(ctx, ax, ay, 2.6, 2.6);
    ctx.stroke();
    ctx.globalAlpha = 0.35 * ease;
    lw(ctx, W_FINE);
    dash(ctx, 2, 3);
    const [mx0, my0] = playerMuzzle(P, 0);
    line(ctx, mx0, my0, ax, ay);
    ctx.setLineDash([]);
  }
  ctx.restore();
  inkReset(ctx);
}

// ── player's sight line, flight line, bullet trajectory and θ pitch arc (all faint) ──
export function drawPlayerTelemetry(ctx, g) {
  const { pal, player: P } = g;
  if (g.mode !== 'play' || !P.alive || P.dying) return;
  const gun = P.gun;
  const ca = Math.cos(P.a);
  const sa = Math.sin(P.a);
  const [nx, ny] = playerMuzzle(P, 0);
  const k = P.firing ? 1 : 0.55;

  ctx.save();
  // sight line: the bore axis, hairline
  ctx.strokeStyle = pal.light;
  ctx.globalAlpha = 0.16 * k;
  lw(ctx, W_FINE);
  line(ctx, nx, ny, P.x + ca * 150, P.y + sa * 150);

  // ballistic trajectory: the bullet's real path (muzzle velocity + 60% inherited jet velocity), dotted, with range ticks
  const bvx = ca * gun.speed + P.vx * 0.6;
  const bvy = sa * gun.speed + P.vy * 0.6;
  const bs = Math.hypot(bvx, bvy);
  const bx = bvx / bs;
  const by = bvy / bs;
  const range = bs * gun.life;
  ctx.strokeStyle = pal.hot;
  ctx.globalAlpha = 0.3 * k;
  lw(ctx, W_RIB);
  dash(ctx, 3, 4);
  line(ctx, nx, ny, nx + bx * range, ny + by * range);
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.4 * k;
  ctx.beginPath();
  for (let i = 1; i <= 4; i++) {
    const r = (range * i) / 4;
    const px = nx + bx * r;
    const py = ny + by * r;
    ctx.moveTo(px - by * 2.2, py + bx * 2.2);
    ctx.lineTo(px + by * 2.2, py - bx * 2.2);
  }
  ctx.stroke();
  label(ctx, `${Math.round(range * M)}M`, nx + bx * range + bx * 5, ny + by * range + by * 5 + 2, pal.hot, 5, bx >= 0 ? 'left' : 'right', 0.4 * k);

  // flight line: velocity vector (this is where the jet is actually going)
  const sp = Math.hypot(P.vx, P.vy);
  if (sp > 40) {
    const len = clamp(sp * 0.1, 10, 46);
    ctx.strokeStyle = pal.hot;
    ctx.globalAlpha = 0.5;
    lw(ctx, W_RIB);
    arrow(ctx, P.x, P.y, P.x + (P.vx / sp) * len, P.y + (P.vy / sp) * len, 3);
  }

  // θ pitch arc against the local horizon
  const fwd = ca >= 0 ? 1 : -1;
  const pitch = Math.atan2(-sa, Math.abs(ca)) * 57.3; // degrees above horizon
  if (Math.abs(pitch) > 2) {
    const base = fwd > 0 ? 0 : Math.PI;
    ctx.strokeStyle = pal.light;
    ctx.globalAlpha = 0.32;
    lw(ctx, W_FINE);
    dash(ctx, 2, 3);
    line(ctx, P.x, P.y, P.x + fwd * 40, P.y);
    ctx.setLineDash([]);
    ctx.strokeStyle = pal.hot;
    ctx.globalAlpha = 0.45;
    lw(ctx, W_RIB);
    angleArc(ctx, P.x, P.y, 32, base, P.a, null, pal.hot);
    const mid = (base + P.a) / 2;
    label(ctx, `θ ${Math.round(pitch)}°`, P.x + Math.cos(mid) * 41, P.y + Math.sin(mid) * 41 + 2, pal.hot, 5.5, 'center', 0.5);
  }
  ctx.restore();
  inkReset(ctx);
}

// ── threat vectors: velocity arrows on fast air threats + unmistakable fire telegraphs ──
// Any enemy with `warn` set is about to shoot: a blinking dashed aim line, a warning triangle above it.
export function drawThreatVectors(ctx, g, seen) {
  const { pal, player: P } = g;
  ctx.save();
  for (const e of g.enemies) {
    if (e.dying || !seen(e, 60)) continue;
    const air = e.kind === 'jet' || e.kind === 'chopper';
    if (air) {
      const [vx, vy] = enemyVel(e);
      const sp = Math.hypot(vx, vy);
      if (sp >= 40) {
        const len = clamp(sp * 0.16, 8, 44);
        ctx.strokeStyle = pal.danger;
        ctx.globalAlpha = 0.42;
        lw(ctx, W_RIB);
        arrow(ctx, e.x, e.y, e.x + (vx / sp) * len, e.y + (vy / sp) * len, 2.8);
      }
    }
    if (e.warn) {
      const on = ((g.realT * 16) | 0) % 2 === 0;
      let ox = e.x;
      let oy = e.y;
      let ang;
      if (e.kind === 'jet') {
        [ox, oy] = jetMuzzle(e);
        ang = e.a;
      } else {
        ang = Math.atan2(P.y - e.y, P.x - e.x);
      }
      const reach = e.kind === 'art' ? 0 : e.kind === 'jet' ? 230 : 170;
      if (reach) {
        ctx.strokeStyle = pal.danger;
        ctx.globalAlpha = on ? 0.75 : 0.3;
        lw(ctx, W_FINE * 1.4);
        dash(ctx, 3, 3);
        line(ctx, ox, oy, ox + Math.cos(ang) * reach, oy + Math.sin(ang) * reach);
        ctx.setLineDash([]);
      }
      // warning triangle with "!" above the shooter
      const ty = e.y - e.hh - 12;
      ctx.globalAlpha = on ? 0.95 : 0.4;
      ctx.strokeStyle = pal.danger;
      lw(ctx, 1.1);
      ctx.beginPath();
      ctx.moveTo(e.x, ty - 5); ctx.lineTo(e.x + 5, ty + 3.5); ctx.lineTo(e.x - 5, ty + 3.5); ctx.closePath();
      ctx.stroke();
      label(ctx, '!', e.x, ty + 2.5, pal.danger, 6, 'center', ctx.globalAlpha);
    }
  }
  ctx.restore();
  inkReset(ctx);
}

// ── diegetic cues hugging the jet: ordnance arcs, bomb hold-charge, ripple pips, incoming-threat arcs ──
export function drawDiegetic(ctx, g) {
  const { pal, player: P } = g;
  if (g.mode !== 'play' || !P.alive || P.dying) return;
  ctx.save();
  ctx.lineCap = 'butt';
  const R = 30;
  const seg = (a0, a1, r) => { ctx.beginPath(); ctx.arc(P.x, P.y, r, a0, a1); ctx.stroke(); };
  const meter = (a0, a1, frac, dir, onCol, alpha, count = 10) => {
    const span = (a1 - a0) / count;
    const lit = Math.ceil(frac * count - 1e-6);
    for (let i = 0; i < count; i++) {
      const idx = dir > 0 ? i : count - 1 - i;
      const on = idx < lit;
      ctx.strokeStyle = on ? onCol : pal.mid;
      ctx.globalAlpha = on ? alpha : 0.22;
      lw(ctx, on ? 1.8 : 0.8);
      seg(a0 + i * span + span * 0.12, a0 + (i + 1) * span - span * 0.12, R);
    }
  };
  const dry = P.dry > 0 && ((g.realT * 20) | 0) % 2 === 0;
  // AGM-73: bottom-left arc, dims while the launcher cools down
  const mReady = 1 - clamp(P.missileCd / ORDNANCE.MISSILE_CD, 0, 1);
  const locked = g.lock && g.lock.t >= 1;
  meter(0.56 * Math.PI, 0.94 * Math.PI, (P.missiles || 0) / (P.maxMissiles || 20), -1, dry ? pal.danger : locked ? pal.danger : pal.hot, 0.35 + 0.5 * mReady);
  // GBU-12: bottom-right arc
  meter(0.06 * Math.PI, 0.44 * Math.PI, (P.bombs || 0) / (P.maxBombs || 25), 1, dry ? pal.danger : pal.light, 0.35 + 0.5 * (1 - clamp(P.bombCd / ORDNANCE.BOMB_TAP_CD, 0, 1)));
  // hold-to-ripple charge: an outer arc fills over the hold window, then the ripple pips take over
  if (P.bombHeld && !P.bombSpent && P.bombHoldT > 0.04) {
    const f = clamp(P.bombHoldT / ORDNANCE.BOMB_HOLD_T, 0, 1);
    ctx.strokeStyle = pal.hot;
    ctx.globalAlpha = 0.9;
    lw(ctx, 1.4);
    seg(0.06 * Math.PI, 0.06 * Math.PI + 0.38 * Math.PI * f, R + 4);
  }
  if (P.bombHeld && P.bombSpent) {
    const total = ORDNANCE.BOMB_SALVO;
    const done = total - P.bombSalvoN;
    ctx.fillStyle = pal.hot;
    ctx.strokeStyle = pal.hot;
    lw(ctx, 0.8);
    for (let i = 0; i < total; i++) {
      const px = P.x + (i - (total - 1) / 2) * 7;
      const py = P.y + R + 8;
      diamond(ctx, px, py, 2.2, 2.2);
      ctx.globalAlpha = i < done ? 1 : 0.35;
      if (i < done) ctx.fill();
      else ctx.stroke();
    }
  }
  // lock progress: a crisp tick ring that closes as the seeker acquires
  if (g.lock && !locked) {
    ctx.strokeStyle = pal.hot;
    ctx.globalAlpha = 0.8;
    lw(ctx, 1.2);
    seg(-Math.PI / 2, -Math.PI / 2 + TAU * g.lock.t, R + 9);
  }

  // incoming rounds: red arcs on the jet's bearing to each threat; thicker and blinking as impact nears
  for (const t of g.threats) {
    const blink = t.urgency > 0.6 ? (((g.realT * 14) | 0) % 2 === 0 ? 1 : 0.35) : 1;
    const half = 0.16 + 0.26 * t.urgency;
    ctx.strokeStyle = pal.danger;
    ctx.globalAlpha = (0.45 + 0.5 * t.urgency) * blink;
    lw(ctx, 1 + 2.2 * t.urgency);
    seg(t.ang - half, t.ang + half, R + 17);
    const cx = P.x + Math.cos(t.ang) * (R + 25);
    const cy = P.y + Math.sin(t.ang) * (R + 25);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t.ang + Math.PI);
    lw(ctx, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(5, -3); ctx.lineTo(5, 3); ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  inkReset(ctx);
}

// ── artillery shell arcs + impact predictions ──
function drawShellArc(ctx, g, b) {
  const { pal } = g;
  let x = b.x;
  let y = b.y;
  let vx = b.vx;
  let vy = b.vy;
  const dt = 0.05;
  let t = 0;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < 70; i++) {
    vy += b.g * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    ctx.lineTo(x, y);
    if (y > surfaceY(g, x)) break;
  }
  ctx.strokeStyle = pal.danger;
  ctx.globalAlpha = 0.55;
  lw(ctx, W_RIB);
  dash(ctx, 3, 4);
  ctx.stroke();
  ctx.setLineDash([]);
  // impact marker: cross + dashed 34-unit blast envelope + time-to-impact
  ctx.globalAlpha = 0.65;
  lw(ctx, W_RIB);
  cross(ctx, x, y, 2.4);
  ctx.globalAlpha = 0.32;
  dash(ctx, 2, 3);
  ctx.beginPath();
  ctx.arc(x, y, 34, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  label(ctx, `T-${t.toFixed(1)}S`, x, y - 38, pal.danger, 5.5, 'center', 0.7);
}

// ── projectiles: needles with white cores + amber tails; crimson threat rounds ──
export function drawProjectiles(ctx, g) {
  const { pal } = g;
  ctx.save();

  for (const b of g.eb) if (b.type === 'shell') drawShellArc(ctx, g, b);

  // player rounds
  for (const b of g.pb) {
    const sp = Math.hypot(b.vx, b.vy);
    const ang = Math.atan2(b.vy, b.vx);
    const heavy = b.size > 2;
    const Ln = clamp(sp * 0.032, 10, 34) * (heavy ? 1.25 : 1);
    ctx.fillStyle = pal.hot;
    ctx.globalAlpha = 0.22;
    taper(ctx, b.x, b.y, ang, Ln * 3.1, heavy ? 3.0 : 1.7);
    ctx.globalAlpha = 0.85;
    needle(ctx, b.x, b.y, ang, Ln, heavy ? 3.6 : 2.2);
    ctx.fillStyle = pal.light;
    ctx.globalAlpha = 1;
    needle(ctx, b.x, b.y, ang, Ln * 0.42, heavy ? 2 : 1.2);
  }

  // ── player guided homing missiles (GTA V style AGM) ──
  if (g.pm) {
    for (const m of g.pm) {
      // Missile guidance lock vector line
      if (m.tgt && !m.tgt.dying) {
        ctx.strokeStyle = pal.danger;
        ctx.globalAlpha = 0.35;
        lw(ctx, W_FINE);
        dash(ctx, 4, 4);
        line(ctx, m.x, m.y, m.tgt.x, m.tgt.y);
        ctx.setLineDash([]);
        diamond(ctx, m.tgt.x, m.tgt.y, 4, 4);
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.a);

      // Rocket motor flame: flickers once the motor is lit (cold coast before ignition)
      if (m.lit) {
        const fl = 0.8 + 0.35 * Math.sin(g.realT * 120 + m.x);
        ctx.fillStyle = pal.hot;
        ctx.strokeStyle = pal.hot;
        lw(ctx, 1);
        diamond(ctx, -9 - 3 * fl, 0, 5.5 * fl, 2.3);
        ctx.fill();
        ctx.fillStyle = pal.light;
        diamond(ctx, -7.5, 0, 2.4 * fl, 1.1);
        ctx.fill();
      }

      // Sleek missile body
      ctx.fillStyle = pal.fill;
      ctx.strokeStyle = pal.light;
      lw(ctx, 1.2);
      ctx.beginPath();
      ctx.moveTo(7.5, 0);
      ctx.lineTo(5.5, -1.3);
      ctx.lineTo(-5.5, -1.3);
      ctx.lineTo(-5.5, 1.3);
      ctx.lineTo(5.5, 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Steering canards & tail fins
      ctx.beginPath();
      ctx.moveTo(3, -2.2); ctx.lineTo(1.5, -1.3);
      ctx.moveTo(3, 2.2); ctx.lineTo(1.5, 1.3);
      ctx.moveTo(-4, -3.2); ctx.lineTo(-5.5, -1.3);
      ctx.moveTo(-4, 3.2); ctx.lineTo(-5.5, 1.3);
      ctx.stroke();

      ctx.restore();
    }
  }

  // ── player gravity strike bombs (GBU) ──
  if (g.bombs) {
    for (const b of g.bombs) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);

      ctx.fillStyle = pal.fill;
      ctx.strokeStyle = pal.light;
      lw(ctx, 1.2);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(3.5, -2.8);
      ctx.lineTo(-4.5, -2.8);
      ctx.lineTo(-6.5, -1.2);
      ctx.lineTo(-7.5, -2.4);
      ctx.lineTo(-8.5, -2.4);
      ctx.lineTo(-8.5, 2.4);
      ctx.lineTo(-7.5, 2.4);
      ctx.lineTo(-6.5, 1.2);
      ctx.lineTo(-4.5, 2.8);
      ctx.lineTo(3.5, 2.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // High-explosive yellow nose band
      ctx.strokeStyle = pal.hot;
      lw(ctx, 1);
      ctx.beginPath();
      ctx.moveTo(2, -2.8); ctx.lineTo(2, 2.8);
      ctx.stroke();

      ctx.restore();
    }
  }

  // enemy rounds
  for (const b of g.eb) {
    if (b.type === 'shell') {
      const ang = Math.atan2(b.vy, b.vx);
      ctx.fillStyle = pal.danger;
      ctx.globalAlpha = 0.8;
      needle(ctx, b.x, b.y, ang, 14, 3.4);
      ctx.fillStyle = pal.light;
      ctx.globalAlpha = 1;
      diamond(ctx, b.x, b.y, 3.2, 3.2);
      ctx.fill();
    } else if (b.type === 'flak') {
      const left = b.fuse - b.t;
      ctx.strokeStyle = pal.light;
      ctx.fillStyle = pal.hot;
      lw(ctx, 1);
      diamond(ctx, b.x, b.y, 3.4, 3.4);
      ctx.fill();
      ctx.stroke();
      // proximity-burst envelope, dashed, tightening and blinking as the fuse runs out
      if (left < 0.5) {
        const on = ((b.t * 24) | 0) % 2 === 0;
        ctx.strokeStyle = pal.danger;
        ctx.globalAlpha = on ? 0.7 : 0.25;
        lw(ctx, W_RIB);
        dash(ctx, 3, 3);
        ctx.beginPath();
        ctx.arc(b.x, b.y, 30, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    } else {
      const sp = Math.hypot(b.vx, b.vy);
      const ang = Math.atan2(b.vy, b.vx);
      ctx.fillStyle = pal.danger;
      ctx.globalAlpha = 0.26;
      taper(ctx, b.x, b.y, ang, clamp(sp * 0.045, 8, 22) * 2.6, 2.4);
      ctx.globalAlpha = 0.85;
      needle(ctx, b.x, b.y, ang, clamp(sp * 0.045, 8, 22), 2.6);
      ctx.fillStyle = pal.light;
      ctx.globalAlpha = 1;
      needle(ctx, b.x, b.y, ang, clamp(sp * 0.045, 8, 22) * 0.36, 1.3);
    }
  }
  ctx.restore();
  inkReset(ctx);
}
