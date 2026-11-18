import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Catering" };

// Placeholder — full page comes in a later build stage.
export default function Page() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-display text-4xl font-extrabold">Catering</h1>
      <p className="mt-3 text-lg text-muted">Halal trays by headcount, with an instant quote request — coming soon.</p>
      <Link href="/menu" className="mt-6 inline-flex min-h-14 items-center rounded-full bg-red px-8 font-display text-lg font-extrabold text-white hover:bg-red-dark">
        Order Now
      </Link>
    </div>
  );
}
