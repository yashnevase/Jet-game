import './App.css';
import jet from './asset/jet.svg';
import { useEffect, useState, useRef } from 'react';

// Player Jet Component
function Jet({ position, shieldActive }) {
  return (
    <div className="Jet" style={{ left: `${position}%` }}>
      {shieldActive && <div className="shield-effect" />}
      <img src={jet} alt="Jet" />
    </div>
  );
}

// Enemy Component
function Enemy({ x, y }) {
  return (
    <div className="Enemy" style={{ left: `${x}%`, top: `${y}px` }}>
      <img src={jet} alt="Enemy Jet" />
    </div>
  );
}

// Player Bullet Component
function Bullet({ x, y, powered }) {
  return (
    <div 
      className={powered ? "Bullet powered" : "Bullet"}
      style={{ 
        left: `${x}%`, 
        top: `${y}px`,
        width: powered ? '12px' : '4px',
        height: powered ? '25px' : '15px'
      }}
    />
  );
}

// Enemy Bullet Component
function EnemyBullet({ x, y }) {
  return (
    <div className="EnemyBullet" style={{ left: `${x}%`, top: `${y}px` }} />
  );
}

// Power-up Components
function HeartPowerUp({ x, y }) {
  return (
    <div className="PowerUp heart" style={{ left: `${x}%`, top: `${y}px` }}>
      ❤️
    </div>
  );
}

function ShieldPowerUp({ x, y }) {
  return (
    <div className="PowerUp shield" style={{ left: `${x}%`, top: `${y}px` }}>
      🛡️
    </div>
  );
}

function AmmoPowerUp({ x, y }) {
  return (
    <div className="PowerUp ammo" style={{ left: `${x}%`, top: `${y}px` }}>
      ⚡
    </div>
  );
}

// Explosion Component
function Explosion({ x, y }) {
  return (
    <div className="Explosion" style={{ left: `${x}%`, top: `${y}px` }}>
      <div className="explosion-inner" />
    </div>
  );
}

// HUD Component
function HUD({ score, health, difficulty, shieldActive, ammoActive }) {
  return (
    <div className="HUD">
      <div className="hud-top">
        <div className="hud-left">
          <div>SCORE: {score}</div>
          <div className="level-indicator">Level: {difficulty}</div>
        </div>
        <div className="hud-right">
          HEALTH: 
          <div className="health-bar-container">
            <div 
              className="health-bar-fill"
              style={{
                width: `${health}%`,
                backgroundColor: health > 50 ? '#00ff00' : health > 25 ? '#ffff00' : '#ff0000'
              }} 
            />
          </div>
        </div>
      </div>
      {(shieldActive || ammoActive) && (
        <div className="powerup-status">
          {shieldActive && <span>🛡️ SHIELD ACTIVE </span>}
          {ammoActive && <span>⚡ POWER AMMO </span>}
        </div>
      )}
    </div>
  );
}

// Mobile Controls
function MobileControls({ onLeft, onRight, onLeftRelease, onRightRelease }) {
  return (
    <div className="mobile-controls">
      <button
        className="control-button left"
        onTouchStart={onLeft}
        onTouchEnd={onLeftRelease}
        onMouseDown={onLeft}
        onMouseUp={onLeftRelease}
        onMouseLeave={onLeftRelease}
      >
        ◀
      </button>
      <button
        className="control-button right"
        onTouchStart={onRight}
        onTouchEnd={onRightRelease}
        onMouseDown={onRight}
        onMouseUp={onRightRelease}
        onMouseLeave={onRightRelease}
      >
        ▶
      </button>
    </div>
  );
}

// Game Over Screen
function GameOverScreen({ score, highScore, onRestart }) {
  return (
    <div className="game-over-screen">
      <h1 className="game-over-title">GAME OVER</h1>
      <p className="final-score">Final Score: {score}</p>
      <p className="high-score">High Score: {highScore}</p>
      <button className="restart-button" onClick={onRestart}>RESTART</button>
    </div>
  );
}

