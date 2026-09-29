/* Shared-state persistence for the UrPay in-memory store.
 *
 * WHY THIS EXISTS
 * ---------------
 * On Vercel every serverless function instance keeps its OWN memory. A
 * registration created on instance A literally does not exist on instance B
 * (or on A after a cold restart): /api/auth/me answers 401 → the frontend
 * auto-logs-out ("kicked out after two seconds"), login answers 401 with the
 * generic card/PIN message ("the PIN is wrong even though I typed it
 * right"), transfer confirms answer 404 → money never moves, and
 * transactions evaporate so the latest entry for a contact silently replaces
 * older ones. ALL reported bugs share this single root cause.
 *
 * This module mirrors the store into ONE shared database so every instance
 * sees the same state and cold starts hydrate from it:
 *
 *   - runRoute() awaits ensureLoaded() before each handler and
 *     persistState() after it (diff-based → read-only requests write nothing).
 *   - Rows are mirrored as (tbl, rid) → JSON (last-write-wins per row).
 *   - ensureLoaded() also re-syncs when the local snapshot is older than
 *     URPAY_SYNC_TTL_MS (default 15s) so writes from other instances appear
 *     quickly; getAuthUser/login additionally force a re-sync before
 *     answering "not found".
 *   - The Db object is refilled IN PLACE (arrays cleared + refilled, object
 *     identity kept) so handlers holding a `getDb()` reference across an
 *     await keep pointing at the live store. Rows whose JSON is unchanged
 *     keep their object identity too (in-flight mutations survive re-syncs).
 *   - seq counters are mirrored in a __meta__ row and merged as
 *     max(local, remote, max-rid) — new IDs never collide after a re-sync.
 *
 * DRIVERS (first match wins)
 *   1. Turso / libSQL row-mirror — env TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).
 *      Row-level diff UPSERT/DELETE statements against one table.
 *   2. Vercel Blob state file — enabled automatically when the project has a
 *      Blob store connected (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID + the
 *      per-request OIDC token, are attached by Vercel to deployments created
 *      AFTER the store is connected — a Redeploy is required). A manual
 *      URPAY_BLOB_TOKEN (the store's rw token pasted by hand) is also
 *      honored. The whole row table is stored as one JSON file; every write
 *      re-reads + merges the remote file first (read-merge-write) so
 *      concurrent instances rarely clobber each other. Works with both
 *      Private and Public stores (the access mode is probed once).
 *      ZERO manual setup: Vercel → Storage → Create → Blob → Connect to
 *      project → Redeploy.
 *   3. memory — no driver configured (previous demo behavior).
 *
 *   IMPORTANT: VERCEL_OIDC_TOKEN alone must NOT activate the Blob driver —
 *   it is attached to EVERY modern Vercel deployment regardless of Blob.
 *   (5.zip activated on it and then reported a confusing mode "failed" on
 *   store-less deployments; 6.zip only activates on real Blob credentials.)
 *
 *   Any driver failure (unreachable, bad token, missing package) fails OPEN:
 *   persistence is disabled for the process and the app keeps serving from
 *   the seeded in-memory store. /api/health reports the exact mode + error,
 *   /api/health?probe=1 runs a REAL write→read→delete round-trip, and on
 *   Vercel in memory mode a client banner + login error explain that
 *   accounts are ephemeral until a Blob store is connected.
 *
 * LOCAL TESTING
 *   URPAY_BLOB_FAKE_DIR=/path makes the Blob driver read/write a local file
 *   with the exact same serialization (cold-restart E2E without a real store).
 */

import type { Client, InStatement } from "@libsql/client";
import { getDb } from "./store";
import type { Db } from "./types";

const TABLES = [
  "users",
  "bills",
  "txns",
  "transferRequests",
  "agentMessages",
  "budgets",
  "notifications",
  "scheduled",
  "goals",
  "favorites",
] as const;
type TableKey = (typeof TABLES)[number];
type AnyRow = { id: number };

