// Demo chain — the same compiled contracts running on an EVM inside the browser (ethereumjs), so the
// bazaar plays from a static page with no wallet and no deployment. Five funded personas, some seed
// shops, requests, designs and a Bot or Not round, and a clock you can fast-forward.
//
// Nothing leaves the browser. Every transaction is logged to localStorage and replayed on load, so a
// refresh keeps your progress; "Reset" clears the log. Gas is free (gas price and base fee are 0).
import { Mainnet, createCustomCommon } from "@ethereumjs/common";
import { createBlock } from "@ethereumjs/block";
import { createLegacyTx } from "@ethereumjs/tx";
import { createAccount, createAddressFromString, bytesToHex, hexToBytes } from "@ethereumjs/util";
import { createVM, runTx, type VM } from "@ethereumjs/vm";
import {
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseEther,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import abiJson from "./abi.json";
import bytecodeJson from "./bytecode.json";
import type { Deployment } from "./deployments";

type Name = keyof Deployment["contracts"];
const ABI = abiJson as unknown as Record<Name, readonly unknown[]>;
const BYTECODE = bytecodeJson as Record<Name, Hex>;

export const DEMO_CHAIN = defineChain({
  id: 31338,
  name: "Demo (in this browser)",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

/** Foundry's published anvil dev keys — public test keys, never funded anywhere real. */
const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
];
const DEPLOYER = 4;
export const PERSONAS = ["You", "Bob", "Carol", "Dave"].map((name, i) => ({
  name,
  address: privateKeyToAccount(KEYS[i]).address,
}));
const ADDRS = KEYS.map((k) => privateKeyToAccount(k).address);

const LOG_KEY = "bazaar-demo-v1";
const SECRET_KEY = (a: Address) => `bon-${a}`; // same key main.ts uses for a Bot or Not answer
interface Entry {
  k: number; // signer index into KEYS
  to: Address | null;
  data: Hex;
  value: string;
  ts: number;
}
interface Log {
  offset: number; // seconds the clock was fast-forwarded
  txs: Entry[];
}
const load = (): Log | null => {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "null");
  } catch {
    return null;
  }
};
const save = (log: Log) => {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* private mode: the demo still works, it just forgets on reload */
  }
};

interface Receipt {
  transactionHash: Hex;
  transactionIndex: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  from: Address;
  to: Address | null;
  cumulativeGasUsed: Hex;
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  contractAddress: Address | null;
  logs: unknown[];
  logsBloom: Hex;
  status: Hex;
  type: Hex;
}

class RpcError extends Error {
  constructor(message: string, public code: number, public data?: Hex) {
    super(message);
  }
}

export class DemoChain {
  private head = { number: 0n, timestamp: 0 };
  private receipts = new Map<Hex, Receipt>();
  private log: Log = { offset: 0, txs: [] };
  deployment!: Deployment;

  private constructor(private vm: VM) {}

  static async boot(): Promise<DemoChain> {
    const common = createCustomCommon({ chainId: DEMO_CHAIN.id }, Mainnet, { hardfork: "paris" });
    const d = new DemoChain(await createVM({ common }));
    for (const a of ADDRS) {
      await d.vm.stateManager.putAccount(createAddressFromString(a), createAccount({ balance: parseEther("100") }));
    }
    const saved = load();
    if (saved?.txs.length) {
      d.log.offset = saved.offset;
      for (const e of saved.txs) await d.exec(e);
      d.deployment = d.addresses();
    } else {
      await d.deployAll();
      await d.seed();
    }
    return d;
  }

  /** Chain clock in seconds: wall time plus fast-forward, never behind the last block. */
  now(): number {
    return Math.max(Math.floor(Date.now() / 1000) + this.log.offset, this.head.timestamp);
  }
  skip(seconds: number) {
    this.log.offset = this.now() + seconds - Math.floor(Date.now() / 1000);
    save(this.log);
  }
  reset() {
    try {
      localStorage.removeItem(LOG_KEY);
      for (const p of PERSONAS) localStorage.removeItem(SECRET_KEY(p.address));
    } catch {
      /* nothing stored */
    }
  }

  private block(timestamp: number) {
    return createBlock(
      { header: { number: this.head.number + 1n, timestamp: BigInt(timestamp), gasLimit: 60_000_000n, baseFeePerGas: 0n } },
      { common: this.vm.common },
    );
  }

