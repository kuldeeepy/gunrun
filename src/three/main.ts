import { Input } from '../core/Input';
import { Audio } from '../core/Audio';
import { Fx } from '../core/Fx';
import { Settings, THEMES } from '../core/Settings';
import { World } from '../sim/World';
import { WEAPONS } from '../sim/weapons';
import { STAGE1 } from '../levels/stage1';
import { Stage3D } from './Stage3D';
import { CHARACTERS } from './characters';

const STEP_MS = 1000 / 60, MAX_STEPS = 5;
const $ = (id: string) => document.getElementById(id)!;
const canvas = $('c') as HTMLCanvasElement;
const stage = new Stage3D(canvas);
const world = World.get();
const fx = Fx.get();
const settings = Settings.get();
const prev = new Map<number, { x: number; y: number }>(); // last-tick enemy positions for interpolation
let state: 'loading' | 'title' | 'play' = 'loading', paused = false, acc = 0, last = performance.now(), clearAt = 0;
let pickRow = 0, tallyStarted = false;

Input.get().bindDom();
if (import.meta.env.DEV) Object.assign(window, { world, stage, settings });
const fit = () => { const r = canvas.getBoundingClientRect(); stage.resize(Math.round(r.width), Math.round(r.height)); };
new ResizeObserver(fit).observe(canvas);

function start(checkpoint = 0) {
  world.load(STAGE1, 640, checkpoint);
  if (!checkpoint) Object.assign(world, { score: 0, deaths: 0, kills: 0, shots: 0, hits: 0, maxCombo: 0 });
  stage.build();
  prev.clear(); clearAt = 0; paused = false; tallyStarted = false;
  $('results').style.display = 'none';
  banner(checkpoint ? 'CONTINUE' : 'STAGE 1 — THE JUNGLE');
  Audio.get().startMusic();
}

let bannerTimer = 0;
function banner(text: string) {
  const b = $('banner'); b.textContent = text; b.style.opacity = '1';
  clearTimeout(bannerTimer); bannerTimer = window.setTimeout(() => (b.style.opacity = '0'), 1800);
}

// ---------- Title: character + time-of-day pickers ----------
function drawPicks() {
  $('pick0').innerHTML = `<span>SOLDIER</span><span>◀ ${CHARACTERS[settings.hero3d]?.name ?? ''} ▶</span>`;
  $('pick1').innerHTML = `<span>TIME</span><span>◀ ${settings.themeDef.name} ▶</span>`;
  $('pick0').classList.toggle('on', pickRow === 0); $('pick1').classList.toggle('on', pickRow === 1);
}
function change(d: number) {
  if (pickRow === 0) { settings.hero3d = (settings.hero3d + d + CHARACTERS.length) % CHARACTERS.length; stage.setHero(); }
  else { settings.theme = (settings.theme + d + THEMES.length) % THEMES.length; stage.build(); }
  settings.save(); Audio.get().unlock(); Audio.get().play('swap'); drawPicks();
}

window.addEventListener('keydown', (e) => {
  if (state === 'title') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { pickRow = 1 - pickRow; drawPicks(); }
    else if (e.key === 'ArrowLeft') change(-1);
    else if (e.key === 'ArrowRight') change(1);
    else if (e.key === 'Enter' || e.key === ' ') { Audio.get().unlock(); $('title').remove(); state = 'play'; start(); }
  } else if (state === 'play') {
    if (e.key === 'Escape' && !world.cleared && !world.gameOver) paused = !paused;
    if (e.key === 'Enter' && world.gameOver) start(world.checkpointX);
    else if (e.key === 'Enter' && world.cleared && !($('again') as HTMLElement).hidden) start();
  }
});
window.addEventListener('blur', () => { if (state === 'play' && !world.cleared && !world.gameOver) paused = true; });

// ---------- Score popups (DOM, projected from the 3D scene) ----------
const popEls = new Map<object, HTMLDivElement>();
const TIER_STYLE = [['#ffffff', 2.2], ['#ffe27a', 2.8], ['#ffb03a', 3.6], ['#ff5ad0', 5]] as const;
function popups(alpha: number) {
  const live = new Set<object>();
  for (const q of world.popups) {
    live.add(q);
    let el = popEls.get(q);
    if (!el) { el = document.createElement('div'); el.className = 'pop'; $('pops').appendChild(el); popEls.set(q, el); }
    const { fx: px, fy } = stage.project(q.x, q.y - (q.t + alpha) * 0.8);
    const [color, size] = TIER_STYLE[q.tier];
    const pop = q.t < 6 ? 1 + (6 - q.t) * 0.08 : 1; // quick scale punch when it appears/merges
    el.textContent = `+${q.value.toLocaleString()}`;
    el.style.cssText = `left:${px * 100}%;top:${fy * 100}%;color:${color};font-size:${size * pop}vmin;opacity:${Math.min(1, (50 - q.t) / 15)}`;
  }
  for (const [q, el] of popEls) if (!live.has(q)) { el.remove(); popEls.delete(q); }
}