const META_TBL = "__meta__";
const META_SEQ = "seq";
const CHUNK = 100;

/** Snapshot shape: tbl → rid → row JSON. */
type SnapshotMap = Map<string, Map<string, string>>;

type RemoteRow = { tbl: string; rid: string; data: string };
type DiffStmts = {
  upserts: RemoteRow[];
  deletes: { tbl: string; rid: string }[];
};

/** Re-sync the local snapshot when it is older than this (ms). 0 = never. */
function syncTtlMs(): number {
  const raw = Number(process.env.URPAY_SYNC_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 15_000;
}

type Global = {
  __urpayIO?: PersistDriver | null;
  __urpayLoadPromise?: Promise<void>;
  __urpaySynced?: SnapshotMap;
  __urpayLastSync?: number;
  __urpayRefreshPromise?: Promise<void> | null;
  __urpayChain?: Promise<unknown>;
  __urpayPersistError?: string | null;
};
const g = globalThis as unknown as Global;

/** Am I running inside Vercel serverless? (VERCEL env is auto-set there.) */
export function isServerless(): boolean {
  return process.env.VERCEL === "1" || !!process.env.VERCEL_URL;
}

/* --------------------------------------------------------------- driver --- */

interface PersistDriver {
  readonly kind: "turso" | "blob";
  /** Connect/verify + return ALL remote rows ([] when the store is fresh). */
  readAll(): Promise<RemoteRow[]>;
  /** Apply a diff; returns the effective post-write snapshot. */
  writeDiff(stmts: DiffStmts, current: SnapshotMap): Promise<SnapshotMap>;
  /** Live write→read→delete round-trip; throws with the real error on failure.
   * Used by /api/health?probe=1 so an operator can verify the store end-to-end. */
  probe(): Promise<void>;
  /** Short health description. */
  describe(): { url: string };
}

function driverConf(): "turso" | "blob" | null {
  if (tursoConf()) return "turso";
  if (blobConf()) return "blob";
  return null;
}

/** Is ANY shared database configured? (exposed for /api/health) */
export function persistenceEnabled(): boolean {
  return driverConf() !== null;
}

/** Create (and cache) the active driver. null → memory mode. */
async function getDriver(): Promise<PersistDriver | null> {
  if (g.__urpayIO !== undefined) return g.__urpayIO;
  const which = driverConf();
  if (!which) {
    g.__urpayIO = null;
    return null;
  }
  try {
    g.__urpayIO = which === "turso" ? await makeTursoDriver() : makeBlobDriver();
  } catch (e) {
    g.__urpayPersistError = e instanceof Error ? e.message : String(e);
    console.error("[urpay-persist] driver unavailable:", g.__urpayPersistError);
    g.__urpayIO = null;
  }
  return g.__urpayIO;
}

/* ------------------------------------------------------------ snapshots --- */

/** Serialize every store row (incl. the __meta__ seq row): tbl → rid → JSON. */
function snapshotWithMeta(db: Db): SnapshotMap {
  const snap: SnapshotMap = new Map();
  for (const t of TABLES) {
    const m = new Map<string, string>();
    for (const row of db[t] as AnyRow[]) {
      m.set(String(row.id), JSON.stringify(row));
    }
    snap.set(t, m);
  }
  snap.set(META_TBL, new Map([[META_SEQ, JSON.stringify(db.seq)]]));
  return snap;
}

/** Row-level diff between the live snapshot and the last synced one. */
function diffStmts(current: SnapshotMap, old: SnapshotMap): DiffStmts {
  const upserts: RemoteRow[] = [];
  const deletes: DiffStmts["deletes"] = [];
  for (const t of [...TABLES, META_TBL]) {
    const cur = current.get(t);
    const was = old.get(t);
    if (!cur) continue;
    if (!was) {
      for (const [rid, data] of cur) upserts.push({ tbl: t, rid, data });
      continue;
    }
    for (const [rid, data] of cur) {
      if (was.get(rid) !== data) upserts.push({ tbl: t, rid, data });
    }
    for (const rid of was.keys()) {
      if (!cur.has(rid)) deletes.push({ tbl: t, rid });
    }
  }
  return { upserts, deletes };
}

/** Refill db in place from remote rows (identity-preserving merge). */
function applyRemote(db: Db, rows: RemoteRow[]): void {
  const remote = new Map<string, Map<string, AnyRow>>();
  for (const t of TABLES) remote.set(t, new Map());
  let remoteSeq: Partial<Db["seq"]> = {};

  for (const r of rows) {
    if (r.tbl === META_TBL) {
      if (r.rid === META_SEQ) {
        try {
          remoteSeq = JSON.parse(r.data) as Partial<Db["seq"]>;
        } catch {
          /* corrupt meta — recompute from max ids below */
        }
      }
      continue;
    }
    if (!(TABLES as readonly string[]).includes(r.tbl)) continue;
    try {
      const parsed = JSON.parse(r.data) as AnyRow;
      if (typeof parsed.id !== "number") continue;
      remote.get(r.tbl as TableKey)!.set(r.rid, parsed);
    } catch {
      /* skip a single corrupt row, never break hydration */
    }
  }

  for (const t of TABLES) {
    const rem = remote.get(t)!;
    const arr = db[t] as AnyRow[];
    // keep local object identity when the row is byte-identical
    const localJson = new Map<string, string>();
    for (const row of arr) localJson.set(String(row.id), JSON.stringify(row));

    const merged: AnyRow[] = [];
    for (const [rid, row] of rem) {
      const same = localJson.get(rid);
      merged.push(
        same === JSON.stringify(row) ? findByRid(arr, rid) ?? row : row,
      );
    }
    merged.sort((a, b) => a.id - b.id);

    arr.length = 0;
    (arr as AnyRow[]).push(...merged);

    // seq: never go backwards, always adopt remote progress
    const maxId = merged.reduce((m, r) => Math.max(m, r.id), 0);
    db.seq[t] = Math.max(db.seq[t] ?? 0, remoteSeq[t] ?? 0, maxId);
  }
}

function findByRid(arr: AnyRow[], rid: string): AnyRow | undefined {
  const n = Number(rid);
  return arr.find((r) => r.id === n);
}

/* --------------------------------------------------------------- loading --- */

/** Await before every handler: loads once, then re-syncs past the TTL. */
export function ensureLoaded(): Promise<void> {
  if (!driverConf()) {
    getDb(); // pure in-memory demo mode — seeds on first access
    return Promise.resolve();
  }
  if (!g.__urpayLoadPromise) {
    g.__urpayLoadPromise = load().catch((e) => {
      // fail-open: log once, keep serving from the seeded memory store
      g.__urpayPersistError = e instanceof Error ? e.message : String(e);
      g.__urpaySynced = undefined;
      console.error(
        "[urpay-persist] load failed — continuing in-memory:",
        g.__urpayPersistError,
      );
      getDb();
    });
  }
  const ttl = syncTtlMs();
  if (ttl > 0 && g.__urpaySynced && Date.now() - (g.__urpayLastSync ?? 0) > ttl) {
    return refreshNow();
  }
  return g.__urpayLoadPromise;
}

async function load(): Promise<void> {
  const io = await getDriver();
  if (!io) throw new Error("no persistence driver");
  const rows = await io.readAll();

  if (rows.length === 0) {
    // first ever start anywhere: deterministic demo seed + full initial sync
    const db = getDb();
    g.__urpaySynced = new Map();
    g.__urpayLastSync = 0;
    await persistState();
    g.__urpayLastSync = Date.now();
    console.log(`[urpay-persist] seeded fresh demo state into ${io.kind}`);
    return;
  }

  // hydrate: refill the (already seeded) Db IN PLACE with remote rows,
  // keeping object identity for rows whose JSON is unchanged.
  const db = getDb();
  applyRemote(db, rows);
  g.__urpaySynced = snapshotWithMeta(db);
  g.__urpayLastSync = Date.now();
  console.log(
    `[urpay-persist] hydrated from ${io.kind}: ` +
      TABLES.map((t) => `${t}=${(db[t] as AnyRow[]).length}`).join(" "),
  );
}

/* ------------------------------------------------------------- refreshing --- */

/** Force a re-sync from the remote database (bypasses the TTL).
 * Single-flight: concurrent callers share one roundtrip. Safe no-op when
 * persistence is off or failed. */
export function refreshNow(): Promise<void> {
  if (!driverConf() || !g.__urpaySynced) return Promise.resolve();
  if (g.__urpayRefreshPromise) return g.__urpayRefreshPromise;
  g.__urpayRefreshPromise = runSerialized(async () => {
    try {
      const io = await getDriver();
      if (!io) return;
      // NOTE: calls the UN-QUEUED persist core — going through the queued
      // persistState() here would chain it behind this very refresh and
      // deadlock the serialization queue (requests would hang forever).
      await persistCore(); // flush local changes first (remote wins later)
      const rows = await io.readAll();
      applyRemote(getDb(), rows);
      g.__urpaySynced = snapshotWithMeta(getDb());
      g.__urpayLastSync = Date.now();
    } catch (e) {
      g.__urpayPersistError = e instanceof Error ? e.message : String(e);
      console.error("[urpay-persist] refresh failed:", g.__urpayPersistError);
    } finally {
      g.__urpayRefreshPromise = null;
    }
  });
  return g.__urpayRefreshPromise;
}

/** Serialize flush/refresh operations so they never overlap. */
function runSerialized(fn: () => Promise<void>): Promise<void> {
  const next = (g.__urpayChain ?? Promise.resolve()).then(fn, fn);
  g.__urpayChain = next.catch(() => {});
  return next;
}

/* ------------------------------------------------------------- persisting --- */

/** Diff the live store against the last synced snapshot and write changes.
 * Read-only requests produce zero statements. Never throws. */
export function persistState(): Promise<void> {
  if (!driverConf() || !g.__urpaySynced) return Promise.resolve(); // off or failed
  return runSerialized(persistCore).catch(() => {
    /* persistState never rejects */
  });
}

/** The actual diff+write — runs INSIDE the serialization queue (either via
 * persistState() after a request, or inline inside refreshNow). */
async function persistCore(): Promise<void> {
  if (!g.__urpaySynced) return;
  const io = await getDriver();
  if (!io) return;

  const db = getDb();
  let current = snapshotWithMeta(db);
  const stmts = diffStmts(current, g.__urpaySynced);

  if (stmts.upserts.length > 0 || stmts.deletes.length > 0) {
    try {
      current = await io.writeDiff(stmts, current);
    } catch (e) {
      g.__urpayPersistError = e instanceof Error ? e.message : String(e);
      console.error(
        "[urpay-persist] save failed — persistence disabled for this process:",
        g.__urpayPersistError,
      );
      g.__urpaySynced = undefined;
      return;
    }
  }

  g.__urpaySynced = current;
  g.__urpayLastSync = Date.now();
}

/* ---------------------------------------------------------- Turso driver --- */

type TursoConf = { url: string; authToken?: string };

function tursoConf(): TursoConf | null {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url || !/^(libsql|https?|wss?):\/\//.test(url) && !url.startsWith("file:")) {
    return null;
  }
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  return { url, authToken: token || undefined };
}