function App() {
  const [jetPosition, setJetPosition] = useState(50);
  const [bullets, setBullets] = useState([]);
  const [enemies, setEnemies] = useState([]);
  const [enemyBullets, setEnemyBullets] = useState([]);
  const [explosions, setExplosions] = useState([]);
  const [powerUps, setPowerUps] = useState([]);
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(100);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const [shieldActive, setShieldActive] = useState(false);
  const [ammoActive, setAmmoActive] = useState(false);
  
  const keysPressed = useRef({ left: false, right: false });
  const animationFrameRef = useRef(null);
  const lastShotTime = useRef(0);
  const lastEnemySpawn = useRef(0);
  const lastPowerUpSpawn = useRef(0);
  const gameTimeRef = useRef(0);
  const jetVelocity = useRef(0);
  const containerRef = useRef(null);
  const shieldTimeoutRef = useRef(null);
  const ammoTimeoutRef = useRef(null);
  const lastFrameTime = useRef(0);

  const CONTAINER_HEIGHT = 750;
  const MAX_BULLETS = 15;
  const MAX_ENEMIES = 8;
  const MAX_ENEMY_BULLETS = 10;

  const getDifficultyLevel = () => {
    return Math.floor(gameTimeRef.current / 10000) + 1;
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') keysPressed.current.left = true;
      if (e.key === 'ArrowRight') keysPressed.current.right = true;
      if ((e.key === ' ' || e.key === 'Enter') && !gameStarted) {
        e.preventDefault();
        setGameStarted(true);
        setGameOver(false);
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'ArrowLeft') keysPressed.current.left = false;
      if (e.key === 'ArrowRight') keysPressed.current.right = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameStarted]);

  // Mobile control handlers
  const handleLeftPress = () => { keysPressed.current.left = true; };
  const handleLeftRelease = () => { keysPressed.current.left = false; };
  const handleRightPress = () => { keysPressed.current.right = true; };
  const handleRightRelease = () => { keysPressed.current.right = false; };

  // Collision detection
  const checkCollision = (x1Percent, y1, w1, h1, x2Percent, y2, w2, h2) => {
    if (!containerRef.current) return false;
    const containerWidth = containerRef.current.offsetWidth;
    
    const x1 = (x1Percent / 100) * containerWidth - w1 / 2;
    const x2 = (x2Percent / 100) * containerWidth - w2 / 2;
    
    return (
      x1 < x2 + w2 &&
      x1 + w1 > x2 &&
      y1 < y2 + h2 &&
      y1 + h1 > y2
    );
  };

  // Optimized collision checking
  const checkAllCollisions = () => {
    // Check bullet-enemy collisions
    setBullets((prevBullets) => {
      const toRemoveBullets = new Set();
      const toRemoveEnemies = new Set();
      const newExplosions = [];
      let scoreIncrease = 0;

      setEnemies((prevEnemies) => {
        prevBullets.forEach((bullet, bIndex) => {
          if (toRemoveBullets.has(bIndex)) return;
          
          for (let eIndex = 0; eIndex < prevEnemies.length; eIndex++) {
            if (toRemoveEnemies.has(eIndex)) continue;
            
            const enemy = prevEnemies[eIndex];
            const bulletSize = bullet.powered ? 12 : 4;
            const bulletHeight = bullet.powered ? 25 : 15;
            
            if (checkCollision(bullet.x, bullet.y, bulletSize, bulletHeight, enemy.x, enemy.y, 50, 50)) {
              toRemoveBullets.add(bIndex);
              
              if (bullet.powered || Math.random() > 0.1) {
                toRemoveEnemies.add(eIndex);
                newExplosions.push({
                  id: Date.now() + Math.random(),
                  x: enemy.x,
                  y: enemy.y
                });
                scoreIncrease += 100;
              }
              break;
            }
          }
        });

        if (newExplosions.length > 0) {
          setExplosions((prev) => [...prev, ...newExplosions]);
        }
        if (scoreIncrease > 0) {
          setScore((prev) => prev + scoreIncrease);
        }

        return prevEnemies.filter((_, i) => !toRemoveEnemies.has(i));
      });

      return prevBullets.filter((_, i) => !toRemoveBullets.has(i));
    });

    // Check power-up collisions
    setPowerUps((prevPowerUps) => {
      return prevPowerUps.filter((powerUp) => {
        if (checkCollision(powerUp.x, powerUp.y, 40, 40, jetPosition, CONTAINER_HEIGHT - 60, 50, 50)) {
          if (powerUp.type === 'heart') {
            setHealth(100);
          } else if (powerUp.type === 'shield') {
            setShieldActive(true);
            if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
            shieldTimeoutRef.current = setTimeout(() => setShieldActive(false), 7000);
          } else if (powerUp.type === 'ammo') {
            setAmmoActive(true);
            if (ammoTimeoutRef.current) clearTimeout(ammoTimeoutRef.current);
            ammoTimeoutRef.current = setTimeout(() => setAmmoActive(false), 7000);
          }
          return false;
        }
        return true;
      });
    });

    // Check collisions with player
    if (!shieldActive) {
      setEnemies((prevEnemies) => {
        return prevEnemies.filter((enemy) => {
          if (checkCollision(enemy.x, enemy.y, 50, 50, jetPosition, CONTAINER_HEIGHT - 60, 50, 50)) {
            setExplosions((prev) => [...prev, {
              id: Date.now() + Math.random(),
              x: enemy.x,
              y: enemy.y
            }]);
            setHealth((prev) => Math.max(0, prev - 20));
            return false;
          }
          return true;
        });
      });

      setEnemyBullets((prevBullets) => {
        return prevBullets.filter((bullet) => {
          if (checkCollision(bullet.x, bullet.y, 6, 6, jetPosition, CONTAINER_HEIGHT - 60, 50, 50)) {
            setHealth((prev) => Math.max(0, prev - 10));
            return false;
          }
          return true;
        });
      });
    } else {
      setEnemyBullets((prev) => 
        prev.filter((bullet) => 
          !checkCollision(bullet.x, bullet.y, 6, 6, jetPosition, CONTAINER_HEIGHT - 60, 50, 50)
        )
      );
      
      setEnemies((prev) => 
        prev.filter((enemy) => 
          !checkCollision(enemy.x, enemy.y, 50, 50, jetPosition, CONTAINER_HEIGHT - 60, 50, 50)
        )
      );
    }
  };

  // Game loop using requestAnimationFrame
  useEffect(() => {
    if (!gameStarted || gameOver) return;

    const gameLoop = (currentTime) => {
      // Throttle to ~60fps
      if (currentTime - lastFrameTime.current < 16) {
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return;
      }
      
      const deltaTime = currentTime - lastFrameTime.current;
      lastFrameTime.current = currentTime;
      
      gameTimeRef.current += deltaTime;
      const difficultyLevel = getDifficultyLevel();

      // Player movement
      setJetPosition((prev) => {
        const acceleration = 0.8;
        const maxSpeed = 2.5;
        const friction = 0.85;
        
        if (keysPressed.current.left) {
          jetVelocity.current -= acceleration;
        }
        if (keysPressed.current.right) {
          jetVelocity.current += acceleration;
        }
        
        if (!keysPressed.current.left && !keysPressed.current.right) {
          jetVelocity.current *= friction;
        }
        
        jetVelocity.current = Math.max(-maxSpeed, Math.min(maxSpeed, jetVelocity.current));
        
        let newPos = prev + jetVelocity.current;
        
        if (newPos < 5) {
          newPos = 5;
          jetVelocity.current = 0;
        } else if (newPos > 95) {
          newPos = 95;
          jetVelocity.current = 0;
        }
        
        return newPos;
      });

      // Auto-fire bullets with limit
      if (currentTime - lastShotTime.current > 200) {
        setBullets((prev) => {
          if (prev.length >= MAX_BULLETS) return prev;
          return [...prev, {
            id: Date.now(),
            x: jetPosition,
            y: CONTAINER_HEIGHT - 60,
            powered: ammoActive
          }];
        });
        lastShotTime.current = currentTime;
      }

      // Enemy spawn with limit
      const baseSpawnRate = 2000;
      const minSpawnRate = 800;
      const spawnRate = Math.max(minSpawnRate, baseSpawnRate - (difficultyLevel * 100));
      
      if (currentTime - lastEnemySpawn.current > spawnRate) {
        setEnemies((prev) => {
          if (prev.length >= MAX_ENEMIES) return prev;
          return [...prev, {
            id: Date.now(),
            x: Math.random() * 90 + 5,
            y: 0,
            lastShot: 0
          }];
        });
        lastEnemySpawn.current = currentTime;
      }

      // Power-up spawn
      const powerUpSpawnRate = 15000 + Math.random() * 10000;
      if (currentTime - lastPowerUpSpawn.current > powerUpSpawnRate && powerUps.length < 2) {
        const types = ['heart', 'shield', 'ammo'];
        const type = types[Math.floor(Math.random() * types.length)];
        
        setPowerUps((prev) => [...prev, {
          id: Date.now(),
          x: Math.random() * 90 + 5,
          y: 0,
          type: type
        }]);
        lastPowerUpSpawn.current = currentTime;
      }

      // Move bullets
      setBullets((prev) => 
        prev.filter((bullet) => bullet.y > 0)
          .map((bullet) => ({ ...bullet, y: bullet.y - 10 }))
      );

      // Move enemies
      const baseEnemySpeed = 0.8;
      const enemySpeed = baseEnemySpeed + (difficultyLevel * 0.15);
      const baseShootInterval = 4000;
      const minShootInterval = 1500;
      const shootInterval = Math.max(minShootInterval, baseShootInterval - (difficultyLevel * 200));
      const shootChance = 0.98;
      
      setEnemies((prev) => 
        prev.filter((enemy) => enemy.y < CONTAINER_HEIGHT)
          .map((enemy) => {
            const newEnemy = { ...enemy, y: enemy.y + enemySpeed };
            
            if (currentTime - enemy.lastShot > shootInterval && Math.random() > shootChance) {
              setEnemyBullets((prevBullets) => {
                if (prevBullets.length >= MAX_ENEMY_BULLETS) return prevBullets;
                return [...prevBullets, {
                  id: Date.now() + Math.random(),
                  x: enemy.x,
                  y: enemy.y + 50
                }];
              });
              newEnemy.lastShot = currentTime;
            }
            
            return newEnemy;
          })
      );

      // Move power-ups
      setPowerUps((prev) => 
        prev.filter((powerUp) => powerUp.y < CONTAINER_HEIGHT)
          .map((powerUp) => ({ ...powerUp, y: powerUp.y + 2 }))
      );

      // Move enemy bullets
      setEnemyBullets((prev) => 
        prev.filter((bullet) => bullet.y < CONTAINER_HEIGHT)
          .map((bullet) => ({ ...bullet, y: bullet.y + 4 }))
      );

      // Check all collisions
      checkAllCollisions();

      // Remove old explosions
      setExplosions((prev) => prev.filter((exp) => currentTime - exp.id < 300));

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameStarted, gameOver, jetPosition, shieldActive, ammoActive, powerUps.length]);

  // Check game over
  useEffect(() => {
    if (health <= 0 && !gameOver) {
      setGameOver(true);
      setGameStarted(false);
      if (score > highScore) {
        setHighScore(score);
      }
    }
  }, [health, gameOver, score, highScore]);

  // Restart game
  const handleRestart = () => {
    setJetPosition(50);
    setBullets([]);
    setEnemies([]);
    setEnemyBullets([]);
    setExplosions([]);
    setPowerUps([]);
    setScore(0);
    setHealth(100);
    setGameOver(false);
    setGameStarted(true);
    setShieldActive(false);
    setAmmoActive(false);
    gameTimeRef.current = 0;
    lastShotTime.current = 0;
    lastEnemySpawn.current = 0;
    lastPowerUpSpawn.current = 0;
    jetVelocity.current = 0;
    lastFrameTime.current = 0;
    if (shieldTimeoutRef.current) clearTimeout(shieldTimeoutRef.current);
    if (ammoTimeoutRef.current) clearTimeout(ammoTimeoutRef.current);
  };

  const handleStart = () => {
    setGameStarted(true);
    setGameOver(false);
  };

  return (
    <div className="Box">
      <div className="Container" ref={containerRef}>
        <HUD 
          score={score} 
          health={health} 
          difficulty={getDifficultyLevel()} 
          shieldActive={shieldActive}
          ammoActive={ammoActive}
        />
        
        {!gameStarted && !gameOver && (
          <div className="start-screen">
            <h1 className="game-title">SKYFIGHTER</h1>
            <p className="controls-text">Use ← → Arrow Keys or Touch Buttons</p>
            <p className="game-info">
              • Difficulty increases every 10 seconds<br/>
              • Collect ❤️ for health, 🛡️ for shield, ⚡ for power<br/>
              • How long can you survive?
            </p>
            <button className="start-button" onClick={handleStart}>
              START GAME
            </button>
          </div>
        )}

        {gameOver && <GameOverScreen score={score} highScore={highScore} onRestart={handleRestart} />}

        {gameStarted && !gameOver && (
          <MobileControls 
            onLeft={handleLeftPress}
            onRight={handleRightPress}
            onLeftRelease={handleLeftRelease}
            onRightRelease={handleRightRelease}
          />
        )}

        <Jet position={jetPosition} shieldActive={shieldActive} />
        
        {bullets.map((bullet) => (
          <Bullet key={bullet.id} x={bullet.x} y={bullet.y} powered={bullet.powered} />
        ))}
        
        {enemies.map((enemy) => (
          <Enemy key={enemy.id} x={enemy.x} y={enemy.y} />
        ))}
        
        {enemyBullets.map((bullet) => (
          <EnemyBullet key={bullet.id} x={bullet.x} y={bullet.y} />
        ))}
        
        {powerUps.map((powerUp) => {
          if (powerUp.type === 'heart') {
            return <HeartPowerUp key={powerUp.id} x={powerUp.x} y={powerUp.y} />;
          } else if (powerUp.type === 'shield') {
            return <ShieldPowerUp key={powerUp.id} x={powerUp.x} y={powerUp.y} />;
          } else if (powerUp.type === 'ammo') {
            return <AmmoPowerUp key={powerUp.id} x={powerUp.x} y={powerUp.y} />;
          }
          return null;
        })}
        
        {explosions.map((exp) => (
          <Explosion key={exp.id} x={exp.x} y={exp.y} />
        ))}
      </div>
    </div>
  );
}

export default App;