// Single source of truth for where guns sit on enemy vehicles. Sprites draw barrels from these
// mounts and the AI fires from the same points, so rounds always leave the visible muzzle.
// x/y are in entity-local units (origin = hitbox centre). Ships mirror x with e.dir.
export const MOUNTS = {
  boat: [{ x: 19, y: -6, r: 3.8, len: 14 }],
  destroyer: [{ x: 44, y: -10, r: 5, len: 18 }, { x: -48, y: -10, r: 5, len: 18 }],
  carrier: [{ x: -122, y: -12, r: 4.4, len: 13 }, { x: -34, y: -12, r: 4.4, len: 13 }, { x: 126, y: -12, r: 4.4, len: 13 }],
  aa: [{ x: 0, y: -7, r: 5.5, len: 19, twin: true }],
  mg: [{ x: 0, y: -7, r: 4.2, len: 16 }],
  art: [{ x: 4, y: -6, r: 0, len: 36 }],
};
const SHIPS = new Set(['boat', 'destroyer', 'carrier']);

export function mountPos(e, i = 0) {
  const list = MOUNTS[e.kind];
  const m = list[i % list.length];
  return { x: e.x + (SHIPS.has(e.kind) ? m.x * e.dir : m.x), y: e.y + m.y, m };
}
