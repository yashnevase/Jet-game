import { clamp, angDiff, TAU } from './util.js';
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

// ── threat vectors: faint velocity arrows on fast air threats, fire lines when a jet is shooting ──
export function drawThreatVectors(ctx, g, seen) {
  const { pal } = g;
  ctx.save();
  for (const e of g.enemies) {
    if (e.dying || (e.kind !== 'jet' && e.kind !== 'chopper') || !seen(e, 60)) continue;
    const [vx, vy] = enemyVel(e);
    const sp = Math.hypot(vx, vy);
    if (sp < 40) continue;
    const len = clamp(sp * 0.16, 8, 44);
    ctx.strokeStyle = pal.danger;
    ctx.globalAlpha = 0.42;
    lw(ctx, W_RIB);
    arrow(ctx, e.x, e.y, e.x + (vx / sp) * len, e.y + (vy / sp) * len, 2.8);
    if (e.kind === 'jet' && (e.burstN > 0 || e.cd < 0.3) && e.state === 'attack') {
      ctx.globalAlpha = 0.5;
      lw(ctx, W_FINE);
      dash(ctx, 2, 3);
      const [jx, jy] = jetMuzzle(e);
      line(ctx, jx, jy, jx + Math.cos(e.a) * 160, jy + Math.sin(e.a) * 160);
      ctx.setLineDash([]);
    }
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

      // Rocket motor flame
      ctx.fillStyle = pal.hot;
      ctx.strokeStyle = pal.hot;
      lw(ctx, 1);
      diamond(ctx, -8, 0, 4, 2.2);
      ctx.fill();

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
