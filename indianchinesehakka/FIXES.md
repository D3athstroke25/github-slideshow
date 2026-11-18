# FIXES — for your approval

Tick each box (or reply with changes) and I'll apply it.

## 0. BLOCKER — the old site could not be imported

On 2026-11-15, `https://indianchinesehakka.ca` did **not** serve a restaurant site:

| URL | Result |
|---|---|
| `/` | HTTP 403, empty page that loads a **domain-parking script** (`sk-jspark_init` from `cdn.jsinit.directfwd.com`) |
| `/takeout-menu` | HTTP 404 (same parking shell) |
| `/tiffin-menu` | HTTP 404 (same parking shell) |

A real browser got the same result. The domain looks **parked or lapsed**, or it is behind a Cloudflare block that refuses non-visitor traffic.

- [ ] **Check the domain right away.** Log in to your registrar and confirm `indianchinesehakka.ca` is still registered to you, set to auto-renew, and that DNS points where you expect. If it has lapsed, renew it before anything else. The "keep the same domain" plan depends on it.
- [ ] **Send me the menu another way**, whichever is easiest:
  - a copy-paste of the menu text,
  - photos or a PDF of the printed takeout and tiffin menus,
  - your Square item library export (Items → Export, CSV). This is the best option because item IDs will then match your POS.
  - your Uber Eats menu link (I'll need network access to it).

Until then, `data/menu.json` holds **only what you gave me in the brief**. I have not invented any items or prices.

## 1. Known errors from your brief (applied in the seed)

- [x] Mango Juice $400 → `price: null` ([PRICE]), hidden (`active: false`) until you set it.
- [x] Duplicate Lamb Biryani → one item, $16.99.
- [x] Honey Chili Potato, Chana Bhatura, Samosa Chaat → old photos dropped (`image: null`). They need real photos and are hidden until they have prices.
- [x] "Abouts US" → "About Us" (new nav uses "About").
- [x] "Panner" → "Paneer". `npm run menu:check` now fails on "Panner".
- [x] Copyright year → computed at render time (`new Date().getFullYear()`), never hard-coded.
- [ ] Featured dishes with no price → **I need the list of featured dishes and their prices.** The new site will not show any item without a price (the validator blocks it).

## 2. Info I need to go live

- [ ] Phone number
- [ ] Opening hours, per day. Also: when do you stop taking orders before close?
- [ ] Postal code for 239 York Blvd (for the JSON-LD and the delivery-radius centre)
- [ ] Contact email for receipts and the catering/tiffin forms
- [ ] Real food photos. The owner's own photos are best; I can use tasteful placeholders until then.

## 3. Menu decisions

- [ ] **Hakka Combo** ($19.99): which dry Hakka dishes are allowed? Is there an upcharge for Shrimp or Paneer? Which pop flavours?
- [ ] **Curry Combo** ($18.99): which curries? Plain or butter naan?
- [ ] **Lunch Special** ($12.99, 12–3 pm): what's in it? Weekdays only?
- [ ] **Family Combo for 4** ($59.99): what's in it?
- [ ] **Protein pricing**: is Veg / Chicken / Shrimp / Paneer one price, or are there upcharges?
- [ ] **Add-ons**: the list and prices (e.g. extra rice, naan, raita, egg).
- [ ] The cut to ~55 items: send your keep list, or I'll propose one once the full menu is in.

## 4. Ordering-rule questions (my default in brackets)

- [ ] Does the 10% pickup discount apply to combos and the Lunch Special? [yes]
- [ ] "Free delivery over $60": measured on the food subtotal before tax? [yes]
- [ ] If the Uber Direct cost exceeds the $4.99 fee, you absorb the difference? [yes, as briefed]
- [ ] Scheduled orders: how many days ahead? [same day + next 2 days, in 15-min slots]
- [ ] Tipping at checkout? [optional: 0 / 10 / 15 / 18%]

## 5. Stage 2 decisions to confirm

- [ ] **Sample menu.** 31 placeholder dishes (`"placeholder": true`) let us build and test ordering. A yellow "sample menu" banner shows site-wide until every active item is real. `npm run menu:check -- --live` fails while any placeholder is active, so it can't go live by accident.
- [ ] **Placeholder upcharges**: Chicken +$2, Shrimp +$4, Paneer +$2, Chicken momos +$1; add-ons rice $3, naan $2.50, raita $2, egg $1.50. These are not real prices; please replace them.
- [ ] **Combos are first** in both the pills and the page, then Best Sellers. Your brief put the combos at the top but listed Best Sellers first among the pills; I kept the two orders matching so the highlighted pill follows the scroll.
- [ ] **Spice defaults to Medium**, so curries, biryani and tandoor items are one-tap Add. Tapping the dish name still opens the options. Hakka dishes always open the sheet, because protein and Dry/Gravy must be chosen.
- [ ] **Delivery fee is taxed** (HST on food − discount + delivery fee), as Ontario requires for delivery charges.
