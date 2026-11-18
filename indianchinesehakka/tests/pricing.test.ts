import { describe, expect, it } from "vitest";
import { computeTotals } from "@/lib/pricing";
import { lineKey, unitPrice, validateSelections } from "@/lib/cart";
import { formatWindow, isItemAvailable } from "@/lib/hours";
import { getItem, isOneTap } from "@/lib/menu";

const line = (unitCents: number, qty = 1) => ({ unitCents, qty });

describe("computeTotals", () => {
  it("pickup: 10% discount, HST on discounted subtotal", () => {
    const t = computeTotals([line(2000)], "pickup");
    expect(t.discount).toBe(200);
    expect(t.deliveryFee).toBe(0);
    expect(t.tax).toBe(234); // 1800 * 0.13
    expect(t.total).toBe(2034);
    expect(t.canCheckout).toBe(true);
  });

  it("delivery under minimum cannot check out", () => {
    const t = computeTotals([line(2500)], "delivery");
    expect(t.belowMinimumBy).toBe(500);
    expect(t.canCheckout).toBe(false);
  });

  it("delivery $30–$60 charges $4.99, taxed", () => {
    const t = computeTotals([line(3000)], "delivery");
    expect(t.discount).toBe(0);
    expect(t.deliveryFee).toBe(499);
    expect(t.tax).toBe(Math.round(3499 * 0.13));
    expect(t.toFreeDelivery).toBe(3000);
    expect(t.canCheckout).toBe(true);
  });

  it("delivery is free at exactly $60", () => {
    const t = computeTotals([line(3000, 2)], "delivery");
    expect(t.deliveryFee).toBe(0);
    expect(t.toFreeDelivery).toBe(0);
  });

  it("empty cart cannot check out", () => {
    expect(computeTotals([], "pickup").canCheckout).toBe(false);
  });
});

describe("cart helpers", () => {
  it("line key is order-independent", () => {
    expect(lineKey("x", { a: ["1"], b: ["2", "3"] })).toBe(lineKey("x", { b: ["3", "2"], a: ["1"] }));
  });

  it("protein upcharge applies", () => {
    const chilli = getItem("chilli")!;
    expect(unitPrice(chilli, { protein: ["shrimp"] })).toBe((chilli.price ?? 0) + 400);
  });

  it("required groups without default must be chosen", () => {
    const chilli = getItem("chilli")!;
    expect(isOneTap(chilli)).toBe(false);
    expect(validateSelections(chilli, { protein: [], style: ["dry"], spice: ["hot"], addons: [] })).toMatch(/protein/i);
    expect(validateSelections(chilli, { protein: ["veg"], style: ["dry"], spice: ["hot"], addons: [] })).toBeNull();
  });

  it("items with only defaulted options are one-tap", () => {
    expect(isOneTap(getItem("butter-chicken")!)).toBe(true);
    expect(isOneTap(getItem("garlic-naan")!)).toBe(true);
  });
});

describe("lunch special window (Toronto time)", () => {
  const lunch = getItem("lunch-special")!;
  it("available at 12:30 pm, not at 3:00 pm", () => {
    expect(isItemAvailable(lunch, new Date("2026-11-18T17:30:00Z"))).toBe(true); // 12:30 EST
    expect(isItemAvailable(lunch, new Date("2026-11-18T20:00:00Z"))).toBe(false); // 3:00 pm EST
    expect(isItemAvailable(lunch, new Date("2026-11-18T16:59:00Z"))).toBe(false); // 11:59 am EST
  });
  it("formats the window", () => {
    expect(formatWindow({ start: "12:00", end: "15:00" })).toBe("12–3 pm");
  });
});
