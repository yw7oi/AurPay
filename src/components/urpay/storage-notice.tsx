"use client";

/* Storage mode notice — the honest answer to "why do new accounts vanish?".
 *
 * On boot it asks /api/health once. When the app runs on Vercel serverless
 * WITHOUT a shared store (mode "memory") or with a broken one ("failed"),
 * a dismissible amber strip explains the situation and the one-click fix
 * (Storage tab → Blob → Connect → Redeploy). Locally / in the sandbox
 * (single dev process) memory mode is perfectly stable, so nothing shows. */

import { useEffect, useState } from "react";
import { TriangleAlert, X } from "lucide-react";

type HealthDb = {
  mode: "memory" | "turso" | "blob" | "failed" | "starting";
  error?: string | null;
  serverless?: boolean;
  hint?: string | null;
};
type Health = { db?: HealthDb };

export function StorageNotice() {
  const [notice, setNotice] = useState<
    { tone: "warn" | "bad"; text: string } | null
  >(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
      .then((h) => {
        if (!alive || !h?.db) return;
        const db = h.db;
        if (db.serverless && db.mode === "memory") {
          setNotice({
            tone: "warn",
            text:
              db.hint ??
              "نسخة فيرسيل تعمل بدون قاعدة بيانات دائمة — الحسابات الجديدة قد تضيع. فعّل Blob من تبويب Storage ثم أعد النشر.",
          });
        } else if (db.serverless && (db.mode === "failed" || db.mode === "starting")) {
          setNotice({
            tone: "bad",
            text:
              "التخزين الدائم مفعّل لكن الاتصال فاشل — راجع /api/health للتفاصيل،" +
              (db.error ? ` آخر خطأ: ${db.error.slice(0, 120)}` : ""),
          });
        }
      })
      .catch(() => {
        /* health is best-effort — never block the app */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!notice || dismissed) return null;

  const warn =
    notice.tone === "warn"
      ? "border-amber-300/60 bg-amber-50 text-amber-900"
      : "border-red-300/60 bg-red-50 text-red-900";

  return (
    <div
      role="status"
      aria-live="polite"
      dir="rtl"
      className={`w-full border-b ${warn} px-4 py-2.5 text-xs leading-relaxed`}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2.5">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        <p className="flex-1 font-medium">{notice.text}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="إغلاق التنبيه"
          className="rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
