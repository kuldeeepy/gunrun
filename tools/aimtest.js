// Dev check: barrel direction vs actual bullet direction, frame by frame, across input sequences.
// Usage (dev server, in-game): await import('/tools/aimtest.js'); await aimTest()
window.aimTest = async function () {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const codes = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', J: 'KeyZ', F: 'KeyX', C: 'KeyC' };
  const held = new Set();
  const set = (keys) => { for (const [c, code] of Object.entries(codes)) { const on = keys.includes(c); if (on !== held.has(c)) { window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { key: code, code, bubbles: true })); on ? held.add(c) : held.delete(c); } } };
  const v = stage.hero, p = world.player;
  const barrelDeg = () => { const q = new THREE.Quaternion(); v.hand.getWorldQuaternion(q); const d = v.barrel.axis.clone().applyQuaternion(q); return Math.atan2(d.y, d.x) * 57.3; };
  const diff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };
  // Each step: keys held for n frames. F is always held (firing).
  const script = [
    ['R', 30], ['R D', 20], ['D', 15], ['L D', 15], ['L', 20], ['R', 20], ['U', 20], ['R U', 20], ['L U', 20], ['C R D', 20], ['C L D', 20], ['R', 10], ['R J', 8], ['R', 12], ['D J', 6], ['D', 20], ['', 10],
  ];
  const report = {};
  for (const wpn of ['R', 'F', 'P']) {
    p.slots[p.cur] = wpn; world.enemies = []; world.spawnTimer = 1e9; p.iframes = 0;
    for (const [keys, n] of script) {
      const label = `${wpn}:${keys || 'none'}`;
      let worst = 0, worstTip = 0, frames = 0, bad = 0;
      for (let i = 0; i < n; i++) {
        set([...keys.split(' ').filter(Boolean), 'F']);
        stepFrames(1); world.enemies = [];
        if (!v.root.visible || !v.hand) continue;
        const shot = world.bullets.filter((b) => !b.enemy && b.life >= 89); // fired this frame
        if (!shot.length) continue;
        frames++;
        const mid = shot[Math.floor(shot.length / 2)];
        const e = diff(barrelDeg(), Math.atan2(-mid.vy, mid.vx) * 57.3);
        const tip = stage.heroTip ? Math.hypot(stage.heroTip.x - (mid.x + mid.w / 2), stage.heroTip.y - (mid.y + mid.h / 2)) : -1;
        worst = Math.max(worst, e); worstTip = Math.max(worstTip, tip);
        if (e > 12) bad++;
      }
      report[label] = `${frames}f angleErr≤${worst.toFixed(0)}° bad=${bad} tipGap≤${worstTip.toFixed(0)}px`;
    }
  }
  set([]);
  return report;
};
