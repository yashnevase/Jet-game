import { clamp, TAU } from './util.js';
import { surfaceY } from './terrain.js';
import { audio } from './audio.js';
import { RANKS, PALETTES } from './constants.js';
import { FONT, lw, dash, snap, segBar, brackets, inkReset, unit, line, W_FINE, W_RIB, W_OUT } from './cadRenderer.js';

// Minimal avionics HUD. During combat all telemetry stays small and at 35–50% opacity so the
// eye tracks the jet and incoming shells; only warnings (hull low, hit, banners) go to full.

const fmtN = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function txt(ctx, s, x, y, size, color, align = 'left', alpha = 1) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
}

// Border ticks that flash amber/red when the hull is hit or critical.
function damageTicks(ctx, g, w, h) {
  const { pal, player: P } = g;
  const low = clamp(1 - P.hp / (P.maxHp * 0.35), 0, 1);
  const hit = g.hitFlash || 0;
  const k = Math.max(hit, low * (0.45 + 0.25 * Math.sin(g.realT * 9)));
  if (k <= 0.02) return;
  const col = hit > 0.3 || low > 0.5 ? pal.danger : pal.hot;
  ctx.strokeStyle = col;
  lw(ctx, 2);
  ctx.globalAlpha = clamp(k, 0, 1);
  const n = 18;
  const len = 6 + 10 * k;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    const y = (i / n) * h;
    ctx.moveTo(x, 0); ctx.lineTo(x, len * (i % 3 === 0 ? 1 : 0.5));
    ctx.moveTo(x, h); ctx.lineTo(x, h - len * (i % 3 === 0 ? 1 : 0.5));
    ctx.moveTo(0, y); ctx.lineTo(len * (i % 3 === 0 ? 1 : 0.5), y);
    ctx.moveTo(w, y); ctx.lineTo(w - len * (i % 3 === 0 ? 1 : 0.5), y);
  }
  ctx.stroke();
  // corner brackets
  lw(ctx, 2);
  brackets(ctx, w / 2, h / 2, w / 2 - 3 * unit(), h / 2 - 3 * unit(), 26 * unit());
  ctx.globalAlpha = 1;
}

