import { SEA_Y } from './constants.js';
import { CFG } from './enemies.js';
import { DRAW } from './spritesEnemy.js';
import { drawPlane } from './spritesPlayer.js';
import { setUnit, segBar, inkReset } from './cadRenderer.js';
import { drawBackdrop, drawIsland, drawWater } from './scene.js';
import { updateLock, drawLock, drawPlayerTelemetry, drawThreatVectors, drawProjectiles, drawDiegetic } from './tactical.js';
import { drawHUD } from './hud.js';

// ─────────────────────────────────────────────────────────────
//  render: the frame pipeline. Everything is drawn at native device resolution:
//    canvas backing store = CSS size × devicePixelRatio, transform scale k = device px per logical unit.
//    setUnit() tells cadRenderer how many logical units make one CSS pixel, so a "2px" stroke is
//    2 CSS px (crisp) whatever the zoom, resolution or display density.
//  Order: backdrop (grid) → islands/ground → sea → back FX → air + player → tactical overlays →
//         projectiles → front FX → lock brackets → [shake ends] → HUD → flash / inverted flash.
// ─────────────────────────────────────────────────────────────

const BAR_KINDS = new Set(['destroyer', 'mg', 'art', 'aa']);

function drawEnemy(ctx, e, pal) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const ink = e.flash > 0 ? pal.hot : pal.light;
  if (e.dying === 'rubble') {
    DRAW.rubble(ctx, e, pal);
  } else {
    if (e.tilt && e.kind !== 'jet') ctx.rotate(e.tilt);
    DRAW[e.kind](ctx, e, pal, ink);
  }
  ctx.restore();

  // segmented integrity gauge once a structure has taken damage
  if (!e.dying && e.hp < e.maxHp && BAR_KINDS.has(e.kind)) {
    const bw = Math.max(18, e.hw * 1.5);
    const bx = e.x - bw / 2;
    const by = e.y - e.hh - 11;
    segBar(ctx, bx, by, bw, 2.4, 8, e.hp / e.maxHp, pal.hot, pal.mid + '55', pal.mid);
  }
}

export function render(g) {
  const ctx = g.ctx;
  if (!ctx) return;
  const { w, h } = g.view;
  const { pal, cam } = g;
  const cv = g.canvas;
  const k = cv.width / w; // device px per logical unit
  const dpr = g.dpr || 1;
  const U = dpr / k; // logical units per CSS px

  // clear in device pixels, then work in logical units
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = pal.dark;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  setUnit(U, k);

  updateLock(g);

  // ── scene shake: trauma² noise + directional kick from nearby blasts ──
  const tr = cam.trauma * cam.trauma;
  const sx = (Math.random() * 2 - 1) * tr * 12 + (cam.kx || 0);
  const sy = (Math.random() * 2 - 1) * tr * 12 + (cam.ky || 0);
  ctx.save();
  ctx.translate(w / 2 + sx, h / 2 + sy);
  ctx.rotate((Math.random() * 2 - 1) * tr * 0.02);
  ctx.translate(-w / 2, -h / 2);

  drawBackdrop(ctx, g, w, h);

  // ── world pass ──
  const z = cam.zoom;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);
  setUnit(U / z, k * z);

  const vw = (w / z) * 0.62 + 50;
  const vh = (h / z) * 0.62 + 50;
  const L = cam.x - vw;
  const R = cam.x + vw;
  const T = cam.y - vh;
  const B = cam.y + vh;
  const seen = (e, m = 0) => e.x + e.hw + m > L && e.x - e.hw - m < R && e.y + e.hh + m > T && e.y - e.hh - m < B;

  for (const isl of g.islands) if (isl.x1 > L && isl.x0 < R) drawIsland(ctx, pal, isl, Math.abs(Math.floor(isl.x0 / 400)));
  for (const e of g.enemies) if (!CFG[e.kind].air && seen(e, 25)) drawEnemy(ctx, e, pal);

  drawWater(ctx, g, L, R, Math.max(B, SEA_Y + 70));

  g.fx.draw(ctx, pal, 0);
  for (const e of g.enemies) if (CFG[e.kind].air && seen(e, 35)) drawEnemy(ctx, e, pal);
  if (g.player.alive && g.mode !== 'over') drawPlane(ctx, pal, g.player, g.realT);

  drawThreatVectors(ctx, g, seen);
  drawPlayerTelemetry(ctx, g);
  drawDiegetic(ctx, g);
  drawProjectiles(ctx, g);
  g.fx.draw(ctx, pal, 1);
  g.fx.drawPopups(ctx, pal);
  drawLock(ctx, g);

  ctx.restore();
  ctx.restore();

  // ── screen-space layers (no shake) ──
  setUnit(U, k);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (g.flash > 0) {
    ctx.globalAlpha = Math.min(0.32, g.flash * 0.45);
    ctx.fillStyle = pal.light;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  drawHUD(ctx, g, w, h);

  // 2-frame inverted flash on heavy kills
  if (g.invertF > 0) {
    g.invertF--;
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  inkReset(ctx);
}
