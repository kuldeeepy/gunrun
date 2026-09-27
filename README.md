# Gunrun

A modern, browser-playable run-and-gun inspired by the late-80s/90s classics — 2.5D low-poly jungle, 8-way aiming, weapon pickups, exploding bridges and a dragon boss.

**Play:** `npm install && npm run dev` → http://localhost:5173

## Controls

| Key | Action |
|---|---|
| ← → / A D | Run (hold to build up to a sprint) |
| ↑ / W | Aim up · with ← → aims diagonally up |
| ↓ / S | Lie down (standing still) · with ← → run and shoot diagonally down · aim down in the air |
| Z / Space | Jump (hold for higher) · ↓ + Jump drops through ledges |
| X / J | Fire (hold) |
| C / Shift | Aim-lock: plant your feet and aim 8 ways |
| V | Swap between your two guns |
| Esc | Pause |

Pickups: **A** auto-fire · **F** 5-way fan · **P** piercing plasma · **B** 10 s barrier. Gamepads work too.

## What's in it

- Fixed 60 Hz deterministic simulation, rendered with interpolation (smooth on 120/144 Hz screens)
- Game feel from the research: hitstop, trauma-based screen shake, coyote time, jump buffering, readable enemy bullets
- Reward loop: combo multiplier with rising pitch, merged score popups, animated rank tally with an honest "next rank" tip
- 8 playable characters, Day / Dusk / Night lighting
- Procedural sound effects and chiptune music (Web Audio, no audio files)

## Code layout

```
src/sim/      deterministic game logic (no rendering, no DOM) — World, tiles, weapons
src/core/     singletons shared by renderers: Input, Audio, Fx (screen shake), Settings
src/three/    2.5D renderer (Three.js + postprocessing): Stage3D, characters, main loop + HUD
src/scenes/   original 2D pixel renderer (Phaser 4) — served at /classic.html
src/levels/   stage layouts as text grids
tools/        asset scripts (Python) + in-browser dev checks (bot.js, aimtest.js, poses.js)
raw/          source art the tools build from
```

Dev checks (dev server only): `await import('/tools/bot.js'); bot.run(1500)` plays the stage and logs deaths/stalls/frame spikes; `aimtest.js` verifies the barrel matches bullet direction; `poses.js` renders a gallery of every aim pose.

## Build

```
npm run build   # type-checks, then builds both pages into dist/
```

## Credits

See [CREDITS.md](CREDITS.md). Art is CC0 / CC-BY; sound and music are generated in code.
