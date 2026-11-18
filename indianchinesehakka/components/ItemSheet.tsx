"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { defaultSelections, groupsFor, type MenuItem } from "@/lib/menu";
import { unitPrice, validateSelections, type Selections } from "@/lib/cart";
import { isItemAvailable } from "@/lib/hours";
import { money } from "@/lib/pricing";

/** Bottom sheet (full dialog on desktop) for choosing protein, spice, dry/gravy, add-ons. */
export function ItemSheet({ item, onClose }: { item: MenuItem | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { add } = useCart();
  const [sel, setSel] = useState<Selections>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (item) {
      setSel(defaultSelections(item));
      setQty(1);
      setNote("");
      setTried(false);
      if (!d.open) d.showModal();
    } else if (d.open) d.close();
  }, [item]);

  if (!item) return <dialog ref={ref} onClose={onClose} />;

  const groups = groupsFor(item);
  const error = validateSelections(item, sel);
  const available = isItemAvailable(item);
  const lineTotal = unitPrice(item, sel) * qty;

  const toggle = (groupId: string, choiceId: string, single: boolean, max: number) =>
    setSel((s) => {
      const cur = s[groupId] ?? [];
      if (single) return { ...s, [groupId]: [choiceId] };
      if (cur.includes(choiceId)) return { ...s, [groupId]: cur.filter((c) => c !== choiceId) };
      if (cur.length >= max) return s;
      return { ...s, [groupId]: [...cur, choiceId] };
    });

  const submit = () => {
    setTried(true);
    if (error || !available) return;
    add(item.id, sel, qty, note);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="sheet-title"
      className="animate-sheet m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-3xl bg-cream p-0 text-ink backdrop:bg-ink/70 sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-start gap-3 border-b border-line bg-card px-5 pt-5 pb-4">
          <div className="flex-1">
            <h2 id="sheet-title" className="font-display text-2xl font-extrabold leading-tight">
              {item.name}
            </h2>
            {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-cream text-2xl font-bold hover:bg-line"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {groups.map((g) => {
            const single = g.max === 1;
            const chosen = sel[g.id] ?? [];
            const missing = tried && g.required && chosen.length === 0;
            return (
              <fieldset key={g.id}>
                <legend className="mb-2 flex w-full items-baseline gap-2 font-display text-lg font-extrabold">
                  {g.name}
                  <span className={`text-xs font-bold uppercase ${missing ? "text-red" : "text-muted"}`}>
                    {g.required ? "Required" : `Optional · up to ${g.max}`}
                  </span>
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {g.choices.map((c) => {
                    const on = chosen.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-xl border-2 px-3 py-2 text-sm font-semibold ${
                          on ? "border-red bg-red text-white" : "border-line bg-card text-ink hover:border-red"
                        }`}
                      >
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={`${item.id}-${g.id}`}
                          checked={on}
                          onChange={() => toggle(g.id, c.id, single, g.max)}
                          className="sr-only"
                        />
                        <span>{c.name}</span>
                        {c.priceDelta > 0 && <span className={on ? "text-white" : "text-muted"}>+{money(c.priceDelta)}</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <label className="block">
            <span className="mb-2 block font-display text-lg font-extrabold">
              Special instructions <span className="text-xs font-bold uppercase text-muted">Optional</span>
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 140))}
              rows={2}
              placeholder="e.g. no onions"
              className="w-full rounded-xl border-2 border-line bg-card p-3 text-base placeholder:text-muted focus:border-red focus:outline-none"
            />
          </label>
        </div>

        <div className="flex items-center gap-3 border-t border-line bg-card px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center rounded-full border-2 border-line">
            <button
              type="button"
              className="size-12 text-2xl font-bold disabled:text-line"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-6 text-center font-bold" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              className="size-12 text-2xl font-bold"
              onClick={() => setQty((q) => Math.min(99, q + 1))}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!available}
            className="flex min-h-14 flex-1 items-center justify-between rounded-full bg-red px-5 font-display text-lg font-extrabold text-white hover:bg-red-dark disabled:bg-muted"
          >
            <span>{!available ? "Not available now" : tried && error ? error : "Add to order"}</span>
            {available && <span>{money(lineTotal)}</span>}
          </button>
        </div>
      </div>
    </dialog>
  );
}
