"use client";

/* ScheduledCard — pending scheduled payments (auto-executed by the backend
   scheduler loop) + creation dialog. Data from GET /api/scheduled
   (pending + history + totals). */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight, CalendarClock, CalendarPlus, Loader2, Pause, Pencil,
  Play, ReceiptText, Send, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/store";
import {
  fmtDateTime, fmtIQD, urpay,
  type CategoryMeta, type ScheduledFeed,
} from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { useT, type Lang } from "@/lib/i18n";
import { EmptyState, PinDialog } from "./parts";
import type { ScheduledItem } from "@/lib/urpay";

/* ------------------------------------------------------------------ */
/* helpers                                                             */

type BillersFeed = {
  categories: CategoryMeta[];
  billers: Record<string, { code: string; name: string }[]>;
};

/** Compact remaining-time unit ("45 دقيقة" / "3h") — numeric units inline,
    interpolated into the shared scheduled.countdown dict key. */
function countdownLabel(iso: string, lang: Lang, now: number): string {
  const mins = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60_000));
  if (mins < 60) return lang === "en" ? `${mins}m` : `${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return lang === "en" ? `${hours}h` : `${hours} سا`;
  const days = Math.floor(hours / 24);
  return lang === "en" ? `${days}d` : `${days} يوم`;
}

/* shared chip look (TopUpDialog quick-amount style) — size is injectable so
   the kind toggle can run larger without class conflicts */
function chip(active: boolean, size = "px-3 py-2 text-xs"): string {
  return `rounded-xl border font-bold transition-colors ${size} ${
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border/70 bg-secondary text-muted-foreground hover:border-primary/40 hover:text-foreground"
  }`;
}

/* 3-row loading skeleton (same look as overview's SkeletonRows) */
function ScheduledSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
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

export function ScheduledCard({ refreshKey }: { refreshKey: number }) {
  const { token } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [feed, setFeed] = useState<ScheduledFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledItem | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /* bumped after create/cancel → reload without waiting for refreshKey */
  const [signal, setSignal] = useState(0);
  /* live countdown clock — 30s tick keeps "باقي …" labels fresh */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setFeed(await urpay.scheduled(token));
      setFailed(false);
    } catch {
      /* silent — keep last known feed; hides only if it never loaded */
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey, signal]);

  /* auto-refresh every 60s — executed mandates move to history live
     (pairs with the backend's 20s scheduler loop) */
  useEffect(() => {
    const id = setInterval(() => {
      setSignal((s) => s + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  async function cancelItem(id: number) {
    if (!token) return;
    setBusyId(id);
    try {
      await urpay.scheduledCancel(token, id);
      toast({ title: t("scheduled.cancelToastTitle") });
      setSignal((s) => s + 1);
    } catch (err) {
      toast({
        title: t("common.opFailed"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function togglePause(item: ScheduledItem) {
    if (!token) return;
    setBusyId(item.id);
    try {
      if (item.status === "paused") {
        await urpay.scheduledResume(token, item.id);
        toast({ title: t("scheduled.resumedToastTitle") });
      } else {
        await urpay.scheduledPause(token, item.id);
        toast({ title: t("scheduled.pausedToastTitle") });
      }
      setSignal((s) => s + 1);
    } catch (err) {
      toast({
        title: t("common.opFailed"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  /* hidden on hard (first-load) failure — avoids a misleading empty state */
  if (!token || (failed && feed === null)) return null;

  const pending = feed?.pending ?? [];
  const history = feed?.history ?? [];
  const monthlyTotal = feed?.monthly_total ?? 0;

  return (
    <>
      <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg leading-tight">{t("scheduled.title")}</h2>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                {t("scheduled.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {monthlyTotal > 0 && (
              <Badge className="rounded-full bg-gold/15 text-gold-deep hover:bg-gold/15 gap-1.5 text-[0.68rem] whitespace-nowrap">
                {t("scheduled.monthlyTotal")}
                <span className="num font-bold">{fmtIQD(monthlyTotal, false, lang)}</span>
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="rounded-xl font-bold"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              {t("scheduled.newBtn")}
            </Button>
          </div>
        </div>

        {/* body */}
        {feed === null ? (
          <ScheduledSkeleton />
        ) : pending.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <EmptyState
              icon={CalendarClock}
              title={t("scheduled.emptyTitle")}
              desc={t("scheduled.emptyDesc")}
              action={
                <Button size="sm" onClick={() => setAddOpen(true)} className="rounded-xl font-bold">
                  <CalendarPlus className="h-4 w-4" />
                  {t("scheduled.newBtn")}
                </Button>
              }
            />
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-2.5 max-h-96 overflow-y-auto scrollbar-slim pe-1"
          >
            {pending.map((item) => {
              const paused = item.status === "paused";
              return (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${
                  paused
                    ? "border-border/50 bg-secondary/40 border-dashed opacity-80"
                    : "border-border/60 bg-background/60 hover:border-primary/30"
                }`}
              >
                <span
                  title={item.kind === "bill"
                    ? t("scheduled.billIconTitle")
                    : t("scheduled.transferIconTitle")}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${
                    item.kind === "bill"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20"
                      : "bg-violet-500/10 text-violet-600 dark:text-violet-300 ring-violet-500/20"
                  } ${paused ? "grayscale-[.6]" : ""}`}
                >
                  {item.kind === "bill"
                    ? <ReceiptText className="h-4 w-4" />
                    : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm truncate">{item.label}</p>
                    {paused ? (
                      <Badge
                        variant="outline"
                        className="rounded-md text-[0.62rem] px-1.5 h-5 bg-stone-500/10 text-stone-600 dark:text-stone-300 border-stone-400/30"
                      >
                        <Pause className="h-2.5 w-2.5 me-0.5" />
                        {t("scheduled.pausedBadge")}
                      </Badge>
                    ) : item.frequency === "monthly" ? (
                      <Badge
                        variant="outline"
                        className="rounded-md text-[0.62rem] px-1.5 h-5 bg-gold/15 text-gold-deep border-gold/30"
                      >
                        {t("scheduled.monthlyBadge")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="rounded-md text-[0.62rem] px-1.5 h-5 text-muted-foreground"
                      >
                        {t("scheduled.onceBadge")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[0.7rem] text-muted-foreground mt-0.5 num">
                    {t("scheduled.nextRun", { when: fmtDateTime(item.next_run_at, lang) })}
                    {!paused && (
                      <>
                        {" · "}
                        <span className="font-semibold text-gold-deep">
                          {t("scheduled.countdown", {
                            left: countdownLabel(item.next_run_at, lang, now),
                          })}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <p className="num font-bold text-base shrink-0">
                  {fmtIQD(item.amount, false, lang)}
                  <span className="text-[0.6rem] font-medium text-muted-foreground block text-center mt-0.5">
                    {t("common.iqd")}
                  </span>
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busyId === item.id}
                  onClick={() => togglePause(item)}
                  className={`rounded-xl h-9 w-9 shrink-0 ${
                    paused
                      ? "text-primary hover:bg-primary/10 hover:text-primary"
                      : "text-muted-foreground hover:text-gold-deep hover:bg-gold/10"
                  }`}
                  aria-label={paused ? t("scheduled.resumeBtn") : t("scheduled.pauseBtn")}
                  title={paused ? t("scheduled.resumeBtn") : t("scheduled.pauseBtn")}
                >
                  {busyId === item.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : paused
                      ? <Play className="h-4 w-4" />
                      : <Pause className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busyId === item.id}
                  onClick={() => setEditing(item)}
                  className="rounded-xl h-9 w-9 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                  aria-label={t("scheduled.editBtn")}
                  title={t("scheduled.editBtn")}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busyId === item.id}
                  onClick={() => cancelItem(item.id)}
                  className="rounded-xl h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label={t("scheduled.cancelBtn")}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
              );
            })}
          </motion.div>
        )}

        {/* recent runs */}
        {history.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06 }}
            className="mt-4 pt-3.5 border-t border-border/60"
          >
            <p className="text-[0.7rem] font-bold text-muted-foreground mb-2">
              {t("scheduled.historyTitle")}
            </p>
            <div className="space-y-1.5">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/25 px-3 py-1.5"
                >
                  <p className="text-xs font-semibold truncate flex-1 min-w-0">{h.label}</p>
                  {h.status === "executed" && (
                    <Badge className="rounded-md text-[0.6rem] px-1.5 h-5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/10">
                      {t("scheduled.statusExecuted")}
                    </Badge>
                  )}
                  {h.status === "cancelled" && (
                    <Badge
                      variant="outline"
                      className="rounded-md text-[0.6rem] px-1.5 h-5 text-muted-foreground"
                    >
                      {t("scheduled.statusCancelled")}
                    </Badge>
                  )}
                  {h.status === "failed" && (
                    <Badge variant="destructive" className="rounded-md text-[0.6rem] px-1.5 h-5">
                      {t("scheduled.statusFailed")}
                    </Badge>
                  )}
                  <p className="num text-[0.68rem] text-muted-foreground shrink-0">
                    {fmtIQD(h.amount, false, lang)}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        <p className="mt-3.5 text-[0.68rem] text-muted-foreground text-center leading-relaxed">
          {t("scheduled.autopayHint")}
        </p>
      </section>

      <ScheduleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => setSignal((s) => s + 1)}
      />

      <EditScheduleDialog
        item={editing}
        onClose={() => setEditing(null)}
        onEdited={() => setSignal((s) => s + 1)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

type WhenChoice = "tomorrow" | "3days" | "firstOfMonth" | "custom";

function ScheduleDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { token } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [kind, setKind] = useState<"bill" | "transfer">("bill");
  const [billerCode, setBillerCode] = useState("");
  const [receiverCard, setReceiverCard] = useState("");
  const [amount, setAmount] = useState("");
  const [when, setWhen] = useState<WhenChoice>("tomorrow");
  const [customWhen, setCustomWhen] = useState("");
  const [frequency, setFrequency] = useState<"once" | "monthly">("once");
  const [pinOpen, setPinOpen] = useState(false);
  const [billers, setBillers] = useState<BillersFeed | null>(null);

  /* reset all fields during render when the dialog opens (budget-card pattern) */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKind("bill");
      setBillerCode("");
      setReceiverCard("");
      setAmount("");
      setWhen("tomorrow");
      setCustomWhen("");
      setFrequency("once");
      setPinOpen(false);
    }
  }

  /* billers catalog — lazy, loaded once on first open (bills-view pattern) */
  useEffect(() => {
    if (!open || billers) return;
    urpay.billers().then(setBillers).catch(() => setBillers({ categories: [], billers: {} }));
  }, [open, billers]);

  const amountNum = Number(amount);
  const cardClean = receiverCard.replace(/\D/g, "");

  /* execute_at from the selected "when" — always a fresh local Date */
  function computeExecuteAt(): Date | null {
    const base = new Date();
    if (when === "tomorrow") {
      const d = new Date(base);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    if (when === "3days") return new Date(base.getTime() + 3 * 86_400_000);
    if (when === "firstOfMonth") {
      return new Date(base.getFullYear(), base.getMonth() + 1, 1, 9, 0, 0, 0);
    }
    if (!customWhen) return null;
    const d = new Date(customWhen); /* datetime-local value → local time */
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const executeAt = computeExecuteAt();
  const valid =
    executeAt !== null &&
    amountNum >= 1000 &&
    amountNum <= 5_000_000 &&
    (kind === "bill" ? billerCode !== "" : cardClean.length === 16);

  async function confirmSchedule(pin: string): Promise<string | null> {
    if (!token || !valid || !executeAt) return t("common.unexpectedError");
    try {
      const res = await urpay.scheduleCreate(token, {
        kind,
        ...(kind === "bill" ? { biller_code: billerCode } : { receiver_card: cardClean }),
        amount: amountNum,
        execute_at: executeAt.toISOString(),
        frequency,
        pin,
      });
      toast({
        title: t("scheduled.successToastTitle"),
        description: `${res.scheduled.label} · ${fmtDateTime(res.scheduled.next_run_at, lang)}`,
      });
      setPinOpen(false);
      onOpenChange(false);
      onCreated();
      return null;
    } catch (err) {
      /* wrong PIN / API error — shown inside PinDialog (shake + retry) */
      return err instanceof Error ? err.message : t("common.opFailed");
    }
  }

  return (
    <>
      <Dialog open={open && !pinOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto scrollbar-slim">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="h-[18px] w-[18px]" />
              </span>
              {t("scheduled.dialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("scheduled.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* kind */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("bill")}
                aria-pressed={kind === "bill"}
                className={`flex items-center justify-center gap-2 ${chip(kind === "bill", "px-3 py-2.5 text-sm")}`}
              >
                <ReceiptText className="h-4 w-4" />
                {t("scheduled.kindBill")}
              </button>
              <button
                type="button"
                onClick={() => setKind("transfer")}
                aria-pressed={kind === "transfer"}
                className={`flex items-center justify-center gap-2 ${chip(kind === "transfer", "px-3 py-2.5 text-sm")}`}
              >
                <Send className="h-4 w-4" />
                {t("scheduled.kindTransfer")}
              </button>
            </div>

            {/* biller / receiver */}
            {kind === "bill" ? (
              <div>
                <label className="text-xs font-bold mb-1.5 block">{t("scheduled.billerLabel")}</label>
                <Select value={billerCode} onValueChange={setBillerCode}>
                  <SelectTrigger className="w-full bg-background rounded-xl h-11">
                    <SelectValue placeholder={billers ? t("bills.selectBiller") : t("common.loading")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl">
                    {billers?.categories.map((cat) => (
                      <SelectGroup key={cat.key}>
                        <SelectLabel>{lang === "en" ? cat.en : cat.ar}</SelectLabel>
                        {(billers.billers[cat.key] ?? []).map((b) => (
                          <SelectItem key={b.code} value={b.code}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <label className="text-xs font-bold mb-1.5 block">{t("scheduled.receiverLabel")}</label>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  placeholder={t("transfer.cardPlaceholder")}
                  value={receiverCard}
                  onChange={(e) =>
                    setReceiverCard(
                      e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 16)
                        .replace(/(\d{4})(?=\d)/g, "$1 "),
                    )
                  }
                  className="num text-left tracking-[0.08em] h-11 rounded-xl"
                />
              </div>
            )}

            {/* amount */}
            <div>
              <label className="text-xs font-bold mb-1.5 block">{t("scheduled.amountLabel")}</label>
              <div className="relative">
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="25000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  className="num text-left text-lg font-bold pe-12 h-12 rounded-xl"
                />
                <span className="absolute inset-y-0 end-4 flex items-center text-xs font-semibold text-muted-foreground">
                  {t("common.iqd")}
                </span>
              </div>
              <div className="mt-2 flex gap-1.5">
                {[25000, 50000, 100000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className={`num ${chip(amountNum === v, "flex-1 px-2 py-2 text-[0.68rem]")}`}
                  >
                    {v.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
            </div>

            {/* when */}
            <div>
              <label className="text-xs font-bold mb-1.5 block">{t("scheduled.whenLabel")}</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setWhen("tomorrow")}
                  aria-pressed={when === "tomorrow"}
                  className={chip(when === "tomorrow")}
                >
                  {t("scheduled.whenTomorrow")}
                </button>
                <button
                  type="button"
                  onClick={() => setWhen("3days")}
                  aria-pressed={when === "3days"}
                  className={chip(when === "3days")}
                >
                  {t("scheduled.when3days")}
                </button>
                <button
                  type="button"
                  onClick={() => setWhen("firstOfMonth")}
                  aria-pressed={when === "firstOfMonth"}
                  className={chip(when === "firstOfMonth")}
                >
                  {t("scheduled.whenFirstOfMonth")}
                </button>
                <button
                  type="button"
                  onClick={() => setWhen("custom")}
                  aria-pressed={when === "custom"}
                  className={chip(when === "custom")}
                >
                  {t("scheduled.whenCustom")}
                </button>
              </div>
              {when === "custom" && (
                <div className="mt-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                  <label className="text-xs font-bold mb-1.5 block">
                    {t("scheduled.customLabel")}
                  </label>
                  <Input
                    type="datetime-local"
                    dir="ltr"
                    value={customWhen}
                    onChange={(e) => setCustomWhen(e.target.value)}
                    className="num text-left h-11 rounded-xl"
                  />
                </div>
              )}
            </div>

            {/* frequency */}
            <div>
              <label className="text-xs font-bold mb-1.5 block">{t("scheduled.freqLabel")}</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setFrequency("once")}
                  aria-pressed={frequency === "once"}
                  className={chip(frequency === "once")}
                >
                  {t("scheduled.freqOnce")}
                </button>
                <button
                  type="button"
                  onClick={() => setFrequency("monthly")}
                  aria-pressed={frequency === "monthly"}
                  className={chip(frequency === "monthly")}
                >
                  {t("scheduled.freqMonthly")}
                </button>
              </div>
            </div>

            <Button
              disabled={!valid}
              onClick={() => setPinOpen(true)}
              className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
            >
              <CalendarPlus className="h-4 w-4" />
              {t("scheduled.newBtn")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title={t("scheduled.pinTitle")}
        description={t("scheduled.pinDesc")}
        amount={valid ? amountNum : undefined}
        confirmText={t("scheduled.pinConfirm")}
        onConfirm={confirmSchedule}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* EditScheduleDialog — change amount and/or run time of a pending     */
/* mandate (PIN-verified, same presets as creation).                   */
/* ------------------------------------------------------------------ */

type EditWhen = "keep" | "tomorrow" | "3days" | "firstOfMonth" | "custom";

function EditScheduleDialog({
  item,
  onClose,
  onEdited,
}: {
  item: ScheduledItem | null;
  onClose: () => void;
  onEdited: () => void;
}) {
  const { token } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [amount, setAmount] = useState("");
  const [when, setWhen] = useState<EditWhen>("keep");
  const [customWhen, setCustomWhen] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  /* render-time reset on item change (lint-safe, no effect) */
  const [wasItem, setWasItem] = useState(item);
  if (item !== wasItem) {
    setWasItem(item);
    if (item) {
      setAmount(String(item.amount));
      setWhen("keep");
      setCustomWhen("");
      setPinOpen(false);
    }
  }

  const open = item !== null;
  const amountNum = Number(amount);

  function computeExecuteAt(): Date | null {
    if (!item) return null;
    if (when === "keep") return new Date(item.next_run_at);
    const base = new Date();
    if (when === "tomorrow") {
      const d = new Date(base);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    if (when === "3days") return new Date(base.getTime() + 3 * 86_400_000);
    if (when === "firstOfMonth") {
      return new Date(base.getFullYear(), base.getMonth() + 1, 1, 9, 0, 0, 0);
    }
    if (!customWhen) return null;
    const d = new Date(customWhen);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const executeAt = computeExecuteAt();
  const amountChanged = !!item && amountNum !== item.amount;
  const whenChanged = !!item && when !== "keep";
  const valid =
    !!item &&
    executeAt !== null &&
    amountNum >= 1000 &&
    amountNum <= 5_000_000 &&
    (amountChanged || whenChanged);

  async function confirmEdit(pin: string): Promise<string | null> {
    if (!token || !item || !executeAt || !valid) return t("common.unexpectedError");
    try {
      const res = await urpay.scheduledEdit(token, item.id, {
        ...(amountChanged ? { amount: amountNum } : {}),
        ...(whenChanged ? { execute_at: executeAt.toISOString() } : {}),
        pin,
      });
      toast({
        title: t("scheduled.editToastTitle"),
        description: `${res.scheduled.label} · ${fmtDateTime(res.scheduled.next_run_at, lang)}`,
      });
      setPinOpen(false);
      onClose();
      onEdited();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : t("common.opFailed");
    }
  }

  return (
    <>
      <Dialog open={open && !pinOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-sm rounded-3xl max-h-[85vh] overflow-y-auto scrollbar-slim">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="h-[18px] w-[18px]" />
              </span>
              {t("scheduled.editDialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("scheduled.editDialogDesc")}</DialogDescription>
          </DialogHeader>

          {item && (
            <div className="space-y-4">
              {/* current mandate summary */}
              <div className="rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3">
                <p className="font-bold text-sm">{item.label}</p>
                <p className="text-[0.7rem] text-muted-foreground mt-0.5 num">
                  {fmtIQD(item.amount, true, lang)} · {fmtDateTime(item.next_run_at, lang)}
                </p>
              </div>

              {/* new amount */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("scheduled.editAmountLabel")}
                </p>
                <div className="relative">
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    className="num text-left text-lg font-bold pe-12"
                  />
                  <span className="absolute inset-y-0 end-4 flex items-center text-xs font-semibold text-muted-foreground">
                    {t("common.iqd")}
                  </span>
                </div>
              </div>

              {/* new when */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("scheduled.editWhenLabel")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWhen("keep")}
                    aria-pressed={when === "keep"}
                    className={`flex items-center justify-center gap-1.5 ${chip(when === "keep")}`}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    {t("scheduled.editKeepWhen")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhen("tomorrow")}
                    aria-pressed={when === "tomorrow"}
                    className={chip(when === "tomorrow")}
                  >
                    {t("scheduled.whenTomorrow")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhen("3days")}
                    aria-pressed={when === "3days"}
                    className={chip(when === "3days")}
                  >
                    {t("scheduled.when3days")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhen("firstOfMonth")}
                    aria-pressed={when === "firstOfMonth"}
                    className={chip(when === "firstOfMonth")}
                  >
                    {t("scheduled.whenFirstOfMonth")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhen("custom")}
                    aria-pressed={when === "custom"}
                    className={`col-span-2 ${chip(when === "custom")}`}
                  >
                    {t("scheduled.whenCustom")}
                  </button>
                </div>
                {when === "custom" && (
                  <Input
                    type="datetime-local"
                    dir="ltr"
                    value={customWhen}
                    onChange={(e) => setCustomWhen(e.target.value)}
                    className="num text-xs"
                  />
                )}
              </div>

              <Button
                type="button"
                disabled={!valid}
                onClick={() => setPinOpen(true)}
                className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
              >
                <Pencil className="h-4 w-4" />
                {t("scheduled.editPinConfirm")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        title={t("scheduled.editPinTitle")}
        description={t("scheduled.editPinDesc")}
        amount={amountChanged ? amountNum : undefined}
        confirmText={t("scheduled.editPinConfirm")}
        onConfirm={confirmEdit}
      />
    </>
  );
}
