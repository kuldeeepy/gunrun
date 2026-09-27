import Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';
import { LevelScene } from './scenes/LevelScene';
import { World } from './sim/World';

// 640x360: exact 3x at 1080p, 4x at 1440p. 32px tiles = Contra's tile-to-hero ratio.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 640,
  height: 360,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { gamepad: true },
  scene: [TitleScene, LevelScene],
});

if (import.meta.env.DEV) Object.assign(window, { game, world: World.get() });
