import { BTN } from './buttons';
import { TileMap, TILE, moveBox, overlap, Box } from './tiles';
import { WEAPONS, WeaponId } from './weapons';

const DT = 1 / 60;

// Jump designed by height/time (Pittman): g = 2h/t², v0 = 2h/t.
const RUN = 150, SPRINT = 210, SPRINT_RAMP = 40; // px/s; holding a direction ramps up to sprint over ~0.7 s
const JUMP_H = 100, JUMP_T = 0.42;
const GRAV = (2 * JUMP_H) / (JUMP_T * JUMP_T);
const JUMP_V = (2 * JUMP_H) / JUMP_T;
const FALL_MULT = 1.45;
const MAX_FALL = 560;
const COYOTE = 6, BUFFER = 6;
const PW = 16, STAND_H = 40, PRONE_H = 14;
const RESPAWN_IFRAMES = 120;
const BARRIER_FRAMES = 600;
const CAMERA_Y = 24; // 12 rows * 32 = 384, view 360
export const GROUND_ROW = 9; // walkable ground surface row in every stage

export type Bullet = Box & { vx: number; vy: number; life: number; enemy: boolean; down: boolean; dmg: number; pierce: boolean; weapon: WeaponId | 'E'; hits: Set<number> | null };
export type EnemyKind = 'soldier' | 'sniper' | 'turret' | 'box' | 'carrier' | 'drone' | 'boss' | 'bossgun';
export type Enemy = Box & {
  id: number; kind: EnemyKind; vx: number; vy: number; hp: number; maxHp: number; flash: number; dir: number;
  cool: number; tell: number; burst: number; t: number; onGround: boolean; dead: boolean; baseY: number;
  shooter: boolean; letter: string; state: string;
};
export type Pickup = Box & { id: number; letter: string; vx: number; vy: number; t: number };
export type Corpse = { id: number; x: number; y: number; vx: number; vy: number; t: number; frame: string; flip: boolean };
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number; grav: number };
export type Shock = Box & { vx: number; life: number };
export type Popup = { x: number; y: number; value: number; t: number; tier: number };
export type Blast = { x: number; y: number; r: number; t: number; max: number };

const COMBO_WINDOW = 90; // frames (1.5 s) to chain the next kill
// End-of-stage bonuses and rank thresholds on the final total.
const RANKS: [string, number][] = [['S', 90000], ['A', 65000], ['B', 40000], ['C', 0]];

export class Player implements Box {
  x = 0; y = 0; w = PW; h = STAND_H;
  px = 0; py = 0; // previous step, for render interpolation
  vx = 0; vy = 0;
  facing = 1;
  aimX = 1; aimY = 0;
  onGround = false; prone = false; somersault = false; spin = 0;
  coyote = 0; buffer = 0;
  fireCool = 0; flash = 0; kick = 0; lastShot = 999; runT = 0; runHeld = 0;
  iframes = RESPAWN_IFRAMES; barrier = 0; dead = 0; lives = 3;
  slots: WeaponId[] = ['R', 'R']; cur = 0;
  plush = false; // plush character: short arm, blaster pivots from the hand
  get weapon() { return this.slots[this.cur]; }
}

export class World {
  private static instance: World;
  static get(): World {
    return (World.instance ??= new World());
  }
  private constructor() {}

  map!: TileMap;
  player!: Player;
  bullets: Bullet[] = [];
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  corpses: Corpse[] = [];
  particles: Particle[] = [];
  shocks: Shock[] = [];
  popups: Popup[] = [];  // floating score numbers
  blasts: Blast[] = [];  // explosion flashes for the renderer
  events: string[] = []; // sounds etc., drained by the renderer each frame
  trauma = 0;            // screen shake requested this frame, drained by the renderer
  freeze = 0;            // hitstop frames remaining (sim state, so replays match)
  private held = 0; private prev = 0;
  camX = 0; camPrevX = 0; camY = CAMERA_Y; camLock = -1;
  frame = 0; spawnTimer = 120; viewW = 640;
  checkpointX = 0; arenaX = 0; bossSpawned = false; bossDead = 0; cleared = false; gameOver = false;
  score = 0; kills = 0; streak = 0; deaths = 0; shots = 0; hits = 0;
  combo = 0; comboTimer = 0; maxCombo = 0;
  bridgeFuse: { cx: number; cy: number; t: number }[] = [];
  private bridgeTiles: { cx: number; cy: number }[] = [];
  private markers: { cx: number; cy: number; c: string; used: boolean }[] = [];
  private nextId = 1;
  private seed = 1;
  private carrierLetters = ['F', 'A', 'P', 'B', 'F', 'A'];
  private carrierIdx = 0;

