import { Skeleton } from "@/components/ui/skeleton";

function Header({ action = true }: { action?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-3">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action ? <Skeleton className="h-10 w-32" /> : null}
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <Header />
      <div className="workspace-panel grid gap-px overflow-hidden sm:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="space-y-3 p-5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <ListSkeletonPanel rows={4} />
    </div>
  );
}

export function ListSkeletonPanel({ rows = 5 }: { rows?: number }) {
  return (
    <div className="workspace-panel p-5">
      <Skeleton className="h-4 w-28" />
      <div className="mt-5 space-y-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListPageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label={`Loading ${label}`}>
      <Header />
      <ListSkeletonPanel rows={6} />
    </div>
  );
}

export function CardsPageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label={`Loading ${label}`}>
      <Header action={false} />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="workspace-panel space-y-3 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="mt-2 h-9 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading task">
      <Header />
      <div className="workspace-panel space-y-4 p-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListSkeletonPanel rows={3} />
        <ListSkeletonPanel rows={3} />
      </div>
    </div>
  );
}

export function FormPageSkeleton() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-6" aria-busy="true" aria-label="Loading form">
      <Header action={false} />
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-1 w-full rounded-full" />
        ))}
      </div>
      <div className="workspace-panel space-y-4 p-6">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
