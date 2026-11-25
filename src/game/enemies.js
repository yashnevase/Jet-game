import { SEA_Y } from './constants.js';
import { clamp, damp, angDiff, wrapAngle, rnd, TAU } from './util.js';
import { waveY, surfaceY } from './terrain.js';
import { ENEMY_MOUNTS, mountPos, muzzlePos, jetMuzzle, jetTail, chopperMuzzle } from './spritesEnemy.js';
import { audio } from './audio.js';

// hw/hh = half width/height of the hitbox. air/sea/ground decides draw order and death style.
export const CFG = {
  boat:      { hw: 40,  hh: 16, hp: 26,  score: 100,  sea: true },
  destroyer: { hw: 68,  hh: 22, hp: 80,  score: 300,  sea: true },
  carrier:   { hw: 132, hh: 34, hp: 420, score: 1800, sea: true },
  jet:       { hw: 26,  hh: 9,  hp: 16,  score: 150,  air: true },
  chopper:   { hw: 36,  hh: 20, hp: 44,  score: 220,  air: true },
  aa:        { hw: 20,  hh: 17, hp: 28,  score: 120,  ground: true },
  art:       { hw: 28,  hh: 17, hp: 40,  score: 180,  ground: true },
  mg:        { hw: 22,  hh: 15, hp: 90,  score: 200,  ground: true },
  fuel:      { hw: 13,  hh: 17, hp: 14,  score: 60,   ground: true },
  radar:     { hw: 10,  hh: 36, hp: 26,  score: 140,  ground: true },
  tent:      { hw: 18,  hh: 14, hp: 8,   score: 30,   ground: true },
};

export function makeEnemy(kind, x, y) {
  const c = CFG[kind];
  return {
    kind, x, y, vx: 0, vy: 0, a: 0, tilt: 0,
    hw: c.hw, hh: c.hh, hp: c.hp, maxHp: c.hp, score: c.score,
    t: Math.random() * 10, flash: 0, cd: rnd(1, 3), home: x, dir: Math.random() < 0.5 ? -1 : 1,
    dying: null, dt: 0, smokeT: 0, aim: -0.8, warn: 0, recoil: 0,
    state: 'attack', until: 0, spin: 0, burstN: 0, burstT: 0, speed: 0, alt: 0,
  };
}

const canTarget = (g) => g.mode === 'play' && g.player.alive && !g.player.dying;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── enemy projectiles ─────────────────────────────────────────
function leadPoint(x, y, P, speed) {
  const t = clamp(Math.hypot(P.x - x, P.y - y) / speed, 0, 1.2);
  return { x: P.x + P.vx * t * 0.8, y: P.y + P.vy * t * 0.8 };
}

function shootBullet(g, x, y, ang, speed, dmg, r = 2.4) {
  g.eb.push({ type: 'b', x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 2.6, dmg, r, g: 0 });
  g.fx.muzzle(x, y, ang, 0.7);
}

// Flak: a shell that bursts near where you're going to be. Watch for the little dark puffs.
function shootFlak(g, x, y, P) {
  const sp = 380;
  const L = leadPoint(x, y, P, sp);
  const ang = Math.atan2(L.y - y, L.x - x) + rnd(-0.05, 0.05);
  const d = Math.hypot(L.x - x, L.y - y);
  g.eb.push({ type: 'flak', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 3, t: 0, fuse: clamp(d / sp, 0.35, 1.7), dmg: 14, r: 3, g: 0 });
  g.fx.muzzle(x, y, ang, 1);
  g.fx.smoke(x, y, 1.2, ['mid'], 0.7);
}

// Artillery lobs a ballistic shell. Solve the launch angle that lands on the target.
function shootShell(g, x, y, P, e) {
  const v = 520;
  const grav = 420;
  let tx = P.x;
  let ty = P.y;
  let ang = null;
  for (let i = 0; i < 2; i++) {
    const dx = Math.abs(tx - x);
    const dyUp = y - ty;
    const disc = v ** 4 - grav * (grav * dx * dx + 2 * dyUp * v * v);
    if (disc < 0 || dx < 20) return false;
    const th = Math.atan((v * v + Math.sqrt(disc)) / (grav * dx)); // high arc
    ang = th;
    const tf = dx / (v * Math.cos(th));
    tx = P.x + P.vx * tf * 0.6;
    ty = P.y + P.vy * tf * 0.6;
  }
  const s = P.x >= x ? 1 : -1;
  const len = e ? ENEMY_MOUNTS.art[0].len : 0; // leave from the muzzle brake, along the barrel
  const mx = x + s * Math.cos(ang) * len;
  const my = y - Math.sin(ang) * len;
  if (e) e.elev = ang;
  g.eb.push({ type: 'shell', x: mx, y: my, vx: s * v * Math.cos(ang), vy: -v * Math.sin(ang), life: 5, dmg: 24, r: 3.4, g: grav });
  g.fx.muzzle(mx, my, s > 0 ? -ang : Math.PI + ang, 1.5);
  g.fx.smoke(mx, my, 2, ['light', 'mid'], 0.8);
  g.addShake(0.08);
  return true;
}

