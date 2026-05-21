import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vaelor · AI Portfolio Agent",
  description: "Multi-user paper trading with ML signals and push alerts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
