import { TAU, clamp, lerp } from './util.js';
import {
  poly, line, lines, hull, rib, fine, inkReset, lw, dash, circle, diamond, W_OUT, W_RIB, W_FINE,
} from './cadRenderer.js';

// ─────────────────────────────────────────────────────────────
//  AIRFRAME.JS: PRECISION MILITARY CAD TECHNICAL BLUEPRINTS
//  Faithfully authored from official Soukhoï Su-30 Flanker three-view
//  schematics, underside structural blueprints, laser-cut vector CAD,
//  and Russian aerospace technical engineering drawings.
//
//  Aircraft models:
//    • 'std'   : Soukhoï Su-30SM / Su-30MKI Flanker-H (Tandem stepped cockpit, canards, AL-31FP TVC)
//    • 'light' : Soukhoï Su-47 Berkut (Forward-swept composite wing, forward canards, extreme agility)
//    • 'heavy' : Soukhoï Su-34 Fullback (Platypus duckbill nose, side-by-side armored cockpit, APU stinger)
//    • Enemy   : Su-35S / Aggressor Flanker-E (Splinter camouflage CAD, red threat sensors, R-77 grid fins)
// ─────────────────────────────────────────────────────────────

// Gun mount coordinates (muzzle x,y and breech x in local units)
export const MOUNTS = {
  mg: [{ x: 30, y: 1.4, b: 16 }, { x: 7, y: 7.2, b: -2 }],
  cannon: [{ x: 33, y: 2.2, b: 14 }],
  scatter: [{ x: 1, y: 9, b: -5 }, { x: -3, y: 13, b: -9 }, { x: -7, y: 17, b: -13 }],
};

export function mountWorld(x, y, a, S, m) {
  const flip = Math.cos(a) < 0 ? -1 : 1;
  const lx = m.x * S;
  const ly = m.y * S * flip;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x + lx * c - ly * s, y + lx * s + ly * c];
}

// ─────────────────────────────────────────────────────────────
//  1. SOUKHOÏ Su-30SM / MKI FLANKER-H (Multirole Fighter - 'std')
//  Faithful to 3-view blueprints, laser-cut CAD, and underside schematics
// ─────────────────────────────────────────────────────────────

// Fuselage outline from pitot boom to engine nacelles
const SU30_FUSE = [
  32, 0.4,   26, -1.4,  20, -2.4,  15.5, -3.2,  12.5, -3.8,   4, -4.2,
  -3, -4.0,  -13, -3.6, -19, -3.0, -22.5, -3.0, -22.5, 3.2,  -19, 3.2,
  -10, 4.8,  -2, 5.0,   6, 4.8,    13, 3.6,    19, 2.4,     26, 1.4,
  32, 0.4
];

// Stepped tandem two-seat bubble canopy (Pilot in front, elevated WSO in rear)
const SU30_CANOPY = [
  15.5, -3.2,  12.5, -6.0,  6.8, -6.2,  4.8, -7.0,  0.2, -6.8,  -2.8, -4.0
];

// All-moving canard foreplane on LERX (Su-30MKI / Su-30SM)
const SU30_CANARD = [13, 0.4, 15.8, 3.2, 10.8, 3.8, 8.2, 1.0];

// Long rear stinger tail boom projecting aft between engine exhausts
const SU30_STINGER = [-18, -1.0, -30, -0.4, -30, 0.4, -18, 1.0];

// Underslung rectangular supersonic air intake with 3-stage compression ramps
const SU30_INTAKE = [13, 3.6, 12, 6.8, -1, 7.2, -4, 5.0];

// Twin outward-canted vertical tail fins (near and far)
const SU30_FIN_NEAR = [-7, -3.8, -15, -15.2, -21, -15.2, -19, -3.0];
const SU30_FIN_FAR = SU30_FIN_NEAR.map((v, i) => (i % 2 ? v + 1.5 : v + 3.4));
const SU30_ECM_POD = [-20.8, -15.8, -26.5, -15.3, -26.5, -14.6, -20.8, -14.5];