  private async exec(e: Entry): Promise<Receipt> {
    const from = createAddressFromString(ADDRS[e.k]);
    const nonce = (await this.vm.stateManager.getAccount(from))?.nonce ?? 0n;
    const tx = createLegacyTx(
      { nonce, gasPrice: 0n, gasLimit: 30_000_000n, to: e.to ?? undefined, value: BigInt(e.value), data: hexToBytes(e.data) },
      { common: this.vm.common },
    ).sign(hexToBytes(KEYS[e.k]));
    const block = this.block(e.ts);
    const r = await runTx(this.vm, { tx, block, skipBlockGasLimitValidation: true, skipHardForkValidation: true });
    this.head = { number: this.head.number + 1n, timestamp: e.ts };
    const hash = bytesToHex(tx.hash()) as Hex;
    const blockHash = keccak256(toHex(`demo-block-${this.head.number}`));
    const receipt: Receipt = {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash,
      blockNumber: toHex(this.head.number),
      from: ADDRS[e.k],
      to: e.to,
      cumulativeGasUsed: toHex(r.totalGasSpent),
      gasUsed: toHex(r.totalGasSpent),
      effectiveGasPrice: "0x0",
      contractAddress: r.createdAddress ? (r.createdAddress.toString() as Address) : null,
      logs: r.receipt.logs.map(([address, topics, data], i) => ({
        address: bytesToHex(address),
        topics: topics.map((t) => bytesToHex(t)),
        data: bytesToHex(data),
        logIndex: toHex(i),
        blockNumber: toHex(this.head.number),
        blockHash,
        transactionHash: hash,
        transactionIndex: "0x0",
        removed: false,
      })),
      logsBloom: bytesToHex(r.bloom.bitvector) as Hex,
      status: r.execResult.exceptionError ? "0x0" : "0x1",
      type: "0x0",
    };
    this.receipts.set(hash, receipt);
    return receipt;
  }

  /** Run and log a transaction, as a new block at the current clock. */
  private async send(k: number, to: Address | null, data: Hex, value = 0n) {
    const e: Entry = { k, to, data, value: value.toString(), ts: Math.max(this.now(), this.head.timestamp + 1) };
    const r = await this.exec(e);
    this.log.txs.push(e);
    save(this.log);
    return r;
  }

  private addresses(): Deployment {
    const from = ADDRS[DEPLOYER];
    const at = (nonce: number) => ({ address: getContractAddress({ from, nonce: BigInt(nonce) }) });
    return {
      chainId: DEMO_CHAIN.id,
      contracts: {
        BazaarMarket: at(0),
        BazaarOffers: at(1),
        BazaarRequests: at(2),
        BazaarProjects: at(3),
        AgentPass: at(4),
        BotOrNot: at(5),
        PixelWorkshop: at(6),
      },
    };
  }

  /** Same order and constructor wiring as deployAll() in scripts/lib/localchain.mjs. */
  private async deployAll() {
    this.deployment = this.addresses();
    const c = this.deployment.contracts as Required<Deployment["contracts"]>;
    const args: Record<Name, Hex> = {
      BazaarMarket: encodeAbiParameters([{ type: "address" }], [c.BazaarOffers.address]),
      BazaarOffers: encodeAbiParameters([{ type: "address" }], [c.BazaarMarket.address]),
      BazaarRequests: "0x",
      BazaarProjects: "0x",
      AgentPass: "0x",
      BotOrNot: encodeAbiParameters([{ type: "address" }], [c.AgentPass.address]),
      PixelWorkshop: "0x",
    };
    for (const name of Object.keys(args) as Name[]) {
      const r = await this.send(DEPLOYER, null, `${BYTECODE[name]}${args[name].slice(2)}` as Hex);
      if (r.contractAddress?.toLowerCase() !== c[name].address.toLowerCase()) throw new Error(`demo: ${name} deploy failed`);
    }
  }

  private call(k: number, name: Name, functionName: string, args: unknown[] = [], value = 0n) {
    const data = encodeFunctionData({ abi: ABI[name], functionName, args } as never);
    return this.send(k, this.deployment.contracts[name]!.address, data, value);
  }

  /** A small bazaar to walk into: three shops, two requests, designs and a live Bot or Not round. */
  private async seed() {
    const [, BOB, CAROL, DAVE] = [0, 1, 2, 3];
    const day = 86400;
    await this.call(CAROL, "AgentPass", "declare", [1, "illustrator"]);
    await this.call(DAVE, "AgentPass", "declare", [2, "pricing bot"]);
    await this.call(CAROL, "BazaarProjects", "register", ["Pixel Guild", ""]);
    const item = (name: string, bot: string) => ({ name, price: parseEther(bot) });
    await this.call(CAROL, "BazaarMarket", "openShop", ["Carol's Pixel Studio", "", 1, 0,
      [item("Custom 8x8 avatar", "0.5"), item("Shop banner", "1.2")]]);
    await this.call(DAVE, "BazaarMarket", "openShop", ["Gas Watch", "", 0, 3,
      [item("Daily price report", "0.1"), item("Price alert bot, 30 days", "0.8")]]);
    await this.call(BOB, "BazaarMarket", "openShop", ["Prompt Forge", "", 0, 1,
      [item("Prompt review", "0.3"), item("Agent workflow audit", "2")]]);
    await this.call(DAVE, "BazaarMarket", "buyItem", [ADDRS[CAROL], 0], parseEther("0.5"));
    const due = BigInt(this.now() + 7 * day);
    await this.call(DAVE, "BazaarRequests", "post", ["Draw a logo for my bot", "", 1, due], parseEther("1.5"));
    await this.call(CAROL, "BazaarRequests", "post", ["Summarise 50 product reviews", "", 2, due], parseEther("0.4"));
    await this.call(CAROL, "PixelWorkshop", "register", ["Heart", "0x14145555555555551554055001400000", 0x0300, 0n]);
    await this.call(CAROL, "PixelWorkshop", "register", ["Bot face", "0x02802aa82eb826982aa825582aa80820", 0x0182, parseEther("0.05")]);
    // Bob seals "I am a bot". His answer is stored like any player's, so switching to Bob can reveal it.
    const salt = keccak256(toHex("demo-bob-salt"));
    const commitment = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bool" }, { type: "bytes32" }], [ADDRS[BOB], true, salt]));
    await this.call(BOB, "BotOrNot", "enter", [commitment]);
    try {
      localStorage.setItem(SECRET_KEY(ADDRS[BOB]), JSON.stringify({ isBot: true, salt }));
    } catch {
      /* private mode */
    }
    await this.call(DAVE, "BotOrNot", "guess", [ADDRS[BOB], false]);
    await this.call(CAROL, "BotOrNot", "guess", [ADDRS[BOB], true]);
  }

