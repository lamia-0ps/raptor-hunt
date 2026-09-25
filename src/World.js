import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const WORLD_SIZE = 300; // metres, square arena
const WORLD_HALF = WORLD_SIZE / 2;

/**
 * The prehistoric jungle world: gradient sky dome, sun + hemisphere light,
 * fog, vertex-coloured ground, low-poly trees/rocks, and the static
 * cannon-es colliders (ground plane, prop boxes, arena boundary walls).
 *
 * Everything is low-poly and shared-material so it stays fast on mobile.
 */
export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {CANNON.World} physics
   */
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.colliders = []; // meshes/groups eligible for bullet raycasts

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildBoundary();
    this._scatterProps();
  }

  /* Two-tone gradient dome. Shader materials ignore fog on purpose,
     so the sky stays crisp behind the jungle haze. */
  _buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 16, 10),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          cTop: { value: new THREE.Color(0x7fb2e5) },
          cBottom: { value: new THREE.Color(0xd9e8c5) },
        },
        vertexShader:
          'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform vec3 cTop; uniform vec3 cBottom; varying vec3 vP;' +
          'void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);' +
          'gl_FragColor = vec4(mix(cBottom, cTop, pow(h, 0.8)), 1.0); }',
      })
    );
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xcfe0b8, 40, 230); // atmospheric jungle haze
  }

  /* Soft sky fill + one shadow-casting sun. */
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x54452e, 0.9));

    const sun = new THREE.DirectionalLight(0xfff1cf, 2.2);
    sun.position.set(60, 90, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // mobile-friendly shadow resolution
    const s = 70; // shadow frustum covers the main play area
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  /* Flat low-poly ground with vertex-colour mottling for cheap variation.
     Physics uses an infinite plane at y = 0 to match. */
  _buildGround() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 48, 48);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Color(0x69923f);
    const b = new THREE.Color(0x8fae54);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const n = Math.sin(pos.getX(i) * 0.15) * Math.cos(pos.getZ(i) * 0.13) * 0.5 + 0.5;
      c.copy(a).lerp(b, n * 0.7 + Math.random() * 0.3);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    this.scene.add(ground);

    const plane = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    plane.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physics.addBody(plane);
  }

  /* Four invisible walls keep the hunt inside the arena. */
  _buildBoundary() {
    const wall = (x, z, sx, sz) => {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(sx / 2, 6, sz / 2)),
        position: new CANNON.Vec3(x, 6, z),
      });
      this.physics.addBody(body);
    };
    const h = WORLD_HALF - 6;
    wall(0, -h, WORLD_SIZE, 4);
    wall(0, h, WORLD_SIZE, 4);
    wall(-h, 0, 4, WORLD_SIZE);
    wall(h, 0, 4, WORLD_SIZE);
  }

  /* Trees + rocks. Shared geometry/material keeps draw setup cheap;
     every prop gets a static box collider so bullets and the player bump into them. */
  _scatterProps() {
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.45, 3, 6);
    const leafGeo = new THREE.ConeGeometry(1.7, 3.4, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
    const leafMats = [
      new THREE.MeshLambertMaterial({ color: 0x3f7d2c }),
      new THREE.MeshLambertMaterial({ color: 0x2f6b24 }),
    ];
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8578, flatShading: true });

    const addTree = (x, z, s) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.5;
      const leaves = new THREE.Mesh(leafGeo, leafMats[Math.random() < 0.5 ? 0 : 1]);
      leaves.position.y = 4.4;
      trunk.castShadow = leaves.castShadow = true;
      g.add(trunk, leaves);
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      g.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(g);
      this.colliders.push(g);

      // Static trunk collider (box approximation of the cylinder)
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(0.4 * s, 2 * s, 0.4 * s)),
        position: new CANNON.Vec3(x, 2 * s, z),
      });
      this.physics.addBody(body);
    };

    const addRock = (x, z, s) => {
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(x, s * 0.35, z);
      m.scale.setScalar(s);
      m.rotation.set(Math.random() * 0.4, Math.random() * 6.3, Math.random() * 0.4);
      m.castShadow = true;
      this.scene.add(m);
      this.colliders.push(m);

      // Only big rocks block movement
      if (s > 0.9) {
        const body = new CANNON.Body({
          mass: 0,
          shape: new CANNON.Box(new CANNON.Vec3(s * 0.8, s * 0.7, s * 0.8)),
          position: new CANNON.Vec3(x, s * 0.7, z),
        });
        this.physics.addBody(body);
      }
    };

    // Random placement, keeping the player's spawn area clear
    const rand = () => {
      const ang = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * (WORLD_HALF - 26);
      return [Math.cos(ang) * r, Math.sin(ang) * r];
    };
    for (let i = 0; i < 70; i++) { const [x, z] = rand(); addTree(x, z, 0.8 + Math.random() * 1.3); }
    for (let i = 0; i < 30; i++) { const [x, z] = rand(); addRock(x, z, 0.5 + Math.random() * 1.2); }
  }
}
