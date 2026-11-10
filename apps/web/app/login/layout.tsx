import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to PoolGuard with a NEAR wallet message signature. No transaction, no fee.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