// ---------- Results: count-up tally, pause, rank stamp, honest next-rank tip ----------
async function tally() {
  tallyStarted = true;
  const r = world.results(), rows = $('rows');
  rows.innerHTML = '';
  $('results').style.display = 'flex';
  $('rank').className = ''; $('rank').textContent = r.rank; $('tip').style.opacity = '0'; ($('again') as HTMLElement).hidden = true;
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  for (const [i, l] of [...r.lines, { label: 'TOTAL', value: r.total }].entries()) {
    const row = document.createElement('div');
    row.className = 'row' + (l.label === 'TOTAL' ? ' total' : '');
    row.innerHTML = `<span>${l.label}</span><span>0</span>`;
    rows.appendChild(row);
    await wait(60); row.classList.add('show');
    const target = l.label === 'TOTAL' ? r.total : l.value, span = row.lastElementChild!;
    for (let k = 1; k <= 12; k++) { span.textContent = Math.round((target * k) / 12).toLocaleString(); if (k % 3 === 0) Audio.get().play(`tick:${i * 2 + k / 3}`); await wait(28); }
    await wait(220);
  }
  await wait(450); // anticipation beat before the reveal
  $('rank').className = 'show';
  Audio.get().play(r.rank === 'S' ? 'rankS' : 'stamp');
  fx.addTrauma(r.rank === 'S' ? 0.6 : 0.3);
  if (r.next) { $('tip').textContent = `${r.next.rank} rank: +${r.next.gap.toLocaleString()} pts — ${r.next.tip}`; $('tip').style.opacity = '1'; }
  await wait(600);
  ($('again') as HTMLElement).hidden = false;
}

function hud(alpha: number) {
  const p = world.player, secs = Math.floor(world.frame / 60), mult = world.multiplier();
  $('lives').textContent = '■'.repeat(Math.max(0, p.lives));
  $('time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  $('score').textContent = `${String(world.score).padStart(7, '0')}${mult > 1 ? `  ×${mult}` : ''}`;
  const combo = world.combo >= 3 ? `${world.combo} COMBO` : '';
  if ($('combo').textContent !== combo) { $('combo').textContent = combo; $('combo').style.transform = 'scale(1.25)'; setTimeout(() => ($('combo').style.transform = ''), 80); }
  const slots = p.slots.map((id, i) => `<div class="${i === p.cur ? 'on' : ''}">${id === 'R' ? 'RIFLE' : `${id} ${WEAPONS[id].name}`}</div>`).join('');
  if ($('slots').innerHTML !== slots) $('slots').innerHTML = slots;
  const over = paused ? 'PAUSED\n\nEsc to resume' : world.gameOver ? 'GAME OVER\n\nEnter — continue from checkpoint' : '';
  if ($('overlay').textContent !== over) $('overlay').textContent = over;
  if (world.cleared && clearAt && world.frame > clearAt + 90 && !tallyStarted) void tally();
  popups(alpha);
}

function frameOnce(now: number) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // never negative (clock jumps), never > 100 ms
  last = Math.max(last, now);
  if (state === 'play' && !paused) {
    acc += dt * 1000;
    let steps = 0;
    while (acc >= STEP_MS && steps < MAX_STEPS) {
      acc -= STEP_MS; steps++;
      prev.clear();
      for (const e of world.enemies) prev.set(e.id, { x: e.x, y: e.y });
      Input.get().poll();
      if (!world.gameOver) world.step(Input.get().held);
    }
    if (steps === MAX_STEPS) acc = 0;
    for (const e of world.events) {
      Audio.get().play(e);
      if (e === 'checkpoint') banner('CHECKPOINT');
      if (e === 'bossIntro') banner('WARNING — JUNGLE DRAGON');
      if (e === 'shieldDown') banner('SHIELD DOWN!');
      if (e === 'clear') clearAt = world.frame;
    }
    world.events.length = 0;
    fx.addTrauma(world.trauma); world.trauma = 0;
  }
  fx.trauma = Math.max(0, fx.trauma - dt / 0.6);
  if (state !== 'loading') {
    const alpha = world.freeze > 0 || paused ? 1 : acc / STEP_MS;
    stage.render(alpha, paused ? 0 : dt, fx.trauma * fx.shakeScale, prev, state === 'title');
    if (state === 'play') hud(alpha);
  }
}
function frame(now: number) { frameOnce(now); requestAnimationFrame(frame); }

stage.load((f) => ($('loading').textContent = `loading models… ${Math.round(f * 100)}%`)).then(() => {
  world.load(STAGE1, 640, 0);
  stage.build(); // the level is visible behind the title, camera on the chosen character
  fit();
  $('loading').hidden = true;
  ($('title').querySelector('.go') as HTMLElement).hidden = false;
  drawPicks();
  state = 'title';
});
requestAnimationFrame(frame);
if (import.meta.env.DEV) Object.assign(window, { stepFrames: (n: number) => { let t = last; for (let i = 0; i < n; i++) { t += STEP_MS; frameOnce(t); } } });
