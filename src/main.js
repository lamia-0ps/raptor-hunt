import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { World } from './World.js';
import { Player } from './Player.js';
import { Dinosaur } from './Dinosaur.js';
import { UI, Input } from './UI.js';

/* ------------------------------------------------------------------
 * Tunables
 * ------------------------------------------------------------------ */
const WAVES_TO_WIN = 5;  // raptors defeated for victory
const BODY_DAMAGE = 34;   // per bullet to the body (head ×2.5 in Dinosaur)
const SPAWN_MIN = 45;     // dino spawn ring: metres from origin
const SPAWN_MAX = 75;

/* ------------------------------------------------------------------
 * Renderer / scene / camera
 * ------------------------------------------------------------------ */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR for mobile fill-rate
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);

/* ------------------------------------------------------------------
 * Physics
 * ------------------------------------------------------------------ */
const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
physics.broadphase = new CANNON.SAPBroadphase(physics);
physics.allowSleep = false;

/* ------------------------------------------------------------------
 * Game objects
 * ------------------------------------------------------------------ */
const world = new World(scene, physics); // terrain, props, lights, sky, colliders
const ui = new UI();                     // HUD + screens
const input = new Input();               // sticks, buttons, keyboard, mouse
const player = new Player({ scene, camera, physics, input });

let state = 'menu'; // 'menu' | 'playing' | 'over'
let dino = null;
let score = 0;
let wave = 1;
let respawnTimer = 0; // > 0 while waiting to spawn the next wave

/* Bullet impact rules live in one place, so damage tuning is easy. */
player.onImpact = (hit) => {
  const part = hit.object.userData.part;
  if (!dino || !dino.alive || (part !== 'head' && part !== 'body')) return;
  const res = dino.takeDamage(BODY_DAMAGE, part === 'head');
  if (res.killed) {
    score += 1;
    ui.score(score);
    ui.hideDinoHealth();
    respawnTimer = 2.5; // brief pause while the corpse keels over
  } else {
    ui.dinoHealth(dino.health / dino.maxHealth);
  }
};

/* The player got mauled — update the health bar and flash the vignette. */
player.onDamaged = () => {
  ui.health(player.health / player.maxHealth);
  ui.damageFlash();
};

/** Remove the previous raptor (if any) and spawn a fresh one for `n`. */
function spawnWave(n) {
  if (dino) scene.remove(dino.group);
  const a = Math.random() * Math.PI * 2;
  const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
  dino = new Dinosaur(scene, new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), n);
  player.targets = [...world.colliders, dino.group]; // raycast targets
  ui.wave(n);
  ui.hideDinoHealth();
  ui.banner(n === WAVES_TO_WIN ? 'FINAL WAVE' : 'WAVE ' + n);
}

function startGame() {
  state = 'playing';
  score = 0;
  wave = 1;
  player.reset();
  ui.score(0);
  ui.health(1);
  ui.ammo(player.magSize, player.magSize, false);
  ui.begin();
  spawnWave(1);
}

function gameOver(win) {
  state = 'over';
  input.firing = false;
  ui.end(win, score, wave);
}

ui.bind({ onStart: startGame, onRestart: startGame });

/* ------------------------------------------------------------------
 * Simulation step
 * ------------------------------------------------------------------ */
function update(dt) {
  if (state !== 'playing') return;

  physics.step(1 / 60, dt, 3); // fixed step with up to 3 substeps
  player.update(dt);
  ui.ammo(player.ammo, player.magSize, player.reloading);

  if (dino) {
    // The raptor AI thinks in 2D on the ground plane
    const playerPos = new THREE.Vector3(player.body.position.x, 0, player.body.position.z);
    dino.update(dt, playerPos, (dmg) => player.takeDamage(dmg));
    dino.pushAway(player.body);

    if (!dino.alive && respawnTimer > 0) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        if (score >= WAVES_TO_WIN) gameOver(true);
        else spawnWave((wave += 1));
      }
    }
  }

  if (player.health <= 0) gameOver(false);
}

/* ------------------------------------------------------------------
 * Render loop + resize / orientation handling
 * ------------------------------------------------------------------ */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  update(Math.min(clock.getDelta(), 0.05)); // clamp dt against tab-switch spikes
  renderer.render(scene, camera);
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