async function makeTursoDriver(): Promise<PersistDriver> {
  const c = tursoConf()!;
  const opts: { url: string; authToken?: string } = { url: c.url };
  if (c.authToken && !c.url.startsWith("file:")) opts.authToken = c.authToken;
  // Dynamic import: without Turso configured the package is never even
  // loaded, and a missing/broken install can never take the app down.
  const mod = (await import("@libsql/client")) as {
    createClient: (o: { url: string; authToken?: string }) => Client;
  };
  const client = mod.createClient(opts);

  const CREATE_SQL =
    "CREATE TABLE IF NOT EXISTS aurpay_state (" +
    "tbl TEXT NOT NULL, rid TEXT NOT NULL, data TEXT NOT NULL, " +
    "PRIMARY KEY (tbl, rid))";

  async function selectAll(cl: Client): Promise<RemoteRow[]> {
    const res = await cl.execute("SELECT tbl, rid, data FROM aurpay_state");
    const out: RemoteRow[] = [];
    for (const r of res.rows as unknown as Record<string, unknown>[]) {
      out.push({
        tbl: String(r.tbl),
        rid: String(r.rid),
        data: String(r.data),
      });
    }
    return out;
  }

  await client.execute(CREATE_SQL);

  return {
    kind: "turso",
    async readAll() {
      return selectAll(client);
    },
    async writeDiff(stmts, current) {
      const sql: InStatement[] = [];
      for (const u of stmts.upserts) {
        sql.push({
          sql: "INSERT OR REPLACE INTO aurpay_state (tbl, rid, data) VALUES (?, ?, ?)",
          args: [u.tbl, u.rid, u.data],
        });
      }
      for (const d of stmts.deletes) {
        sql.push({
          sql: "DELETE FROM aurpay_state WHERE tbl = ? AND rid = ?",
          args: [d.tbl, d.rid],
        });
      }
      for (let i = 0; i < sql.length; i += CHUNK) {
        await client.batch(sql.slice(i, i + CHUNK));
      }
      return current;
    },
    async probe() {
      await client.execute("SELECT 1");
    },
    describe() {
      return { url: c.url };
    },
  };
}

