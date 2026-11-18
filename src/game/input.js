// Keyboard + touch + gamepad merged into inputs: left, right, thrust, fire, missile, bomb.
const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyZ', 'KeyJ', 'KeyK',
  'KeyM', 'KeyX', 'KeyB', 'KeyC', 'KeyP', 'Escape',
]);

export class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.touch = { left: false, right: false, thrust: false, fire: false, missile: false, bomb: false };
    this.gp = { left: false, right: false, thrust: false, fire: false, missile: false, bomb: false };
    this.onDown = this.onDown.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
  }

  // Poll standard Gamepad API every frame
  pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    try {
      const gamepads = navigator.getGamepads();
      if (!gamepads) return;
      let pad = null;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i].connected) { pad = gamepads[i]; break; }
      }
      if (!pad) {
        this.gp.left = this.gp.right = this.gp.thrust = this.gp.fire = this.gp.missile = this.gp.bomb = false;
        return;
      }
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      const b = pad.buttons;
      // D-pad or left analog stick
      this.gp.left = ax < -0.3 || (b[14] && b[14].pressed);
      this.gp.right = ax > 0.3 || (b[15] && b[15].pressed);
      // Thrust: Up on stick/D-pad, or A button (b[0]), or Right Trigger (b[7])
      this.gp.thrust = ay < -0.3 || (b[12] && b[12].pressed) || (b[0] && b[0].pressed) || (b[7] && b[7].pressed);
      // Fire Cannon: X button (b[2]) or RB (b[5])
      this.gp.fire = (b[2] && b[2].pressed) || (b[5] && b[5].pressed);
      // Guided Homing Missile: Y button (b[3])
      this.gp.missile = (b[3] && b[3].pressed);
      // Bomb: B button (b[1]) or Left Bumper / Trigger (b[4] or b[6])
      this.gp.bomb = (b[1] && b[1].pressed) || (b[4] && b[4].pressed) || (b[6] && b[6].pressed);

      // Start / Menu: Pause toggle
      if (b[9] && b[9].pressed && !this._gpStartLast) {
        this.game.togglePause();
      }
      this._gpStartLast = !!(b[9] && b[9].pressed);
    } catch (_) {}
  }

  get left() { return !!(this.keys.ArrowLeft || this.keys.KeyA || this.touch.left || this.gp.left); }
  get right() { return !!(this.keys.ArrowRight || this.keys.KeyD || this.touch.right || this.gp.right); }
  get thrust() { return !!(this.keys.ArrowUp || this.keys.KeyW || this.touch.thrust || this.gp.thrust); }
  get fire() { return !!(this.keys.Space || this.keys.KeyZ || this.keys.KeyJ || this.touch.fire || this.gp.fire); }
  get missile() { return !!(this.keys.KeyM || this.keys.KeyX || this.touch.missile || this.gp.missile); }
  get bomb() { return !!(this.keys.KeyB || this.keys.KeyC || this.touch.bomb || this.gp.bomb); }

  attach() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }

  onDown(e) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys[e.code] = true;
    this.game.onKey(e.code);
  }
  onUp(e) { this.keys[e.code] = false; }
  onBlur() {
    this.keys = {};
    this.touch.left = this.touch.right = this.touch.thrust = this.touch.fire = this.touch.missile = this.touch.bomb = false;
    this.gp.left = this.gp.right = this.gp.thrust = this.gp.fire = this.gp.missile = this.gp.bomb = false;
    this.game.autoPause();
  }
}
