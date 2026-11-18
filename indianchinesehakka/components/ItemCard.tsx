"use client";

import { useCart } from "@/components/CartProvider";
import { defaultSelections, fromPrice, isOneTap, type MenuItem } from "@/lib/menu";
import { formatWindow, isItemAvailable } from "@/lib/hours";
import { money } from "@/lib/pricing";

type Props = {
  item: MenuItem;
  onOpen: (item: MenuItem) => void;
  variant?: "default" | "combo";
  now: Date | null;
};

export function ItemCard({ item, onOpen, variant = "default", now }: Props) {
  const { add } = useCart();
  const { cents, varies } = fromPrice(item);
  // `now` is null until mounted, so server and first client render agree.
  const available = now ? isItemAvailable(item, now) : true;
  const oneTap = isOneTap(item);
  const combo = variant === "combo";

  const onAdd = () => {
    if (oneTap) add(item.id, defaultSelections(item));
    else onOpen(item);
  };

  return (
    <article
      className={
        combo
          ? "flex min-w-[17rem] snap-start flex-col rounded-3xl bg-red p-5 text-white shadow-lg sm:min-w-0"
          : "flex flex-col rounded-2xl border border-line bg-card p-4 shadow-sm"
      }
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex-1 text-left"
        aria-label={`${item.name}, ${money(cents)} — see options`}
      >
        <h3 className={`font-display font-extrabold leading-tight ${combo ? "text-2xl" : "text-lg"}`}>
          {item.name}
          {item.vegetarian && (
            <span className="ml-2 inline-block rounded-md border border-veg px-1.5 align-middle text-xs font-bold text-veg">
              VEG
            </span>
          )}
        </h3>
        {item.description && (
          <p className={`mt-1 line-clamp-2 text-sm ${combo ? "text-white/90" : "text-muted"}`}>{item.description}</p>
        )}
        {item.availableHours && (
          <p className={`mt-2 text-sm font-semibold ${combo ? "text-white" : "text-red"}`}>
            {formatWindow(item.availableHours)} only
          </p>
        )}
      </button>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className={`font-display font-extrabold ${combo ? "text-3xl text-gold" : "text-lg"}`}>
          {varies && <span className={`mr-1 text-sm font-semibold ${combo ? "text-white" : "text-muted"}`}>from</span>}
          {money(cents)}
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={!available}
          className={
            combo
              ? "min-h-12 rounded-full bg-white px-6 font-display font-extrabold text-red hover:bg-gold-soft disabled:bg-white/60"
              : "min-h-12 rounded-full bg-red px-6 font-display font-extrabold text-white hover:bg-red-dark disabled:bg-muted"
          }
          aria-label={available ? `Add ${item.name}` : `${item.name} unavailable right now`}
        >
          {available ? (oneTap ? "Add" : "Choose") : "Not now"}
        </button>
      </div>
    </article>
  );
}
