# LOWLINE

A Luftrausers-style arcade flyer in React + Canvas. Fly low, shoot everything,
chain kills, rank up, and watch the palette change as the enemy gets angrier.
Written to be read: every system is a small file you can tweak.

```bash
npm install
npm run dev        # play at http://localhost:5173 (also opens on your phone via LAN)
npm test           # headless physics + gameplay smoke test
npm run build      # static build in dist/ (host anywhere, works offline)
```

## Controls
| | Keyboard | Touch |
|---|---|---|
| Rotate | ←/→ or A/D | ◀ ▶ buttons |
| Thrust | ↑ or W | Thrust button |
| Fire | Space / Z | Fire button |
| Guided missile (AGM-73) | M / X | AGM button |
| Gravity bomb (GBU-12) | B / C: **tap** = 1, **hold** = ripple of 4 | GBU button |
| Sound on/off | N | SND button in menu / pause |
| Pause | P / Esc | II button |

Rules of the sky: hitting sea or land is instant death. Stop shooting for about a
second and your hull heals. Kills within 3.6 s build a combo (x2 … x8). Radars call in jets, flak bursts where
you're *going* to be, and artillery lobs shells you can see coming.

## Flight, weapons & combat rules (v2 pass)
- **Energy flight**: throttle spools up/down (weight); holding thrust ~0.45 s lights the **afterburner** (+30% thrust, +6% top speed, longer hotter plume,
  spark shower). Nose-down converts altitude to speed (a dive can overspeed the level cap by 20%); a steep sustained climb bleeds speed;
  below `STALL_SPEED` the nose drops and the stall buzzer sounds. All knobs are in `PHYS` (constants.js).
- **Attitude animation**: bank compression follows turn rate; reversing direction rolls the airframe over through its edge (`flipAnim`).
  Wingtip vortex ribbons (one per wing) appear under G; afterburner sparks, shell casings (all guns), wreckage chunks on every kill.
- **AGM-73**: edge-triggered (one press = one missile; held keys never double-spend), ejector coast → motor ignition → pursuit arc with its own smoke ribbon.
  A full lock gives the full seeker; firing without lock gives a weaker seeker (55% turn rate). Lock ring + tone close as the seeker acquires.
- **GBU-12**: drops on press (tap = 1 precision bomb). Keep holding past 0.24 s and 3 more follow at 0.11 s spacing; releasing cancels the rest.
  Bombs inherit the jet's full velocity; fast / diving drops hit harder and wider (`power`).
- **Fairness**: enemies telegraph 0.5 s before firing (blinking dashed aim line, "!" triangle, warning tick); rounds closing on you draw red
  arcs around the jet that thicken and blink as impact nears. Hull hits grant 0.45 s i-frames (the jet strobes). Hit-stop is capped at 45 ms and rate-limited.
- **Risk / reward**: chain x2…x8 within 3.6 s; kills at < 70 m altitude pay +25% (LOW), inside 170 m pay +25% (CLOSE).
- **Frame-rate independence**: `dt` is clamped to 50 ms and the sim sub-steps at ~60 Hz; everything (physics, particles, camera, timers) uses it.

## Audio (audio.js, zero asset files)
Pure Web Audio. A continuous engine loop (turbine whine + sub rumble + wind rush + afterburner roar) is driven every frame from airspeed / throttle /
afterburner / dive. Layered cannon (thump + crack + body, pitch-jittered), missile ejector + whoosh, bomb latch + whistle, layered explosions
(sub boom + filtered-noise body + crackle pops, scaled by blast size and distance), hull-hit clang, GPWS, stall buzzer, lock tone, incoming tick,
enemy-telegraph tick, chain / rank chimes. Pause ducks the engine and silences world SFX but leaves UI clicks; mute (N) persists.

