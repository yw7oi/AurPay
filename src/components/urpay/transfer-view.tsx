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
import { EmptyState, PinDialog, ReceiptCard, UserAvatar } from "./parts";

/* ------------------------------------------------------------------ */
/* Pending transfer requests — sender confirms/cancels, receiver      */
/* declines. 24h TTL auto-expiry runs server-side on every list call.  */
/* ------------------------------------------------------------------ */

function ttlLeft(createdAtIso: string): { hours: number; label: string; danger: boolean } {
  const created = new Date(createdAtIso).getTime();
  const expires = created + 24 * 3600_000;
  const ms = expires - Date.now();
  if (ms <= 0) return { hours: 0, label: "على وشك الانتهاء", danger: true };
  const hours = Math.floor(ms / 3600_000);
  const mins = Math.floor((ms % 3600_000) / 60_000);
  const label = hours >= 1 ? `${hours} سا و${mins} د` : `${mins} دقيقة`;
  return { hours, label: `تنتهي بعد ${label}`, danger: hours < 2 };
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
      toast({ title: "تم الإلغاء", description: res.message });
      await load();
    } catch (err) {
      toast({
        title: "تعذر الإلغاء",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
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
      toast({ title: "تم الرفض", description: res.message });
      await load();
    } catch (err) {
      toast({
        title: "تعذر الرفض",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirmReq(pin: string): Promise<string | null> {
    if (!token || !confirming) return "خطأ غير متوقع";
    try {
      const res = await urpay.transferConfirm(token, confirming.id, pin);
      onReceipt(res.receipt);
      const me = await urpay.me(token);
      setUser(me);
      toast({ title: "وصلت الحوالة ✅", description: res.message });
      await load();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "فشل التحويل";
    }
  }

  if (reqs === null || reqs.length === 0) return null;

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg flex items-center gap-2">
          <Clock3 className="h-4.5 w-4.5 h-[18px] w-[18px] text-primary" />
          طلبات معلّقة
          <Badge className="rounded-full bg-gold/15 text-gold-deep hover:bg-gold/15 num px-2">
            {reqs.length}
          </Badge>
        </h2>
        <p className="text-[0.68rem] text-muted-foreground">
          تنتهي تلقائيًا بعد 24 ساعة من إنشائها
        </p>
      </div>

      <div className="space-y-2.5">
        {reqs.map((r) => {
          const ttl = ttlLeft(r.created_at);
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
                      {isSender ? "صادرة — بانتظار تأكيدك" : "واردة — بانتظار المرسل"}
                    </Badge>
                  </div>
                  <p className="text-[0.7rem] text-muted-foreground mt-0.5 num" dir="rtl">
                    {r.counterparty_card} ·{" "}
                    <span className={`font-semibold ${ttl.danger ? "text-destructive" : ""}`}>
                      {ttl.label}
                    </span>
                    {ttl.danger && (
                      <TimerOff className="inline h-3 w-3 ms-1 -mt-0.5 text-destructive" />
                    )}
                  </p>
                </div>
                <p className="num font-bold text-base shrink-0" dir="rtl">
                  {fmtIQD(r.amount, false)}
                  <span className="text-[0.6rem] font-medium text-muted-foreground block text-center mt-0.5">
                    د.ع
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
                      أكّد بالـ PIN
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
                      إلغاء
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
                    ارفض الحوالة
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
        title="تأكيد الحوالة المعلّقة"
        description={
          confirming
            ? `إلى ${confirming.counterparty} — لا تنعكس العملية بعد التنفيذ`
            : "أدخل رمزك السري"
        }
        amount={confirming?.amount}
        confirmText="نفّذ الحوالة"
        onConfirm={confirmReq}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function TransferView() {
  const { user, token, setUser } = useSession();
  const { toast } = useToast();
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
    if (!token || !targetCard || !pendingReq) return "خطأ غير متوقع";
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
      toast({ title: "وصلت الحوالة ✅", description: res.message });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "فشل التحويل";
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
        title: "تعذر إنشاء التحويل",
        description: err instanceof Error ? err.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-5 max-w-2xl" dir="rtl">
      <div>
        <h1 className="font-display text-2xl">حوّل لأي مستخدم</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          دوّر على المستلم بالاسم أو رقم بطاقته — التحويل يتطلب تأكيد الـ PIN.
        </p>
      </div>

      {receipt ? (
        <div className="space-y-4">
          <ReceiptCard receipt={receipt} />
          <Button variant="outline" onClick={() => setReceipt(null)} className="rounded-xl font-bold">
            حوّل مرة ثانية
          </Button>
        </div>
      ) : (
        <form onSubmit={startTransfer} className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6 space-y-5">
          {/* search */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              ابحث بالاسم
            </Label>
            <Input
              placeholder="مثال: أحمد علي — أو زينب…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> جاري البحث…
              </p>
            )}
            {results && !searching && (
              <div className="rounded-2xl border border-border/60 divide-y divide-border/50 max-h-64 overflow-y-auto scrollbar-slim bg-background">
                {results.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    ما لقينا أحد بهذا الاسم — جرب الاسم الثلاثي أو رقم البطاقة.
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
            <Label className="text-xs font-semibold text-muted-foreground">المستلم</Label>
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
                  تغيير
                </Button>
              </div>
            ) : (
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder="أو أدخل رقم البطاقة — 4539 .... .... ...."
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
            <Label className="text-xs font-semibold text-muted-foreground">المبلغ</Label>
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
                د.ع
              </span>
            </div>
            <div className="flex gap-1.5">
              {[25000, 50000, 100000, 250000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="rounded-full border border-border/70 bg-secondary px-3 py-1 text-[0.68rem] font-bold text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors num"
                  dir="rtl"
                >
                  {v.toLocaleString("en-US")}
                </button>
              ))}
            </div>
            {amountNum > 0 && user && amountNum > user.balance && (
              <p className="text-xs font-semibold text-destructive">
                المبلغ أكبر من رصيدك ({fmtIQD(user.balance)})
              </p>
            )}
          </div>

          <Button type="submit" disabled={!valid} className="w-full h-12 rounded-2xl font-bold text-base shadow-lift">
            <Send className="h-4 w-4" />
            متابعة التحويل
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
          شلون تشتغلة التحويلات؟
        </p>
        <ol className="mt-2.5 text-xs text-muted-foreground leading-relaxed space-y-1 list-decimal list-inside">
          <li>تدور على المستلم (من 100 مستخدم مسجل بالمنصة) أو تكتب بطاقته مباشرة.</li>
          <li>تنشئ طلب تحويل مؤكد — ما ينفذ إلا بعد رمز الـ PIN.</li>
          <li>تستلم إيصالًا برقم مرجعي، ويوصل المبلغ فوري للطرف الثاني.</li>
          <li>إذا ما أكّدت الطلب خلال 24 ساعة — ينتهي تلقائيًا ويرجع رصيدك محفوظ.</li>
        </ol>
      </div>

      <PinDialog
        open={pinOpen}
        onOpenChange={(v) => {
          setPinOpen(v);
          if (!v) setPendingReq(null);
        }}
        title="تأكيد الحوالة"
        description={
          pendingReq
            ? `إلى ${pendingReq.receiver} — لا تنعكس العملية بعد التنفيذ`
            : "أدخل رمزك السري"
        }
        amount={pendingReq?.amount}
        confirmText="نفّذ الحوالة"
        onConfirm={confirmTransfer}
      />
    </div>
  );
}
