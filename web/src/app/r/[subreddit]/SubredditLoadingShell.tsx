export default function SubredditLoadingShell() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-2xl border border-[#18253b] bg-[#060b14] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="border-b border-[#142137] px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-3">
              <div className="h-4 w-40 rounded bg-[#0f1d32] animate-pulse" />
              <div className="h-16 w-56 rounded bg-[#0f1d32] animate-pulse" />
            </div>

            <div className="space-y-3">
              <div className="ml-auto h-10 w-28 rounded-md border border-[#22375a] bg-[#0b1526] animate-pulse" />
              <div className="h-10 w-36 rounded-md border border-[#1f2f4a] bg-[#09121f] animate-pulse" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <div className="h-[520px] rounded-xl border border-[#1a2940] bg-[#081425] animate-pulse" />
          <div className="h-[520px] rounded-xl border border-[#1a2940] bg-[#081425] animate-pulse" />
        </div>
      </section>
    </main>
  );
}