/* ----------------------------------------------------------- Blob driver --- */

const BLOB_PATHNAME = "aurpay-state.json";

type BlobGlobal = {
  __urpayBlobAccess?: "private" | "public";
  __urpayBlobLastText?: string | null;
};
const bg = globalThis as unknown as BlobGlobal;

/** Blob driver config: a fake dir for local E2E; a real store only when a
 * genuine Blob credential is attached. Vercel attaches BLOB_READ_WRITE_TOKEN
 * (classic flow) or BLOB_STORE_ID + per-request OIDC (new flow) to deployments
 * CREATED AFTER the store is connected — connecting without a Redeploy leaves
 * the running deployment with nothing, which is exactly what /api/health's
 * env booleans reveal. URPAY_BLOB_TOKEN is the manual "link it myself" path
 * (paste the store's read/write token by hand).
 *
 * NOTE: VERCEL_OIDC_TOKEN alone must NOT activate the driver — it is present
 * on EVERY modern Vercel deployment regardless of Blob. */
function blobConf(): { fakeDir: string } | { real: true; token?: string } | null {
  const fakeDir = process.env.URPAY_BLOB_FAKE_DIR?.trim();
  if (fakeDir) return { fakeDir };
  const manual = process.env.URPAY_BLOB_TOKEN?.trim();
  if (manual) return { real: true, token: manual };
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return { real: true };
  if (process.env.BLOB_STORE_ID?.trim()) return { real: true };
  return null;
}

