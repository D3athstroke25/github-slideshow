import { ordering } from "@/config/site";

export type Fulfillment = "pickup" | "delivery";

export type PriceLine = { unitCents: number; qty: number };

export type Totals = {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
  /** Food subtotal still needed to reach the delivery minimum (0 when met or pickup). */
  belowMinimumBy: number;
  /** Food subtotal still needed for free delivery (0 when already free or pickup). */
  toFreeDelivery: number;
  canCheckout: boolean;
};

type Rules = typeof ordering;

/**
 * All money is integer cents. Rules:
 * - Pickup: optional % discount on the food subtotal.
 * - Delivery: flat customer fee, waived when food subtotal ≥ freeOver; minimum food subtotal.
 * - HST applies to (food − discount + delivery fee); delivery fees are taxable in Ontario.
 */
export function computeTotals(lines: PriceLine[], fulfillment: Fulfillment, rules: Rules = ordering): Totals {
  const subtotal = lines.reduce((s, l) => s + l.unitCents * l.qty, 0);
  const isPickup = fulfillment === "pickup";
  const discount =
    isPickup && rules.pickup.discountEnabled ? Math.round(subtotal * rules.pickup.discountRate) : 0;

  const d = rules.delivery;
  const deliveryFee = !isPickup && subtotal > 0 && subtotal < d.freeOverCents ? d.customerFeeCents : 0;
  const belowMinimumBy = !isPickup ? Math.max(0, d.minimumCents - subtotal) : 0;
  const toFreeDelivery = !isPickup && deliveryFee > 0 ? d.freeOverCents - subtotal : 0;

  const tax = Math.round((subtotal - discount + deliveryFee) * rules.hstRate);
  const total = subtotal - discount + deliveryFee + tax;

  return {
    subtotal,
    discount,
    deliveryFee,
    tax,
    total,
    belowMinimumBy,
    toFreeDelivery,
    canCheckout: subtotal > 0 && belowMinimumBy === 0,
  };
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