  // mulberry32: deterministic, never use Math.random() in the sim.
  rand() {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Legend: # rock  = ledge  b bridge  ~ water  P player  K checkpoint
  // S sniper  T dome turret  U box turret  c capsule carrier  d drone wave  B boss arena
  load(rows: string[], viewW: number, fromCheckpoint = 0) {
    this.viewW = viewW;
    this.bullets = []; this.enemies = []; this.pickups = []; this.corpses = []; this.particles = []; this.shocks = []; this.events = [];
    this.bridgeFuse = []; this.markers = [];
    this.frame = 0; this.seed = 1; this.spawnTimer = 150; this.carrierIdx = 0;
    this.trauma = 0; this.freeze = 0; this.held = this.prev = 0; this.streak = 0;
    this.combo = this.comboTimer = 0; this.popups = []; this.blasts = [];
    this.camLock = -1; this.bossSpawned = false; this.bossDead = 0; this.cleared = false; this.gameOver = false;
    this.checkpointX = fromCheckpoint;
    let sx = 96, sy = 200;
    const clean = rows.map((r) => r.split(''));
    rows.forEach((r, cy) => [...r].forEach((c, cx) => {
      if ('PKSTUcdB'.includes(c)) clean[cy][cx] = '.';
      if (c === 'P') { sx = cx * TILE; sy = cy * TILE; }
      else if (c === 'B') this.arenaX = cx * TILE;
      else if ('KSTUcd'.includes(c)) this.markers.push({ cx, cy, c, used: cx * TILE <= fromCheckpoint });
    }));
    this.map = new TileMap(clean.map((r) => r.join('')));
    this.bridgeTiles = [];
    this.map.rows.forEach((r, cy) => [...r].forEach((c, cx) => { if (c === 'b') this.bridgeTiles.push({ cx, cy }); }));
    this.player = new Player();
    const p = this.player;
    if (fromCheckpoint > 0) { sx = fromCheckpoint; sy = 0; }
    p.x = p.px = sx; p.y = p.py = sy + TILE - STAND_H;
    this.camX = this.camPrevX = Math.max(0, sx - viewW * 0.3);
  }

  private makeEnemy(kind: EnemyKind, x: number, y: number, extra: Partial<Enemy> = {}): Enemy {
    const base: Enemy = {
      id: this.nextId++, kind, x, y, w: 16, h: 40, vx: 0, vy: 0, hp: 1, maxHp: 1, flash: 0, dir: -1,
      cool: 60, tell: 0, burst: 0, t: 0, onGround: false, dead: false, baseY: y, shooter: false, letter: '', state: '',
    };
    const stats: Partial<Record<EnemyKind, Partial<Enemy>>> = {
      soldier: { w: 16, h: 40, hp: 1, vx: -110 },
      sniper: { w: 16, h: 40, hp: 2, cool: 60 },
      turret: { w: 40, h: 34, hp: 8, cool: 50 }, // tall enough that standing shots (muzzle 32px up) connect
      box: { w: 34, h: 40, hp: 12, cool: 80 },
      carrier: { w: 30, h: 30, hp: 1, vx: 150 },
      drone: { w: 30, h: 30, hp: 2, vx: -150 },
      bossgun: { w: 34, h: 40, hp: 20, cool: 90 },
      boss: { w: 190, h: 200, hp: 220, cool: 120, state: 'intro' },
    };
    const e = { ...base, ...stats[kind], ...extra };
    e.maxHp = e.hp;
    return e;
  }

  private hitstop(frames: number) { this.freeze = Math.max(this.freeze, frames); }
  private shake(v: number) { this.trauma = Math.min(1, this.trauma + v); }
  private down(b: number) { return (this.held & b) !== 0; }
  private pressed(b: number) { return (this.held & b) !== 0 && (this.prev & b) === 0; }

  // mask = BTN bitmask for this tick. During hitstop the previous mask is kept, so presses aren't lost.
  step(mask: number) {
    if (this.freeze > 0) { this.freeze--; return; }
    this.prev = this.held; this.held = mask;
    this.frame++;
    this.camPrevX = this.camX;
    this.stepPlayer();
    this.stepCamera();
    this.stepMarkers();
    this.stepSpawner();
    this.stepEnemies();
    this.stepBullets();
    this.stepPickups();
    this.stepBridges();
    this.stepShocks();
    this.stepFx();
  }

  // ---------- Player ----------
  private stepPlayer() {
    const p = this.player;
    p.px = p.x; p.py = p.y;
    if (p.flash > 0) p.flash--;
    if (p.kick > 0) p.kick--;
    p.lastShot++;

    if (p.dead > 0) {
      if (--p.dead === 0) this.respawn();
      return;
    }
    if (this.cleared) { p.vx = 0; p.vy = Math.min(MAX_FALL, p.vy + GRAV * DT); const h = moveBox(this.map, p, 0, p.vy * DT); if (h.bottom) p.vy = 0; return; }
    if (p.iframes > 0) p.iframes--;
    if (p.barrier > 0) p.barrier--;

    const L = this.down(BTN.LEFT), R = this.down(BTN.RIGHT), U = this.down(BTN.UP), D = this.down(BTN.DOWN);
    const lock = this.down(BTN.LOCK);
    const hx = (R ? 1 : 0) - (L ? 1 : 0);
    const vy = (D ? 1 : 0) - (U ? 1 : 0);
    if (hx !== 0) p.facing = hx;
    if (this.pressed(BTN.SWAP)) { p.cur = 1 - p.cur; this.events.push('swap'); }

    // Prone: ↓ while standing still lies you down; once down, ←/→ only turn you (you stay flat).
    // ↓ while running keeps you running and aims diagonally down (Contra).
    const wantProne = p.onGround && D && !lock && (p.prone || hx === 0);
    if (wantProne !== p.prone) {
      p.y += wantProne ? STAND_H - PRONE_H : -(STAND_H - PRONE_H);
      p.h = wantProne ? PRONE_H : STAND_H;
      p.prone = wantProne;
    }

    // Aim: 8-way. On the ground, pure down = prone (aims forward, low).
    if (lock || !p.onGround) {
      p.aimX = hx; p.aimY = vy;
      if (hx === 0 && vy === 0) p.aimX = p.facing;
      if (p.onGround && p.aimY > 0 && p.aimX === 0) p.aimX = p.facing; // can't shoot straight down standing
    } else {
      p.aimX = U && hx === 0 ? 0 : p.facing;
      p.aimY = U ? -1 : D && hx !== 0 ? 1 : 0;
      if (p.prone) { p.aimX = p.facing; p.aimY = 0; }
    }

    // Momentum: the longer you hold one direction, the faster you run (resets on stop or turn).
    p.runHeld = hx !== 0 && hx === Math.sign(p.vx || hx) && !lock && !p.prone ? p.runHeld + 1 : 0;
    p.vx = lock || p.prone ? 0 : hx * (RUN + (SPRINT - RUN) * Math.min(1, p.runHeld / SPRINT_RAMP));
    if (p.onGround && p.vx !== 0) p.runT++;

    // Jump with coyote time + buffer; down+jump drops through ledges.
    p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - 1);
    p.buffer = this.pressed(BTN.JUMP) ? BUFFER : Math.max(0, p.buffer - 1);
    let drop = false;
    if (p.buffer > 0 && p.coyote > 0) {
      const unProne = () => { if (p.prone) { p.y -= STAND_H - PRONE_H; p.h = STAND_H; p.prone = false; } };
      if (D && this.standingOnOneWay()) { unProne(); drop = true; }
      else { unProne(); p.vy = -JUMP_V; p.somersault = true; this.events.push('jump'); }
      p.buffer = 0; p.coyote = 0;
    }

    // Variable height: releasing jump while rising cuts upward speed.
    const rising = p.vy < 0;
    let g = GRAV * (rising ? 1 : FALL_MULT);
    if (rising && !this.down(BTN.JUMP)) g *= 2.2;
    p.vy = Math.min(MAX_FALL, p.vy + g * DT);

    const wasGround = p.onGround;
    const hit = moveBox(this.map, p, p.vx * DT, p.vy * DT, drop);
    if (p.x < this.camX) p.x = this.camX; // Contra: no walking back past the screen edge
    const rightLimit = this.camLock >= 0 ? this.camLock + this.viewW - p.w : this.map.widthPx - p.w;
    if (p.x > rightLimit) p.x = rightLimit;
    if (hit.bottom) {
      if (!wasGround && p.vy > 200) { this.dust(p.x + p.w / 2, p.y + p.h, 6); this.events.push('land'); }
      p.vy = 0; p.somersault = false;
      const cx = Math.floor((p.x + p.w / 2) / TILE), cy = Math.floor((p.y + p.h + 1) / TILE);
      if (this.map.at(cx, cy) === 'b') this.lightBridge(cx, cy);
    }
    if (hit.top) p.vy = 0;
    p.onGround = hit.bottom;
    p.spin += p.somersault ? 1 : 0;
    if (p.y > this.map.heightPx - TILE * 1.5) { this.splash(p.x + p.w / 2, this.map.heightPx - TILE * 2); this.killPlayer(true); }

    if (p.fireCool > 0) p.fireCool--;
    if (this.down(BTN.FIRE) && p.fireCool === 0) this.fire();
  }

