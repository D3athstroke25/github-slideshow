#!/usr/bin/env node
// Checks data/menu.json for the kinds of errors the old site had.
// Run: npm run menu:check            (exits 1 on errors, prints warnings)
//      npm run menu:check -- --live  (also fails on active placeholder items — use before launch)
import { readFileSync } from "node:fs";

const path = new URL("../data/menu.json", import.meta.url);
const menu = JSON.parse(readFileSync(path, "utf8"));
const LIVE = process.argv.includes("--live");
const errors = [];
const warnings = [];
const cats = new Set(menu.categories.map((c) => c.id));
const groups = new Set(Object.keys(menu.optionGroups ?? {}));
const TYPOS = [
  [/\bpanner\b/i, "Paneer"],
  [/\babouts us\b/i, "About Us"],
];
const MAX_SINGLE_ITEM_CENTS = 10000; // $100 — above this on a non-combo item is suspicious

const seenIds = new Set();
const seenNames = new Map();
for (const it of menu.items) {
  const tag = `${it.id} (${it.name})`;
  if (seenIds.has(it.id)) errors.push(`${tag}: duplicate id`);
  seenIds.add(it.id);
  const key = it.name.trim().toLowerCase();
  if (seenNames.has(key)) errors.push(`${tag}: duplicate name (also ${seenNames.get(key)})`);
  seenNames.set(key, it.id);
  if (!cats.has(it.category)) errors.push(`${tag}: unknown category "${it.category}"`);
  for (const g of it.optionGroups ?? []) {
    if (!groups.has(g)) errors.push(`${tag}: unknown option group "${g}"`);
  }
  if (typeof it.active !== "boolean") errors.push(`${tag}: "active" must be true/false`);
  if (it.price != null && (!Number.isInteger(it.price) || it.price <= 0)) {
    errors.push(`${tag}: price must be positive integer cents`);
  }
  if (it.active && it.price == null) errors.push(`${tag}: active but has no price`);
  if (it.price != null && it.price > MAX_SINGLE_ITEM_CENTS && it.category !== "combos") {
    errors.push(`${tag}: suspicious price $${(it.price / 100).toFixed(2)}`);
  }
  for (const [re, fix] of TYPOS) {
    if (re.test(`${it.name} ${it.description ?? ""}`)) errors.push(`${tag}: typo — should be "${fix}"`);
  }
  for (const g of it.optionGroups ?? []) {
    for (const c of menu.optionGroups?.[g]?.choices ?? []) {
      if (!Number.isInteger(c.priceDelta)) errors.push(`${tag}: option "${g}/${c.id}" has no priceDelta`);
    }
    if (it.active && menu.optionGroups?.[g]?.placeholderPrices) {
      (LIVE ? errors : warnings).push(`${tag}: option group "${g}" has placeholder prices`);
    }
  }
  if (it.active && it.placeholder) (LIVE ? errors : warnings).push(`${tag}: PLACEHOLDER item (not a real dish/price)`);
  if (it.active && !it.image) warnings.push(`${tag}: no photo`);
  if (it.needsReview?.length) warnings.push(`${tag}: needs review — ${it.needsReview.join("; ")}`);
}

const active = menu.items.filter((i) => i.active).length;
const ph = menu.items.filter((i) => i.active && i.placeholder).length;
console.log(`${menu.items.length} items, ${active} active (target ~55), ${ph} placeholders${LIVE ? " [live mode]" : ""}`);
for (const w of warnings) console.log("  warn ", w);
for (const e of errors) console.log("  ERROR", e);
process.exit(errors.length ? 1 : 0);