// Horizontal all-moving stabilator
const SU30_STAB = [-13, 3.8, -22, 9.8, -26, 9.8, -22.5, 3.2];
const SU30_STAB_PIVOT = [-13.5, 3.8];

// 42° swept main wing planform
const SU30_WING = [
  14, 3.0,   6, 5.0,   -7, 18.2,   -12, 18.2,   -14.5, 5.4,   -4, 4.2
];

// Wingtip missile launch rail + Vympel R-73 (AA-11 Archer) heat-seeking dogfight missile
const SU30_AAM = [
  -1, 18.5,  -16, 18.5,  -17.5, 19.3,  -16, 20.1,  -1, 20.1,  0.5, 19.3
];

function drawSu30Flanker(ctx, pal, o, flip, ink, accent, S) {
  const { t, burn, steer } = o;

  // ── Layer 1: Base Silhouettes (Far fin, stinger, wings) ──
  hull(ctx, pal, SU30_FIN_FAR, ink, S);
  hull(ctx, pal, SU30_STINGER, ink, S);
  hull(ctx, pal, SU30_WING, ink, S);

  // Wingtip missile launch rail + R-73 Archer missile
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.75, S);
  poly(ctx, SU30_AAM);
  ctx.fill();
  ctx.stroke();

  // R-73 infrared seeker dome & stabilization fins
  ctx.fillStyle = accent ? pal.danger : pal.hot;
  circle(ctx, 0.4, 19.3, 0.75, true, true);
  rib(ctx, pal, S);
  lines(ctx, [
    -14.5, 18.5, -15.4, 17.2,   -14.5, 20.1, -15.4, 21.4, // forward steering canards
    -3, 18.5, -3.8, 17.2,       -3, 20.1, -3.8, 21.4,     // rear cruciform fins
    -10.5, 18.5, -11.2, 17.6,   -10.5, 20.1, -11.2, 21.0, // mid-body strakes
  ]);
  inkReset(ctx);

  // Underwing weapon pylon stations (Vympel R-77 with iconic folding grid fins)
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.7, S);
  // Station 1: inboard pylon + R-77
  poly(ctx, [3, 10.8, -9, 10.8, -10.5, 12.2, 2, 12.2]);
  ctx.fill(); ctx.stroke();
  // Station 2: outboard pylon
  poly(ctx, [-1.5, 14.6, -11, 14.6, -12.2, 15.8, -2.5, 15.8]);
  ctx.fill(); ctx.stroke();

  // R-77 iconic lattice / grid tail fins
  rib(ctx, pal, S);
  lines(ctx, [
    -9, 10.8, -10.5, 9.6,   -9, 12.2, -10.5, 13.4,
    -10.5, 9.6, -11.8, 9.6, -10.5, 13.4, -11.8, 13.4,
    -11.8, 9.6, -10.5, 11.5, -11.8, 13.4, -10.5, 11.5,
  ]);
  inkReset(ctx);

  // Trailing-edge flaperons (articulates dynamically with steering roll/pitch)
  const def = clamp(Math.abs(steer) * 0.75, 0, 1);
  const fc = lerp(1.8, 0.5, def);
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.8, S);
  poly(ctx, [-7, 18.2, -12, 18.2, -12 - fc, 18.7, -7 - fc, 18.7]);
  ctx.fill(); ctx.stroke();

  // All-moving horizontal stabilator (rotates with steering pitch)
  ctx.save();
  ctx.translate(SU30_STAB_PIVOT[0], SU30_STAB_PIVOT[1]);
  ctx.rotate(steer * 0.38 * flip);
  ctx.translate(-SU30_STAB_PIVOT[0], -SU30_STAB_PIVOT[1]);
  hull(ctx, pal, SU30_STAB, ink, S);
  rib(ctx, pal, S);
  line(ctx, -14.5, 4.2, -24, 9.4);
  inkReset(ctx);
  ctx.restore();

  // Underslung engine air intake ramps
  hull(ctx, pal, SU30_INTAKE, ink, S);
  hull(ctx, pal, SU30_FUSE, ink, S);

  // Su-30 All-Moving Canard Foreplane on LERX (articulates dynamically with steering)
  ctx.save();
  ctx.translate(11, 1.2);
  ctx.rotate(-steer * 0.34 * flip);
  ctx.translate(-11, -1.2);
  hull(ctx, pal, SU30_CANARD, ink, S);
  rib(ctx, pal, S);
  line(ctx, 12, 0.8, 14.5, 2.8);
  circle(ctx, 11, 1.2, 0.5, true, true); // pivot hinge
  inkReset(ctx);
  ctx.restore();

  // Dorsal Airbrake (Speedbrake - opens during heavy deceleration or high-G turn, Image 4)
  const brakeLift = clamp((o.rec || 0) * 1.8 + (burn < 0.1 && Math.abs(steer) > 0.4 ? Math.abs(steer) * 3.8 : 0), 0, 4.8);
  if (brakeLift > 0.4) {
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = ink;
    lw(ctx, W_OUT * 0.8, S);
    poly(ctx, [-2.5, -4.0, -10.5, -4.0 - brakeLift, -12.0, -4.0 - brakeLift, -4.5, -4.0]);
    ctx.fill(); ctx.stroke();
    // Hydraulic actuator jack strut
    rib(ctx, pal, S);
    line(ctx, -6.5, -4.0, -8.5, -4.0 - brakeLift * 0.82);
    inkReset(ctx);
  } else {
    // Airbrake door closed seam
    rib(ctx, pal, S);
    line(ctx, -2.5, -4.0, -11.5, -3.7);
    inkReset(ctx);
  }

  // Twin Saturn AL-31FP thrust-vectoring engine nozzles (articulate with pitch)
  const tv = steer * 0.24 * flip;
  const na = 2.8 + 0.6 * burn;
  ctx.save();
  ctx.translate(-19, 0.3);
  ctx.rotate(tv);
  ctx.translate(19, -0.3);
  hull(ctx, pal, [-19, -3.0, -22.8, -na - 0.2, -22.8, na + 0.6, -19, 3.2], ink, S);
  // Individual nozzle petal segments around nozzle circumference
  rib(ctx, pal, S);
  for (let ny = -na + 0.4; ny <= na + 0.2; ny += 0.95) {
    line(ctx, -19, ny, -22.8, ny);
  }
  inkReset(ctx);
  ctx.restore();

  // Near vertical tail fin with clipped tip and dielectric ECM pod
  hull(ctx, pal, SU30_FIN_NEAR, ink, S);
  if (accent) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    poly(ctx, [-11, -10.2, -15, -15.2, -18, -15.2, -14, -10.2]);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  hull(ctx, pal, SU30_ECM_POD, ink, S);

  // Stepped tandem bubble canopy glass
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.85, S);
  poly(ctx, SU30_CANOPY);
  ctx.fill();
  ctx.stroke();

  // OLS-30 IRST spherical optical tracking dome on starboard nose
  ctx.fillStyle = pal.hot;
  circle(ctx, 16.8, -3.4, 1.1, true, true);
  ctx.fillStyle = pal.light;
  circle(ctx, 16.5, -3.7, 0.35, true, false); // lens glint

  // GSh-30-1 internal 30mm autocannon blast deflector shield on starboard wing root
  ctx.strokeStyle = ink;
  lw(ctx, W_RIB * 1.5, S);
  line(ctx, 11, -1.8, 6.5, -1.8);
  // Gun venting louvers
  lines(ctx, [9.5, -2.4, 9.5, -1.2, 8.2, -2.4, 8.2, -1.2]);

  // ── Layer 2: Technical Blueprint CAD Internal Panel Lines (From User Reference Blueprints) ──
  rib(ctx, pal, S);
  lines(ctx, [
    // Radome seam & needle pitot boom with pitch/yaw vanes
    25.5, -1.5, 25.5, 1.5,
    32, 0.4, 38.5, 0.4,
    35.5, -0.6, 35.5, 1.4, // pitot aerodynamic vanes

    // Retractable in-flight refueling probe door outline (port nose)
    23, -1.0, 19, -1.8,
    23, -0.4, 19, -1.2,

    // Fuselage frame bulkhead stations (Image 3 laser-cut CAD framework)
    20, -2.4, 20, 2.2,
    15, -3.2, 15, 3.4,
    9, -4.0, 9, 4.6,
    2, -4.2, 2, 4.8,
    -5, -3.9, -5, 4.5,
    -12, -3.6, -12, 4.0,

    // Longitudinal longeron stringers (laser-cut CAD structural spine)
    19, -1.0, -18, -1.0,
    18, 1.2, -18, 1.2,
    13, 2.8, -12, 2.8,
    7, -2.2, -10, -2.2,

    // Supersonic intake splitter ramps & boundary layer louvers
    10, 4.4, 6, 7.0,
    4, 4.8, 1, 7.1,
    -1, 7.0, -1, 5.4,
    -3, 6.8, -3, 5.2,

    // Wing structure: front spar, main spar, rear spar, chordwise ribs (Image 3)
    5, 5.0, -8, 18.2,       // leading edge spar
    -2, 4.8, -10.5, 18.2,   // main spar
    -9, 4.6, -12.5, 18.2,   // rear spar
    1, 8.0, -4, 8.0,        // rib station 1
    -3, 11.8, -8, 11.8,     // rib station 2
    -6, 15.2, -10.5, 15.2,  // rib station 3

    // Diagonal geodesic truss ribs across wing bays (authentic technical mesh)
    5, 5.0, -3, 11.8,
    1, 8.0, -6, 15.2,
    -4, 8.0, -2, 4.8,
    -8, 11.8, -9, 4.6,
    -10.5, 15.2, -12.5, 18.2,

    // Engine nacelle compressor stages & turbine stator discs
    -5, -0.8, -5, 2.4,
    -9, -0.8, -9, 2.4,
    -13, -1.4, -13, 2.0,
    -17, -1.4, -17, 2.0,

    // Twin engine tunnels & afterburner flameholder ring lines
    -3, -1.4, -19, -1.4,
    -3, 2.0, -19, 2.0,

    // Vertical fin spar, rudder hinge line, and trim tabs
    -11, -3.8, -19, -15.2,
    -15.5, -3.0, -18, -15.2,
    -19.5, -5.5, -19.5, -9.5, // rudder trim tab
    -13, -7.5, -17, -7.5,     // fin horizontal rib 1
    -14, -11.5, -18, -11.5,   // fin horizontal rib 2
  ]);

  // Structural lightening holes in bulkheads (authentic laser-cut CAD feature)
  circle(ctx, 10, -0.4, 0.75, false, true);
  circle(ctx, 4, -0.4, 0.85, false, true);
  circle(ctx, -2, -0.4, 0.85, false, true);
  circle(ctx, -8, -0.4, 0.75, false, true);

  // Stepped tandem cockpit interior: pilot ejection seat, WSO seat, HUD glass
  lines(ctx, [
    14.2, -3.6, 14.2, -5.2, // HUD combiner glass
    10.5, -5.8, 9.6, -3.2,  // pilot K-36D seat backrest
    3.8, -6.6, 3.0, -3.8,   // WSO K-36D elevated seat backrest
    11.5, -5.6, 10.8, -3.4, // windscreen arch
    6.8, -6.0, 6.2, -3.8,   // intermediate arch
    1.2, -6.5, 0.8, -4.0,   // aft rollover arch
  ]);

  // Pilot & WSO helmet silhouettes with oxygen masks & visor reflections
  ctx.beginPath();
  ctx.arc(9.8, -4.3, 1.0, 0, TAU); // Pilot
  ctx.arc(3.6, -4.9, 0.95, 0, TAU); // WSO
  ctx.stroke();

  // Canopy specular glare reflections
  lines(ctx, [13.5, -3.6, 11.8, -5.5, 5.5, -3.8, 4.0, -6.2]);
  inkReset(ctx);

  // Blinking wingtip formation nav light
  if (((t * 2.4 + o.x * 0.01) | 0) % 2 === 0) {
    ctx.fillStyle = pal.danger;
    circle(ctx, -26.2, -14.9, 0.75, true, false);
  }
}