## Where things live
```
src/game/
  constants.js   ALL tuning: gravity, lift, drag, gun/hull/engine stats, ranks, palettes
  player.js      flight model (thrust, lift, gravity, drag, alignment, stall), guns, health regen
  enemies.js     11 enemy types: config table + AI per type + death behaviours + enemy bullets
  world.js       endless chunk generator (islands, fleets, carriers)
  terrain.js     wave function and island height profile
  game.js        state, main loop, collisions, director (spawns), scoring, ranks, camera
  cadRenderer.js reusable CAD primitives + stroke hierarchy (2px / 0.75px / 0.5px): hull, rib, brackets, needle, arrows…
  vfxSystem.js   geometric VFX: ribbon contrails, shockwave rings, debris shards, ripples, muzzle starbursts
  spritesPlayer.js / spritesEnemy.js   multi-layer CAD vehicles built only from cadRenderer (reuse for new vehicles)
  scene.js       engineering grid (+ slower parallax layer, shockwave warp), altitude ticks, hazard band, ridges, islands, sea
  audio.js       procedural Web Audio: engine loop, layered SFX, warnings, mute / pause
  tactical.js    fire-control overlays: lock brackets, lead pip, sight/flight/ballistic lines, shell arcs, telegraphs, diegetic ordnance/threat arcs
  hud.js         minimal avionics HUD (telemetry at 35–50% opacity), altitude tape, touch-safe layout
  render.js      native-resolution frame pipeline (DPR scaling, shake, layer order)
  input.js       keyboard + touch → left/right/thrust/fire
src/App.jsx      React menus (title, loadout, pause, game over) + touch pad
scripts/sim-test.mjs   headless simulation (runs the real game with no canvas)
```

## How the flight feels the way it does (player.js → flight())
1. **Thrust** pushes along the nose.
2. **Lift** grows with speed² and acts on the airframe's "up" side. At `CRUISE` speed in level flight it exactly cancels gravity.
   Slower than that and you sink; faster and you climb.
3. **Alignment** bleeds off sideways velocity relative to the nose. This is what turns a floaty rocket into a plane.
4. **Stall**: below ~150 px/s the nose flops toward your direction of travel.
5. **Recoil**: guns push you backwards. The heavy cannon really does slow you.

Try these 30-second experiments in `constants.js`: `ALIGN: 1` (drifty), `ALIGN: 8` (on rails),
`G: 250` (moon), `CRUISE: 400` (everything is faster), `DRAG_QUAD: 0.0008` (higher top speed).

## Rendering notes
- The canvas backing store is CSS size × devicePixelRatio (capped for huge displays). `render()` scales logical
  units onto it and calls `setUnit()` so every stroke width is in CSS pixels: "2px" stays 2px at any zoom/DPR.
- Draw with `pal.dark / fill / mid / rib / light / hot / danger`; `game.pal` blends toward the rank palette.
- Water is drawn after ships and islands so hulls sink into it. Visual-only water ripples never affect physics.
- Screen shake = trauma² noise plus a directional kick from nearby blasts; kills hit-stop and heavy kills flash inverted for 2 frames.
- `npm test` runs the physics sim and a strict render harness (fake canvas that rejects NaN, bad radii, unbalanced save/restore).
- `dist/` is a stale prebuilt bundle: run `npm install && npm run build` to refresh it.

## Ideas to make it yours
- **New enemy**: add a row to `CFG`, an `AI.yourkind`, a `DRAW.yourkind`, and place it in `genChunk()`.
  (A submarine that surfaces, a blimp, a zeppelin boss, a minelayer…)
- **New gun**: add an entry to `GUNS` (homing missiles, a flamethrower, a laser, a bomb that drops).
- **Unlocks**: gate parts behind ranks or coins, and persist with `saveJSON`.
- **Missions / daily seed**: `g.seed` already drives the world; use a fixed seed for a daily challenge.
- **Bosses**: a multi-turret carrier with phases using the `e.state` field.
- **Gamepad**: poll `navigator.getGamepads()` inside `Input`.
