// Player choices from the title screen, remembered in localStorage.
export const SKINS = [
  { name: 'RAVEN', prefix: 'hero_', color: 0x3d8bff, plush: false },
  { name: 'BLAZE', prefix: 'hero1_', color: 0xe8435a, plush: false },
  { name: 'VIPER', prefix: 'hero2_', color: 0xa05cff, plush: false },
  { name: 'GHOST', prefix: 'hero3_', color: 0xdfe6ee, plush: false },
  { name: 'PLUSH', prefix: 'muse_', color: 0xf3e3c3, plush: true }, // own hand-drawn frames + separate blaster
];

export type Theme = {
  name: string;
  sky: [number, number];         // top, bottom
  cloud: number; cloudAlpha: number;
  ridgeFar: number; ridgeNear: number;
  treeFar: number; treeNear: number;
  tiles: number;                 // tint on the level tiles
  stars: boolean;
};

export const THEMES: Theme[] = [
  { name: 'DAY', sky: [0x3a7bd5, 0xa8e0ff], cloud: 0xffffff, cloudAlpha: 0.95, ridgeFar: 0x5f8fa8, ridgeNear: 0x3e6b5e, treeFar: 0x2c4a47, treeNear: 0x5f7f6a, tiles: 0xffffff, stars: false },
  { name: 'DUSK', sky: [0x3b2a6b, 0xff9a5a], cloud: 0xffb48a, cloudAlpha: 0.85, ridgeFar: 0x7a4f7a, ridgeNear: 0x4a3552, treeFar: 0x2e2238, treeNear: 0x6b5060, tiles: 0xffd6c0, stars: false },
  { name: 'NIGHT', sky: [0x050914, 0x1c2f52], cloud: 0x5a6a90, cloudAlpha: 0.5, ridgeFar: 0x1f2f4a, ridgeNear: 0x15233a, treeFar: 0x0f1a26, treeNear: 0x2f4460, tiles: 0x9fb4e0, stars: true },
];

export class Settings {
  private static instance: Settings;
  static get(): Settings {
    return (Settings.instance ??= new Settings());
  }

  skin = 0;
  theme = 0;
  hero3d = 0; // index into CHARACTERS (2.5D renderer)

  private constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('gunrun.settings') ?? '{}');
      if (saved.skin >= 0 && saved.skin < SKINS.length) this.skin = saved.skin;
      if (saved.theme >= 0 && saved.theme < THEMES.length) this.theme = saved.theme;
      if (Number.isInteger(saved.hero3d) && saved.hero3d >= 0) this.hero3d = saved.hero3d;
    } catch { /* private mode / blocked storage: defaults are fine */ }
  }

  save() {
    try { localStorage.setItem('gunrun.settings', JSON.stringify({ skin: this.skin, theme: this.theme, hero3d: this.hero3d })); } catch { /* ignore */ }
  }

  get skinDef() { return SKINS[this.skin]; }
  get themeDef() { return THEMES[this.theme]; }
}
