// Headless render test: runs the real game and calls render() every frame against a strict fake 2D context.
// The fake context fails the test on anything a real browser would throw on or silently mangle:
//   NaN/Infinity arguments, negative arc/ellipse radii, non-finite lineWidth, globalAlpha outside 0..1,
//   undefined colours, "NaN"/"undefined" inside text, and unbalanced save()/restore().
import { Game } from '../src/game/game.js';
import { makeEnemy, CFG } from '../src/game/enemies.js';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.Path2D = class {
  moveTo(...a) { chk('Path2D.moveTo', a); }
  lineTo(...a) { chk('Path2D.lineTo', a); }
  closePath() {}
};

const errors = [];
let calls = 0;
let where = '';
function fail(msg) {
  if (errors.length < 25) {
    const st = (new Error().stack || '').split('\n').slice(3, 8).map((l) => l.trim().replace(/^at /, '').replace(/file:\/\/.*\/src\/game\//, '')).join(' <- ');
    errors.push(`${where}: ${msg}  @ ${st}`);
  }
}
function chk(name, args) {
  for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) fail(`${name}(${args.join(', ')}) has non-finite arg`);
}

function makeCtx() {
  let depth = 0;
  const state = { lineWidth: 1, globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', font: '10px mono' };
  const grad = { addColorStop: () => {} };
  const impl = {
    save: () => { depth++; },
    restore: () => { depth--; if (depth < 0) fail('restore() without save()'); },
    arc: (x, y, r, a0, a1) => { chk('arc', [x, y, r, a0, a1]); if (r < 0) fail(`arc negative radius ${r}`); },
    ellipse: (x, y, rx, ry, rot, a0, a1) => { chk('ellipse', [x, y, rx, ry, rot, a0, a1]); if (rx < 0 || ry < 0) fail(`ellipse negative radius ${rx},${ry}`); },
    fillText: (t, x, y) => { chk('fillText', [x, y]); if (/NaN|undefined|Infinity/.test(String(t))) fail(`text "${t}"`); },
    strokeText: (t, x, y) => { chk('strokeText', [x, y]); if (/NaN|undefined|Infinity/.test(String(t))) fail(`text "${t}"`); },
    createLinearGradient: (...a) => { chk('createLinearGradient', a); return grad; },
    createRadialGradient: (...a) => { chk('createRadialGradient', a); return grad; },
    setLineDash: (a) => { chk('setLineDash', a); for (const v of a) if (v < 0) fail('negative dash'); },
    clip: () => {},
    fill: () => {},
    stroke: () => {},
    closePath: () => {},
    beginPath: () => {},
  };
  const numeric = ['moveTo', 'lineTo', 'rect', 'fillRect', 'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'setTransform', 'transform', 'quadraticCurveTo', 'bezierCurveTo'];
  for (const n of numeric) impl[n] = (...a) => chk(n, a);
  const ctx = new Proxy({}, {
    get(_, p) {
      if (p === '__depth') return depth;
      if (p in impl) return (...a) => { calls++; return impl[p](...a); };
      if (p in state) return state[p];
      return () => {};
    },
    set(_, p, v) {
      if (p === 'lineWidth' && !(Number.isFinite(v) && v > 0)) fail(`lineWidth=${v}`);
      if (p === 'globalAlpha' && !(Number.isFinite(v) && v >= 0 && v <= 1.0000001)) fail(`globalAlpha=${v}`);
      if ((p === 'fillStyle' || p === 'strokeStyle') && v !== grad && (typeof v !== 'string' || /undefined|NaN/.test(v))) fail(`${p}=${v}`);
      if (p === 'font' && /NaN|undefined/.test(v)) fail(`font=${v}`);
      state[p] = v;
      return true;
    },
  });
  return ctx;
}

const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

async function run(dpr, W, H) {
  globalThis.window = { devicePixelRatio: dpr };
  const { render } = await import('../src/game/render.js');
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const ctx = makeCtx();
  const g = new Game(canvas);
  g.resize(W, H);
  const frame = (label) => {
    where = label;
    g.update(1 / 60);
    render(g);
    if (ctx.__depth !== 0) { fail(`unbalanced save/restore depth=${ctx.__depth}`); }
  };

  // menu (demo flight)
  for (let i = 0; i < 90; i++) frame('menu');

  // play: spawn one of every kind just ahead of the nose, then fly + shoot
  g.startRun();
  const P = g.player;
  P.hp = P.maxHp;
  for (const kind of Object.keys(CFG)) {
    const e = makeEnemy(kind, P.x + 260 + Math.random() * 200, CFG[kind].air ? P.y - 20 : -CFG[kind].hh);
    e.chunk = null;
    if (CFG[kind].air) { e.speed = 240; e.a = Math.PI; e.side = 1; }
    g.enemies.push(e);
  }
  const keys = (g.input.keys = {});
  let frames = 0;
  while (frames < 60 * 40 && (g.mode === 'play' || g.mode === 'dying')) {
    frames++;
    // ace bot: always face the nearest target and fire
    let best = null; let bd = 1e9;
    for (const e of g.enemies) {
      if (e.dying) continue;
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best && g.mode === 'play') P.a = Math.atan2(best.y - P.y, best.x - P.x);
    if (P.y > -150) P.vy = Math.min(P.vy, -80);
    keys.Space = !!best && bd < 500;
    keys.ArrowUp = true;
    if (frames === 300) g.hurtPlayer(30, P.x + 20, P.y); // damage feedback path
    if (frames % 600 === 0) g.fx.explode(g, P.x + 100, P.y, 3); // heavy blast: invert flash + kick
    if (frames % 450 === 0) g.fx.splash(P.x, 1.5);
    frame('play');
  }
  ok(g.kills > 0 || g.score > 0, `dpr${dpr}: ace bot scored (kills=${g.kills} score=${g.score})`);

  // pause, then force a crash → dying → over
  g.mode = 'play'; g.player.alive = true; g.player.dying = false; g.player.hp = 60;
  g.togglePause();
  for (let i = 0; i < 10; i++) frame('paused');
  g.togglePause();
  g.player.hp = 5;
  g.hurtPlayer(50, P.x, P.y);
  for (let i = 0; i < 400; i++) frame('dying/over');
  ok(true, `dpr${dpr}: rendered ${W}x${H} through menu/play/pause/death, mode=${g.mode}`);
}

await run(1, 1280, 720);
await run(2, 390, 844); // phone portrait: MIN_W branch
await run(3, 1920, 1080);

ok(errors.length === 0, `no invalid canvas calls (${calls} calls checked)`);
if (errors.length) {
  for (const e of errors) console.log('  ' + e);
  process.exit(1);
}
console.log('\nrender test: all good');