  private standingOnOneWay() {
    const p = this.player;
    const cy = Math.floor((p.y + p.h + 1) / TILE);
    return this.map.oneWay(Math.floor((p.x + p.w / 2) / TILE), cy);
  }

  // Gun tip relative to the hitbox, matched to the sprite frames.
  muzzle() {
    const p = this.player, cx = p.x + p.w / 2, top = p.y, f = p.facing;
    if (p.plush) {
      if (p.prone) return { x: cx + f * 34, y: p.y + p.h - 8 };
      const len = Math.hypot(p.aimX, p.aimY) || 1, hx = cx + (p.aimX === 0 ? f * 2 : f * 8), hy = p.y + p.h - 20;
      return { x: hx + (p.aimX / len) * 20, y: hy + (p.aimY / len) * 20 };
    }
    if (p.prone) return { x: cx + f * 32, y: p.y + p.h - 10 };
    const ax = p.aimX, ay = p.aimY;
    if (ay < 0 && ax === 0) return { x: cx + f * 3, y: top - 16 };
    if (ay < 0) return { x: cx + ax * 21, y: top - 4 };
    if (ay > 0 && ax === 0) return { x: cx + f * 2, y: top + 44 };
    if (ay > 0) return { x: cx + ax * 21, y: top + 28 };
    return { x: cx + f * 24, y: top + 8 };
  }

  private fire() {
    const p = this.player, W = WEAPONS[p.weapon];
    const len = Math.hypot(p.aimX, p.aimY) || 1;
    const base = Math.atan2(p.aimY / len, p.aimX / len);
    const m = this.muzzle();
    for (let i = 0; i < W.pellets; i++) {
      const off = W.pellets > 1 ? (i - (W.pellets - 1) / 2) * W.spread : 0;
      const a = base + off + (this.rand() - 0.5) * W.jitter;
      const horiz = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
      const bw = horiz ? W.w : W.h, bh = horiz ? W.h : W.w;
      this.bullets.push({
        x: m.x - bw / 2, y: m.y - bh / 2, w: bw, h: bh, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed,
        life: 90, enemy: false, down: p.aimY > 0, dmg: W.dmg, pierce: W.pierce, weapon: p.weapon, hits: W.pierce ? new Set() : null,
      });
    }
    this.shots += W.pellets;
    p.fireCool = W.cool;
    p.flash = 2; p.kick = 3; p.lastShot = 0;
    this.events.push('shot' + p.weapon);
    // Shell casing (stays briefly, Vlambeer "permanence").
    this.particles.push({ x: p.x + p.w / 2, y: p.y + 10, vx: -p.facing * (40 + this.rand() * 40), vy: -120 - this.rand() * 60, life: 40, max: 40, color: 0xe8c15a, size: 2, grav: 900 });
  }

