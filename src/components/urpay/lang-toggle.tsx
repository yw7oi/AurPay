"use client";

import { Languages } from "lucide-react";

import { useLang, useT } from "@/lib/i18n";

/**
 * AR ⇄ EN language pill — same visual family as ThemeToggle.
 * `compact` = icon-only button for tight mobile headers (shows the OTHER
 * language's code, i.e. what you'd switch TO).
 */
export function LangToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { lang, toggle } = useLang();
  const { t } = useT();
  const isAr = lang === "ar";

  if (compact) {
    return (
      <button
        onClick={toggle}
        aria-label={isAr ? t("lang.toEnglish") : t("lang.toArabic")}
        title={isAr ? t("lang.toEnglish") : t("lang.toArabic")}
        className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-border/70 bg-secondary/70 px-2 text-[11px] font-bold tracking-wide text-foreground transition-colors hover:border-primary/40 hover:text-primary ${className ?? ""}`}
      >
        {isAr ? "EN" : "ع"}
        <span className="sr-only">
          {isAr ? t("lang.englishOn") : t("lang.arabicOn")}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label={isAr ? t("lang.toEnglish") : t("lang.toArabic")}
      title={isAr ? t("lang.toEnglish") : t("lang.toArabic")}
      className={`group relative inline-flex h-9 w-[4.25rem] items-center rounded-full border border-border/70 bg-secondary/70 transition-colors hover:border-primary/40 ${className ?? ""}`}
    >
      {/* track labels */}
      <span
        className={`absolute start-2 text-[11px] font-bold transition-all ${
          isAr ? "text-primary scale-100" : "text-muted-foreground/50 scale-90"
        }`}
      >
        ع
      </span>
      <Languages
        className={`absolute end-2 h-4 w-4 transition-all ${
          isAr ? "text-muted-foreground/50 scale-90" : "text-gold-deep scale-100"
        }`}
      />
      {/* knob */}
      <span
        className={`absolute top-1 h-7 w-7 rounded-full bg-card shadow-lift ring-1 ring-border/60 transition-all duration-300 ${
          isAr ? "start-1" : "start-[2.3rem]"
        }`}
        aria-hidden="true"
      />
      <span className="sr-only">
        {isAr ? t("lang.arabicOn") : t("lang.englishOn")}
      </span>
    </button>
  );
}
