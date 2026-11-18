import { TAU, clamp } from './util.js';
import {
  poly, line, lines, hull, hullPath, rib, fine, inkReset, lw, dash, circle, diamond, angleArc, W_OUT, W_RIB, W_FINE,
} from './cadRenderer.js';
import { drawFighter, MOUNTS as JET_MOUNTS, mountWorld } from './airframe.js';

// ─────────────────────────────────────────────────────────────
//  Enemy / structure sprites. Same stroke hierarchy as the player jet (cadRenderer):
//  2px silhouette + dark fill, 0.75px panel lines, then procedural articulation.
//  DRAW[kind](ctx, e, pal, ink): origin = entity centre, units = world units.
//  Ships and ground units are authored with their keel / base on y = +hh.
//
//  GUN MOUNTS: ENEMY_MOUNTS is the single source of truth for where every turret sits. The sprite draws
//  barrels from it and enemies.js spawns projectiles from the same muzzle, so shots leave the barrel.
// ─────────────────────────────────────────────────────────────

export const ENEMY_SCALE_JET = 1.22;
const FLIP = { boat: 1, destroyer: 1, carrier: 1 }; // sea units mirror with e.dir

export const ENEMY_MOUNTS = {
  boat: [{ x: 26, y: -3, r: 3.6, len: 12 }],
  destroyer: [{ x: 42, y: -4.5, r: 4.8, len: 17 }, { x: -50, y: -4.5, r: 4.8, len: 17 }],
  carrier: [{ x: -104, y: -15, r: 3.8, len: 11 }, { x: -14, y: -15, r: 3.8, len: 11 }, { x: 112, y: -15, r: 3.8, len: 11 }],
  aa: [{ x: 6, y: -4, r: 3.8, len: 21, twin: true }],
  art: [{ x: 6, y: -1, r: 4, len: 31 }],
  mg: [{ x: 6, y: 1, r: 3, len: 14 }],
};

// World pivot of a turret mount, and the end of its barrel along `ang` (default: the current aim).
export function mountPos(e, i = 0) {
  const m = ENEMY_MOUNTS[e.kind][i];
  return [e.x + m.x * (FLIP[e.kind] ? e.dir : 1), e.y + m.y];
}
export function muzzlePos(e, i = 0, ang = e.aim) {
  const [x, y] = mountPos(e, i);
  const m = ENEMY_MOUNTS[e.kind][i];
  return [x + Math.cos(ang) * m.len, y + Math.sin(ang) * m.len];
}
// Fighter nose cannon (enemy interceptors) and the helicopter chin gun.
export function jetMuzzle(e) {
  return mountWorld(e.x, e.y, e.a, ENEMY_SCALE_JET, JET_MOUNTS.mg[0]);
}
export function jetTail(e) {
  return [e.x - Math.cos(e.a) * 26 * ENEMY_SCALE_JET, e.y - Math.sin(e.a) * 26 * ENEMY_SCALE_JET];
}
export function chopperMuzzle(e) {
  const f = e.face || 1;
  const la = chopperAim(e);
  return [e.x + f * (21 + Math.cos(la) * 9), e.y + 6 + Math.sin(la) * 9];
}
const chopperAim = (e) => clamp(e.face >= 0 ? e.aim : Math.PI - e.aim, -0.25, 1.1);

// ── shared helpers ──
function warnMark(ctx, pal, x, y) {
  ctx.fillStyle = pal.danger;
  ctx.strokeStyle = pal.light;
  lw(ctx, W_RIB);
  ctx.beginPath();
  ctx.moveTo(x, y - 3); ctx.lineTo(x + 2.8, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 2.8, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
const blink = (e) => e.warn && ((e.t * 14) | 0) % 2 === 0;

function rrect(ctx, x0, y0, x1, y1, r) {
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0);
  ctx.arc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x1, y1 - r);
  ctx.arc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  ctx.lineTo(x0 + r, y1);
  ctx.arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x0, y0 + r);
  ctx.arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

// Tracked running gear: belt, road wheels, return rollers. Base of the belt sits on y = bottom.
function tracks(ctx, pal, ink, x0, x1, top, bottom, wheels) {
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.9);
  rrect(ctx, x0, top, x1, bottom, (bottom - top) / 2.2);
  ctx.fill();
  ctx.stroke();
  rib(ctx, pal);
  const r = (bottom - top) * 0.3;
  const cy = (top + bottom) / 2 + 0.4;
  for (let i = 0; i < wheels; i++) {
    const x = x0 + (bottom - top) * 0.55 + ((x1 - x0 - (bottom - top) * 1.1) * i) / (wheels - 1);
    circle(ctx, x, cy, r, false, true);
    circle(ctx, x, cy, r * 0.38, false, true);
  }
  for (let x = x0 + 3; x < x1 - 2; x += 4) line(ctx, x, top + 0.2, x, top + 1.2); // track links
  inkReset(ctx);
}

