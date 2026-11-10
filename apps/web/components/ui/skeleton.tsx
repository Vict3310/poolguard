import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer rounded-[6px]", className)} />;
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="workspace-panel p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-9 w-56" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
