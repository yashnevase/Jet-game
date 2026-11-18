import { SEA_Y } from './constants.js';

// Animated sea surface. Two sines is enough to feel like swell.
export const waveY = (x, t) => SEA_Y + Math.sin(x * 0.021 + t * 1.7) * 1.6 + Math.sin(x * 0.049 - t * 1.15) * 0.9;

// Height (above sea level) of an island at world x. Steep rocky shores, bumpy top.
export function islandH(isl, x) {
  const t = (x - isl.x0) / (isl.x1 - isl.x0);
  if (t <= 0 || t >= 1) return 0;
  const base = 1 - Math.pow(Math.abs(2 * t - 1), 1.8);
  const bump = 0.82 + 0.18 * Math.sin(t * 11 + isl.ph) + 0.08 * Math.sin(t * 27 + isl.ph * 2);
  return isl.h * Math.pow(base, 0.7) * bump;
}

// Y of the solid surface at x (land if an island is there, otherwise the sea).
export function surfaceY(g, x) {
  let y = SEA_Y;
  for (const isl of g.islands) {
    if (x > isl.x0 && x < isl.x1) y = Math.min(y, SEA_Y - islandH(isl, x));
  }
  return y;
}
