"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getItem } from "@/lib/menu";
import { lineKey, sanitizeLines, unitPrice, type CartLine, type Selections } from "@/lib/cart";
import { computeTotals, type Fulfillment, type Totals } from "@/lib/pricing";
import { readJSON, writeJSON } from "@/lib/storage";

const CART_KEY = "ichh.cart.v1";
const LAST_ORDER_KEY = "ichh.lastOrder.v1";

type CartState = { lines: CartLine[]; fulfillment: Fulfillment };

type CartApi = {
  lines: CartLine[];
  fulfillment: Fulfillment;
  count: number;
  totals: Totals;
  hydrated: boolean;
  lastOrder: CartLine[];
  add: (itemId: string, selections: Selections, qty?: number, note?: string) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  setFulfillment: (f: Fulfillment) => void;
  reorder: () => number;
  /** Call after a successful payment (stage 3) so "Order again" can offer it. */
  saveLastOrder: () => void;
  lastAdded: { name: string; at: number } | null;
};

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>({ lines: [], fulfillment: "pickup" });
  const [lastOrder, setLastOrder] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [lastAdded, setLastAdded] = useState<CartApi["lastAdded"]>(null);

  useEffect(() => {
    const saved = readJSON<CartState>(CART_KEY, { lines: [], fulfillment: "pickup" });
    setState({
      lines: sanitizeLines(Array.isArray(saved.lines) ? saved.lines : []),
      fulfillment: saved.fulfillment === "delivery" ? "delivery" : "pickup",
    });
    setLastOrder(sanitizeLines(readJSON<CartLine[]>(LAST_ORDER_KEY, [])));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJSON(CART_KEY, state);
  }, [state, hydrated]);

  const add = useCallback<CartApi["add"]>((itemId, selections, qty = 1, note = "") => {
    const key = lineKey(itemId, selections, note);
    setState((s) => {
      const existing = s.lines.find((l) => l.key === key);
      const lines = existing
        ? s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + qty) } : l))
        : [...s.lines, { key, itemId, selections, qty, note: note.trim() || undefined }];
      return { ...s, lines };
    });
    setLastAdded({ name: getItem(itemId)?.name ?? "Item", at: Date.now() });
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setState((s) => ({
      ...s,
      lines:
        qty <= 0
          ? s.lines.filter((l) => l.key !== key)
          : s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l)),
    }));
  }, []);

  const remove = useCallback((key: string) => setQty(key, 0), [setQty]);
  const clear = useCallback(() => setState((s) => ({ ...s, lines: [] })), []);
  const setFulfillment = useCallback((fulfillment: Fulfillment) => setState((s) => ({ ...s, fulfillment })), []);

  const reorder = useCallback(() => {
    const valid = sanitizeLines(lastOrder);
    valid.forEach((l) => add(l.itemId, l.selections, l.qty, l.note));
    return valid.length;
  }, [lastOrder, add]);

  const saveLastOrder = useCallback(() => {
    writeJSON(LAST_ORDER_KEY, state.lines);
    setLastOrder(state.lines);
  }, [state.lines]);

  const api = useMemo<CartApi>(() => {
    const priced = state.lines.map((l) => {
      const item = getItem(l.itemId);
      return { unitCents: item ? unitPrice(item, l.selections) : 0, qty: l.qty };
    });
    return {
      ...state,
      count: state.lines.reduce((n, l) => n + l.qty, 0),
      totals: computeTotals(priced, state.fulfillment),
      hydrated,
      lastOrder,
      add,
      setQty,
      remove,
      clear,
      setFulfillment,
      reorder,
      saveLastOrder,
      lastAdded,
    };
  }, [state, hydrated, lastOrder, add, setQty, remove, clear, setFulfillment, reorder, saveLastOrder, lastAdded]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCart must be used inside <CartProvider>");
  return v;
}
