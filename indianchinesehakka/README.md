# indianchinesehakka.ca — Indian Chinese Halal Hakka

Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel. Direct online ordering with Square.

> **Status: Stage 2 of 6 (menu & cart) on a SAMPLE menu.** The old site could not be imported (see [FIXES.md](./FIXES.md) §0). Items marked `"placeholder": true` are stand-ins.
> Later stages (menu & cart → checkout → tiffin/catering → design → SEO) will fill in this README: Square and Uber Direct keys, Vercel deploy, and pointing the domain.

## Editing the menu

Everything is in `data/menu.json`.

- `price` is in **cents** (`1699` = $16.99). `null` means no price yet; such an item can't be active.
- `active: false` hides an item without deleting it.
- `optionGroups` lists choices (protein, spice, dry/gravy…) by ID; the groups are defined at the top of the file.
- `bestSeller: true` also shows the item under Best Sellers.

After editing, run:

```bash
npm run menu:check
```

It fails on missing prices, duplicates, suspicious prices (> $100), unknown categories and known typos ("Panner").
Before launch, run `npm run menu:check -- --live`; it also fails while any placeholder item or placeholder option price is active.

## Business settings

Hours, phone, address and ordering rules (HST, pickup discount, delivery fee/minimum/radius) are in `config/site.ts`.

## Dev

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # pricing, cart, lunch-window tests
npm run lint
npm run build
```
