/*
 * UI: HUD updates, start/end screens, and Input — the unified touch,
 * button, keyboard and mouse layer. Nothing here contains game rules;
 * the Player consumes the input each frame.
 */

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.startScreen = $('start-screen');
    this.endScreen = $('end-screen');
    this.hud = $('hud');
    this.controls = $('controls');
    this.healthBar = $('health-bar');
    this.ammoEl = $('ammo');
    this.scoreEl = $('score');
    this.waveEl = $('wave');
    this.dinoWrap = $('dino-health-wrap');
    this.dinoBar = $('dino-health-bar');
    this.endTitle = $('end-title');
    this.endSub = $('end-sub');
    this.bannerEl = $('banner');
    this.vignette = $('vignette');
  }

  bind({ onStart, onRestart }) {
    $('btn-start').addEventListener('click', onStart);
    $('btn-restart').addEventListener('click', onRestart);
  }

  begin() {
    this.startScreen.classList.add('hidden');
    this.endScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.controls.classList.remove('hidden');
  }

  end(win, score, wave) {
    this.hud.classList.add('hidden');
    this.controls.classList.add('hidden');
    this.hideDinoHealth();
    this.endTitle.textContent = win ? 'VICTORY' : 'GAME OVER';
    this.endSub.textContent = win
      ? `All ${score} raptors down — the jungle is yours.`
      : `Overrun on wave ${wave}. The pack remembers.`;
    this.endScreen.classList.remove('hidden');
  }

  health(frac) {
    this.healthBar.style.width = Math.max(0, frac) * 100 + '%';
    this.healthBar.classList.toggle('low', frac < 0.3);
  }

  ammo(n, mag, reloading) {
    this.ammoEl.textContent = reloading ? 'RELOADING…' : `${n} / ${mag}`;
    this.ammoEl.classList.toggle('empty', n === 0 && !reloading);
  }

  score(n) { this.scoreEl.textContent = n; }
  wave(n) { this.waveEl.textContent = n; }

  dinoHealth(frac) {
    this.dinoWrap.classList.remove('hidden');
    this.dinoBar.style.width = Math.max(0, frac) * 100 + '%';
  }
  hideDinoHealth() { this.dinoWrap.classList.add('hidden'); }

  banner(text) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => this.bannerEl.classList.remove('show'), 1500);
  }

  damageFlash() {
    this.vignette.classList.add('hit');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.vignette.classList.remove('hit'), 180);
  }
}

/**
 * Unified input: virtual joystick + buttons (touch/pen), keyboard and mouse.
 * Uses Pointer Events, so one code path covers fingers, styluses and mice.
 */
export class Input {
  constructor() {
    this.move = { x: 0, y: 0 }; // strafe / forward, -1..1
    this.look = { x: 0, y: 0 }; // accumulated look delta this frame (radians)
    this.firing = false;        // FIRE button held down
    this.keys = Object.create(null);
    this._jump = false;
    this._reload = false;
    this._tapFire = false;      // motionless tap on the look layer = one shot

    this._initKeyboard();
    this._initMoveStick();
    this._initLookZone();
    this._initButtons();
  }

  /** Movement vector merging joystick + WASD, clamped to unit length. */
  moveVector() {
    let x = this.move.x;
    let y = this.move.y;
    if (this.keys.KeyW || this.keys.ArrowUp) y += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) y -= 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  consumeLook() { const l = this.look; this.look = { x: 0, y: 0 }; return l; }
  consumeJump() { const v = this._jump; this._jump = false; return v; }
  consumeReload() { const v = this._reload; this._reload = false; return v; }
  consumeTapFire() { const v = this._tapFire; this._tapFire = false; return v; }

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') { this._jump = true; e.preventDefault(); }
      if (e.code === 'KeyR') this._reload = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this.firing = false;
    });
  }

  /* Left virtual joystick: analog strafe/forward. */
  _initMoveStick() {
    const zone = $('move-zone');
    const knob = $('move-stick');
    const R = 48; // max knob travel in CSS px
    let pid = null, cx = 0, cy = 0;

    zone.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      zone.setPointerCapture(pid);
      const r = zone.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(len, R);
      dx = (dx / len) * cl;
      dy = (dy / len) * cl;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = dx / R;
      this.move.y = -dy / R; // screen up = forward
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.move.x = 0;
      this.move.y = 0;
      knob.style.transform = 'translate(0, 0)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /* Full-screen look/aim layer: drag = look, motionless tap = fire. */
  _initLookZone() {
    const zone = $('look-zone');
    const SENS = 0.0042; // radians per CSS pixel
    let pid = null, lastX = 0, lastY = 0, moved = 0;

    zone.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      zone.setPointerCapture(pid);
      lastX = e.clientX;
      lastY = e.clientY;
      moved = 0;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.look.x += dx * SENS;
      this.look.y += dy * SENS;
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      if (moved < 8) this._tapFire = true; // a tap, not a drag → shoot
      pid = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /* FIRE (hold for auto-fire), JUMP and RELOAD buttons. */
  _initButtons() {
    const hold = (id, down, up) => {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        down();
      });
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    };
    hold('btn-fire', () => { this.firing = true; }, () => { this.firing = false; });
    hold('btn-jump', () => { this._jump = true; }, () => {});
    hold('btn-reload', () => { this._reload = true; }, () => {});
  }
}
