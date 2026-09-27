import Phaser from 'phaser';

const COMMANDS: [string, string, string][] = [
  ['← → / A D', 'Pad: stick / d-pad', 'Run'],
  ['↑ / W', 'Pad: stick up', 'Aim up (hold with ← → for diagonal)'],
  ['↓ / S', 'Pad: stick down', 'Lie down (standing still) · aim down in the air'],
  ['← → + ↓', 'Pad: down-diagonal', 'Run and shoot diagonally down'],
  ['← → + ↑', 'Pad: up-diagonal', 'Run and shoot diagonally up'],
  ['Z / Space', 'Pad: A', 'Jump (hold for higher)'],
  ['↓ + Jump', 'Pad: down + A', 'Drop through a ledge or bridge'],
  ['X / J', 'Pad: X / RT', 'Fire (hold for auto-fire)'],
  ['C / Shift', 'Pad: LB / LT', 'Aim-lock: plant feet, aim 8 ways'],
  ['V', 'Pad: Y', 'Swap between your two guns'],
  ['Esc', '', 'Pause'],
  ['Enter', '', 'Continue after game over / replay after clear'],
  ['?', '', 'Open / close this command list'],
];

const PICKUPS = 'PICKUPS   A Auto (fast fire)   F Fan (5-way spread)   P Plasma (pierces)   B Barrier (10s shield)';

// Toggle the command palette. Returns true while it is open.
export function toggleHelp(scene: Phaser.Scene): boolean {
  const existing = scene.children.getByName('help') as Phaser.GameObjects.Container | null;
  if (existing) { existing.destroy(); return false; }

  const { width: w, height: h } = scene.scale;
  const c = scene.add.container(0, 0).setName('help').setScrollFactor(0).setDepth(200);
  const bg = scene.add.graphics();
  bg.fillStyle(0x000000, 0.8).fillRect(0, 0, w, h);
  bg.fillStyle(0x0d1520, 0.95).fillRect(40, 22, w - 80, h - 44);
  bg.lineStyle(2, 0xffd23f).strokeRect(40, 22, w - 80, h - 44);
  c.add(bg);

  const font = { fontFamily: 'monospace', fontSize: '11px', color: '#e8f0ff' };
  c.add(scene.add.text(w / 2, 36, 'COMMANDS', { ...font, fontSize: '16px', color: '#ffd23f' }).setOrigin(0.5, 0));
  COMMANDS.forEach(([keys, pad, what], i) => {
    const y = 66 + i * 21;
    c.add(scene.add.text(62, y, keys, { ...font, color: '#ffd23f' }));
    c.add(scene.add.text(190, y, what, font));
    if (pad) c.add(scene.add.text(w - 62, y, pad, { ...font, color: '#8fa3b8', fontSize: '9px' }).setOrigin(1, 0));
  });
  c.add(scene.add.text(w / 2, h - 58, PICKUPS, { ...font, fontSize: '9px', color: '#9ff3ff' }).setOrigin(0.5, 0));
  c.add(scene.add.text(w / 2, h - 40, 'press ? or Esc to close', { ...font, fontSize: '9px', color: '#8fa3b8' }).setOrigin(0.5, 0));
  return true;
}
