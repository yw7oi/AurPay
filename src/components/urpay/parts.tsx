"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, Copy, Loader2, ShieldCheck, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot,
} from "@/components/ui/input-otp";
import { CategoryIcon, DirectionIcon } from "./icons";
import { fmtDateTime, fmtIQD, type Bill, type Receipt, type Txn } from "@/lib/urpay";
import { dueLabel } from "@/lib/urpay";

/* ----------------------------- PIN dialog ---------------------------- */

export function PinDialog({
  open,
  onOpenChange,
  title,
  description,
  amount,
  confirmText = "تأكيد العملية",
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
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        inFlight.current = false;
      } else {
        onOpenChange(false); // parent closes; reset happens on next open
      }
    } catch {
      setError("صار خطأ غير متوقع — حاول مرة ثانية");
      setPin("");
      inFlight.current = false;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl" dir="rtl">
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
          <p className="num text-center text-2xl text-primary" dir="rtl">
            {fmtIQD(amount)}
          </p>
        )}

        <div className="flex flex-col items-center gap-2 py-2">
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
          <p className="text-[0.7rem] text-muted-foreground">
            أدخل رمزك السري (4–6 أرقام) — نفس PIN التسجيل
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
          {confirmText}
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
  const [copied, setCopied] = useState(false);

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(receipt.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <motion.div
      initial={floating ? { opacity: 0, y: 8, scale: 0.98 } : false}
      animate={floating ? { opacity: 1, y: 0, scale: 1 } : undefined}
      className="rounded-2xl border border-primary/30 bg-card p-4 shadow-lift"
      dir="rtl"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/25">
            <BadgeCheck className="h-4 w-4" />
          </span>
          <p className="text-sm font-bold text-primary">عملية ناجحة</p>
        </div>
        <Badge className="rounded-lg bg-primary/10 text-primary hover:bg-primary/10">
          إيصال
        </Badge>
      </div>
      <p className="mt-2.5 font-semibold leading-snug">{receipt.title}</p>
      {receipt.subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{receipt.subtitle}</p>
      )}
      <p className="num mt-2 text-2xl text-primary" dir="rtl">
        {fmtIQD(receipt.amount)}
      </p>
      <div className="mt-3 border-t border-dashed border-border pt-2.5 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex flex-col">
          <span>الرقم المرجعي</span>
          <button
            onClick={copyRef}
            className="num font-semibold text-foreground inline-flex items-center gap-1.5 hover:text-primary transition-colors text-start"
            dir="ltr"
            title="انسخ الرقم المرجعي"
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
          <span>الرصيد بعد العملية</span>
          <span className="num font-semibold text-foreground" dir="rtl">
            {fmtIQD(receipt.balance_after)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[0.68rem] text-muted-foreground/80">
        {fmtDateTime(receipt.created_at)}
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
  const u = urgency(bill);
  return (
    <div
      className={`relative overflow-hidden flex items-center gap-3.5 rounded-2xl border bg-card p-3.5 sm:p-4 transition-all ${
        bill.status === "unpaid"
          ? "border-border/70 hover:border-primary/40 hover:shadow-lift"
          : "border-border/40 bg-secondary/30"
      }`}
      dir="rtl"
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
              متأخرة
            </Badge>
          )}
          {bill.status === "paid" && (
            <Badge className="rounded-md bg-primary/10 text-primary hover:bg-primary/10 text-[0.62rem] px-1.5 h-5">
              مدفوعة
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          #{bill.id} · {bill.period || "بلا فترة"} · اشتراك {bill.subscriber_no}
        </p>
        {bill.status === "unpaid" && (
          <p className={`text-[0.7rem] mt-1 font-semibold ${u.tone}`}>
            الاستحقاق: {dueLabel(bill.due_date)}
          </p>
        )}
        {bill.status === "paid" && bill.receipt_ref && (
          <p className="text-[0.7rem] mt-1 text-muted-foreground/70 num" dir="ltr">
            {bill.receipt_ref}
          </p>
        )}
      </div>
      <div className="text-end shrink-0">
        <p className={`num font-bold ${bill.status === "paid" ? "text-muted-foreground/60" : ""}`} dir="rtl">
          {fmtIQD(bill.amount, false)}
          <span className="text-[0.6rem] font-medium text-muted-foreground block mt-0.5">د.ع</span>
        </p>
        {bill.status === "unpaid" && onPay && (
          <Button
            size="sm"
            onClick={() => onPay(bill)}
            className="mt-2 rounded-xl h-8 px-3.5 text-xs font-bold"
          >
            ادفع الآن
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- txn row ----------------------------- */

export function TxnRow({ txn }: { txn: Txn }) {
  return (
    <div
      className="flex items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-3.5 transition-all hover:border-primary/35 hover:shadow-lift"
      dir="rtl"
    >
      <CategoryIcon category={txn.category === "transfer" ? "transfer" : txn.category} />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate">{txn.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {txn.subtitle || txn.reference} · {fmtDateTime(txn.created_at)}
        </p>
      </div>
      <div className="text-end shrink-0">
        <p
          className={`num font-bold flex items-center gap-1 justify-end rounded-xl px-2 py-1 ${
            txn.direction === "in"
              ? "text-primary bg-primary/10"
              : "text-foreground bg-secondary"
          }`}
          dir="rtl"
        >
          <DirectionIcon direction={txn.direction} />
          {txn.direction === "out" ? "−" : "+"}
          {fmtIQD(txn.amount, false)}
        </p>
        <p className="text-[0.62rem] text-muted-foreground num mt-1" dir="rtl">
          رصيد: {fmtIQD(txn.balance_after)}
        </p>
      </div>
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
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-secondary/30 p-10 text-center" dir="rtl">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-card border border-border text-muted-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 font-bold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-xs leading-relaxed">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
