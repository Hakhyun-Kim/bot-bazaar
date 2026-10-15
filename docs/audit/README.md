# BOT Bazaar contracts: audit-readiness package

Commit reviewed: `5ed0a86` ("Contracts: per-transaction BOT cap for the mainnet test version").
Prepared 2026-10-14. This is an internal review and a static-analysis pass, not an external audit.

| File | Contents |
|---|---|
| [README.md](README.md) | scope, trust model, cap, build/test, limitations, focus areas |
| [static-analysis.md](static-analysis.md) | Slither run (tool, version, commands) and triage of every detector hit |
| [static-analysis-raw.txt](static-analysis-raw.txt) | raw Slither output |
| [internal-review.md](internal-review.md) | manual review of the money paths, findings, invariants |
| [test-results.md](test-results.md) | latest `npm test` / `npm run test:local` / explorer bytecode check results |

## Scope

Solidity 0.8.28, `evmVersion: paris`, optimizer on, 200 runs. The single source of these settings
is `scripts/lib/compile.mjs`; tests, deploy and explorer verification all use it.

| Contract | Lines | Holds BOT? | External calls | Mainnet status |
|---|---:|---|---|---|
| `contracts/BazaarMarket.sol` | 516 | **Yes**: escrowed purchases (24 h, 7 days if disputed) | `seller.call{value}` in `_settle`; `buyer.call{value}` in `refund`; `onERC1155Received` on the receiver in `safeTransferFrom` | deployed 2026-10-14, capped (test version 0.1) |
| `contracts/BazaarOffers.sol` | 126 | **Yes**: locked offers (up to 7 days) | `buyer.call{value}` in `cancelOffer`; `market.purchaseFor{value}` in `acceptOffer` | deployed 2026-10-14, capped (test version 0.1) |
| `contracts/BazaarRequests.sol` | 215 | **Yes**: request rewards (until paid / returned) | `worker.call{value}` in `_pay`; `poster.call{value}` in `_return` | deployed 2026-10-14, capped (test version 0.1) |
| `contracts/BazaarProjects.sol` | 110 | No | none | deployed 2026-10-14 |
| `contracts/AgentPass.sol` | 114 | No | `ecrecover` precompile | deployed 2026-10-14 |
| `contracts/BotOrNot.sol` | 175 | No (score only) | `AgentPass.kindOf` (view) | deployed 2026-10-14 |
| `contracts/PixelWorkshop.sol` | 117 | No on mainnet (`freeOnly = true`) | `creator.call{value}` only for priced designs, unreachable when `freeOnly` | already on mainnet, `0x48b1c637f7fe9fec89961577329657344311adbb` (chain 677) |

No contract imports any library. There are no tokens other than the minimal ERC-1155 purchase
receipts inside `BazaarMarket` (minted on settlement, transferable, burnable via `redeem`).

Wiring: `BazaarMarket.offers` and `BazaarOffers.market` are immutable and point at each other.
The market's `offers` address is predicted from the deployer's next nonce
(`scripts/lib/localchain.mjs` `deployAll`); the script aborts if the prediction is wrong.
`BotOrNot.pass` is the `AgentPass` address.

## Trust model

- **No owner, no admin key, no pause, no upgrade path.** No proxy, no `selfdestruct`, no
  `delegatecall`. Every parameter (`offers`, `market`, `maxAmount`, `pass`, `freeOnly`) is
  `immutable` and set in the constructor. A bug can only be fixed by deploying new contracts and
  moving the web client to them; funds in the old ones follow the old rules.
- **No fees.** The contracts never keep any BOT for themselves. Every wei that enters leaves to the
  buyer/seller or poster/worker.
- **Native BOT only.** No ERC-20 transfers, no approvals, no oracles, no price feeds.
- **No arbiter.** A dispute does not move money. In the market, a dispute extends the escrow to
  7 days; only the seller can refund, otherwise the seller is paid. In requests, a dispute extends
  the review to 10 days; only the worker can hand the reward back, otherwise the worker is paid.
  This is deliberate (no admin key) and is the most important thing for users to understand.
- **Settlement is permissionless after a deadline** (`release`, `releaseMany`, `cancelOffer` after
  expiry). There is no keeper.

## The 0.1 test-version cap

