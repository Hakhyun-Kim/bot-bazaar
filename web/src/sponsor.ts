// Sponsored free play: a new browser wallet asks the sponsor's relayer (sponsor/relayer.mjs) for its
// first gas once, so a visitor can publish without buying BOT first. No imports, so `npm test` can
// check the message matches the relayer's word for word.

/** The one message a player's wallet signs (address checksummed). Same text as sponsor/relayer.mjs. */
export const claimMessage = (chainId: number, address: string) => `BOT Bazaar free gas\nChain: ${chainId}\nAddress: ${address}`;

export interface SponsorStatus {
  chainId: number;
  tank: string;
  dripAmount: string;
  dailyCap: string;
  spentToday: string;
  dripCount: number;
  totalDripped: string;
  balance: string;
  open: boolean;
  turnstile: boolean;
}

export async function sponsorStatus(url: string): Promise<SponsorStatus | null> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/status`);
    return r.ok ? ((await r.json()) as SponsorStatus) : null;
  } catch {
    return null;
  }
}

/** Ask for the drip. Resolves with the transaction hash, or throws with the relayer's own words. */
export async function claimFreeGas(url: string, address: string, signature: string): Promise<string> {
  const r = await fetch(`${url.replace(/\/+$/, "")}/drip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, signature }),
  });
  const body = (await r.json().catch(() => ({}))) as { hash?: string; error?: string };
  if (!r.ok || !body.hash) throw new Error(body.error || `Free gas is not available right now (${r.status})`);
  return body.hash;
}