// ── generic turret: tracks you, telegraphs (e.warn) then fires ──
function turret(g, e, dt, range, cd0, cd1, ox, oy, fire) {
  const P = g.player;
  const tx = e.x + ox;
  const ty = e.y + oy;
  e.recoil = Math.max(0, e.recoil - dt * 5);
  const want = Math.atan2(P.y - ty, P.x - tx);
  e.aim += angDiff(e.aim, want) * Math.min(1, 7 * dt);
  if (!canTarget(g) || Math.hypot(P.x - tx, P.y - ty) > range) {
    e.warn = 0;
    e.cd = Math.max(e.cd, 0.9);
    return;
  }
  e.cd -= dt;
  e.warn = e.cd < 0.5 ? 1 : 0;
  if (e.cd <= 0) {
    if (fire(tx, ty, e.aim) !== false) e.recoil = 1;
    e.cd = rnd(cd0, cd1) - Math.min(g.rank * 0.1, 0.8);
  }
}

function seaMove(g, e, dt, speed, range) {
  e.vx = e.dir * speed;
  e.x += e.vx * dt;
  if (Math.abs(e.x - e.home) > range) e.dir = e.x > e.home ? -1 : 1;
  e.y = waveY(e.x, g.t) - e.hh + 3 + Math.sin(e.t * 1.3) * 0.6;
  e.tilt = Math.sin(e.t * 1.1 + e.home) * 0.025;
}

export function spawnAir(g, kind) {
  const P = g.player;
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = P.x + side * (g.view.w * 0.5 + 140);
  const y = clamp(P.y + rnd(-220, 100), -1500, -140);
  const e = makeEnemy(kind, x, y);
  e.a = side > 0 ? Math.PI : 0;
  e.speed = 235 + g.rank * 10;
  e.side = Math.random() < 0.5 ? -1 : 1;
  e.chunk = null;
  g.enemies.push(e);
  return e;
}