  private async simulate(p: { from?: Address; to?: Address; data?: Hex; value?: Hex }) {
    const sm = this.vm.stateManager;
    await sm.checkpoint();
    try {
      const r = await this.vm.evm.runCall({
        caller: createAddressFromString(p.from ?? ADDRS[0]),
        to: p.to ? createAddressFromString(p.to) : undefined,
        data: p.data ? hexToBytes(p.data) : undefined,
        value: p.value ? BigInt(p.value) : 0n,
        gasLimit: 30_000_000n,
        block: this.block(this.now()),
      });
      const out = bytesToHex(r.execResult.returnValue) as Hex;
      if (r.execResult.exceptionError) throw new RpcError("execution reverted", 3, out);
      return out;
    } finally {
      await sm.revert();
    }
  }

  /** EIP-1193 provider for viem's custom() transport. Covers what main.ts and viem's actions ask for. */
  request = async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
    const p = params as never[];
    switch (method) {
      case "eth_chainId":
        return toHex(DEMO_CHAIN.id);
      case "net_version":
        return String(DEMO_CHAIN.id);
      case "eth_blockNumber":
        return toHex(this.head.number);
      case "eth_accounts":
      case "eth_requestAccounts":
        return PERSONAS.map((x) => x.address);
      case "eth_getBalance": {
        const acc = await this.vm.stateManager.getAccount(createAddressFromString(p[0]));
        return toHex(acc?.balance ?? 0n);
      }
      case "eth_getTransactionCount": {
        const acc = await this.vm.stateManager.getAccount(createAddressFromString(p[0]));
        return toHex(acc?.nonce ?? 0n);
      }
      case "eth_getCode":
        return bytesToHex(await this.vm.stateManager.getCode(createAddressFromString(p[0])));
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return "0x0";
      case "eth_estimateGas":
        await this.simulate(p[0]);
        return toHex(30_000_000n);
      case "eth_call":
        return this.simulate(p[0]);
      case "eth_getBlockByNumber":
      case "eth_getBlockByHash":
        return {
          number: toHex(this.head.number),
          hash: keccak256(toHex(`demo-block-${this.head.number}`)),
          parentHash: keccak256(toHex(`demo-block-${this.head.number - 1n}`)),
          timestamp: toHex(this.now()),
          gasLimit: toHex(60_000_000n),
          gasUsed: "0x0",
          baseFeePerGas: "0x0",
          transactions: [],
        };
      case "eth_sendTransaction": {
        const t = p[0] as { from: Address; to?: Address; data?: Hex; value?: Hex };
        const k = ADDRS.findIndex((a) => a.toLowerCase() === t.from.toLowerCase());
        if (k < 0 || k === DEPLOYER) throw new RpcError(`unknown demo account ${t.from}`, 4100);
        await this.simulate(t);
        const r = await this.send(k, t.to ?? null, t.data ?? "0x", t.value ? BigInt(t.value) : 0n);
        return r.transactionHash;
      }
      case "eth_getTransactionReceipt":
        return this.receipts.get(p[0]) ?? null;
      case "eth_getTransactionByHash": {
        const r = this.receipts.get(p[0]);
        return r ? { hash: r.transactionHash, blockHash: r.blockHash, blockNumber: r.blockNumber, from: r.from, to: r.to,
          transactionIndex: "0x0", input: "0x", value: "0x0", nonce: "0x0", gas: r.gasUsed, gasPrice: "0x0", type: "0x0" } : null;
      }
      case "eth_getLogs":
        return [];
      case "wallet_switchEthereumChain":
        return null;
      default:
        throw new RpcError(`demo chain: ${method} is not supported`, 4200);
    }
  };
}
