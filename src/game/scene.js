import { SEA_Y } from './constants.js';
import { clamp } from './util.js';
import { waveY, islandH } from './terrain.js';
import { lw, dash, snap, label, inkReset, dimLine, line, W_OUT, W_RIB, W_FINE } from './cadRenderer.js';

// ─────────────────────────────────────────────────────────────
//  scene: the drafting-sheet world. Engineering grid with edge coordinate markers, wireframe ridge
//  lines, topographic island sections and a contoured sea surface.
//  Screen-space functions (backdrop) expect cadRenderer.setUnit() for the screen; world-space
//  functions (islands, water) expect it for the zoomed world transform.
// ─────────────────────────────────────────────────────────────

const MINOR = 20;
const MAJOR = 100;

// ── Backdrop: flat slate, multi-tier grid, edge ticks + coordinate labels, distant ridges ──
export function drawBackdrop(ctx, g, w, h) {
  const { pal, cam } = g;
  const z = cam.zoom;
  const hy = h / 2 + (SEA_Y - cam.y) * z;

  // surface: flat in CHALK CAD, a soft vertical fade in the other themes
  if (pal.sky === pal.sky2) {
    ctx.fillStyle = pal.sky;
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, Math.max(hy, h * 0.6));
    grad.addColorStop(0, pal.sky2);
    grad.addColorStop(1, pal.sky);
    ctx.fillStyle = grad;
  }
  ctx.fillRect(-40, -40, w + 80, h + 80);

  // world-fixed grid: 20-unit minor (3%) and 100-unit major (8%) divisions
  const x0 = cam.x - w / 2 / z - MINOR;
  const x1 = cam.x + w / 2 / z + MINOR;
  const y0 = cam.y - h / 2 / z - MINOR;
  const y1 = cam.y + h / 2 / z + MINOR;
  const sx = (wx) => snap(w / 2 + (wx - cam.x) * z);
  const sy = (wy) => snap(h / 2 + (wy - cam.y) * z);
  const ex = 40; // overscan so camera shake never exposes an unlined border
  for (const [step, alpha] of [[MINOR, 0.03], [MAJOR, 0.08]]) {
    ctx.strokeStyle = pal.grid || pal.light;
    ctx.globalAlpha = alpha;
    lw(ctx, 1);
    ctx.beginPath();
    for (let wx = Math.ceil(x0 / step) * step; wx <= x1; wx += step) {
      if (step === MINOR && wx % MAJOR === 0) continue;
      const x = sx(wx);
      ctx.moveTo(x, -ex);
      ctx.lineTo(x, h + ex);
    }
    for (let wy = Math.ceil(y0 / step) * step; wy <= y1; wy += step) {
      if (step === MINOR && wy % MAJOR === 0) continue;
      const y = sy(wy);
      ctx.moveTo(-ex, y);
      ctx.lineTo(w + ex, y);
    }
    ctx.stroke();
  }

  // edge coordinate markers: ticks on every grid line, labels on the majors (kept clear of the HUD)
  ctx.strokeStyle = pal.light;
  ctx.globalAlpha = 0.35;
  lw(ctx, 1);
  ctx.beginPath();
  for (let wx = Math.ceil(x0 / MINOR) * MINOR; wx <= x1; wx += MINOR) {
    const x = sx(wx);
    ctx.moveTo(x, h);
    ctx.lineTo(x, h - (wx % MAJOR === 0 ? 6 : 2.5));
  }
  for (let wy = Math.ceil(y0 / MINOR) * MINOR; wy <= y1; wy += MINOR) {
    const y = sy(wy);
    ctx.moveTo(w, y);
    ctx.lineTo(w - (wy % MAJOR === 0 ? 6 : 2.5), y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (let wx = Math.ceil(x0 / MAJOR) * MAJOR; wx <= x1; wx += MAJOR) {
    const x = w / 2 + (wx - cam.x) * z;
    if (x < 24 || x > w - 24) continue;
    label(ctx, `E${String(Math.round(wx / 10)).padStart(4, '0')}`, x, h - 9, pal.light, 5, 'center', 0.35);
  }
  for (let wy = Math.ceil(y0 / MAJOR) * MAJOR; wy <= y1; wy += MAJOR) {
    const y = h / 2 + (wy - cam.y) * z;
    if (y < 40 || y > h - 16) continue;
    const t = wy === 0 ? '0 MSL' : wy < 0 ? `+${-wy}` : `-${wy}`;
    label(ctx, t, w - 9, y + 2, wy === 0 ? pal.hot : pal.light, 5, 'right', wy === 0 ? 0.55 : 0.35);
  }

  // distant ridge wireframes (two parallax layers), faintly occluding the grid behind them
  for (const [f, hgt, a] of [[0.06, 96, 0.32], [0.14, 54, 0.5]]) {
    const off = cam.x * f;
    ctx.beginPath();
    ctx.moveTo(-10, hy);
    for (let px = -10; px <= w + 10; px += 8) {
      const x = px / z + off;
      const v = Math.sin(x * 0.0045 + 1.7) * 0.6 + Math.sin(x * 0.013 + 5.1) * 0.3 + Math.sin(x * 0.031 + 2) * 0.1;
      ctx.lineTo(px, hy - hgt * z * Math.max(0, v * 0.95 + 0.08));
    }
    ctx.lineTo(w + 10, hy);
    ctx.closePath();
    ctx.fillStyle = pal.dark;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.strokeStyle = pal.mid;
    ctx.globalAlpha = a + 0.2;
    lw(ctx, W_RIB);
    ctx.stroke();
  }

  // ── prominent horizon reference line: instant spatial orientation at 600+ px/s ──
  if (hy >= -10 && hy <= h + 10) {
    ctx.strokeStyle = pal.hot;
    ctx.globalAlpha = 0.5;
    lw(ctx, 1.4);
    dash(ctx, 12, 6);
    line(ctx, -ex, hy, w + ex, hy);
    ctx.setLineDash([]);
    // Navigational compass heading ticks along the horizon
    ctx.globalAlpha = 0.45;
    lw(ctx, 1);
    for (let wx = Math.ceil(x0 / 200) * 200; wx <= x1; wx += 200) {
      const x = sx(wx);
      if (x > 30 && x < w - 30) {
        const deg = Math.round((((wx * 0.15) % 360) + 360) % 360);
        line(ctx, x, hy - 4, x, hy + 4);
        label(ctx, `${String(deg).padStart(3, '0')}°`, x, hy - 7, pal.hot, 5, 'center', 0.6);
      }
    }
    label(ctx, '0 MSL // SEA LEVEL HORIZON', w / 2, hy + 6, pal.hot, 5.5, 'center', 0.45);
  }

  // High-altitude flight strata (FL180, FL240, FL300) to orient pilots during vertical climbs
  for (const [alt, fl] of [[-600, 'FL180'], [-1200, 'FL240'], [-1800, 'FL300']]) {
    const y = sy(alt);
    if (y >= 10 && y <= h - 10) {
      ctx.strokeStyle = pal.light;
      ctx.globalAlpha = 0.18;
      lw(ctx, W_FINE);
      dash(ctx, 6, 8);
      line(ctx, -ex, y, w + ex, y);
      ctx.setLineDash([]);
      label(ctx, `AIR CORRIDOR ${fl} // ALT ${-alt}M`, 36, y - 5, pal.light, 5, 'left', 0.3);
    }
  }

  ctx.globalAlpha = 1;
}

// ── Islands: authentic 3D wireframe topographic mesh terrain (Reference: Chalk CAD Mesh) ──
function islandGeo(isl) {
  if (isl._cad) return isl._cad;
  const xs = [];
  for (let x = isl.x0; x < isl.x1; x += 5) xs.push(x);
  xs.push(isl.x1);
  const sil = new Path2D();
  const top = new Path2D();
  const meshLines = new Path2D();
  const floor = SEA_Y + 48;
  sil.moveTo(isl.x0, floor);
  let peakX = isl.x0;
  let peakH = 0;
  xs.forEach((x, i) => {
    const hgt = islandH(isl, x);
    if (hgt > peakH) { peakH = hgt; peakX = x; }
    sil.lineTo(x, SEA_Y - hgt);
    if (i === 0) top.moveTo(x, SEA_Y - hgt);
    else top.lineTo(x, SEA_Y - hgt);
  });
  sil.lineTo(isl.x1, floor);
  sil.closePath();

  // 1. Terraced longitudinal contour elevations along terrain curve (3D mesh horizontal rings)
  for (const f of [0.18, 0.36, 0.54, 0.72, 0.88]) {
    let started = false;
    for (const x of xs) {
      const hgt = islandH(isl, x) * f;
      if (hgt < 1.0) { started = false; continue; }
      if (!started) { meshLines.moveTo(x, SEA_Y - hgt); started = true; }
      else meshLines.lineTo(x, SEA_Y - hgt);
    }
  }

  // 2. Transverse topographic rib struts (3D wireframe mesh vertical ribs spaced across the hill)
  const ribStep = 16;
  const startX = Math.ceil(isl.x0 / ribStep) * ribStep;
  for (let x = startX; x <= isl.x1; x += ribStep) {
    const hgt = islandH(isl, x);
    if (hgt > 2) {
      meshLines.moveTo(x, SEA_Y - hgt);
      // Perspective drape downward with slight isometric curve
      meshLines.lineTo(x - (x - isl.x0) * 0.08, SEA_Y + 48);
    }
  }

  isl._cad = { sil, top, meshLines, peakX, peakH };
  return isl._cad;
}

export function drawIsland(ctx, pal, isl, idx) {
  const G = islandGeo(isl);
  ctx.save();
  ctx.fillStyle = pal.fill;
  ctx.fill(G.sil);

  // 3D Topographic wireframe mesh lines (Chalk CAD style)
  ctx.save();
  ctx.clip(G.sil);
  ctx.strokeStyle = pal.hot;
  ctx.globalAlpha = 0.38;
  lw(ctx, W_FINE);
  ctx.stroke(G.meshLines);
  ctx.restore();

  // Terrain surface ridge (primary bold CAD outline)
  ctx.strokeStyle = pal.light;
  lw(ctx, W_OUT);
  ctx.lineJoin = 'round';
  ctx.stroke(G.top);

  // Topographic crest glowing wireframe rim
  ctx.strokeStyle = pal.hot;
  ctx.globalAlpha = 0.65;
  lw(ctx, W_RIB);
  ctx.stroke(G.top);
  inkReset(ctx);

  // Shoreline datum ticks + peak elevation callout
  ctx.strokeStyle = pal.light;
  ctx.globalAlpha = 0.6;
  lw(ctx, W_RIB);
  line(ctx, isl.x0, SEA_Y, isl.x0, SEA_Y + 8);
  line(ctx, isl.x1, SEA_Y, isl.x1, SEA_Y + 8);
  ctx.strokeStyle = pal.hot;
  ctx.globalAlpha = 0.6;
  dimLine(ctx, G.peakX + 8, SEA_Y, G.peakX + 8, SEA_Y - G.peakH, 2.2);
  label(ctx, `ELEV +${Math.round(G.peakH)}M`, G.peakX + 13, SEA_Y - G.peakH * 0.5, pal.hot, 5.5, 'left', 0.8);
  label(ctx, `SECTOR-${String(idx).padStart(2, '0')}`, G.peakX - 8, SEA_Y - G.peakH - 4, pal.light, 5.5, 'right', 0.6);
  ctx.restore();
}

// ── Sea: contoured surface, section hatching, datum ticks, impact ripples ──
export function drawWater(ctx, g, x0, x1, bottom) {
  const { pal, t, fx } = g;
  const step = 8;
  const xa = Math.floor(x0 / step) * step;
  const n = Math.ceil((x1 + 10 - xa) / step) + 1;
  const ys = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = xa + i * step;
    ys[i] = waveY(x, t) + fx.surfaceDelta(x);
  }

  ctx.save();
  ctx.fillStyle = pal.fill;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(xa, bottom);
  for (let i = 0; i < n; i++) ctx.lineTo(xa + i * step, ys[i]);
  ctx.lineTo(xa + (n - 1) * step, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // section hatching under the surface: staggered 45° dashes in three bands
  ctx.strokeStyle = pal.mid;
  ctx.globalAlpha = 0.4;
  lw(ctx, W_FINE);
  ctx.beginPath();
  for (let row = 0; row < 3; row++) {
    const depth = 7 + row * 15;
    const sp = 16;
    const first = Math.ceil((x0 - row * 5) / sp) * sp + row * 5;
    for (let x = first; x < x1; x += sp) {
      const yy = waveY(x, t) + fx.surfaceDelta(x) + depth;
      ctx.moveTo(x, yy);
      ctx.lineTo(x - 6, yy + 6);
    }
  }
  ctx.stroke();

  // depth contour lines (dashed, phase-shifted copies of the swell)
  ctx.strokeStyle = pal.mid;
  ctx.globalAlpha = 0.55;
  lw(ctx, W_RIB);
  dash(ctx, 5, 5);
  for (const depth of [20, 44, 76]) {
    ctx.beginPath();
    for (let x = xa; x <= x1 + 12; x += 12) {
      const yy = waveY(x + depth * 3, t * 0.7) + depth;
      if (x === xa) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  inkReset(ctx);

  // primary surface line
  ctx.strokeStyle = pal.light;
  lw(ctx, 1.8);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xa + i * step;
    if (i === 0) ctx.moveTo(x, ys[i]);
    else ctx.lineTo(x, ys[i]);
  }
  ctx.stroke();

  // dynamic wave crest foam chevrons along high wave peaks
  ctx.strokeStyle = pal.hot;
  ctx.globalAlpha = 0.7;
  lw(ctx, 1);
  ctx.beginPath();
  for (let i = 1; i < n - 1; i++) {
    // If local peak in the swell
    if (ys[i] < ys[i - 1] && ys[i] < ys[i + 1]) {
      const x = xa + i * step;
      const y = ys[i];
      ctx.moveTo(x - 5, y + 1.8);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 5, y + 1.8);
    }
  }
  ctx.stroke();

  // elevation datum ticks standing on the surface: every 20 units, long every 100
  ctx.strokeStyle = pal.light;
  ctx.globalAlpha = 0.55;
  lw(ctx, W_RIB);
  ctx.beginPath();
  for (let x = Math.ceil(x0 / MINOR) * MINOR; x < x1; x += MINOR) {
    const yy = waveY(x, t) + fx.surfaceDelta(x);
    const big = x % MAJOR === 0;
    ctx.moveTo(x, yy);
    ctx.lineTo(x, yy - (big ? 6 : 2.5));
  }
  ctx.stroke();
  ctx.restore();
}