  // ---------- Camera ----------
  private stepCamera() {
    const p = this.player;
    if (this.camLock >= 0) { this.camX += (this.camLock - this.camX) * 0.1; return; }
    // Forward-only scroll, player held at ~40% of screen width.
    const target = p.x - this.viewW * 0.36; // a little more look-ahead at sprint speed
    const next = this.camX + (target - this.camX) * 0.12;
    this.camX = Math.max(this.camX, Math.min(next, this.map.widthPx - this.viewW));
    if (!this.bossSpawned && this.camX >= this.arenaX - 4) {
      this.camLock = this.arenaX;
      this.spawnBoss();
    }
  }

  // ---------- Level markers ----------
  private stepMarkers() {
    const reach = this.camX + this.viewW + 24;
    for (const m of this.markers) {
      if (m.used || m.cx * TILE > reach) continue;
      if (m.c === 'K' && this.player.x < m.cx * TILE) continue; // checkpoints count once you reach them, not when they scroll in
      m.used = true;
      const x = m.cx * TILE, y = m.cy * TILE;
      if (m.c === 'K') { this.checkpointX = x; this.events.push('checkpoint'); continue; }
      if (m.c === 'S') this.enemies.push(this.makeEnemy('sniper', x + 8, y + TILE - 40));
      if (m.c === 'T') this.enemies.push(this.makeEnemy('turret', x - 4, y + TILE - 34));
      if (m.c === 'U') {
        const inArena = x >= this.arenaX;
        this.enemies.push(this.makeEnemy(inArena ? 'bossgun' : 'box', x - 1, y + TILE - 40));
      }
      if (m.c === 'c') {
        const letter = this.carrierLetters[this.carrierIdx++ % this.carrierLetters.length];
        this.enemies.push(this.makeEnemy('carrier', this.camX - 30, y, { letter, baseY: y }));
      }
      if (m.c === 'd') for (let i = 0; i < 3; i++) this.enemies.push(this.makeEnemy('drone', this.camX + this.viewW + 20 + i * 60, y + i * 30, { baseY: y + i * 30, t: i * 20 }));
    }
  }

  // Soldiers stream in from the right edge. Stronger guns = faster spawns (NES Contra's hidden rule).
  private stepSpawner() {
    if (this.camLock >= 0 || this.player.dead > 0) return;
    if (--this.spawnTimer > 0) return;
    const tier = WEAPONS[this.player.weapon].tier;
    this.spawnTimer = 110 - tier * 14 + Math.floor(this.rand() * 70);
    const x = this.camX + this.viewW + 6;
    const cx = Math.floor(x / TILE);
    for (let cy = 2; cy < this.map.rows.length; cy++) {
      const c = this.map.at(cx, cy);
      if (c === '#' || c === '=' || c === 'b') {
        if (this.map.at(cx, cy - 1) !== '.') break;
        this.enemies.push(this.makeEnemy('soldier', x, cy * TILE - 40, { shooter: this.rand() < 0.35, cool: 30 + Math.floor(this.rand() * 60) }));
        return;
      }
    }
  }

  // ---------- Enemies ----------
  private aimAt(e: Enemy, snap: number) {
    const p = this.player;
    const a = Math.atan2(p.y + p.h / 2 - (e.y + e.h / 2), p.x + p.w / 2 - (e.x + e.w / 2));
    return Math.round(a / snap) * snap;
  }

  private enemyShot(x: number, y: number, a: number, speed: number, size = 6) {
    this.bullets.push({ x: x - size / 2, y: y - size / 2, w: size, h: size, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 300, enemy: true, down: false, dmg: 1, pierce: false, weapon: 'E', hits: null });
  }

  private onScreen(e: Box, pad = 0) { return e.x + e.w > this.camX - pad && e.x < this.camX + this.viewW + pad; }