/** @vercel/blob module surface (only the pieces we call). A `token` option
 * (manual URPAY_BLOB_TOKEN) is honored by put/get/del — resolveBlobAuth()
 * checks options.token FIRST, before any env var. */
type BlobTokenOpt = { token?: string };
type BlobModule = {
  put: (
    pathname: string,
    body: string,
    opts: {
      access: "private" | "public";
      addRandomSuffix?: boolean;
      allowOverwrite?: boolean;
      contentType?: string;
    } & BlobTokenOpt,
  ) => Promise<unknown>;
  get: (
    urlOrPathname: string,
    opts: {
      access: "private" | "public";
      useCache?: boolean;
    } & BlobTokenOpt,
  ) => Promise<{
    statusCode: number;
    stream: ReadableStream<Uint8Array> | null;
    blob: { url: string; contentType: string };
  } | null>;
  del: (urlOrPathname: string, opts?: BlobTokenOpt) => Promise<unknown>;
};

let blobModule: BlobModule | null = null;
async function getBlobModule(): Promise<BlobModule> {
  if (blobModule) return blobModule;
  blobModule = (await import("@vercel/blob")) as unknown as BlobModule;
  return blobModule;
}

/** Deterministic JSON for the whole row table (sorted tbl, numeric rid). */
function serializeSnapshot(snap: SnapshotMap): string {
  const rows: RemoteRow[] = [];
  for (const t of [...TABLES, META_TBL]) {
    const m = snap.get(t);
    if (!m) continue;
    for (const [rid, data] of m) rows.push({ tbl: t, rid, data });
  }
  rows.sort((a, b) =>
    a.tbl === b.tbl ? Number(a.rid) - Number(b.rid) : a.tbl < b.tbl ? -1 : 1,
  );
  return JSON.stringify({ v: 1, rows });
}

