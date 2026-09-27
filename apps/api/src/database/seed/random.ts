import { createHash } from 'node:crypto';

/** Deterministic PRNG (mulberry32), so every run produces the same data. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick() from an empty list');
      return item;
    },
  };
}

/**
 * A stable UUID for a seed record, derived from a name. Re-running the seed
 * produces the same IDs, which is what makes it idempotent.
 */
export function seedId(name: string): string {
  const hex = createHash('sha256').update(`boothconnect-seed:${name}`).digest('hex');
  // Shape it as a UUID (version nibble 8 = custom, RFC 9562 variant bits).
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
