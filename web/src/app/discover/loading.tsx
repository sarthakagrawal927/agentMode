export default function Loading() {
  return (
    <main className="container mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-9 w-40 bg-muted animate-pulse rounded" />
        <div className="h-10 w-48 bg-muted animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-96 border rounded bg-card p-4 space-y-3">
            <div className="flex gap-2">
              <div className="h-5 w-20 bg-muted animate-pulse rounded" />
              <div className="h-5 w-16 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-5 w-32 bg-muted animate-pulse rounded" />
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
            <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
            <div className="h-4 w-4/6 bg-muted animate-pulse rounded" />
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
            <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </main>
  );
}