function parseStateFile(text: string): RemoteRow[] {
  const parsed = JSON.parse(text) as { v?: number; rows?: RemoteRow[] };
  if (parsed?.v !== 1 || !Array.isArray(parsed.rows)) {
    throw new Error("corrupt aurpay state file");
  }
  return parsed.rows;
}

function makeBlobDriver(): PersistDriver {
  const c = blobConf()!;
  const fakePath = "fakeDir" in c ? `${c.fakeDir}/aurpay-state.json` : null;
  // manual "link it myself" token — passed explicitly to every SDK call
  const manualToken = "real" in c ? c.token : undefined;

  /* ---- raw file I/O (real store or local fake dir) ---- */

  async function readRemoteText(): Promise<string | null> {
    if (fakePath) {
      const { readFile } = await import("node:fs/promises");
      try {
        return await readFile(fakePath, "utf8");
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        throw e;
      }
    }
    const mod = await getBlobModule();
    const tryGet = async (access: "private" | "public") => {
      const res = await mod.get(BLOB_PATHNAME, {
        access,
        useCache: false,
        token: manualToken,
      });
      if (!res) return null; // not found — store reachable, state fresh
      if (!res.stream) throw new Error("blob stream missing (304?)");
      return await new Response(res.stream).text();
    };
    const mode = bg.__urpayBlobAccess ?? "private";
    try {
      return await tryGet(mode);
    } catch (e) {
      // the cached access mode may mismatch the store (private vs public) —
      // flip once and retry before giving up
      const alt: "private" | "public" = mode === "private" ? "public" : "private";
      try {
        const text = await tryGet(alt);
        bg.__urpayBlobAccess = alt;
        return text;
      } catch {
        throw e; // original error — store truly unreachable
      }
    }
  }

  async function writeRemoteText(text: string): Promise<void> {
    if (fakePath) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(fakePath), { recursive: true });
      await writeFile(fakePath, text, "utf8");
      return;
    }
    const mod = await getBlobModule();
    const putOpts = (access: "private" | "public") => ({
      access,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token: manualToken,
    });
    const mode = bg.__urpayBlobAccess ?? "private";
    try {
      await mod.put(BLOB_PATHNAME, text, putOpts(mode));
    } catch (e) {
      const alt: "private" | "public" = mode === "private" ? "public" : "private";
      try {
        await mod.put(BLOB_PATHNAME, text, putOpts(alt));
        bg.__urpayBlobAccess = alt;
      } catch {
        throw e;
      }
    }
  }

  return {
    kind: "blob",
    async readAll() {
      const text = await readRemoteText();
      bg.__urpayBlobLastText = text;
      if (text === null) return [];
      return parseStateFile(text);
    },
    async writeDiff(_stmts, current) {
      // Read-merge-write: pull concurrent remote changes in BEFORE the
      // overwrite so two live instances rarely clobber each other (the
      // whole-file last-write-wins window shrinks to the get→put gap).
      const remoteText = await readRemoteText();
      let eff = current;
      if (
        remoteText !== null &&
        remoteText !== bg.__urpayBlobLastText &&
        remoteText.trim() !== ""
      ) {
        const rows = parseStateFile(remoteText);
        applyRemote(getDb(), rows);
        eff = snapshotWithMeta(getDb());
      }
      const text = serializeSnapshot(eff);
      if (text !== bg.__urpayBlobLastText) {
        await writeRemoteText(text);
        bg.__urpayBlobLastText = text;
      }
      return eff;
    },
    async probe() {
      // REAL round-trip against the exact same layer the state file uses:
      // put a tiny probe object → read it back → delete it. If the store is
      // unreachable, the token is wrong or the access mode mismatches, the
      // original error propagates to /api/health?probe=1.
      const PROBE_PATH = "aurpay-probe.json";
      const payload = JSON.stringify({ t: Date.now(), probe: true });
      if (fakePath) {
        const { writeFile, readFile, unlink, mkdir } = await import(
          "node:fs/promises"
        );
        const { dirname } = await import("node:path");
        const p = `${dirname(fakePath)}/aurpay-probe.json`;
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, payload, "utf8");
        const back = await readFile(p, "utf8");
        if (back !== payload) {
          throw new Error("probe round-trip mismatch (local fake dir)");
        }
        await unlink(p);
        return;
      }
      const mod = await getBlobModule();
      const mode = bg.__urpayBlobAccess ?? "private";
      const attempt = async (access: "private" | "public") => {
        await mod.put(PROBE_PATH, payload, {
          access,
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json",
          token: manualToken,
        });
        const res = await mod.get(PROBE_PATH, {
          access,
          useCache: false,
          token: manualToken,
        });
        if (!res || !res.stream) {
          throw new Error("probe file not readable after put");
        }
        const back = await new Response(res.stream).text();
        if (back !== payload) {
          throw new Error("probe round-trip mismatch");
        }
        await mod.del(PROBE_PATH, { token: manualToken });
        bg.__urpayBlobAccess = access;
      };
      try {
        await attempt(mode);
      } catch (e) {
        const alt: "private" | "public" =
          mode === "private" ? "public" : "private";
        try {
          await attempt(alt);
        } catch {
          throw e; // original error — store truly unreachable
        }
      }
    },
    describe() {
      return { url: fakePath ?? "vercel-blob:" + BLOB_PATHNAME };
    },
  };
}

