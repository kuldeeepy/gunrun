import Phaser from 'phaser';

// Screen shake (trauma², Eiserloh GDC 2016). Hitstop lives in the sim (World.freeze).
export class Fx {
  private static instance: Fx;
  static get(): Fx {
    return (Fx.instance ??= new Fx());
  }
  private constructor() {}

  trauma = 0;
  shakeScale = 1; // accessibility slider
  private t = 0;

  addTrauma(v: number) { this.trauma = Math.min(1, this.trauma + v); }

  // Per render frame: returns camera offset to apply on top of the follow position.
  shake(cam: Phaser.Cameras.Scene2D.Camera, dtMs: number) {
    this.t += dtMs / 1000;
    this.trauma = Math.max(0, this.trauma - dtMs / 1000 / 0.6);
    const s = this.trauma * this.trauma * this.shakeScale;
    const n = (seed: number) => Math.sin(this.t * 37 + seed) * 0.6 + Math.sin(this.t * 59 + seed * 3) * 0.4;
    cam.setScroll(cam.scrollX + 6 * s * n(1), cam.scrollY + 6 * s * n(2));
    cam.setRotation(0.03 * s * n(3));
  }
}
