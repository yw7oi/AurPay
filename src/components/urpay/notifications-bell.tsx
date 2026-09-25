"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft, ArrowUpRight, Bell, CheckCheck, ChevronLeft, Gauge, Inbox,
  ReceiptText, TriangleAlert, UserPlus, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSession } from "@/lib/store";
import { fmtIQD, timeAgo, urpay, type Notification } from "@/lib/urpay";
import type { DashTab } from "./dashboard";

/* kind → icon + tint */
const KIND_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  payment: { icon: ReceiptText, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
  topup: { icon: Wallet, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  transfer_in: { icon: ArrowDownLeft, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
  transfer_out: { icon: ArrowUpRight, cls: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
  transfer_request: { icon: UserPlus, cls: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
  transfer_declined: { icon: TriangleAlert, cls: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
  bill_due: { icon: TriangleAlert, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  budget_exceeded: { icon: Gauge, cls: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
  welcome: { icon: Bell, cls: "bg-primary/10 text-primary" },
};

/* kind → dashboard tab the user should land on when tapping the row */
const KIND_TAB: Record<string, DashTab> = {
  payment: "transactions",
  topup: "transactions",
  transfer_in: "transactions",
  transfer_out: "transactions",
  transfer_request: "transfer",
  transfer_declined: "transfer",
  bill_due: "bills",
  budget_exceeded: "overview",
  welcome: "overview",
};

export function NotificationsBell({ refreshKey, onNavigate }: {
  refreshKey: number;
  onNavigate?: (tab: DashTab) => void;
}) {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [marking, setMarking] = useState(false);
  const prevUnread = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!token) return;
      try {
        const feed = await urpay.notifications(token);
        setItems(feed.items);
        prevUnread.current = feed.unread;
        setUnread(feed.unread);
      } catch {
        if (!silent) setItems([]);
      }
    },
    [token],
  );

  /* initial + on any wallet action (refreshKey bumps after payments/transfers) */
  useEffect(() => {
    load(true);
  }, [load, refreshKey]);

  /* light polling while the dashboard is open — keeps the badge fresh */
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => load(true), 45_000);
    return () => clearInterval(id);
  }, [load, token]);

  async function markAll() {
    if (!token || marking) return;
    setMarking(true);
    try {
      await urpay.notificationsReadAll(token);
      setItems((prev) =>
        prev ? prev.map((n) => ({ ...n, is_read: true })) : prev,
      );
      setUnread(0);
    } finally {
      setMarking(false);
    }
  }

  async function markOne(n: Notification) {
    if (!token || n.is_read) return;
    setItems((prev) =>
      prev ? prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)) : prev,
    );
    setUnread((u) => Math.max(0, u - 1));
    urpay.notificationRead(token, n.id).catch(() => null);
  }

  function openNotification(n: Notification) {
    markOne(n);
    const tab = KIND_TAB[n.kind];
    if (tab && onNavigate) {
      setOpen(false);
      onNavigate(tab);
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-full hover:bg-secondary transition-colors p-2.5"
          aria-label={`الإشعارات${unread ? ` — ${unread} غير مقروء` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -end-0.5 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-gold text-[0.6rem] font-black text-[#3A2E07] flex items-center justify-center num shadow-sm">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={10}
        className="w-[22rem] sm:w-[24rem] p-0 rounded-3xl border-border/70 overflow-hidden shadow-lift"
        dir="rtl"
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-secondary/40">
          <p className="font-display text-sm font-bold flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-gold-deep" />
            الإشعارات
            {unread > 0 && (
              <span className="num rounded-full bg-gold/20 text-gold-deep px-2 py-0.5 text-[0.62rem] font-black">
                {unread} جديد
              </span>
            )}
          </p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAll}
              disabled={marking}
              className="h-7 rounded-lg text-[0.68rem] font-bold text-primary hover:text-primary px-2.5"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              علّم الكل
            </Button>
          )}
        </div>

        {/* list */}
        <div className="max-h-[22rem] overflow-y-auto scrollbar-slim">
          {items === null ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="h-9 w-9 rounded-2xl bg-secondary animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-0.5">
                    <div className="h-3 rounded-full bg-secondary animate-pulse w-3/4" />
                    <div className="h-2.5 rounded-full bg-secondary/70 animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 px-6 flex flex-col items-center text-center">
              <div className="h-14 w-14 rounded-3xl bg-secondary flex items-center justify-center">
                <Inbox className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="mt-3 text-sm font-bold">ما وصلك إشعار بعد</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                هيج رح تطلع هنا فواتيرك المستحقة، التحويلات، وكل عملية دفع.
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {items.map((n) => {
                const meta = KIND_META[n.kind] ?? KIND_META.welcome;
                return (
                  <motion.button
                    key={n.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => openNotification(n)}
                    className={`group w-full text-start flex gap-3 px-4 py-3 border-b border-border/40 last:border-0 transition-colors ${
                      n.is_read ? "hover:bg-secondary/40" : "bg-primary/[.04] hover:bg-primary/[.08]"
                    }`}
                  >
                    <span
                      className={`h-9 w-9 rounded-2xl flex items-center justify-center shrink-0 ${meta.cls}`}
                    >
                      <meta.icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-start justify-between gap-2">
                        <span className={`text-[0.8rem] leading-snug ${n.is_read ? "font-semibold text-foreground/80" : "font-bold"}`}>
                          {n.title}
                        </span>
                        <span className="flex items-center gap-1 shrink-0 mt-0.5">
                          {!n.is_read && (
                            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
                          )}
                          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:-translate-x-0.5 transition-all" aria-hidden="true" />
                        </span>
                      </span>
                      {n.body && (
                        <span className="block mt-0.5 text-[0.68rem] text-muted-foreground leading-relaxed line-clamp-2">
                          {n.body}
                        </span>
                      )}
                      <span className="flex items-center gap-2 mt-1">
                        <span className="text-[0.6rem] text-muted-foreground/70">
                          {timeAgo(n.created_at)}
                        </span>
                        {n.amount != null && (
                          <span className="num text-[0.62rem] font-bold text-foreground/70" dir="rtl">
                            {fmtIQD(n.amount)}
                          </span>
                        )}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* footer hint */}
        <div className="px-4 py-2 border-t border-border/60 bg-secondary/30">
          <p className="text-[0.6rem] text-muted-foreground/70 text-center">
            اضغط على الإشعار لتعليمه كمقروء · تحدّث تلقائيًا
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
