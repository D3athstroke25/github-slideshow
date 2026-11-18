// Business + ordering rules. Edit here; everything else reads from this file.
// Values in [BRACKETS] are placeholders you still need to fill in.
export const site = {
  name: "Indian Chinese Halal Hakka",
  domain: "indianchinesehakka.ca",
  title: "Halal Hakka & Indian Food in Hamilton | Order Direct",
  address: {
    street: "239 York Blvd",
    city: "Hamilton",
    region: "ON",
    postalCode: "[POSTAL CODE]",
    country: "CA",
    crossStreets: "York Blvd & Hess St N",
    lat: null as number | null, // needed for the 8 km delivery radius
    lng: null as number | null,
  },
  phone: "[PHONE]",
  email: "[EMAIL]",
  timezone: "America/Toronto",
  // 0 = Sunday. null = closed that day. Fill in from [HOURS].
  hours: {
    0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null,
  } as Record<number, { open: string; close: string } | null>,
  cuisine: ["Indo-Chinese", "Hakka", "North Indian"],
  halal: true,
  alcohol: false,
} as const;

export const ordering = {
  hstRate: 0.13,
  pickup: { readyMinutes: 20, discountEnabled: true, discountRate: 0.1 },
  delivery: {
    customerFeeCents: 499,
    minimumCents: 3000,
    freeOverCents: 6000,
    radiusKm: 8,
    stubCostCents: 1000, // used when Uber Direct keys are missing
  },
  scheduledOrders: true,
  // Open questions — see FIXES.md
  // - Does the 10% pickup discount apply to combos / the lunch special?
  // - "Free over $60": before or after the pickup discount / tax? (assumed: food subtotal, before tax)
} as const;
