// One bitmask per sim step; the same shape a second player or netcode would send.
export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, JUMP: 16, FIRE: 32, LOCK: 64, SWAP: 128 } as const;
