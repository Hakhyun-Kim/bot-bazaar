// Which screens a deployment gets. Plain TypeScript with no imports, so `npm test` can load it in Node.
// Rule (CLAUDE.md 7): the 3D bazaar is always the first screen, on every network and deployment set.
export const TABS = ["bazaar", "workshop", "shops", "requests", "botornot", "projects", "account"] as const;
export type Tab = (typeof TABS)[number];

/** A deployment holding only some contracts (mainnet v1: PixelWorkshop) keeps the 3D bazaar and shows the rest as coming soon. */
export function tabsFor(contracts: Record<string, unknown>): readonly Tab[] {
  return contracts.BazaarMarket ? TABS : ["bazaar", "workshop"];
}
