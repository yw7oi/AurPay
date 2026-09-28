/* Faithful TypeScript port of Python's difflib.SequenceMatcher (the classic
 * Ratcliff-Obershelp "longest matching block" recursion used by .ratio()).
 *
 * The agent's smart person-search (tools.ts) relies on SequenceMatcher's
 * exact ratio() values — 2*M/T over the collapsed non-adjacent matching
 * blocks — so the port mirrors CPython's algorithm including the junk and
 * popular-element handling (inert for the short name tokens we feed it). */

export type MatchBlock = [number, number, number]; // (i, j, n)

type Options = {
  /** elements treated as junk (matches on them score nothing) */
  isJunk?: (ch: string) => boolean;
  /** auto-purge elements occurring > 1% when len(b) >= 200 */
  autoJunk?: boolean;
};

export class SequenceMatcher {
  private a: string;
  private b: string;
  private isJunk: ((ch: string) => boolean) | null;
  private autoJunk: boolean;
  private b2j: Map<string, number[]> = new Map();
  private bjunk: Set<string> = new Set();
  private bpopular: Set<string> = new Set();
  private matchingBlocks: MatchBlock[] | null = null;

  constructor(a: string, b: string, opts: Options = {}) {
    this.a = a;
    this.b = b;
    this.isJunk = opts.isJunk ?? null;
    this.autoJunk = opts.autoJunk ?? true;
    this.chainB();
  }

  /** Index sequence b — junk filtered out, popular elements flagged. */
  private chainB(): void {
    const b = this.b;

    for (const elt of b) {
      if (this.isJunk && !this.bjunk.has(elt) && this.isJunk(elt)) {
        this.bjunk.add(elt);
      }
    }

    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      if (this.bjunk.has(elt)) continue;
      let idxs = this.b2j.get(elt);
      if (!idxs) {
        idxs = [];
        this.b2j.set(elt, idxs);
      }
      idxs.push(i);
    }

    // purge popular elements (only for long b sequences)
    const n = b.length;
    if (this.autoJunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of this.b2j) {
        if (idxs.length > ntest) this.bpopular.add(elt);
      }
    }
  }

  /** Find the longest matching block in a[alo:ahi] × b[blo:bhi]. */
  findLongestMatch(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): MatchBlock {
    const a = this.a;
    const b = this.b;
    const b2j = this.b2j;
    const bjunk = this.bjunk;
    const bpopular = this.bpopular;

    const isBJunk = (ch: string) => bjunk.has(ch);

    let besti = alo;
    let bestj = blo;
    let bestsize = 0;

    // find longest junk-free match
    let j2len: Map<number, number> = new Map();
    for (let i = alo; i < ahi; i++) {
      // popular elements reset the diagonal chains (CPython 3.9+ behavior)
      if (bpopular.has(a[i])) {
        j2len = new Map();
        continue;
      }
      const newj2len: Map<number, number> = new Map();
      const idxs = b2j.get(a[i]);
      if (idxs) {
        for (const j of idxs) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }

    // extend the best by non-junk elements on each end
    while (
      besti > alo &&
      bestj > blo &&
      !isBJunk(b[bestj - 1]) &&
      a[besti - 1] === b[bestj - 1]
    ) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      !isBJunk(b[bestj + bestsize]) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }

    // now look for a junk match on each end
    while (
      besti > alo &&
      bestj > blo &&
      isBJunk(b[bestj - 1]) &&
      a[besti - 1] === b[bestj - 1]
    ) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      isBJunk(b[bestj + bestsize]) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }

    return [besti, bestj, bestsize];
  }

  /** All matching blocks, collapsed to non-adjacent triples (sorted). */
  getMatchingBlocks(): MatchBlock[] {
    if (this.matchingBlocks) return this.matchingBlocks;

    const la = this.a.length;
    const lb = this.b.length;

    // 1. compute the matches — LIFO queue exactly like CPython
    type Region = [number, number, number, number];
    const queue: Region[] = [[0, la, 0, lb]];
    const found: MatchBlock[] = [];
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k > 0) {
        found.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    found.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

    // 2. collapse adjacent equal blocks
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: MatchBlock[] = [];
    for (const [i2, j2, k2] of found) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1 > 0) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1 > 0) nonAdjacent.push([i1, j1, k1]);

    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  /** 2.0 * M / T — M = total matched chars, T = len(a) + len(b). */
  ratio(): number {
    const blocks = this.getMatchingBlocks();
    let matches = 0;
    for (const [, , n] of blocks) matches += n;
    const length = this.a.length + this.b.length;
    return length > 0 ? (2.0 * matches) / length : 1.0;
  }
}
