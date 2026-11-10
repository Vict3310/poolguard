import { AppShell, AuthGate } from "@/components/app-shell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <AuthGate>{children}</AuthGate>
    </AppShell>
  );
}
