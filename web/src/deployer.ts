// Deploy the seven contracts from the browser wallet, so testnet needs no key outside this page.
// Same order and constructor wiring as deployAll() in scripts/lib/localchain.mjs.
import { getContractAddress, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import abiJson from "./abi.json";
import bytecodeJson from "./bytecode.json";
import type { Deployment } from "./deployments";

type Name = keyof Deployment["contracts"];
const ABI = abiJson as unknown as Record<Name, readonly unknown[]>;
const BYTECODE = bytecodeJson as Record<Name, Hex>;

export async function deployFromBrowser(pub: PublicClient, wallet: WalletClient, log: (line: string) => void): Promise<Deployment> {
  const account = wallet.account!;
  const from = account.address;
  const chainId = await pub.getChainId();
  const contracts = {} as Record<Name, { address: Address; tx: Hex; block: number }>;
  const deploy = async (name: Name, args: unknown[] = []) => {
    log(`Deploying ${name}…`);
    const hash = await wallet.deployContract({ abi: ABI[name], bytecode: BYTECODE[name], args, account, chain: wallet.chain } as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error(`${name} deploy failed`);
    contracts[name] = { address: r.contractAddress, tx: hash, block: Number(r.blockNumber) };
    return r.contractAddress;
  };
  const nonce = await pub.getTransactionCount({ address: from, blockTag: "pending" });
  const predictedOffers = getContractAddress({ from, nonce: BigInt(nonce + 1) });
  const market = await deploy("BazaarMarket", [predictedOffers]);
  const offers = await deploy("BazaarOffers", [market]);
  if (offers.toLowerCase() !== predictedOffers.toLowerCase()) throw new Error(`offers landed at ${offers}, market expects ${predictedOffers}`);
  await deploy("BazaarRequests");
  await deploy("BazaarProjects");
  const pass = await deploy("AgentPass");
  await deploy("BotOrNot", [pass]);
  await deploy("PixelWorkshop", [false]);
  return { chainId, network: "testnet", deployer: from, deployedAt: new Date().toISOString(), deployedFrom: "browser", contracts } as Deployment;
}
