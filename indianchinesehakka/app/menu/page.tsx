import type { Metadata } from "next";
import { MenuBrowser } from "@/components/MenuBrowser";
import { ordering } from "@/config/site";

export const metadata: Metadata = {
  title: "Menu — Order Online",
  description: "Hakka chilli, Manchurian, noodles, momos, biryani and curries. 100% halal. Order direct for pickup or delivery in Hamilton.",
};

export default function MenuPage() {
  const pct = Math.round(ordering.pickup.discountRate * 100);
  return (
    <>
      <div className="bg-red text-white">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Order Online</h1>
          <p className="mt-1 font-semibold">
            {ordering.pickup.discountEnabled && <>Pickup saves {pct}% · </>}Ready in ~{ordering.pickup.readyMinutes} min · 100% halal
          </p>
        </div>
      </div>
      <MenuBrowser />
    </>
  );
}
