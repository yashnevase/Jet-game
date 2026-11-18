import { SEA_Y, CHUNK } from './constants.js';
import { mulberry32 } from './util.js';
import { makeEnemy, CFG } from './enemies.js';
import { islandH } from './terrain.js';

// The world is an endless row of chunks. Each is generated once when you get close
// and thrown away when you leave. Add your own chunk types in genChunk().

function pickBuildings(rng, rank, w) {
  const n = 3 + Math.floor(w / 170) + (rank > 3 ? 1 : 0);
  const table = [['tent', 3], ['fuel', 1.6], ['aa', 2]];
  if (rank >= 2) table.push(['mg', 1.3], ['art', 1.5]);
  if (rank >= 3) table.push(['radar', 0.9]);
  const total = table.reduce((s, t) => s + t[1], 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rng() * total;
    for (const [k, w2] of table) {
      if ((r -= w2) <= 0) { out.push(k); break; }
    }
  }
  return out;
}

function genChunk(g, c) {
  const rng = mulberry32((Math.imul(c, 2654435761) ^ g.seed) >>> 0);
  const x0 = c * CHUNK;
  const r = g.rank;
  g.chunks.set(c, true);

  const ent = (kind, x, y) => {
    const e = makeEnemy(kind, x, y);
    e.chunk = c;
    g.enemies.push(e);
    return e;
  };
  const boat = (x, kind = 'boat') => {
    const e = ent(kind, x, SEA_Y - CFG[kind].hh);
    e.home = x;
    e.dir = rng() < 0.5 ? -1 : 1;
    return e;
  };
  const island = (w, h, kinds) => {
    const ix = x0 + 120 + rng() * (CHUNK - w - 240);
    const isl = { c, x0: ix, x1: ix + w, h, ph: rng() * 6.28 };
    g.islands.push(isl);
    kinds.forEach((k, i) => {
      const x = isl.x0 + w * (0.14 + 0.72 * ((i + 0.5) / kinds.length)) + (rng() - 0.5) * 10;
      ent(k, x, SEA_Y - islandH(isl, x) - CFG[k].hh + 1);
    });
  };

  // hand-built opening so the first minute teaches itself
  if (c === 0) { boat(x0 + 950); return; }
  if (c === -1) { boat(x0 + 400); boat(x0 + 1000); return; }
  if (c === 1) { island(520, 55, ['tent', 'aa', 'tent', 'fuel']); return; }
  if (c === 2) { boat(x0 + 500); boat(x0 + 1000); return; }

  const roll = rng();
  if (roll < 0.1) return; // empty sea: a breather
  if (roll < 0.36) {
    boat(x0 + 150 + rng() * 500);
    boat(x0 + 800 + rng() * 400);
    if (r >= 2 && rng() < 0.5) boat(x0 + 500 + rng() * 300, 'destroyer');
  } else if (roll < 0.78) {
    const w = 480 + rng() * 420;
    island(w, 55 + rng() * 80, pickBuildings(rng, r, w));
  } else {
    // fleet
    const x = x0 + 300 + rng() * 500;
    boat(x, 'destroyer');
    boat(x - 260);
    boat(x + 260);
    if (r >= 2 && rng() < 0.35) boat(x + 520, 'destroyer');
    if (r >= 4 && rng() < 0.55) boat(x0 + 700, 'carrier');
  }
}

function unload(g, c) {
  g.chunks.delete(c);
  g.islands = g.islands.filter((i) => i.c !== c);
  g.enemies = g.enemies.filter((e) => e.chunk !== c);
}

export function updateChunks(g) {
  const pc = Math.floor(g.player.x / CHUNK);
  if (g.lastPc === pc) return;
  g.lastPc = pc;
  for (let c = pc - 3; c <= pc + 3; c++) if (!g.chunks.has(c)) genChunk(g, c);
  for (const c of [...g.chunks.keys()]) if (Math.abs(c - pc) > 5) unload(g, c);
}
