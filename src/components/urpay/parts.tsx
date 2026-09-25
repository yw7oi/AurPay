"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, ChevronLeft, Copy, Loader2, ShieldCheck, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot,
} from "@/components/ui/input-otp";
import { CategoryIcon, DirectionIcon } from "./icons";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/lib/i18n";
import { categoryName, dueLabel, fmtDateTime, fmtIQD, type Bill, type Receipt, type Txn } from "@/lib/urpay";

/* ----------------------------- PIN dialog ---------------------------- */

export function PinDialog({
  open,
  onOpenChange,
  title,
  description,
  amount,
  confirmText,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  amount?: number;
  confirmText?: string;
  onConfirm: (pin: string) => Promise<string | null>;
  /* returns error message or null on success */
}) {
  const { t, lang } = useT();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* bumped on each wrong attempt — re-triggers the shake animation */
  const [shakeKey, setShakeKey] = useState(0);
  /* synchronous in-flight guard — prevents the onComplete + button-click
     double-submit race (both would otherwise read a stale `loading`) */
  const inFlight = useRef(false);

  /* reset state when the dialog opens — derived during render (lint-safe) */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPin("");
      setError(null);
      setLoading(false);
      setShakeKey(0);
      inFlight.current = false;
    }
  }

  async function submit() {
    if (pin.length < 4 || loading || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const err = await onConfirm(pin);
      if (err) {
        setError(err);
        setPin("");
        setShakeKey((k) => k + 1);
        inFlight.current = false;
      } else {
        onOpenChange(false); // parent closes; reset happens on next open
      }
    } catch {
      setError(t("parts.unexpectedError"));
      setPin("");
      setShakeKey((k) => k + 1);
      inFlight.current = false;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader className="text-center items-center space-y-0">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <DialogTitle className="font-display text-xl mt-3">{title}</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>

        {amount !== undefined && (
          <p className="num text-center text-2xl text-primary">
            {fmtIQD(amount, true, lang)}
          </p>
        )}

        <div className="flex flex-col items-center gap-2 py-2">
          <div key={shakeKey} className={shakeKey > 0 ? "animate-shake" : ""}>
            <InputOTP
              dir="ltr"
              maxLength={6}
              value={pin}
              onChange={setPin}
              onComplete={submit}
              disabled={loading}
            >
              <InputOTPGroup>
                {[0, 1, 2].map((i) => (
                  <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg num" />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg num" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            {t("parts.pinHint")}
          </p>
          {error && (
            <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
              <X className="h-4 w-4" />
              {error}
            </p>
          )}
        </div>

        <Button
          onClick={submit}
          disabled={pin.length < 4 || loading}
          className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BadgeCheck className="h-5 w-5" />}
          {confirmText ?? t("parts.confirm")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- receipt card --------------------------- */

export function ReceiptCard({
  receipt,
  floating = false,
}: {
  receipt: Receipt;
  floating?: boolean;
}) {
  const { t, lang } = useT();
  const [copied, setCopied] = useState(false);

  async function copyRef() {
    const ok = await copyToClipboard(receipt.reference);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <motion.div
      initial={floating ? { opacity: 0, y: 8, scale: 0.98 } : false}
      animate={floating ? { opacity: 1, y: 0, scale: 1 } : undefined}
      className="rounded-2xl border border-primary/30 bg-card p-4 shadow-lift"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/25">
            <BadgeCheck className="h-4 w-4" />
          </span>
          <p className="text-sm font-bold text-primary">{t("parts.receiptSuccess")}</p>
        </div>
        <Badge className="rounded-lg bg-primary/10 text-primary hover:bg-primary/10">
          {t("parts.receipt")}
        </Badge>
      </div>
      <p className="mt-2.5 font-semibold leading-snug">{receipt.title}</p>
      {receipt.subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{receipt.subtitle}</p>
      )}
      <p className="num mt-2 text-2xl text-primary">
        {fmtIQD(receipt.amount, true, lang)}
      </p>
      <div className="mt-3 border-t border-dashed border-border pt-2.5 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex flex-col">
          <span>{t("parts.reference")}</span>
          <button
            onClick={copyRef}
            className="num font-semibold text-foreground inline-flex items-center gap-1.5 hover:text-primary transition-colors text-start"
            dir="ltr"
            title={t("parts.copyReference")}
          >
            {receipt.reference}
            {copied ? (
              <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
          </button>
        </div>
        <div className="flex flex-col">
          <span>{t("parts.balanceAfter")}</span>
          <span className="num font-semibold text-foreground">
            {fmtIQD(receipt.balance_after, true, lang)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[0.68rem] text-muted-foreground/80">
        {fmtDateTime(receipt.created_at, lang)}
      </p>
    </motion.div>
  );
}

/* ------------------------------- avatar ------------------------------ */

export function UserAvatar({
  name,
  hue,
  size = 40,
  className,
}: {
  name: string;
  hue: number;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 30) % 360} 60% 30%))`,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/* ------------------------------ bill row ----------------------------- */

/* urgency: how close the due date is — drives the progress bar color/width */
function urgency(bill: Bill): { pct: number; tone: string; bar: string } {
  if (bill.status === "paid") return { pct: 0, tone: "", bar: "" };
  if (bill.overdue) return { pct: 100, tone: "text-destructive", bar: "bg-destructive" };
  const days = Math.ceil((+new Date(bill.due_date) - Date.now()) / 86_400_000);
  if (days <= 3) return { pct: 85, tone: "text-destructive", bar: "bg-destructive/80" };
  if (days <= 7) return { pct: 60, tone: "text-gold-deep", bar: "bg-gold" };
  return { pct: 30, tone: "text-muted-foreground", bar: "bg-primary/60" };
}

export function BillRow({ bill, onPay }: { bill: Bill; onPay?: (b: Bill) => void }) {
  const { t, lang } = useT();
  const u = urgency(bill);
  return (
    <div
      className={`relative overflow-hidden flex items-center gap-3.5 rounded-2xl border bg-card p-3.5 sm:p-4 transition-all ${
        bill.status === "unpaid"
          ? "border-border/70 hover:border-primary/40 hover:shadow-lift"
          : "border-border/40 bg-secondary/30"
      }`}
    >
      {/* urgency bar (right edge in RTL) */}
      {bill.status === "unpaid" && (
        <span
          className={`absolute bottom-0 start-0 h-1 rounded-full transition-all ${u.bar}`}
          style={{ width: `${u.pct}%` }}
          aria-hidden="true"
        />
      )}
      <CategoryIcon category={bill.category} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`font-bold text-sm truncate ${bill.status === "paid" ? "text-muted-foreground" : ""}`}>
            {bill.biller_name}
          </p>
          {bill.overdue && (
            <Badge variant="destructive" className="rounded-md text-[0.62rem] px-1.5 h-5">
              {t("parts.overdue")}
            </Badge>
          )}
          {bill.status === "paid" && (
            <Badge className="rounded-md bg-primary/10 text-primary hover:bg-primary/10 text-[0.62rem] px-1.5 h-5">
              {t("parts.paid")}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          #{bill.id} · {bill.period || t("parts.noPeriod")} · {t("parts.subscription")} {bill.subscriber_no}
        </p>
        {bill.status === "unpaid" && (
          <p className={`text-[0.7rem] mt-1 font-semibold ${u.tone}`}>
            {t("parts.due")} {dueLabel(bill.due_date, lang)}
          </p>
        )}
        {bill.status === "paid" && bill.receipt_ref && (
          <p className="text-[0.7rem] mt-1 text-muted-foreground/70 num" dir="ltr">
            {bill.receipt_ref}
          </p>
        )}
      </div>
      <div className="text-end shrink-0">
        <p className={`num font-bold ${bill.status === "paid" ? "text-muted-foreground/60" : ""}`}>
          {fmtIQD(bill.amount, false, lang)}
          <span className="text-[0.6rem] font-medium text-muted-foreground block mt-0.5">{t("parts.iqd")}</span>
        </p>
        {bill.status === "unpaid" && onPay && (
          <Button
            size="sm"
            onClick={() => onPay(bill)}
            className="mt-2 rounded-xl h-8 px-3.5 text-xs font-bold"
          >
            {t("parts.payNow")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- txn row ----------------------------- */

export function TxnRow({ txn, onOpen }: { txn: Txn; onOpen?: (txn: Txn) => void }) {
  const { t, lang } = useT();
  const interactive = typeof onOpen === "function";
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen?.(txn);
              }
            }
          : undefined
      }
      onClick={interactive ? () => onOpen?.(txn) : undefined}
      className={`flex items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-3.5 transition-all group/txn ${
        interactive
          ? "cursor-pointer hover:border-primary/35 hover:shadow-lift hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          : "hover:border-primary/35"
      }`}
    >
      <CategoryIcon category={txn.category === "transfer" ? "transfer" : txn.category} />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate">{txn.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {txn.subtitle || txn.reference} · {fmtDateTime(txn.created_at, lang)}
        </p>
      </div>
      <div className="text-end shrink-0">
        <p
          className={`num font-bold flex items-center gap-1 justify-end rounded-xl px-2 py-1 ${
            txn.direction === "in"
              ? "text-primary bg-primary/10"
              : "text-foreground bg-secondary"
          }`}
        >
          <DirectionIcon direction={txn.direction} />
          {txn.direction === "out" ? "−" : "+"}
          {fmtIQD(txn.amount, false, lang)}
        </p>
        <p className="text-[0.62rem] text-muted-foreground num mt-1">
          {t("parts.balance", { n: fmtIQD(txn.balance_after, true, lang) })}
        </p>
      </div>
      {interactive && (
        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover/txn:text-primary" aria-hidden="true" />
      )}
    </div>
  );
}

/* --------------------------- txn detail dialog ------------------------ */

const TXN_TYPE_KEY: Record<Txn["type"], string> = {
  bill_payment: "txns.typeBillPayment",
  transfer_out: "txns.typeTransferOut",
  transfer_in: "txns.typeTransferIn",
  topup: "txns.typeTopup",
};

export function TxnDetailDialog({
  txn,
  onOpenChange,
}: {
  txn: Txn | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, lang } = useT();
  const [copied, setCopied] = useState(false);

  async function copyRef() {
    if (!txn) return;
    const ok = await copyToClipboard(txn.reference);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <Dialog open={!!txn} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl p-6" dir={lang === "ar" ? "rtl" : "ltr"}>
        {txn && (
          <>
            <DialogHeader className="text-center">
              <DialogTitle className="flex items-center justify-center gap-2 font-display text-xl">
                <DirectionIcon direction={txn.direction} />
                {t("parts.txnDetail")}
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col items-center pt-1">
              <CategoryIcon category={txn.category === "transfer" ? "transfer" : txn.category} />
              <p className="mt-3 font-semibold text-center leading-snug">{txn.title}</p>
              <p
                className={`num mt-2 text-3xl font-bold ${
                  txn.direction === "in" ? "text-primary" : "text-foreground"
                }`}
              >
                {txn.direction === "out" ? "−" : "+"}
                {fmtIQD(txn.amount, true, lang)}
              </p>
              <Badge
                variant="outline"
                className={`mt-2 rounded-full text-[0.65rem] font-bold ${
                  txn.direction === "in"
                    ? "border-primary/30 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {t(TXN_TYPE_KEY[txn.type])}
              </Badge>
            </div>

            <div className="mt-5 rounded-2xl border border-dashed border-border bg-secondary/30 divide-y divide-border/60">
              <DetailRow label={t("parts.txnDirection")}>
                {txn.direction === "in"
                  ? t("parts.txnDirectionIn")
                  : t("parts.txnDirectionOut")}
              </DetailRow>
              <DetailRow label={t("parts.txnCategory")}>
                {categoryName(txn.category, lang)}
              </DetailRow>
              {txn.subtitle && (
                <DetailRow label={t("parts.txnNotes")}>{txn.subtitle}</DetailRow>
              )}
              <DetailRow label={t("parts.txnWhen")}>
                <span className="num">{fmtDateTime(txn.created_at, lang)}</span>
              </DetailRow>
              <DetailRow label={t("parts.txnBalanceAfter")}>
                <span className="num font-bold text-primary">
                  {fmtIQD(txn.balance_after, true, lang)}
                </span>
              </DetailRow>
              <DetailRow label={t("parts.reference")}>
                <button
                  onClick={copyRef}
                  className="num font-semibold inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                  dir="ltr"
                  title={t("parts.copyReference")}
                >
                  {txn.reference}
                  {copied ? (
                    <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                </button>
              </DetailRow>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-semibold text-foreground text-end min-w-0">{children}</span>
    </div>
  );
}

/* ----------------------------- empty state --------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="relative flex flex-col items-center justify-center rounded-3xl border border-dashed border-border/80 bg-secondary/25 p-10 text-center overflow-hidden"
    >
      {/* soft decorative glow */}
      <span
        className="absolute -top-10 start-1/2 -translate-x-1/2 h-28 w-48 rounded-full bg-primary/[.07] blur-2xl"
        aria-hidden="true"
      />
      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-card border border-border/80 text-muted-foreground shadow-sm">
        <Icon className="h-6 w-6" />
      </span>
      <p className="relative mt-4 font-bold">{title}</p>
      <p className="relative mt-1 text-sm text-muted-foreground max-w-xs leading-relaxed">{desc}</p>
      {action && <div className="relative mt-4">{action}</div>}
    </div>
  );
}