/* ---------------------------------------------------------------- status --- */

/** Health-endpoint view of the persistence layer.
 * `env` exposes WHICH credentials this deployment can see (booleans only —
 * never values): with a store connected but mode "memory" the false booleans
 * prove the deployment predates the connection → Redeploy fixes it. */
export function persistenceInfo(): {
  mode: "memory" | "turso" | "blob" | "failed" | "starting";
  url: string | null;
  error: string | null;
  serverless: boolean;
  hint: string | null;
  env: {
    blobToken: boolean;
    blobStoreId: boolean;
    oidc: boolean;
    turso: boolean;
  };
} {
  const which = driverConf();
  const driver = g.__urpayIO;
  let mode: "memory" | "turso" | "blob" | "failed" | "starting" = "memory";
  let url: string | null = null;
  if (which) {
    const rawUrl =
      driver?.describe().url ??
      (which === "turso" ? tursoConf()!.url : "vercel-blob:" + BLOB_PATHNAME);
    url = rawUrl.startsWith("file:")
      ? rawUrl
      : rawUrl.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
    mode = g.__urpaySynced
      ? which === "turso"
        ? "turso"
        : "blob"
      : g.__urpayPersistError
        ? "failed"
        : "starting";
  }
  return {
    mode,
    url,
    error: g.__urpayPersistError ?? null,
    serverless: isServerless(),
    hint: modeWarning(),
    env: {
      blobToken:
        !!process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
        !!process.env.URPAY_BLOB_TOKEN?.trim(),
      blobStoreId: !!process.env.BLOB_STORE_ID?.trim(),
      oidc: !!process.env.VERCEL_OIDC_TOKEN?.trim(),
      turso: !!process.env.TURSO_DATABASE_URL?.trim(),
    },
  };
}

