"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Download, History, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { fmtIQD, urpay, type Txn } from "@/lib/urpay";
import { EmptyState, TxnRow } from "./parts";

const FILTERS = [
  { key: "all", labelKey: "txns.filter.all" },
  { key: "bill_payment", labelKey: "txns.filter.billPayment" },
  { key: "transfer_out", labelKey: "txns.filter.transferOut" },
  { key: "transfer_in", labelKey: "txns.filter.transferIn" },
  { key: "topup", labelKey: "txns.filter.topup" },
] as const;

export function TransactionsView() {
  const { token, user } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

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

  async function exportCsv() {
    if (!token || exporting) return;
    setExporting(true);
    try {
      await urpay.exportTransactionsCsv(token);
      setExported(true);
      toast({
        title: t("txns.exportOk"),
        description: t("txns.exportOkDesc"),
      });
      setTimeout(() => setExported(false), 2500);
    } catch {
      toast({ title: t("txns.exportFail"), description: t("txns.exportFailDesc") });
    } finally {
      setExporting(false);
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl">{t("txns.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("txns.subtitle")}
          </p>
        </div>
        <Button
          onClick={exportCsv}
          disabled={exporting || !txns || txns.length === 0}
          size="sm"
          variant="outline"
          className="rounded-xl border-primary/30 text-primary hover:bg-primary/[.06] hover:border-primary/50 font-bold gap-2"
        >
          {exported ? (
            <Check className="h-4 w-4" />
          ) : (
            <Download className={`h-4 w-4 ${exporting ? "animate-bounce" : ""}`} />
          )}
          {exported ? t("txns.exported") : exporting ? t("txns.exporting") : t("txns.exportCsv")}
        </Button>
      </div>

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[0.68rem] font-semibold text-muted-foreground flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3 text-rose-500 dark:text-rose-300" />
              {t("txns.outTotal")}
            </p>
            <p className="num mt-1 font-bold text-rose-600 dark:text-rose-300">
              {fmtIQD(totals.out, true, lang)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-[0.68rem] font-semibold text-muted-foreground flex items-center gap-1">
              <ArrowDownLeft className="h-3 w-3 text-emerald-600 dark:text-emerald-300" />
              {t("txns.inTotal")}
            </p>
            <p className="num mt-1 font-bold text-emerald-600 dark:text-emerald-300">
              {fmtIQD(totals.inn, true, lang)}
            </p>
          </div>
          <div className="rounded-2xl border border-primary/25 bg-primary/[.05] p-4">
            <p className="text-[0.68rem] font-semibold text-muted-foreground">{t("txns.currentBalance")}</p>
            <p className="num mt-1 font-bold text-primary">
              {fmtIQD(user.balance, true, lang)}
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
              {t(f.labelKey)}
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
          title={t("txns.emptyTitle")}
          desc={t("txns.emptyDesc")}
        />
      ) : (
        <div className="space-y-2.5 max-h-[calc(100vh-22rem)] overflow-y-auto scrollbar-slim pe-1">
          {filtered.map((t) => (
            <TxnRow key={t.id} txn={t} />
          ))}
          {filtered.length >= 120 && (
            <p className="text-center text-xs text-muted-foreground py-2">
              {t("txns.lastN", { n: 120 })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
