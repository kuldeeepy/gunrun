export const TILE = 32;

export type Box = { x: number; y: number; w: number; h: number }; // x,y = top-left

export class TileMap {
  constructor(public rows: string[]) {}
  get cols() { return this.rows[0].length; }
  get widthPx() { return this.cols * TILE; }
  get heightPx() { return this.rows.length * TILE; }

  at(cx: number, cy: number): string {
    if (cy < 0) return '.';
    if (cx < 0 || cx >= this.cols || cy >= this.rows.length) return cy >= this.rows.length ? '.' : '#';
    return this.rows[cy][cx];
  }
  solid(cx: number, cy: number) { return this.at(cx, cy) === '#'; }
  oneWay(cx: number, cy: number) { const c = this.at(cx, cy); return c === '=' || c === 'b'; }
}

// Move X then Y, resolving against the grid. Returns which sides were hit.
export function moveBox(map: TileMap, b: Box, dx: number, dy: number, dropThrough = false) {
  const hit = { left: false, right: false, top: false, bottom: false };

  b.x += dx;
  const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h - 0.01) / TILE);
  if (dx > 0) {
    const cx = Math.floor((b.x + b.w - 0.01) / TILE);
    for (let cy = y0; cy <= y1; cy++) if (map.solid(cx, cy)) { b.x = cx * TILE - b.w; hit.right = true; break; }
  } else if (dx < 0) {
    const cx = Math.floor(b.x / TILE);
    for (let cy = y0; cy <= y1; cy++) if (map.solid(cx, cy)) { b.x = (cx + 1) * TILE; hit.left = true; break; }
  }

  const prevBottom = b.y + b.h;
  b.y += dy;
  const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 0.01) / TILE);
  if (dy > 0) {
    const cy = Math.floor((b.y + b.h - 0.01) / TILE);
    for (let cx = x0; cx <= x1; cx++) {
      const top = cy * TILE;
      const landOneWay = !dropThrough && map.oneWay(cx, cy) && prevBottom <= top + 0.01;
      if (map.solid(cx, cy) || landOneWay) { b.y = top - b.h; hit.bottom = true; break; }
    }
  } else if (dy < 0) {
    const cy = Math.floor(b.y / TILE);
    for (let cx = x0; cx <= x1; cx++) if (map.solid(cx, cy)) { b.y = (cy + 1) * TILE; hit.top = true; break; }
  }
  return hit;
}

export function overlap(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
