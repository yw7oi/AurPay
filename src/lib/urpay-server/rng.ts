/* Deterministic seeded PRNG (mulberry32) mirroring the call patterns of
 * Python's random.Random — used ONLY by the seed so the demo dataset is
 * stable across process restarts. Runtime randomness (references, salts)
 * uses node:crypto instead (matching Python's `secrets` usage).
 *
 * Semantics match Python:
 *   random()          -> float in [0, 1)
 *   randint(a, b)     -> int in [a, b] (inclusive both ends)
 *   randrange(s, e, k)-> random element of range(s, e, k)
 *   choice(seq)       -> random element
 *   choices(seq, k, weights?) -> k elements (with replacement)
 *   sample(seq, k)    -> k unique elements in selection order
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32 — one step, float in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  random(): number {
    return this.next();
  }

  randint(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  randrange(start: number, stop: number, step = 1): number {
    const count = Math.max(0, Math.ceil((stop - start) / step));
    return start + Math.floor(this.next() * count) * step;
  }

  choice<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  choices<T>(arr: readonly T[], k: number, weights?: number[]): T[] {
    const out: T[] = [];
    if (weights && weights.length === arr.length) {
      const cum: number[] = [];
      let total = 0;
      for (const w of weights) {
        total += w;
        cum.push(total);
      }
      for (let i = 0; i < k; i++) {
        const r = this.next() * total;
        let idx = cum.findIndex((c) => c >= r);
        if (idx === -1) idx = arr.length - 1;
        out.push(arr[idx]);
      }
    } else {
      for (let i = 0; i < k; i++) out.push(this.choice(arr));
    }
    return out;
  }

  sample<T>(arr: readonly T[], k: number): T[] {
    const picked = new Set<number>();
    const out: T[] = [];
    const n = arr.length;
    const want = Math.min(k, n);
    while (out.length < want) {
      const i = Math.floor(this.next() * n);
      if (!picked.has(i)) {
        picked.add(i);
        out.push(arr[i]);
      }
    }
    return out;
  }
}

/** hackathon submission date — stable seed (seed.py: random.Random(20260928)) */
export const seedRng = new Rng(20260928);