`BazaarMarket`, `BazaarOffers` and `BazaarRequests` take `uint128 maxAmount` (wei, `0` = no cap)
in the constructor. With a non-zero cap:

| Path | Check |
|---|---|
| `BazaarMarket.list`, `openShop` (each item) | price must be `<= maxAmount` (`_capped`, BazaarMarket.sol:127) |
| `BazaarMarket._pushPurchase` (`buy`, `buyItem`, `purchaseFor`) | amount `<= maxAmount` (BazaarMarket.sol:349) |
| `BazaarOffers.makeOffer` | `msg.value <= maxAmount` (BazaarOffers.sol:58) |
| `BazaarRequests.post` | `msg.value <= maxAmount` (BazaarRequests.sol:73) |

`scripts/deploy.mjs` refuses a mainnet market deployment without `--max-amount`; the planned value
is `0.001` BOT (`10^15` wei), the same for all three contracts.

The cap is **per purchase / offer / request**, not a total. Many capped escrows can add up to any
total balance. It limits what one buggy settlement can move, not the contracts' aggregate exposure.
Since `maxAmount` is immutable, raising it means redeploying.

## Build and test

```sh
npm ci
npm run compile        # solc 0.8.28 (npm package), writes web ABIs/bytecode, prints sizes
npm test               # node --test test/logic.test.mjs (7 tests, off-chain logic and config)
npm i @foundry-rs/anvil --ignore-scripts --no-save   # once, for the local chain
npm run test:local     # anvil e2e, chain id 677, hardfork paris: 39 scenarios incl. 4 cap scenarios
```

Both suites passed at `5ed0a86` during this review (7/7, 39/39). Deployed sizes:
BazaarMarket 16,958 B, BazaarRequests 8,644 B, BotOrNot 6,048 B, BazaarProjects 5,103 B,
BazaarOffers 5,005 B, PixelWorkshop 4,581 B, AgentPass 3,402 B.

Static analysis: see [static-analysis.md](static-analysis.md) (Slither 0.11.6 via a shim over
the npm `solc` 0.8.28). No fuzzing or formal verification was run (Foundry `forge` was not
available); the test suite is scenario-based.

## Known limitations (by design or accepted for 0.1)

1. Disputes only delay. Buyers and posters have no on-chain recourse beyond the counterparty's
   goodwill (`refund` / `handBack`). See internal-review.md I-1.
2. Payouts are push payments with `require(ok)`. A payee that rejects BOT blocks its own payout
   and, in `releaseMany`, the whole batch (L-1, L-2). No funds can be taken by anyone else.
3. ERC-1155 receipts are a minimal implementation: `safeBatchTransferFrom` skips the receiver
   hook, receipts are freely transferable, metadata is an unencoded `data:` JSON URI (I-3, I-4).
4. AgentPass and BotOrNot are honour systems for identity/scoring. BotOrNot scores can be farmed
   with sybil addresses; nothing of value depends on them.
5. The per-transaction cap is not an aggregate cap.
6. Storage arrays (`_purchases`, `_offers`, `_requests`, `_openOwners`, `_players`) grow forever.
   Every state-changing function is O(1); only paginated views iterate.

## What an auditor should focus on

1. **Escrow accounting in `BazaarMarket`**: one `settled` flag guards both `_settle` and `refund`;
   confirm no path pays twice or leaves the contract owing more than it holds (invariants in
   internal-review.md).
2. **`BazaarOffers` → `BazaarMarket.purchaseFor` hand-off**: the immutable cross-wiring, the
   nonce-predicted address, and cap consistency between the two contracts.
3. **`BazaarRequests` state machine** (OPEN → ASSIGNED → SUBMITTED → PAID / RETURNED) and its
   time boundaries (`<` vs `<=` on `deadline` and `releaseAt`).
4. **Reverting / gas-griefing payees** and reentrancy from payees into other functions
   (state is written before every value transfer, there is no `nonReentrant` guard).
5. **Front-running**: seller changing a shop item between quote and `buyItem` (L-3), seller
   `acceptOffer` racing buyer `cancelOffer` (L-5), buyer `dispute` racing `release` (L-4).
6. **ERC-1155 conformance** of the receipts, if any third-party integration is expected.
7. **AgentPass EIP-712 signature handling** (domain, nonce, low-s, `ecrecover` zero address).