// ── AI per kind ───────────────────────────────────────────────
const AI = {
  boat(g, e, dt) {
    seaMove(g, e, dt, 20, 320);
    const [px, py] = [e.dir * ENEMY_MOUNTS.boat[0].x, ENEMY_MOUNTS.boat[0].y];
    turret(g, e, dt, 560, 2.4, 3.4, px, py, (x, y, a) => {
      const [mx, my] = muzzlePos(e, 0, a);
      shootBullet(g, mx, my, a + rnd(-0.05, 0.05), 210, 10);
    });
  },

  destroyer(g, e, dt) {
    seaMove(g, e, dt, 16, 360);
    const m0 = ENEMY_MOUNTS.destroyer[0];
    turret(g, e, dt, 680, 1.9, 2.7, e.dir * m0.x, m0.y, () => {
      e.alt = !e.alt;
      const [mx, my] = muzzlePos(e, e.alt ? 1 : 0);
      shootFlak(g, mx, my, g.player);
    });
  },

  carrier(g, e, dt) {
    seaMove(g, e, dt, 9, 200);
    const mc = ENEMY_MOUNTS.carrier[1];
    turret(g, e, dt, 760, 1.3, 2.0, e.dir * mc.x, mc.y, () => {
      e.alt = ((e.alt || 0) + 1) % 3;
      const [mx, my] = muzzlePos(e, e.alt);
      shootFlak(g, mx, my, g.player);
    });
    e.launchT = (e.launchT === undefined ? 3 : e.launchT) - dt;
    if (e.launchT <= 0 && canTarget(g) && Math.hypot(g.player.x - e.x, g.player.y - e.y) < 1100) {
      e.launchT = Math.max(4, 7.5 - g.rank * 0.4);
      if (g.airCount() < g.airCap() + 2) {
        const j = makeEnemy('jet', e.x + e.dir * 40, e.y - e.hh - 4);
        j.speed = 220 + g.rank * 10;
        j.a = e.dir > 0 ? -0.6 : Math.PI + 0.6;
        j.side = 1;
        j.chunk = null;
        g.enemies.push(j);
        g.fx.smoke(j.x, j.y + 6, 2, ['light', 'mid'], 0.8);
      }
    }
  },

  jet(g, e, dt) {
    const P = g.player;
    const ok = canTarget(g);
    const d = dist(e, P);
    let tgt;

    if (!ok) {
      tgt = e.a;
    } else if (e.state === 'attack') {
      // Stand-off tactical dogfight targeting: compute lead intercept point
      const L = leadPoint(e.x, e.y, P, e.speed + 220);
      tgt = Math.atan2(L.y - e.y, L.x - e.x);
      e.aim = tgt;

      // Anti-ramming tactical break: disengage and execute 5G break turn if too close (<220px)
      if (d < 220 || (d < 340 && Math.abs(angDiff(e.a, Math.atan2(P.y - e.y, P.x - e.x))) < 0.35)) {
        e.state = 'break';
        e.until = e.t + rnd(1.3, 2.2);
        // Break 90° away from player vector to overshoot without ramming
        const escapeDir = Math.random() < 0.5 ? 1.45 : -1.45;
        e.breakAng = Math.atan2(e.y - P.y, e.x - P.x) + escapeDir;
      }
    } else if (e.state === 'break') {
      tgt = e.breakAng;
      if (e.t > e.until && d > 280) e.state = 'climb';
    } else if (e.state === 'climb') {
      // Energy fighting: climb to gain altitude advantage over player
      tgt = Math.cos(e.a) >= 0 ? -0.7 : -Math.PI + 0.7;
      if (e.y < P.y - 180 || e.t > (e.until || 0) + 2.5) e.state = 'attack';
    } else {
      tgt = e.a;
      if (e.t > (e.until || 0)) e.state = 'attack';
    }

    // Terrain & sea avoidance: pull up smoothly before approaching terrain
    const gy = surfaceY(g, e.x + Math.cos(e.a) * 110);
    if (e.y > gy - 130 && Math.sin(e.a) > -0.2) {
      tgt = Math.cos(e.a) >= 0 ? -1.0 : -Math.PI + 1.0;
    }
    if (e.y < -1800 && Math.sin(e.a) < 0) {
      tgt = Math.cos(e.a) >= 0 ? 0.6 : Math.PI - 0.6;
    }

    const turn = 2.4 + g.rank * 0.08;
    e.steer = clamp(angDiff(e.a, tgt) / 0.6, -1, 1);
    e.a = wrapAngle(e.a + clamp(angDiff(e.a, tgt), -turn * dt, turn * dt));
    e.x += Math.cos(e.a) * e.speed * dt;
    e.y += Math.sin(e.a) * e.speed * dt;

    // Telegraph: from 0.55 s before the burst (and during it) the jet shows its aim line and pings a warning
    const aligned = Math.abs(angDiff(e.a, Math.atan2(P.y - e.y, P.x - e.x))) < 0.4;
    e.warn = ok && e.state === 'attack' && d >= 220 && d < 580 && aligned && (e.burstN > 0 || e.cd < 0.55) ? 1 : 0;

    // Tactical burst fire: fires from stand-off range (260-560px) with lead deflection
    e.cd -= dt;
    if (ok && e.state === 'attack' && e.burstN === 0 && e.cd <= 0 && d >= 220 && d < 560 && Math.abs(angDiff(e.a, Math.atan2(P.y - e.y, P.x - e.x))) < 0.25) {
      e.burstN = 3;
      e.burstT = 0;
      e.cd = rnd(2.2, 3.4) - Math.min(g.rank * 0.12, 1);
    }
    if (e.burstN > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.09;
        e.burstN--;
        const [mx, my] = jetMuzzle(e);
        shootBullet(g, mx, my, e.a + rnd(-0.025, 0.025), 490, 6, 2.2);
      }
    }
    e.trailT = (e.trailT || 0) - dt;
    if (e.trailT <= 0) {
      e.trailT = 0.018;
      const [tx, ty] = jetTail(e);
      g.fx.trail(tx, ty, 0.8, e);
    }
  },

  chopper(g, e, dt) {
    const P = g.player;
    const ok = canTarget(g);
    e.face = P.x >= e.x ? 1 : -1;
    e.aim = Math.atan2(P.y - (e.y + 6), P.x - e.x);
    if (ok) {
      const tx = P.x + e.side * 230;
      const ty = Math.min(P.y - 80, -70);
      e.vx = damp(e.vx, clamp((tx - e.x) * 0.9, -150, 150), 2, dt);
      e.vy = damp(e.vy, clamp((ty - e.y) * 0.9, -110, 110), 2, dt);
    } else {
      e.vx = damp(e.vx, 0, 1, dt);
      e.vy = damp(e.vy, 0, 1, dt);
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.tilt = clamp(e.vx * 0.0014, -0.25, 0.25);
    e.cd -= dt;
    if (ok && e.burstN === 0 && e.cd <= 0 && Math.abs(P.x - e.x) < 520) {
      e.burstN = 3;
      e.burstT = 0;
      e.cd = rnd(2.4, 3.4) - Math.min(g.rank * 0.1, 0.9);
    }
    e.warn = e.cd < 0.3 && ok ? 1 : 0;
    if (e.burstN > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.2;
        e.burstN--;
        const [mx, my] = chopperMuzzle(e);
        const a = Math.atan2(P.y - my, P.x - mx) + rnd(-0.07, 0.07);
        shootBullet(g, mx, my, a, 240, 8, 2.6);
      }
    }
  },

  aa(g, e, dt) {
    const ma = ENEMY_MOUNTS.aa[0];
    turret(g, e, dt, 640, 2.2, 3.0, ma.x, ma.y, () => {
      const [mx, my] = muzzlePos(e, 0);
      shootFlak(g, mx, my, g.player);
    });
  },

  art(g, e, dt) {
    const mr = ENEMY_MOUNTS.art[0];
    turret(g, e, dt, 640, 3.2, 4.4, mr.x, mr.y, (x, y) => shootShell(g, x, y, g.player, e));
  },

  mg(g, e, dt) {
    const mm = ENEMY_MOUNTS.mg[0];
    turret(g, e, dt, 460, 1.8, 2.6, mm.x, mm.y, () => {
      e.burstN = 5;
      e.burstT = 0;
    });
    if (e.burstN > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.09;
        e.burstN--;
        const [mx, my] = muzzlePos(e, 0);
        shootBullet(g, mx, my, e.aim + rnd(-0.08, 0.08), 400, 5, 2.2);
      }
    }
  },

  fuel() {},
  tent() {},

  radar(g, e, dt) {
    e.al = (e.al === undefined ? 5 : e.al) - dt;
    if (canTarget(g) && Math.abs(g.player.x - e.x) < 1100 && e.al <= 0) {
      e.al = Math.max(4.5, 9 - g.rank * 0.5);
      if (g.airCount() < g.airCap() + 1) {
        spawnAir(g, 'jet');
        g.fx.add({ k: 'ring', x: e.x, y: e.y - e.hh, life: 0.6, s0: 3, s1: 36, w0: 2, ramp: ['hot', 'light'], z: 1 });
        e.ping = 1;
      }
    }
    e.ping = Math.max(0, (e.ping || 0) - dt);
  },
};

