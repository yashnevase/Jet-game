import { TAU } from './util.js';

// ─────────────────────────────────────────────────────────────
//  cadRenderer: reusable CAD drawing primitives.
//  Stroke hierarchy used by every vehicle (jets, ships, tanks, helicopters…):
//    W_OUT  2.0px  outer silhouette (drafting white, dark fill)
//    W_RIB  0.75px internal ribs / panel lines / spars
//    W_FINE 0.5px  construction lines, dimension ticks, dashed guides
//  Functions never allocate per call beyond tiny arrays; safe in the hot loop.
// ─────────────────────────────────────────────────────────────

export const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';
export const W_OUT = 2;
export const W_RIB = 0.75;
export const W_FINE = 0.5;

// The game's logical canvas is small (380 units tall) and scaled up to the screen, so
// "2px" must be converted to logical units. render() calls setUnit(1 / pixelsPerUnit)
// before each pass; every width/dash below is multiplied by it (and divided by any local
// sprite scale `s`) so lines stay a constant, razor-sharp thickness on screen.
let U = 1;
let K = 1; // device pixels per logical unit
export const setUnit = (u, k = 1) => { U = u; K = k; };
// Snap to a device-pixel centre so 1px lines never straddle two pixels (razor-sharp).
export const snap = (v) => (Math.round(v * K) + 0.5) / K;
export const unit = () => U;
export const lw = (ctx, w, s = 1) => { ctx.lineWidth = (w * U) / s; };
export const dash = (ctx, a, b, s = 1) => ctx.setLineDash([(a * U) / s, (b * U) / s]);

export const poly = (ctx, pts) => {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
};

export const line = (ctx, x1, y1, x2, y2) => {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
};

// Several segments in one stroke: segs = [x1,y1,x2,y2, x1,y1,x2,y2, …]
export const lines = (ctx, segs) => {
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo(segs[i], segs[i + 1]);
    ctx.lineTo(segs[i + 2], segs[i + 3]);
  }
  ctx.stroke();
};

// Layer 1: bold silhouette with dark interior fill.
// `pts` is a flat polygon. `ink` overrides the outline colour (hit flash).
export function hull(ctx, pal, pts, ink, s = 1) {
  ctx.fillStyle = pal.fill || pal.dark;
  ctx.strokeStyle = ink || pal.light;
  lw(ctx, W_OUT, s);
  ctx.lineJoin = 'round';
  poly(ctx, pts);
  ctx.fill();
  ctx.stroke();
}

// Same as hull() for an arbitrary already-built path function.
export function hullPath(ctx, pal, build, ink, s = 1) {
  ctx.fillStyle = pal.fill || pal.dark;
  ctx.strokeStyle = ink || pal.light;
  lw(ctx, W_OUT, s);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  build(ctx);
  ctx.fill();
  ctx.stroke();
}

// Layer 2: thin internal structure. Call rib(ctx, pal) once, then draw lines.
export function rib(ctx, pal, s = 1, alpha = 0.9) {
  ctx.strokeStyle = pal.rib || pal.light;
  lw(ctx, W_RIB, s);
  ctx.globalAlpha = alpha * 0.7;
}
export function fine(ctx, pal, s = 1, alpha = 0.7) {
  ctx.strokeStyle = pal.mid;
  lw(ctx, W_FINE, s);
  ctx.globalAlpha = alpha;
}
export const inkReset = (ctx) => { ctx.globalAlpha = 1; ctx.setLineDash([]); };

export function circle(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// Corner brackets ┌ ┐ └ ┘ around a rect centred at (cx,cy).
export function brackets(ctx, cx, cy, hw, hh, len = 5) {
  const l = Math.min(len, hw, hh);
  ctx.beginPath();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = cx + sx * hw;
      const y = cy + sy * hh;
      ctx.moveTo(x - sx * l, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * l);
    }
  }
  ctx.stroke();
}

// Small monospace label with a leader line from (x1,y1) to a text anchor.
export function leader(ctx, x1, y1, dx, dy, text, color, size = 6.5) {
  const x2 = x1 + dx;
  const y2 = y1 + dy;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 + (dx >= 0 ? 10 : -10), y2);
  ctx.stroke();
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = dx >= 0 ? 'left' : 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x2 + (dx >= 0 ? 12 : -12), y2 + size * 0.35);
}

