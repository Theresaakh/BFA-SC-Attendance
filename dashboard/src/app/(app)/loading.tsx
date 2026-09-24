export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 h-8 w-56 rounded-lg bg-surface-3" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-xl bg-surface-3" />)}
      </div>
      <div className="mt-6 h-96 rounded-xl bg-surface-3" />
    </div>
  );
}