// ── damage & death ────────────────────────────────────────────
export function damageEnemy(g, e, dmg) {
  if (e.dying) return;
  const willKill = e.hp <= dmg;
  e.hp -= dmg;
  e.flash = 0.07;
  g.hitmarker = { t: willKill ? 0.28 : 0.16, isKill: willKill, x: e.x, y: e.y };
  audio.hitmarker(willKill);
  if (e.hp <= 0) killEnemy(g, e);
}

export function blast(g, x, y, r, dmgE, dmgP) {
  for (const o of g.enemies) {
    if (o.dying) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < r + o.hw) damageEnemy(g, o, dmgE * (1 - clamp(d / (r + o.hw), 0, 1) * 0.5));
  }
  const P = g.player;
  if (g.mode === 'play' && P.alive && !P.dying) {
    const d = Math.hypot(P.x - x, P.y - y);
    if (d < r) g.hurtPlayer(dmgP * (1 - (d / r) * 0.6), x, y);
  }
}

export function killEnemy(g, e) {
  if (e.dying) return;
  const c = CFG[e.kind];
  g.addScore(e.score, e.x, e.y - e.hh - 4, e.kind === 'carrier' || e.kind === 'destroyer');
  g.kills++;
  e.dying = c.air ? 'fall' : c.sea ? 'sink' : 'rubble';
  e.dt = 0;
  e.warn = 0;
  switch (e.kind) {
    case 'fuel':
      g.fx.explode(g, e.x, e.y, 2.1);
      blast(g, e.x, e.y, 78, 45, 30);
      break;
    case 'carrier':
      g.fx.explode(g, e.x, e.y - 6, 3.4);
      g.freeze(0.045);
      g.slowT = 0.5;
      e.boomT = 0.1;
      e.sinkTilt = 0.07 * e.dir;
      break;
    case 'destroyer':
      g.fx.explode(g, e.x, e.y - 4, 2);
      e.boomT = 0.15;
      e.sinkTilt = 0.18 * e.dir;
      break;
    case 'boat':
      g.fx.explode(g, e.x, e.y - 2, 1.3);
      e.sinkTilt = 0.35 * e.dir;
      break;
    case 'jet':
      g.fx.explode(g, e.x, e.y, 0.9);
      e.vx = Math.cos(e.a) * e.speed * 0.8;
      e.vy = Math.sin(e.a) * e.speed * 0.8;
      e.spin = rnd(-6, 6);
      break;
    case 'chopper':
      g.fx.explode(g, e.x, e.y, 1.2);
      e.vy = -20;
      e.spin = rnd(-4, 4);
      break;
    case 'radar':
      g.fx.explode(g, e.x, e.y + 4, 1.2);
      break;
    default:
      g.fx.explode(g, e.x, e.y, c.hp > 50 ? 1.5 : 1);
  }
  // persistent wireframe wreckage that tumbles and splashes down
  g.fx.wreck(e.x, e.y, e.hw, e.hh, e.vx || 0, e.vy || 0, c.hp > 60 ? 2 : 1);
}

