import { PHYS, SEA_Y, GUNS, HULLS, ENGINES, ORDNANCE } from './constants.js';
import { playerMuzzle, playerBreech, PLAYER_SCALE } from './spritesPlayer.js';
import { clamp, damp, wrapAngle, angDiff, rnd } from './util.js';
import { surfaceY, waveY } from './terrain.js';
import { audio } from './audio.js';

export function makePlayer(loadout) {
  const gun = GUNS.find((x) => x.id === loadout.gun) || GUNS[0];
  const hull = HULLS.find((x) => x.id === loadout.hull) || HULLS[1];
  const eng = ENGINES.find((x) => x.id === loadout.engine) || ENGINES[0];
  return {
    x: 0, y: -220, vx: 240, vy: 0, a: 0, av: 0,
    hp: hull.hp, maxHp: hull.hp, r: PHYS.PLANE_R,
    gun, hull, eng,
    missiles: ORDNANCE.MISSILE_START,
    maxMissiles: ORDNANCE.MISSILE_MAX,
    bombs: ORDNANCE.BOMB_START,
    maxBombs: ORDNANCE.BOMB_MAX,
    missileCd: 0,
    bombCd: 0,
    bombHoldT: 0,
    bombSalvoN: 0,
    bombSalvoT: 0,
    alive: true, dying: false, demo: false,
    flash: 0, inv: 0, cd: 0, lastFire: -9, lastHurt: -9,
    thrusting: false, firing: false,
    trailT: 0, trailD: 0, wakeT: 0, spin: 0, dyingT: 0, flameT: 0,
  };
}

