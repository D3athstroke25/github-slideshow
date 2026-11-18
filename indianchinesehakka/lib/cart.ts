import { getItem, groupsFor, type MenuItem } from "@/lib/menu";

export type Selections = Record<string, string[]>; // optionGroupId -> choiceIds

export type CartLine = {
  key: string;
  itemId: string;
  selections: Selections;
  qty: number;
  note?: string;
};

/** Same item + same options + same note = same line (quantities merge). */
export function lineKey(itemId: string, selections: Selections, note = ""): string {
  const sel = Object.keys(selections)
    .sort()
    .map((g) => `${g}=${[...selections[g]].sort().join("+")}`)
    .join("&");
  return `${itemId}?${sel}#${note.trim().toLowerCase()}`;
}

export function unitPrice(item: MenuItem, selections: Selections): number {
  let cents = item.price ?? 0;
  for (const g of groupsFor(item)) {
    for (const id of selections[g.id] ?? []) {
      cents += g.choices.find((c) => c.id === id)?.priceDelta ?? 0;
    }
  }
  return cents;
}

/** Human summary of the chosen options, e.g. "Chicken · Dry · Hot". */
export function describeSelections(item: MenuItem, selections: Selections): string {
  return groupsFor(item)
    .flatMap((g) => (selections[g.id] ?? []).map((id) => g.choices.find((c) => c.id === id)?.name))
    .filter(Boolean)
    .join(" · ");
}

/** Validates selections against the menu; returns an error message or null. */
export function validateSelections(item: MenuItem, selections: Selections): string | null {
  for (const g of groupsFor(item)) {
    const chosen = selections[g.id] ?? [];
    if (chosen.some((id) => !g.choices.some((c) => c.id === id))) return `${g.name}: invalid choice`;
    if (g.required && chosen.length < Math.max(1, g.min)) return `Choose ${g.name.toLowerCase()}`;
    if (chosen.length > g.max) return `${g.name}: pick at most ${g.max}`;
  }
  return null;
}

/** Drop lines whose item was hidden/removed or whose options no longer validate (menu edited since). */
export function sanitizeLines(lines: CartLine[]): CartLine[] {
  return lines.filter((l) => {
    const item = getItem(l.itemId);
    return item && l.qty > 0 && !validateSelections(item, l.selections);
  });
}
