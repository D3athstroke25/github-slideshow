"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";

export function CartButton() {
  const { count, hydrated } = useCart();
  return (
    <Link
      href="/cart"
      className="relative flex min-h-12 min-w-12 items-center justify-center rounded-full hover:bg-white/10"
      aria-label={hydrated && count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart"}
    >
      <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
      {hydrated && count > 0 && (
        <span className="absolute top-1 right-0 grid min-w-5 place-items-center rounded-full bg-gold px-1 text-xs font-extrabold text-red-dark">
          {count}
        </span>
      )}
    </Link>
  );
}
