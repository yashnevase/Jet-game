// ─────────────────────────────────────────────────────────────
//  LOWLINE: TACTICAL SCHEMATIC / CAD / BLACKBOARD BLUEPRINT EDITION
// ─────────────────────────────────────────────────────────────

export const SEA_Y = 0;        // sea level (world y grows DOWNWARD, sky is negative)
export const CHUNK = 1400;     // world is generated in chunks this wide
export const BASE_H = 440;     // internal logical height (crisp high-DPI scaling, wider tactical view)
export const MIN_W = 620;      // minimum internal width

// Secondary ordnance specifications (GTA V style homing missiles & heavy gravity bombs)
export const ORDNANCE = {
  MISSILE_START: 12,
  MISSILE_MAX: 20,
  MISSILE_REARM: 5,     // bonus awarded on DEFCON rank escalation
  MISSILE_SPEED: 780,
  MISSILE_TURN: 3.8,    // rad/s tracking rate (GTA V Oppressor Mk2 style break-turn dodgeable)
  MISSILE_DMG: 45,
  MISSILE_LIFE: 3.2,

  BOMB_START: 16,
  BOMB_MAX: 25,
  BOMB_REARM: 5,        // bonus awarded on DEFCON rank escalation
  BOMB_GRAV: 550,
  BOMB_DMG: 65,
  BOMB_RADIUS: 52,
};

// Flight model. Arcade, not simulation — but with real stall / lift / momentum.
export const PHYS = {
  G: 460,           // gravity (px/s²)
  CRUISE: 240,      // speed where wing lift exactly cancels gravity in level flight
  LIFT_MAX: 1.15,   // lift stops growing past this multiple of cruise speed
  DRAG_LIN: 0.35,   // linear drag
  DRAG_QUAD: 0.0016,// quadratic drag (sets top speed together with thrust)
  ALIGN: 3.2,       // how fast velocity swings to match the nose (higher = grippier)
  CEILING: -2100,   // soft altitude ceiling
  PLANE_R: 9,       // collision radius
  GROUND_EFFECT: 52,// ground effect aerodynamic cushion distance (px)
  PULL_UP_BOOST: 1.35, // aerodynamic elevator authority scaling during high-speed pull-up
};

// ── Loadout parts ───────────────────────────────────────────
export const GUNS = [
  { id: 'mg', name: 'GSh-30-1 30mm Autocannon', desc: 'High-velocity 30mm tracer with depleted uranium core. Continuous fire.',
    rate: 16, dmg: 3, speed: 780, spread: 0.045, life: 0.78, recoil: 6, shots: 1, size: 1.6 },
  { id: 'cannon', name: 'Bofors 57mm Heavy AP Sabot', desc: 'High-caliber armor-piercing kinetic sabot. Massive recoil kick.',
    rate: 3.2, dmg: 16, speed: 660, spread: 0.012, life: 1.15, recoil: 60, shots: 1, size: 3.2 },
  { id: 'scatter', name: 'Cluster Kinetic Flak', desc: 'Three-stage kinetic spread with proximity fuse. Devastating up close.',
    rate: 6, dmg: 4, speed: 700, spread: 0.18, life: 0.52, recoil: 22, shots: 3, size: 1.6 },
];

export const HULLS = [
  { id: 'light', name: 'Su-47 Berkut (Interceptor)', desc: 'Forward-swept composite wing, extreme instantaneous turn rate, supermaneuverable.', hp: 60, turn: 3.7, scale: 0.95 },
  { id: 'std', name: 'Su-30SM Flanker-H (Multirole)', desc: 'Tandem stepped cockpit, canards, thrust-vectoring Saturn AL-31FP, R-73/R-77 loadout.', hp: 100, turn: 3.1, scale: 1 },
  { id: 'heavy', name: 'Su-34 Fullback (Strike Jet)', desc: 'Armored titanium bathtub cockpit, duckbill nose chine, giant rear APU radar stinger.', hp: 170, turn: 2.45, scale: 1.15 },
];