export function drawHUD(ctx, g, w, h) {
  const { pal, player: P, cam } = g;
  const play = g.mode === 'play' || g.mode === 'dying' || g.mode === 'paused';
  const menu = g.mode === 'menu';
  if (!play && !menu) return;
  const U = unit();
  ctx.save();
  ctx.lineJoin = 'miter';

  if (play) {
    damageTicks(ctx, g, w, h);

    // ── hull integrity: segmented bar with notches ──
    const ratio = clamp(P.hp / P.maxHp, 0, 1);
    const low = ratio < 0.3;
    const bx = snap(12);
    txt(ctx, 'HULL INTEGRITY', bx, 8, 7.5, pal.light, 'left', 0.6);
    segBar(ctx, bx, snap(19), 92, 5, 20, ratio, low && ((g.realT * 8) | 0) % 2 ? pal.danger : low ? pal.danger : pal.light, pal.mid + '55', null);
    txt(ctx, `${Math.round(ratio * 100)}%`, bx + 96, 18, 7.5, low ? pal.danger : pal.light, 'left', low ? 1 : 0.6);

    // ── tactical circular radar scope ──
    if (w > 560 && h > 340) {
      const rx = 52;
      const ry = 66;
      const rad = 28;
      ctx.save();
      ctx.strokeStyle = pal.mid;
      ctx.fillStyle = pal.dark;
      lw(ctx, W_FINE);
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, TAU);
      ctx.fill();
      ctx.stroke();
      dash(ctx, 2, 3);
      ctx.beginPath();
      ctx.arc(rx, ry, rad * 0.66, 0, TAU);
      ctx.arc(rx, ry, rad * 0.33, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(rx - rad, ry); ctx.lineTo(rx + rad, ry);
      ctx.moveTo(rx, ry - rad); ctx.lineTo(rx, ry + rad);
      ctx.stroke();
      const swAng = (g.realT * 2.6) % TAU;
      ctx.strokeStyle = pal.hot;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + Math.cos(swAng) * rad, ry + Math.sin(swAng) * rad);
      ctx.stroke();
      ctx.fillStyle = pal.light;
      ctx.globalAlpha = 1;
      ctx.fillRect(rx - 1, ry - 1, 2, 2);
      const radarRange = 1600;
      for (const e of g.enemies) {
        if (e.dying) continue;
        const edx = (e.x - P.x) / radarRange * rad;
        const edy = (e.y - P.y) / radarRange * rad;
        if (Math.hypot(edx, edy) <= rad - 1) {
          ctx.fillStyle = e.kind === 'jet' || e.kind === 'chopper' ? pal.danger : pal.hot;
          ctx.fillRect(rx + edx - 1, ry + edy - 1, 2.2, 2.2);
        }
      }
      ctx.restore();
      txt(ctx, 'RADAR // 1.6KM', rx, ry + rad + 4, 5.5, pal.light, 'center', 0.4);
    }
  }

  // ── secondary weapon ordnance meters (GTA V style AGM missiles & GBU bombs) ──
  if (play) {
    // On touch screens the thumb pads own the bottom corners, so the ordnance readout moves to bottom-centre.
    const touch = !!g.touch;
    const obx = touch ? snap(w / 2 - 78) : snap(12);
    const oby = snap(h - 32);
    const mLocked = g.lock && g.lock.t >= 1;
    // Missile status
    txt(ctx, `AGM-73 [ ${P.missiles || 0} / ${P.maxMissiles || 20} ]`, obx, oby, 7, mLocked ? pal.danger : pal.hot, 'left', 0.85);
    segBar(ctx, obx, oby + 10, 68, 3, 10, (P.missiles || 0) / (P.maxMissiles || 20), mLocked ? pal.danger : pal.hot, pal.mid + '44', null);
    // Bomb status
    txt(ctx, `GBU-12 [ ${P.bombs || 0} / ${P.maxBombs || 20} ]`, obx + 90, oby, 7, pal.light, 'left', 0.75);
    segBar(ctx, obx + 90, oby + 10, 68, 3, 10, (P.bombs || 0) / (P.maxBombs || 20), pal.light, pal.mid + '44', null);
    // Weapon control hint
    if (!touch) txt(ctx, '[M/X] GUIDED MISSILE | [B/C] GRAVITY BOMB [TAP/HOLD] | [SPACE] 30MM', obx, oby + 18, 5.5, pal.light, 'left', 0.35);

    // ── score & combo ──
    txt(ctx, fmtN(g.score), w / 2, 8, 16, pal.light, 'center', 0.92);
    if (g.combo >= 2) {
      const pulse = 1 + Math.max(0, g.comboT - 3.2) * 0.8;
      txt(ctx, `CHAIN x${g.mult}`, w / 2, 28, 8 * pulse, pal.hot, 'center');
      segBar(ctx, w / 2 - 30, snap(40), 60, 2, 12, clamp(g.comboT / 3.6, 0, 1), pal.hot, pal.mid + '44', null);
    }

    // ── rank / threat ──
    const curPal = PALETTES[g.palIdx] || PALETTES[0];
    txt(ctx, curPal.name, w - 12, 8, 7, pal.hot, 'right', 0.5);
    txt(ctx, `DEFCON ${g.rank}`, w - 12, 17, 7, pal.light, 'right', 0.5);
    const lo = RANKS[g.rank - 1] ?? 0;
    const hi = RANKS[g.rank] ?? lo + 1;
    const prog = g.rank >= RANKS.length ? 1 : clamp((g.score - lo) / (hi - lo), 0, 1);
    segBar(ctx, w - 12 - 70, snap(28), 70, 2, 14, prog, pal.light, pal.mid + '44', null);
    txt(ctx, audio.muted ? 'SND OFF [N]' : 'SND ON [N]', w - 12, 34, 5.5, audio.muted ? pal.danger : pal.light, 'right', audio.muted ? 0.8 : 0.35);

    // ── altitude tape: radar altimeter strip on the right edge, red floor = terrain hazard zone ──
    if (w > 480 && h > 300) {
      const tx = w - 40;
      const ty0 = 84;
      const ty1 = h - 58;
      const maxA = 900;
      const yAt = (a) => ty1 - (clamp(a, 0, maxA) / maxA) * (ty1 - ty0);
      ctx.save();
      ctx.strokeStyle = pal.light;
      ctx.globalAlpha = 0.3;
      lw(ctx, W_FINE);
      line(ctx, tx, ty0, tx, ty1);
      ctx.beginPath();
      for (let a = 0; a <= maxA; a += 100) {
        const y = snap(yAt(a));
        ctx.moveTo(tx - 2, y);
        ctx.lineTo(tx + (a % 300 === 0 ? 4 : 2), y);
      }
      ctx.stroke();
      for (let a = 0; a <= maxA; a += 300) txt(ctx, String(a), tx - 5, yAt(a) - 3, 5, pal.light, 'right', 0.28);
      ctx.fillStyle = pal.danger;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(tx - 1.5, yAt(70), 3, ty1 - yAt(70));
      const agl = Math.max(0, surfaceY(g, P.x) - P.y);
      const danger = agl < 70;
      const my = yAt(agl);
      ctx.fillStyle = danger ? pal.danger : pal.hot;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(tx + 1, my); ctx.lineTo(tx + 8, my - 3.5); ctx.lineTo(tx + 8, my + 3.5); ctx.closePath();
      ctx.fill();
      ctx.restore();
      txt(ctx, `RALT ${Math.round(agl)}M`, tx + 4, ty0 - 12, 5.5, danger ? pal.danger : pal.light, 'center', danger ? 0.95 : 0.45);
    }
  } else if (menu) {
    const curPal = PALETTES[g.palIdx] || PALETTES[0];
    txt(ctx, curPal.name, w - 12, 8, 7, pal.hot, 'right', 0.5);
    txt(ctx, 'SYSTEM: ARMED & READY', w - 12, 17, 7, pal.light, 'right', 0.65);
    txt(ctx, '12x AGM-73 | 16x GBU-12', w - 12, 28, 6.5, pal.hot, 'right', 0.85);
  }

  // ── flight avionics around the jet (pitch ladder, IAS, ALT) at 35–50% ──
  if (g.mode === 'play' && P.alive) {
    const jx = w / 2 + (P.x - cam.x) * cam.zoom;
    const jy = h / 2 + (P.y - cam.y) * cam.zoom;
    if (jx > 70 && jx < w - 70 && jy > 40 && jy < h - 40) {
      const spd = Math.round(Math.hypot(P.vx, P.vy) * 0.65);
      const altFt = Math.round(Math.max(0, -P.y * 3.28));
      const pitch = Math.atan2(Math.sin(P.a), Math.abs(Math.cos(P.a))) * 57.3;
      ctx.strokeStyle = pal.light;
      lw(ctx, 0.75);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (const deg of [-30, -20, -10, 10, 20, 30]) {
        const py = snap(jy + (deg + pitch) * 1.1);
        if (Math.abs(py - jy) > 60) continue;
        const half = deg % 20 === 0 ? 16 : 10;
        ctx.moveTo(jx - 54 - half, py); ctx.lineTo(jx - 54, py); ctx.lineTo(jx - 54, py + (deg > 0 ? 2.5 : -2.5));
        ctx.moveTo(jx + 54 + half, py); ctx.lineTo(jx + 54, py); ctx.lineTo(jx + 54, py + (deg > 0 ? 2.5 : -2.5));
      }
      ctx.stroke();
      // heading caret
      ctx.beginPath();
      ctx.moveTo(jx - 54, snap(jy)); ctx.lineTo(jx - 48, snap(jy));
      ctx.moveTo(jx + 54, snap(jy)); ctx.lineTo(jx + 48, snap(jy));
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Flight telemetry with dashed leader lines (Reference: media_1794999581534_1c837192.jpg)
      ctx.strokeStyle = pal.light;
      ctx.globalAlpha = 0.35;
      lw(ctx, W_FINE);
      dash(ctx, 3, 3);
      ctx.beginPath();
      ctx.moveTo(jx - 48, jy); ctx.lineTo(jx - 76, jy);
      ctx.moveTo(jx + 48, jy); ctx.lineTo(jx + 76, jy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      txt(ctx, `IAS ${spd} KT`, jx - 80, jy - 3, 6.5, pal.light, 'right', 0.6);
      txt(ctx, `ALT ${altFt} FT`, jx + 80, jy - 3, 6.5, pal.light, 'left', 0.6);
      txt(ctx, `THR ${Math.round((P.throttle || 0) * 100)}%${P.ab > 0.5 ? ' AB' : ''}`, jx - 80, jy + 6, 6, P.ab > 0.5 ? pal.hot : pal.light, 'right', P.ab > 0.5 ? 0.95 : 0.4);
      if (P.stall && ((g.realT * 6) | 0) % 2 === 0) txt(ctx, 'STALL', jx + 80, jy + 6, 6.5, pal.danger, 'left', 0.95);

      // High-G turn arc (5G / 7G turn vector shown in reference image)
      const gLoad = Math.max(1, Math.round((Math.abs(P.av || 0) * spd) / 140));
      if (gLoad >= 3) {
        ctx.strokeStyle = gLoad >= 6 ? pal.danger : pal.hot;
        lw(ctx, 1);
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        const turnDir = (P.av || 0) > 0 ? 1 : -1;
        ctx.arc(jx, jy, 48, P.a - 0.6 * turnDir, P.a + 0.6 * turnDir);
        ctx.stroke();
        txt(ctx, `${gLoad}G`, jx + Math.cos(P.a - 0.7 * turnDir) * 54, jy + Math.sin(P.a - 0.7 * turnDir) * 54, 6, pal.hot, 'center', 0.8);
      }
    }
  }

  // ── banner ──
  if (g.banner) {
    const a = clamp(g.banner.t / 0.6, 0, 1);
    txt(ctx, `◈ ${g.banner.text.toUpperCase()} ◈`, w / 2, h * 0.2, 14, pal.hot, 'center', a);
    txt(ctx, 'HOSTILE ESCALATION DETECTED // VECTOR INTERCEPT', w / 2, h * 0.2 + 19, 7, pal.light, 'center', a * 0.7);
  }

  // ── tactical hitmarker: crisp crosshair hit pips ──
  if (g.hitmarker && g.hitmarker.t > 0) {
    const hm = g.hitmarker;
    const isKill = hm.isKill;
    const jx = w / 2 + (P.x - cam.x) * cam.zoom;
    const jy = h / 2 + (P.y - cam.y) * cam.zoom;
    const hx = hm.x !== undefined ? w / 2 + (hm.x - cam.x) * cam.zoom : jx;
    const hy = hm.y !== undefined ? h / 2 + (hm.y - cam.y) * cam.zoom : jy;

    ctx.save();
    ctx.strokeStyle = isKill ? pal.danger : pal.hot;
    ctx.globalAlpha = clamp(hm.t / (isKill ? 0.28 : 0.16), 0, 1);
    lw(ctx, isKill ? 2 : 1.2);
    const sz = isKill ? 8 : 5.5;

    // Draw hitmarker around reticle and impact point
    for (const [cx, cy] of [[jx, jy], [hx, hy]]) {
      if (cx > 10 && cx < w - 10 && cy > 10 && cy < h - 10) {
        ctx.beginPath();
        ctx.moveTo(cx - sz, cy - sz); ctx.lineTo(cx - 2, cy - 2);
        ctx.moveTo(cx + sz, cy - sz); ctx.lineTo(cx + 2, cy - 2);
        ctx.moveTo(cx - sz, cy + sz); ctx.lineTo(cx - 2, cy + 2);
        ctx.moveTo(cx + sz, cy + sz); ctx.lineTo(cx + 2, cy + 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── GPWS ground proximity / terrain avoidance warning ──
  if (P.gpws && g.mode === 'play') {
    const flash = ((g.realT * 7) | 0) % 2 === 0;
    if (flash) {
      txt(ctx, '⚠ PULL UP // TERRAIN PROXIMITY ⚠', w / 2, h - 38, 10, pal.danger, 'center', 0.95);
      ctx.strokeStyle = pal.danger;
      lw(ctx, 1.5);
      brackets(ctx, w / 2, h - 33, 90, 12, 6);
    }
  }

  // ── off-screen threat chevrons ──
  let shown = 0;
  for (const e of g.enemies) {
    if (e.dying || shown > 6) continue;
    const k = e.kind;
    if (k !== 'jet' && k !== 'chopper' && k !== 'carrier' && k !== 'radar') continue;
    const sx = w / 2 + (e.x - cam.x) * cam.zoom;
    const sy = h / 2 + (e.y - cam.y) * cam.zoom;
    if (sx > 20 && sx < w - 20 && sy > 20 && sy < h - 20) continue;
    const dist = Math.hypot(e.x - P.x, e.y - P.y);
    if (dist > 1800) continue;
    const maxX = w > 480 ? w - 84 : w - 16; // keep chevrons out of the altitude-tape lane on the right edge
    const cx = clamp(sx, 16, maxX);
    const cy = clamp(sy, 56, h - 16);
    const a = Math.atan2(sy - h / 2, sx - w / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.strokeStyle = k === 'jet' ? pal.danger : pal.hot;
    lw(ctx, 1);
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-4, -5); ctx.lineTo(-1, 0); ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    txt(ctx, `${k.toUpperCase()} ${Math.round(dist * 0.2)}M`, clamp(cx, 34, maxX - 18), cy + 8, 6, pal.light, 'center', 0.5);
    shown++;
  }
  ctx.restore();
  inkReset(ctx);
}