// ─────────────────────────────────────────────────────────────
//  2. SOUKHOÏ Su-47 BERKUT (High-Agility Interceptor - 'light')
//  Forward-swept composite wing, forward canards, extreme agility
// ─────────────────────────────────────────────────────────────

const SU47_FUSE = [
  31, 0.2,   25, -1.4,  19, -2.2,  13.5, -2.8,  4, -3.4,  -4, -3.2,
  -13, -2.8, -19, -2.2, -19, 2.8,  -12, 3.8,    -3, 4.2,  5, 4.0,
  12, 3.0,   18, 2.0,   25, 1.0,   31, 0.2
];
const SU47_CANOPY = [14.5, -2.6, 11.5, -5.2, 4.5, -5.4, -0.5, -3.4];
const SU47_CANARD = [14.5, 0.4, 17, 3.2, 12, 3.6, 9.5, 1.0];
// Forward-swept main wing: sweeps FORWARD from root to wingtip (-20°)
const SU47_WING = [
  5, 3.8,   -3, 4.4,   -12, 4.8,   -8, 19.0,   2, 19.0,   8, 4.2
];
const SU47_AAM = [10, 19.2, -4, 19.2, -5.5, 20.0, -4, 20.8, 10, 20.8, 11.5, 20.0];

function drawSu47Berkut(ctx, pal, o, flip, ink, accent, S) {
  const { t, burn, steer } = o;

  // Far vertical fin (canted 14° outward)
  hull(ctx, pal, [-8, -3.0, -16, -14.2, -21, -14.2, -18.5, -2.6], ink, S);
  // Forward-swept wing
  hull(ctx, pal, SU47_WING, ink, S);

  // Wingtip missile launch rail + R-73 missile
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.75, S);
  poly(ctx, SU47_AAM);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = pal.hot;
  circle(ctx, 11.2, 20.0, 0.75, true, true);

  // Fuselage
  hull(ctx, pal, SU47_FUSE, ink, S);

  // Forward canards (articulate with extreme turn authority)
  ctx.save();
  ctx.translate(12, 1.4);
  ctx.rotate(-steer * 0.42 * flip);
  ctx.translate(-12, -1.4);
  hull(ctx, pal, SU47_CANARD, ink, S);
  circle(ctx, 12, 1.4, 0.5, true, true);
  ctx.restore();

  // Near vertical tail fin
  hull(ctx, pal, [-10, -3.2, -18, -14.6, -23, -14.6, -20, -2.8], ink, S);
  if (accent) {
    ctx.fillStyle = accent;
    poly(ctx, [-14, -9.0, -18, -14.6, -21, -14.6, -17, -9.0]);
    ctx.fill();
  }

  // Canopy & Pilot
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.85, S);
  poly(ctx, SU47_CANOPY);
  ctx.fill(); ctx.stroke();

  rib(ctx, pal, S);
  ctx.beginPath();
  ctx.arc(8.5, -3.8, 1.0, 0, TAU); // Pilot
  ctx.stroke();

  // Forward-swept wing internal spars & longerons
  lines(ctx, [
    25, -1.4, 25, 1.0,
    31, 0.2, 36, 0.2,
    1, 4.4, 0, 19.0,
    -4, 4.6, -4, 19.0,
    -8, 4.8, -7, 19.0,
    -10, -3.2, -19, -14.6, // rudder line
  ]);
  inkReset(ctx);
}