  private stepEnemies() {
    const p = this.player, alive = p.dead === 0 && !this.cleared;
    for (const e of this.enemies) {
      if (e.flash > 0) e.flash--;
      e.t++;
      switch (e.kind) {
        case 'soldier': {
          e.vy = Math.min(MAX_FALL, e.vy + GRAV * DT);
          const stopped = e.tell > 0;
          if (stopped) {
            if (--e.tell === 0) { this.enemyShot(e.x + e.w / 2 + e.dir * 18, e.y + 12, e.dir > 0 ? 0 : Math.PI, 190); this.events.push('eshot'); }
          } else if (e.shooter && alive && --e.cool <= 0 && this.onScreen(e, -40)) {
            e.shooter = false; e.tell = 22; e.dir = p.x > e.x ? 1 : -1; // stop, face, telegraph
          }
          const hit = moveBox(this.map, e, stopped ? 0 : e.vx * DT, e.vy * DT);
          if (hit.bottom) {
            e.vy = 0; e.onGround = true;
            // Reaching a ledge: sometimes hop, otherwise walk off.
            const ahead = Math.floor((e.x + (e.vx > 0 ? e.w + 4 : -4)) / TILE), below = Math.floor((e.y + e.h + 4) / TILE);
            if (!stopped && this.map.at(ahead, below) === '.' && this.rand() < 0.03) e.vy = -380;
          }
          if (hit.left || hit.right) e.vx = -e.vx;
          if (!stopped) e.dir = Math.sign(e.vx) || e.dir;
          if (e.x < this.camX - 60 || e.y > this.map.heightPx) e.dead = true;
          break;
        }
        case 'sniper': {
          e.dir = p.x > e.x ? 1 : -1;
          if (!alive || !this.onScreen(e, -10)) break;
          if (e.tell > 0) {
            if (--e.tell === 0) e.burst = 3;
          } else if (e.burst > 0) {
            if (e.t % 8 === 0) { this.enemyShot(e.x + e.w / 2 + e.dir * 20, e.y + 12, this.aimAt(e, Math.PI / 4), 180); e.burst--; this.events.push('eshot'); }
          } else if (--e.cool <= 0) { e.cool = 130 + Math.floor(this.rand() * 60); e.tell = 24; }
          break;
        }
        case 'turret': case 'box': case 'bossgun': {
          e.dir = p.x > e.x + e.w / 2 ? 1 : -1;
          if (!alive || !this.onScreen(e, -8)) break;
          if (e.kind === 'bossgun' && !this.bossSpawned) break; // arena guns wake with the boss, not while you walk in
          if (e.tell > 0) {
            if (--e.tell === 0) e.burst = e.kind === 'turret' ? 1 : 3;
          } else if (e.burst > 0) {
            if (e.t % 9 === 0) {
              const a = e.kind === 'turret' ? this.aimAt(e, Math.PI / 6) : e.kind === 'bossgun' ? this.aimAt(e, Math.PI / 8) : e.dir > 0 ? 0 : Math.PI;
              this.enemyShot(e.x + e.w / 2 + Math.cos(a) * 20, e.y + (e.kind === 'turret' ? 10 : 16) + Math.sin(a) * 8, a, e.kind === 'turret' ? 160 : 175);
              e.burst--; this.events.push('eshot');
            }
          } else if (--e.cool <= 0) { e.cool = e.kind === 'turret' ? 80 : 120; e.tell = 26; }
          break;
        }
        case 'carrier': {
          e.x += e.vx * DT;
          e.y = e.baseY + Math.sin(e.t * 0.06) * 26;
          if (e.x > this.camX + this.viewW + 60) e.dead = true;
          break;
        }
        case 'drone': {
          // Swoop: cruise in, then dive toward the player once.
          if (e.state === '' && e.x < this.camX + this.viewW - 80) { e.state = 'dive'; const a = this.aimAt(e, 0.001); e.vx = Math.cos(a) * 170; e.vy = Math.sin(a) * 170; }
          if (e.state === '') { e.x += e.vx * DT; e.y = e.baseY + Math.sin(e.t * 0.08) * 16; }
          else { e.x += e.vx * DT; e.y += e.vy * DT; }
          if (e.x < this.camX - 60 || e.y > this.map.heightPx || e.y < -80 || e.x > this.camX + this.viewW + 200) e.dead = true;
          break;
        }
        case 'boss': this.stepBoss(e); break;
      }
      // Static enemies left behind the forward-only camera are gone for good.
      if ((e.kind === 'sniper' || e.kind === 'turret' || e.kind === 'box') && e.x + e.w < this.camX - 100) e.dead = true;
      const touchBox = e.kind === 'boss' ? { x: e.x + 30, y: e.y + 20, w: e.w - 60, h: e.h - 20 } : e;
      const fixture = e.kind === 'carrier' || e.kind === 'turret' || e.kind === 'box' || e.kind === 'bossgun'; // scenery guns: only their bullets hurt
      if (!e.dead && alive && !fixture && overlap(touchBox, p)) this.hurtPlayer();
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  // ---------- Boss (dragon in 3D, mech in classic): hover, aimed bursts, leap + shockwave ----------
  private spawnBoss() {
    this.bossSpawned = true;
    const groundY = GROUND_ROW * TILE;
    const b = this.makeEnemy('boss', this.arenaX + this.viewW - 230, groundY - 200);
    b.dir = -1;
    this.enemies.push(b);
    this.events.push('bossIntro');
    this.shake(0.5);
  }

  // Where boss shots spawn (the classic sprite's cannon tip; the 3D renderer draws them leaving the dragon's mouth).
  bossMuzzle(b: Enemy) { return { x: b.dir < 0 ? b.x - 11 : b.x + b.w + 11, y: b.y + 72 }; }

  bossShielded() { return this.enemies.some((e) => e.kind === 'bossgun'); }

  private stepBoss(b: Enemy) {
    const p = this.player, alive = p.dead === 0;
    const hpPct = b.hp / b.maxHp;
    const groundY = GROUND_ROW * TILE - b.h;
    b.dir = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
    if (hpPct < 0.5 && this.frame % 6 === 0) this.particles.push({ x: b.x + 40 + ((this.frame * 37) % (b.w - 80)), y: b.y + 30, vx: 0, vy: -40, life: 40, max: 40, color: 0x444444, size: 5, grav: -10 });
    if (b.state === 'intro') { if (b.t > 70) { b.state = 'idle'; b.cool = 40; } return; }
    if (b.state === 'jump') {
      b.vy += GRAV * 0.8 * DT;
      b.x += b.vx * DT; b.y += b.vy * DT;
      b.x = Math.max(this.arenaX + 30, Math.min(this.arenaX + this.viewW - b.w - 30, b.x));
      if (b.y >= groundY && b.vy > 0) {
        b.y = groundY; b.state = 'idle'; b.cool = 60;
        this.shake(0.7); this.hitstop(4); this.events.push('stomp');
        this.dust(b.x + b.w / 2, b.y + b.h, 16);
        const fy = GROUND_ROW * TILE - 14;
        this.shocks.push({ x: b.x + 10, y: fy, w: 22, h: 14, vx: -260, life: 150 }, { x: b.x + b.w - 30, y: fy, w: 22, h: 14, vx: 260, life: 150 });
      }
      return;
    }
    if (b.state === 'tell') {
      if (--b.tell === 0) { b.state = 'fire'; b.burst = 3; }
      return;
    }
    if (b.state === 'fire') {
      if (b.t % (hpPct < 0.25 ? 7 : 10) === 0 && alive) {
        const { x: mx, y: my } = this.bossMuzzle(b);
        const a = Math.atan2(p.y + p.h / 2 - my, p.x + p.w / 2 - mx);
        if (hpPct < 0.25) for (const o of [-0.25, 0, 0.25]) this.enemyShot(mx, my, a + o, 200, 9);
        else this.enemyShot(mx, my, a, 200, 9);
        this.events.push('bossShot'); this.shake(0.1);
        b.burst--;
      }
      if (b.burst <= 0) { b.state = 'idle'; b.cool = hpPct < 0.25 ? 50 : 80; }
      return;
    }
    // idle: pick next attack
    if (--b.cool > 0) return;
    const r = this.rand();
    if (hpPct < 0.6 && r < 0.35) {
      b.state = 'jump'; b.vy = -620; b.vx = (p.x - (b.x + b.w / 2)) * 0.9; this.events.push('bossJump');
    } else if (r < 0.55 && this.enemies.filter((e) => e.kind === 'drone').length < 2) {
      for (let i = 0; i < 2; i++) this.enemies.push(this.makeEnemy('drone', this.camX + this.viewW + 20 + i * 50, 60 + i * 50, { baseY: 60 + i * 50 }));
      b.cool = 70;
    } else {
      b.state = 'tell'; b.tell = hpPct < 0.25 ? 20 : 32;
    }
  }

  // ---------- Bullets ----------
  private stepBullets() {
    const p = this.player;
    for (const b of this.bullets) {
      b.x += b.vx * DT; b.y += b.vy * DT; b.life--;
      const cx = Math.floor((b.x + b.w / 2) / TILE), cy = Math.floor((b.y + b.h / 2) / TILE);
      // Contra rule: your downward shots pass through terrain, so diagonal-down works from cliffs.
      if (this.map.solid(cx, cy) && (b.enemy || !b.down)) { b.life = 0; this.sparks(b.x + b.w / 2, b.y + b.h / 2, 3, b.enemy ? 0xff8af5 : 0xffe08a); continue; }
      if (b.x < this.camX - 24 || b.x > this.camX + this.viewW + 24 || b.y < -40 || b.y > this.map.heightPx) { b.life = 0; continue; }
      if (b.enemy) {
        if (p.dead === 0 && overlap(b, { x: p.x + 3, y: p.y + 6, w: p.w - 6, h: p.h - 8 })) {
          if (p.barrier > 0) { b.life = 0; this.sparks(b.x, b.y, 5, 0x9ff3ff); continue; }
          if (p.iframes === 0) { b.life = 0; this.hurtPlayer(); }
        }
        continue;
      }
      for (const e of this.enemies) {
        if (e.dead || (b.hits && b.hits.has(e.id))) continue;
        const hb = e.kind === 'boss' ? { x: e.x + 30, y: e.y + 10, w: e.w - 60, h: e.h - 20 } : e;
        if (!overlap(b, hb)) continue;
        if (b.hits) b.hits.add(e.id); else b.life = 0;
        if (e.kind === 'boss' && (this.bossShielded() || e.state === 'intro')) {
          this.sparks(b.x + b.w / 2, b.y + b.h / 2, 3, 0x9ff3ff); this.events.push('clink'); break;
        }
        this.hits++;
        e.hp -= b.dmg; e.flash = 3;
        if (e.kind === 'soldier' || e.kind === 'sniper') e.x += Math.sign(b.vx) * 2;
        this.sparks(b.x + b.w / 2, b.y + b.h / 2, 3, 0xffffff);
        this.events.push('hit');
        if (e.hp <= 0) this.killEnemy(e, Math.sign(b.vx) || 1);
        break;
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  private killEnemy(e: Enemy, dir: number) {
    if (e.kind === 'boss' && this.bossDead > 0) return;
    if (e.kind !== 'boss') e.dead = true; // the boss stays alive for its death sequence (stepFx removes it)
    this.kills++; this.streak++;
    this.combo++; this.comboTimer = COMBO_WINDOW; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.events.push(`kill:${this.combo}`); // renderer raises the kill-sound pitch with the combo
    const mult = this.multiplier();
    const pts: Record<EnemyKind, number> = { soldier: 100, sniper: 200, turret: 500, box: 800, carrier: 100, drone: 300, bossgun: 1500, boss: 20000 };
    const gained = Math.round(pts[e.kind] * mult);
    this.score += gained;
    this.popup(e.x + e.w / 2, e.y, gained);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    if (e.kind === 'soldier' || e.kind === 'sniper') {
      // Contra-style: body flies back, then pops.
      this.corpses.push({ id: this.nextId++, x: cx, y: e.y + e.h, vx: dir * 90, vy: -260, t: 0, frame: 'sol_hurt', flip: dir > 0 });
      this.hitstop(2); this.shake(0.12);
      this.events.push('die');
      return;
    }
    if (e.kind === 'carrier') {
      this.pickups.push({ id: this.nextId++, x: cx - 9, y: cy - 9, w: 18, h: 18, letter: e.letter, vx: 70, vy: -260, t: 0 });
      this.explode(cx, cy, 14); this.hitstop(3); this.events.push('boom');
      return;
    }
    if (e.kind === 'boss') {
      this.bossDead = 1;
      this.bullets = this.bullets.filter((b) => !b.enemy);
      for (const d of this.enemies) if (d.kind === 'drone') { d.dead = true; this.explode(d.x + 15, d.y + 15, 10); }
      this.hitstop(20); this.shake(1);
      this.events.push('bigboom');
      return;
    }
    const big = e.kind === 'box' || e.kind === 'bossgun' || e.kind === 'turret';
    this.hitstop(big ? 6 : 3);
    this.shake(big ? 0.45 : 0.2);
    this.explode(cx, cy, big ? 28 : 14);
    this.events.push(big ? 'bigboom' : 'boom');
    if (e.kind === 'bossgun' && !this.bossShielded()) this.events.push('shieldDown');
  }

  // Combo: kills chained within 1.5 s. Every 5 in a row adds x0.5, up to x4.
  multiplier() { return Math.min(4, 1 + Math.floor(this.combo / 5) * 0.5); }

  // Popups close in time and space merge into one bigger number (bigger reads as more rewarding).
  private popup(x: number, y: number, value: number) {
    const near = this.popups.find((q) => q.t < 12 && Math.abs(q.x - x) < 60 && Math.abs(q.y - y) < 60);
    if (near) { near.value += value; near.t = 0; near.tier = this.tier(near.value); return; }
    this.popups.push({ x, y, value, t: 0, tier: this.tier(value) });
  }
  private tier(v: number) { return v >= 5000 ? 3 : v >= 1000 ? 2 : v >= 400 ? 1 : 0; }

  // Stage results: base score + bonuses, the rank, and an honest gap to the next rank.
  results() {
    const secs = Math.floor(this.frame / 60), acc = this.shots ? Math.min(100, Math.round((this.hits / this.shots) * 100)) : 0;
    const lines = [
      { label: 'SCORE', value: this.score, max: 0, tip: '' },
      { label: 'TIME BONUS', value: Math.max(0, 300 - secs) * 100, max: 30000, tip: 'finish faster (every second = 100)' },
      { label: 'NO-DEATH BONUS', value: this.deaths === 0 ? 20000 : 0, max: 20000, tip: 'clear it without dying' },
      { label: `ACCURACY ${acc}%`, value: acc * 200, max: 20000, tip: 'land more shots (every 1% = 200)' },
      { label: `MAX COMBO ${this.maxCombo}`, value: this.maxCombo * 300, max: 12000, tip: 'chain kills within 1.5 s' },
    ];
    const total = lines.reduce((a, l) => a + l.value, 0);
    const i = RANKS.findIndex(([, min]) => total >= min);
    const next = i > 0 ? RANKS[i - 1] : null;
    const weakest = lines.slice(1).sort((a, b) => (b.max - b.value) - (a.max - a.value))[0];
    return { lines, total, rank: RANKS[i][0], next: next && { rank: next[0], gap: next[1] - total, tip: weakest.tip } };
  }

  // ---------- Player damage ----------
  private hurtPlayer() {
    const p = this.player;
    if (p.dead > 0 || p.iframes > 0) return;
    if (p.barrier > 0) return;
    this.killPlayer(false);
  }

  private killPlayer(fell: boolean) {
    const p = this.player;
    if (p.dead > 0) return;
    p.dead = 60;
    p.lives--; this.deaths++; this.streak = 0;
    if (this.combo >= 5) this.events.push('comboEnd');
    this.combo = this.comboTimer = 0;
    p.slots[p.cur] = 'R'; // Contra III: lose only the gun in hand
    this.hitstop(10);
    this.shake(0.6);
    if (!fell) {
      this.corpses.push({ id: this.nextId++, x: p.x + p.w / 2, y: p.y + p.h, vx: -p.facing * 80, vy: -300, t: 0, frame: p.plush ? 'muse_hurt' : 'hero_hurt', flip: p.facing < 0 });
      this.explode(p.x + p.w / 2, p.y + p.h / 2, 12);
    }
    this.events.push('death');
  }

  private respawn() {
    const p = this.player;
    if (p.lives < 0) { this.gameOver = true; return; }
    // Rebuild blown bridges on screen or ahead, otherwise a wide river becomes impassable.
    const from = this.camX - TILE;
    this.bridgeFuse = this.bridgeFuse.filter((f) => f.cx * TILE < from - 8 * TILE);
    for (const { cx, cy } of this.bridgeTiles) {
      if (cx * TILE < from) continue;
      const row = this.map.rows[cy];
      this.map.rows[cy] = row.slice(0, cx) + 'b' + row.slice(cx + 1);
    }
    // Drop back in on the current screen, on solid ground (no respawning into a pit).
    let x = this.camX + 70;
    for (let tries = 0; tries < 12; tries++) {
      const cx = Math.floor((x + p.w / 2) / TILE);
      if (this.map.solid(cx, GROUND_ROW) || this.map.at(cx, GROUND_ROW) === 'b') break;
      x += TILE;
    }
    p.x = p.px = x; p.y = p.py = -10; p.vx = 0; p.vy = 0;
    p.onGround = false; p.coyote = 0; p.buffer = 0;
    p.h = STAND_H; p.prone = false; p.iframes = RESPAWN_IFRAMES; p.somersault = false;
    this.bullets = this.bullets.filter((b) => !b.enemy);
    this.events.push('respawn');
  }

  // ---------- Pickups ----------
  private stepPickups() {
    const p = this.player;
    for (const k of this.pickups) {
      k.t++;
      k.vy = Math.min(MAX_FALL, k.vy + GRAV * 0.7 * DT);
      const hit = moveBox(this.map, k, k.vx * DT, k.vy * DT);
      if (hit.bottom) k.vy = -220; // bounces along like Contra's falcons
      if (hit.left || hit.right) k.vx = -k.vx;
      if (p.dead === 0 && overlap(k, p)) { this.collect(k.letter); k.t = -1; }
      if (k.x > this.camX + this.viewW + 20 || k.y > this.map.heightPx) k.t = -1;
    }
    this.pickups = this.pickups.filter((k) => k.t >= 0);
  }

  private collect(letter: string) {
    const p = this.player;
    this.score += 500;
    this.events.push('pickup');
    if (letter === 'B') { p.barrier = BARRIER_FRAMES; return; }
    const w = letter as WeaponId;
    if (p.slots[p.cur] === 'R') p.slots[p.cur] = w;
    else if (p.slots[1 - p.cur] === 'R') p.slots[1 - p.cur] = w;
    else p.slots[p.cur] = w;
  }

  // ---------- Exploding bridges (Contra stage 1) ----------
  private lightBridge(cx: number, cy: number) {
    let x0 = cx;
    while (this.map.at(x0 - 1, cy) === 'b') x0--;
    if (this.bridgeFuse.some((f) => f.cy === cy && Math.abs(f.cx - x0) < 12)) return; // one fuse per bridge
    this.bridgeFuse.push({ cx: x0, cy, t: 0 });
  }

  private stepBridges() {
    for (const f of this.bridgeFuse) {
      f.t++;
      if (f.t % 32 !== 0) continue; // 2 tiles per 32 frames: just slower than running, so it chases you
      const seg = f.cx + (f.t / 32 - 1) * 2;
      let blown = 0;
      for (const cx of [seg, seg + 1]) {
        if (this.map.at(cx, f.cy) !== 'b') continue;
        const row = this.map.rows[f.cy];
        this.map.rows[f.cy] = row.slice(0, cx) + '.' + row.slice(cx + 1);
        this.explode(cx * TILE + 16, f.cy * TILE + 8, 18);
        blown++;
      }
      if (!blown) { f.t = -1; continue; } // reached the far end: fuse is done
      this.shake(0.3);
      this.events.push('boom');
    }
    this.bridgeFuse = this.bridgeFuse.filter((f) => f.t >= 0);
  }

  private stepShocks() {
    const p = this.player;
    for (const s of this.shocks) {
      s.x += s.vx * DT; s.life--;
      if (this.frame % 3 === 0) this.dust(s.x + s.w / 2, s.y + s.h, 1);
      if (p.dead === 0 && p.iframes === 0 && p.barrier === 0 && overlap(s, p)) this.hurtPlayer();
      if (s.x < this.camX - 40 || s.x > this.camX + this.viewW + 40) s.life = 0;
    }
    this.shocks = this.shocks.filter((s) => s.life > 0);
  }

  // ---------- Effects ----------
  private stepFx() {
    if (this.comboTimer > 0 && --this.comboTimer === 0) {
      if (this.combo >= 5) this.events.push('comboEnd'); // soft "drop" sound, no penalty
      this.combo = 0;
    }
    for (const q of this.popups) q.t++;
    this.popups = this.popups.filter((q) => q.t < 50);
    for (const b of this.blasts) b.t++;
    this.blasts = this.blasts.filter((b) => b.t < b.max);
    for (const q of this.particles) { q.vy += q.grav * DT; q.x += q.vx * DT; q.y += q.vy * DT; q.life--; }
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const c of this.corpses) {
      c.t++; c.vy += GRAV * DT; c.x += c.vx * DT; c.y += c.vy * DT;
      if (c.t === 34) { this.explode(c.x, c.y - 20, 10); this.events.push('pop'); }
    }
    this.corpses = this.corpses.filter((c) => c.t < 34);
    if (this.bossDead > 0 && !this.cleared) {
      const b = this.enemies.find((e) => e.kind === 'boss');
      this.bossDead++;
      if (b && this.bossDead % 7 === 0) {
        this.explode(b.x + 20 + this.rand() * (b.w - 40), b.y + 20 + this.rand() * (b.h - 40), 22);
        this.shake(0.35); this.events.push('boom');
      }
      if (this.bossDead > 150) {
        if (b) { b.dead = true; this.explode(b.x + b.w / 2, b.y + b.h / 2, 80); }
        this.shake(1); this.hitstop(12);
        this.events.push('bigboom', 'clear');
        this.cleared = true;
      }
    }
  }

  sparks(x: number, y: number, n: number, color: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, s = 60 + this.rand() * 100;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 6 + ((this.rand() * 6) | 0), max: 12, color, size: 2, grav: 0 });
    }
  }

  dust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const s = (i % 2 ? 1 : -1) * (20 + this.rand() * 50);
      this.particles.push({ x, y: y - 2, vx: s, vy: -10 - this.rand() * 25, life: 18, max: 18, color: 0xcdbf9a, size: 3, grav: 30 });
    }
  }

  splash(x: number, y: number) {
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + (this.rand() - 0.5) * 1.4, s = 120 + this.rand() * 160;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 30, max: 30, color: i % 2 ? 0x9fe3ff : 0xffffff, size: 3, grav: 700 });
    }
    this.events.push('splash');
  }

  explode(x: number, y: number, n: number) {
    this.blasts.push({ x, y, r: 8 + n * 1.6, t: 0, max: n > 30 ? 26 : 16 });
    const colors = [0xffffff, 0xfff1a8, 0xffc247, 0xff7a2e, 0xe03c28, 0x5a4a44];
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, s = 30 + this.rand() * (80 + n * 4);
      const life = 16 + ((this.rand() * 24) | 0);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life, max: life, color: colors[i % colors.length], size: 2 + ((this.rand() * 4) | 0), grav: 160 });
    }
  }
}
