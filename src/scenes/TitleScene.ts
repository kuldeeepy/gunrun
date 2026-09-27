import Phaser from 'phaser';
import { Audio } from '../core/Audio';
import { Settings, SKINS, THEMES } from '../core/Settings';
import { toggleHelp } from './help';

export class TitleScene extends Phaser.Scene {
  private row = 0; // 0 = soldier, 1 = stage time
  private sky!: Phaser.GameObjects.Graphics;
  private hero!: Phaser.GameObjects.Image;
  private rows: Phaser.GameObjects.Text[] = [];
  private trees: Phaser.GameObjects.Image[] = [];

  constructor() { super('Title'); }

  preload() {
    const v = import.meta.env.DEV ? `?v=${Date.now()}` : ''; // dev: never serve a stale atlas after repacking
    this.load.atlas('atlas', `assets/atlas.png${v}`, `assets/atlas.json${v}`);
    const J = 'assets/jungle/';
    for (const n of ['ground_brown', 'wall_brown', 'bottom_brown', 'water', 'vegetation', 'bridge'])
      this.load.spritesheet(n, `${J}tile_jungle_${n}.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.image('tree_dark', `${J}tree_a.png`);
    this.load.image('tree_light', `${J}tree_b.png`);
    this.load.image('cloud1', `${J}bg_cloud6.png`);
    this.load.image('cloud2', `${J}bg_cloud01.png`);
    this.load.image('cloud3', `${J}bg_cloud2.png`);
  }

  create() {
    const { width: w, height: h } = this.scale;
    this.sky = this.add.graphics();
    this.trees = [
      this.add.image(w * 0.82, h + 10, 'tree_dark').setOrigin(0.5, 1),
      this.add.image(w * 0.1, h + 20, 'tree_dark').setOrigin(0.5, 1).setFlipX(true),
    ];
    this.hero = this.add.image(w * 0.74, h - 24, 'atlas', 'hero_aimUD').setScale(2).setOrigin(0.5, 1);

    const title = this.add.text(w / 2, 58, 'GUNRUN', { fontFamily: 'monospace', fontSize: '60px', fontStyle: 'bold', color: '#ffd23f', stroke: '#6b1d0e', strokeThickness: 8 }).setOrigin(0.5);
    this.add.text(w / 2, 102, 'OPERATION  GREEN  HELL', { fontFamily: 'monospace', fontSize: '13px', color: '#e8f0ff', letterSpacing: 4, stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5);
    this.tweens.add({ targets: title, y: 62, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    const font = { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 };
    this.rows = [this.add.text(60, 150, '', font), this.add.text(60, 180, '', font)];
    const press = this.add.text(60, 226, 'ENTER  START', { ...font, fontSize: '14px', color: '#ffd23f' });
    this.tweens.add({ targets: press, alpha: 0.3, duration: 500, yoyo: true, repeat: -1 });
    this.add.text(60, 250, '↑↓ choose   ←→ change   ?  all commands', { ...font, fontSize: '10px', color: '#c8d4e2', strokeThickness: 3 });
    this.add.text(w - 6, 6, 'Art: Master484 (CC-BY 3.0) · Open Pixel Project (CC0)', { fontFamily: 'monospace', fontSize: '8px', color: '#c8d4e2' }).setOrigin(1, 0);
    this.refresh();

    let started = false, helpOpen = false;
    const go = () => {
      if (started) return; started = true;
      Settings.get().save();
      Audio.get().unlock(); Audio.get().startMusic(); this.scene.start('Level');
    };
    const change = (d: number) => {
      const s = Settings.get();
      if (this.row === 0) s.skin = (s.skin + d + SKINS.length) % SKINS.length;
      else s.theme = (s.theme + d + THEMES.length) % THEMES.length;
      Audio.get().unlock(); Audio.get().play('swap');
      this.refresh();
    };
    const flipRow = () => { this.row = 1 - this.row; this.refresh(); };
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key === '?' || (helpOpen && e.key === 'Escape')) { helpOpen = toggleHelp(this); return; }
      if (helpOpen) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'arrowdown' || k === 'w' || k === 's') flipRow();
      else if (k === 'arrowleft' || k === 'a') change(-1);
      else if (k === 'arrowright' || k === 'd') change(1);
      else if (k === 'enter' || k === ' ' || k === 'z' || k === 'x') go();
    });
    // Standard gamepad: d-pad 12-15, A = 0, Start = 9.
    this.input.gamepad?.on('down', (_p: unknown, b: Phaser.Input.Gamepad.Button) => {
      if (b.index === 12 || b.index === 13) flipRow();
      else if (b.index === 14) change(-1);
      else if (b.index === 15) change(1);
      else if (b.index === 0 || b.index === 9) go();
    });
  }

  private refresh() {
    const s = Settings.get(), th = s.themeDef, { width: w, height: h } = this.scale;
    this.sky.clear().fillGradientStyle(th.sky[0], th.sky[0], th.sky[1], th.sky[1], 1).fillRect(0, 0, w, h);
    if (th.stars) for (let i = 0; i < 60; i++) this.sky.fillStyle(0xffffff, 0.6).fillRect((i * 97) % w, (i * 53) % 140, 1, 1);
    this.trees.forEach((t) => t.setTint(th.treeFar));
    this.hero.setFrame(s.skinDef.plush ? 'muse_stand' : s.skinDef.prefix + 'aimUD').setTint(th.tiles);
    const line = (r: number, label: string, value: string) =>
      this.rows[r].setText(`${this.row === r ? '▶' : ' '} ${label}  ◀ ${value.padEnd(5)} ▶`).setColor(this.row === r ? '#ffd23f' : '#ffffff');
    line(0, 'SOLDIER', s.skinDef.name);
    line(1, 'STAGE  ', th.name);
  }
}