/** REAL end-to-end storage check for /api/health?probe=1: runs a
 * write→read→delete round-trip through the ACTIVE driver and reports the
 * raw error plus an Arabic `advice` naming the most likely fix. Never throws. */
export async function probeStore(): Promise<{
  ok: boolean;
  mode: string;
  ms: number;
  error: string | null;
  advice: string | null;
}> {
  const started = Date.now();
  const which = driverConf();
  if (!which) {
    return {
      ok: false,
      mode: "memory",
      ms: 0,
      error: null,
      advice:
        "لا يوجد مخزن مشترك مربوط بهذه النسخة (وضع الذاكرة). " +
        "من لوحة Vercel: تبويب Storage ← اختر مخزن Blob ← Connect to project " +
        "← ثم Deployments ← ⋯ ← Redeploy، وأعد الفحص.",
    };
  }
  try {
    const io = await getDriver();
    if (!io) {
      throw new Error(
        g.__urpayPersistError ?? "تعذّر تهيئة طبقة التخزين",
      );
    }
    await io.probe();
    return {
      ok: true,
      mode: which,
      ms: Date.now() - started,
      error: null,
      advice:
        which === "blob"
          ? "مخزن Blob يستجيب للكتابة والقراءة والحذف — التخزين الدائم يعمل ✓"
          : "قاعدة Turso تستجيب — التخزين الدائم يعمل ✓",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const info = persistenceInfo();
    let advice: string;
    if (!info.env.blobToken && !info.env.blobStoreId && !info.env.turso) {
      advice =
        "متغيرات المخزن غير موجودة في هذه النسخة: إمّا المخزن غير مربوط " +
        "بالمشروع، أو أنك ربطته ولم تعمل Redeploy بعدها. الحل: Storage ← " +
        "Connect to project ← Deployments ← ⋯ ← Redeploy، ثم أعد الفحص.";
    } else if (/401|unauthorized|token/i.test(msg)) {
      advice =
        "التوكن مرفوض — انسخ قيمة BLOB_READ_WRITE_TOKEN من صفحة المخزن " +
        "(Storage ← المخزن ← .env.local) وأضفها يدويًا في Settings ← " +
        "Environment Variables، ثم Redeploy.";
    } else if (/not found|store/i.test(msg)) {
      advice =
        "المخزن غير موجود أو موقوف — تأكد من اختيار نفس المشروع عند " +
        "Connect to project وأن المخزن بحالة Active.";
    } else {
      advice =
        "فشل الوصول للمخزن — راجع الرسالة أعلاه وتأكد من حالة المخزن في " +
        "تبويب Storage ثم أعد المحاولة.";
    }
    return { ok: false, mode: which, ms: Date.now() - started, error: msg, advice };
  }
}

/** Warning shown when running on Vercel WITHOUT durable storage — the exact
 * situation where new accounts vanish and logins report a wrong PIN.
 * Returns null everywhere else (local/sandbox single-process memory is fine). */
export function memoryModeWarning(): string | null {
  return modeWarning();
}

function modeWarning(): string | null {
  if (!isServerless()) return null;
  const which = driverConf();
  if (which) return null;
  return (
    "نسخة فيرسيل تعمل بدون قاعدة بيانات دائمة (وضع الذاكرة): " +
    "الحسابات الجديدة تضيع عند تبديل الخادم. " +
    "الحل بدقيقة: لوحة فيرسيل ← تبويب Storage ← Create ← Blob ← " +
    "اربطه بالمشروع ← Redeploy (الخطوات في README)"
  );
}
