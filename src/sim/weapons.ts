export type WeaponId = 'R' | 'A' | 'F' | 'P';

// Each gun has a job: R baseline, A sustained DPS, F crowd control, P pierce/long range.
export const WEAPONS: Record<WeaponId, { name: string; cool: number; speed: number; dmg: number; pellets: number; spread: number; jitter: number; pierce: boolean; w: number; h: number; tier: number }> = {
  R: { name: 'RIFLE', cool: 10, speed: 450, dmg: 1, pellets: 1, spread: 0, jitter: 0.03, pierce: false, w: 12, h: 5, tier: 0 },
  A: { name: 'AUTO', cool: 5, speed: 520, dmg: 1, pellets: 1, spread: 0, jitter: 0.07, pierce: false, w: 12, h: 4, tier: 1 },
  F: { name: 'FAN', cool: 14, speed: 420, dmg: 1, pellets: 5, spread: 0.2, jitter: 0, pierce: false, w: 7, h: 7, tier: 3 },
  P: { name: 'PLASMA', cool: 12, speed: 640, dmg: 2, pellets: 1, spread: 0, jitter: 0, pierce: true, w: 26, h: 5, tier: 2 },
};
