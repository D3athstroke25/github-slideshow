"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { money } from "@/lib/pricing";

/** Sticky bottom bar on phones: always one tap from the cart. Also announces each add. */
export function CartBar() {
  const { count, totals, hydrated, lastAdded } = useCart();
  const pathname = usePathname();
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!lastAdded) return;
    setFlash(`${lastAdded.name} added`);
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [lastAdded]);

  const hide = !hydrated || count === 0 || pathname === "/cart" || pathname.startsWith("/checkout");

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {flash ?? ""}
      </p>
      {!hide && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:bottom-4 md:left-auto md:right-4 md:w-96 md:p-0">
          <Link
            href="/cart"
            className="flex min-h-14 items-center gap-3 rounded-2xl bg-red px-4 font-display text-white shadow-xl shadow-red-dark/30 transition hover:bg-red-dark"
          >
            <span className="grid min-w-8 place-items-center rounded-full bg-white px-2 py-0.5 text-sm font-extrabold text-red">
              {count}
            </span>
            <span className="flex-1 truncate text-base font-bold">{flash ?? "View cart"}</span>
            <span className="text-lg font-extrabold">{money(totals.subtotal)}</span>
          </Link>
        </div>
      )}
    </>
  );
}
