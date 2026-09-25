"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditCard, History, Home, LayoutGrid, LogOut, MessageSquareHeart,
  RefreshCw, Send, UserRound,
} from "lucide-react";
import { UrPayLogo } from "./logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/store";
import { fmtIQD, urpay } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { OverviewView } from "./overview";
import { BillsView } from "./bills-view";
import { TransferView } from "./transfer-view";
import { AgentView } from "./agent-view";
import { TransactionsView } from "./transactions-view";
import { ProfileView } from "./profile-view";
import { UserAvatar } from "./parts";
import { ThemeToggle } from "./theme-toggle";
import { NotificationsBell } from "./notifications-bell";

export type DashTab = "overview" | "bills" | "transfer" | "agent" | "transactions" | "profile";

const NAV: { key: DashTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "نظرة عامة", icon: Home },
  { key: "bills", label: "الفواتير", icon: LayoutGrid },
  { key: "transfer", label: "تحويل", icon: Send },
  { key: "agent", label: "المساعد أور", icon: MessageSquareHeart },
  { key: "transactions", label: "السجل", icon: History },
  { key: "profile", label: "حسابي", icon: UserRound },
];

export function Dashboard({
  tab,
  setTab,
  refreshKey,
}: {
  tab: DashTab;
  setTab: (t: DashTab) => void;
  refreshKey: number;
}) {
  const { user, token, setUser, logout } = useSession();
  const { toast } = useToast();

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const me = await urpay.me(token);
      setUser(me);
    } catch {
      /* silent */
    }
  }, [token, setUser]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser, refreshKey]);

  if (!user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-clip" dir="rtl">
      {/* top header */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <UrPayLogo compact className="lg:hidden" />
            <UrPayLogo className="hidden lg:inline-flex" />
            <div className="hidden sm:flex items-center gap-2 ms-2 rounded-full border border-primary/25 bg-primary/[.06] px-3.5 py-1.5">
              <span className="text-[0.68rem] font-medium text-muted-foreground">الرصيد</span>
              <span className="num text-sm font-bold text-primary" dir="rtl">
                {fmtIQD(user.balance)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="sm:hidden">
              <ThemeToggle compact />
            </div>
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshUser}
              className="rounded-full"
              aria-label="تحديث"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <NotificationsBell refreshKey={refreshKey} onNavigate={setTab} />
            <button
              onClick={() => setTab("profile")}
              className="flex items-center gap-2.5 rounded-full border border-border/70 bg-card py-1 pe-3 ps-1 hover:border-primary/40 transition-colors"
            >
              <UserAvatar name={user.full_name} hue={user.avatar_hue} size={30} />
              <span className="hidden sm:block text-sm font-bold max-w-28 truncate">
                {user.first_name}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                logout();
                toast({ title: "تم تسجيل الخروج", description: "نشتاقلك! ترجع بأي وقت." });
              }}
              className="rounded-full text-muted-foreground hover:text-destructive"
              aria-label="تسجيل الخروج"
            >
              <LogOut className="h-4 w-4 rtl:-scale-x-100" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 flex gap-6 py-6 pb-24 lg:pb-8">
        {/* sidebar — desktop */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 sticky top-24 self-start">
          <nav className="rounded-3xl border border-border/70 bg-card p-2.5 space-y-1" aria-label="قائمة اللوحة">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => setTab(n.key)}
                className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition-all ${
                  tab === n.key
                    ? "bg-primary text-primary-foreground shadow-lift"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <n.icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                {n.label}
                {n.key === "agent" && tab !== "agent" && (
                  <span className="ms-auto h-2 w-2 rounded-full bg-gold animate-pulse-dot" />
                )}
              </button>
            ))}
          </nav>
          <div className="mt-4 rounded-3xl bg-night text-[#F4F1E8] p-5 relative overflow-hidden grain">
            <div className="absolute inset-0 pattern-ur-dark opacity-70" aria-hidden="true" />
            <div className="relative">
              <Badge className="rounded-full bg-[#3ED9A3]/15 text-[#3ED9A3] border-[#3ED9A3]/30 text-[0.65rem] hover:bg-[#3ED9A3]/15">
                Groq · gpt-oss-120b
              </Badge>
              <p className="mt-3 font-bold text-sm leading-snug">
                خلّي أور يدفع فواتيرك
              </p>
              <p className="mt-1 text-[0.7rem] text-white/60 leading-relaxed">
                محادثة وحدة تكفي — يفهم، يتحقق، يطلب PIN، وينفّذ.
              </p>
              <Button
                size="sm"
                onClick={() => setTab("agent")}
                className="mt-3.5 rounded-xl bg-[#3ED9A3] text-[#0C2A21] hover:bg-[#5ce0b0] font-bold"
              >
                افتح المحادثة
              </Button>
            </div>
          </div>
        </aside>

        {/* main */}
        <main className="flex-1 min-w-0">
          {tab === "overview" && <OverviewView setTab={setTab} refreshKey={refreshKey} />}
          {tab === "bills" && <BillsView refreshKey={refreshKey} />}
          {tab === "transfer" && <TransferView />}
          {tab === "agent" && <AgentView />}
          {tab === "transactions" && <TransactionsView />}
          {tab === "profile" && <ProfileView />}
        </main>
      </div>

      {/* bottom bar — mobile */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
        aria-label="التنقل السفلي"
      >
        <div className="grid grid-cols-6 h-16">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className={`flex flex-col items-center justify-center gap-0.5 relative ${
                tab === n.key ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {tab === n.key && (
                <span className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />
              )}
              <n.icon className="h-5 w-5" />
              <span className="text-[0.6rem] font-bold">{n.label}</span>
              {n.key === "agent" && tab !== "agent" && (
                <span className="absolute top-2 end-3 h-1.5 w-1.5 rounded-full bg-gold" />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
