// Headless smoke test: runs the real game logic with no canvas.
// Checks flight physics sanity, then plays 3 simulated runs with a simple bot.
import { Game } from '../src/game/game.js';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ── 1. physics: level flight at cruise speed should hold altitude ──
{
  const g = new Game(null);
  g.startRun();
  const P = g.player;
  P.x = 0; P.y = -300; P.vx = 240; P.vy = 0; P.a = 0;
  g.input.keys = {};
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  ok(Math.abs(P.y + 300) < 40, `cruise holds altitude (dy=${(P.y + 300).toFixed(1)})`);

  // no thrust, nose up: should stall and fall, not fly forever
  P.x = 0; P.y = -600; P.vx = 200; P.vy = 0; P.a = -1.2; P.thrusting = false;
  for (let i = 0; i < 300; i++) g.step(1 / 60);
  ok(P.y > -600 || !P.alive, 'unpowered climb stalls and falls');

  // thrust level reaches a sane top speed
  const g2 = new Game(null); g2.startRun();
  const Q = g2.player; Q.y = -1000; Q.a = 0;
  g2.input.keys = { ArrowUp: true };
  for (let i = 0; i < 300; i++) { Q.y = -1000; g2.step(1 / 60); }
  const sp = Math.hypot(Q.vx, Q.vy);
  ok(sp > 300 && sp <= 640, `top speed sane incl. afterburner (${sp.toFixed(0)})`);
  ok(Q.ab > 0.8, `afterburner lights after sustained thrust (ab=${Q.ab.toFixed(2)})`);
}


// ── 1b. new combat rules ──
{
  const mk = () => { const g = new Game(null); g.startRun(); const P = g.player; P.x = 0; P.y = -600; P.vx = 260; P.vy = 0; P.a = 0; g.enemies.length = 0; return g; };
  const hold = (g, keys, frames) => { g.input.keys = keys; for (let i = 0; i < frames; i++) { g.update(1 / 60); g.player.y = Math.min(g.player.y, -500); } g.input.keys = {}; };

  // missile: one press = one missile, even if the key is held for 1.5 s
  let g = mk(); const m0 = g.player.missiles;
  hold(g, { KeyM: true }, 90);
  ok(m0 - g.player.missiles === 1, `held missile key spends exactly 1 (spent ${m0 - g.player.missiles})`);
  g.update(1 / 60); hold(g, { KeyM: true }, 5);
  ok(m0 - g.player.missiles === 2 || g.player.missileCd > 0, 'a fresh press fires again after the cooldown');

  // missile: ejector coast, then motor ignition
  g = mk(); hold(g, { KeyM: true }, 2);
  const m = g.pm[0];
  ok(m && !m.lit, 'missile coasts on the ejector before ignition');
  hold(g, {}, 20);
  ok(g.pm[0] && g.pm[0].lit, 'missile motor ignites after the delay');

  // bombs: tap = 1, hold = 1 + ripple (4), release cancels the rest
  g = mk(); const b0 = g.player.bombs;
  hold(g, { KeyB: true }, 6); hold(g, {}, 30);
  ok(b0 - g.player.bombs === 1, `bomb tap drops exactly 1 (dropped ${b0 - g.player.bombs})`);
  g = mk(); const b1 = g.player.bombs;
  hold(g, { KeyB: true }, 80); hold(g, {}, 10);
  ok(b1 - g.player.bombs === 1 + 3, `bomb hold drops a 4-bomb ripple (dropped ${b1 - g.player.bombs})`);
  g = mk(); const b2 = g.player.bombs;
  hold(g, { KeyB: true }, 18); hold(g, {}, 30); // released mid-ripple
  ok(b2 - g.player.bombs < 4, `releasing mid-ripple cancels the rest (dropped ${b2 - g.player.bombs})`);
  g = mk(); g.player.vx = 300; hold(g, { KeyB: true }, 3);
  ok(g.bombs.length && Math.abs(g.bombs[0].vx - g.player.vx) < 40, 'bomb inherits aircraft velocity');

  // hit-stop: capped and rate-limited
  g = mk(); g.freeze(0.5);
  ok(g.hitstop <= 0.0451, `hit-stop capped at ~45 ms (${(g.hitstop * 1000).toFixed(0)} ms)`);
  const h1 = g.hitstop; g.hitstop = 0; g.freeze(0.04);
  ok(g.hitstop === 0, 'back-to-back hit-stops are rate-limited');

  // dt clamp: a 2 s frame spike must not advance the sim more than 50 ms
  g = mk(); const t0 = g.t; g.update(2);
  ok(g.t - t0 <= 0.0501, `dt clamped to 50 ms (advanced ${(g.t - t0).toFixed(3)} s)`);

  // fairness: hull hit grants invulnerability; a second hit inside the window does nothing
  g = mk(); const hp0 = g.player.hp; g.hurtPlayer(10, 50, -600); const hp1 = g.player.hp; g.hurtPlayer(10, 50, -600);
  ok(hp1 === hp0 - 10 && g.player.hp === hp1 && g.player.inv >= 0.4, 'hull hit grants i-frames (no multi-frame drain)');

  // energy: a dive builds speed past the level-flight cap; a vertical climb bleeds it
  g = mk(); g.player.a = 1.2; g.player.vx = 300; g.player.vy = 300; g.input.keys = { ArrowUp: true };
  for (let i = 0; i < 90; i++) { g.step(1 / 60); g.player.y = -900; g.player.a = 1.2; }
  const dive = Math.hypot(g.player.vx, g.player.vy);
  g = mk(); g.player.a = -1.4; g.player.vx = 100; g.player.vy = -380; g.input.keys = { ArrowUp: true };
  for (let i = 0; i < 90; i++) { g.step(1 / 60); g.player.y = -900; g.player.a = -1.4; }
  const climb = Math.hypot(g.player.vx, g.player.vy);
  ok(dive > climb + 120, `dive converts altitude to speed, climb bleeds it (dive ${dive.toFixed(0)} vs climb ${climb.toFixed(0)})`);

  // stall warning flag
  g = mk(); g.player.vx = 60; g.player.vy = 0; g.step(1 / 60);
  ok(g.player.stall === true, 'stall flag set when too slow');

  // low-altitude / close-range kill bonus
  g = mk(); g.player.y = -30; g.player.x = 0; const sc0 = g.score; g.addScore(100, 40, -30);
  ok(g.score - sc0 === 150, `LOW+CLOSE kill pays +50% (${g.score - sc0})`);

  // incoming-threat scan
  g = mk(); g.eb.push({ type: 'b', x: g.player.x + 200, y: g.player.y, vx: -450, vy: 0, life: 2, dmg: 6, r: 2.4, g: 0 }); g.scanThreats();
  ok(g.threats.length === 1 && g.incoming > 0.2, 'incoming round is detected for the warning arcs');
}

