"use client";

/* GoalsCard — أهداف التوفير (savings goals): earmarked money moved out of
   the spendable balance. Deposits/withdrawals are PIN-verified; a goal
   auto-completes when its target is reached (backend notifies 🎉). */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine, Loader2, PiggyBank, Plus, Sparkles, Target, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/store";
import { fmtIQD, urpay, type GoalItem, type GoalsFeed } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { EmptyState, PinDialog } from "./parts";

const EMOJI_CHOICES = ["🎯", "🕌", "✈️", "🎓", "🚗", "🏠", "💍", "📱", "💻", "👶", "🏝️", "🎁"];
const TARGET_CHIPS = [500_000, 1_000_000, 3_000_000, 5_000_000];
const DEPOSIT_CHIPS = [10_000, 25_000, 50_000, 100_000];

/* ------------------------------------------------------------------ */

function goalSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 rounded-2xl border border-border/50 bg-secondary/40 p-4 animate-pulse"
        >
          <div className="h-10 w-10 rounded-xl bg-border/60" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-1/2 rounded bg-border/60" />
            <div className="h-2.5 w-1/3 rounded bg-border/40" />
          </div>
          <div className="h-4 w-16 rounded bg-border/60" />
        </div>
      ))}
    </div>
  );
}

/* rounded progress bar with a shimmering fill for completed goals */
function GoalBar({ pct, done }: { pct: number; done: boolean }) {
  const w = Math.min(100, Math.max(2, pct));
  return (
    <div className="h-2.5 rounded-full bg-primary/12 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${w}%` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className={`h-full rounded-full ${
          done
            ? "bg-gradient-to-l from-gold via-[#E8C867] to-gold-deep"
            : "bg-gradient-to-l from-primary to-[#3E8E7E]"
        }`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function GoalsCard({ refreshKey }: { refreshKey: number }) {
  const { token, setUser } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [feed, setFeed] = useState<GoalsFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [depositing, setDepositing] = useState<GoalItem | null>(null);
  const [withdrawing, setWithdrawing] = useState<GoalItem | null>(null);
  const [deleting, setDeleting] = useState<GoalItem | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [signal, setSignal] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setFeed(await urpay.goals(token));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey, signal]);

  if (!token || (failed && feed === null)) return null;

  const goals = feed?.items ?? [];
  const totals = feed?.totals;

  async function refreshBalance() {
    if (!token) return;
    try {
      setUser(await urpay.me(token));
    } catch { /* silent */ }
  }

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <PiggyBank className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg leading-tight">{t("goals.title")}</h2>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {t("goals.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(totals?.saved ?? 0) > 0 && (
            <Badge className="rounded-full bg-primary/10 text-primary hover:bg-primary/10 gap-1.5 text-[0.68rem] whitespace-nowrap">
              {t("goals.savedBadge")}
              <span className="num font-bold">{fmtIQD(totals!.saved, false, lang)}</span>
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="rounded-xl font-bold"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("goals.newBtn")}
          </Button>
        </div>
      </div>

      {/* body */}
      {feed === null ? (
        goalSkeleton()
      ) : goals.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <EmptyState
            icon={Target}
            title={t("goals.emptyTitle")}
            desc={t("goals.emptyDesc")}
            action={
              <Button size="sm" onClick={() => setAddOpen(true)} className="rounded-xl font-bold">
                <Target className="h-4 w-4" />
                {t("goals.newBtn")}
              </Button>
            }
          />
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="grid gap-3 sm:grid-cols-2 max-h-[26rem] overflow-y-auto scrollbar-slim pe-1"
        >
          {goals.map((g) => {
            const done = g.status === "completed";
            return (
              <div
                key={g.id}
                className={`group relative rounded-2xl border p-4 transition-colors ${
                  done
                    ? "border-gold/40 bg-gold/[.05]"
                    : "border-border/60 bg-background/60 hover:border-primary/30"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* emoji medallion */}
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ring-1 ${
                      done
                        ? "bg-gold/15 ring-gold/30"
                        : "bg-primary/10 ring-primary/15"
                    }`}
                    aria-hidden="true"
                  >
                    {g.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm truncate">{g.name}</p>
                      {done && (
                        <Badge className="rounded-full bg-gold/15 text-gold-deep border border-gold/30 hover:bg-gold/15 text-[0.6rem] px-2 h-5 gap-1">
                          <Sparkles className="h-3 w-3" />
                          {t("goals.doneBadge")}
                        </Badge>
                      )}
                    </div>
                    <p className="num text-[0.7rem] text-muted-foreground mt-0.5">
                      <b className="text-foreground">{fmtIQD(g.saved_amount, false, lang)}</b>
                      {" "}{t("goals.ofWord")}{" "}
                      {fmtIQD(g.target_amount, false, lang)}
                      {" · "}
                      <b className={done ? "text-gold-deep" : "text-primary"}>
                        {Math.round(g.pct)}%
                      </b>
                      {!done && g.remaining > 0 && (
                        <>{" · "}{t("goals.remaining")}{": "}<b className="text-foreground">{fmtIQD(g.remaining, false, lang)}</b></>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <GoalBar pct={g.pct} done={done} />
                </div>

                {/* actions */}
                <div className="mt-3 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => setDepositing(g)}
                    disabled={busyId === g.id}
                    className="rounded-xl h-8 px-3 text-[0.7rem] font-bold"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("goals.depositBtn")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setWithdrawing(g)}
                    disabled={busyId === g.id || g.saved_amount === 0}
                    className="rounded-xl h-8 px-3 text-[0.7rem] font-bold"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    {t("goals.withdrawBtn")}
                  </Button>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(g)}
                    disabled={busyId === g.id}
                    aria-label={t("goals.deleteBtn")}
                    title={t("goals.deleteBtn")}
                    className="rounded-xl h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    {busyId === g.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* create dialog */}
      <CreateGoalDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={() => {
          setSignal((s) => s + 1);
          toast({ title: t("goals.createdToastTitle") });
        }}
      />

      {/* deposit dialog */}
      <MoneyGoalDialog
        mode="deposit"
        goal={depositing}
        max={depositing ? 5_000_000 : 0}
        presetTotal={depositing?.saved_amount ?? 0}
        onOpenChange={(v) => !v && setDepositing(null)}
        onDone={(msg) => {
          setDepositing(null);
          setSignal((s) => s + 1);
          refreshBalance();
          toast({ title: t("goals.depositToastTitle"), description: msg });
        }}
      />

      {/* withdraw dialog */}
      <MoneyGoalDialog
        mode="withdraw"
        goal={withdrawing}
        max={withdrawing?.saved_amount ?? 0}
        presetTotal={withdrawing?.saved_amount ?? 0}
        onOpenChange={(v) => !v && setWithdrawing(null)}
        onDone={(msg) => {
          setWithdrawing(null);
          setSignal((s) => s + 1);
          refreshBalance();
          toast({ title: t("goals.withdrawToastTitle"), description: msg });
        }}
      />

      {/* delete confirm (PIN) */}
      <PinDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={t("goals.deleteTitle")}
        description={deleting
          ? t("goals.deleteDesc", {
              name: deleting.name,
              saved: fmtIQD(deleting.saved_amount, true, lang),
            })
          : ""}
        confirmText={t("goals.deleteConfirm")}
        onConfirm={async (pin) => {
          if (!token || !deleting) return t("common.unexpectedError");
          setBusyId(deleting.id);
          try {
            const r = await urpay.goalDelete(token, deleting.id, pin);
            setDeleting(null);
            setSignal((s) => s + 1);
            refreshBalance();
            toast({ title: t("goals.deletedToastTitle"), description: r.message });
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : t("common.opFailed");
          } finally {
            setBusyId(null);
          }
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* create goal — no PIN (no money moves)                                */

function CreateGoalDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { token } = useSession();
  const { t } = useT();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = Number(target);
  const valid = name.trim().length >= 2 && amount >= 10_000 && amount <= 100_000_000;

  async function submit() {
    if (!token || !valid) return;
    setBusy(true);
    setErr(null);
    try {
      await urpay.goalCreate(token, {
        name: name.trim(), target_amount: amount, emoji,
      });
      onDone();
      onOpenChange(false);
      setName("");
      setTarget("");
      setEmoji("🎯");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common.opFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Target className="h-[18px] w-[18px]" />
            </span>
            {t("goals.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("goals.createDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {/* emoji picker */}
          <div>
            <p className="text-xs font-bold text-muted-foreground mb-1.5">{t("goals.emojiLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-pressed={emoji === e}
                  className={`h-9 w-9 rounded-xl text-lg leading-none transition-all active:scale-95 ${
                    emoji === e
                      ? "bg-primary/15 ring-2 ring-primary/45 scale-105"
                      : "bg-secondary hover:bg-primary/10 ring-1 ring-border/60"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* name */}
          <div>
            <p className="text-xs font-bold text-muted-foreground mb-1.5">{t("goals.nameLabel")}</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 48))}
              placeholder={t("goals.namePlaceholder")}
              className="h-11"
            />
          </div>

          {/* target */}
          <div>
            <p className="text-xs font-bold text-muted-foreground mb-1.5">{t("goals.targetLabel")}</p>
            <div className="relative">
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder="1000000"
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/\D/g, "").slice(0, 9))}
                className="num text-left text-lg font-bold pe-12 h-12"
              />
              <span className="absolute inset-y-0 end-4 flex items-center text-xs font-semibold text-muted-foreground">
                {t("common.iqd")}
              </span>
            </div>
            <div className="mt-2 flex gap-1.5">
              {TARGET_CHIPS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTarget(String(v))}
                  className={`flex-1 rounded-xl border px-2 py-2 text-[0.68rem] font-bold num transition-colors ${
                    amount === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 bg-secondary text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {v === 1_000_000 ? "1M" : `${v / 1000}k`}
                </button>
              ))}
            </div>
          </div>

          {err && <p className="text-xs text-destructive font-semibold">{err}</p>}

          <Button
            disabled={!valid || busy}
            onClick={submit}
            className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
            {t("goals.createBtn")}
          </Button>
        </div>
        <DialogFooter className="sr-only">
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* deposit / withdraw — amount + PIN                                    */

function MoneyGoalDialog({
  mode,
  goal,
  max,
  presetTotal,
  onOpenChange,
  onDone,
}: {
  mode: "deposit" | "withdraw";
  goal: GoalItem | null;
  max: number;
  presetTotal: number;
  onOpenChange: (v: boolean) => void;
  onDone: (msg: string) => void;
}) {
  const { token } = useSession();
  const { t, lang } = useT();
  const [amountStr, setAmountStr] = useState("");
  const [pinOpen, setPinOpen] = useState(false);

  /* reset + prefill when a NEW goal opens — React's adjust-state-on-prop-
     change pattern (reset during render, no effect) */
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const goalKey = goal ? `${mode}-${goal.id}` : null;
  if (goalKey && goalKey !== prevKey) {
    setPrevKey(goalKey);
    setAmountStr(mode === "withdraw" ? String(goal!.saved_amount) : "");
    setPinOpen(false);
  }

  const amount = Number(amountStr);
  const valid = amount >= 1_000 && amount <= (mode === "withdraw" ? max : 5_000_000);
  const chips = mode === "deposit" ? DEPOSIT_CHIPS : [presetTotal, Math.floor(presetTotal / 2)];

  return (
    <>
      <Dialog open={!!goal && !pinOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">{goal?.emoji}</span>
              {mode === "deposit" ? t("goals.depositTitle") : t("goals.withdrawTitle")}
              <span className="text-muted-foreground font-medium text-sm truncate">
                {goal?.name}
              </span>
            </DialogTitle>
            <DialogDescription>
              {mode === "deposit"
                ? t("goals.depositDesc", { target: fmtIQD(goal?.target_amount ?? 0, true, lang) })
                : t("goals.withdrawDesc", { saved: fmtIQD(presetTotal, true, lang) })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder="50000"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, "").slice(0, 7))}
                className="num text-left text-lg font-bold pe-12 h-12"
              />
              <span className="absolute inset-y-0 end-4 flex items-center text-xs font-semibold text-muted-foreground">
                {t("common.iqd")}
              </span>
            </div>
            <div className="flex gap-1.5">
              {chips.map((v, i) => (
                v > 0 && (
                  <button
                    key={`${mode}-${i}-${v}`}
                    type="button"
                    onClick={() => setAmountStr(String(v))}
                    className={`flex-1 rounded-xl border px-2 py-2 text-[0.68rem] font-bold num transition-colors ${
                      amount === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/70 bg-secondary text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {mode === "withdraw" && i === 0 ? t("goals.allSaved") : v.toLocaleString("en-US")}
                  </button>
                )
              ))}
            </div>
            <Button
              disabled={!valid}
              onClick={() => setPinOpen(true)}
              className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
            >
              {mode === "deposit" ? <Plus className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
              {mode === "deposit" ? t("goals.depositBtn") : t("goals.withdrawBtn")}
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
        title={mode === "deposit" ? t("goals.depositPinTitle") : t("goals.withdrawPinTitle")}
        description={goal ? `${goal.emoji} ${goal.name}` : ""}
        amount={valid ? amount : undefined}
        confirmText={mode === "deposit" ? t("goals.depositBtn") : t("goals.withdrawBtn")}
        onConfirm={async (pin) => {
          if (!token || !goal || !valid) return t("common.unexpectedError");
          try {
            const r = mode === "deposit"
              ? await urpay.goalDeposit(token, goal.id, amount, pin)
              : await urpay.goalWithdraw(token, goal.id, mode === "withdraw" ? amount : null, pin);
            onDone(r.message);
            setPinOpen(false);
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : t("common.opFailed");
          }
        }}
      />
    </>
  );
}
