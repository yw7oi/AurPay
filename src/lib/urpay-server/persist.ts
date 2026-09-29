/* Turso (libSQL) row-mirror persistence for the UrPay in-memory store.
 *
 * WHY THIS EXISTS
 * ---------------
 * On Vercel every serverless function instance keeps its OWN memory. A
 * registration created on instance A literally does not exist on instance B
 * (or on A after a cold restart): login answers 401 → the frontend
 * auto-logs-out ("returned to the home screen"), transfer confirms answer
 * 404 → money never moves, and transactions evaporate so the latest entry
 * for a contact silently replaces older ones. All three reported bugs share
 * this single root cause.
 *
 * This module mirrors every store row into ONE shared Turso database so all
 * instances see the same state and cold starts hydrate from it:
 *
 *   - runRoute() awaits ensureLoaded() before each handler and
 *     persistState() after it (diff-based → read-only requests write nothing).
 *   - Rows live in one table as (tbl, rid) → JSON. Changed/new rows are
 *     UPSERTed, vanished rows DELETEd (last-write-wins per row).
 *   - ensureLoaded() also re-syncs when the local snapshot is older than
 *     URPAY_SYNC_TTL_MS (default 15s) so writes from other instances appear
 *     quickly; login/transfer-confirm additionally force a re-sync before
 *     answering "not found".
 *   - The Db object is refilled IN PLACE (arrays cleared + refilled, object
 *     identity kept) so handlers holding a `getDb()` reference across an
 *     await keep pointing at the live store. Rows whose JSON is unchanged
 *     keep their object identity too (in-flight mutations survive re-syncs).
 *   - seq counters are mirrored in a __meta__ row and merged as
 *     max(local, remote, max-rid) — new IDs never collide after a re-sync.
 *
 * MODES
 *   - No TURSO_DATABASE_URL  → pure in-memory demo mode (previous behavior).
 *   - Turso unreachable      → persistence disabled for the process and the
 *                              app keeps serving from memory (fail-open).
 *
 * SETUP (2 env vars, see .env.example): turso.tech → create DB → token
 *   TURSO_DATABASE_URL=libsql://your-db.turso.io
 *   TURSO_AUTH_TOKEN=eyJ...
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

/** Re-sync the local snapshot when it is older than this (ms). 0 = never. */
function syncTtlMs(): number {
  const raw = Number(process.env.URPAY_SYNC_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 15_000;
}

type Global = {
  __urpayTurso?: Client;
  __urpayLoadPromise?: Promise<void>;
  __urpaySynced?: Map<string, Map<string, string>>;
  __urpayLastSync?: number;
  __urpayRefreshPromise?: Promise<void> | null;
  __urpayChain?: Promise<unknown>;
  __urpayPersistError?: string | null;
};
const g = globalThis as unknown as Global;

type Conf = { url: string; authToken?: string };

function conf(): Conf | null {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url || !/^(libsql|https?|wss?):\/\//.test(url) && !url.startsWith("file:")) {
    return null;
  }
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  return { url, authToken: token || undefined };
}

/** Is a shared database configured? (exposed for /api/health) */
export function persistenceEnabled(): boolean {
  return conf() !== null;
}

async function getClient(): Promise<Client | null> {
  const c = conf();
  if (!c) return null;
  if (g.__urpayTurso) return g.__urpayTurso;
  try {
    const opts: { url: string; authToken?: string } = { url: c.url };
    if (c.authToken && !c.url.startsWith("file:")) opts.authToken = c.authToken;
    // Dynamic import: without Turso configured the package is never even
    // loaded, and a missing/broken install can never take the app down.
    const mod = (await import("@libsql/client")) as {
      createClient: (o: { url: string; authToken?: string }) => Client;
    };
    g.__urpayTurso = mod.createClient(opts);
    return g.__urpayTurso;
  } catch (e) {
    g.__urpayPersistError = `libsql client unavailable: ${
      e instanceof Error ? e.message : String(e)
    }`;
    console.error("[urpay-persist]", g.__urpayPersistError);
    return null;
  }
}

/** Serialize every table row: tbl → rid → JSON. */
function snapshot(db: Db): Map<string, Map<string, string>> {
  const snap = new Map<string, Map<string, string>>();
  for (const t of TABLES) {
    const m = new Map<string, string>();
    for (const row of db[t] as AnyRow[]) {
      m.set(String(row.id), JSON.stringify(row));
    }
    snap.set(t, m);
  }
  return snap;
}

const CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS aurpay_state (" +
  "tbl TEXT NOT NULL, rid TEXT NOT NULL, data TEXT NOT NULL, " +
  "PRIMARY KEY (tbl, rid))";

type RemoteRow = { tbl: string; rid: string; data: string };

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

/* --------------------------------------------------------------- loading --- */

/** Await before every handler: loads once, then re-syncs past the TTL. */
export function ensureLoaded(): Promise<void> {
  if (!conf()) {
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
  const cl = await getClient();
  if (!cl) throw new Error("no libsql client");
  await cl.execute(CREATE_SQL);
  const rows = await selectAll(cl);

  if (rows.length === 0) {
    // first ever start anywhere: deterministic demo seed + full initial sync
    const db = getDb();
    g.__urpaySynced = new Map();
    g.__urpayLastSync = 0;
    await persistState();
    g.__urpayLastSync = Date.now();
    console.log(
      "[urpay-persist] seeded fresh demo state into Turso",
    );
    return;
  }

  // hydrate: refill the (already seeded) Db IN PLACE with remote rows,
  // keeping object identity for rows whose JSON is unchanged.
  const db = getDb();
  applyRemote(db, rows);
  g.__urpaySynced = snapshot(db);
  g.__urpayLastSync = Date.now();
  console.log(
    "[urpay-persist] hydrated from Turso: " +
      TABLES.map((t) => `${t}=${(db[t] as AnyRow[]).length}`).join(" "),
  );
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
      merged.push(same === JSON.stringify(row) ? findByRid(arr, rid) ?? row : row);
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

/* ------------------------------------------------------------- refreshing --- */

/** Force a re-sync from the remote database (bypasses the TTL).
 * Single-flight: concurrent callers share one roundtrip. Safe no-op when
 * persistence is off or failed. */
export function refreshNow(): Promise<void> {
  if (!conf() || !g.__urpaySynced) return Promise.resolve();
  if (g.__urpayRefreshPromise) return g.__urpayRefreshPromise;
  g.__urpayRefreshPromise = runSerialized(async () => {
    try {
      const cl = await getClient();
      if (!cl) return;
      // NOTE: calls the UN-QUEUED persist core — going through the queued
      // persistState() here would chain it behind this very refresh and
      // deadlock the serialization queue (requests would hang forever).
      await persistCore(); // flush local changes first (remote wins later)
      const rows = await selectAll(cl);
      applyRemote(getDb(), rows);
      g.__urpaySynced = snapshot(getDb());
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
  if (!conf() || !g.__urpaySynced) return Promise.resolve(); // off or failed
  return runSerialized(persistCore).catch(() => {
    /* persistState never rejects */
  });
}

/** The actual diff+write — runs INSIDE the serialization queue (either via
 * persistState() after a request, or inline inside refreshNow). */
async function persistCore(): Promise<void> {
  if (!g.__urpaySynced) return;
  const cl = await getClient();
  if (!cl) return;

    const db = getDb();
    const current = snapshot(db);
    const stmts: InStatement[] = [];
    const upsert = (tbl: string, rid: string, data: string): void => {
      stmts.push({
        sql: "INSERT OR REPLACE INTO aurpay_state (tbl, rid, data) VALUES (?, ?, ?)",
        args: [tbl, rid, data],
      });
    };
    const remove = (tbl: string, rid: string): void => {
      stmts.push({
        sql: "DELETE FROM aurpay_state WHERE tbl = ? AND rid = ?",
        args: [tbl, rid],
      });
    };

    for (const t of TABLES) {
      const cur = current.get(t)!;
      const old = g.__urpaySynced.get(t);
      if (!old) {
        for (const [rid, data] of cur) upsert(t, rid, data);
        continue;
      }
      for (const [rid, data] of cur) {
        if (old.get(rid) !== data) upsert(t, rid, data);
      }
      for (const rid of old.keys()) {
        if (!cur.has(rid)) remove(t, rid);
      }
    }

    const seqJson = JSON.stringify(db.seq);
    if (g.__urpaySynced.get(META_TBL)?.get(META_SEQ) !== seqJson) {
      upsert(META_TBL, META_SEQ, seqJson);
      current.set(META_TBL, new Map([[META_SEQ, seqJson]]));
    } else {
      current.set(META_TBL, new Map([[META_SEQ, seqJson]]));
    }

    if (stmts.length > 0) {
      try {
        for (let i = 0; i < stmts.length; i += CHUNK) {
          await cl.batch(stmts.slice(i, i + CHUNK));
        }
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

/* ---------------------------------------------------------------- status --- */

/** Health-endpoint view of the persistence layer. */
export function persistenceInfo():
  | { mode: "memory" }
  | { mode: "turso" | "failed" | "starting"; url: string; error: string | null } {
  const c = conf();
  if (!c) return { mode: "memory" };
  const url = c.url.startsWith("file:")
    ? c.url
    : c.url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
  const mode = g.__urpaySynced
    ? "turso"
    : g.__urpayPersistError
      ? "failed"
      : "starting";
  return { mode: mode as "turso" | "failed" | "starting", url, error: g.__urpayPersistError ?? null };
}
