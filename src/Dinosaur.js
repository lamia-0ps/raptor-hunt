import * as THREE from 'three';

/** AI states: WANDER → ALERT → CHARGE → ATTACK (loops) | DEAD (terminal). */
export const STATE = {
  WANDER: 'WANDER',
  ALERT: 'ALERT',
  CHARGE: 'CHARGE',
  ATTACK: 'ATTACK',
  DEAD: 'DEAD',
};

/**
 * A low-poly procedural raptor driven by a small state machine.
 * Built entirely from boxes so it stays cheap on mobile GPUs.
 * The model faces +Z, so yaw = atan2(dx, dz) aims it at a target.
 */
export class Dinosaur {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position spawn point (y assumed 0)
   * @param {number} wave difficulty scaler for health / speed
   */
  constructor(scene, position, wave = 1) {
    this.scene = scene;
    this.wave = wave;

    // Stats scale gently per wave
    this.maxHealth = 100 + (wave - 1) * 25;
    this.health = this.maxHealth;
    this.speed = 2.2 + wave * 0.15;     // wandering speed
    this.chargeSpeed = 6 + wave * 0.45; // attack run speed
    this.alertRadius = 34;             // WANDER → ALERT distance
    this.attackRange = 2.8;             // CHARGE → ATTACK distance

    this.alive = true;
    this.state = STATE.WANDER;
    this.stateTime = 0;
    this.attackCooldown = 0;
    this.deathTimer = 0;
    this._struck = false; // set once a lunge has landed its hit
    this._hitFlash = 0;

    this.wanderTarget = null;
    this.wanderTimer = 0;
    this.legPhase = 0;

    this.group = this._buildModel(wave);
    this.group.position.copy(position);
    scene.add(this.group);
  }

  /* ==================== model ==================== */

