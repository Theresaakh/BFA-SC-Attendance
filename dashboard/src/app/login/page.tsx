import Image from "next/image";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/guard";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await currentUser()) redirect("/");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-brand-navy lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-red/20 blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/5 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <Image src="/logo.png" alt="" width={48} height={48} priority />
          <span className="font-display text-xl font-semibold uppercase tracking-wider text-white">Beirut Football Academy</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-semibold uppercase leading-tight tracking-wide text-white">Finance &amp; attendance, in one place.</h1>
          <p className="mt-4 text-base text-white/70">Customer invoices from Odoo and player and coach attendance from the BFA app, matched player by player.</p>
        </div>
        <p className="relative text-sm text-white/50">Internal administration system · Authorised staff only</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image src="/logo.png" alt="" width={40} height={40} priority />
            <span className="font-display text-lg font-semibold uppercase tracking-wider text-ink">BFA Admin</span>
          </div>
          <h2 className="text-2xl font-bold text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your BFA administration account.</p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