function updateDying(g, e, dt) {
  e.dt += dt;
  const fx = g.fx;
  if (e.dying === 'sink') {
    const big = e.kind === 'carrier' ? 1 : e.kind === 'destroyer' ? 0.6 : 0.3;
    e.y += (4 + e.dt * 5 * (1.3 - big * 0.5)) * dt;
    e.tilt += (e.sinkTilt || 0.2) * dt;
    if (e.boomT !== undefined && e.dt < (e.kind === 'carrier' ? 2.4 : 1.2)) {
      e.boomT -= dt;
      if (e.boomT <= 0) {
        e.boomT = e.kind === 'carrier' ? 0.17 : 0.25;
        fx.explode(g, e.x + rnd(-e.hw, e.hw) * 0.9, e.y - rnd(0, e.hh), e.kind === 'carrier' ? rnd(0.9, 1.7) : rnd(0.6, 1.1));
      }
    }
    e.smokeT -= dt;
    if (e.smokeT <= 0) {
      e.smokeT = 0.06;
      fx.burn(e.x + rnd(-e.hw, e.hw) * 0.8, e.y - e.hh * 0.6, 1.2 + big);
    }
    if (Math.floor(e.dt * 2.5) !== Math.floor((e.dt - dt) * 2.5)) fx.splash(e.x + rnd(-e.hw, e.hw), 0.15 + big * 0.3);
    if (e.y > SEA_Y + e.hh + 16 + big * 6) e.remove = true;
  } else if (e.dying === 'fall') {
    e.vy += 430 * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.a += e.spin * dt;
    e.tilt = e.kind === 'chopper' ? e.a : 0;
    e.smokeT -= dt;
    if (e.smokeT <= 0) {
      e.smokeT = 0.025;
      fx.burn(e.x, e.y, 1.1);
    }
    const gy = surfaceY(g, e.x);
    if (e.y + e.hh * 0.5 > gy) {
      fx.explode(g, e.x, gy - 2, e.kind === 'chopper' ? 1.4 : 1);
      e.remove = true;
    }
  } else {
    // rubble: smoulders for a while
    e.smokeT -= dt;
    if (e.smokeT <= 0) {
      e.smokeT = rnd(0.12, 0.25);
      fx.smoke(e.x + rnd(-e.hw, e.hw) * 0.6, e.y - e.hh * 0.4, 1.2, ['dark', 'mid'], 0.7);
      if (Math.random() < 0.4) fx.burn(e.x + rnd(-e.hw, e.hw) * 0.5, e.y, 0.8);
    }
    if (e.dt > 10) e.remove = true;
  }
}

