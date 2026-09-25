"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight, LayoutGrid, Loader2, MessageSquareHeart, PiggyBank, Plus, Send,
  Sparkles, Wallet, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/lib/store";
import { useT } from "@/lib/i18n";
import {
  Bill, Txn, dueLabel, fmtIQD, urpay, type Receipt,
} from "@/lib/urpay";
import { BillRow, EmptyState, PinDialog, ReceiptCard, TxnDetailDialog, TxnRow } from "./parts";
import { useToast } from "@/hooks/use-toast";
import { CategoryIcon } from "./icons";
import type { DashTab } from "./dashboard";
import { UrPayMark } from "./logo";
import { AnalyticsCard } from "./analytics";
import { BudgetCard } from "./budget-card";
import { GoalsCard } from "./goals-card";
import { ScheduledCard } from "./scheduled-card";

/* Animated count-up balance — rAF + easeOutCubic, re-runs when value changes */
function useCountUp(target: number, duration = 850): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/* hero balance with count-up + tabular figures so digits don't jitter */
function CountUpBalance({ target, lang }: { target: number; lang: "ar" | "en" }) {
  const v = useCountUp(target);
  return (
    <p className="font-display mt-2 text-4xl sm:text-5xl num tracking-tight">
      {fmtIQD(v, true, lang)}
    </p>
  );
}