// Rotating gun mount: shielded housing on a ring, recoiling barrel (optionally twin), muzzle brake,
// bore-evacuator bulge, ballistic bore ray + θ elevation arc while about to fire.
function gun(ctx, e, pal, ink, m, px, py) {
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.8);
  ctx.lineJoin = 'round';
  poly(ctx, [-m.r, 1.5, -m.r * 0.85, -m.r * 0.9, m.r * 0.85, -m.r * 0.9, m.r, 1.5]); // shielded housing
  ctx.fill();
  ctx.stroke();
  rib(ctx, pal);
  line(ctx, -m.r * 0.7, -m.r * 0.2, m.r * 0.7, -m.r * 0.2);
  circle(ctx, 0, 1.5, m.r * 0.3, false, true);
  inkReset(ctx);
  ctx.rotate(e.aim);
  const L = m.len - e.recoil * 3.8;
  const offs = m.twin ? [-1.7, 1.7] : [0];
  for (const o of offs) {
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.75);
    ctx.fillRect(0, o - 1.1, L, 2.2);
    ctx.strokeRect(0, o - 1.1, L, 2.2);
    ctx.fillRect(L - 2.6, o - 1.7, 2.6, 3.4); // muzzle brake
    ctx.strokeRect(L - 2.6, o - 1.7, 2.6, 3.4);
    ctx.fillRect(L * 0.45, o - 1.6, L * 0.14, 3.2); // bore evacuator
    ctx.strokeRect(L * 0.45, o - 1.6, L * 0.14, 3.2);
    rib(ctx, pal);
    line(ctx, L * 0.25, o - 1.1, L * 0.25, o + 1.1);
    inkReset(ctx);
  }
  if (e.warn) {
    fine(ctx, pal);
    dash(ctx, 2, 3);
    line(ctx, L + 2, 0, L + 24, 0);
    ctx.setLineDash([]);
    inkReset(ctx);
  }
  if (blink(e)) warnMark(ctx, pal, L + 6, 0);
  ctx.restore();
  if (e.warn) {
    ctx.save();
    ctx.translate(px, py);
    ctx.strokeStyle = pal.hot;
    lw(ctx, W_FINE);
    ctx.globalAlpha = 0.6;
    const a = Math.atan2(Math.sin(e.aim), Math.cos(e.aim));
    dash(ctx, 1.5, 2.5);
    angleArc(ctx, 0, 0, m.r + 8, Math.cos(a) >= 0 ? 0 : Math.PI, a, null, pal.hot);
    ctx.setLineDash([]);
    ctx.restore();
    inkReset(ctx);
  }
}
const sunGun = (ctx, e, pal, ink, i = 0) => {
  const [mx, my] = [ENEMY_MOUNTS[e.kind][i].x * (FLIP[e.kind] ? e.dir : 1), ENEMY_MOUNTS[e.kind][i].y];
  gun(ctx, e, pal, ink, ENEMY_MOUNTS[e.kind][i], mx, my);
};

// Waterline displacement: short dashes either side of a hull riding the sea.
function waterline(ctx, e, pal, half, y) {
  fine(ctx, pal);
  const ph = (e.t * 14) % 6;
  for (let i = 0; i < 3; i++) {
    const o = i * 6 + ph;
    line(ctx, -half - 4 - o, y, -half - 8 - o, y);
    line(ctx, half + 4 + o, y, half + 8 + o, y);
  }
  ctx.globalAlpha = 0.5;
  line(ctx, -half + 4, y + 2.5, half - 4, y + 2.5);
  inkReset(ctx);
}

