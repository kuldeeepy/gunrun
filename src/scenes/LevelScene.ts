import Phaser from 'phaser';
import { Input } from '../core/Input';
import { Fx } from '../core/Fx';
import { Audio } from '../core/Audio';
import { World } from '../sim/World';
import { TILE } from '../sim/tiles';
import { WEAPONS } from '../sim/weapons';
import { STAGE1 } from '../levels/stage1';
import { toggleHelp } from './help';
import { Settings } from '../core/Settings';

const STEP_MS = 1000 / 60;
const MAX_STEPS = 5;
const FONT = { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 };

// Phaser 4: fill tint is a tint mode, not a separate method.
const fill = (s: Phaser.GameObjects.Sprite, c: number) => s.setTint(c).setTintMode(Phaser.TintModes.FILL);
const plain = (s: Phaser.GameObjects.Sprite) => s.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);

// Cheap deterministic hash for tile variety.
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

export class LevelScene extends Phaser.Scene {
  private acc = 0;
  private fxG!: Phaser.GameObjects.Graphics;
  private topG!: Phaser.GameObjects.Graphics;
  private hudG!: Phaser.GameObjects.Graphics;
  private hero!: Phaser.GameObjects.Sprite;
  private gun!: Phaser.GameObjects.Image; // plush character's blaster, rotated to the aim
  private sprites = new Map<number, Phaser.GameObjects.Sprite>();
  private bridges = new Map<string, Phaser.GameObjects.Image[]>();
  private hudText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private paused = false;
  private helpOpen = false;
  private startCheckpoint = 0;
  private clearAt = 0;

  constructor() { super('Level'); }

  init(data: { checkpoint?: number }) {
    this.startCheckpoint = data.checkpoint ?? 0;
    this.sprites = new Map();
    this.bridges = new Map();
    this.acc = 0; this.paused = false; this.helpOpen = false; this.clearAt = 0;
  }

