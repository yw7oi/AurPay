"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, CheckCheck, Clock3, Loader2,
  Search, Send, TimerOff, Users, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/store";
import { fmtIQD, urpay, type Receipt, type TransferReq, type UserSummary } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { tr, useT, type Lang } from "@/lib/i18n";
import { EmptyState, PinDialog, ReceiptCard, UserAvatar } from "./parts";

/* ------------------------------------------------------------------ */
/* Pending transfer requests — sender confirms/cancels, receiver      */
/* declines. 24h TTL auto-expiry runs server-side on every list call.  */
/* ------------------------------------------------------------------ */

function ttlLeft(createdAtIso: string, lang: Lang): { hours: number; label: string; danger: boolean } {
  const created = new Date(createdAtIso).getTime();
  const expires = created + 24 * 3600_000;
  const ms = expires - Date.now();
  if (ms <= 0) return { hours: 0, label: tr(lang, "transfer.ttlExpiring"), danger: true };
  const hours = Math.floor(ms / 3600_000);
  const mins = Math.floor((ms % 3600_000) / 60_000);
  const label = hours >= 1
    ? tr(lang, "transfer.ttlHm", { h: hours, m: mins })
    : tr(lang, "transfer.ttlMins", { m: mins });
  return { hours, label: tr(lang, "transfer.ttlExpiresIn", { label }), danger: hours < 2 };
}

