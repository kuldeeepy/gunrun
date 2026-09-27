// Dev playtest bot. Paste/run in the browser console on the dev server (needs window.world + stepFrames).
// window.bot.run(n) advances n frames with bot input and returns a summary; call repeatedly.
window.bot = (() => {
  const codes = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', J: 'KeyZ', F: 'KeyX' };
  const held = new Set(), log = [], errors = [];
  let lastX = 0, stuck = 0, jumpCool = 0, spikes = 0, worst = 0, maxE = 0, maxB = 0, maxP = 0, continues = 0, lastLog = '';
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: code, code, bubbles: true }));
  const setKeys = (want) => { for (const c of Object.keys(codes)) { const on = want.has(c); if (on !== held.has(c)) { key(codes[c], on); on ? held.add(c) : held.delete(c); } } };
  const add = (s) => { if (s !== lastLog) log.push(`[${world.frame}] ${s}`); lastLog = s; };
  function run(n) {
    const T = 32, map = world.map;
    if (document.getElementById('overlay')?.textContent.startsWith('PAUSED')) { key('Escape', true); stepFrames(1); } // auto-paused by tool focus changes
    for (let f = 0; f < n; f++) {
      const p = world.player, want = new Set(['F']);
      if (world.gameOver) { add(`GAMEOVER x=${Math.round(p.x)} cp=${world.checkpointX}`); if (continues++ > 4) break; key('Enter', true); stepFrames(2); continue; }
      if (world.cleared) { add('CLEARED'); stepFrames(1); continue; }
      const cx = p.x + p.w / 2, feet = p.y + p.h, boss = world.enemies.find((e) => e.kind === 'boss');
      if (boss) { const bx = boss.x + boss.w / 2; if (bx - cx > 260) want.add('R'); else if (p.facing < 0) want.add('R'); } else want.add('R'); // face the boss, hold ground
      let best = null, bd = 1e9;
      for (const e of world.enemies) { const d = Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - p.y); if (d < bd && e.x + e.w > world.camX && e.x < world.camX + 640) { bd = d; best = e; } }
      if (best) {
        const dy = best.y + best.h / 2 - (p.y + 10), dx = best.x + best.w / 2 - cx;
        if (dy < -40) want.add('U');
        if (dy < -40 && Math.abs(dx) < 50) { want.delete('R'); want.delete('L'); }
        if (dy > 50 && !p.onGround) want.add('D');
      }
      const ahead = Math.floor((cx + 40) / T), row = Math.floor((feet + 4) / T);
      const pit = p.onGround && !map.solid(ahead, row) && !map.oneWay(ahead, row);
      const wall = map.solid(Math.floor((cx + 20) / T), Math.floor((feet - 20) / T));
      const blocker = world.enemies.some((e) => !['drone', 'carrier', 'boss'].includes(e.kind) && e.x - cx > 0 && e.x - cx < 60 && Math.abs(e.y + e.h - feet) < 20);
      const danger = world.bullets.some((b) => b.enemy && Math.abs(b.x - cx) < 70 && b.y > p.y && b.y < feet);
      if (--jumpCool <= 0 && (pit || wall || blocker || danger || world.shocks.some((s) => Math.abs(s.x - cx) < 90))) { want.add('J'); jumpCool = 18; }
      if (!p.onGround && p.vy < 0) want.add('J');
      setKeys(want);
      const t0 = performance.now(); stepFrames(1); const dt = performance.now() - t0;
      if (dt > 12) spikes++; worst = Math.max(worst, dt);
      if (dt > 25) add(`SPIKE ${dt.toFixed(0)}ms enemies=${world.enemies.map((e) => e.kind).join(',')} blasts=${world.blasts.length} particles=${world.particles.length}`);
      if (p.dead === 59) {
        const near = world.bullets.filter((b) => b.enemy && Math.hypot(b.x - cx, b.y - p.y - 20) < 50).length;
        const touching = world.enemies.filter((e) => Math.abs(e.x + e.w / 2 - cx) < 50 && Math.abs(e.y - p.y) < 60).map((e) => e.kind).join('/');
        add(`DIED x=${Math.round(p.x)} y=${Math.round(p.y)} fell=${p.y > 300} bulletsNear=${near} touching=${touching}`);
      }
      if (Math.abs(p.x - lastX) < 0.5 && !boss && p.dead === 0) { if (++stuck === 240) add(`STUCK x=${Math.round(p.x)} y=${Math.round(p.y)}`); } else stuck = 0;
      lastX = p.x;
      maxE = Math.max(maxE, world.enemies.length); maxB = Math.max(maxB, world.bullets.length); maxP = Math.max(maxP, world.particles.length);
    }
    return { x: Math.round(world.player.x), frame: world.frame, cleared: world.cleared, deaths: world.deaths, score: world.score, kills: world.kills, maxE, maxB, maxP, spikes, worst: +worst.toFixed(1), errors: errors.slice(0, 5), log: log.slice(-25) };
  }
  return { run, stop: () => setKeys(new Set()) };
})();
