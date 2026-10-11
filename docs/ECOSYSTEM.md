# BOT Bazaar and the BOT Chain ecosystem

How BOT Bazaar fits BOT Chain, what the first mainnet module would be, and what can be measured.
Programme details are from https://www.botchain.ai/en/ecosystem-support/ as read on 2026-10-11;
check that page for current terms.

## Fit

- **Token-less.** BOT Bazaar issues no token and plans no listing. The programme's community-growth
  track explicitly covers token-less tools, NFT and SocialFi projects.
- **Agent-native.** BOT Chain positions itself as an AI-native L1 for autonomous agents. BOT Bazaar
  gives agents a place to sell and buy, and `AgentPass` makes every agent accountable to a named
  principal.
- **Shared infrastructure.** Other BOT Chain projects can register a district and list their own
  shops without writing commerce contracts. Activity grows across projects, not inside one app.
- **Measurable from the chain.** Every meaningful action is an event, so users and interactions can
  be counted without trusting a server (there is none).

## Proposed first mainnet module

The **free pixel design creation and gallery flow** (`PixelWorkshop`) on mainnet 677:

| Item | State |
|---|---|
| Contract | `contracts/PixelWorkshop.sol`, covered by `npm run test:local` |
| Permissions | none: no owner, no admin, no fee; creators may set an optional price paid directly to them |
| Wallet flow | injected wallet (MetaMask, Rabby, OKX and others), `wallet_addEthereumChain` for 677 / 968 |
| Network config | `scripts/lib/networks.mjs` and `web/src/networks.ts`, checked against each other by `npm test` |
| Dependencies | solc 0.8.28 (`paris`), viem, Vite; no backend, no IPFS (designs are fully on chain) |
| Commerce and escrow | follow as a second step: `BazaarMarket`, `BazaarOffers`, `BazaarProjects`, `AgentPass` |

## Support that would help

- Technical onboarding and deployment gas for testnet and mainnet.
- Explorer source verification on scan.botchain.ai.
- A listing in the BOT Chain wallet's DApp store once the gallery is live.
- Introductions to BOT Chain projects that want a storefront district.

## Metrics

All from events, reportable per day once mainnet is live:

| Metric | Source |
|---|---|
| Unique creators, designs, collections | `DesignRegistered`, `DesignCollected` |
| Shops opened, by category and project | `ShopOpened` |
| Purchases and volume | `Purchased`, `Settled` |
| Settlement vs refund vs dispute rate | `Settled`, `Refunded`, `Disputed` |
| Offers made and accepted | `OfferMade`, `OfferAccepted` |
| Projects and featured shops | `ProjectRegistered`, `Featured` |
| Agents linked to principals | `Linked` |
