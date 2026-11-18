"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { ItemCard } from "@/components/ItemCard";
import { ItemSheet } from "@/components/ItemSheet";
import { categories, groupsFor, items, sectionsInOrder, type MenuItem } from "@/lib/menu";

const sections = sectionsInOrder();
const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));

/** 2 = name/description/category match, 1 = only an option matches (e.g. "paneer" → Chilli w/ Paneer), 0 = none. */
function score(item: MenuItem, q: string): number {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const main = `${item.name} ${item.description} ${catName[item.category] ?? ""}`.toLowerCase();
  if (words.every((w) => main.includes(w))) return 2;
  const opts = groupsFor(item).flatMap((g) => g.choices.map((c) => c.name)).join(" ").toLowerCase();
  return words.every((w) => main.includes(w) || opts.includes(w)) ? 1 : 0;
}

export function MenuBrowser() {
  const [open, setOpen] = useState<MenuItem | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(sections[0]?.category.id);
  const [now, setNow] = useState<Date | null>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const { lastOrder, reorder, hydrated } = useCart();

  // Re-evaluate time-windowed items (lunch special) every minute.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Highlight the pill for the section in view.
  useEffect(() => {
    if (query) return;
    const els = sections.map((s) => document.getElementById(`cat-${s.category.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("cat-", ""));
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [query]);

  useEffect(() => {
    const pill = pillsRef.current?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    pill?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return items
      .map((item) => ({ item, s: score(item, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.item);
  }, [query]);

  return (
    <>
      <div className="sticky top-16 z-20 border-b border-line bg-cream/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <label className="relative block">
            <span className="sr-only">Search the menu</span>
            <svg aria-hidden className="absolute top-1/2 left-4 -translate-y-1/2 text-muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — try “chilli”, “biryani”, “paneer”"
              className="min-h-12 w-full rounded-full border-2 border-line bg-card pr-4 pl-12 text-base placeholder:text-muted focus:border-red focus:outline-none"
            />
          </label>
        </div>
        {!query && (
          <nav aria-label="Menu categories">
            <div ref={pillsRef} className="no-scrollbar mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3">
              {sections.map(({ category }) => {
                const on = active === category.id;
                return (
                  <a
                    key={category.id}
                    href={`#cat-${category.id}`}
                    data-cat={category.id}
                    aria-current={on ? "true" : undefined}
                    className={`flex min-h-12 shrink-0 items-center rounded-full px-4 text-sm font-bold whitespace-nowrap ${
                      on ? "bg-red text-white" : "border-2 border-line bg-card text-ink hover:border-red"
                    }`}
                  >
                    {category.name}
                  </a>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      <div className="mx-auto max-w-6xl px-4">
        {hydrated && lastOrder.length > 0 && !query && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border-2 border-gold bg-gold-soft p-4">
            <p className="font-semibold">
              <span className="block font-display text-lg font-extrabold">Welcome back!</span>
              Same as last time?
            </p>
            <button
              type="button"
              onClick={reorder}
              className="min-h-12 rounded-full bg-red px-5 font-display font-extrabold text-white hover:bg-red-dark"
            >
              Order again
            </button>
          </div>
        )}

        {query ? (
          <section className="py-6" aria-live="polite">
            <h2 className="mb-4 font-display text-2xl font-extrabold">
              {results.length} result{results.length === 1 ? "" : "s"} for “{query.trim()}”
            </h2>
            {results.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((i) => (
                  <ItemCard key={i.id} item={i} onOpen={setOpen} now={now} />
                ))}
              </div>
            ) : (
              <p className="text-muted">Nothing matched. Try a shorter word, or browse the categories.</p>
            )}
          </section>
        ) : (
          sections.map(({ category, items: list }) => (
            <section key={category.id} id={`cat-${category.id}`} className="pt-8" aria-labelledby={`h-${category.id}`}>
              <h2 id={`h-${category.id}`} className="mb-4 font-display text-3xl font-extrabold tracking-tight">
                {category.name}
              </h2>
              {category.id === "combos" ? (
                <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
                  {list.map((i) => (
                    <ItemCard key={i.id} item={i} onOpen={setOpen} variant="combo" now={now} />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((i) => (
                    <ItemCard key={i.id} item={i} onOpen={setOpen} now={now} />
                  ))}
                </div>
              )}
            </section>
          ))
        )}
      </div>

      <ItemSheet item={open} onClose={() => setOpen(null)} />
    </>
  );
}
