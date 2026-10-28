/** Every tool, for the /tools page, the footer and the nav's active state. */
export const TOOLS = [
  { href: "/overlap", label: "Fan overlap", who: "Anyone curious", body: "Any two names: how much their fans overlap, where, and who those fans are.", example: "/overlap?a=Phoebe%20Bridgers&b=PEN15" },
  { href: "/fan", label: "Meet the fan", who: "Creators & marketers", body: "Who a fanbase's fans are and everything else they love.", example: "/fan/Call%20Her%20Daddy" },
  { href: "/lineup", label: "Lineup builder", who: "Promoters & festivals", body: "A headliner in; support acts, host, city, venue and a poster out.", example: "/lineup?h=Phoebe%20Bridgers" },
  { href: "/brand", label: "Brand match", who: "Brands & agencies", body: "The talent, shows and podcasts your customers over-index on, and where they are.", example: "/brand?brand=Patagonia" },
  { href: "/venue", label: "Venue booker", who: "Venues", body: "The artists, comedians, podcasts and brands your city loves.", example: "/venue?city=Austin" },
  { href: "/cities", label: "City explorer", who: "Tour planners & fan clubs", body: "A fanbase's strongest cities at home and in three more countries.", example: "/cities?q=Taylor%20Swift" },
  { href: "/tour", label: "Tour optimizer", who: "Artists & agents", body: "The best route through a fanbase's strongest cities inside your constraints, with every leg's distance and why strong cities were left off.", example: "/tour?q=Phoebe%20Bridgers" },
  { href: "/city", label: "City pages", who: "Everyone", body: "What every big city is into, one page each.", example: "/city/austin" },
] as const;

/** Top navigation, in order. Every page gets it through AppHeader. */
export const NAV = [
  { href: "/", label: "Plan a takeover" },
  { href: "/daily", label: "Daily" },
  { href: "/tools", label: "Tools" },
  { href: "/explore", label: "Explore" },
  { href: "/plans", label: "My plans" },
  { href: "/method", label: "How it works" },
] as const;

/** The footer lists the tools under the nav. */
export const FOOTER_EXTRA = TOOLS.map(({ href, label }) => ({ href, label }));

/** City pages linked from /city and the footer: big markets first, then music and comedy towns. */
export const FEATURED_CITIES = [
  "New York City", "Los Angeles", "Chicago", "Austin", "Nashville", "Atlanta", "Seattle", "Portland",
  "Denver", "Boston", "Miami", "New Orleans", "London", "Manchester", "Glasgow", "Bristol",
  "Toronto", "Montréal", "Vancouver", "Sydney", "Melbourne", "Dublin", "Berlin", "Mexico City",
] as const;

/** "New York City" → "new-york-city"; accents kept, so "Montréal" → "montréal". */
export function citySlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

export const overlapHref = (a: string, b: string) => `/overlap?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
