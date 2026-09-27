import Phaser from 'phaser';

import { BTN } from '../sim/buttons';
export { BTN };

export class Input {
  private static instance: Input;
  static get(): Input {
    return (Input.instance ??= new Input());
  }
  private constructor() {}

  private keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private dom = new Set<string>(); // key codes held, when running without Phaser (3D renderer)
  private padActive = false;        // ignore a connected pad until a button is pressed (stick drift = phantom input)
  private gamepads: Phaser.Input.Gamepad.GamepadPlugin | null = null;
  held = 0;
  prev = 0;

  bind(scene: Phaser.Scene) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = scene.input.keyboard!.addKeys({
      left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN,
      a: K.A, d: K.D, w: K.W, s: K.S,
      jump: K.Z, jump2: K.SPACE, fire: K.X, fire2: K.J, lock: K.C, lock2: K.SHIFT, swap: K.V,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.gamepads = scene.input.gamepad ?? null;
    this.held = this.prev = 0;

    // Keys go "stuck down" when focus leaves mid-press (Cmd+Shift screenshot, tab switch): the keyup never arrives.
    // macOS also drops keyups for keys released while Cmd is held. Clear everything on blur/hide and on Cmd release.
    const kb = scene.input.keyboard!;
    const reset = () => { kb.resetKeys(); this.held = this.prev = 0; };
    scene.game.events.on(Phaser.Core.Events.BLUR, reset);
    scene.game.events.on(Phaser.Core.Events.HIDDEN, reset);
    kb.on('keyup-META', reset);
    kb.on('keydown-META', reset);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.game.events.off(Phaser.Core.Events.BLUR, reset);
      scene.game.events.off(Phaser.Core.Events.HIDDEN, reset);
    });
  }

  // Plain-DOM binding for the Three.js renderer (same keys and pad layout as the Phaser path).
  bindDom() {
    this.keys = null; this.gamepads = null;
    const reset = () => { this.dom.clear(); this.held = this.prev = 0; };
    window.addEventListener('keydown', (e) => { if (e.key === 'Meta') reset(); else this.dom.add(e.code); });
    window.addEventListener('keyup', (e) => { if (e.key === 'Meta') reset(); else this.dom.delete(e.code); });
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  }

  // Called once per fixed step.
  poll() {
    this.prev = this.held;
    let m = 0;
    const k = this.keys, d = this.dom;
    const on = (phaser: string[], codes: string[]) => (k ? phaser.some((n) => k[n].isDown) : codes.some((c) => d.has(c)));
    if (on(['left', 'a'], ['ArrowLeft', 'KeyA'])) m |= BTN.LEFT;
    if (on(['right', 'd'], ['ArrowRight', 'KeyD'])) m |= BTN.RIGHT;
    if (on(['up', 'w'], ['ArrowUp', 'KeyW'])) m |= BTN.UP;
    if (on(['down', 's'], ['ArrowDown', 'KeyS'])) m |= BTN.DOWN;
    if (on(['jump', 'jump2'], ['KeyZ', 'Space'])) m |= BTN.JUMP;
    if (on(['fire', 'fire2'], ['KeyX', 'KeyJ'])) m |= BTN.FIRE;
    if (on(['lock', 'lock2'], ['KeyC', 'ShiftLeft', 'ShiftRight'])) m |= BTN.LOCK;
    if (on(['swap'], ['KeyV'])) m |= BTN.SWAP;

    const p = this.gamepads?.pad1;
    if (p) {
      const x = p.leftStick.x, y = p.leftStick.y, dz = 0.35;
      if (x < -dz || p.left) m |= BTN.LEFT;
      if (x > dz || p.right) m |= BTN.RIGHT;
      if (y < -dz || p.up) m |= BTN.UP;
      if (y > dz || p.down) m |= BTN.DOWN;
      if (p.A) m |= BTN.JUMP;
      if (p.X || p.R2 > 0.3) m |= BTN.FIRE;
      if (p.L1 || p.L2 > 0.3) m |= BTN.LOCK;
      if (p.Y) m |= BTN.SWAP;
    } else if (!k) {
      // Standard-mapping gamepad straight from the browser.
      const g = navigator.getGamepads?.().find((x) => x && x.mapping === 'standard');
      if (g && !this.padActive) this.padActive = g.buttons.some((b) => b.pressed);
      if (g && this.padActive) {
        const b = (i: number) => g.buttons[i]?.pressed, ax = g.axes[0] ?? 0, ay = g.axes[1] ?? 0, dz = 0.5;
        if (ax < -dz || b(14)) m |= BTN.LEFT;
        if (ax > dz || b(15)) m |= BTN.RIGHT;
        if (ay < -dz || b(12)) m |= BTN.UP;
        if (ay > dz || b(13)) m |= BTN.DOWN;
        if (b(0)) m |= BTN.JUMP;
        if (b(2) || b(7)) m |= BTN.FIRE;
        if (b(4) || b(6)) m |= BTN.LOCK;
        if (b(3)) m |= BTN.SWAP;
      }
    }
    this.held = m;
  }

  down(b: number) { return (this.held & b) !== 0; }
  pressed(b: number) { return (this.held & b) !== 0 && (this.prev & b) === 0; }
}
