"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, ReceiptText, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { fmtIQD, categoryName, urpay, type Bill, type Receipt } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { BillRow, EmptyState, PinDialog, ReceiptCard } from "./parts";
import { CategoryIcon } from "./icons";

type BillerOption = { category: string; code: string; name: string; ar: string };

export function BillsView({ refreshKey }: { refreshKey: number }) {
  const { token, setUser } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [tab, setTab] = useState<"unpaid" | "paid" | "all">("unpaid");
  const [paying, setPaying] = useState<Bill | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    urpay.bills(token, "all").then(setBills).catch(() => setBills([]));
  }, [token, refreshKey]);

  const filtered = useMemo(() => {
    if (!bills) return null;
    const list = tab === "all" ? bills : bills.filter((b) => b.status === tab);
    return list.sort((a, b) => {
      if (a.status !== b.status) return a.status === "unpaid" ? -1 : 1;
      return +new Date(a.due_date) - +new Date(b.due_date);
    });
  }, [bills, tab]);

  const unpaidTotal = bills?.filter((b) => b.status === "unpaid").reduce((s, b) => s + b.amount, 0) ?? 0;

  async function confirmPay(pin: string): Promise<string | null> {
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
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{t("bills.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {bills === null
              ? t("common.loading")
              : tab === "unpaid"
                ? unpaidTotal > 0
                  ? t("bills.unpaidTotal", { total: fmtIQD(unpaidTotal, true, lang) })
                  : t("bills.allPaid")
                : t("bills.count", { n: filtered?.length ?? 0 })}
          </p>
        </div>
        <Button onClick={() => setSimOpen(true)} variant="outline" className="rounded-xl font-bold">
          <Plus className="h-4 w-4" />
          {t("bills.simulateBtn")}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="rounded-2xl bg-secondary p-1 h-auto">
          <TabsTrigger value="unpaid" className="rounded-xl px-4 py-2 font-bold data-[state=active]:bg-card">
            {t("bills.tabUnpaid")}
            {bills && (
              <Badge className="ms-1.5 rounded-md h-5 px-1.5 text-[0.6rem] bg-primary text-primary-foreground hover:bg-primary">
                {bills.filter((b) => b.status === "unpaid").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="paid" className="rounded-xl px-4 py-2 font-bold data-[state=active]:bg-card">
            {t("bills.tabPaid")}
          </TabsTrigger>
          <TabsTrigger value="all" className="rounded-xl px-4 py-2 font-bold data-[state=active]:bg-card">
            {t("bills.tabAll")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered === null ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-secondary/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={tab === "unpaid" ? Sparkles : ReceiptText}
          title={tab === "unpaid" ? t("bills.noUnpaidTitle") : t("bills.noneInFilterTitle")}
          desc={t("bills.emptyDesc")}
          action={
            <Button onClick={() => setSimOpen(true)} className="rounded-xl font-bold">
              <Wand2 className="h-4 w-4" />
              {t("bills.simulateShortBtn")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5 max-h-[calc(100vh-16rem)] overflow-y-auto scrollbar-slim pe-1">
          {filtered.map((b) => (
            <BillRow key={b.id} bill={b} onPay={setPaying} />
          ))}
        </div>
      )}

      {/* PIN dialog */}
      <PinDialog
        open={!!paying}
        onOpenChange={(v) => !v && setPaying(null)}
        title={t("bills.payConfirmTitle")}
        description={paying ? `${paying.biller_name} · ${paying.period || t("bills.noPeriod")}` : ""}
        amount={paying?.amount}
        confirmText={t("bills.payNowBtn")}
        onConfirm={confirmPay}
      />

      {/* receipt dialog */}
      <Dialog open={!!receipt} onOpenChange={(v) => !v && setReceipt(null)}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("bills.receiptTitle")}</DialogTitle>
            <DialogDescription>{t("bills.receiptDesc")}</DialogDescription>
          </DialogHeader>
          {receipt && <ReceiptCard receipt={receipt} />}
        </DialogContent>
      </Dialog>

      <SimulateBillDialog
        open={simOpen}
        onOpenChange={setSimOpen}
        onCreated={(nb) => {
          setBills((bs) => [nb, ...(bs ?? [])]);
          setTab("unpaid");
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

const CATEGORY_OPTIONS = ["electricity", "water", "internet", "mobile", "education", "traffic"];

function SimulateBillDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (b: Bill) => void;
}) {
  const { token } = useSession();
  const { toast } = useToast();
  const { t, lang } = useT();
  const [billers, setBillers] = useState<BillerOption[] | null>(null);
  const [category, setCategory] = useState("electricity");
  const [billerCode, setBillerCode] = useState("");
  const [subscriber, setSubscriber] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || billers) return;
    urpay
      .billers()
      .then((data) => {
        const opts: BillerOption[] = [];
        for (const [cat, list] of Object.entries(data.billers)) {
          const meta = data.categories.find((c) => c.key === cat);
          for (const b of list) {
            opts.push({ category: cat, code: b.code, name: b.name, ar: meta?.ar ?? cat });
          }
        }
        setBillers(opts);
      })
      .catch(() => setBillers([]));
  }, [open, billers]);

  const catBillers = billers?.filter((b) => b.category === category) ?? [];
  const valid =
    billerCode.length > 0 && subscriber.trim().length >= 3 && Number(amount) > 1000;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !token) return;
    setLoading(true);
    try {
      const nb = await urpay.simulateBill(token, {
        category,
        biller_code: billerCode,
        subscriber_no: subscriber.trim(),
        amount: Number(amount),
      });
      onCreated(nb);
      onOpenChange(false);
      toast({
        title: t("bills.generatedToastTitle"),
        description: t("bills.generatedToastDesc"),
      });
      setBillerCode("");
      setSubscriber("");
      setAmount("");
    } catch (err) {
      toast({
        title: t("bills.generateFailTitle"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-gold-deep" />
            {t("bills.simulateBtn")}
          </DialogTitle>
          <DialogDescription>
            {t("bills.simulateDesc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">{t("bills.categoryLabel")}</Label>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCategory(c);
                    setBillerCode("");
                  }}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition-all ${
                    category === c
                      ? "border-primary bg-primary/[.07]"
                      : "border-border/60 hover:border-primary/40"
                  }`}
                  aria-pressed={category === c}
                >
                  <CategoryIcon category={c} boxed={false} className={category === c ? "text-primary" : "text-muted-foreground"} />
                  <span className="text-[0.62rem] font-bold">{categoryName(c, lang)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">{t("bills.billerLabel")}</Label>
              <Select value={billerCode} onValueChange={setBillerCode}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder={billers ? t("bills.selectBiller") : t("common.loading")} />
                </SelectTrigger>
                <SelectContent>
                  {catBillers.map((b) => (
                    <SelectItem key={b.code} value={b.code}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">{t("bills.subscriberLabel")}</Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                placeholder="12345678"
                value={subscriber}
                onChange={(e) => setSubscriber(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className="num text-left"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">{t("bills.amountLabel")}</Label>
            <Input
              dir="ltr"
              inputMode="numeric"
              placeholder="35000"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="num text-left"
            />
            <div className="flex gap-1.5 pt-1">
              {[15000, 35000, 60000, 120000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-[0.65rem] font-bold text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors num"
                >
                  {v.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl font-bold">
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || loading} className="rounded-xl font-bold flex-1">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("bills.generateBtn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
