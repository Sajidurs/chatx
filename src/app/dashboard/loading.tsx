// Next.js shows this automatically the instant a navigation starts, before
// the target route's own data has finished loading -- turns "blank screen
// until every query resolves" into an immediate response, which is most of
// what "the page feels slow" was actually about.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-gray-100" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
    </div>
  );
}
