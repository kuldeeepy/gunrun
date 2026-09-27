// Dev: render a gallery of hero poses (side-view close-up) while firing, one tile per aim state.
// Usage: await import('/tools/poses.js'); await poseGallery()   -> draws an overlay canvas on the page
window.poseGallery = async function (hero) {
  if (hero !== undefined) { settings.hero3d = hero; stage.setHero(); }
  const codes = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', J: 'KeyZ', F: 'KeyX', C: 'KeyC' };
  const held = new Set();
  const set = (keys) => { for (const [c, code] of Object.entries(codes)) { const on = keys.includes(c); if (on !== held.has(c)) { window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { key: code, code, bubbles: true })); on ? held.add(c) : held.delete(c); } } };
  const states = [
    ['RIGHT', ['C', 'R'], 0], ['LEFT', ['C', 'L'], 0], ['UP', ['U'], 0],
    ['UP-RIGHT', ['C', 'R', 'U'], 0], ['UP-LEFT', ['C', 'L', 'U'], 0],
    ['DOWN-RIGHT', ['C', 'R', 'D'], 0], ['DOWN-LEFT', ['C', 'L', 'D'], 0],
    ['PRONE-RIGHT', ['D'], 0, ['R']], ['PRONE-LEFT', ['D', 'L'], 0, ['L']],
    ['JUMP-DOWN', ['D'], 1], ['RUN-RIGHT', ['R'], 0], ['RUN-UPRIGHT', ['R', 'U'], 0], ['RUN-DOWNRIGHT', ['R', 'D'], 0],
  ];
  world.enemies = []; world.spawnTimer = 1e9; world.player.iframes = 0; stage.closeup = true;
  const W = 320, H = 240, cols = 4, out = document.createElement('canvas');
  out.width = W * cols; out.height = H * Math.ceil(states.length / cols);
  const g = out.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height);
  const src = stage.renderer.domElement;
  for (const [i, [name, keys, air, pre]] of states.entries()) {
    set(pre ?? []); stepFrames(8); set([]); stepFrames(4); world.enemies = []; // pre: face a direction first
    if (air) { set(['J']); stepFrames(10); }
    set([...keys, 'F', ...(air ? ['J'] : [])]); stepFrames(air ? 6 : 24); world.enemies = [];
    stepFrames(1); // render and grab in the same task, before the buffer is cleared
    const s = Math.min(src.width / 1.6, src.height / 1.2);
    g.drawImage(src, (src.width - s * 1.6) / 2 + src.width * 0.08, (src.height - s * 1.2) / 2, s * 1.6, s * 1.2, (i % cols) * W, Math.floor(i / cols) * H, W, H);
    g.fillStyle = '#ffd23f'; g.font = 'bold 16px monospace'; g.fillText(name, (i % cols) * W + 8, Math.floor(i / cols) * H + 20);
  }
  set([]); stage.closeup = false;
  out.id = 'posegallery'; out.style.cssText = 'position:fixed;inset:0;margin:auto;max-width:100vw;max-height:100vh;z-index:9999;background:#000';
  document.getElementById('posegallery')?.remove(); document.body.appendChild(out);
  return 'gallery drawn';
};
