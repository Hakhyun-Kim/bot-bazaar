# BOT Bazaar

**An open, fee-free marketplace on BOT Chain where projects, shops, developers and AI agents sell
goods and services, and every payment sits in on-chain escrow until the buyer is satisfied.**

BOT Bazaar is shared commerce infrastructure. A single set of contracts serves a person buying a
digital collectible, a company hiring a smart-contract reviewer, and an autonomous agent selling a
service on behalf of the team that runs it. Any project can open its own storefront district on
top of the same market and point its own frontend at it, so new BOT Chain apps get escrow, offers,
receipts and a buyer base without writing commerce contracts themselves.

- **No token.** BOT Bazaar does not issue a token and has no plans for one. Payments are in BOT.
- **No platform fee.** Sellers receive 100% of the price. Nothing is skimmed by the contracts.
- **No admin key.** Nothing can be paused, upgraded, redirected or censored after deployment.
- **No backend.** All state lives on BOT Chain. The web client is static files and a wallet.
- **Goods and services only.** No order book, no lending, no yield, no financial products.

| | |
|---|---|
| Status | Contracts and web client complete and tested on a local chain. Not yet deployed. |
| Chain | BOT Chain mainnet (chain id 677) and testnet (968), EVM |
| License | MIT |

---

## Contents

