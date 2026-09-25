"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/* ------------------------------------------------------------------ */
/* useTheme — class-based light/dark with localStorage persistence.    */
/* Source of truth: the .dark class on <html> (applied pre-paint by    */
/* the inline script in layout.tsx). Exposed via useSyncExternalStore. */
/* ------------------------------------------------------------------ */

export type Theme = "light" | "dark";
const STORAGE_KEY = "urpay-theme";
const CHANGE_EVENT = "urpay-theme-change";

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggle = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}

/* ------------------------------------------------------------------ */

export function ThemeToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  /* compact — icon-only button for tight mobile headers */
  if (compact) {
    return (
      <button
        onClick={toggle}
        aria-label={dark ? "الوضع النهاري" : "الوضع الليلي"}
        title={dark ? "الوضع النهاري" : "الوضع الليلي"}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-secondary/70 text-foreground transition-colors hover:border-primary/40 hover:text-primary ${className ?? ""}`}
      >
        {dark ? (
          <Sun className="h-4 w-4 text-gold-deep" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
        <span className="sr-only">{dark ? "الوضع الليلي مفعّل" : "الوضع النهاري مفعّل"}</span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "الوضع النهاري" : "الوضع الليلي"}
      title={dark ? "الوضع النهاري" : "الوضع الليلي"}
      className={`group relative inline-flex h-9 w-16 items-center rounded-full border border-border/70 bg-secondary/70 transition-colors hover:border-primary/40 ${className ?? ""}`}
    >
      {/* track icons */}
      <Sun
        className={`absolute start-2 h-4 w-4 transition-all ${
          dark ? "text-muted-foreground/50 scale-90" : "text-gold-deep scale-100"
        }`}
      />
      <Moon
        className={`absolute end-2 h-4 w-4 transition-all ${
          dark ? "text-primary scale-100" : "text-muted-foreground/50 scale-90"
        }`}
      />
      {/* knob */}
      <span
        className={`absolute top-1 h-7 w-7 rounded-full bg-card shadow-lift ring-1 ring-border/60 transition-all duration-300 ${
          dark ? "start-[2.05rem]" : "start-1"
        }`}
        aria-hidden="true"
      />
      <span className="sr-only">{dark ? "الوضع الليلي مفعّل" : "الوضع النهاري مفعّل"}</span>
    </button>
  );
}
