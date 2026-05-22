import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vaelor · AI Trading & Investment",
  description: "Multi-user paper trading with ML signals and push alerts",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
