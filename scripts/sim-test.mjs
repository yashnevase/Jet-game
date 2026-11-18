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
  ok(sp > 300 && sp <= 560, `top speed sane (${sp.toFixed(0)})`);
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
}

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
