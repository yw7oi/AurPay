"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, History, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/store";
import { fmtIQD, urpay, type Txn } from "@/lib/urpay";
import { EmptyState, TxnRow } from "./parts";

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "bill_payment", label: "فواتير" },
  { key: "transfer_out", label: "تحويلات صادرة" },
  { key: "transfer_in", label: "تحويلات واردة" },
  { key: "topup", label: "شحن وإيداع" },
] as const;

export function TransactionsView() {
  const { token, user } = useSession();
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!token) return;
    urpay.transactions(token, 120).then(setTxns).catch(() => setTxns([]));
  }, [token]);

  const filtered = useMemo(() => {
    if (!txns) return null;
    return filter === "all" ? txns : txns.filter((t) => t.type === filter);
  }, [txns, filter]);

  const totals = useMemo(() => {
    if (!txns) return null;
    const out = txns.filter((t) => t.direction === "out").reduce((s, t) => s + t.amount, 0);
    const inn = txns.filter((t) => t.direction === "in").reduce((s, t) => s + t.amount, 0);
    return { out, inn };
  }, [txns]);

  if (!user) return null;

  return (
    <div className="space-y-5" dir="rtl">
      <div>
        <h1 className="font-display text-2xl">سجل المعاملات</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          كل حركة بمحفظتك — مع الرقم المرجعي والرصيد بعد كل عملية.
        </p>
      </div>

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[0.68rem] font-semibold text-muted-foreground flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3 text-rose-500 dark:text-rose-300" />
              صادر
            </p>
            <p className="num mt-1 font-bold text-rose-600 dark:text-rose-300" dir="rtl">
              {fmtIQD(totals.out)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[0.68rem] font-semibold text-muted-foreground flex items-center gap-1">
              <ArrowDownLeft className="h-3 w-3 text-emerald-600 dark:text-emerald-300" />
              وارد
            </p>
            <p className="num mt-1 font-bold text-emerald-600 dark:text-emerald-300" dir="rtl">
              {fmtIQD(totals.inn)}
            </p>
          </div>
          <div className="rounded-2xl border border-primary/25 bg-primary/[.05] p-4">
            <p className="text-[0.68rem] font-semibold text-muted-foreground">الرصيد الحالي</p>
            <p className="num mt-1 font-bold text-primary" dir="rtl">
              {fmtIQD(user.balance)}
            </p>
          </div>
        </div>
      )}

      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="rounded-2xl bg-secondary p-1 h-auto flex-wrap">
          {FILTERS.map((f) => (
            <TabsTrigger
              key={f.key}
              value={f.key}
              className="rounded-xl px-3.5 py-2 font-bold text-xs data-[state=active]:bg-card"
            >
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {filtered === null ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[4.5rem] rounded-2xl bg-secondary/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title="ما هني معاملات بهذا التصنيف"
          desc="جرّب تصنيفًا آخر، أو ابدأ بدفع فاتورة أو تحويل."
        />
      ) : (
        <div className="space-y-2.5 max-h-[calc(100vh-22rem)] overflow-y-auto scrollbar-slim pe-1">
          {filtered.map((t) => (
            <TxnRow key={t.id} txn={t} />
          ))}
          {filtered.length >= 120 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              أُظهرت آخر 120 معاملة
            </p>
          )}
        </div>
      )}
    </div>
  );
}
