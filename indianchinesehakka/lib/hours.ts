import { site } from "@/config/site";
import type { MenuItem } from "@/lib/menu";

/** Minutes since local midnight in the restaurant's time zone. */
export function restaurantMinutes(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: site.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Time-windowed items (e.g. Lunch Special 12–3 pm). Items without a window are always available. */
export function isItemAvailable(item: MenuItem, at: Date = new Date()): boolean {
  if (!item.availableHours) return true;
  const now = restaurantMinutes(at);
  return now >= toMin(item.availableHours.start) && now < toMin(item.availableHours.end);
}

export function formatWindow(w: { start: string; end: string }): string {
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const h12 = ((h + 11) % 12) + 1;
    return m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`;
  };
  const suffix = (hhmm: string) => (Number(hhmm.split(":")[0]) < 12 ? "am" : "pm");
  return `${fmt(w.start)}–${fmt(w.end)} ${suffix(w.end)}`;
}