  create() {
    const w = World.get();
    Input.get().bind(this);
    w.load(STAGE1, this.scale.width, this.startCheckpoint);
    if (this.startCheckpoint === 0) { w.score = 0; w.deaths = 0; w.kills = 0; w.shots = 0; w.hits = 0; }

    this.buildBackground();
    this.buildTiles();

    this.fxG = this.add.graphics().setDepth(20);
    this.hero = this.add.sprite(0, 0, 'atlas', 'hero_stand').setDepth(15);
    this.gun = this.add.image(0, 0, 'atlas', 'muse_gun').setDepth(16).setOrigin(1, 0.5).setVisible(false);
    w.player.plush = Settings.get().skinDef.plush;
    this.topG = this.add.graphics().setDepth(30); // enemy bullets always on top

    this.hudG = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.hudText = this.add.text(0, 0, '', FONT).setScrollFactor(0).setDepth(101);
    this.scoreText = this.add.text(this.scale.width - 8, 6, '', { ...FONT, fontSize: '12px' }).setOrigin(1, 0).setScrollFactor(0).setDepth(101);
    this.timeText = this.add.text(this.scale.width / 2, 6, '', { ...FONT, fontSize: '12px' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);
    this.banner = this.add.text(this.scale.width / 2, 120, '', { ...FONT, fontSize: '28px', color: '#ffd23f', strokeThickness: 6 }).setOrigin(0.5).setScrollFactor(0).setDepth(102).setAlpha(0);
    this.overlay = this.add.text(this.scale.width / 2, this.scale.height / 2, '', { ...FONT, fontSize: '14px', align: 'center', lineSpacing: 6 }).setOrigin(0.5).setScrollFactor(0).setDepth(103);

    // Auto-pause when the tab/window loses focus.
    const autoPause = () => { if (!w.cleared && !w.gameOver) this.paused = true; };
    this.game.events.on(Phaser.Core.Events.BLUR, autoPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.BLUR, autoPause));
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.key === '?' || (this.helpOpen && e.key === 'Escape')) { this.helpOpen = toggleHelp(this); this.paused = this.helpOpen; return; }
      if (e.key === 'Escape' && !w.cleared && !w.gameOver) this.paused = !this.paused;
    });
    this.input.keyboard!.on('keydown-ENTER', () => this.onEnter());
    this.showBanner(this.startCheckpoint ? 'CONTINUE' : 'STAGE 1 — THE JUNGLE', 110);
    Audio.get().startMusic();
  }

  private onEnter() {
    const w = World.get();
    if (w.gameOver) { w.score = 0; this.scene.restart({ checkpoint: w.checkpointX }); }
    else if (w.cleared && this.clearAt && w.frame > this.clearAt + 60) this.scene.restart({ checkpoint: 0 });
  }

  // ---------- Static layers ----------
  private buildBackground() {
    const { width: vw, height: vh } = this.scale, w = World.get(), th = Settings.get().themeDef;
    const sky = this.add.graphics().setScrollFactor(0).setDepth(-100);
    sky.fillGradientStyle(th.sky[0], th.sky[0], th.sky[1], th.sky[1], 1).fillRect(0, 0, vw, vh);
    if (th.stars) for (let i = 0; i < 90; i++) {
      sky.fillStyle(0xffffff, 0.3 + (hash(i, 1) % 70) / 100).fillRect(hash(i, 2) % vw, hash(i, 3) % 200, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }

    const levelW = w.map.widthPx;
    const cl = ['cloud1', 'cloud2', 'cloud3'];
    for (let i = 0, x = -100; x < levelW * 0.1 + vw; i++, x += 260 + (hash(i, 3) % 200)) {
      this.add.image(x, 30 + (hash(i, 7) % 90), cl[i % 3]).setScrollFactor(0.1, 0).setDepth(-90).setAlpha(th.cloudAlpha).setTint(th.cloud);
    }
    // Distant jungle ridge (procedural silhouette).
    const ridge = (factor: number, color: number, base: number, amp: number, depth: number, seed: number) => {
      const g = this.add.graphics().setScrollFactor(factor, 0).setDepth(depth);
      const span = levelW * factor + vw + 64;
      g.fillStyle(color);
      g.beginPath(); g.moveTo(-32, vh);
      for (let x = -32; x <= span; x += 16) {
        const y = base - Math.abs(Math.sin((x + seed) * 0.011)) * amp - Math.sin((x + seed * 3) * 0.047) * amp * 0.25 - (hash(x, seed) % 6);
        g.lineTo(x, y);
      }
      g.lineTo(span, vh); g.closePath(); g.fillPath();
    };
    ridge(0.2, th.ridgeFar, 230, 70, -80, 11);
    ridge(0.35, th.ridgeNear, 262, 60, -70, 29);
    // Tree lines: dark far trees, then lighter near trees.
    for (let i = 0, x = -60; x < levelW * 0.5 + vw; i++, x += 150 + (hash(i, 5) % 120)) {
      this.add.image(x, 312 - (hash(i, 9) % 20), 'tree_dark').setOrigin(0.5, 1).setScrollFactor(0.5, 1).setDepth(-60).setTint(th.treeFar).setFlipX(i % 2 === 0);
    }
    for (let i = 0, x = 0; x < levelW * 0.75 + vw; i++, x += 240 + (hash(i, 13) % 180)) {
      this.add.image(x, 300, 'tree_light').setOrigin(0.5, 1).setScrollFactor(0.75, 1).setDepth(-50).setTint(th.treeNear).setFlipX(i % 2 === 1);
    }
  }

  private buildTiles() {
    const w = World.get(), map = w.map;
    const rt = this.add.renderTexture(0, 0, map.widthPx, map.heightPx).setOrigin(0).setDepth(0);
    const deco = this.add.renderTexture(0, 0, map.widthPx, map.heightPx).setOrigin(0).setDepth(16); // grass tufts in front of feet
    const solid = (cx: number, cy: number) => map.at(cx, cy) === '#';
    const stamp = (key: string, frame: number, x: number, y: number, target = rt) => target.stamp(key, frame, x, y, { originX: 0, originY: 0 });

    for (let cy = 0; cy < map.rows.length; cy++) {
      for (let cx = 0; cx < map.cols; cx++) {
        const c = map.rows[cy][cx], x = cx * TILE, y = cy * TILE, h = hash(cx, cy);
        if (c === '#') {
          const up = solid(cx, cy - 1) || map.at(cx, cy - 1) === '#';
          const L = solid(cx - 1, cy), R = solid(cx + 1, cy), D = cy + 1 >= map.rows.length || solid(cx, cy + 1);
          if (!up) {
            stamp('ground_brown', !L ? 6 : !R ? 8 : h % 3 === 0 ? 19 : 7, x, y);
            if (h % 5 < 2) stamp('vegetation', 2 + (h % 6), x, y - 18, deco);
          } else if (!L) stamp('wall_brown', 4 * (1 + (cy % 6)), x, y);
          else if (!R) stamp('wall_brown', 4 * (1 + (cy % 6)) + 1, x, y);
          else if (!D) stamp('bottom_brown', 1, x, y);
          else stamp('wall_brown', h % 9 === 0 ? 6 : 2, x, y);
        } else if (c === '=') {
          const L = map.at(cx - 1, cy) === '=', R = map.at(cx + 1, cy) === '=';
          stamp('ground_brown', !L ? 30 : !R ? 32 : 31, x, y);
        } else if (c === '~') {
          const top = map.at(cx, cy - 1) !== '~';
          stamp('water', top ? 12 + (cx % 2) : 17 + (h % 2), x, y);
        } else if (c === 'b') {
          let i = 0; while (map.at(cx - i - 1, cy) === 'b') i++;
          let j = 0; while (map.at(cx + j + 1, cy) === 'b') j++;
          const col = i === 0 ? 0 : j === 0 ? 5 : 1 + ((i - 1) % 4);
          const imgs = [
            this.add.image(x, y - TILE, 'bridge', 11 + col).setOrigin(0).setDepth(1),
            this.add.image(x, y, 'bridge', 22 + col).setOrigin(0).setDepth(1),
          ];
          this.bridges.set(`${cx},${cy}`, imgs);
        }
      }
    }
    rt.render(); deco.render();
    const tint = Settings.get().themeDef.tiles;
    rt.setTint(tint); deco.setTint(tint);
    for (const imgs of this.bridges.values()) imgs.forEach((i) => i.setTint(tint));
  }

  // ---------- Loop ----------
  update(_time: number, delta: number) {
    const w = World.get();
    if (this.paused) { this.overlay.setText(this.helpOpen ? '' : 'PAUSED\n\nESC to resume   ·   ? commands'); return; }
    this.acc += Math.min(delta, 250);
    let steps = 0;
    while (this.acc >= STEP_MS && steps < MAX_STEPS) {
      this.acc -= STEP_MS; steps++;
      Input.get().poll();
      if (!w.gameOver) w.step(Input.get().held); // hitstop is handled inside the sim
    }
    if (steps === MAX_STEPS) this.acc = 0;
    for (const e of w.events) this.onEvent(e);
    w.events.length = 0;
    Fx.get().addTrauma(w.trauma); w.trauma = 0;
    this.render(w.freeze > 0 ? 1 : this.acc / STEP_MS, delta);
  }

  private onEvent(e: string) {
    Audio.get().play(e);
    const w = World.get();
    if (e === 'checkpoint') this.showBanner('CHECKPOINT', 60);
    if (e === 'bossIntro') this.showBanner('WARNING — GUARDIAN MECH', 120);
    if (e === 'shieldDown') this.showBanner('SHIELD DOWN!', 70);
    if (e === 'clear') this.clearAt = w.frame;
  }

  private showBanner(text: string, frames: number) {
    this.banner.setText(text).setAlpha(1).setScale(1.3);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, scale: 1, duration: 180, ease: 'Back.out' });
    this.tweens.add({ targets: this.banner, alpha: 0, delay: frames * 16, duration: 300 });
  }

  // ---------- Render ----------
  private render(alpha: number, delta: number) {
    const w = World.get(), cam = this.cameras.main;
    cam.setScroll(Math.round(w.camPrevX + (w.camX - w.camPrevX) * alpha), w.camY);
    Fx.get().shake(cam, delta);

    // Bridges that blew up (or were rebuilt).
    for (const [key, imgs] of this.bridges) {
      const [cx, cy] = key.split(',').map(Number);
      const up = w.map.at(cx, cy) === 'b'; // bridges can be rebuilt on respawn, so toggle rather than destroy
      imgs.forEach((i) => i.setVisible(up));
    }

    this.renderHero(alpha);
    this.renderEnemies();
    this.renderFx();
    this.renderHud();
  }

  private renderHero(alpha: number) {
    const w = World.get(), p = w.player, s = this.hero;
    const visible = p.dead === 0 && !w.gameOver && !(p.iframes > 0 && (p.iframes >> 2) % 2 === 1 && !w.cleared);
    s.setVisible(visible);
    this.gun.setVisible(false);
    if (!visible) return;
    if (p.plush) return this.renderPlush(alpha);
    const x = Math.round(p.px + (p.x - p.px) * alpha), y = Math.round(p.py + (p.y - p.py) * alpha);
    const kick = p.kick ? -p.facing : 0;
    const f = p.facing, ax = p.aimX, ay = p.aimY;
    const pre = Settings.get().skinDef.prefix;
    let frame = 'hero_stand', angle = 0, ox = f > 0 ? 0.46 : 0.54, oy = 1, px = x + p.w / 2 + kick, py = y + p.h;

    if (p.prone) { frame = 'hero_prone'; ox = 0.5; }
    else if (!p.onGround && p.somersault && p.lastShot > 12) {
      frame = 'hero_jump'; angle = Math.floor(p.spin / 4) * 90 * f; ox = 0.5; oy = 0.55; py = y + p.h / 2;
    } else if (!p.onGround) {
      frame = ay < 0 ? (ax === 0 ? 'hero_aimU' : 'hero_aimUD') : ay > 0 ? (ax === 0 ? 'hero_aimD' : 'hero_aimDD') : 'hero_jump';
    } else if (p.vx !== 0) {
      const i = Math.floor(p.runT / 5) % 8;
      frame = ay < 0 ? `hero_runU${i}` : ay > 0 ? `hero_runD${i}` : `hero_run${i}`;
    } else {
      frame = ay < 0 ? (ax === 0 ? 'hero_aimU' : 'hero_aimUD') : ay > 0 ? 'hero_aimDD' : 'hero_stand';
    }
    s.setFrame(pre + frame.slice(5)).setOrigin(ox, oy).setPosition(px, py).setFlipX(f < 0).setAngle(angle);
    if (p.barrier > 0 && (p.barrier > 120 || (p.barrier >> 2) % 2)) plain(s).setTint(0xb8f6ff); else plain(s);
  }

  // Plush character: body frames + a separate blaster pivoting at the hand, tip on the muzzle point.
  private renderPlush(alpha: number) {
    const w = World.get(), p = w.player, s = this.hero;
    const x = Math.round(p.px + (p.x - p.px) * alpha), y = Math.round(p.py + (p.y - p.py) * alpha), f = p.facing;
    const dx = x - p.x, dy = y - p.y; // interpolation offset, applied to the gun too
    const spinning = !p.onGround && p.somersault && p.lastShot > 12;
    let frame = 'muse_stand', angle = 0, oy = 1, py = y + p.h;
    if (p.prone) frame = 'muse_prone';
    else if (spinning) { frame = 'muse_jump'; angle = Math.floor(p.spin / 3) * 45 * f; oy = 0.6; py = y + p.h / 2; } // plush rolls
    else if (!p.onGround) frame = 'muse_jump';
    else if (p.vx !== 0) frame = `muse_run${Math.floor(p.runT / 6) % 4}`;
    else if (w.frame % 200 < 7) frame = 'muse_blink';
    s.setFrame(frame).setOrigin(0.5, oy).setPosition(x + p.w / 2 + (p.kick ? -f : 0), py).setFlipX(f < 0).setAngle(angle);
    if (p.barrier > 0 && (p.barrier > 120 || (p.barrier >> 2) % 2)) plain(s).setTint(0xb8f6ff); else plain(s);
    if (spinning) return;
    const m = w.muzzle(), a = p.prone ? (f > 0 ? 0 : Math.PI) : Math.atan2(p.aimY, p.aimX || f);
    this.gun.setVisible(true).setPosition(m.x + dx - Math.cos(a) * (p.kick ? 2 : 0), m.y + dy - Math.sin(a) * (p.kick ? 2 : 0))
      .setRotation(a).setFlipY(Math.cos(a) < -0.01);
  }

  private sprite(id: number, frame: string, depth = 10) {
    let s = this.sprites.get(id);
    if (!s) { s = this.add.sprite(0, 0, 'atlas', frame).setDepth(depth); this.sprites.set(id, s); }
    s.setData('seen', true);
    return s.setFrame(frame);
  }

  private renderEnemies() {
    const w = World.get();
    for (const s of this.sprites.values()) s.setData('seen', false);
    const shielded = w.bossShielded();

    for (const e of w.enemies) {
      const telling = e.tell > 0 && (e.tell >> 2) % 2 === 0;
      let s: Phaser.GameObjects.Sprite;
      switch (e.kind) {
        case 'soldier':
          s = this.sprite(e.id, e.tell > 0 ? 'sol_stand' : `sol_run${Math.floor(e.t / 4) % 8}`);
          s.setOrigin(e.dir > 0 ? 0.46 : 0.54, 1).setPosition(e.x + e.w / 2, e.y + e.h).setFlipX(e.dir < 0);
          break;
        case 'sniper':
          s = this.sprite(e.id, e.burst > 0 && e.t % 8 < 3 ? 'sol_jump' : 'sol_stand');
          s.setOrigin(e.dir > 0 ? 0.46 : 0.54, 1).setPosition(e.x + e.w / 2, e.y + e.h).setFlipX(e.dir < 0);
          break;
        case 'turret':
          s = this.sprite(e.id, e.burst > 0 ? 'tur1s' : 'tur1', 5);
          s.setOrigin(0.5, 1).setPosition(e.x + e.w / 2, e.y + e.h).setFlipX(e.dir > 0);
          break;
        case 'box': case 'bossgun':
          s = this.sprite(e.id, e.burst > 0 ? (e.t % 6 < 3 ? 'tur2s0' : 'tur2s1') : 'tur2', 5);
          s.setOrigin(0.44, 1).setPosition(e.x + e.w / 2, e.y + e.h).setFlipX(e.dir > 0);
          break;
        case 'carrier':
          s = this.sprite(e.id, e.t % 10 < 5 ? 'carrier0' : 'carrier1', 12);
          s.setOrigin(0.5).setPosition(e.x + e.w / 2, e.y + e.h / 2).setAngle(e.t * 4);
          break;
        case 'drone':
          s = this.sprite(e.id, e.t % 6 < 3 ? 'drone0' : 'drone1', 12);
          s.setOrigin(0.5).setPosition(e.x + e.w / 2, e.y + e.h / 2);
          break;
        case 'boss': {
          const frame = e.state === 'jump' ? 'mech_jump' : e.state === 'fire' ? (e.t % 10 < 4 ? 'mech_shoot1' : 'mech_shoot0') : e.state === 'tell' ? 'mech_shoot0' : 'mech_stand';
          s = this.sprite(e.id, frame, 8);
          s.setScale(2).setOrigin(0.5, 1).setPosition(e.x + e.w / 2, e.y + e.h).setFlipX(e.dir > 0);
          if (e.state === 'tell' && (e.tell >> 2) % 2 === 0) {
            const m = w.bossMuzzle(e);
            this.fxG.fillStyle(0xff3b3b, 0.8).fillCircle(m.x, m.y, 6 + (e.tell % 4));
          }
          break;
        }
      }
      if (e.flash > 0) fill(s!, 0xffffff);
      else if (telling) fill(s!, 0xff4a3a);
      else if (e.kind === 'bossgun') plain(s!).setTint(0xffb0a0);
      else if (e.kind === 'boss' && e.hp < e.maxHp * 0.25 && (w.frame >> 3) % 2) plain(s!).setTint(0xff9090);
      else plain(s!);
      if (e.kind === 'boss' && shielded && e.state !== 'intro') {
        this.fxG.lineStyle(2, 0x9ff3ff, 0.35 + 0.25 * Math.sin(w.frame * 0.2)).strokeEllipse(e.x + e.w / 2, e.y + e.h / 2 + 10, e.w + 40, e.h + 20);
      }
    }

    for (const k of w.pickups) {
      const s = this.sprite(k.id, `orb_${k.letter}`, 12);
      s.setOrigin(0.5).setPosition(k.x + k.w / 2, k.y + k.h / 2).setScale(1.3);
      if ((k.t >> 3) % 2) fill(s, 0xffffff); else plain(s);
    }
    for (const c of w.corpses) {
      const s = this.sprite(c.id, c.frame.startsWith('hero_') ? Settings.get().skinDef.prefix + c.frame.slice(5) : c.frame, 9);
      if (c.frame === 'muse_hurt') s.setOrigin(0.5, 1);
      s.setOrigin(0.5, 1).setPosition(c.x, c.y).setFlipX(c.flip).setAngle(c.t * 6 * (c.flip ? -1 : 1));
      if ((c.t >> 2) % 2) fill(s, 0xffffff); else plain(s);
    }
    for (const [id, s] of this.sprites) if (!s.getData('seen')) { s.destroy(); this.sprites.delete(id); }
  }

  private renderFx() {
    const w = World.get(), p = w.player, g = this.fxG, top = this.topG;
    g.clear(); top.clear();

    // Player bullets, styled per weapon.
    for (const b of w.bullets) {
      if (b.enemy) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (w.map.solid(Math.floor(cx / TILE), Math.floor(cy / TILE))) continue; // tunnelling through rock
      if (b.weapon === 'P') {
        g.fillStyle(0x3ad7ff, 0.35).fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
        g.fillStyle(0xe8fdff).fillRect(b.x, b.y, b.w, b.h);
      } else if (b.weapon === 'F') {
        g.fillStyle(0xff5a2a).fillCircle(cx, cy, 4.5);
        g.fillStyle(0xfff1a8).fillCircle(cx, cy, 2.5);
      } else {
        g.fillStyle(b.weapon === 'A' ? 0xff7a1a : 0xffb000, 0.45).fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
        g.fillStyle(b.weapon === 'A' ? 0xffc36a : 0xfff1a8).fillRect(b.x, b.y, b.w, b.h);
        g.fillStyle(0xffffff).fillRect(cx - 2, cy - 1, 4, 2);
      }
    }
    // Muzzle flash: big for 1-2 frames.
    if (p.flash > 0 && p.dead === 0) {
      const m = w.muzzle();
      g.fillStyle(0xfff6b0).fillCircle(m.x + p.aimX * 3, m.y + p.aimY * 3, 7);
      g.fillStyle(0xffffff).fillCircle(m.x + p.aimX * 3, m.y + p.aimY * 3, 4);
    }
    // Barrier bubble.
    if (p.barrier > 0 && p.dead === 0) {
      g.lineStyle(2, 0x9ff3ff, 0.5 + 0.3 * Math.sin(w.frame * 0.3)).strokeCircle(p.x + p.w / 2, p.y + p.h / 2, 30);
    }
    // Boss shockwaves.
    for (const s of w.shocks) {
      g.fillStyle(0xffd23f, 0.9).fillTriangle(s.x, s.y + s.h, s.x + s.w / 2, s.y - 6, s.x + s.w, s.y + s.h);
      g.fillStyle(0xffffff).fillTriangle(s.x + 6, s.y + s.h, s.x + s.w / 2, s.y + 2, s.x + s.w - 6, s.y + s.h);
    }
    for (const q of w.particles) {
      g.fillStyle(q.color, Math.min(1, q.life / (q.max * 0.5))).fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    // Enemy bullets: one colour nothing else uses, dark outline, drawn on top of everything.
    for (const b of w.bullets) {
      if (!b.enemy) continue;
      const r = b.w / 2 + 1, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      top.fillStyle(0x1a0010).fillCircle(cx, cy, r + 1.5);
      top.fillStyle((w.frame >> 2) % 2 ? 0xff3df2 : 0xff8af8).fillCircle(cx, cy, r);
      top.fillStyle(0xffffff).fillCircle(cx - 1, cy - 1, 1);
    }
  }

  private renderHud() {
    const w = World.get(), p = w.player, g = this.hudG, vh = this.scale.height;
    g.clear();
    // Lives as medals.
    for (let i = 0; i < Math.max(0, p.lives); i++) {
      g.fillStyle(0x000000, 0.5).fillRect(8 + i * 12, 7, 9, 14);
      g.fillStyle(Settings.get().skinDef.color).fillRect(9 + i * 12, 8, 7, 8);
      g.fillStyle(0xffd23f).fillRect(10 + i * 12, 16, 5, 4);
    }
    // Weapon slots (Contra III style: two guns, lose only the one in hand).
    p.slots.forEach((_id, i) => {
      const x = 8 + i * 58, y = vh - 26, active = i === p.cur;
      g.fillStyle(0x000000, 0.55).fillRect(x, y, 54, 18);
      g.lineStyle(active ? 2 : 1, active ? 0xffd23f : 0x667788).strokeRect(x, y, 54, 18);
    });
    const slotLabel = p.slots.map((id) => (id === 'R' ? '  RIFLE' : `${id} ${WEAPONS[id].name}`));
    this.hudText.setPosition(13, vh - 23).setText(`${slotLabel[0].padEnd(9)}${slotLabel[1]}`);
    const mult = w.multiplier();
    this.scoreText.setText(`${String(w.score).padStart(7, '0')}${mult > 1 ? `  x${mult}` : ''}`);
    const secs = Math.floor(w.frame / 60);
    this.timeText.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);

    if (w.gameOver) {
      this.overlay.setText('GAME OVER\n\nENTER — continue from checkpoint');
    } else if (w.cleared && this.clearAt && w.frame > this.clearAt + 90) {
      const acc = w.shots ? Math.round((w.hits / w.shots) * 100) : 0;
      const t = Math.floor(this.clearAt / 60);
      const pts = (w.deaths === 0 ? 3 : w.deaths <= 2 ? 2 : w.deaths <= 5 ? 1 : 0) + (t < 180 ? 2 : t < 300 ? 1 : 0) + (acc >= 40 ? 1 : 0);
      const rank = pts >= 6 ? 'S' : pts >= 4 ? 'A' : pts >= 2 ? 'B' : 'C';
      this.overlay.setText(
        `STAGE CLEAR\n\nTIME      ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}\nDEATHS    ${w.deaths}\nACCURACY  ${acc}%\nKILLS     ${w.kills}\nSCORE     ${w.score}\n\nRANK  ${rank}\n\nENTER — play again`);
      const r = this.overlay.getBounds();
      g.fillStyle(0x000000, 0.65).fillRect(r.x - 24, r.y - 16, r.width + 48, r.height + 32);
      this.banner.setAlpha(0);
    } else if (!this.paused) {
      this.overlay.setText('');
    }
  }
}
