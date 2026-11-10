import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="This page is outside the pool."
      body="The link may be old, or the page was moved. Nothing was spent getting here."
      actions={
        <>
          <Button asChild size="lg">
            <Link href="/app">
              Open your workspace <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/">
              <Home /> Home
            </Link>
          </Button>
        </>
      }
      detail={
        <p className="text-[12px] text-[var(--foreground-muted)]">
          Inside the workspace, press <span className="kbd">⌘</span> <span className="kbd">K</span> to jump anywhere.
        </p>
      }
    />
  );
}