1. [Who it is for](#who-it-is-for)
2. [How a purchase works](#how-a-purchase-works)
3. [Contracts](#contracts)
4. [Projects: many storefronts on one market](#projects-many-storefronts-on-one-market)
5. [Agents and the Agent Pass](#agents-and-the-agent-pass)
6. [Pixel Workshop](#pixel-workshop)
7. [Trust model](#trust-model)
8. [Networks](#networks)
9. [Quick start](#quick-start)
10. [Deploying](#deploying)
11. [Repository layout](#repository-layout)
12. [Roadmap](#roadmap)
13. [FAQ](#faq)

Deeper notes: [docs/DESIGN.md](docs/DESIGN.md) (data model, invariants, decisions) and
[docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) (how the project fits the BOT Chain ecosystem).

---

## Who it is for

| Who | What they do on BOT Bazaar | Category |
|---|---|---|
| Consumers | buy cosmetics, coupons, digital items, collect pixel art | Goods (B2C) |
| Independent sellers | open a shop with up to 8 priced items in one transaction | Goods (B2C) |
| Studios and freelancers | sell fixed-scope work: audits, integrations, design, deployment help | Service (B2B) |
| Developers | sell SDK licences, templates, data sets, API access tiers | Developer asset |
| AI agents | sell a service (research, monitoring, content) for a named owner | Agent service |
| BOT Chain projects | host a storefront district and curate it on their own site | Project |
| Creators | publish free 8x8 pixel designs, optionally charge for collecting them | Pixel Workshop |

## How a purchase works

```
 buyer                     BazaarMarket                    seller
   │  buyItem(seller, i)  ─▶  price checked on chain
   │  (pays exact price)      money held in escrow
   │                          releaseAt = now + 24 h
   │
   ├─ confirm() ───────────▶  settle: money → seller, receipt (ERC-1155) → buyer
   ├─ dispute() ───────────▶  deadline moves to now + 7 days, both sides talk
   │                                               ◀── refund(): money → buyer, no receipt
   │
   └─ after the deadline, anyone may call release() / releaseMany() to settle
```

- **Fixed price.** `buyItem` (shop items) and `buy` (programmatic listings) only accept the exact
  stored price.
- **Offers.** For anything without a fixed price, or below it, the buyer calls `makeOffer` and
  the money is locked in `BazaarOffers`. If the seller accepts, the offer becomes a normal escrowed
  purchase. Offers expire after 7 days; the buyer can always cancel and get the money back.
- **Receipts.** The receipt token is minted only when the seller is paid, so nobody ends up with
  both a refund and a receipt. A receipt can be **redeemed** (burned) to prove a coupon or service
  was used, and the merchant checks the `Redeemed` event.
- **No keeper.** The chain has no timers. Settlement happens when someone calls it; the seller can
  settle many matured sales at once with `releaseMany`.

## Contracts

| Contract | Responsibility | Key functions |
|---|---|---|
| [`BazaarMarket`](contracts/BazaarMarket.sol) | Shops, listings, escrow, disputes, refunds, ERC-1155 receipts | `openShop` `buyItem` `list` `buy` `confirm` `dispute` `refund` `release` `releaseMany` `redeem` `openShops` |
| [`BazaarOffers`](contracts/BazaarOffers.sol) | Escrowed price offers that turn into market purchases | `makeOffer` `acceptOffer` `cancelOffer` `offersFor` |
| [`BazaarProjects`](contracts/BazaarProjects.sol) | Project registry and per-project curation | `register` `update` `transfer` `setFeatured` `projectsPage` `featuredOf` |
| [`AgentPass`](contracts/AgentPass.sol) | Links an agent or hot wallet to the principal it acts for | `link` `unlink` `revoke` `principalOf` `identityOf` |
| [`PixelWorkshop`](contracts/PixelWorkshop.sol) | Free on-chain pixel designs, gallery, optional paid collecting | `register` `collect` `setProfileDesign` `designsPage` |

All five are plain Solidity with no external dependencies, compiled with solc 0.8.28,
`evmVersion: paris` and the optimizer at 200 runs. The largest, `BazaarMarket`, is 16.2 KB, well
under the 24 KB limit.

### A shop

```solidity
openShop(
  "Contract review desk",              // title, 1–60 bytes
  "ipfs://…/shop.json",                // metadata: logo, description, contact, terms (optional)
  2,                                   // project id (0 = independent)
  1,                                   // category: 0 goods · 1 service · 2 developer asset · 3 agent service
  [("1-hour Solidity review", 20e18), ("Deploy + verify", 8e18)]   // 1–8 items, name + price in wei
)
```

Calling `openShop` again updates the shop in place. `closeShop` takes it off the open list.
`openShops(offset, limit)` returns open shops page by page for any frontend to render.

For catalogues larger than eight items, `list(itemId, price)` adds programmatic listings without a
limit; they settle through the same escrow.

## Projects: many storefronts on one market

A project is any app, community or company that wants a market for its users without building one.

1. The project calls `BazaarProjects.register(name, metadataURI)` and gets an id.
2. Shops join by setting that id in `openShop`. Joining needs no approval, so the chain never
   blocks a seller.
3. The project curates its own frontend with `setFeatured(id, shop, true)`; `featuredOf(id)`
   returns the list. Curation affects only what that project chooses to highlight.
4. The project builds whatever frontend it likes (2D, 3D, mobile, a chat bot) on top of the same
   contracts. The bundled web client filters by project with `?project=<id>`.

Money never passes through the project. Ownership of a project can be transferred.

## Agents and the Agent Pass

BOT Chain is built for autonomous agents, and agents sign with hot keys. A buyer should still know
*who* is behind the agent they are paying.

1. The principal (a person's or company's main wallet) signs an EIP-712 message, gas-free:
   *"agent 0xA… may act for me"*, with a nonce and a deadline.
2. The agent submits that signature with `AgentPass.link(...)`. Both sides have to agree: the
   principal's signature and the agent's own transaction.
3. Frontends call `identityOf(agent)` and show the principal's name and history instead of an
   anonymous hot wallet.
4. If the agent key leaks, the principal calls `revoke(agent)`.

Agents that answer offers automatically can use [`scripts/lib/haggle.mjs`](scripts/lib/haggle.mjs):
the owner sets a floor, offers at or above the list price are always accepted, offers below the
floor are always refused, and the agent (an LLM or a simple rule) only decides in between. A
misbehaving model cannot sell below the floor.

## Pixel Workshop

A free creative module that works on its own and is the smallest useful mainnet deployment.

- A design is 8x8 pixels in 4 colours from a 16-colour preset: 16 bytes of pixels and a 16-bit
  palette, stored entirely on chain. No IPFS, no pinning service, no image host.
- Publishing costs only gas. The creator may set a price; collectors then pay the creator directly.
- Every collector can show one owned design on their profile (`setProfileDesign`), which any app
  can read with `profileDesignOf`.
- The gallery is a paged read (`designsPage`), newest first.

## Trust model

| Party | Can | Cannot |
|---|---|---|
| Seller | refund, change prices for future sales, close the shop | touch escrowed money before settlement |
| Buyer | confirm, dispute once, cancel own offers | hold settlement beyond 7 days; keep both a refund and a receipt |
| Project owner | curate featured shops, update or transfer the project | block a shop from joining; touch any payment |
| Anyone | settle matured purchases, cancel expired offers | send money anywhere other than the recorded buyer or seller |
| Deployer | nothing after deployment | pause, upgrade, take a fee, change the offers contract |

What escrow does not solve is off-chain delivery: a dispute buys time to talk, it does not judge.
An optional arbitration contract that a project can appoint for its own district is on the roadmap.

## Networks

| | Chain id | RPC | Explorer |
|---|---|---|---|
| Mainnet | 677 | https://rpc.botchain.ai | https://scan.botchain.ai |
| Testnet | 968 | https://rpc.bohr.life | https://scan.bohr.life |

Testnet BOT: https://faucet.botchain.ai · Developer guide:
https://dev-docs.botchain.ai/docs/Developers/quick-guide/

These values live in one table, [`scripts/lib/networks.mjs`](scripts/lib/networks.mjs), mirrored
in [`web/src/networks.ts`](web/src/networks.ts); `npm test` fails if the two disagree. Deployed
addresses are written to `deployments/<chainId>.json` and picked up by the web client
automatically.

## Quick start

Requires Node.js 20 or newer.

```bash
npm ci
npm test                                         # pure checks, no chain, under a second
npm i @foundry-rs/anvil --ignore-scripts --no-save
npm run test:local                               # deploys everything on a local chain and walks 20 paths
```

`test:local` starts anvil with chain id 677 and the `paris` hardfork, deploys all five contracts in
production order, and checks escrow, dispute timing (by jumping the clock 2 and 8 days), refunds,
listings, offers and expiry, Agent Pass signatures and replay protection, and the workshop.

To click around in a browser:

```bash
npm run chain        # terminal 1: local chain on :8545 with sample projects, shops and designs
npm run dev          # terminal 2: web client on http://localhost:5173
```

Pick **Local dev chain** in the network menu, add `http://127.0.0.1:8545` (chain id 31337) to your
wallet, and import anvil's public development key
`0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` (it holds no real funds).

## Deploying

The deploy key is read from the environment only. It is never written to disk or printed.

```bash
DEPLOYER_KEY=0x... npm run deploy -- --network testnet          # dry run: chain id, balance, sizes
DEPLOYER_KEY=0x... npm run deploy -- --network testnet --yes    # broadcast five deployments
DEPLOYER_KEY=0x... npm run deploy -- --network mainnet --yes
```

The script refuses to run if the RPC reports a different chain id, if the deployer has no BOT, or
if `deployments/<chainId>.json` already exists (pass `--force` to deploy a fresh set). It deploys
in a fixed order: `BazaarMarket` receives the address `BazaarOffers` will have (predicted from the
next nonce), and the script stops if the prediction does not match.

For explorer source verification, `npm run verify-input` writes the solc standard-JSON input
(compiler v0.8.28, `paris`, optimizer 200) to `deployments/standard-input.json`.

## Repository layout

```
contracts/            Solidity: BazaarMarket · BazaarOffers · BazaarProjects · AgentPass · PixelWorkshop
scripts/
  compile.mjs         compile and write web/src/abi.json, print sizes
  test-local.mjs      end-to-end tests on a local anvil
  dev-chain.mjs       local chain with sample data for the web client
  deploy.mjs          deploy to testnet or mainnet
  verify-input.mjs    standard-JSON input for explorer verification
  lib/                networks · compile settings · local chain harness · offer rules for agents
test/                 pure tests (npm test)
web/                  Vite + TypeScript + viem, no framework: shops · projects · workshop · account
deployments/          <chainId>.json for each deployed network
docs/                 DESIGN.md · ECOSYSTEM.md
```

## Roadmap

1. Testnet (968) deployment and a public web build pointing at it.
2. Pixel Workshop on mainnet (677): creation and gallery only, gas only.
3. Market, offers, projects and Agent Pass on mainnet.
4. Stablecoin payments (an ERC-20 path beside native BOT, same escrow rules).
5. Agent toolkit: an SDK and MCP server so agents can open shops, answer offers within an
   owner-set floor and confirm deliveries.
6. Reputation per principal (settled, refunded, disputed) on shop cards, read from events.
7. Optional per-project arbitration contract.

Indexers and caches wait until there are users; the web client reads the chain directly.

## FAQ

**Is there a token or a points programme?** No.

**Who earns money from the market?** Sellers and creators. The contracts take no fee.

**What if a seller never delivers?** The buyer disputes within 24 hours, which holds the money for
7 days. The seller can refund at any time in that window. If neither acts, the purchase settles to
the seller after 7 days, so disputes are a negotiation window, not arbitration. Projects that need
arbitration will be able to appoint one for their district.

**Can a project remove a shop from its district?** It can un-feature a shop on its own frontend.
It cannot stop anyone from trading on the shared market.

**Why ERC-1155 receipts?** One token id per seller and item (`keccak256(seller, itemId)`), so
wallets and explorers show "3 × Deploy + verify from 0xB…" without a separate NFT per purchase.

**Why `evmVersion: paris`?** The bytecode then uses no opcodes introduced after the Merge, so it
does not depend on which later upgrades a chain has enabled.

## License

MIT — see [LICENSE](LICENSE).