export function updateEnemies(g, dt) {
  const P = g.player;
  const a = g.enemies;
  for (let i = a.length - 1; i >= 0; i--) {
    const e = a[i];
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);
    if (e.dying) {
      updateDying(g, e, dt);
    } else {
      AI[e.kind](g, e, dt);
      const w = e.warn ? 1 : 0;
      if (w && !e._w && canTarget(g) && Math.hypot(e.x - P.x, e.y - P.y) < 760) audio.threatTick();
      e._w = w;
      if (e.hp < e.maxHp * 0.5) {
        e.smokeT -= dt;
        if (e.smokeT <= 0) {
          const bad = e.hp < e.maxHp * 0.25;
          e.smokeT = bad ? 0.07 : 0.16;
          if (bad) g.fx.burn(e.x + rnd(-e.hw, e.hw) * 0.6, e.y - e.hh * 0.4, 0.9);
          else g.fx.smoke(e.x + rnd(-e.hw, e.hw) * 0.6, e.y - e.hh * 0.5, 1, ['dark', 'mid'], 0.6);
        }
      }
      if (CFG[e.kind].air && Math.hypot(e.x - P.x, e.y - P.y) > 2600) e.remove = true;
    }
    if (e.remove) {
      a[i] = a[a.length - 1];
      a.pop();
    }
  }
}

// ── enemy bullets ─────────────────────────────────────────────
export function updateEnemyBullets(g, dt) {
  const a = g.eb;
  const P = g.player;
  for (let i = a.length - 1; i >= 0; i--) {
    const b = a[i];
    b.life -= dt;
    b.vy += (b.g || 0) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let dead = b.life <= 0;
    const live = g.mode === 'play' && P.alive && !P.dying;
    if (b.type === 'flak') {
      b.t += dt;
      if (b.t >= b.fuse || (live && Math.hypot(P.x - b.x, P.y - b.y) < 15)) {
        flakBurst(g, b, live);
        dead = true;
      }
      g.fx.add({ k: 'dot', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, s0: 1.4, s1: 0.4, ramp: ['mid'], a: 0.6, fade: true, z: 0 });
    } else if (b.type === 'shell') {
      g.fx.add({ k: 'dot', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.5, s0: 2, s1: 0.5, ramp: ['light', 'mid'], a: 0.7, fade: true, z: 0 });
      const sy = surfaceY(g, b.x);
      if (b.y > sy) {
        g.fx.explode(g, b.x, sy - 2, 0.9);
        blast(g, b.x, sy, 34, 0, b.dmg);
        dead = true;
      } else if (live && Math.hypot(P.x - b.x, P.y - b.y) < 17) {
        g.fx.explode(g, b.x, b.y, 0.9);
        blast(g, b.x, b.y, 34, 0, b.dmg);
        dead = true;
      }
    } else if (live && Math.hypot(P.x - b.x, P.y - b.y) < P.r + b.r) {
      g.hurtPlayer(b.dmg, b.x - b.vx, b.y - b.vy);
      g.fx.spark(b.x, b.y, b.vx, b.vy, 4);
      dead = true;
    } else if (b.y > surfaceY(g, b.x)) {
      dead = true;
      if (b.y > SEA_Y - 1 && surfaceY(g, b.x) >= SEA_Y) g.fx.splash(b.x, 0.2);
    }
    if (dead) {
      a[i] = a[a.length - 1];
      a.pop();
    }
  }
}

function flakBurst(g, b, live) {
  const fx = g.fx;
  fx.add({ k: 'flash', x: b.x, y: b.y, life: 0.08, s0: 7, s1: 11, ramp: ['light'], z: 1 });
  fx.add({ k: 'ring', x: b.x, y: b.y, life: 0.3, s0: 4, s1: 28, w0: 2, ramp: ['light', 'hot'], z: 1 });
  for (let i = 0; i < 9; i++) {
    const ang = rnd(0, TAU);
    const sp = rnd(10, 60);
    fx.add({ k: 'dot', x: b.x + Math.cos(ang) * 5, y: b.y + Math.sin(ang) * 5, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, drag: 1.6, life: rnd(0.8, 1.6), s0: rnd(3, 6), s1: rnd(8, 12), ramp: ['dark', 'mid'], a: 0.85, fade: true, z: 0 });
  }
  for (let i = 0; i < 5; i++) {
    const ang = rnd(0, TAU);
    fx.add({ k: 'line', x: b.x, y: b.y, vx: Math.cos(ang) * 160, vy: Math.sin(ang) * 160, drag: 2, life: 0.25, ramp: ['light', 'hot'], z: 1 });
  }
  g.addShake(0.1);
  const P = g.player;
  if (live && Math.hypot(P.x - b.x, P.y - b.y) < 30) g.hurtPlayer(b.dmg, b.x, b.y);
}
