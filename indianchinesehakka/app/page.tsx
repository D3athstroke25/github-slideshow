import Link from "next/link";
import { items } from "@/lib/menu";
import { money } from "@/lib/pricing";
import { ordering, site } from "@/config/site";

export default function Home() {
  const combos = items.filter((i) => i.category === "combos");
  const pct = Math.round(ordering.pickup.discountRate * 100);
  return (
    <>
      <section className="bg-red-dark text-white">
        <div className="mx-auto max-w-6xl px-4 pt-12 pb-14 sm:pt-20 sm:pb-24">
          <p className="inline-block rounded-full bg-gold px-3 py-1 text-sm font-extrabold text-red-dark">100% HALAL · NO ALCOHOL</p>
          <h1 className="mt-5 max-w-3xl font-display text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-7xl">
            Hamilton’s halal <span className="text-gold">Hakka</span>, made to order.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/90">
            Indo-Chinese Hakka and North Indian, wok-fired on York Blvd. Order direct — skip the app fees
            {ordering.pickup.discountEnabled && <> and save {pct}% on pickup</>}.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/menu"
              className="inline-flex min-h-14 items-center rounded-full bg-gold px-8 font-display text-xl font-extrabold text-red-dark shadow-lg hover:bg-gold-soft"
            >
              Order Now
            </Link>
            <p className="text-sm font-semibold text-white/90">
              Pickup in ~{ordering.pickup.readyMinutes} min · Delivery within {ordering.delivery.radiusKm} km
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12" aria-labelledby="combos-h">
        <div className="flex items-end justify-between gap-4">
          <h2 id="combos-h" className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Combos that feed you right
          </h2>
          <Link href="/menu#cat-combos" className="hidden min-h-12 items-center font-bold text-red underline underline-offset-4 sm:inline-flex">
            See all
          </Link>
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {combos.map((c) => (
            <li key={c.id}>
              <Link href="/menu#cat-combos" className="flex h-full flex-col rounded-3xl bg-red p-5 text-white hover:bg-red-dark">
                <span className="font-display text-2xl font-extrabold">{c.name}</span>
                <span className="mt-1 flex-1 text-sm text-white/90">{c.description}</span>
                <span className="mt-4 font-display text-3xl font-extrabold text-gold">{money(c.price ?? 0)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto grid max-w-6xl gap-3 px-4 sm:grid-cols-3">
        {[
          ["Order direct, pay less", "No app markups. Your money goes to a family kitchen, not a middleman."],
          ["Tiffin service", "Home-style meals, weekly or monthly.", "/tiffin"],
          ["Catering", "Trays sized by headcount. Halal, of course.", "/catering"],
        ].map(([t, d, href]) => (
          <div key={t} className="rounded-2xl border border-line bg-card p-5">
            <h3 className="font-display text-xl font-extrabold">{t}</h3>
            <p className="mt-1 text-muted">{d}</p>
            {href && (
              <Link href={href} className="mt-3 inline-flex min-h-12 items-center font-bold text-red underline underline-offset-4">
                Learn more
              </Link>
            )}
          </div>
        ))}
      </section>

      <p className="mx-auto mt-10 max-w-6xl px-4 text-muted">
        {site.address.street}, {site.address.city} — {site.address.crossStreets}
      </p>
    </>
  );
}
