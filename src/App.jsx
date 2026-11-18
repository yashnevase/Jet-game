import { useEffect, useRef, useState } from 'react';
import { Game } from './game/game.js';
import { GUNS, HULLS, ENGINES, PALETTES } from './game/constants.js';
import { fmt } from './game/util.js';
import { audio } from './game/audio.js';
import { UpgradePreview } from './UpgradePreview.jsx';

// React owns the menus. The game itself runs on a plain <canvas> outside React's render loop.

function applyPalette(p) {
  const s = document.documentElement.style;
  s.setProperty('--dark', p.dark);
  s.setProperty('--mid', p.mid);
  s.setProperty('--light', p.light);
  s.setProperty('--hot', p.hot);
  s.setProperty('--sky', p.sky);
  s.setProperty('--danger', p.danger || '#FF2A55');
}

function Bar({ v, max }) {
  return (
    <span className="bar" aria-hidden="true">
      <i style={{ width: Math.round((100 * v) / max) + '%' }} />
    </span>
  );
}

function PartPicker({ title, category, items, value, previewId, onPick, onInspect, stats }) {
  return (
    <fieldset className="parts">
      <legend>{title}</legend>
      {items.map((it) => {
        const isEquipped = it.id === value;
        const isPreviewing = it.id === previewId;
        return (
          <button
            key={it.id}
            className={'part' + (isEquipped ? ' on' : '') + (isPreviewing ? ' previewing' : '')}
            onClick={() => {
              audio.uiClick();
              onPick(it.id);
            }}
            onMouseEnter={() => {
              audio.uiHover();
              onInspect(it);
            }}
            onFocus={() => {
              audio.uiHover();
              onInspect(it);
            }}
            aria-pressed={isEquipped}
          >
            <b>{it.name}</b>
            <small>{it.desc}</small>
            {stats(it).map(([label, v, max]) => (
              <span className="stat" key={label}>
                <em>{label}</em>
                <Bar v={v} max={max} />
              </span>
            ))}
          </button>
        );
      })}
    </fieldset>
  );
}

