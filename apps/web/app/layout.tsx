import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "PoolGuard — One task budget. Multiple agents.",
    template: "%s · PoolGuard",
  },
  description:
    "Give agents room to work, with spending limits enforced on NEAR. Shared task budgets, approved providers and recoverable payments.",
  applicationName: "PoolGuard",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f8f6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/near-wallet-selector.css" />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[8px] focus:bg-[var(--primary)] focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