export const ENGINES = [
  { id: 'std', name: 'Saturn AL-31FP Turbofan', desc: 'Twin afterburning turbofans with 2D thrust-vectoring axisymmetric nozzles.', thrust: 540, lift: 1, drag: 1, maxSpeed: 560 },
  { id: 'turbo', name: 'AL-41F1S Vectored Ramjet', desc: 'Extreme supersonic acceleration with high-Mach shock diamonds.', thrust: 840, lift: 0.9, drag: 1.35, maxSpeed: 650 },
  { id: 'glider', name: 'High-Lift Supercritical Wing', desc: 'Maximum glide ratio and high-altitude cruise ceiling.', thrust: 430, lift: 1.4, drag: 0.7, maxSpeed: 480 },
];

export const DEFAULT_LOADOUT = { gun: 'mg', hull: 'std', engine: 'std' };

// Score needed to reach each rank. Each rank swaps the blueprint palette and escalates threat.
export const RANKS = [0, 800, 2500, 6000, 12000, 22000, 36000, 55000, 80000];

// ── Technical Blueprint & Chalkboard Palettes ─────────────────
// Every theme provides the same keys, so all drawing code stays theme-agnostic:
//   dark   = deepest background (also the CSS page colour)
//   sky/sky2 = background surface (flat in CHALK CAD; other themes add a soft vertical fade)
//   fill   = interior fill of every vehicle/structure so it pops over the grid
//   mid    = secondary structural lines: steel, dimension lines, hatching
//   rib    = thin internal geometry (panel lines, spars, ribs)
//   light  = primary drafting ink: silhouettes, text
//   hot    = active ballistics, telemetry, lock-on (tactical amber)
//   danger = threats and damage (crimson)
export const PAL_KEYS = ['sky', 'sky2', 'mid', 'dark', 'light', 'hot', 'grid', 'fill', 'rib', 'danger'];
export const PALETTES = [
  {
    name: 'VALORANT COMIC',
    desc: 'Cel-shaded matte navy, twilight indigo, electric cyan tracers & chromatic bursts',
    dark: '#080A12', sky: '#121728', sky2: '#080B14', fill: '#141A2B',
    mid: '#3D4F6E', rib: '#7B9AD0', light: '#F1F5F9', hot: '#00F0FF', danger: '#FF2A55', grid: '#1C243B',
  },
  {
    name: 'CHALK CAD',
    desc: 'Blueprint slate with drafting-white ink and tactical amber',
    dark: '#0B0E11', sky: '#0B0E11', sky2: '#0B0E11', fill: '#0E1318',
    mid: '#5C6B73', rib: '#B4BFC6', light: '#F4F6F8', hot: '#FFB000', danger: '#FF3B30', grid: '#F4F6F8',
  },
  {
    name: 'BLUEPRINT',
    desc: 'Prussian blue naval engineering schematic',
    dark: '#061325', sky: '#0a1d38', sky2: '#050f1e', fill: '#081a30',
    mid: '#3f6f9d', rib: '#9cc4e4', light: '#e0f2fe', hot: '#38bdf8', danger: '#ff5a4f', grid: '#e0f2fe',
  },
  {
    name: 'RADAR CRT',
    desc: 'Tactical phosphor green night-vision HUD',
    dark: '#051008', sky: '#09190d', sky2: '#040a05', fill: '#07140a',
    mid: '#2f7a43', rib: '#9bd8ad', light: '#dcfce7', hot: '#4ade80', danger: '#ff5547', grid: '#dcfce7',
  },
  {
    name: 'AMBER HUD',
    desc: 'Avionics cockpit amber CRT display',
    dark: '#120d04', sky: '#1c1508', sky2: '#0d0902', fill: '#171006',
    mid: '#8a6a2c', rib: '#e6cf9a', light: '#fef3c7', hot: '#f59e0b', danger: '#ff4d3d', grid: '#fef3c7',
  },
  {
    name: 'GRAPH SHEET',
    desc: 'Technical millimetric engineering sheet',
    dark: '#16191f', sky: '#1d222a', sky2: '#13161b', fill: '#191d24',
    mid: '#6b7a8f', rib: '#c3cbd6', light: '#ffffff', hot: '#fb7185', danger: '#ff3b30', grid: '#ffffff',
  },
  {
    name: 'STEALTH',
    desc: 'Monochrome inverted high-contrast telemetry',
    dark: '#08080a', sky: '#131317', sky2: '#060607', fill: '#0c0c0f',
    mid: '#5a5a69', rib: '#b9bac4', light: '#f3f4f6', hot: '#e11d48', danger: '#ff3b30', grid: '#f3f4f6',
  },
];