  _buildModel(wave) {
    const g = new THREE.Group();

    // Slight per-wave hue variation so each raptor feels unique
    const hue = 0.2 + ((wave * 0.03) % 0.08);
    const skin = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(hue, 0.45, 0.38),
    });
    const belly = new THREE.MeshLambertMaterial({ color: 0xcfc39a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3c4a22 });

    // Tags each mesh for hitscan damage routing (head vs body)
    const mark = (mesh, part) => { mesh.userData.part = part; return mesh; };

    const body = mark(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 2.4), skin), 'body');
    body.position.y = 1.4;
    const under = mark(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.8), belly), 'body');
    under.position.set(0, 0.95, 0.1);

    const neck = mark(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.6), skin), 'body');
    neck.position.set(0, 1.95, 1.25);
    neck.rotation.x = 0.35;

    // Head pivots at the neck top so it can bob during the roar
    this.headGroup = new THREE.Group();
    const skull = mark(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.1), skin), 'head');
    skull.position.set(0, 0.15, 0.5);
    const jaw = mark(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.95), dark), 'head');
    jaw.position.set(0, -0.12, 0.45);
    const eyeGeo = new THREE.SphereGeometry(0.07, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const eyeL = mark(new THREE.Mesh(eyeGeo, eyeMat), 'head');
    eyeL.position.set(-0.27, 0.22, 0.72);
    const eyeR = mark(new THREE.Mesh(eyeGeo, eyeMat), 'head');
    eyeR.position.set(0.27, 0.22, 0.72);
    this.headGroup.add(skull, jaw, eyeL, eyeR);
    this.headGroup.position.set(0, 2.35, 1.4);

    // Tail: three tapering segments pivoting at the hip
    this.tailGroup = new THREE.Group();
    const t1 = mark(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.2), skin), 'body');
    t1.position.z = -0.5;
    const t2 = mark(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1.1), dark), 'body');
    t2.position.z = -1.5;
    const t3 = mark(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.0), dark), 'body');
    t3.position.z = -2.4;
    this.tailGroup.add(t1, t2, t3);
    this.tailGroup.position.set(0, 1.5, -1.2);

    // Legs: pivot groups at the hips so rotation.x swings the whole limb
    const mkLeg = (side) => {
      const leg = new THREE.Group();
      const thigh = mark(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.5), skin), 'body');
      thigh.position.y = -0.35;
      const shin = mark(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.32), dark), 'body');
      shin.position.set(0, -0.8, 0.12);
      const foot = mark(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.55), dark), 'body');
      foot.position.set(0, -1.02, 0.18);
      leg.add(thigh, shin, foot);
      leg.position.set(0.45 * side, 0.95, -0.5);
      return leg;
    };
    this.legL = mkLeg(1);
    this.legR = mkLeg(-1);

    // Tiny raptor arms
    const mkArm = (side) => {
      const arm = mark(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.45, 0.14), dark), 'body');
      arm.position.set(0.55 * side, 1.35, 0.55);
      arm.rotation.x = -0.7;
      return arm;
    };

    g.add(body, under, neck, this.headGroup, this.tailGroup, this.legL, this.legR, mkArm(1), mkArm(-1));
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  /* ==================== AI ==================== */

  /**
   * Advance the state machine one frame.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos ground-plane player position
   * @param {(damage: number) => void} onAttack called when a lunge lands
   */
  update(dt, playerPos, onAttack) {
    this.stateTime += dt;
    const pos = this.group.position;
    const toPlayer = new THREE.Vector3().subVectors(playerPos, pos);
    const dist = toPlayer.length();

    switch (this.state) {
      case STATE.WANDER: {
        // Pick a fresh strolling target every few seconds
        this.wanderTimer -= dt;
        if (!this.wanderTarget || this.wanderTimer <= 0 || pos.distanceTo(this.wanderTarget) < 2) {
          const a = Math.random() * Math.PI * 2;
          const r = 20 + Math.random() * 80;
          this.wanderTarget = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
          this.wanderTimer = 4 + Math.random() * 4;
        }
        this._moveToward(this.wanderTarget, this.speed, dt);
        this._animateLegs(this.speed, dt);
        if (dist < this.alertRadius) this._enter(STATE.ALERT);
        break;
      }

      case STATE.ALERT: {
        // Freeze, face the player, roar-bob the head, then commit to the charge
        this._face(toPlayer, dt, 6);
        this._animateLegs(0, dt);
        this.headGroup.position.y = 2.35 + Math.abs(Math.sin(this.stateTime * 9)) * 0.12;
        if (this.stateTime > 0.9) {
          this.headGroup.position.y = 2.35;
          this._enter(STATE.CHARGE);
        }
        break;
      }

      case STATE.CHARGE: {
        this._moveToward(playerPos, this.chargeSpeed, dt);
        this.attackCooldown -= dt;
        if (dist < this.attackRange && this.attackCooldown <= 0) this._enter(STATE.ATTACK);
        if (dist > 70) this._enter(STATE.WANDER); // lost interest
        break;
      }

      case STATE.ATTACK: {
        this._face(toPlayer, dt, 10);
        if (this.stateTime < 0.25) {
          // Lunge toward the player
          const dir = toPlayer.clone().normalize();
          this.group.position.addScaledVector(dir, this.chargeSpeed * 1.3 * dt);
        } else if (this.stateTime < 0.45 && !this._struck && dist < 3.4) {
          // Strike lands once, mid-lunge
          this._struck = true;
          onAttack(12 + this.wave * 2);
        } else if (this.stateTime >= 0.45) {
          this.attackCooldown = 1.1; // brief breather between bites
          this._enter(STATE.CHARGE);
        }
        this._animateLegs(this.chargeSpeed, dt);
        break;
      }

      case STATE.DEAD: {
        // Keel over, then fade from the world
        this.deathTimer += dt;
        this.group.rotation.z = Math.min(1.5, this.deathTimer * 3);
        if (this.deathTimer > 2.5) this.group.visible = false;
        break;
      }
    }

    // Red damage flash fades back out
    if (this._hitFlash > 0) {
      this._hitFlash -= dt;
      if (this._hitFlash <= 0) this._setFlash(0);
    }
  }

  /** Apply bullet damage; head hits are multiplied by the caller. */
  takeDamage(amount, isHead) {
    if (!this.alive) return { killed: false };
    this.health -= isHead ? amount * 2.5 : amount;
    this._setFlash(0.55);
    this._hitFlash = 0.12;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this._enter(STATE.DEAD);
      return { killed: true };
    }
    // Shooting a raptor mid-stroll wakes it up immediately
    if (this.state === STATE.WANDER) this._enter(STATE.ALERT);
    return { killed: false };
  }

  /** Nudge the player out of overlap so the raptor can't stand inside them. */
  pushAway(playerBody) {
    if (!this.alive) return;
    const dx = playerBody.position.x - this.group.position.x;
    const dz = playerBody.position.z - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.7 && d > 0.001) {
      playerBody.velocity.x = (dx / d) * 7;
      playerBody.velocity.z = (dz / d) * 7;
    }
  }

  /* ==================== helpers ==================== */

  _enter(s) {
    this.state = s;
    this.stateTime = 0;
    this._struck = false;
  }

  _face(dir, dt, rate) {
    const target = Math.atan2(dir.x, dir.z); // model faces +Z
    let diff = target - this.group.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // wrap to [-PI, PI]
    this.group.rotation.y += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
  }

  _moveToward(target, speed, dt) {
    const dir = new THREE.Vector3().subVectors(target, this.group.position);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    this.group.position.addScaledVector(dir, speed * dt);
    this._face(dir, dt, 10);
  }

  _animateLegs(speed, dt) {
    this.legPhase += dt * (2 + speed * 1.6);
    const amp = Math.min(0.7, speed * 0.1);
    this.legL.rotation.x = Math.sin(this.legPhase) * amp;
    this.legR.rotation.x = Math.sin(this.legPhase + Math.PI) * amp;
    this.tailGroup.rotation.y = Math.sin(this.legPhase * 0.5) * 0.15;
  }

  _setFlash(v) {
    this.group.traverse((o) => {
      if (o.isMesh && o.material.emissive) {
        o.material.emissive.setRGB(v, v * 0.1, v * 0.05);
      }
    });
  }
}
