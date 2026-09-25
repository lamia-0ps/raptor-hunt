# 🦖 Raptor Hunt

A mobile-first **3D dinosaur hunting web game** built with Three.js and cannon-es. No build step is required — `index.html` + a CDN import map runs directly on GitHub Pages.

## Stack

| Layer | Choice |
| --- | --- |
| Rendering | Three.js 0.160 (ES modules via jsDelivr import map) |
| Physics | cannon-es 0.20 — player body, ground plane, prop & boundary colliders |
| Shooting | Hitscan raycasting (head shots deal 2.5× damage) |
| UI / controls | Pure HTML/CSS overlay — dual virtual sticks, action buttons, HUD |
| Bundler (optional) | Vite config included for local dev / offline bundling |

## Features

- **Procedural jungle world** — vertex-coloured low-poly ground, 70 trees, 30 rocks, gradient sky dome, sun + hemisphere lighting, distance fog
- **State-machine raptor AI** — `WANDER → ALERT → CHARGE → ATTACK` with per-wave stat scaling, hit flash, flinch and death animation
- **Mobile controls** — left joystick (move), full-screen drag (aim), FIRE / JUMP / RELOAD buttons; desktop fallback with WASD + mouse
- **Combat feel** — muzzle flash light, camera recoil, auto-reload on empty mag, damage vignette
- **Game loop** — 5 waves, player health, ammo counter, raptor kills, wave banners, victory / game-over screens with restart
- **Responsive** — resize + orientation handling, notch-safe (`viewport-fit=cover`), landscape recommended on phones

## File structure

```
index.html        Entry point: viewport meta, HUD/control overlays, import map
style.css         Touch UI layout, crosshair, HUD, screens, landscape hint
src/
  main.js         Game init, loop, physics step, wave logic, resize handlers
  Player.js       First-person camera rig, physics body, weapon & shooting
  Dinosaur.js     Procedural raptor model, animation, AI state machine
  World.js        Terrain, props, lighting, sky dome, fog, static colliders
  UI.js           HUD updates, screens + Input (sticks, buttons, keys)
package.json      Optional Vite dev setup
vite.config.js    Optional bundler config (relative base for Pages)
```

## Run locally

A static server is required (ES modules don't load from `file://`):

```bash
npx serve .          # or: python3 -m http.server 8000
```

Open `http://localhost:8000`.

Or with Vite (resolves the same bare imports from `node_modules`):

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. In the repository open **Settings → Pages**
2. Under **Build and deployment** set **Source: GitHub Actions**
3. Push to `main` (or run the included workflow manually)

The workflow (`.github/workflows/pages.yml`) uploads the repo root as-is — no build output needed.

## Controls

| Action | Touch | Desktop |
| --- | --- | --- |
| Move | Left joystick | WASD / arrow keys |
| Look / aim | Drag anywhere | Mouse drag |
| Fire | FIRE button (hold = auto) | Motionless click |
| Jump | JUMP button | Space |
| Reload | RELOAD button | R |

## Gameplay tips

- Head shots deal 2.5× damage — aim for the skull/jaw.
- The raptor pauses to roar when it first notices you: that's your free shot.
- Each wave brings more health and speed. Keep your distance while reloading.
