# BOT Bazaar — design notes

The README explains what BOT Bazaar does. This file records *why* it is built this way, the
invariants the contracts keep, and what is deliberately left out.

## 1. Goal

One shared marketplace layer for BOT Chain that:

- anyone can sell on in one transaction, without permission;
- any project can host as its own storefront district, with its own frontend;
- humans and autonomous agents use in the same way, with agents accountable to a named principal;
- needs no operator: no server, no fee, no admin key.

## 2. Principles

1. **Goods and services only.** No fungible token, no order book, no lending, no yield. A receipt
   is proof of purchase, not an investment.
2. **No platform fee, no admin key.** Nothing can be paused, upgraded or redirected. If a project
   wants revenue, it charges for its own frontend or services, not inside the shared contracts.
3. **Prices are enforced on chain.** `buyItem` and `buy` accept only the exact stored price.
   Anything else goes through `BazaarOffers`, the only caller allowed into `purchaseFor`, fixed at
   deployment.
4. **Escrow by default.** Every purchase waits 24 h for the buyer to confirm or dispute. A dispute
   extends it to 7 days. The seller can refund at any time before settlement. After the deadline
   anyone can settle, so a silent buyer cannot freeze a seller's money.
5. **Receipts only on settlement.** The ERC-1155 receipt is minted when the money reaches the
   seller, so a refunded buyer never holds both.
6. **Hot wallets are named.** `AgentPass` lets a principal sign, without gas, that an agent acts
   for it. Frontends show the principal.
7. **Free first.** Creating a pixel design costs only gas. A price is optional and goes to the
   creator directly.
8. **Scale work waits for users.** No indexer, cache or off-chain database until traffic needs one.
   Paged view functions are enough for launch.

## 3. Invariants

These hold for every reachable state and are exercised by `npm run test:local`.

| # | Invariant | Where |
|---|---|---|
| I1 | A purchase's money goes to exactly one of: the recorded seller (settle) or the recorded buyer (refund) | `_settle`, `refund` |
| I2 | A purchase settles or refunds at most once | `settled` flag checked in both paths |
| I3 | A receipt exists only for settled purchases | minted inside `_settle` only |
| I4 | A buyer cannot delay settlement past `releaseAt`, which is at most purchase time + 7 days | `dispute` extends once |
| I5 | An offer's money returns to the buyer unless the seller accepts before expiry | `cancelOffer`, `acceptOffer` |
| I6 | Only `BazaarOffers` can create a purchase at a price other than the stored one | `purchaseFor` caller check, immutable |
| I7 | An Agent Pass signature is usable once, before its deadline, by the named agent only | nonce, deadline, `msg.sender` in digest |
| I8 | Project owners never hold or route funds | `BazaarProjects` has no payable function |

## 4. Data model

- `Shop { title, metadataURI, projectId, category, openedAt, open, items[≤8] }`, one per address.
  `category`: 0 goods (B2C), 1 service (B2B), 2 developer asset, 3 agent service.
  `metadataURI` points to JSON (logo, description, contact, terms); the chain never fetches it.
- `Listing(seller, itemId) → price`, unlimited, for programmatic catalogues. Same escrow.
- `Purchase { buyer, seller, amount, releaseAt, settled, disputed, tokenId }` with
  `tokenId = keccak256(seller, itemId)`, so all receipts for one item share an id.
- `Offer { buyer, seller, amount, expiresAt, active, itemName }`, indexed per seller with
  swap-and-pop so `offersFor(seller)` stays small.
- `Project { owner, createdAt, name, metadataURI }`, ids from 1 (0 means an independent shop).
- `Design { creator, createdAt, mints, price, palette, pixels(bytes16), name }`.

### Suggested shop metadata JSON

```json
{
  "name": "Contract review desk",
  "description": "Fixed-scope Solidity reviews for BOT Chain projects.",
  "image": "ipfs://…/logo.png",
  "website": "https://…",
  "contact": "https://t.me/…",
  "terms": "Delivery within 3 days of purchase. Refund if not started."
}
```

## 5. Decisions

**One market contract for B2B and B2C.** The difference between selling a skin and selling an
audit is the category label and the delivery terms, not the payment logic. One escrow path means
one thing to audit.

**Projects as a registry, not as separate markets.** Separate markets per project would split
buyers, receipts and reputation. A registry plus a `projectId` on each shop keeps one market with
many views of it.

**Curation without gatekeeping.** A project can highlight shops on its own frontend but cannot stop
anyone from joining or trading. Spam is handled where it is cheap: in each frontend's display
choices.

**No automatic settlement.** There is no keeper or timer. Anyone can call `release`, and
`releaseMany` lets a seller batch it. This keeps the contracts free of off-chain dependencies.

**Native BOT first.** Stablecoin payments come next as a separate path with the same escrow rules;
starting with one asset keeps the first audit small.

**Fully on-chain pixel designs.** 16 bytes plus a 16-bit palette per design means no external
storage to rot, and any app can render a design from a single view call.

**`paris` EVM target.** No post-Merge opcodes, so deployment does not depend on which later
upgrades the chain has enabled.

## 6. Out of scope

- Tokens, staking, points, order books, auctions with bidding wars, lending.
- Physical-goods logistics. Escrow covers payment, not shipping.
- On-chain arbitration in v1 (planned as an optional per-project contract).
- Indexers, caches, sharding before there are users.

## 7. Roadmap

Each step ships with tests on the local chain.

1. **Testnet (968)** deployment and a public web build pointing at it.
2. **Pixel Workshop on mainnet (677)**: creation and gallery only, gas only.
3. **Market on mainnet**: shops, escrow, offers, projects, Agent Pass.
4. **Stablecoin payments**: an ERC-20 path beside native BOT, same escrow rules.
5. **Agent toolkit**: SDK and MCP server so agents can open shops, answer offers within an
   owner-set floor (`haggle.mjs`) and confirm deliveries.
6. **Reputation view**: per-principal history (settled, refunded, disputed) from events.
7. **Optional arbitration** contract that projects can appoint for their district.