// Carrier-borne Flanker (J-15 / Su-33) with wings folded upright on the carrier deck
function deckJet(ctx, pal, ink, x, y) {
  ctx.save();
  ctx.translate(x, y);
  const S = 0.62;
  ctx.scale(S, S);
  // Heavy carrier nose gear & catapult launch bar
  ctx.strokeStyle = ink;
  lw(ctx, W_RIB * 1.5);
  lines(ctx, [16, 2, 16, 7, 16, 6, 21, 7, -6, 4, -6, 7]);
  circle(ctx, 16, 7.5, 1.2, true, true);
  circle(ctx, -6, 7.5, 1.4, true, true);
  // Fuselage & needle radome
  hull(ctx, pal, [28, 0, 18, -2, 10, -4, -4, -4, -18, -3, -24, 0, -18, 3, 10, 4, 18, 2, 28, 0], ink);
  // Stepped tandem canopy
  hull(ctx, pal, [13, -3, 9, -6, 2, -6, -2, -4], ink);
  // Canards
  hull(ctx, pal, [10, 0, 12, 3, 8, 3.5, 6, 1], ink);
  // Inner wing root
  hull(ctx, pal, [5, 3.5, -4, 4.5, -12, 4.8, -10, 10, 1, 9], ink);
  // Folded outer wing panel (standing vertically upright at 90°)
  hull(ctx, pal, [0, 9, -1, 9, -1, -6, 0, -6], ink);
  hull(ctx, pal, [-7, 9.5, -8, 9.5, -8, -5.5, -7, -5.5], ink);
  // Vertical missile rail on folded wingtip + R-73 missile
  lines(ctx, [-1, -6, -1, -12, -8, -5.5, -8, -11.5]);
  // Twin canted vertical tails & stinger with arrestor hook
  hull(ctx, pal, [-8, -4, -15, -13, -19, -13, -17, -3], ink);
  hull(ctx, pal, [-18, -1, -27, 0, -18, 1], ink);
  // Arrestor hook stowed under stinger
  line(ctx, -14, 2.5, -24, 1.5);
  rib(ctx, pal);
  lines(ctx, [18, -2, 18, 2, 10, -4, 10, 4, 28, 0, 33, 0]);
  inkReset(ctx);
  ctx.restore();
}

