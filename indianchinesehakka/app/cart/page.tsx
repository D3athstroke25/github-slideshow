"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { getItem } from "@/lib/menu";
import { describeSelections, unitPrice } from "@/lib/cart";
import { money, type Fulfillment } from "@/lib/pricing";
import { ordering } from "@/config/site";

export default function CartPage() {
  const { lines, hydrated, totals, fulfillment, setFulfillment, setQty } = useCart();
  const pct = Math.round(ordering.pickup.discountRate * 100);

  if (!hydrated) return <div className="mx-auto max-w-2xl px-4 py-10" aria-busy="true" />;

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold">Your order is empty</h1>
        <p className="mt-2 text-muted">Hungry? The chilli chicken is calling.</p>
        <Link
          href="/menu"
          className="mt-6 inline-flex min-h-14 items-center rounded-full bg-red px-8 font-display text-lg font-extrabold text-white hover:bg-red-dark"
        >
          Order Now
        </Link>
      </div>
    );
  }

  const options: { id: Fulfillment; label: string; sub: string }[] = [
    {
      id: "pickup",
      label: "Pickup",
      sub: `Ready in ~${ordering.pickup.readyMinutes} min${ordering.pickup.discountEnabled ? ` · save ${pct}%` : ""}`,
    },
    {
      id: "delivery",
      label: "Delivery",
      sub: `${money(ordering.delivery.customerFeeCents)} · free over ${money(ordering.delivery.freeOverCents)}`,
    },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-3xl font-extrabold">Your order</h1>

      <fieldset className="mt-5">
        <legend className="sr-only">Pickup or delivery</legend>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-line p-1">
          {options.map((o) => {
            const on = fulfillment === o.id;
            return (
              <label
                key={o.id}
                className={`flex min-h-16 cursor-pointer flex-col justify-center rounded-xl px-3 py-2 text-center ${
                  on ? "bg-red text-white shadow" : "text-ink hover:bg-card"
                }`}
              >
                <input type="radio" name="fulfillment" className="sr-only" checked={on} onChange={() => setFulfillment(o.id)} />
                <span className="font-display text-lg font-extrabold">{o.label}</span>
                <span className={`text-xs font-semibold ${on ? "text-white" : "text-muted"}`}>{o.sub}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-card">
        {lines.map((l) => {
          const item = getItem(l.itemId);
          if (!item) return null;
          const opts = describeSelections(item, l.selections);
          return (
            <li key={l.key} className="flex gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-display font-extrabold">{item.name}</p>
                {opts && <p className="text-sm text-muted">{opts}</p>}
                {l.note && <p className="text-sm text-muted italic">“{l.note}”</p>}
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    className="grid size-12 place-items-center rounded-full border-2 border-line text-xl font-bold"
                    onClick={() => setQty(l.key, l.qty - 1)}
                    aria-label={l.qty === 1 ? `Remove ${item.name}` : `One less ${item.name}`}
                  >
                    {l.qty === 1 ? (
                      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      "−"
                    )}
                  </button>
                  <span className="w-8 text-center font-bold">{l.qty}</span>
                  <button
                    type="button"
                    className="grid size-12 place-items-center rounded-full border-2 border-line text-xl font-bold"
                    onClick={() => setQty(l.key, l.qty + 1)}
                    aria-label={`One more ${item.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
              <p className="font-bold">{money(unitPrice(item, l.selections) * l.qty)}</p>
            </li>
          );
        })}
      </ul>

      <Link href="/menu" className="mt-3 inline-flex min-h-12 items-center font-semibold text-red underline underline-offset-4">
        + Add more items
      </Link>

      <dl className="mt-4 space-y-2 rounded-2xl border border-line bg-card p-4">
        <Row label="Subtotal" value={money(totals.subtotal)} />
        {totals.discount > 0 && <Row label={`Pickup discount (${pct}%)`} value={`−${money(totals.discount)}`} accent />}
        {fulfillment === "delivery" && (
          <Row label="Delivery" value={totals.deliveryFee ? money(totals.deliveryFee) : "FREE"} accent={!totals.deliveryFee} />
        )}
        <Row label="HST (13%)" value={money(totals.tax)} />
        <div className="flex justify-between border-t border-line pt-3 font-display text-xl font-extrabold">
          <dt>Total</dt>
          <dd>{money(totals.total)}</dd>
        </div>
      </dl>

      {totals.belowMinimumBy > 0 && (
        <p role="status" className="mt-3 rounded-xl bg-gold-soft p-3 text-sm font-semibold">
          Delivery minimum is {money(ordering.delivery.minimumCents)} — add {money(totals.belowMinimumBy)} more, or switch to pickup.
        </p>
      )}
      {totals.belowMinimumBy === 0 && totals.toFreeDelivery > 0 && (
        <p role="status" className="mt-3 rounded-xl bg-gold-soft p-3 text-sm font-semibold">
          Add {money(totals.toFreeDelivery)} more for free delivery.
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 mt-6 bg-cream/95 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          disabled
          className="flex min-h-14 w-full items-center justify-between rounded-full bg-red px-6 font-display text-lg font-extrabold text-white disabled:bg-muted"
          aria-describedby="checkout-note"
        >
          <span>Checkout</span>
          <span>{money(totals.total)}</span>
        </button>
        <p id="checkout-note" className="mt-2 text-center text-sm text-muted">
          Online payment arrives in the next build stage.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={accent ? "font-bold text-veg" : "font-semibold"}>{value}</dd>
    </div>
  );
}
