import { hasPlaceholders } from "@/lib/menu";

/** Shown until every active item in menu.json is real (placeholder !== true). */
export function PlaceholderBanner() {
  if (!hasPlaceholders) return null;
  return (
    <div role="note" className="bg-gold-soft px-4 py-2 text-center text-sm font-semibold text-ink">
      Preview: sample menu — dishes and prices are placeholders, not the real menu.
    </div>
  );
}
