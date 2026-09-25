import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * First-person player: physics body, camera rig, weapon and shooting.
 *
 * Movement is camera-relative and drives the cannon-es body velocity
 * directly for snappy mobile handling, while gravity, jumping and
 * collisions against the world stay fully in the physics engine.
 */
export class Player {
  /**
   * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera,
   *           physics: CANNON.World, input: import('./UI.js').Input }} opts
   */
  constructor({ scene, camera, physics, input }) {
    this.scene = scene;
    this.camera = camera;
    this.physics = physics;
    this.input = input;

    // Hooks wired by main.js (keeps game rules out of the controller)
    this.onImpact = null;   // (hit: THREE.Intersection) => void
    this.onDamaged = null; // () => void

    // Stats
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.magSize = 6;
    this.ammo = this.magSize;
    this.reloading = false;
    this.reloadTime = 1.4;   // seconds
    this.fireInterval = 0.35; // seconds between shots (hold to auto-fire)
    this.fireCooldown = 0;
    this.speed = 6.5;        // m/s ground speed
    this.jumpSpeed = 7.5;
    this.eyeHeight = 1.15;    // above body centre (body r = 0.5 → eye ≈ 1.65 m)

    // View state
    this.yaw = 0;
    this.pitch = 0;
    this.recoil = 0; // additive upward kick (radians), decays exponentially

    // Physics: sphere body sliding over the ground plane
    this.body = new CANNON.Body({
      mass: 75,
      shape: new CANNON.Sphere(0.5),
      position: new CANNON.Vec3(0, 1, 14),
      linearDamping: 0,
      material: new CANNON.Material({ friction: 0.0, restitution: 0 }),
    });
    this.body.allowSleep = false;
    physics.addBody(this.body);

    // Muzzle flash: brief point light + glowing blob at the gun
    this.flashLight = new THREE.PointLight(0xffc966, 0, 16);
    this.flashLight.position.set(0.28, -0.2, -0.6);
    camera.add(this.flashLight);

    this.flashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 })
    );
    this.flashMesh.position.set(0.28, -0.24, -0.9);
    camera.add(this.flashMesh);

    // The camera (and its weapon children) must be in the scene graph to render
    scene.add(camera);

    this.ray = new THREE.Raycaster();
    this.targets = []; // set by main.js: [...world.colliders, dino.group]
    this._reloadT = 0;
    this._flashT = 0;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ'); // yaw-then-pitch FPS order
  }

  /** Restore full state for a fresh game. */
  reset() {
    this.health = this.maxHealth;
    this.ammo = this.magSize;
    this.reloading = false;
    this.body.position.set(0, 1, 14);
    this.body.velocity.setZero();
    this.yaw = 0;
    this.pitch = 0;
    this.recoil = 0;
  }

  /** True while resting on the ground (body centre ≈ 0.5 m). */
  isGrounded() {
    return this.body.position.y <= 0.52;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.onDamaged) this.onDamaged();
  }

  update(dt) {
    /* ---- Look: right-stick drag / mouse drag ---- */
    const look = this.input.consumeLook();
    this.yaw -= look.x;
    this.pitch -= look.y;
    const lim = THREE.MathUtils.degToRad(80);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);

    /* ---- Move: camera-relative strafe/forward ---- */
    const mv = this.input.moveVector();
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward is -Z rotated by yaw; right is +X rotated by yaw.
    this.body.velocity.x = (cos * mv.x - sin * mv.y) * this.speed;
    this.body.velocity.z = (-sin * mv.x - cos * mv.y) * this.speed;

    if (this.input.consumeJump() && this.isGrounded()) {
      this.body.velocity.y = this.jumpSpeed;
    }

    /* ---- Reload ---- */
    if (this.reloading) {
      this._reloadT -= dt;
      if (this._reloadT <= 0) {
        this.reloading = false;
        this.ammo = this.magSize;
      }
    } else if (this.input.consumeReload() && this.ammo < this.magSize) {
      this.reloading = true;
      this._reloadT = this.reloadTime;
    }

    /* ---- Fire: FIRE button hold or motionless desktop tap ---- */
    this.fireCooldown -= dt;
    const tap = this.input.consumeTapFire();
    if ((this.input.firing || tap) && this.fireCooldown <= 0) {
      if (this.ammo > 0 && !this.reloading) {
        this.shoot();
      } else if (!this.reloading) {
        // Trigger pulled on an empty magazine → auto reload
        this.reloading = true;
        this._reloadT = this.reloadTime;
      }
    }

    /* ---- Camera follows the body; recoil kicks the pitch up ---- */
    this.recoil *= Math.pow(0.0005, dt); // fast exponential decay
    this._euler.set(this.pitch + this.recoil, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);
    this.camera.position.set(
      this.body.position.x,
      this.body.position.y + this.eyeHeight,
      this.body.position.z
    );
  }

  /** Hitscan shot from the screen centre. Impact handling is delegated
      to main.js via the `onImpact` hook. */
  shoot() {
    this.ammo -= 1;
    this.fireCooldown = this.fireInterval;
    this.recoil += 0.035; // ≈ 2° kick per shot

    // Muzzle flash for ~55 ms
    this.flashLight.intensity = 26;
    this.flashMesh.material.opacity = 1;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => {
      this.flashLight.intensity = 0;
      this.flashMesh.material.opacity = 0;
    }, 55);

    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.ray.intersectObjects(this.targets, true);
    const hit = hits.find((h) => h.distance > 0.8); // skip stuff hugging the camera
    if (hit && this.onImpact) this.onImpact(hit);
  }
}