export function OverviewView({
  setTab,
  refreshKey,
}: {
  setTab: (t: DashTab) => void;
  refreshKey: number;
}) {
  const { user, token, setUser } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [txnDetail, setTxnDetail] = useState<Txn | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  /* total earmarked in savings goals — powers the hero "وفّرت" badge */
  const [savedTotal, setSavedTotal] = useState(0);

  useEffect(() => {
    if (!token) return;
    urpay.bills(token, "unpaid").then(setBills).catch(() => setBills([]));
    urpay.transactions(token, 6).then(setTxns).catch(() => setTxns([]));
    urpay.goals(token)
      .then((g) => setSavedTotal(g.totals.saved))
      .catch(() => null);
  }, [token, refreshKey]);

  if (!user) return null;

  const unpaid = bills ?? [];
  const unpaidTotal = unpaid.reduce((s, b) => s + b.amount, 0);
  const overdue = unpaid.filter((b) => b.overdue).length;

  /* time-aware Iraqi greeting */
  const h = new Date().getHours();
  const greeting =
    h >= 4 && h < 12
      ? { text: t("overview.greetingMorning"), emoji: "☀️" }
      : h >= 12 && h < 17
        ? { text: t("overview.greetingAfternoon"), emoji: "🌤️" }
        : h >= 17 && h < 20
          ? { text: t("overview.greetingEvening"), emoji: "🌇" }
          : { text: t("overview.greetingEvening"), emoji: "🌙" };

  return (
    <div className="space-y-6">
      {/* balance hero */}
      <section className="relative overflow-hidden rounded-3xl bg-night text-[#F4F1E8] p-6 sm:p-8 grain shadow-lift-lg">
        <div className="absolute inset-0 pattern-ur-dark opacity-80" aria-hidden="true" />
        <div
          className="absolute -top-24 -end-24 h-64 w-64 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(62,217,163,.22), transparent)" }}
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-white/55 text-sm font-medium">
              {t("overview.greetingLine", { greeting: greeting.text, name: user.first_name, emoji: greeting.emoji })}
            </p>
            <p className="text-white/55 text-[0.7rem] mt-1 num">
              {new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar-IQ-u-nu-latn", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </p>
            <CountUpBalance target={user.balance} lang={lang} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-white/10 text-white/80 border-white/15 hover:bg-white/10 text-[0.68rem]">
                <Wallet className="h-3 w-3 me-1" />
                {t("overview.walletBadge")}
              </Badge>
              <Badge className="rounded-full bg-white/10 text-white/80 border-white/15 hover:bg-white/10 text-[0.68rem] num" dir="ltr">
                •••• {user.card_number.slice(-4)}
              </Badge>
              {savedTotal > 0 && (
                <Badge className="rounded-full bg-[#3ED9A3]/15 text-[#7CE8C2] border-[#3ED9A3]/30 hover:bg-[#3ED9A3]/15 text-[0.68rem] gap-1">
                  <PiggyBank className="h-3 w-3" />
                  {t("overview.savedBadge")}{" "}
                  <span className="num font-bold">{fmtIQD(savedTotal, false, lang)}</span>
                </Badge>
              )}
              {user.is_demo && (
                <Badge className="rounded-full bg-[#E8C867]/15 text-[#E8C867] border-[#E8C867]/30 hover:bg-[#E8C867]/15 text-[0.68rem]">
                  {t("overview.demoBadge")}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <Button
              onClick={() => setTab("bills")}
              className="rounded-2xl bg-[#3ED9A3] text-[#0C2A21] hover:bg-[#5ce0b0] font-bold h-11 px-5 shadow-gold"
            >
              <Zap className="h-4 w-4" />
              {t("overview.payBillBtn")}
            </Button>
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                onClick={() => setTab("transfer")}
                className="rounded-2xl bg-white/10 border border-white/20 text-white hover:bg-white/15 hover:text-white font-bold h-11 px-4"
              >
                <Send className="h-4 w-4" />
                {t("overview.transferBtn")}
              </Button>
              <Button
                onClick={() => setTopupOpen(true)}
                className="rounded-2xl bg-white/10 border border-white/20 text-white hover:bg-white/15 hover:text-white font-bold h-11 px-4"
              >
                <Wallet className="h-4 w-4" />
                {t("overview.topUpBtn")}
              </Button>
            </div>
            <Button
              onClick={() => setTab("agent")}
              className="rounded-2xl bg-transparent border border-[#E8C867]/40 text-[#E8C867] hover:bg-[#E8C867]/10 hover:text-[#E8C867] font-bold h-11 px-5"
            >
              <MessageSquareHeart className="h-4 w-4" />
              {t("overview.askUrBtn")}
            </Button>
          </div>
        </div>
      </section>

      {/* alerts */}
      {overdue > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/[.06] px-4 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
            <LayoutGrid className="h-4 w-4" />
          </span>
          <p className="text-sm font-semibold flex-1">
            {t("overview.overdueAlertStart")} <b className="num">{overdue}</b> {t("overview.overdueAlertEnd")}
          </p>
          <Button size="sm" variant="destructive" onClick={() => setTab("bills")} className="rounded-xl font-bold">
            {t("overview.showBillsBtn")}
          </Button>
        </div>
      )}

      {/* spend analytics */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <AnalyticsCard refreshKey={refreshKey} />
      </motion.div>

      {/* monthly budgets */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.09 }}
      >
        <BudgetCard refreshKey={refreshKey} />
      </motion.div>

      {/* savings goals */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <GoalsCard refreshKey={refreshKey} />
      </motion.div>

      {/* scheduled payments */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.11 }}
      >
        <ScheduledCard refreshKey={refreshKey} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.12 }}
        className="grid lg:grid-cols-[1.15fr_.85fr] gap-6">
        {/* upcoming bills */}
        <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg">{t("overview.upcomingBillsTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {unpaid.length > 0 ? (
                  <>
                    <b className="num text-foreground">{unpaid.length}</b> {t("overview.billsCountSuffix")}{" "}
                    <b className="num text-primary">{fmtIQD(unpaidTotal, true, lang)}</b>
                  </>
                ) : (
                  t("bills.allPaid")
                )}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setTab("bills")} className="rounded-xl font-semibold">
              {t("overview.viewAllBtn")}
              <ArrowUpRight className="ms-1 h-3.5 w-3.5" />
            </Button>
          </div>
          {bills === null ? (
            <SkeletonRows />
          ) : unpaid.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title={t("bills.noUnpaidTitle")}
              desc={t("overview.noUnpaidDesc")}
              action={
                <Button size="sm" onClick={() => setTab("bills")} className="rounded-xl font-bold">
                  <Plus className="h-4 w-4" />
                  {t("bills.simulateBtn")}
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto scrollbar-slim pe-1">
              {unpaid.slice(0, 5).map((b) => (
                <BillRow key={b.id} bill={b} onPay={setPaying} />
              ))}
            </div>
          )}
        </section>

        {/* recent txns + agent teaser */}
        <div className="space-y-6">
          <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg">{t("overview.recentTitle")}</h2>
              <Button variant="outline" size="sm" onClick={() => setTab("transactions")} className="rounded-xl font-semibold">
                {t("overview.fullHistoryBtn")}
              </Button>
            </div>
            {txns === null ? (
              <SkeletonRows rows={4} />
            ) : txns.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t("overview.noTxns")}
              </p>
            ) : (
              <div className="space-y-2.5">
                {txns.slice(0, 5).map((t) => (
                  <TxnRow key={t.id} txn={t} onOpen={setTxnDetail} />
                ))}
              </div>
            )}
          </section>

          {/* agent teaser */}
          <section className="relative overflow-hidden rounded-3xl border border-gold/35 bg-gold/[.06] p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <UrPayMark className="h-12 w-12 shrink-0" />
              <div className="min-w-0">
                <p className="font-display text-base">{t("overview.tryUrTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("overview.tryUrDesc")}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[t("overview.chipBalance"), t("overview.chipBills"), t("overview.chipPayBill")].map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-gold/40 bg-card px-3 py-1 text-[0.68rem] font-semibold text-gold-deep"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <Button
                  size="sm"
                  onClick={() => setTab("agent")}
                  className="mt-4 rounded-xl font-bold h-9"
                >
                  <MessageSquareHeart className="h-4 w-4" />
                  {t("overview.openChatBtn")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </motion.div>

      {/* PIN + receipt for quick payment */}
      <PinDialog
        open={!!paying}
        onOpenChange={(v) => !v && setPaying(null)}
        title={t("bills.payConfirmTitle")}
        description={paying ? `${paying.biller_name} · ${paying.period || t("bills.noPeriod")}` : ""}
        amount={paying?.amount}
        confirmText={t("bills.payNowBtn")}
        onConfirm={async (pin) => {
          if (!token || !paying) return t("common.unexpectedError");
          try {
            const r = await urpay.payBill(token, paying.id, pin);
            setReceipt(r);
            setBills((bs) =>
              (bs ?? []).map((b) =>
                b.id === paying.id
                  ? { ...b, status: "paid", paid_at: r.created_at, receipt_ref: r.reference }
                  : b,
              ),
            );
            const me = await urpay.me(token);
            setUser(me);
            toast({
              title: t("bills.paidToastTitle"),
              description: `${paying.biller_name} — ${fmtIQD(paying.amount, true, lang)}`,
            });
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : t("common.opFailed");
          }
        }}
      />
      {/* txn detail (click a recent row) */}
      <TxnDetailDialog txn={txnDetail} onOpenChange={(v) => !v && setTxnDetail(null)} />

      {/* wallet top-up */}
      <TopUpDialog
        open={topupOpen}
        onOpenChange={(v) => {
          setTopupOpen(v);
          if (!v) setTopupAmount("");
        }}
        amountStr={topupAmount}
        setAmountStr={setTopupAmount}
        onDone={(r) => {
          setReceipt(r);
          if (token) urpay.me(token).then(setUser).catch(() => null);
          toast({
            title: t("overview.topupToastTitle"),
            description: t("overview.topupToastDesc", {
              amount: fmtIQD(r.amount, true, lang),
              balance: fmtIQD(r.balance_after, true, lang),
            }),
          });
        }}
      />

      {/* receipt — same Radix pattern as bills view (Escape + a11y) */}
      <Dialog open={!!receipt} onOpenChange={(v) => !v && setReceipt(null)}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("bills.receiptTitle")}</DialogTitle>
            <DialogDescription>{t("bills.receiptDesc")}</DialogDescription>
          </DialogHeader>
          {receipt && (
            <>
              <ReceiptCard receipt={receipt} floating />
              <Button
                variant="outline"
                onClick={() => setReceipt(null)}
                className="mt-3 w-full rounded-2xl font-bold"
              >
                {t("overview.doneCloseBtn")}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 rounded-2xl border border-border/50 bg-secondary/40 p-4 animate-pulse"
        >
          <div className="h-10 w-10 rounded-xl bg-border/60" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-2/3 rounded bg-border/60" />
            <div className="h-2.5 w-1/3 rounded bg-border/40" />
          </div>
          <div className="h-4 w-16 rounded bg-border/60" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TopUpDialog({
  open,
  onOpenChange,
  amountStr,
  setAmountStr,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  amountStr: string;
  setAmountStr: (v: string) => void;
  onDone: (r: Receipt) => void;
}) {
  const { token } = useSession();
  const { t } = useT();
  const [pinOpen, setPinOpen] = useState(false);
  const amount = Number(amountStr);
  const valid = amount >= 1000 && amount <= 5_000_000;

  return (
    <>
      <Dialog open={open && !pinOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Wallet className="h-4.5 w-4.5 h-[18px] w-[18px]" />
              </span>
              {t("overview.topupDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("overview.topupDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder="100000"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, "").slice(0, 7))}
                className="num text-left text-lg font-bold pe-12 h-12"
              />
              <span className="absolute inset-y-0 end-4 flex items-center text-xs font-semibold text-muted-foreground">
                {t("common.iqd")}
              </span>
            </div>
            <div className="flex gap-1.5">
              {[50000, 100000, 250000, 500000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmountStr(String(v))}
                  className={`flex-1 rounded-xl border px-2 py-2 text-[0.68rem] font-bold num transition-colors ${
                    amount === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 bg-secondary text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {v.toLocaleString("en-US")}
                </button>
              ))}
            </div>
            <Button
              disabled={!valid}
              onClick={() => setPinOpen(true)}
              className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
            >
              <Wallet className="h-4 w-4" />
              {t("overview.topupContinueBtn")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PinDialog
        open={pinOpen}
        onOpenChange={(v) => {
          setPinOpen(v);
          if (!v) onOpenChange(false);
        }}
        title={t("overview.topupPinTitle")}
        description={t("overview.topupPinDesc")}
        amount={valid ? amount : undefined}
        confirmText={t("overview.topupPinConfirm")}
        onConfirm={async (pin) => {
          if (!token || !valid) return t("common.unexpectedError");
          try {
            const r = await urpay.topup(token, amount, pin);
            onDone(r);
            setPinOpen(false);
            onOpenChange(false);
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : t("common.opFailed");
          }
        }}
      />
    </>
  );
}
