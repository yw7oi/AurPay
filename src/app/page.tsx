"use client";

import { useEffect, useState } from "react";
import { useSession, useUi } from "@/lib/store";
import { urpay } from "@/lib/urpay";
import { Landing } from "@/components/urpay/landing";
import { AuthView } from "@/components/urpay/auth-view";
import { Dashboard, type DashTab } from "@/components/urpay/dashboard";

type View = "landing" | "auth" | "app";

export default function Page() {
  const { token, user } = useSession();
  const { setAuthTab } = useUi();
  const [view, setView] = useState<View>("landing");
  const [tab, setTab] = useState<DashTab>("overview");
  const [demo, setDemo] = useState<{ card_number: string; pin: string } | null>(null);

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

  if (effectiveView === "app" && token && user) {
    return <Dashboard tab={tab} setTab={setTab} refreshKey={tab} />;
  }

  if (effectiveView === "auth") {
    return <AuthView onBack={goLanding} demoCard={demo} />;
  }

  return <Landing onEnter={() => goAuth("login")} onDemo={() => goAuth("login")} />;
}