// The heart of the game feel. Four forces: thrust, lift, gravity, drag —
// plus "alignment": velocity is dragged toward wherever the nose points,
// which is what makes it feel like a plane and not a spaceship.
function flight(p, dt, g) {
  const { G, CRUISE, LIFT_MAX, DRAG_LIN, DRAG_QUAD, ALIGN, GROUND_EFFECT } = PHYS;
  const eng = p.eng;
  const fx = Math.cos(p.a);
  const fy = Math.sin(p.a);
  let sp = Math.hypot(p.vx, p.vy);

  if (p.thrusting) {
    p.vx += fx * eng.thrust * dt;
    p.vy += fy * eng.thrust * dt;
  }

  // Lift acts on the airframe's "up" side and grows with speed². At CRUISE in level flight it equals gravity.
  // Scaled by |fx| so a vertical nose gives no lift (and no jitter when the sign flips).
  const f = Math.min(sp / CRUISE, LIFT_MAX);
  // When pulling up from a dive, ensure aerodynamic lift vectors upward even when banked
  const pitchUpHelp = (p.vy > 60 && fy < 0.6) ? 0.35 : 0;
  const lift = G * f * f * eng.lift * Math.min(1.0, Math.abs(fx) + pitchUpHelp);
  const nx = fx >= 0 ? fy : -fy;
  const ny = fx >= 0 ? -fx : fx;
  p.vx += nx * lift * dt;
  p.vy += ny * lift * dt;

  p.vy += G * dt;

  // Ground effect: aerodynamic high-pressure cushion within 52 units of sea/terrain
  if (g && p.y > SEA_Y - 55 && p.vy > 0) {
    const gy = surfaceY(g, p.x);
    const dGround = gy - p.y;
    if (dGround > 0 && dGround < (GROUND_EFFECT || 52)) {
      const cushion = (1 - dGround / (GROUND_EFFECT || 52)) * G * 1.35 * eng.lift;
      p.vy = Math.max(-80, p.vy - cushion * dt);
    }
  }

  // alignment: kill sideways velocity relative to the nose
  sp = Math.hypot(p.vx, p.vy);
  const along = p.vx * fx + p.vy * fy;
  const lx = p.vx - along * fx;
  const ly = p.vy - along * fy;
  const keep = Math.exp(-ALIGN * clamp(sp / CRUISE, 0.15, 1.3) * dt);
  p.vx = along * fx + lx * keep;
  p.vy = along * fy + ly * keep;

  // drag
  sp = Math.hypot(p.vx, p.vy);
  const d = Math.exp(-(DRAG_LIN + DRAG_QUAD * sp) * eng.drag * dt);
  p.vx *= d;
  p.vy *= d;

  sp = Math.hypot(p.vx, p.vy);
  if (sp > eng.maxSpeed) {
    p.vx *= eng.maxSpeed / sp;
    p.vy *= eng.maxSpeed / sp;
  }

  // stall: too slow and the nose flops toward the direction you're actually moving
  if (sp < 150) {
    const va = Math.atan2(p.vy, p.vx);
    p.a = wrapAngle(p.a + angDiff(p.a, va) * (1 - sp / 150) * 1.6 * dt);
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // soft ceiling
  if (p.y < PHYS.CEILING) p.vy += (PHYS.CEILING - p.y) * 4 * dt;
}

function shoot(g, p) {
  const gun = p.gun;
  const fx = Math.cos(p.a);
  const fy = Math.sin(p.a);
  // each barrel is a real mount on the airframe (see airframe.js MOUNTS): autocannons alternate,
  // the cluster gun fires one pellet from each wing pod, the heavy cannon has a single barrel.
  p.mountI = ((p.mountI || 0) + 1) % 2;
  let lastX = p.x;
  let lastY = p.y;
  for (let i = 0; i < gun.shots; i++) {
    const [nx, ny] = playerMuzzle(p, gun.shots > 1 ? i : p.mountI);
    lastX = nx;
    lastY = ny;
    const fan = gun.shots > 1 ? (i - (gun.shots - 1) / 2) * gun.spread : 0;
    const a = p.a + fan + (Math.random() - 0.5) * gun.spread * (gun.shots > 1 ? 0.3 : 1);
    g.pb.push({
      x: nx, y: ny, px: nx, py: ny,
      vx: Math.cos(a) * gun.speed + p.vx * 0.6,
      vy: Math.sin(a) * gun.speed + p.vy * 0.6,
      life: gun.life, dmg: gun.dmg, size: gun.size,
    });
    if (gun.shots > 1) g.fx.muzzle(nx, ny, p.a, 0.8);
  }
  p.vx -= fx * gun.recoil;
  p.vy -= fy * gun.recoil;
  if (gun.shots === 1) g.fx.muzzle(lastX, lastY, p.a, gun.size > 2 ? 1.7 : 1);
  if (gun.id === 'mg' && Math.random() < 0.4) {
    const [cx, cy] = playerBreech(p, p.mountI);
    g.fx.casing(cx, cy, p.a);
  }
  g.addShake(gun.size > 2 ? 0.2 : 0.03);
  audio.shoot(gun.id);
}

export function updatePlayer(g, dt) {
  const p = g.player;
  const inp = g.input;
  p.flash = Math.max(0, p.flash - dt);
  p.inv = Math.max(0, p.inv - dt);
  if (!p.alive) return;

  if (p.dying) {
    p.dyingT += dt;
    p.vy += PHYS.G * 0.9 * dt;
    p.vx *= Math.exp(-0.25 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.a += p.spin * dt;
    p.flameT -= dt;
    if (p.flameT <= 0) {
      p.flameT = 0.02;
      g.fx.burn(p.x, p.y, 1.3);
    }
    const land = surfaceY(g, p.x) < SEA_Y - 1;
    if (p.y + 3 > (land ? surfaceY(g, p.x) : waveY(p.x, g.t)) || p.dyingT > 1.9) g.crashPlayer(land);
    return;
  }

  const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  p.thrusting = inp.thrust;
  p.firing = inp.fire;

  // Aerodynamic control authority: at high speeds, dynamic pressure gives responsive elevator authority,
  // especially when pitching up to recover from a dive.
  const sp0 = Math.hypot(p.vx, p.vy);
  const pullingUp = (p.vy > 50 && ((Math.cos(p.a) >= 0 && steer < 0) || (Math.cos(p.a) < 0 && steer > 0)));
  const aeroAuthority = clamp(1 + (sp0 / 520) * 0.35 + (pullingUp ? 0.35 : 0), 0.9, 1.55);
  p.av = damp(p.av, steer * p.hull.turn * aeroAuthority, 18, dt);
  p.a = wrapAngle(p.a + p.av * dt);

  flight(p, dt, g);

  // guns
  p.cd = Math.max(0, p.cd - dt);
  if (p.firing) {
    p.lastFire = g.t;
    let guard = 0;
    while (p.cd <= 0 && guard++ < 3) {
      shoot(g, p);
      p.cd += 1 / p.gun.rate;
    }
  }

  // guided homing missiles (GTA V style)
  p.missileCd = Math.max(0, p.missileCd - dt);
  if (inp.missile && p.missileCd <= 0 && p.missiles > 0) {
    p.missiles--;
    p.missileCd = 0.5;
    g.launchMissile(p);
    audio.missileLaunch();
  }

  // gravity bombs: tap to drop 1, hold to drop a salvo of 3-5
  p.bombCd = Math.max(0, p.bombCd - dt);
  if (inp.bomb) {
    p.bombHoldT += dt;
    // holding down: trigger salvo
    if (p.bombHoldT > 0.28 && p.bombSalvoN === 0 && p.bombs > 0) {
      p.bombSalvoN = Math.min(4, p.bombs);
      p.bombSalvoT = 0;
    }
  } else {
    // released button: if short tap, drop 1 bomb
    if (p.bombHoldT > 0 && p.bombHoldT <= 0.28 && p.bombCd <= 0 && p.bombs > 0 && p.bombSalvoN === 0) {
      p.bombs--;
      p.bombCd = 0.35;
      g.dropBomb(p);
      audio.bombDrop();
    }
    p.bombHoldT = 0;
  }

  // salvo bomb dispenser
  if (p.bombSalvoN > 0) {
    p.bombSalvoT -= dt;
    if (p.bombSalvoT <= 0 && p.bombs > 0) {
      p.bombSalvoT = 0.11;
      p.bombSalvoN--;
      p.bombs--;
      g.dropBomb(p);
      audio.bombDrop();
    }
    if (p.bombs <= 0) p.bombSalvoN = 0;
  }

  // health regen: stop shooting and stay un-hit for a moment and the hull knits back together
  if (g.t - p.lastFire > 0.9 && g.t - p.lastHurt > 1.2 && p.hp < p.maxHp) {
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.09 * dt);
  }

  const sp = Math.hypot(p.vx, p.vy);

  // contrail: one puff per few pixels travelled, so it reads as a solid ribbon at any speed
  // ribbon weight follows airspeed, afterburner and G-load (turn rate × speed)
  const gf = clamp((Math.abs(p.av) * sp) / 900, 0, 1);
  const trailSize = clamp(0.4 + (sp / 560) * 0.55 + (p.thrusting ? 0.25 : 0) + gf * 0.3, 0.4, 1.5);
  p.trailD += sp * dt;
  const step = p.thrusting ? 4 : 7;
  const n = Math.min(8, Math.floor(p.trailD / step));
  p.trailD -= n * step;
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n;
    const tl = 22 * PLAYER_SCALE(p); // behind the nozzles
    const tx = p.x - Math.cos(p.a) * tl - p.vx * dt * f;
    const ty = p.y - Math.sin(p.a) * tl - p.vy * dt * f;
    g.fx.trail(tx, ty, trailSize);
  }
  // wingtip vortex ribbons appear under hard G (visual only)
  if (gf > 0.35 && sp > 120) {
    const S = PLAYER_SCALE(p);
    const flip = Math.cos(p.a) < 0 ? -1 : 1;
    const ca = Math.cos(p.a);
    const sa = Math.sin(p.a);
    const lx = -9 * S;
    const ly = 17.2 * S * flip; // wingtip missile rail
    g.fx.trail(p.x + lx * ca - ly * sa, p.y + lx * sa + ly * ca, 0.3 + gf * 0.45, 'wt');
  }
  if (p.hp < p.maxHp * 0.4 && Math.random() < 0.6) g.fx.burn(p.x, p.y, 0.9);

  // low-flying spray off the sea
  const land = surfaceY(g, p.x) < SEA_Y - 1;
  p.wakeT -= dt;
  if (!land && p.y > SEA_Y - 28 && p.y < SEA_Y - 4 && sp > 150 && p.wakeT <= 0) {
    p.wakeT = 0.035;
    g.fx.wake(p.x, p.vx);
  }

  // GPWS warning: altitude danger when descending rapidly towards sea or ground
  const ground = land ? surfaceY(g, p.x) : waveY(p.x, g.t);
  const altDist = ground - p.y;
  p.gpws = (altDist < 110 && p.vy > 95);
  if (p.gpws && g.mode === 'play') audio.gpwsWarning();

  // sonic boom vapor ring when exceeding top cruise speed at full throttle
  if (sp > 460 && p.thrusting && Math.random() < 0.2) {
    g.fx.shock(p.x, p.y, 20, 'ring', 0.28);
  }

  // crash into sea or land
  if (p.y + 4 > ground) g.crashPlayer(land);
}

export function updatePlayerBullets(g, dt) {
  const a = g.pb;
  for (let i = a.length - 1; i >= 0; i--) {
    const b = a[i];
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) {
      const sy = surfaceY(g, b.x);
      if (b.y > sy) {
        dead = true;
        if (sy < SEA_Y - 1) g.fx.spark(b.x, b.y, b.vx, b.vy, 3);
        else g.fx.splash(b.x, 0.25);
      }
    }
    if (dead) {
      a[i] = a[a.length - 1];
      a.pop();
    }
  }
}

export function dyingSpin() {
  return rnd(4, 8) * (Math.random() < 0.5 ? -1 : 1);
}
