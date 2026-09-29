"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, useUi } from "@/lib/store";
import { urpay } from "@/lib/urpay";
import { Landing } from "@/components/urpay/landing";
import { AuthView } from "@/components/urpay/auth-view";
import { Dashboard, type DashTab } from "@/components/urpay/dashboard";
import { StorageNotice } from "@/components/urpay/storage-notice";

type View = "landing" | "auth" | "app";

export default function Page() {
  const { token, user } = useSession();
  const { setAuthTab } = useUi();
  const [view, setView] = useState<View>("landing");
  const [tab, setTabState] = useState<DashTab>("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [demo, setDemo] = useState<{ card_number: string; pin: string } | null>(null);

  /* tab switch also bumps the dashboard refresh signal */
  const setTab = useCallback((t: DashTab) => {
    setTabState(t);
    setRefreshKey((k) => k + 1);
  }, []);

  /* load the demo credentials once for the login screen */
  useEffect(() => {
    if (demo) return;
    let alive = true;
    urpay
      .stats()
      .then((s) => {
        if (alive && s.demo)
          setDemo({ card_number: s.demo.card_number, pin: s.demo.pin });
      })
      .catch(() => {
        if (alive) setDemo({ card_number: "4539123412341234", pin: "1234" });
      });
    return () => {
      alive = false;
    };
  }, [demo]);

  /* derive the effective view — no cascading setState effects:
     logged in  -> app
     logged out -> landing (never a dead "app" view) */
  const effectiveView: View =
    token && user ? "app" : view === "app" ? "landing" : view;

  const goLanding = () => setView("landing");
  const goAuth = (mode: "login" | "register" = "login") => {
    setAuthTab(mode);
    setView("auth");
  };

  /* the storage notice renders above EVERY view — it is the honest answer
     to "accounts vanish" on Vercel until a Blob store is connected */
  const body =
    effectiveView === "app" && token && user ? (
      <Dashboard tab={tab} setTab={setTab} refreshKey={refreshKey} />
    ) : effectiveView === "auth" ? (
      <AuthView onBack={goLanding} demoCard={demo} />
    ) : (
      <Landing onEnter={() => goAuth("login")} onDemo={() => goAuth("login")} />
    );

  return (
    <>
      <StorageNotice />
      {body}
    </>
  );
}
