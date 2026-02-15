export default function Loading() {
  return (
    <main className="container mx-auto p-8 space-y-8">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-4 w-96 bg-muted animate-pulse rounded" />
        <div className="flex gap-2 mt-2">
          <div className="h-5 w-20 bg-muted animate-pulse rounded" />
          <div className="h-5 w-24 bg-muted animate-pulse rounded" />
        </div>
      </div>

      {/* Period tabs + controls */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="h-7 w-28 bg-muted animate-pulse rounded" />
          <div className="flex gap-1">
            <div className="h-8 w-16 bg-muted animate-pulse rounded" />
            <div className="h-8 w-16 bg-muted animate-pulse rounded" />
            <div className="h-8 w-16 bg-muted animate-pulse rounded" />
          </div>
        </div>

        <div className="h-4 w-64 bg-muted animate-pulse rounded mb-4" />

        {/* Summary skeleton */}
        <div className="border rounded bg-card p-4 space-y-3">
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
          <div className="h-4 w-4/6 bg-muted animate-pulse rounded" />
          <div className="h-4 w-full bg-muted animate-pulse rounded" />
          <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
          <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
          <div className="h-4 w-2/3 bg-muted animate-pulse rounded" />
        </div>
      </div>
    </main>
  );
}
