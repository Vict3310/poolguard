"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/auth-provider";
import { PreferencesProvider } from "@/components/preferences-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 4_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--surface)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                boxShadow: "var(--shadow-popover)",
              },
            }}
          />
        </TooltipProvider>
      </AuthProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