export const DRAW = {
  // ── FAST ATTACK CRAFT ──
  boat(ctx, e, pal, ink) {
    ctx.save();
    ctx.scale(e.dir, 1);
    hull(ctx, pal, [-38, 0, -36, 14, 22, 16, 41, -4, 32, -1], ink); // raked hull
    hull(ctx, pal, [-34, -1, -31, -5, -21, -5, -24, -1], ink); // SSM canisters
    hull(ctx, pal, [-16, -1, -12, -8, 4, -8, 8, -1], ink); // bridge
    hull(ctx, pal, [-11, -8, -9, -12, 0, -12, 1, -8], ink);
    rib(ctx, pal);
    lines(ctx, [-26, 0, -25, 14, -14, 0, -14, 15, -2, 0, -2, 15.5, 10, 0, 10, 15.5, 22, -1, 22, 16]); // plating
    lines(ctx, [-37, 6, 36, 4, -10, -6, 4, -6, -12, -3.5, 5, -3.5]); // sheer + windows
    lines(ctx, [-31, -3, -23, -3, -29, -5, -26, -1.5]); // canister ribs
    lines(ctx, [-4, -12, -4, -17, -7, -15, -1, -15]); // mast
    circle(ctx, -4, -17.8, 1.8, false, true);
    // mast radar bar sweeps
    const sw = Math.cos(e.t * 5) * 4;
    line(ctx, -4 - sw, -20, -4 + sw, -20);
    inkReset(ctx);
    waterline(ctx, e, pal, 40, 15);
    ctx.restore();
    sunGun(ctx, e, pal, ink);
  },

  // ── DESTROYER / BATTLESHIP (Inspired by US Navy IOWA Class) ──
  destroyer(ctx, e, pal, ink) {
    ctx.save();
    ctx.scale(e.dir, 1);
    // Armored Iowa-class hull with flared clipper bow and sheer line
    hull(ctx, pal, [-68, -2, -64, 19, 52, 22, 72, -10, 58, -3], ink);
    // Citadel armor belt stripe
    hull(ctx, pal, [-44, 2, -44, 10, 36, 10, 36, 2], ink);
    // Superstructure & Armored conning tower
    hull(ctx, pal, [-24, -2, -20, -14, 6, -14, 10, -2], ink);
    // Towering armored bridge citadel
    hull(ctx, pal, [-16, -14, -14, -20, -2, -20, 0, -14], ink);
    // Forward and aft funnels with cap grilles
    hull(ctx, pal, [-36, -2, -35, -10, -28, -10, -27, -2], ink); // aft stack
    hull(ctx, pal, [12, -2, 13, -12, 21, -12, 22, -2], ink); // fwd stack

    rib(ctx, pal);
    lines(ctx, [-62, 3, 58, 2, -60, 9, 50, 9, -50, 0, -48, 20, -32, 0, -30, 21, -10, 0, -8, 21, 14, 0, 16, 22, 32, 0, 34, 22]);
    lines(ctx, [-19, -8, 8, -8, -18, -11, 7, -11, -15, -16, -3, -16]); // bridge vision slits
    lines(ctx, [13, -9, 21, -9, -35, -7, -28, -7]); // funnel grilles
    // Mk 38 Gun Director and Radar Mast
    lines(ctx, [-8, -20, -8, -25, -12, -23, -4, -23]);
    const sw = Math.cos(e.t * 3.8) * 5;
    line(ctx, -8 - sw, -25.5, -8 + sw, -25.5); // Air-search radar antenna
    // Secondary twin 5-inch turrets
    hull(ctx, pal, [-4, -2, -4, -7, 4, -7, 4, -2], ink);
    lines(ctx, [4, -4.5, 9, -4.5]);
    // Aft helipad / floatplane catapult
    ctx.beginPath();
    ctx.ellipse(-56, -2, 9, 1.4, 0, 0, TAU);
    ctx.stroke();
    inkReset(ctx);
    waterline(ctx, e, pal, 68, 20);
    ctx.restore();
    sunGun(ctx, e, pal, ink, 0);
    sunGun(ctx, e, pal, ink, 1);
  },

  // ── AIRCRAFT CARRIER (Inspired by PLAN Project 891) ──
  carrier(ctx, e, pal, ink) {
    const d = e.dir;
    ctx.save();
    ctx.scale(d, 1);
    // Heavy hull with raked bow and ski-jump ramp angle (~14°)
    hull(ctx, pal, [-136, -8, -132, 8, -114, 25, -76, 32, 70, 32, 106, 24, 128, 8, 144, -18, 142, -9], ink);
    // Angled flight deck slab with ski-jump bow elevation
    hull(ctx, pal, [-134, -8, 124, -8, 144, -18, 140, -11, -134, -13], ink);
    // Sponsons for CIWS and FL-3000N missile pods
    hull(ctx, pal, [118, -8, 132, -8, 142, -13, 124, -13], ink);
    hull(ctx, pal, [-96, -8, -60, -8, -56, -4, -92, -4], ink);
    hull(ctx, pal, [-134, -8, -140, -4, -134, 0], ink);
    // Stealth island superstructure with 4 faceted AESA phased array faces
    hull(ctx, pal, [28, -13, 30, -29, 62, -29, 66, -13], ink);
    hull(ctx, pal, [34, -29, 36, -35, 58, -35, 60, -29], ink);

    rib(ctx, pal);
    // Catapult tracks and ski-jump launch markings
    dash(ctx, 8, 6);
    line(ctx, -126, -10.5, 120, -10.5);
    line(ctx, -120, -9, 100, -12.5); // angled landing runway
    line(ctx, 60, -11, 140, -16.5); // ski-jump launch track
    ctx.setLineDash([]);
    // Arrestor wires on angled deck
    for (let x = -118; x <= -92; x += 8) line(ctx, x, -13, x, -9);
    // Aircraft elevator
    rrect(ctx, -66, -12.6, -40, -8.4, 1);
    ctx.stroke();
    // Hull framing lines
    for (let x = -112; x <= 100; x += 26) line(ctx, x, -8, x + 3, 27 - Math.abs(x) * 0.03);
    // Island AESA radar panels (Type 346 active phased array)
    diamond(ctx, 38, -21, 4, 4);
    diamond(ctx, 52, -21, 4, 4);
    ctx.stroke();
    // Integrated mast and comms radome
    lines(ctx, [48, -35, 48, -41, 44, -38, 52, -38]);
    circle(ctx, 48, -42, 1.8, true, true);
    inkReset(ctx);
    // Parked Flanker/J-15 deck fighters
    deckJet(ctx, pal, ink, -100, -13);
    deckJet(ctx, pal, ink, -76, -13);
    deckJet(ctx, pal, ink, 82, -13);
    waterline(ctx, e, pal, 134, 32);
    ctx.restore();
    for (let i = 0; i < 3; i++) sunGun(ctx, e, pal, ink, i);
    if (e.hp < e.maxHp) {
      ctx.fillStyle = pal.fill;
      ctx.fillRect(-35, -52, 70, 5);
      ctx.strokeStyle = pal.mid;
      lw(ctx, W_RIB);
      ctx.strokeRect(-35, -52, 70, 5);
      ctx.fillStyle = pal.hot;
      ctx.fillRect(-34, -51, 68 * Math.max(0, e.hp / e.maxHp), 3);
    }
  },

  // ── ENEMY INTERCEPTOR: same Flanker airframe as the player, crimson accents ──
  jet(ctx, e, pal, ink) {
    drawFighter(ctx, pal, {
      x: 0, y: 0, a: e.a, S: ENEMY_SCALE_JET, t: e.t,
      ink, burn: e.dying ? 0 : 0.55, steer: e.steer || 0, rec: e.burstN > 0 ? 0.8 : 0, gun: 'mg', accent: true, enemy: true,
    });
  },

  // ── ATTACK HELICOPTER: KAMOV Ka-52 ALLIGATOR (Coaxial Contra-Rotating Dual Rotors) ──
  chopper(ctx, e, pal, ink) {
    ctx.scale(e.dying ? 1 : e.face || 1, 1);
    ctx.lineJoin = 'round';

    // 1. Fixed wheeled landing gear (nose gear + main gear with oleo struts)
    ctx.strokeStyle = ink;
    lw(ctx, W_RIB * 1.4);
    lines(ctx, [
      14, 6.5, 14, 10.5,    // nose gear strut
      -5, 6.5, -5, 10.5,    // main gear strut
      -5, 8.5, -8, 10.5,    // torque link
      -26, -2.5, -26, 2.0,  // tail skid
    ]);
    circle(ctx, 14, 11, 1.6, true, true);
    circle(ctx, -5, 11, 1.8, true, true);
    circle(ctx, -26, 2.8, 1.0, true, true);

    // 2. Tail boom, swept vertical fin, and twin auxiliary endplate fins (NO tail rotor!)
    hull(ctx, pal, [-12, -3.5, -32, -3.2, -32, -0.6, -12, 1.4], ink);
    // Swept vertical stabilizer with endplates
    hull(ctx, pal, [-25, -3.2, -31, -11.5, -35, -11.5, -30, -3.0], ink);
    hull(ctx, pal, [-26, -0.8, -32, 2.2, -35, 2.2, -31, -0.9], ink);
    // Twin horizontal tailplane endplate fins
    hull(ctx, pal, [-30, -6.5, -33, -9.5, -36, -9.5, -33, -6.5], ink);

    // 3. Stub wings + weapon stations (Vikhr 6-tube ATGM + B-8V20 rocket pods)
    hull(ctx, pal, [5, 3.2, -5, 3.2, -6, 6.8, 4, 6.8], ink);
    // Inboard: B-8V20 80mm rocket pod
    hull(ctx, pal, [9, 4.4, -4, 4.4, -4, 7.6, 9, 7.6, 11, 6.0], ink);
    // Outboard: 9K121 Vikhr 6-tube anti-tank missile container rack
    hull(ctx, pal, [7, 7.6, -2, 7.6, -2, 10.0, 7, 10.0, 8.5, 8.8], ink);
    // Wingtip L-370 Vitebsk electronic warfare sensor fairing
    hull(ctx, pal, [11, 8.8, 4, 8.8, 3, 10.8, 10, 10.8], ink);

    // 4. Streamlined armored fuselage & twin Klimov VK-2500 turboshaft nacelles
    hull(ctx, pal, [
      26, 3.5,   23, -1.0,  17, -4.8,  5, -6.5,  -7, -6.0,  -14, -3.5,
      -14, 3.5,   0, 7.0,    16, 7.0,   24, 5.5,  26, 3.5
    ], ink);
    // Engine cowling and EVU infrared exhaust suppressors
    hull(ctx, pal, [3, -6.5, -1, -9.2, -11, -8.6, -14, -4.5, 0, -5.5], ink);

    // 5. Side-by-side armored cockpit cabin (Pilot on left, Weapon Operator on right)
    hull(ctx, pal, [18, -1.0, 15, -5.2, 5, -5.4, 2, -1.8], ink);
    // Cockpit windscreen arches and armor frame
    rib(ctx, pal);
    lines(ctx, [
      12, -4.8, 12, 6.4,
      4, -6.0, 4, 6.4,
      -5, -5.6, -5, 4.5,
      -10, -4.2, -10, 2.2,
      9, -5.3, 7, -1.8, // center windshield pillar
    ]);

    // Side-by-side crew helmet silhouettes (Ka-52 signature)
    ctx.beginPath();
    ctx.arc(11.5, -3.5, 1.05, 0, TAU); // Pilot
    ctx.arc(6.5, -3.8, 1.05, 0, TAU);  // Tactical Operator
    ctx.stroke();

    // Rocket pod launch tubes & Vikhr missile canisters
    lines(ctx, [
      7, 4.4, 7, 7.6,  3, 4.4, 3, 7.6,  -1, 4.4, -1, 7.6,
      5, 7.6, 5, 10.0, 1, 7.6, 1, 10.0,
      -4, -8.6, -11, -8.6, -3, -7.8, -12, -7.8, // EVU exhaust suppressor grilles
    ]);
    inkReset(ctx);

    // 6. Under-nose GOES-451 spherical electro-optical FLIR targeting turret
    ctx.save();
    ctx.translate(22, 5.8);
    ctx.rotate(e.dying ? 0.3 : chopperAim(e));
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.75);
    circle(ctx, 0, 0, 2.8, true, true);
    // Optical FLIR camera sensor
    ctx.fillStyle = pal.hot;
    circle(ctx, 1.8, 0, 1.1, true, false);
    ctx.restore();

    // 7. Starboard cheek-mounted 30mm Shipunov 2A42 autocannon with recoil action
    ctx.save();
    ctx.translate(21, 6);
    ctx.rotate(e.dying ? 0.3 : chopperAim(e));
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.8);
    const recKick = e.burstN > 0 ? 1.8 : 0;
    ctx.fillRect(-recKick, -1.1, 10, 2.2);
    ctx.strokeRect(-recKick, -1.1, 10, 2.2);
    // Muzzle brake
    ctx.fillRect(10 - recKick, -1.6, 2.2, 3.2);
    ctx.strokeRect(10 - recKick, -1.6, 2.2, 3.2);
    // Ammo feed chute
    rib(ctx, pal);
    line(ctx, -2, 0, -5, -3);
    inkReset(ctx);
    ctx.restore();

    // 8. COAXIAL CONTRA-ROTATING DUAL 3-BLADE MAIN ROTORS (Kamov Ka-52 signature)
    // Central rotor mast column
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.85);
    poly(ctx, [-3.5, -6.5, -3.5, -18, -0.5, -18, -0.5, -6.5]);
    ctx.fill(); ctx.stroke();

    // Lower rotor hub & swashplate (spins counter-clockwise)
    hull(ctx, pal, [-5, -11.0, -5, -12.4, 1, -12.4, 1, -11.0], ink);
    const spd = 28;
    const rl_lower1 = 30 * Math.cos(-e.t * spd);
    const rl_lower2 = 30 * Math.cos(-e.t * spd + 2.09);
    lw(ctx, W_OUT * 0.85);
    ctx.strokeStyle = ink;
    line(ctx, -2 - rl_lower1, -11.7, -2 + rl_lower1, -11.7);
    lw(ctx, W_RIB);
    line(ctx, -2 - rl_lower2, -11.7, -2 + rl_lower2, -11.7);
    fine(ctx, pal);
    ctx.beginPath();
    ctx.ellipse(-2, -11.7, 30, 2.0, 0, 0, TAU);
    ctx.stroke();

    // Upper rotor hub & swashplate (spins clockwise)
    hull(ctx, pal, [-4.5, -16.8, -4.5, -18.2, 0.5, -18.2, 0.5, -16.8], ink);
    const rl_upper1 = 30 * Math.cos(e.t * spd);
    const rl_upper2 = 30 * Math.cos(e.t * spd + 2.09);
    lw(ctx, W_OUT * 0.85);
    ctx.strokeStyle = ink;
    line(ctx, -2 - rl_upper1, -17.5, -2 + rl_upper1, -17.5);
    lw(ctx, W_RIB);
    line(ctx, -2 - rl_upper2, -17.5, -2 + rl_upper2, -17.5);
    fine(ctx, pal);
    ctx.beginPath();
    ctx.ellipse(-2, -17.5, 30, 2.0, 0, 0, TAU);
    ctx.stroke();

    // Mast pitch links & counter-rotating drive shafts
    rib(ctx, pal);
    lines(ctx, [
      -4, -12.4, -4, -16.8,
      0, -12.4, 0, -16.8,
    ]);
    inkReset(ctx);

    // Mast cap warning antenna
    ctx.fillStyle = pal.danger;
    poly(ctx, [-3, -18.2, -1, -18.2, -2, -20]);
    ctx.fill();

    if (blink(e)) warnMark(ctx, pal, 36, 6);
  },

  // ── SPAAG: tracked self-propelled AA gun with twin autocannon + search radar ──
  aa(ctx, e, pal, ink) {
    tracks(ctx, pal, ink, -19, 19, 9, 17, 5);
    hull(ctx, pal, [-20, 9, -18, 5, 17, 5, 20, 9], ink);
    hull(ctx, pal, [-15, 5, -12, 0, 10, 0, 14, 5], ink);
    hull(ctx, pal, [-9, 0, -7, -7, 8, -7, 10, 0], ink);
    rib(ctx, pal);
    lines(ctx, [-12, 5, -12, 9, 6, 5, 6, 9, -8, 0, -8, 5, -6, -3, 7, -3, 12, 1, 12, 5]);
    lines(ctx, [-6, -7, -6, -11]);
    inkReset(ctx);
    // rotating search radar dish (squeeze)
    ctx.save();
    ctx.translate(-6, -12.5);
    ctx.scale(Math.abs(Math.cos(e.t * 2.2)) * 0.85 + 0.15, 1);
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.7);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.2, 3.6, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    sunGun(ctx, e, pal, ink, 0);
  },

  // ── SELF-PROPELLED HEAVY HOWITZER (Drum Artillery / IDF Roem / 2S5 Giatsint) ──
  art(ctx, e, pal, ink) {
    tracks(ctx, pal, ink, -28, 28, 9, 17, 7);
    // Heavy armored hull
    hull(ctx, pal, [-30, 9, -27, 3, 26, 3, 30, 9], ink);
    // Lowered hydraulic anchor spade digging into ground (2S5 Giatsint spade)
    hull(ctx, pal, [-36, 8, -30, 8, -28, 17, -35, 19], ink);
    line(ctx, -29, 9, -34, 18); // hydraulic spade ram strut

    // Robotic armored box turret with autoloader housing (IDF Roem Sigma 155)
    hull(ctx, pal, [-18, 3, -15, -6, 12, -6.5, 16, 3], ink);
    // Rear rotary ammunition drum cylinder (Drum Artillery)
    hull(ctx, pal, [-24, 1, -24, -4, -18, -4, -18, 1], ink);
    ctx.beginPath();
    ctx.ellipse(-21, -1.5, 3.2, 2.2, 0, 0, TAU); // autoloader drum indexing face
    ctx.stroke();

    rib(ctx, pal);
    lines(ctx, [-22, 3, -22, 9, 22, 3, 22, 9, -10, -6, -10, 3, 6, -6.2, 6, 3, -14, -1, 14, -1]);
    lines(ctx, [-6, -6.5, -6, -10, -2, -10, -2, -6.5]); // commander panoramic sight
    inkReset(ctx);

    // elevating barrel: hydraulic recoil cylinders, fume extractor, perforated muzzle brake
    const right = Math.cos(e.aim) >= 0;
    e.elevV = (e.elevV === undefined ? 1 : e.elevV) + ((e.elev === undefined ? 1 : e.elev) - (e.elevV === undefined ? 1 : e.elevV)) * 0.12;
    const el = right ? -e.elevV : -Math.PI + e.elevV;
    const m = ENEMY_MOUNTS.art[0];
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(el);
    const L = m.len - e.recoil * 6;
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.8);
    // Heavy gun cradle & mantlet
    ctx.fillRect(-5, -2.8, 14, 5.6);
    ctx.strokeRect(-5, -2.8, 14, 5.6);

    // Barrel velocity radar horn on mantlet (IDF Roem signature)
    ctx.fillRect(1, -4.6, 5, 2.2);
    ctx.strokeRect(1, -4.6, 5, 2.2);

    // Massive 52-caliber rifled barrel
    ctx.fillRect(9, -1.5, L - 9, 3.0);
    ctx.strokeRect(9, -1.5, L - 9, 3.0);

    // Dual hydraulic recuperator cylinders (2S5 Giatsint)
    ctx.fillRect(8, -2.8, L * 0.35, 1.3);
    ctx.strokeRect(8, -2.8, L * 0.35, 1.3);
    ctx.fillRect(8, 1.5, L * 0.35, 1.3);
    ctx.strokeRect(8, 1.5, L * 0.35, 1.3);

    // Fume extractor bulge
    ctx.fillRect(L * 0.52, -2.2, L * 0.16, 4.4);
    ctx.strokeRect(L * 0.52, -2.2, L * 0.16, 4.4);

    // Multi-chamber perforated muzzle brake (2S5 Giatsint / Roem)
    ctx.fillRect(L - 4.2, -2.8, 4.2, 5.6);
    ctx.strokeRect(L - 4.2, -2.8, 4.2, 5.6);

    rib(ctx, pal);
    lines(ctx, [16, -1.5, 16, 1.5, L - 7, -1.5, L - 7, 1.5, L - 2.8, -2.8, L - 2.8, 2.8, L - 1.4, -2.8, L - 1.4, 2.8]);
    inkReset(ctx);
    fine(ctx, pal);
    dash(ctx, 2, 3);
    line(ctx, L + 3, 0, L + 28, 0); // ballistic bore ray
    ctx.setLineDash([]);
    inkReset(ctx);
    if (blink(e)) warnMark(ctx, pal, L + 8, 0);
    ctx.restore();
    if (e.warn) {
      ctx.strokeStyle = pal.hot;
      lw(ctx, W_FINE);
      ctx.globalAlpha = 0.55;
      dash(ctx, 1.5, 2.5);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 18, right ? el : Math.PI, right ? 0 : Math.PI + e.elevV);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  },

  // ── ARMOURED MG BUNKER ──
  mg(ctx, e, pal, ink) {
    hull(ctx, pal, [-22, 15, -20, 2, -12, -4, 12, -4, 20, 2, 22, 15], ink);
    rib(ctx, pal);
    lines(ctx, [-20, 6, 21, 6, -21, 10, 21, 10, -10, -4, -12, 15, 0, -4, 0, 15, 10, -4, 12, 15]); // concrete lifts
    lines(ctx, [-12, -4, -12, -12, -12, -9, -9, -9]); // whip antenna
    inkReset(ctx);
    // embrasure with the gun poking out
    ctx.fillStyle = pal.dark;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.7);
    poly(ctx, [3, -1.5, 16, -1.5, 16, 3.5, 3, 3.5]);
    ctx.fill();
    ctx.stroke();
    const m = ENEMY_MOUNTS.mg[0];
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(e.aim);
    const L = m.len - e.recoil * 2.5;
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.75);
    ctx.fillRect(0, -1.2, L, 2.4);
    ctx.strokeRect(0, -1.2, L, 2.4);
    ctx.fillRect(L - 2.2, -1.8, 2.2, 3.6);
    if (blink(e)) warnMark(ctx, pal, L + 6, 0);
    ctx.restore();
    // sandbag row
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = pal.rib;
    lw(ctx, W_RIB);
    for (let x = -21; x < 20; x += 6.5) {
      rrect(ctx, x, 11.5, x + 6, 15, 1.4);
      ctx.fill();
      ctx.stroke();
    }
  },

  // ── FUEL TANK ──
  fuel(ctx, e, pal, ink) {
    hull(ctx, pal, [-13, -12, 13, -12, 13, 17, -13, 17], ink);
    ctx.beginPath();
    ctx.ellipse(0, -12, 13, 4, 0, 0, TAU); // domed roof
    ctx.fill();
    ctx.stroke();
    rib(ctx, pal);
    lines(ctx, [-13, -4, 13, -4, -13, 4, 13, 4, -13, 12, 13, 12, -6, -8, -6, 17, 6, -8, 6, 17]);
    lines(ctx, [13, -9, 9, -5, 13, -1, 9, 3, 13, 7, 9, 11]); // spiral stair
    lines(ctx, [0, -16, 0, -12, -2.5, -16, 2.5, -16]); // roof vent
    for (let x = -12; x < 8; x += 4.5) line(ctx, x, 12, x + 3, 17); // hazard stripes
    circle(ctx, -6, 0, 1.8, false, true); // level gauge
    ctx.beginPath();
    ctx.ellipse(0, 17, 13, 3.4, 0, 0, Math.PI);
    ctx.stroke();
    inkReset(ctx);
  },

  // ── RADAR TOWER ──
  radar(ctx, e, pal, ink) {
    hull(ctx, pal, [-10, 36, -2, -14, 2, -14, 10, 36], ink);
    rib(ctx, pal);
    for (let y = -10; y < 34; y += 11) {
      const wl = -2 - ((y + 14) / 50) * 8;
      lines(ctx, [wl, y, -wl, y + 11, -wl, y, wl, y + 11, wl, y + 11, -wl, y + 11]);
    }
    lines(ctx, [-6, -16, 6, -16, -6, -14, 6, -14]);
    inkReset(ctx);
    ctx.save();
    ctx.translate(0, -25);
    ctx.scale(Math.abs(Math.cos(e.t * 1.5)) * 0.9 + 0.1, 1);
    ctx.rotate(-0.4);
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0, 3.8, 11, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    rib(ctx, pal);
    line(ctx, 0, -11, 0, 11);
    line(ctx, -3, 0, 3, 0);
    inkReset(ctx);
    ctx.restore();
    fine(ctx, pal);
    dash(ctx, 2, 3);
    const sa = e.t * 3;
    ctx.beginPath();
    ctx.arc(0, -25, 20, sa, sa + 0.6);
    ctx.stroke();
    ctx.setLineDash([]);
    inkReset(ctx);
    if (e.ping > 0 || ((e.t * 3) | 0) % 2 === 0) warnMark(ctx, pal, 0, -38);
  },

  // ── COMMAND TENT ──
  tent(ctx, e, pal, ink) {
    hull(ctx, pal, [-18, 14, 0, -8, 18, 14], ink);
    rib(ctx, pal);
    lines(ctx, [-9, 14, 0, -8, 9, 14, 0, -8, -4, 14, 0, 2, 4, 14, 0, 2, -14, 4, 14, 4, -22, 14, -18, 14, 18, 14, 22, 14]);
    lines(ctx, [0, -8, 0, -15]);
    inkReset(ctx);
    ctx.fillStyle = pal.danger;
    ctx.globalAlpha = 0.85;
    poly(ctx, [0, -15, 7, -13, 0, -11]);
    ctx.fill();
    ctx.globalAlpha = 1;
  },

  // ── RUBBLE ──
  rubble(ctx, e, pal) {
    hullPath(ctx, pal, (c) => {
      c.moveTo(-e.hw, e.hh); c.lineTo(-e.hw * 0.7, e.hh * 0.3); c.lineTo(-2, e.hh * 0.6);
      c.lineTo(e.hw * 0.4, e.hh * 0.1); c.lineTo(e.hw, e.hh); c.closePath();
    }, pal.mid);
    rib(ctx, pal);
    lines(ctx, [-e.hw * 0.3, e.hh, -e.hw * 0.2, e.hh * 0.5, e.hw * 0.2, e.hh, e.hw * 0.25, e.hh * 0.4]);
    inkReset(ctx);
    if (((e.t * 8) | 0) % 2 === 0) {
      ctx.fillStyle = pal.hot;
      ctx.fillRect(-3, e.hh - 2.5, 2, 1.5);
      ctx.fillRect(e.hw * 0.3, e.hh - 3, 1.6, 1.4);
    }
  },
};