// ── 2. bot runs ──
function bot(g) {
  const P = g.player, k = g.input.keys = {};
  // nearest live enemy
  let best = null, bd = 1e9;
  for (const e of g.enemies) {
    if (e.dying) continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (d < bd) { bd = d; best = e; }
  }
  let want = best ? Math.atan2(best.y - 30 - P.y, best.x - P.x) : 0;
  const sp = Math.hypot(P.vx, P.vy);
  if (P.y > -160 && Math.sin(P.a) > -0.2) want = Math.cos(P.a) >= 0 ? -1.1 : -Math.PI + 1.1;       // pull up near the sea
  if (sp < 170) want = Math.cos(P.a) >= 0 ? 0.6 : Math.PI - 0.6; // dive to regain speed
  let d = want - P.a; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283;
  if (Math.abs(d) > 1.4) d = (Math.cos(P.a) >= 0 ? -1 : 1) * 2; // big turn: loop over the top, never through a dive
  if (d > 0.1) k.ArrowRight = true; else if (d < -0.1) k.ArrowLeft = true;
  k.ArrowUp = sp < 330 || Math.abs(d) < 0.5;
  k.Space = !!best && bd < 420 && Math.abs(d) < 0.35;
}

const DEBUG = process.env.DBG;
for (let run = 0; run < 3; run++) {
  const g = new Game(null);
  g.startRun();
  let frames = 0, nan = false, maxEnemies = 0, maxFx = 0;
  while (frames < 60 * 150 && g.mode !== 'over') {
    bot(g); if (DEBUG && run === 0 && frames % 6 === 0 && frames < 90) console.log(frames, g.player.x.toFixed(0), g.player.y.toFixed(0), g.player.vx.toFixed(0), g.player.vy.toFixed(0), g.player.a.toFixed(2), g.mode, JSON.stringify(g.input.keys));
    g.update(1 / 60);
    frames++;
    const P = g.player;
    if (![P.x, P.y, P.vx, P.vy, P.a, g.score].every(Number.isFinite)) { nan = true; break; }
    maxEnemies = Math.max(maxEnemies, g.enemies.length);
    let nfx = g.fx.p.length; for (const a of g.fx.streams.values()) nfx += a.length; maxFx = Math.max(maxFx, nfx);
  }
  ok(!nan, `run ${run}: no NaN`);
  console.log(`  run ${run}: ${(frames / 60).toFixed(0)}s mode=${g.mode} score=${g.score} kills=${g.kills} rank=${g.rank} enemies<=${maxEnemies} fx<=${maxFx} eb=${g.eb.length}`);
  ok(maxEnemies < 120 && maxFx <= 1500, `run ${run}: entity counts bounded`);
  ok(g.fx.streams.size < 40 && g.pm.length < 40 && g.bombs.length < 80 && g.fx.warps.length <= 6, `run ${run}: no stream/projectile/warp leaks (streams=${g.fx.streams.size})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