function PendingRequests({
  refreshSignal,
  onReceipt,
}: {
  refreshSignal: number;
  onReceipt: (r: Receipt) => void;
}) {
  const { token, setUser } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [reqs, setReqs] = useState<TransferReq[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<TransferReq | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setReqs(await urpay.transferRequests(token));
    } catch {
      /* silent — keeps last known list */
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  async function cancelReq(id: number) {
    if (!token) return;
    setBusy(id);
    try {
      const res = await urpay.transferCancel(token, id);
      toast({ title: t("transfer.cancelToastTitle"), description: res.message });
      await load();
    } catch (err) {
      toast({
        title: t("transfer.cancelFailTitle"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function declineReq(id: number) {
    if (!token) return;
    setBusy(id);
    try {
      const res = await urpay.transferDecline(token, id);
      toast({ title: t("transfer.declineToastTitle"), description: res.message });
      await load();
    } catch (err) {
      toast({
        title: t("transfer.declineFailTitle"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirmReq(pin: string): Promise<string | null> {
    if (!token || !confirming) return t("common.unexpectedError");
    try {
      const res = await urpay.transferConfirm(token, confirming.id, pin);
      onReceipt(res.receipt);
      const me = await urpay.me(token);
      setUser(me);
      toast({ title: t("transfer.sentToastTitle"), description: res.message });
      await load();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : t("transfer.failed");
    }
  }

  if (reqs === null || reqs.length === 0) return null;

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg flex items-center gap-2">
          <Clock3 className="h-4.5 w-4.5 h-[18px] w-[18px] text-primary" />
          {t("transfer.pendingTitle")}
          <Badge className="rounded-full bg-gold/15 text-gold-deep hover:bg-gold/15 num px-2">
            {reqs.length}
          </Badge>
        </h2>
        <p className="text-[0.68rem] text-muted-foreground">
          {t("transfer.pendingHint")}
        </p>
      </div>

      <div className="space-y-2.5">
        {reqs.map((r) => {
          const ttl = ttlLeft(r.created_at, lang);
          const isSender = r.role === "sender";
          return (
            <div
              key={r.id}
              className="rounded-2xl border border-border/60 bg-background p-3.5 sm:p-4 transition-all hover:border-primary/35"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${
                    isSender
                      ? "bg-primary/10 text-primary ring-primary/20"
                      : "bg-gold/15 text-gold-deep ring-gold/30"
                  }`}
                >
                  {isSender ? (
                    <ArrowUpRight className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                  ) : (
                    <ArrowDownLeft className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm truncate">
                      {r.counterparty}
                    </p>
                    <Badge
                      variant="outline"
                      className={`rounded-md text-[0.6rem] px-1.5 h-5 ${
                        isSender
                          ? "border-primary/30 text-primary"
                          : "border-gold/40 text-gold-deep"
                      }`}
                    >
                      {isSender ? t("transfer.badgeOutgoing") : t("transfer.badgeIncoming")}
                    </Badge>
                  </div>
                  <p className="text-[0.7rem] text-muted-foreground mt-0.5 num">
                    {r.counterparty_card} ·{" "}
                    <span className={`font-semibold ${ttl.danger ? "text-destructive" : ""}`}>
                      {ttl.label}
                    </span>
                    {ttl.danger && (
                      <TimerOff className="inline h-3 w-3 ms-1 -mt-0.5 text-destructive" />
                    )}
                  </p>
                </div>
                <p className="num font-bold text-base shrink-0">
                  {fmtIQD(r.amount, false, lang)}
                  <span className="text-[0.6rem] font-medium text-muted-foreground block text-center mt-0.5">
                    {t("common.iqd")}
                  </span>
                </p>
              </div>

              <div className="flex gap-2 mt-3">
                {isSender ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setConfirming(r);
                        setPinOpen(true);
                      }}
                      className="rounded-xl h-9 px-4 text-xs font-bold flex-1 sm:flex-none"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      {t("transfer.confirmPinBtn")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => cancelReq(r.id)}
                      className="rounded-xl h-9 px-4 text-xs font-bold text-muted-foreground hover:text-destructive hover:border-destructive/40"
                    >
                      {busy === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => declineReq(r.id)}
                    className="rounded-xl h-9 px-4 text-xs font-bold text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  >
                    {busy === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                    {t("transfer.declineBtn")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <PinDialog
        open={pinOpen}
        onOpenChange={(v) => {
          setPinOpen(v);
          if (!v) setConfirming(null);
        }}
        title={t("transfer.pendingPinTitle")}
        description={
          confirming
            ? t("transfer.toReceiverDesc", { name: confirming.counterparty })
            : t("transfer.enterPinDesc")
        }
        amount={confirming?.amount}
        confirmText={t("transfer.executeBtn")}
        onConfirm={confirmReq}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function TransferView() {
  const { user, token, setUser } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [receiver, setReceiver] = useState<UserSummary | null>(null);
  const [cardInput, setCardInput] = useState("");
  const [amount, setAmount] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pendingReq, setPendingReq] = useState<{ id: number; receiver: string; amount: number } | null>(null);
  const [reqSignal, setReqSignal] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* live user search */
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      if (!token) return;
      try {
        const r = await urpay.searchUsers(token, query.trim());
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, token]);

  const amountNum = Number(amount);
  const cardClean = cardInput.replace(/\D/g, "");
  const targetCard = receiver?.card_number ?? (cardClean.length === 16 ? cardClean : null);
  const valid =
    !!targetCard && amountNum > 0 && amountNum <= (user?.balance ?? 0);

  async function confirmTransfer(pin: string): Promise<string | null> {
    if (!token || !targetCard || !pendingReq) return t("common.unexpectedError");
    try {
      const res = await urpay.transferConfirm(token, pendingReq.id, pin);
      setReceipt(res.receipt);
      const me = await urpay.me(token);
      setUser(me);
      setPendingReq(null);
      setReceiver(null);
      setCardInput("");
      setAmount("");
      setReqSignal((s) => s + 1);
      toast({ title: t("transfer.sentToastTitle"), description: res.message });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : t("transfer.failed");
    }
  }

  async function startTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !token) return;
    try {
      const res = await urpay.transferRequest(token, {
        receiver_card: targetCard!,
        amount: amountNum,
      });
      setPendingReq(res.request);
      setPinOpen(true);
    } catch (err) {
      toast({
        title: t("transfer.createFailTitle"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl">{t("transfer.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("transfer.subtitle")}
        </p>
      </div>

      {receipt ? (
        <div className="space-y-4">
          <ReceiptCard receipt={receipt} />
          <Button variant="outline" onClick={() => setReceipt(null)} className="rounded-xl font-bold">
            {t("transfer.againBtn")}
          </Button>
        </div>
      ) : (
        <form onSubmit={startTransfer} className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6 space-y-5">
          {/* search */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              {t("transfer.searchLabel")}
            </Label>
            <Input
              placeholder={t("transfer.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("transfer.searching")}
              </p>
            )}
            {results && !searching && (
              <div className="rounded-2xl border border-border/60 divide-y divide-border/50 max-h-64 overflow-y-auto scrollbar-slim bg-background">
                {results.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    {t("transfer.noResults")}
                  </p>
                ) : (
                  results.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setReceiver(u);
                        setQuery("");
                        setResults(null);
                        setCardInput("");
                      }}
                      className="w-full flex items-center gap-3 p-3 hover:bg-secondary/60 transition-colors text-start"
                    >
                      <UserAvatar name={u.full_name} hue={u.avatar_hue} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{u.full_name}</p>
                        <p className="text-xs text-muted-foreground">{u.city}</p>
                      </div>
                      <Badge variant="outline" className="rounded-lg num" dir="ltr">
                        •••• {u.card_number.slice(-4)}
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* receiver */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">{t("transfer.recipientLabel")}</Label>
            {receiver ? (
              <div className="flex items-center gap-3 rounded-2xl border border-primary/35 bg-primary/[.05] p-3.5">
                <UserAvatar name={receiver.full_name} hue={receiver.avatar_hue} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold">{receiver.full_name}</p>
                  <p className="text-xs text-muted-foreground num" dir="ltr">
                    {receiver.card_number.replace(/(\d{4})(?=\d)/g, "$1 ")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setReceiver(null)}
                  className="rounded-xl text-muted-foreground"
                >
                  {t("transfer.changeBtn")}
                </Button>
              </div>
            ) : (
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder={t("transfer.cardPlaceholder")}
                value={cardInput}
                onChange={(e) =>
                  setCardInput(
                    e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 16)
                      .replace(/(\d{4})(?=\d)/g, "$1 "),
                  )
                }
                className="num text-left tracking-[0.08em]"
              />
            )}
          </div>

          {/* amount */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">{t("transfer.amountLabel")}</Label>
            <div className="relative">
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder="25000"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
                className="num text-left text-lg font-bold pe-12"
              />
              <span className="absolute inset-y-0 end-4 flex items-center text-xs font-semibold text-muted-foreground">
                {t("common.iqd")}
              </span>
            </div>
            <div className="flex gap-1.5">
              {[25000, 50000, 100000, 250000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="rounded-full border border-border/70 bg-secondary px-3 py-1 text-[0.68rem] font-bold text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors num"
                >
                  {v.toLocaleString("en-US")}
                </button>
              ))}
            </div>
            {amountNum > 0 && user && amountNum > user.balance && (
              <p className="text-xs font-semibold text-destructive">
                {t("transfer.exceedsBalance", { balance: fmtIQD(user.balance, true, lang) })}
              </p>
            )}
          </div>

          <Button type="submit" disabled={!valid} className="w-full h-12 rounded-2xl font-bold text-base shadow-lift">
            <Send className="h-4 w-4" />
            {t("transfer.continueBtn")}
          </Button>
        </form>
      )}

      {/* pending requests */}
      <PendingRequests
        refreshSignal={reqSignal}
        onReceipt={(r) => setReceipt(r)}
      />

      {/* how it works */}
      <div className="rounded-3xl border border-dashed border-border bg-secondary/30 p-5">
        <p className="font-bold text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          {t("transfer.howTitle")}
        </p>
        <ol className="mt-2.5 text-xs text-muted-foreground leading-relaxed space-y-1 list-decimal list-inside">
          <li>{t("transfer.how1")}</li>
          <li>{t("transfer.how2")}</li>
          <li>{t("transfer.how3")}</li>
          <li>{t("transfer.how4")}</li>
        </ol>
      </div>

      <PinDialog
        open={pinOpen}
        onOpenChange={(v) => {
          setPinOpen(v);
          if (!v) setPendingReq(null);
        }}
        title={t("transfer.pinTitle")}
        description={
          pendingReq
            ? t("transfer.toReceiverDesc", { name: pendingReq.receiver })
            : t("transfer.enterPinDesc")
        }
        amount={pendingReq?.amount}
        confirmText={t("transfer.executeBtn")}
        onConfirm={confirmTransfer}
      />
    </div>
  );
}