// ─────────────────────────────────────────────────────────────
//  3. SOUKHOÏ Su-34 FULLBACK (Armored Strike Jet - 'heavy')
//  "Platypus" duckbill armored nose, side-by-side cockpit, giant APU stinger
// ─────────────────────────────────────────────────────────────

const SU34_FUSE = [
  30, 0.2,   25, -1.2,  19, -2.6,  14, -4.4,   3, -5.4,  -6, -5.2,
  -14, -4.4, -20, -3.4, -20, 3.8,  -12, 5.0,   -2, 5.4,  7, 5.2,
  14, 4.2,   20, 3.0,   26, 1.4,   30, 0.2
];
const SU34_CANOPY = [15.5, -3.6, 11.5, -7.0, 3, -7.2, -2, -5.0];
const SU34_STINGER = [-19, -1.6, -33, -0.8, -33, 0.8, -19, 1.6];
const SU34_WING = [
  13, 3.4,   5, 5.6,   -9, 19.5,   -14.5, 19.5,   -16.5, 6.0,   -5, 4.8
];

function drawSu34Fullback(ctx, pal, o, flip, ink, accent, S) {
  const { t, burn, steer } = o;

  // Far fin
  hull(ctx, pal, [-8, -4.4, -16, -15.6, -22.5, -15.6, -20, -3.6], ink, S);
  // Heavy rear stinger boom containing APU and rearward radar
  hull(ctx, pal, SU34_STINGER, ink, S);
  // Heavy broad main wings
  hull(ctx, pal, SU34_WING, ink, S);

  // Wingtip heavy Khibiny electronic warfare jamming pod
  hull(ctx, pal, [-4, 18.6, -16.5, 18.6, -18, 19.8, -16.5, 21.0, -4, 21.0, -2.5, 19.8], ink, S);

  // Triple heavy weapon stations under wings (precision-guided bombs / heavy sabot pods)
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.75, S);
  for (const px of [1, -5, -11]) {
    poly(ctx, [px, 10.5 + Math.abs(px) * 0.4, px - 6.5, 10.5 + Math.abs(px) * 0.4, px - 7.5, 12.4 + Math.abs(px) * 0.4, px + 1, 12.4 + Math.abs(px) * 0.4]);
    ctx.fill(); ctx.stroke();
  }

  // Platypus fuselage & armored titanium bathtub
  hull(ctx, pal, SU34_FUSE, ink, S);

  // Near vertical tail fin
  hull(ctx, pal, [-10, -4.6, -18, -15.8, -24.5, -15.8, -22, -3.8], ink, S);
  if (accent) {
    ctx.fillStyle = accent;
    poly(ctx, [-14, -10.2, -18, -15.8, -22, -15.8, -18, -10.2]);
    ctx.fill();
  }

  // Side-by-side armored cockpit glass
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.9, S);
  poly(ctx, SU34_CANOPY);
  ctx.fill(); ctx.stroke();

  // Side-by-side crew silhouettes (Pilot on left, Navigator/WSO on right)
  rib(ctx, pal, S);
  ctx.beginPath();
  ctx.arc(8.5, -5.0, 1.05, 0, TAU); // Pilot
  ctx.arc(5.8, -5.4, 1.05, 0, TAU); // Navigator
  ctx.stroke();

  // Duckbill chine ridge lines & armor seams
  lines(ctx, [
    30, 0.2, 35, 0.2,
    23, -1.2, 16, -2.2,
    23, 1.2, 16, 2.2,
    -19, 0, -33, 0, // stinger spine line
    -10, -4.6, -20, -15.8, // rudder line
  ]);
  inkReset(ctx);
}

