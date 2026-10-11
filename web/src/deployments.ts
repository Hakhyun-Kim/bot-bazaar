// Addresses come from deployments/<chainId>.json written by scripts/deploy.mjs.
type Address = `0x${string}`;
export interface Deployment {
  chainId: number;
  contracts: Record<"BazaarMarket" | "BazaarOffers" | "BazaarRequests" | "BazaarProjects" | "AgentPass" | "BotOrNot" | "PixelWorkshop", { address: Address }>;
}

const files = import.meta.glob<Deployment>("../../deployments/[0-9]*.json", { eager: true, import: "default" });

/** A committed file wins; otherwise a set this browser deployed itself (src/deployer.ts), until it is committed. */
export function deploymentFor(chainId: number): Deployment | null {
  for (const d of Object.values(files)) if (d.chainId === chainId) return d;
  try {
    const own = localStorage.getItem(browserDeploymentKey(chainId));
    return own ? (JSON.parse(own) as Deployment) : null;
  } catch {
    return null;
  }
}

export const browserDeploymentKey = (chainId: number) => `bazaar-deployment-${chainId}`;
