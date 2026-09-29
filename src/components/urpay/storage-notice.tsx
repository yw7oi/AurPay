"use client";

/* Storage mode notice + self-service diagnostics — the honest answer to
 * "why do new accounts vanish?" and "is my Blob store actually linked?".
 *
 * On boot it asks /api/health once. When the app runs on Vercel serverless
 * WITHOUT a shared store (mode "memory") or with a broken one ("failed"),
 * a dismissible amber/red strip explains the situation and the one-click fix
 * (Storage tab → Blob → Connect → Redeploy). Locally / in the sandbox
 * (single dev process) memory mode is perfectly stable, so nothing shows.
 *
 * The strip embeds a diagnostics panel: "افحص التخزين الآن" hits
 * /api/health?probe=1 which runs a REAL write→read→delete round-trip
 * through the store, then renders:
 *   - the live probe verdict (+ latency, or the raw error),
 *   - which credentials THIS deployment can see (BLOB_READ_WRITE_TOKEN /
 *     BLOB_STORE_ID / OIDC / TURSO — booleans only, never values),
 *   - a targeted Arabic `advice` naming the exact next step
 *     (all-false ⇒ the deployment predates the store connection ⇒ Redeploy). */

import { useEffect, useState } from "react";
import {
  Check,
  Database,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";

type HealthDb = {
  mode: "memory" | "turso" | "blob" | "failed" | "starting";
  url?: string | null;
  error?: string | null;
  serverless?: boolean;
  hint?: string | null;
  env?: {
    blobToken: boolean;
    blobStoreId: boolean;
    oidc: boolean;
    turso: boolean;
  } | null;
};
type Probe = {
  ok: boolean;
  mode: string;
  ms: number;
  error: string | null;
  advice: string | null;
};
type Health = { db?: HealthDb; probe?: Probe | null };

const MODE_LABEL: Record<string, string> = {
  memory: "ذاكرة مؤقتة",
  turso: "Turso",
  blob: "Vercel Blob",
  failed: "فاشل",
  starting: "قيد التهيئة",
};

function EnvChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        on
          ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-800"
          : "border-black/10 bg-black/[0.04] text-black/45"
      }`}
    >
      {on ? (
        <Check className="h-2.5 w-2.5" aria-hidden />
      ) : (
        <X className="h-2.5 w-2.5" aria-hidden />
      )}
      {label}
    </span>
  );
}

export function StorageNotice() {
  const [db, setDb] = useState<HealthDb | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
      .then((h) => {
        if (alive && h?.db) setDb(h.db);
      })
      .catch(() => {
        /* health is best-effort — never block the app */
      });
    return () => {
      alive = false;
    };
  }, []);

  const runProbe = async () => {
    setChecking(true);
    setProbe(null);
    try {
      const r = await fetch("/api/health?probe=1");
      const h = (await r.json()) as Health;
      if (h?.db) setDb(h.db);
      setProbe(h?.probe ?? null);
    } catch {
      setProbe({
        ok: false,
        mode: "?",
        ms: 0,
        error: "network",
        advice: "تعذّر الوصول إلى /api/health — أعد تحميل الصفحة وحاول مجددًا.",
      });
    } finally {
      setChecking(false);
    }
  };

  const visible =
    !!db?.serverless &&
    (db.mode === "memory" || db.mode === "failed" || db.mode === "starting");

  if (!visible || dismissed) return null;

  const warn =
    db!.mode === "memory"
      ? "border-amber-300/60 bg-amber-50 text-amber-900"
      : "border-red-300/60 bg-red-50 text-red-900";

  const noticeText =
    db!.mode === "memory"
      ? (db!.hint ??
        "نسخة فيرسيل تعمل بدون قاعدة بيانات دائمة — الحسابات الجديدة قد تضيع. فعّل Blob من تبويب Storage ثم أعد النشر.")
      : "التخزين الدائم مفعّل لكن الاتصال فاشل — افتح الفحص بالأسفل أو راجع /api/health للتفاصيل" +
        (db!.error ? ` (آخر خطأ: ${db!.error.slice(0, 120)})` : "");

  return (
    <div
      role="status"
      aria-live="polite"
      dir="rtl"
      className={`w-full border-b ${warn} px-4 py-2.5 text-xs leading-relaxed`}
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-2.5">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <p className="flex-1 font-medium">{noticeText}</p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="إغلاق التنبيه"
            className="rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>

        {/* self-service diagnostics — answers "is my store linked?" in one click */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runProbe}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-md border border-current/25 bg-white/60 px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors hover:bg-white disabled:opacity-60"
          >
            {checking ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Database className="h-3 w-3" aria-hidden />
            )}
            {checking ? "جاري الفحص…" : "افحص التخزين الآن"}
          </button>
          {db!.env ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <EnvChip label="BLOB_READ_WRITE_TOKEN" on={db!.env.blobToken} />
              <EnvChip label="BLOB_STORE_ID" on={db!.env.blobStoreId} />
              <EnvChip label="VERCEL_OIDC_TOKEN" on={db!.env.oidc} />
              {db!.env.turso ? <EnvChip label="TURSO" on /> : null}
            </span>
          ) : null}
        </div>

        {probe ? (
          <div className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  probe.ok
                    ? "bg-emerald-600/10 text-emerald-700"
                    : "bg-red-600/10 text-red-700"
                }`}
              >
                {probe.ok ? (
                  <Check className="h-3 w-3" aria-hidden />
                ) : (
                  <X className="h-3 w-3" aria-hidden />
                )}
                {probe.ok ? "التخزين يعمل" : "الفحص فشل"}
              </span>
              <span className="text-[10px] font-medium text-black/55">
                الوضع: {MODE_LABEL[probe.mode] ?? probe.mode}
                {probe.ok ? ` · ${probe.ms}ms` : ""}
              </span>
              {probe.ok && db!.url ? (
                <span className="max-w-full truncate text-[10px] text-black/40" dir="ltr">
                  {db!.url}
                </span>
              ) : null}
            </div>
            {probe.error ? (
              <p
                dir="ltr"
                className="mt-1.5 max-h-16 overflow-y-auto rounded bg-red-600/5 px-2 py-1 font-mono text-[10px] text-red-800"
              >
                {probe.error}
              </p>
            ) : null}
            {probe.advice ? (
              <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-black/70">
                {probe.advice}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