// ─────────────────────────────────────────────────────────────
//  4. SUKHOI Su-35S / AGGRESSOR FLANKER-E (Enemy Interceptor)
//  Menacing splinter camouflage CAD, crimson threat sensors, R-77 grid fins
// ─────────────────────────────────────────────────────────────

function drawAggressorFlanker(ctx, pal, o, flip, ink, accent, S) {
  const { t, burn, steer } = o;

  // Far fin
  hull(ctx, pal, SU30_FIN_FAR, ink, S);
  hull(ctx, pal, SU30_STINGER, ink, S);
  hull(ctx, pal, SU30_WING, ink, S);

  // Adversary splinter camouflage panels on wing
  ctx.fillStyle = pal.danger;
  ctx.globalAlpha = 0.45;
  poly(ctx, [4, 5.6, 0, 10.5, -4, 9.8, -1, 5.2]);
  ctx.fill();
  poly(ctx, [-6, 12.0, -10, 18.2, -12, 18.2, -8, 11.5]);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Wingtip APU-73 launch rail + R-73 missile
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.75, S);
  poly(ctx, SU30_AAM);
  ctx.fill(); ctx.stroke();

  // Glowing crimson radar lock seeker eye
  ctx.fillStyle = pal.danger;
  circle(ctx, 0.4, 19.3, 0.85, true, true);

  // Underwing R-77 active radar homing missile with lattice grid fins
  poly(ctx, [3, 10.8, -9, 10.8, -10.5, 12.2, 2, 12.2]);
  ctx.fill(); ctx.stroke();
  rib(ctx, pal, S);
  lines(ctx, [
    -9, 10.8, -10.5, 9.6,   -9, 12.2, -10.5, 13.4,
    -10.5, 9.6, -11.8, 9.6, -10.5, 13.4, -11.8, 13.4,
  ]);
  inkReset(ctx);

  // Stabilator
  ctx.save();
  ctx.translate(SU30_STAB_PIVOT[0], SU30_STAB_PIVOT[1]);
  ctx.rotate(steer * 0.38 * flip);
  ctx.translate(-SU30_STAB_PIVOT[0], -SU30_STAB_PIVOT[1]);
  hull(ctx, pal, SU30_STAB, ink, S);
  ctx.restore();

  // Intakes & Fuselage
  hull(ctx, pal, SU30_INTAKE, ink, S);
  hull(ctx, pal, SU30_FUSE, ink, S);

  // Aggressor splinter camouflage panels on fuselage spine
  ctx.fillStyle = pal.danger;
  ctx.globalAlpha = 0.5;
  poly(ctx, [10, -2.6, 6, -4.2, 2, -4.2, 5, -2.4]);
  ctx.fill();
  poly(ctx, [-4, -4.0, -9, -3.8, -7, -2.0, -2, -2.0]);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Near vertical tail fin
  hull(ctx, pal, SU30_FIN_NEAR, ink, S);
  // Red star / aggressor chevron on tail fin
  ctx.fillStyle = pal.danger;
  poly(ctx, [-12, -9.5, -15, -14.2, -18, -14.2, -15, -9.5]);
  ctx.fill();
  hull(ctx, pal, SU30_ECM_POD, ink, S);

  // Canopy
  ctx.fillStyle = pal.fill;
  ctx.strokeStyle = ink;
  lw(ctx, W_OUT * 0.85, S);
  poly(ctx, SU30_CANOPY);
  ctx.fill(); ctx.stroke();

  // Glowing red OLS-35 IRST threat eye
  ctx.fillStyle = pal.danger;
  circle(ctx, 16.8, -3.4, 1.2, true, true);

  // Thrust vectoring nozzles
  const tv = steer * 0.24 * flip;
  const na = 2.8 + 0.6 * burn;
  ctx.save();
  ctx.translate(-19, 0.3);
  ctx.rotate(tv);
  ctx.translate(19, -0.3);
  hull(ctx, pal, [-19, -3.0, -22.8, -na - 0.2, -22.8, na + 0.6, -19, 3.2], ink, S);
  rib(ctx, pal, S);
  for (let ny = -na + 0.4; ny <= na + 0.2; ny += 0.95) line(ctx, -19, ny, -22.8, ny);
  inkReset(ctx);
  ctx.restore();

  // Technical blueprint CAD lines
  rib(ctx, pal, S);
  lines(ctx, [
    25.5, -1.5, 25.5, 1.5,
    32, 0.4, 38.5, 0.4,
    35.5, -0.6, 35.5, 1.4,
    20, -2.4, 20, 2.2,
    15, -3.2, 15, 3.4,
    9, -4.0, 9, 4.6,
    -11, -3.8, -19, -15.2,
  ]);
  inkReset(ctx);
}

