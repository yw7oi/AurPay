"use client";

import { cn } from "@/lib/utils";

export function UrPayMark({ className, gold = "#E8C867" }: { className?: string; gold?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="urpay-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0F8A63" />
          <stop offset="1" stopColor="#0B5C46" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#urpay-g)" />
      <path
        d="M20 21v13a12 12 0 0 0 24 0V21"
        fill="none"
        stroke={gold}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="16.5" r="3.6" fill={gold} />
    </svg>
  );
}

export function UrPayLogo({
  className,
  dark = false,
  compact = false,
}: {
  className?: string;
  dark?: boolean;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <UrPayMark className="h-9 w-9 shrink-0" />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span
            className="font-display text-[1.35rem] tracking-tight"
            dir="ltr"
            style={{ color: dark ? "#F4F1E8" : "var(--ink)" }}
          >
            Ur<span style={{ color: "var(--gold-deep)" }}>Pay</span>
          </span>
          <span
            className="text-[0.72rem] font-semibold mt-1"
            style={{ color: dark ? "rgba(244,241,232,.72)" : "var(--muted-foreground)" }}
          >
            أور پاي
          </span>
        </span>
      )}
    </span>
  );
}

export function UrSeal({ className }: { className?: string }) {
  /* Mesopotamian sun/palm divider ornament */
  return (
    <svg viewBox="0 0 120 12" className={className} aria-hidden="true" fill="none">
      <line x1="0" y1="6" x2="46" y2="6" stroke="currentColor" strokeOpacity=".35" />
      <line x1="74" y1="6" x2="120" y2="6" stroke="currentColor" strokeOpacity=".35" />
      <path
        d="M60 1.5c-1.8 0-3 1.2-3 2.7 0 1.2.7 2 1.6 2.4L57.4 10.5h5.2L61.4 6.6c.9-.4 1.6-1.2 1.6-2.4 0-1.5-1.2-2.7-3-2.7Z"
        fill="currentColor"
      />
      <circle cx="53" cy="6" r="1.4" fill="currentColor" fillOpacity=".6" />
      <circle cx="67" cy="6" r="1.4" fill="currentColor" fillOpacity=".6" />
    </svg>
  );
}
