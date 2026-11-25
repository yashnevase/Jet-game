import { clamp, damp } from './util.js';
import { drawFighter, mountWorld, MOUNTS } from './airframe.js';

// Player fighter: the shared Flanker-style airframe plus the player's own visual state
// (afterburner smoothing, steering deflection, gun recoil). No landing gear: the jet never lands.

export const PLAYER_SCALE = (p) => (p.hull.scale || 1) * 1.25;

// World position of one of the player's gun muzzles (bullets and muzzle flashes spawn here).
export function playerMuzzle(p, i = 0) {
  const list = MOUNTS[p.gun.id] || MOUNTS.mg;
  return mountWorld(p.x, p.y, p.a, PLAYER_SCALE(p), list[i % list.length]);
}
// World position of the ejection port (behind the muzzle) for shell casings.
export function playerBreech(p, i = 0) {
  const list = MOUNTS[p.gun.id] || MOUNTS.mg;
  const m = list[i % list.length];
  return mountWorld(p.x, p.y, p.a, PLAYER_SCALE(p), { x: m.b + 1.5, y: m.y + 0.6 });
}

export function drawPlane(ctx, pal, p, t) {
  const dt = clamp(t - (p._vt === undefined ? t : p._vt), 0, 0.1);
  p._vt = t;
  p.burn = damp(p.burn || 0, (p.thrusting && !p.dying) || p.demo ? 1 : 0, 9, dt);
  const steer = clamp((p.av || 0) / p.hull.turn, -1, 1);
  const rec = p.firing && p.gun.rate ? clamp(p.cd * p.gun.rate, 0, 1) : 0;
  // recovery feedback: after a hull hit the jet strobes while invulnerable, so the player can read the grace window
  const strobe = p.inv > 0 && !p.dying && ((t * 22) | 0) % 2 === 0;
  if (strobe) ctx.globalAlpha = 0.35;
  drawFighter(ctx, pal, {
    x: p.x, y: p.y, a: p.a, S: PLAYER_SCALE(p), t,
    ink: p.flash > 0 ? pal.danger : pal.light,
    burn: p.burn, steer, rec, gun: p.gun.id, hull: p.hull.id,
    ab: p.demo ? 0.4 : p.ab || 0, bank: p.bank || 0, flipAnim: p.flipAnim,
  });
  if (strobe) ctx.globalAlpha = 1;
}