// ─────────────────────────────────────────────────────────────
//  ROUTER: DRAW FIGHTER (Matches loadout airframe & weapon mounts)
// ─────────────────────────────────────────────────────────────

export function drawFighter(ctx, pal, o) {
  const { S, t, burn, steer } = o;
  const flip = Math.cos(o.a) < 0 ? -1 : 1;
  const ink = o.ink;
  const accent = o.accent ? pal.danger : null;
  const hullType = o.hull || 'std';

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.a);
  ctx.scale(S, S * flip);
  ctx.lineJoin = 'round';

  // CAD drafting centerline guide
  fine(ctx, pal, S, 0.35);
  dash(ctx, 7, 4, S);
  line(ctx, -38, 0, 44, 0);
  inkReset(ctx);

  // ── Twin afterburner plumes: tapered core, Mach shock diamonds ──
  const x0 = -22.8;
  if (burn > 0.03) {
    const flick = 0.92 + 0.08 * Math.sin(t * 90 + o.x) + 0.05 * Math.sin(t * 37);
    const Lf = (9 + 32 * burn) * flick;
    const ap = 1.05 + 0.85 * burn;
    for (const yc of [-1.3, 1.7]) {
      ctx.fillStyle = o.enemy ? pal.danger : pal.hot;
      ctx.strokeStyle = o.enemy ? pal.danger : pal.hot;
      lw(ctx, 1, S);
      ctx.globalAlpha = 0.35 * burn;
      poly(ctx, [x0, yc - ap * 1.15, x0 - Lf, yc, x0, yc + ap * 1.15]);
      ctx.fill();
      ctx.globalAlpha = 0.95 * burn;
      ctx.stroke();
      ctx.fillStyle = pal.light;
      poly(ctx, [x0, yc - ap * 0.55, x0 - Lf * 0.6, yc, x0, yc + ap * 0.55]);
      ctx.fill();
      // Mach shock diamonds
      ctx.strokeStyle = pal.light;
      lw(ctx, W_RIB, S);
      for (let i = 0; i < 4; i++) {
        const cx = x0 - Lf * 0.2 - i * Lf * 0.22;
        if (cx < x0 - Lf * 0.92) break;
        ctx.fillStyle = o.enemy ? pal.danger : pal.hot;
        ctx.globalAlpha = 0.65 * burn;
        diamond(ctx, cx, yc, Lf * 0.075, ap * 0.75 * (1 - i * 0.2));
        ctx.fill();
        ctx.globalAlpha = 0.92 * burn;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Route to Specific Detailed CAD Blueprint Airframe ──
  if (o.enemy) {
    drawAggressorFlanker(ctx, pal, o, flip, ink, accent, S);
  } else if (hullType === 'light') {
    drawSu47Berkut(ctx, pal, o, flip, ink, accent, S);
  } else if (hullType === 'heavy') {
    drawSu34Fullback(ctx, pal, o, flip, ink, accent, S);
  } else {
    // Standard: Su-30SM / Su-30MKI Flanker
    drawSu30Flanker(ctx, pal, o, flip, ink, accent, S);
  }

  // ── Gun barrels: drawn from the same mounts bullets spawn from ──
  const mounts = MOUNTS[o.gun] || MOUNTS.mg;
  const rec = (o.rec || 0) * (o.gun === 'cannon' ? 2.5 : 1.2);
  ctx.strokeStyle = ink;
  ctx.fillStyle = pal.fill;
  const heavy = o.gun === 'cannon';
  const list = o.enemy ? [MOUNTS.mg[0]] : mounts;
  for (const m of list) {
    lw(ctx, W_OUT * (heavy ? 1.2 : 0.8), S);
    line(ctx, m.b - rec, m.y, m.x - rec, m.y);
    const bw = heavy ? 3.0 : 1.8;
    const bh = heavy ? 1.8 : 1.0;
    ctx.fillRect(m.x - bw - rec, m.y - bh, bw, bh * 2);
    lw(ctx, W_RIB, S);
    ctx.strokeRect(m.x - bw - rec, m.y - bh, bw, bh * 2);
    if (heavy) {
      rib(ctx, pal, S);
      lines(ctx, [
        m.x - 9 - rec, m.y - 1.4, m.x - 9 - rec, m.y + 1.4,
        m.x - 14 - rec, m.y - 1.4, m.x - 14 - rec, m.y + 1.4
      ]);
      ctx.strokeStyle = ink;
    }
  }

  ctx.restore();
}
