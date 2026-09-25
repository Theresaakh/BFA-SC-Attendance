import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <p className="font-display text-6xl font-semibold text-brand-red">404</p>
      <h1 className="mt-2 text-xl font-bold text-ink">Page not found</h1>
      <p className="mt-1 text-sm text-muted">The record may have been removed from Odoo or the attendance app.</p>
      <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand-navy px-4 text-sm font-semibold text-white">Back to dashboard</Link>
    </main>
  );
}