// Degree arc between two angles around (x,y) with optional label.
export function angleArc(ctx, x, y, r, a0, a1, label, color, size = 6) {
  ctx.beginPath();
  ctx.arc(x, y, r, Math.min(a0, a1), Math.max(a0, a1));
  ctx.stroke();
  if (label) {
    const m = (a0 + a1) / 2;
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + Math.cos(m) * (r + 8), y + Math.sin(m) * (r + 8));
  }
}

// Dotted ballistic arc sampled from an initial state under constant gravity.
export function ballisticArc(ctx, x, y, vx, vy, grav, steps, dt) {
  dash(ctx, 3, 4);
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < steps; i++) {
    x += vx * dt;
    y += vy * dt;
    vy += grav * dt;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// Dimension tick: short perpendicular cap at both ends of a segment.
export function dimLine(ctx, x1, y1, x2, y2, cap = 2.5) {
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
  const cx = Math.cos(a) * cap;
  const cy = Math.sin(a) * cap;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.moveTo(x1 - cx, y1 - cy); ctx.lineTo(x1 + cx, y1 + cy);
  ctx.moveTo(x2 - cx, y2 - cy); ctx.lineTo(x2 + cx, y2 + cy);
  ctx.stroke();
}

// 4-point vector starburst (muzzle flash): four kite-shaped spikes, long/short alternating.
export function starburst(ctx, x, y, ang, r, inner = 0.22) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = ang + (i * Math.PI) / 2;
    const long = i % 2 === 0 ? r : r * 0.55;
    ctx.moveTo(x + Math.cos(a + 0.35) * r * inner, y + Math.sin(a + 0.35) * r * inner);
    ctx.lineTo(x + Math.cos(a) * long, y + Math.sin(a) * long);
    ctx.lineTo(x + Math.cos(a - 0.35) * r * inner, y + Math.sin(a - 0.35) * r * inner);
  }
  ctx.fill();
}

// Diamond (rhombus) path, handy for shock diamonds and markers.
export function diamond(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(x - rx, y); ctx.lineTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry);
  ctx.closePath();
}

// Segmented bar: `n` cells, `ratio` filled. Crisp: caller passes pixel-aligned x/y.
export function segBar(ctx, x, y, w, h, n, ratio, on, off, edge) {
  const gap = 1;
  const cw = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, Math.max(0, ratio * n - i));
    ctx.fillStyle = off;
    ctx.fillRect(x + i * (cw + gap), y, cw, h);
    if (f > 0) {
      ctx.fillStyle = on;
      ctx.fillRect(x + i * (cw + gap), y, cw * f, h);
    }
  }
  if (edge) {
    ctx.strokeStyle = edge;
    lw(ctx, 1);
    ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
  }
}

// ── additional reusable primitives ───────────────────────────

// Tapered filled needle: head at (x,y) pointing along `ang`, tail `len` behind. `w` = full width at the head
// in screen px (converted through the current unit). Used for tracers, shells and velocity streaks.
export function needle(ctx, x, y, ang, len, w) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const h = (w * U) / 2;
  ctx.beginPath();
  ctx.moveTo(x + c * 0, y + s * 0);
  ctx.lineTo(x - c * len - s * h, y - s * len + c * h);
  ctx.lineTo(x - c * len * 0.82, y - s * len * 0.82);
  ctx.lineTo(x - c * len + s * h, y - s * len - c * h);
  ctx.closePath();
  ctx.fill();
}

// Line with an open arrowhead at (x2,y2).
export function arrow(ctx, x1, y1, x2, y2, head = 3) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.moveTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
  ctx.stroke();
}

// Small monospace label. Size is in logical units like everything else the caller draws in.
export function label(ctx, text, x, y, color, size = 6.5, align = 'left', alpha = 1, base = 'alphabetic') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

// Cross-hair "X" impact marker.
export function cross(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r);
  ctx.stroke();
}