function TouchBtn({ game, name, className, children }) {
  const set = (v) => (e) => {
    e.preventDefault();
    audio.resume();
    if (v && e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    game.current.input.touch[name] = v;
    e.currentTarget.classList.toggle('down', v);
  };
  return (
    <button
      className={'tb ' + className}
      onPointerDown={set(true)}
      onPointerUp={set(false)}
      onPointerCancel={set(false)}
      onLostPointerCapture={set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export default function App() {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const game = useRef(null);
  const [screen, setScreen] = useState('menu'); // menu | loadout | play | paused | over
  const [summary, setSummary] = useState(null);
  const [loadout, setLoadout] = useState({ gun: 'mg', hull: 'std', engine: 'std' });
  const [preview, setPreview] = useState({ category: 'gun', item: GUNS[0] });
  const [themeIdx, setThemeIdx] = useState(0);
  const [best, setBest] = useState(0);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const g = new Game(canvas.current, {
      onMode: (m, s) => {
        if (m === 'over') {
          setSummary(s);
          setBest(s.best);
        }
        setScreen((prev) => (prev === 'loadout' && m === 'menu' ? prev : m));
      },
      onPalette: (pal) => {
        applyPalette(pal);
        if (game.current) setThemeIdx(game.current.palIdx);
      },
    });
    game.current = g;
    setLoadout(g.loadout);
    setBest(g.best);
    setThemeIdx(g.palIdx);
    applyPalette(PALETTES[g.palIdx] || PALETTES[0]);

    const fit = () => {
      const r = wrap.current.getBoundingClientRect();
      g.resize(Math.max(1, r.width), Math.max(1, r.height));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    const onTouch = () => setTouch(true);
    window.addEventListener('touchstart', onTouch, { once: true, passive: true });
    g.attach();
    return () => {
      ro.disconnect();
      window.removeEventListener('touchstart', onTouch);
      g.destroy();
    };
  }, []);

  const cycleTheme = () => {
    audio.resume();
    audio.uiClick();
    if (!game.current) return;
    const next = (game.current.palIdx + 1) % PALETTES.length;
    game.current.selectTheme(next);
    setThemeIdx(next);
  };

  const pick = (key, id) => {
    const next = { ...loadout, [key]: id };
    setLoadout(next);
    game.current.setLoadout(next);
    game.current.enterMenu(); // rebuild the demo plane with the new parts
    const list = key === 'gun' ? GUNS : key === 'hull' ? HULLS : ENGINES;
    const it = list.find((x) => x.id === id) || list[0];
    setPreview({ category: key, item: it });
  };

  const fly = () => {
    audio.resume();
    audio.uiClick();
    game.current.startRun();
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && screen === 'menu') {
        e.preventDefault();
        fly();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const toMenu = () => {
    audio.uiClick();
    game.current.enterMenu();
    setScreen('menu');
  };

  const showPad = touch && (screen === 'play' || screen === 'paused');
  const activePal = PALETTES[themeIdx] || PALETTES[0];

  return (
    <div className="stage" ref={wrap}>
      <canvas ref={canvas} className="view" />

      {screen === 'menu' && (
        <main className="menu">
          <h1>VECTOR // AERO</h1>
          <p className="tag">Tactical Combined-Arms & Ballistic Geometry Flight</p>

          <div className="ordnance-strip">
            <div className="ord-item">
              <span className="ord-tag hot">AGM-73</span>
              <span className="ord-name">Homing Missiles (x12)</span>
              <span className="ord-key">M / X</span>
            </div>
            <div className="ord-item">
              <span className="ord-tag">GBU-12</span>
              <span className="ord-name">Strike Bombs (x16)</span>
              <span className="ord-key">B / C</span>
            </div>
            <div className="ord-item">
              <span className="ord-tag hot">GSh-30</span>
              <span className="ord-name">30mm Autocannon</span>
              <span className="ord-key">Space</span>
            </div>
          </div>

          <div className="row">
            <button className="btn big pulse" onClick={fly}>
              ▶ SCRAMBLE FLIGHT
            </button>
            <button className="btn" onClick={() => { audio.resume(); audio.uiClick(); setScreen('loadout'); }}>Avionics</button>
            <button className="btn" onClick={cycleTheme} title="Switch Blueprint / Chalkboard Theme">
              CAD: {PALETTES[themeIdx]?.name || 'CHALK'}
            </button>
          </div>
          {best > 0 && <p className="best">Record Score: {fmt(best)}</p>}
          <p className="keys">
            <b>←/→</b> or <b>A/D</b> pitch &nbsp; <b>↑</b> or <b>W</b> thrust &nbsp; <b>Space</b> cannon &nbsp; <b>M/X</b> homing missile &nbsp; <b>B/C</b> drop bomb &nbsp; <b>P</b> pause
          </p>
          <p className="sub-hint">
            ▶ Click <b>SCRAMBLE FLIGHT</b> or press <b>SPACE / ENTER</b> to deploy flight
          </p>
        </main>
      )}

      {screen === 'loadout' && (
        <section className="sheet" aria-label="Loadout">
          <header>
            <h2>AIRCRAFT AVIONICS & SCHEMATICS</h2>
            <button className="btn big" onClick={fly}>Deploy Flight</button>
            <button className="btn" onClick={cycleTheme}>Theme: {PALETTES[themeIdx]?.name}</button>
            <button className="btn" onClick={() => { audio.uiClick(); setScreen('menu'); }}>Back</button>
          </header>

          <div className="loadout-layout">
            {/* Left side: Part Pickers */}
            <div className="cols">
              <PartPicker
                title="Armament System"
                category="gun"
                items={GUNS}
                value={loadout.gun}
                previewId={preview.category === 'gun' ? preview.item.id : null}
                onPick={(id) => pick('gun', id)}
                onInspect={(it) => setPreview({ category: 'gun', item: it })}
                stats={(g) => [['Damage/s', g.rate * g.dmg * g.shots, 100], ['Recoil', g.recoil * g.rate, 200]]}
              />
              <PartPicker
                title="Airframe Geometry"
                category="hull"
                items={HULLS}
                value={loadout.hull}
                previewId={preview.category === 'hull' ? preview.item.id : null}
                onPick={(id) => pick('hull', id)}
                onInspect={(it) => setPreview({ category: 'hull', item: it })}
                stats={(h) => [['Armor', h.hp, 170], ['Turn Rate', h.turn, 3.7]]}
              />
              <PartPicker
                title="Propulsion System"
                category="engine"
                items={ENGINES}
                value={loadout.engine}
                previewId={preview.category === 'engine' ? preview.item.id : null}
                onPick={(id) => pick('engine', id)}
                onInspect={(it) => setPreview({ category: 'engine', item: it })}
                stats={(e) => [['Thrust', e.thrust, 840], ['Wing Lift', e.lift, 1.4]]}
              />
            </div>

            {/* Right side: Valorant-style Tactical Upgrade Evaluation Window */}
            <UpgradePreview
              item={preview.item}
              category={preview.category}
              currentId={loadout[preview.category]}
              pal={activePal}
              onEquip={(id) => pick(preview.category, id)}
            />
          </div>
        </section>
      )}

      {screen === 'paused' && (
        <section className="card">
          <h2>Paused</h2>
          <div className="row">
            <button className="btn big" onClick={() => { audio.uiClick(); game.current.togglePause(); }}>Resume</button>
            <button className="btn" onClick={toMenu}>Quit</button>
          </div>
        </section>
      )}

      {screen === 'over' && summary && (
        <section className="card">
          <h2>Down in flames</h2>
          <p className="score">{fmt(summary.score)}</p>
          {summary.newBest ? <p className="best">New best</p> : <p className="best">Best {fmt(summary.best)}</p>}
          <dl>
            <div><dt>Rank</dt><dd>{summary.rank}</dd></div>
            <div><dt>Kills</dt><dd>{summary.kills}</dd></div>
            <div><dt>Time</dt><dd>{Math.floor(summary.time / 60)}:{String(summary.time % 60).padStart(2, '0')}</dd></div>
          </dl>
          <div className="row">
            <button className="btn big" onClick={fly} autoFocus>Retry</button>
            <button className="btn" onClick={() => { audio.uiClick(); setScreen('loadout'); }}>Loadout</button>
            <button className="btn" onClick={toMenu}>Menu</button>
          </div>
        </section>
      )}

      {showPad && (
        <div className="pad" aria-label="Mobile Controls">
          {/* Left thumb: Pitch steering controls */}
          <div className="pad-l">
            <TouchBtn game={game} name="left" className="rot rot-l">◀ PITCH</TouchBtn>
            <TouchBtn game={game} name="right" className="rot rot-r">PITCH ▶</TouchBtn>
          </div>

          {/* Right thumb: PUBG-style tactical weapon & thrust action cluster */}
          <div className="pad-r">
            <div className="pad-actions-top">
              <TouchBtn game={game} name="missile" className="btn-ord btn-missile">
                <span className="btn-icon">🚀</span>
                <span className="btn-lbl">AGM</span>
              </TouchBtn>
              <TouchBtn game={game} name="bomb" className="btn-ord btn-bomb">
                <span className="btn-icon">💣</span>
                <span className="btn-lbl">GBU</span>
              </TouchBtn>
            </div>
            <div className="pad-actions-main">
              <TouchBtn game={game} name="fire" className="btn-main btn-fire">
                <span className="btn-icon">⚡</span>
                <span className="btn-lbl">CANNON</span>
              </TouchBtn>
              <TouchBtn game={game} name="thrust" className="btn-main btn-thrust">
                <span className="btn-icon">▲</span>
                <span className="btn-lbl">THRUST</span>
              </TouchBtn>
            </div>
          </div>

          <button className="pause-btn" onClick={() => game.current.togglePause()} aria-label="Pause Flight">
            ❚❚ PAUSE
          </button>
        </div>
      )}
    </div>
  );
}
