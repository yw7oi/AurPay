"use client";

/**
 * Lightweight i18n for AurPay — Arabic (default, RTL) & English (LTR).
 * - `useT()` hook: { t, lang, dir, isRTL } — subscribes to lang changes.
 * - dictionaries live in src/lib/dict/{landing,dashboard,misc}.ts
 *   each exports { ar: {...}, en: {...} } for its namespace.
 * - `t(key, vars)` supports {var} interpolation.
 */
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { ar as landingAr, en as landingEn } from "./dict/landing";
import { ar as authAr, en as authEn } from "./dict/auth";
import { ar as dashboardAr, en as dashboardEn } from "./dict/dashboard";
import { ar as miscAr, en as miscEn } from "./dict/misc";

export type Lang = "ar" | "en";

type Dict = Record<string, string>;

const AR: Dict = { ...miscAr, ...dashboardAr, ...landingAr, ...authAr };
const EN: Dict = { ...miscEn, ...dashboardEn, ...landingEn, ...authEn };

/* ------------------------------------------------------------------ */

type LangState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
};

export const useLang = create<LangState>()(
  persist(
    (set) => ({
      lang: "ar",
      setLang: (lang) => set({ lang }),
      toggle: () => set((s) => ({ lang: s.lang === "ar" ? "en" : "ar" })),
    }),
    { name: "urpay-lang" },
  ),
);

/** Resolve a key for a given lang without subscribing (event handlers, toasts). */
export function tr(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const dict = lang === "en" ? EN : AR;
  let s = dict[key] ?? AR[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** Hook — use inside components. Re-renders on language change. */
export function useT() {
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  const toggle = useLang((s) => s.toggle);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars),
    [lang],
  );
  return {
    t, lang, setLang, toggle,
    dir: (lang === "ar" ? "rtl" : "ltr") as "rtl" | "ltr",
    isRTL: lang === "ar",
  };
}

/** Applies lang/dir to <html> — mount once at the app root. */
export function LangBoot() {
  const lang = useLang((s) => s.lang);
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  return null;
}
