// Public numbers: what BOT Bazaar has done on chain, read from the contracts and nothing else
// (no server, no indexer, no estimates). Wallets the team uses for its own test runs are listed in
// deployments/<id>.json "team" and counted apart, so the player numbers are never padded.

type Address = `0x${string}`;
type Read = <T>(contract: string, fn: string, args?: unknown[]) => Promise<T>;

export interface NumberRow {
  key: string;
  label: string;
  total: number;
  /** null when the contract has no per-item read to tell team items apart */
  team: number | null;
  /** only this many items were looked at (the list is longer) */
  checked?: number;
}

/** Per-item reads stop here; the panel then says how many were checked. */
export const MAX_ITEMS = 400;

const lower = (a: string) => a.toLowerCase();

async function each<T>(n: number, from: number, get: (i: number) => Promise<T>) {
  const count = Math.min(n, MAX_ITEMS);
  return Promise.all(Array.from({ length: count }, (_, i) => get(from + i)));
}

export async function chainNumbers(read: Read, has: (c: string) => boolean, team: readonly string[]): Promise<NumberRow[]> {
  const isTeam = (a: string) => team.some((t) => lower(t) === lower(a));
  const rows: NumberRow[] = [];
  const checked = (n: number) => (n > MAX_ITEMS ? { checked: MAX_ITEMS } : {});

  if (has("PixelWorkshop")) {
    const n = Number(await read<bigint>("PixelWorkshop", "designCount"));
    const list: { creator: string; mints: number }[] = [];
    for (let off = 0; off < Math.min(n, MAX_ITEMS); off += 100) {
      const [, page] = await read<[bigint[], { creator: string; mints: number }[]]>("PixelWorkshop", "designsPage", [BigInt(off), 100n]);
      list.push(...page);
    }
    const creators = new Set(list.map((d) => lower(d.creator)));
    rows.push({ key: "designs", label: "Pixel designs published", total: n, team: list.filter((d) => isTeam(d.creator)).length, ...checked(n) });
    rows.push({ key: "artists", label: "Artists (different wallets)", total: creators.size, team: [...creators].filter(isTeam).length, ...checked(n) });
    rows.push({ key: "collected", label: "Designs collected", total: list.reduce((s, d) => s + Number(d.mints), 0), team: null, ...checked(n) });
  }
  if (has("BazaarMarket")) {
    const n = Number(await read<bigint>("BazaarMarket", "purchaseCount"));
    const buyers = await each(n, 0, (i) => read<readonly [Address]>("BazaarMarket", "purchaseOf", [BigInt(i)]).then((p) => p[0]));
    rows.push({ key: "purchases", label: "Purchases (escrowed)", total: n, team: buyers.filter(isTeam).length, ...checked(n) });
  }
  if (has("BazaarOffers")) {
    const n = Number(await read<bigint>("BazaarOffers", "offerCount"));
    const buyers = await each(n, 0, (i) => read<{ buyer: Address }>("BazaarOffers", "offerAt", [BigInt(i)]).then((o) => o.buyer));
    rows.push({ key: "offers", label: "Offers made", total: n, team: buyers.filter(isTeam).length, ...checked(n) });
  }
  if (has("BazaarRequests")) {
    rows.push({ key: "requests", label: "Requests posted", total: Number(await read<bigint>("BazaarRequests", "requestCount")), team: null });
  }
  if (has("BazaarProjects")) {
    const n = Number(await read<bigint>("BazaarProjects", "projectCount"));
    const owners = await each(n, 1, (i) => read<{ owner: Address }>("BazaarProjects", "projectOf", [BigInt(i)]).then((p) => p.owner));
    rows.push({ key: "projects", label: "Projects registered", total: n, team: owners.filter(isTeam).length, ...checked(n) });
  }
  if (has("BotOrNot")) {
    const n = Number(await read<bigint>("BotOrNot", "playerCount"));
    const [who] = await read<[Address[]]>("BotOrNot", "players", [0n, BigInt(MAX_ITEMS)]);
    rows.push({ key: "botornot", label: "Bot or Not players", total: n, team: who.filter(isTeam).length, ...checked(n) });
  }
  return rows;
}

/** Players' share of a row: the total minus what the team's own wallets did. */
export const byPlayers = (r: NumberRow) => (r.team === null || r.checked ? null : r.total - r.team);
