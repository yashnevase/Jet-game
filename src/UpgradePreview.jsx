import { useEffect, useRef } from 'react';
import { drawFighter } from './game/airframe.js';
import { circle, diamond, line, lw, dash, brackets, starburst } from './game/cadRenderer.js';
import { GUNS, HULLS, ENGINES } from './game/constants.js';

export function UpgradePreview({ item, category, currentId, pal, onEquip }) {
  const canvasRef = useRef(null);
  const animRef = useRef(0);
  const isEquipped = item.id === currentId;

  // Find the currently equipped part for comparison
  const list = category === 'gun' ? GUNS : category === 'hull' ? HULLS : ENGINES;
  const currentItem = list.find((x) => x.id === currentId) || list[0];

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let t = 0;
    let last = performance.now();
    let simBullets = [];
    let simSparks = [];
    let simRings = [];
    let nextShoot = 0;

    const loop = (now) => {
      animRef.current = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      const w = cv.width;
      const h = cv.height;

      // ── Background: CAD blueprint grid & scanning raster ──
      ctx.fillStyle = pal.dark;
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = pal.grid || pal.light;
      ctx.globalAlpha = 0.06;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 20) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += 20) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Sweeping scanline
      const scanY = ((t * 40) % h);
      ctx.strokeStyle = pal.hot;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.moveTo(0, scanY); ctx.lineTo(w, scanY);
      ctx.stroke();

      // Corner tactical brackets
      ctx.strokeStyle = pal.mid;
      ctx.globalAlpha = 0.5;
      brackets(ctx, w / 2, h / 2, w / 2 - 8, h / 2 - 8, 14);

      // ── Simulation Logic by Category ──
      if (category === 'gun') {
        const jetX = 90;
        const jetY = h / 2;
        const targetX = w - 85;
        const targetY = h / 2;

        nextShoot -= dt;
        let recoilKick = 0;

        if (item.id === 'mg') {
          // Autocannon 20mm: continuous rapid fire
          if (nextShoot <= 0) {
            nextShoot = 0.065;
            simBullets.push({ x: jetX + 22, y: jetY + (Math.sin(t * 18) * 1.5), vx: 520, vy: 0, life: 0.45, size: 2.0 });
          }
        } else if (item.id === 'cannon') {
          // Heavy 57mm Bofors: slow, massive recoil sabot
          if (nextShoot <= 0) {
            nextShoot = 0.65;
            simBullets.push({ x: jetX + 26, y: jetY, vx: 440, vy: 0, life: 0.55, size: 4.2, heavy: true });
            simRings.push({ x: jetX + 28, y: jetY, r: 4, maxR: 26, life: 0.28, maxL: 0.28 });
          }
          if (nextShoot > 0.48) recoilKick = (nextShoot - 0.48) * 45;
        } else if (item.id === 'scatter') {
          // Cluster Flak: 3-spread kinetic burst
          if (nextShoot <= 0) {
            nextShoot = 0.36;
            for (let k = -1; k <= 1; k++) {
              simBullets.push({ x: jetX + 20, y: jetY + k * 4, vx: 480, vy: k * 110, life: 0.42, size: 2.2 });
            }
          }
        }

        // Target drone
        ctx.save();
        ctx.translate(targetX, targetY);
        ctx.strokeStyle = pal.danger;
        ctx.fillStyle = pal.fill;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.4;
        diamond(ctx, 0, 0, 14, 14);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.stroke();
        // Target drone rotors
        const rw = Math.abs(Math.cos(t * 22)) * 14;
        line(ctx, -rw, -15, rw, -15);
        line(ctx, -rw, 15, rw, 15);
        ctx.restore();

        // Update & draw bullets
        for (let i = simBullets.length - 1; i >= 0; i--) {
          const b = simBullets[i];
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.life -= dt;

          ctx.fillStyle = b.heavy ? pal.light : pal.hot;
          ctx.strokeStyle = pal.light;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
          ctx.fill();

          // Tracer tail
          ctx.strokeStyle = pal.hot;
          ctx.lineWidth = b.heavy ? 2.5 : 1.4;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - 18, b.y);
          ctx.stroke();

          // Impact target check
          if (b.x >= targetX - 10) {
            b.life = 0;
            // Spawn sparks
            for (let s = 0; s < (b.heavy ? 12 : 5); s++) {
              const ang = (Math.random() - 0.5) * 2.8 + Math.PI;
              const spd = Math.random() * (b.heavy ? 220 : 120) + 40;
              simSparks.push({ x: targetX, y: b.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.25, maxL: 0.25 });
            }
            if (b.heavy) {
              simRings.push({ x: targetX, y: targetY, r: 6, maxR: 38, life: 0.35, maxL: 0.35 });
            }
          }

          if (b.life <= 0) simBullets.splice(i, 1);
        }

        // Draw Player Flanker Jet
        drawFighter(ctx, pal, {
          x: jetX - recoilKick, y: jetY, a: 0, S: 1.1, t,
          ink: pal.light, burn: 0.45, steer: 0, rec: recoilKick > 1 ? 1 : 0, gun: item.id, hull: 'std',
        });

      } else if (category === 'hull') {
        // Hull agility / maneuver / armor demo
        let jetX = w / 2;
        let jetY = h / 2;
        let jetA = 0;
        let steer = 0;

        if (item.id === 'light') {
          // Interceptor: high-speed loop / Pugachev's Cobra
          const phase = (t * 2.2) % (Math.PI * 2);
          jetA = -phase;
          jetX = w / 2 + Math.cos(phase) * 44;
          jetY = h / 2 + Math.sin(phase) * 28;
          steer = -1;
        } else if (item.id === 'std') {
          // Multirole: smooth banked S-curve
          jetA = Math.sin(t * 2) * 0.35;
          jetX = w / 2 + Math.cos(t * 1.5) * 35;
          jetY = h / 2 + Math.sin(t * 2) * 20;
          steer = Math.cos(t * 2) * 0.6;
        } else if (item.id === 'heavy') {
          // Armored Strike Jet: taking hits & deflecting shrapnel
          jetX = w / 2 + Math.sin(t * 0.8) * 15;
          jetY = h / 2;
          jetA = 0;
          if (Math.random() < 0.15) {
            for (let s = 0; s < 4; s++) {
              const ang = Math.random() * Math.PI * 2;
              simSparks.push({ x: jetX + (Math.random() - 0.5) * 20, y: jetY + (Math.random() - 0.5) * 10, vx: Math.cos(ang) * 90, vy: Math.sin(ang) * 90, life: 0.22, maxL: 0.22 });
            }
          }
        }

        drawFighter(ctx, pal, {
          x: jetX, y: jetY, a: jetA, S: item.scale * 1.1, t,
          ink: pal.light, burn: 0.65, steer, rec: 0, gun: 'mg', hull: item.id,
        });

      } else if (category === 'engine') {
        // Propulsion: thrust & acceleration demo
        let burn = 0.5;
        let jetX = 100;
        let jetY = h / 2;
        let jetA = 0;

        if (item.id === 'turbo') {
          // Ramjet: high speed dash with sonic boom rings
          burn = 1.0;
          jetX = 80 + ((t * 180) % (w - 120));
          if (Math.random() < 0.12) {
            simRings.push({ x: jetX - 22, y: jetY, r: 8, maxR: 44, life: 0.38, maxL: 0.38 });
          }
        } else if (item.id === 'glider') {
          // High-Lift Delta: smooth soaring high altitude
          burn = 0.25;
          jetX = w / 2 + Math.sin(t * 0.9) * 40;
          jetY = h / 2 - 15 + Math.sin(t * 1.4) * 10;
          jetA = Math.cos(t * 1.4) * 0.12;
        } else {
          // Standard Afterburning Turbofan
          burn = 0.7;
          jetX = 85 + ((t * 80) % (w - 140));
          jetY = h / 2;
        }

        drawFighter(ctx, pal, {
          x: jetX, y: jetY, a: jetA, S: 1.1, t,
          ink: pal.light, burn, steer: 0, rec: 0, gun: 'mg', hull: 'std',
        });
      }

      // Update & draw shock rings
      for (let i = simRings.length - 1; i >= 0; i--) {
        const r = simRings[i];
        r.life -= dt;
        const progress = 1 - r.life / r.maxL;
        const curR = r.r + (r.maxR - r.r) * progress;
        ctx.strokeStyle = pal.hot;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = Math.max(0, r.life / r.maxL);
        ctx.beginPath();
        ctx.arc(r.x, r.y, curR, 0, Math.PI * 2);
        ctx.stroke();
        if (r.life <= 0) simRings.splice(i, 1);
      }

      // Update & draw sparks
      for (let i = simSparks.length - 1; i >= 0; i--) {
        const s = simSparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        ctx.fillStyle = pal.hot;
        ctx.globalAlpha = Math.max(0, s.life / s.maxL);
        ctx.fillRect(s.x, s.y, 2, 2);
        if (s.life <= 0) simSparks.splice(i, 1);
      }

      // ── HUD Broadcast Overlay: Valorant-style Telemetry ──
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold 9px "Share Tech Mono", monospace';
      ctx.fillStyle = pal.hot;
      ctx.textAlign = 'left';
      ctx.fillText(`REC ● [00:${String(Math.floor(t * 2.5) % 60).padStart(2, '0')}:88]`, 12, 18);

      ctx.fillStyle = pal.light;
      ctx.textAlign = 'right';
      ctx.fillText('LIVE TACTICAL EVALUATION // 60 FPS', w - 12, 18);

      // System Tagline banner at bottom
      ctx.textAlign = 'center';
      ctx.font = 'bold 10px "Chakra Petch", sans-serif';
      ctx.fillStyle = pal.light;
      ctx.fillText(item.name.toUpperCase(), w / 2, h - 14);

      ctx.font = '8px "Share Tech Mono", monospace';
      ctx.fillStyle = pal.hot;
      ctx.fillText(item.desc.toUpperCase(), w / 2, h - 4);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [item, category, pal]);

  // ── Stat Delta Comparison Logic ──
  const getStats = (it) => {
    if (category === 'gun') {
      return [
        { label: 'DPS (KINETIC)', val: Math.round(it.rate * it.dmg * it.shots), unit: 'PTS' },
        { label: 'VELOCITY', val: it.speed, unit: 'M/S' },
        { label: 'RECOIL KICK', val: Math.round(it.recoil * it.rate), unit: 'KN' },
      ];
    }
    if (category === 'hull') {
      return [
        { label: 'ARMOR INTEGRITY', val: it.hp, unit: 'HP' },
        { label: 'TURN RATE', val: it.turn.toFixed(1), unit: 'R/S' },
        { label: 'RADAR PROFILE', val: Math.round(it.scale * 100), unit: '%' },
      ];
    }
    return [
      { label: 'MAX THRUST', val: it.thrust, unit: 'KN' },
      { label: 'WING LIFT', val: (it.lift * 100).toFixed(0), unit: '%' },
      { label: 'TOP AIRSPEED', val: it.maxSpeed, unit: 'PX/S' },
    ];
  };

  const previewStats = getStats(item);
  const currentStats = getStats(currentItem);

  return (
    <div className="eval-window">
      <div className="eval-monitor">
        <canvas ref={canvasRef} width={380} height={214} className="eval-canvas" />
        <div className="eval-scanlines" />
      </div>

      <div className="eval-body">
        <div className="eval-header">
          <div>
            <span className="eval-tag">SYSTEM UPGRADE // {category.toUpperCase()}</span>
            <h3 className="eval-title">{item.name}</h3>
          </div>
          {isEquipped ? (
            <span className="badge-equipped">EQUIPPED</span>
          ) : (
            <button className="btn-equip" onClick={() => onEquip(item.id)}>
              EQUIP SYSTEM
            </button>
          )}
        </div>

        <p className="eval-desc">{item.desc}</p>

        {/* Side-by-Side Stat Matrix with Deltas */}
        <div className="eval-stats">
          {previewStats.map((st, i) => {
            const curVal = Number(currentStats[i]?.val) || 0;
            const newVal = Number(st.val) || 0;
            const diff = newVal - curVal;
            const isBetter = diff > 0;
            const isWorse = diff < 0;

            return (
              <div key={st.label} className="eval-stat-row">
                <span className="eval-stat-label">{st.label}</span>
                <span className="eval-stat-val">
                  <b>{st.val}</b> <small>{st.unit}</small>
                </span>
                {!isEquipped && (
                  <span className={`eval-delta ${isBetter ? 'up' : isWorse ? 'down' : 'same'}`}>
                    {diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '='}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
