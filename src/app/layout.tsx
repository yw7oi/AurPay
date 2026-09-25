import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter_Tight } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const interTight = Inter_Tight({
  variable: "--font-display-tight",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

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
      <body
        className={`${interTight.variable} ${plexArabic.variable} antialiased bg-background text-foreground font-sans`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
