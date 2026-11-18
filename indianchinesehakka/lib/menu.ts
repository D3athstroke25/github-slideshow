import raw from "@/data/menu.json";

export type Choice = { id: string; name: string; priceDelta: number };
export type OptionGroup = {
  id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
  default?: string;
  choices: Choice[];
};
export type MenuItem = {
  id: string;
  name: string;
  category: string;
  active: boolean;
  placeholder?: boolean;
  description: string;
  price: number | null;
  image: string | null;
  bestSeller?: boolean;
  vegetarian?: boolean;
  optionGroups?: string[];
  availableHours?: { start: string; end: string };
};
export type Category = { id: string; name: string };

type RawMenu = {
  categories: Category[];
  optionGroups: Record<string, Omit<OptionGroup, "id">>;
  items: MenuItem[];
};
const menu = raw as unknown as RawMenu;

export const categories: Category[] = menu.categories;

export const optionGroups: Record<string, OptionGroup> = Object.fromEntries(
  Object.entries(menu.optionGroups).map(([id, g]) => [id, { id, ...g }]),
);

/** Items a customer can see and order: active and priced. */
export const items: MenuItem[] = menu.items.filter((i) => i.active && i.price != null);

export const hasPlaceholders = items.some((i) => i.placeholder);

export function getItem(id: string): MenuItem | undefined {
  return items.find((i) => i.id === id);
}

export function groupsFor(item: MenuItem): OptionGroup[] {
  return (item.optionGroups ?? []).map((g) => optionGroups[g]).filter(Boolean);
}

/** True when tapping "Add" can add the item straight away (every required group has a default or a single choice). */
export function isOneTap(item: MenuItem): boolean {
  return groupsFor(item).every((g) => !g.required || g.default != null || g.choices.length === 1);
}

/** Default selections: the group's default, or its only choice. */
export function defaultSelections(item: MenuItem): Record<string, string[]> {
  const sel: Record<string, string[]> = {};
  for (const g of groupsFor(item)) {
    if (g.default) sel[g.id] = [g.default];
    else if (g.required && g.choices.length === 1) sel[g.id] = [g.choices[0].id];
    else sel[g.id] = [];
  }
  return sel;
}

/** Lowest possible price (base + cheapest required choices), for "from $X" labels. */
export function fromPrice(item: MenuItem): { cents: number; varies: boolean } {
  let cents = item.price ?? 0;
  let varies = false;
  for (const g of groupsFor(item)) {
    const deltas = g.choices.map((c) => c.priceDelta);
    if (new Set(deltas).size > 1) varies = true;
    if (g.required) cents += Math.min(...deltas);
  }
  return { cents, varies };
}

export function sectionsInOrder(): { category: Category; items: MenuItem[] }[] {
  return categories
    .map((category) => ({
      category,
      items:
        category.id === "best-sellers"
          ? items.filter((i) => i.bestSeller && i.category !== "combos")
          : items.filter((i) => i.category === category.id),
    }))
    .filter((s) => s.items.length > 0);
}
