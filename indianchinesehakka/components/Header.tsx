import Link from "next/link";
import { CartButton } from "@/components/CartButton";

export function Header() {
  return (
    <header className="sticky top-0 z-30 bg-red-dark text-white shadow-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="mr-auto flex min-h-12 items-center gap-2" aria-label="Indian Chinese Halal Hakka — home">
          <span className="grid size-9 place-items-center rounded-full bg-gold font-display text-lg font-extrabold text-red-dark">
            H
          </span>
          <span className="font-display text-lg leading-tight font-extrabold">
            Halal Hakka
            <span className="block text-xs font-semibold tracking-wide text-gold">INDIAN · CHINESE</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm font-semibold md:flex" aria-label="Main">
          <Link className="rounded-lg px-3 py-3 hover:bg-white/10" href="/menu">Menu</Link>
          <Link className="rounded-lg px-3 py-3 hover:bg-white/10" href="/tiffin">Tiffin</Link>
          <Link className="rounded-lg px-3 py-3 hover:bg-white/10" href="/catering">Catering</Link>
          <Link className="rounded-lg px-3 py-3 hover:bg-white/10" href="/about">About Us</Link>
        </nav>
        <CartButton />
        <Link
          href="/menu"
          className="hidden min-h-12 items-center rounded-full bg-gold px-5 font-display font-extrabold text-red-dark hover:bg-gold-soft sm:flex"
        >
          Order Now
        </Link>
      </div>
    </header>
  );
}
