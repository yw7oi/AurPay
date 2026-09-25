import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LangBoot } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "أور پاي UrPay — محفظة العراق الذكية",
  description:
    "أور پاي (UrPay): منصة دفع عراقية بمساعد ذكي (AI Agent) يدفع فواتيرك ويحوّل أموالك من محادثة واحدة. كهرباء، ماء، إنترنت، اتصالات وتعليم — كلها بلمسة.",
  keywords: [
    "UrPay", "أور پاي", "محفظة عراقية", "دفع فواتير", "AI Agent",
    "زين العراق", "تحويل أموال", "fintech Iraq",
  ],
  authors: [{ name: "UrPay Team" }],
  openGraph: {
    title: "أور پاي UrPay — محفظة العراق الذكية",
    description: "ادفع فواتيرك بمحادثة واحدة مع أور، المساعد الذكي.",
    siteName: "UrPay",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E7A5C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* apply stored theme + language before first paint — no flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("urpay-theme");if(t==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}}catch(e){}try{var l=localStorage.getItem("urpay-lang");if(l){var v=JSON.parse(l);if(v&&v.state&&v.state.lang){var g=v.state.lang;document.documentElement.lang=g;if(g==="en"){document.documentElement.dir="ltr";}else{document.documentElement.dir="rtl";}}}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground font-sans">
        <LangBoot />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
