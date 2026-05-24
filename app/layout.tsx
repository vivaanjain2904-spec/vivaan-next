import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vaelor · Paper trading with real edge",
  description:
    "AI-powered paper trading with ATR-based smart stops, ML drop-probability signals, multi-channel alerts, and hands-off auto-execution via Alpaca.",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
  openGraph: {
    title: "Vaelor · Paper trading with real edge",
    description:
      "Volatility-adjusted stops, ML signals, and hands-off execution. Free forever.",
    url: "https://vaelor.dev",
    siteName: "Vaelor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vaelor · Paper trading with real edge",
    description:
      "ATR smart stops · ML signals · Auto-execution. Free forever.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
