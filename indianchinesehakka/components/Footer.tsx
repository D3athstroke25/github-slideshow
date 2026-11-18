import Link from "next/link";
import { site } from "@/config/site";
import { Year } from "@/components/Year";

export function Footer() {
  return (
    <footer className="mt-16 bg-ink pb-28 text-white md:pb-10">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="font-display text-xl font-extrabold">{site.name}</p>
          <p className="mt-2 text-sm text-white/85">100% halal · No alcohol · Family-run</p>
        </div>
        <address className="text-sm not-italic leading-relaxed text-white/85">
          {site.address.street}, {site.address.city}, {site.address.region}
          <br />
          {site.address.crossStreets}
          <br />
          <a className="inline-block py-2 underline" href={`tel:${site.phone}`}>
            {site.phone}
          </a>
        </address>
        <nav className="flex flex-col text-sm" aria-label="Footer">
          <Link className="py-2 underline-offset-4 hover:underline" href="/menu">Menu</Link>
          <Link className="py-2 underline-offset-4 hover:underline" href="/tiffin">Tiffin</Link>
          <Link className="py-2 underline-offset-4 hover:underline" href="/catering">Catering</Link>
          <Link className="py-2 underline-offset-4 hover:underline" href="/about">About Us</Link>
        </nav>
      </div>
      <p className="border-t border-white/15 px-4 py-4 text-center text-xs text-white/75">
        © <Year initial={new Date().getFullYear()} /> {site.name}. All rights reserved.
      </p>
    </footer>
  );
}
